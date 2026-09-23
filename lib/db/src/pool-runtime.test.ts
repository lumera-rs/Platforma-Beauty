import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSupportedDatabaseUrl,
  createNewClientInitializer,
  safeIdleClientErrorMessage,
  selectDatabaseUrl,
  type DatabaseUrlSelection,
} from "./pool-runtime.ts";

const direct = "postgresql://user:fakepassword@ep-direct.neon.tech/lumera";
const legacy = "postgresql://legacy:fakepassword@legacy.example/lumera";

test("LUMERA_DATABASE_URL wins in every runtime", () => {
  for (const environment of [
    { LUMERA_DATABASE_URL: direct, DATABASE_URL: legacy },
    { NODE_ENV: "production", LUMERA_DATABASE_URL: direct, DATABASE_URL: legacy },
    { REPLIT_DEPLOYMENT: "1", LUMERA_DATABASE_URL: direct, DATABASE_URL: legacy },
  ]) {
    assert.deepEqual(selectDatabaseUrl(environment), {
      connectionString: direct,
      variable: "LUMERA_DATABASE_URL",
    });
  }
});

test("deployment runtimes require LUMERA_DATABASE_URL", () => {
  for (const environment of [
    { NODE_ENV: "production", DATABASE_URL: legacy },
    { REPLIT_DEPLOYMENT: "1", DATABASE_URL: legacy },
    { REPL_DEPLOYMENT: "1", DATABASE_URL: legacy },
  ]) {
    assert.throws(
      () => selectDatabaseUrl(environment),
      /^Error: LUMERA_DATABASE_URL must be set in deployment runtimes\.$/,
    );
  }
});

test("DATABASE_URL remains the outside-deployment fallback", () => {
  assert.deepEqual(selectDatabaseUrl({ DATABASE_URL: legacy }), {
    connectionString: legacy,
    variable: "DATABASE_URL",
  });
  assert.throws(
    () => selectDatabaseUrl({}),
    /^Error: DATABASE_URL must be set outside deployment runtimes\.$/,
  );
});

test("Neon pooler URLs are refused without exposing connection details", () => {
  const values = [
    "postgresql://user:fakepassword@ep-name-pooler.us-east-2.aws.neon.tech/db",
    "postgresql://user:fakepassword@direct.example/db?host=ep-query-pooler.neon.tech",
    "postgresql://user:fakepassword@direct.example/db?host=ep-direct.neon.tech&host=ep-last-pooler.neon.tech",
    "postgresql://user:fakepassword@ep-fallback-pooler.neon.tech/db?host=ep-direct.neon.tech&host=",
    "postgresql://user:fakepassword@ep-dot-pooler.neon.tech./db",
    "postgresql://user:fakepassword@direct.example/db?host=ep-query-dot-pooler.neon.tech.",
    "not a URL containing fakepassword and secret-host",
  ];
  for (const connectionString of values) {
    const selection: DatabaseUrlSelection = {
      connectionString,
      variable: "LUMERA_DATABASE_URL",
    };
    assert.throws(() => assertSupportedDatabaseUrl(selection), (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /LUMERA_DATABASE_URL/);
      if (connectionString.includes("-pooler")) {
        assert.match(error.message, /LISTEN does not work through a -pooler endpoint/);
      }
      assert.doesNotMatch(
        error.message,
        /fakepassword|secret-host|ep-name|ep-query|ep-dot/i,
      );
      return true;
    });
  }
  assert.doesNotThrow(() =>
    assertSupportedDatabaseUrl({
      connectionString: direct,
      variable: "LUMERA_DATABASE_URL",
    }),
  );
  assert.doesNotThrow(() =>
    assertSupportedDatabaseUrl({
      connectionString:
        "postgresql://user:fakepassword@ep-authority-pooler.neon.tech/db?host=ep-direct.neon.tech",
      variable: "LUMERA_DATABASE_URL",
    }),
  );
  assert.doesNotThrow(() =>
    assertSupportedDatabaseUrl({
      connectionString:
        "postgresql://user:fakepassword@direct.example/db?host=ep-first-pooler.neon.tech&host=ep-direct.neon.tech",
      variable: "LUMERA_DATABASE_URL",
    }),
  );
});

test("new-client initializer awaits timeout setup for every client", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const initialize = createNewClientInitializer(30_000);
  for (let client = 0; client < 3; client += 1) {
    let completed = false;
    const pending = initialize({
      async query(sql: string, values?: unknown[]) {
        await Promise.resolve();
        calls.push({ sql, values: values ?? [] });
        completed = true;
        return {} as never;
      },
    } as never);
    assert.equal(completed, false);
    await pending;
    assert.equal(completed, true);
  }
  assert.equal(calls.length, 3);
  assert(calls.every(({ sql }) => sql.includes("set_config")));
  assert.deepEqual(calls.map(({ values }) => values), [
    ["30000"],
    ["30000"],
    ["30000"],
  ]);
});

test("new-client initialization failure is safe", async () => {
  const initialize = createNewClientInitializer(30_000);
  await assert.rejects(
    initialize({
      query() {
        throw new Error(
          "connect fakepassword ep-secret-pooler.us-east-2.aws.neon.tech",
        );
      },
    } as never),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /DB_STMT_TIMEOUT_MS/);
      assert.doesNotMatch(error.message, /fakepassword|ep-secret|neon\.tech/i);
      return true;
    },
  );
});

test("idle-client errors never echo driver connection details", () => {
  const message = safeIdleClientErrorMessage();
  assert.doesNotMatch(message, /fakepassword|secret-host|postgres(?:ql)?:\/\//i);
});