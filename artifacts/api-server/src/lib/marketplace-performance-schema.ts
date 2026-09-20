import { type StartupDdlPool, resolveStartupDdlPool } from "./startup-ddl-pool";
import { logger } from "./logger"; import { applyStartupDdlSessionTimeouts, readStartupDdlSessionTimeouts, restoreStartupDdlSessionTimeouts, type StartupDdlSessionTimeouts } from "./startup-ddl-safety";

/**
 * Production deployments do not run drizzle-kit push. Keep indexes required by
 * public marketplace queries in this additive rollout so existing databases
 * receive them on the first deployment that needs them.
 *
 * CREATE INDEX CONCURRENTLY avoids blocking appointment writes while the
 * catalog grows. The session advisory lock prevents concurrent application
 * boots from trying to build the same index at the same time.
 */
const MARKETPLACE_PERFORMANCE_INDEX_LOCK = 0x4d500001;

export async function ensureMarketplacePerformanceIndexes(poolOverride?: StartupDdlPool): Promise<void> {
  const client = await (await resolveStartupDdlPool(poolOverride)).connect(); let previousTimeouts: StartupDdlSessionTimeouts | undefined;
  let locked = false; let startupError: unknown;
  try { previousTimeouts = await readStartupDdlSessionTimeouts(client); await applyStartupDdlSessionTimeouts(client);
    await client.query("select pg_advisory_lock($1)", [MARKETPLACE_PERFORMANCE_INDEX_LOCK]);
    locked = true;
    await client.query(
      "create index concurrently if not exists appointments_employee_date_status_idx on appointments (employee_id, appointment_date, status)",
    );
    // Supplier-agnostic catalog indexes. The schema's other catalog indexes
    // lead with supplier_id and so cannot serve supplier-unscoped lookups.
    // parent_id and category_id additionally each carry a foreign key, which
    // Postgres does not index automatically, so without these the referential
    // checks fall back to sequential scans of the catalog.
    await client.query(
      "create index concurrently if not exists product_categories_parent_sort_idx on product_categories (parent_id, sort_order)",
    );
    await client.query(
      "create index concurrently if not exists product_categories_active_sort_idx on product_categories (active, sort_order)",
    );
    await client.query(
      "create index concurrently if not exists products_category_active_idx on products (category_id, active)",
    );
    logger.info("Marketplace performance indexes are ready");
  } catch (error) { startupError = error; throw error; } finally {
    let cleanupError: unknown;
    let unlockError: unknown;
    if (locked) {
      await client.query("select pg_advisory_unlock($1)", [MARKETPLACE_PERFORMANCE_INDEX_LOCK]).catch((error) => {
        cleanupError = error;
        unlockError = error;
        logger.error(
          { err: error, lockKey: MARKETPLACE_PERFORMANCE_INDEX_LOCK },
          "Marketplace performance advisory lock could not be released cleanly",
        );
      });
    }
    if (previousTimeouts) await restoreStartupDdlSessionTimeouts(client, previousTimeouts).catch((error) => { cleanupError ??= error; });
    client.release(unlockError instanceof Error ? unlockError : unlockError ? true : undefined);
    if (cleanupError && !startupError) throw cleanupError;
  }
}