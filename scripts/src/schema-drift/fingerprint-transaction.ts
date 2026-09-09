import type { DatabaseClient } from "../backend-standards-database";

export async function pinFingerprintEnvironment(client: DatabaseClient): Promise<void> {
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