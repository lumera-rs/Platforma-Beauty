import { pool } from "@workspace/db";
import { isProductionOrDeploymentRuntime } from "@workspace/db/destructive-test-runtime";

const INDEX = "retail_cart_items_cart_product_variant_unique";
const COLUMNS = ["cart_id", "product_id", "variant_value"];

/**
 * Dev-only bridge for a PostgreSQL index property not modeled by Drizzle's
 * index builder. Publish must see the same standalone native index in both
 * databases, not replace it with an ordinary UNIQUE constraint.
 */
export async function ensureRetailCartIndexDevelopmentSchema(
  schemaName = "public",
): Promise<{ changed: boolean }> {
  if (isProductionOrDeploymentRuntime()) {
    throw new Error("Retail cart index reconciliation refuses production or deployment runtimes.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schemaName) || schemaName.startsWith("pg_")) {
    throw new Error("Invalid schema name for retail cart index reconciliation.");
  }
  const table = `"${schemaName}"."retail_cart_items"`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `retail-cart-index-development:${schemaName}`,
    ]);
    // Prevent cart writes between removal of the constraint-owned index and
    // creation of its standalone replacement. Any failure restores the old one.
    await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    const { rows } = await client.query<{
      table_name: string;
      method: string;
      columns: string[];
      unique: boolean;
      valid: boolean;
      ready: boolean;
      nulls_not_distinct: boolean;
      simple: boolean;
      constraint_name: string | null;
      constraint_type: string | null;
    }>(
      `SELECT t.relname AS table_name, am.amname AS method,
         ARRAY(SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum, position)
           JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
           ORDER BY k.position) AS columns,
         i.indisunique AS unique, i.indisvalid AS valid, i.indisready AS ready,
         i.indnullsnotdistinct AS nulls_not_distinct,
         (i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=i.indnkeyatts) AS simple,
         con.conname AS constraint_name, con.contype AS constraint_type
       FROM pg_index i
       JOIN pg_class c ON c.oid=i.indexrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_class t ON t.oid=i.indrelid
       JOIN pg_am am ON am.oid=c.relam
       LEFT JOIN pg_constraint con ON con.conindid=i.indexrelid
       WHERE n.nspname=$1 AND c.relname=$2`,
      [schemaName, INDEX],
    );
    const existing = rows[0];
    if (rows.length > 1 || (existing && (
      existing.table_name !== "retail_cart_items"
      || existing.method !== "btree"
      || !existing.unique || !existing.valid || !existing.ready || !existing.simple
      || JSON.stringify(existing.columns) !== JSON.stringify(COLUMNS)
      || (existing.constraint_name !== null && (
        existing.constraint_name !== INDEX || existing.constraint_type !== "u"
      ))
    ))) {
      throw new Error("Unexpected retail cart index definition; refusing to replace it.");
    }
    const changed = !existing || !existing.nulls_not_distinct || existing.constraint_name !== null;
    if (changed) {
      if (existing?.constraint_name) {
        await client.query(`ALTER TABLE ${table} DROP CONSTRAINT "${INDEX}"`);
      } else if (existing) {
        await client.query(`DROP INDEX "${schemaName}"."${INDEX}"`);
      }
      // No data cleanup: duplicates cause an explicit failure and rollback.
      await client.query(`CREATE UNIQUE INDEX "${INDEX}"
        ON ${table} (cart_id, product_id, variant_value) NULLS NOT DISTINCT`);
    }
    await client.query("COMMIT");
    return { changed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}