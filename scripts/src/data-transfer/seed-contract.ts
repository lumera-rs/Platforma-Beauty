import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DatabaseClient } from "../backend-standards-database";
import { identifier, readTransferCatalog, relation } from "./catalog";

export interface SeedEntry { table: string; count: number; columns: string[]; omittedColumns: string[]; hash: string }
export interface SeedContract { formatVersion: 1; tables: SeedEntry[] }
export const hashRows = (rows: readonly string[]): string => {
  const hash = createHash("sha256");
  for (const row of rows) hash.update(`${Buffer.byteLength(row, "utf8")}:${row}\n`);
  return hash.digest("hex");
};
export async function stableRows(client: DatabaseClient, table: string, columns: string[], order?: string[]): Promise<string[]> {
  // A record projection has no variadic-function argument ceiling. Wide canonical
  // relations exceed jsonb_build_object's PostgreSQL 100-argument limit.
  const projection = columns.map(c => `r.${identifier(c)}`).join(",");
  const sqlProjection = columns.length
    ? `(SELECT to_jsonb(projected)::text FROM (SELECT ${projection}) projected)`
    : "'{}'::text";
  const result = await client.query(`SELECT ${sqlProjection} AS payload FROM ${relation(table)} r ORDER BY ${
    order?.length ? order.map(c => `r.${identifier(c)}`).join(",") : `${sqlProjection} COLLATE "C"`}`);
  return result.rows.map(row => String(row.payload));
}
/** Calibration-only: caller must first run all four migrations on an owned empty database.
 * No runtime/CLI option accepts a caller-supplied baseline.
 */
export async function buildSeedContract(client: DatabaseClient): Promise<SeedContract> {
  const entries: SeedEntry[] = [];
  for (const table of await readTransferCatalog(client)) {
    const omitted = table.columns.filter(c => c.default && (
      /(?:now\(\)|CURRENT_TIMESTAMP|clock_timestamp\(\))/iu.test(c.default)
      || (table.name !== "public.suppliers" && /gen_random_uuid\(\)|uuid_generate/iu.test(c.default))
    )).map(c => c.name);
    const columns = table.columns.map(c => c.name).filter(c => !omitted.includes(c));
    const rows = await stableRows(client, table.name, columns);
    entries.push({ table: table.name, columns, omittedColumns: omitted, count: rows.length, hash: hashRows(rows) });
  }
  return { formatVersion: 1, tables: entries };
}
export async function readPinnedSeedContract(): Promise<SeedContract> {
  // Fixed repository authority; cannot be selected or replaced by command-line arguments.
  return JSON.parse(await readFile(new URL("./seed-contract.json", import.meta.url), "utf8")) as SeedContract;
}