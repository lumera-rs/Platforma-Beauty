import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const runnerPath = path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");
const runnerScriptPath = path.join(workspaceRoot, "scripts", "src", "run-api-regressions.ts");
const databaseUrl = process.env.DATABASE_URL;

type InterruptedPhase = "schema" | "shell";

type HarnessManifest = {
  databaseName: string;
  databaseTarget: string;
  ownerPid: number;
  ownerProcessIdentity: string;
  version: 1;
};

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

assert.ok(databaseUrl, "DATABASE_URL is required for the API regression lifecycle test.");

async function commandPath(command: string): Promise<string> {
  const { stdout } = await execFileAsync("which", [command]);
  const resolved = stdout.trim();
  assert.ok(resolved, `Could not resolve ${command}.`);
  return resolved;
}

async function waitForFile(filePath: string, timeoutMilliseconds = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for lifecycle phase marker ${filePath}.`);
}

async function waitForExit(child: ChildProcess, timeoutMilliseconds = 60_000): Promise<ChildExit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for regression runner to exit.")),
      timeoutMilliseconds,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function readManifest(manifestDirectory: string): Promise<{
  manifestPath: string;
  manifest: HarnessManifest;
}> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const entries = await readdir(manifestDirectory);
    const manifestName = entries.find((entry) => entry.endsWith(".json"));
    if (manifestName) {
      const manifestPath = path.join(manifestDirectory, manifestName);
      return {
        manifestPath,
        manifest: JSON.parse(await readFile(manifestPath, "utf8")) as HarnessManifest,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for a regression database manifest in ${manifestDirectory}.`);
}

async function databaseExists(databaseName: string): Promise<boolean> {
  const { stdout } = await execFileAsync("psql", [
    databaseUrl!,
    "-At",
    "-c",
    `SELECT 1 FROM pg_database WHERE datname = '${databaseName.replaceAll("'", "''")}'`,
  ]);
  return stdout.trim() === "1";
}

async function dropDatabase(databaseName: string): Promise<void> {
  await execFileAsync("dropdb", [
    "--force",
    "--if-exists",
    "--maintenance-db",
    databaseUrl!,
    databaseName,
  ]);
}

async function findOwnedTestServers(testDatabaseUrl: string): Promise<number[]> {
  const processEntries = await readdir("/proc", { withFileTypes: true });
  const processIds = processEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const ownedPids: number[] = [];

  await Promise.all(processIds.map(async (processId) => {
    try {
      const [commandLine, environment] = await Promise.all([
        readFile(`/proc/${processId}/cmdline`, "utf8"),
        readFile(`/proc/${processId}/environ`, "utf8"),
      ]);
      if (
        commandLine.includes("test-server.ts")
        && (
          environment.includes(`DATABASE_URL=${testDatabaseUrl}\u0000`)
          || environment.includes(`LUMERA_TEST_DATABASE_URL=${testDatabaseUrl}\u0000`)
        )
      ) {
        ownedPids.push(processId);
      }
    } catch {
      // Processes can exit between reading /proc entries and their files.
    }
  }));

  return ownedPids.sort((left, right) => left - right);
}

async function waitForOwnedTestServersToStop(testDatabaseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let remaining: number[] = [];
  while (Date.now() < deadline) {
    remaining = await findOwnedTestServers(testDatabaseUrl);
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(remaining, [], `Owned disposable test-server processes remain: ${remaining.join(", ")}`);
}

async function writeCommandShims(
  binDirectory: string,
  phase: InterruptedPhase,
  realBash: string,
  realPnpm: string,
): Promise<void> {
  await writeFile(
    path.join(binDirectory, "pnpm"),
    `#!${realBash}
set -euo pipefail
if [[ "$*" == *"@workspace/db run push-force"* && "${phase}" == "schema" ]]; then
  printf 'schema' > "$LUMERA_LIFECYCLE_PHASE_MARKER"
  while :; do sleep 1; done
fi
exec "$LUMERA_LIFECYCLE_REAL_PNPM" "$@"
`,
    { mode: 0o755 },
  );
  await writeFile(
    path.join(binDirectory, "bash"),
    `#!${realBash}
set -euo pipefail
if [[ "${phase}" == "shell" && "\${1:-}" == *"test-admin-authorization.sh" ]]; then
  printf 'shell' > "$LUMERA_LIFECYCLE_PHASE_MARKER"
  while :; do sleep 1; done
fi
exec "$LUMERA_LIFECYCLE_REAL_BASH" "$@"
`,
    { mode: 0o755 },
  );
  await chmod(path.join(binDirectory, "pnpm"), 0o755);
  await chmod(path.join(binDirectory, "bash"), 0o755);
}

async function runInterruptedScenario(phase: InterruptedPhase): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-api-regression-lifecycle-"));
  const binDirectory = path.join(temporaryRoot, "bin");
  const markerPath = path.join(temporaryRoot, "phase-reached");
  const manifestDirectoryName = `api-regression-lifecycle-${process.pid}-${randomUUID()}`;
  const manifestDirectory = path.join(workspaceRoot, ".lumera-test-state", manifestDirectoryName);
  const databasePrefix = `lumera_api_regression_lifecycle_${process.pid}_${randomUUID()}_`;
  let child: ChildProcess | undefined;
  let manifestPath: string | undefined;
  let databaseName: string | undefined;
  let testDatabaseUrl: string | undefined;

  try {
    const realBash = await commandPath("bash");
    const realPnpm = await commandPath("pnpm");
    await mkdir(binDirectory, { recursive: true });
    await writeCommandShims(
      binDirectory,
      phase,
      realBash,
      realPnpm,
    );
    const environment = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      DATABASE_URL: databaseUrl,
      LUMERA_API_REGRESSION_DATABASE_PREFIX: databasePrefix,
      LUMERA_API_REGRESSION_MANIFEST_DIRECTORY: manifestDirectoryName,
      LUMERA_LIFECYCLE_PHASE_MARKER: markerPath,
      LUMERA_LIFECYCLE_REAL_BASH: realBash,
      LUMERA_LIFECYCLE_REAL_PNPM: realPnpm,
    };
    child = spawn(runnerPath, [runnerScriptPath], {
      cwd: workspaceRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    await waitForFile(markerPath);
    const manifest = await readManifest(manifestDirectory);
    manifestPath = manifest.manifestPath;
    databaseName = manifest.manifest.databaseName;
    const isolatedDatabaseUrl = new URL(databaseUrl!);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    testDatabaseUrl = isolatedDatabaseUrl.toString();
    assert.equal(await databaseExists(databaseName), true, `Disposable database was not created.\n${output}`);

    child.kill("SIGTERM");
    const exit = await waitForExit(child);
    assert.equal(exit.signal, null, `Runner was terminated directly instead of handling SIGTERM.\n${output}`);
    assert.equal(exit.code, 143, `Runner did not report SIGTERM status 143.\n${output}`);

    await waitForOwnedTestServersToStop(testDatabaseUrl);
    await assert.rejects(readFile(manifestPath), { code: "ENOENT" });
    assert.equal(await databaseExists(databaseName), false, "Disposable database was not removed.");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    if (databaseName) {
      await dropDatabase(databaseName).catch(() => undefined);
    }
    await rm(manifestDirectory, { recursive: true, force: true });
    await unlink(markerPath).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("SIGTERM during disposable API regression schema setup cleans every resource", async () => {
  await runInterruptedScenario("schema");
});

test("SIGTERM during a disposable API regression shell check cleans every resource", async () => {
  await runInterruptedScenario("shell");
});