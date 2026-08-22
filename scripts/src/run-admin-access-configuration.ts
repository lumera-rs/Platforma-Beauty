import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const testDatabasePrefix = "lumera_admin_browser_";
const harnessDatabaseNamePattern = /^lumera_admin_browser_(\d+)_[a-f0-9]{32}$/;
const manifestDirectory = path.join(workspaceRoot, ".lumera-test-state", "admin-browser-databases");

interface HarnessDatabaseManifest {
  version: 1;
  databaseName: string;
  databaseTarget: string;
  ownerPid: number;
  ownerProcessIdentity: string;
}

function requireDevelopmentDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to manage disposable admin browser test databases.");
  }

  const parsed = new URL(databaseUrl);
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return databaseUrl;
}

function getDatabaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

function getDatabaseTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return JSON.stringify({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    databaseName: getDatabaseName(databaseUrl),
  });
}

function createTestDatabaseUrl(developmentDatabaseUrl: string, databaseName: string): string {
  const url = new URL(developmentDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function isHarnessDatabaseName(databaseName: string): boolean {
  return harnessDatabaseNamePattern.test(databaseName);
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function getProcessIdentity(processId: number): Promise<string | undefined> {
  try {
    const [bootId, stat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${processId}/stat`, "utf8"),
    ]);
    const commandEnd = stat.lastIndexOf(")");
    const statFields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : [];
    const startTime = statFields[19];
    if (!bootId.trim() || !startTime) {
      throw new Error(`Could not identify process ${processId}.`);
    }

    return `${bootId.trim()}:${startTime}`;
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

function getManifestPath(databaseName: string): string {
  return path.join(manifestDirectory, `${databaseName}.json`);
}

async function writeHarnessDatabaseManifest(manifest: HarnessDatabaseManifest): Promise<string> {
  await mkdir(manifestDirectory, { recursive: true });
  const manifestPath = getManifestPath(manifest.databaseName);
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, manifestPath);
  return manifestPath;
}

async function removeHarnessDatabaseManifest(manifestPath: string): Promise<void> {
  try {
    await unlink(manifestPath);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function parseHarnessDatabaseManifest(contents: string, filename: string): HarnessDatabaseManifest | undefined {
  try {
    const manifest: unknown = JSON.parse(contents);
    if (
      !manifest
      || typeof manifest !== "object"
      || !("version" in manifest)
      || manifest.version !== 1
      || !("databaseName" in manifest)
      || typeof manifest.databaseName !== "string"
      || !isHarnessDatabaseName(manifest.databaseName)
      || filename !== `${manifest.databaseName}.json`
      || !("databaseTarget" in manifest)
      || typeof manifest.databaseTarget !== "string"
      || !("ownerPid" in manifest)
      || typeof manifest.ownerPid !== "number"
      || !Number.isSafeInteger(manifest.ownerPid)
      || manifest.ownerPid <= 0
      || !("ownerProcessIdentity" in manifest)
      || typeof manifest.ownerProcessIdentity !== "string"
      || !manifest.ownerProcessIdentity
    ) {
      return undefined;
    }

    return manifest as HarnessDatabaseManifest;
  } catch {
    return undefined;
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local TCP port for the browser test environment.");
  }

  return address.port;
}

function runCommand(command: string, args: string[], environment: NodeJS.ProcessEnv, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: environment,
      stdio: "inherit",
    });

    child.once("error", () => reject(new Error(`${label} could not be started.`)));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed${signal ? ` after ${signal}` : ` with exit code ${code ?? "unknown"}`}.`));
      }
    });
  });
}

function startProcess(command: string, args: string[], environment: NodeJS.ProcessEnv, label: string): ChildProcess {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    detached: process.platform !== "win32",
    env: environment,
    stdio: "inherit",
  });

  child.once("error", () => {
    console.error(`${label} could not be started.`);
  });

  return child;
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`received ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`${label} did not become ready within 30 seconds${lastError ? ` (${lastError instanceof Error ? lastError.message : String(lastError)})` : ""}.`);
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child) return;

  if (process.platform !== "win32" && child.pid) {
    const processGroupId = child.pid;
    const processGroupExists = () => {
      try {
        process.kill(-processGroupId, 0);
        return true;
      } catch (error) {
        return !isFileNotFound(error) && !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
      }
    };
    const waitForProcessGroupExit = async (timeoutMilliseconds: number) => {
      const deadline = Date.now() + timeoutMilliseconds;
      while (processGroupExists() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return !processGroupExists();
    };
    const signalProcessGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-processGroupId, signal);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
          throw error;
        }
      }
    };

    signalProcessGroup("SIGTERM");
    if (!await waitForProcessGroupExit(5_000)) {
      signalProcessGroup("SIGKILL");
      if (!await waitForProcessGroupExit(5_000)) {
        throw new Error(`Could not stop disposable service process group ${processGroupId}.`);
      }
    }
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function recoverInterruptedHarnessDatabases(): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const developmentDatabaseName = getDatabaseName(developmentDatabaseUrl);
  const databaseTarget = getDatabaseTarget(developmentDatabaseUrl);
  let manifestEntries;
  try {
    manifestEntries = await readdir(manifestDirectory, { withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) {
      console.log("No interrupted admin browser test databases were found.");
      return;
    }
    throw error;
  }

  const manifests: Array<{ manifest: HarnessDatabaseManifest; manifestPath: string }> = [];
  for (const entry of manifestEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const manifestPath = path.join(manifestDirectory, entry.name);
    const manifest = parseHarnessDatabaseManifest(await readFile(manifestPath, "utf8"), entry.name);
    if (!manifest) continue;
    manifests.push({ manifest, manifestPath });
  }

  if (manifests.length === 0) {
    console.log("No interrupted admin browser test databases were found.");
    return;
  }

  const cleanupErrors: unknown[] = [];
  let removedDatabaseCount = 0;
  for (const { manifest, manifestPath } of manifests) {
    try {
      if (manifest.databaseTarget !== databaseTarget || manifest.databaseName === developmentDatabaseName) {
        continue;
      }

      const currentOwnerIdentity = await getProcessIdentity(manifest.ownerPid);
      if (currentOwnerIdentity === manifest.ownerProcessIdentity) {
        continue;
      }

      await runCommand(
        "dropdb",
        ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, manifest.databaseName],
        process.env,
        `Removing interrupted admin browser test database ${manifest.databaseName}`,
      );
      await removeHarnessDatabaseManifest(manifestPath);
      removedDatabaseCount += 1;
      console.log(`Removed interrupted admin browser test database ${manifest.databaseName}.`);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "One or more interrupted admin browser test databases could not be removed.");
  }
  if (removedDatabaseCount === 0) {
    console.log("No interrupted admin browser test databases were found.");
  }
}

async function run(): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const databaseName = `${testDatabasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const ownerProcessIdentity = await getProcessIdentity(process.pid);
  if (!ownerProcessIdentity) {
    throw new Error("Could not identify the admin browser test harness process.");
  }
  const manifestPath = await writeHarnessDatabaseManifest({
    version: 1,
    databaseName,
    databaseTarget: getDatabaseTarget(developmentDatabaseUrl),
    ownerPid: process.pid,
    ownerProcessIdentity,
  });
  const testDatabaseUrl = createTestDatabaseUrl(developmentDatabaseUrl, databaseName);
  const apiPort = await findAvailablePort();
  const webPort = await findAvailablePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  const testEnvironment = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    LUMERA_TEST_DATABASE_URL: testDatabaseUrl,
    LUMERA_ISOLATED_ADMIN_BROWSER_TEST: "1",
    NODE_ENV: "test",
  };
  let databaseMayExist = false;
  let apiProcess: ChildProcess | undefined;
  let webProcess: ChildProcess | undefined;

  try {
    databaseMayExist = true;
    await runCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      process.env,
      "Creating the disposable admin browser test database",
    );

    await runCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      testEnvironment,
      "Preparing the disposable admin browser test schema",
    );

    apiProcess = startProcess(
      path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx"),
      [path.join(workspaceRoot, "artifacts", "api-server", "src", "test-server.ts")],
      { ...testEnvironment, PORT: String(apiPort) },
      "Disposable API server",
    );
    await waitForHttp(`${apiBaseUrl}/api/healthz`, "Disposable API server");

    webProcess = startProcess(
      "pnpm",
      ["--filter", "@workspace/beauty-marketplace", "run", "dev"],
      {
        ...testEnvironment,
        BASE_PATH: "/",
        LUMERA_API_BASE_URL: apiBaseUrl,
        PORT: String(webPort),
      },
      "Disposable browser frontend",
    );
    await waitForHttp(webBaseUrl, "Disposable browser frontend");

    await runCommand(
      "pnpm",
      [
        "--filter",
        "@workspace/scripts",
        "exec",
        "playwright",
        "test",
        "browser/admin-access-configuration.spec.ts",
        "--config",
        "playwright.config.ts",
      ],
      { ...testEnvironment, LUMERA_WEB_BASE_URL: webBaseUrl },
      "Admin access browser checks",
    );
  } finally {
    try {
      await stopProcess(webProcess);
    } finally {
      try {
        await stopProcess(apiProcess);
      } finally {
        if (databaseMayExist) {
          await runCommand(
            "dropdb",
            ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, databaseName],
            process.env,
            "Removing the disposable admin browser test database",
          );
        }
        await removeHarnessDatabaseManifest(manifestPath);
      }
    }
  }
}

const commandArguments = process.argv.slice(2);
const command = commandArguments.length === 0
  ? run()
  : commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases"
    ? recoverInterruptedHarnessDatabases()
    : Promise.reject(new Error("Usage: run-admin-access-configuration.ts [--recover-interrupted-databases]"));

void command.catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});