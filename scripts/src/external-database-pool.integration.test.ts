import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

type HeldClient = {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: () => void;
};

const deploymentKeys = [
  "NODE_ENV",
  "REPLIT_DEPLOYMENT",
  "REPL_DEPLOYMENT",
  "REPLIT_DEPLOYMENT_ID",
  "REPL_DEPLOYMENT_ID",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSSLMODE",
] as const;

async function withFakePostgresTarget(): Promise<{
  url: string;
  attempts: () => number;
  close: () => Promise<void>;
}> {
  let connectionAttempts = 0;
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    connectionAttempts += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.destroy();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    url: `postgresql://fixture:fixture@127.0.0.1:${address.port}/lumera_ci_database?sslmode=disable`,
    attempts: () => connectionAttempts,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

async function importApplicationAndAttemptConnection(
  databaseUrl: string,
  lumeraDatabaseUrl: string,
  deployment: boolean,
): Promise<void> {
  const environment = { ...process.env };
  for (const key of deploymentKeys) delete environment[key];
  Object.assign(environment, {
    DATABASE_URL: databaseUrl,
    LUMERA_DATABASE_URL: lumeraDatabaseUrl,
    DB_CONN_TIMEOUT_MS: "500",
    DB_POOL_MAX: "4",
    DB_POOL_MIN: "0",
  });
  if (deployment) environment.REPLIT_DEPLOYMENT = "1";

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      [
        "const applicationDatabase = await import(process.env.LUMERA_EXTERNAL_DATABASE_TEST_MODULE ?? '@workspace/db');",
        "try { await applicationDatabase.pool.connect(); } catch {}",
        "finally { await applicationDatabase.closePool(); }",
      ].join(" "),
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const [exitCode] = await once(child, "exit");
  assert.equal(
    exitCode,
    0,
    "application pool probe child exited unsuccessfully",
  );
  void stdout;
  void stderr;
}

test("actual application pool selects only the runtime-authorized URL", async () => {
  for (const deployment of [false, true]) {
    const databaseTarget = await withFakePostgresTarget();
    const overrideTarget = await withFakePostgresTarget();
    try {
      await importApplicationAndAttemptConnection(
        databaseTarget.url,
        overrideTarget.url,
        deployment,
      );
      assert.equal(
        databaseTarget.attempts(),
        deployment ? 0 : 1,
        "DATABASE_URL must have zero network attempts when bypassed",
      );
      assert.equal(
        overrideTarget.attempts(),
        deployment ? 1 : 0,
        "LUMERA_DATABASE_URL must have zero network attempts when bypassed",
      );
    } finally {
      await Promise.all([databaseTarget.close(), overrideTarget.close()]);
    }
  }
});

async function importApplicationExpectingPreconnectionRefusal(
  lumeraDatabaseUrl: string,
  pgHost: string,
  pgPort: string,
): Promise<{ connectionAttempts: number; safeError?: string }> {
  const environment = { ...process.env };
  for (const key of deploymentKeys) delete environment[key];
  Object.assign(environment, {
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/lumera_ci_database?sslmode=disable",
    LUMERA_DATABASE_URL: lumeraDatabaseUrl,
    REPLIT_DEPLOYMENT: "1",
    PGHOST: pgHost,
    PGPORT: pgPort,
  });

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      [
        "const { Socket } = await import('node:net');",
        "let connectionAttempts = 0;",
        "const originalConnect = Socket.prototype.connect;",
        "Socket.prototype.connect = function (...args) { connectionAttempts += 1; return originalConnect.apply(this, args); };",
        "let safeError;",
        "try { await import(process.env.LUMERA_EXTERNAL_DATABASE_TEST_MODULE ?? '@workspace/db'); }",
        "catch (error) { safeError = error instanceof Error ? error.message : undefined; }",
        "finally { Socket.prototype.connect = originalConnect; }",
        "process.stdout.write(JSON.stringify({ connectionAttempts, safeError }));",
      ].join(" "),
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const [exitCode] = await once(child, "exit");
  assert.equal(
    exitCode,
    0,
    "preconnection-refusal child exited unsuccessfully",
  );
  assert.equal(stderr.length, 0, "preconnection-refusal child wrote diagnostics");
  try {
    return JSON.parse(Buffer.concat(stdout).toString()) as {
      connectionAttempts: number;
      safeError?: string;
    };
  } catch {
    throw new Error("preconnection-refusal child returned an invalid result");
  }
}

test("actual application import refuses invalid deployment overrides with zero network attempts", async () => {
  const pgFallbackTarget = await withFakePostgresTarget();
  try {
    const port = new URL(pgFallbackTarget.url).port;
    const cases = [
      {
        connectionString:
          "postgresql://fixture:fixture@ep%2Dencoded%2Dpooler.neon.tech/lumera",
        expectedError:
          "LUMERA_DATABASE_URL must use a direct Neon endpoint; LISTEN does not work through a -pooler endpoint.",
      },
      {
        connectionString: "postgresql:///lumera",
        expectedError:
          "LUMERA_DATABASE_URL must include an explicit database host.",
      },
      {
        connectionString: "postgresql:///lumera?host=",
        expectedError:
          "LUMERA_DATABASE_URL must include an explicit database host.",
      },
    ];
    for (const testCase of cases) {
      const result = await importApplicationExpectingPreconnectionRefusal(
        testCase.connectionString,
        "127.0.0.1",
        port,
      );
      assert.deepEqual(result, {
        connectionAttempts: 0,
        safeError: testCase.expectedError,
      });
      assert.equal(
        pgFallbackTarget.attempts(),
        0,
        "PGHOST fallback target must have zero network attempts",
      );
    }
  } finally {
    await pgFallbackTarget.close();
  }
});

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