export type DatabaseRow = Record<string, unknown>;

export interface DatabaseClient {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: DatabaseRow[] }>;
}

export interface UnvalidatedConstraint {
  schemaName: string;
  tableName: string;
  constraintName: string;
  constraintType: "CHECK" | "FOREIGN KEY";
}

export interface InvalidIndex {
  schemaName: string;
  tableName: string;
  indexName: string;
}

export async function auditUnvalidatedConstraints(
  client: DatabaseClient,
): Promise<UnvalidatedConstraint[]> {
  const result = await client.query(`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      constraint_record.conname AS constraint_name,
      CASE constraint_record.contype
        WHEN 'c' THEN 'CHECK'
        WHEN 'f' THEN 'FOREIGN KEY'
      END AS constraint_type
    FROM pg_constraint constraint_record
    JOIN pg_class relation
      ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND constraint_record.contype IN ('c', 'f')
      AND constraint_record.convalidated = false
    ORDER BY relation.relname, constraint_record.conname
  `);

  return result.rows.map((row) => ({
    schemaName: String(row["schema_name"]),
    tableName: String(row["table_name"]),
    constraintName: String(row["constraint_name"]),
    constraintType: String(row["constraint_type"]) as
      | "CHECK"
      | "FOREIGN KEY",
  }));
}

export function formatUnvalidatedConstraintReport(
  constraints: UnvalidatedConstraint[],
): string {
  const listed = constraints
    .map(
      (constraint) =>
        `${constraint.schemaName}.${constraint.tableName} — ${constraint.constraintName} (${constraint.constraintType})`,
    )
    .join("\n");

  return [
    listed,
    "",
    "Safe next step: verify that existing rows satisfy each constraint, then validate it in the development database through the approved development schema reconciliation (ALTER TABLE ... VALIDATE CONSTRAINT). Re-run this gate and recompute the Publish migration. Do not apply this repair directly to production.",
  ].join("\n");
}

export async function auditInvalidIndexes(
  client: DatabaseClient,
): Promise<InvalidIndex[]> {
  const result = await client.query(`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      index_relation.relname AS index_name
    FROM pg_index index_record
    JOIN pg_class relation
      ON relation.oid = index_record.indrelid
    JOIN pg_class index_relation
      ON index_relation.oid = index_record.indexrelid
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND index_record.indisvalid = false
    ORDER BY relation.relname, index_relation.relname
  `);

  return result.rows.map((row) => ({
    schemaName: String(row["schema_name"]),
    tableName: String(row["table_name"]),
    indexName: String(row["index_name"]),
  }));
}

export function formatInvalidIndexReport(indexes: InvalidIndex[]): string {
  const listed = indexes
    .map(
      (index) =>
        `${index.schemaName}.${index.tableName} — ${index.indexName} (INVALID INDEX)`,
    )
    .join("\n");

  return [
    listed,
    "",
    "Safe next step: inspect the failed or interrupted index operation, then repair the index in the development database through the approved development schema reconciliation (for example, drop and recreate it from the canonical schema declaration). Re-run this gate and recompute the Publish migration. Do not apply this repair directly to production.",
  ].join("\n");
}
