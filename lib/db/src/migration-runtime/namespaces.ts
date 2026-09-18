import type { MigrationDatabaseClient } from "./database-client";
import { readOnlyMigrationClient } from "./read-only-query";

/**
 * Supported deployment paths use the public application schema only. PostgreSQL
 * system schemas are intentionally excluded from this check because they are
 * owned by the server and are part of every supported catalog.
 *
 * The query returns only a boolean. In particular, the name of an unexpected
 * schema is not included in the error, so diagnostics cannot disclose tenant
 * or operator-provided identifiers.
 */
export const NON_PUBLIC_NAMESPACE_REASON = "MIGRATION_NON_PUBLIC_NAMESPACE";

export async function assertPublicOnlyNamespaces(
  client: MigrationDatabaseClient,
): Promise<void> {
  const result = await readOnlyMigrationClient(client).query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace
      WHERE nspname <> 'public'
        AND nspname <> 'information_schema'
        AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
    ) AS has_unsupported_namespace
  `);
  const value = result.rows[0]?.has_unsupported_namespace;
  if (value === true || value === "true" || value === "t" || value === 1 || value === "1") {
    throw new Error(NON_PUBLIC_NAMESPACE_REASON);
  }
}