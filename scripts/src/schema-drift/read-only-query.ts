import type { DatabaseClient } from "../backend-standards-database";

function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function assertReadOnlyCatalogQuery(sql: string): void {
  const text = executableSql(sql).trim();
  if (!/^(?:SELECT|WITH)\b/i.test(text)
    || /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO)\b/i.test(text)) {
    throw new Error("Schema audit refused SQL that is not a read-only catalog query");
  }
}

export function readOnlyQueryLayer(client: DatabaseClient): DatabaseClient {
  return {
    query(sql: string, values?: unknown[]) {
      assertReadOnlyCatalogQuery(sql);
      return client.query(sql, values);
    },
  };
}