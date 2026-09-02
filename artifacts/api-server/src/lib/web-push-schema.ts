import { pool, type DatabasePoolClient as PoolClient } from "@workspace/db";

const LOCK_KEY = "lumera:web-push-schema:v1";

function quotedSchema(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("Invalid PostgreSQL schema name.");
  return `"${value}"`;
}

export async function ensureWebPushSchema(schemaName = "public"): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
    locked = true;
    await client.query("begin");
    try {
      await runWebPushSchemaDdl(client, schemaName);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  } finally {
    if (locked) await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function runWebPushSchemaDdl(client: PoolClient, schemaName: string): Promise<void> {
  const schema = quotedSchema(schemaName);
  await client.query(`set local search_path to ${schema}`);
  await client.query(`
    DO $$ BEGIN
      CREATE TYPE system_push_delivery_status AS ENUM ('queued', 'processing', 'sent', 'failed');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
      endpoint text NOT NULL,
      p256dh text NOT NULL,
      auth text NOT NULL,
      user_agent text,
      enabled boolean NOT NULL DEFAULT true,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      disabled_at timestamptz,
      disabled_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique ON ${schema}.push_subscriptions(endpoint)`);
  await client.query(`CREATE INDEX IF NOT EXISTS push_subscriptions_user_enabled_idx ON ${schema}.push_subscriptions(user_id, enabled)`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.system_push_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_key text NOT NULL,
      subscription_id uuid NOT NULL REFERENCES ${schema}.push_subscriptions(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
      payload jsonb NOT NULL,
      status system_push_delivery_status NOT NULL DEFAULT 'queued',
      attempt_count integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      claim_token text,
      claimed_at timestamptz,
      claim_expires_at timestamptz,
      last_attempt_at timestamptz,
      last_http_status integer,
      last_error text,
      sent_at timestamptz,
      acknowledged_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS expires_at timestamptz`);
  await client.query(`ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`);
  await client.query(`UPDATE ${schema}.system_push_deliveries SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL`);
  await client.query(`ALTER TABLE ${schema}.system_push_deliveries ALTER COLUMN expires_at SET NOT NULL`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS system_push_deliveries_event_subscription_unique ON ${schema}.system_push_deliveries(event_key, subscription_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS system_push_deliveries_subscription_idx ON ${schema}.system_push_deliveries(subscription_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS system_push_deliveries_ready_idx ON ${schema}.system_push_deliveries(status, next_attempt_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS system_push_deliveries_claim_expiry_idx ON ${schema}.system_push_deliveries(claim_expires_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS system_push_deliveries_user_idx ON ${schema}.system_push_deliveries(user_id)`);
}