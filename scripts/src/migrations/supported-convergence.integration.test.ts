import assert from "node:assert/strict";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import {
  explicitAdminUrlFromArgs,
  withOwnedDisposableDatabase,
} from "../startup-equivalence/fixtures";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "../schema-drift/catalog";
import { fingerprintSnapshot } from "../schema-drift/fingerprint";
import { beginFingerprintTransaction } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";
import { applyMigrations } from "./runner";
import { expectedDisposableTarget } from "./disposable-target-fixture";
import { loadMigrations } from "./files";
import type { LoadedMigration } from "./types";

assertDestructiveTestRuntimeAllowed(process.env, "Supported migration convergence integration tests");
const adminUrl = explicitAdminUrlFromArgs();
const skip = adminUrl
  ? undefined
  : "Pass --admin-url=postgres://<owner>@127.0.0.1:<non-5432-port>/<db>";
const REPORT_DIR = "/tmp/lumera-supported-results";
const REPORT_LOG = path.join(REPORT_DIR, "convergence.log");
const CANONICAL = {
  structural: "938c62183adabae9fdab00c5d968c39feb3f216e521b9031d1642575f5875cad",
  physical: "673f3810d49a4be6899482d44281607dac06d3e1012cd001e8348a45fdf5ea1f",
} as const;

if (process.env.DATABASE_URL) throw new Error("This isolated proof must not use ambient DATABASE_URL");
if (process.env.NODE_ENV !== "test") throw new Error("Run this proof with NODE_ENV=test");
for (const key of ["REPLIT_DEPLOYMENT", "REPLIT_DEPLOYMENT_ID", "REPL_DEPLOYMENT", "REPL_DEPLOYMENT_ID"]) {
  if (process.env[key]) throw new Error(`Deployment flag must be unset: ${key}`);
}

type Pool = pg.Pool;
type Client = pg.PoolClient;

async function log(message: string): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  await appendFile(REPORT_LOG, `${new Date().toISOString()} ${message}\n`);
}

async function withClient<T>(pool: Pool, callback: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function loadPlanMigrations(): Promise<LoadedMigration[]> {
  const migrations = await loadMigrations();
  return migrations;
}

async function applyBaseline(pool: Pool): Promise<void> {
  const migrations = await loadPlanMigrations();
  const baseline = migrations.filter((migration) => migration.id === "000001");
  assert.equal(baseline.length, 1);
  await withClient(pool, (client) => applyMigrations(client, { migrations: baseline }));
}

async function applySupported(pool: Pool): Promise<{ applied: string[]; skipped: string[] }> {
  const migrations = await loadPlanMigrations();
  return withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
}

async function fingerprint(pool: Pool): Promise<{
  structuralFingerprint: string;
  physicalFingerprint: string;
}> {
  return withClient(pool, async (client) => {
    await beginFingerprintTransaction(client);
    try {
      const snapshot = await readPostgresSnapshot(client);
      const compatibility = await readPostgresFingerprintCompatibility(client);
      const result = fingerprintSnapshot(snapshot, ownershipExceptions, compatibility);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

async function allRows(pool: Pool): Promise<Record<string, unknown[]>> {
  return withClient(pool, async (client) => {
    const tables = await client.query<{ schema_name: string; table_name: string }>(`
      SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
      ORDER BY n.nspname,c.relname`);
    const result: Record<string, unknown[]> = {};
    for (const table of tables.rows) {
      const relation = `"${table.schema_name.replaceAll("\"", "\"\"")}"."${table.table_name.replaceAll("\"", "\"\"")}"`;
      const rows = await client.query<{ row: unknown }>(
        `SELECT to_jsonb(t) AS row FROM ${relation} t ORDER BY to_jsonb(t)::text`,
      );
      result[`${table.schema_name}.${table.table_name}`] = rows.rows.map((row) => row.row);
    }
    return result;
  });
}

async function ledger(pool: Pool): Promise<unknown[]> {
  return withClient(pool, async (client) => {
    const relation = await client.query("SELECT to_regclass('public.lumera_migration_ledger') AS name");
    if (relation.rows[0]?.name == null) return [];
    return (await client.query(`
      SELECT migration_id,checksum,mode,state,error FROM public.lumera_migration_ledger ORDER BY migration_id
    `)).rows;
  });
}

async function fastFunctionDefinition(): Promise<string> {
  const summaryPath = fileURLToPath(new URL("../../../docs/startup-ddl-equivalence/evidence/summary.json", import.meta.url));
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
    startupRepeatDifference?: { catalogChanges?: { kind: string; identity: string; after?: { definition?: string } }[] };
  };
  const change = summary.startupRepeatDifference?.catalogChanges?.find((item) =>
    item.kind === "functions" && item.identity.includes("prevent_education_gift_voucher_snapshot_update"));
  const definition = change?.after?.definition;
  if (!definition) throw new Error("Fast-path function definition evidence is missing");
  return definition;
}

async function replaceWithFastFunction(pool: Pool): Promise<void> {
  const definition = await fastFunctionDefinition();
  await withClient(pool, (client) => client.query(definition));
}

async function replaceWithUnknownFunction(pool: Pool): Promise<void> {
  await withClient(pool, (client) => client.query(`
    CREATE OR REPLACE FUNCTION public.prevent_education_gift_voucher_snapshot_update()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NEW;
    END $$`));
}

async function assertCanonical(pool: Pool): Promise<void> {
  const value = await fingerprint(pool);
  assert.deepEqual(
    { structural: value.structuralFingerprint, physical: value.physicalFingerprint },
    CANONICAL,
  );
}

test("canonical baseline plus exact fast function converges and repeats", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await applyBaseline(pool);
    await replaceWithFastFunction(pool);
    const first = await applySupported(pool);
    assert.deepEqual(first.applied, ["000002"]);
    await assertCanonical(pool);
    const before = await allRows(pool);
    const beforeLedger = await ledger(pool);
    const repeated = await applySupported(pool);
    assert.deepEqual(repeated.applied, []);
    assert.deepEqual(await allRows(pool), before);
    assert.deepEqual(await ledger(pool), beforeLedger);
    await log("canonical-fast convergence PASS; repeat preserved all rows and canonical fingerprints");
  });
});

test("unknown function and extra public objects reject before ledger mutation", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await applyBaseline(pool);
    await replaceWithUnknownFunction(pool);
    const beforeRows = await allRows(pool);
    const beforeLedger = await ledger(pool);
    await assert.rejects(() => applySupported(pool), /SUPPORTED_STARTUP_SCHEMA_FINGERPRINT_UNSUPPORTED/u);
    assert.deepEqual(await allRows(pool), beforeRows);
    assert.deepEqual(await ledger(pool), beforeLedger);
    await log("unknown function rejection PASS; rows and ledger unchanged");
  });

  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await withClient(pool, (client) => client.query(`
      CREATE TYPE public.supported_convergence_extra_type AS ENUM ('extra');
      CREATE FUNCTION public.supported_convergence_extra_function() RETURNS integer
      LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$`));
    const beforeLedger = await ledger(pool);
    await assert.rejects(() => applySupported(pool), /existing schema without a migration ledger|partially initialized/u);
    assert.deepEqual(await ledger(pool), beforeLedger);
    await log("fresh extra public object rejection PASS; ledger was never created");
  });

  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await applyBaseline(pool);
    await withClient(pool, (client) => client.query(`
      CREATE FUNCTION public.supported_convergence_extra_function() RETURNS integer
      LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$`));
    const beforeRows = await allRows(pool);
    const beforeLedger = await ledger(pool);
    await assert.rejects(() => applySupported(pool), /SUPPORTED_STARTUP_SCHEMA_FINGERPRINT_UNSUPPORTED/u);
    assert.deepEqual(await allRows(pool), beforeRows);
    assert.deepEqual(await ledger(pool), beforeLedger);
    await log("canonical extra public object rejection PASS; rows and ledger unchanged");
  });
});

test("cleanup provenance rejects and zero report timestamp is preserved", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await applyBaseline(pool);
    await withClient(pool, (client) => client.query(`
      INSERT INTO public.education_salon_cleanup_reports
        (version,candidates,detached_users,deleted_salons,retired_salons,completed_at)
      VALUES (99,1,0,0,0,'2024-01-02T03:04:05Z')`));
    const beforeRows = await allRows(pool);
    const beforeLedger = await ledger(pool);
    await assert.rejects(() => applySupported(pool), /SUPPORTED_STARTUP_CLEANUP_PROVENANCE_UNSUPPORTED/u);
    assert.deepEqual(await allRows(pool), beforeRows);
    assert.deepEqual(await ledger(pool), beforeLedger);
    await log("nonzero cleanup provenance rejection PASS; rows and ledger unchanged");
  });

  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await applyBaseline(pool);
    await withClient(pool, (client) => client.query(`
      INSERT INTO public.education_salon_cleanup_reports
        (version,candidates,detached_users,deleted_salons,retired_salons,completed_at)
      VALUES (99,0,0,0,0,'2024-01-02T03:04:05Z')`));
    const first = await applySupported(pool);
    assert.deepEqual(first.applied, ["000002"]);
    const report = await withClient(pool, (client) => client.query(
      "SELECT candidates,detached_users,deleted_salons,retired_salons,completed_at FROM public.education_salon_cleanup_reports WHERE version=99",
    ));
    assert.equal(report.rows[0]?.completed_at.toISOString(), "2024-01-02T03:04:05.000Z");
    await assertCanonical(pool);
    await log("zero cleanup report PASS; timestamp preserved");
  });
});

test("production runtime guard rejects before querying a client", async () => {
  const migrations = await loadPlanMigrations();
  let queryCount = 0;
  const fakeClient = {
    query: async () => {
      queryCount += 1;
      throw new Error("fake client must not be queried");
    },
  };
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      () => applyMigrations(fakeClient, { migrations }),
      /development-only/u,
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
  assert.equal(queryCount, 0);
  await log("production guard PASS; fake client query count 0");
});