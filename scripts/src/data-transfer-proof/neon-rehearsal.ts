import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { inspectDatabaseMigrationReady, pinMigrationFingerprintEnvironment, readPostgresSnapshot, fingerprintSnapshot, ownershipExceptions, readPostgresFingerprintCompatibility } from "@workspace/db/migration-runtime";
import { assertTargetIdentity, type ExpectedTargetIdentity } from "../migrations/target-identity";
import { main as migrationCli } from "../migrations/cli";
import { transferData, TransferError } from "../data-transfer/engine";
import { identifier, relation, readTransferCatalog } from "../data-transfer/catalog";
import { stableRows, hashRows } from "../data-transfer/seed-contract";
import { withOwnedPair } from "./owned-pair";

assertDestructiveTestRuntimeAllowed(process.env, "Authorized Neon test rehearsal");

// Pinned prior authorized test record, NOT inferred from this connection.
// docs/neon-target-identity/follow-up-verification.md:202.
const expected: ExpectedTargetIdentity = {
  databaseName: "neondb", systemIdentifier: "7688718332222926027", transport: "unencrypted",
  neon: { projectId: "patient-band-58516090", branchId: "br-odd-sound-b1os4cyc" },
};

async function evidence(client: pg.Client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await pinMigrationFingerprintEnvironment(client);
    const fp = fingerprintSnapshot(await readPostgresSnapshot(client), ownershipExceptions, await readPostgresFingerprintCompatibility(client));
    const tables = [];
    for (const table of await readTransferCatalog(client)) {
      const rows = await stableRows(client, table.name, table.columns.map(c => c.name), table.primaryKey);
      tables.push({ table: table.name, count: rows.length, hash: hashRows(rows) });
    }
    const triggers = await client.query("SELECT c.relname,t.tgname,t.tgenabled FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname");
    const ledger = await stableRows(client, "public.lumera_migration_ledger",
      ["migration_id", "checksum", "mode", "state", "error", "started_at", "finished_at", "database_name", "system_identifier", "neon_project_id", "neon_branch_id"], ["migration_id"]);
    return { tables, structural: fp.structuralFingerprint, physical: fp.physicalFingerprint,
      triggerHash: hashRows(triggers.rows.map(r => JSON.stringify(r))), ledgerHash: hashRows(ledger) };
  } finally { await client.query("ROLLBACK"); }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args[0] === "--authorized-branch2-rehearsal"
    && (args.length === 1 || (args.length === 2 && args[1] === "--already-bound")),
  "Explicit branch2 rehearsal authorization required");
  const url = process.env.LUMERA_NEON_TEST_BRANCH2_URL;
  if (!url) throw new Error("AUTHORIZED_TEST_SECRET_MISSING");
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname.endsWith(".neon.tech") || parsed.hostname.includes("-pooler")) throw new Error("AUTHORIZED_TEST_DIRECT_URL_REQUIRED");
  const target = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 1800000 });
  await target.connect();
  try {
    await assertTargetIdentity(target, expected);
    console.log("NEON_DECLARATION verified=1 prior_record=1 control_plane_proof=0");
    if ((await inspectDatabaseMigrationReady(target)).ready) {
      console.log("NEON_BIND already_bound_ready=true binding_skipped=true");
    } else {
      assert.ok(!args.includes("--already-bound"), "Already-bound rehearsal refuses binding or repair");
      await migrationCli(["bind-ledger-identity", "--confirm", `--database-url=${url}`,
        "--expected-database=neondb", "--expected-system-identifier=7688718332222926027",
        "--expected-transport=unencrypted", "--expected-neon-project-id=patient-band-58516090",
        "--expected-neon-branch-id=br-odd-sound-b1os4cyc"]);
    }
    assert.equal((await inspectDatabaseMigrationReady(target)).ready, true);
    const before = await evidence(target);
    await withOwnedPair(async pair => {
      await pair.buildCanonical(pair.source);
      const source = await pair.source.connect();
      try {
        // Replica is used only to construct an owned superuser fixture, never on Neon.
        await source.query("BEGIN");
        await source.query("SET LOCAL session_replication_role=replica");
        await pinMigrationFingerprintEnvironment(source);
        await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
          await pinMigrationFingerprintEnvironment(target);
          for (const table of await readTransferCatalog(target)) {
            const columns = table.columns.filter(c => !c.generated).map(c => c.name);
            const rows = await stableRows(target, table.name, columns, table.primaryKey);
            await source.query(`DELETE FROM ${relation(table.name)}`);
            const projection = columns.map(identifier).join(",");
            for (const row of rows) await source.query(`INSERT INTO ${relation(table.name)} (${projection}) OVERRIDING SYSTEM VALUE SELECT ${projection} FROM jsonb_populate_record(NULL::${relation(table.name)},$1::jsonb)`, [row]);
          }
        } finally { await target.query("ROLLBACK"); }
        await source.query("INSERT INTO public.service_categories (name,slug,description) VALUES ('Disposable rehearsal fixture','disposable-neon-rehearsal','Synthetic fixture only')");
        await source.query("COMMIT");
        const report = await transferData(source, target, { expectedTargetIdentity: expected, rehearsal: true });
        console.log(`NEON_REHEARSAL status=${report.status} tables=${report.tables.length} blockers=${report.blockers.length} vacuum_recommended=${report.vacuumRecommended}`);
        for (const blocker of report.blockers) console.log(`BLOCKER ${JSON.stringify(blocker)}`);
        assert.equal(report.status, "rehearsed", "Neon rehearsal must complete full verification before rollback");
        assert.ok(report.tables.every(t => t.sourceCount === t.targetCount && t.sourceHash === t.targetHash));
        const after = await evidence(target);
        assert.deepEqual(after, before, "Neon rehearsal must preserve target data, ledger, triggers and fingerprints");
        assert.equal((await inspectDatabaseMigrationReady(target)).ready, true);
        const output = path.resolve("../.local/data-transfer-fix");
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, "neon-rehearsal.json"), `${JSON.stringify({ report, before, after }, null, 2)}\n`);
        console.log("NEON_AFTER readiness=true data_unchanged=true ledger_unchanged=true triggers_unchanged=true structural_unchanged=true physical_unchanged=true");
      } finally { await source.query("ROLLBACK").catch(() => undefined); source.release(); }
    });
    console.log("OWNED_SOURCE_REMOVED");
  } finally { await target.end(); }
}
main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof TransferError ? error.code : "NEON_REHEARSAL_FAILED",
    sqlstate: typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : error instanceof TransferError ? error.sqlstate : null,
    step: error instanceof TransferError ? error.step : "proof", vacuumRecommended: true }));
  process.exitCode = 1;
});