import type { DatabaseClient } from "../backend-standards-database";

export const BASELINE_ADOPTION_ADVISORY_LOCK_KEY = 7_346_231_927;

async function pinFingerprintEnvironment(client: DatabaseClient): Promise<void> {
  await client.query("SET LOCAL search_path = pg_catalog");
  await client.query("SET LOCAL quote_all_identifiers = on");
  await client.query("SET LOCAL standard_conforming_strings = on");
  await client.query("SET LOCAL IntervalStyle = 'postgres'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SET LOCAL TimeZone = 'UTC'");
  await client.query("SET LOCAL extra_float_digits = 3");
  await client.query("SET LOCAL bytea_output = 'hex'");
  await client.query("SET LOCAL lc_numeric = 'C'");
  await client.query("SET LOCAL lc_time = 'C'");
  await client.query("SET LOCAL statement_timeout = '30s'");
}

export async function beginFingerprintTransaction(client: DatabaseClient): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await pinFingerprintEnvironment(client);
}

export async function acquireBaselineAdoptionLock(client: DatabaseClient): Promise<void> {
  await client.query("SET lock_timeout = '10s'");
  try {
    await client.query("SELECT pg_catalog.pg_advisory_lock($1)", [
      BASELINE_ADOPTION_ADVISORY_LOCK_KEY,
    ]);
  } finally {
    await client.query("RESET lock_timeout");
  }
}

export async function beginBaselineAdoptionTransaction(client: DatabaseClient): Promise<void> {
  await client.query("BEGIN READ WRITE");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await pinFingerprintEnvironment(client);
  await client.query("LOCK TABLE pg_catalog.pg_class IN SHARE ROW EXCLUSIVE MODE");
  const tables = await client.query(`
    SELECT pg_catalog.format('%I.%I', n.nspname, c.relname) AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
    ORDER BY n.nspname, c.relname`);
  const names = tables.rows.map((row) => String(row.table_name));
  if (names.length > 0) {
    await client.query(`LOCK TABLE ${names.join(", ")} IN ACCESS EXCLUSIVE MODE`);
  }
}

export async function releaseBaselineAdoptionLock(client: DatabaseClient): Promise<void> {
  await client.query("SELECT pg_catalog.pg_advisory_unlock($1)", [
    BASELINE_ADOPTION_ADVISORY_LOCK_KEY,
  ]);
}