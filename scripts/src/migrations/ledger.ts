import type { DatabaseClient } from "../backend-standards-database";
import type { LoadedMigration, MigrationLedgerRow, MigrationState } from "./types";

export const MIGRATION_LEDGER_TABLE = "public.lumera_migration_ledger";

const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
  migration_id text PRIMARY KEY,
  checksum text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('transactional', 'nontransactional')),
  state text NOT NULL CHECK (state IN ('APPLYING', 'APPLIED', 'FAILED', 'ADOPTED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  error text
)`;

export async function ensureLedger(client: DatabaseClient): Promise<void> {
  await client.query(CREATE_LEDGER);
}

export async function readLedger(client: DatabaseClient): Promise<MigrationLedgerRow[]> {
  const result = await client.query(`
    SELECT migration_id, checksum, mode, state, error
    FROM ${MIGRATION_LEDGER_TABLE}
    ORDER BY migration_id
  `);
  return result.rows.map((row) => {
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
    };
  });
}

export async function markApplying(
  client: DatabaseClient,
  migration: LoadedMigration,
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
  await client.query(`
    INSERT INTO ${MIGRATION_LEDGER_TABLE}
      (migration_id, checksum, mode, state, started_at, finished_at, error)
    VALUES ($1, $2, $3, 'APPLYING', clock_timestamp(), NULL, NULL)
  `, [migration.id, migration.checksum, migration.mode]);
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
  await client.query(`
    INSERT INTO ${MIGRATION_LEDGER_TABLE}
      (migration_id, checksum, mode, state, started_at, finished_at, error)
    VALUES ($1, $2, $3, 'ADOPTED', clock_timestamp(), clock_timestamp(), NULL)
  `, [migration.id, migration.checksum, migration.mode]);
}