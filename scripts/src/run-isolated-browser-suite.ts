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

export interface IsolatedApiRegressionSuiteConfiguration extends IsolatedSuiteConfiguration {
  scriptPaths: string[];
}

interface HarnessDatabaseManifest {
  version: 1;
  databaseName: string;
  databaseTarget: string;
  ownerPid: number;
  ownerProcessIdentity: string;
  processMarker?: string;
}

const processMarkerEnvironmentName = "LUMERA_TEST_RUN_MARKER";

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

function isProcessInaccessible(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error.code === "EACCES" || error.code === "EPERM"),
  );
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

async function getProcessGroupId(processId: number): Promise<number | undefined> {
  try {
    const stat = await readFile(`/proc/${processId}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const statFields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : [];
    const processGroupId = Number(statFields[2]);
    return Number.isSafeInteger(processGroupId) && processGroupId > 0 ? processGroupId : undefined;
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
      || (
        "processMarker" in manifest
        && (typeof manifest.processMarker !== "string" || !manifest.processMarker)
      )
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

interface RunCommandOptions {
  failOnOutput?: RegExp;
  onSpawn?: (child: ChildProcess) => void;
}

function runCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  label: string,
  options?: RunCommandOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      detached: process.platform !== "win32",
      env: environment,
      stdio: options?.failOnOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    options?.onSpawn?.(child);
    if (options?.failOnOutput) {
      const writeOutput = (stream: NodeJS.WriteStream, chunk: Buffer) => {
        output += chunk.toString();
        stream.write(chunk);
      };
      child.stdout?.on("data", (chunk: Buffer) => writeOutput(process.stdout, chunk));
      child.stderr?.on("data", (chunk: Buffer) => writeOutput(process.stderr, chunk));
    }

    child.once("error", () => reject(new Error(`${label} could not be started.`)));
    child.once("exit", (code, signal) => {
      if (code === 0 && (!options?.failOnOutput || !options.failOnOutput.test(output))) {
        resolve();
      } else {
        reject(new Error(
          `${label} failed${
            signal ? ` after ${signal}` : ` with exit code ${code ?? "unknown"}`
          }${code === 0 ? " after reporting an error" : ""}.`,
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

async function findProcessGroups(processMarker: string | undefined): Promise<number[]> {
  if (process.platform === "win32" || !processMarker) return [];

  const processEntries = await readdir("/proc", { withFileTypes: true });
  const processIds = processEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const processGroups = new Set<number>();

  await Promise.all(processIds.map(async (processId) => {
    try {
      const environment = await readFile(`/proc/${processId}/environ`, "utf8");
      if (!environment.includes(`${processMarkerEnvironmentName}=${processMarker}\u0000`)) return;
      const processGroupId = await getProcessGroupId(processId);
      if (processGroupId) processGroups.add(processGroupId);
    } catch (error) {
      if (!isFileNotFound(error) && !isProcessInaccessible(error)) throw error;
      // Processes can exit between reading /proc entries and their files.
    }
  }));

  return [...processGroups].sort((left, right) => left - right);
}

async function waitForHttp(
  url: string,
  label: string,
  isInterrupted?: () => boolean,
  abortSignal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (isInterrupted?.()) {
      throw new Error(`${label} was interrupted.`);
    }
    try {
      const response = await fetch(url, { signal: abortSignal });
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
    await stopProcessGroup(child.pid);
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

async function stopProcessGroup(processGroupId: number): Promise<void> {
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
}

async function stopOrphanedHarnessProcesses(processMarker: string | undefined): Promise<void> {
  for (const processGroupId of await findProcessGroups(processMarker)) {
    await stopProcessGroup(processGroupId);
  }
}

export async function recoverInterruptedHarnessDatabases(
  configuration: IsolatedSuiteConfiguration,
  suiteLabel: "browser" | "API" | "API regression",
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

      await stopOrphanedHarnessProcesses(manifest.processMarker);
      await runCommand(
        "dropdb",
        ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, manifest.databaseName],
        process.env,
        `Removing interrupted ${suiteLabel} test database ${manifest.databaseName}`,
      );
      await removeHarnessDatabaseManifest(manifestPath);
      removedDatabaseCount += 1;
      console.log(`Removed interrupted ${suiteLabel} test database ${manifest.databaseName}.`);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `One or more interrupted ${suiteLabel} test databases could not be removed.`,
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
  const processMarker = randomUUID();
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
    processMarker,
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
    [processMarkerEnvironmentName]: processMarker,
    NODE_ENV: "test",
  };
  let databaseMayExist = false;
  let apiProcess: ChildProcess | undefined;
  let webProcess: ChildProcess | undefined;
  let activeCommand: ChildProcess | undefined;
  let interruptedSignal: NodeJS.Signals | undefined;
  let isCleaningUp = false;
  let interruptedProcessCleanup: Promise<void> | undefined;
  const throwIfInterrupted = () => {
    if (interruptedSignal) {
      throw new Error(`Browser checks interrupted by ${interruptedSignal}.`);
    }
  };
  const runBrowserCommand = (
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
    label: string,
    options?: Omit<RunCommandOptions, "onSpawn">,
  ) => {
    throwIfInterrupted();
    return runCommand(command, args, environment, label, {
      ...options,
      onSpawn: (child) => {
        activeCommand = child;
        child.once("close", () => {
          if (activeCommand === child) activeCommand = undefined;
        });
      },
    });
  };
  const onSignal = (signal: NodeJS.Signals) => {
    interruptedSignal ??= signal;
    if (isCleaningUp) return;
    interruptedProcessCleanup ??= Promise.allSettled([
      stopProcess(activeCommand),
      stopProcess(webProcess),
      stopProcess(apiProcess),
    ]).then(() => undefined);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    databaseMayExist = true;
    await runBrowserCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      process.env,
      "Creating the disposable browser test database",
    );

    await runBrowserCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      testEnvironment,
      "Preparing the disposable browser test schema",
      { failOnOutput: /(?:^|\n)error(?: response from server)?:/i },
    );

    apiProcess = startProcess(
      path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx"),
      [path.join(workspaceRoot, "artifacts", "api-server", "src", "test-server.ts")],
      { ...testEnvironment, PORT: String(apiPort) },
      "Disposable API server",
    );
    await waitForHttp(
      `${apiBaseUrl}/api/healthz`,
      "Disposable API server",
      () => Boolean(interruptedSignal),
    );

    throwIfInterrupted();
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
    await waitForHttp(
      webBaseUrl,
      "Disposable browser frontend",
      () => Boolean(interruptedSignal),
    );

    await runBrowserCommand(
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
  } catch (error) {
    if (!interruptedSignal) throw error;
  } finally {
    isCleaningUp = true;
    await interruptedProcessCleanup;
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
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  if (interruptedSignal) {
    process.exitCode = 128 + (interruptedSignal === "SIGINT" ? 2 : 15);
  }
}

export async function runIsolatedApiSuite(
  configuration: IsolatedApiSuiteConfiguration,
): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const databaseName =
    `${configuration.databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const processMarker = randomUUID();
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
    processMarker,
  });
  const testDatabaseUrl = createTestDatabaseUrl(developmentDatabaseUrl, databaseName);
  const testEnvironment = {
    ...process.env,
    ...configuration.environment,
    DATABASE_URL: testDatabaseUrl,
    LUMERA_TEST_DATABASE_URL: testDatabaseUrl,
    [processMarkerEnvironmentName]: processMarker,
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
      { failOnOutput: /(?:^|\n)error(?: response from server)?:/i },
    );
    await runCommand(
      "pnpm",
      ["--filter", "@workspace/scripts", "exec", "tsx", "--test", configuration.testFilePath],
      testEnvironment,
      configuration.testLabel,
    );
  } finally {
    if (databaseMayExist) {
      await runCommand(
        "dropdb",
        ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, databaseName],
        process.env,
        "Removing the disposable API test database",
      );
    }
    // Remove the manifest only after the database has been removed. If cleanup
    // fails, recovery can retry the database removal on a later run.
    await removeHarnessDatabaseManifest(manifestPath);
  }
}

export async function runIsolatedApiRegressionSuite(
  configuration: IsolatedApiRegressionSuiteConfiguration,
): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const databaseName =
    `${configuration.databasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const processMarker = randomUUID();
  const ownerProcessIdentity = await getProcessIdentity(process.pid);
  if (!ownerProcessIdentity) {
    throw new Error("Could not identify the isolated API regression harness process.");
  }
  const manifestPath = await writeHarnessDatabaseManifest(configuration, {
    version: 1,
    databaseName,
    databaseTarget: getDatabaseTarget(developmentDatabaseUrl),
    ownerPid: process.pid,
    ownerProcessIdentity,
    processMarker,
  });
  const testDatabaseUrl = createTestDatabaseUrl(developmentDatabaseUrl, databaseName);
  const apiPort = await findAvailablePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const apiEnvironment = {
    ...process.env,
    ...configuration.environment,
    DATABASE_URL: testDatabaseUrl,
    LUMERA_TEST_DATABASE_URL: testDatabaseUrl,
    [processMarkerEnvironmentName]: processMarker,
    LUMERA_TEST_SEED: "1",
    NODE_ENV: "test",
    PORT: String(apiPort),
  };
  const scriptEnvironment = {
    ...apiEnvironment,
    LUMERA_API_BASE_URL: `${apiBaseUrl}/api`,
  };
  let databaseMayExist = false;
  let apiProcess: ChildProcess | undefined;
  let activeCommand: ChildProcess | undefined;
  let interruptedSignal: NodeJS.Signals | undefined;
  let isCleaningUp = false;
  let interruptedProcessCleanup: Promise<void> | undefined;
  let readinessAbortController: AbortController | undefined;
  const throwIfInterrupted = () => {
    if (interruptedSignal) {
      throw new Error(`API regression checks interrupted by ${interruptedSignal}.`);
    }
  };
  const runRegressionCommand = (
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
    label: string,
    options?: Omit<RunCommandOptions, "onSpawn">,
  ) => {
    throwIfInterrupted();
    return runCommand(command, args, environment, label, {
      ...options,
      onSpawn: (child) => {
        activeCommand = child;
        child.once("close", () => {
          if (activeCommand === child) activeCommand = undefined;
        });
      },
    });
  };
  const onSignal = (signal: NodeJS.Signals) => {
    interruptedSignal ??= signal;
    readinessAbortController?.abort();
    if (isCleaningUp) return;
    interruptedProcessCleanup ??= Promise.allSettled([
      stopProcess(activeCommand),
      stopProcess(apiProcess),
    ]).then(() => undefined);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    databaseMayExist = true;
    await runRegressionCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      process.env,
      "Creating the disposable API regression database",
    );
    await runRegressionCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      apiEnvironment,
      "Preparing the disposable API regression schema",
      { failOnOutput: /(?:^|\n)error(?: response from server)?:/i },
    );

    throwIfInterrupted();
    apiProcess = startProcess(
      path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx"),
      [path.join(workspaceRoot, "artifacts", "api-server", "src", "test-server.ts")],
      apiEnvironment,
      "Disposable API regression server",
    );
    readinessAbortController = new AbortController();
    await waitForHttp(
      `${apiBaseUrl}/api/healthz`,
      "Disposable API regression server",
      () => Boolean(interruptedSignal),
      readinessAbortController.signal,
    );

    for (const scriptPath of configuration.scriptPaths) {
      await runRegressionCommand(
        "bash",
        [path.join(workspaceRoot, scriptPath)],
        scriptEnvironment,
        `${configuration.testLabel}: ${path.basename(scriptPath)}`,
      );
    }
  } catch (error) {
    if (!interruptedSignal) throw error;
  } finally {
    isCleaningUp = true;
    await interruptedProcessCleanup;
    try {
      await stopProcess(apiProcess);
    } finally {
      if (databaseMayExist) {
        await runCommand(
          "dropdb",
          ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, databaseName],
          process.env,
          "Removing the disposable API regression database",
        );
      }
      await removeHarnessDatabaseManifest(manifestPath);
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  if (interruptedSignal) {
    process.exitCode = 128 + (interruptedSignal === "SIGINT" ? 2 : 15);
  }
}

export async function runIsolatedBrowserSuiteCommand(
  configuration: IsolatedBrowserSuiteConfiguration,
): Promise<void> {
  const commandArguments = process.argv.slice(2);
  const command = commandArguments.length === 0
    ? runIsolatedBrowserSuite(configuration)
    : commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases"
      ? recoverInterruptedHarnessDatabases(configuration, "browser")
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
      ? recoverInterruptedHarnessDatabases(configuration, "API")
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

export async function runIsolatedApiRegressionSuiteCommand(
  configuration: IsolatedApiRegressionSuiteConfiguration,
): Promise<void> {
  const commandArguments = process.argv.slice(2);
  const command = commandArguments.length === 0
    ? runIsolatedApiRegressionSuite(configuration)
    : commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases"
      ? recoverInterruptedHarnessDatabases(configuration, "API regression")
      : Promise.reject(new Error(
        `Usage: ${path.basename(process.argv[1] ?? "isolated-api-regressions")} [--recover-interrupted-databases]`,
      ));

  try {
    await command;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}