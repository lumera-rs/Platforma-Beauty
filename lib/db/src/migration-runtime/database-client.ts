/**
 * The migration runtime deliberately depends on this structural contract rather
 * than on pg, Drizzle, or the scripts package's database client type.
 */
export interface MigrationDatabaseClient {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}
