import type { DatabaseClient } from "../backend-standards-database";
import type { LoadedMigration, MigrationLedgerRow, MigrationState } from "./types";
import {
  ledgerIdentityFromTarget,
  type DatabaseTargetIdentity,
} from "@workspace/db/migration-runtime";

export const MIGRATION_LEDGER_TABLE = "public.lumera_migration_ledger";

const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
  migration_id text PRIMARY KEY,
  checksum text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('transactional', 'nontransactional')),
  state text NOT NULL CHECK (state IN ('APPLYING', 'APPLIED', 'FAILED', 'ADOPTED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  error text,
  database_name text,
  system_identifier text,
  neon_project_id text,
  neon_branch_id text
)`;

export async function ensureLedger(client: DatabaseClient): Promise<void> {
  await client.query(CREATE_LEDGER);
  // Runner-owned compatibility upgrade. These bookkeeping columns are
  // deliberately outside the immutable numbered migration/catalog contract.
  await client.query(`
    ALTER TABLE ${MIGRATION_LEDGER_TABLE}
      ADD COLUMN IF NOT EXISTS database_name text,
      ADD COLUMN IF NOT EXISTS system_identifier text,
      ADD COLUMN IF NOT EXISTS neon_project_id text,
      ADD COLUMN IF NOT EXISTS neon_branch_id text
  `);
}

export async function readLedger(
  client: DatabaseClient,
  options: { readonly forUpdate?: boolean } = {},
): Promise<MigrationLedgerRow[]> {
  const result = await client.query(`
    SELECT pg_catalog.to_jsonb(ledger) AS ledger_row
    FROM ${MIGRATION_LEDGER_TABLE}
    AS ledger
    ORDER BY migration_id
    ${options.forUpdate ? "FOR UPDATE" : ""}
  `);
  return result.rows.map((resultRow) => {
    const raw = resultRow["ledger_row"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Ledger row is not a JSON object");
    }
    const row = raw as Record<string, unknown>;
    const state = String(row["state"]);
    const mode = String(row["mode"]);
    if (!["APPLYING", "APPLIED", "FAILED", "ADOPTED"].includes(state)) {
      throw new Error(`Ledger contains unknown migration state: ${state}`);
    }
    if (mode !== "transactional" && mode !== "nontransactional") {
      throw new Error(`Ledger contains unknown migration mode for ${String(row["migration_id"])}`);
    }
    return {
      id: String(row["migration_id"]),
      checksum: String(row["checksum"]),
      mode,
      state: state as MigrationState,
      error: row["error"] == null ? null : String(row["error"]),
      databaseName: row["database_name"] == null ? null : String(row["database_name"]),
      systemIdentifier: row["system_identifier"] == null ? null : String(row["system_identifier"]),
      neonProjectId: row["neon_project_id"] == null ? null : String(row["neon_project_id"]),
      neonBranchId: row["neon_branch_id"] == null ? null : String(row["neon_branch_id"]),
    };
  });
}

export async function markApplying(
  client: DatabaseClient,
  migration: LoadedMigration,
  targetIdentity: DatabaseTargetIdentity,
): Promise<void> {
  const existing = await readLedger(client);
  const row = existing.find((item) => item.id === migration.id);
  if (row) {
    if (row.checksum !== migration.checksum) {
      throw new Error(`Ledger checksum mismatch for ${migration.id}: existing row cannot be overwritten`);
    }
    if (row.mode !== migration.mode) throw new Error(`Ledger mode mismatch for ${migration.id}`);
    if (row.state === "APPLYING") return;
    if (row.state !== "FAILED" || migration.mode !== "transactional") {
      throw new Error(`Ledger state cannot transition to APPLYING for ${migration.id}: ${row.state}`);
    }
    const updated = await client.query(`
      UPDATE ${MIGRATION_LEDGER_TABLE}
      SET state = 'APPLYING', started_at = clock_timestamp(), finished_at = NULL, error = NULL
      WHERE migration_id = $1 AND checksum = $2 AND mode = $3 AND state = 'FAILED'
      RETURNING migration_id
    `, [migration.id, migration.checksum, migration.mode]);
    if (updated.rows.length !== 1) throw new Error(`Ledger APPLYING transition lost for ${migration.id}`);
    return;
  }
  const identity = ledgerIdentityFromTarget(targetIdentity);
  await client.query(`
    INSERT INTO ${MIGRATION_LEDGER_TABLE}
      (migration_id, checksum, mode, state, started_at, finished_at, error,
       database_name, system_identifier, neon_project_id, neon_branch_id)
    VALUES ($1, $2, $3, 'APPLYING', clock_timestamp(), NULL, NULL, $4, $5, $6, $7)
  `, [migration.id, migration.checksum, migration.mode, identity.databaseName,
    identity.systemIdentifier, identity.neonProjectId, identity.neonBranchId]);
}

export async function markFinished(
  client: DatabaseClient,
  id: string,
  state: "APPLIED",
): Promise<void> {
  const result = await client.query(`
    UPDATE ${MIGRATION_LEDGER_TABLE}
    SET state = $2, finished_at = clock_timestamp(), error = NULL
    WHERE migration_id = $1 AND state = 'APPLYING'
    RETURNING migration_id
  `, [id, state]);
  if (result.rows.length !== 1) throw new Error(`Ledger state transition to ${state} failed for ${id}`);
}

export async function markFailed(client: DatabaseClient, id: string, error: string): Promise<void> {
  const result = await client.query(`
    UPDATE ${MIGRATION_LEDGER_TABLE}
    SET state = 'FAILED', finished_at = clock_timestamp(), error = $2
    WHERE migration_id = $1 AND state = 'APPLYING'
    RETURNING migration_id
  `, [id, error.slice(0, 8000)]);
  if (result.rows.length !== 1) throw new Error(`Ledger state transition to FAILED failed for ${id}`);
}

export async function adoptLedgerRow(
  client: DatabaseClient,
  migration: LoadedMigration,
  targetIdentity: DatabaseTargetIdentity,
): Promise<void> {
  const existing = await readLedger(client);
  const row = existing.find((item) => item.id === migration.id);
  if (row) {
    if (row.checksum !== migration.checksum) {
      throw new Error(`Ledger checksum mismatch for ${migration.id}: existing row cannot be overwritten`);
    }
    if (row.mode !== migration.mode) throw new Error(`Ledger mode mismatch for ${migration.id}`);
    if (row.state === "ADOPTED") return;
    throw new Error(`Ledger state cannot be adopted for ${migration.id}: ${row.state}`);
  }
  const identity = ledgerIdentityFromTarget(targetIdentity);
  await client.query(`
    INSERT INTO ${MIGRATION_LEDGER_TABLE}
      (migration_id, checksum, mode, state, started_at, finished_at, error,
       database_name, system_identifier, neon_project_id, neon_branch_id)
    VALUES ($1, $2, $3, 'ADOPTED', clock_timestamp(), clock_timestamp(), NULL, $4, $5, $6, $7)
  `, [migration.id, migration.checksum, migration.mode, identity.databaseName,
    identity.systemIdentifier, identity.neonProjectId, identity.neonBranchId]);
}