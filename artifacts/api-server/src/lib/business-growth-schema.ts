import { pool, type DatabasePoolClient as PoolClient } from "@workspace/db";
import { logger } from "./logger";

/**
 * Production deployments do NOT run drizzle-kit push. This module performs a
 * complete, additive, idempotent rollout of every Phase 2 ("Business Growth")
 * schema object so a previously populated production database can accept the
 * feature on first deploy — and safely re-run on every subsequent (possibly
 * concurrent) boot.
 *
 * Design constraints honored here:
 *  - Runs on ONE PoolClient in AUTOCOMMIT (no wrapping transaction) because
 *    `ALTER TYPE ... ADD VALUE` must commit before the new label can be used by
 *    later column/default/worker statements in the same rollout.
 *  - Serializes concurrent boots via a session-level advisory lock keyed to a
 *    versioned constant; the lock is always released in `finally` and the client
 *    is always returned to the pool.
 *  - Every statement is independently idempotent (CREATE ... IF NOT EXISTS,
 *    ADD COLUMN IF NOT EXISTS, guarded enum-label/constraint creation) and never
 *    drops or recreates existing data.
 *  - Completion is logged only after ALL DDL succeeds; any error propagates so
 *    startup fails loudly.
 *
 * Versioned/auditable: bump BUSINESS_GROWTH_SCHEMA_VERSION whenever the DDL set
 * changes. The advisory lock key is derived from it so a new rollout version
 * takes its own lock slot.
 */
export const BUSINESS_GROWTH_SCHEMA_VERSION = 17;

/**
 * Stable 64-bit advisory lock key for the Business Growth rollout. The high word
 * is an ASCII-derived namespace ("BG" = 0x4247) and the low word is the schema
 * version, so different versions and unrelated bootstraps never collide.
 */
const ADVISORY_LOCK_KEY = 0x42470000 + BUSINESS_GROWTH_SCHEMA_VERSION;

/**
 * Every expected label for each Phase 2 enum. `create if absent AND add every
 * expected label IF NOT EXISTS` handles both a brand-new type and a partially
 * applied older one. Order matters only for readability; ADD VALUE appends.
 */
const ENUM_LABELS: Record<string, string[]> = {
  integration_key: ["sms", "brevo", "google_oauth", "facebook_oauth", "cloudflare"],
  order_status: ["pending", "confirmed", "paid", "processing", "shipped", "delivered", "cancelled"],
  payment_method: ["CARD", "BANK_TRANSFER", "CASH_AT_SALON", "CASH_ON_DELIVERY", "FREE"],
  payment_status: ["unpaid", "pending", "paid", "refunded", "failed"],
  delivery_method: ["courier", "personal_belgrade"],
  automation_trigger: [
    "inactive_days",
    "birthday",
    "visit_count",
    "first_visit_completed",
    "package_completed",
    "appointment_cancelled",
    "expected_return_overdue",
  ],
  automation_action: ["send_email", "send_sms", "send_email_and_sms"],
  automation_status: ["active", "paused", "draft"],
  automation_run_status: ["pending", "sent", "skipped", "failed"],
  customer_retention_status: ["NEW", "ACTIVE", "VIP", "AT_RISK", "LOST"],
  package_purchase_status: ["pending_payment", "active", "completed", "expired", "cancelled"],
  package_redemption_status: ["redeemed", "reversed"],
  commission_type: ["percent_of_revenue", "fixed_per_treatment"],
  package_payment_method: ["pay_at_salon", "bank_transfer"],
  // Existing enum evolved during Phase 2: ensure it exists AND carries every
  // label (notably `processing`) BEFORE any column/default/worker uses it.
  sms_delivery_status: ["queued", "processing", "sent", "failed", "skipped"],
  // Existing message-type enum: Phase 2 added `automation`. Ensure the type
  // exists AND carries every current core.ts label (mirrored exactly, not just
  // `automation`) BEFORE any sms_deliveries insert / automation worker startup.
  sms_message_type: [
    "appointment_confirmation",
    "appointment_reminder",
    "education_session_reminder",
    "education_waitlist_offer",
    "education_session_cancelled",
    "automation",
    // v7: platform-level admin alerts (delivery-report silence SMS fallback).
    "admin_alert",
    "retail_order",
  ],
  // v10 — Phase 3 enums. Mirror lib/db/src/schema/phase3.ts exactly.
  treatment_photo_kind: ["before", "after"],
  salon_inventory_movement_type: ["purchase", "consumption", "adjustment"],
  shift_swap_status: [
    "pending_colleague",
    "colleague_declined",
    "pending_owner",
    "owner_declined",
    "approved",
    "cancelled",
  ],
};

/**
 * Validate a Postgres identifier (schema name) and return it double-quoted for
 * safe interpolation. Production always uses `public`; tests pass an isolated
 * temp schema. Rejects anything outside a conservative identifier grammar.
 */
function quoteSchema(schemaName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName) || schemaName.length > 63) {
    throw new Error(`Invalid schema name for Business Growth bootstrap: ${JSON.stringify(schemaName)}`);
  }
  return `"${schemaName}"`;
}

/**
 * Build the ordered, INDIVIDUALLY-EXECUTED statements that (a) create the enum
 * type if absent, then (b) add every expected label using the native
 * `ALTER TYPE ... ADD VALUE IF NOT EXISTS`. Each is run separately in autocommit
 * so a newly-added label is committed and usable by later column/default/worker
 * statements — `ALTER TYPE ADD VALUE` must not share a transaction with a use of
 * the new value, which autocommit guarantees.
 */
function enumBootstrapStatements(schema: string, typeName: string, labels: string[]): string[] {
  const qType = `${schema}.${typeName}`;
  const createBody = labels.map((l) => `'${l}'`).join(", ");
  const create = `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = '${typeName}' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE ${qType} AS ENUM (${createBody});
  END IF;
END $$`;
  const addValues = labels.map((l) => `ALTER TYPE ${qType} ADD VALUE IF NOT EXISTS '${l}'`);
  return [create, ...addValues];
}

/**
 * The ordered, schema-qualified DDL for all Business Growth tables/columns/
 * indexes/constraints. Dependency-safe order: enums → tables that only reference
 * pre-existing core tables → tables that reference other growth tables.
 *
 * Note on FKs to core tables: production `public` already has salons, employees,
 * services, appointments, salon_customers, users, reviews. Tests seed minimal
 * legacy base tables into the temp schema before running the bootstrap, so these
 * FK targets exist there too.
 */
function tableStatements(s: string): string[] {
  return [
    // ── Existing-table additive changes (Phase 2 evolution) ────────────────
    `ALTER TABLE ${s}.salon_customers ADD COLUMN IF NOT EXISTS birth_date date`,
    // Retention's stratified preview seeks from a random UUID within each salon
    // and reads a bounded circular range. Keep the production bootstrap aligned
    // with core.ts so legacy customer tables never fall back to a full sort.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS salon_customers_salon_id_idx
       ON ${s}.salon_customers (salon_id, id)`,

    // v12: Customer-safe retail storefront fields. These deliberately remain
    // separate from the owner-only B2B description and prices in `products`.
    // Production does not run drizzle push, so legacy catalogs need the same
    // additive rollout before anonymous catalog queries can be served.
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'public_enabled')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'retail_enabled') THEN
         ALTER TABLE products RENAME COLUMN public_enabled TO retail_enabled;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS retail_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_description text`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_price integer`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_discount_price integer`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS professional_enabled boolean NOT NULL DEFAULT true`,
    `DROP INDEX IF EXISTS ${s}.products_public_active_created_idx`,
    `CREATE INDEX IF NOT EXISTS products_retail_active_created_idx
       ON ${s}.products (retail_enabled, active, created_at)`,
    `CREATE INDEX IF NOT EXISTS products_professional_active_created_idx
       ON ${s}.products (professional_enabled, active, created_at)`,

    `CREATE TABLE IF NOT EXISTS ${s}.retail_carts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash text NOT NULL UNIQUE,
      user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS retail_carts_user_idx ON ${s}.retail_carts (user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_cart_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id uuid NOT NULL REFERENCES ${s}.retail_carts(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      variant_value text,
      product_name text NOT NULL,
      product_image_url text NOT NULL,
      unit_price integer NOT NULL,
      quantity integer NOT NULL,
      weight_grams integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // v14: PostgreSQL's legacy unique index treated NULL variant values as
    // distinct. Merge those duplicate no-variant cart lines before replacing
    // it, so the stricter invariant preserves each cart's aggregate quantity.
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1
         FROM pg_index index_definition
         JOIN pg_class index_relation ON index_relation.oid = index_definition.indexrelid
         JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
         WHERE index_schema.nspname = current_schema()
           AND index_relation.relname = 'retail_cart_items_cart_product_variant_unique'
           AND NOT index_definition.indnullsnotdistinct
       ) THEN
         IF EXISTS (
           SELECT 1
           FROM ${s}.retail_cart_items
           WHERE variant_value IS NULL
           GROUP BY cart_id, product_id
           HAVING sum(quantity)::bigint > 2147483647
         ) THEN
           RAISE EXCEPTION 'Cannot consolidate duplicate retail cart items: aggregate quantity exceeds integer range';
         END IF;

         WITH ranked_items AS (
           SELECT
             id,
             sum(quantity) OVER (PARTITION BY cart_id, product_id) AS aggregate_quantity,
             row_number() OVER (PARTITION BY cart_id, product_id ORDER BY created_at, id) AS row_number
           FROM ${s}.retail_cart_items
           WHERE variant_value IS NULL
         )
         UPDATE ${s}.retail_cart_items AS item
         SET quantity = ranked_items.aggregate_quantity::integer,
             updated_at = now()
         FROM ranked_items
         WHERE item.id = ranked_items.id
           AND ranked_items.row_number = 1;

         WITH ranked_items AS (
           SELECT
             id,
             row_number() OVER (PARTITION BY cart_id, product_id ORDER BY created_at, id) AS row_number
           FROM ${s}.retail_cart_items
           WHERE variant_value IS NULL
         )
         DELETE FROM ${s}.retail_cart_items AS item
         USING ranked_items
         WHERE item.id = ranked_items.id
           AND ranked_items.row_number > 1;

         IF EXISTS (
           SELECT 1
           FROM pg_constraint constraint_definition
           JOIN pg_namespace constraint_schema ON constraint_schema.oid = constraint_definition.connamespace
           WHERE constraint_schema.nspname = current_schema()
             AND constraint_definition.conname = 'retail_cart_items_cart_product_variant_unique'
         ) THEN
           EXECUTE format(
             'ALTER TABLE %I.%I DROP CONSTRAINT %I',
             current_schema(),
             'retail_cart_items',
             'retail_cart_items_cart_product_variant_unique'
           );
         ELSE
           EXECUTE format(
             'DROP INDEX %I.%I',
             current_schema(),
             'retail_cart_items_cart_product_variant_unique'
           );
         END IF;
       END IF;
     END $$`,
    `CREATE UNIQUE INDEX IF NOT EXISTS retail_cart_items_cart_product_variant_unique
       ON ${s}.retail_cart_items (cart_id, product_id, variant_value) NULLS NOT DISTINCT`,
    `CREATE INDEX IF NOT EXISTS retail_cart_items_cart_idx ON ${s}.retail_cart_items (cart_id)`,
    `CREATE INDEX IF NOT EXISTS retail_cart_items_product_idx ON ${s}.retail_cart_items (product_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_number text NOT NULL UNIQUE,
      cart_id uuid NOT NULL REFERENCES ${s}.retail_carts(id) ON DELETE RESTRICT,
      user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      tracking_token_hash text NOT NULL UNIQUE,
      tracking_token_revoked_at timestamptz,
      idempotency_key text NOT NULL,
      status ${s}.order_status NOT NULL DEFAULT 'pending',
      payment_method ${s}.payment_method NOT NULL,
      payment_status ${s}.payment_status NOT NULL DEFAULT 'unpaid',
      delivery_method ${s}.delivery_method NOT NULL DEFAULT 'courier',
      subtotal integer NOT NULL,
      shipping_cost integer NOT NULL DEFAULT 0,
      total integer NOT NULL,
      shipping_name text NOT NULL,
      shipping_address text NOT NULL,
      shipping_city text NOT NULL,
      shipping_postal_code text NOT NULL,
      shipping_phone text NOT NULL,
      shipping_email text NOT NULL,
      shipping_note text,
      tracking_number text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (cart_id, idempotency_key)
    )`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS cart_id uuid REFERENCES ${s}.retail_carts(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.retail_orders DROP CONSTRAINT IF EXISTS retail_orders_idempotency_key_key`,
    `CREATE UNIQUE INDEX IF NOT EXISTS retail_orders_cart_idempotency_unique
       ON ${s}.retail_orders (cart_id, idempotency_key) WHERE cart_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS retail_orders_user_created_idx ON ${s}.retail_orders (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS retail_orders_status_created_idx ON ${s}.retail_orders (status, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES ${s}.retail_orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id),
      product_name text NOT NULL,
      product_image_url text NOT NULL,
      variant_value text,
      variant_label text,
      unit_price integer NOT NULL,
      quantity integer NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_order_idx ON ${s}.retail_order_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_product_idx ON ${s}.retail_order_items (product_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_product_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      order_item_id uuid NOT NULL REFERENCES ${s}.retail_order_items(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      rating integer NOT NULL,
      comment text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS retail_product_reviews_item_user_unique ON ${s}.retail_product_reviews (order_item_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS retail_product_reviews_product_idx ON ${s}.retail_product_reviews (product_id)`,
    `CREATE INDEX IF NOT EXISTS retail_product_reviews_user_idx ON ${s}.retail_product_reviews (user_id)`,

    `ALTER TABLE ${s}.reviews ADD COLUMN IF NOT EXISTS employee_id uuid`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'reviews_employee_id_employees_id_fk'
           AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
       ) THEN
         ALTER TABLE ${s}.reviews
           ADD CONSTRAINT reviews_employee_id_employees_id_fk
           FOREIGN KEY (employee_id) REFERENCES ${s}.employees(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS reviews_employee_visible_idx ON ${s}.reviews (employee_id, visible)`,

    // Returning-client attribution checks completed appointment history by
    // customer and date for every attributed campaign appointment. Keep this
    // partial index aligned with the correlated EXISTS predicate; excluding
    // non-completed appointments makes the hot history probe smaller. The
    // statement is autocommitted so CONCURRENTLY avoids blocking appointment
    // writes while an existing production table is indexed.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS appointments_salon_customer_completed_date_idx
       ON ${s}.appointments (salon_customer_id, appointment_date)
       WHERE status = 'completed'`,

    // sms_deliveries Phase-2 lease/reconciliation columns + claim index. The
    // sms_delivery_status enum (incl. `processing`) is ensured by ENUM_LABELS.
    `ALTER TABLE ${s}.sms_deliveries ADD COLUMN IF NOT EXISTS processing_started_at timestamptz`,
    `ALTER TABLE ${s}.sms_deliveries ADD COLUMN IF NOT EXISTS submission_started_at timestamptz`,
    `ALTER TABLE ${s}.sms_deliveries ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz`,
    `ALTER TABLE ${s}.sms_deliveries ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.sms_deliveries ADD COLUMN IF NOT EXISTS next_retry_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS sms_deliveries_retry_index ON ${s}.sms_deliveries (status, next_retry_at)`,
    `CREATE INDEX IF NOT EXISTS sms_deliveries_claim_expiry_idx ON ${s}.sms_deliveries (status, claim_expires_at)`,

    // email_deliveries delivery-report alert history (v8). The silence and
    // recovery alert runners group over ALL rows of their alert email types on
    // every scheduler tick; this partial index keeps those history scans
    // bounded to the small alert history as email_deliveries grows. Mirrors
    // email_deliveries_report_alert_history_idx in lib/db/src/schema/core.ts.
    `CREATE INDEX IF NOT EXISTS email_deliveries_report_alert_history_idx
       ON ${s}.email_deliveries (email_type, recipient_email)
       WHERE email_type IN ('delivery_report_silence_alert', 'delivery_report_recovery_alert')`,

    // email_deliveries provider message-id matching (v9). Every verified Brevo
    // delivery-report webhook event matches back to its outbound email via
    // provider_message_id + email_type = 'automation'; this partial index keeps
    // that per-event lookup cheap as sent email history grows. Legacy databases
    // may predate the provider_message_id column, so ensure it exists first.
    // Built CONCURRENTLY (statements run in autocommit, so this is legal) to
    // avoid a write-blocking lock on the large, actively written table.
    // Mirrors email_deliveries_provider_message_idx in lib/db/src/schema/core.ts.
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS provider_message_id text`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS email_deliveries_provider_message_idx
       ON ${s}.email_deliveries (provider_message_id)
       WHERE email_type = 'automation'`,

    // ── platform_retention_settings (v4: admin-tunable retention thresholds) ─
    // Append-only versioned platform config; highest version is active. Mirrors
    // lib/db/src/schema/business-growth.ts platformRetentionSettingsTable.
    `CREATE TABLE IF NOT EXISTS ${s}.platform_retention_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version integer NOT NULL,
      new_customer_window_days integer NOT NULL,
      default_interval_days integer NOT NULL,
      at_risk_interval_percent integer NOT NULL,
      lost_interval_percent integer NOT NULL,
      lost_minimum_days integer NOT NULL,
      vip_min_completed_visits integer NOT NULL,
      vip_spend_percent_of_median integer NOT NULL,
      changed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      change_source text NOT NULL DEFAULT 'manual',
      restored_from_version integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // v6: audit provenance — restores are labelled, not disguised as manual edits.
    `ALTER TABLE ${s}.platform_retention_settings ADD COLUMN IF NOT EXISTS change_source text NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE ${s}.platform_retention_settings ADD COLUMN IF NOT EXISTS restored_from_version integer`,
    `CREATE UNIQUE INDEX IF NOT EXISTS platform_retention_settings_version_unique ON ${s}.platform_retention_settings (version)`,
    // Leading FK coverage (DB standards audit): changed_by_user_id.
    `CREATE INDEX IF NOT EXISTS platform_retention_settings_changed_by_idx ON ${s}.platform_retention_settings (changed_by_user_id)`,

    // ── automation_rules ───────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.automation_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      name text NOT NULL,
      trigger ${s}.automation_trigger NOT NULL,
      trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
      action ${s}.automation_action NOT NULL,
      email_subject text,
      email_body text,
      sms_body text,
      voucher_code text,
      status ${s}.automation_status NOT NULL DEFAULT 'draft',
      ai_proposed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.automation_rules ADD COLUMN IF NOT EXISTS voucher_code text`,
    `ALTER TABLE ${s}.automation_rules ADD COLUMN IF NOT EXISTS ai_proposed boolean NOT NULL DEFAULT false`,
    `CREATE INDEX IF NOT EXISTS automation_rules_salon_status_idx ON ${s}.automation_rules (salon_id, status)`,

    // ── automation_runs ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.automation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_key text NOT NULL,
      rule_id uuid NOT NULL REFERENCES ${s}.automation_rules(id) ON DELETE CASCADE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      salon_customer_id uuid NOT NULL REFERENCES ${s}.salon_customers(id) ON DELETE CASCADE,
      status ${s}.automation_run_status NOT NULL DEFAULT 'pending',
      skip_reason text,
      error_message text,
      attributed_appointment_id uuid REFERENCES ${s}.appointments(id) ON DELETE SET NULL,
      executed_at timestamptz,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.automation_runs ADD COLUMN IF NOT EXISTS sent_at timestamptz`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'automation_runs_event_key_unique'
           AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
       ) THEN
         ALTER TABLE ${s}.automation_runs
           ADD CONSTRAINT automation_runs_event_key_unique UNIQUE (event_key);
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS automation_runs_rule_customer_idx ON ${s}.automation_runs (rule_id, salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS automation_runs_salon_created_idx ON ${s}.automation_runs (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS automation_runs_attribution_idx ON ${s}.automation_runs (salon_id, salon_customer_id, status)`,
    `CREATE INDEX IF NOT EXISTS automation_runs_cooldown_idx ON ${s}.automation_runs (rule_id, salon_customer_id, sent_at)`,
    // Leading FK coverage (DB standards audit): every FK column needs a leading index.
    `CREATE INDEX IF NOT EXISTS automation_runs_attributed_appointment_idx ON ${s}.automation_runs (attributed_appointment_id)`,
    `CREATE INDEX IF NOT EXISTS automation_runs_salon_customer_idx ON ${s}.automation_runs (salon_customer_id)`,

    // ── automation_deliveries ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.automation_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL REFERENCES ${s}.automation_runs(id) ON DELETE CASCADE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      event_key text NOT NULL,
      channel text NOT NULL,
      recipient_email text,
      recipient_phone text,
      status text NOT NULL DEFAULT 'queued',
      processing_started_at timestamptz,
      claim_expires_at timestamptz,
      provider_message_id text,
      error_message text,
      delivered_at timestamptz,
      opened_at timestamptz,
      failed_at timestamptz,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.automation_deliveries ADD COLUMN IF NOT EXISTS processing_started_at timestamptz`,
    `ALTER TABLE ${s}.automation_deliveries ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz`,
    `ALTER TABLE ${s}.automation_deliveries ADD COLUMN IF NOT EXISTS sent_at timestamptz`,
    // v4: provider-reported terminal failure timestamp (webhook delivery state).
    `ALTER TABLE ${s}.automation_deliveries ADD COLUMN IF NOT EXISTS failed_at timestamptz`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'automation_deliveries_event_key_unique'
           AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
       ) THEN
         ALTER TABLE ${s}.automation_deliveries
           ADD CONSTRAINT automation_deliveries_event_key_unique UNIQUE (event_key);
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS automation_deliveries_run_idx ON ${s}.automation_deliveries (run_id)`,
    `CREATE INDEX IF NOT EXISTS automation_deliveries_salon_created_idx ON ${s}.automation_deliveries (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS automation_deliveries_claim_expiry_idx ON ${s}.automation_deliveries (status, claim_expires_at)`,

    // ── provider_webhook_receipts (v5: delivery-report freshness) ───────────
    // One row per delivery-report provider ("brevo" | "infobip") holding the
    // last accepted verified webhook event receipt time. Mirrors
    // lib/db/src/schema/business-growth.ts providerWebhookReceiptsTable.
    `CREATE TABLE IF NOT EXISTS ${s}.provider_webhook_receipts (
      provider text PRIMARY KEY,
      last_event_at timestamptz,
      rejected_payload_count integer NOT NULL DEFAULT 0,
      last_rejected_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.provider_webhook_receipts ALTER COLUMN last_event_at DROP NOT NULL`,
    `ALTER TABLE ${s}.provider_webhook_receipts ADD COLUMN IF NOT EXISTS rejected_payload_count integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.provider_webhook_receipts ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz`,

    // ── treatment_packages ───────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.treatment_packages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      price_in_dinars integer NOT NULL,
      session_count integer NOT NULL,
      validity_days integer NOT NULL DEFAULT 365,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS treatment_packages_salon_active_idx ON ${s}.treatment_packages (salon_id, active)`,

    // ── package_service_links ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.package_service_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      package_id uuid NOT NULL REFERENCES ${s}.treatment_packages(id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS package_service_links_unique ON ${s}.package_service_links (package_id, service_id)`,
    `CREATE INDEX IF NOT EXISTS package_service_links_service_idx ON ${s}.package_service_links (service_id)`,

    // ── customer_package_purchases (referenced by snapshot + redemptions) ─────
    `CREATE TABLE IF NOT EXISTS ${s}.customer_package_purchases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      package_id uuid NOT NULL REFERENCES ${s}.treatment_packages(id) ON DELETE RESTRICT,
      salon_customer_id uuid NOT NULL REFERENCES ${s}.salon_customers(id) ON DELETE CASCADE,
      total_sessions integer NOT NULL,
      remaining_sessions integer NOT NULL,
      price_in_dinars integer NOT NULL,
      payment_method ${s}.package_payment_method NOT NULL DEFAULT 'pay_at_salon',
      status ${s}.package_purchase_status NOT NULL DEFAULT 'pending_payment',
      expires_at timestamptz NOT NULL,
      payment_confirmed_at timestamptz,
      payment_confirmed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.customer_package_purchases ADD COLUMN IF NOT EXISTS payment_method ${s}.package_payment_method NOT NULL DEFAULT 'pay_at_salon'`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_salon_customer_idx ON ${s}.customer_package_purchases (salon_id, salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_package_idx ON ${s}.customer_package_purchases (package_id)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_status_idx ON ${s}.customer_package_purchases (status, expires_at)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_payment_confirmed_by_idx ON ${s}.customer_package_purchases (payment_confirmed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_customer_idx ON ${s}.customer_package_purchases (salon_customer_id)`,

    // ── package_purchase_service_links (immutable snapshot) ───────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.package_purchase_service_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_id uuid NOT NULL REFERENCES ${s}.customer_package_purchases(id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS package_purchase_service_links_unique ON ${s}.package_purchase_service_links (purchase_id, service_id)`,
    `CREATE INDEX IF NOT EXISTS package_purchase_service_links_purchase_idx ON ${s}.package_purchase_service_links (purchase_id)`,
    `CREATE INDEX IF NOT EXISTS package_purchase_service_links_service_idx ON ${s}.package_purchase_service_links (service_id)`,

    // ── package_redemptions ───────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.package_redemptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_id uuid NOT NULL REFERENCES ${s}.customer_package_purchases(id) ON DELETE CASCADE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE RESTRICT,
      salon_customer_id uuid NOT NULL REFERENCES ${s}.salon_customers(id) ON DELETE CASCADE,
      status ${s}.package_redemption_status NOT NULL DEFAULT 'redeemed',
      original_appointment_price integer NOT NULL DEFAULT 0,
      redeemed_at timestamptz NOT NULL DEFAULT now(),
      reversed_at timestamptz,
      reversed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.package_redemptions ADD COLUMN IF NOT EXISTS original_appointment_price integer NOT NULL DEFAULT 0`,
    `CREATE UNIQUE INDEX IF NOT EXISTS package_redemptions_purchase_appointment_unique ON ${s}.package_redemptions (purchase_id, appointment_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_purchase_idx ON ${s}.package_redemptions (purchase_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_salon_customer_idx ON ${s}.package_redemptions (salon_id, salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_appointment_idx ON ${s}.package_redemptions (appointment_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_reversed_by_idx ON ${s}.package_redemptions (reversed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_customer_idx ON ${s}.package_redemptions (salon_customer_id)`,

    // ── employee_commission_settings ─────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.employee_commission_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      commission_type ${s}.commission_type NOT NULL DEFAULT 'percent_of_revenue',
      commission_percent integer NOT NULL DEFAULT 0,
      fixed_amount_in_dinars integer NOT NULL DEFAULT 0,
      per_service_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS employee_commission_settings_employee_unique ON ${s}.employee_commission_settings (employee_id)`,
    `CREATE INDEX IF NOT EXISTS employee_commission_settings_salon_idx ON ${s}.employee_commission_settings (salon_id)`,
    `CREATE INDEX IF NOT EXISTS employee_commission_settings_updated_by_idx ON ${s}.employee_commission_settings (updated_by_user_id)`,

    // ── employee_ratings ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.employee_ratings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      average_rating integer NOT NULL DEFAULT 0,
      review_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS employee_ratings_employee_unique ON ${s}.employee_ratings (employee_id)`,
    `CREATE INDEX IF NOT EXISTS employee_ratings_salon_idx ON ${s}.employee_ratings (salon_id)`,

    // ═══════════════════════ v10 — Phase 3 tables ═══════════════════════════
    // Mirrors lib/db/src/schema/phase3.ts exactly (tables, defaults, indexes).

    // ── treatment_photos (before/after photos on completed appointments) ────
    `CREATE TABLE IF NOT EXISTS ${s}.treatment_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      salon_customer_id uuid NOT NULL REFERENCES ${s}.salon_customers(id) ON DELETE CASCADE,
      appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE CASCADE,
      employee_id uuid REFERENCES ${s}.employees(id) ON DELETE SET NULL,
      uploaded_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      kind ${s}.treatment_photo_kind NOT NULL,
      media_asset_id uuid NOT NULL,
      consent_confirmed boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS treatment_photos_salon_customer_created_idx ON ${s}.treatment_photos (salon_customer_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS treatment_photos_appointment_idx ON ${s}.treatment_photos (appointment_id)`,
    `CREATE INDEX IF NOT EXISTS treatment_photos_salon_created_idx ON ${s}.treatment_photos (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS treatment_photos_employee_idx ON ${s}.treatment_photos (employee_id)`,
    `CREATE INDEX IF NOT EXISTS treatment_photos_uploaded_by_idx ON ${s}.treatment_photos (uploaded_by_user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS treatment_photos_media_asset_unique ON ${s}.treatment_photos (media_asset_id)`,

    // ── service_product_consumptions (service → product usage mapping) ──────
    `CREATE TABLE IF NOT EXISTS ${s}.service_product_consumptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      quantity_per_use double precision NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS service_product_consumptions_service_product_unique ON ${s}.service_product_consumptions (service_id, product_id)`,
    `CREATE INDEX IF NOT EXISTS service_product_consumptions_salon_idx ON ${s}.service_product_consumptions (salon_id)`,
    `CREATE INDEX IF NOT EXISTS service_product_consumptions_product_idx ON ${s}.service_product_consumptions (product_id)`,

    // ── salon_inventory (salon-owned stock in usage units) ──────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.salon_inventory (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      quantity double precision NOT NULL DEFAULT 0,
      unit_content_amount double precision NOT NULL DEFAULT 1,
      usage_unit text,
      low_stock_threshold double precision,
      peak_quantity double precision NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS salon_inventory_salon_product_unique ON ${s}.salon_inventory (salon_id, product_id)`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_product_idx ON ${s}.salon_inventory (product_id)`,

    // ── salon_inventory_movements (append-only ledger, idempotent debits) ───
    `CREATE TABLE IF NOT EXISTS ${s}.salon_inventory_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      inventory_id uuid NOT NULL REFERENCES ${s}.salon_inventory(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      type ${s}.salon_inventory_movement_type NOT NULL,
      quantity_delta double precision NOT NULL,
      appointment_id uuid REFERENCES ${s}.appointments(id) ON DELETE SET NULL,
      service_id uuid REFERENCES ${s}.services(id) ON DELETE SET NULL,
      order_id uuid REFERENCES ${s}.orders(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_movements_salon_created_idx ON ${s}.salon_inventory_movements (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_movements_inventory_created_idx ON ${s}.salon_inventory_movements (inventory_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_movements_product_idx ON ${s}.salon_inventory_movements (product_id)`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_movements_appointment_idx ON ${s}.salon_inventory_movements (appointment_id)`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_movements_service_idx ON ${s}.salon_inventory_movements (service_id)`,
    `CREATE INDEX IF NOT EXISTS salon_inventory_movements_order_idx ON ${s}.salon_inventory_movements (order_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS salon_inventory_movements_consumption_unique
       ON ${s}.salon_inventory_movements (appointment_id, product_id)
       WHERE type = 'consumption'`,

    // ── employee_clock_entries (time clock; one open entry per employee) ────
    `CREATE TABLE IF NOT EXISTS ${s}.employee_clock_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      clock_in_at timestamptz NOT NULL,
      clock_out_at timestamptz,
      edited_by_owner boolean NOT NULL DEFAULT false,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS employee_clock_entries_salon_in_idx ON ${s}.employee_clock_entries (salon_id, clock_in_at)`,
    `CREATE INDEX IF NOT EXISTS employee_clock_entries_employee_in_idx ON ${s}.employee_clock_entries (employee_id, clock_in_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS employee_clock_entries_one_open_per_employee
       ON ${s}.employee_clock_entries (employee_id)
       WHERE clock_out_at IS NULL`,

    // ── shift_swap_requests (colleague accept → owner approve → swap) ───────
    `CREATE TABLE IF NOT EXISTS ${s}.shift_swap_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      requester_employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      target_employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      swap_date date NOT NULL,
      note text,
      status ${s}.shift_swap_status NOT NULL DEFAULT 'pending_colleague',
      colleague_responded_at timestamptz,
      owner_reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS shift_swap_requests_salon_status_idx ON ${s}.shift_swap_requests (salon_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS shift_swap_requests_requester_idx ON ${s}.shift_swap_requests (requester_employee_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS shift_swap_requests_target_idx ON ${s}.shift_swap_requests (target_employee_id, created_at)`,
  ];
}

/**
 * Internal runner: applies the full rollout against a validated `schemaName`
 * using the supplied PoolClient (already connected). Runs in autocommit; sets
 * the search_path so unqualified references in `DO` blocks resolve to the
 * target schema, while all DDL uses explicit schema-qualified identifiers.
 *
 * Exported for tests (legacy-upgrade proof) — production always goes through
 * `ensureBusinessGrowthSchema()` with the default `public`.
 */
export async function runBusinessGrowthSchemaDdl(
  client: PoolClient,
  schemaName: string,
): Promise<void> {
  const quoted = quoteSchema(schemaName);
  // Constrain unqualified name resolution inside DO blocks to the target schema.
  await client.query(`SET search_path TO ${quoted}`);

  const statements: string[] = [];
  for (const [typeName, labels] of Object.entries(ENUM_LABELS)) {
    statements.push(...enumBootstrapStatements(quoted, typeName, labels));
  }
  statements.push(...tableStatements(quoted));

  // Autocommit: each statement commits on its own. Do NOT wrap in a transaction
  // (ALTER TYPE ADD VALUE cannot be followed by use of the value in the same tx).
  for (const statement of statements) {
    await client.query(statement);
  }
}

/**
 * Production entrypoint. Acquires ONE PoolClient, takes a session advisory lock
 * so concurrent boots serialize, runs the additive/idempotent rollout against
 * `public` in autocommit, then releases the lock and client. Logs completion
 * only after all DDL succeeds; any failure propagates to fail startup.
 */
export async function ensureBusinessGrowthSchema(schemaName = "public"): Promise<void> {
  quoteSchema(schemaName); // validate early, before acquiring resources
  const client = await pool.connect();
  let locked = false;
  const previousSearchPath = await currentSearchPath(client);
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    locked = true;
    await runBusinessGrowthSchemaDdl(client, schemaName);
    logger.info(
      { version: BUSINESS_GROWTH_SCHEMA_VERSION, schema: schemaName },
      "Business Growth database schema is ready",
    );
  } finally {
    // Restore search_path on the pooled client so it does not leak to reuse.
    try {
      await client.query(`SET search_path TO ${previousSearchPath}`);
    } catch {
      /* best-effort; the client is released regardless */
    }
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      } catch {
        /* advisory locks auto-release on session end; ignore */
      }
    }
    client.release();
  }
}

async function currentSearchPath(client: PoolClient): Promise<string> {
  const result = await client.query<{ search_path: string }>("SHOW search_path");
  const value = result.rows[0]?.search_path;
  return value && value.trim().length ? value : '"$user", public';
}
