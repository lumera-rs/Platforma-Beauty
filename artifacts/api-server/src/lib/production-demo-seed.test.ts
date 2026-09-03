/**
 * Regression coverage for the CRITICAL fix to demo-account seeding.
 *
 * Before this fix, `ensureDemoData()` (called from nearly every marketplace
 * route, including the public unauthenticated booking widget) would, on any
 * database with zero users, silently insert a set of well-known demo
 * accounts -- including a SUPER_ADMIN ("admin@lumera.local") -- using a
 * password documented in this repository (docs/development.md). That made
 * every freshly-provisioned production database vulnerable to an
 * unauthenticated full-platform takeover by anyone who had read the source.
 *
 * `productionDemoSeedAllowed()` (lib/seed.ts) now gates that entire
 * demo-identity-creation branch: it is allowed unconditionally outside
 * production, and in production only when an operator has explicitly set
 * LUMERA_ALLOW_PRODUCTION_DEMO_SEED=1 (for an intentional showcase/demo
 * deployment). This file verifies both the pure decision function and the
 * real end-to-end HTTP behavior against a genuinely empty, freshly
 * schema-pushed, disposable database and a real running API server -- the
 * same "createdb / push-force / spawn test-server.ts" primitives already
 * used by scripts/src/run-isolated-browser-suite.ts, reimplemented here in a
 * small, self-contained form so this file stays fully additive and does not
 * modify that shared harness.
 *
 * Run:
 *   NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
 *     ../artifacts/api-server/src/lib/production-demo-seed.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { assertDestructiveTestRuntimeAllowed } from "./destructive-test-runtime";
import { PRODUCTION_DEMO_SEED_OPT_IN_ENV, productionDemoSeedAllowed } from "./seed";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const tsxPath = path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");
const testServerPath = path.join(workspaceRoot, "artifacts", "api-server", "src", "test-server.ts");

// -----------------------------------------------------------------------
// Part 1: pure, DB-free coverage of the gating decision itself.
// -----------------------------------------------------------------------

void test("productionDemoSeedAllowed blocks production by default", () => {
  assert.equal(productionDemoSeedAllowed({ NODE_ENV: "production" }), false);
});

void test("productionDemoSeedAllowed allows production only with the exact opt-in value", () => {
  assert.equal(
    productionDemoSeedAllowed({ NODE_ENV: "production", [PRODUCTION_DEMO_SEED_OPT_IN_ENV]: "1" }),
    true,
  );
});

void test("productionDemoSeedAllowed fails safe for near-miss opt-in values", () => {
  const nearMisses = ["true", "TRUE", "yes", "on", "0", "", " 1", "1 "];
  for (const value of nearMisses) {
    assert.equal(
      productionDemoSeedAllowed({ NODE_ENV: "production", [PRODUCTION_DEMO_SEED_OPT_IN_ENV]: value }),
      false,
      `opt-in value ${JSON.stringify(value)} must not enable production demo seeding`,
    );
  }
});

void test("productionDemoSeedAllowed never requires the opt-in outside production", () => {
  for (const nodeEnv of ["test", "development", undefined]) {
    assert.equal(
      productionDemoSeedAllowed(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
      true,
      `NODE_ENV=${nodeEnv ?? "(unset)"} must not require the production opt-in`,
    );
  }
});

void test("the opt-in env var is not silently satisfied by an unrelated truthy env var", () => {
  // Guards against a future edit accidentally keying off the wrong variable
  // name (e.g. a generic "SEED_DEMO_DATA=1") and reintroducing silent
  // production seeding.
  assert.equal(
    productionDemoSeedAllowed({ NODE_ENV: "production", SEED_DEMO_DATA: "1", LUMERA_ALLOW_DEMO: "1" }),
    false,
  );
});

// -----------------------------------------------------------------------
// Part 2: real end-to-end HTTP behavior against a disposable, genuinely
// empty database and a real running API server process.
// -----------------------------------------------------------------------

assertDestructiveTestRuntimeAllowed(process.env, "Production demo-seed guard regression");

const baseDatabaseUrl = process.env.DATABASE_URL;
assert.ok(baseDatabaseUrl, "DATABASE_URL is required to provision disposable regression databases.");

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local TCP port for the disposable API server.");
  }
  return address.port;
}

async function waitForHealthz(apiBaseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/healthz`);
      if (response.ok) return;
      lastError = new Error(`received ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Disposable API server did not become ready within 30 seconds${
      lastError ? ` (${lastError instanceof Error ? lastError.message : String(lastError)})` : ""
    }.`,
  );
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

type DisposableEnvironment = {
  apiBaseUrl: string;
  queryUsers: () => Promise<Array<{ email: string; role: string }>>;
  cleanup: () => Promise<void>;
};

/**
 * Provisions a brand-new, empty (freshly schema-pushed, zero rows), disposable
 * Postgres database and starts a real API server process against it with the
 * given environment. This intentionally reimplements only the small subset of
 * scripts/src/run-isolated-browser-suite.ts's primitives needed here (createdb
 * / push-force / spawn test-server.ts / wait for /api/healthz), so this
 * regression file stays self-contained and never modifies that shared,
 * more general-purpose harness.
 */
async function provisionDisposableApiServer(
  serverEnvironment: Record<string, string>,
): Promise<DisposableEnvironment> {
  const databaseName = `lumera_prod_demo_seed_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const testDatabaseUrl = (() => {
    const url = new URL(baseDatabaseUrl!);
    url.pathname = `/${databaseName}`;
    return url.toString();
  })();

  await execFileAsync("createdb", ["--maintenance-db", baseDatabaseUrl!, databaseName]);

  let databaseExists = true;
  try {
    await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: { ...process.env, DATABASE_URL: testDatabaseUrl } },
    );

    const port = await findAvailablePort();
    const apiBaseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(tsxPath, [testServerPath], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        // The app requires an Anthropic integration to be configured at
        // import time (lib/integrations-anthropic-ai). No test request here
        // ever reaches that code path, so unreachable placeholder values are
        // sufficient to let the server boot; the real production deployment
        // configures its own real credentials independently of this test.
        AI_INTEGRATIONS_ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
        AI_INTEGRATIONS_ANTHROPIC_API_KEY: "unused-in-this-regression-test",
        ...serverEnvironment,
        DATABASE_URL: testDatabaseUrl,
        PORT: String(port),
      },
      stdio: "ignore",
    });
    const startupError = new Promise<never>((_, reject) => {
      child.once("error", (error) => reject(new Error(`Disposable API server could not start: ${error.message}`)));
      child.once("exit", (code, signal) => {
        if (code !== 0 || signal) {
          reject(new Error(`Disposable API server exited early (code=${code ?? "null"}, signal=${signal ?? "null"}).`));
        }
      });
    });

    await Promise.race([waitForHealthz(apiBaseUrl), startupError]);

    const queryUsers = async (): Promise<Array<{ email: string; role: string }>> => {
      const { stdout } = await execFileAsync("psql", [
        testDatabaseUrl,
        "-At",
        "-F", "\t",
        "-c",
        "select email, role from users order by email",
      ]);
      return stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [email, role] = line.split("\t");
          return { email: email ?? "", role: role ?? "" };
        });
    };

    return {
      apiBaseUrl,
      queryUsers,
      cleanup: async () => {
        await stopProcess(child);
        if (databaseExists) {
          databaseExists = false;
          await execFileAsync("dropdb", ["--force", "--if-exists", "--maintenance-db", baseDatabaseUrl!, databaseName]);
        }
      },
    };
  } catch (error) {
    if (databaseExists) {
      databaseExists = false;
      await execFileAsync("dropdb", ["--force", "--if-exists", "--maintenance-db", baseDatabaseUrl!, databaseName]).catch(() => undefined);
    }
    throw error;
  }
}

void test(
  "production + empty database: no request path creates the demo SUPER_ADMIN (auth, public, and widget routes)",
  { timeout: 60_000 },
  async () => {
    const environment = await provisionDisposableApiServer({ NODE_ENV: "production" });
    try {
      // Requirement 1: an unauthenticated request must not seed anything.
      const meResponse = await fetch(`${environment.apiBaseUrl}/api/auth/me`);
      assert.equal(meResponse.status, 200, "GET /auth/me should succeed anonymously");

      // Requirement 1 (public route, non-auth flavor).
      const salonsResponse = await fetch(`${environment.apiBaseUrl}/api/salons`);
      assert.equal(salonsResponse.status, 200, "GET /salons should succeed publicly");

      // Requirement 1 (an auth-flow entry point, exercised with no real account).
      const loginResponse = await fetch(`${environment.apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" }),
      });
      assert.equal(loginResponse.status, 401, "a login attempt with no existing account must fail, not seed one");

      // Requirement 2: the public, unauthenticated booking widget must not
      // trigger demo-account creation either, even against a nonexistent slug.
      const widgetResponse = await fetch(`${environment.apiBaseUrl}/api/widget/salons/does-not-exist`);
      assert.equal(widgetResponse.status, 404, "the widget route should 404 for an unknown salon, not error");

      // Requirement 1 & 3: after every one of the above, the database must
      // still have zero users -- in particular, no admin@lumera.local
      // SUPER_ADMIN and no other predictable demo account.
      const users = await environment.queryUsers();
      assert.deepEqual(
        users,
        [],
        "a fresh production database must gain no users at all from ordinary request traffic",
      );
    } finally {
      await environment.cleanup();
    }
  },
);

void test(
  "production + explicit operator opt-in: demo identities are created only then, and observably (not silently)",
  { timeout: 60_000 },
  async () => {
    const environment = await provisionDisposableApiServer({
      NODE_ENV: "production",
      [PRODUCTION_DEMO_SEED_OPT_IN_ENV]: "1",
    });
    try {
      const response = await fetch(`${environment.apiBaseUrl}/api/auth/me`);
      assert.equal(response.status, 200);

      const users = await environment.queryUsers();
      const admin = users.find((user) => user.email === "admin@lumera.local");
      assert.ok(admin, "an operator who explicitly opts in must still get the intentional showcase demo set");
      assert.equal(admin?.role, "SUPER_ADMIN");
    } finally {
      await environment.cleanup();
    }
  },
);

void test(
  "development/test workflows keep seeding demo accounts exactly as before, unaffected by the production gate",
  { timeout: 60_000 },
  async () => {
    const environment = await provisionDisposableApiServer({ NODE_ENV: "test" });
    try {
      const response = await fetch(`${environment.apiBaseUrl}/api/auth/me`);
      assert.equal(response.status, 200);

      const users = await environment.queryUsers();
      const admin = users.find((user) => user.email === "admin@lumera.local");
      const educationOwner = users.find((user) => user.email === "edukacija@lumera.local");
      assert.ok(admin, "non-production environments must keep seeding the demo SUPER_ADMIN as before");
      assert.equal(admin?.role, "SUPER_ADMIN");
      assert.ok(educationOwner, "non-production environments must keep seeding the rest of the demo identities");
    } finally {
      await environment.cleanup();
    }
  },
);
