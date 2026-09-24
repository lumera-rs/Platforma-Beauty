import type { DatabaseClient } from "../backend-standards-database";
import { identifier, relation } from "./catalog";
import type { Blocker, TableShape } from "./mapping";

export async function verifyConstraints(client: DatabaseClient, tables: TableShape[]): Promise<Blocker[]> {
  const violations: Blocker[] = [];
  async function count(table: string, constraint: string, sql: string): Promise<void> {
    const result = await client.query(sql);
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count)) throw new Error("INVALID_CONSTRAINT_COUNT");
    if (count) violations.push({ code: "CONSTRAINT_VIOLATION", table, constraint, count });
  }
  for (const table of tables) {
    for (const column of table.columns.filter(c => c.notNull)) {
      await count(table.name, `${column.name}:not_null`,
        `SELECT count(*)::text AS count FROM ${relation(table.name)} WHERE ${identifier(column.name)} IS NULL`);
    }
  }
  const constraints = await client.query(`
    SELECT c.conname,c.contype,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS destination,
      c.confmatchtype,pg_get_expr(c.conbin,c.conrelid) AS expression,
      (SELECT jsonb_agg(a.attname ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(num,n)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num) AS columns,
      (SELECT jsonb_agg(a.attname ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(num,n)
       JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num) AS foreign_columns,
      COALESCE(i.indnullsnotdistinct,false) AS nulls_not_distinct,
      pg_get_expr(i.indpred,i.indrelid) AS predicate,
      (SELECT jsonb_agg(pg_get_indexdef(c.conindid,k,true) ORDER BY k)
       FROM generate_series(1,i.indnkeyatts) k) AS index_expressions,
      (SELECT jsonb_agg(jsonb_build_object('name',o.oprname,'schema',ns.nspname) ORDER BY k.n)
       FROM unnest(c.conexclop) WITH ORDINALITY k(op,n)
       JOIN pg_operator o ON o.oid=k.op JOIN pg_namespace ns ON ns.oid=o.oprnamespace) AS exclusion_operators
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid=c.conindid
    WHERE n.nspname='public' AND r.relname<>'lumera_migration_ledger'
    ORDER BY r.relname,c.conname
  `);
  const lookup = new Map(tables.map(t => [t.name.replace("public.", ""), t.name]));
  for (const constraint of constraints.rows) {
    // regclass under pinned pg_catalog search_path is schema-qualified, quoted.
    const rawName = String(constraint.source).replaceAll('"', "").replace(/^public\./u, "");
    const table = lookup.get(rawName);
    if (!table) throw new Error("UNSUPPORTED_CONSTRAINT_RELATION");
    const name = String(constraint.conname);
    const columns = (constraint.columns ?? []) as string[];
    const type = String(constraint.contype);
    if (type === "c") {
      await count(table, name, `SELECT count(*)::text AS count FROM ${relation(table)} WHERE (${String(constraint.expression)}) IS FALSE`);
    } else if (type === "p" || type === "u") {
      const cols = columns.map(identifier).join(",");
      const where = type === "u" && !constraint.nulls_not_distinct
        ? `WHERE ${columns.map(c => `${identifier(c)} IS NOT NULL`).join(" AND ")}` : "";
      await count(table, name, `SELECT COALESCE(sum(n-1),0)::text AS count FROM
        (SELECT count(*) n FROM ${relation(table)} ${where} GROUP BY ${cols} HAVING count(*)>1) d`);
    } else if (type === "f") {
      const foreignColumns = constraint.foreign_columns as string[];
      const destinationName = String(constraint.destination).replaceAll('"', "");
      const destination = destinationName.startsWith("public.") ? destinationName : `public.${destinationName}`;
      const notNull = columns.map(c => `s.${identifier(c)} IS NOT NULL`).join(" AND ");
      const someNotNull = columns.map(c => `s.${identifier(c)} IS NOT NULL`).join(" OR ");
      const join = columns.map((c, i) => `s.${identifier(c)}=d.${identifier(foreignColumns[i]!)}`).join(" AND ");
      const mixed = constraint.confmatchtype === "f" ? `((${someNotNull}) AND NOT (${notNull})) OR ` : "";
      await count(table, name, `SELECT count(*)::text AS count FROM ${relation(table)} s WHERE
        ${mixed}((${notNull}) AND NOT EXISTS(SELECT 1 FROM ${relation(destination)} d WHERE ${join}))`);
    } else if (type === "x") {
      const expressions = constraint.index_expressions as string[];
      const operators = constraint.exclusion_operators as { name: string; schema: string }[];
      if (!expressions?.length || expressions.length !== operators?.length
        || operators.some(op => op.schema !== "pg_catalog" || !/^[+*/<>=~!@#%^&|?-]+$/u.test(op.name))) {
        violations.push({ code: "UNSUPPORTED_CONSTRAINT", table, constraint: name });
        continue;
      }
      const projection = expressions.map((expression, i) => `(${expression}) AS ${identifier(`key_${i}`)}`).join(",");
      const predicate = constraint.predicate ? `WHERE (${String(constraint.predicate)}) IS TRUE` : "";
      // One unordered pair is one exclusion violation. NULL comparisons do not
      // conflict, matching PostgreSQL exclusion semantics. Evaluate partial-index
      // predicates and expression keys rather than just conkey attribute numbers.
      const pairs = operators.map((op, i) =>
        `l.${identifier(`key_${i}`)} OPERATOR(pg_catalog.${op.name}) r.${identifier(`key_${i}`)}`).join(" AND ");
      await count(table, name, `WITH keys AS MATERIALIZED (
        SELECT ctid AS row_tid,${projection} FROM ${relation(table)} ${predicate}
      ) SELECT count(*)::text AS count FROM keys l JOIN keys r
        ON l.row_tid<r.row_tid AND (${pairs})`);
    } else {
      // Unknown catalog semantics never silently pass relaxed checks.
      violations.push({ code: "UNSUPPORTED_CONSTRAINT", table, constraint: name });
    }
  }
  // A standalone UNIQUE index is not necessarily represented in pg_constraint.
  // Check its actual expression keys and partial predicate, not table columns.
  const indexes = await client.query(`
    SELECT r.relname AS table_name,ic.relname AS index_name,
      i.indisvalid,i.indisready,i.indnullsnotdistinct,am.amname,
      pg_get_expr(i.indpred,i.indrelid) AS predicate,
      (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid,k,true) ORDER BY k)
       FROM generate_series(1,i.indnkeyatts) k) AS expressions,
      (SELECT bool_and(op.opcdefault AND ns.nspname='pg_catalog')
       FROM unnest(i.indclass::oid[]) cl JOIN pg_opclass op ON op.oid=cl
       JOIN pg_namespace ns ON ns.oid=op.opcnamespace) AS default_opclasses
    FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_am am ON am.oid=ic.relam
    WHERE n.nspname='public' AND r.relname<>'lumera_migration_ledger'
      AND i.indisunique AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
    ORDER BY r.relname,ic.relname
  `);
  for (const index of indexes.rows) {
    const table = `public.${String(index.table_name)}`;
    const name = String(index.index_name);
    const expressions = index.expressions as string[];
    if (index.amname !== "btree" || !index.default_opclasses || !index.indisvalid || !index.indisready || !expressions?.length) {
      violations.push({ code: "UNSUPPORTED_UNIQUE_INDEX", table, constraint: name });
      continue;
    }
    const keys = expressions.map((_, i) => identifier(`key_${i}`));
    const projection = expressions.map((expr, i) => `(${expr}) AS ${keys[i]}`).join(",");
    const predicate = index.predicate ? `WHERE (${String(index.predicate)}) IS TRUE` : "";
    const nullFilter = index.indnullsnotdistinct ? "" : `WHERE ${keys.map(key => `${key} IS NOT NULL`).join(" AND ")}`;
    await count(table, name, `WITH keys AS MATERIALIZED (
      SELECT ${projection} FROM ${relation(table)} ${predicate}
    ) SELECT COALESCE(sum(n-1),0)::text AS count FROM (
      SELECT count(*) n FROM keys ${nullFilter} GROUP BY ${keys.join(",")} HAVING count(*)>1
    ) duplicate_keys`);
  }
  return violations;
}