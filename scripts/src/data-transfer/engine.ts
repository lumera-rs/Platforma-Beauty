import type { DatabaseClient } from "../backend-standards-database";
import { assertTargetIdentity, type ExpectedTargetIdentity } from "../migrations/target-identity";
import { inspectDatabaseMigrationReady, pinMigrationFingerprintEnvironment, readPostgresSnapshot, fingerprintSnapshot, ownershipExceptions, readPostgresFingerprintCompatibility } from "@workspace/db/migration-runtime";
import { identifier, readTransferCatalog, relation } from "./catalog";
import { LEDGER, planMapping, type Blocker, type TransferPolicy } from "./mapping";
import { hashRows, readPinnedSeedContract, stableRows, type SeedContract } from "./seed-contract";
import { verifyConstraints } from "./constraints";
import { MIGRATION_MANIFEST } from "../migrations/manifest";

export interface TransferOptions { expectedTargetIdentity: ExpectedTargetIdentity; policy?: TransferPolicy }
export interface TableResult {
  table: string; sourceCount: number; targetCount: number; sourceHash: string; targetHash: string;
  hashColumns?: string[]; outcome?: "not-loaded" | "excluded" | "verified" | "committed";
  ordering?: "primary-key" | "row-multiset"; recomputedColumns?: string[];
}
export interface TransferReport {
  status: "committed" | "blocked"; blockers: Blocker[]; tables: TableResult[];
  namedDrops: string[]; namedExclusions: string[];
  fingerprints?: { structural: string; physical: string };
}
export class TransferError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "TransferError"; }
}
async function fingerprints(client: DatabaseClient): Promise<{ structural: string; physical: string }> {
  const result = fingerprintSnapshot(await readPostgresSnapshot(client), ownershipExceptions, await readPostgresFingerprintCompatibility(client));
  return { structural: result.structuralFingerprint, physical: result.physicalFingerprint };
}
async function readiness(client: DatabaseClient): Promise<void> {
  const report = await inspectDatabaseMigrationReady(client);
  if (!report.ready || report.migrationIds.join(",") !== "000001,000002,000003,000004") throw new TransferError("TARGET_NOT_READY");
}
export async function transferData(source: DatabaseClient, target: DatabaseClient, options: TransferOptions): Promise<TransferReport> {
  // Application entry point has no injection/baseline override.
  return transferCore(source, target, options, { readiness, seeds: await readPinnedSeedContract(), fingerprint: fingerprints, boundLedger: true });
}
export interface Admission {
  readiness(client: DatabaseClient): Promise<void>;
  seeds: SeedContract | null;
  fingerprint(client: DatabaseClient): Promise<{ structural: string; physical: string }>;
  boundLedger?: boolean;
}
/** Internal shared core. Only fixture.ts replaces application admission; never exposed by CLI. */
export async function transferCore(source: DatabaseClient, target: DatabaseClient, options: TransferOptions, admission: Admission): Promise<TransferReport> {
  const policy = options.policy ?? {};
  const report: TransferReport = { status: "blocked", blockers: [], tables: [],
    namedDrops: [...(policy.dropColumns ?? [])], namedExclusions: [...(policy.excludeTables ?? [])] };
  let sourceOpen = false;
  let targetOpen = false;
  let committed = false;
  try {
    await assertTargetIdentity(target, options.expectedTargetIdentity);
    await admission.readiness(target);
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    sourceOpen = true;
    await pinMigrationFingerprintEnvironment(source);
    const same = await source.query("SELECT current_database() AS name, system_identifier::text AS system FROM pg_catalog.pg_control_system()");
    if (same.rows[0]?.name === options.expectedTargetIdentity.databaseName
      && same.rows[0]?.system === options.expectedTargetIdentity.systemIdentifier) throw new TransferError("SOURCE_EQUALS_TARGET");
    const sourceTables = await readTransferCatalog(source);
    const discoveredTables = await readTransferCatalog(target);
    const ledger = await target.query("SELECT to_regclass('public.lumera_migration_ledger') AS ledger");
    await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    targetOpen = true;
    await pinMigrationFingerprintEnvironment(target);
    // Hold all destination relations through the pristine check and COMMIT; no check/load race.
    // LOCK precedes the first target snapshot query: a concurrent pre-lock commit cannot hide behind an old snapshot.
    const lockNames = [...discoveredTables.map(t => t.name), ...(ledger.rows[0]?.ledger ? [LEDGER] : [])].sort();
    if (lockNames.length) await target.query(`LOCK TABLE ${lockNames.map(relation).join(",")} IN ACCESS EXCLUSIVE MODE`);
    const targetTables = await readTransferCatalog(target);
    if (JSON.stringify(targetTables.map(t => t.name)) !== JSON.stringify(discoveredTables.map(t => t.name))) throw new TransferError("TARGET_CATALOG_RACE");
    if (admission.boundLedger) {
      const rows = await target.query("SELECT migration_id,checksum,state,database_name,system_identifier,neon_project_id,neon_branch_id FROM public.lumera_migration_ledger ORDER BY migration_id");
      const expected = options.expectedTargetIdentity;
      if (rows.rows.length !== MIGRATION_MANIFEST.length || rows.rows.some((row, i) =>
        row.migration_id !== MIGRATION_MANIFEST[i]?.id || row.checksum !== MIGRATION_MANIFEST[i]?.checksum
        || !["APPLIED", "ADOPTED"].includes(String(row.state))
        || row.database_name !== expected.databaseName || row.system_identifier !== expected.systemIdentifier
        || row.neon_project_id !== (expected.neon?.projectId ?? null) || row.neon_branch_id !== (expected.neon?.branchId ?? null))) {
        throw new TransferError("TARGET_LEDGER_NOT_BOUND");
      }
    }
    const before = await admission.fingerprint(target);
    if (admission.boundLedger && (before.structural !== MIGRATION_MANIFEST.at(-1)?.structuralFingerprint
      || before.physical !== MIGRATION_MANIFEST.at(-1)?.physicalFingerprint)) throw new TransferError("TARGET_NOT_CANONICAL");
    const triggers = await target.query(`SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled IN ('A','R')`);
    for (const t of triggers.rows) report.blockers.push({ code: "UNSUPPRESSIBLE_TRIGGER", table: `public.${String(t.relname)}`, constraint: String(t.tgname) });
    const sourceMap = new Map(sourceTables.map(t => [t.name, t]));
    const targetMap = new Map(targetTables.map(t => [t.name, t]));
    for (const name of policy.excludeTables ?? []) {
      if (name === LEDGER || (!sourceMap.has(name) && !targetMap.has(name))) report.blockers.push({ code: "INVALID_NAMED_EXCLUSION", table: name });
    }
    for (const name of policy.dropColumns ?? []) {
      if (!sourceTables.some(t => t.columns.some(c => `${t.name}.${c.name}` === name) && !targetMap.get(t.name)?.columns.some(c => `${t.name}.${c.name}` === name))) {
        report.blockers.push({ code: "INVALID_NAMED_DROP" });
      }
    }
    for (const [name, cast] of Object.entries(policy.casts ?? {})) {
      const sourceColumn = sourceTables.flatMap(t => t.columns.map(c => ({ key: `${t.name}.${c.name}`, type: c.type }))).find(c => c.key === name);
      const targetColumn = targetTables.flatMap(t => t.columns.map(c => ({ key: `${t.name}.${c.name}`, type: c.type }))).find(c => c.key === name);
      if (!sourceColumn || !targetColumn || sourceColumn.type === targetColumn.type || cast !== `${sourceColumn.type}->${targetColumn.type}`) {
        report.blockers.push({ code: "INVALID_NAMED_CAST" });
      }
    }
    for (const table of sourceTables) {
      if (!targetMap.has(table.name) && !policy.excludeTables?.includes(table.name)) report.blockers.push({ code: "SOURCE_ONLY_TABLE", table: table.name });
    }
    const seeds = new Map(admission.seeds?.tables.map(s => [s.table, s]) ?? []);
    if (admission.seeds && (seeds.size !== targetTables.length || targetTables.some(t => !seeds.has(t.name)))) {
      report.blockers.push({ code: "SEED_CONTRACT_TABLE_MISMATCH" });
    }
    const existingCounts = new Map<string, number>();
    for (const table of targetTables) {
      const seed = seeds.get(table.name);
      const rows = await stableRows(target, table.name, seed?.columns ?? table.columns.map(c => c.name));
      existingCounts.set(table.name, rows.length);
      if (seed ? rows.length !== seed.count || hashRows(rows) !== seed.hash : rows.length !== 0) {
        report.blockers.push({ code: "TARGET_NOT_PRISTINE", table: table.name, count: rows.length });
      }
    }
    const plans = [];
    for (const table of targetTables) {
      if (policy.excludeTables?.includes(table.name)) continue;
      const other = sourceMap.get(table.name);
      if (!other) { report.blockers.push({ code: "SOURCE_TABLE_MISSING", table: table.name }); continue; }
      const plan = planMapping(other, table, policy);
      plans.push({ table, plan });
      report.blockers.push(...plan.blockers);
    }
    // Even a mapping refusal produces a complete, content-free table census.
    // These are diagnostic JSONB projection hashes, not a claim of a successful
    // raw-json transfer; raw json columns are blocked explicitly by the mapper.
    for (const name of [...new Set([...sourceMap.keys(), ...targetMap.keys()])].sort()) {
      const sourceTable = sourceMap.get(name);
      const targetTable = targetMap.get(name);
      const columns = sourceTable && targetTable
        ? targetTable.columns.map(c => c.name).filter(c => sourceTable.columns.some(s => s.name === c))
        : (sourceTable ?? targetTable)!.columns.map(c => c.name);
      const preferredKey = targetTable?.primaryKey ?? sourceTable?.primaryKey ?? [];
      const order = preferredKey.every(c => columns.includes(c)) ? preferredKey : [];
      const sourceRows = sourceTable ? await stableRows(source, name, columns, order) : [];
      const targetRows = targetTable ? await stableRows(target, name, columns, order) : [];
      report.tables.push({ table: name, sourceCount: sourceRows.length, targetCount: targetRows.length,
        sourceHash: hashRows(sourceRows), targetHash: hashRows(targetRows), hashColumns: columns,
        ordering: order.length ? "primary-key" : "row-multiset",
        recomputedColumns: targetTable?.columns.filter(c => c.generated).map(c => c.name) ?? [],
        outcome: policy.excludeTables?.includes(name) ? "excluded" : "not-loaded" });
    }
    const recordTable = (result: TableResult): void => {
      const index = report.tables.findIndex(t => t.table === result.table);
      if (index < 0) report.tables.push(result);
      else report.tables[index] = { ...report.tables[index], ...result };
    };
    // Exclusion and unsupported constraints are fail-closed before any data mutation.
    report.blockers.push(...await verifyConstraints(target, targetTables));
    if (report.blockers.length) return report;
    // Replica mode suppresses ordinary user triggers AND FK triggers. ALWAYS/REPLICA triggers were refused.
    await target.query("SET LOCAL session_replication_role = replica");
    for (const { table, plan } of plans) {
      const rows = await stableRows(source, table.name, plan.shared, table.primaryKey);
      const sourceHash = hashRows(rows);
      const existing = existingCounts.get(table.name) ?? 0;
      if (existing) {
        const targetRows = await stableRows(target, table.name, plan.shared, table.primaryKey);
        const targetHash = hashRows(targetRows);
        recordTable({ table: table.name, sourceCount: rows.length, targetCount: targetRows.length, sourceHash, targetHash,
          outcome: targetRows.length === rows.length && targetHash === sourceHash ? "verified" : "not-loaded" });
        // Seed divergence needs an owner decision. No DELETE, upsert, overwrite or implicit reconciliation.
        if (targetRows.length !== rows.length || targetHash !== sourceHash) {
          report.blockers.push({ code: "SEED_RECONCILIATION_REQUIRED", table: table.name, count: rows.length });
        }
        continue;
      }
      const columns = plan.shared.filter(c => !plan.generated.includes(c)).map(identifier).join(",");
      for (const row of rows) {
        try {
          if (columns) {
            await target.query(`INSERT INTO ${relation(table.name)} (${columns}) OVERRIDING SYSTEM VALUE
              SELECT ${columns} FROM jsonb_populate_record(NULL::${relation(table.name)},$1::jsonb)`, [row]);
          } else {
            await target.query(`INSERT INTO ${relation(table.name)} DEFAULT VALUES`);
          }
        } catch (error) {
          const pgError = error as { code?: string; constraint?: string; column?: string };
          if (["23502", "23505", "23514", "23P01"].includes(pgError.code ?? "")) {
            // These constraints remain enforced even in replica mode. Count is the one
            // rejected row actually observed, not a claim to have scanned later rows.
            report.blockers.push({ code: "ENFORCED_CONSTRAINT_REJECTED_ROW", table: table.name,
              ...(pgError.constraint ? { constraint: pgError.constraint } : {}),
              ...(pgError.column ? { column: pgError.column } : {}), count: 1 });
            return report;
          }
          throw error;
        }
      }
      const targetRows = await stableRows(target, table.name, plan.shared, table.primaryKey);
      const targetHash = hashRows(targetRows);
      recordTable({ table: table.name, sourceCount: rows.length, targetCount: targetRows.length, sourceHash, targetHash, outcome: "verified" });
      if (rows.length !== targetRows.length || sourceHash !== targetHash) report.blockers.push({ code: "CONTENT_MISMATCH", table: table.name });
    }
    report.blockers.push(...await verifyConstraints(target, targetTables));
    if (report.blockers.length) return report;
    // PostgreSQL ALTER SEQUENCE RESTART is transactional, unlike setval().
    for (const { table } of plans) {
      for (const column of table.columns) {
        const sequence = await target.query("SELECT pg_get_serial_sequence($1,$2) AS name", [table.name, column.name]);
        if (!sequence.rows[0]?.name) continue;
        const seqName = String(sequence.rows[0].name).replaceAll('"', "");
        const params = await target.query("SELECT seqincrement::text AS increment,seqmin::text AS minimum,seqmax::text AS maximum FROM pg_sequence WHERE seqrelid=$1::regclass", [seqName]);
        const p = params.rows[0];
        if (!p || BigInt(String(p.increment)) <= 0n) throw new TransferError("UNSUPPORTED_SEQUENCE");
        const maximum = await target.query(`SELECT max(${identifier(column.name)})::text AS maximum FROM ${relation(table.name)}`);
        const next = maximum.rows[0]?.maximum == null ? BigInt(String(p.minimum)) : BigInt(String(maximum.rows[0].maximum)) + BigInt(String(p.increment));
        if (next > BigInt(String(p.maximum))) throw new TransferError("SEQUENCE_EXHAUSTED");
        await target.query(`ALTER SEQUENCE ${relation(seqName.startsWith("public.") ? seqName : `public.${seqName}`)} RESTART WITH ${next}`);
      }
    }
    await target.query("SET LOCAL session_replication_role = origin");
    const after = await admission.fingerprint(target);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new TransferError("SCHEMA_CHANGED");
    await target.query("COMMIT");
    targetOpen = false;
    committed = true;
    await admission.readiness(target);
    await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    targetOpen = true;
    await pinMigrationFingerprintEnvironment(target);
    const postCommit = await admission.fingerprint(target);
    if (JSON.stringify(before) !== JSON.stringify(postCommit)) throw new TransferError("POSTCOMMIT_SCHEMA_CHANGED");
    await target.query("ROLLBACK"); targetOpen = false;
    report.status = "committed"; report.fingerprints = postCommit;
    for (const table of report.tables) if (table.outcome === "verified") table.outcome = "committed";
    return report;
  } catch (error) {
    if (error instanceof TransferError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/^Target identity (?:mismatch|indeterminate): [a-zA-Z.]+$/u.test(message)) throw new TransferError(message);
    throw new TransferError(committed ? "POSTCOMMIT_VERIFICATION_FAILED" : "TRANSFER_FAILED");
  } finally {
    if (targetOpen) await target.query("ROLLBACK").catch(() => { throw new TransferError("TARGET_ROLLBACK_FAILED"); });
    if (sourceOpen) await source.query("ROLLBACK").catch(() => { throw new TransferError("SOURCE_ROLLBACK_FAILED"); });
  }
}