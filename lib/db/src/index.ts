import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  assertDestructiveTestRuntimeAllowed,
  isProductionOrDeploymentRuntime,
} from "./destructive-test-runtime";
export { databaseQueryObservationHeader } from "./query-observation";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const { Pool } = pg;
type PoolClient = import("pg").PoolClient;
type PoolRelease = (error?: Error | boolean) => void;
type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: PoolRelease,
) => void;

function assertDirectDatabaseTestRuntimeAllowed(): void {
  const entryPoint = process.argv[1] ?? "";
  if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entryPoint)) return;
  assertDestructiveTestRuntimeAllowed(process.env, "Direct database tests");
}

assertDirectDatabaseTestRuntimeAllowed();

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
const schedulerDatabaseWorkload = new AsyncLocalStorage<boolean>();
const schedulerConnectionLimit = Math.max(1, poolMax - 2);
type SchedulerConnectionWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
};
const schedulerConnectionWaiters: SchedulerConnectionWaiter[] = [];
let schedulerConnectionsActive = 0;
let schedulerConnectionsClosing = false;

function poolClosingError(): Error {
  return Object.assign(new Error("Database pool is closing."), {
    code: "POOL_CLOSING",
  });
}

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

const originalPoolConnect = pool.connect.bind(pool) as {
  (): Promise<PoolClient>;
  (callback: PoolConnectCallback): void;
};

function grantSchedulerConnectionPermit(): () => void {
  schedulerConnectionsActive += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    schedulerConnectionsActive -= 1;
    const next = schedulerConnectionWaiters.shift();
    if (next && !schedulerConnectionsClosing) {
      next.resolve(grantSchedulerConnectionPermit());
    } else if (next) {
      next.reject(poolClosingError());
    }
  };
}

function acquireSchedulerConnectionPermit(): Promise<() => void> {
  if (schedulerConnectionsClosing) {
    return Promise.reject(poolClosingError());
  }
  if (
    schedulerConnectionsActive < schedulerConnectionLimit
    && schedulerConnectionWaiters.length === 0
  ) {
    return Promise.resolve(grantSchedulerConnectionPermit());
  }
  return new Promise((resolve, reject) => {
    schedulerConnectionWaiters.push({ resolve, reject });
  });
}

function closeSchedulerConnectionQueue(): void {
  if (schedulerConnectionsClosing) return;
  schedulerConnectionsClosing = true;
  const error = poolClosingError();
  for (const waiter of schedulerConnectionWaiters.splice(0)) {
    waiter.reject(error);
  }
}

function attachSchedulerConnectionPermit(
  client: PoolClient,
  releaseClient: PoolRelease,
  releasePermit: () => void,
): PoolRelease {
  let released = false;
  const release: PoolRelease = (error) => {
    if (released) return releaseClient(error);
    released = true;
    try {
      return releaseClient(error);
    } finally {
      releasePermit();
    }
  };
  client.release = release;
  return release;
}

function workloadAwareConnect(): Promise<PoolClient>;
function workloadAwareConnect(callback: PoolConnectCallback): void;
function workloadAwareConnect(
  callback?: PoolConnectCallback,
): Promise<PoolClient> | void {
  if (!schedulerDatabaseWorkload.getStore()) {
    return callback ? originalPoolConnect(callback) : originalPoolConnect();
  }

  if (callback) {
    void acquireSchedulerConnectionPermit().then(
      (releasePermit) => {
        originalPoolConnect((error, client, releaseClient) => {
          if (error || !client) {
            releasePermit();
            callback(error ?? new Error("Database pool did not return a client."), client, releaseClient);
            return;
          }
          const release = attachSchedulerConnectionPermit(client, releaseClient, releasePermit);
          callback(undefined, client, release);
        });
      },
      (error: Error) => callback(error, undefined, () => undefined),
    );
    return;
  }

  return acquireSchedulerConnectionPermit().then(async (releasePermit) => {
    try {
      const client = await originalPoolConnect();
      attachSchedulerConnectionPermit(client, client.release.bind(client), releasePermit);
      return client;
    } catch (error) {
      releasePermit();
      throw error;
    }
  });
}

// pg-pool routes pool.query() through this.connect(), so this one boundary
// covers direct queries, Drizzle queries, and transactions. Scheduler work can
// therefore never check out the two clients reserved for interactive requests,
// even when one job performs several database branches concurrently.
pool.connect = workloadAwareConnect as typeof pool.connect;

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
    schedulerConnections: schedulerDatabaseConnectionCapacitySnapshot(),
  };
}

export type DatabasePoolClient = import("pg").PoolClient;

export function runWithSchedulerDatabaseWorkload<T>(operation: () => T): T {
  return schedulerDatabaseWorkload.run(true, operation);
}

export function schedulerDatabaseConnectionCapacitySnapshot(): {
  active: number;
  queued: number;
  limit: number;
  reservedForInteractive: number;
} {
  return {
    active: schedulerConnectionsActive,
    queued: schedulerConnectionWaiters.length,
    limit: schedulerConnectionLimit,
    reservedForInteractive: poolMax - schedulerConnectionLimit,
  };
}

export type DatabaseQueryObservation = {
  sql: string;
  params: unknown[];
};

type DatabaseQueryObserver = (query: DatabaseQueryObservation) => void;
let databaseStatementCount = 0;

export const databaseQueryObservationHeader = "x-database-query-observation";

export function isDatabaseQueryObservationRuntimeAllowed(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isProductionOrDeploymentRuntime(environment)) return false;
  return (
    environment.NODE_ENV === "test"
    || environment.DATABASE_QUERY_OBSERVATION_ENABLED === "1"
  );
}

export async function observeDatabaseQueries<T>(
  observer: DatabaseQueryObserver,
  operation: (captureId: string) => Promise<T>,
): Promise<T> {
  const captureId = randomUUID();
  const observers = new Set(databaseQueryObservers.getStore());
  observers.add(observer);
  registeredDatabaseQueryObservers.set(captureId, observer);
  try {
    return await databaseQueryObservers.run(observers, () => operation(captureId));
  } finally {
    registeredDatabaseQueryObservers.delete(captureId);
  }
}

export function runWithDatabaseQueryObservation<T>(
  captureId: string | undefined,
  operation: () => T,
): T {
  const observer = captureId
    ? registeredDatabaseQueryObservers.get(captureId)
    : undefined;
  if (!observer) return operation();

  const observers = new Set(databaseQueryObservers.getStore());
  observers.add(observer);
  return databaseQueryObservers.run(observers, operation);
}
export const db = drizzle(pool, {
  schema,
  logger: {
    logQuery(query, params) {
      databaseStatementCount += 1;
      const observation = { sql: query, params };
      for (const observer of databaseQueryObservers.getStore() ?? []) {
        observer(observation);
      }
    },
  },
});

export * from "./schema";

export async function closePool(): Promise<void> {
  closeSchedulerConnectionQueue();
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

const registeredDatabaseQueryObservers = new Map<string, DatabaseQueryObserver>();

const databaseQueryObservers = new AsyncLocalStorage<ReadonlySet<DatabaseQueryObserver>>();
