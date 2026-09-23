import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { assertDestructiveTestRuntimeAllowed } from "./destructive-test-runtime";
import { isDeploymentRuntime } from "./migrations/development-runtime";
import { loadMigrations } from "./migrations/files";
import { applyMigrations } from "./migrations/runner";
import { pipeRedactedDatabaseOutput } from "./safe-child-process-output";
import type { ExpectedTargetIdentity } from "./migrations/target-identity";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const command = process.argv.slice(2).filter((argument, index) => argument !== "--" || index !== 0);

// Refuse the ambient runtime before sanitizing anything or creating the owned
// cluster. Deployment indicators must never be erased as a way around guards.
if (isDeploymentRuntime(process.env)) {
  throw new Error("Destructive test runner refuses production or deployment runtimes");
}
assertDestructiveTestRuntimeAllowed({
  NODE_ENV: process.env.NODE_ENV,
  REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT,
  REPL_DEPLOYMENT: process.env.REPL_DEPLOYMENT,
  DATABASE_URL: "",
}, "Owned disposable PostgreSQL runner");

if (command.length === 0) {
  throw new Error(
    "Usage: pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- <command...>",
  );
}

// This process never needs an inherited database location. Delete these keys
// without reading their values before importing or invoking database code.
for (const key of [
  "DATABASE_URL",
  "LUMERA_DISPOSABLE_DATABASE",
  "LUMERA_TEST_DATABASE_URL",
  "REPLIT_DEPLOYMENT",
  "REPL_DEPLOYMENT",
  "REPLIT_DEPLOYMENT_ID",
  "REPL_DEPLOYMENT_ID",
]) {
  delete process.env[key];
}
process.env.NODE_ENV = "test";

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "lumera-destructive-test-"));
const port = 55441;
const owner = "lumera_destructive";
let clusterStarted = false;
let pool: pg.Pool | undefined;
let child: ChildProcess | undefined;
let childProcessGroupId: number | undefined;
let receivedSignal: NodeJS.Signals | undefined;
let forcedTermination: NodeJS.Timeout | undefined;

const signalHandlers = new Map<NodeJS.Signals, () => void>();
const signalExitCode = (signal: NodeJS.Signals): number => (
  signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129
);
const signalChildGroup = (signal: NodeJS.Signals) => {
  if (!childProcessGroupId) return;
  try {
    process.kill(-childProcessGroupId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      console.error(`Unable to signal owned child process group: ${String(error)}`);
    }
  }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  const handler = () => {
    receivedSignal ??= signal;
    signalChildGroup(signal);
    forcedTermination ??= setTimeout(() => signalChildGroup("SIGKILL"), 5_000);
    forcedTermination.unref();
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

function childEnvironment(
  databaseUrl: string,
  identity: ExpectedTargetIdentity,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  const excluded = new Set([
    "DATABASE_URL",
    "LUMERA_DISPOSABLE_DATABASE",
    "LUMERA_TEST_DATABASE_URL",
    "REPLIT_DEPLOYMENT",
    "REPL_DEPLOYMENT",
    "REPLIT_DEPLOYMENT_ID",
    "REPL_DEPLOYMENT_ID",
  ]);
  for (const key of Object.keys(process.env)) {
    if (!excluded.has(key)) environment[key] = process.env[key];
  }
  return {
    ...environment,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    LUMERA_DISPOSABLE_DATABASE: databaseUrl,
    LUMERA_TEST_DATABASE_URL: databaseUrl,
    LUMERA_TEST_DATABASE_NAME: identity.databaseName,
    LUMERA_TEST_DATABASE_SYSTEM_IDENTIFIER: identity.systemIdentifier,
    LUMERA_TEST_DATABASE_TRANSPORT: identity.transport,
  };
}

function assertNotInterrupted(): void {
  if (receivedSignal) {
    const error = new Error(`Destructive test runner interrupted by ${receivedSignal}`);
    (error as Error & { exitCode: number }).exitCode = signalExitCode(receivedSignal);
    throw error;
  }
}

async function runCommand(environment: NodeJS.ProcessEnv): Promise<number> {
  assertNotInterrupted();
  return new Promise((resolve, reject) => {
    child = spawn(command[0]!, command.slice(1), {
      cwd: workspaceRoot,
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    childProcessGroupId = child.pid;
    pipeRedactedDatabaseOutput(child, environment);
    child.once("error", (error) => {
      childProcessGroupId = undefined;
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (receivedSignal) signalChildGroup("SIGKILL");
      childProcessGroupId = undefined;
      child = undefined;
      if (code !== null) resolve(code);
      else resolve(signal ? signalExitCode(signal) : 1);
    });
  });
}

let primaryError: unknown;
let commandExitCode = 0;
try {
  execFileSync(
    "initdb",
    [
      "-D", dataDirectory,
      "--auth=trust",
      `--username=${owner}`,
      "--encoding=UTF8",
      "--locale=C",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "pg_ctl",
    [
      "-D", dataDirectory,
      "-l", path.join(dataDirectory, "server.log"),
      "-o", `-h '' -k ${dataDirectory} -p ${port}`,
      "-w", "start",
    ],
    { stdio: "ignore" },
  );
  clusterStarted = true;
  assertNotInterrupted();

  pool = new pg.Pool({
    host: dataDirectory,
    port,
    user: owner,
    database: "postgres",
  });
  const client = await pool.connect();
  assertNotInterrupted();
  let identity: ExpectedTargetIdentity;
  try {
    const version = Number(
      (await client.query("SHOW server_version_num")).rows[0]?.server_version_num,
    );
    if (Math.floor(version / 10000) !== 16) {
      throw new Error(`Destructive test runner requires PostgreSQL 16, found ${version}`);
    }
    const systemIdentifier = (
      await client.query(
        "SELECT system_identifier::text FROM pg_catalog.pg_control_system()",
      )
    ).rows[0]?.system_identifier;
    if (typeof systemIdentifier !== "string") {
      throw new Error("Disposable PostgreSQL system identity is unavailable");
    }
    identity = {
      databaseName: "postgres",
      systemIdentifier,
      transport: "unencrypted",
    };
    console.log("DISPOSABLE_IDENTITY", JSON.stringify(identity));
    console.log("PG_VERSION", version);
    console.log(
      "RUNNER",
      await applyMigrations(client, {
        migrations: await loadMigrations(),
        expectedTargetIdentity: identity,
      }),
    );
    assertNotInterrupted();
  } finally {
    client.release();
  }
  await pool.end();
  pool = undefined;
  assertNotInterrupted();

  const databaseUrl = `postgresql://${owner}@localhost/postgres?host=${encodeURIComponent(dataDirectory)}&port=${port}`;
  commandExitCode = await runCommand(childEnvironment(databaseUrl, identity));
} catch (error) {
  primaryError = error;
} finally {
  if (forcedTermination) clearTimeout(forcedTermination);
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  try {
    if (pool) await pool.end();
  } catch (error) {
    primaryError ??= error;
  }
  if (clusterStarted) {
    try {
      execFileSync(
        "pg_ctl",
        ["-D", dataDirectory, "-m", "fast", "-w", "stop"],
        { stdio: "ignore" },
      );
    } catch (error) {
      primaryError ??= error;
    }
  }
  try {
    await rm(dataDirectory, { recursive: true, force: true });
  } catch (error) {
    primaryError ??= error;
  }
}

if (primaryError && !receivedSignal) throw primaryError;
process.exitCode = receivedSignal
  ? signalExitCode(receivedSignal)
  : commandExitCode;