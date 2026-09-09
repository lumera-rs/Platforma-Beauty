import * as schemaExports from "@workspace/db/schema";
import { SQL, is } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type {
  IndexDefinition, SchemaSnapshot, TableDefinition,
} from "./model";

const dialect = new PgDialect();

function sqlText(value: unknown): string {
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql;
  if (value !== null && typeof value === "object") {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  }
  return typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value);
}

function indexExpression(value: unknown): string {
  if (is(value, SQL)) return sqlText(value);
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  throw new Error("Unsupported Drizzle index expression in canonical schema");
}

export function buildCanonicalSnapshot(): SchemaSnapshot {
  const seen = new Set<string>();
  const tables: TableDefinition[] = [];
  for (const value of Object.values(schemaExports)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const schema = config.schema ?? "public";
    const key = `${schema}.${config.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const inlinePrimary = config.columns.filter((column) => column.primary);
    const configuredPrimary = config.primaryKeys[0];
    const primaryColumns = configuredPrimary?.columns ?? inlinePrimary;
    const uniques = [
      ...config.uniqueConstraints.map((unique) => ({
        name: unique.getName() ?? `${config.name}_${unique.columns.map((column) => column.name).join("_")}_unique`,
        columns: unique.columns.map((column) => column.name),
      })),
      ...config.columns.filter((column) => column.isUnique).map((column) => ({
        name: column.uniqueName ?? `${config.name}_${column.name}_unique`,
        columns: [column.name],
      })),
    ];
    tables.push({
      schema,
      name: config.name,
      columns: config.columns.map((column) => ({
        name: column.name,
        type: column.getSQLType(),
        nullable: !column.notNull,
        default: column.default === undefined ? null : sqlText(column.default),
        generated: column.generated
          ? sqlText((column.generated as { as: unknown }).as)
          : null,
      })),
      primaryKey: primaryColumns.length ? {
        name: configuredPrimary?.getName() ?? `${config.name}_pkey`,
        columns: primaryColumns.map((column) => column.name),
      } : null,
      uniques,
      foreignKeys: config.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        const foreignConfig = getTableConfig(reference.foreignTable);
        return {
          name: foreignKey.getName(),
          columns: reference.columns.map((column) => column.name),
          foreignSchema: foreignConfig.schema ?? "public",
          foreignTable: foreignConfig.name,
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          onDelete: foreignKey.onDelete ?? "no action",
          onUpdate: foreignKey.onUpdate ?? "no action",
        };
      }),
      checks: config.checks.map((check) => ({
        name: check.name,
        expression: sqlText(check.value),
      })),
      indexes: config.indexes.map((index): IndexDefinition => ({
        name: index.config.name!,
        expressions: index.config.columns.map(indexExpression),
        unique: index.config.unique,
        predicate: index.config.where ? sqlText(index.config.where) : null,
        method: index.config.method ?? "btree",
      })),
    });
  }
  return { tables };
}