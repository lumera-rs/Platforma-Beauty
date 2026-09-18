import { randomBytes } from "node:crypto";
import net from "node:net";
import pg from "pg";
import {
  applyMigrations,
  adoptBaseline,
  migrationStatus,
} from "../migrations/runner";
import { loadMigrations } from "../migrations/files";
import { preflightBaselineAdoption, type AdoptionPreflightReport } from "../migrations/preflight";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "../schema-drift/catalog";
import { beginFingerprintTransaction } from "../schema-drift/fingerprint-transaction";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "../schema-drift/fingerprint";
import { ownershipExceptions } from "../schema-drift/ownership";
import {
  loadRepositoryCrosswalk,
  type AdditionalStartupOperation,
  type StartupMigrationMapping,
} from "../startup-migration-crosswalk";

type PoolClient = pg.PoolClient;

export interface DisposableDatabase {
  readonly name: string;
  readonly owner: string;
  readonly pool: pg.Pool;
  /** Internal-only child target; never include it in a generated report. */
  readonly connectionString: string;
}

export interface OperationCoverage {
  readonly totalMappings: number;
  readonly mappingStatusCounts: Readonly<Record<string, number>>;
  readonly additionalOperationCount: number;
  readonly additionalStatusCounts: Readonly<Record<string, number>>;
  readonly additionalCategoryCounts: Readonly<Record<string, number>>;
  readonly unresolvedAdditionalOperationIds: readonly string[];
}

export interface ObservableState {
  readonly fingerprint: CatalogFingerprintResult;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly rowCountsAreNotContentProof: true;
}

export interface ObservableDifference {
  readonly structuralFingerprintChanged: boolean;
  readonly physicalFingerprintChanged: boolean;
  readonly changedRowCounts: Readonly<Record<string, { before: number; after: number }>>;
  readonly catalogChanges: readonly {
    kind: string; identity: string; before: unknown; after: unknown;
  }[];
}

export interface RolloutCharacterization {
  readonly name: string;
  readonly injectedPool: boolean;
  readonly executed: boolean;
  readonly before?: ObservableState;
  readonly after?: ObservableState;
  readonly difference?: ObservableDifference;
  readonly error?: string;
}

export interface EquivalenceReport {
  readonly provenance: {
    readonly kind: "DISPOSABLE_CHILD_DATABASES_ONLY";
    readonly adminTarget: "EXPLICIT_LOOPBACK_NONDEFAULT_PORT";
    readonly productionClaim: false;
  };
  readonly operationCoverage: OperationCoverage;
  readonly canonicalMigration: {
    readonly id: string;
    readonly freshApply: string;
    readonly freshApplyRepeat: string;
    readonly freshFingerprint: FingerprintEvidence;
    readonly reconstructedFingerprint: FingerprintEvidence;
    readonly adoptedFingerprint: FingerprintEvidence;
    readonly reconstructedPreflight: AdoptionPreflightReport;
    readonly reconstructedAdoption: string;
    readonly reconstructedAdoptionRepeat: string;
    readonly freshAndReconstructedFingerprintsEqual: boolean;
  };
  readonly observableDataLimitation: "ROW_COUNTS_DO_NOT_PROVE_ROW_CONTENT";
  readonly driftRejection: {
    readonly readiness: AdoptionPreflightReport["readiness"];
    readonly blockers: readonly string[];
  };
  readonly partialSchemaRejection: {
    readonly readiness: AdoptionPreflightReport["readiness"];
    readonly blockers: readonly string[];
  };
  readonly startupRollouts: readonly RolloutCharacterization[];
  readonly startupRepeat: readonly RolloutCharacterization[];
  readonly finalStartupDifference: ObservableDifference;
  readonly startupRepeatDifference: ObservableDifference;
  readonly repeatedStartupPreflight: AdoptionPreflightReport | null;
  readonly blockers: readonly string[];
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll(`"`, `""`)}"`;
}

function loopbackHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || (net.isIP(hostname) === 4 && hostname.startsWith("127."));
}

/**
 * Mutating database work is deliberately impossible without an explicit,
 * loopback, non-default-port administrator URL. This function never consults
 * DATABASE_URL or any other ambient secret.
 */
export function validateDisposableAdminUrl(input: string): URL {
  let target: URL;
  try {
    target = new URL(input);
  } catch {
    throw new Error("Disposable characterization requires a valid PostgreSQL URL.");
  }
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("Disposable characterization requires a postgres:// URL.");
  }
  if (!loopbackHost(target.hostname)) {
    throw new Error("Disposable characterization only accepts a loopback database host.");
  }
  if (!target.port || Number(target.port) === 5432) {
    throw new Error("Disposable characterization requires an explicit non-default database port.");
  }
  if (!Number.isInteger(Number(target.port)) || Number(target.port) < 1 || Number(target.port) > 65535) {
    throw new Error("Disposable characterization requires a valid database port.");
  }
  if (target.search || target.hash || target.password) {
    throw new Error("Disposable target refuses query overrides, fragments, and passwords.");
  }
  if (!target.username || !/^\/[a-zA-Z_][a-zA-Z0-9_]*$/.test(target.pathname)) {
    throw new Error("Disposable target requires an explicit username and database.");
  }
  return target;
}

export function explicitAdminUrlFromArgs(
  argv: readonly string[] = [...process.argv.slice(2), ...process.execArgv],
): string | undefined {
  const argument = argv.find((value) => value.startsWith("--admin-url="));
  return argument?.slice("--admin-url=".length) || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function aggregateErrors(primary: unknown | undefined, cleanup: readonly unknown[]): Error | undefined {
  if (!primary && cleanup.length === 0) return undefined;
  const errors = [primary, ...cleanup].filter((value): value is unknown => value !== undefined);
  if (errors.length === 1) return errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
  return new AggregateError(errors, "Disposable characterization cleanup failed");
}

async function withClient<T>(pool: pg.Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function withOwnedDisposableDatabase<T>(
  adminUrl: string,
  callback: (database: DisposableDatabase) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.REPLIT_DEPLOYMENT_ID) {
    throw new Error("Disposable characterization is forbidden in a deployment runtime.");
  }
  const target = validateDisposableAdminUrl(adminUrl);
  const admin = new pg.Pool({ connectionString: target.toString(), password: "", max: 2, connectionTimeoutMillis: 5_000 });
  const childName = `lumera_startup_equivalence_${process.pid}_${randomBytes(8).toString("hex")}`;
  let child: pg.Pool | undefined;
  let created = false;
  let owner = "";
  let result: T | undefined;
  let callbackCompleted = false;
  let callbackError: unknown;
  try {
    const ownerResult = await admin.query<{ current_user: string }>(
      "SELECT current_user",
    );
    owner = ownerResult.rows[0]?.current_user ?? "";
    if (!owner) throw new Error("Disposable administrator identity was not returned.");
    await admin.query(`CREATE DATABASE ${quoteIdentifier(childName)} OWNER ${quoteIdentifier(owner)}`);
    created = true;
    const ownership = await admin.query<{ datname: string; owner: string }>(
      `SELECT d.datname, pg_catalog.pg_get_userbyid(d.datdba) AS owner
       FROM pg_catalog.pg_database d WHERE d.datname = $1`,
      [childName],
    );
    if (ownership.rows.length !== 1 || ownership.rows[0]?.owner !== owner) {
      throw new Error("Generated disposable database ownership validation failed.");
    }
    const childTarget = new URL(target.toString());
    childTarget.pathname = `/${encodeURIComponent(childName)}`;
    child = new pg.Pool({ connectionString: childTarget.toString(), password: "", max: 4, connectionTimeoutMillis: 5_000 });
    const identity = await child.query("SELECT current_database() AS name, current_user AS owner");
    if (identity.rows[0]?.name !== childName || identity.rows[0]?.owner !== owner) {
      throw new Error("Disposable child connection identity mismatch.");
    }
    result = await callback({
      name: childName,
      owner,
      pool: child,
      connectionString: childTarget.toString(),
    });
    callbackCompleted = true;
  } catch (error) {
    callbackError = error;
  }
  const cleanupErrors: unknown[] = [];
  try {
    await child?.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (created) {
    try {
      await admin.query(`DROP DATABASE ${quoteIdentifier(childName)} WITH (FORCE)`);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const remaining = await admin.query<{ datname: string }>(
        "SELECT datname FROM pg_catalog.pg_database WHERE datname = $1",
        [childName],
      );
      if (remaining.rows.length !== 0) {
        cleanupErrors.push(new Error(`Owned disposable database still exists after cleanup: ${childName}`));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
  const finalError = aggregateErrors(callbackError, cleanupErrors);
  if (finalError) throw finalError;
  if (!callbackCompleted) {
    throw new Error(`Disposable database callback did not return a result for ${childName}`);
  }
  return result as T;
}

async function fingerprintAndRowCounts(pool: pg.Pool): Promise<ObservableState> {
  return withClient(pool, async (client) => {
    await beginFingerprintTransaction(client);
    let committed = false;
    try {
      const snapshot = await readPostgresSnapshot(client);
      const compatibility = await readPostgresFingerprintCompatibility(client);
      const result = fingerprintSnapshot(snapshot, ownershipExceptions, compatibility);
      const tables = await client.query<{ schema_name: string; table_name: string }>(`
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
        ORDER BY n.nspname, c.relname
      `);
      const rowCounts: Record<string, number> = {};
      for (const table of tables.rows) {
        const identity = `${table.schema_name}.${table.table_name}`;
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${quoteIdentifier(table.schema_name)}.${quoteIdentifier(table.table_name)}`,
        );
        rowCounts[identity] = Number(count.rows[0]?.count ?? 0);
      }
      await client.query("COMMIT");
      committed = true;
      return { fingerprint: result, rowCounts, rowCountsAreNotContentProof: true };
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackError: unknown) => {
        throw new AggregateError([error, rollbackError], "Fingerprint transaction rollback failed");
      });
      throw error;
    } finally {
      if (!committed) {
        // The catch block owns rollback and preserves its original error.
      }
    }
  });
}

function fingerprintEvidence(value: CatalogFingerprintResult): FingerprintEvidence {
  return {
    structuralFingerprint: value.structuralFingerprint,
    physicalFingerprint: value.physicalFingerprint,
    normalizedObjectCount: value.normalizedObjectCount,
    enumCount: value.enumCount,
    triggerCount: value.triggerCount,
    functionCount: value.functionCount,
    postgresVersionNum: value.postgresCompatibility.serverVersionNum,
  };
}

interface FingerprintEvidence {
  readonly structuralFingerprint: string;
  readonly physicalFingerprint: string;
  readonly normalizedObjectCount: number;
  readonly enumCount: number;
  readonly triggerCount: number;
  readonly functionCount: number;
  readonly postgresVersionNum: number;
}

export async function observableState(pool: pg.Pool): Promise<ObservableState> {
  return fingerprintAndRowCounts(pool);
}

export function observableDifference(before: ObservableState, after: ObservableState): ObservableDifference {
  const changedRowCounts: Record<string, { before: number; after: number }> = {};
  const tables = new Set([...Object.keys(before.rowCounts), ...Object.keys(after.rowCounts)]);
  for (const table of tables) {
    const left = before.rowCounts[table] ?? 0;
    const right = after.rowCounts[table] ?? 0;
    if (left !== right) changedRowCounts[table] = { before: left, after: right };
  }
  const catalogChanges: { kind: string; identity: string; before: unknown; after: unknown }[] = [];
  for (const kind of ["tables", "enums", "functions", "triggers"] as const) {
    const leftPayload = before.fingerprint.structuralPayload as unknown as Record<string, Record<string, unknown>[]>;
    const rightPayload = after.fingerprint.structuralPayload as unknown as Record<string, Record<string, unknown>[]>;
    const identity = (item: Record<string, unknown>): string =>
      [item.schema ?? item.tableSchema, item.tableName, item.name, item.identityArguments]
        .filter((part) => part !== undefined).join(".");
    const left = new Map(leftPayload[kind]!.map((item) => [identity(item), item]));
    const right = new Map(rightPayload[kind]!.map((item) => [identity(item), item]));
    for (const key of new Set([...left.keys(), ...right.keys()])) {
      if (JSON.stringify(left.get(key)) !== JSON.stringify(right.get(key))) {
        catalogChanges.push({ kind, identity: key, before: left.get(key) ?? null, after: right.get(key) ?? null });
      }
    }
  }
  return {
    structuralFingerprintChanged: before.fingerprint.structuralFingerprint !== after.fingerprint.structuralFingerprint,
    physicalFingerprintChanged: before.fingerprint.physicalFingerprint !== after.fingerprint.physicalFingerprint,
    changedRowCounts,
    catalogChanges,
  };
}

export function operationCoverage(): OperationCoverage {
  const { crosswalk } = loadRepositoryCrosswalk();
  const count = (values: readonly string[]): Readonly<Record<string, number>> =>
    values.reduce<Record<string, number>>((result, value) => {
      result[value] = (result[value] ?? 0) + 1;
      return result;
    }, {});
  return {
    totalMappings: crosswalk.mappings.length,
    mappingStatusCounts: count(crosswalk.mappings.map((item: StartupMigrationMapping) => item.status)),
    additionalOperationCount: crosswalk.additionalOperations.length,
    additionalStatusCounts: count(crosswalk.additionalOperations.map((item: AdditionalStartupOperation) => item.status)),
    additionalCategoryCounts: count(crosswalk.additionalOperations.map((item: AdditionalStartupOperation) => item.category)),
    unresolvedAdditionalOperationIds: crosswalk.additionalOperations.map((item) => item.id),
  };
}

async function executeCanonicalBody(pool: pg.Pool): Promise<void> {
  const migrations = await loadMigrations();
  const canonical = migrations[0];
  if (migrations.length !== 1 || canonical?.id !== "000001") {
    throw new Error("This reconstructed fixture is pinned to the 000001-only migration frontier.");
  }
  await withClient(pool, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(canonical.body);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

async function preflight(pool: pg.Pool): Promise<AdoptionPreflightReport> {
  return withClient(pool, async (client) => preflightBaselineAdoption(client, await loadMigrations()));
}

async function freshApply(pool: pg.Pool): Promise<string> {
  const migrations = await loadMigrations();
  const first = await withClient(pool, async (client) => applyMigrations(client, { migrations }));
  const repeat = await withClient(pool, async (client) => applyMigrations(client, { migrations }));
  return JSON.stringify({ first, repeat });
}

async function adopt(pool: pg.Pool): Promise<{
  readonly summary: string;
  readonly fingerprint: CatalogFingerprintResult;
}> {
  const result = await withClient(pool, async (client) => adoptBaseline(client, { migrations: await loadMigrations() }));
  return {
    summary: JSON.stringify({ adopted: result.adopted }),
    fingerprint: result.fingerprint,
  };
}

async function adoptRepeat(pool: pg.Pool): Promise<string> {
  const result = await withClient(pool, async (client) => adoptBaseline(client, { migrations: await loadMigrations() }));
  return JSON.stringify({ adopted: result.adopted });
}

async function characterizeInjectedRollouts(
  pool: pg.Pool,
  connectionString: string,
): Promise<{ first: RolloutCharacterization[]; repeat: RolloutCharacterization[] }> {
  if (process.env.DATABASE_URL !== undefined) {
    throw new Error("Disposable rollout characterization refuses an ambient DATABASE_URL.");
  }
  process.env.DATABASE_URL = connectionString;
  type BusinessGrowthModule = {
    ensureBusinessGrowthSchema: (schema: string, pool: pg.Pool) => Promise<void>;
  };
  type MediaModule = { ensureMediaSchema: (pool: pg.Pool) => Promise<void> };
  type ShippingModule = {
    ensureShippingConfigSchema: (schema: string, pool: pg.Pool) => Promise<void>;
  };
  type MarketplaceModule = { ensureMarketplacePerformanceIndexes: (pool: pg.Pool) => Promise<void> };
  type WebPushModule = {
    ensureWebPushSchema: (schema: string, pool: pg.Pool) => Promise<void>;
  };
  type BookingModule = {
    ensureBookingCommandSchema: (schema: string, pool: pg.Pool) => Promise<void>;
  };
  type EducationBundleModule = {
    ensureEducationBundlePurchaseSchema: (schema: string, pool: pg.Pool) => Promise<void>;
  };
  type DatabaseModule = { closePool: () => Promise<void>; pool: pg.Pool };
  const importModule = (specifier: string): Promise<Record<string, unknown>> => import(specifier);
  let closeDefaultPool: (() => Promise<void>) | undefined;
  let injectedRollouts: readonly {
    name: string;
    injectedPool?: boolean;
    run: (pool: pg.Pool) => Promise<void>;
  }[] = [];
  try {
    /*
     * These imports are deliberately delayed until after the child target has
     * been created and verified. The modules construct @workspace/db at
     * import-time; setting DATABASE_URL to this owned child target prevents an
     * ambient or production pool from ever being created. Referral is loaded
     * only after that safe default pool is bound to the child target.
    */
    const database = await importModule("@workspace/db") as DatabaseModule;
    closeDefaultPool = database.closePool;
    // Module caches must never reuse a pool previously initialized for another
    // database, even if the environment was changed before this import.
    const identity = await database.pool.query("SELECT current_database() AS name");
    if (identity.rows[0]?.name !== new URL(connectionString).pathname.slice(1)) {
      throw new Error("Default pool does not target the owned disposable child.");
    }
    const [
      businessGrowth,
      media,
      shipping,
      marketplace,
      referral,
      webPush,
      booking,
      educationBundle,
    ] = await Promise.all([
      importModule("../../../artifacts/api-server/src/lib/business-growth-schema"),
      importModule("../../../artifacts/api-server/src/lib/media-schema"),
      importModule("../../../artifacts/api-server/src/lib/shipping-config"),
      importModule("../../../artifacts/api-server/src/lib/marketplace-performance-schema"),
      importModule("../../../artifacts/api-server/src/lib/referral-schema"),
      importModule("../../../artifacts/api-server/src/lib/web-push-schema"),
      importModule("../../../artifacts/api-server/src/lib/booking-command-schema"),
      importModule("../../../artifacts/api-server/src/lib/education-bundle-purchase-schema"),
    ]) as [
      BusinessGrowthModule,
      MediaModule,
      ShippingModule,
      MarketplaceModule,
      { ensureReferralSchema: (schema: string) => Promise<void> },
      WebPushModule,
      BookingModule,
      EducationBundleModule,
    ];
    injectedRollouts = [
      { name: "ensureBusinessGrowthSchema", run: (target) => businessGrowth.ensureBusinessGrowthSchema("public", target) },
      { name: "ensureMediaSchema", run: (target) => media.ensureMediaSchema(target) },
      { name: "ensureShippingConfigSchema", run: (target) => shipping.ensureShippingConfigSchema("public", target) },
      { name: "ensureMarketplacePerformanceIndexes", run: (target) => marketplace.ensureMarketplacePerformanceIndexes(target) },
      { name: "ensureReferralSchema", injectedPool: false, run: () => referral.ensureReferralSchema("public") },
      { name: "ensureWebPushSchema", run: (target) => webPush.ensureWebPushSchema("public", target) },
      { name: "ensureBookingCommandSchema", run: (target) => booking.ensureBookingCommandSchema("public", target) },
      { name: "ensureEducationBundlePurchaseSchema", run: (target) => educationBundle.ensureEducationBundlePurchaseSchema("public", target) },
    ];
  } catch (error) {
    await closeDefaultPool?.();
    throw error;
  } finally {
    delete process.env.DATABASE_URL;
  }
  const passes: RolloutCharacterization[][] = [];
  try {
    for (let pass = 0; pass < 2; pass += 1) {
    const result: RolloutCharacterization[] = [];
    for (const [index, rollout] of injectedRollouts.entries()) {
      const before = await observableState(pool);
      try {
        await rollout.run(pool);
        const after = await observableState(pool);
        result.push({
          name: rollout.name,
          injectedPool: rollout.injectedPool ?? true,
          executed: true,
          before,
          after,
          difference: observableDifference(before, after),
        });
      } catch (error) {
        result.push({
          name: rollout.name,
          injectedPool: rollout.injectedPool ?? true,
          executed: false,
          before,
          error: errorMessage(error),
        });
        for (const later of injectedRollouts.slice(index + 1)) {
          result.push({
            name: later.name,
            injectedPool: later.injectedPool ?? true,
            executed: false,
            error: `NOT_EXECUTED_AFTER_PREVIOUS_FAILURE:${rollout.name}`,
          });
        }
        break;
      }
    }
    passes.push(result);
    if (result.some((item) => !item.executed)) break;
    }
  } finally {
    await closeDefaultPool?.();
  }
  return { first: passes[0] ?? [], repeat: passes[1] ?? [] };
}

export async function characterizeDisposableEquivalence(adminUrl: string): Promise<EquivalenceReport> {
  if (process.env.DATABASE_URL !== undefined) {
    throw new Error("Disposable characterization refuses an ambient DATABASE_URL before database creation.");
  }
  const coverage = operationCoverage();
  const blockers: string[] = [];
  let canonicalMigration = {
    id: "000001",
    freshApply: "",
    freshApplyRepeat: "",
    freshFingerprint: undefined as unknown as FingerprintEvidence,
    reconstructedFingerprint: undefined as unknown as FingerprintEvidence,
    adoptedFingerprint: undefined as unknown as FingerprintEvidence,
    reconstructedPreflight: undefined as unknown as AdoptionPreflightReport,
    reconstructedAdoption: "",
    reconstructedAdoptionRepeat: "",
    freshAndReconstructedFingerprintsEqual: false,
  };
  let driftRejection: EquivalenceReport["driftRejection"] = { readiness: "NOT_READY", blockers: ["NOT_RUN"] };
  let partialSchemaRejection: EquivalenceReport["partialSchemaRejection"] = { readiness: "NOT_READY", blockers: ["NOT_RUN"] };
  let startupRollouts: readonly RolloutCharacterization[] = [];
  let startupRepeat: readonly RolloutCharacterization[] = [];
  const emptyDifference = (): ObservableDifference => ({
    structuralFingerprintChanged: false,
    physicalFingerprintChanged: false,
    changedRowCounts: {},
    catalogChanges: [],
  });
  let finalStartupDifference = emptyDifference();
  let startupRepeatDifference = emptyDifference();
  let repeatedStartupPreflight: AdoptionPreflightReport | null = null;

  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    const freshApplyResult = JSON.parse(await freshApply(pool)) as {
      first: { applied: string[]; skipped: string[] };
      repeat: { applied: string[]; skipped: string[] };
    };
    canonicalMigration.freshApply = JSON.stringify(freshApplyResult.first);
    canonicalMigration.freshApplyRepeat = JSON.stringify(freshApplyResult.repeat);
    const freshState = await observableState(pool);
    canonicalMigration.freshFingerprint = fingerprintEvidence(freshState.fingerprint);
    await withOwnedDisposableDatabase(adminUrl, async ({ pool: reconstructed, connectionString }) => {
      await executeCanonicalBody(reconstructed);
      const reconstructedBeforeAdoption = await observableState(reconstructed);
      canonicalMigration.reconstructedFingerprint = fingerprintEvidence(reconstructedBeforeAdoption.fingerprint);
      canonicalMigration.reconstructedPreflight = await preflight(reconstructed);
      const adoption = await adopt(reconstructed);
      canonicalMigration.reconstructedAdoption = adoption.summary;
      canonicalMigration.reconstructedAdoptionRepeat = await adoptRepeat(reconstructed);
      const adoptedState = await observableState(reconstructed);
      canonicalMigration.adoptedFingerprint = fingerprintEvidence(adoptedState.fingerprint);
      canonicalMigration.freshAndReconstructedFingerprintsEqual =
        freshState.fingerprint.structuralFingerprint === reconstructedBeforeAdoption.fingerprint.structuralFingerprint
        && freshState.fingerprint.physicalFingerprint === reconstructedBeforeAdoption.fingerprint.physicalFingerprint;
      if (!canonicalMigration.freshAndReconstructedFingerprintsEqual) {
        blockers.push("FRESH_AND_RECONSTRUCTED_FINGERPRINT_MISMATCH");
      }
      if (canonicalMigration.reconstructedPreflight.readiness !== "READY") {
        blockers.push("RECONSTRUCTED_BASELINE_PREFLIGHT_NOT_READY");
      }
      if (adoptedState.fingerprint.structuralFingerprint !== freshState.fingerprint.structuralFingerprint) {
        blockers.push("ADOPTION_CHANGED_STRUCTURAL_FINGERPRINT");
      }

      await withOwnedDisposableDatabase(adminUrl, async ({ pool: drifted }) => {
        await executeCanonicalBody(drifted);
        await drifted.query("CREATE TABLE public.startup_equivalence_drift_marker (id integer)");
        const report = await preflight(drifted);
        driftRejection = { readiness: report.readiness, blockers: report.blockers };
        if (report.readiness !== "NOT_READY") blockers.push("DRIFT_WAS_NOT_REJECTED");
      });
      await withOwnedDisposableDatabase(adminUrl, async ({ pool: partial }) => {
        await executeCanonicalBody(partial);
        await partial.query("DROP FUNCTION public.prevent_incomplete_commercial_snapshot_insert()");
        const report = await preflight(partial);
        partialSchemaRejection = { readiness: report.readiness, blockers: report.blockers };
        if (report.readiness !== "NOT_READY") blockers.push("PARTIAL_SCHEMA_WAS_NOT_REJECTED");
      });
      const passes = await characterizeInjectedRollouts(reconstructed, connectionString);
      startupRollouts = passes.first;
      startupRepeat = passes.repeat;
      const firstEnd = startupRollouts.at(-1)?.after;
      const repeatEnd = startupRepeat.at(-1)?.after;
      if (firstEnd) finalStartupDifference = observableDifference(adoptedState, firstEnd);
      if (firstEnd && repeatEnd) startupRepeatDifference = observableDifference(firstEnd, repeatEnd);
      repeatedStartupPreflight = await preflight(reconstructed);
      if (startupRollouts.some((item) => !item.executed) || startupRepeat.length !== 8) {
        blockers.push("INJECTED_STARTUP_ROLLOUT_FAILED");
      }
      if (finalStartupDifference.structuralFingerprintChanged || finalStartupDifference.physicalFingerprintChanged) {
        blockers.push("FINAL_STARTUP_SCHEMA_DIFFERS_FROM_MIGRATIONS");
      }
      if (Object.keys(finalStartupDifference.changedRowCounts).length > 0) {
        blockers.push("STARTUP_SEED_OR_RECONCILIATION_DATA_MISSING_FROM_MIGRATIONS");
      }
      if (startupRepeat.some((item) => !item.executed)) blockers.push("STARTUP_REPEAT_FAILED");
      if (startupRepeatDifference.structuralFingerprintChanged || startupRepeatDifference.physicalFingerprintChanged) {
        blockers.push("STARTUP_REPEAT_CATALOG_DRIFT");
      }
      if (repeatedStartupPreflight.readiness === "NOT_READY") {
        blockers.push("RECONSTRUCTED_STARTUP_STATE_REJECTED_BY_PREFLIGHT");
      }
    });
  });
  if (coverage.unresolvedAdditionalOperationIds.length > 0) {
    blockers.push("UNRESOLVED_STARTUP_OPERATIONS_REMAIN");
  }
  return {
    provenance: {
      kind: "DISPOSABLE_CHILD_DATABASES_ONLY",
      adminTarget: "EXPLICIT_LOOPBACK_NONDEFAULT_PORT",
      productionClaim: false,
    },
    operationCoverage: coverage,
    canonicalMigration,
    driftRejection,
    partialSchemaRejection,
    startupRollouts,
    startupRepeat,
    finalStartupDifference,
    startupRepeatDifference,
    repeatedStartupPreflight,
    observableDataLimitation: "ROW_COUNTS_DO_NOT_PROVE_ROW_CONTENT",
    blockers: [...new Set(blockers)],
  };
}

export async function readMigrationStatus(pool: pg.Pool): Promise<Awaited<ReturnType<typeof migrationStatus>>> {
  return withClient(pool, async (client) => migrationStatus(client, await loadMigrations()));
}