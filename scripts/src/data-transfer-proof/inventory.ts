import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { withOwnedPair } from "./owned-pair";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const q = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
type Column = { name: string; type: string; notNull: boolean; default: string | null; identity: string; generated: string };
type Table = { name: string; columns: Column[]; count: number; foreignKeys: Record<string, unknown>[] };

export async function inventory(client: pg.PoolClient): Promise<{ tables: Table[]; triggers: Record<string, unknown>[]; functions: Record<string, unknown>[] }> {
  const names = (await client.query<{ name: string }>(`
    SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> 'lumera_migration_ledger' ORDER BY c.relname
  `)).rows;
  const tables: Table[] = [];
  for (const { name } of names) {
    const columns = (await client.query<Column>(`
      SELECT a.attname AS name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS "notNull", pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default,
        a.attidentity AS identity, a.attgenerated AS generated
      FROM pg_catalog.pg_attribute a
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
    `, [`public.${q(name)}`])).rows;
    const foreignKeys = (await client.query(`
      SELECT conname AS name, confrelid::regclass::text AS target, pg_catalog.pg_get_constraintdef(oid,true) AS definition
      FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND contype='f' ORDER BY conname
    `, [`public.${q(name)}`])).rows;
    const count = Number((await client.query(`SELECT count(*)::text AS count FROM public.${q(name)}`)).rows[0].count);
    tables.push({ name: `public.${name}`, columns, count, foreignKeys });
  }
  const triggers = (await client.query(`
    SELECT t.tgname AS name, c.relname AS table, p.proname AS function, t.tgenabled AS enabled,
      pg_catalog.pg_get_triggerdef(t.oid,true) AS definition
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname
  `)).rows;
  const functions = (await client.query(`
    SELECT p.proname AS name, pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_catalog.pg_get_functiondef(p.oid) AS definition,
      (SELECT count(*)::integer FROM pg_catalog.pg_trigger t WHERE t.tgfoid=p.oid) AS "attachedTriggers"
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
    ORDER BY p.proname
  `)).rows.map(({ definition, ...row }) => ({ ...row, definitionHash: hash(String(definition)),
    writes: [...String(definition).matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?["]?([a-z_][a-z_0-9]*)/gi)].map(match => match[1]),
    raises: /RAISE\s+EXCEPTION/i.test(String(definition)),
  }));
  return { tables, triggers, functions };
}

export async function runInventory(): Promise<void> {
  const output = path.join(root, ".local/data-transfer");
  const docs = path.join(root, "docs/data-transfer");
  await mkdir(output, { recursive: true });
  await mkdir(docs, { recursive: true });
  const provisional = JSON.parse(await readFile(path.join(root, ".local/data-transfer-inventory/step1-inventory.json"), "utf8"));
  await withOwnedPair(async pair => {
    await pair.restoreSource(path.join(root, "recovery-backups/phase6-preserved-xJV2Dz/attempt-a775nT/development-full.dump"));
    const sourceClient = await pair.source.connect();
    const targetClient = await pair.target.connect();
    try {
      await sourceClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await targetClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const source = await inventory(sourceClient);
      const target = await inventory(targetClient);
      await targetClient.query("COMMIT");
      await sourceClient.query("COMMIT");
      const sourceMap = new Map(source.tables.map(table => [table.name, table]));
      const tables = target.tables.map(table => {
        const from = sourceMap.get(table.name);
        const prior = provisional.tables.find((entry: { table: string }) => `public.${entry.table}` === table.name);
        const differences: { column: string; kind: string; source: unknown; target: unknown }[] = [];
        for (const col of table.columns) {
          const sourceColumn = from?.columns.find(column => column.name === col.name);
          if (!sourceColumn) differences.push({ column: col.name, kind: "target-only", source: null, target: col });
          else for (const field of ["type", "notNull", "default", "identity", "generated"] as const) {
            if (sourceColumn[field] !== col[field]) differences.push({ column: col.name, kind: field, source: sourceColumn[field], target: col[field] });
          }
        }
        for (const col of from?.columns ?? []) if (!table.columns.some(column => column.name === col.name)) {
          differences.push({ column: col.name, kind: "source-only", source: col, target: null });
        }
        return { table: table.name, sourceCount: from?.count ?? null, seededTargetCount: table.count,
          seededBy: table.count ? (prior?.seededBy?.length ? prior.seededBy : ["lib/db/migrations/000002_supported_startup_state/migration.sql"]) : [],
          foreignKeys: table.foreignKeys, sourceColumns: from?.columns ?? [], targetColumns: table.columns,
          columnDifferences: differences, proposal: table.count ? "compare-with-seeded-rows" : "transfer",
          reason: table.count ? "Reconcile existing migration seeds explicitly; transfer remains default." : "Transfer all source rows by default.",
          businessDecisions: prior?.businessDecisionFlags ?? [],
          provisional: prior ? { sourceCount: prior.sourceCount, differences: prior.columnDifferences, proposal: prior.proposal } : null,
        };
      });
      const report = {
        authority: "Executed applyMigrations with loaded migrations 000001-000004 on owned PostgreSQL 16",
        excluded: ["public.lumera_migration_ledger"],
        sourceTables: source.tables.length, targetTables: target.tables.length,
        sourceRows: source.tables.reduce((sum, table) => sum + table.count, 0),
        targetSeedRows: target.tables.reduce((sum, table) => sum + table.count, 0),
        tables, sourceOnly: source.tables.filter(table => !tables.some(target => target.table === table.name)),
        sourceTriggers: source.triggers, targetTriggers: target.triggers,
        sourceFunctions: source.functions, targetFunctions: target.functions,
      };
      await writeFile(path.join(output, "migration-built-inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(path.join(docs, "inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`INVENTORY target_tables=${target.tables.length} source_tables=${source.tables.length} source_rows=${report.sourceRows} target_seed_rows=${report.targetSeedRows}`);
      console.log(`TRIGGERS source=${source.triggers.length} target=${target.triggers.length}`);
      console.log(`FUNCTIONS source=${source.functions.length} target=${target.functions.length}`);
      const cleanup = tables.find(table => table.table === "public.education_salon_cleanup_reports");
      console.log(`CLEANUP_REPORT_TABLE target_exists=${Boolean(cleanup)} source_count=${cleanup?.sourceCount ?? 0} target_count=${cleanup?.seededTargetCount ?? 0}`);
      const fault = source.functions.filter(item => String(item.name).startsWith("appointment_cancel_email_fault_"));
      console.log(`FAULT_FUNCTION source_count=${fault.length} source_attached_triggers=${fault.reduce((sum, item) => sum + Number(item.attachedTriggers), 0)} target_count=${target.functions.filter(item => String(item.name).startsWith("appointment_cancel_email_fault")).length}`);
    } finally {
      sourceClient.release();
      targetClient.release();
    }
  }, { builtCanonical: true });
  console.log("OWNED_CLUSTER_REMOVED");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInventory().catch(() => { console.error("INVENTORY_FAILED: inspect owned disposable diagnostics; no row payload emitted"); process.exitCode = 1; });
}