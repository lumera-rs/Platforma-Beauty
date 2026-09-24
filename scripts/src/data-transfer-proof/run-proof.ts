import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { inspectDatabaseMigrationReady, pinMigrationFingerprintEnvironment, readPostgresSnapshot, fingerprintSnapshot, ownershipExceptions, readPostgresFingerprintCompatibility } from "@workspace/db/migration-runtime";
import { transferData, TransferError, type TransferReport } from "../data-transfer/engine";
import { identifier, readTransferCatalog, relation } from "../data-transfer/catalog";
import { hashRows, stableRows } from "../data-transfer/seed-contract";
import { withOwnedPair } from "./owned-pair";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mode = process.argv.includes("--success") ? "canonical-success" : "snapshot";
const q = identifier;

async function evidence(client: pg.PoolClient) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await pinMigrationFingerprintEnvironment(client);
    const fingerprint = fingerprintSnapshot(await readPostgresSnapshot(client), ownershipExceptions, await readPostgresFingerprintCompatibility(client));
    const tables = [];
    for (const table of await readTransferCatalog(client)) {
      const rows = await stableRows(client, table.name, table.columns.map(column => column.name), table.primaryKey);
      tables.push({ table: table.name, count: rows.length, hash: hashRows(rows) });
    }
    return { structural: fingerprint.structuralFingerprint, physical: fingerprint.physicalFingerprint, tables };
  } finally { await client.query("ROLLBACK"); }
}

await mkdir(path.join(root, ".local/data-transfer"), { recursive: true });
await withOwnedPair(async pair => {
  if (mode === "snapshot") {
    await pair.restoreSource(path.join(root, "recovery-backups/phase6-preserved-xJV2Dz/attempt-a775nT/development-full.dump"));
  } else {
    await pair.buildCanonical(pair.source);
    const source = await pair.source.connect();
    const target = await pair.target.connect();
    try {
      await source.query("BEGIN");
      await source.query("SET LOCAL session_replication_role=replica");
      await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await pinMigrationFingerprintEnvironment(source);
      await pinMigrationFingerprintEnvironment(target);
      for (const table of await readTransferCatalog(target)) {
        const columns = table.columns.map(column => column.name);
        const rows = await stableRows(target, table.name, columns, table.primaryKey);
        await source.query(`DELETE FROM ${relation(table.name)}`);
        for (const row of rows) {
          const projection = columns.map(q).join(",");
          await source.query(`INSERT INTO ${relation(table.name)} (${projection}) OVERRIDING SYSTEM VALUE SELECT ${projection} FROM jsonb_populate_record(NULL::${relation(table.name)},$1::jsonb)`, [row]);
        }
      }
      await source.query("INSERT INTO public.service_categories (name,slug,description) VALUES ('Disposable transfer proof','disposable-transfer-proof','Synthetic fixture only')");
      await source.query("COMMIT");
      await target.query("ROLLBACK");
    } finally { source.release(); target.release(); }
  }
  const source = await pair.source.connect();
  const target = await pair.target.connect();
  try {
    const before = await evidence(target);
    const sourceCounts = (await readTransferCatalog(source));
    const counts = new Map<string, number>();
    for (const table of sourceCounts) counts.set(table.name, Number((await source.query(`SELECT count(*)::text AS count FROM ${relation(table.name)}`)).rows[0].count));
    let report: TransferReport | undefined;
    let failure: string | null = null;
    try { report = await transferData(source, target, { expectedTargetIdentity: pair.expectedTargetIdentity }); }
    catch (error) {
      if (!(error instanceof TransferError)) throw error;
      failure = error.code;
    }
    const after = await evidence(target);
    assert.equal(after.structural, before.structural);
    assert.equal(after.physical, before.physical);
    const ready = await inspectDatabaseMigrationReady(target);
    assert.equal(ready.ready, true);
    if (mode === "snapshot" || report?.status !== "committed") assert.deepEqual(after.tables, before.tables);
    if (mode === "canonical-success") {
      assert.equal(failure, null, "canonical success proof must not throw");
      assert.equal(report?.status, "committed", "canonical success proof must commit");
      assert.equal(report?.tables.length, 256);
      assert.ok(report.tables.every(table => table.sourceCount === table.targetCount && table.sourceHash === table.targetHash));
      assert.equal(after.tables.find(table => table.table === "public.service_categories")?.count, 1);
    }
    const outcomes = before.tables.map(table => {
      const current = after.tables.find(entry => entry.table === table.table)!;
      return { table: table.table, sourceCount: counts.get(table.table) ?? null, beforeCount: table.count, afterCount: current.count,
        beforeHash: table.hash, afterHash: current.hash,
        outcome: report?.status === "committed" ? "committed_verified" : "unchanged_after_refusal",
        blockers: report?.blockers.filter(blocker => blocker.table === table.table) ?? [] };
    });
    const result = { mode, report, failure, outcomes, fingerprints: { before: { structural: before.structural, physical: before.physical }, after: { structural: after.structural, physical: after.physical } }, readiness: ready.ready };
    await writeFile(path.join(root, `.local/data-transfer/${mode}-proof.json`), `${JSON.stringify(result, null, 2)}\n`);
    for (const outcome of outcomes) console.log(`TABLE ${JSON.stringify(outcome)}`);
    for (const blocker of report?.blockers ?? []) console.log(`BLOCKER ${JSON.stringify(blocker)}`);
    if (failure) console.log(`TRANSFER_ERROR ${failure}`);
    console.log(`TRANSFER_RESULT mode=${mode} status=${report?.status ?? "failed"} tables=${outcomes.length} blockers=${report?.blockers.length ?? 0}`);
    console.log(`VERIFICATION readiness=${ready.ready} structural_unchanged=${before.structural === after.structural} physical_unchanged=${before.physical === after.physical} target_data_unchanged=${JSON.stringify(before.tables) === JSON.stringify(after.tables)}`);
  } finally { source.release(); target.release(); }
}, { builtCanonical: true });
console.log("OWNED_CLUSTER_REMOVED");