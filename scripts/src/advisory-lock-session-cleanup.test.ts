import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { ensureMediaSchema } from "../../artifacts/api-server/src/lib/media-schema";

const KEY = "lumera:media-schema:v1";

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as net.AddressInfo).port;
}

async function close(server: net.Server): Promise<void> {
  if (server.listening) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

async function until(check: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await delay(25);
  }
}

// This test never consumes DATABASE_URL or any externally supplied PG endpoint.
// All clients connect only to the cluster created here. No query/release mocks.
test("media owner destroys a session when a transport blackhole prevents unlock", async () => {
  const root = mkdtempSync(join(tmpdir(), "lumera-lock-regression-"));
  const data = join(root, "data");
  const portReservation = net.createServer();
  const port = await listen(portReservation);
  await close(portReservation);
  let initialized = false;
  let pool: pg.Pool | undefined;
  let observer: pg.Client | undefined;
  let contender: pg.Client | undefined;
  let proxy: net.Server | undefined;
  const sockets = new Set<net.Socket>();
  const networkErrors: string[] = [];
  let ownerPid = 0;
  let droppedUnlocks = 0;
  let droppedBytes = 0;
  let ownerSocketClosed = false;
  let releaseCount = 0;
  let releasedWithError = false;
  const config = {
    host: "127.0.0.1", port, user: "lock_test", database: "postgres",
    ssl: false as const, connectionTimeoutMillis: 3000,
  };
  try {
    execFileSync("initdb", ["-D", data, "-U", "lock_test", "-A", "trust", "--no-locale"], { stdio: "pipe" });
    initialized = true;
    execFileSync("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"),
      "-o", `-h 127.0.0.1 -p ${port} -k ${root}`, "-w", "start"], { stdio: "pipe" });
    observer = new pg.Client(config);
    contender = new pg.Client(config);
    await observer.connect();
    await contender.connect();
    await observer.query("CREATE TABLE users (id uuid PRIMARY KEY)");
    const observerPid = (await observer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const contenderPid = (await contender.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;

    proxy = net.createServer((downstream) => {
      const upstream = net.connect({ host: "127.0.0.1", port });
      sockets.add(downstream);
      sockets.add(upstream);
      let pending = Buffer.alloc(0);
      let startup = true;
      let blackhole = false;
      downstream.on("close", () => {
        ownerSocketClosed = true;
        upstream.destroy(); // Client destruction must also end the real backend.
        sockets.delete(downstream);
      });
      upstream.on("close", () => {
        downstream.destroy();
        sockets.delete(upstream);
      });
      for (const socket of [downstream, upstream]) {
        socket.on("error", (error) => {
          networkErrors.push(error.message);
          downstream.destroy();
          upstream.destroy();
        });
      }
      upstream.on("data", (chunk) => downstream.write(chunk));
      downstream.on("data", (chunk) => {
        if (blackhole) { droppedBytes += chunk.length; return; }
        pending = Buffer.concat([pending, chunk]);
        // Parse framing, not TCP chunks: startup has no message-type byte.
        while (pending.length >= (startup ? 4 : 5)) {
          const length = pending.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
          if (pending.length < length) return;
          const frame = pending.subarray(0, length);
          pending = pending.subarray(length);
          const kind = String.fromCharCode(frame[0]);
          if (!startup && (kind === "P" || kind === "Q")
            && frame.includes(Buffer.from("pg_advisory_unlock"))) {
            droppedUnlocks++;
            droppedBytes += frame.length + pending.length;
            pending = Buffer.alloc(0);
            blackhole = true;
            return; // Lose outgoing traffic, leave upstream backend alive.
          }
          upstream.write(frame);
          startup = false;
        }
      });
    });
    const proxyPort = await listen(proxy);
    // pg 8.23 non-pipelined query_timeout rejects a real outstanding query
    // without marking _queryable false. A server statement_timeout would not
    // model this transport failure; killing the backend would release its locks.
    pool = new pg.Pool({
      ...config, port: proxyPort, max: 1,
      idleTimeoutMillis: 0, maxLifetimeSeconds: 0, query_timeout: 1000,
    });
    pool.on("connect", (client) => {
      ownerPid = (client as pg.PoolClient & { processID: number }).processID;
    });
    pool.on("release", (error) => {
      releaseCount++;
      releasedWithError = Boolean(error);
    });
    pool.on("error", (error) => networkErrors.push(error.message));

    const locks = async () => Number((await observer!.query(`
      SELECT count(*) AS count FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND pid = $1
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = CASE WHEN hashtext($2) < 0 THEN 4294967295 ELSE 0 END::oid
        AND objid = (hashtext($2)::bigint & 4294967295)::oid AND objsubid = 1
    `, [ownerPid, KEY])).rows[0].count);
    const backendGone = async () => (await observer!.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1", [ownerPid])).rowCount === 0;

    // Execute the complete real owner, including commit and its finally block.
    await ensureMediaSchema(pool);
    assert.equal(droppedUnlocks, 1, "Actual owner unlock must hit the broken transport");
    assert.equal(releaseCount, 1, "Actual owner finally must release its client");
    assert.equal(new Set([ownerPid, observerPid, contenderPid]).size, 3);
    assert.ok(ownerPid > 0);
    assert.deepEqual(networkErrors, []);
    assert.equal((await observer.query("SELECT to_regclass('media_upload_tickets') IS NOT NULL AS ready")).rows[0].ready, true);

    // A fixed owner destroys asynchronously; allow bounded backend exit first.
    if (pool.totalCount === 0 || releasedWithError) {
      await until(backendGone, "destroyed owner backend to exit");
    }
    const leakedLockCount = await locks();
    const acquired = (await contender.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [KEY])).rows[0].acquired;
    if (acquired) await contender.query("SELECT pg_advisory_unlock(hashtext($1))", [KEY]);
    console.log("REGRESSION_OBSERVATION", JSON.stringify({
      ownerPid, observerPid, contenderPid, droppedUnlocks, droppedBytes,
      leakedLockCount, thirdSessionAcquired: acquired,
      backendAlive: !(await backendGone()), ownerSocketClosed,
      poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount,
      releaseCount, releasedWithError,
    }));
    // Both observations are collected before the assertion, even on baseline.
    assert.deepEqual({ leakedLockCount, thirdSessionAcquired: acquired },
      { leakedLockCount: 0, thirdSessionAcquired: true });
  } finally {
    try {
      if (pool) await pool.end();
      if (ownerPid && observer) {
        await until(async () => (await observer!.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid = $1", [ownerPid])).rowCount === 0,
        "owner backend to exit after pool destruction");
        const remaining = Number((await observer.query(
          "SELECT count(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = $1",
          [ownerPid])).rows[0].count);
        assert.equal(remaining, 0);
        console.log("SESSION_CLEANUP", JSON.stringify({ ownerPid, backendGone: true, remainingLocks: remaining, ownerSocketClosed }));
      }
    } finally {
      for (const socket of sockets) socket.destroy();
      if (proxy) await close(proxy);
      await Promise.all([observer?.end(), contender?.end()]);
      try {
        if (initialized && existsSync(join(data, "postmaster.pid"))) {
          execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
        }
      } finally {
        // Never remove a cluster directory if its server could still be running.
        assert.equal(existsSync(join(data, "postmaster.pid")), false);
        rmSync(root, { recursive: true, force: true });
        console.log("CLUSTER_CLEANUP", JSON.stringify({ root, removed: !existsSync(root), stopped: true }));
      }
    }
  }
});