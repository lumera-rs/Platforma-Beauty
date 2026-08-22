import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function boundedInteger(
  environmentKey: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[environmentKey];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${environmentKey} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: boundedInteger("DB_POOL_MAX", 12, 3, 50),
  idleTimeoutMillis: boundedInteger("DB_POOL_IDLE_TIMEOUT_MS", 30_000, 1_000, 300_000),
  connectionTimeoutMillis: boundedInteger("DB_POOL_CONNECTION_TIMEOUT_MS", 10_000, 500, 60_000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

export function databasePoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export type DatabasePoolClient = import("pg").PoolClient;

export type DatabaseQueryObservation = {
  sql: string;
  params: unknown[];
};

let databaseQueryObserver: ((query: DatabaseQueryObservation) => void) | undefined;

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
      databaseQueryObserver?.({ sql: query, params });
    },
  },
});

export * from "./schema";
