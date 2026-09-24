import { createHash } from "node:crypto";
import type { DatabaseClient } from "../backend-standards-database";
import { transferCore, type TransferOptions, type TransferReport } from "./engine";

/** Test-only adapter. The CLI always imports transferData, never this module. */
export async function transferFixtureData(source: DatabaseClient, target: DatabaseClient, options: TransferOptions): Promise<TransferReport> {
  return transferCore(source, target, options, {
    seeds: null,
    fixtureMutatingTriggers: ["salons.synthetic_side_effect"],
    fixtureValidatingTriggers: ["category_fixture.category_no_self"],
    async readiness() {},
    async fingerprint(client) {
      const result = await client.query(`SELECT jsonb_agg(row_to_json(x) ORDER BY x.oid)::text AS shape FROM (
        SELECT c.oid,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull,
          pg_get_expr(d.adbin,d.adrelid) AS default
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' ORDER BY c.oid,a.attnum) x`);
      const triggers = await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.oid),'[]'::jsonb)::text AS shape
        FROM (SELECT tg.oid,tg.tgname,tg.tgenabled FROM pg_trigger tg
          JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND NOT tg.tgisinternal) t`);
      const hash = createHash("sha256").update(String(result.rows[0]?.shape)).update(String(triggers.rows[0]?.shape)).digest("hex");
      return { structural: hash, physical: hash };
    },
  });
}