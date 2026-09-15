import type { DatabaseClient } from "../backend-standards-database";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "../schema-drift/catalog";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "../schema-drift/fingerprint";
import { beginFingerprintTransaction } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";
import { readOnlyQueryLayer, assertReadOnlyCatalogQuery } from "../schema-drift/read-only-query";
import { adoptLedgerRow, ensureLedger, markApplying, markFailed, markFinished, readLedger } from "./ledger";
import { loadMigrations } from "./files";
import { MIGRATION_MANIFEST } from "./manifest";
import { withMigrationAdvisoryLock } from "./lock";
import type {
  LoadedMigration, MigrationDatabaseClient, MigrationLedgerRow, MigrationRunResult, MigrationRunnerOptions,
} from "./types";

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
): Promise<void> {
  for (const sql of migration.preconditions) await condition(client, sql, "precondition");
  if (migration.mode === "transactional") {
    await client.query("BEGIN");
    try {
      await client.query(migration.body);
      for (const sql of migration.postconditions) await condition(client, sql, "postcondition");
      if (finishTransactional) await finishTransactional();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
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
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "\\") {
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
      if (statement.replace(/(?:--[^\n]*|\/\*[\s\S]*?\*\/|\s)/gu, "") !== "") {
        statements.push(statement);
      }
      start = index + 1;
    }
    index += 1;
  }
  const final = sql.slice(start).trim();
  if (final.replace(/(?:--[^\n]*|\/\*[\s\S]*?\*\/|\s)/gu, "") !== "") statements.push(final);
  return statements;
}

export async function applyMigrations(
  client: MigrationDatabaseClient,
  options: MigrationRunnerOptions = {},
): Promise<MigrationRunResult> {
  const migrations = options.migrations ?? await loadMigrations();
  return withMigrationAdvisoryLock(client, async () => {
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
      await markApplying(client, migration);
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
        await markFailed(client, migration.id, errorText(error));
        throw new Error(`Migration ${migration.id} failed: ${errorText(error)}`);
      }
    }
    return { applied, skipped };
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
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

async function currentFingerprint(client: DatabaseClient): Promise<CatalogFingerprintResult> {
  await beginFingerprintTransaction(client);
  try {
    const readOnly = readOnlyQueryLayer(client);
    const result = fingerprintSnapshot(
      await readPostgresSnapshot(readOnly),
      ownershipExceptions,
      await readPostgresFingerprintCompatibility(readOnly),
    );
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
  const migrations = options.migrations ?? await loadMigrations();
  return withMigrationAdvisoryLock(client, async () => {
    const fingerprint = await currentFingerprint(client);
    const expected = migrations[migrations.length - 1]!;
    if (
      fingerprint.fingerprintVersion !== expected.fingerprintVersion
      || fingerprint.formatVersion !== expected.formatVersion
      || fingerprint.postgresCompatibility.serverMajorVersion !== expected.postgresMajor
      || fingerprint.postgresCompatibility.serverVersionNum !== expected.postgresVersionNum
      || fingerprint.structuralFingerprint !== expected.structuralFingerprint
      || fingerprint.physicalFingerprint !== expected.physicalFingerprint
      || fingerprint.normalizedObjectCount !== expected.normalizedObjectCount
      || fingerprint.enumCount !== expected.enumCount
      || fingerprint.triggerCount !== expected.triggerCount
    ) {
      throw new Error(
        `Migration baseline adoption mismatch: expected structural ${expected.structuralFingerprint} `
        + `and physical ${expected.physicalFingerprint}, got structural ${fingerprint.structuralFingerprint} `
        + `and physical ${fingerprint.physicalFingerprint}`,
      );
    }
    await ensureLedger(client);
    const rows = validateLedger(await readLedger(client), migrations);
    for (const migration of migrations) {
      const row = rows.get(migration.id);
      if (row && row.state !== "ADOPTED" && row.state !== "APPLIED") {
        throw new Error(`Migration baseline adoption found inconsistent ledger state for ${migration.id}: ${row.state}`);
      }
      if (row?.state === "APPLIED") continue;
      await adoptLedgerRow(client, migration);
    }
    return { adopted: migrations.map((migration) => migration.id), fingerprint };
  }, { timeoutMs: options.lockTimeoutMs, pollMs: options.lockPollMs });
}

export { MIGRATION_MANIFEST };
export const runMigrations = applyMigrations;
export const getMigrationStatus = migrationStatus;
export const adoptMigrationBaseline = adoptBaseline;