import type { MigrationDatabaseClient } from "./database-client";

function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function assertReadOnlyMigrationQuery(sql: string): void {
  const text = executableSql(sql).trim();
  if (!/^(?:SELECT|WITH)\b/i.test(text)
    || /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO)\b/i.test(text)) {
    throw new Error("Schema audit refused SQL that is not a read-only catalog query");
  }
}

export function readOnlyMigrationClient(
  client: MigrationDatabaseClient,
): MigrationDatabaseClient {
  return {
    query(sql: string, values?: readonly unknown[]) {
      assertReadOnlyMigrationQuery(sql);
      return client.query(sql, values);
    },
  };
}
