import assert from "node:assert/strict";
import test from "node:test";

type HeldClient = {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: () => void;
};

async function proveApplicationPoolTimeoutLifecycle(
  pool: {
    connect: () => Promise<HeldClient>;
    options?: { statement_timeout?: unknown };
  },
): Promise<void> {
  assert.equal(
    pool.options?.statement_timeout,
    undefined,
    "the application pool must not send statement_timeout as a startup parameter",
  );

  const clients = await Promise.all(
    Array.from({ length: 4 }, () => pool.connect()),
  );
  try {
    const observations = await Promise.all(clients.map(async (client) => {
      await client.query("BEGIN TRANSACTION READ ONLY");
      try {
        const shown = await client.query("SHOW statement_timeout");
        const pid = await client.query("SELECT pg_catalog.pg_backend_pid() AS pid");
        return {
          shown: shown.rows[0]?.statement_timeout,
          pid: pid.rows[0]?.pid,
        };
      } finally {
        await client.query("ROLLBACK");
      }
    }));

    assert.equal(new Set(observations.map(({ pid }) => pid)).size, clients.length);
    for (const observation of observations) assert.equal(observation.shown, "30s");

    const client = clients[0]!;
    const normalTimeout = observations[0]!.shown;
    await client.query("BEGIN TRANSACTION READ ONLY");
    try {
      await client.query("SET LOCAL statement_timeout = '100ms'");
      await assert.rejects(
        client.query("SELECT pg_catalog.pg_sleep(1)"),
        (error: unknown) => (
          typeof error === "object"
          && error !== null
          && "code" in error
          && error.code === "57014"
        ),
      );
    } finally {
      await client.query("ROLLBACK");
    }

    const restored = await client.query("SHOW statement_timeout");
    assert.equal(restored.rows[0]?.statement_timeout, normalTimeout);
    const normalQuery = await client.query("SELECT 1 AS value");
    assert.equal(normalQuery.rows[0]?.value, 1);
  } finally {
    for (const client of clients) client.release();
  }
}

test("the application pool preserves defaults and transaction-local timeout restores", async () => {
  assert.ok(process.env.LUMERA_DISPOSABLE_DATABASE);
  assert.equal(process.env.DATABASE_URL, process.env.LUMERA_DISPOSABLE_DATABASE);
  process.env.DB_POOL_MAX = "4";
  process.env.DB_POOL_MIN = "0";
  process.env.DB_STMT_TIMEOUT_MS = "30000";

  const moduleSpecifier = process.env.LUMERA_EXTERNAL_DATABASE_TEST_MODULE
    ?? "@workspace/db";
  if (moduleSpecifier !== "@workspace/db") {
    assert.match(moduleSpecifier, /^file:\/\/\/.*\/src\/index\.ts$/u);
  }
  const applicationDatabase: typeof import("@workspace/db") = await import(
    moduleSpecifier
  );
  try {
    await proveApplicationPoolTimeoutLifecycle(applicationDatabase.pool);
  } finally {
    await applicationDatabase.closePool();
  }
});