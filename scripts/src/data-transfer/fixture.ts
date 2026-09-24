import { createHash } from "node:crypto";
import type { DatabaseClient } from "../backend-standards-database";
import { transferCore, type TransferOptions, type TransferReport } from "./engine";

/** Test-only adapter. The CLI always imports transferData, never this module. */
export async function transferFixtureData(source: DatabaseClient, target: DatabaseClient, options: TransferOptions): Promise<TransferReport> {
  return transferCore(source, target, options, {
    seeds: null,
    async readiness() {},
    async fingerprint(client) {
      const result = await client.query(`SELECT jsonb_agg(row_to_json(x) ORDER BY x.oid)::text AS shape FROM (
        SELECT c.oid,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull,
          pg_get_expr(d.adbin,d.adrelid) AS default
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' ORDER BY c.oid,a.attnum) x`);
      const hash = createHash("sha256").update(String(result.rows[0]?.shape)).digest("hex");
      return { structural: hash, physical: hash };
    },
  });
}