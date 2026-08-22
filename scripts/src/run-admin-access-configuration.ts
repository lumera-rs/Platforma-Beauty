import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const testDatabasePrefix = "lumera_admin_browser_";

function requireDevelopmentDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create the disposable admin browser test database.");
  }

  const parsed = new URL(databaseUrl);
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return databaseUrl;
}

function createTestDatabaseUrl(developmentDatabaseUrl: string, databaseName: string): string {
  const url = new URL(developmentDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
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
  if (!child || child.exitCode !== null || child.killed) return;

  child.kill("SIGTERM");
  const exited = Promise.race([
    once(child, "exit").then(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
  ]);
  await exited;

  if (child.exitCode === null && !child.killed) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function run(): Promise<void> {
  const developmentDatabaseUrl = requireDevelopmentDatabaseUrl();
  const databaseName = `${testDatabasePrefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
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
  let databaseCreated = false;
  let apiProcess: ChildProcess | undefined;
  let webProcess: ChildProcess | undefined;

  try {
    await runCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      process.env,
      "Creating the disposable admin browser test database",
    );
    databaseCreated = true;

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
    await stopProcess(webProcess);
    await stopProcess(apiProcess);

    if (databaseCreated) {
      await runCommand(
        "dropdb",
        ["--force", "--if-exists", "--maintenance-db", developmentDatabaseUrl, databaseName],
        process.env,
        "Removing the disposable admin browser test database",
      );
    }
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});