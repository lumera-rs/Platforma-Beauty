import type { DatabaseClient } from "../backend-standards-database";
import type {
  CheckDefinition, ColumnDefinition, ForeignKeyDefinition, IndexDefinition,
  KeyDefinition, SchemaSnapshot, TableDefinition,
} from "./model";

type Row = Record<string, unknown>;
const strings = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  // PostgreSQL's ARRAY over name/attname has a name[] OID that node-postgres
  // intentionally leaves as its text representation.
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    const body = value.slice(1, -1);
    return body === "" ? [] : body.split(",").map((item) => item.replace(/^"|"$/g, ""));
  }
  return [];
};

export async function readPostgresSnapshot(client: DatabaseClient): Promise<SchemaSnapshot> {
  const tablesResult = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
    ORDER BY n.nspname, c.relname`);
  const columnsResult = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      NOT a.attnotnull AS nullable,
      CASE WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true) END AS column_default,
      CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true) END AS generated
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    WHERE c.relkind IN ('r','p') AND n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY n.nspname,c.relname,a.attnum`);
  const constraintsResult = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname,
      con.contype, fn.nspname AS foreign_schema, fc.relname AS foreign_table,
      ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY x(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS columns,
      ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY x(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=x.attnum ORDER BY x.ord) AS foreign_columns,
      CASE con.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS on_delete,
      CASE con.confupdtype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS on_update,
      CASE WHEN con.contype='c' THEN pg_catalog.pg_get_expr(con.conbin,con.conrelid,true) END AS expression
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_class fc ON fc.oid=con.confrelid
    LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid=fc.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND con.contype IN ('p','u','f','c')
    ORDER BY n.nspname,c.relname,con.conname`);
  const indexesResult = await client.query(`
    SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
      ix.indisunique AS is_unique, am.amname AS method,
      ARRAY(SELECT pg_catalog.pg_get_indexdef(ix.indexrelid,k,true)
        FROM generate_series(1,ix.indnkeyatts) k ORDER BY k) AS expressions,
      pg_catalog.pg_get_expr(ix.indpred,ix.indrelid,true) AS predicate
    FROM pg_catalog.pg_index ix
    JOIN pg_catalog.pg_class t ON t.oid=ix.indrelid
    JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid=i.relam
    LEFT JOIN pg_catalog.pg_constraint con ON con.conindid=ix.indexrelid AND con.contype IN ('p','u','x')
    WHERE n.nspname='public' AND t.relkind IN ('r','p') AND con.oid IS NULL
    ORDER BY n.nspname,t.relname,i.relname`);

  const map = new Map<string, TableDefinition>();
  for (const row of tablesResult.rows) {
    const table = String(row["table_name"]);
    const schema = String(row["schema_name"]);
    map.set(`${schema}.${table}`, {
      schema, name: table, columns: [], primaryKey: null, uniques: [],
      foreignKeys: [], checks: [], indexes: [],
    });
  }
  const tableFor = (row: Row) => map.get(`${row["schema_name"]}.${row["table_name"]}`);
  for (const row of columnsResult.rows) tableFor(row)?.columns.push({
    name: String(row["column_name"]), type: String(row["data_type"]),
    nullable: Boolean(row["nullable"]),
    default: row["column_default"] == null ? null : String(row["column_default"]),
    generated: row["generated"] == null ? null : String(row["generated"]),
  } satisfies ColumnDefinition);
  for (const row of constraintsResult.rows) {
    const table = tableFor(row);
    if (!table) continue;
    const base: KeyDefinition = { name: String(row["conname"]), columns: strings(row["columns"]) };
    if (row["contype"] === "p") table.primaryKey = base;
    else if (row["contype"] === "u") table.uniques.push(base);
    else if (row["contype"] === "c") table.checks.push({
      name: base.name, expression: String(row["expression"]),
    } satisfies CheckDefinition);
    else table.foreignKeys.push({
      ...base, foreignSchema: String(row["foreign_schema"]), foreignTable: String(row["foreign_table"]),
      foreignColumns: strings(row["foreign_columns"]), onDelete: String(row["on_delete"]),
      onUpdate: String(row["on_update"]),
    } satisfies ForeignKeyDefinition);
  }
  for (const row of indexesResult.rows) tableFor(row)?.indexes.push({
    name: String(row["index_name"]), expressions: strings(row["expressions"]),
    unique: Boolean(row["is_unique"]), method: String(row["method"]),
    predicate: row["predicate"] == null ? null : String(row["predicate"]),
  } satisfies IndexDefinition);
  return { tables: [...map.values()] };
}