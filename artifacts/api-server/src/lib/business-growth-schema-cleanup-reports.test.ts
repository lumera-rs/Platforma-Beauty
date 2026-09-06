/**
 * Task #11A: regression coverage for the production boot crash confirmed
 * in Task #11 (#11-F1).
 *
 * Root cause: runBusinessGrowthSchemaDdl()'s "fast path" (taken whenever
 * business_growth_schema_rollout.version already reads as current) applies
 * only a small set of additive contract repairs and returns early -- it
 * never ran the historical DDL array that used to be the only place
 * education_salon_cleanup_reports got created. ensureBusinessGrowthSchema()
 * then unconditionally SELECTs from that table regardless of which path was
 * taken. A database whose rollout tracker reads "current" without having
 * actually executed that historical array -- reproduced against this
 * project's own shared dev database, where business_growth_schema_rollout
 * (ALSO declared in the static Drizzle schema, so `drizzle-kit push`
 * creates it empty) had its version column populated to the current value
 * without ever running the real rollout -- permanently lacked the table
 * and crashed every subsequent call, including the one
 * artifacts/api-server/src/index.ts awaits before listen().
 *
 * Fix (business-growth-schema.ts): an unconditional
 * `CREATE TABLE IF NOT EXISTS education_salon_cleanup_reports` now runs
 * before the fast-path/slow-path branch decision, under the same advisory
 * lock, on every call -- so the table's SHAPE is guaranteed regardless of
 * rollout history, while the historical v99 cleanup DATA migration (the DO
 * block that actually populates a row) stays exactly as version-gated as
 * before and still runs at most once.
 *
 * ensureBusinessGrowthSchema() always operates against whatever database
 * @workspace/db's shared pool was bound to at process start, so each
 * scenario below runs business-growth-schema-ensure-child.ts as a genuinely
 * separate child process against a disposable database this test
 * provisions and fully controls -- never the ambient shared DATABASE_URL,
 * and never relying on `drizzle-kit push` to have incidentally already
 * created the cleanup-reports table.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/business-growth-schema-cleanup-reports.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BUSINESS_GROWTH_SCHEMA_VERSION } from "./business-growth-schema";

const execFileAsync = promisify(execFile);
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(thisDir, "..", "..", "..", "..");
const tsxBin = path.resolve(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");
const childScript = path.resolve(thisDir, "business-growth-schema-ensure-child.ts");

const baseDatabaseUrl = process.env.DATABASE_URL;
assert.ok(baseDatabaseUrl, "DATABASE_URL is required to provision disposable regression databases.");

type DisposableDatabase = { databaseUrl: string; query: (sql: string) => Promise<string[]>; cleanup: () => Promise<void> };

/**
 * `pg` is only a direct dependency of @workspace/db, not resolvable from
 * this package under pnpm's strict linking -- psql (already required by
 * every other self-contained disposable-database test in this file's
 * neighborhood, e.g. production-demo-seed.test.ts) is used for this test's
 * own verification/setup queries instead of a direct pg.Pool.
 */
async function psqlQuery(databaseUrl: string, sql: string): Promise<string[]> {
  const { stdout } = await execFileAsync("psql", [databaseUrl, "-At", "-F", "\t", "-c", sql]);
  return stdout.split("\n").filter((line) => line.trim().length > 0);
}

/** A brand-new, disposable, freshly `drizzle-kit push`-schema'd database this test fully controls. */
async function provisionDisposableDatabase(label: string): Promise<DisposableDatabase> {
  const databaseName = `lumera_growth_schema_${label}_${process.pid}_${randomUUID().replaceAll("-", "")}`.slice(0, 63);
  const databaseUrl = (() => {
    const url = new URL(baseDatabaseUrl!);
    url.pathname = `/${databaseName}`;
    return url.toString();
  })();
  await execFileAsync("createdb", ["--maintenance-db", baseDatabaseUrl!, databaseName]);
  let exists = true;
  try {
    // `drizzle-kit push` is the only schema step here -- deliberately never
    // calling ensureBusinessGrowthSchema() in between, so the rollout row
    // state each scenario needs is exactly what that scenario constructs
    // itself, not an accident of push order.
    await execFileAsync(
      "pnpm", ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
  } catch (error) {
    exists = false;
    await execFileAsync("dropdb", ["--force", "--if-exists", "--maintenance-db", baseDatabaseUrl!, databaseName]).catch(() => {});
    throw error;
  }
  return {
    databaseUrl,
    query: (sql: string) => psqlQuery(databaseUrl, sql),
    cleanup: async () => {
      if (exists) await execFileAsync("dropdb", ["--force", "--if-exists", "--maintenance-db", baseDatabaseUrl!, databaseName]);
    },
  };
}

async function tableExists(db: DisposableDatabase, table: string): Promise<boolean> {
  const rows = await db.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS exists`);
  return rows[0] === "t";
}

async function rolloutVersion(db: DisposableDatabase): Promise<number | null> {
  if (!(await tableExists(db, "business_growth_schema_rollout"))) return null;
  const rows = await db.query("SELECT version FROM business_growth_schema_rollout WHERE singleton = true");
  return rows[0] === undefined ? null : Number(rows[0]);
}

/** Runs business-growth-schema-ensure-child.ts as a real, separate process against `databaseUrl`. */
function runEnsureChild(databaseUrl: string, scenario?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [childScript], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        ...(scenario ? { LUMERA_TEST_SCHEMA_SCENARIO: scenario } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

void test("broken state: rollout already current, cleanup-reports table missing -> repaired without throwing", async () => {
  const db = await provisionDisposableDatabase("broken");
  try {
    // Sanity-check the precondition this scenario relies on: drizzle-kit
    // push alone must not have created the cleanup-reports table (it isn't
    // in the static Drizzle schema, only this raw-SQL module knows about
    // it), so forcing the rollout version below genuinely reproduces the
    // broken state rather than a no-op.
    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), false,
      "test precondition: cleanup-reports table must not already exist from drizzle-kit push");

    const result = await runEnsureChild(db.databaseUrl, "broken-current-version");
    assert.equal(result.code, 0, `child process must exit 0, not throw against the broken-but-recoverable state. stderr: ${result.stderr}`);
    assert.match(result.stdout, /CHILD_OK/);

    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), true,
      "education_salon_cleanup_reports must exist after ensureBusinessGrowthSchema() repairs the broken state");
    const rows = await db.query("SELECT count(*) FROM education_salon_cleanup_reports");
    assert.equal(rows[0], "0", "the repaired table is correctly empty -- the one-time v99 DATA migration must not be replayed on an already-current database");
    assert.equal(await rolloutVersion(db), BUSINESS_GROWTH_SCHEMA_VERSION);
  } finally {
    await db.cleanup();
  }
});

void test("fresh database: no rollout row, no cleanup-reports table -> normal full rollout creates both", async () => {
  const db = await provisionDisposableDatabase("fresh");
  try {
    assert.equal(await rolloutVersion(db), null, "test precondition: no rollout row yet on a fresh database");
    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), false);

    const result = await runEnsureChild(db.databaseUrl);
    assert.equal(result.code, 0, `fresh-database rollout must succeed. stderr: ${result.stderr}`);

    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), true);
    assert.equal(await rolloutVersion(db), BUSINESS_GROWTH_SCHEMA_VERSION);
  } finally {
    await db.cleanup();
  }
});

void test("already healthy database: rollout current, table already exists -> repeat call is idempotent", async () => {
  const db = await provisionDisposableDatabase("healthy");
  try {
    // First bring the database to the normal, fully-migrated steady state.
    const first = await runEnsureChild(db.databaseUrl);
    assert.equal(first.code, 0, `first rollout must succeed. stderr: ${first.stderr}`);
    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), true);
    const beforeRowCount = (await db.query("SELECT count(*) FROM education_salon_cleanup_reports"))[0];

    // Now call it again -- twice in the same child process, via the
    // "healthy-repeat" scenario -- to prove the steady state is idempotent:
    // no duplicate-primary-key error, no destructive change, no row churn.
    const repeat = await runEnsureChild(db.databaseUrl, "healthy-repeat");
    assert.equal(repeat.code, 0, `repeat calls against an already-healthy database must not throw. stderr: ${repeat.stderr}`);
    assert.match(repeat.stdout, /CHILD_OK/);

    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), true);
    assert.equal(await rolloutVersion(db), BUSINESS_GROWTH_SCHEMA_VERSION);
    const afterRowCount = (await db.query("SELECT count(*) FROM education_salon_cleanup_reports"))[0];
    assert.equal(afterRowCount, beforeRowCount, "repeat calls must not insert/duplicate cleanup-report rows");
  } finally {
    await db.cleanup();
  }
});

void test("concurrent callers against the same broken-state database both succeed, table exists exactly once", async () => {
  const db = await provisionDisposableDatabase("concurrent");
  try {
    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), false);

    // Force the broken state directly (not via the child, so both children
    // race against the identical already-broken starting state rather than
    // one of them constructing it).
    await db.query(
      `INSERT INTO business_growth_schema_rollout (singleton, version, completed_at)
       VALUES (true, ${BUSINESS_GROWTH_SCHEMA_VERSION}, now())
       ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, completed_at = EXCLUDED.completed_at`,
    );

    const [a, b] = await Promise.all([
      runEnsureChild(db.databaseUrl),
      runEnsureChild(db.databaseUrl),
    ]);
    assert.equal(a.code, 0, `concurrent caller A must succeed (the existing advisory lock must serialize, not corrupt). stderr: ${a.stderr}`);
    assert.equal(b.code, 0, `concurrent caller B must succeed. stderr: ${b.stderr}`);

    assert.equal(await tableExists(db, "education_salon_cleanup_reports"), true);
    assert.equal(await rolloutVersion(db), BUSINESS_GROWTH_SCHEMA_VERSION,
      "the rollout version must remain exactly correct after two concurrent callers, not corrupted or double-applied");
  } finally {
    await db.cleanup();
  }
});
