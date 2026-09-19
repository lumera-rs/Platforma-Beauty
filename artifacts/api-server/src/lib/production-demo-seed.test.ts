/**
 * Production demo-fixture safety regression suite.
 *
 * This suite is intentionally DB-free.  The former version created a
 * database and ran schema-changing setup; that is not an acceptable safety
 * test because it exercised migration machinery and could be pointed at
 * persistent workspace data.  The harness below bundles app.ts
 * against a controlled in-memory adapter, removes DATABASE_URL from every
 * child process, and records mutations for behavioral assertions.
 *
 * The app is imported directly, never through index.ts.  This keeps startup
 * DDL, workers, listeners, and production bootstrap out of the harness.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  disposeIsolatedHarness,
  runSeedFacadeInFreshProcess,
  runSeedFacadeWithFixtureSpy,
  startIsolatedHttpServer,
  type IsolatedDbSnapshot,
  type IsolatedHttpServer,
  type IsolatedWrite,
} from "./production-demo-seed-isolated-harness";

const apiServerRoot = path.resolve(import.meta.dirname, "..", "..");
const routesRoot = path.join(apiServerRoot, "src", "routes");

const DEMO_FIXTURE_TABLES = new Set([
  "salons",
  "serviceCategories",
  "services",
  "employees",
  "employeeServices",
  "employeeLocationAssignments",
  "salonHours",
  "appointments",
  "salonCustomers",
  "products",
  "productCategories",
  "productBrands",
  "salonBrands",
  "educationCenters",
  "educationInstructors",
  "courses",
  "courseCategories",
  "beautyJobListings",
  "educationSections",
  "educationSubcategories",
  "educationCourseTypes",
]);
const ALLOWED_AUTH_WRITE_TABLES = new Set([
  "customerPasswordSetupRateLimits",
  "phoneVerificationProofs",
  "sessions",
  "users",
]);

function forbiddenDemoWrites(snapshot: IsolatedDbSnapshot): IsolatedWrite[] {
  return snapshot.writes.filter((write) => {
    if (DEMO_FIXTURE_TABLES.has(write.table)) return true;
    if (write.table !== "users") return false;
    return write.rows.some((row) => {
      const email = typeof row === "object" && row !== null && "email" in row
        ? String((row as { email?: unknown }).email ?? "")
        : "";
      return email.endsWith("@lumera.local");
    });
  });
}

async function jsonResponse(
  server: IsolatedHttpServer,
  pathname: string,
  init?: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${server.baseUrl}${pathname}`, init);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

function jsonRequestBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function assertNoForbiddenWrites(server: IsolatedHttpServer): Promise<IsolatedDbSnapshot> {
  const snapshot = await server.snapshot();
  assert.deepEqual(
    forbiddenDemoWrites(snapshot),
    [],
    `ordinary production traffic created demo writes: ${JSON.stringify(snapshot.writes)}`,
  );
  assert.ok(
    snapshot.writes.every((write) =>
      DEMO_FIXTURE_TABLES.has(write.table) || ALLOWED_AUTH_WRITE_TABLES.has(write.table)),
    `unexpected non-auth mutation in isolated production traffic: ${JSON.stringify(snapshot.writes)}`,
  );
  return snapshot;
}

after(async () => {
  await disposeIsolatedHarness();
});

test("production ensureDemoData is a DB-free no-op even with the old opt-in", async () => {
  const result = await runSeedFacadeInFreshProcess({
    NODE_ENV: "production",
    LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /LUMERA_SEED_DONE/);
  assert.doesNotMatch(result.stdout, /LUMERA_SEED_ERROR/);
});

test("production ensureDemoData does not reconcile an existing account or salon", async () => {
  const result = await runSeedFacadeWithFixtureSpy({
    NODE_ENV: "production",
    LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    LUMERA_INERT_DB_MODE: "existing",
  });
  assert.equal(result.code, 0, result.stderr);
  const snapshotLine = result.stdout.match(/LUMERA_DB_SNAPSHOT:(\{.*\})/);
  assert.ok(snapshotLine, result.stdout);
  const snapshot = JSON.parse(snapshotLine[1]!) as IsolatedDbSnapshot;
  assert.deepEqual(snapshot.users, [{ id: "real-user-1", email: "real@example.test", role: "CUSTOMER" }]);
  assert.deepEqual(snapshot.salons, [{ id: "real-salon-1", slug: "real-salon", name: "Stvarni salon" }]);
  assert.deepEqual(forbiddenDemoWrites(snapshot), []);
});

test("strict fixture initialization refuses production before importing a database", async () => {
  const result = await runSeedFacadeInFreshProcess(
    {
      NODE_ENV: "production",
      LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    },
    "initialize",
  );
  assert.equal(result.code, 2, result.stdout);
  assert.match(result.stderr, /Development\/test fixtures require NODE_ENV=development or NODE_ENV=test/);
});

test("deployment markers cannot turn NODE_ENV=test into a production fixture runtime", async () => {
  for (const marker of ["REPLIT_DEPLOYMENT", "REPL_DEPLOYMENT"]) {
    const result = await runSeedFacadeInFreshProcess({
      NODE_ENV: "test",
      [marker]: "1",
      LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    });
    assert.equal(result.code, 0, `${marker}: ${result.stderr}`);
    assert.match(result.stdout, /LUMERA_SEED_DONE/);
  }
});

test("explicit development and test fixture entry points are the only positive path", async () => {
  for (const nodeEnv of ["development", "test"]) {
    const result = await runSeedFacadeWithFixtureSpy({ NODE_ENV: nodeEnv }, "initialize");
    assert.equal(result.code, 0, `${nodeEnv}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`LUMERA_FIXTURE_SPY:${nodeEnv}`));
    assert.match(result.stdout, /LUMERA_FIXTURE_DONE/);
  }
});

test("ordinary production HTTP requests do not seed an empty database", async () => {
  const server = await startIsolatedHttpServer({
    NODE_ENV: "production",
    LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    LUMERA_INERT_DB_MODE: "empty",
    DATABASE_URL: "postgres://must-not-reach-a-database",
    OPENAI_API_KEY: "must-not-reach-a-provider",
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: "must-not-reach-a-provider",
  });
  try {
    const network = await jsonResponse(server, "/__inert-network-control");
    assert.equal(network.response.status, 204);
    assert.equal(network.response.headers.get("x-isolated-network"), "blocked");

    const salons = await jsonResponse(server, "/api/salons");
    assert.equal(salons.response.status, 200);
    assert.deepEqual(salons.body, []);

    const profile = await jsonResponse(server, "/api/salons/does-not-exist");
    assert.equal(profile.response.status, 404);

    const widget = await jsonResponse(server, "/api/widget/salons/does-not-exist");
    assert.equal(widget.response.status, 404);

    const login = await jsonResponse(
      server,
      "/api/auth/login",
      jsonRequestBody({ email: "nobody@example.test", password: "wrong-password" }),
    );
    assert.equal(login.response.status, 401);

    const register = await jsonResponse(
      server,
      "/api/auth/register",
      jsonRequestBody({
        firstName: "Nova",
        lastName: "Korisnica",
        email: "new@example.test",
        password: "strong-password",
        phone: "+381612345678",
        phoneVerificationCode: "123456",
      }),
    );
    assert.equal(register.response.status, 400, "without a verification row registration must not invent one");

    const privateRoute = await jsonResponse(server, "/api/customer/dashboard");
    assert.equal(privateRoute.response.status, 401);

    const snapshot = await assertNoForbiddenWrites(server);
    assert.deepEqual(snapshot.users, []);
    assert.deepEqual(snapshot.salons, []);
    assert.ok(
      snapshot.writes.every((write) => write.operation === "auth-rate-limit-write"),
      `ordinary anonymous auth traffic emitted an unexpected write: ${JSON.stringify(snapshot.writes)}`,
    );
  } finally {
    await server.close();
  }
});

test("existing production data is returned unchanged and never reconciled as demo data", async () => {
  const server = await startIsolatedHttpServer({
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
    LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    LUMERA_INERT_DB_MODE: "existing",
  });
  try {
    const before = await server.snapshot();
    assert.equal((before.rowsByTable.salons as Array<{ servesMen?: boolean }>)[0]?.servesMen, false);
    assert.equal((before.rowsByTable.services as Array<{ price?: number; promoPrice?: number }>)[0]?.price, 2400);
    assert.equal((before.rowsByTable.services as Array<{ promoPrice?: number }>)[0]?.promoPrice, 2100);
    assert.equal((before.rowsByTable.products as Array<{ price?: number; retailEnabled?: boolean }>)[0]?.price, 1800);
    assert.equal((before.rowsByTable.products as Array<{ retailEnabled?: boolean }>)[0]?.retailEnabled, true);
    assert.equal((before.rowsByTable.employees as Array<{ id?: string }>)[0]?.id, "real-employee-1");
    assert.equal((before.rowsByTable.salonCustomers as Array<{ userId?: string }>)[0]?.userId, "real-user-1");

    const salons = await jsonResponse(server, "/api/salons");
    assert.equal(salons.response.status, 200);
    assert.ok(Array.isArray(salons.body));
    assert.equal((salons.body as Array<{ slug?: string }>)[0]?.slug, "real-salon");

    const profile = await jsonResponse(server, "/api/salons/real-salon");
    assert.equal(profile.response.status, 200, JSON.stringify({ body: profile.body, diagnostics: server.diagnostics() }));
    assert.equal((profile.body as { slug?: string }).slug, "real-salon");
    assert.equal((profile.body as { name?: string }).name, "Stvarni salon");

    const widget = await jsonResponse(server, "/api/widget/salons/real-salon");
    assert.equal(widget.response.status, 200);
    assert.equal((widget.body as { slug?: string }).slug, "real-salon");
    assert.deepEqual(
      (widget.body as { services?: Array<{ id?: string; price?: number; promoPrice?: number }> }).services,
      [{ id: "real-service-1", name: "Stvarno šišanje", durationMinutes: 60, price: 2400, promoPrice: 2100, categoryName: "Šišanje" }],
    );
    assert.deepEqual(
      (widget.body as { employees?: Array<{ id?: string }> }).employees,
      [{ id: "real-employee-1", name: "Stvarna Zaposlena", role: "Frizerka", serviceIds: ["real-service-1"] }],
    );

    const login = await jsonResponse(
      server,
      "/api/auth/login",
      jsonRequestBody({ email: "real@example.test", password: "wrong-password" }),
    );
    assert.equal(login.response.status, 401);

    const privateRoute = await jsonResponse(server, "/api/customer/dashboard");
    assert.equal(privateRoute.response.status, 401);

    const snapshot = await assertNoForbiddenWrites(server);
    assert.deepEqual(snapshot.users, [{ id: "real-user-1", email: "real@example.test", role: "CUSTOMER" }]);
    assert.deepEqual(snapshot.salons, [{ id: "real-salon-1", slug: "real-salon", name: "Stvarni salon" }]);
    assert.deepEqual(snapshot.rowsByTable.salons, before.rowsByTable.salons);
    assert.deepEqual(snapshot.rowsByTable.services, before.rowsByTable.services);
    assert.deepEqual(snapshot.rowsByTable.employees, before.rowsByTable.employees);
    assert.deepEqual(snapshot.rowsByTable.employeeServices, before.rowsByTable.employeeServices);
    assert.deepEqual(snapshot.rowsByTable.salonCustomers, before.rowsByTable.salonCustomers);
    assert.deepEqual(snapshot.rowsByTable.products, before.rowsByTable.products);
    assert.deepEqual(snapshot.rowsByTable.productCategories, before.rowsByTable.productCategories);
    assert.ok(
      snapshot.writes.every((write) => write.operation === "auth-rate-limit-write"),
      `existing-data traffic emitted an unexpected write: ${JSON.stringify(snapshot.writes)}`,
    );
  } finally {
    await server.close();
  }
});

test("isolated adapter captures ORM demo writes and denies raw SQL demo writes", async () => {
  const server = await startIsolatedHttpServer({
    NODE_ENV: "production",
    LUMERA_INERT_DB_MODE: "empty",
  });
  try {
    const orm = await jsonResponse(server, "/__inert-db-negative-control/orm", { method: "POST" });
    assert.equal(orm.response.status, 204);
    let snapshot = await server.snapshot();
    assert.ok(snapshot.writes.some((write) => write.operation === "insert" && write.table === "salons"));
    assert.ok(snapshot.writes.some((write) => write.table === "salons" && write.rows.some((row) =>
      typeof row === "object" && row !== null && "id" in row && (row as { id?: unknown }).id === "negative-control-salon",
    )));

    const raw = await jsonResponse(server, "/__inert-db-negative-control/raw", { method: "POST" });
    assert.equal(raw.response.status, 500);
    assert.match(String((raw.body as { error?: unknown }).error), /Raw SQL writes are denied/);
    snapshot = await server.snapshot();
    assert.ok(snapshot.writes.some((write) => write.operation === "raw-write" && write.table === "raw-sql"));
  } finally {
    await server.close();
  }
});

test("legitimate registration may write its one real account but cannot trigger demo fixture writes", async () => {
  const server = await startIsolatedHttpServer({
    NODE_ENV: "production",
    LUMERA_INERT_DB_MODE: "registration",
  });
  try {
    const register = await jsonResponse(
      server,
      "/api/auth/register",
      jsonRequestBody({
        firstName: "Nova",
        lastName: "Korisnica",
        email: "new@example.test",
        password: "strong-password",
        phone: "+381612345678",
        phoneVerificationCode: "123456",
      }),
    );
    assert.equal(register.response.status, 201);
    assert.equal((register.body as { user?: { email?: string; role?: string } }).user?.email, "new@example.test");
    assert.equal((register.body as { user?: { role?: string } }).user?.role, "CUSTOMER");

    const snapshot = await assertNoForbiddenWrites(server);
    assert.deepEqual(snapshot.users, [{ id: "registered-user-1", email: "new@example.test", role: "CUSTOMER" }]);
    assert.ok(
      snapshot.writes.some((write) => write.table === "users" && write.operation === "insert"),
      "the harness must prove that real registration is still allowed rather than suppressing all writes",
    );
    assert.ok(
      snapshot.writes.every((write) =>
        write.operation === "auth-rate-limit-write" || ALLOWED_AUTH_WRITE_TABLES.has(write.table)),
      `registration emitted an unexpected write: ${JSON.stringify(snapshot.writes)}`,
    );
  } finally {
    await server.close();
  }
});

test("two fresh HTTP processes remain safe independently", async () => {
  const servers = await Promise.all([
    startIsolatedHttpServer({
      NODE_ENV: "production",
      LUMERA_INERT_DB_MODE: "empty",
      LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    }),
    startIsolatedHttpServer({
      NODE_ENV: "production",
      LUMERA_INERT_DB_MODE: "empty",
      LUMERA_ALLOW_PRODUCTION_DEMO_SEED: "1",
    }),
  ]);
  try {
    const responses = await Promise.all(servers.map((server) => jsonResponse(server, "/api/salons")));
    assert.deepEqual(responses.map(({ response }) => response.status), [200, 200]);
    const snapshots = await Promise.all(servers.map((server) => assertNoForbiddenWrites(server)));
    assert.deepEqual(snapshots.map((snapshot) => snapshot.users), [[], []]);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.salons), [[], []]);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test("route modules and authentication helpers have no fixture dependency", async () => {
  const entries = await readdir(routesRoot, { recursive: true, withFileTypes: true });
  const routeFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));
  routeFiles.push(path.join(apiServerRoot, "src", "lib", "auth.ts"));
  const sources = await Promise.all(routeFiles.map((file) => readFile(file, "utf8")));

  for (const source of sources) {
    assert.doesNotMatch(source, /\bensureDemoData\s*\(/, "HTTP/auth code must not call the fixture facade");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:\/|\\)seed(?:["']|["']\s*;)/,
      "HTTP/auth code must not import the fixture facade",
    );
  }
});