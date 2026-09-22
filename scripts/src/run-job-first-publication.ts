import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { isDeploymentRuntime } from "./migrations/development-runtime";
import { loadMigrations } from "./migrations/files";
import { applyMigrations } from "./migrations/runner";

// No ambient database URL is read. The entire HTTP suite owns this PG16
// cluster, declares its identity, and applies the full manifest via the runner.
if (isDeploymentRuntime(process.env)) throw new Error("Deployment runtime refused");
const dir = await mkdtemp(path.join(os.tmpdir(), "job-publication-http-"));
let started = false;
let pool: pg.Pool | undefined;
try {
  execFileSync("initdb", ["-D", dir, "--auth=trust", "--username=job_publication", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", dir, "-l", path.join(dir, "server.log"), "-o", `-h '' -k ${dir} -p 55441`, "-w", "start"], { stdio: "ignore" });
  started = true;
  pool = new pg.Pool({ host: dir, port: 55441, user: "job_publication", database: "postgres" });
  const client = await pool.connect();
  try {
    const version = Number((await client.query("SHOW server_version_num")).rows[0].server_version_num);
    if (Math.floor(version / 10000) !== 16) throw new Error("Job publication tests require PostgreSQL 16");
    const systemIdentifier = (await client.query("SELECT system_identifier::text FROM pg_catalog.pg_control_system()")).rows[0].system_identifier;
    const expectedTargetIdentity = { databaseName: "postgres", systemIdentifier, transport: "unencrypted" as const };
    console.log("DISPOSABLE_IDENTITY", JSON.stringify(expectedTargetIdentity));
    console.log("PG_VERSION", version);
    console.log("RUNNER", await applyMigrations(client, { migrations: await loadMigrations(), expectedTargetIdentity }));
  } finally {
    client.release();
  }
  await pool.end();
  pool = undefined;
  const databaseUrl = `postgresql://job_publication@localhost/postgres?host=${encodeURIComponent(dir)}&port=55441`;
  execFileSync("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", "../artifacts/api-server/src/lib/beauty-jobs-routes.test.ts"], {
    cwd: path.resolve(import.meta.dirname, "../.."), stdio: "inherit", timeout: 240000,
    env: { ...process.env, NODE_ENV: "test", SITE_INDEXABLE: "false", PUBLIC_SITE_URL: "", DATABASE_URL: databaseUrl, LUMERA_TEST_DATABASE_URL: databaseUrl },
  });
} finally {
  if (pool) await pool.end();
  if (started) execFileSync("pg_ctl", ["-D", dir, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(dir, { recursive: true, force: true });
}