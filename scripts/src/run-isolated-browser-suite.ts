import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const stateRoot = path.join(workspaceRoot, ".lumera-test-state");

interface IsolatedSuiteConfiguration {
  databasePrefix: string;
  manifestDirectoryName: string;
  testLabel: string;
  environment: Record<string, string>;
}

export interface IsolatedBrowserSuiteConfiguration extends IsolatedSuiteConfiguration {
  specPath: string;
}

export interface IsolatedApiSuiteConfiguration extends IsolatedSuiteConfiguration {
  testFilePath: string;
}

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
    throw new Error("DATABASE_URL is required to manage disposable browser test databases.");
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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createHarnessDatabaseNamePattern(databasePrefix: string): RegExp {
  return new RegExp(`^${escapeRegularExpression(databasePrefix)}(\\d+)_[a-f0-9]{32}$`);
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isProcessMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
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

function getManifestDirectory(configuration: IsolatedSuiteConfiguration): string {
  return path.join(stateRoot, configuration.manifestDirectoryName);
}

function getManifestPath(
  configuration: IsolatedSuiteConfiguration,
  databaseName: string,
): string {
  return path.join(getManifestDirectory(configuration), `${databaseName}.json`);
}

async function writeHarnessDatabaseManifest(
  configuration: IsolatedSuiteConfiguration,
  manifest: HarnessDatabaseManifest,
): Promise<string> {
  await mkdir(getManifestDirectory(configuration), { recursive: true });
  const manifestPath = getManifestPath(configuration, manifest.databaseName);
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

function parseHarnessDatabaseManifest(
  configuration: IsolatedSuiteConfiguration,
  contents: string,
  filename: string,
): HarnessDatabaseManifest | undefined {
  try {
    const manifest: unknown = JSON.parse(contents);
    if (
      !manifest
      || typeof manifest !== "object"
      || !("version" in manifest)
      || manifest.version !== 1
      || !("databaseName" in manifest)
      || typeof manifest.databaseName !== "string"
      || !createHarnessDatabaseNamePattern(configuration.databasePrefix).test(manifest.databaseName)
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
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));

  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local TCP port for the browser test environment.");
  }

  return address.port;
}

function runCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
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
        reject(new Error(
          `${label} failed${signal ? ` after ${signal}` : ` with exit code ${code ?? "unknown"}`}.`,
        ));
      }
    });
  });
}

function startProcess(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  label: string,
): ChildProcess {
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

  throw new Error(
    `${label} did not become ready within 30 seconds${
      lastError ? ` (${lastError instanceof Error ? lastError.message : String(lastError)})` : ""
    }.`,
  );
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
        return !isProcessMissing(error);
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
        if (!isProcessMissing(error)) throw error;
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

export async function recoverInterruptedHarnessDatabases(
  configuration: IsolatedSuiteConfiguration,
): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const developmentDatabaseName = getDatabaseName(developmentDatabaseUrl);
  const databaseTarget = getDatabaseTarget(developmentDatabaseUrl);
  let manifestEntries;
  try {
    manifestEntries = await readdir(getManifestDirectory(configuration), { withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) {
      console.log(`No interrupted ${configuration.testLabel.toLowerCase()} databases were found.`);
      return;
    }
    throw error;
  }

  const manifests: Array<{ manifest: HarnessDatabaseManifest; manifestPath: string }> = [];
  for (const entry of manifestEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const manifestPath = path.join(getManifestDirectory(configuration), entry.name);
    const manifest = parseHarnessDatabaseManifest(
      configuration,
      await readFile(manifestPath, "utf8"),
      entry.name,
    );
    if (manifest) manifests.push({ manifest, manifestPath });
  }

  if (manifests.length === 0) {
    console.log(`No interrupted ${configuration.testLabel.toLowerCase()} databases were found.`);
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
      if (currentOwnerIdentity === manifest.ownerProcessIdentity) continue;

      await runCommand(
        "dropdb",
        ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, manifest.databaseName],
        process.env,
        `Removing interrupted browser test database ${manifest.databaseName}`,
      );
      await removeHarnessDatabaseManifest(manifestPath);
      removedDatabaseCount += 1;
      console.log(`Removed interrupted browser test database ${manifest.databaseName}.`);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "One or more interrupted browser test databases could not be removed.",
    );
  }
  if (removedDatabaseCount === 0) {
    console.log(`No interrupted ${configuration.testLabel.toLowerCase()} databases were found.`);
  }
}

export async function runIsolatedBrowserSuite(
  configuration: IsolatedBrowserSuiteConfiguration,
): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const databaseName =
    `${configuration.databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const ownerProcessIdentity = await getProcessIdentity(process.pid);
  if (!ownerProcessIdentity) {
    throw new Error("Could not identify the isolated browser test harness process.");
  }
  const manifestPath = await writeHarnessDatabaseManifest(configuration, {
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
    ...configuration.environment,
    DATABASE_URL: testDatabaseUrl,
    LUMERA_TEST_DATABASE_URL: testDatabaseUrl,
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
      "Creating the disposable browser test database",
    );

    await runCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      testEnvironment,
      "Preparing the disposable browser test schema",
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
        configuration.specPath,
        "--config",
        "playwright.config.ts",
      ],
      { ...testEnvironment, LUMERA_WEB_BASE_URL: webBaseUrl },
      configuration.testLabel,
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
            "Removing the disposable browser test database",
          );
        }
        await removeHarnessDatabaseManifest(manifestPath);
      }
    }
  }
}

export async function runIsolatedApiSuite(
  configuration: IsolatedApiSuiteConfiguration,
): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const databaseName =
    `${configuration.databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const ownerProcessIdentity = await getProcessIdentity(process.pid);
  if (!ownerProcessIdentity) {
    throw new Error("Could not identify the isolated API test harness process.");
  }
  const manifestPath = await writeHarnessDatabaseManifest(configuration, {
    version: 1,
    databaseName,
    databaseTarget: getDatabaseTarget(developmentDatabaseUrl),
    ownerPid: process.pid,
    ownerProcessIdentity,
  });
  const testDatabaseUrl = createTestDatabaseUrl(developmentDatabaseUrl, databaseName);
  const testEnvironment = {
    ...process.env,
    ...configuration.environment,
    DATABASE_URL: testDatabaseUrl,
    LUMERA_TEST_DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test",
  };
  let databaseMayExist = false;

  try {
    databaseMayExist = true;
    await runCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      process.env,
      "Creating the disposable API test database",
    );
    await runCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      testEnvironment,
      "Preparing the disposable API test schema",
    );
    await runCommand(
      "pnpm",
      ["--filter", "@workspace/scripts", "exec", "tsx", "--test", configuration.testFilePath],
      testEnvironment,
      configuration.testLabel,
    );
  } finally {
    try {
      if (databaseMayExist) {
        await runCommand(
          "dropdb",
          ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, databaseName],
          process.env,
          "Removing the disposable API test database",
        );
      }
    } finally {
      await removeHarnessDatabaseManifest(manifestPath);
    }
  }
}

export async function runIsolatedBrowserSuiteCommand(
  configuration: IsolatedBrowserSuiteConfiguration,
): Promise<void> {
  const commandArguments = process.argv.slice(2);
  const command = commandArguments.length === 0
    ? runIsolatedBrowserSuite(configuration)
    : commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases"
      ? recoverInterruptedHarnessDatabases(configuration)
      : Promise.reject(new Error(
        `Usage: ${path.basename(process.argv[1] ?? "isolated-browser-suite")} [--recover-interrupted-databases]`,
      ));

  try {
    await command;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export async function runIsolatedApiSuiteCommand(
  configuration: IsolatedApiSuiteConfiguration,
): Promise<void> {
  const commandArguments = process.argv.slice(2);
  const command = commandArguments.length === 0
    ? runIsolatedApiSuite(configuration)
    : commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases"
      ? recoverInterruptedHarnessDatabases(configuration)
      : Promise.reject(new Error(
        `Usage: ${path.basename(process.argv[1] ?? "isolated-api-suite")} [--recover-interrupted-databases]`,
      ));

  try {
    await command;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}