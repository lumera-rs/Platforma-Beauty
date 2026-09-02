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