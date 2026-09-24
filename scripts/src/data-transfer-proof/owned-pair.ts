import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import pg from "pg";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { applyMigrations } from "../migrations/runner";
import { loadMigrations } from "../migrations/files";
import { registerDisposableTarget, expectedDisposableTarget } from "../migrations/disposable-target-fixture";
import type { ExpectedTargetIdentity } from "../migrations/target-identity";

assertDestructiveTestRuntimeAllowed(process.env, "Data transfer owned PostgreSQL pair");

export type OwnedPair = {
  source: pg.Pool;
  target: pg.Pool;
  sourceUrl: string;
  targetUrl: string;
  expectedTargetIdentity: ExpectedTargetIdentity;
  buildCanonical: (pool?: pg.Pool) => Promise<void>;
  restoreSource: (dump: string) => Promise<void>;
};

/** No ambient database parameters, credentials, deployment markers, or provider secrets. */
export function isolatedEnvironment(): NodeJS.ProcessEnv {
  return { HOME: os.homedir(), PATH: process.env.PATH, CI: "true", NODE_ENV: "test" };
}

async function command(program: string, args: string[], log: string): Promise<void> {
  const output: Buffer[] = [];
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(program, args, { env: isolatedEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => output.push(chunk));
    child.once("error", reject);
    child.once("close", resolve);
  });
  await writeFile(log, Buffer.concat(output));
  if (code !== 0) throw new Error(`Owned disposable command failed: ${program} (exit ${code}); inspect private local log`);
}

async function port(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Owned disposable port allocation failed");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (address.port === 5432) return port();
  return address.port;
}

/** Every call creates and destroys its own PG16 cluster; never accepts an administrator URL. */
export async function withOwnedPair<T>(
  callback: (pair: OwnedPair) => Promise<T>,
  options: { builtCanonical?: boolean } = {},
): Promise<T> {
  // Check the caller's real runtime BEFORE the child environment is sanitized.
  // Sanitization must not turn a deployment runtime into an authorized test runtime.
  assertDestructiveTestRuntimeAllowed(process.env, "Data transfer owned PostgreSQL pair");
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-data-transfer-owned-"));
  const data = path.join(root, "data");
  const selectedPort = await port();
  const base = `postgresql://transfer_owner@127.0.0.1:${selectedPort}`;
  let started = false;
  let admin: pg.Pool | undefined;
  let source: pg.Pool | undefined;
  let target: pg.Pool | undefined;
  try {
    await command("initdb", ["-D", data, "-U", "transfer_owner", "--auth=trust", "--encoding=UTF8", "--locale=C"], path.join(root, "init.log"));
    await command("pg_ctl", ["-D", data, "-l", path.join(root, "server.log"), "-o", `-h 127.0.0.1 -p ${selectedPort} -k ${root}`, "-w", "start"], path.join(root, "start.log"));
    started = true;
    admin = new pg.Pool({ connectionString: `${base}/postgres`, password: "" });
    const major = Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num);
    if (Math.floor(major / 10000) !== 16) throw new Error("Owned disposable cluster is not PostgreSQL 16");
    await admin.query("CREATE DATABASE transfer_source");
    await admin.query("CREATE DATABASE transfer_target");
    source = new pg.Pool({ connectionString: `${base}/transfer_source`, password: "", max: 4 });
    target = new pg.Pool({ connectionString: `${base}/transfer_target`, password: "", max: 4 });
    await registerDisposableTarget(admin, target, "transfer_target");
    await registerDisposableTarget(admin, source, "transfer_source");
    const targetPool = target;
    const buildCanonical = async (pool = targetPool): Promise<void> => {
      const client = await pool.connect();
      try {
        await applyMigrations(client, { migrations: await loadMigrations(), expectedTargetIdentity: expectedDisposableTarget(pool) });
      } finally { client.release(); }
    };
    if (options.builtCanonical) await buildCanonical();
    return await callback({
      source, target, sourceUrl: `${base}/transfer_source`, targetUrl: `${base}/transfer_target`,
      expectedTargetIdentity: expectedDisposableTarget(target),
      buildCanonical,
      restoreSource: async dump => {
        await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", `--dbname=${base}/transfer_source`, path.resolve(dump)], path.join(root, "restore.log"));
      },
    });
  } finally {
    try {
      await Promise.all([source?.end(), target?.end(), admin?.end()]);
    } finally {
      if (started) await command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], path.join(root, "stop.log"));
      await rm(root, { recursive: true, force: true });
    }
  }
}