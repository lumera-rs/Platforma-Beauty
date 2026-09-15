import type { DatabaseClient } from "../backend-standards-database";
import type {
  BackingIndexDetails, CheckDefinition, ColumnDefinition, ExclusionDefinition,
  ForeignKeyDefinition, IndexDefinition,
  KeyDefinition, PostgresFingerprintCompatibility, SchemaSnapshot, TableDefinition,
  EnumDefinition, FunctionDefinition, TriggerDefinition, UnmodelledObjectCensus,
} from "./model";
import {
  POSTGRES_DEPARSE_FORMAT,
  SUPPORTED_POSTGRES_MAJOR_VERSIONS,
} from "./model";

type Row = Record<string, unknown>;
const strings = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  throw new Error(`Catalog returned a non-JSON array: ${String(value)}`);
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
    SELECT con.oid AS constraint_oid, n.nspname AS schema_name, c.relname AS table_name, con.conname,
      con.contype, fn.nspname AS foreign_schema, fc.relname AS foreign_table,
      con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
      con.convalidated AS validated, con.connoinherit AS no_inherit,
      pix.indnullsnotdistinct AS nulls_not_distinct,
      pam.amname AS index_method, pix.indisvalid AS index_valid, pix.indisready AS index_ready,
       to_jsonb(ARRAY(SELECT pg_catalog.pg_get_indexdef(pix.indexrelid,k,true)
        FROM generate_series(pix.indnkeyatts + 1,pix.indnatts) k
         ORDER BY k)) AS index_include_expressions,
       to_jsonb(ARRAY(SELECT option_value FROM unnest(pix.indoption::smallint[]) WITH ORDINALITY
         option(option_value,ord) WHERE ord<=pix.indnkeyatts ORDER BY ord)) AS index_key_options,
       to_jsonb(ARRAY(SELECT CASE WHEN item.collation_oid=0 THEN ''
          ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname) END
        FROM unnest(pix.indcollation::oid[]) WITH ORDINALITY item(collation_oid,ord)
        LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=item.collation_oid
        LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=coll.collnamespace
         WHERE item.ord<=pix.indnkeyatts ORDER BY item.ord)) AS index_collations,
       to_jsonb(ARRAY(SELECT pg_catalog.format('%I.%I', opn.nspname, opc.opcname)
        FROM unnest(pix.indclass::oid[]) WITH ORDINALITY item(opclass_oid,ord)
        JOIN pg_catalog.pg_opclass opc ON opc.oid=item.opclass_oid
        JOIN pg_catalog.pg_namespace opn ON opn.oid=opc.opcnamespace
         WHERE item.ord<=pix.indnkeyatts ORDER BY item.ord)) AS index_opclasses,
       to_jsonb(ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY x(attnum,ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.attnum ORDER BY x.ord)) AS columns,
       to_jsonb(ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY x(attnum,ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=x.attnum ORDER BY x.ord)) AS foreign_columns,
       to_jsonb(ARRAY(SELECT a.attname::text FROM unnest(con.confdelsetcols) WITH ORDINALITY x(attnum,ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.attnum ORDER BY x.ord)) AS delete_set_columns,
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
       to_jsonb(ARRAY(SELECT option_value FROM unnest(ix.indoption::smallint[]) WITH ORDINALITY
         option(option_value,ord) WHERE ord<=ix.indnkeyatts ORDER BY ord)) AS key_options,
       to_jsonb(ARRAY(SELECT CASE WHEN item.collation_oid=0 THEN ''
          ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname) END
        FROM unnest(ix.indcollation::oid[]) WITH ORDINALITY item(collation_oid,ord)
        LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=item.collation_oid
        LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=coll.collnamespace
         WHERE item.ord<=ix.indnkeyatts ORDER BY item.ord)) AS collations,
       to_jsonb(ARRAY(SELECT pg_catalog.format('%I.%I', opn.nspname, opc.opcname)
        FROM unnest(ix.indclass::oid[]) WITH ORDINALITY item(opclass_oid,ord)
        JOIN pg_catalog.pg_opclass opc ON opc.oid=item.opclass_oid
        JOIN pg_catalog.pg_namespace opn ON opn.oid=opc.opcnamespace
         WHERE item.ord<=ix.indnkeyatts ORDER BY item.ord)) AS opclasses,
       to_jsonb(ARRAY(SELECT pg_catalog.pg_get_indexdef(ix.indexrelid,k,true)
         FROM generate_series(1,ix.indnkeyatts) k ORDER BY k)) AS expressions,
       to_jsonb(ARRAY(SELECT pg_catalog.pg_get_indexdef(ix.indexrelid,k,true)
         FROM generate_series(ix.indnkeyatts + 1,ix.indnatts) k ORDER BY k)) AS include_expressions,
      pg_catalog.pg_get_expr(ix.indpred,ix.indrelid,true) AS predicate
    FROM pg_catalog.pg_index ix
    JOIN pg_catalog.pg_class t ON t.oid=ix.indrelid
    JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid=i.relam
    LEFT JOIN pg_catalog.pg_constraint con ON con.conindid=ix.indexrelid AND con.contype IN ('p','u','x')
    WHERE n.nspname='public' AND t.relkind IN ('r','p') AND con.oid IS NULL
    ORDER BY n.nspname,t.relname,i.relname`);
  const enumsResult = await client.query(`
    SELECT n.nspname AS schema_name, t.typname AS enum_name,
      COALESCE(
        to_jsonb(array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
          FILTER (WHERE e.oid IS NOT NULL)),
        '[]'::jsonb
      ) AS labels
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    LEFT JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_toast'
      AND t.typtype='e'
    GROUP BY n.nspname,t.typname
    ORDER BY n.nspname,t.typname`);
  const triggersResult = await client.query(`
    SELECT t.tgconstraint AS constraint_oid,
      n.nspname AS table_schema, c.relname AS table_name, t.tgname AS trigger_name,
      CASE t.tgenabled WHEN 'O' THEN 'origin' WHEN 'D' THEN 'disabled'
        WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always'
        ELSE pg_catalog.concat('unknown:',t.tgenabled) END AS enabled,
      CASE WHEN (t.tgtype & 2) <> 0 THEN 'before'
        WHEN (t.tgtype & 64) <> 0 THEN 'instead of' ELSE 'after' END AS timing,
      to_jsonb(array_remove(ARRAY[
        CASE WHEN (t.tgtype & 4) <> 0 THEN 'insert' END,
        CASE WHEN (t.tgtype & 8) <> 0 THEN 'delete' END,
        CASE WHEN (t.tgtype & 16) <> 0 THEN 'update' END,
        CASE WHEN (t.tgtype & 32) <> 0 THEN 'truncate' END
      ],NULL)) AS events,
      to_jsonb(ARRAY(SELECT a.attname::text
        FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY item(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=item.attnum
        ORDER BY item.ord)) AS update_columns,
      CASE WHEN (t.tgtype & 1) <> 0 THEN 'row' ELSE 'statement' END AS level,
      pg_catalog.pg_get_triggerdef(t.oid,true) AS trigger_definition,
      t.tgconstraint <> 0 AS is_constraint, t.tgdeferrable AS deferrable,
      t.tginitdeferred AS initially_deferred,
      t.tgoldtable AS old_transition_table, t.tgnewtable AS new_transition_table,
      pn.nspname AS function_schema, p.proname AS function_name,
      pg_catalog.encode(t.tgargs,'base64') AS arguments_base64,
      pg_catalog.pg_get_functiondef(p.oid) AS function_definition
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY n.nspname,c.relname,t.tgname`);
  const censusResult = await client.query(`
    WITH objects AS (
      SELECT n.nspname AS schema_name,c.relname AS object_name,c.relkind,
        fs.srvname AS foreign_server
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_catalog.pg_foreign_table ft ON ft.ftrelid=c.oid
      LEFT JOIN pg_catalog.pg_foreign_server fs ON fs.oid=ft.ftserver
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname !~ '^pg_toast'
    )
    SELECT
      (SELECT jsonb_agg(jsonb_build_object('schema',schema_name,'name',object_name)
        ORDER BY schema_name,object_name) FROM objects WHERE relkind='v') AS views,
      (SELECT jsonb_agg(jsonb_build_object('schema',schema_name,'name',object_name)
        ORDER BY schema_name,object_name) FROM objects WHERE relkind='m') AS materialized_views,
      (SELECT jsonb_agg(jsonb_build_object('schema',schema_name,'name',object_name,'server',foreign_server)
        ORDER BY schema_name,object_name) FROM objects WHERE relkind='f') AS foreign_tables,
      (SELECT jsonb_agg(jsonb_build_object('schema',schema_name,'name',object_name)
        ORDER BY schema_name,object_name) FROM objects WHERE relkind='S') AS sequences,
      (SELECT to_jsonb(array_agg(nspname::text ORDER BY nspname))
        FROM pg_catalog.pg_namespace
        WHERE nspname NOT IN ('public','pg_catalog','information_schema')
          AND nspname !~ '^pg_(toast|temp)') AS application_schemas,
      (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
          'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity)
        ORDER BY n.nspname,c.relname)
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p') AND (c.relrowsecurity OR c.relforcerowsecurity)
          AND n.nspname NOT IN ('pg_catalog','information_schema')) AS rls_tables,
      (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
          'name',pol.polname,'command',pol.polcmd,'permissive',pol.polpermissive,
          'roles',to_jsonb(ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE
              (SELECT r.rolname::text FROM pg_catalog.pg_roles r WHERE r.oid=role_oid) END
            FROM unnest(pol.polroles) role_oid ORDER BY 1)),
          'using',pg_catalog.pg_get_expr(pol.polqual,pol.polrelid,true),
          'check',pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid,true))
        ORDER BY n.nspname,c.relname,pol.polname)
        FROM pg_catalog.pg_policy pol JOIN pg_catalog.pg_class c ON c.oid=pol.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')) AS policies,
      (SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)
        ORDER BY e.extname) FROM pg_catalog.pg_extension e
        JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace) AS extensions`);
  const functionsResult = await client.query(`
    SELECT n.nspname AS schema_name, p.proname AS function_name,
      CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
        WHEN 'w' THEN 'window_function'
        ELSE p.prokind::text END AS function_kind,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      pg_catalog.pg_get_function_arguments(p.oid) AS function_arguments,
      COALESCE(pg_catalog.pg_get_function_result(p.oid), '') AS return_type,
      p.proretset AS return_set, l.lanname AS language,
      CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable'
        WHEN 'v' THEN 'volatile' ELSE p.provolatile::text END AS volatility,
      CASE p.proparallel WHEN 's' THEN 'safe' WHEN 'r' THEN 'restricted'
        WHEN 'u' THEN 'unsafe' ELSE p.proparallel::text END AS parallel,
      p.proisstrict AS strict, p.proleakproof AS leakproof,
      p.prosecdef AS security_definer, p.procost AS cost, p.prorows AS rows,
      COALESCE(to_jsonb(p.proconfig), '[]'::jsonb) AS configuration,
      pg_catalog.pg_get_functiondef(p.oid) AS function_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.prokind IN ('f','p','w')
      AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
          AND d.objid=p.oid AND d.deptype='e'
      )
    ORDER BY n.nspname,p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid),
      pg_catalog.pg_get_functiondef(p.oid)`);

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
  const expectedConstraintTriggerIds = new Set<string>();
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
    else if (row["contype"] === "f") {
      if (row["on_delete"] == null || row["on_update"] == null || row["match_type"] == null) {
        throw new Error(`Unknown PostgreSQL FK action/match code for ${base.name}`);
      }
      table.foreignKeys.push({
        ...base, foreignSchema: String(row["foreign_schema"]), foreignTable: String(row["foreign_table"]),
        foreignColumns: strings(row["foreign_columns"]), onDelete: String(row["on_delete"]),
        onUpdate: String(row["on_update"]), matchType: String(row["match_type"]),
        deleteSetColumns: strings(row["delete_set_columns"]),
      } satisfies ForeignKeyDefinition);
    }
    else if (row["contype"] === "t") {
      const constraintId = String(row["constraint_oid"] ?? "");
      if (!constraintId) throw new Error(`Missing PostgreSQL constraint trigger identity for ${base.name}`);
      expectedConstraintTriggerIds.add(constraintId);
    } else throw new Error(`Unsupported catalog constraint type: ${String(row["contype"])}`);
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
  const enums: EnumDefinition[] = (enumsResult?.rows ?? []).map((row) => ({
    schema: String(row["schema_name"]),
    name: String(row["enum_name"]),
    labels: strings(row["labels"]),
  }));
  const triggers: TriggerDefinition[] = (triggersResult?.rows ?? []).map((row) => {
    const definition = String(row["trigger_definition"]);
    return {
    tableSchema: String(row["table_schema"]),
    tableName: String(row["table_name"]),
    name: String(row["trigger_name"]),
    enabled: String(row["enabled"]),
    timing: String(row["timing"]),
    events: strings(row["events"]),
    updateColumns: strings(row["update_columns"]),
    level: String(row["level"]),
    when: triggerWhenExpression(definition),
    constraint: Boolean(row["is_constraint"]),
    deferrable: Boolean(row["deferrable"]),
    initiallyDeferred: Boolean(row["initially_deferred"]),
    oldTransitionTable: row["old_transition_table"] == null
      ? null : String(row["old_transition_table"]),
    newTransitionTable: row["new_transition_table"] == null
      ? null : String(row["new_transition_table"]),
    functionSchema: String(row["function_schema"]),
    functionName: String(row["function_name"]),
    argumentsBase64: String(row["arguments_base64"]),
    definition,
    functionDefinition: String(row["function_definition"]),
    };
  });
  const functions: FunctionDefinition[] = (functionsResult?.rows ?? []).map((row) => ({
    schema: String(row["schema_name"]),
    name: String(row["function_name"]),
    kind: String(row["function_kind"]),
    identityArguments: String(row["identity_arguments"]),
    arguments: String(row["function_arguments"]),
    returnType: String(row["return_type"]),
    returnSet: Boolean(row["return_set"]),
    language: String(row["language"]),
    volatility: String(row["volatility"]),
    parallel: String(row["parallel"]),
    strict: Boolean(row["strict"]),
    leakproof: Boolean(row["leakproof"]),
    securityDefiner: Boolean(row["security_definer"]),
    cost: Number(row["cost"]),
    rows: Number(row["rows"]),
    configuration: strings(row["configuration"]),
    definition: String(row["function_definition"]),
  }));
  const modeledConstraintTriggerIds = new Set(
    (triggersResult?.rows ?? [])
      .map((row) => String(row["constraint_oid"] ?? "0"))
      .filter((value) => value !== "0"),
  );
  for (const constraintId of expectedConstraintTriggerIds) {
    if (!modeledConstraintTriggerIds.has(constraintId)) {
      throw new Error(`Constraint trigger ${constraintId} was not represented by the trigger catalog`);
    }
  }
  const censusRow = censusResult?.rows?.[0] ?? {};
  const array = <T>(key: string): T[] =>
    censusRow[key] == null ? [] : Array.isArray(censusRow[key]) ? censusRow[key] as T[]
      : (() => { throw new Error(`Catalog census ${key} was not a JSON array`); })();
  const unmodelled: UnmodelledObjectCensus = {
    views: array("views"),
    materializedViews: array("materialized_views"),
    foreignTables: array("foreign_tables"),
    sequences: array("sequences"),
    applicationSchemas: array("application_schemas").map(String),
    rlsTables: array("rls_tables"),
    policies: array("policies"),
    extensions: array("extensions"),
  };
  return { tables: [...map.values()], enums, triggers, functions, unmodelled };
}

function triggerWhenExpression(definition: string): string | null {
  const marker = " WHEN (";
  for (let index = 0; index < definition.length;) {
    const quotedEnd = sqlQuotedTokenEnd(definition, index);
    if (quotedEnd !== null) {
      index = quotedEnd;
      continue;
    }
    if (definition.slice(index, index + marker.length).toUpperCase() !== marker) {
      index += 1;
      continue;
    }
    const expressionStart = index + marker.length;
    let depth = 1;
    for (let cursor = expressionStart; cursor < definition.length;) {
      const expressionQuotedEnd = sqlQuotedTokenEnd(definition, cursor);
      if (expressionQuotedEnd !== null) {
        cursor = expressionQuotedEnd;
        continue;
      }
      if (definition[cursor] === "(") depth += 1;
      else if (definition[cursor] === ")") {
        depth -= 1;
        if (depth === 0) {
          const remainder = definition.slice(cursor + 1).trimStart().toUpperCase();
          if (
            remainder.startsWith("EXECUTE FUNCTION ")
            || remainder.startsWith("EXECUTE PROCEDURE ")
          ) {
            return definition.slice(expressionStart, cursor);
          }
          break;
        }
      }
      cursor += 1;
    }
    index += marker.length;
  }
  return null;
}

function sqlQuotedTokenEnd(input: string, start: number): number | null {
  const quote = input[start];
  if (quote === "'" || quote === '"') {
    for (let index = start + 1; index < input.length; index += 1) {
      if (input[index] === quote && input[index + 1] === quote) {
        index += 1;
      } else if (input[index] === quote) {
        return index + 1;
      }
    }
    throw new Error("Malformed quoted token in PostgreSQL trigger definition");
  }
  if (quote === "$") {
    const delimiter = input.slice(start).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];
    if (delimiter) {
      const end = input.indexOf(delimiter, start + delimiter.length);
      if (end < 0) throw new Error("Malformed dollar quote in PostgreSQL trigger definition");
      return end + delimiter.length;
    }
  }
  return null;
}