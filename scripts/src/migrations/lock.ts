import type { DatabaseClient } from "../backend-standards-database";

export interface AdvisoryLockOptions {
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

// Session-lock cleanup relies on the CLI owning a single-connection pool and
// ending it afterwards. This module cannot destroy a pooled client on unlock
// failure; a long-lived shared-pool caller must not return that session to its
// pool (including when an earlier error takes precedence over the unlock error).
export async function withMigrationAdvisoryLock<T>(
  client: DatabaseClient,
  operation: () => Promise<T>,
  options: AdvisoryLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 100;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) {
    throw new Error("Migration advisory lock timeout is outside the bounded range");
  }
  const started = Date.now();
  for (;;) {
    const result = await client.query(
      "SELECT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext('lumera:phase4:migrations')) AS locked",
    );
    if (result.rows.length !== 1) throw new Error("Migration advisory lock query returned an unexpected row count");
    const locked = result.rows[0]?.["locked"];
    if (locked === true || locked === "t" || locked === "true" || locked === 1 || locked === "1") break;
    if (Date.now() - started >= timeoutMs) {
      throw new Error("Migration advisory lock timeout");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, timeoutMs)));
  }
  let result: T | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    result = await operation();
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  let cleanupError: unknown;
  let hasCleanupError = false;
  try {
    await client.query(
      "SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('lumera:phase4:migrations'))",
    );
  } catch (error) {
    hasCleanupError = true;
    cleanupError = error;
  }

  if (hasPrimaryError) throw primaryError;
  if (hasCleanupError) throw cleanupError;
  return result as T;
}