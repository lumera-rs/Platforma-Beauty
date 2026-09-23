import assert from "node:assert/strict";
import { Socket } from "node:net";

const mode = process.argv[2];
if (mode !== "direct" && mode !== "pooler-refusal") {
  throw new Error("Usage: external-database-pool.proof.ts <direct|pooler-refusal>");
}

function selectAuthorizedTarget(name: "LUMERA_NEON_TEST_URL" | "LUMERA_NEON_TEST_POOLER_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing authorized secret ${name}`);

  delete process.env.DATABASE_URL;
  delete process.env.LUMERA_DATABASE_URL;
  delete process.env.PGDATABASE;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  process.env.LUMERA_DATABASE_URL = value;
  return value;
}

async function proveDirectRoute(): Promise<void> {
  selectAuthorizedTarget("LUMERA_NEON_TEST_URL");
  process.env.DB_POOL_MAX = "4";
  process.env.DB_POOL_MIN = "0";
  process.env.DB_STMT_TIMEOUT_MS = "30000";

  const applicationDatabase = await import("@workspace/db");
  const clients = await Promise.all(
    Array.from({ length: 4 }, () => applicationDatabase.pool.connect()),
  );
  let evidence: Record<string, unknown> | undefined;
  try {
    assert.equal(
      (applicationDatabase.pool.options as unknown as Record<string, unknown>).statement_timeout,
      undefined,
    );

    const observations = await Promise.all(clients.map(async (client) => {
      await client.query("BEGIN TRANSACTION READ ONLY");
      try {
        const shown = await client.query("SHOW statement_timeout");
        const pid = await client.query("SELECT pg_catalog.pg_backend_pid() AS pid");
        const readOnly = await client.query("SHOW transaction_read_only");
        return {
          shown: shown.rows[0]?.statement_timeout,
          pid: pid.rows[0]?.pid,
          readOnly: readOnly.rows[0]?.transaction_read_only,
        };
      } finally {
        await client.query("ROLLBACK");
      }
    }));

    assert.equal(new Set(observations.map(({ pid }) => pid)).size, clients.length);
    for (const observation of observations) {
      assert.equal(observation.readOnly, "on");
      assert.equal(observation.shown, "30s");
    }

    const client = clients[0]!;
    const normalTimeout = observations[0]!.shown;
    await client.query("BEGIN TRANSACTION READ ONLY");
    let cancellationCode: string | undefined;
    try {
      await client.query("SET LOCAL statement_timeout = '100ms'");
      await client.query("SELECT pg_catalog.pg_sleep(1)");
    } catch (error) {
      cancellationCode = (
        typeof error === "object" && error !== null && "code" in error
      ) ? String(error.code) : undefined;
    } finally {
      await client.query("ROLLBACK");
    }
    assert.equal(cancellationCode, "57014");

    const restored = await client.query("SHOW statement_timeout");
    assert.equal(restored.rows[0]?.statement_timeout, normalTimeout);
    assert.equal((await client.query("SELECT 1 AS value")).rows[0]?.value, 1);

    evidence = {
      result: "pass",
      route: "authorized-direct",
      heldFreshClients: clients.length,
      distinctBackends: new Set(observations.map(({ pid }) => pid)).size,
      transactionReadOnly: observations.every(({ readOnly }) => readOnly === "on"),
      configuredTimeoutPreserved: observations.every(({ shown }) => shown === "30s"),
      cancellationSqlstate: cancellationCode,
      rollbackRestoredDefault: restored.rows[0]?.statement_timeout === normalTimeout,
      normalQueryAfterRollback: true,
      safeError: null,
    };
  } finally {
    for (const client of clients) client.release();
    await applicationDatabase.closePool();
  }
  process.stdout.write(`${JSON.stringify({ ...evidence, poolClosed: true })}\n`);
}

async function provePoolerRefusalBeforeConnection(): Promise<void> {
  selectAuthorizedTarget("LUMERA_NEON_TEST_POOLER_URL");

  let connectionAttempts = 0;
  type AnyConnect = (this: Socket, ...args: unknown[]) => Socket;
  const socketPrototype = Socket.prototype as unknown as { connect: AnyConnect };
  const originalConnect = socketPrototype.connect;
  socketPrototype.connect = function patchedConnect(...args: unknown[]): Socket {
    connectionAttempts += 1;
    return originalConnect.apply(this, args);
  };

  let refused = false;
  let safeError: string | undefined;
  let importedPool: { end: () => Promise<void> } | undefined;
  try {
    try {
      const applicationDatabase = await import("@workspace/db");
      importedPool = applicationDatabase.pool;
    } catch (error) {
      refused = true;
      safeError = error instanceof Error ? error.message : undefined;
    }
  } finally {
    socketPrototype.connect = originalConnect;
    if (importedPool) await importedPool.end();
  }

  assert.equal(refused, true, "the application must refuse the authorized pooler route");
  assert.equal(
    safeError,
    "LUMERA_DATABASE_URL must use a direct Neon endpoint; LISTEN does not work through a -pooler endpoint.",
  );
  assert.equal(connectionAttempts, 0, "pooler refusal must happen before network connection");
  process.stdout.write(`${JSON.stringify({
    result: "pass",
    route: "authorized-pooler",
    refusedBeforeConnection: true,
    connectionAttempts,
    safeError,
    poolClosed: true,
  })}\n`);
}

if (mode === "direct") {
  await proveDirectRoute();
} else {
  await provePoolerRefusalBeforeConnection();
}