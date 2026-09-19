import type { DatabaseClient } from "../backend-standards-database";
import { readPostgresFingerprintCompatibility, readPostgresSnapshot } from "../schema-drift/catalog";
import { fingerprintSnapshot } from "../schema-drift/fingerprint";
import { beginFingerprintTransaction } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";
import { readOnlyQueryLayer } from "../schema-drift/read-only-query";
import { readLedgerForPreflight } from "./read-only-ledger";
import type { LoadedMigration, MigrationLedgerRow } from "./types";
import {
  isReviewedPostgresPatch,
  POSTGRES_DEPARSE_FORMAT,
} from "@workspace/db/migration-runtime";

export type AdoptionPreflightReadiness = "READY" | "NOT_READY" | "ALREADY_INITIALIZED";

export interface AdoptionPreflightReport {
  /** This report can only assess the immutable schema baseline. */
  readonly scope: "SCHEMA_BASELINE_ONLY";
  /** Catalog identity cannot establish whether data migrations ran. */
  readonly dataMigrationEligibility: "NOT_ASSESSED";
  readonly readiness: AdoptionPreflightReadiness;
  readonly blockers: readonly string[];
  readonly migrationId: string;
  readonly baselineChecksum: "MATCH";
  readonly postgresVersionNum: number;
  readonly postgresMajor: number;
  readonly fingerprintVersion: number;
  readonly formatVersion: number;
  readonly structuralFingerprint: "MATCH" | "MISMATCH";
  readonly physicalFingerprint: "MATCH" | "MISMATCH";
  readonly normalizedObjectCount: number;
  readonly enumCount: number;
  readonly triggerCount: number;
  readonly functionCount: number;
  readonly requiredExtensions: Readonly<Record<string, "PRESENT" | "MISSING">>;
  readonly ledger: {
    readonly existence: "MISSING" | "PRESENT";
    readonly state: "UNINITIALIZED" | "VALID" | "BLOCKED";
    readonly rows: readonly { id: string; state: string; checksum: "MATCH" | "MISMATCH" }[];
  };
}

function inspectLedgerRows(
  rows: readonly MigrationLedgerRow[],
  migrations: readonly LoadedMigration[],
): { blockers: string[]; valid: boolean } {
  const expected = new Map(migrations.map((migration) => [migration.id, migration]));
  const baseline = migrations.find((migration) => migration.id === "000001");
  const blockers: string[] = [];
  for (const row of rows) {
    const migration = expected.get(row.id);
    if (!migration) blockers.push(`UNKNOWN_MIGRATION:${row.id}`);
    else {
      if (row.checksum !== migration.checksum) blockers.push(`CHECKSUM_MISMATCH:${row.id}`);
      if (row.mode !== migration.mode) blockers.push(`MODE_MISMATCH:${row.id}`);
    }
    if (row.state === "APPLYING") blockers.push(`APPLYING_MIGRATION:${row.id}`);
    if (row.state === "FAILED") blockers.push(`FAILED_MIGRATION:${row.id}`);
    if (row.id !== "000001" && expected.get(row.id)?.admissionContract && row.state === "ADOPTED") {
      blockers.push(`DATA_MIGRATION_ADOPTED:${row.id}`);
    }
  }
  return {
    blockers,
    valid: blockers.length === 0
      && rows.every((row) => row.state === "ADOPTED" || row.state === "APPLIED")
      && baseline !== undefined
      && rows.some((row) => row.id === baseline.id
        && (row.state === "ADOPTED" || row.state === "APPLIED")),
  };
}

export async function preflightBaselineAdoption(
  client: DatabaseClient,
  migrations: readonly LoadedMigration[],
): Promise<AdoptionPreflightReport> {
  const expected = migrations.find((migration) => migration.id === "000001");
  if (!expected) throw new Error("Adoption preflight requires a reviewed migration manifest");
  await beginFingerprintTransaction(client);
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    const readOnly = readOnlyQueryLayer(client);
    const compatibility = await readPostgresFingerprintCompatibility(readOnly);
    const snapshot = await readPostgresSnapshot(readOnly);
    const fingerprint = fingerprintSnapshot(snapshot, ownershipExceptions, compatibility);
    const ledgerRelation = await readOnly.query(
      "SELECT pg_catalog.to_regclass('public.lumera_migration_ledger') AS ledger",
    );
    const ledgerExists = ledgerRelation.rows[0]?.["ledger"] != null;
    let rows: MigrationLedgerRow[] = [];
    let ledgerUnreadable = false;
    if (ledgerExists) {
      try {
        rows = await readLedgerForPreflight(readOnly);
      } catch {
        ledgerUnreadable = true;
      }
    }
    const ledgerInspection = inspectLedgerRows(rows, migrations);
    const blockers = [...ledgerInspection.blockers];
    if (ledgerUnreadable) blockers.push("LEDGER_UNREADABLE");
    else if (ledgerExists && !ledgerInspection.valid) blockers.push("LEDGER_INCONSISTENT");
    const compare = (actual: unknown, wanted: unknown, code: string): void => {
      if (actual !== wanted) blockers.push(code);
    };
    // The manifest's 16.10 value is immutable evidence, not a runtime patch
    // lock. A patch is admitted only within the reviewed family and only when
    // the exact catalog/fingerprint metadata below still matches.
    compare(compatibility.serverMajorVersion, expected.postgresMajor, "POSTGRES_MAJOR_MISMATCH");
    if (compatibility.serverMajorVersion === expected.postgresMajor
      && !isReviewedPostgresPatch({
        postgresServerMajorVersion: compatibility.serverMajorVersion,
        postgresServerVersionNum: compatibility.serverVersionNum,
        postgresDeparserFormat: compatibility.deparserFormat,
      }, expected.postgresMajor)) {
      blockers.push("POSTGRES_VERSION_MISMATCH");
    }
    if (compatibility.deparserFormat !== POSTGRES_DEPARSE_FORMAT) {
      blockers.push("POSTGRES_DEPARSER_MISMATCH");
    }
    compare(fingerprint.fingerprintVersion, expected.fingerprintVersion, "FINGERPRINT_VERSION_MISMATCH");
    compare(fingerprint.formatVersion, expected.formatVersion, "FORMAT_VERSION_MISMATCH");
    compare(fingerprint.structuralFingerprint, expected.structuralFingerprint, "STRUCTURAL_MISMATCH");
    compare(fingerprint.physicalFingerprint, expected.physicalFingerprint, "PHYSICAL_MISMATCH");
    compare(fingerprint.normalizedObjectCount, expected.normalizedObjectCount, "OBJECT_COUNT_MISMATCH");
    compare(fingerprint.enumCount, expected.enumCount, "ENUM_COUNT_MISMATCH");
    compare(fingerprint.triggerCount, expected.triggerCount, "TRIGGER_COUNT_MISMATCH");
    compare(fingerprint.functionCount, expected.functionCount, "FUNCTION_COUNT_MISMATCH");
    const extensions = new Set(snapshot.unmodelled?.extensions.map((item) => item.name) ?? []);
    const requiredExtensions = {
      btree_gist: extensions.has("btree_gist") ? "PRESENT" : "MISSING",
      pg_trgm: extensions.has("pg_trgm") ? "PRESENT" : "MISSING",
    } as const;
    for (const [name, state] of Object.entries(requiredExtensions)) {
      if (state === "MISSING") blockers.push(`MISSING_EXTENSION:${name}`);
    }
    await client.query("COMMIT");
    const baselineRow = rows.find((row) => row.id === expected.id);
    const alreadyInitialized = ledgerExists && ledgerInspection.valid && !ledgerUnreadable
      && baselineRow !== undefined;
    return {
      scope: "SCHEMA_BASELINE_ONLY",
      dataMigrationEligibility: "NOT_ASSESSED",
      readiness: blockers.length > 0 ? "NOT_READY" : alreadyInitialized ? "ALREADY_INITIALIZED" : "READY",
      blockers: [...new Set(blockers)].sort(),
      migrationId: expected.id,
      baselineChecksum: "MATCH",
      postgresVersionNum: compatibility.serverVersionNum,
      postgresMajor: compatibility.serverMajorVersion,
      fingerprintVersion: fingerprint.fingerprintVersion,
      formatVersion: fingerprint.formatVersion,
      structuralFingerprint: fingerprint.structuralFingerprint === expected.structuralFingerprint ? "MATCH" : "MISMATCH",
      physicalFingerprint: fingerprint.physicalFingerprint === expected.physicalFingerprint ? "MATCH" : "MISMATCH",
      normalizedObjectCount: fingerprint.normalizedObjectCount,
      enumCount: fingerprint.enumCount,
      triggerCount: fingerprint.triggerCount,
      functionCount: fingerprint.functionCount,
      requiredExtensions,
      ledger: {
        existence: ledgerExists ? "PRESENT" : "MISSING",
        state: !ledgerExists ? "UNINITIALIZED"
          : ledgerInspection.valid && !ledgerUnreadable ? "VALID" : "BLOCKED",
        rows: rows.map((row) => ({
          id: row.id,
          state: row.state,
          checksum: migrations.find((item) => item.id === row.id)?.checksum === row.checksum ? "MATCH" : "MISMATCH",
        })),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function serializePreflightEvidence(report: AdoptionPreflightReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}