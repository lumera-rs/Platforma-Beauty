import type { DatabaseClient } from "../backend-standards-database";
import type {
  BackingIndexDetails, CheckDefinition, ColumnDefinition, ExclusionDefinition,
  ForeignKeyDefinition, IndexDefinition,
  KeyDefinition, PostgresFingerprintCompatibility, SchemaSnapshot, TableDefinition,
} from "./model";
import {
  POSTGRES_DEPARSE_FORMAT,
  SUPPORTED_POSTGRES_MAJOR_VERSIONS,
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
const numbers = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map(Number);
  return strings(value).map(Number);
};

export function postgresFingerprintCompatibility(
  serverVersionNumInput: string | number,
): PostgresFingerprintCompatibility {
  const serverVersionNum = Number(serverVersionNumInput);
  if (!Number.isInteger(serverVersionNum) || serverVersionNum < 10000) {
    throw new Error(`Invalid PostgreSQL server_version_num: ${String(serverVersionNumInput)}`);
  }
  const serverMajorVersion = Math.floor(serverVersionNum / 10000);
  if (!(SUPPORTED_POSTGRES_MAJOR_VERSIONS as readonly number[]).includes(serverMajorVersion)) {
    throw new Error(
      `Unsupported PostgreSQL ${serverMajorVersion} deparser format; `
      + `supported major version(s): ${SUPPORTED_POSTGRES_MAJOR_VERSIONS.join(", ")}`,
    );
  }
  return { serverVersionNum, serverMajorVersion, deparserFormat: POSTGRES_DEPARSE_FORMAT };
}

export async function readPostgresFingerprintCompatibility(
  client: DatabaseClient,
): Promise<PostgresFingerprintCompatibility> {
  const result = await client.query(
    "SELECT pg_catalog.current_setting('server_version_num') AS server_version_num",
  );
  if (result.rows.length !== 1) {
    throw new Error("PostgreSQL server version query returned an unexpected row count");
  }
  return postgresFingerprintCompatibility(result.rows[0]?.["server_version_num"] as string | number);
}

export async function readPostgresSnapshot(client: DatabaseClient): Promise<SchemaSnapshot> {
  const tablesResult = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
    ORDER BY n.nspname, c.relname`);
  const columnsResult = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attnum AS column_position,
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      NOT a.attnotnull AS nullable,
      CASE a.attidentity WHEN 'a' THEN 'always' WHEN 'd' THEN 'by default' ELSE NULL END AS identity_mode,
      CASE a.attgenerated WHEN 's' THEN 'stored' WHEN 'v' THEN 'virtual' ELSE NULL END AS generated_mode,
      CASE WHEN a.attcollation=0 THEN NULL
        ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname) END AS column_collation,
      CASE WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true) END AS column_default,
      CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true) END AS generated
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=a.attcollation
    LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=coll.collnamespace
    LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    WHERE c.relkind IN ('r','p') AND n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY n.nspname,c.relname,a.attnum`);
  const constraintsResult = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname,
      con.contype, fn.nspname AS foreign_schema, fc.relname AS foreign_table,
      con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
      con.convalidated AS validated, con.connoinherit AS no_inherit,
      pix.indnullsnotdistinct AS nulls_not_distinct,
      pam.amname AS index_method, pix.indisvalid AS index_valid, pix.indisready AS index_ready,
      ARRAY(SELECT pg_catalog.pg_get_indexdef(pix.indexrelid,k,true)
        FROM generate_series(pix.indnkeyatts + 1,pix.indnatts) k
        ORDER BY k) AS index_include_expressions,
      ARRAY(SELECT option_value FROM unnest(pix.indoption::smallint[]) WITH ORDINALITY
        option(option_value,ord) WHERE ord<=pix.indnkeyatts ORDER BY ord) AS index_key_options,
      ARRAY(SELECT CASE WHEN item.collation_oid=0 THEN ''
          ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname) END
        FROM unnest(pix.indcollation::oid[]) WITH ORDINALITY item(collation_oid,ord)
        LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=item.collation_oid
        LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=coll.collnamespace
        WHERE item.ord<=pix.indnkeyatts ORDER BY item.ord) AS index_collations,
      ARRAY(SELECT pg_catalog.format('%I.%I', opn.nspname, opc.opcname)
        FROM unnest(pix.indclass::oid[]) WITH ORDINALITY item(opclass_oid,ord)
        JOIN pg_catalog.pg_opclass opc ON opc.oid=item.opclass_oid
        JOIN pg_catalog.pg_namespace opn ON opn.oid=opc.opcnamespace
        WHERE item.ord<=pix.indnkeyatts ORDER BY item.ord) AS index_opclasses,
      ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY x(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS columns,
      ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY x(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=x.attnum ORDER BY x.ord) AS foreign_columns,
      ARRAY(SELECT a.attname FROM unnest(con.confdelsetcols) WITH ORDINALITY x(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS delete_set_columns,
      CASE con.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS on_delete,
      CASE con.confupdtype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS on_update,
      CASE con.confmatchtype WHEN 's' THEN 'simple' WHEN 'f' THEN 'full'
        WHEN 'p' THEN 'partial' END AS match_type,
      CASE WHEN con.contype='c' THEN pg_catalog.pg_get_expr(con.conbin,con.conrelid,true) END AS expression
      , CASE WHEN con.contype='x' THEN pg_catalog.pg_get_constraintdef(con.oid,true) END AS exclusion_definition
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_class fc ON fc.oid=con.confrelid
    LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid=fc.relnamespace
    LEFT JOIN pg_catalog.pg_index pix ON pix.indexrelid=con.conindid
    LEFT JOIN pg_catalog.pg_class pi ON pi.oid=con.conindid
    LEFT JOIN pg_catalog.pg_am pam ON pam.oid=pi.relam
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY n.nspname,c.relname,con.conname`);
  const indexesResult = await client.query(`
    SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
      ix.indisunique AS is_unique, ix.indnullsnotdistinct AS nulls_not_distinct,
      ix.indisvalid AS is_valid, ix.indisready AS is_ready, am.amname AS method,
      ARRAY(SELECT option_value FROM unnest(ix.indoption::smallint[]) WITH ORDINALITY
        option(option_value,ord) WHERE ord<=ix.indnkeyatts ORDER BY ord) AS key_options,
      ARRAY(SELECT CASE WHEN item.collation_oid=0 THEN ''
          ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname) END
        FROM unnest(ix.indcollation::oid[]) WITH ORDINALITY item(collation_oid,ord)
        LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=item.collation_oid
        LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=coll.collnamespace
        WHERE item.ord<=ix.indnkeyatts ORDER BY item.ord) AS collations,
      ARRAY(SELECT pg_catalog.format('%I.%I', opn.nspname, opc.opcname)
        FROM unnest(ix.indclass::oid[]) WITH ORDINALITY item(opclass_oid,ord)
        JOIN pg_catalog.pg_opclass opc ON opc.oid=item.opclass_oid
        JOIN pg_catalog.pg_namespace opn ON opn.oid=opc.opcnamespace
        WHERE item.ord<=ix.indnkeyatts ORDER BY item.ord) AS opclasses,
      ARRAY(SELECT pg_catalog.pg_get_indexdef(ix.indexrelid,k,true)
        FROM generate_series(1,ix.indnkeyatts) k ORDER BY k) AS expressions,
      ARRAY(SELECT pg_catalog.pg_get_indexdef(ix.indexrelid,k,true)
        FROM generate_series(ix.indnkeyatts + 1,ix.indnatts) k ORDER BY k) AS include_expressions,
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
    if (!schema || !table || map.has(`${schema}.${table}`)) {
      throw new Error(`Invalid or duplicate catalog table row: ${schema}.${table}`);
    }
    map.set(`${schema}.${table}`, {
      schema, name: table, columns: [], primaryKey: null, uniques: [],
      foreignKeys: [], checks: [], exclusions: [], indexes: [],
    });
  }
  const tableFor = (row: Row): TableDefinition => {
    const key = `${row["schema_name"]}.${row["table_name"]}`;
    const table = map.get(key);
    if (!table) throw new Error(`Catalog returned child object for unknown table: ${key}`);
    return table;
  };
  for (const row of columnsResult.rows) tableFor(row).columns.push({
    position: Number(row["column_position"]),
    name: String(row["column_name"]), type: String(row["data_type"]),
    nullable: Boolean(row["nullable"]),
    default: row["column_default"] == null ? null : String(row["column_default"]),
    generated: row["generated"] == null ? null : String(row["generated"]),
    generatedMode: row["generated_mode"] == null ? null : String(row["generated_mode"]),
    identity: row["identity_mode"] == null ? null : String(row["identity_mode"]),
    collation: row["column_collation"] == null ? null : String(row["column_collation"]),
  } satisfies ColumnDefinition);
  for (const row of constraintsResult.rows) {
    const table = tableFor(row);
    const backingIndex: BackingIndexDetails = row["index_method"] == null ? {} : {
      indexMethod: String(row["index_method"]),
      indexIncludeExpressions: strings(row["index_include_expressions"]),
      indexKeyOptions: numbers(row["index_key_options"]),
      indexCollations: strings(row["index_collations"]),
      indexOpclasses: strings(row["index_opclasses"]),
      indexValid: Boolean(row["index_valid"]),
      indexReady: Boolean(row["index_ready"]),
    };
    const base = {
      name: String(row["conname"]),
      columns: strings(row["columns"]),
      deferrable: Boolean(row["deferrable"]),
      initiallyDeferred: Boolean(row["initially_deferred"]),
      validated: Boolean(row["validated"]),
    };
    if (row["contype"] === "p") table.primaryKey = {
      ...base, ...backingIndex, nullsNotDistinct: Boolean(row["nulls_not_distinct"]),
    } satisfies KeyDefinition;
    else if (row["contype"] === "u") table.uniques.push({
      ...base, ...backingIndex, nullsNotDistinct: Boolean(row["nulls_not_distinct"]),
    } satisfies KeyDefinition);
    else if (row["contype"] === "c") table.checks.push({
      name: base.name, expression: String(row["expression"]), validated: base.validated,
      noInherit: Boolean(row["no_inherit"]),
    } satisfies CheckDefinition);
    else if (row["contype"] === "x") table.exclusions!.push({
      name: base.name,
      definition: String(row["exclusion_definition"]),
      deferrable: base.deferrable,
      initiallyDeferred: base.initiallyDeferred,
      validated: base.validated,
      ...backingIndex,
    } satisfies ExclusionDefinition);
    else if (row["contype"] === "f") table.foreignKeys.push({
      ...base, foreignSchema: String(row["foreign_schema"]), foreignTable: String(row["foreign_table"]),
      foreignColumns: strings(row["foreign_columns"]), onDelete: String(row["on_delete"]),
      onUpdate: String(row["on_update"]), matchType: String(row["match_type"]),
      deleteSetColumns: strings(row["delete_set_columns"]),
    } satisfies ForeignKeyDefinition);
    else throw new Error(`Unsupported catalog constraint type: ${String(row["contype"])}`);
  }
  for (const row of indexesResult.rows) tableFor(row).indexes.push({
    name: String(row["index_name"]), expressions: strings(row["expressions"]),
    includeExpressions: strings(row["include_expressions"]),
    keyOptions: numbers(row["key_options"]),
    collations: strings(row["collations"]),
    opclasses: strings(row["opclasses"]),
    unique: Boolean(row["is_unique"]), method: String(row["method"]),
    nullsNotDistinct: Boolean(row["nulls_not_distinct"]),
    valid: Boolean(row["is_valid"]),
    ready: Boolean(row["is_ready"]),
    predicate: row["predicate"] == null ? null : String(row["predicate"]),
  } satisfies IndexDefinition);
  return { tables: [...map.values()] };
}