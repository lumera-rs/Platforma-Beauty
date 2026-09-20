import { asc } from "drizzle-orm";
import type { DatabasePoolClient as PoolClient } from "@workspace/db";
import { shippingRulesTable } from "@workspace/db/schema";
import { type StartupDdlPool, resolveStartupDdlPool } from "./startup-ddl-pool";
import { setLocalStartupDdlTimeouts } from "./startup-ddl-safety";
import { logger } from "./logger";


const SHIPPING_RULES_LOCK_KEY = "lumera:shipping-rules-singleton";
const SHIPPING_RULES_INDEX_NAME = "shipping_rules_singleton_unique";

type ShippingRuleInsert = typeof shippingRulesTable.$inferInsert;

/**
 * Production does not run drizzle-kit push. Before the API accepts traffic,
 * collapse any legacy duplicates to the stable lowest UUID and enforce the
 * singleton with a database-level unique expression index.
 */
export async function ensureShippingConfigSchema(schemaName = "public", poolOverride?: StartupDdlPool): Promise<void> {
  quoteSchema(schemaName);
  const client = await (await resolveStartupDdlPool(poolOverride)).connect();
  let locked = false; let unlockError: unknown;
  try {
    await client.query("begin"); await setLocalStartupDdlTimeouts(client); await client.query("select pg_advisory_lock(hashtext($1))", [SHIPPING_RULES_LOCK_KEY]);
    locked = true;
    // Transaction-local timeouts bound both advisory-lock and table-lock waits.
    await runShippingConfigSchemaDdl(client, schemaName);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    if (locked) {
      await client.query("select pg_advisory_unlock(hashtext($1))", [SHIPPING_RULES_LOCK_KEY])
        .catch((error) => { unlockError = error; logger.error({ err: error, schema: schemaName }, "Failed to release shipping configuration schema advisory lock"); });
    }
    client.release(unlockError instanceof Error ? unlockError : unlockError ? true : undefined);
  }
}



/**
 * Exported for isolated rollout tests. The caller owns the transaction and
 * session-level advisory lock; this routine only performs the guarded DDL.
 */
export async function runShippingConfigSchemaDdl(
  client: PoolClient,
  schemaName: string,
): Promise<void> {
  const schema = quoteSchema(schemaName);
  // Index names are scoped by the current schema in PostgreSQL; keep the
  // table qualified while making the target schema local to this transaction.
  await client.query(`set local search_path to ${schema}`);
  await client.query(`lock table ${schema}.shipping_rules in share row exclusive mode`);
  await client.query(`
    delete from ${schema}.shipping_rules
    where id <> (
      select id from ${schema}.shipping_rules order by id asc limit 1
    )
  `);
  await client.query(`
    create unique index if not exists ${SHIPPING_RULES_INDEX_NAME}
    on ${schema}.shipping_rules ((true))
  `);
}

/**
 * Normal request-path lookup. Startup installs the singleton guard; after that
 * the fast path is a plain read. If a newly provisioned database has no row,
 * the unique index makes concurrent first inserts conflict-safe.
 */
export async function getOrCreateShippingConfig(
  initialValues: ShippingRuleInsert = {},
): Promise<typeof shippingRulesTable.$inferSelect> {
  const { db } = await import("@workspace/db");
  const [existing] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  if (existing) return existing;

  const [created] = await db.insert(shippingRulesTable)
    .values(initialValues)
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [winner] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  if (!winner) throw new Error("Shipping configuration could not be initialized.");
  return winner;
}

function quoteSchema(schemaName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName) || schemaName.length > 63) {
    throw new Error(`Invalid shipping configuration schema: ${JSON.stringify(schemaName)}`);
  }
  return `"${schemaName}"`;
}
