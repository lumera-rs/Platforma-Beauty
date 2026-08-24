/**
 * Cross-file serialization for browser specs that temporarily rewrite global
 * integration settings. The lock stays on one dedicated connection until
 * fixture cleanup restores the prior rows.
 */
import { pool } from "@workspace/db";

const LOCK_KEY = "integration-settings-browser";

export async function acquireIntegrationSettingsLock(): Promise<() => Promise<void>> {
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