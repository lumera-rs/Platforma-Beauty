import type { DatabaseClient } from "../backend-standards-database";
import { isDeploymentRuntime } from "./development-runtime";
import { assertTargetIdentity } from "./target-identity";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "../schema-drift/catalog";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "../schema-drift/fingerprint";
import { beginFingerprintTransaction, pinFingerprintEnvironment } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";
import { readOnlyQueryLayer, assertReadOnlyCatalogQuery } from "../schema-drift/read-only-query";
import { adoptLedgerRow, ensureLedger, markApplying, markFailed, markFinished, readLedger } from "./ledger";
import { loadMigrations } from "./files";
import { MIGRATION_MANIFEST } from "./manifest";
import { withMigrationAdvisoryLock } from "./lock";
import type {
  LoadedMigration, MigrationDatabaseClient, MigrationLedgerRow, MigrationRunResult, MigrationRunnerOptions,
} from "./types";
import { assertSupportedStartupState, lockSupportedStartupTables } from "./supported-state";
import {
  readDeploymentLedgerInspection,
} from "./deployment-eligibility";
import { isReviewedPostgresPatch } from "@workspace/db/migration-runtime";
import {
  ledgerIdentityFromTarget,
  ledgerIdentityMismatch,
  parseLedgerIdentity,
  type DatabaseTargetIdentity,
} from "@workspace/db/migration-runtime";

const BUSINESS_GROWTH_ADVISORY_KEY = 1111949377;

function assertSupportedMigrationDevelopmentOnly(): void {
  // REPLIT_ENVIRONMENT can have a production-like value in an editor
  // workspace. It is not a deployment indicator by itself; explicit
  // deployment flags and the separately verified target establish the boundary.
  if (isDeploymentRuntime(process.env)) {
    throw new Error("Supported startup-state migration is development-only and requires separate rollout authorization");
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingLedgerError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "42P01";
}

function validateLedger(
  rows: readonly MigrationLedgerRow[],
  migrations: readonly LoadedMigration[],
): Map<string, MigrationLedgerRow> {
  const known = new Map(migrations.map((migration) => [migration.id, migration]));
  const result = new Map<string, MigrationLedgerRow>();
  for (const row of rows) {
    const migration = known.get(row.id);
    if (!migration) throw new Error(`Ledger contains unknown or future migration: ${row.id}`);
    if (result.has(row.id)) throw new Error(`Ledger contains duplicate migration: ${row.id}`);
    if (row.checksum !== migration.checksum) {
      throw new Error(`Ledger checksum mismatch for ${row.id}: expected ${migration.checksum}, got ${row.checksum}`);
    }
    if (row.mode !== migration.mode) throw new Error(`Ledger mode mismatch for ${row.id}`);
    if (row.state === "FAILED" && !row.error) {
      throw new Error(`Ledger FAILED state has no failure detail for ${row.id}`);
    }
    if (row.state !== "FAILED" && row.error !== null) {
      throw new Error(`Ledger state has an unexpected failure detail for ${row.id}`);
    }
    result.set(row.id, row);
  }
  let blocked = false;
  for (const migration of migrations) {
    const row = result.get(migration.id);
    if (!row) {
      blocked = true;
      continue;
    }
    if (blocked) {
      throw new Error(`Ledger contains an inconsistent state after ${migration.id}`);
    }
    if (row.state === "FAILED" || row.state === "APPLYING") blocked = true;
  }
  return result;
}

function assertLedgerIdentity(
  rows: readonly MigrationLedgerRow[],
  target: DatabaseTargetIdentity,
  deployment: boolean,
): void {
  const expected = ledgerIdentityFromTarget(target);
  for (const row of rows) {
    const state = parseLedgerIdentity({
      database_name: row.databaseName,
      system_identifier: row.systemIdentifier,
      neon_project_id: row.neonProjectId,
      neon_branch_id: row.neonBranchId,
    });
    if (state.kind === "partial") {
      throw new Error(`Migration ledger identity partial for ${row.id}: ${state.component}`);
    }
    if (state.kind === "unbound") {
      if (deployment) throw new Error(`Migration ledger identity unbound for ${row.id}: databaseName`);
      continue;
    }
    const component = ledgerIdentityMismatch(state.identity, expected);
    if (component) throw new Error(`Migration ledger identity mismatch for ${row.id}: ${component}`);
  }
}

async function condition(client: DatabaseClient, sql: string, kind: "precondition" | "postcondition"): Promise<void> {
  assertReadOnlyCatalogQuery(sql);
  const result = await readOnlyQueryLayer(client).query(sql);
  if (result.rows.length !== 1) throw new Error(`${kind} returned an unexpected row count`);
  const value = Object.values(result.rows[0] ?? {})[0];
  if (!(value === true || value === "t" || value === "true" || value === 1 || value === "1")) {
    throw new Error(`${kind} failed`);
  }
}

async function executeMigration(
  client: MigrationDatabaseClient,
  migration: LoadedMigration,
  finishTransactional?: () => Promise<void>,
  transactionAlreadyOpen = false,
): Promise<void> {
  for (const sql of migration.preconditions) await condition(client, sql, "precondition");
  if (migration.mode === "transactional" && !transactionAlreadyOpen) {
    await client.query("BEGIN");
    try {
      await client.query(migration.body);
      for (const sql of migration.postconditions) await condition(client, sql, "postcondition");
      if (finishTransactional) await finishTransactional();
      await client.query("COMMIT");
    } catch (error) {
      // The migration error is the actionable error. A failed rollback is
      // cleanup context and must never replace it.
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } else if (migration.mode === "transactional") {
    await client.query(migration.body);
    for (const sql of migration.postconditions) await condition(client, sql, "postcondition");
    if (finishTransactional) await finishTransactional();
  } else {
    const statements = splitSqlStatements(migration.body);
    if (statements.length === 0) throw new Error(`Migration ${migration.id} has no executable SQL statement`);
    for (const statement of statements) await client.query(statement);
    for (const sql of migration.postconditions) await condition(client, sql, "postcondition");
  }
}

/**
 * PostgreSQL's simple-query protocol can wrap several semicolon-separated
 * commands in one implicit transaction. Nontransactional migrations therefore
 * send each top-level command separately. This lexer deliberately understands
 * only SQL quoting/comment boundaries; it does not attempt to parse SQL.
 */
export function splitSqlStatements(sql: string): string[] {
  const hasExecutableSql = (value: string): boolean => {
    let cursor = 0;
    while (cursor < value.length) {
      if (/\s/u.test(value[cursor] ?? "")) {
        cursor += 1;
        continue;
      }
      if (value.startsWith("--", cursor)) {
        const end = value.indexOf("\n", cursor + 2);
        cursor = end < 0 ? value.length : end + 1;
        continue;
      }
      if (value.startsWith("/*", cursor)) {
        let depth = 1;
        cursor += 2;
        while (cursor < value.length && depth > 0) {
          if (value.startsWith("/*", cursor)) {
            depth += 1;
            cursor += 2;
          } else if (value.startsWith("*/", cursor)) {
            depth -= 1;
            cursor += 2;
          } else {
            cursor += 1;
          }
        }
        if (depth > 0) throw new Error("Migration contains an unterminated block comment");
        continue;
      }
      return true;
    }
    return false;
  };
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let blockDepth = 0;
  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      blockDepth += 1;
      index += 2;
      while (index < sql.length && blockDepth > 0) {
        if (sql.startsWith("/*", index)) {
          blockDepth += 1;
          index += 2;
        } else if (sql.startsWith("*/", index)) {
          blockDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (blockDepth > 0) throw new Error("Migration contains an unterminated block comment");
      continue;
    }
    if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index];
      // With PostgreSQL's standard_conforming_strings=on, backslashes in
      // ordinary strings and quoted identifiers are ordinary characters.
      // Only the explicit E'...' form uses backslash escapes.
      const prefix = sql[index - 1];
      const beforePrefix = sql[index - 2];
      const escapeString = quote === "'"
        && (prefix === "e" || prefix === "E")
        && (beforePrefix === undefined || !/[A-Za-z0-9_$]/u.test(beforePrefix));
      index += 1;
      while (index < sql.length) {
        if (escapeString && sql[index] === "\\") {
          index += Math.min(2, sql.length - index);
        } else if (sql[index] === quote && sql[index + 1] === quote) {
          index += 2;
        } else if (sql[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      if (index >= sql.length && sql[index - 1] !== quote) {
        throw new Error("Migration contains an unterminated quoted token");
      }
      continue;
    }
    if (sql[index] === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (match) {
        const delimiter = match[0];
        const end = sql.indexOf(delimiter, index + delimiter.length);
        if (end < 0) throw new Error("Migration contains an unterminated dollar-quoted string");
        index = end + delimiter.length;
        continue;
      }
    }
    if (sql[index] === ";") {
      const statement = sql.slice(start, index).trim();
      if (hasExecutableSql(statement)) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  const final = sql.slice(start).trim();
  if (hasExecutableSql(final)) statements.push(final);
  return statements;
}

export async function applyMigrations(
  client: MigrationDatabaseClient,
  options: MigrationRunnerOptions = {},
): Promise<MigrationRunResult> {
  const targetIdentity = await assertTargetIdentity(client, options.expectedTargetIdentity);
  const migrations = options.migrations ?? await loadMigrations();
  if (migrations.some((migration) => migration.admissionContract)) {
    return applySupportedMigrations(client, migrations, options, targetIdentity);
  }
  return withMigrationAdvisoryLock(client, async () => {
    const namespaceInspection = await readDeploymentLedgerInspection(client, migrations);
    if (namespaceInspection.reasons.length) {
      throw new Error(`Unsupported migration ledger: ${namespaceInspection.reasons.join(",")}`);
    }
    if (namespaceInspection.exists) {
      assertLedgerIdentity(await readLedger(client), targetIdentity, isDeploymentRuntime(process.env));
    }
    await ensureLedger(client);
    const rows = validateLedger(await readLedger(client), migrations);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const migration of migrations) {
      const row = rows.get(migration.id);
      if (row?.state === "APPLIED" || row?.state === "ADOPTED") {
        skipped.push(migration.id);
        continue;
      }
      if (row?.state === "APPLYING" && migration.mode === "nontransactional") {
        throw new Error(`Interrupted nontransactional migration is halted: ${migration.id}`);
      }
      if (row?.state === "FAILED" && migration.mode === "nontransactional") {
        throw new Error(`Failed nontransactional migration requires recovery: ${migration.id}`);
      }
      await markApplying(client, migration, targetIdentity);
      try {
        await executeMigration(
          client,
          migration,
          migration.mode === "transactional"
            ? () => markFinished(client, migration.id, "APPLIED")
            : undefined,
        );
        if (migration.mode === "nontransactional") await markFinished(client, migration.id, "APPLIED");
        applied.push(migration.id);
      } catch (error) {
        // Keep the migration operation error primary. Ledger failure is
        // secondary cleanup and must not hide the SQL/condition failure.
        await markFailed(client, migration.id, errorText(error)).catch(() => undefined);
        throw error;
      }
    }
    return { applied, skipped };
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
}

/**
 * Admission-contract migrations are deliberately run as one transaction. In
 * particular, creating the ledger is not an eligibility probe: an unsupported
 * database must remain byte-for-byte unchanged, including having no ledger.
 */
async function applySupportedMigrations(
  client: MigrationDatabaseClient,
  migrations: readonly LoadedMigration[],
  options: MigrationRunnerOptions,
  targetIdentity: DatabaseTargetIdentity,
): Promise<MigrationRunResult> {
  assertSupportedMigrationDevelopmentOnly();
  const admitted = migrations.filter((migration) => migration.admissionContract);
  if (admitted.some((migration) => migration.admissionContract !== "supported-startup-v1")) {
    throw new Error("Unknown migration admission contract");
  }
  return withMigrationAdvisoryLock(client, async () => {
    const ledgerInspection = await readDeploymentLedgerInspection(client, migrations);
    const ledgerExists = ledgerInspection.exists;
    const rows = [...ledgerInspection.rows];
    if (ledgerInspection.reasons.length) {
      throw new Error(`Unsupported migration ledger: ${ledgerInspection.reasons.join(",")}`);
    }
    if (ledgerInspection.exists) {
      assertLedgerIdentity(await readLedger(client), targetIdentity, isDeploymentRuntime(process.env));
    }
    const checked = validateLedger(rows, migrations);
    for (const migration of admitted) {
      const row = checked.get(migration.id);
      if (row?.state === "ADOPTED") {
        throw new Error(`Data-bearing migration cannot be ADOPTED: ${migration.id}`);
      }
    }
    const baseline = migrations.find((migration) => migration.id === "000001");
    if (!baseline) throw new Error("Supported migration pipeline requires 000001 baseline");
    const pending = migrations.filter((migration) => !checked.has(migration.id));
    const schemaRelation = await client.query(
      "SELECT pg_catalog.to_regclass('public.subscription_plans') AS plans",
    );
    const hasCanonicalTable = schemaRelation.rows[0]?.["plans"] != null;
    const publicObjects = await client.query(`
      SELECT count(*)::integer AS count
      FROM (
        SELECT c.oid
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public'
        UNION ALL
        SELECT p.oid
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
        UNION ALL
        SELECT t.oid
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public'
      ) objects
    `);
    const hasPublicObjects = Number(publicObjects.rows[0]?.["count"] ?? 0) > 0;
    if (!ledgerExists && hasCanonicalTable) {
      throw new Error("Supported migration refuses an existing schema without a migration ledger; adoption is explicit");
    }
    if (!ledgerExists && !hasCanonicalTable && hasPublicObjects) {
      throw new Error("Supported migration refuses a partially initialized schema without a migration ledger");
    }
    if (!pending.length) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await pinFingerprintEnvironment(client);
        await client.query(
          `SELECT pg_catalog.pg_advisory_xact_lock(${BUSINESS_GROWTH_ADVISORY_KEY})`,
        );
        // The admission contract protects the initial transition only. Once
        // every step is APPLIED, normal tenant/runtime rows are expected and
        // must not be re-tested against the empty bootstrap-state predicate.
        // The catalog fingerprint remains the replay frontier invariant.
        const finalFingerprint = await readCurrentFingerprint(client);
        const finalMigration = migrations[migrations.length - 1]!;
        assertMigrationFingerprint(finalFingerprint, finalMigration);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      return { applied: [], skipped: migrations.map((migration) => migration.id) };
    }
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await pinFingerprintEnvironment(client);
      await client.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(${BUSINESS_GROWTH_ADVISORY_KEY})`,
      );
      if (hasCanonicalTable) {
        if (pending.some(migration => migration.admissionContract)) {
          await lockSupportedStartupTables(client);
          await assertSupportedStartupState(client);
        } else {
          // Once the admitted data transition is APPLIED, subsequent additive
          // schema migrations must accept ordinary tenant rows. Preserve the
          // exact previous catalog frontier, not the initial seed-state test.
          const previous = migrations.filter(migration => checked.has(migration.id)).at(-1);
          if (!previous) throw new Error("Supported migration has no applied predecessor");
          assertMigrationFingerprint(await readCurrentFingerprint(client), previous);
        }
      }
      await ensureLedger(client);
      const txRows = validateLedger(await readLedger(client), migrations);
      const applied: string[] = [];
      const skipped: string[] = [];
      for (const migration of migrations) {
        const row = txRows.get(migration.id);
        if (row?.state === "APPLIED" || row?.state === "ADOPTED") {
          skipped.push(migration.id);
          continue;
        }
        if (row) throw new Error(`Supported migration cannot resume ledger state ${row.state}: ${migration.id}`);
        await markApplying(client, migration, targetIdentity);
        await executeMigration(
          client,
          migration,
          () => markFinished(client, migration.id, "APPLIED"),
          true,
        );
        applied.push(migration.id);
        if (migration.id === "000001") {
          // The fresh baseline was admitted as an empty catalog. Re-lock the
          // newly-created relations before validating the post-baseline state.
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query("SET LOCAL statement_timeout = '30s'");
          await pinFingerprintEnvironment(client);
          await lockSupportedStartupTables(client);
          await assertSupportedStartupState(client);
        } else if (migration.admissionContract) {
          await assertSupportedStartupState(client);
        }
        const finalFingerprint = await readCurrentFingerprint(client);
        if (
          finalFingerprint.structuralFingerprint !== migration.structuralFingerprint
          || finalFingerprint.physicalFingerprint !== migration.physicalFingerprint
          || finalFingerprint.fingerprintVersion !== migration.fingerprintVersion
          || finalFingerprint.formatVersion !== migration.formatVersion
          || finalFingerprint.normalizedObjectCount !== migration.normalizedObjectCount
          || finalFingerprint.enumCount !== migration.enumCount
          || finalFingerprint.triggerCount !== migration.triggerCount
          || finalFingerprint.functionCount !== migration.functionCount
        ) {
          throw new Error(`Migration ${migration.id} did not produce its declared catalog fingerprint`);
        }
      }
      await client.query("COMMIT");
      return { applied, skipped };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
}

function assertMigrationFingerprint(
  fingerprint: CatalogFingerprintResult,
  migration: LoadedMigration,
): void {
  if (
    fingerprint.structuralFingerprint !== migration.structuralFingerprint
    || fingerprint.physicalFingerprint !== migration.physicalFingerprint
    || fingerprint.fingerprintVersion !== migration.fingerprintVersion
    || fingerprint.formatVersion !== migration.formatVersion
    || fingerprint.normalizedObjectCount !== migration.normalizedObjectCount
    || fingerprint.enumCount !== migration.enumCount
    || fingerprint.triggerCount !== migration.triggerCount
    || fingerprint.functionCount !== migration.functionCount
  ) {
    throw new Error(`Migration ${migration.id} did not produce its declared catalog fingerprint`);
  }
}

export interface MigrationStatus {
  readonly id: string;
  readonly description: string;
  readonly state: "PENDING" | "APPLYING" | "APPLIED" | "FAILED" | "ADOPTED";
  readonly checksum: string;
}

export async function migrationStatus(
  client: DatabaseClient,
  migrations?: readonly LoadedMigration[],
): Promise<MigrationStatus[]> {
  const loadedMigrations = migrations ?? await loadMigrations();
  let rows: MigrationLedgerRow[] = [];
  try {
    rows = await readLedger(client);
  } catch (error) {
    if (!isMissingLedgerError(error)) throw error;
  }
  const ledger = validateLedger(rows, loadedMigrations);
  return loadedMigrations.map((migration) => ({
    id: migration.id,
    description: migration.description,
    state: ledger.get(migration.id)?.state ?? "PENDING",
    checksum: migration.checksum,
  }));
}

async function readCurrentFingerprint(client: DatabaseClient): Promise<CatalogFingerprintResult> {
  await pinFingerprintEnvironment(client);
  const readOnly = readOnlyQueryLayer(client);
  return fingerprintSnapshot(
    await readPostgresSnapshot(readOnly),
    ownershipExceptions,
    await readPostgresFingerprintCompatibility(readOnly),
  );
}

async function currentFingerprint(client: DatabaseClient): Promise<CatalogFingerprintResult> {
  await beginFingerprintTransaction(client);
  try {
    const result = await readCurrentFingerprint(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function adoptBaseline(
  client: MigrationDatabaseClient,
  options: MigrationRunnerOptions = {},
): Promise<{ readonly adopted: string[]; readonly fingerprint: CatalogFingerprintResult }> {
  const targetIdentity = await assertTargetIdentity(client, options.expectedTargetIdentity);
  const migrations = options.migrations ?? await loadMigrations();
  if (migrations.some((migration) => migration.admissionContract)) {
    assertSupportedMigrationDevelopmentOnly();
    return adoptSupportedBaseline(client, migrations, options, targetIdentity);
  }
  return withMigrationAdvisoryLock(client, async () => {
    // Namespace admission is part of every supported branch, including
    // explicit baseline adoption. It must run before fingerprint reads or any
    // ledger mutation so an untracked schema cannot shadow runtime queries.
    const namespaceInspection = await readDeploymentLedgerInspection(client, migrations);
    if (namespaceInspection.reasons.length) {
      throw new Error(`Unsupported migration ledger: ${namespaceInspection.reasons.join(",")}`);
    }
    let existingRows: MigrationLedgerRow[] = [];
    const ledgerRelation = await client.query(
      "SELECT pg_catalog.to_regclass('public.lumera_migration_ledger') AS ledger",
    );
    if (ledgerRelation.rows[0]?.["ledger"] != null) {
      existingRows = await readLedger(client);
      assertLedgerIdentity(existingRows, targetIdentity, isDeploymentRuntime(process.env));
    }
    validateLedger(existingRows, migrations);
    const fingerprint = await currentFingerprint(client);
    const expected = migrations.find((migration) => migration.id === "000001");
    if (!expected) throw new Error("Baseline adoption requires immutable 000001 manifest entry");
    if (migrations.some((migration) => migration.id !== "000001" && migration.admissionContract)) {
      // Data-bearing state cannot be inferred from a catalog fingerprint.
      // It must be applied, never synthesized as ADOPTED.
      if (existingRows.some((row) => row.id !== "000001" && row.state === "ADOPTED")) {
        throw new Error("Baseline adoption cannot adopt data-bearing migration rows");
      }
    }
    if (
      fingerprint.fingerprintVersion !== expected.fingerprintVersion
      || fingerprint.formatVersion !== expected.formatVersion
      || !isReviewedPostgresPatch({
        postgresServerMajorVersion: fingerprint.postgresCompatibility.serverMajorVersion,
        postgresServerVersionNum: fingerprint.postgresCompatibility.serverVersionNum,
        postgresDeparserFormat: fingerprint.postgresCompatibility.deparserFormat,
      }, expected.postgresMajor)
      || fingerprint.structuralFingerprint !== expected.structuralFingerprint
      || fingerprint.physicalFingerprint !== expected.physicalFingerprint
      || fingerprint.normalizedObjectCount !== expected.normalizedObjectCount
      || fingerprint.enumCount !== expected.enumCount
      || fingerprint.triggerCount !== expected.triggerCount
      || fingerprint.functionCount !== expected.functionCount
    ) {
      throw new Error(
        `Migration baseline adoption mismatch: expected structural ${expected.structuralFingerprint} `
        + `and physical ${expected.physicalFingerprint}, got structural ${fingerprint.structuralFingerprint} `
        + `and physical ${fingerprint.physicalFingerprint}`,
      );
    }
    await ensureLedger(client);
    const rows = validateLedger(await readLedger(client), migrations);
    for (const migration of migrations.filter((item) => item.id === "000001")) {
      const row = rows.get(migration.id);
      if (row && row.state !== "ADOPTED" && row.state !== "APPLIED") {
        throw new Error(`Migration baseline adoption found inconsistent ledger state for ${migration.id}: ${row.state}`);
      }
      if (row?.state === "APPLIED") continue;
      await adoptLedgerRow(client, migration, targetIdentity);
    }
    return { adopted: ["000001"], fingerprint };
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
}

/**
 * Data-bearing adoption is deliberately separate from the legacy schema-only
 * helper. Every read and initial-data check runs inside the migration and
 * BusinessGrowth lock transaction before the ledger can be created.
 */
async function adoptSupportedBaseline(
  client: MigrationDatabaseClient,
  migrations: readonly LoadedMigration[],
  options: MigrationRunnerOptions,
  targetIdentity: DatabaseTargetIdentity,
): Promise<{ readonly adopted: string[]; readonly fingerprint: CatalogFingerprintResult }> {
  return withMigrationAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await pinFingerprintEnvironment(client);
      await client.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(${BUSINESS_GROWTH_ADVISORY_KEY})`,
      );
      await lockSupportedStartupTables(client);

      const inspection = await readDeploymentLedgerInspection(client, migrations);
      if (inspection.reasons.length) {
        throw new Error(`Unsupported migration ledger: ${inspection.reasons.join(",")}`);
      }
      if (inspection.exists) {
        assertLedgerIdentity(await readLedger(client), targetIdentity, isDeploymentRuntime(process.env));
      }
      const rows = new Map(inspection.rows.map((row) => [row.id, row]));
      const baseline = migrations.find((migration) => migration.id === "000001");
      const dataMigration = migrations.find((migration) => migration.admissionContract);
      if (!baseline || !dataMigration) throw new Error("Supported adoption requires baseline and data migration");
      const baselineRow = rows.get("000001");
      const dataRow = rows.get(dataMigration.id);

      // A completed supported transition is a tracked runtime state. Adoption
      // is idempotent and must not re-run empty-bootstrap admission against
      // normal user/tenant data.
      if (dataRow?.state === "APPLIED") {
        if (!baselineRow || (baselineRow.state !== "APPLIED" && baselineRow.state !== "ADOPTED")) {
          throw new Error("Supported adoption requires a completed baseline before the data migration");
        }
        const fingerprint = await readCurrentFingerprint(client);
        const completedFrontier = migrations.filter(migration => {
          const state = rows.get(migration.id)?.state;
          return state === "APPLIED" || state === "ADOPTED";
        }).at(-1)!;
        assertMigrationFingerprint(fingerprint, completedFrontier);
        await client.query("COMMIT");
        return { adopted: [], fingerprint };
      }

      const fingerprint = await readCurrentFingerprint(client);
      if (
        fingerprint.fingerprintVersion !== baseline.fingerprintVersion
        || fingerprint.formatVersion !== baseline.formatVersion
        || !isReviewedPostgresPatch({
          postgresServerMajorVersion: fingerprint.postgresCompatibility.serverMajorVersion,
          postgresServerVersionNum: fingerprint.postgresCompatibility.serverVersionNum,
          postgresDeparserFormat: fingerprint.postgresCompatibility.deparserFormat,
        }, baseline.postgresMajor)
        || fingerprint.structuralFingerprint !== baseline.structuralFingerprint
        || fingerprint.physicalFingerprint !== baseline.physicalFingerprint
        || fingerprint.normalizedObjectCount !== baseline.normalizedObjectCount
        || fingerprint.enumCount !== baseline.enumCount
        || fingerprint.triggerCount !== baseline.triggerCount
        || fingerprint.functionCount !== baseline.functionCount
      ) {
        throw new Error("Supported baseline adoption requires the exact canonical baseline fingerprint");
      }
      await assertSupportedStartupState(client);

      await ensureLedger(client);
      const ledgerRows = validateLedger(await readLedger(client), migrations);
      const existing = ledgerRows.get(baseline.id);
      if (existing && existing.state !== "ADOPTED" && existing.state !== "APPLIED") {
        throw new Error(`Supported adoption found inconsistent ledger state for ${baseline.id}: ${existing.state}`);
      }
      if (!existing) await adoptLedgerRow(client, baseline, targetIdentity);
      await client.query("COMMIT");
      return { adopted: existing ? [] : [baseline.id], fingerprint };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
}

export interface BindMigrationLedgerIdentityResult {
  readonly bound: readonly string[];
}

/**
 * One-way compatibility command for receipts created before ledger identity
 * existed. Bound rows are immutable: this command never repairs or rebinds one.
 */
export async function bindMigrationLedgerIdentity(
  client: MigrationDatabaseClient,
  options: MigrationRunnerOptions = {},
): Promise<BindMigrationLedgerIdentityResult> {
  const targetIdentity = await assertTargetIdentity(client, options.expectedTargetIdentity);
  const migrations = options.migrations ?? await loadMigrations();
  return withMigrationAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      const inspection = await readDeploymentLedgerInspection(client, migrations);
      if (!inspection.exists) throw new Error("Migration ledger identity binding requires an existing ledger");
      if (inspection.reasons.length) {
        throw new Error(`Unsupported migration ledger: ${inspection.reasons.join(",")}`);
      }
      // Lock every receipt before deciding whether any row may be changed.
      // Together with the CAS update this makes the all-row refusal atomic,
      // including against writers that do not take the migration advisory lock.
      const rows = await readLedger(client, { forUpdate: true });
      validateLedger(rows, migrations);
      const expected = ledgerIdentityFromTarget(targetIdentity);
      const unbound: string[] = [];
      for (const row of rows) {
        const state = parseLedgerIdentity({
          database_name: row.databaseName,
          system_identifier: row.systemIdentifier,
          neon_project_id: row.neonProjectId,
          neon_branch_id: row.neonBranchId,
        });
        if (state.kind === "partial") {
          throw new Error(`Migration ledger identity partial for ${row.id}: ${state.component}`);
        }
        if (state.kind === "unbound") {
          unbound.push(row.id);
          continue;
        }
        const component = ledgerIdentityMismatch(state.identity, expected);
        if (component) throw new Error(`Migration ledger identity mismatch for ${row.id}: ${component}`);
      }
      await ensureLedger(client);
      const bound: string[] = [];
      for (const id of unbound) {
        const result = await client.query(`
          UPDATE public.lumera_migration_ledger
          SET database_name=$2, system_identifier=$3, neon_project_id=$4, neon_branch_id=$5
          WHERE migration_id=$1
            AND database_name IS NULL AND system_identifier IS NULL
            AND neon_project_id IS NULL AND neon_branch_id IS NULL
          RETURNING migration_id
        `, [id, expected.databaseName, expected.systemIdentifier,
          expected.neonProjectId, expected.neonBranchId]);
        if (result.rows.length !== 1) {
          throw new Error(`Migration ledger identity binding lost for ${id}: databaseName`);
        }
        bound.push(id);
      }
      await client.query("COMMIT");
      return { bound };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
}

export { MIGRATION_MANIFEST };
export const runMigrations = applyMigrations;
export const getMigrationStatus = migrationStatus;
export const adoptMigrationBaseline = adoptBaseline;