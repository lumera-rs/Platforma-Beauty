import assert from "node:assert/strict";
import test from "node:test";
import { assertDestructiveTestRuntimeAllowed } from "./destructive-test-runtime";

const dummyUrl = (databaseName: string): string =>
  `postgresql://test-user:test-password@invalid.example/${databaseName}`;

test("refuses an ordinary database target", () => {
  assert.throws(
    () => assertDestructiveTestRuntimeAllowed(
      { DATABASE_URL: dummyUrl("heliumdb") },
      "guard unit test",
    ),
    (error: unknown) => error instanceof Error
      && /refuse non-disposable database targets/.test(error.message)
      && error.message.includes('database "heliumdb"'),
  );
});

test("allows an empty or unset database target", () => {
  assert.doesNotThrow(() => assertDestructiveTestRuntimeAllowed({}));
  assert.doesNotThrow(() => assertDestructiveTestRuntimeAllowed({ DATABASE_URL: "" }));
});

test("allows both fixed CI database names", () => {
  for (const name of ["lumera_ci_database", "lumera_ci_browser"]) {
    assert.doesNotThrow(() =>
      assertDestructiveTestRuntimeAllowed({ DATABASE_URL: dummyUrl(name) }));
  }
});

test("allows a Playwright disposable database name", () => {
  assert.doesNotThrow(() => assertDestructiveTestRuntimeAllowed({
    DATABASE_URL: dummyUrl(
      "lumera_retention_exact_browser_123_0123456789abcdef0123456789abcdef",
    ),
  }));
  assert.doesNotThrow(() => assertDestructiveTestRuntimeAllowed({
    DATABASE_URL:
      "postgresql://test-user:test-password@invalid.example/"
      + "lumera%5Fadmin%5Fbrowser%5F123%5F0123456789abcdef0123456789abcdef",
  }));
});

test("allows an exact disposable marker match", () => {
  const databaseUrl = dummyUrl("explicitly_marked_database");
  assert.doesNotThrow(() => assertDestructiveTestRuntimeAllowed({
    DATABASE_URL: databaseUrl,
    LUMERA_DISPOSABLE_DATABASE: databaseUrl,
  }));
});

test("refuses a mismatched disposable marker", () => {
  assert.throws(() => assertDestructiveTestRuntimeAllowed({
    DATABASE_URL: dummyUrl("heliumdb"),
    LUMERA_DISPOSABLE_DATABASE: dummyUrl("another_database"),
  }));
});

test("fails closed for ambiguous or malformed URLs without leaking credentials", () => {
  const password = "never-print-this-password";
  const targets = [
    `postgresql://user:${password}@invalid.example/lumera_ci_database?database=heliumdb`,
    `postgresql://user:${password}@invalid.example/lumera_ci_database?dbname=heliumdb`,
    `not a URL containing ${password}`,
  ];

  for (const DATABASE_URL of targets) {
    assert.throws(
      () => assertDestructiveTestRuntimeAllowed({ DATABASE_URL }),
      (error: unknown) => error instanceof Error
        && !error.message.includes(password)
        && !error.message.includes(DATABASE_URL)
        && error.message.includes(
          DATABASE_URL.startsWith("not a URL")
            ? "database name unknown/malformed"
            : "database name unknown/ambiguous",
        ),
    );
  }
});

test("production refusal wins before database target inspection", () => {
  const inaccessibleTargetEnvironment = {
    NODE_ENV: "production",
    get DATABASE_URL(): string {
      throw new Error("database target was inspected");
    },
  };

  assert.throws(
    () => assertDestructiveTestRuntimeAllowed(inaccessibleTargetEnvironment),
    /refuse production or deployment runtimes/,
  );

  const explicitlyMarkedUrl = dummyUrl("explicitly_marked_database");
  assert.throws(
    () => assertDestructiveTestRuntimeAllowed({
      NODE_ENV: "production",
      DATABASE_URL: explicitlyMarkedUrl,
      LUMERA_DISPOSABLE_DATABASE: explicitlyMarkedUrl,
    }),
    /refuse production or deployment runtimes/,
  );
});

test("guard decision is synchronous and makes no connection", () => {
  let connectionAttempts = 0;
  const guardedConnect = (environment: NodeJS.ProcessEnv): void => {
    assertDestructiveTestRuntimeAllowed(environment);
    connectionAttempts += 1;
  };

  assert.throws(() => guardedConnect({ DATABASE_URL: dummyUrl("heliumdb") }));
  assert.equal(connectionAttempts, 0);
});