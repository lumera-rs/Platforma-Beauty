/**
 * Task #11A: production-like API boot regression for the #11-F1 fix.
 *
 * The original impact was API *boot* failure: artifacts/api-server/src/
 * index.ts -- the real production entrypoint -- awaits
 * ensureBusinessGrowthSchema() before app.listen(), so a database in the
 * broken state (rollout tracker already current, education_salon_
 * cleanup_reports missing) crashed the whole process before it ever
 * started serving traffic. Proving the helper function alone no longer
 * throws (business-growth-schema-cleanup-reports.test.ts) is not the same
 * claim as proving the real production boot path recovers -- this file
 * spawns index.ts itself (not test-server.ts, which never calls any
 * ensure*Schema() function and so cannot exercise this path at all)
 * against a disposable database deliberately left in the exact broken
 * state, and proves the process reaches a healthy, listening state.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/business-growth-schema-boot-regression.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BUSINESS_GROWTH_SCHEMA_VERSION } from "./business-growth-schema";

const execFileAsync = promisify(execFile);
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(thisDir, "..", "..", "..", "..");
const tsxBin = path.resolve(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");
const indexEntrypoint = path.resolve(workspaceRoot, "artifacts", "api-server", "src", "index.ts");

const baseDatabaseUrl = process.env.DATABASE_URL;
assert.ok(baseDatabaseUrl, "DATABASE_URL is required to provision the disposable regression database.");

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === "string") throw new Error("Could not reserve a local TCP port.");
  return address.port;
}

async function waitForHealthz(apiBaseUrl: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/healthz`);
      if (response.ok) return;
      lastError = new Error(`received ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API server did not become ready within ${deadlineMs}ms${lastError ? ` (${lastError instanceof Error ? lastError.message : String(lastError)})` : ""}.`);
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

void test("real production boot path (index.ts) recovers from the broken current-version/missing-table state", async () => {
  const databaseName = `lumera_boot_regression_${process.pid}_${randomUUID().replaceAll("-", "")}`.slice(0, 63);
  const databaseUrl = (() => {
    const url = new URL(baseDatabaseUrl!);
    url.pathname = `/${databaseName}`;
    return url.toString();
  })();
  await execFileAsync("createdb", ["--maintenance-db", baseDatabaseUrl!, databaseName]);
  let databaseExists = true;
  let child: ChildProcess | undefined;
  try {
    await execFileAsync(
      "pnpm", ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: { ...process.env, DATABASE_URL: databaseUrl } },
    );

    // Deliberately construct the broken state directly via psql -- never
    // via ensureBusinessGrowthSchema() itself, so this test does not
    // accidentally depend on the very function under test to set itself up.
    await execFileAsync("psql", [databaseUrl, "-c",
      `INSERT INTO business_growth_schema_rollout (singleton, version, completed_at)
       VALUES (true, ${BUSINESS_GROWTH_SCHEMA_VERSION}, now())
       ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, completed_at = EXCLUDED.completed_at`]);
    const { stdout: beforeExists } = await execFileAsync("psql", [databaseUrl, "-At", "-c",
      "SELECT to_regclass('public.education_salon_cleanup_reports') IS NOT NULL"]);
    assert.equal(beforeExists.trim(), "f", "test precondition: cleanup-reports table must not exist before boot");

    const port = await findAvailablePort();
    const apiBaseUrl = `http://127.0.0.1:${port}`;
    child = spawn(tsxBin, [indexEntrypoint], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(port),
        NODE_ENV: "test",
        SESSION_SECRET: process.env.SESSION_SECRET ?? "lumera-boot-regression-test-secret",
        AI_INTEGRATIONS_ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
        AI_INTEGRATIONS_ANTHROPIC_API_KEY: "unused-in-this-regression-test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const startupError = new Promise<never>((_, reject) => {
      child!.once("error", (error) => reject(new Error(`API process could not start: ${error.message}`)));
      child!.once("exit", (code, signal) => {
        if (code !== 0 || signal) {
          reject(new Error(`API process exited early during boot (code=${code ?? "null"}, signal=${signal ?? "null"}).\nstderr:\n${stderr}`));
        }
      });
    });

    // The real production boot path runs eight sequential ensure*Schema()
    // rollouts plus scheduler/worker setup before listen() -- allow more
    // headroom than the plain-helper tests.
    await Promise.race([waitForHealthz(apiBaseUrl, 45_000), startupError]);

    const { stdout: afterExists } = await execFileAsync("psql", [databaseUrl, "-At", "-c",
      "SELECT to_regclass('public.education_salon_cleanup_reports') IS NOT NULL"]);
    assert.equal(afterExists.trim(), "t", "cleanup-reports table must exist after a real boot from the broken state");

    const { stdout: versionAfter } = await execFileAsync("psql", [databaseUrl, "-At", "-c",
      "SELECT version FROM business_growth_schema_rollout WHERE singleton = true"]);
    assert.equal(Number(versionAfter.trim()), BUSINESS_GROWTH_SCHEMA_VERSION);
  } finally {
    await stopProcess(child);
    if (databaseExists) {
      databaseExists = false;
      await execFileAsync("dropdb", ["--force", "--if-exists", "--maintenance-db", baseDatabaseUrl!, databaseName]);
    }
  }
});
