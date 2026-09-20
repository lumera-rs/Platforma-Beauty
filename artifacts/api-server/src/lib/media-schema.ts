import { type StartupDdlPool, resolveStartupDdlPool } from "./startup-ddl-pool";
import { setLocalStartupDdlTimeouts } from "./startup-ddl-safety";
import { logger } from "./logger";

/**
 * Production deployments do not run drizzle-kit push. Keep this additive,
 * idempotent bootstrap ahead of every media query so an existing database can
 * accept the media pipeline on the first deploy.
 */
export async function ensureMediaSchema(poolOverride?: StartupDdlPool): Promise<void> { const client = await (await resolveStartupDdlPool(poolOverride)).connect(); let locked = false;
  const statements = [
    `DO $$ BEGIN
      CREATE TYPE image_asset_status AS ENUM ('pending', 'processing', 'ready', 'failed');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$`,
    `CREATE TABLE IF NOT EXISTS image_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      original_filename text NOT NULL,
      source_content_type text NOT NULL,
      source_size integer NOT NULL,
      staging_object_path text NOT NULL,
      original_object_path text,
      original_width integer,
      original_height integer,
      variants jsonb,
      status image_asset_status NOT NULL DEFAULT 'pending',
      alt_text text NOT NULL DEFAULT '',
      failure_reason text,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS image_assets_staging_object_path_unique ON image_assets (staging_object_path)`,
    `CREATE INDEX IF NOT EXISTS image_assets_uploader_created_idx ON image_assets (uploaded_by_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS image_assets_status_expires_idx ON image_assets (status, expires_at)`,
    `ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS alt_text text NOT NULL DEFAULT ''`,
    `CREATE TABLE IF NOT EXISTS media_assets (
      id uuid PRIMARY KEY,
      owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      scope text NOT NULL,
      resource_id uuid,
      visibility text NOT NULL DEFAULT 'public',
      original_file_name text NOT NULL,
      original_content_type text NOT NULL,
      width integer NOT NULL,
      height integer NOT NULL,
      content_hash text NOT NULL,
      alt_text text NOT NULL DEFAULT '',
      cleanup_reserved_at timestamptz,
      test_cleanup_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS cleanup_reserved_at timestamptz`,
    `ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS test_cleanup_key text`,
    `ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text text NOT NULL DEFAULT ''`,
    `CREATE INDEX IF NOT EXISTS media_assets_owner_created_idx ON media_assets (owner_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS media_assets_scope_resource_idx ON media_assets (scope, resource_id)`,
    `CREATE INDEX IF NOT EXISTS media_assets_content_hash_idx ON media_assets (content_hash)`,
    `CREATE INDEX IF NOT EXISTS media_assets_cleanup_reservation_idx ON media_assets (resource_id, cleanup_reserved_at)`,
    `CREATE INDEX IF NOT EXISTS media_assets_test_cleanup_idx ON media_assets (test_cleanup_key)`,
    `CREATE TABLE IF NOT EXISTS media_variants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      size_name text NOT NULL,
      format text NOT NULL,
      object_path text NOT NULL,
      content_type text NOT NULL,
      width integer NOT NULL,
      height integer NOT NULL,
      byte_size integer NOT NULL,
      etag text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS media_variants_asset_size_format_unique ON media_variants (asset_id, size_name, format)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS media_variants_object_path_unique ON media_variants (object_path)`,
    `CREATE INDEX IF NOT EXISTS media_variants_asset_idx ON media_variants (asset_id)`,
    `CREATE TABLE IF NOT EXISTS media_upload_tickets (
      id uuid PRIMARY KEY,
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope text NOT NULL,
      resource_id uuid,
      staging_object_path text NOT NULL,
      original_file_name text NOT NULL,
      content_type text NOT NULL,
      byte_size integer NOT NULL,
      expires_at timestamptz NOT NULL,
      finalized_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
      finalized_at timestamptz,
      cleanup_failure_count integer NOT NULL DEFAULT 0,
      last_cleanup_failure_at timestamptz,
      test_cleanup_key text,
      promotion_cleanup_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE media_upload_tickets ADD COLUMN IF NOT EXISTS test_cleanup_key text`,
    `ALTER TABLE media_upload_tickets ADD COLUMN IF NOT EXISTS promotion_cleanup_paths jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `CREATE UNIQUE INDEX IF NOT EXISTS media_upload_tickets_staging_path_unique ON media_upload_tickets (staging_object_path)`,
    `CREATE INDEX IF NOT EXISTS media_upload_tickets_owner_expires_idx ON media_upload_tickets (owner_user_id, expires_at)`,
    `CREATE INDEX IF NOT EXISTS media_upload_tickets_cleanup_idx ON media_upload_tickets (expires_at, finalized_at)`,
    `CREATE INDEX IF NOT EXISTS media_upload_tickets_test_cleanup_idx ON media_upload_tickets (test_cleanup_key)`,
  ];

  try { await client.query("begin"); await setLocalStartupDdlTimeouts(client); await client.query("select pg_advisory_lock(hashtext($1))", ["lumera:media-schema:v1"]); locked = true;
    for (const statement of statements) { await client.query(statement); }
    await client.query("commit"); logger.info("Media database schema is ready");
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  finally { let unlockError: unknown; if (locked) await client.query("select pg_advisory_unlock(hashtext($1))", ["lumera:media-schema:v1"]).catch((error) => { unlockError = error; logger.error({ err: error }, "Failed to release media schema advisory lock"); }); if (unlockError) client.release(unlockError instanceof Error ? unlockError : true); else client.release(); }
}