import { logger } from "./logger";
import { randomUUID } from "node:crypto";
import { databasePoolStats } from "@workspace/db";

export type SchedulerFailureClass = "transient_database" | "permanent";
export type SchedulerRunState = "idle" | "running" | "retrying" | "failed";

export const SCHEDULER_DEPENDENCIES = [
  "delivery-report-statuses",
  "delivery-report-recipients",
  "delivery-report-history",
  "education-gallery-candidates",
] as const;

export type SchedulerDependency = typeof SCHEDULER_DEPENDENCIES[number];

class SchedulerDependencyError extends Error {
  readonly dependency: SchedulerDependency;

  constructor(dependency: SchedulerDependency, cause: unknown) {
    super("Scheduled job dependency failed");
    this.name = "SchedulerDependencyError";
    this.dependency = dependency;
    this.cause = cause;
  }
}

/**
 * Preserves the original failure for retry classification while tagging the
 * known dependency boundary. The boundary is static and safe to put in logs.
 */
export async function withSchedulerDependency<T>(
  dependency: SchedulerDependency,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new SchedulerDependencyError(dependency, error);
  }
}

export type SchedulerFailureDiagnostics = {
  dependency: SchedulerDependency | "unknown";
  errorCode: string | "unknown";
  errorType: string;
  causeType: string | "unknown";
};

export type SchedulerJobHealth = {
  job: string;
  state: SchedulerRunState;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastFailureClass: SchedulerFailureClass | null;
  consecutiveFailures: number;
  deferredCycles: number;
  nextRetryAt: string | null;
};

type TimerHandle = ReturnType<typeof setTimeout>;

export type SchedulerTimer = {
  now: () => Date;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (timer: TimerHandle) => void;
};

export type ResilientSchedulerOptions = {
  job: string;
  run: () => Promise<unknown>;
  maxRetryAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  random?: () => number;
  timer?: SchedulerTimer;
};

const healthByJob = new Map<string, SchedulerJobHealth>();

/**
 * Keep a small portion of the shared pool available for interactive requests.
 * Scheduled work is intentionally bounded here rather than by each job: several
 * independent timers can fire together during boot or after an outage.
 */
export const SCHEDULER_DATABASE_ACTIVITY_LIMIT = Math.max(
  1,
  databasePoolStats().max - 2,
);

let activeDatabaseActivities = 0;
const waitingDatabaseActivities: Array<() => void> = [];

async function acquireSchedulerDatabaseActivity(): Promise<() => void> {
  if (
    activeDatabaseActivities < SCHEDULER_DATABASE_ACTIVITY_LIMIT
    && waitingDatabaseActivities.length === 0
  ) {
    activeDatabaseActivities += 1;
    return releaseSchedulerDatabaseActivity;
  }

  await new Promise<void>((resolve) => {
    waitingDatabaseActivities.push(resolve);
  });
  activeDatabaseActivities += 1;
  return releaseSchedulerDatabaseActivity;
}

function releaseSchedulerDatabaseActivity(): void {
  activeDatabaseActivities -= 1;
  const next = waitingDatabaseActivities.shift();
  next?.();
}

/**
 * Runs one unit of scheduler-owned work while preserving pool capacity for
 * interactive requests. This is exported so contention regressions can model
 * real scheduler activity without creating health entries or timers.
 */
export async function withSchedulerDatabaseActivity<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireSchedulerDatabaseActivity();
  try {
    return await operation();
  } finally {
    release();
  }
}

const defaultTimer: SchedulerTimer = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

function cloneHealth(health: SchedulerJobHealth): SchedulerJobHealth {
  return { ...health };
}

export function schedulerHealthSnapshot(): SchedulerJobHealth[] {
  return [...healthByJob.values()]
    .map(cloneHealth)
    .sort((left, right) => left.job.localeCompare(right.job));
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code.toUpperCase() : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

const SAFE_ERROR_TYPES = new Set([
  "SchedulerDependencyError",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "AggregateError",
  "PostgresError",
  "DatabaseError",
  "FetchError",
]);

const SAFE_NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function safeErrorType(error: unknown): string {
  const name = error instanceof Error
    ? error.name
    : error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "unknown";
  return SAFE_ERROR_TYPES.has(name) ? name : "unknown";
}

function safeErrorCode(error: unknown): string | "unknown" {
  const code = errorCode(error);
  if (!code) return "unknown";
  // PostgreSQL SQLSTATE values and a short set of Node/undici network codes
  // are opaque implementation identifiers, unlike error messages or queries.
  if (/^[0-9A-Z]{5}$/.test(code) || SAFE_NETWORK_ERROR_CODES.has(code)) return code;
  return "unknown";
}

/**
 * Returns only allowlisted diagnostics. Never add error messages, SQL, URLs,
 * request bodies, stack traces, or arbitrary custom error fields here.
 */
export function schedulerFailureDiagnostics(error: unknown): SchedulerFailureDiagnostics {
  const seen = new Set<unknown>();
  let candidate: unknown = error;
  let dependency: SchedulerDependency | "unknown" = "unknown";
  let errorCodeValue: string | "unknown" = "unknown";
  let errorType = "unknown";
  let causeType: string | "unknown" = "unknown";

  while (candidate && typeof candidate === "object" && !seen.has(candidate)) {
    seen.add(candidate);
    const candidateType = safeErrorType(candidate);
    if (errorType === "unknown") errorType = candidateType;
    else if (causeType === "unknown" && candidateType !== "unknown") causeType = candidateType;
    if (errorCodeValue === "unknown") errorCodeValue = safeErrorCode(candidate);
    if (candidate instanceof SchedulerDependencyError) dependency = candidate.dependency;
    candidate = (candidate as { cause?: unknown }).cause;
  }

  return { dependency, errorCode: errorCodeValue, errorType, causeType };
}

/**
 * True only for failures where another connection attempt can reasonably
 * recover work. SQL mistakes, invalid data, and configuration errors stay
 * failed until the next normal scheduler cycle so they never hot-loop.
 */
export function isTransientDatabaseFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let candidate: unknown = error;

  while (candidate && typeof candidate === "object" && !seen.has(candidate)) {
    seen.add(candidate);
    const code = errorCode(candidate);
    if (
      (code !== null && /^08[0-9A-Z]{3}$/.test(code))
      || code === "57P01"
      || code === "57P02"
      || code === "57P03"
      || code === "40001"
      || code === "40P01"
      || code === "ETIMEDOUT"
      || code === "ECONNRESET"
      || code === "ECONNREFUSED"
      || code === "EPIPE"
    ) {
      return true;
    }
    if (/\b(connection|connect|socket|network).{0,40}\b(timeout|timed out|reset|refused|closed|terminated)\b/i.test(
      errorMessage(candidate),
    )) {
      return true;
    }

    const nested = candidate as { cause?: unknown };
    candidate = nested.cause;
  }

  return /\b(connection|connect|socket|network).{0,40}\b(timeout|timed out|reset|refused|closed|terminated)\b/i.test(
    errorMessage(error),
  );
}

/**
 * Owns one in-process scheduled job. This intentionally does not replace
 * job-level leases or locks: it only prevents timer fan-out during a transient
 * database outage and records the last known local process status.
 */
export class ResilientScheduledJob {
  private readonly job: string;
  private readonly runJob: () => Promise<unknown>;
  private readonly maxRetryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly random: () => number;
  private readonly timer: SchedulerTimer;
  private retryTimer: TimerHandle | null = null;
  private running = false;
  private stopped = false;
  private retryAttempts = 0;
  private readonly health: SchedulerJobHealth;

  constructor(options: ResilientSchedulerOptions) {
    if (!options.job.trim()) throw new RangeError("Scheduler job name is required.");
    this.job = options.job;
    this.runJob = options.run;
    this.maxRetryAttempts = options.maxRetryAttempts ?? 4;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 60_000;
    this.random = options.random ?? Math.random;
    this.timer = options.timer ?? defaultTimer;

    if (!Number.isInteger(this.maxRetryAttempts) || this.maxRetryAttempts < 0 || this.maxRetryAttempts > 20) {
      throw new RangeError("Scheduler maxRetryAttempts must be an integer from 0 to 20.");
    }
    if (!Number.isFinite(this.retryBaseDelayMs) || this.retryBaseDelayMs < 1) {
      throw new RangeError("Scheduler retryBaseDelayMs must be at least 1.");
    }
    if (!Number.isFinite(this.retryMaxDelayMs) || this.retryMaxDelayMs < this.retryBaseDelayMs) {
      throw new RangeError("Scheduler retryMaxDelayMs must be at least retryBaseDelayMs.");
    }

    this.health = {
      job: this.job,
      state: "idle",
      lastStartedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastFailureClass: null,
      consecutiveFailures: 0,
      deferredCycles: 0,
      nextRetryAt: null,
    };
    healthByJob.set(this.job, this.health);
  }

  snapshot(): SchedulerJobHealth {
    return cloneHealth(this.health);
  }

  async run(isRetry = false): Promise<void> {
    if (this.stopped) return;
    if (this.running || this.retryTimer) {
      this.health.deferredCycles += 1;
      return;
    }
    // A later normal interval starts a fresh, still-bounded retry window after
    // a previous outage exhausted its attempts. Retry callbacks deliberately
    // retain the current budget so one outage cannot fan out indefinitely.
    if (!isRetry && this.health.state === "failed" && this.retryAttempts > 0) {
      this.retryAttempts = 0;
    }

    this.running = true;
    this.health.state = "running";
    const startedAt = this.timer.now();
    const runId = randomUUID();
    this.health.lastStartedAt = startedAt.toISOString();
    const releaseDatabaseActivity = await acquireSchedulerDatabaseActivity();
    try {
      if (this.stopped) return;
      await this.runJob();
      this.retryAttempts = 0;
      this.health.state = "idle";
      this.health.lastSucceededAt = this.timer.now().toISOString();
      this.health.lastFailureClass = null;
      this.health.consecutiveFailures = 0;
      this.health.deferredCycles = 0;
      this.health.nextRetryAt = null;
    } catch (error) {
      const failureClass: SchedulerFailureClass = isTransientDatabaseFailure(error)
        ? "transient_database"
        : "permanent";
      const diagnostics = schedulerFailureDiagnostics(error);
      const durationMs = Math.max(0, this.timer.now().getTime() - startedAt.getTime());
      this.health.lastFailedAt = this.timer.now().toISOString();
      this.health.lastFailureClass = failureClass;
      this.health.consecutiveFailures += 1;

      if (failureClass === "transient_database" && this.retryAttempts < this.maxRetryAttempts && !this.stopped) {
        this.retryAttempts += 1;
        this.health.deferredCycles += 1;
        this.scheduleRetry();
        logger.warn(
          {
            job: this.job,
            runId,
            isRetry,
            durationMs,
            ...diagnostics,
            retryAttempt: this.retryAttempts,
            maxRetryAttempts: this.maxRetryAttempts,
          },
          "Scheduler database failure deferred for bounded retry",
        );
      } else {
        this.health.state = "failed";
        this.health.nextRetryAt = null;
        logger.error(
          {
            job: this.job,
            runId,
            isRetry,
            durationMs,
            failureClass,
            ...diagnostics,
            retryAttempts: this.retryAttempts,
          },
          "Scheduler job failed; waiting for its next normal cycle",
        );
      }
    } finally {
      releaseDatabaseActivity();
      this.running = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      this.timer.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.health.nextRetryAt = null;
      if (this.health.state === "retrying") this.health.state = "failed";
    }
  }

  private scheduleRetry(): void {
    const exponentialDelay = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * 2 ** (this.retryAttempts - 1),
    );
    // ±25% jitter prevents several jobs recovering from the same outage together.
    const jitteredDelay = Math.round(exponentialDelay * (0.75 + Math.min(1, Math.max(0, this.random())) * 0.5));
    const retryAt = new Date(this.timer.now().getTime() + jitteredDelay);
    this.health.state = "retrying";
    this.health.nextRetryAt = retryAt.toISOString();
    this.retryTimer = this.timer.setTimeout(() => {
      this.retryTimer = null;
      void this.run(true);
    }, jitteredDelay);
    this.retryTimer.unref?.();
  }
}

export function createResilientScheduledJob(options: ResilientSchedulerOptions): ResilientScheduledJob {
  return new ResilientScheduledJob(options);
}