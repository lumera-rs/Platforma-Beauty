import type { DatabaseClient } from "../backend-standards-database";
import { readPostgresFingerprintCompatibility, readPostgresSnapshot } from "../schema-drift/catalog";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "../schema-drift/fingerprint";
import { beginFingerprintTransaction, pinFingerprintEnvironment } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";
import { readOnlyQueryLayer } from "../schema-drift/read-only-query";
import {
  assertPublicOnlyNamespaces,
  NON_PUBLIC_NAMESPACE_REASON,
  isReviewedPostgresPatch,
} from "@workspace/db/migration-runtime";
import { loadMigrations } from "./files";
import { MIGRATION_MANIFEST } from "./manifest";
import { assertSupportedStartupState } from "./supported-state";
import type { LoadedMigration, MigrationLedgerRow } from "./types";

export type DeploymentEligibilityPath = "FRESH_EMPTY" | "SUPPORTED_EXISTING" | "UNSUPPORTED";
export type DeploymentEligibilityMode = "INITIAL_TRANSITION" | "TRACKED_RUNTIME";

export interface DeploymentEligibilityReport {
  readonly path: DeploymentEligibilityPath;
  readonly mode: DeploymentEligibilityMode;
  readonly reasons: readonly string[];
  readonly pendingMigrationIds: readonly string[];
  readonly productionEligibility: "NOT_ASSESSED";
  readonly ledger: "MISSING" | "VALID" | "INVALID";
  readonly catalog: "EMPTY" | "CANONICAL" | "KNOWN_FAST_PATH" | "DRIFTED" | "UNKNOWN";
}

export interface DeploymentEligibilityOptions {
  readonly migrations?: readonly LoadedMigration[];
}

export interface DeploymentLedgerInspection {
  readonly exists: boolean;
  readonly rows: readonly MigrationLedgerRow[];
  readonly reasons: readonly string[];
}

function isMissingRelation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "42P01";
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function readCatalogFingerprint(client: DatabaseClient): Promise<CatalogFingerprintResult> {
  await pinFingerprintEnvironment(client);
  const readOnly = readOnlyQueryLayer(client);
  return fingerprintSnapshot(
    await readPostgresSnapshot(readOnly),
    ownershipExceptions,
    await readPostgresFingerprintCompatibility(readOnly),
  );
}

export async function readDeploymentLedgerInspection(
  client: DatabaseClient,
  migrations: readonly LoadedMigration[],
): Promise<DeploymentLedgerInspection> {
  const readOnly = readOnlyQueryLayer(client);
  await assertPublicOnlyNamespaces(readOnly);
  let relation: { rows: Array<Record<string, unknown>> };
  try {
    relation = await readOnly.query(
      "SELECT pg_catalog.to_regclass('public.lumera_migration_ledger') AS ledger",
    );
  } catch (error) {
    if (isMissingRelation(error)) return { exists: false, rows: [], reasons: [] };
    throw error;
  }
  if (relation.rows[0]?.ledger == null) return { exists: false, rows: [], reasons: [] };

  const known = new Map(migrations.map((migration) => [migration.id, migration]));
  const reasons: string[] = [];
  const raw = await readOnly.query(`
    SELECT migration_id, checksum, mode, state, error, started_at, finished_at
    FROM public.lumera_migration_ledger
    ORDER BY migration_id
  `);
  const rows: MigrationLedgerRow[] = [];
  const seen = new Set<string>();
  for (const item of raw.rows) {
    const id = String(item.migration_id);
    const migration = known.get(id);
    if (!migration) {
      reasons.push(`LEDGER_UNKNOWN_MIGRATION:${id}`);
      continue;
    }
    if (seen.has(id)) {
      reasons.push(`LEDGER_DUPLICATE_MIGRATION:${id}`);
      continue;
    }
    seen.add(id);
    const state = String(item.state);
    const mode = String(item.mode);
    if (String(item.checksum) !== migration.checksum) reasons.push(`LEDGER_CHECKSUM_MISMATCH:${id}`);
    if (mode !== migration.mode) reasons.push(`LEDGER_MODE_MISMATCH:${id}`);
    if (!["APPLYING", "APPLIED", "FAILED", "ADOPTED"].includes(state)) {
      reasons.push(`LEDGER_UNKNOWN_STATE:${id}`);
    }
    if (item.started_at == null) reasons.push(`LEDGER_MISSING_STARTED_AT:${id}`);
    if ((state === "APPLIED" || state === "ADOPTED") && item.finished_at == null) {
      reasons.push(`LEDGER_MISSING_FINISHED_AT:${id}`);
    }
    const startedAt = timestampMillis(item.started_at);
    const finishedAt = timestampMillis(item.finished_at);
    if (item.started_at != null && startedAt == null) reasons.push(`LEDGER_INVALID_STARTED_AT:${id}`);
    if (item.finished_at != null && finishedAt == null) reasons.push(`LEDGER_INVALID_FINISHED_AT:${id}`);
    if (startedAt != null && finishedAt != null && finishedAt < startedAt) {
      reasons.push(`LEDGER_FINISHED_BEFORE_STARTED:${id}`);
    }
    if (state === "FAILED" && !item.error) reasons.push(`LEDGER_FAILED_WITHOUT_ERROR:${id}`);
    if (state !== "FAILED" && item.error != null) reasons.push(`LEDGER_UNEXPECTED_ERROR:${id}`);
    rows.push({
      id,
      checksum: String(item.checksum),
      mode: mode as MigrationLedgerRow["mode"],
      state: state as MigrationLedgerRow["state"],
      error: item.error == null ? null : String(item.error),
    });
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const expected = migrations[index]!;
    const row = rows.find((candidate) => candidate.id === expected.id);
    if (!row) {
      if (rows.some((candidate) => Number(candidate.id) > Number(expected.id))) {
        reasons.push(`LEDGER_HOLE:${expected.id}`);
      }
      continue;
    }
    if (row.state === "APPLYING" || row.state === "FAILED") reasons.push(`LEDGER_INCOMPLETE:${expected.id}`);
    if (expected.id !== "000001" && row.state === "ADOPTED") {
      reasons.push(`LEDGER_DATA_MIGRATION_ADOPTED:${expected.id}`);
    }
  }
  return { exists: true, rows, reasons };
}

async function hasApplicationObjects(client: DatabaseClient): Promise<boolean> {
  const result = await readOnlyQueryLayer(client).query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype <> 'p'
    ) AS present
  `);
  return result.rows[0]?.present === true || result.rows[0]?.present === "true";
}

function catalogKind(
  fingerprint: CatalogFingerprintResult,
  baseline: Awaited<ReturnType<typeof loadMigrations>>[number],
  fast: { structural: string; physical: string },
): "CANONICAL" | "KNOWN_FAST_PATH" | "DRIFTED" {
  const reviewedPostgres = isReviewedPostgresPatch({
    postgresServerMajorVersion: fingerprint.postgresCompatibility.serverMajorVersion,
    postgresServerVersionNum: fingerprint.postgresCompatibility.serverVersionNum,
    postgresDeparserFormat: fingerprint.postgresCompatibility.deparserFormat,
  }, baseline.postgresMajor);
  const matches = reviewedPostgres
    && fingerprint.structuralFingerprint === baseline.structuralFingerprint
    && fingerprint.physicalFingerprint === baseline.physicalFingerprint
    && fingerprint.fingerprintVersion === baseline.fingerprintVersion
    && fingerprint.formatVersion === baseline.formatVersion
    && fingerprint.normalizedObjectCount === baseline.normalizedObjectCount
    && fingerprint.enumCount === baseline.enumCount
    && fingerprint.triggerCount === baseline.triggerCount
    && fingerprint.functionCount === baseline.functionCount;
  if (matches) return "CANONICAL";
  if (reviewedPostgres && fingerprint.structuralFingerprint === fast.structural
    && fingerprint.physicalFingerprint === fast.physical
    && fingerprint.fingerprintVersion === baseline.fingerprintVersion
    && fingerprint.formatVersion === baseline.formatVersion
    && fingerprint.normalizedObjectCount === baseline.normalizedObjectCount
    && fingerprint.enumCount === baseline.enumCount
    && fingerprint.triggerCount === baseline.triggerCount
    && fingerprint.functionCount === baseline.functionCount) return "KNOWN_FAST_PATH";
  return "DRIFTED";
}

/**
 * Classifies a database while the caller owns the transaction. This function
 * never creates a ledger or writes any application/catalog row.
 */
export async function classifyDeploymentEligibility(
  client: DatabaseClient,
  options: DeploymentEligibilityOptions = {},
): Promise<DeploymentEligibilityReport> {
  const migrations = options.migrations ?? await loadMigrations();
  const baseline = migrations.find((migration) => migration.id === "000001");
  const dataMigration = migrations.find((migration) => migration.admissionContract === "supported-startup-v1");
  const reasons: string[] = [];
  if (!baseline || !dataMigration) {
    return {
      path: "UNSUPPORTED", mode: "INITIAL_TRANSITION", reasons: ["MIGRATION_MANIFEST_INCOMPLETE"],
      pendingMigrationIds: [], productionEligibility: "NOT_ASSESSED", ledger: "INVALID", catalog: "UNKNOWN",
    };
  }
  let ledger: DeploymentLedgerInspection;
  try {
    ledger = await readDeploymentLedgerInspection(client, migrations);
  } catch (error) {
    if (error instanceof Error && error.message === NON_PUBLIC_NAMESPACE_REASON) {
      return {
        path: "UNSUPPORTED",
        mode: "INITIAL_TRANSITION",
        reasons: [NON_PUBLIC_NAMESPACE_REASON],
        pendingMigrationIds: [],
        productionEligibility: "NOT_ASSESSED",
        ledger: "INVALID",
        catalog: "UNKNOWN",
      };
    }
    throw error;
  }
  const applicationObjects = await hasApplicationObjects(client);
  if (!ledger.exists) {
    if (!applicationObjects) {
      return {
        path: "FRESH_EMPTY", mode: "INITIAL_TRANSITION", reasons: [],
        pendingMigrationIds: migrations.map((migration) => migration.id),
        productionEligibility: "NOT_ASSESSED", ledger: "MISSING", catalog: "EMPTY",
      };
    }
    return {
      path: "UNSUPPORTED", mode: "INITIAL_TRANSITION",
      reasons: ["EXISTING_SCHEMA_WITHOUT_VALID_LEDGER", ...ledger.reasons],
      pendingMigrationIds: migrations.map((migration) => migration.id),
      productionEligibility: "NOT_ASSESSED", ledger: "INVALID", catalog: "UNKNOWN",
    };
  }
  let fingerprint: CatalogFingerprintResult;
  try {
    fingerprint = await readCatalogFingerprint(client);
  } catch (error) {
    return {
      path: "UNSUPPORTED", mode: "INITIAL_TRANSITION",
      reasons: [`CATALOG_READ_FAILED:${errorCode(error)}`],
      pendingMigrationIds: [], productionEligibility: "NOT_ASSESSED",
      ledger: ledger.reasons.length ? "INVALID" : "VALID", catalog: "UNKNOWN",
    };
  }
  const kind = catalogKind(fingerprint, baseline, {
    structural: "b8b39c5dfdc9c19dec105cfecef8f6688a4a00982dd25b47847cc3d92a5c8a29",
    physical: "25becc22380e260a6d84f802f8b1c4a948159ac1d1f9266f171cd27d7fb4a048",
  });
  const byId = new Map(ledger.rows.map((row) => [row.id, row]));
  if (ledger.reasons.length) reasons.push(...ledger.reasons);
  const baselineRow = byId.get("000001");
  const dataRow = byId.get(dataMigration.id);
  if (!baselineRow) reasons.push("LEDGER_BASELINE_MISSING");
  if (baselineRow && baselineRow.state !== "APPLIED" && baselineRow.state !== "ADOPTED") {
    reasons.push("LEDGER_BASELINE_NOT_COMPLETE");
  }
  if (!dataRow) {
    if (kind === "DRIFTED") reasons.push("CATALOG_DRIFT");
    if (kind === "CANONICAL" || kind === "KNOWN_FAST_PATH") {
      try {
        await assertSupportedStartupState(client);
      } catch (error) {
        reasons.push(errorCode(error));
      }
    }
    return {
      path: reasons.length ? "UNSUPPORTED" : "SUPPORTED_EXISTING",
      mode: "INITIAL_TRANSITION",
      reasons: [...new Set(reasons)],
      pendingMigrationIds: [dataMigration.id],
      productionEligibility: "NOT_ASSESSED",
      ledger: reasons.some((reason) => reason.startsWith("LEDGER_")) ? "INVALID" : "VALID",
      catalog: kind,
    };
  }
  if (dataRow.state !== "APPLIED") reasons.push("LEDGER_DATA_MIGRATION_NOT_APPLIED");
  if (kind !== "CANONICAL") reasons.push(kind === "KNOWN_FAST_PATH" ? "CATALOG_FAST_PATH_NOT_CONVERGED" : "CATALOG_DRIFT");
  return {
    path: reasons.length ? "UNSUPPORTED" : "SUPPORTED_EXISTING",
    mode: "TRACKED_RUNTIME",
    reasons: [...new Set(reasons)],
    pendingMigrationIds: [],
    productionEligibility: "NOT_ASSESSED",
    ledger: reasons.some((reason) => reason.startsWith("LEDGER_")) ? "INVALID" : "VALID",
    catalog: kind,
  };
}

/** Standalone read-only wrapper for a deployment-readiness report. */
export async function inspectDeploymentEligibility(
  client: DatabaseClient,
  options: DeploymentEligibilityOptions = {},
): Promise<DeploymentEligibilityReport> {
  await beginFingerprintTransaction(client);
  try {
    const report = await classifyDeploymentEligibility(client, options);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export const deploymentEligibilityManifest = MIGRATION_MANIFEST;