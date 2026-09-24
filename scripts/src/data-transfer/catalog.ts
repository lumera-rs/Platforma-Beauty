import type { DatabaseClient } from "../backend-standards-database";
import type { TableShape } from "./mapping";

export function identifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
export function relation(name: string): string {
  const parts = name.split(".");
  if (parts.length !== 2 || parts[0] !== "public") throw new Error("UNSUPPORTED_RELATION");
  return parts.map(identifier).join(".");
}

/** Ledger excluded in SQL, before discovering columns or reading any source rows. */
export async function readTransferCatalog(client: DatabaseClient): Promise<TableShape[]> {
  const result = await client.query(`
    SELECT c.relname AS name,
      (SELECT jsonb_agg(jsonb_build_object(
        'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
        'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
      COALESCE((SELECT jsonb_agg(a.attname ORDER BY k.ordinality)
       FROM pg_constraint p CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY k(num,ordinality)
       JOIN pg_attribute a ON a.attrelid=p.conrelid AND a.attnum=k.num
       WHERE p.conrelid=c.oid AND p.contype='p'),'[]'::jsonb) AS primary_key
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname <> 'lumera_migration_ledger' ORDER BY c.relname
  `);
  return result.rows.map(row => ({ name: `public.${String(row.name)}`,
    columns: row.columns as TableShape["columns"], primaryKey: row.primary_key as string[] }));
}