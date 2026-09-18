import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "../backend-standards-database";
import { withMigrationAdvisoryLock } from "../migrations/lock";
import { DATA_STEP_CHECKSUMS, TABLE_CONTRACT_CHECKSUM } from "./manifest";

export const REFERENCE_TABLES = [
  "suppliers", "beauty_job_platform_settings", "beauty_job_categories",
  "shop_settings", "b2c_display_settings", "aftercare_settings",
  "education_placement_settings", "education_b2b_discount_settings",
] as const;
export const CONTRACT_TABLES = [...REFERENCE_TABLES, "subscription_plans", "subscriptions", "education_center_subscriptions"];
export type DataStep = keyof typeof DATA_STEP_CHECKSUMS;
const root = new URL("../../../lib/db/data-migrations/", import.meta.url);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Scoped to these tables; this is not the whole-project schema inventory. */
export async function readDataTableContract(client: DatabaseClient): Promise<unknown> {
  const columns = await client.query(`
    SELECT c.relname AS table_name, a.attname AS name, a.attnum AS position,
      pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
      a.attidentity AS identity, a.attgenerated AS generated,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`, [CONTRACT_TABLES]);
  const constraints = await client.query(`
    SELECT c.relname AS table_name, con.conname AS name, con.convalidated AS validated,
      pg_catalog.pg_get_constraintdef(con.oid,true) AS definition
    FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,con.conname`, [CONTRACT_TABLES]);
  const indexes = await client.query(`
    SELECT c.relname AS table_name, i.relname AS name, ix.indisvalid AS valid,
      pg_catalog.pg_get_indexdef(i.oid) AS definition
    FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class c ON c.oid=ix.indrelid
    JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,i.relname`, [CONTRACT_TABLES]);
  const triggers = await client.query(`
    SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,
      pg_catalog.pg_get_triggerdef(t.oid,true) AS definition,
      pg_catalog.pg_get_functiondef(t.tgfoid) AS function_definition
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,t.tgname`, [CONTRACT_TABLES]);
  const relations = await client.query(`
    SELECT c.relname AS table_name,c.relkind AS kind,c.relrowsecurity AS row_security,
      c.relforcerowsecurity AS force_row_security
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [CONTRACT_TABLES]);
  const rules = await client.query(`
    SELECT c.relname AS table_name,r.rulename AS name,pg_catalog.pg_get_ruledef(r.oid,true) AS definition
    FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,r.rulename`, [CONTRACT_TABLES]);
  return {
    columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows,
    triggers: triggers.rows, relations: relations.rows, rules: rules.rows,
  };
}

export async function loadDataStep(step: DataStep): Promise<string> {
  if (!Object.hasOwn(DATA_STEP_CHECKSUMS, step)) throw new Error("Unknown explicit data step");
  const sql = await readFile(new URL(`${step}/data.sql`, root), "utf8");
  if (digest(sql) !== DATA_STEP_CHECKSUMS[step]) throw new Error("Immutable data step checksum mismatch");
  return sql;
}

/**
 * Development validation executor, deliberately limited to owned disposable
 * fixtures. No default pool, ambient URL, schema-ledger adoption or app wiring.
 * The SQL is a separate explicit data step; production enablement is NOT done.
 */
export async function applyStartupData(client: DatabaseClient, step: DataStep): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.REPLIT_DEPLOYMENT_ID) throw new Error("Data steps are not authorized in a deployment");
  const sql = await loadDataStep(step);
  const contractText = await readFile(fileURLToPath(new URL("./table-contract.json", import.meta.url)), "utf8");
  if (digest(contractText) !== TABLE_CONTRACT_CHECKSUM) throw new Error("Table contract checksum mismatch");
  const identity = await client.query("SELECT current_database() AS name, pg_catalog.host(inet_server_addr()) AS host, inet_server_port() AS port");
  const target = identity.rows[0];
  if (!target || !/^lumera_startup_equivalence_\d+_[a-f0-9]{16}$/.test(String(target.name))
    || !["127.0.0.1", "::1"].includes(String(target.host)) || Number(target.port) === 5432) {
    throw new Error("Explicit data executor only permits owned loopback disposable fixtures");
  }
  await withMigrationAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public");
      // Same owner lock as startup, followed by table locks for administrative
      // writes. No existing row may change between precondition and INSERT.
      await client.query("SELECT pg_advisory_xact_lock(1111949377)");
      await client.query(`LOCK TABLE ${CONTRACT_TABLES.map((table) => `public."${table}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
      if (JSON.stringify(await readDataTableContract(client)) !== JSON.stringify(JSON.parse(contractText))) {
        throw new Error("STARTUP_DATA_UNSUPPORTED_TABLE_CONTRACT");
      }
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Data step failed; rollback also failed");
      }
      throw error;
    }
  });
}