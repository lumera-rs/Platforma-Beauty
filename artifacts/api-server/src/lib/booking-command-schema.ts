import { pool } from "@workspace/db";

const LOCK_KEY = 0x42434d44;

/** Replay-safe rollout used in production, where drizzle-kit push is not run. */
export async function ensureBookingCommandSchema(schemaName = "public"): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) throw new Error("Invalid schema name.");
  const schema = `"${schemaName}"`;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.booking_command_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES ${schema}.salons(id) ON DELETE CASCADE,
        actor_type text NOT NULL,
        actor_id text NOT NULL,
        idempotency_key text NOT NULL,
        command_type text NOT NULL,
        payload_fingerprint text NOT NULL,
        response_status integer NOT NULL,
        response_body jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS booking_command_receipts_scope_key_unique
      ON ${schema}.booking_command_receipts (salon_id, actor_type, actor_id, idempotency_key)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS booking_command_receipts_actor_created_idx
      ON ${schema}.booking_command_receipts (actor_type, actor_id, created_at)
    `);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}