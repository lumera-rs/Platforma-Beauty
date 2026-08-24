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
  processMarker?: string;
  version: 1;
};

const processMarkerEnvironmentName = "LUMERA_TEST_RUN_MARKER";

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
    const entries = await readdir(manifestDirectory).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
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

async function getProcessIdentity(processId: number): Promise<string> {
  const [bootId, stat] = await Promise.all([
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    readFile(`/proc/${processId}/stat`, "utf8"),
  ]);
  const commandEnd = stat.lastIndexOf(")");
  const statFields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : [];
  const startTime = statFields[19];
  assert.ok(bootId.trim() && startTime, `Could not identify process ${processId}.`);
  return `${bootId.trim()}:${startTime}`;
}

async function getProcessGroupId(processId: number): Promise<number> {
  const stat = await readFile(`/proc/${processId}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  const statFields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : [];
  const processGroupId = Number(statFields[2]);
  assert.ok(Number.isSafeInteger(processGroupId) && processGroupId > 0);
  return processGroupId;
}

function getDatabaseTarget(databaseName = new URL(databaseUrl!).pathname.slice(1)): string {
  const parsed = new URL(databaseUrl!);
  return JSON.stringify({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    databaseName,
  });
}

async function writeManifest(
  manifestDirectory: string,
  manifest: HarnessManifest,
): Promise<string> {
  const manifestPath = path.join(manifestDirectory, `${manifest.databaseName}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  return manifestPath;
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

async function createDatabase(databaseName: string): Promise<void> {
  await execFileAsync("createdb", [
    "--maintenance-db",
    databaseUrl!,
    databaseName,
  ]);
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

async function stopProcessGroup(processId: number): Promise<void> {
  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
  }
}

async function stopMarkedProcessGroups(processMarker: string): Promise<void> {
  const processGroupIds = new Set<number>();
  for (const processId of await findProcessesWithMarker(processMarker)) {
    try {
      processGroupIds.add(await getProcessGroupId(processId));
    } catch {
      // Processes can exit while the test is cleaning up.
    }
  }
  await Promise.all([...processGroupIds].map((processGroupId) => stopProcessGroup(processGroupId)));
}

async function findProcessesWithMarker(processMarker: string): Promise<number[]> {
  const processEntries = await readdir("/proc", { withFileTypes: true });
  const processIds = processEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const ownedPids: number[] = [];

  await Promise.all(processIds.map(async (processId) => {
    try {
      const environment = await readFile(`/proc/${processId}/environ`, "utf8");
      if (environment.includes(`${processMarkerEnvironmentName}=${processMarker}\u0000`)) {
        ownedPids.push(processId);
      }
    } catch {
      // Processes can exit between reading /proc entries and their files.
    }
  }));

  return ownedPids.sort((left, right) => left - right);
}

async function waitForProcess(processId: number, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.fail(`${label} process ${processId} did not remain running.`);
}

async function waitForProcessToStop(processId: number, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label} process ${processId} did not stop.`);
}

async function waitForOwnedTestServers(testDatabaseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let ownedPids: number[] = [];
  while (Date.now() < deadline) {
    ownedPids = await findOwnedTestServers(testDatabaseUrl);
    if (ownedPids.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.notDeepEqual(ownedPids, [], "The disposable API regression server did not start.");
}

async function waitForMarkerProcessesToStop(processMarker: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let remaining: number[] = [];
  while (Date.now() < deadline) {
    remaining = await findProcessesWithMarker(processMarker);
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(remaining, [], `Orphaned regression processes remain: ${remaining.join(", ")}`);
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

async function writeBrowserCommandShims(
  binDirectory: string,
  realBash: string,
  realPnpm: string,
  realNode: string,
  frontendPidPath: string,
  phaseMarkerPath: string,
  blockerPidPath: string,
  blockFrontendReadiness = false,
): Promise<void> {
  await writeFile(
    path.join(binDirectory, "pnpm"),
    `#!${realBash}
set -euo pipefail
if [[ "$*" == *"@workspace/db run push-force"* ]]; then
  exec "$LUMERA_LIFECYCLE_REAL_PNPM" "$@"
fi
if [[ "$*" == *"--filter @workspace/beauty-marketplace run dev"* ]]; then
  printf '%s' "$$" > "$LUMERA_LIFECYCLE_FRONTEND_PID"
  if [[ "${blockFrontendReadiness ? "true" : "false"}" == "true" ]]; then
    printf 'frontend-readiness' > "$LUMERA_LIFECYCLE_PHASE_MARKER"
    while :; do sleep 1; done
  fi
  exec "$LUMERA_LIFECYCLE_REAL_NODE" -e '
    const http = require("node:http");
    http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("browser lifecycle frontend");
    }).listen(Number(process.env.PORT), "127.0.0.1");
  '
fi
if [[ "$*" == *"--filter @workspace/scripts exec playwright test"* ]]; then
  printf 'playwright' > "$LUMERA_LIFECYCLE_PHASE_MARKER"
  printf '%s' "$$" > "$LUMERA_LIFECYCLE_BLOCKER_PID"
  while :; do sleep 1; done
fi
exec "$LUMERA_LIFECYCLE_REAL_PNPM" "$@"
`,
    { mode: 0o755 },
  );
  await chmod(path.join(binDirectory, "pnpm"), 0o755);
}

async function runForcedBrowserStopScenario(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-browser-suite-forced-stop-"));
  const binDirectory = path.join(temporaryRoot, "bin");
  const phaseMarkerPath = path.join(temporaryRoot, "phase-reached");
  const frontendPidPath = path.join(temporaryRoot, "frontend-pid");
  const blockerPidPath = path.join(temporaryRoot, "blocker-pid");
  const browserRunnerScriptPath = path.join(temporaryRoot, "run-browser-suite.ts");
  const manifestDirectoryName = `browser-suite-forced-stop-${process.pid}-${randomUUID()}`;
  const manifestDirectory = path.join(workspaceRoot, ".lumera-test-state", manifestDirectoryName);
  const databasePrefix = `lumera_bforced_${process.pid}_`;
  let child: ChildProcess | undefined;
  let staleManifest: { manifestPath: string; manifest: HarnessManifest } | undefined;
  let staleProcessMarker: string | undefined;
  let blockerPid: number | undefined;
  let activeProcess: ChildProcess | undefined;
  let unrelatedProcess: ChildProcess | undefined;
  const databaseNames: string[] = [];

  try {
    const realBash = await commandPath("bash");
    const realPnpm = await commandPath("pnpm");
    await mkdir(binDirectory, { recursive: true });
    await writeBrowserCommandShims(
      binDirectory,
      realBash,
      realPnpm,
      process.execPath,
      frontendPidPath,
      phaseMarkerPath,
      blockerPidPath,
    );
    await writeFile(
      browserRunnerScriptPath,
      `import { runIsolatedBrowserSuiteCommand } from ${JSON.stringify(
        path.join(workspaceRoot, "scripts", "src", "run-isolated-browser-suite.ts"),
      )};

void runIsolatedBrowserSuiteCommand({
  databasePrefix: ${JSON.stringify(databasePrefix)},
  manifestDirectoryName: ${JSON.stringify(manifestDirectoryName)},
  specPath: "browser/retail-checkout.spec.ts",
  testLabel: "Browser lifecycle checks",
  environment: {},
});
`,
      "utf8",
    );
    const environment = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      DATABASE_URL: databaseUrl,
      LUMERA_LIFECYCLE_BLOCKER_PID: blockerPidPath,
      LUMERA_LIFECYCLE_FRONTEND_PID: frontendPidPath,
      LUMERA_LIFECYCLE_PHASE_MARKER: phaseMarkerPath,
      LUMERA_LIFECYCLE_REAL_NODE: process.execPath,
      LUMERA_LIFECYCLE_REAL_PNPM: realPnpm,
    };
    child = spawn(runnerPath, [browserRunnerScriptPath], {
      cwd: workspaceRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    await waitForFile(phaseMarkerPath);
    staleManifest = await readManifest(manifestDirectory);
    staleProcessMarker = staleManifest.manifest.processMarker;
    assert.ok(staleProcessMarker, "The browser process marker was not recorded.");
    const staleDatabaseName = staleManifest.manifest.databaseName;
    databaseNames.push(staleDatabaseName);
    const isolatedDatabaseUrl = new URL(databaseUrl!);
    isolatedDatabaseUrl.pathname = `/${staleDatabaseName}`;
    const testDatabaseUrl = isolatedDatabaseUrl.toString();
    assert.equal(await databaseExists(staleDatabaseName), true, `Disposable database was not created.\n${output}`);
    await waitForOwnedTestServers(testDatabaseUrl);

    const frontendPid = Number(await readFile(frontendPidPath, "utf8"));
    assert.ok(Number.isSafeInteger(frontendPid) && frontendPid > 0, "The frontend PID was not recorded.");
    blockerPid = Number(await readFile(blockerPidPath, "utf8"));
    assert.ok(
      Number.isSafeInteger(blockerPid) && blockerPid > 0,
      "The Playwright blocker PID was not recorded.",
    );
    await waitForProcess(frontendPid, "The disposable browser frontend");
    await waitForProcess(blockerPid, "The disposable Playwright check");
    const orphanedProcesses = await findProcessesWithMarker(staleProcessMarker);
    assert.ok(
      orphanedProcesses.includes(frontendPid),
      "The disposable browser frontend did not carry the run marker.",
    );
    assert.ok(
      orphanedProcesses.includes(blockerPid),
      "The disposable Playwright process did not carry the run marker.",
    );

    process.kill(staleManifest.manifest.ownerPid, "SIGKILL");
    const exit = await waitForExit(child);
    assert.notEqual(exit.code, 0, `Browser runner was not force-stopped.\n${output}`);
    await waitForProcess(frontendPid, "The orphaned disposable browser frontend");
    await waitForProcess(blockerPid, "The orphaned disposable Playwright check");

    const activeDatabaseName = `${databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const unrelatedDatabaseName = `${databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(activeDatabaseName, unrelatedDatabaseName);
    await createDatabase(activeDatabaseName);
    await createDatabase(unrelatedDatabaseName);
    const activeManifestPath = await writeManifest(manifestDirectory, {
      version: 1,
      databaseName: activeDatabaseName,
      databaseTarget: getDatabaseTarget(),
      ownerPid: process.pid,
      ownerProcessIdentity: await getProcessIdentity(process.pid),
      processMarker: `active-${randomUUID()}`,
    });
    const unrelatedManifestPath = await writeManifest(manifestDirectory, {
      version: 1,
      databaseName: unrelatedDatabaseName,
      databaseTarget: getDatabaseTarget("unrelated-maintenance-database"),
      ownerPid: 1,
      ownerProcessIdentity: "unrelated-process",
    });
    const activeManifest = JSON.parse(await readFile(activeManifestPath, "utf8")) as HarnessManifest;
    activeProcess = spawn(realBash, ["-c", "while :; do sleep 1; done"], {
      env: {
        ...process.env,
        [processMarkerEnvironmentName]: activeManifest.processMarker,
      },
      detached: true,
      stdio: "ignore",
    });
    unrelatedProcess = spawn(realBash, ["-c", "while :; do sleep 1; done"], {
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const recovery = await execFileAsync(
      runnerPath,
      [browserRunnerScriptPath, "--recover-interrupted-databases"],
      { cwd: workspaceRoot, env: environment },
    );
    const escapedStaleDatabaseName = staleDatabaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      recovery.stdout,
      new RegExp(`Removed interrupted browser test database ${escapedStaleDatabaseName}`),
    );
    assert.equal(await databaseExists(staleDatabaseName), false, "Recovery did not remove the stale database.");
    await assert.rejects(readFile(staleManifest.manifestPath), { code: "ENOENT" });
    assert.equal(await databaseExists(activeDatabaseName), true, "Recovery removed an active database.");
    assert.equal(await databaseExists(unrelatedDatabaseName), true, "Recovery removed an unrelated database.");
    await readFile(activeManifestPath);
    await readFile(unrelatedManifestPath);
    assert.ok(activeProcess.pid);
    assert.ok(
      (await findProcessesWithMarker(activeManifest.processMarker!)).includes(activeProcess.pid),
      "Recovery terminated an active browser-run process.",
    );
    assert.ok(unrelatedProcess.pid);
    process.kill(unrelatedProcess.pid, 0);
    await waitForMarkerProcessesToStop(staleProcessMarker);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    if (staleProcessMarker) {
      await stopMarkedProcessGroups(staleProcessMarker).catch(() => undefined);
    }
    if (blockerPid) {
      await stopProcessGroup(blockerPid).catch(() => undefined);
    }
    if (activeProcess?.pid) {
      await stopProcessGroup(await getProcessGroupId(activeProcess.pid)).catch(() => undefined);
    }
    if (unrelatedProcess?.pid) {
      await stopProcessGroup(await getProcessGroupId(unrelatedProcess.pid)).catch(() => undefined);
    }
    await Promise.all(databaseNames.map((databaseName) => dropDatabase(databaseName).catch(() => undefined)));
    await rm(manifestDirectory, { recursive: true, force: true });
    await unlink(phaseMarkerPath).catch(() => undefined);
    await unlink(frontendPidPath).catch(() => undefined);
    await unlink(blockerPidPath).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runInterruptedBrowserScenario(blockFrontendReadiness = false): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-browser-suite-lifecycle-"));
  const binDirectory = path.join(temporaryRoot, "bin");
  const phaseMarkerPath = path.join(temporaryRoot, "phase-reached");
  const frontendPidPath = path.join(temporaryRoot, "frontend-pid");
  const blockerPidPath = path.join(temporaryRoot, "blocker-pid");
  const browserRunnerScriptPath = path.join(temporaryRoot, "run-browser-suite.ts");
  const manifestDirectoryName = `browser-suite-lifecycle-${process.pid}-${randomUUID()}`;
  const manifestDirectory = path.join(workspaceRoot, ".lumera-test-state", manifestDirectoryName);
  const databasePrefix = `lumera_blifecycle_${process.pid}_${randomUUID()}_`;
  let child: ChildProcess | undefined;
  let unrelatedProcess: ChildProcess | undefined;
  let manifestPath: string | undefined;
  let databaseName: string | undefined;
  let blockerPid: number | undefined;

  try {
    const realBash = await commandPath("bash");
    const realPnpm = await commandPath("pnpm");
    await mkdir(binDirectory, { recursive: true });
    await writeBrowserCommandShims(
      binDirectory,
      realBash,
      realPnpm,
      process.execPath,
      frontendPidPath,
      phaseMarkerPath,
      blockerPidPath,
      blockFrontendReadiness,
    );
    await writeFile(
      browserRunnerScriptPath,
      `import { runIsolatedBrowserSuiteCommand } from ${JSON.stringify(
        path.join(workspaceRoot, "scripts", "src", "run-isolated-browser-suite.ts"),
      )};

void runIsolatedBrowserSuiteCommand({
  databasePrefix: ${JSON.stringify(databasePrefix)},
  manifestDirectoryName: ${JSON.stringify(manifestDirectoryName)},
  specPath: "browser/retail-checkout.spec.ts",
  testLabel: "Browser lifecycle checks",
  environment: {},
});
`,
      "utf8",
    );
    const environment = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      DATABASE_URL: databaseUrl,
      LUMERA_LIFECYCLE_BLOCKER_PID: blockerPidPath,
      LUMERA_LIFECYCLE_FRONTEND_PID: frontendPidPath,
      LUMERA_LIFECYCLE_PHASE_MARKER: phaseMarkerPath,
      LUMERA_LIFECYCLE_REAL_NODE: process.execPath,
      LUMERA_LIFECYCLE_REAL_PNPM: realPnpm,
    };
    child = spawn(runnerPath, [browserRunnerScriptPath], {
      cwd: workspaceRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    await waitForFile(phaseMarkerPath);
    const manifest = await readManifest(manifestDirectory);
    manifestPath = manifest.manifestPath;
    databaseName = manifest.manifest.databaseName;
    const isolatedDatabaseUrl = new URL(databaseUrl!);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const testDatabaseUrl = isolatedDatabaseUrl.toString();
    assert.equal(await databaseExists(databaseName), true, `Disposable database was not created.\n${output}`);
    await waitForOwnedTestServers(testDatabaseUrl);

    const frontendPid = Number(await readFile(frontendPidPath, "utf8"));
    assert.ok(Number.isSafeInteger(frontendPid) && frontendPid > 0, "The frontend PID was not recorded.");
    if (!blockFrontendReadiness) {
      blockerPid = Number(await readFile(blockerPidPath, "utf8"));
      assert.ok(
        Number.isSafeInteger(blockerPid) && blockerPid > 0,
        "The Playwright blocker PID was not recorded.",
      );
    }
    unrelatedProcess = spawn(realBash, ["-c", "while :; do sleep 1; done"], {
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    await waitForProcess(frontendPid, "The disposable browser frontend");
    if (blockerPid) {
      await waitForProcess(blockerPid, "The disposable Playwright check");
    }
    assert.ok(unrelatedProcess.pid);
    await waitForProcess(unrelatedProcess.pid, "The unrelated local service");

    child.kill("SIGTERM");
    const exit = await waitForExit(child);
    assert.equal(exit.signal, null, `Runner was terminated directly instead of handling SIGTERM.\n${output}`);
    assert.equal(exit.code, 143, `Runner did not report SIGTERM status 143.\n${output}`);

    await waitForOwnedTestServersToStop(testDatabaseUrl);
    await waitForProcessToStop(frontendPid, "The disposable browser frontend");
    if (blockerPid) {
      await waitForProcessToStop(blockerPid, "The disposable Playwright check");
    }
    await waitForMarkerProcessesToStop(manifest.manifest.processMarker!);
    await assert.rejects(readFile(manifestPath), { code: "ENOENT" });
    assert.equal(await databaseExists(databaseName), false, "Disposable database was not removed.");
    process.kill(unrelatedProcess.pid, 0);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    if (unrelatedProcess?.pid) {
      await stopProcessGroup(await getProcessGroupId(unrelatedProcess.pid)).catch(() => undefined);
    }
    if (blockerPid) {
      await stopProcessGroup(blockerPid).catch(() => undefined);
    }
    if (databaseName) {
      await dropDatabase(databaseName).catch(() => undefined);
    }
    await rm(manifestDirectory, { recursive: true, force: true });
    await unlink(phaseMarkerPath).catch(() => undefined);
    await unlink(frontendPidPath).catch(() => undefined);
    await unlink(blockerPidPath).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
  printf '%s' "$$" > "$LUMERA_LIFECYCLE_BLOCKER_PID"
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
  printf '%s' "$$" > "$LUMERA_LIFECYCLE_BLOCKER_PID"
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
  const blockerPidPath = path.join(temporaryRoot, "blocker-pid");
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
      LUMERA_LIFECYCLE_BLOCKER_PID: blockerPidPath,
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
    const blockerPidContents = await readFile(blockerPidPath, "utf8").catch(() => "");
    const blockerPid = Number(blockerPidContents);
    if (Number.isSafeInteger(blockerPid) && blockerPid > 0) {
      await stopProcessGroup(blockerPid).catch(() => undefined);
    }
    await unlink(blockerPidPath).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runForcedStopScenario(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-api-regression-forced-stop-"));
  const binDirectory = path.join(temporaryRoot, "bin");
  const markerPath = path.join(temporaryRoot, "phase-reached");
  const blockerPidPath = path.join(temporaryRoot, "blocker-pid");
  const manifestDirectoryName = `api-regression-forced-stop-${process.pid}-${randomUUID()}`;
  const manifestDirectory = path.join(workspaceRoot, ".lumera-test-state", manifestDirectoryName);
  const databasePrefix = `lumera_forced_${process.pid}_`;
  let child: ChildProcess | undefined;
  let blockerPid: number | undefined;
  let activeProcess: ChildProcess | undefined;
  let unrelatedProcess: ChildProcess | undefined;
  const databaseNames: string[] = [];

  try {
    const realBash = await commandPath("bash");
    const realPnpm = await commandPath("pnpm");
    await mkdir(binDirectory, { recursive: true });
    await writeCommandShims(binDirectory, "shell", realBash, realPnpm);
    const environment = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      DATABASE_URL: databaseUrl,
      LUMERA_API_REGRESSION_DATABASE_PREFIX: databasePrefix,
      LUMERA_API_REGRESSION_MANIFEST_DIRECTORY: manifestDirectoryName,
      LUMERA_LIFECYCLE_PHASE_MARKER: markerPath,
      LUMERA_LIFECYCLE_BLOCKER_PID: blockerPidPath,
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

    const staleManifest = await readManifest(manifestDirectory);
    const staleDatabaseName = staleManifest.manifest.databaseName;
    databaseNames.push(staleDatabaseName);
    const isolatedDatabaseUrl = new URL(databaseUrl!);
    isolatedDatabaseUrl.pathname = `/${staleDatabaseName}`;
    const testDatabaseUrl = isolatedDatabaseUrl.toString();
    assert.ok(staleManifest.manifest.processMarker, "The regression process marker was not recorded.");
    await waitForFile(markerPath);
    assert.equal(await databaseExists(staleDatabaseName), true, `Disposable database was not created.\n${output}`);
    await waitForOwnedTestServers(testDatabaseUrl);
    const orphanedProcesses = await findProcessesWithMarker(staleManifest.manifest.processMarker);
    assert.ok(orphanedProcesses.length > 0, "No detached processes were found for the interrupted run.");
    blockerPid = Number(await readFile(blockerPidPath, "utf8"));
    assert.ok(
      Number.isSafeInteger(blockerPid) && blockerPid > 0,
      "The forced-stop blocker PID was not recorded.",
    );

    process.kill(staleManifest.manifest.ownerPid, "SIGKILL");
    const exit = await waitForExit(child);
    assert.notEqual(exit.code, 0, `Runner was not force-stopped.\n${output}`);

    const activeDatabaseName = `${databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const unrelatedDatabaseName = `${databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(activeDatabaseName, unrelatedDatabaseName);
    await createDatabase(activeDatabaseName);
    await createDatabase(unrelatedDatabaseName);
    const activeManifestPath = await writeManifest(manifestDirectory, {
      version: 1,
      databaseName: activeDatabaseName,
      databaseTarget: getDatabaseTarget(),
      ownerPid: process.pid,
      ownerProcessIdentity: await getProcessIdentity(process.pid),
      processMarker: `active-${randomUUID()}`,
    });
    const unrelatedManifestPath = await writeManifest(manifestDirectory, {
      version: 1,
      databaseName: unrelatedDatabaseName,
      databaseTarget: getDatabaseTarget("unrelated-maintenance-database"),
      ownerPid: 1,
      ownerProcessIdentity: "unrelated-process",
    });
    const activeManifest = JSON.parse(await readFile(activeManifestPath, "utf8")) as HarnessManifest;
    activeProcess = spawn(realBash, ["-c", "while :; do sleep 1; done"], {
      env: {
        ...process.env,
        [processMarkerEnvironmentName]: activeManifest.processMarker,
      },
      detached: true,
      stdio: "ignore",
    });
    unrelatedProcess = spawn(realBash, ["-c", "while :; do sleep 1; done"], {
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const recovery = await execFileAsync(
      runnerPath,
      [runnerScriptPath, "--recover-interrupted-databases"],
      { cwd: workspaceRoot, env: environment },
    );
    const escapedStaleDatabaseName = staleDatabaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      recovery.stdout,
      new RegExp(`Removed interrupted browser test database ${escapedStaleDatabaseName}`),
    );
    assert.equal(await databaseExists(staleDatabaseName), false, "Recovery did not remove the stale database.");
    await assert.rejects(readFile(staleManifest.manifestPath), { code: "ENOENT" });
    assert.equal(await databaseExists(activeDatabaseName), true, "Recovery removed an active database.");
    assert.equal(await databaseExists(unrelatedDatabaseName), true, "Recovery removed an unrelated database.");
    await readFile(activeManifestPath);
    await readFile(unrelatedManifestPath);
    assert.ok(activeProcess.pid);
    assert.ok(
      (await findProcessesWithMarker(activeManifest.processMarker!)).includes(activeProcess.pid),
      "Recovery terminated an active regression process.",
    );
    assert.ok(unrelatedProcess.pid);
    process.kill(unrelatedProcess.pid, 0);
    await waitForMarkerProcessesToStop(staleManifest.manifest.processMarker);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    if (blockerPid) {
      await stopProcessGroup(blockerPid).catch(() => undefined);
    }
    if (activeProcess?.pid) {
      await stopProcessGroup(await getProcessGroupId(activeProcess.pid)).catch(() => undefined);
    }
    if (unrelatedProcess?.pid) {
      await stopProcessGroup(await getProcessGroupId(unrelatedProcess.pid)).catch(() => undefined);
    }
    await Promise.all(databaseNames.map((databaseName) => dropDatabase(databaseName).catch(() => undefined)));
    await rm(manifestDirectory, { recursive: true, force: true });
    await unlink(markerPath).catch(() => undefined);
    await unlink(blockerPidPath).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("SIGTERM during disposable API regression schema setup cleans every resource", async () => {
  await runInterruptedScenario("schema");
});

test("SIGTERM during a disposable API regression shell check cleans every resource", async () => {
  await runInterruptedScenario("shell");
});

test("forced API regression shutdown recovery removes orphaned API and shell-check processes", async () => {
  await runForcedStopScenario();
});

test("forced browser-suite shutdown recovery removes only stale API, frontend, and Playwright processes", async () => {
  await runForcedBrowserStopScenario();
});

test("SIGTERM during a disposable browser check cleans every owned resource", async () => {
  await runInterruptedBrowserScenario();
});

test("SIGTERM during disposable browser frontend readiness cleans every owned resource", async () => {
  await runInterruptedBrowserScenario(true);
});
