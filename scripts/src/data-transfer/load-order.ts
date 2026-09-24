import type { DatabaseClient } from "../backend-standards-database";
import { relation, identifier } from "./catalog";
export async function foreignKeyReady(client: DatabaseClient, table: string, row: string): Promise<boolean> {
  const constraints = await client.query(`SELECT pn.nspname AS schema,p.relname AS parent,
    array_agg(a.attname::text ORDER BY k.n) AS local_columns,array_agg(pa.attname::text ORDER BY k.n) AS parent_columns
    FROM pg_constraint f JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    CROSS JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY k(l,r,n)
    JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.l
    JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.r
    WHERE f.conrelid=$1::regclass AND f.contype='f'
    GROUP BY f.oid,pn.nspname,p.relname`, [table]);
  for (const fk of constraints.rows) {
    const local = fk.local_columns as string[], remote = fk.parent_columns as string[];
    const self = `${String(fk.schema)}.${String(fk.parent)}` === table
      ? ` OR (${local.map((c,i) => `r.${identifier(c)} = r.${identifier(remote[i]!)}`).join(" AND ")})` : "";
    const result = await client.query(`SELECT (${local.map(c => `r.${identifier(c)} IS NULL`).join(" OR ")})${self}
      OR EXISTS (SELECT 1 FROM ${relation(`${String(fk.schema)}.${String(fk.parent)}`)} p
       WHERE ${local.map((c,i) => `r.${identifier(c)} = p.${identifier(remote[i]!)}`).join(" AND ")}) AS ready
      FROM jsonb_populate_record(NULL::${relation(table)},$1::jsonb) r`, [row]);
    if (!result.rows[0]?.ready) return false;
  }
  return true;
}