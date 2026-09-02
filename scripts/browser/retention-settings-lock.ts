/**
 * Cross-file serialization for the retention-settings browser specs.
 *
 * The retention browser specs write to the single global
 * platform_retention_settings table: versions are a global sequence, and each
 * file's cleanup deletes every version above its own watermark. Playwright
 * runs spec files in parallel workers, so without coordination one file's
 * saves and cleanup corrupt another file's expected version sequence (a
 * watermark captured before a sibling's rows deletes those rows mid-test).
 *
 * A session-level PostgreSQL advisory lock (the same technique the
 * education-gallery spec uses for its course lock) makes the files take
 * turns: each spec acquires the lock before capturing its version watermark
 * and releases it only after its cleanup restored the pre-test state.
 */
import { pool } from "@workspace/db";

const LOCK_KEY = "platform-retention-settings-browser";

/**
 * Blocks until this process holds the retention-settings advisory lock and
 * returns an idempotent release function. The lock lives on a dedicated pool
 * connection, so it survives for as long as the spec file needs it and can
 * never be released early by unrelated queries returning the connection.
 */
export async function acquireRetentionSettingsLock(): Promise<() => Promise<void>> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
    } finally {
      client.release();
    }
  };
}
