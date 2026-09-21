/**
 * Regression proof for the removed startup repair path.
 *
 * The old test expected index.ts to repair a deliberately incomplete catalog.
 * The supported path now refuses that state before listen/reconciliation. This
 * keeps the real entrypoint in the proof while asserting that the disposable
 * fixture remains unchanged after refusal.
 *
 * Run with an explicit disposable administrator URL:
 * NODE_ENV=test pnpm --filter @workspace/api-server exec tsx \
 *   src/lib/business-growth-schema-boot-regression.test.ts \
 *   --admin-url=postgres://owner@127.0.0.1:39523/postgres
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import type { Pool } from "pg";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";

assertDestructiveTestRuntimeAllowed(process.env, "Business growth schema boot regression tests");
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(thisDir, "../../../../");
const apiEntrypoint = path.resolve(workspaceRoot, "artifacts/api-server/src/index.ts");
const tsxBin = path.resolve(workspaceRoot, "scripts/node_modules/.bin/tsx");
const fixtures = await import(pathToFileURL(
  path.resolve(workspaceRoot, "scripts/src/startup-equivalence/fixtures.ts"),
).href);
const migrationRunner = await import(pathToFileURL(
  path.resolve(workspaceRoot, "scripts/src/migrations/runner.ts"),
).href);
const migrationFiles = await import(pathToFileURL(
  path.resolve(workspaceRoot, "scripts/src/migrations/files.ts"),
).href);
const adminUrl = fixtures.explicitAdminUrlFromArgs();

function requireAdminUrl(): string {
  assert.ok(adminUrl, "An explicit --admin-url is required for this disposable regression.");
  return adminUrl;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  assert.ok(port > 0);
  return port;
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    sleep(5_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function expectReadonlyRefusal(
  databaseUrl: string,
): Promise<{ stderr: string; reachedHealth: boolean }> {
  const port = await availablePort();
  const stderr: string[] = [];
  const child = spawn(tsxBin, [apiEntrypoint], {
    cwd: workspaceRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      BASE_PATH: "/api",
      SESSION_SECRET: "lumera-disposable-regression-session-secret",
      DOTENV_CONFIG_PATH: path.join("/tmp", `lumera-no-dotenv-${randomUUID()}`),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
  let reachedHealth = false;
  try {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
        reachedHealth = response.ok;
        if (reachedHealth) break;
      } catch {
        // Readiness refusal is expected before listen.
      }
      await sleep(250);
    }
    assert.equal(reachedHealth, false, "Broken catalog unexpectedly reached API health.");
    return { stderr: stderr.join(""), reachedHealth };
  } finally {
    await stopChild(child);
  }
}

type QueryPool = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

async function fixtureState(pool: QueryPool): Promise<{
  cleanupReports: string | null;
  coverColumns: number;
  ledger: unknown[];
}> {
  const cleanupReports = await pool.query("SELECT to_regclass('public.education_salon_cleanup_reports') AS name");
  const coverColumns = await pool.query(`
    SELECT count(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name='cover_image_description'
      AND table_name IN ('salons','products','courses','beauty_job_listings')
  `);
  const ledger = await pool.query(`
    SELECT migration_id, checksum, mode, state, error, started_at, finished_at
    FROM public.lumera_migration_ledger ORDER BY migration_id
  `);
  return {
    cleanupReports: cleanupReports.rows[0]?.name ?? null,
    coverColumns: coverColumns.rows[0]?.count ?? 0,
    ledger: ledger.rows,
  };
}

test("actual entrypoint refuses the old business-growth broken state without repair", async () => {
  await fixtures.withOwnedDisposableDatabase(requireAdminUrl(), async ({
    pool,
    connectionString,
    expectedTargetIdentity,
  }: {
    pool: Pool;
    connectionString: string;
    expectedTargetIdentity: { databaseName: string; systemIdentifier: string; transport: "encrypted" | "unencrypted" };
  }) => {
    const migrations = await migrationFiles.loadMigrations();
    const client = await pool.connect();
    try {
      await migrationRunner.applyMigrations(client, { migrations, expectedTargetIdentity });
    } finally {
      client.release();
    }
    await pool.query(`
      ALTER TABLE public.salons DROP COLUMN IF EXISTS cover_image_description;
      ALTER TABLE public.products DROP COLUMN IF EXISTS cover_image_description;
      ALTER TABLE public.courses DROP COLUMN IF EXISTS cover_image_description;
      ALTER TABLE public.beauty_job_listings DROP COLUMN IF EXISTS cover_image_description;
      DROP TABLE IF EXISTS public.education_salon_cleanup_reports;
    `);
    const before = await fixtureState(pool);
    assert.equal(before.cleanupReports, null);
    assert.equal(before.coverColumns, 0);

    const refusal = await expectReadonlyRefusal(connectionString);
    assert.match(refusal.stderr, /migration|catalog|unsupported|readiness/i);
    assert.deepEqual(await fixtureState(pool), before, "Readonly refusal mutated the broken fixture.");
  });
});