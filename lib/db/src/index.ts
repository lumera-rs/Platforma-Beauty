import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function parseEnvInt(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < minimum || n > maximum) {
    process.stderr.write(
      `[db-pool] ignoring invalid ${key}; expected an integer from ${minimum} to ${maximum}\n`,
    );
    return fallback;
  }
  return n;
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const poolMax = parseEnvInt("DB_POOL_MAX", 10, 4, 50);
const configuredPoolMin = parseEnvInt("DB_POOL_MIN", 0, 0, 10);
const poolMin = Math.min(configuredPoolMin, poolMax);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  min: poolMin,
  idleTimeoutMillis: parseEnvInt("DB_IDLE_TIMEOUT_MS", 10_000, 1_000, 300_000),
  // pg-pool applies this timeout while requests wait for an already-open
  // client too. Five seconds caused avoidable 500s under a 1,000-request
  // booking burst while the fixed-size pools had long acquisition queues.
  connectionTimeoutMillis: parseEnvInt("DB_CONN_TIMEOUT_MS", 15_000, 500, 60_000),
  query_timeout: parseEnvInt("DB_QUERY_TIMEOUT_MS", 30_000, 1_000, 300_000),
  statement_timeout: parseEnvInt("DB_STMT_TIMEOUT_MS", 30_000, 1_000, 300_000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on("error", (err: Error) => {
  const safeMessage = err.message.replace(
    /postgres(?:ql)?:\/\/[^@]*@[^\s"']*/gi,
    "postgres://<redacted>",
  );
  process.stderr.write(`[db-pool] idle client error: ${safeMessage}\n`);
});

export function databasePoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: poolMax,
    statements: databaseStatementCount,
  };
}

export type DatabasePoolClient = import("pg").PoolClient;

export type DatabaseQueryObservation = {
  sql: string;
  params: unknown[];
};

let databaseQueryObserver: ((query: DatabaseQueryObservation) => void) | undefined;
let databaseStatementCount = 0;

export function observeDatabaseQueries(observer: (query: DatabaseQueryObservation) => void) {
  if (databaseQueryObserver) throw new Error("A database query observer is already active.");
  databaseQueryObserver = observer;
  return () => {
    if (databaseQueryObserver === observer) databaseQueryObserver = undefined;
  };
}

export const db = drizzle(pool, {
  schema,
  logger: {
    logQuery(query, params) {
      databaseStatementCount += 1;
      databaseQueryObserver?.({ sql: query, params });
    },
  },
});

export * from "./schema";

export async function closePool(): Promise<void> {
  await pool.end();
}

export function getPoolStatus(): {
  total: number;
  idle: number;
  waiting: number;
  max: number;
  statements: number;
} {
  return databasePoolStats();
}
