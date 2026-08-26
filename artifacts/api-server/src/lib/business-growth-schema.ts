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
export const BUSINESS_GROWTH_SCHEMA_VERSION = 38;

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
  email_delivery_status: ["queued", "processing", "sent", "failed", "skipped"],
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
  beauty_job_listing_type: ["job", "equipment_rental", "space_rental", "freelance"],
  beauty_job_listing_intent: ["offering", "seeking"],
  beauty_job_listing_status: ["active", "expired", "closed", "rejected"],
  beauty_job_moderation_status: ["pending", "approved", "rejected"],
  beauty_job_posted_by_type: ["salon", "user"],
  beauty_job_price_period: ["hour", "day", "week", "month", "project", "fixed"],
  beauty_job_contact_status: ["pending", "viewed", "accepted", "declined", "replied"],
  beauty_job_rental_request_status: ["pending", "accepted", "declined"],
  beauty_job_report_status: ["pending", "resolved", "dismissed"],
  referral_channel: ["A", "B1", "B2", "C", "D"],
  referral_attribution_status: ["attributed", "rejected", "under_review", "expired"],
  referral_qualification_status: ["pending_verification", "tracking", "qualified", "held", "available", "reversed", "rejected"],
  referral_review_status: ["open", "approved", "rejected", "dismissed"],
  referral_credit_entry_type: ["held", "available", "redeemed", "expired", "reversed", "negative_offset", "restored"],
  referral_wallet_kind: ["B2B", "B2C"],
  referral_milestone_kind: ["salon_subscription_reduction", "education_commission_reduction"],
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
    // v35 — Referral programme core.  These rows are append-only evidence and
    // accounting records; no referral reward is inferred from mutable UI state.
    `CREATE TABLE IF NOT EXISTS ${s}.phone_verification_proofs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      phone_normalized text NOT NULL, verification_method text NOT NULL DEFAULT 'sms_otp',
      verified_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
      revocation_reason text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (phone_normalized, verification_method, verified_at)
    )`,
    `CREATE INDEX IF NOT EXISTS phone_verification_proofs_user_active_idx
      ON ${s}.phone_verification_proofs (user_id, verified_at) WHERE revoked_at IS NULL`,
    `DO $$ BEGIN
       IF to_regclass('${s}.oauth_login_states') IS NOT NULL THEN
         ALTER TABLE ${s}.oauth_login_states ADD COLUMN IF NOT EXISTS referral_code text;
       END IF;
     END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.legal_entities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), normalized_pib text NOT NULL,
      legal_name text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (normalized_pib)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.legal_entity_businesses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      legal_entity_id uuid NOT NULL REFERENCES ${s}.legal_entities(id) ON DELETE RESTRICT,
      owner_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT legal_entity_businesses_one_business_check
        CHECK (num_nonnulls(salon_id, education_center_id) = 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS legal_entity_businesses_salon_unique
      ON ${s}.legal_entity_businesses (salon_id) WHERE salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS legal_entity_businesses_center_unique
      ON ${s}.legal_entity_businesses (education_center_id) WHERE education_center_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS legal_entity_businesses_entity_owner_idx
      ON ${s}.legal_entity_businesses (legal_entity_id, owner_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.business_verification_audits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      legal_entity_business_id uuid NOT NULL REFERENCES ${s}.legal_entity_businesses(id) ON DELETE CASCADE,
      previous_status text, next_status text NOT NULL, reason text,
      actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      evidence jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS business_verification_audits_business_created_idx
      ON ${s}.business_verification_audits (legal_entity_business_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
      channel ${s}.referral_channel NOT NULL,
      referrer_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      referrer_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      referrer_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT referral_codes_source_channel_check CHECK (
        (channel in ('B1', 'B2') and num_nonnulls(referrer_salon_id, referrer_education_center_id) = 0)
        or (channel = 'C' and referrer_education_center_id is not null and referrer_salon_id is null)
        or (channel = 'D' and referrer_salon_id is not null and referrer_education_center_id is null)
        or (channel = 'A' and num_nonnulls(referrer_salon_id, referrer_education_center_id) = 1)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS referral_codes_salon_channel_idx ON ${s}.referral_codes (referrer_salon_id, channel)`,
    `CREATE INDEX IF NOT EXISTS referral_codes_center_channel_idx ON ${s}.referral_codes (referrer_education_center_id, channel)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_salon_channel_unique ON ${s}.referral_codes (referrer_salon_id, channel) WHERE referrer_salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_center_channel_unique ON ${s}.referral_codes (referrer_education_center_id, channel) WHERE referrer_education_center_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_user_channel_unique ON ${s}.referral_codes (referrer_user_id, channel) WHERE referrer_salon_id IS NULL AND referrer_education_center_id IS NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_attributions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      referral_code_id uuid NOT NULL REFERENCES ${s}.referral_codes(id) ON DELETE RESTRICT,
      channel ${s}.referral_channel NOT NULL,
      referrer_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      referred_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      referred_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
      referred_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
      status ${s}.referral_attribution_status NOT NULL DEFAULT 'attributed',
      captured_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz NOT NULL,
      rejection_reason text, idempotency_key text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (referred_user_id),
      CONSTRAINT referral_attributions_target_business_check CHECK (
        num_nonnulls(referred_salon_id, referred_education_center_id) = 0
        or (channel in ('A', 'B1') and num_nonnulls(referred_salon_id, referred_education_center_id) = 1)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS referral_attributions_referrer_channel_created_idx
      ON ${s}.referral_attributions (referrer_user_id, channel, created_at)`,
    `CREATE INDEX IF NOT EXISTS referral_attributions_referred_salon_idx ON ${s}.referral_attributions (referred_salon_id)`,
    `CREATE INDEX IF NOT EXISTS referral_attributions_referred_center_idx ON ${s}.referral_attributions (referred_education_center_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_qualifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attribution_id uuid NOT NULL UNIQUE REFERENCES ${s}.referral_attributions(id) ON DELETE RESTRICT,
      referred_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
      referred_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
      status ${s}.referral_qualification_status NOT NULL DEFAULT 'pending_verification',
      required_evidence_count integer NOT NULL, qualified_at timestamptz, hold_until timestamptz,
      available_at timestamptz, reversed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT referral_qualifications_target_business_check
        CHECK (num_nonnulls(referred_salon_id, referred_education_center_id) <= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS referral_qualifications_status_hold_idx ON ${s}.referral_qualifications (status, hold_until)`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_qualification_evidence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      qualification_id uuid NOT NULL REFERENCES ${s}.referral_qualifications(id) ON DELETE CASCADE,
      appointment_id uuid REFERENCES ${s}.appointments(id) ON DELETE RESTRICT,
      enrollment_id uuid REFERENCES ${s}.course_enrollments(id) ON DELETE RESTRICT,
      eligible_at timestamptz NOT NULL, invalidated_at timestamptz, invalidation_reason text,
      idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT referral_qualification_evidence_one_source_check
        CHECK (num_nonnulls(appointment_id, enrollment_id) = 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_qualification_evidence_appointment_unique
      ON ${s}.referral_qualification_evidence (qualification_id, appointment_id) WHERE appointment_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_qualification_evidence_enrollment_unique
      ON ${s}.referral_qualification_evidence (qualification_id, enrollment_id) WHERE enrollment_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attribution_id uuid REFERENCES ${s}.referral_attributions(id) ON DELETE CASCADE,
      qualification_id uuid REFERENCES ${s}.referral_qualifications(id) ON DELETE CASCADE,
      status ${s}.referral_review_status NOT NULL DEFAULT 'open', reason_code text NOT NULL,
      detail text, score integer, reviewed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS referral_reviews_status_created_idx ON ${s}.referral_reviews (status, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_credit_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_kind ${s}.referral_wallet_kind NOT NULL,
      owner_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
      education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
      referral_attribution_id uuid REFERENCES ${s}.referral_attributions(id) ON DELETE RESTRICT,
      type ${s}.referral_credit_entry_type NOT NULL, amount_rsd integer NOT NULL,
      expires_at timestamptz, effective_at timestamptz NOT NULL DEFAULT now(),
      actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, reason text NOT NULL,
      idempotency_key text NOT NULL UNIQUE, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT referral_credit_ledger_wallet_business_check CHECK (
        (wallet_kind = 'B2C' AND salon_id IS NULL AND education_center_id IS NULL)
        OR (wallet_kind = 'B2B' AND num_nonnulls(salon_id, education_center_id) = 1)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS referral_credit_ledger_owner_wallet_effective_idx ON ${s}.referral_credit_ledger (owner_user_id, wallet_kind, effective_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_credit_redemptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ledger_entry_id uuid NOT NULL REFERENCES ${s}.referral_credit_ledger(id) ON DELETE RESTRICT,
      order_id uuid REFERENCES ${s}.orders(id) ON DELETE RESTRICT,
      retail_order_id uuid,
      amount_rsd integer NOT NULL, idempotency_key text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT referral_credit_redemptions_one_order_check CHECK (num_nonnulls(order_id, retail_order_id) = 1),
      CONSTRAINT referral_credit_redemptions_positive_amount_check CHECK (amount_rsd > 0)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_credit_redemptions_order_ledger_unique ON ${s}.referral_credit_redemptions (order_id, ledger_entry_id) WHERE order_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_credit_redemptions_retail_order_ledger_unique ON ${s}.referral_credit_redemptions (retail_order_id, ledger_entry_id) WHERE retail_order_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.referral_milestone_benefits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      referrer_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      channel ${s}.referral_channel NOT NULL,
      benefit_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
      benefit_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
      qualifying_count integer NOT NULL,
       kind ${s}.referral_milestone_kind NOT NULL, billing_cycle_start timestamptz,
       billing_cycle_end timestamptz, discount_percent integer,
      applied_at timestamptz, idempotency_key text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT referral_milestone_benefits_business_check CHECK (
        (channel = 'A' and kind = 'salon_subscription_reduction' and benefit_salon_id is not null and benefit_education_center_id is null)
        or (channel in ('A', 'C') and kind = 'education_commission_reduction' and benefit_education_center_id is not null and benefit_salon_id is null)
      )
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_milestone_benefits_salon_channel_count_unique ON ${s}.referral_milestone_benefits (benefit_salon_id, channel, qualifying_count) WHERE benefit_salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_milestone_benefits_center_channel_count_unique ON ${s}.referral_milestone_benefits (benefit_education_center_id, channel, qualifying_count) WHERE benefit_education_center_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS referral_milestone_benefits_pending_idx
      ON ${s}.referral_milestone_benefits (channel, billing_cycle_start) WHERE applied_at IS NULL`,
    // v38 — immutable-at-use salon benefit policy snapshots. Nullable rollout
    // keeps old education and not-yet-scheduled rows valid.
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS billing_cycle_end timestamptz`,
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS discount_percent integer`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_milestone_benefits_discount_percent_check'
         AND conrelid = '${s}.referral_milestone_benefits'::regclass) THEN
         ALTER TABLE ${s}.referral_milestone_benefits ADD CONSTRAINT referral_milestone_benefits_discount_percent_check
           CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100)) NOT VALID;
       END IF;
     END $$`,
    // v36 — a user can own several locations. Replace v35's user/channel
    // constraints with source-business scope, while keeping B1/B2 personal.
    `ALTER TABLE ${s}.referral_codes ADD COLUMN IF NOT EXISTS referrer_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE`,
    `ALTER TABLE ${s}.referral_codes ADD COLUMN IF NOT EXISTS referrer_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE CASCADE`,
    `ALTER TABLE ${s}.referral_codes DROP CONSTRAINT IF EXISTS referral_codes_referrer_user_id_channel_key`,
    `ALTER TABLE ${s}.referral_codes DROP CONSTRAINT IF EXISTS referral_codes_source_channel_check`,
    `ALTER TABLE ${s}.referral_codes ADD CONSTRAINT referral_codes_source_channel_check CHECK (
      (channel in ('B1', 'B2') and num_nonnulls(referrer_salon_id, referrer_education_center_id) = 0)
      or (channel = 'C' and referrer_education_center_id is not null and referrer_salon_id is null)
      or (channel = 'D' and referrer_salon_id is not null and referrer_education_center_id is null)
      or (channel = 'A' and num_nonnulls(referrer_salon_id, referrer_education_center_id) = 1)
    ) NOT VALID`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_salon_channel_unique ON ${s}.referral_codes (referrer_salon_id, channel) WHERE referrer_salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_center_channel_unique ON ${s}.referral_codes (referrer_education_center_id, channel) WHERE referrer_education_center_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_user_channel_unique ON ${s}.referral_codes (referrer_user_id, channel) WHERE referrer_salon_id IS NULL AND referrer_education_center_id IS NULL`,
    `ALTER TABLE ${s}.referral_attributions ADD COLUMN IF NOT EXISTS referred_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.referral_attributions ADD COLUMN IF NOT EXISTS referred_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.referral_attributions DROP CONSTRAINT IF EXISTS referral_attributions_target_business_check`,
    `ALTER TABLE ${s}.referral_attributions ADD CONSTRAINT referral_attributions_target_business_check CHECK (
      num_nonnulls(referred_salon_id, referred_education_center_id) = 0
      or (channel in ('A', 'B1') and num_nonnulls(referred_salon_id, referred_education_center_id) = 1)
    )`,
    `ALTER TABLE ${s}.referral_qualifications ADD COLUMN IF NOT EXISTS referred_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.referral_qualifications ADD COLUMN IF NOT EXISTS referred_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.referral_qualifications DROP CONSTRAINT IF EXISTS referral_qualifications_target_business_check`,
    `ALTER TABLE ${s}.referral_qualifications ADD CONSTRAINT referral_qualifications_target_business_check
      CHECK (num_nonnulls(referred_salon_id, referred_education_center_id) <= 1)`,
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS benefit_salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS benefit_education_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.referral_milestone_benefits DROP CONSTRAINT IF EXISTS referral_milestone_benefits_referrer_user_id_channel_qualifying_count_key`,
    `ALTER TABLE ${s}.referral_milestone_benefits DROP CONSTRAINT IF EXISTS referral_milestone_benefits_business_check`,
    `ALTER TABLE ${s}.referral_milestone_benefits ADD CONSTRAINT referral_milestone_benefits_business_check CHECK (
      (channel = 'A' and kind = 'salon_subscription_reduction' and benefit_salon_id is not null and benefit_education_center_id is null)
      or (channel in ('A', 'C') and kind = 'education_commission_reduction' and benefit_education_center_id is not null and benefit_salon_id is null)
    ) NOT VALID`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_milestone_benefits_salon_channel_count_unique ON ${s}.referral_milestone_benefits (benefit_salon_id, channel, qualifying_count) WHERE benefit_salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_milestone_benefits_center_channel_count_unique ON ${s}.referral_milestone_benefits (benefit_education_center_id, channel, qualifying_count) WHERE benefit_education_center_id IS NOT NULL`,
    // Existing commerce stores integer whole RSD (for example product price
    // 2000 is displayed as 2,000 RSD). Preserve v35 amounts while exposing the
    // explicitly named fields to new referral accounting code.
    `ALTER TABLE ${s}.referral_credit_ledger ADD COLUMN IF NOT EXISTS amount_rsd integer`,
    `ALTER TABLE ${s}.referral_credit_redemptions ADD COLUMN IF NOT EXISTS amount_rsd integer`,
    `DO $$ BEGIN
       ALTER TABLE ${s}.referral_credit_ledger DISABLE TRIGGER USER;
       ALTER TABLE ${s}.referral_credit_redemptions DISABLE TRIGGER USER;
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                  AND table_name = 'referral_credit_ledger' AND column_name = 'amount') THEN
         UPDATE ${s}.referral_credit_ledger SET amount_rsd = amount WHERE amount_rsd IS NULL;
       END IF;
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                  AND table_name = 'referral_credit_redemptions' AND column_name = 'amount') THEN
         UPDATE ${s}.referral_credit_redemptions SET amount_rsd = amount WHERE amount_rsd IS NULL;
       END IF;
       ALTER TABLE ${s}.referral_credit_ledger ENABLE TRIGGER USER;
       ALTER TABLE ${s}.referral_credit_redemptions ENABLE TRIGGER USER;
     EXCEPTION WHEN OTHERS THEN
       ALTER TABLE ${s}.referral_credit_ledger ENABLE TRIGGER USER;
       ALTER TABLE ${s}.referral_credit_redemptions ENABLE TRIGGER USER;
       RAISE;
     END $$`,
    `ALTER TABLE ${s}.referral_credit_ledger ALTER COLUMN amount_rsd SET NOT NULL`,
    `ALTER TABLE ${s}.referral_credit_redemptions ALTER COLUMN amount_rsd SET NOT NULL`,
    // v37 — permit a single order to consume more than one earned ledger
    // entry, while preserving the no-duplicate-source invariant.
    `DROP INDEX IF EXISTS ${s}.referral_credit_redemptions_order_unique`,
    `DROP INDEX IF EXISTS ${s}.referral_credit_redemptions_retail_order_unique`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_credit_redemptions_order_ledger_unique
       ON ${s}.referral_credit_redemptions (order_id, ledger_entry_id) WHERE order_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS referral_credit_redemptions_retail_order_ledger_unique
       ON ${s}.referral_credit_redemptions (retail_order_id, ledger_entry_id) WHERE retail_order_id IS NOT NULL`,
    `ALTER TABLE ${s}.referral_credit_redemptions DROP CONSTRAINT IF EXISTS referral_credit_redemptions_positive_amount_check`,
    `ALTER TABLE ${s}.referral_credit_redemptions ADD CONSTRAINT referral_credit_redemptions_positive_amount_check CHECK (amount_rsd > 0) NOT VALID`,
    // Accounting rows and first-touch attribution identity are facts.
    // Attribution status/reason are the deliberately mutable lifecycle fields;
    // financial corrections remain reversal/negative-offset entries.
    `CREATE OR REPLACE FUNCTION ${s}.referral_prevent_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Referral financial and attribution records are append-only'; END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.referral_protect_attribution_identity() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE'
          OR NEW.id IS DISTINCT FROM OLD.id
          OR NEW.referral_code_id IS DISTINCT FROM OLD.referral_code_id
          OR NEW.channel IS DISTINCT FROM OLD.channel
          OR NEW.referrer_user_id IS DISTINCT FROM OLD.referrer_user_id
          OR NEW.referred_user_id IS DISTINCT FROM OLD.referred_user_id
          OR NEW.referred_salon_id IS DISTINCT FROM OLD.referred_salon_id
          OR NEW.referred_education_center_id IS DISTINCT FROM OLD.referred_education_center_id
          OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
          OR NEW.locked_until IS DISTINCT FROM OLD.locked_until
          OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
          OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'Referral attribution identity is immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS referral_attributions_append_only ON ${s}.referral_attributions`,
    `CREATE TRIGGER referral_attributions_append_only BEFORE UPDATE OR DELETE ON ${s}.referral_attributions
      FOR EACH ROW EXECUTE FUNCTION ${s}.referral_protect_attribution_identity()`,
    `DROP TRIGGER IF EXISTS referral_credit_ledger_append_only ON ${s}.referral_credit_ledger`,
    `CREATE TRIGGER referral_credit_ledger_append_only BEFORE UPDATE OR DELETE ON ${s}.referral_credit_ledger
      FOR EACH ROW EXECUTE FUNCTION ${s}.referral_prevent_mutation()`,
    `DROP TRIGGER IF EXISTS referral_credit_redemptions_append_only ON ${s}.referral_credit_redemptions`,
    `CREATE TRIGGER referral_credit_redemptions_append_only BEFORE UPDATE OR DELETE ON ${s}.referral_credit_redemptions
      FOR EACH ROW EXECUTE FUNCTION ${s}.referral_prevent_mutation()`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS retail_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_description text`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_price integer`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_discount_price integer`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS professional_enabled boolean NOT NULL DEFAULT true`,
    // v18: preserve an opaque customer-facing catalog reference independently
    // from the editable owner SKU. Backfill legacy products before enforcing
    // the invariant so existing carts and orders can snapshot it.
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS catalog_reference text`,
    `ALTER TABLE ${s}.products ALTER COLUMN catalog_reference SET DEFAULT
       ('LUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))`,
    `UPDATE ${s}.products
       SET catalog_reference = 'LUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
       WHERE catalog_reference IS NULL OR btrim(catalog_reference) = ''`,
    `ALTER TABLE ${s}.products ALTER COLUMN catalog_reference SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS products_catalog_reference_unique
       ON ${s}.products (catalog_reference)`,
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
      product_catalog_reference text,
      unit_price integer NOT NULL,
      quantity integer NOT NULL,
      weight_grams integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.retail_cart_items ADD COLUMN IF NOT EXISTS product_catalog_reference text`,
    `UPDATE ${s}.retail_cart_items AS item
       SET product_catalog_reference = product.catalog_reference
       FROM ${s}.products AS product
       WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL`,
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
       referral_credit_merchandise_subtotal_rsd integer NOT NULL DEFAULT 0,
       referral_credit_pre_credit_payable_total_rsd integer NOT NULL DEFAULT 0,
       referral_credit_applied_rsd integer NOT NULL DEFAULT 0,
       referral_credit_restored_at timestamptz,
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
    // v37 — explicit immutable quote snapshots make the pre-credit and
    // payable amounts auditable even when regular order totals are repurposed.
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS referral_credit_merchandise_subtotal_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS referral_credit_pre_credit_payable_total_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS referral_credit_applied_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS referral_credit_restored_at timestamptz`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS referral_credit_merchandise_subtotal_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS referral_credit_pre_credit_payable_total_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS referral_credit_applied_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS referral_credit_restored_at timestamptz`,
    `ALTER TABLE ${s}.retail_orders DROP CONSTRAINT IF EXISTS retail_orders_idempotency_key_key`,
    `CREATE UNIQUE INDEX IF NOT EXISTS retail_orders_cart_idempotency_unique
       ON ${s}.retail_orders (cart_id, idempotency_key) WHERE cart_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS retail_orders_user_created_idx ON ${s}.retail_orders (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS retail_orders_status_created_idx ON ${s}.retail_orders (status, created_at)`,
    // retail_orders is created above on old deployments. Add this FK only after
    // its target exists; the referral table itself is deliberately created
    // earlier because all of its other evidence targets are core tables.
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'referral_credit_redemptions_retail_order_id_fkey'
       ) THEN
         ALTER TABLE ${s}.referral_credit_redemptions
           ADD CONSTRAINT referral_credit_redemptions_retail_order_id_fkey
           FOREIGN KEY (retail_order_id) REFERENCES ${s}.retail_orders(id) ON DELETE RESTRICT;
       END IF;
     END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES ${s}.retail_orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id),
      product_name text NOT NULL,
      product_image_url text NOT NULL,
      product_catalog_reference text,
      variant_value text,
      variant_label text,
      unit_price integer NOT NULL,
      quantity integer NOT NULL
    )`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS product_catalog_reference text`,
    `UPDATE ${s}.retail_order_items AS item
       SET product_catalog_reference = product.catalog_reference
       FROM ${s}.products AS product
       WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_order_idx ON ${s}.retail_order_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_product_idx ON ${s}.retail_order_items (product_id)`,
    // v19: exact immutable-reference searches use this covering lookup before
    // joining the bounded admin result back to retail_orders.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS retail_order_items_catalog_reference_order_idx
       ON ${s}.retail_order_items (product_catalog_reference, order_id)`,
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
    // Legacy installations can predate the durable lease/retry columns now
    // required by every retryable transactional email.
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES ${s}.appointments(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS recipient_name text`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS html_content text`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS status ${s}.email_delivery_status NOT NULL DEFAULT 'queued'`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS error_message text`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS scheduled_at timestamptz`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS sent_at timestamptz`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS retryable_failure boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS next_retry_at timestamptz`,
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS processing_token text`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_retry_index ON ${s}.email_deliveries (status, next_retry_at)`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_salon_idx ON ${s}.email_deliveries (salon_id)`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_appointment_idx ON ${s}.email_deliveries (appointment_id)`,
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
    // v23: bounded Beauty Poslovi delivery-issue dashboard scans and alert
    // cooldown history. These partial indexes mirror core.ts and exclude every
    // unrelated transactional email from the operational hot path.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS email_deliveries_beauty_job_issue_idx
       ON ${s}.email_deliveries (status, created_at)
       WHERE email_type IN ('beauty_job_new_contact', 'beauty_job_author_reply', 'beauty_job_moderation', 'beauty_job_expiry_warning')`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS email_deliveries_beauty_job_alert_history_idx
       ON ${s}.email_deliveries (recipient_email, created_at)
       WHERE email_type = 'beauty_job_delivery_alert'`,

    // v22: marketing consent is separate from transactional delivery. Existing
    // accounts remain opted in so this additive rollout never changes consent
    // without an explicit user action.
    `ALTER TABLE ${s}.users ADD COLUMN IF NOT EXISTS marketing_emails_enabled boolean NOT NULL DEFAULT true`,
    // v31 — Serbian business role terminology. PostgreSQL enum values are
    // stored by internal OID, so RENAME VALUE preserves all rows and every FK.
    // A previous interrupted/manual deployment can contain both labels; in that
    // case migrate remaining old rows before future boots continue normally.
    `DO $$
     DECLARE has_old boolean; has_new boolean;
     BEGIN
       SELECT EXISTS (
         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'user_role' AND n.nspname = current_schema()
           AND e.enumlabel = 'EDUCATION_CENTER_OWNER'
       ), EXISTS (
         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'user_role' AND n.nspname = current_schema()
           AND e.enumlabel = 'EDUKATIVNI_CENTAR'
       ) INTO has_old, has_new;
       IF has_old AND has_new THEN
         UPDATE ${s}.users SET role = 'EDUKATIVNI_CENTAR'
         WHERE role = 'EDUCATION_CENTER_OWNER';
       ELSIF has_old THEN
         ALTER TYPE ${s}.user_role RENAME VALUE 'EDUCATION_CENTER_OWNER' TO 'EDUKATIVNI_CENTAR';
       END IF;
     END $$`,
    // v32 — per-center education billing and tax identity. education_centers
    // is a pre-existing core table, so production needs additive ALTERs for
    // both populated legacy databases and subsequent idempotent boots.
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS pib text`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS commission_percent_override integer`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS reserve_percent_override integer`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS online_refund_days_override integer`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS live_appeal_days_override integer`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS featured_course_price_override integer`,
    // v33 — owners can create intraday employee blocks without changing the
    // all-day leave meaning of existing rows. Both times are present or absent;
    // when present their lexical HH:MM order is also chronological.
    `ALTER TABLE ${s}.employee_time_off ADD COLUMN IF NOT EXISTS start_time text`,
    `ALTER TABLE ${s}.employee_time_off ADD COLUMN IF NOT EXISTS end_time text`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'employee_time_off_times_together_check'
       ) THEN
         ALTER TABLE ${s}.employee_time_off ADD CONSTRAINT employee_time_off_times_together_check
           CHECK ((start_time IS NULL) = (end_time IS NULL));
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'employee_time_off_time_order_check'
       ) THEN
         ALTER TABLE ${s}.employee_time_off ADD CONSTRAINT employee_time_off_time_order_check
           CHECK (start_time IS NULL OR start_time < end_time);
       END IF;
     END $$`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS employee_time_off_employee_date_time_idx
       ON ${s}.employee_time_off (employee_id, start_date, end_date, start_time, end_time)`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'education_centers_commission_override_check'
       ) THEN
         ALTER TABLE ${s}.education_centers
           ADD CONSTRAINT education_centers_commission_override_check
           CHECK (commission_percent_override BETWEEN 0 AND 100);
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'education_centers_reserve_override_check'
       ) THEN
         ALTER TABLE ${s}.education_centers
           ADD CONSTRAINT education_centers_reserve_override_check
           CHECK (reserve_percent_override BETWEEN 0 AND 100);
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'education_centers_online_refund_override_check'
       ) THEN
         ALTER TABLE ${s}.education_centers
           ADD CONSTRAINT education_centers_online_refund_override_check
           CHECK (online_refund_days_override BETWEEN 0 AND 365);
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'education_centers_live_appeal_override_check'
       ) THEN
         ALTER TABLE ${s}.education_centers
           ADD CONSTRAINT education_centers_live_appeal_override_check
           CHECK (live_appeal_days_override BETWEEN 0 AND 365);
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conname = 'education_centers_featured_price_override_check'
       ) THEN
         ALTER TABLE ${s}.education_centers
           ADD CONSTRAINT education_centers_featured_price_override_check
           CHECK (featured_course_price_override >= 0);
       END IF;
     END $$`,
    // v29 — JOBSEEKER is intentionally a distinct account boundary.  This is
    // additive and the conversion is idempotent, preserving every FK record.
    `ALTER TYPE ${s}.user_role ADD VALUE IF NOT EXISTS 'JOBSEEKER'`,
    `ALTER TABLE ${s}.users ADD COLUMN IF NOT EXISTS date_of_birth date`,
    `CREATE TABLE IF NOT EXISTS ${s}.jobseeker_profiles (
      user_id uuid PRIMARY KEY REFERENCES ${s}.users(id) ON DELETE CASCADE,
      bio text NOT NULL DEFAULT '',
      portfolio_media jsonb NOT NULL DEFAULT '[]'::jsonb,
      skill_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      category_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT jobseeker_profiles_portfolio_count CHECK (
        jsonb_array_length(portfolio_media) = 0
        OR jsonb_array_length(portfolio_media) BETWEEN 3 AND 5
      )
    )`,
    `DO $$ BEGIN
       ALTER TABLE ${s}.jobseeker_profiles DROP CONSTRAINT IF EXISTS jobseeker_profiles_portfolio_count;
       ALTER TABLE ${s}.jobseeker_profiles ADD CONSTRAINT jobseeker_profiles_portfolio_count CHECK (
         jsonb_array_length(portfolio_media) = 0
         OR jsonb_array_length(portfolio_media) BETWEEN 3 AND 5
       );
     END $$`,
    `CREATE INDEX IF NOT EXISTS jobseeker_profiles_updated_idx ON ${s}.jobseeker_profiles (updated_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.jobseeker_salon_interests (
      user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT jobseeker_salon_interests_user_salon_unique UNIQUE (user_id, salon_id)
    )`,
    `CREATE INDEX IF NOT EXISTS jobseeker_salon_interests_salon_idx ON ${s}.jobseeker_salon_interests (salon_id)`,

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
       rejected_payload_times jsonb NOT NULL DEFAULT '[]'::jsonb,
      last_rejected_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.provider_webhook_receipts ALTER COLUMN last_event_at DROP NOT NULL`,
    `ALTER TABLE ${s}.provider_webhook_receipts ADD COLUMN IF NOT EXISTS rejected_payload_count integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.provider_webhook_receipts ADD COLUMN IF NOT EXISTS rejected_payload_times jsonb NOT NULL DEFAULT '[]'::jsonb`,
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
       quota_policy text NOT NULL DEFAULT 'shared_pool',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.treatment_packages ADD COLUMN IF NOT EXISTS quota_policy text NOT NULL DEFAULT 'shared_pool'`,
    `CREATE INDEX IF NOT EXISTS treatment_packages_salon_active_idx ON ${s}.treatment_packages (salon_id, active)`,

    // ── package_service_links ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.package_service_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      package_id uuid NOT NULL REFERENCES ${s}.treatment_packages(id) ON DELETE CASCADE,
       service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE CASCADE,
       quota integer NOT NULL DEFAULT 1
    )`,
    // Existing definitions used a shared session_count. Preserve their historic
    // coverage while making each legacy link visibly carry that old allowance.
    `ALTER TABLE ${s}.package_service_links ADD COLUMN IF NOT EXISTS quota integer`,
    `UPDATE ${s}.package_service_links l
       SET quota = p.session_count
      FROM ${s}.treatment_packages p
     WHERE l.package_id = p.id AND l.quota IS NULL`,
    `ALTER TABLE ${s}.package_service_links ALTER COLUMN quota SET DEFAULT 1`,
    `ALTER TABLE ${s}.package_service_links ALTER COLUMN quota SET NOT NULL`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_service_links_quota_positive'
         AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
         ALTER TABLE ${s}.package_service_links ADD CONSTRAINT package_service_links_quota_positive CHECK (quota > 0);
       END IF;
     END $$`,
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
       quota_policy text NOT NULL DEFAULT 'shared_pool',
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
    `ALTER TABLE ${s}.customer_package_purchases ADD COLUMN IF NOT EXISTS quota_policy text NOT NULL DEFAULT 'shared_pool'`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_salon_customer_idx ON ${s}.customer_package_purchases (salon_id, salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_package_idx ON ${s}.customer_package_purchases (package_id)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_status_idx ON ${s}.customer_package_purchases (status, expires_at)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_payment_confirmed_by_idx ON ${s}.customer_package_purchases (payment_confirmed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS customer_package_purchases_customer_idx ON ${s}.customer_package_purchases (salon_customer_id)`,

    // ── package_purchase_service_links (immutable snapshot) ───────────────────
    `CREATE TABLE IF NOT EXISTS ${s}.package_purchase_service_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_id uuid NOT NULL REFERENCES ${s}.customer_package_purchases(id) ON DELETE CASCADE,
       service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE CASCADE,
       total_quota integer NOT NULL DEFAULT 0,
       remaining_quota integer NOT NULL DEFAULT 0
    )`,
    `ALTER TABLE ${s}.package_purchase_service_links ADD COLUMN IF NOT EXISTS total_quota integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.package_purchase_service_links ADD COLUMN IF NOT EXISTS remaining_quota integer NOT NULL DEFAULT 0`,
    // These values are audit snapshots only for old shared-pool purchases. Their
    // quota_policy remains shared_pool, so they are never reinterpreted as caps.
    `UPDATE ${s}.package_purchase_service_links l
       SET total_quota = p.total_sessions,
           remaining_quota = p.remaining_sessions
      FROM ${s}.customer_package_purchases p
     WHERE l.purchase_id = p.id AND l.total_quota = 0 AND l.remaining_quota = 0`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_purchase_service_links_quota_nonnegative'
         AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
         ALTER TABLE ${s}.package_purchase_service_links ADD CONSTRAINT package_purchase_service_links_quota_nonnegative
           CHECK (total_quota >= 0 AND remaining_quota >= 0 AND remaining_quota <= total_quota);
       END IF;
     END $$`,
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
       purchase_service_link_id uuid REFERENCES ${s}.package_purchase_service_links(id) ON DELETE RESTRICT,
       service_id uuid REFERENCES ${s}.services(id) ON DELETE RESTRICT,
      status ${s}.package_redemption_status NOT NULL DEFAULT 'redeemed',
      original_appointment_price integer NOT NULL DEFAULT 0,
      redeemed_at timestamptz NOT NULL DEFAULT now(),
      reversed_at timestamptz,
      reversed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.package_redemptions ADD COLUMN IF NOT EXISTS original_appointment_price integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.package_redemptions ADD COLUMN IF NOT EXISTS purchase_service_link_id uuid REFERENCES ${s}.package_purchase_service_links(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.package_redemptions ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES ${s}.services(id) ON DELETE RESTRICT`,
    // Very old appointment schemas predate service_id. Keep the rollout
    // additive/idempotent instead of failing startup before the core schema
    // migration has had a chance to add that column.
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'appointments'
            AND column_name = 'service_id'
       ) THEN
         UPDATE ${s}.package_redemptions r
            SET service_id = a.service_id
           FROM ${s}.appointments a
          WHERE r.appointment_id = a.id AND r.service_id IS NULL;
       END IF;
     END $$`,
    `CREATE UNIQUE INDEX IF NOT EXISTS package_redemptions_purchase_appointment_unique ON ${s}.package_redemptions (purchase_id, appointment_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_purchase_idx ON ${s}.package_redemptions (purchase_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_salon_customer_idx ON ${s}.package_redemptions (salon_id, salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_appointment_idx ON ${s}.package_redemptions (appointment_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_reversed_by_idx ON ${s}.package_redemptions (reversed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_customer_idx ON ${s}.package_redemptions (salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_purchase_service_link_idx ON ${s}.package_redemptions (purchase_service_link_id)`,

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

    // ── Beauty Poslovi marketplace (v20) ────────────────────────────────────
    // Exact street addresses are intentionally absent from every marketplace
    // table. Rentals expose city/region and a free-form availability pattern only.
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      name text NOT NULL UNIQUE,
      subtype_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
      enabled boolean NOT NULL DEFAULT true,
      feature_flag text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_platform_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_expiry_days integer NOT NULL DEFAULT 30,
      hourly_posting_limit integer NOT NULL DEFAULT 5,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_platform_settings_updated_by_idx ON ${s}.beauty_job_platform_settings (updated_by_user_id)`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_platform_settings_expiry_positive' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_platform_settings ADD CONSTRAINT beauty_job_platform_settings_expiry_positive CHECK (listing_expiry_days > 0);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_platform_settings_limit_positive' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_platform_settings ADD CONSTRAINT beauty_job_platform_settings_limit_positive CHECK (hourly_posting_limit > 0);
       END IF;
     END $$`,
    `INSERT INTO ${s}.beauty_job_platform_settings (listing_expiry_days, hourly_posting_limit)
       SELECT 30, 5 WHERE NOT EXISTS (SELECT 1 FROM ${s}.beauty_job_platform_settings)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_listings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id uuid NOT NULL REFERENCES ${s}.beauty_job_categories(id) ON DELETE RESTRICT,
      salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      user_id uuid REFERENCES ${s}.users(id) ON DELETE CASCADE,
      posted_by_type ${s}.beauty_job_posted_by_type NOT NULL,
      type ${s}.beauty_job_listing_type NOT NULL,
      intent ${s}.beauty_job_listing_intent NOT NULL DEFAULT 'offering',
      title text NOT NULL,
      description text NOT NULL,
      city text NOT NULL,
      region text NOT NULL,
      latitude double precision,
      longitude double precision,
      price_amount integer,
      price_period ${s}.beauty_job_price_period,
      negotiable boolean NOT NULL DEFAULT false,
      is_urgent boolean NOT NULL DEFAULT false,
      photos jsonb NOT NULL DEFAULT '[]'::jsonb,
      status ${s}.beauty_job_listing_status NOT NULL DEFAULT 'active',
      moderation_status ${s}.beauty_job_moderation_status NOT NULL DEFAULT 'pending',
      moderation_reason text,
       moderation_internal_note text,
      moderated_at timestamptz,
      contact_count integer NOT NULL DEFAULT 0,
      view_count integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.beauty_job_listings ADD COLUMN IF NOT EXISTS is_urgent boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.beauty_job_listings ADD COLUMN IF NOT EXISTS intent ${s}.beauty_job_listing_intent NOT NULL DEFAULT 'offering'`,
  `ALTER TABLE ${s}.beauty_job_listings ADD COLUMN IF NOT EXISTS moderation_reason text`,
   `ALTER TABLE ${s}.beauty_job_listings ADD COLUMN IF NOT EXISTS moderation_internal_note text`,
  `ALTER TABLE ${s}.beauty_job_listings ADD COLUMN IF NOT EXISTS moderated_at timestamptz`,
    `DROP INDEX IF EXISTS ${s}.beauty_job_listings_category_visibility_created_idx`,
    `CREATE INDEX IF NOT EXISTS beauty_job_listings_category_visibility_created_idx ON ${s}.beauty_job_listings (category_id, intent, status, moderation_status, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_listings_city_region_idx ON ${s}.beauty_job_listings (city, region)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_listings_salon_created_idx ON ${s}.beauty_job_listings (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_listings_user_created_idx ON ${s}.beauty_job_listings (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_listings_expiry_idx ON ${s}.beauty_job_listings (status, expires_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_listings_moderation_created_idx ON ${s}.beauty_job_listings (moderation_status, created_at)`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_listings_exactly_one_author' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_listings ADD CONSTRAINT beauty_job_listings_exactly_one_author CHECK (((salon_id IS NOT NULL)::integer + (user_id IS NOT NULL)::integer) = 1);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_listings_posted_by_matches_author' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_listings ADD CONSTRAINT beauty_job_listings_posted_by_matches_author CHECK ((posted_by_type = 'salon' AND salon_id IS NOT NULL AND user_id IS NULL) OR (posted_by_type = 'user' AND user_id IS NOT NULL AND salon_id IS NULL));
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_listings_price_nonnegative' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_listings ADD CONSTRAINT beauty_job_listings_price_nonnegative CHECK (price_amount IS NULL OR price_amount >= 0);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_listings_coordinates_pair' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_listings ADD CONSTRAINT beauty_job_listings_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL));
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beauty_job_listings_urgent_only_freelance' AND connamespace = current_schema()::regnamespace) THEN
         ALTER TABLE ${s}.beauty_job_listings ADD CONSTRAINT beauty_job_listings_urgent_only_freelance CHECK (NOT is_urgent OR type = 'freelance');
       END IF;
     END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_moderation_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL,
      acting_admin_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      action text NOT NULL,
      public_reason text,
      internal_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.beauty_job_moderation_audit DROP CONSTRAINT IF EXISTS beauty_job_moderation_audit_listing_id_fkey`,
    `CREATE INDEX IF NOT EXISTS beauty_job_moderation_audit_listing_created_idx ON ${s}.beauty_job_moderation_audit (listing_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_moderation_audit_admin_created_idx ON ${s}.beauty_job_moderation_audit (acting_admin_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_moderation_audit_action_created_idx ON ${s}.beauty_job_moderation_audit (action, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_listing_availability (
      listing_id uuid PRIMARY KEY REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      availability_pattern text NOT NULL,
      day_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_rental_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT beauty_job_rental_slots_positive_period CHECK (ends_at > starts_at)
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_rental_slots_listing_starts_idx ON ${s}.beauty_job_rental_slots (listing_id, starts_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_rental_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      slot_id uuid NOT NULL REFERENCES ${s}.beauty_job_rental_slots(id) ON DELETE CASCADE,
      applicant_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      message text,
      status ${s}.beauty_job_rental_request_status NOT NULL DEFAULT 'pending',
      responded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_rental_requests_listing_created_idx ON ${s}.beauty_job_rental_requests (listing_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_rental_requests_applicant_created_idx ON ${s}.beauty_job_rental_requests (applicant_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_rental_requests_slot_status_idx ON ${s}.beauty_job_rental_requests (slot_id, status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS beauty_job_rental_requests_slot_accepted_unique ON ${s}.beauty_job_rental_requests (slot_id) WHERE status = 'accepted'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS beauty_job_rental_requests_slot_applicant_pending_unique ON ${s}.beauty_job_rental_requests (slot_id, applicant_user_id) WHERE status = 'pending'`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      applicant_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      applicant_message text NOT NULL,
      applicant_status ${s}.beauty_job_contact_status NOT NULL DEFAULT 'pending',
      author_reply text,
      author_status ${s}.beauty_job_contact_status NOT NULL DEFAULT 'pending',
      replied_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${s}.beauty_job_contacts ADD COLUMN IF NOT EXISTS rejection_note text`,
    `ALTER TABLE ${s}.beauty_job_contacts ADD COLUMN IF NOT EXISTS decision_actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.beauty_job_contacts ADD COLUMN IF NOT EXISTS decision_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS beauty_job_contacts_listing_created_idx ON ${s}.beauty_job_contacts (listing_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_contacts_applicant_created_idx ON ${s}.beauty_job_contacts (applicant_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_contacts_listing_status_created_idx ON ${s}.beauty_job_contacts (listing_id, author_status, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_contacts_decision_actor_idx ON ${s}.beauty_job_contacts (decision_actor_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_application_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id uuid NOT NULL,
      listing_id uuid NOT NULL,
      from_status ${s}.beauty_job_contact_status NOT NULL,
      to_status ${s}.beauty_job_contact_status NOT NULL,
      private_note text,
      actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_application_actions_contact_created_idx ON ${s}.beauty_job_application_actions (contact_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_application_actions_listing_created_idx ON ${s}.beauty_job_application_actions (listing_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_application_actions_actor_created_idx ON ${s}.beauty_job_application_actions (actor_user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_saved_listings (
      user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      listing_id uuid NOT NULL REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, listing_id)
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_saved_listings_listing_idx ON ${s}.beauty_job_saved_listings (listing_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      reporter_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      reason text NOT NULL,
      status ${s}.beauty_job_report_status NOT NULL DEFAULT 'pending',
      resolved_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      resolution_note text,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_reports_listing_status_idx ON ${s}.beauty_job_reports (listing_id, status)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_reports_reporter_idx ON ${s}.beauty_job_reports (reporter_user_id)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_reports_resolved_by_idx ON ${s}.beauty_job_reports (resolved_by_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.beauty_job_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      listing_id uuid REFERENCES ${s}.beauty_job_listings(id) ON DELETE CASCADE,
      contact_id uuid REFERENCES ${s}.beauty_job_contacts(id) ON DELETE CASCADE,
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS beauty_job_notifications_recipient_created_idx ON ${s}.beauty_job_notifications (recipient_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_notifications_listing_idx ON ${s}.beauty_job_notifications (listing_id)`,
    `CREATE INDEX IF NOT EXISTS beauty_job_notifications_contact_idx ON ${s}.beauty_job_notifications (contact_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS beauty_job_notifications_expiry_warning_unique
       ON ${s}.beauty_job_notifications (recipient_user_id, listing_id)
       WHERE type = 'expiry_warning' AND listing_id IS NOT NULL`,
    `INSERT INTO ${s}.beauty_job_categories (slug, name, subtype_labels, enabled, feature_flag) VALUES
      ('frizeri', 'Frizeri', '["Ženski frizer", "Muški frizer", "Kolorista"]'::jsonb, true, NULL),
      ('barberi', 'Barberi', '["Šišanje", "Brijanje", "Stilizovanje brade"]'::jsonb, true, NULL),
      ('kozmetika', 'Kozmetika', '[]'::jsonb, true, NULL),
      ('kozmeticari', 'Kozmetičari', '["Nega lica", "Depilacija", "Tretmani tela"]'::jsonb, true, NULL),
      ('nokti', 'Nokti (Manikir/Pedikir)', '["Manikir", "Pedikir", "Nail artist"]'::jsonb, true, NULL),
      ('lash-brow', 'Lash/Brow', '["Ekstenzije trepavica", "Laminacija trepavica", "Obrve"]'::jsonb, true, NULL),
      ('make-up', 'Make-up', '["Dnevna šminka", "Svečana šminka"]'::jsonb, true, NULL),
      ('sminkeri', 'Šminkeri', '["Dnevna šminka", "Svečana šminka", "Editorial"]'::jsonb, true, NULL),
      ('pmu', 'PMU', '["Obrve", "Usne", "Eyeliner"]'::jsonb, true, NULL),
      ('estetika-masaza', 'Estetika i masaža', '["Estetika", "Masaža", "Terapeut"]'::jsonb, true, NULL),
      ('masaza-terapeuti', 'Masaža/Terapeuti', '["Relaks masaža", "Sportska masaža", "Terapeut"]'::jsonb, true, NULL),
      ('estetika-anti-aging', 'Estetika/anti-aging', '["Anti-aging", "Mezoterapija", "Nega lica"]'::jsonb, true, NULL),
      ('pomocno-osoblje', 'Pomoćno osoblje', '["Recepcija", "Asistent u salonu", "Šampon"]'::jsonb, true, NULL),
      ('tattoo-piercing', 'Tattoo/Piercing', '["Tattoo", "Piercing"]'::jsonb, true, 'beauty_jobs_tattoo_piercing'),
      ('iznajmljivanje-opreme', 'Iznajmljivanje opreme', '[]'::jsonb, true, NULL),
      ('iznajmljivanje-prostora-stolice', 'Iznajmljivanje prostora/stolice', '["Stolica", "Kabina", "Prostor"]'::jsonb, true, NULL),
      ('freelance-angazmani', 'Freelance/angažmani', '[]'::jsonb, true, NULL)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        subtype_labels = EXCLUDED.subtype_labels,
        enabled = EXCLUDED.enabled,
        feature_flag = EXCLUDED.feature_flag,
        updated_at = now()`,
    // Existing individual marketplace users move once and only once.  No
    // dependent row is rewritten: listings, contacts, rentals and enrollments
    // keep their user foreign keys while the account boundary changes.
    `DO $$ BEGIN
       IF to_regclass('course_enrollments') IS NOT NULL THEN
         UPDATE ${s}.users u SET role = 'JOBSEEKER'
         WHERE u.role = 'CUSTOMER'
           AND (EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id)
             OR EXISTS (
               SELECT 1 FROM ${s}.course_enrollments e
               WHERE e.user_id = u.id OR e.purchaser_id = u.id
             ));
       ELSE
         UPDATE ${s}.users u SET role = 'JOBSEEKER'
         WHERE u.role = 'CUSTOMER'
           AND EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id);
       END IF;
     END $$`,
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
