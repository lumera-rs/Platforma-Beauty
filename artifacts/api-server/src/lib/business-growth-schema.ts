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
 * changes.
 */
export const BUSINESS_GROWTH_SCHEMA_VERSION = 111;

/**
 * Stable advisory lock key for every Business Growth rollout version. It is
 * deliberately pinned to the key shipped by v65, so an already-running v65
 * process and this v66 process contend during the first rolling deployment;
 * all future versions must keep this value unchanged.
 */
export const BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY = 0x42470000 + 65;

/**
 * Every expected label for each Phase 2 enum. `create if absent AND add every
 * expected label IF NOT EXISTS` handles both a brand-new type and a partially
 * applied older one. Order matters only for readability; ADD VALUE appends.
 */
const ENUM_LABELS: Record<string, string[]> = {
  appointment_status: ["pending", "confirmed", "completed", "cancelled", "no-show"],
  integration_key: ["sms", "brevo", "google_oauth", "facebook_oauth", "cloudflare", "web_push"],
  order_status: ["pending", "confirmed", "paid", "processing", "shipped", "delivered", "cancelled"],
  fulfillment_status: ["RECEIVED", "PREPARING", "PACKING", "SHIPPED", "COMPLETED", "CANCELLED"],
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
  supplier_scope: ["B2B", "B2C", "BOTH"],
  similar_products_mode: ["AUTO_CATEGORY", "MANUAL"],
  bundle_market: ["B2B", "B2C", "BOTH"],
  cart_price_source: ["FULL_PRICE", "SALE", "TIER", "LOYALTY_TIER_PRICE", "BUNDLE"],
  commerce_audience: ["B2B", "B2C"],
  loyalty_point_entry_type: ["AWARD", "REVERSAL", "ADJUSTMENT"],
  product_waitlist_status: ["ACTIVE", "NOTIFIED", "UNSUBSCRIBED"],
  coupon_discount_type: ["PERCENTAGE", "FIXED_RSD"],
  approval_request_status: ["PENDING", "APPROVED", "REJECTED", "EXPIRED"],
  price_inquiry_status: ["NEW", "CONTACTED", "CLOSED"],
  rma_status: ["RECEIVED", "IN_REVIEW", "APPROVED", "REJECTED"],
  catalog_sync_status: ["NOT_CONNECTED", "VALIDATED", "FAILED"],
  retail_subscription_frequency: ["WEEKLY", "BIWEEKLY", "MONTHLY", "EVERY_TWO_MONTHS"],
  retail_subscription_status: ["ACTIVE", "PAUSED", "CANCELLED"],
  retail_subscription_attempt_status: ["PROCESSING", "CREATED", "INSUFFICIENT_STOCK", "SKIPPED"],
  b2c_banner_placement: ["HERO", "BELOW_CATEGORIES", "IN_RESULTS"],
  b2c_banner_destination_kind: ["CATEGORY", "PRODUCT", "FILTERED_LISTING", "CUSTOM_INTERNAL_PATH"],
  b2c_product_sort: ["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "NEWEST", "BEST_RATED", "MOST_POPULAR"],
  retail_review_moderation_status: ["PUBLISHED", "REPORTED", "AUTO_FLAGGED", "REMOVED"],
  retail_review_report_reason: ["SPAM", "ABUSE", "HATE", "PERSONAL_INFORMATION", "MISLEADING", "OTHER"],
  retail_review_moderation_action: ["KEEP", "DISMISS_REPORTS", "REMOVE", "RESTORE"],
  aftercare_first_timing: ["IMMEDIATE_AFTER_COMPLETION", "NEXT_DAY"],
  aftercare_recommendation_status: ["PENDING", "ACTIVE", "CONVERTED", "EXPIRED", "CANCELLED"],
  aftercare_line_kind: ["PRODUCT", "PREMADE_BUNDLE", "PERSONALIZED_BUNDLE"],
  aftercare_delivery_kind: ["FIRST", "SECOND", "REPLENISHMENT"],
  aftercare_delivery_status: ["QUEUED", "PROCESSING", "SENT", "FAILED", "SKIPPED"],
  salon_resource_type: ["chair", "booth", "bed", "room", "equipment", "other"],
  education_course_type_status: ["approved", "pending", "rejected"],
  education_review_status: ["pending", "published", "rejected"],
  education_payment_mode: ["online_full", "live_deposit", "live_off_platform"],
  education_placement_kind: ["featured_salon", "featured_center", "special_offer"],
  education_placement_scope: ["home", "category", "subcategory"],
  education_placement_status: ["pending_payment", "active", "expired", "cancelled", "rejected"],
  education_gift_voucher_status: ["pending_payment", "active", "redeemed", "refunded", "cancelled"],
  education_scheduling_mode: ["fixed_group", "individual_calendar"],
  education_staff_role: ["owner_admin", "manager_reception", "educator"],
  education_deposit_disposition: ["refund", "forfeit", "transfer"],
  education_booking_group_status: ["pending", "active", "waitlisted", "cancelled"],
  education_participant_status: ["reserved", "waitlisted", "cancelled"],
  education_attendance_status: ["present", "absent", "excused"],
  education_installment_status: ["pending", "settled", "refunded", "cancelled"],
  education_outbox_status: ["pending", "processing", "sent", "failed"],
  education_bundle_purchase_status: ["pending_payment", "settled", "cancelled", "refunded"],
  education_bundle_purchase_target: ["individual", "salon_employee"],
  education_escrow_status: ["held", "ready_for_payout", "frozen", "paid_out", "refunded", "partially_refunded"],
  education_ledger_entry_type: ["charge", "platform_fee", "reserve_hold", "release", "payout", "refund", "adjustment"],
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
/**
 * Legacy payable rows predate the immutable QR snapshot columns.  Freeze only
 * rows that can be rendered safely from their durable amount/reference and a
 * complete canonical platform account. Rows without that data deliberately
 * remain null; their read endpoints return an explicit compatibility error.
 */
function paymentInstructionSnapshotBackfillStatements(s: string): string[] {
  const validSettings = `(SELECT ips_recipient_name, regexp_replace(ips_recipient_account, '[[:space:]-]', '', 'g') AS account, ips_purpose
    FROM ${s}.education_platform_settings
    WHERE btrim(COALESCE(ips_recipient_name, '')) <> ''
      AND btrim(COALESCE(ips_purpose, '')) <> ''
      AND regexp_replace(COALESCE(ips_recipient_account, ''), '[[:space:]-]', '', 'g') ~ '^[0-9]{18}$'
    ORDER BY updated_at DESC, id DESC LIMIT 1)`;
  const payload = (amount: string, reference: string) => `concat(
    'K:PR|V:01|C:1|R:', settings.account, '|N:', settings.ips_recipient_name,
    '|I:RSD', to_char(${amount}::numeric, 'FM999999999999990.00'),
    '|P:', settings.ips_purpose, '|SF:221|S:', ${reference})`;
  return [
    `UPDATE ${s}.course_enrollments enrollment
       SET payment_instructions_snapshot = jsonb_build_object(
         'payload', ${payload("enrollment.charged_amount", "'EDU' || replace(enrollment.id::text, '-', '')")},
         'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account,
         'purpose', settings.ips_purpose, 'amount', enrollment.charged_amount, 'currency', 'RSD',
         'reference', 'EDU' || replace(enrollment.id::text, '-', ''), 'paymentCode', '221')
       FROM ${validSettings} settings
       WHERE enrollment.payment_instructions_snapshot IS NULL
         AND enrollment.status = 'pending' AND enrollment.payment_status = 'pending'
         AND enrollment.charged_amount > 0`,
    `UPDATE ${s}.education_installments installment
       SET payment_instructions_snapshot = jsonb_build_object(
         'payload', ${payload("installment.amount", "installment.payment_reference")},
         'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account,
         'purpose', settings.ips_purpose, 'amount', installment.amount, 'currency', 'RSD',
         'reference', installment.payment_reference, 'paymentCode', '221')
       FROM ${validSettings} settings
       WHERE installment.payment_instructions_snapshot IS NULL
         AND installment.status = 'pending' AND installment.amount > 0
         AND btrim(COALESCE(installment.payment_reference, '')) <> ''`,
  ];
}

function tableStatements(s: string): string[] {
  return [
    `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
    // ── Existing-table additive changes (Phase 2 evolution) ────────────────
    `ALTER TABLE ${s}.salon_customers ADD COLUMN IF NOT EXISTS birth_date date`,
    // Retention's stratified preview seeks from a random UUID within each salon
    // and reads a bounded circular range. Keep the production bootstrap aligned
    // with core.ts so legacy customer tables never fall back to a full sort.
    `CREATE INDEX IF NOT EXISTS salon_customers_salon_id_idx
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
    `ALTER TABLE ${s}.referral_milestone_benefits
       VALIDATE CONSTRAINT referral_milestone_benefits_discount_percent_check`,
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
    `ALTER TABLE ${s}.referral_codes
       VALIDATE CONSTRAINT referral_codes_source_channel_check`,
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
    `ALTER TABLE ${s}.referral_milestone_benefits
       VALIDATE CONSTRAINT referral_milestone_benefits_business_check`,
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
    `ALTER TABLE ${s}.referral_credit_redemptions
       VALIDATE CONSTRAINT referral_credit_redemptions_positive_amount_check`,
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
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS discount_price_ends_at timestamptz`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS public_discount_price_ends_at timestamptz`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS characteristics jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS search_synonyms jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `CREATE TABLE IF NOT EXISTS ${s}.product_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      media_asset_id uuid NOT NULL REFERENCES ${s}.media_assets(id) ON DELETE RESTRICT,
      display_name text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (product_id, media_asset_id)
    )`,
    `CREATE INDEX IF NOT EXISTS product_documents_product_sort_idx ON ${s}.product_documents (product_id, sort_order, id)`,
    `CREATE INDEX IF NOT EXISTS product_documents_asset_idx ON ${s}.product_documents (media_asset_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.commerce_experience_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      header_enabled boolean NOT NULL DEFAULT false,
      header_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
      header_interval_seconds integer NOT NULL DEFAULT 5,
      smart_search_mode text NOT NULL DEFAULT 'AUTOMATIC',
      smart_search_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      bestseller_period_days integer NOT NULL DEFAULT 30,
      version integer NOT NULL DEFAULT 1,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT commerce_experience_settings_values_check CHECK (
        header_interval_seconds BETWEEN 2 AND 60 AND smart_search_mode IN ('AUTOMATIC','MANUAL')
        AND jsonb_array_length(smart_search_product_ids) <= 5
        AND bestseller_period_days IN (30,60) AND version >= 1
      )
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS commerce_experience_settings_singleton_unique ON ${s}.commerce_experience_settings ((true))`,
    `CREATE INDEX IF NOT EXISTS commerce_experience_settings_updated_by_idx ON ${s}.commerce_experience_settings (updated_by_user_id)`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS professional_enabled boolean NOT NULL DEFAULT true`,
    // v41 — validated product merchandising configuration. JSONB keeps ordered
    // relationship ids and tier rows intact; API writes enforce their invariants.
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS similar_products_mode ${s}.similar_products_mode NOT NULL DEFAULT 'AUTO_CATEGORY'`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS similar_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS cross_sell_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS quantity_pricing_tiers jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS minimum_order_quantity integer NOT NULL DEFAULT 1`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS delivery_business_days_override integer`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS subscription_allowed boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS subscription_discount_percent integer`,
    // v39 — platform-managed supplier catalog. A single deterministic legacy
    // supplier preserves every pre-marketplace catalog row without deleting or
    // rewriting the legacy categoryName/subcategoryName compatibility fields.
    `CREATE TABLE IF NOT EXISTS ${s}.suppliers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      scope ${s}.supplier_scope NOT NULL DEFAULT 'BOTH',
      logo_url text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS suppliers_active_name_idx ON ${s}.suppliers (active, name)`,
    `INSERT INTO ${s}.suppliers (id, name, slug, scope, active)
      VALUES ('9b5970ea-0a8c-5e60-9d32-2a09f0890560', 'LUMERA Legacy Catalog', 'lumera-legacy', 'BOTH', true)
      ON CONFLICT (slug) DO NOTHING`,
    `ALTER TABLE ${s}.product_categories ADD COLUMN IF NOT EXISTS supplier_id uuid`,
    `UPDATE ${s}.product_categories
       SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560'
       WHERE supplier_id IS NULL`,
    `ALTER TABLE ${s}.product_categories ALTER COLUMN supplier_id
       SET DEFAULT '9b5970ea-0a8c-5e60-9d32-2a09f0890560'`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM ${s}.product_categories category
         LEFT JOIN ${s}.suppliers supplier ON supplier.id = category.supplier_id
         WHERE supplier.id IS NULL
       ) THEN RAISE EXCEPTION 'Cannot add category supplier FK: an owner is missing'; END IF;
       IF EXISTS (SELECT 1 FROM ${s}.product_categories WHERE supplier_id IS NULL) THEN
         RAISE EXCEPTION 'Cannot require product_categories.supplier_id: legacy backfill is incomplete';
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.product_categories'::regclass
         AND conname = 'product_categories_supplier_id_fkey') THEN
         ALTER TABLE ${s}.product_categories ADD CONSTRAINT product_categories_supplier_id_fkey
           FOREIGN KEY (supplier_id) REFERENCES ${s}.suppliers(id) ON DELETE RESTRICT;
       END IF;
       ALTER TABLE ${s}.product_categories ALTER COLUMN supplier_id SET NOT NULL;
     END $$`,
     // Replace the legacy global uniqueness constraints with supplier-scoped
     // sibling uniqueness. Root siblings use separate partial indexes because
     // Drizzle's index builder cannot model NULLS NOT DISTINCT.
    `ALTER TABLE ${s}.product_categories DROP CONSTRAINT IF EXISTS product_categories_name_key`,
    `ALTER TABLE ${s}.product_categories DROP CONSTRAINT IF EXISTS product_categories_slug_key`,
    `ALTER TABLE ${s}.product_categories DROP CONSTRAINT IF EXISTS product_categories_name_unique`,
    `ALTER TABLE ${s}.product_categories DROP CONSTRAINT IF EXISTS product_categories_slug_unique`,
    `DROP INDEX IF EXISTS ${s}.product_categories_name_unique`,
    `DROP INDEX IF EXISTS ${s}.product_categories_slug_unique`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_categories_supplier_root_name_unique
        ON ${s}.product_categories (supplier_id, name) WHERE parent_id IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_categories_supplier_root_slug_unique
        ON ${s}.product_categories (supplier_id, slug) WHERE parent_id IS NULL`,
    `ALTER TABLE ${s}.product_categories DROP CONSTRAINT IF EXISTS product_categories_supplier_parent_name_unique`,
    `ALTER TABLE ${s}.product_categories DROP CONSTRAINT IF EXISTS product_categories_supplier_parent_slug_unique`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_categories_supplier_parent_name_unique
       ON ${s}.product_categories (supplier_id, parent_id, name)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_categories_supplier_parent_slug_unique
       ON ${s}.product_categories (supplier_id, parent_id, slug)`,
    `CREATE INDEX IF NOT EXISTS product_categories_supplier_parent_sort_idx
       ON ${s}.product_categories (supplier_id, parent_id, sort_order)`,
    `CREATE INDEX IF NOT EXISTS product_categories_supplier_active_sort_idx
       ON ${s}.product_categories (supplier_id, active, sort_order)`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM ${s}.product_categories child
         LEFT JOIN ${s}.product_categories parent ON parent.id = child.parent_id
         WHERE child.parent_id IS NOT NULL AND parent.id IS NULL
       ) THEN RAISE EXCEPTION 'Cannot add category parent FK: an existing parent is missing'; END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.product_categories'::regclass
         AND conname = 'product_categories_parent_id_fkey') THEN
         ALTER TABLE ${s}.product_categories ADD CONSTRAINT product_categories_parent_id_fkey
           FOREIGN KEY (parent_id) REFERENCES ${s}.product_categories(id) ON DELETE RESTRICT;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS supplier_id uuid`,
    // v65 — administrator-only catalog COGS and immutable order-line
    // profitability snapshots. Legacy lines are explicitly zero-safe.
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS cost_price_rsd integer`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_cost_price_rsd_check'
         AND conrelid = '${s}.products'::regclass) THEN
         ALTER TABLE ${s}.products ADD CONSTRAINT products_cost_price_rsd_check
           CHECK (cost_price_rsd IS NULL OR cost_price_rsd >= 0) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.products VALIDATE CONSTRAINT products_cost_price_rsd_check`,
    `UPDATE ${s}.products
       SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560'
       WHERE supplier_id IS NULL`,
    `ALTER TABLE ${s}.products ALTER COLUMN supplier_id
       SET DEFAULT '9b5970ea-0a8c-5e60-9d32-2a09f0890560'`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM ${s}.products product
         LEFT JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id
         WHERE supplier.id IS NULL
       ) THEN RAISE EXCEPTION 'Cannot add product supplier FK: an owner is missing'; END IF;
       IF EXISTS (SELECT 1 FROM ${s}.products WHERE supplier_id IS NULL) THEN
         RAISE EXCEPTION 'Cannot require products.supplier_id: legacy backfill is incomplete';
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.products'::regclass
         AND conname = 'products_supplier_id_fkey') THEN
         ALTER TABLE ${s}.products ADD CONSTRAINT products_supplier_id_fkey
           FOREIGN KEY (supplier_id) REFERENCES ${s}.suppliers(id) ON DELETE RESTRICT;
       END IF;
       ALTER TABLE ${s}.products ALTER COLUMN supplier_id SET NOT NULL;
     END $$`,
    `CREATE INDEX IF NOT EXISTS products_supplier_category_active_idx
       ON ${s}.products (supplier_id, category_id, active)`,
    `CREATE INDEX IF NOT EXISTS products_supplier_active_created_idx
       ON ${s}.products (supplier_id, active, created_at)`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM ${s}.products product
         LEFT JOIN ${s}.product_categories category ON category.id = product.category_id
         WHERE product.category_id IS NOT NULL
           AND (category.id IS NULL OR category.supplier_id <> product.supplier_id)
       ) THEN RAISE EXCEPTION 'Cannot enforce product category ownership: legacy catalog is inconsistent'; END IF;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.enforce_supplier_catalog_ownership()
      RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE parent_supplier uuid; category_supplier uuid; supplier_scope_value ${s}.supplier_scope;
      BEGIN
        IF TG_TABLE_NAME = 'product_categories' THEN
          IF NEW.parent_id IS NOT NULL THEN
            SELECT supplier_id INTO parent_supplier FROM ${s}.product_categories WHERE id = NEW.parent_id;
            IF parent_supplier IS NULL OR parent_supplier <> NEW.supplier_id THEN
              RAISE EXCEPTION 'Category parent must belong to the same supplier';
            END IF;
            IF NEW.id IS NOT NULL AND NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Category cannot be its own parent'; END IF;
            IF NEW.id IS NOT NULL AND EXISTS (
              WITH RECURSIVE ancestors AS (
                SELECT id, parent_id FROM ${s}.product_categories WHERE id = NEW.parent_id
                UNION
                SELECT category.id, category.parent_id FROM ${s}.product_categories category
                JOIN ancestors ON category.id = ancestors.parent_id
              ) SELECT 1 FROM ancestors WHERE id = NEW.id
            ) THEN RAISE EXCEPTION 'Category parent would create a cycle'; END IF;
          END IF;
        ELSE
          SELECT supplier_id INTO category_supplier FROM ${s}.product_categories WHERE id = NEW.category_id;
          IF NEW.category_id IS NOT NULL AND (category_supplier IS NULL OR category_supplier <> NEW.supplier_id) THEN
            RAISE EXCEPTION 'Product category must belong to the same supplier';
          END IF;
          SELECT scope INTO supplier_scope_value FROM ${s}.suppliers
          WHERE id = NEW.supplier_id
          FOR SHARE;
          IF supplier_scope_value IS NULL
             OR (NEW.retail_enabled AND supplier_scope_value NOT IN ('B2C', 'BOTH'))
             OR (NEW.professional_enabled AND supplier_scope_value NOT IN ('B2B', 'BOTH')) THEN
            RAISE EXCEPTION 'Product sales channels are not permitted by supplier scope';
          END IF;
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS product_categories_supplier_ownership ON ${s}.product_categories`,
    `CREATE TRIGGER product_categories_supplier_ownership BEFORE INSERT OR UPDATE ON ${s}.product_categories
       FOR EACH ROW EXECUTE FUNCTION ${s}.enforce_supplier_catalog_ownership()`,
    `DROP TRIGGER IF EXISTS products_supplier_ownership ON ${s}.products`,
    `CREATE TRIGGER products_supplier_ownership BEFORE INSERT OR UPDATE ON ${s}.products
       FOR EACH ROW EXECUTE FUNCTION ${s}.enforce_supplier_catalog_ownership()`,
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
      contact_email text,
      activity_version integer NOT NULL DEFAULT 1 CHECK (activity_version >= 1),
      reminder_enqueued_activity_version integer,
      completed_activity_version integer,
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
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS fulfillment_status ${s}.fulfillment_status NOT NULL DEFAULT 'RECEIVED'`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS fulfillment_status ${s}.fulfillment_status NOT NULL DEFAULT 'RECEIVED'`,
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'status') THEN
         UPDATE ${s}.orders SET fulfillment_status = CASE
           WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status
           WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status
           WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status
           WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status
           ELSE 'RECEIVED'::${s}.fulfillment_status END
           WHERE fulfillment_status = 'RECEIVED';
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'retail_orders' AND column_name = 'status') THEN
         UPDATE ${s}.retail_orders SET fulfillment_status = CASE
           WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status
           WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status
           WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status
           WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status
           ELSE 'RECEIVED'::${s}.fulfillment_status END
           WHERE fulfillment_status = 'RECEIVED';
       END IF;
     END $$`,
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS tracking_url text`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS tracking_url text`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS tracking_token_expires_at timestamptz`,
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS tracking_token_rotated_at timestamptz`,
    `UPDATE ${s}.retail_orders SET tracking_token_expires_at = created_at + interval '180 days'
       WHERE tracking_token_expires_at IS NULL`,
    `ALTER TABLE ${s}.retail_orders ALTER COLUMN tracking_token_expires_at SET NOT NULL`,
    `ALTER TABLE ${s}.retail_orders ALTER COLUMN tracking_token_expires_at SET DEFAULT (now() + interval '180 days')`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_order_status_history (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       retail_order_id uuid NOT NULL REFERENCES ${s}.retail_orders(id) ON DELETE CASCADE,
       actor_user_id uuid, actor_name text NOT NULL DEFAULT 'Administrator',
       field text NOT NULL, previous_value text, next_value text, note text,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS retail_order_status_history_order_created_idx
       ON ${s}.retail_order_status_history (retail_order_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_tracking_rate_limits (
       client_key_hash text PRIMARY KEY,
       window_started_at timestamptz NOT NULL,
       request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS retail_tracking_rate_limits_updated_idx
       ON ${s}.retail_tracking_rate_limits (updated_at)`,
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
    // v62 — B2C G2 checkout is immutable evidence: rule ids/versions/config,
    // qualification result and allocations are deliberately snapshots, never FKs.
    `ALTER TABLE ${s}.retail_orders ADD COLUMN IF NOT EXISTS promotion_snapshot jsonb`,
    // v63 — B2B uses the same immutable G2 evidence boundary as retail.
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS promotion_snapshot jsonb`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_promotion_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN
          RAISE EXCEPTION 'Order promotion snapshot is immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS orders_promotion_snapshot_immutable ON ${s}.orders`,
    `CREATE TRIGGER orders_promotion_snapshot_immutable BEFORE UPDATE ON ${s}.orders
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_order_promotion_snapshot_update()`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_promotion_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN
          RAISE EXCEPTION 'Retail order promotion snapshot is immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS retail_orders_promotion_snapshot_immutable ON ${s}.retail_orders`,
    `CREATE TRIGGER retail_orders_promotion_snapshot_immutable BEFORE UPDATE ON ${s}.retail_orders
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_retail_order_promotion_snapshot_update()`,
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
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgrelid = '${s}.retail_order_items'::regclass
           AND tgname = 'retail_order_items_commercial_snapshot_immutable'
           AND NOT tgisinternal
       ) THEN
         UPDATE ${s}.retail_order_items AS item
           SET product_catalog_reference = product.catalog_reference
           FROM ${s}.products AS product
           WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL;
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_order_idx ON ${s}.retail_order_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_product_idx ON ${s}.retail_order_items (product_id)`,
    // v19: exact immutable-reference searches use this covering lookup before
    // joining the bounded admin result back to retail_orders.
    `CREATE INDEX IF NOT EXISTS retail_order_items_catalog_reference_order_idx
       ON ${s}.retail_order_items (product_catalog_reference, order_id)`,
    // v39 — immutable supplier and commercial line snapshots. Populate from
    // the product/catalog as it exists during rollout before making the facts
    // required; existing orders remain valid if that supplier is later retired.
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS supplier_id uuid`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS supplier_name text`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS supplier_slug text`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS product_catalog_reference text`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS product_sku_snapshot text`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'B2B'`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RSD'`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS unit_price integer`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS discount_snapshot integer`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS line_subtotal integer`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS line_total integer`,
    // Fail closed outside this session while the migration is in progress. A
    // failed rollout therefore cannot leave a permissive trigger behind.
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN RETURN NEW; END IF;
         RAISE EXCEPTION 'Order item commercial snapshot is immutable';
       END $$`,
    // v71 — B2B order_items does not have retail-only aftercare evidence
    // columns. Split the trigger functions so each row type references only its
    // own physical columns.
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
       IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
         OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
         OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot OR NEW.market IS DISTINCT FROM OLD.market
         OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
         OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot OR NEW.quantity IS DISTINCT FROM OLD.quantity
         OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal OR NEW.line_total IS DISTINCT FROM OLD.line_total
         OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
         OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price OR NEW.price_source IS DISTINCT FROM OLD.price_source
         OR NEW.line_discount IS DISTINCT FROM OLD.line_discount OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
         OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
         OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
         OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
         OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
         OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot THEN RAISE EXCEPTION 'Order item commercial snapshot is immutable'; END IF;
       RETURN NEW; END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
       IF NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd
         OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd
         OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id THEN
         RAISE EXCEPTION 'Order item commercial snapshot is immutable'; END IF;
       RETURN NEW; END $$`,
    `DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_immutable ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_commercial_snapshot_immutable BEFORE UPDATE ON ${s}.retail_order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_incomplete_commercial_snapshot_insert()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN RETURN NEW; END IF;
         IF NEW.supplier_id IS NULL OR NEW.supplier_name IS NULL OR NEW.supplier_slug IS NULL
           OR (NEW.product_id IS NOT NULL AND NEW.product_catalog_reference IS NULL)
           OR NEW.unit_price IS NULL OR NEW.line_subtotal IS NULL OR NEW.line_total IS NULL THEN
           RAISE EXCEPTION 'Commercial order-item snapshot is required during migration';
         END IF;
         RETURN NEW;
       END $$`,
    `DROP TRIGGER IF EXISTS order_items_commercial_snapshot_migration_guard ON ${s}.order_items`,
    `CREATE TRIGGER order_items_commercial_snapshot_migration_guard BEFORE INSERT OR UPDATE ON ${s}.order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_incomplete_commercial_snapshot_insert()`,
    `DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_migration_guard ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_commercial_snapshot_migration_guard BEFORE INSERT OR UPDATE ON ${s}.retail_order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_incomplete_commercial_snapshot_insert()`,
    `SELECT set_config('lumera.snapshot_backfill', 'on', false)`,
    `UPDATE ${s}.order_items AS item SET
       supplier_id = COALESCE(item.supplier_id, product.supplier_id),
       supplier_name = COALESCE(item.supplier_name, supplier.name),
       supplier_slug = COALESCE(item.supplier_slug, supplier.slug),
       product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference),
       product_sku_snapshot = COALESCE(item.product_sku_snapshot, item.product_sku, product.sku),
       unit_price = COALESCE(item.unit_price, item.price),
       line_subtotal = COALESCE(item.line_subtotal, item.price * item.quantity),
       line_total = COALESCE(item.line_total, item.price * item.quantity)
       FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id
       WHERE item.product_id = product.id`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS supplier_id uuid`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS supplier_name text`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS supplier_slug text`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS product_sku_snapshot text`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'B2C'`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RSD'`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS discount_snapshot integer`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS line_subtotal integer`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS line_total integer`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS automatic_promotion_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS threshold_reward_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS personalized_treatment_bundle_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS post_treatment_recommendation_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS aftercare_recommendation_id uuid`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS automatic_promotion_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS threshold_reward_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS unit_cost_price_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS line_cogs_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS referral_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS realized_revenue_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS category_id_snapshot uuid`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS category_name_snapshot text`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS brand_snapshot text`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS unit_cost_price_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS line_cogs_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS referral_discount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS realized_revenue_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS category_id_snapshot uuid`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS category_name_snapshot text`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS brand_snapshot text`,
    // A prior rollout may already have the immutable trigger installed when a
    // deployment retries this additive backfill.  Replace its shared function
    // first with a session-gated version, then enable that gate only for the
    // two controlled legacy updates below.  The final definition later in this
    // rollout is strict again.  `runBusinessGrowthSchemaDdl` resets the gate in
    // a finally block, including on failure, so a pooled connection can never
    // retain a bypass.
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN
           RETURN NEW;
         END IF;
         IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
           OR NEW.line_total IS DISTINCT FROM OLD.line_total
           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
            OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
            OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
            OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
            OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
            OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
           RAISE EXCEPTION 'Order item commercial snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    `SELECT set_config('lumera.snapshot_backfill', 'on', false)`,
    `UPDATE ${s}.order_items SET realized_revenue_rsd = line_total
       WHERE realized_revenue_rsd = 0 AND line_total > 0`,
    `UPDATE ${s}.retail_order_items SET realized_revenue_rsd = line_total
       WHERE realized_revenue_rsd = 0 AND line_total > 0`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_profit_snapshot_check'
         AND conrelid = '${s}.order_items'::regclass) THEN
         ALTER TABLE ${s}.order_items ADD CONSTRAINT order_items_profit_snapshot_check CHECK (
           unit_cost_price_rsd >= 0 AND line_cogs_rsd >= 0 AND referral_discount_rsd >= 0
           AND realized_revenue_rsd >= 0 AND referral_discount_rsd <= line_total
         ) NOT VALID;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retail_order_items_profit_snapshot_check'
         AND conrelid = '${s}.retail_order_items'::regclass) THEN
         ALTER TABLE ${s}.retail_order_items ADD CONSTRAINT retail_order_items_profit_snapshot_check CHECK (
           unit_cost_price_rsd >= 0 AND line_cogs_rsd >= 0 AND referral_discount_rsd >= 0
           AND realized_revenue_rsd >= 0 AND referral_discount_rsd <= line_total
         ) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.order_items VALIDATE CONSTRAINT order_items_profit_snapshot_check`,
    `ALTER TABLE ${s}.retail_order_items VALIDATE CONSTRAINT retail_order_items_profit_snapshot_check`,
    // v64 — GIFT_PRODUCT rewards are explicit immutable, zero-price inventory lines.
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS is_reward_gift boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.retail_order_items ADD COLUMN IF NOT EXISTS reward_snapshot jsonb`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS is_reward_gift boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.order_items ADD COLUMN IF NOT EXISTS reward_snapshot jsonb`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retail_order_items_reward_gift_check'
         AND conrelid = '${s}.retail_order_items'::regclass) THEN
         ALTER TABLE ${s}.retail_order_items ADD CONSTRAINT retail_order_items_reward_gift_check
           CHECK (NOT is_reward_gift OR (product_id IS NOT NULL AND unit_price = 0 AND line_subtotal = 0 AND line_total = 0 AND reward_snapshot IS NOT NULL)) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.retail_order_items VALIDATE CONSTRAINT retail_order_items_reward_gift_check`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_reward_gift_check'
         AND conrelid = '${s}.order_items'::regclass) THEN
         ALTER TABLE ${s}.order_items ADD CONSTRAINT order_items_reward_gift_check
           CHECK (NOT is_reward_gift OR (product_id IS NOT NULL AND price = 0 AND unit_price = 0 AND line_subtotal = 0 AND line_total = 0 AND reward_snapshot IS NOT NULL)) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.order_items VALIDATE CONSTRAINT order_items_reward_gift_check`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_g2_discount_check'
         AND conrelid = '${s}.order_items'::regclass) THEN
         ALTER TABLE ${s}.order_items ADD CONSTRAINT order_items_g2_discount_check
           CHECK (automatic_promotion_discount_rsd >= 0 AND threshold_reward_discount_rsd >= 0) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.order_items VALIDATE CONSTRAINT order_items_g2_discount_check`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retail_order_items_g2_discount_check'
         AND conrelid = '${s}.retail_order_items'::regclass) THEN
         ALTER TABLE ${s}.retail_order_items ADD CONSTRAINT retail_order_items_g2_discount_check
           CHECK (automatic_promotion_discount_rsd >= 0 AND threshold_reward_discount_rsd >= 0) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.retail_order_items VALIDATE CONSTRAINT retail_order_items_g2_discount_check`,
    `UPDATE ${s}.retail_order_items AS item SET
       supplier_id = COALESCE(item.supplier_id, product.supplier_id),
       supplier_name = COALESCE(item.supplier_name, supplier.name),
       supplier_slug = COALESCE(item.supplier_slug, supplier.slug),
       product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference),
       product_sku_snapshot = COALESCE(item.product_sku_snapshot, product.sku),
       discount_snapshot = COALESCE(item.discount_snapshot,
         CASE WHEN product.public_price IS NOT NULL AND product.public_price > item.unit_price
           THEN product.public_price - item.unit_price ELSE NULL END),
       line_subtotal = COALESCE(item.line_subtotal, item.unit_price * item.quantity),
       line_total = COALESCE(item.line_total, item.unit_price * item.quantity)
       FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id
       WHERE item.product_id = product.id`,
    `SELECT set_config('lumera.snapshot_backfill', 'off', false)`,
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM ${s}.order_items WHERE supplier_id IS NULL OR supplier_name IS NULL
         OR supplier_slug IS NULL OR (product_id IS NOT NULL AND product_catalog_reference IS NULL) OR unit_price IS NULL
         OR line_subtotal IS NULL OR line_total IS NULL) THEN
         RAISE EXCEPTION 'Cannot require order item snapshots: legacy backfill is incomplete';
       END IF;
       IF EXISTS (SELECT 1 FROM ${s}.retail_order_items WHERE supplier_id IS NULL OR supplier_name IS NULL
         OR supplier_slug IS NULL OR (product_id IS NOT NULL AND product_catalog_reference IS NULL) OR unit_price IS NULL
         OR line_subtotal IS NULL OR line_total IS NULL) THEN
         RAISE EXCEPTION 'Cannot require retail order item snapshots: legacy backfill is incomplete';
       END IF;
       ALTER TABLE ${s}.order_items ALTER COLUMN supplier_id SET NOT NULL;
       ALTER TABLE ${s}.order_items ALTER COLUMN supplier_name SET NOT NULL;
       ALTER TABLE ${s}.order_items ALTER COLUMN supplier_slug SET NOT NULL;
       IF EXISTS (SELECT 1 FROM ${s}.order_items WHERE product_id IS NULL) THEN
         ALTER TABLE ${s}.order_items ALTER COLUMN product_catalog_reference DROP NOT NULL;
       ELSE
         ALTER TABLE ${s}.order_items ALTER COLUMN product_catalog_reference SET NOT NULL;
       END IF;
       ALTER TABLE ${s}.order_items ALTER COLUMN unit_price SET NOT NULL;
       ALTER TABLE ${s}.order_items ALTER COLUMN line_subtotal SET NOT NULL;
       ALTER TABLE ${s}.order_items ALTER COLUMN line_total SET NOT NULL;
       ALTER TABLE ${s}.retail_order_items ALTER COLUMN supplier_id SET NOT NULL;
       ALTER TABLE ${s}.retail_order_items ALTER COLUMN supplier_name SET NOT NULL;
       ALTER TABLE ${s}.retail_order_items ALTER COLUMN supplier_slug SET NOT NULL;
       IF EXISTS (SELECT 1 FROM ${s}.retail_order_items WHERE product_id IS NULL) THEN
         ALTER TABLE ${s}.retail_order_items ALTER COLUMN product_catalog_reference DROP NOT NULL;
       ELSE
         ALTER TABLE ${s}.retail_order_items ALTER COLUMN product_catalog_reference SET NOT NULL;
       END IF;
       ALTER TABLE ${s}.retail_order_items ALTER COLUMN line_subtotal SET NOT NULL;
       ALTER TABLE ${s}.retail_order_items ALTER COLUMN line_total SET NOT NULL;
     END $$`,
    `CREATE INDEX IF NOT EXISTS order_items_supplier_idx ON ${s}.order_items (supplier_id)`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_supplier_idx ON ${s}.retail_order_items (supplier_id)`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
          OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
          OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
          OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
          OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
          OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
          OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
          OR NEW.quantity IS DISTINCT FROM OLD.quantity
          OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
          OR NEW.line_total IS DISTINCT FROM OLD.line_total
          OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
          OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
          OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
          OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
          OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
          OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
          OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price
          OR NEW.price_source IS DISTINCT FROM OLD.price_source
          OR NEW.line_discount IS DISTINCT FROM OLD.line_discount
          OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
          OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot
          OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
          OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
          OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
          OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
          OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
          OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
          RAISE EXCEPTION 'Order item commercial snapshot is immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
          OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
          OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
          OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
          OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
          OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
          OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
          OR NEW.quantity IS DISTINCT FROM OLD.quantity
          OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
          OR NEW.line_total IS DISTINCT FROM OLD.line_total
          OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
          OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
          OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
          OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
          OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd
          OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd
          OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id
          OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
          OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
          OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
          OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
          OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
          RAISE EXCEPTION 'Order item commercial snapshot is immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS order_items_commercial_snapshot_immutable ON ${s}.order_items`,
    `CREATE TRIGGER order_items_commercial_snapshot_immutable BEFORE UPDATE ON ${s}.order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()`,
    `DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_immutable ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_commercial_snapshot_immutable BEFORE UPDATE ON ${s}.retail_order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()`,
    `DROP TRIGGER IF EXISTS order_items_commercial_snapshot_migration_guard ON ${s}.order_items`,
    `DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_migration_guard ON ${s}.retail_order_items`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_g2_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN
          RAISE EXCEPTION 'Retail G2 promotion allocations are immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS retail_order_items_g2_snapshot_immutable ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_g2_snapshot_immutable BEFORE UPDATE ON ${s}.retail_order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_retail_g2_snapshot_update()`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_g2_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN
          RAISE EXCEPTION 'Order G2 promotion allocations are immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS order_items_g2_snapshot_immutable ON ${s}.order_items`,
    `CREATE TRIGGER order_items_g2_snapshot_immutable BEFORE UPDATE ON ${s}.order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_order_g2_snapshot_update()`,
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
    // non-completed appointments makes the hot history probe smaller. Regular
    // CREATE INDEX avoids CREATE INDEX CONCURRENTLY waiting on the virtual
    // transactions of processes blocked on the rollout advisory lock.
    `CREATE INDEX IF NOT EXISTS appointments_salon_customer_completed_date_idx
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
    // Regular index DDL is required by the blocking rollout lock: concurrent
    // index builds can deadlock with advisory-lock waiters' virtual transactions.
    // Mirrors email_deliveries_provider_message_idx in lib/db/src/schema/core.ts.
    `ALTER TABLE ${s}.email_deliveries ADD COLUMN IF NOT EXISTS provider_message_id text`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_provider_message_idx
       ON ${s}.email_deliveries (provider_message_id)
       WHERE email_type = 'automation'`,
    // v23: bounded Beauty Poslovi delivery-issue dashboard scans and alert
    // cooldown history. These partial indexes mirror core.ts and exclude every
    // unrelated transactional email from the operational hot path.
    `CREATE INDEX IF NOT EXISTS email_deliveries_beauty_job_issue_idx
       ON ${s}.email_deliveries (status, created_at)
       WHERE email_type IN ('beauty_job_new_contact', 'beauty_job_author_reply', 'beauty_job_moderation', 'beauty_job_expiry_warning')`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_beauty_job_alert_history_idx
       ON ${s}.email_deliveries (recipient_email, created_at)
       WHERE email_type = 'beauty_job_delivery_alert'`,

    // v22: marketing consent is separate from transactional delivery. Existing
    // accounts remain opted in so this additive rollout never changes consent
    // without an explicit user action.
    `ALTER TABLE ${s}.users ADD COLUMN IF NOT EXISTS marketing_emails_enabled boolean NOT NULL DEFAULT true`,
    // v82 — SUPER_ADMIN-created CUSTOMER accounts use a short-lived,
    // one-time password setup capability. Only token digests and privacy-safe
    // rate-limit keys are persisted.
    `ALTER TABLE ${s}.users ADD COLUMN IF NOT EXISTS password_set_at timestamptz`,
    `CREATE TABLE IF NOT EXISTS ${s}.customer_password_setup_tokens (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       issued_by_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       token_hash text NOT NULL,
       expires_at timestamptz NOT NULL,
       consumed_at timestamptz,
       invalidated_at timestamptz,
       failed_attempts integer NOT NULL DEFAULT 0,
       max_attempts integer NOT NULL DEFAULT 5,
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT customer_password_setup_tokens_attempts_check
         CHECK (failed_attempts >= 0 AND max_attempts BETWEEN 1 AND 10)
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS customer_password_setup_tokens_hash_unique
       ON ${s}.customer_password_setup_tokens (token_hash)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS customer_password_setup_tokens_one_active_user
       ON ${s}.customer_password_setup_tokens (user_id)
       WHERE consumed_at IS NULL AND invalidated_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS customer_password_setup_tokens_user_created_idx
       ON ${s}.customer_password_setup_tokens (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS customer_password_setup_tokens_issuer_created_idx
       ON ${s}.customer_password_setup_tokens (issued_by_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS customer_password_setup_tokens_expiry_idx
       ON ${s}.customer_password_setup_tokens (expires_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.customer_password_setup_audits (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       administrator_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       target_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       action text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT customer_password_setup_audits_action_check
         CHECK (action IN ('CUSTOMER_CREATED', 'PASSWORD_SET'))
     )`,
    `CREATE INDEX IF NOT EXISTS customer_password_setup_audits_target_created_idx
       ON ${s}.customer_password_setup_audits (target_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS customer_password_setup_audits_admin_created_idx
       ON ${s}.customer_password_setup_audits (administrator_user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.customer_password_setup_rate_limits (
       key_hash text NOT NULL,
       action text NOT NULL,
       window_started_at timestamptz NOT NULL,
       request_count integer NOT NULL DEFAULT 1,
       updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT customer_password_setup_rate_limits_count_check CHECK (request_count > 0),
       UNIQUE (key_hash, action)
     )`,
    `CREATE INDEX IF NOT EXISTS customer_password_setup_rate_limits_updated_idx
       ON ${s}.customer_password_setup_rate_limits (updated_at)`,
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
    `CREATE INDEX IF NOT EXISTS employee_time_off_employee_date_time_idx
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
    // v76 — owner-scoped, durable idempotency/replay evidence for the
    // additional-location command. Response is retained verbatim so retries do
    // not create another independently-operated location.
    `CREATE TABLE IF NOT EXISTS ${s}.salon_location_creation_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      idempotency_key text NOT NULL,
      request_hash text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS salon_location_creation_requests_owner_key_unique
      ON ${s}.salon_location_creation_requests (owner_id, idempotency_key)`,
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
    // v42 — cart growth: fixed-price bundles, explicit pricing evidence,
    // saved items, loyalty accounting, waitlist/outbox and unified settings.
    `CREATE TABLE IF NOT EXISTS ${s}.product_bundles (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       supplier_id uuid NOT NULL REFERENCES ${s}.suppliers(id) ON DELETE RESTRICT,
       name text NOT NULL, description text, image_url text,
       market ${s}.bundle_market NOT NULL,
       b2b_price integer, b2c_price integer,
       active boolean NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT product_bundles_market_prices_check CHECK (
         (market = 'B2B' AND b2b_price > 0 AND b2c_price IS NULL)
         OR (market = 'B2C' AND b2c_price > 0 AND b2b_price IS NULL)
         OR (market = 'BOTH' AND b2b_price > 0 AND b2c_price > 0)
       )
     )`,
    `CREATE INDEX IF NOT EXISTS product_bundles_supplier_active_idx
       ON ${s}.product_bundles (supplier_id, active)`,
    `CREATE TABLE IF NOT EXISTS ${s}.product_bundle_components (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       bundle_id uuid NOT NULL REFERENCES ${s}.product_bundles(id) ON DELETE CASCADE,
       product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT,
       quantity integer NOT NULL CHECK (quantity > 0), sort_order integer NOT NULL,
       UNIQUE (bundle_id, product_id), UNIQUE (bundle_id, sort_order)
     )`,
    `CREATE INDEX IF NOT EXISTS product_bundle_components_product_idx
       ON ${s}.product_bundle_components (product_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.shop_settings (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       show_loyalty_points boolean NOT NULL DEFAULT true,
       points_per_100_rsd integer NOT NULL DEFAULT 1 CHECK (points_per_100_rsd >= 0),
       low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 1),
       default_delivery_business_days integer NOT NULL DEFAULT 3
         CHECK (default_delivery_business_days BETWEEN 1 AND 365),
       version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS shop_settings_singleton_unique ON ${s}.shop_settings ((true))`,
    `INSERT INTO ${s}.shop_settings DEFAULT VALUES ON CONFLICT DO NOTHING`,
    `ALTER TABLE ${s}.shopping_cart_items ADD COLUMN IF NOT EXISTS bundle_id uuid
       REFERENCES ${s}.product_bundles(id) ON DELETE CASCADE`,
    `ALTER TABLE ${s}.retail_cart_items ADD COLUMN IF NOT EXISTS bundle_id uuid
       REFERENCES ${s}.product_bundles(id) ON DELETE CASCADE`,
    `ALTER TABLE ${s}.shopping_cart_items ALTER COLUMN product_id DROP NOT NULL`,
    `ALTER TABLE ${s}.retail_cart_items ALTER COLUMN product_id DROP NOT NULL`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.shopping_cart_items'::regclass
         AND conname = 'shopping_cart_items_target_check') THEN
         ALTER TABLE ${s}.shopping_cart_items ADD CONSTRAINT shopping_cart_items_target_check
           CHECK (num_nonnulls(product_id, bundle_id) = 1);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.retail_cart_items'::regclass
         AND conname = 'retail_cart_items_target_check') THEN
         ALTER TABLE ${s}.retail_cart_items ADD CONSTRAINT retail_cart_items_target_check
           CHECK (num_nonnulls(product_id, bundle_id) = 1);
       END IF;
     END $$`,
    `CREATE UNIQUE INDEX IF NOT EXISTS shopping_cart_items_cart_bundle_unique
       ON ${s}.shopping_cart_items (cart_id, bundle_id) WHERE bundle_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS retail_cart_items_cart_bundle_unique
       ON ${s}.retail_cart_items (cart_id, bundle_id) WHERE bundle_id IS NOT NULL`,
    // v48 — Persist import application receipts so a B2B upload retry cannot
    // merge its quantities more than once.
    `CREATE TABLE IF NOT EXISTS ${s}.b2b_cart_imports (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       cart_id uuid REFERENCES ${s}.shopping_carts(id) ON DELETE SET NULL,
       idempotency_key text NOT NULL, content_hash text NOT NULL,
       result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT b2b_cart_imports_salon_idempotency_unique UNIQUE (salon_id, idempotency_key)
     )`,
    `CREATE INDEX IF NOT EXISTS b2b_cart_imports_cart_idx ON ${s}.b2b_cart_imports (cart_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.saved_shop_cart_items (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       cart_id uuid NOT NULL REFERENCES ${s}.shopping_carts(id) ON DELETE CASCADE,
       product_id uuid REFERENCES ${s}.products(id) ON DELETE CASCADE,
       bundle_id uuid REFERENCES ${s}.product_bundles(id) ON DELETE CASCADE,
       variant_value text, quantity integer NOT NULL CHECK (quantity > 0),
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT saved_shop_cart_items_target_check
         CHECK (num_nonnulls(product_id, bundle_id) = 1)
     )`,
    `CREATE INDEX IF NOT EXISTS saved_shop_cart_items_cart_idx ON ${s}.saved_shop_cart_items (cart_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.saved_retail_cart_items (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       cart_id uuid NOT NULL REFERENCES ${s}.retail_carts(id) ON DELETE CASCADE,
       product_id uuid REFERENCES ${s}.products(id) ON DELETE CASCADE,
       bundle_id uuid REFERENCES ${s}.product_bundles(id) ON DELETE CASCADE,
       variant_value text, quantity integer NOT NULL CHECK (quantity > 0),
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT saved_retail_cart_items_target_check
         CHECK (num_nonnulls(product_id, bundle_id) = 1)
     )`,
    `CREATE INDEX IF NOT EXISTS saved_retail_cart_items_cart_idx ON ${s}.saved_retail_cart_items (cart_id)`,
    ...["order_items", "retail_order_items"].flatMap((table) => [
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS bundle_id uuid`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS base_unit_price integer NOT NULL DEFAULT 0`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS effective_unit_price integer NOT NULL DEFAULT 0`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS price_source ${s}.cart_price_source NOT NULL DEFAULT 'FULL_PRICE'`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS line_discount integer NOT NULL DEFAULT 0`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS bundle_name_snapshot text`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS bundle_components_snapshot jsonb`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS estimated_delivery_date text`,
      `ALTER TABLE ${s}.${table} ALTER COLUMN product_id DROP NOT NULL`,
      `ALTER TABLE ${s}.${table} ALTER COLUMN product_catalog_reference DROP NOT NULL`,
    ]),
    `CREATE TABLE IF NOT EXISTS ${s}.order_bundle_components (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       order_item_id uuid NOT NULL REFERENCES ${s}.order_items(id) ON DELETE CASCADE,
       product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT,
       product_name text NOT NULL,
       product_catalog_reference text NOT NULL,
       quantity integer NOT NULL CHECK (quantity > 0),
       CONSTRAINT order_bundle_components_item_product_unique UNIQUE (order_item_id, product_id)
     )`,
    `CREATE INDEX IF NOT EXISTS order_bundle_components_product_idx ON ${s}.order_bundle_components (product_id)`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_bundle_component_update()
       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
         RAISE EXCEPTION 'Order bundle component snapshot is immutable';
       END $$`,
    `DROP TRIGGER IF EXISTS order_bundle_components_immutable ON ${s}.order_bundle_components`,
    `CREATE TRIGGER order_bundle_components_immutable BEFORE UPDATE ON ${s}.order_bundle_components
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_order_bundle_component_update()`,
    ...["orders", "retail_orders"].flatMap((table) => [
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS estimated_delivery_date text`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS loyalty_points_awarded integer NOT NULL DEFAULT 0`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS loyalty_points_reversed_at timestamptz`,
    ]),
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.order_items'::regclass
         AND conname = 'order_items_target_check') THEN
         ALTER TABLE ${s}.order_items ADD CONSTRAINT order_items_target_check
           CHECK (num_nonnulls(product_id, bundle_id) = 1);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${s}.retail_order_items'::regclass
         AND conname = 'retail_order_items_target_check') THEN
         ALTER TABLE ${s}.retail_order_items ADD CONSTRAINT retail_order_items_target_check
           CHECK (num_nonnulls(product_id, bundle_id) = 1);
       END IF;
     END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.loyalty_point_ledger (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       audience ${s}.commerce_audience NOT NULL,
       salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
       user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       order_id uuid REFERENCES ${s}.orders(id) ON DELETE RESTRICT,
       retail_order_id uuid REFERENCES ${s}.retail_orders(id) ON DELETE RESTRICT,
       type ${s}.loyalty_point_entry_type NOT NULL, points integer NOT NULL,
       idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT loyalty_point_ledger_owner_check CHECK (
         (audience = 'B2B' AND salon_id IS NOT NULL AND user_id IS NULL)
         OR (audience = 'B2C' AND user_id IS NOT NULL AND salon_id IS NULL)),
       CONSTRAINT loyalty_point_ledger_order_check CHECK (num_nonnulls(order_id, retail_order_id) <= 1)
     )`,
    `CREATE INDEX IF NOT EXISTS loyalty_point_ledger_salon_created_idx
       ON ${s}.loyalty_point_ledger (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS loyalty_point_ledger_user_created_idx
       ON ${s}.loyalty_point_ledger (user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.product_waitlist (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
       audience ${s}.commerce_audience NOT NULL,
       salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       user_id uuid REFERENCES ${s}.users(id) ON DELETE CASCADE,
       status ${s}.product_waitlist_status NOT NULL DEFAULT 'ACTIVE',
       notified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT product_waitlist_owner_check CHECK (
         (audience = 'B2B' AND salon_id IS NOT NULL AND user_id IS NULL)
         OR (audience = 'B2C' AND user_id IS NOT NULL AND salon_id IS NULL))
     )`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_product_status_idx
       ON ${s}.product_waitlist (product_id, status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_waitlist_active_salon_unique
       ON ${s}.product_waitlist (product_id, salon_id) WHERE status = 'ACTIVE' AND salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_waitlist_active_user_unique
       ON ${s}.product_waitlist (product_id, user_id) WHERE status = 'ACTIVE' AND user_id IS NOT NULL`,
    // v48 — B2C wishlists remain user-owned even when a product later becomes
    // unavailable; only adding a new item is gated by retail visibility.
    `CREATE TABLE IF NOT EXISTS ${s}.product_wishlists (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
       variant_value text, created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_wishlists_user_product_variant_unique
       ON ${s}.product_wishlists (user_id, product_id, variant_value) NULLS NOT DISTINCT`,
    `CREATE INDEX IF NOT EXISTS product_wishlists_product_idx ON ${s}.product_wishlists (product_id)`,
    `CREATE INDEX IF NOT EXISTS product_wishlists_user_created_idx ON ${s}.product_wishlists (user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.commerce_customer_notifications (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       waitlist_id uuid REFERENCES ${s}.product_waitlist(id) ON DELETE SET NULL,
       title text NOT NULL, message text NOT NULL, href text, read_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS commerce_customer_notifications_user_created_idx
       ON ${s}.commerce_customer_notifications (user_id, created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS commerce_customer_notifications_waitlist_unique
       ON ${s}.commerce_customer_notifications (waitlist_id) WHERE waitlist_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.product_waitlist_notification_outbox (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       waitlist_id uuid NOT NULL UNIQUE REFERENCES ${s}.product_waitlist(id) ON DELETE CASCADE,
       audience ${s}.commerce_audience NOT NULL,
       salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       user_id uuid REFERENCES ${s}.users(id) ON DELETE CASCADE,
       product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
       processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_notification_outbox_pending_idx
       ON ${s}.product_waitlist_notification_outbox (created_at) WHERE processed_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.reorder_actions (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audience ${s}.commerce_audience NOT NULL,
       salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       user_id uuid REFERENCES ${s}.users(id) ON DELETE CASCADE,
       idempotency_key text NOT NULL, result jsonb NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reorder_actions_salon_key_unique
       ON ${s}.reorder_actions (salon_id, idempotency_key) WHERE salon_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reorder_actions_user_key_unique
       ON ${s}.reorder_actions (user_id, idempotency_key) WHERE user_id IS NOT NULL`,
    `CREATE OR REPLACE FUNCTION ${s}.validate_bundle_component()
       RETURNS trigger LANGUAGE plpgsql AS $$
       DECLARE component_supplier uuid; component_variants jsonb; bundle_supplier uuid;
       BEGIN
         SELECT supplier_id, variants INTO component_supplier, component_variants
           FROM ${s}.products WHERE id = NEW.product_id FOR KEY SHARE;
         SELECT supplier_id INTO bundle_supplier
           FROM ${s}.product_bundles WHERE id = NEW.bundle_id FOR KEY SHARE;
         IF component_supplier IS DISTINCT FROM bundle_supplier THEN
           RAISE EXCEPTION 'Bundle components must belong to the bundle supplier';
         END IF;
         IF component_variants IS NOT NULL AND jsonb_array_length(component_variants) > 0 THEN
           RAISE EXCEPTION 'Bundle components with variants are not supported';
         END IF;
         RETURN NEW;
       END $$`,
    `DROP TRIGGER IF EXISTS product_bundle_components_validate ON ${s}.product_bundle_components`,
    `CREATE TRIGGER product_bundle_components_validate BEFORE INSERT OR UPDATE
       ON ${s}.product_bundle_components FOR EACH ROW EXECUTE FUNCTION ${s}.validate_bundle_component()`,
    `CREATE OR REPLACE FUNCTION ${s}.enqueue_restocked_product_waitlist()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF OLD.stock = 0 AND NEW.stock > 0 THEN
           INSERT INTO ${s}.product_waitlist_notification_outbox
             (waitlist_id, audience, salon_id, user_id, product_id)
           SELECT id, audience, salon_id, user_id, product_id
             FROM ${s}.product_waitlist
             WHERE product_id = NEW.id AND status = 'ACTIVE'
           ON CONFLICT (waitlist_id) DO NOTHING;
           UPDATE ${s}.product_waitlist waiter SET status = 'NOTIFIED',
             notified_at = now(), updated_at = now()
             WHERE waiter.product_id = NEW.id AND waiter.status = 'ACTIVE'
               AND EXISTS (SELECT 1 FROM ${s}.product_waitlist_notification_outbox outbox
                 WHERE outbox.waitlist_id = waiter.id);
         END IF;
         RETURN NEW;
       END $$`,
    `DROP TRIGGER IF EXISTS products_enqueue_restocked_waitlist ON ${s}.products`,
    `CREATE TRIGGER products_enqueue_restocked_waitlist AFTER UPDATE OF stock ON ${s}.products
       FOR EACH ROW EXECUTE FUNCTION ${s}.enqueue_restocked_product_waitlist()`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
           OR NEW.line_total IS DISTINCT FROM OLD.line_total
           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price
           OR NEW.price_source IS DISTINCT FROM OLD.price_source
           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount
           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot
            OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
            OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
            OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
            OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
            OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
            OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
            OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
            OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
            OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
            OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
           RAISE EXCEPTION 'Order item commercial snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    // v71 replay tail: later legacy function definitions above must not rebind
    // the split trigger functions on a fresh bootstrap.
    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
       IF (to_jsonb(NEW) - ARRAY['id','order_id','created_at','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['id','order_id','created_at','updated_at']) THEN
         RAISE EXCEPTION 'Order item commercial snapshot is immutable';
       END IF; RETURN NEW; END $$`,
    `DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_immutable ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_commercial_snapshot_immutable BEFORE UPDATE ON ${s}.retail_order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()`,
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
    // v44 — runs after all cart/bundle tables exist, and is safe to replay.
    `ALTER TABLE ${s}.employees ADD COLUMN IF NOT EXISTS can_order_independently boolean NOT NULL DEFAULT false`,
    ...["seller_company_name text", "seller_tax_id text", "seller_registration_number text", "seller_address text", "seller_city text", "seller_postal_code text", "seller_bank_account text", "seller_contact_email text", "seller_contact_phone text"]
      .map((definition) => `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS ${definition}`),
    // v47 — durable B2C abandoned-cart reminder state and configuration.
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS retail_cart_reminder_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS retail_cart_reminder_delay_hours integer NOT NULL DEFAULT 24`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS retail_cart_reminder_brevo_template_id integer`,
    `ALTER TABLE ${s}.retail_carts ADD COLUMN IF NOT EXISTS contact_email text`,
    `ALTER TABLE ${s}.retail_carts ADD COLUMN IF NOT EXISTS activity_version integer NOT NULL DEFAULT 1`,
    `ALTER TABLE ${s}.retail_carts ADD COLUMN IF NOT EXISTS reminder_enqueued_activity_version integer`,
    `ALTER TABLE ${s}.retail_carts ADD COLUMN IF NOT EXISTS completed_activity_version integer`,
    `CREATE INDEX IF NOT EXISTS retail_carts_reminder_sweep_idx ON ${s}.retail_carts (updated_at, activity_version)
      WHERE reminder_enqueued_activity_version IS NULL OR reminder_enqueued_activity_version < activity_version`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_settings_retail_cart_reminder_delay_check'
          AND conrelid = '${s}.shop_settings'::regclass) THEN
         ALTER TABLE ${s}.shop_settings ADD CONSTRAINT shop_settings_retail_cart_reminder_delay_check
            CHECK (retail_cart_reminder_delay_hours BETWEEN 1 AND 720);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_settings_retail_cart_reminder_template_check'
          AND conrelid = '${s}.shop_settings'::regclass) THEN
         ALTER TABLE ${s}.shop_settings ADD CONSTRAINT shop_settings_retail_cart_reminder_template_check
            CHECK (retail_cart_reminder_brevo_template_id IS NULL OR retail_cart_reminder_brevo_template_id > 0);
       END IF;
     END $$`,
    ...["orders", "retail_orders"].flatMap((table) => [
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS coupon_code_snapshot text`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS coupon_discount_rsd integer NOT NULL DEFAULT 0`,
      `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS coupon_free_shipping boolean NOT NULL DEFAULT false`,
    ]),
    ...["order_items", "retail_order_items"].map((table) => `ALTER TABLE ${s}.${table} ADD COLUMN IF NOT EXISTS coupon_discount_rsd integer NOT NULL DEFAULT 0`),
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS invoice_number text`,
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS invoice_issued_at timestamptz`,
    `ALTER TABLE ${s}.orders ADD COLUMN IF NOT EXISTS seller_snapshot jsonb`,
    `CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_unique ON ${s}.orders (invoice_number) WHERE invoice_number IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.coupons (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true,
      audience ${s}.commerce_audience, discount_type ${s}.coupon_discount_type NOT NULL, discount_value integer NOT NULL,
      starts_at timestamptz, ends_at timestamptz, minimum_spend_rsd integer NOT NULL DEFAULT 0, maximum_spend_rsd integer,
      free_shipping boolean NOT NULL DEFAULT false, include_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb, exclude_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      include_category_ids jsonb NOT NULL DEFAULT '[]'::jsonb, exclude_category_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      include_bundle_ids jsonb NOT NULL DEFAULT '[]'::jsonb, exclude_bundle_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      usage_limit integer, per_customer_usage_limit integer, usage_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((discount_type = 'PERCENTAGE' AND discount_value BETWEEN 1 AND 100) OR (discount_type = 'FIXED_RSD' AND discount_value > 0)),
      CHECK (minimum_spend_rsd >= 0 AND (maximum_spend_rsd IS NULL OR maximum_spend_rsd >= minimum_spend_rsd)),
      CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
      CHECK ((usage_limit IS NULL OR usage_limit > 0) AND (per_customer_usage_limit IS NULL OR per_customer_usage_limit > 0))
    )`,
    `CREATE INDEX IF NOT EXISTS coupons_active_dates_idx ON ${s}.coupons (active, starts_at, ends_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.coupon_redemptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coupon_id uuid NOT NULL REFERENCES ${s}.coupons(id) ON DELETE RESTRICT,
      audience ${s}.commerce_audience NOT NULL, order_id uuid REFERENCES ${s}.orders(id) ON DELETE RESTRICT, retail_order_id uuid REFERENCES ${s}.retail_orders(id) ON DELETE RESTRICT,
      salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT, user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT, guest_email_normalized text,
      code_snapshot text NOT NULL, discount_rsd integer NOT NULL DEFAULT 0, free_shipping boolean NOT NULL DEFAULT false, cancelled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (num_nonnulls(order_id, retail_order_id) = 1), CHECK (num_nonnulls(salon_id, user_id, guest_email_normalized) = 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_order_unique ON ${s}.coupon_redemptions (order_id) WHERE order_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_retail_order_unique ON ${s}.coupon_redemptions (retail_order_id) WHERE retail_order_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_customer_idx ON ${s}.coupon_redemptions (coupon_id, user_id, salon_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.b2b_invoice_sequences (year integer PRIMARY KEY, last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0), updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS ${s}.order_approval_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE RESTRICT, employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE RESTRICT,
      submitted_by_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT, cart_id uuid NOT NULL REFERENCES ${s}.shopping_carts(id) ON DELETE RESTRICT, status ${s}.approval_request_status NOT NULL DEFAULT 'PENDING',
      idempotency_key text NOT NULL, quote_version text NOT NULL, quote_snapshot jsonb NOT NULL, coupon_code text, referral_credit_intent_rsd integer NOT NULL DEFAULT 0,
      reviewer_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT, reviewer_reason text, decided_at timestamptz,
      finalized_order_id uuid REFERENCES ${s}.orders(id) ON DELETE RESTRICT, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (salon_id, idempotency_key)
    )`,
    `CREATE INDEX IF NOT EXISTS order_approval_requests_salon_status_created_idx ON ${s}.order_approval_requests (salon_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS order_approval_requests_employee_created_idx ON ${s}.order_approval_requests (employee_id, created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS order_approval_requests_finalized_order_unique ON ${s}.order_approval_requests (finalized_order_id) WHERE finalized_order_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.order_approval_request_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES ${s}.order_approval_requests(id) ON DELETE CASCADE,
      product_id uuid REFERENCES ${s}.products(id) ON DELETE RESTRICT, bundle_id uuid REFERENCES ${s}.product_bundles(id) ON DELETE RESTRICT,
      product_name text NOT NULL, product_sku_snapshot text, quantity integer NOT NULL, catalog_snapshot jsonb NOT NULL,
      CHECK (num_nonnulls(product_id, bundle_id) = 1), CHECK (quantity > 0)
    )`,
    `CREATE INDEX IF NOT EXISTS order_approval_request_lines_request_idx ON ${s}.order_approval_request_lines (request_id)`,
    // v45 — every foreign key needs a matching leading index. These statements
    // also reconcile legacy databases that predate the current schema audit.
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS neutralized_at timestamptz`,
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS neutralized_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.referral_milestone_benefits ADD COLUMN IF NOT EXISTS neutralization_reason text`,
    `CREATE INDEX IF NOT EXISTS business_verification_audits_actor_user_idx ON ${s}.business_verification_audits (actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS coupon_redemptions_salon_idx ON ${s}.coupon_redemptions (salon_id)`,
    `CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON ${s}.coupon_redemptions (user_id)`,
    `CREATE INDEX IF NOT EXISTS legal_entity_businesses_owner_user_idx ON ${s}.legal_entity_businesses (owner_user_id)`,
    `CREATE INDEX IF NOT EXISTS loyalty_point_ledger_order_idx ON ${s}.loyalty_point_ledger (order_id)`,
    `CREATE INDEX IF NOT EXISTS loyalty_point_ledger_retail_order_idx ON ${s}.loyalty_point_ledger (retail_order_id)`,
    `CREATE INDEX IF NOT EXISTS order_approval_request_lines_bundle_idx ON ${s}.order_approval_request_lines (bundle_id)`,
    `CREATE INDEX IF NOT EXISTS order_approval_request_lines_product_idx ON ${s}.order_approval_request_lines (product_id)`,
    `CREATE INDEX IF NOT EXISTS order_approval_requests_cart_idx ON ${s}.order_approval_requests (cart_id)`,
    `CREATE INDEX IF NOT EXISTS order_approval_requests_reviewer_user_idx ON ${s}.order_approval_requests (reviewer_user_id)`,
    `CREATE INDEX IF NOT EXISTS order_approval_requests_submitted_by_user_idx ON ${s}.order_approval_requests (submitted_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS package_redemptions_service_idx ON ${s}.package_redemptions (service_id)`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_salon_idx ON ${s}.product_waitlist (salon_id)`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_user_idx ON ${s}.product_waitlist (user_id)`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_notification_outbox_product_idx ON ${s}.product_waitlist_notification_outbox (product_id)`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_notification_outbox_salon_idx ON ${s}.product_waitlist_notification_outbox (salon_id)`,
    `CREATE INDEX IF NOT EXISTS product_waitlist_notification_outbox_user_idx ON ${s}.product_waitlist_notification_outbox (user_id)`,
    `CREATE INDEX IF NOT EXISTS referral_attributions_referral_code_idx ON ${s}.referral_attributions (referral_code_id)`,
    `CREATE INDEX IF NOT EXISTS referral_credit_ledger_actor_user_idx ON ${s}.referral_credit_ledger (actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS referral_credit_ledger_center_effective_idx ON ${s}.referral_credit_ledger (education_center_id, effective_at)`,
    `CREATE INDEX IF NOT EXISTS referral_credit_ledger_referral_attribution_idx ON ${s}.referral_credit_ledger (referral_attribution_id)`,
    `CREATE INDEX IF NOT EXISTS referral_credit_ledger_salon_effective_idx ON ${s}.referral_credit_ledger (salon_id, effective_at)`,
    `CREATE INDEX IF NOT EXISTS referral_credit_redemptions_ledger_entry_idx ON ${s}.referral_credit_redemptions (ledger_entry_id)`,
    `CREATE INDEX IF NOT EXISTS referral_milestone_benefits_neutralized_by_user_idx ON ${s}.referral_milestone_benefits (neutralized_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS referral_milestone_benefits_referrer_user_idx ON ${s}.referral_milestone_benefits (referrer_user_id)`,
    `CREATE INDEX IF NOT EXISTS referral_qualification_evidence_appointment_idx ON ${s}.referral_qualification_evidence (appointment_id)`,
    `CREATE INDEX IF NOT EXISTS referral_qualification_evidence_enrollment_idx ON ${s}.referral_qualification_evidence (enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS referral_qualifications_referred_education_center_idx ON ${s}.referral_qualifications (referred_education_center_id)`,
    `CREATE INDEX IF NOT EXISTS referral_qualifications_referred_salon_idx ON ${s}.referral_qualifications (referred_salon_id)`,
    `CREATE INDEX IF NOT EXISTS referral_reviews_attribution_idx ON ${s}.referral_reviews (attribution_id)`,
    `CREATE INDEX IF NOT EXISTS referral_reviews_qualification_idx ON ${s}.referral_reviews (qualification_id)`,
    `CREATE INDEX IF NOT EXISTS referral_reviews_reviewed_by_user_idx ON ${s}.referral_reviews (reviewed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS retail_cart_items_bundle_idx ON ${s}.retail_cart_items (bundle_id)`,
    `CREATE INDEX IF NOT EXISTS saved_retail_cart_items_bundle_idx ON ${s}.saved_retail_cart_items (bundle_id)`,
    `CREATE INDEX IF NOT EXISTS saved_retail_cart_items_product_idx ON ${s}.saved_retail_cart_items (product_id)`,
    `CREATE INDEX IF NOT EXISTS saved_shop_cart_items_bundle_idx ON ${s}.saved_shop_cart_items (bundle_id)`,
    `CREATE INDEX IF NOT EXISTS saved_shop_cart_items_product_idx ON ${s}.saved_shop_cart_items (product_id)`,
    `CREATE INDEX IF NOT EXISTS shopping_cart_items_bundle_idx ON ${s}.shopping_cart_items (bundle_id)`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_coupon_order_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd THEN
          RAISE EXCEPTION 'Order coupon allocation is immutable';
        END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS order_items_coupon_snapshot_immutable ON ${s}.order_items`,
    `CREATE TRIGGER order_items_coupon_snapshot_immutable BEFORE UPDATE ON ${s}.order_items
      FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_coupon_order_snapshot_update()`,
    `DROP TRIGGER IF EXISTS retail_order_items_coupon_snapshot_immutable ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_coupon_snapshot_immutable BEFORE UPDATE ON ${s}.retail_order_items
      FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_coupon_order_snapshot_update()`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_b2b_invoice_snapshot_update()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.invoice_issued_at IS NOT NULL AND (
          NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.invoice_issued_at IS DISTINCT FROM OLD.invoice_issued_at
          OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.coupon_code_snapshot IS DISTINCT FROM OLD.coupon_code_snapshot
          OR NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd OR NEW.coupon_free_shipping IS DISTINCT FROM OLD.coupon_free_shipping
        ) THEN RAISE EXCEPTION 'Finalized B2B invoice snapshot is immutable'; END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS orders_invoice_snapshot_immutable ON ${s}.orders`,
    `CREATE TRIGGER orders_invoice_snapshot_immutable BEFORE UPDATE ON ${s}.orders
      FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_b2b_invoice_snapshot_update()`,
    // v46 — customer B2C physical-product replenishment. Intentionally
    // separate from salon plans and their billing lifecycle.
    `CREATE TABLE IF NOT EXISTS ${s}.retail_product_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT,
      quantity integer NOT NULL, frequency ${s}.retail_subscription_frequency NOT NULL,
      status ${s}.retail_subscription_status NOT NULL DEFAULT 'ACTIVE',
      discount_percent_snapshot integer NOT NULL,
      payment_method ${s}.payment_method NOT NULL,
      delivery_method ${s}.delivery_method NOT NULL,
      contact_snapshot jsonb NOT NULL, delivery_snapshot jsonb NOT NULL,
      anchor_day integer NOT NULL,
      next_due_at timestamptz NOT NULL, blocked_until timestamptz,
      paused_at timestamptz, cancelled_at timestamptz, last_attempt_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT retail_product_subscriptions_quantity_check CHECK (quantity > 0),
      CONSTRAINT retail_product_subscriptions_anchor_day_check CHECK (anchor_day BETWEEN 1 AND 31),
      CONSTRAINT retail_product_subscriptions_discount_percent_check CHECK (discount_percent_snapshot BETWEEN 0 AND 100)
    )`,
    // Existing subscriptions predate anchor_day. Their current due date is the
    // only truthful anchor available, so backfill it once before making it
    // mandatory. Every statement remains safe on concurrent/replayed boots.
    `ALTER TABLE ${s}.retail_product_subscriptions ADD COLUMN IF NOT EXISTS anchor_day integer`,
    `UPDATE ${s}.retail_product_subscriptions SET anchor_day = EXTRACT(DAY FROM next_due_at)::integer WHERE anchor_day IS NULL`,
    `ALTER TABLE ${s}.retail_product_subscriptions ALTER COLUMN anchor_day SET NOT NULL`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.retail_product_subscriptions'::regclass AND conname='retail_product_subscriptions_anchor_day_check') THEN
      ALTER TABLE ${s}.retail_product_subscriptions ADD CONSTRAINT retail_product_subscriptions_anchor_day_check CHECK (anchor_day BETWEEN 1 AND 31);
    END IF; END $$`,
    `CREATE INDEX IF NOT EXISTS retail_product_subscriptions_user_created_idx
      ON ${s}.retail_product_subscriptions (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS retail_product_subscriptions_product_idx
      ON ${s}.retail_product_subscriptions (product_id)`,
    `CREATE INDEX IF NOT EXISTS retail_product_subscriptions_due_claim_idx
      ON ${s}.retail_product_subscriptions (status, next_due_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_product_subscription_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id uuid NOT NULL REFERENCES ${s}.retail_product_subscriptions(id) ON DELETE CASCADE,
      due_at timestamptz NOT NULL,
      status ${s}.retail_subscription_attempt_status NOT NULL DEFAULT 'PROCESSING',
      retry_count integer NOT NULL DEFAULT 0, claimed_at timestamptz NOT NULL DEFAULT now(),
      claim_token uuid NOT NULL, order_id uuid REFERENCES ${s}.retail_orders(id) ON DELETE RESTRICT,
      failure_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT retail_subscription_attempts_subscription_due_unique UNIQUE (subscription_id, due_at),
      CONSTRAINT retail_subscription_attempts_retry_count_check CHECK (retry_count >= 0)
    )`,
    `CREATE INDEX IF NOT EXISTS retail_subscription_attempts_order_idx
      ON ${s}.retail_product_subscription_attempts (order_id)`,
    `CREATE INDEX IF NOT EXISTS retail_subscription_attempts_status_claimed_idx
      ON ${s}.retail_product_subscription_attempts (status, claimed_at)`,
    `ALTER TABLE ${s}.retail_product_reviews ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'APPROVED'`,
    `CREATE INDEX IF NOT EXISTS retail_product_reviews_product_moderation_idx
      ON ${s}.retail_product_reviews (product_id, moderation_status)`,
    // v51 — verified B2C product reviews. This extends the former minimal
    // review table without touching the separately-owned B2B salon review
    // domain. Existing approved rows are published deterministically.
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS average_rating integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.retail_product_reviews DROP CONSTRAINT IF EXISTS retail_product_reviews_moderation_check`,
    `ALTER TABLE ${s}.retail_product_reviews ADD COLUMN IF NOT EXISTS moderation_reason text`,
    `ALTER TABLE ${s}.retail_product_reviews ADD COLUMN IF NOT EXISTS removed_at timestamptz`,
    `ALTER TABLE ${s}.retail_product_reviews ALTER COLUMN moderation_status DROP DEFAULT`,
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'retail_product_reviews'
           AND column_name = 'moderation_status' AND udt_name <> 'retail_review_moderation_status'
       ) THEN
         UPDATE ${s}.retail_product_reviews SET moderation_status = 'PUBLISHED'
           WHERE moderation_status IN ('APPROVED', 'PENDING');
         UPDATE ${s}.retail_product_reviews SET moderation_status = 'REMOVED'
           WHERE moderation_status = 'REJECTED';
         ALTER TABLE ${s}.retail_product_reviews ALTER COLUMN moderation_status
           TYPE ${s}.retail_review_moderation_status
           USING moderation_status::${s}.retail_review_moderation_status;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.retail_product_reviews ALTER COLUMN moderation_status
       SET DEFAULT 'PUBLISHED'::${s}.retail_review_moderation_status`,
    `WITH ranked AS (
       SELECT id, row_number() OVER (PARTITION BY product_id, user_id ORDER BY updated_at DESC, id DESC) AS position
       FROM ${s}.retail_product_reviews WHERE moderation_status <> 'REMOVED'
     )
     UPDATE ${s}.retail_product_reviews review SET moderation_status = 'REMOVED', removed_at = coalesce(removed_at, now())
     FROM ranked WHERE review.id = ranked.id AND ranked.position > 1`,
    `CREATE UNIQUE INDEX IF NOT EXISTS retail_product_reviews_product_user_active_unique
       ON ${s}.retail_product_reviews (product_id, user_id) WHERE moderation_status <> 'REMOVED'`,
    `CREATE INDEX IF NOT EXISTS retail_product_reviews_product_status_created_idx
       ON ${s}.retail_product_reviews (product_id, moderation_status, created_at)`,
    `CREATE INDEX IF NOT EXISTS retail_product_reviews_order_item_idx ON ${s}.retail_product_reviews (order_item_id)`,
    // v52 — B2C browsing history is intentionally independent of carts.  The
    // partial unique indexes make concurrent repeated detail views idempotent.
    `CREATE TABLE IF NOT EXISTS ${s}.b2c_recently_viewed_products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      viewer_token_hash text, user_id uuid REFERENCES ${s}.users(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      last_viewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2c_recent_views_one_owner_check
        CHECK (num_nonnulls(viewer_token_hash, user_id) = 1)
    )`,
    `CREATE INDEX IF NOT EXISTS b2c_recent_views_product_idx
      ON ${s}.b2c_recently_viewed_products (product_id)`,
    `CREATE INDEX IF NOT EXISTS b2c_recent_views_user_viewed_idx
      ON ${s}.b2c_recently_viewed_products (user_id, last_viewed_at)`,
    `CREATE INDEX IF NOT EXISTS b2c_recent_views_viewer_viewed_idx
      ON ${s}.b2c_recently_viewed_products (viewer_token_hash, last_viewed_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS b2c_recent_views_user_product_unique
      ON ${s}.b2c_recently_viewed_products (user_id, product_id) WHERE user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS b2c_recent_views_viewer_product_unique
      ON ${s}.b2c_recently_viewed_products (viewer_token_hash, product_id) WHERE viewer_token_hash IS NOT NULL`,
    // Reconcile the maintained public aggregate for rows that predate v51.
    `UPDATE ${s}.products product SET
       average_rating = COALESCE(aggregate.average_rating, 0),
       review_count = COALESCE(aggregate.review_count, 0)
     FROM (
       SELECT product_id, round(avg(rating)::numeric)::integer AS average_rating, count(*)::integer AS review_count
       FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED'
       GROUP BY product_id
     ) aggregate WHERE product.id = aggregate.product_id`,
    `UPDATE ${s}.products SET average_rating = 0, review_count = 0
     WHERE id NOT IN (SELECT DISTINCT product_id FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED')`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_product_review_reports (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       review_id uuid NOT NULL REFERENCES ${s}.retail_product_reviews(id) ON DELETE CASCADE,
       reporter_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       reason ${s}.retail_review_report_reason NOT NULL, explanation text,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT retail_review_reports_review_reporter_unique UNIQUE (review_id, reporter_user_id)
     )`,
    `CREATE INDEX IF NOT EXISTS retail_review_reports_review_created_idx
       ON ${s}.retail_product_review_reports (review_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS retail_review_reports_reporter_idx
       ON ${s}.retail_product_review_reports (reporter_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_product_review_moderation_audits (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       review_id uuid NOT NULL REFERENCES ${s}.retail_product_reviews(id) ON DELETE CASCADE,
       moderator_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       action ${s}.retail_review_moderation_action NOT NULL,
       previous_status ${s}.retail_review_moderation_status,
       next_status ${s}.retail_review_moderation_status NOT NULL,
       reason text, internal_note text, created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS retail_review_moderation_audits_review_created_idx
       ON ${s}.retail_product_review_moderation_audits (review_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS retail_review_moderation_audits_moderator_created_idx
       ON ${s}.retail_product_review_moderation_audits (moderator_user_id, created_at)`,
    // v50 — supplier-first B2C catalog discovery. Dictionary identifiers are
    // stable API values; referenced rows use RESTRICT and are deactivated.
    `CREATE TABLE IF NOT EXISTS ${s}.b2c_product_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
      label text NOT NULL, active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2c_product_types_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      CONSTRAINT b2c_product_types_version_check CHECK (version >= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS b2c_product_types_active_sort_idx
      ON ${s}.b2c_product_types (active, sort_order, id)`,
    `CREATE INDEX IF NOT EXISTS b2c_product_types_created_by_idx ON ${s}.b2c_product_types (created_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS b2c_product_types_updated_by_idx ON ${s}.b2c_product_types (updated_by_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.b2c_need_tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
      label text NOT NULL, active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2c_need_tags_key_check CHECK (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      CONSTRAINT b2c_need_tags_version_check CHECK (version >= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS b2c_need_tags_active_sort_idx
      ON ${s}.b2c_need_tags (active, sort_order, id)`,
    `CREATE INDEX IF NOT EXISTS b2c_need_tags_created_by_idx ON ${s}.b2c_need_tags (created_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS b2c_need_tags_updated_by_idx ON ${s}.b2c_need_tags (updated_by_user_id)`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS product_type_id uuid`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS ingredients text`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS usage_instructions text`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.products'::regclass
        AND conname='products_product_type_id_b2c_product_types_id_fk') THEN
        ALTER TABLE ${s}.products ADD CONSTRAINT products_product_type_id_b2c_product_types_id_fk
          FOREIGN KEY (product_type_id) REFERENCES ${s}.b2c_product_types(id) ON DELETE RESTRICT NOT VALID;
      END IF;
    END $$`,
    `ALTER TABLE ${s}.products VALIDATE CONSTRAINT products_product_type_id_b2c_product_types_id_fk`,
    `CREATE INDEX IF NOT EXISTS products_product_type_idx ON ${s}.products (product_type_id)`,
    `CREATE INDEX IF NOT EXISTS products_supplier_type_retail_active_idx
      ON ${s}.products (supplier_id, product_type_id, retail_enabled, active)`,
    `CREATE INDEX IF NOT EXISTS products_supplier_retail_price_idx
      ON ${s}.products (supplier_id, retail_enabled, active, public_price, id)`,
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='brand') THEN
        CREATE INDEX IF NOT EXISTS products_supplier_retail_brand_idx
          ON ${s}.products (supplier_id, retail_enabled, active, brand, id);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='brand')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='category_name')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='subcategory_name') THEN
        CREATE INDEX IF NOT EXISTS products_b2c_search_idx ON ${s}.products
          USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' ||
            coalesce(category_name,'') || ' ' || coalesce(subcategory_name,'')));
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.b2c_product_need_tags (
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      need_tag_id uuid NOT NULL REFERENCES ${s}.b2c_need_tags(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2c_product_need_tags_product_tag_unique UNIQUE (product_id, need_tag_id)
    )`,
    `CREATE INDEX IF NOT EXISTS b2c_product_need_tags_tag_product_idx
      ON ${s}.b2c_product_need_tags (need_tag_id, product_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.b2c_promotional_banners (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), internal_name text NOT NULL,
      supplier_id uuid NOT NULL REFERENCES ${s}.suppliers(id) ON DELETE RESTRICT,
      desktop_image_url text NOT NULL, mobile_image_url text, headline text NOT NULL,
      text text, cta_label text, destination_kind ${s}.b2c_banner_destination_kind NOT NULL,
      destination_category_id uuid REFERENCES ${s}.product_categories(id) ON DELETE RESTRICT,
      destination_product_id uuid REFERENCES ${s}.products(id) ON DELETE RESTRICT,
      filtered_listing jsonb, custom_internal_path text,
      placement ${s}.b2c_banner_placement NOT NULL, active boolean NOT NULL DEFAULT true,
      starts_at timestamptz, ends_at timestamptz, sort_order integer NOT NULL DEFAULT 0,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2c_banners_version_check CHECK (version >= 1),
      CONSTRAINT b2c_banners_window_check CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
      CONSTRAINT b2c_banners_internal_path_check CHECK (custom_internal_path IS NULL OR (custom_internal_path LIKE '/%' AND custom_internal_path NOT LIKE '//%')),
      CONSTRAINT b2c_banners_destination_check CHECK (
        (destination_kind='CATEGORY' AND num_nonnulls(destination_category_id,destination_product_id,filtered_listing,custom_internal_path)=1 AND destination_category_id IS NOT NULL)
        OR (destination_kind='PRODUCT' AND num_nonnulls(destination_category_id,destination_product_id,filtered_listing,custom_internal_path)=1 AND destination_product_id IS NOT NULL)
        OR (destination_kind='FILTERED_LISTING' AND num_nonnulls(destination_category_id,destination_product_id,filtered_listing,custom_internal_path)=1 AND filtered_listing IS NOT NULL)
        OR (destination_kind='CUSTOM_INTERNAL_PATH' AND num_nonnulls(destination_category_id,destination_product_id,filtered_listing,custom_internal_path)=1 AND custom_internal_path IS NOT NULL)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS b2c_banners_supplier_window_sort_idx
      ON ${s}.b2c_promotional_banners (supplier_id, active, placement, starts_at, ends_at, sort_order, id)`,
    `CREATE INDEX IF NOT EXISTS b2c_banners_category_idx ON ${s}.b2c_promotional_banners (destination_category_id)`,
    `CREATE INDEX IF NOT EXISTS b2c_banners_product_idx ON ${s}.b2c_promotional_banners (destination_product_id)`,
    `CREATE INDEX IF NOT EXISTS b2c_banners_created_by_idx ON ${s}.b2c_promotional_banners (created_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS b2c_banners_updated_by_idx ON ${s}.b2c_promotional_banners (updated_by_user_id)`,
    `CREATE OR REPLACE FUNCTION ${s}.validate_b2c_banner_destination()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.destination_category_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ${s}.product_categories c WHERE c.id=NEW.destination_category_id
            AND c.supplier_id=NEW.supplier_id FOR KEY SHARE
        ) THEN RAISE EXCEPTION 'Banner category destination must belong to supplier'; END IF;
        IF NEW.destination_product_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ${s}.products p WHERE p.id=NEW.destination_product_id
            AND p.supplier_id=NEW.supplier_id AND p.retail_enabled=true FOR KEY SHARE
        ) THEN RAISE EXCEPTION 'Banner product destination must belong to supplier'; END IF;
        RETURN NEW;
      END $$`,
    `DROP TRIGGER IF EXISTS b2c_banners_validate_destination ON ${s}.b2c_promotional_banners`,
    `CREATE TRIGGER b2c_banners_validate_destination BEFORE INSERT OR UPDATE OF
      supplier_id,destination_category_id,destination_product_id ON ${s}.b2c_promotional_banners
      FOR EACH ROW EXECUTE FUNCTION ${s}.validate_b2c_banner_destination()`,
    `CREATE TABLE IF NOT EXISTS ${s}.b2c_display_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      default_sort ${s}.b2c_product_sort NOT NULL DEFAULT 'RECOMMENDED',
      enabled_sort_options jsonb NOT NULL DEFAULT '["RECOMMENDED","PRICE_ASC","PRICE_DESC","NEWEST","BEST_RATED","MOST_POPULAR"]'::jsonb,
      page_size integer NOT NULL DEFAULT 24, show_out_of_stock boolean NOT NULL DEFAULT true,
      recently_viewed_enabled boolean NOT NULL DEFAULT true, recently_viewed_max integer NOT NULL DEFAULT 12,
      version integer NOT NULL DEFAULT 1,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2c_display_settings_values_check CHECK (
        page_size BETWEEN 1 AND 100 AND recently_viewed_max BETWEEN 1 AND 100
        AND version >= 1 AND jsonb_typeof(enabled_sort_options)='array')
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS b2c_display_settings_singleton_unique ON ${s}.b2c_display_settings ((true))`,
    `CREATE INDEX IF NOT EXISTS b2c_display_settings_updated_by_idx ON ${s}.b2c_display_settings (updated_by_user_id)`,
    `INSERT INTO ${s}.b2c_display_settings DEFAULT VALUES ON CONFLICT DO NOTHING`,

    // v53 — Deo E/F commerce workflows. All evidence and one-time issuance
    // fences are additive, preserving existing catalog, cart and stock models.
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS price_on_request boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS bulk_matrix_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS quote_validity_days integer NOT NULL DEFAULT 7`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS review_rewards_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS review_invitation_delay_days integer NOT NULL DEFAULT 7`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS review_reward_percent integer NOT NULL DEFAULT 5`,
    `ALTER TABLE ${s}.shop_settings ADD COLUMN IF NOT EXISTS review_reward_validity_days integer NOT NULL DEFAULT 30`,
    `CREATE TABLE IF NOT EXISTS ${s}.b2b_quotes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
      source_cart_id uuid REFERENCES ${s}.shopping_carts(id) ON DELETE SET NULL,
      customer_company_name text, seller_snapshot jsonb NOT NULL, item_snapshots jsonb NOT NULL,
      subtotal_without_vat integer NOT NULL, vat_amount integer NOT NULL, total_with_vat integer NOT NULL,
      currency text NOT NULL DEFAULT 'RSD', valid_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT b2b_quotes_totals_check CHECK (subtotal_without_vat >= 0 AND vat_amount >= 0 AND total_with_vat = subtotal_without_vat + vat_amount)
    )`,
    `CREATE INDEX IF NOT EXISTS b2b_quotes_salon_created_idx ON ${s}.b2b_quotes (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS b2b_quotes_source_cart_idx ON ${s}.b2b_quotes (source_cart_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.price_inquiries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL REFERENCES ${s}.suppliers(id) ON DELETE RESTRICT,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT,
      name text NOT NULL, email text NOT NULL, phone text NOT NULL, message text NOT NULL,
      status ${s}.price_inquiry_status NOT NULL DEFAULT 'NEW', internal_note text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS price_inquiries_status_created_idx ON ${s}.price_inquiries (status, created_at)`,
    `CREATE INDEX IF NOT EXISTS price_inquiries_product_created_idx ON ${s}.price_inquiries (product_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS price_inquiries_supplier_idx ON ${s}.price_inquiries (supplier_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.rmas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rma_number text NOT NULL UNIQUE,
      order_id uuid NOT NULL REFERENCES ${s}.orders(id) ON DELETE RESTRICT,
      order_item_id uuid NOT NULL REFERENCES ${s}.order_items(id) ON DELETE RESTRICT,
      requester_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
      quantity integer NOT NULL CHECK (quantity > 0), reason text NOT NULL, description text NOT NULL,
      status ${s}.rma_status NOT NULL DEFAULT 'RECEIVED',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS rmas_order_created_idx ON ${s}.rmas (order_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS rmas_order_item_idx ON ${s}.rmas (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS rmas_requester_user_idx ON ${s}.rmas (requester_user_id)`,
    `CREATE INDEX IF NOT EXISTS rmas_status_created_idx ON ${s}.rmas (status, created_at)`,
    // Existing v53 installations may already have B2B-only non-null columns.
    // Extend in place to a checked discriminated target; no data is rewritten.
    `ALTER TABLE ${s}.rmas ADD COLUMN IF NOT EXISTS retail_order_id uuid REFERENCES ${s}.retail_orders(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.rmas ADD COLUMN IF NOT EXISTS retail_order_item_id uuid REFERENCES ${s}.retail_order_items(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.rmas ALTER COLUMN order_id DROP NOT NULL`,
    `ALTER TABLE ${s}.rmas ALTER COLUMN order_item_id DROP NOT NULL`,
    `CREATE INDEX IF NOT EXISTS rmas_retail_order_created_idx ON ${s}.rmas (retail_order_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS rmas_retail_order_item_idx ON ${s}.rmas (retail_order_item_id)`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rmas_target_check' AND conrelid = '${s}.rmas'::regclass) THEN
      ALTER TABLE ${s}.rmas ADD CONSTRAINT rmas_target_check CHECK (num_nonnulls(order_id, retail_order_id) = 1 AND num_nonnulls(order_item_id, retail_order_item_id) = 1) NOT VALID;
      ALTER TABLE ${s}.rmas VALIDATE CONSTRAINT rmas_target_check;
    END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.rma_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rma_id uuid NOT NULL REFERENCES ${s}.rmas(id) ON DELETE CASCADE,
      media_asset_id uuid NOT NULL UNIQUE REFERENCES ${s}.media_assets(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS rma_attachments_rma_idx ON ${s}.rma_attachments (rma_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.rma_status_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rma_id uuid NOT NULL REFERENCES ${s}.rmas(id) ON DELETE CASCADE,
      actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      previous_status ${s}.rma_status, next_status ${s}.rma_status NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS rma_status_history_rma_created_idx ON ${s}.rma_status_history (rma_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS rma_status_history_actor_user_idx ON ${s}.rma_status_history (actor_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.review_reward_issuances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES ${s}.retail_orders(id) ON DELETE RESTRICT,
      review_id uuid NOT NULL UNIQUE, coupon_id uuid NOT NULL, percent_snapshot integer NOT NULL CHECK (percent_snapshot BETWEEN 1 AND 100),
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.catalog_sync_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL DEFAULT 'META',
      status ${s}.catalog_sync_status NOT NULL DEFAULT 'NOT_CONNECTED', item_count integer NOT NULL DEFAULT 0,
      validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
      requested_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS catalog_sync_runs_provider_created_idx ON ${s}.catalog_sync_runs (provider, created_at)`,
    `CREATE INDEX IF NOT EXISTS catalog_sync_runs_requested_by_idx ON ${s}.catalog_sync_runs (requested_by_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.retail_product_review_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id uuid NOT NULL REFERENCES ${s}.retail_product_reviews(id) ON DELETE CASCADE,
      media_asset_id uuid NOT NULL UNIQUE REFERENCES ${s}.media_assets(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS retail_product_review_attachments_review_idx ON ${s}.retail_product_review_attachments (review_id)`,
    // v60 — Deo G2 normalized, versioned rule definitions.  Rule rows are
    // deliberately separate from catalog products: expiring a campaign never
    // rewrites a product price, and immutable orders retain their snapshots.
    `CREATE TABLE IF NOT EXISTS ${s}.product_upsell_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      alternative_product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT, sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), CHECK (product_id <> alternative_product_id), CHECK (sort_order BETWEEN 1 AND 3),
      UNIQUE (product_id, alternative_product_id), UNIQUE (product_id, sort_order)
    )`,
    `CREATE INDEX IF NOT EXISTS product_upsell_links_alternative_idx ON ${s}.product_upsell_links (alternative_product_id)`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS loyalty_pricing_excluded boolean NOT NULL DEFAULT false`,
    `CREATE TABLE IF NOT EXISTS ${s}.loyalty_pricing_tiers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, market text NOT NULL, spend_threshold_rsd integer NOT NULL,
      discount_percent integer NOT NULL, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (market, name), CHECK (market IN ('B2B','B2C','BOTH')), CHECK (spend_threshold_rsd >= 0),
      CHECK (discount_percent BETWEEN 1 AND 100), CHECK (version >= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS loyalty_pricing_tiers_market_active_threshold_idx ON ${s}.loyalty_pricing_tiers (market, active, spend_threshold_rsd)`,
    `CREATE TABLE IF NOT EXISTS ${s}.loyalty_pricing_tier_product_exclusions (
      tier_id uuid NOT NULL REFERENCES ${s}.loyalty_pricing_tiers(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT, UNIQUE (tier_id, product_id)
    )`,
    `CREATE INDEX IF NOT EXISTS loyalty_pricing_tier_product_exclusions_product_idx ON ${s}.loyalty_pricing_tier_product_exclusions (product_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.bulk_sale_campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, market text NOT NULL, discount_type text NOT NULL,
      discount_value integer NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz, status text NOT NULL DEFAULT 'DRAFT',
      version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (market IN ('B2B','B2C','BOTH')), CHECK (discount_type IN ('PERCENT','FIXED_RSD')), CHECK (discount_value > 0),
      CHECK (status IN ('DRAFT','ACTIVE')), CHECK (ends_at IS NULL OR ends_at > starts_at), CHECK (version >= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS bulk_sale_campaigns_market_status_schedule_idx ON ${s}.bulk_sale_campaigns (market, status, starts_at, ends_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.bulk_sale_campaign_targets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES ${s}.bulk_sale_campaigns(id) ON DELETE CASCADE,
      product_id uuid REFERENCES ${s}.products(id) ON DELETE CASCADE, category_id uuid REFERENCES ${s}.product_categories(id) ON DELETE CASCADE,
      CHECK (num_nonnulls(product_id, category_id) = 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS bulk_sale_campaign_targets_product_unique ON ${s}.bulk_sale_campaign_targets (campaign_id, product_id) WHERE product_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS bulk_sale_campaign_targets_category_unique ON ${s}.bulk_sale_campaign_targets (campaign_id, category_id) WHERE category_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS bulk_sale_campaign_targets_product_idx ON ${s}.bulk_sale_campaign_targets (product_id)`,
    `CREATE INDEX IF NOT EXISTS bulk_sale_campaign_targets_category_idx ON ${s}.bulk_sale_campaign_targets (category_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.cart_threshold_rewards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, market text NOT NULL, spend_threshold_rsd integer NOT NULL,
      reward_kind text NOT NULL, discount_percent integer, gift_product_id uuid REFERENCES ${s}.products(id) ON DELETE RESTRICT,
      gift_quantity integer, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (market IN ('B2B','B2C','BOTH')), CHECK (spend_threshold_rsd >= 0), CHECK (reward_kind IN ('FREE_SHIPPING','GIFT_PRODUCT','PERCENT_DISCOUNT')),
      CHECK ((reward_kind = 'FREE_SHIPPING' AND discount_percent IS NULL AND gift_product_id IS NULL AND gift_quantity IS NULL) OR (reward_kind = 'PERCENT_DISCOUNT' AND discount_percent BETWEEN 1 AND 100 AND gift_product_id IS NULL AND gift_quantity IS NULL) OR (reward_kind = 'GIFT_PRODUCT' AND gift_product_id IS NOT NULL AND gift_quantity > 0 AND discount_percent IS NULL)), CHECK (version >= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS cart_threshold_rewards_market_active_threshold_idx ON ${s}.cart_threshold_rewards (market, active, spend_threshold_rsd)`,
    `CREATE INDEX IF NOT EXISTS cart_threshold_rewards_gift_product_idx ON ${s}.cart_threshold_rewards (gift_product_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.automatic_xy_promotions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, market text NOT NULL, buy_quantity integer NOT NULL,
      reward_quantity integer NOT NULL, reward_percent integer NOT NULL, per_order_reward_unit_cap integer, starts_at timestamptz, ends_at timestamptz,
      status text NOT NULL DEFAULT 'DRAFT', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (market IN ('B2B','B2C','BOTH')), CHECK (buy_quantity > 0 AND reward_quantity > 0 AND reward_percent BETWEEN 1 AND 100 AND (per_order_reward_unit_cap IS NULL OR per_order_reward_unit_cap > 0)), CHECK (status IN ('DRAFT','ACTIVE')), CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at), CHECK (version >= 1)
    )`,
    `CREATE INDEX IF NOT EXISTS automatic_xy_promotions_market_status_schedule_idx ON ${s}.automatic_xy_promotions (market, status, starts_at, ends_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.automatic_xy_promotion_targets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotion_id uuid NOT NULL REFERENCES ${s}.automatic_xy_promotions(id) ON DELETE CASCADE,
      target_role text NOT NULL, product_id uuid REFERENCES ${s}.products(id) ON DELETE CASCADE, category_id uuid REFERENCES ${s}.product_categories(id) ON DELETE CASCADE,
      CHECK (target_role IN ('BUY','REWARD')), CHECK (num_nonnulls(product_id, category_id) = 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS automatic_xy_targets_role_product_unique ON ${s}.automatic_xy_promotion_targets (promotion_id, target_role, product_id) WHERE product_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS automatic_xy_targets_role_category_unique ON ${s}.automatic_xy_promotion_targets (promotion_id, target_role, category_id) WHERE category_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS automatic_xy_targets_product_idx ON ${s}.automatic_xy_promotion_targets (product_id)`,
    `CREATE INDEX IF NOT EXISTS automatic_xy_targets_category_idx ON ${s}.automatic_xy_promotion_targets (category_id)`,
    // v68 — platform-only B2C post-treatment care. No table references salon notifications.
    `CREATE TABLE IF NOT EXISTS ${s}.treatment_taxonomy (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), taxonomy_key text NOT NULL UNIQUE,
      category_name text NOT NULL, treatment_name text NOT NULL, search_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT treatment_taxonomy_key_check CHECK (taxonomy_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    )`,
    `CREATE INDEX IF NOT EXISTS treatment_taxonomy_active_name_idx ON ${s}.treatment_taxonomy (active, category_name, treatment_name)`,
    `ALTER TABLE ${s}.products ADD COLUMN IF NOT EXISTS average_duration_days integer`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_average_duration_days_check' AND conrelid = '${s}.products'::regclass) THEN ALTER TABLE ${s}.products ADD CONSTRAINT products_average_duration_days_check CHECK (average_duration_days IS NULL OR average_duration_days > 0); END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.product_treatment_mappings (
      product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE CASCADE,
      treatment_id uuid NOT NULL REFERENCES ${s}.treatment_taxonomy(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_treatment_mappings_unique ON ${s}.product_treatment_mappings (product_id, treatment_id)`,
    `CREATE INDEX IF NOT EXISTS product_treatment_mappings_treatment_idx ON ${s}.product_treatment_mappings (treatment_id, product_id)`,
    `ALTER TABLE ${s}.product_bundles ADD COLUMN IF NOT EXISTS linked_treatment_id uuid REFERENCES ${s}.treatment_taxonomy(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS product_bundles_treatment_market_active_idx ON ${s}.product_bundles (linked_treatment_id, market, active)`,
    `CREATE TABLE IF NOT EXISTS ${s}.aftercare_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL, is_current boolean NOT NULL DEFAULT true,
      first_timing ${s}.aftercare_first_timing NOT NULL DEFAULT 'IMMEDIATE_AFTER_COMPLETION',
      cooldown_days integer NOT NULL DEFAULT 30, second_reminder_delay_days integer NOT NULL DEFAULT 6,
      post_treatment_discount_enabled boolean NOT NULL DEFAULT false, post_treatment_discount_percent integer NOT NULL DEFAULT 0,
      post_treatment_discount_validity_days integer NOT NULL DEFAULT 30, personalized_bundle_discount_percent integer NOT NULL DEFAULT 10,
      combination_window_days integer NOT NULL DEFAULT 30, created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT aftercare_settings_positive_days_check CHECK (cooldown_days > 0 AND second_reminder_delay_days > 0 AND post_treatment_discount_validity_days > 0 AND combination_window_days > 0),
      CONSTRAINT aftercare_settings_percent_check CHECK (post_treatment_discount_percent BETWEEN 0 AND 100 AND personalized_bundle_discount_percent BETWEEN 1 AND 100),
      CONSTRAINT aftercare_settings_discount_enabled_check CHECK (NOT post_treatment_discount_enabled OR post_treatment_discount_percent > 0)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_settings_version_unique ON ${s}.aftercare_settings (version)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_settings_current_unique ON ${s}.aftercare_settings (is_current) WHERE is_current`,
    `CREATE INDEX IF NOT EXISTS aftercare_settings_created_by_user_idx ON ${s}.aftercare_settings (created_by_user_id)`,
    `INSERT INTO ${s}.aftercare_settings (version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${s}.aftercare_settings)`,
    `CREATE TABLE IF NOT EXISTS ${s}.aftercare_completion_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE CASCADE,
      customer_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, transition_key text NOT NULL, completed_at timestamptz NOT NULL,
      available_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, claim_token text, claim_expires_at timestamptz,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), last_error text, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_completion_events_transition_unique ON ${s}.aftercare_completion_events (appointment_id, transition_key)`,
    `CREATE INDEX IF NOT EXISTS aftercare_completion_events_customer_user_idx ON ${s}.aftercare_completion_events (customer_user_id)`,
    `CREATE INDEX IF NOT EXISTS aftercare_completion_events_due_idx ON ${s}.aftercare_completion_events (processed_at, available_at, claim_expires_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.aftercare_recommendations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
      settings_version integer NOT NULL, status ${s}.aftercare_recommendation_status NOT NULL DEFAULT 'PENDING',
      entitlement_token_hash text NOT NULL UNIQUE, window_started_at timestamptz NOT NULL, window_ends_at timestamptz NOT NULL,
      activates_at timestamptz NOT NULL, entitlement_expires_at timestamptz NOT NULL, settings_snapshot jsonb NOT NULL,
      treatment_snapshot jsonb NOT NULL, read_at timestamptz, first_sent_at timestamptz, second_sent_at timestamptz,
      converted_at timestamptz, converted_order_id uuid REFERENCES ${s}.retail_orders(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT aftercare_recommendations_window_check CHECK (window_ends_at > window_started_at AND entitlement_expires_at > activates_at)
    )`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendations_customer_created_idx ON ${s}.aftercare_recommendations (customer_user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendations_stats_idx ON ${s}.aftercare_recommendations (created_at, status, converted_at)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendations_conversion_order_idx ON ${s}.aftercare_recommendations (converted_order_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.aftercare_recommendation_appointments (
      recommendation_id uuid NOT NULL REFERENCES ${s}.aftercare_recommendations(id) ON DELETE CASCADE,
      appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE RESTRICT,
      treatment_id uuid NOT NULL REFERENCES ${s}.treatment_taxonomy(id) ON DELETE RESTRICT, appointment_snapshot jsonb NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_recommendation_appointments_appointment_unique ON ${s}.aftercare_recommendation_appointments (appointment_id)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_appointments_recommendation_idx ON ${s}.aftercare_recommendation_appointments (recommendation_id)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_appointments_treatment_idx ON ${s}.aftercare_recommendation_appointments (treatment_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.aftercare_recommendation_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recommendation_id uuid NOT NULL REFERENCES ${s}.aftercare_recommendations(id) ON DELETE CASCADE,
      kind ${s}.aftercare_line_kind NOT NULL, product_id uuid REFERENCES ${s}.products(id) ON DELETE SET NULL,
      bundle_id uuid REFERENCES ${s}.product_bundles(id) ON DELETE SET NULL, treatment_ids jsonb NOT NULL, covered_product_ids jsonb NOT NULL,
      catalog_snapshot jsonb NOT NULL, pricing_snapshot jsonb NOT NULL, discount_kind text NOT NULL, discount_percent integer NOT NULL,
      discount_allocation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, replenishment_due_at timestamptz, replenishment_sent_at timestamptz,
      purchased_at timestamptz, purchased_order_id uuid REFERENCES ${s}.retail_orders(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT aftercare_recommendation_lines_shape_check CHECK ((kind='PRODUCT' AND product_id IS NOT NULL AND bundle_id IS NULL) OR (kind='PREMADE_BUNDLE' AND product_id IS NULL AND bundle_id IS NOT NULL) OR (kind='PERSONALIZED_BUNDLE' AND product_id IS NULL AND bundle_id IS NULL)),
      CONSTRAINT aftercare_recommendation_lines_discount_check CHECK (discount_percent BETWEEN 0 AND 100),
      CONSTRAINT aftercare_recommendation_lines_coverage_check CHECK (jsonb_array_length(treatment_ids) > 0 AND jsonb_array_length(covered_product_ids) > 0)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_recommendation_lines_product_unique ON ${s}.aftercare_recommendation_lines (recommendation_id, product_id) WHERE kind = 'PRODUCT'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_recommendation_lines_bundle_unique ON ${s}.aftercare_recommendation_lines (recommendation_id, bundle_id) WHERE kind = 'PREMADE_BUNDLE'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_recommendation_lines_personalized_unique ON ${s}.aftercare_recommendation_lines (recommendation_id) WHERE kind = 'PERSONALIZED_BUNDLE'`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_lines_product_cooldown_idx ON ${s}.aftercare_recommendation_lines (product_id, purchased_at)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_lines_bundle_idx ON ${s}.aftercare_recommendation_lines (bundle_id)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_lines_purchased_order_idx ON ${s}.aftercare_recommendation_lines (purchased_order_id)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_lines_replenishment_idx ON ${s}.aftercare_recommendation_lines (replenishment_sent_at, replenishment_due_at)`,
    `CREATE INDEX IF NOT EXISTS aftercare_recommendation_lines_stats_idx ON ${s}.aftercare_recommendation_lines (product_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.aftercare_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recommendation_id uuid NOT NULL REFERENCES ${s}.aftercare_recommendations(id) ON DELETE CASCADE,
      line_id uuid REFERENCES ${s}.aftercare_recommendation_lines(id) ON DELETE CASCADE, kind ${s}.aftercare_delivery_kind NOT NULL,
      status ${s}.aftercare_delivery_status NOT NULL DEFAULT 'QUEUED', event_key text NOT NULL UNIQUE, scheduled_at timestamptz NOT NULL,
      claim_token text, claim_expires_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      provider_message_id text, provider_status text, provider_event_at timestamptz, accepted_at timestamptz, sent_at timestamptz,
      failed_at timestamptz, last_error text, payload_snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT aftercare_deliveries_replenishment_line_check CHECK (kind <> 'REPLENISHMENT' OR line_id IS NOT NULL)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_deliveries_campaign_kind_unique ON ${s}.aftercare_deliveries (recommendation_id, kind) WHERE line_id IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS aftercare_deliveries_line_kind_unique ON ${s}.aftercare_deliveries (recommendation_id, line_id, kind) WHERE line_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS aftercare_deliveries_line_idx ON ${s}.aftercare_deliveries (line_id)`,
    `CREATE INDEX IF NOT EXISTS aftercare_deliveries_due_claim_idx ON ${s}.aftercare_deliveries (status, scheduled_at, claim_expires_at)`,
    `CREATE INDEX IF NOT EXISTS aftercare_deliveries_provider_idx ON ${s}.aftercare_deliveries (provider_message_id)`,
    // v69 — B2C order lines retain the exact server-validated entitlement
    // reference and allocations.  The FK is added after aftercare tables exist
    // so legacy upgrades remain dependency-safe.
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retail_order_items_aftercare_recommendation_fk'
         AND conrelid='${s}.retail_order_items'::regclass) THEN
         ALTER TABLE ${s}.retail_order_items ADD CONSTRAINT retail_order_items_aftercare_recommendation_fk
           FOREIGN KEY (aftercare_recommendation_id) REFERENCES ${s}.aftercare_recommendations(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS retail_order_items_aftercare_recommendation_idx
       ON ${s}.retail_order_items (aftercare_recommendation_id) WHERE aftercare_recommendation_id IS NOT NULL`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retail_order_items_aftercare_discount_check'
         AND conrelid='${s}.retail_order_items'::regclass) THEN
         ALTER TABLE ${s}.retail_order_items ADD CONSTRAINT retail_order_items_aftercare_discount_check CHECK (
           personalized_treatment_bundle_discount_rsd >= 0
           AND post_treatment_recommendation_discount_rsd >= 0
           AND personalized_treatment_bundle_discount_rsd + post_treatment_recommendation_discount_rsd <= line_subtotal
         ) NOT VALID;
         ALTER TABLE ${s}.retail_order_items VALIDATE CONSTRAINT retail_order_items_aftercare_discount_check;
       END IF;
     END $$`,
    // v70 — v69's SET NULL action conflicts with the immutable commercial
    // evidence trigger. Keep the evidence reference intact and prevent deletion
    // of a recommendation while an order line cites it.
    `ALTER TABLE ${s}.retail_order_items
       DROP CONSTRAINT IF EXISTS retail_order_items_aftercare_recommendation_fk`,
    `ALTER TABLE ${s}.retail_order_items
       ADD CONSTRAINT retail_order_items_aftercare_recommendation_fk
       FOREIGN KEY (aftercare_recommendation_id)
       REFERENCES ${s}.aftercare_recommendations(id) ON DELETE RESTRICT`,
    `CREATE OR REPLACE FUNCTION ${s}.protect_aftercare_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id OR NEW.settings_version IS DISTINCT FROM OLD.settings_version
        OR NEW.entitlement_token_hash IS DISTINCT FROM OLD.entitlement_token_hash OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
        OR NEW.treatment_snapshot IS DISTINCT FROM OLD.treatment_snapshot OR NEW.window_started_at IS DISTINCT FROM OLD.window_started_at
        OR NEW.window_ends_at IS DISTINCT FROM OLD.window_ends_at OR NEW.activates_at IS DISTINCT FROM OLD.activates_at
        OR NEW.entitlement_expires_at IS DISTINCT FROM OLD.entitlement_expires_at THEN
        RAISE EXCEPTION 'aftercare recommendation evidence is immutable';
      END IF; RETURN NEW; END $$`,
    `DROP TRIGGER IF EXISTS protect_aftercare_recommendation_evidence ON ${s}.aftercare_recommendations`,
    `CREATE TRIGGER protect_aftercare_recommendation_evidence BEFORE UPDATE ON ${s}.aftercare_recommendations FOR EACH ROW EXECUTE FUNCTION ${s}.protect_aftercare_evidence()`,
    `CREATE OR REPLACE FUNCTION ${s}.protect_aftercare_line_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
        OR NEW.treatment_ids IS DISTINCT FROM OLD.treatment_ids OR NEW.covered_product_ids IS DISTINCT FROM OLD.covered_product_ids
        OR NEW.catalog_snapshot IS DISTINCT FROM OLD.catalog_snapshot OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot
        OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent
        OR NEW.discount_allocation_snapshot IS DISTINCT FROM OLD.discount_allocation_snapshot THEN
        RAISE EXCEPTION 'aftercare recommendation line evidence is immutable';
      END IF; RETURN NEW; END $$`,
    `DROP TRIGGER IF EXISTS protect_aftercare_recommendation_line_evidence ON ${s}.aftercare_recommendation_lines`,
    `CREATE TRIGGER protect_aftercare_recommendation_line_evidence BEFORE UPDATE ON ${s}.aftercare_recommendation_lines FOR EACH ROW EXECUTE FUNCTION ${s}.protect_aftercare_line_evidence()`,
    // v72 — repair v71 deployments whose old shared order-line trigger was
    // retained or rebound after the initial split. This tail is deliberately
    // unconditional: a rollout recorded as v71 must receive the corrected
    // function bodies and bindings even when every table/column already exists.
    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.product_name IS DISTINCT FROM OLD.product_name
           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku
           OR NEW.price IS DISTINCT FROM OLD.price
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
           OR NEW.line_total IS DISTINCT FROM OLD.line_total
           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd
           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price
           OR NEW.price_source IS DISTINCT FROM OLD.price_source
           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount
           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot
           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
           RAISE EXCEPTION 'Order item commercial snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.product_name IS DISTINCT FROM OLD.product_name
           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url
           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value
           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
           OR NEW.line_total IS DISTINCT FROM OLD.line_total
           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd
           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price
           OR NEW.price_source IS DISTINCT FROM OLD.price_source
           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount
           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot
           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd
           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd
           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id
           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
           RAISE EXCEPTION 'Order item commercial snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    `DROP TRIGGER IF EXISTS order_items_commercial_snapshot_immutable ON ${s}.order_items`,
    `CREATE TRIGGER order_items_commercial_snapshot_immutable BEFORE UPDATE ON ${s}.order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()`,
    `DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_immutable ON ${s}.retail_order_items`,
    `CREATE TRIGGER retail_order_items_commercial_snapshot_immutable BEFORE UPDATE ON ${s}.retail_order_items
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()`,
    // v73 — v47 added these checks as NOT VALID but never validated them.
    // Replit Publish introspects the development schema and cannot reproduce
    // NOT VALID checks inline inside CREATE TABLE, so finish their validation.
    `ALTER TABLE ${s}.shop_settings
       VALIDATE CONSTRAINT shop_settings_retail_cart_reminder_delay_check`,
    `ALTER TABLE ${s}.shop_settings
       VALIDATE CONSTRAINT shop_settings_retail_cart_reminder_template_check`,
    // v75 — additive location assignments and schedules. employees.salon_id
    // remains the legacy/default location; no historic appointment is moved.
    `CREATE TABLE IF NOT EXISTS ${s}.employee_location_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      active boolean NOT NULL DEFAULT true,
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (employee_id, salon_id)
    )`,
    `CREATE INDEX IF NOT EXISTS employee_location_assignments_salon_active_idx
      ON ${s}.employee_location_assignments (salon_id, active)`,
    `CREATE INDEX IF NOT EXISTS employee_location_assignments_employee_active_idx
      ON ${s}.employee_location_assignments (employee_id, active)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS employee_location_assignments_one_default_unique
      ON ${s}.employee_location_assignments (employee_id) WHERE is_default = true`,
    // One-time-safe legacy backfill. Conflict makes repeated startup a no-op
    // and never reactivates an owner-deactivated assignment.
    `INSERT INTO ${s}.employee_location_assignments
       (employee_id, salon_id, active, is_default)
     SELECT id, salon_id, true, true FROM ${s}.employees
     ON CONFLICT (employee_id, salon_id) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS ${s}.employee_location_schedules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id uuid NOT NULL REFERENCES ${s}.employees(id) ON DELETE CASCADE,
      salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
      weekday integer NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      break_start text,
      break_end text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (employee_id, salon_id, weekday, start_time, end_time)
    )`,
    `CREATE INDEX IF NOT EXISTS employee_location_schedules_employee_salon_weekday_idx
      ON ${s}.employee_location_schedules (employee_id, salon_id, weekday)`,
    `CREATE INDEX IF NOT EXISTS employee_location_schedules_salon_idx
      ON ${s}.employee_location_schedules (salon_id)`,
    // Preserve legacy schedules as the schedule of the legacy/default salon.
    // Some historical schemas predate employee_schedules entirely, so defer
    // parsing the legacy-table query until the guarded branch is entered.
    `DO $$ BEGIN
       IF to_regclass('${s}.employee_schedules') IS NOT NULL THEN
         INSERT INTO ${s}.employee_location_schedules
           (employee_id, salon_id, weekday, start_time, end_time, break_start, break_end)
         SELECT es.employee_id, e.salon_id, es.weekday, es.start_time, es.end_time, es.break_start, es.break_end
         FROM ${s}.employee_schedules es
         INNER JOIN ${s}.employees e ON e.id = es.employee_id
         ON CONFLICT (employee_id, salon_id, weekday, start_time, end_time) DO NOTHING;
       END IF;
     END $$`,
    // A NULL location continues to mean leave at every location.
    `ALTER TABLE ${s}.employee_time_off ADD COLUMN IF NOT EXISTS salon_id uuid
      REFERENCES ${s}.salons(id) ON DELETE CASCADE`,
    `CREATE INDEX IF NOT EXISTS employee_time_off_employee_salon_start_idx
      ON ${s}.employee_time_off (employee_id, salon_id, start_date)`,
    `CREATE INDEX IF NOT EXISTS employee_time_off_salon_idx
      ON ${s}.employee_time_off (salon_id)`,
    // v78 — Dynamic Booking Calendar. All changes are additive; legacy
    // date/start/end remain the public compatibility fields.
    `ALTER TABLE ${s}.services ADD COLUMN IF NOT EXISTS buffer_minutes integer NOT NULL DEFAULT 0`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_buffer_minutes_check'
         AND conrelid='${s}.services'::regclass) THEN
         ALTER TABLE ${s}.services ADD CONSTRAINT services_buffer_minutes_check
           CHECK (buffer_minutes >= 0) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.services VALIDATE CONSTRAINT services_buffer_minutes_check`,
    `CREATE TABLE IF NOT EXISTS ${s}.salon_booking_settings (
       salon_id uuid PRIMARY KEY REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       slot_granularity_minutes integer NOT NULL DEFAULT 15,
       minimum_lead_time_minutes integer NOT NULL DEFAULT 0,
       cancellation_deadline_minutes integer NOT NULL DEFAULT 0,
       reminder_offsets_minutes jsonb NOT NULL DEFAULT '[]'::jsonb,
       reminder_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
       max_visit_gap_minutes integer NOT NULL DEFAULT 0,
       minimum_useful_late_treatment_minutes integer NOT NULL DEFAULT 0,
       updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT salon_booking_settings_granularity_check
         CHECK (slot_granularity_minutes IN (5, 10, 15, 30)),
       CONSTRAINT salon_booking_settings_nonnegative_check CHECK (
         minimum_lead_time_minutes >= 0 AND cancellation_deadline_minutes >= 0
         AND max_visit_gap_minutes >= 0 AND minimum_useful_late_treatment_minutes >= 0)
     )`,
    `CREATE INDEX IF NOT EXISTS salon_booking_settings_updated_by_idx
       ON ${s}.salon_booking_settings (updated_by_user_id)`,
    `INSERT INTO ${s}.salon_booking_settings (salon_id)
       SELECT id FROM ${s}.salons ON CONFLICT (salon_id) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS ${s}.salon_date_hours (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       date date NOT NULL, closed boolean NOT NULL DEFAULT false,
       open_time text, close_time text, reason text,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (salon_id, date),
       CONSTRAINT salon_date_hours_window_check CHECK (
         (closed AND open_time IS NULL AND close_time IS NULL)
         OR (NOT closed AND open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time))
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.booking_groups (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       customer_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       salon_customer_id uuid REFERENCES ${s}.salon_customers(id) ON DELETE SET NULL,
       created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       notes text, created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS booking_groups_salon_created_idx ON ${s}.booking_groups (salon_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS booking_groups_customer_idx ON ${s}.booking_groups (customer_id)`,
    `CREATE INDEX IF NOT EXISTS booking_groups_salon_customer_idx ON ${s}.booking_groups (salon_customer_id)`,
    `CREATE INDEX IF NOT EXISTS booking_groups_created_by_idx ON ${s}.booking_groups (created_by_user_id)`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS booking_group_id uuid
       REFERENCES ${s}.booking_groups(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS planned_date date`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS planned_start_time text`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS planned_end_time text`,
    // v80 — complete arrival/start lifecycle audit. These remain nullable for
    // legacy appointments that predate explicit staff lifecycle actions.
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS arrived_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS arrived_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS actual_started_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS started_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS actual_completed_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS no_show_at timestamptz`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS no_show_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.appointments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
    // v79 — leading indexes for the user-audit foreign keys introduced by v78.
    `CREATE INDEX IF NOT EXISTS appointments_created_by_idx ON ${s}.appointments (created_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_updated_by_idx ON ${s}.appointments (updated_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_arrived_by_idx ON ${s}.appointments (arrived_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_started_by_idx ON ${s}.appointments (started_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_cancelled_by_idx ON ${s}.appointments (cancelled_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_completed_by_idx ON ${s}.appointments (completed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_no_show_by_idx ON ${s}.appointments (no_show_by_user_id)`,
    // Copy, never normalize or rewrite, the legacy customer-visible wall-clock values.
    `UPDATE ${s}.appointments SET
       planned_date=COALESCE(planned_date, appointment_date),
       planned_start_time=COALESCE(planned_start_time, start_time),
       planned_end_time=COALESCE(planned_end_time, end_time)
     WHERE (planned_date IS NULL AND appointment_date IS NOT NULL)
        OR (planned_start_time IS NULL AND start_time IS NOT NULL)
        OR (planned_end_time IS NULL AND end_time IS NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS appointments_booking_group_idx ON ${s}.appointments (booking_group_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.appointment_status_history (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE CASCADE,
       status ${s}.appointment_status NOT NULL,
       action text,
       changed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       occurred_at timestamptz NOT NULL DEFAULT now(),
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `ALTER TABLE ${s}.appointment_status_history ADD COLUMN IF NOT EXISTS action text`,
    `ALTER TABLE ${s}.appointment_status_history ADD COLUMN IF NOT EXISTS occurred_at timestamptz`,
    `UPDATE ${s}.appointment_status_history
       SET occurred_at = COALESCE(occurred_at, created_at)
       WHERE occurred_at IS NULL`,
    `ALTER TABLE ${s}.appointment_status_history ALTER COLUMN occurred_at SET DEFAULT now()`,
    `ALTER TABLE ${s}.appointment_status_history ALTER COLUMN occurred_at SET NOT NULL`,
    `CREATE INDEX IF NOT EXISTS appointment_status_history_appt_created_idx
       ON ${s}.appointment_status_history (appointment_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS appointment_status_history_changed_by_idx
       ON ${s}.appointment_status_history (changed_by_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.appointment_treatments (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE CASCADE,
       service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE RESTRICT,
       employee_id uuid REFERENCES ${s}.employees(id) ON DELETE SET NULL,
       position integer NOT NULL, duration_minutes integer NOT NULL,
       buffer_minutes integer NOT NULL DEFAULT 0, price integer NOT NULL,
       planned_start_time text, planned_end_time text,
       actual_started_at timestamptz, actual_completed_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (appointment_id, position),
       CONSTRAINT appointment_treatments_position_check CHECK (position >= 0),
       CONSTRAINT appointment_treatments_duration_check CHECK (duration_minutes > 0 AND buffer_minutes >= 0)
     )`,
    // Every old single-service appointment becomes a one-treatment plan. The
    // guarded shape also permits deliberately sparse historical/test fixtures.
    `INSERT INTO ${s}.appointment_treatments
       (appointment_id, service_id, employee_id, position, duration_minutes, buffer_minutes,
        price, planned_start_time, planned_end_time)
     SELECT a.id, a.service_id, a.employee_id, 0, a.duration_minutes,
       COALESCE(svc.buffer_minutes, 0), a.price, a.start_time, a.end_time
     FROM ${s}.appointments a JOIN ${s}.services svc ON svc.id=a.service_id
     WHERE a.service_id IS NOT NULL AND a.duration_minutes IS NOT NULL AND a.duration_minutes > 0
       AND a.price IS NOT NULL
     ON CONFLICT (appointment_id, position) DO NOTHING`,
    `CREATE INDEX IF NOT EXISTS appointment_treatments_service_idx ON ${s}.appointment_treatments (service_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_treatments_employee_idx ON ${s}.appointment_treatments (employee_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.salon_resources (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       salon_id uuid NOT NULL REFERENCES ${s}.salons(id) ON DELETE CASCADE,
       name text NOT NULL, type ${s}.salon_resource_type NOT NULL DEFAULT 'other',
       capacity integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (salon_id, name),
       CONSTRAINT salon_resources_capacity_positive CHECK (capacity >= 1)
     )`,
    `CREATE INDEX IF NOT EXISTS salon_resources_salon_active_idx
       ON ${s}.salon_resources (salon_id, active)`,
    `CREATE TABLE IF NOT EXISTS ${s}.service_resource_requirements (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       service_id uuid NOT NULL REFERENCES ${s}.services(id) ON DELETE CASCADE,
       resource_id uuid NOT NULL REFERENCES ${s}.salon_resources(id) ON DELETE CASCADE,
       quantity integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (service_id, resource_id),
       CONSTRAINT service_resource_requirements_quantity_positive CHECK (quantity >= 1)
     )`,
    `CREATE INDEX IF NOT EXISTS service_resource_requirements_resource_idx
       ON ${s}.service_resource_requirements (resource_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.appointment_resource_allocations (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       appointment_id uuid NOT NULL REFERENCES ${s}.appointments(id) ON DELETE CASCADE,
       resource_id uuid NOT NULL REFERENCES ${s}.salon_resources(id) ON DELETE CASCADE,
       quantity integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (appointment_id, resource_id),
       CONSTRAINT appointment_resource_allocations_quantity_positive CHECK (quantity >= 1)
     )`,
    `CREATE INDEX IF NOT EXISTS appointment_resource_allocations_resource_idx
       ON ${s}.appointment_resource_allocations (resource_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_resource_allocations_appointment_idx
       ON ${s}.appointment_resource_allocations (appointment_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.salon_resource_downtime (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       resource_id uuid NOT NULL REFERENCES ${s}.salon_resources(id) ON DELETE CASCADE,
       starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, reason text,
       created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT salon_resource_downtime_window_check CHECK (starts_at < ends_at)
     )`,
    `CREATE INDEX IF NOT EXISTS salon_resource_downtime_resource_window_idx
       ON ${s}.salon_resource_downtime (resource_id, starts_at, ends_at)`,
    `CREATE INDEX IF NOT EXISTS salon_resource_downtime_created_by_idx
       ON ${s}.salon_resource_downtime (created_by_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.customer_notifications (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE,
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       category text NOT NULL, title text NOT NULL, body text NOT NULL, deep_link text,
       read_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS customer_notifications_user_created_idx
       ON ${s}.customer_notifications (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS customer_notifications_user_unread_idx
       ON ${s}.customer_notifications (user_id, created_at) WHERE read_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.review_invitations (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE,
       appointment_id uuid NOT NULL UNIQUE REFERENCES ${s}.appointments(id) ON DELETE CASCADE,
       customer_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       notification_id uuid REFERENCES ${s}.customer_notifications(id) ON DELETE SET NULL,
       invited_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
     )`,
    `CREATE INDEX IF NOT EXISTS review_invitations_customer_idx
       ON ${s}.review_invitations (customer_id, invited_at)`,
    `CREATE INDEX IF NOT EXISTS review_invitations_notification_idx
       ON ${s}.review_invitations (notification_id)`,
    // v84 — additive Education taxonomy, discovery metrics and paid placements.
    `CREATE TABLE IF NOT EXISTS ${s}.education_sections (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
       sort_order integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS education_sections_active_sort_idx
       ON ${s}.education_sections (active, sort_order)`,
    `ALTER TABLE ${s}.course_categories ADD COLUMN IF NOT EXISTS section_id uuid
       REFERENCES ${s}.education_sections(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.course_categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.course_categories ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
    `ALTER TABLE ${s}.course_categories ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
    `ALTER TABLE ${s}.course_categories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
    `CREATE INDEX IF NOT EXISTS course_categories_section_sort_idx
       ON ${s}.course_categories (section_id, sort_order)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_subcategories (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       category_id uuid NOT NULL REFERENCES ${s}.course_categories(id) ON DELETE CASCADE,
       name text NOT NULL, slug text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
       active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (category_id, slug)
     )`,
    `CREATE INDEX IF NOT EXISTS education_subcategories_category_active_sort_idx
       ON ${s}.education_subcategories (category_id, active, sort_order)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_course_types (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       subcategory_id uuid NOT NULL REFERENCES ${s}.education_subcategories(id) ON DELETE CASCADE,
       name text NOT NULL, normalized_name text NOT NULL,
       status ${s}.education_course_type_status NOT NULL DEFAULT 'pending',
       proposed_by_center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE SET NULL,
       reviewed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       review_note text, reviewed_at timestamptz, sort_order integer NOT NULL DEFAULT 0,
       active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (subcategory_id, normalized_name)
     )`,
    `CREATE INDEX IF NOT EXISTS education_course_types_status_idx
       ON ${s}.education_course_types (status, active, sort_order)`,
    `CREATE INDEX IF NOT EXISTS education_course_types_proposed_by_idx
       ON ${s}.education_course_types (proposed_by_center_id)`,
    `CREATE INDEX IF NOT EXISTS education_course_types_reviewed_by_idx
       ON ${s}.education_course_types (reviewed_by_user_id)`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS subcategory_id uuid
       REFERENCES ${s}.education_subcategories(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS course_type_id uuid
       REFERENCES ${s}.education_course_types(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS theory_hours integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS practical_hours integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS certificate_name text`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS accredited boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS language text DEFAULT 'Srpski'`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS trailer_url text`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS faq jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS payment_mode ${s}.education_payment_mode NOT NULL DEFAULT 'online_full'`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS deposit_amount integer`,
    `CREATE INDEX IF NOT EXISTS courses_subcategory_published_idx
       ON ${s}.courses (subcategory_id, published, archived)`,
    `CREATE INDEX IF NOT EXISTS courses_course_type_published_idx
       ON ${s}.courses (course_type_id, published, archived)`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_theory_hours_nonnegative_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_theory_hours_nonnegative_check CHECK (theory_hours IS NULL OR theory_hours >= 0) NOT VALID;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_practical_hours_nonnegative_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_practical_hours_nonnegative_check CHECK (practical_hours IS NULL OR practical_hours >= 0) NOT VALID;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_deposit_amount_nonnegative_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_deposit_amount_nonnegative_check CHECK (deposit_amount IS NULL OR deposit_amount >= 0) NOT VALID;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_live_deposit_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_live_deposit_check CHECK (payment_mode <> 'live_deposit' OR (format IN ('in-person', 'hybrid') AND deposit_amount > 0)) NOT VALID;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_live_off_platform_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_live_off_platform_check CHECK (payment_mode <> 'live_off_platform' OR format IN ('in-person', 'hybrid')) NOT VALID;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_non_deposit_amount_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_non_deposit_amount_check CHECK (payment_mode = 'live_deposit' OR deposit_amount IS NULL) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_theory_hours_nonnegative_check`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_practical_hours_nonnegative_check`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_deposit_amount_nonnegative_check`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_live_deposit_check`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_live_off_platform_check`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_non_deposit_amount_check`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_inquiries (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE CASCADE,
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
       status text NOT NULL DEFAULT 'open', message text,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS education_inquiries_course_created_idx ON ${s}.education_inquiries (course_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS education_inquiries_center_status_created_idx ON ${s}.education_inquiries (center_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS education_inquiries_user_created_idx ON ${s}.education_inquiries (user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_course_metric_events (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE CASCADE,
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
       actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       event_type text NOT NULL CHECK (event_type IN ('view', 'inquiry')),
       occurred_at timestamptz NOT NULL DEFAULT now(), dedupe_key text
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_course_metric_events_dedupe_unique
       ON ${s}.education_course_metric_events (dedupe_key) WHERE dedupe_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS education_course_metric_events_course_30d_idx
       ON ${s}.education_course_metric_events (course_id, event_type, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS education_course_metric_events_center_90d_idx
       ON ${s}.education_course_metric_events (center_id, event_type, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS education_course_metric_events_actor_idx
       ON ${s}.education_course_metric_events (actor_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_placement_settings (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind ${s}.education_placement_kind NOT NULL,
       scope ${s}.education_placement_scope NOT NULL, price integer NOT NULL CHECK (price >= 0),
       slot_count integer NOT NULL CHECK (slot_count > 0), duration_days integer NOT NULL CHECK (duration_days > 0),
       updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (kind, scope)
     )`,
    `CREATE INDEX IF NOT EXISTS education_placement_settings_updated_by_idx ON ${s}.education_placement_settings (updated_by_user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_placements (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind ${s}.education_placement_kind NOT NULL,
       scope ${s}.education_placement_scope NOT NULL,
       scope_category_id uuid REFERENCES ${s}.course_categories(id) ON DELETE CASCADE,
       scope_subcategory_id uuid REFERENCES ${s}.education_subcategories(id) ON DELETE CASCADE,
        scope_key text GENERATED ALWAYS AS (coalesce(scope_category_id::text, scope_subcategory_id::text, 'home')) STORED,
       center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
       course_id uuid REFERENCES ${s}.courses(id) ON DELETE CASCADE,
        slot_number integer NOT NULL CHECK (slot_number > 0), price_snapshot integer NOT NULL CHECK (price_snapshot >= 0),
        duration_days_snapshot integer NOT NULL CHECK (duration_days_snapshot > 0),
       status ${s}.education_placement_status NOT NULL DEFAULT 'pending_payment',
       payment_reference text UNIQUE, starts_at timestamptz, ends_at timestamptz,
       rotation_seed integer NOT NULL DEFAULT 0, settled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT education_placements_target_check CHECK (
         (kind='featured_center' AND center_id IS NOT NULL AND course_id IS NULL)
         OR (kind='special_offer' AND course_id IS NOT NULL AND center_id IS NULL)),
       CONSTRAINT education_placements_scope_check CHECK (
         (scope='home' AND scope_category_id IS NULL AND scope_subcategory_id IS NULL)
         OR (scope='category' AND scope_category_id IS NOT NULL AND scope_subcategory_id IS NULL)
         OR (scope='subcategory' AND scope_category_id IS NULL AND scope_subcategory_id IS NOT NULL)),
       CONSTRAINT education_placements_dates_check CHECK (
         (starts_at IS NULL AND ends_at IS NULL)
         OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at))
     )`,
    `CREATE INDEX IF NOT EXISTS education_placements_scope_status_dates_idx ON ${s}.education_placements (kind, scope, status, starts_at, ends_at)`,
    `CREATE INDEX IF NOT EXISTS education_placements_pending_created_idx ON ${s}.education_placements (status, created_at)`,
    `CREATE INDEX IF NOT EXISTS education_placements_category_slot_idx ON ${s}.education_placements (scope_category_id, slot_number, status)`,
    `CREATE INDEX IF NOT EXISTS education_placements_subcategory_slot_idx ON ${s}.education_placements (scope_subcategory_id, slot_number, status)`,
    `CREATE EXTENSION IF NOT EXISTS btree_gist`,
    // Existing deployments may have overlapping active placements from before
    // this invariant. Preserve the rows/audit trail and expire older conflicts
    // before installing the exclusion constraint, making replay safe.
    `WITH ranked AS (
       SELECT id, row_number() OVER (
         PARTITION BY kind, scope, coalesce(scope_category_id::text, scope_subcategory_id::text, 'home'), slot_number
         ORDER BY starts_at DESC NULLS LAST, created_at DESC
       ) AS rn
       FROM ${s}.education_placements WHERE status = 'active'
     ) UPDATE ${s}.education_placements p SET status = 'expired', updated_at = now()
       FROM ranked r WHERE p.id = r.id AND r.rn > 1`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS scope_key text
       GENERATED ALWAYS AS (coalesce(scope_category_id::text, scope_subcategory_id::text, 'home')) STORED`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS duration_days_snapshot integer`,
    `UPDATE ${s}.education_placements p
        SET duration_days_snapshot = coalesce((
          SELECT ps.duration_days
          FROM ${s}.education_placement_settings ps
          WHERE ps.kind = p.kind AND ps.scope = p.scope
          LIMIT 1
        ), 30)
      WHERE p.duration_days_snapshot IS NULL`,
    `ALTER TABLE ${s}.education_placements ALTER COLUMN duration_days_snapshot SET NOT NULL`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = '${s}.education_placements'::regclass
           AND conname = 'education_placements_duration_days_check'
       ) THEN
         ALTER TABLE ${s}.education_placements
           ADD CONSTRAINT education_placements_duration_days_check CHECK (duration_days_snapshot > 0);
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = '${s}.education_placements'::regclass
           AND conname = 'education_placements_active_slot_no_overlap'
       ) THEN
         ALTER TABLE ${s}.education_placements
           ADD CONSTRAINT education_placements_active_slot_no_overlap
           EXCLUDE USING gist (
             kind WITH =, scope WITH =, scope_key WITH =, slot_number WITH =,
             tstzrange(starts_at, ends_at, '[)') WITH &&
           ) WHERE (status = 'active');
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS education_placements_center_idx ON ${s}.education_placements (center_id)`,
    `CREATE INDEX IF NOT EXISTS education_placements_course_idx ON ${s}.education_placements (course_id)`,
    `CREATE INDEX IF NOT EXISTS education_placements_settled_by_idx ON ${s}.education_placements (settled_by_user_id)`,
    // v96 — one paid-placement ledger now also targets salons. Existing
    // education rows and endpoint contracts remain untouched.
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS salon_id uuid REFERENCES ${s}.salons(id) ON DELETE CASCADE`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS settled_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS education_placements_salon_idx ON ${s}.education_placements (salon_id)`,
    `ALTER TABLE ${s}.education_placements DROP CONSTRAINT IF EXISTS education_placements_target_check`,
    `ALTER TABLE ${s}.education_placements ADD CONSTRAINT education_placements_target_check CHECK (
       (kind='featured_salon' AND salon_id IS NOT NULL AND center_id IS NULL AND course_id IS NULL)
       OR (kind='featured_center' AND center_id IS NOT NULL AND salon_id IS NULL AND course_id IS NULL)
       OR (kind='special_offer' AND course_id IS NOT NULL AND center_id IS NULL AND salon_id IS NULL)
     ) NOT VALID`,
    `ALTER TABLE ${s}.education_placements VALIDATE CONSTRAINT education_placements_target_check`,
    `INSERT INTO ${s}.education_placement_settings (kind, scope, price, slot_count, duration_days)
       VALUES ('featured_salon', 'home', 5000, 12, 30)
       ON CONFLICT (kind, scope) DO NOTHING`,
    `UPDATE ${s}.education_placements
       SET payment_reference = 'FP-' || replace(id::text, '-', '')
       WHERE payment_reference IS NULL OR length(payment_reference) > 35`,
    // v97 — immutable payment instructions. Nullable by design: historical
    // rows predate snapshots and remain readable as explicitly nonpayable.
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS payment_ips_payload_snapshot text`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS payment_recipient_name_snapshot text`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS payment_recipient_account_snapshot text`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS payment_purpose_snapshot text`,
    `ALTER TABLE ${s}.education_placements ADD COLUMN IF NOT EXISTS payment_currency_snapshot text`,
    `DO $$ BEGIN
       IF to_regclass('${s}.education_center_subscriptions') IS NOT NULL THEN
         ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';
         ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS payment_reference text;
         ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS paid_at timestamptz;
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.education_center_subscriptions'::regclass AND conname='education_center_subscriptions_billing_cycle_check') THEN
           ALTER TABLE ${s}.education_center_subscriptions ADD CONSTRAINT education_center_subscriptions_billing_cycle_check CHECK (billing_cycle IN ('monthly', 'yearly')) NOT VALID;
         END IF;
       END IF;
     END $$`,
    // v87 — remaining Education marketplace: explicit duration, canonical
    // center reviews, private wishlists and manual-payment gift vouchers.
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS duration_minutes integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS gift_voucher_eligible boolean NOT NULL DEFAULT false`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_duration_minutes_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_duration_minutes_check
           CHECK (duration_minutes IS NULL OR duration_minutes > 0) NOT VALID;
       END IF;
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='courses' AND column_name='refund_policy')
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_published_live_deposit_refund_policy_check') THEN
         ALTER TABLE ${s}.courses ADD CONSTRAINT courses_published_live_deposit_refund_policy_check
           CHECK (NOT (published AND payment_mode='live_deposit') OR length(btrim(refund_policy)) > 0) NOT VALID;
       END IF;
     END $$`,
    `ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_duration_minutes_check`,
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.courses'::regclass AND conname='courses_published_live_deposit_refund_policy_check') THEN
         ALTER TABLE ${s}.courses VALIDATE CONSTRAINT courses_published_live_deposit_refund_policy_check;
       END IF;
     END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_center_reviews (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
       enrollment_id uuid NOT NULL UNIQUE REFERENCES ${s}.course_enrollments(id) ON DELETE CASCADE,
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), comment text NOT NULL DEFAULT '',
       status ${s}.education_review_status NOT NULL DEFAULT 'pending',
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS education_center_reviews_center_status_created_idx
       ON ${s}.education_center_reviews (center_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS education_center_reviews_user_idx ON ${s}.education_center_reviews (user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_wishlists (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE,
       course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE CASCADE,
       created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, course_id)
     )`,
    `CREATE INDEX IF NOT EXISTS education_wishlists_user_created_idx ON ${s}.education_wishlists (user_id, created_at, id)`,
    `CREATE INDEX IF NOT EXISTS education_wishlists_course_idx ON ${s}.education_wishlists (course_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_gift_vouchers (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE RESTRICT,
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
       purchaser_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       recipient_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT, recipient_email text,
       course_title_snapshot text NOT NULL, course_image_url_snapshot text NOT NULL,
       amount_snapshot integer NOT NULL CHECK (amount_snapshot >= 0), currency_snapshot text NOT NULL DEFAULT 'RSD',
       code_hash text NOT NULL UNIQUE, code_last4 text NOT NULL,
       status ${s}.education_gift_voucher_status NOT NULL DEFAULT 'pending_payment',
       payment_reference text NOT NULL UNIQUE, idempotency_key text,
       settled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, settled_at timestamptz,
       redeemed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       redeemed_enrollment_id uuid UNIQUE REFERENCES ${s}.course_enrollments(id) ON DELETE RESTRICT, redeemed_at timestamptz,
       refunded_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, refunded_at timestamptz,
       refund_note text, dispute_id uuid,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT education_gift_vouchers_recipient_check CHECK (num_nonnulls(recipient_user_id, recipient_email) >= 1)
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_gift_vouchers_purchaser_idempotency_unique
       ON ${s}.education_gift_vouchers (purchaser_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_purchaser_created_idx ON ${s}.education_gift_vouchers (purchaser_id, created_at, id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_recipient_created_idx ON ${s}.education_gift_vouchers (recipient_user_id, created_at, id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_center_status_idx ON ${s}.education_gift_vouchers (center_id, status, created_at)`,
    `DO $$ BEGIN
       IF to_regclass('${s}.education_disputes') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${s}.education_gift_vouchers'::regclass AND conname='education_gift_vouchers_dispute_id_fkey') THEN
         ALTER TABLE ${s}.education_gift_vouchers ADD CONSTRAINT education_gift_vouchers_dispute_id_fkey
           FOREIGN KEY (dispute_id) REFERENCES ${s}.education_disputes(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_education_gift_voucher_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id
           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot
           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot
           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4
           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    `DROP TRIGGER IF EXISTS education_gift_vouchers_snapshot_immutable ON ${s}.education_gift_vouchers`,
    `CREATE TRIGGER education_gift_vouchers_snapshot_immutable BEFORE UPDATE ON ${s}.education_gift_vouchers
       FOR EACH ROW EXECUTE FUNCTION ${s}.prevent_education_gift_voucher_snapshot_update()`,
    // v88 — instructor portfolios and immutable optional gift presentation.
    // education_instructors is owned by the canonical Drizzle schema rather
    // than this additive bootstrap, so old/disposable upgrade fixtures may not
    // contain it. ALTER when present; canonical schema creation already
    // includes the column for new installations.
    `ALTER TABLE IF EXISTS ${s}.education_instructors ADD COLUMN IF NOT EXISTS portfolio_media jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${s}.education_gift_vouchers ADD COLUMN IF NOT EXISTS recipient_name_snapshot text`,
    `ALTER TABLE ${s}.education_gift_vouchers ADD COLUMN IF NOT EXISTS gift_message_snapshot text`,
    `ALTER TABLE ${s}.education_center_reviews ADD COLUMN IF NOT EXISTS admin_note text`,
    `ALTER TABLE ${s}.education_center_reviews ADD COLUMN IF NOT EXISTS moderated_at timestamptz`,
    `CREATE OR REPLACE FUNCTION ${s}.prevent_education_gift_voucher_snapshot_update()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id
           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot
           OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot
           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot
           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot
           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4
           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    `DO $$ BEGIN
       IF to_regclass('${s}.education_center_subscriptions') IS NOT NULL THEN
         CREATE UNIQUE INDEX IF NOT EXISTS education_center_subscriptions_payment_reference_unique
           ON ${s}.education_center_subscriptions (payment_reference);
         ALTER TABLE ${s}.education_center_subscriptions VALIDATE CONSTRAINT education_center_subscriptions_billing_cycle_check;
       END IF;
     END $$`,
    // v90 — Education operational scheduling. This is additive so legacy
    // course/enrollment/session records continue using fixed-group defaults.
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS scheduling_mode ${s}.education_scheduling_mode NOT NULL DEFAULT 'fixed_group'`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS operational_time_zone text NOT NULL DEFAULT 'Europe/Belgrade'`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS cancellation_deadline_hours integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS deposit_disposition ${s}.education_deposit_disposition NOT NULL DEFAULT 'refund'`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS minimum_enrollment_risk_deadline timestamptz`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS early_bird_price integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS early_bird_cutoff timestamptz`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 1`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_instructors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, full_name text NOT NULL, photo_url text,
      biography text NOT NULL DEFAULT '', industry_years integer NOT NULL DEFAULT 0, experience_years integer NOT NULL DEFAULT 0,
      specializations jsonb NOT NULL DEFAULT '[]'::jsonb, qualifications jsonb NOT NULL DEFAULT '[]'::jsonb,
      portfolio_media jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS education_instructors_center_idx ON ${s}.education_instructors(center_id)`,
    `CREATE INDEX IF NOT EXISTS education_instructors_user_idx ON ${s}.education_instructors(user_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.course_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE CASCADE,
      starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, location text, capacity integer NOT NULL DEFAULT 20,
      reserved_seats integer NOT NULL DEFAULT 0, minimum_enrollments integer, cancelled_at timestamptz,
      cancellation_reason text, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS course_sessions_course_starts_at_idx ON ${s}.course_sessions(course_id, starts_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_center_staff (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE, instructor_profile_id uuid REFERENCES ${s}.education_instructors(id) ON DELETE SET NULL,
      role ${s}.education_staff_role NOT NULL, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(center_id, user_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_center_staff_one_active_educator_center_unique ON ${s}.education_center_staff(user_id) WHERE role = 'educator' AND active`,
    `CREATE INDEX IF NOT EXISTS education_center_staff_center_role_active_idx ON ${s}.education_center_staff(center_id, role, active)`,
    `CREATE INDEX IF NOT EXISTS education_center_staff_instructor_profile_idx ON ${s}.education_center_staff(instructor_profile_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_educator_weekly_availability (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES ${s}.education_center_staff(id) ON DELETE CASCADE,
      weekday integer NOT NULL, start_time text NOT NULL, end_time text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(staff_id, weekday, start_time, end_time), CHECK(weekday between 1 and 7), CHECK(start_time < end_time)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_educator_absences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES ${s}.education_center_staff(id) ON DELETE CASCADE,
      start_date date NOT NULL, end_date date NOT NULL, start_time text, end_time text, reason text, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(end_date >= start_date), CHECK((start_time is null and end_time is null) or (start_time is not null and end_time is not null and start_time < end_time))
    )`,
    `CREATE INDEX IF NOT EXISTS education_educator_absences_staff_dates_idx ON ${s}.education_educator_absences(staff_id, start_date, end_date)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_session_educators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL UNIQUE REFERENCES ${s}.course_sessions(id) ON DELETE CASCADE,
      staff_id uuid NOT NULL REFERENCES ${s}.education_center_staff(id) ON DELETE RESTRICT, assigned_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      assigned_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS education_session_educators_staff_idx ON ${s}.education_session_educators(staff_id)`,
    // v91 — durable idempotency receipts for individual-calendar recurrence commits.
    `CREATE TABLE IF NOT EXISTS ${s}.education_recurrence_commands (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      actor_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE, idempotency_key text NOT NULL,
      request_fingerprint text NOT NULL, response_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT education_recurrence_commands_key_check CHECK(length(btrim(idempotency_key)) > 0),
      CONSTRAINT education_recurrence_commands_fingerprint_check CHECK(length(request_fingerprint) = 64),
      UNIQUE(actor_user_id, idempotency_key)
    )`,
    `CREATE INDEX IF NOT EXISTS education_recurrence_commands_center_created_idx ON ${s}.education_recurrence_commands(center_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_booking_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE CASCADE, session_id uuid REFERENCES ${s}.course_sessions(id) ON DELETE SET NULL,
      purchaser_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, created_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      status ${s}.education_booking_group_status NOT NULL DEFAULT 'pending', idempotency_key text NOT NULL, request_fingerprint text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(created_by_user_id, idempotency_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_booking_participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_group_id uuid NOT NULL REFERENCES ${s}.education_booking_groups(id) ON DELETE CASCADE,
      user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, full_name text NOT NULL, email text, phone text,
      status ${s}.education_participant_status NOT NULL DEFAULT 'reserved', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(user_id is not null or email is not null or phone is not null)
    )`,
    `CREATE INDEX IF NOT EXISTS education_booking_participants_group_status_idx ON ${s}.education_booking_participants(booking_group_id, status)`,
    `CREATE INDEX IF NOT EXISTS education_booking_groups_center_session_status_idx ON ${s}.education_booking_groups(center_id, session_id, status)`,
    `CREATE INDEX IF NOT EXISTS education_booking_groups_purchaser_idx ON ${s}.education_booking_groups(purchaser_id)`,
    `CREATE INDEX IF NOT EXISTS education_booking_participants_user_idx ON ${s}.education_booking_participants(user_id)`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS booking_group_id uuid REFERENCES ${s}.education_booking_groups(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES ${s}.education_booking_participants(id) ON DELETE SET NULL`,
    // v92 operational guest attendees have no account, but must always be
    // tied to the named participant record.
    `ALTER TABLE ${s}.course_enrollments ALTER COLUMN user_id DROP NOT NULL`,
    `ALTER TABLE ${s}.course_enrollments DROP CONSTRAINT IF EXISTS course_enrollments_operational_user_check`,
    `ALTER TABLE ${s}.course_enrollments ADD CONSTRAINT course_enrollments_operational_user_check CHECK(user_id IS NOT NULL OR participant_id IS NOT NULL)`,
    `DROP INDEX IF EXISTS ${s}.course_enrollments_course_purchaser_participant_unique`,
    `CREATE UNIQUE INDEX IF NOT EXISTS course_enrollments_course_purchaser_participant_unique ON ${s}.course_enrollments(course_id, purchaser_id, participant_key) WHERE participant_id IS NULL AND status <> 'cancelled'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS course_enrollments_participant_active_unique ON ${s}.course_enrollments(participant_id) WHERE participant_id IS NOT NULL AND status <> 'cancelled'`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_attendance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_id uuid NOT NULL REFERENCES ${s}.education_booking_participants(id) ON DELETE CASCADE,
      session_id uuid NOT NULL REFERENCES ${s}.course_sessions(id) ON DELETE CASCADE, status ${s}.education_attendance_status NOT NULL,
      recorded_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(participant_id, session_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_price_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_group_id uuid NOT NULL UNIQUE REFERENCES ${s}.education_booking_groups(id) ON DELETE RESTRICT,
      course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE RESTRICT, gross_amount integer NOT NULL, platform_fee integer NOT NULL, reserve_amount integer NOT NULL, net_amount integer NOT NULL,
       early_bird_applied boolean NOT NULL DEFAULT false, early_bird_cutoff_snapshot timestamptz, installment_count integer NOT NULL,
       cancellation_deadline_at timestamptz,
      deposit_disposition ${s}.education_deposit_disposition NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(gross_amount >= 0 and platform_fee >= 0 and reserve_amount >= 0 and net_amount >= 0 and gross_amount = platform_fee + reserve_amount + net_amount), CHECK(installment_count in (1,2,3))
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_installments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), price_snapshot_id uuid NOT NULL REFERENCES ${s}.education_price_snapshots(id) ON DELETE RESTRICT,
      installment_number integer NOT NULL, amount integer NOT NULL, status ${s}.education_installment_status NOT NULL DEFAULT 'pending',
       payment_reference text NOT NULL UNIQUE, due_at timestamptz, settled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, settled_at timestamptz, refunded_amount integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(price_snapshot_id, installment_number), CHECK(amount > 0 and refunded_amount >= 0 and refunded_amount <= amount)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_installment_settlement_commands (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installment_id uuid NOT NULL REFERENCES ${s}.education_installments(id) ON DELETE CASCADE,
      actor_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE CASCADE, idempotency_key text NOT NULL, request_fingerprint text NOT NULL,
      response_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT education_installment_settlement_command_key_check CHECK(length(btrim(idempotency_key)) > 0),
      CONSTRAINT education_installment_settlement_command_fingerprint_check CHECK(length(request_fingerprint) = 64),
      UNIQUE(actor_user_id, idempotency_key)
    )`,
    `CREATE INDEX IF NOT EXISTS education_installment_settlement_command_installment_idx ON ${s}.education_installment_settlement_commands(installment_id)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_platform_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), commission_percent integer NOT NULL DEFAULT 15,
      reserve_percent integer NOT NULL DEFAULT 10, online_refund_days integer NOT NULL DEFAULT 14,
      live_appeal_days integer NOT NULL DEFAULT 7, featured_course_price integer NOT NULL DEFAULT 0,
      updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS education_platform_settings_updated_by_idx ON ${s}.education_platform_settings(updated_by_user_id)`,
    `ALTER TABLE ${s}.education_platform_settings ADD COLUMN IF NOT EXISTS ips_recipient_name text`,
    `ALTER TABLE ${s}.education_platform_settings ADD COLUMN IF NOT EXISTS ips_recipient_account text`,
    `ALTER TABLE ${s}.education_platform_settings ADD COLUMN IF NOT EXISTS ips_purpose text`,
    `ALTER TABLE ${s}.education_price_snapshots ADD COLUMN IF NOT EXISTS discount_reason text NOT NULL DEFAULT 'none'`,
    // v93 — immutable operational cancellation policy cutoff. Null marks
    // pre-v93 groups, which retain their explicit legacy treatment.
    `ALTER TABLE ${s}.education_price_snapshots ADD COLUMN IF NOT EXISTS cancellation_deadline_at timestamptz`,
    // v95 — immutable installment due date for new bookings. Historical rows
    // intentionally remain null and are rendered as having no deadline.
    `ALTER TABLE ${s}.education_installments ADD COLUMN IF NOT EXISTS due_at timestamptz`,
    // v94 — schema parity repairs for v90-v93. Constraint creation is guarded
    // so databases already marked v93 are repaired without destructive DDL.
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'education_price_snapshots_discount_reason_check' AND conrelid = '${s}.education_price_snapshots'::regclass) THEN
        ALTER TABLE ${s}.education_price_snapshots ADD CONSTRAINT education_price_snapshots_discount_reason_check CHECK(discount_reason in ('none', 'early_bird', 'group', 'early_bird_and_group'));
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_operational_timezone_check' AND conrelid = '${s}.courses'::regclass) THEN
        ALTER TABLE ${s}.courses ADD CONSTRAINT courses_operational_timezone_check CHECK(operational_time_zone = 'Europe/Belgrade');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_cancellation_deadline_check' AND conrelid = '${s}.courses'::regclass) THEN
        ALTER TABLE ${s}.courses ADD CONSTRAINT courses_cancellation_deadline_check CHECK(cancellation_deadline_hours >= 0 and cancellation_deadline_hours <= 8760);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_early_bird_check' AND conrelid = '${s}.courses'::regclass) THEN
        ALTER TABLE ${s}.courses ADD CONSTRAINT courses_early_bird_check CHECK((early_bird_price is null and early_bird_cutoff is null) or (early_bird_price >= 0 and early_bird_price <= price and early_bird_cutoff is not null));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_installment_count_check' AND conrelid = '${s}.courses'::regclass) THEN
        ALTER TABLE ${s}.courses ADD CONSTRAINT courses_installment_count_check CHECK(installment_count in (1, 2, 3));
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
      session_id uuid REFERENCES ${s}.course_sessions(id) ON DELETE CASCADE, participant_id uuid REFERENCES ${s}.education_booking_participants(id) ON DELETE CASCADE,
      event_type text NOT NULL, dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL, status ${s}.education_outbox_status NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), leased_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS education_outbox_delivery_idx ON ${s}.education_outbox(status, available_at)`,
    // v96 — every Education operational FK gets a leading index. Besides
    // improving parent update/delete behavior, this keeps post-merge database
    // standards deterministic for legacy databases upgraded from v95.
    `CREATE INDEX IF NOT EXISTS course_enrollments_booking_group_idx ON ${s}.course_enrollments(booking_group_id)`,
    `CREATE INDEX IF NOT EXISTS education_attendance_session_idx ON ${s}.education_attendance(session_id)`,
    `CREATE INDEX IF NOT EXISTS education_attendance_recorded_by_idx ON ${s}.education_attendance(recorded_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_booking_groups_course_idx ON ${s}.education_booking_groups(course_id)`,
    `CREATE INDEX IF NOT EXISTS education_booking_groups_session_idx ON ${s}.education_booking_groups(session_id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_course_idx ON ${s}.education_gift_vouchers(course_id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_settled_by_idx ON ${s}.education_gift_vouchers(settled_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_redeemed_by_idx ON ${s}.education_gift_vouchers(redeemed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_refunded_by_idx ON ${s}.education_gift_vouchers(refunded_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_gift_vouchers_dispute_idx ON ${s}.education_gift_vouchers(dispute_id)`,
    `CREATE INDEX IF NOT EXISTS education_installments_settled_by_idx ON ${s}.education_installments(settled_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_outbox_center_idx ON ${s}.education_outbox(center_id)`,
    `CREATE INDEX IF NOT EXISTS education_outbox_session_idx ON ${s}.education_outbox(session_id)`,
    `CREATE INDEX IF NOT EXISTS education_outbox_participant_idx ON ${s}.education_outbox(participant_id)`,
    `CREATE INDEX IF NOT EXISTS education_price_snapshots_course_idx ON ${s}.education_price_snapshots(course_id)`,
    `CREATE INDEX IF NOT EXISTS education_session_educators_assigned_by_idx ON ${s}.education_session_educators(assigned_by_user_id)`,
    // v99 — isolate legacy education registrations from salon tenancy.  The
    // exact registration copy plus the education owner role is provenance
    // evidence.  We first detach active_salon_id, then delete only when the
    // database catalog proves that no FK-dependent row exists.  Otherwise the
    // row is retained, inactive and explicitly retired.
    `ALTER TABLE ${s}.salons ADD COLUMN IF NOT EXISTS provisioning_source text`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_salon_cleanup_reports (
       version integer PRIMARY KEY, candidates integer NOT NULL,
       detached_users integer NOT NULL, deleted_salons integer NOT NULL,
       retired_salons integer NOT NULL, completed_at timestamptz NOT NULL DEFAULT now()
     )`,
    `DO $cleanup$
     DECLARE candidate record; dependency record; has_dependency boolean;
       salon_owner_column text; cleanup_supported boolean;
       candidate_count integer := 0; detached_count integer := 0;
       deleted_count integer := 0; retired_count integer := 0; affected integer;
     BEGIN
       SELECT column_name INTO salon_owner_column FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'salons'
           AND column_name IN ('user_id', 'owner_id')
         ORDER BY CASE column_name WHEN 'user_id' THEN 0 ELSE 1 END LIMIT 1;
       SELECT salon_owner_column IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='active')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='slug')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='short_description')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='description')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='active_salon_id')
         INTO cleanup_supported;
       IF NOT cleanup_supported THEN
         INSERT INTO ${s}.education_salon_cleanup_reports (version,candidates,detached_users,deleted_salons,retired_salons)
         VALUES (99,0,0,0,0) ON CONFLICT (version) DO NOTHING;
         RETURN;
       END IF;
       FOR candidate IN EXECUTE format(
          'SELECT s.id FROM ${s}.salons s JOIN ${s}.users u ON u.id = s.%I
           WHERE u.role::text = ''EDUKATIVNI_CENTAR''
             AND EXISTS (SELECT 1 FROM ${s}.education_centers ec WHERE ec.owner_id = u.id)
             AND s.active = false AND s.slug LIKE ''%%-'' || left(u.id::text, 8)
             AND s.short_description = s.name || '' je novi LUMERA partner.''
             AND s.description = ''Poslovni profil za '' || s.name || ''. Dopunite ponudu, tim i radno vreme iz poslovnog portala.''
             AND s.provisioning_source IS NULL', salon_owner_column)
       LOOP
         candidate_count := candidate_count + 1;
         UPDATE ${s}.users SET active_salon_id = NULL
           WHERE active_salon_id = candidate.id;
         GET DIAGNOSTICS affected = ROW_COUNT;
         detached_count := detached_count + affected;
          -- Never delete a historic tenant row: it may be referenced by
          -- records unknown to this rollout or retained for audit purposes.
          -- The row is merely retired after detaching any active selection.
          UPDATE ${s}.salons SET active = false,
            provisioning_source = 'legacy_education_registration_retired'
            WHERE id = candidate.id;
          retired_count := retired_count + 1;
       END LOOP;
       INSERT INTO ${s}.education_salon_cleanup_reports
         (version, candidates, detached_users, deleted_salons, retired_salons, completed_at)
       VALUES (99, candidate_count, detached_count, deleted_count, retired_count, now())
       ON CONFLICT (version) DO NOTHING;
     END $cleanup$`,
    // v100 — administrator-configured education-center B2B benefit and
    // immutable final-checkout evidence. No business thresholds are seeded.
    `CREATE TABLE IF NOT EXISTS ${s}.education_b2b_discount_settings (
       id boolean PRIMARY KEY DEFAULT true CHECK (id = true), version integer NOT NULL DEFAULT 1,
       updated_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
    `INSERT INTO ${s}.education_b2b_discount_settings (id, version) VALUES (true, 1) ON CONFLICT (id) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_b2b_discount_tiers (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
       min_spend_rsd integer NOT NULL, max_spend_rsd integer, discount_percent integer NOT NULL,
       sort_order integer NOT NULL UNIQUE, version integer NOT NULL DEFAULT 1,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       CHECK (min_spend_rsd >= 0 AND (max_spend_rsd IS NULL OR max_spend_rsd >= min_spend_rsd)),
       CHECK (discount_percent BETWEEN 0 AND 100)
     )`,
    `DO $tiers$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'education_b2b_discount_tiers_no_overlap') THEN
         ALTER TABLE ${s}.education_b2b_discount_tiers
           ADD CONSTRAINT education_b2b_discount_tiers_no_overlap
           EXCLUDE USING gist
           (int8range(min_spend_rsd::bigint,
             CASE WHEN max_spend_rsd IS NULL THEN NULL ELSE max_spend_rsd::bigint + 1 END, '[)') WITH &&);
       END IF;
     END $tiers$`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_b2b_discount_audits (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL,
       actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       tiers_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_b2b_orders (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
       purchaser_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       lines_snapshot jsonb NOT NULL, subtotal_rsd integer NOT NULL,
       discount_rsd integer NOT NULL, total_rsd integer NOT NULL,
       benefit_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
       CHECK (subtotal_rsd >= 0 AND discount_rsd >= 0 AND total_rsd = subtotal_rsd - discount_rsd)
     )`,
    `CREATE INDEX IF NOT EXISTS education_b2b_orders_center_created_idx ON ${s}.education_b2b_orders(center_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_b2b_order_items (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       order_id uuid NOT NULL REFERENCES ${s}.education_b2b_orders(id) ON DELETE RESTRICT,
       product_id uuid NOT NULL REFERENCES ${s}.products(id) ON DELETE RESTRICT,
       quantity integer NOT NULL CHECK (quantity > 0), unit_price_rsd integer NOT NULL CHECK (unit_price_rsd >= 0),
       line_total_rsd integer NOT NULL CHECK (line_total_rsd = quantity * unit_price_rsd)
     )`,
    `CREATE INDEX IF NOT EXISTS education_b2b_order_items_order_idx ON ${s}.education_b2b_order_items(order_id)`,
    // v101 — center-owned operations, inventory, packages and learner contact journal.
    `CREATE TABLE IF NOT EXISTS ${s}.education_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('room','equipment')), name text NOT NULL, capacity integer, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS education_resources_center_kind_idx ON ${s}.education_resources(center_id, kind)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_session_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES ${s}.education_resources(id) ON DELETE RESTRICT, session_id uuid NOT NULL REFERENCES ${s}.course_sessions(id) ON DELETE CASCADE, quantity integer NOT NULL DEFAULT 1 CHECK(quantity > 0), UNIQUE(resource_id, session_id))`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_inventory_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE, product_id uuid REFERENCES ${s}.products(id) ON DELETE RESTRICT, name text NOT NULL, quantity_on_hand integer NOT NULL DEFAULT 0 CHECK(quantity_on_hand >= 0), reorder_level integer NOT NULL DEFAULT 0 CHECK(reorder_level >= 0), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_inventory_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES ${s}.education_inventory_items(id) ON DELETE RESTRICT, center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT, delta integer NOT NULL CHECK(delta <> 0), course_id uuid REFERENCES ${s}.courses(id) ON DELETE SET NULL, session_id uuid REFERENCES ${s}.course_sessions(id) ON DELETE SET NULL, note text NOT NULL, actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS education_inventory_movements_item_created_idx ON ${s}.education_inventory_movements(item_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_bundles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE, title text NOT NULL, description text NOT NULL DEFAULT '', price integer NOT NULL CHECK(price >= 0), active boolean NOT NULL DEFAULT true, published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_bundle_courses (bundle_id uuid NOT NULL REFERENCES ${s}.education_bundles(id) ON DELETE CASCADE, course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE RESTRICT, sort_order integer NOT NULL, PRIMARY KEY(bundle_id, course_id), UNIQUE(bundle_id, sort_order))`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_bundle_purchases (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bundle_id uuid NOT NULL REFERENCES ${s}.education_bundles(id) ON DELETE RESTRICT,
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT, purchaser_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       target_type ${s}.education_bundle_purchase_target NOT NULL, learner_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT, employee_id uuid REFERENCES ${s}.employees(id) ON DELETE RESTRICT,
       amount integer NOT NULL CHECK(amount >= 0), currency text NOT NULL DEFAULT 'RSD',
       status ${s}.education_bundle_purchase_status NOT NULL DEFAULT 'pending_payment', payment_method ${s}.payment_method,
       payment_reference text NOT NULL UNIQUE, payment_instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
       idempotency_key text NOT NULL, idempotency_fingerprint text NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
       settled_at timestamptz, settled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       cancelled_at timestamptz, refunded_at timestamptz, audit_data jsonb NOT NULL DEFAULT '{}'::jsonb,
       updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(purchaser_id,idempotency_key),
       CHECK ((target_type='individual' AND learner_user_id IS NOT NULL AND salon_id IS NULL AND employee_id IS NULL)
         OR (target_type='salon_employee' AND learner_user_id IS NOT NULL AND salon_id IS NOT NULL AND employee_id IS NOT NULL))
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_bundle_purchase_items (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES ${s}.education_bundle_purchases(id) ON DELETE CASCADE,
       course_id uuid NOT NULL REFERENCES ${s}.courses(id) ON DELETE RESTRICT, course_title text NOT NULL,
       course_terms jsonb NOT NULL DEFAULT '{}'::jsonb, sort_order integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE(purchase_id,course_id), UNIQUE(purchase_id,sort_order)
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_bundle_purchase_escrows (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL UNIQUE REFERENCES ${s}.education_bundle_purchases(id) ON DELETE CASCADE,
       center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT, gross_amount integer NOT NULL,
       platform_fee_amount integer NOT NULL DEFAULT 0, reserve_amount integer NOT NULL DEFAULT 0, net_amount integer NOT NULL,
       status ${s}.education_escrow_status NOT NULL DEFAULT 'held', release_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       CHECK (gross_amount >= 0 AND platform_fee_amount >= 0 AND reserve_amount >= 0 AND net_amount >= 0
         AND platform_fee_amount + reserve_amount <= gross_amount AND net_amount = gross_amount - platform_fee_amount - reserve_amount)
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_bundle_purchase_ledger_entries (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escrow_id uuid NOT NULL REFERENCES ${s}.education_bundle_purchase_escrows(id) ON DELETE CASCADE,
       entry_type ${s}.education_ledger_entry_type NOT NULL, amount integer NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_contact_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE, learner_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, enrollment_id uuid REFERENCES ${s}.course_enrollments(id) ON DELETE SET NULL, channel text NOT NULL, note text NOT NULL, actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS education_contact_history_center_learner_idx ON ${s}.education_contact_history(center_id, learner_user_id, created_at)`,
    // v102 — education subscriptions, immutable payment instructions and
    // learner access snapshots. Every change is additive for rolling deploys.
    `ALTER TABLE ${s}.salons ADD COLUMN IF NOT EXISTS payment_reference_number text`,
    `CREATE UNIQUE INDEX IF NOT EXISTS salons_payment_reference_number_unique ON ${s}.salons(payment_reference_number) WHERE payment_reference_number IS NOT NULL`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS payment_reference_number text`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS legal_entity_type text NOT NULL DEFAULT 'legal_entity'`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS bank_account text`,
    `ALTER TABLE ${s}.education_centers ADD COLUMN IF NOT EXISTS bank_account_environment text NOT NULL DEFAULT 'production'`,
    `ALTER TABLE ${s}.education_platform_settings ADD COLUMN IF NOT EXISTS ips_account_environment text NOT NULL DEFAULT 'production'`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='education_centers_bank_account_environment_check' AND conrelid='${s}.education_centers'::regclass) THEN
         ALTER TABLE ${s}.education_centers ADD CONSTRAINT education_centers_bank_account_environment_check CHECK(bank_account_environment IN ('production','test'));
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='education_platform_settings_ips_account_environment_check' AND conrelid='${s}.education_platform_settings'::regclass) THEN
         ALTER TABLE ${s}.education_platform_settings ADD CONSTRAINT education_platform_settings_ips_account_environment_check CHECK(ips_account_environment IN ('production','test'));
       END IF;
     END $$`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_centers_payment_reference_number_unique ON ${s}.education_centers(payment_reference_number) WHERE payment_reference_number IS NOT NULL`,
    // v108 — a business reference is assigned exactly once.  Historical nulls
    // are deterministically backfilled before the trigger makes the invariant
    // permanent; callers may never replace an issued reference.
    `UPDATE ${s}.salons SET payment_reference_number = 'SAL' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL`,
    `UPDATE ${s}.education_centers SET payment_reference_number = 'EDU' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL`,
    `CREATE OR REPLACE FUNCTION ${s}.assign_immutable_business_payment_reference() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' AND NEW.payment_reference_number IS NULL THEN
          NEW.payment_reference_number := CASE WHEN TG_TABLE_NAME = 'salons'
            THEN 'SAL' || replace(NEW.id::text, '-', '')
            ELSE 'EDU' || replace(NEW.id::text, '-', '') END;
        ELSIF TG_OP = 'UPDATE' AND NEW.payment_reference_number IS DISTINCT FROM OLD.payment_reference_number THEN
          RAISE EXCEPTION 'payment_reference_number is immutable';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS salons_immutable_payment_reference ON ${s}.salons`,
    `CREATE TRIGGER salons_immutable_payment_reference BEFORE INSERT OR UPDATE OF payment_reference_number ON ${s}.salons
      FOR EACH ROW EXECUTE FUNCTION ${s}.assign_immutable_business_payment_reference()`,
    `DROP TRIGGER IF EXISTS education_centers_immutable_payment_reference ON ${s}.education_centers`,
    `CREATE TRIGGER education_centers_immutable_payment_reference BEFORE INSERT OR UPDATE OF payment_reference_number ON ${s}.education_centers
      FOR EACH ROW EXECUTE FUNCTION ${s}.assign_immutable_business_payment_reference()`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='education_centers_legal_entity_type_check' AND conrelid='${s}.education_centers'::regclass) THEN
         ALTER TABLE ${s}.education_centers ADD CONSTRAINT education_centers_legal_entity_type_check CHECK(legal_entity_type IN ('individual','legal_entity'));
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='education_centers_bank_account_check' AND conrelid='${s}.education_centers'::regclass) THEN
         ALTER TABLE ${s}.education_centers ADD CONSTRAINT education_centers_bank_account_check CHECK(bank_account IS NULL OR bank_account ~ '^[0-9]{18}$');
       END IF;
     END $$`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS trial_started_at timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS grace_ends_at timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS deactivated_at timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT true`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS contract_kind text NOT NULL DEFAULT 'standard'`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS contract_ends_at timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS course_limit_override integer`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS pending_plan_id uuid REFERENCES ${s}.subscription_plans(id)`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS pending_plan_effective_at timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS grace_extension_note text`,
    `CREATE INDEX IF NOT EXISTS education_center_subscriptions_grace_idx ON ${s}.education_center_subscriptions(status, grace_ends_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_trial_claims (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), normalized_email_hash text NOT NULL,
       normalized_phone_hash text, normalized_pib_hash text,
       user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL,
       center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE SET NULL,
       claimed_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_trial_claims_email_unique ON ${s}.education_trial_claims(normalized_email_hash)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_trial_claims_phone_unique ON ${s}.education_trial_claims(normalized_phone_hash) WHERE normalized_phone_hash IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_trial_claims_pib_unique ON ${s}.education_trial_claims(normalized_pib_hash) WHERE normalized_pib_hash IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_financial_audit_log (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
       old_value jsonb, new_value jsonb, reason text,
       occurred_at timestamptz NOT NULL DEFAULT now(), time_zone text NOT NULL DEFAULT 'Europe/Belgrade' CHECK(time_zone='Europe/Belgrade')
     )`,
    `CREATE INDEX IF NOT EXISTS education_financial_audit_entity_idx ON ${s}.education_financial_audit_log(entity_type, entity_id, occurred_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_payment_obligations (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       center_id uuid REFERENCES ${s}.education_centers(id) ON DELETE RESTRICT,
       salon_id uuid REFERENCES ${s}.salons(id) ON DELETE RESTRICT,
       enrollment_id uuid REFERENCES ${s}.course_enrollments(id) ON DELETE RESTRICT,
       subscription_id uuid REFERENCES ${s}.education_center_subscriptions(id) ON DELETE RESTRICT,
       kind text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
       expected_amount integer NOT NULL CHECK(expected_amount > 0), confirmed_amount integer,
       recipient_name_snapshot text NOT NULL, recipient_account_snapshot text NOT NULL CHECK(recipient_account_snapshot ~ '^[0-9]{18}$'),
       payment_code_snapshot text NOT NULL CHECK(payment_code_snapshot IN ('221','289')),
       purpose_snapshot text NOT NULL, reference_snapshot text NOT NULL UNIQUE, ips_payload_snapshot text,
       issued_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz,
       confirmed_at timestamptz, confirmed_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       cancelled_at timestamptz, cancelled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT,
       CHECK(num_nonnulls(center_id, salon_id) >= 1)
     )`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_center_status_idx ON ${s}.education_payment_obligations(center_id, status, due_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_grace_notes (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES ${s}.education_centers(id) ON DELETE CASCADE,
       author_user_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT, note text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS education_grace_notes_center_created_idx ON ${s}.education_grace_notes(center_id, created_at)`,
    `ALTER TABLE ${s}.education_platform_settings ADD COLUMN IF NOT EXISTS bank_reconciliation_enabled boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS online_access_days integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS extension_price_1_month integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS extension_price_3_months integer`,
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS extension_price_6_months integer`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS access_expires_at timestamptz`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS access_days_snapshot integer`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS course_price_snapshot integer`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS duration_snapshot text`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS extension_prices_snapshot jsonb`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_at timestamptz`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_user_id uuid REFERENCES ${s}.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_text_snapshot text`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_version_snapshot text`,
    // Some pre-business-growth installations have the original enrollment
    // table without payment_status.  It must exist before the entitlement
    // preservation backfill below, rather than relying on the later legacy
    // compatibility pass.
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS access_granted_at timestamptz`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS purchased_at timestamptz`,
    // The oldest supported courses table predates the human-readable duration
    // column. Add it before referencing it in the evidence backfill. IF NOT
    // EXISTS makes replays preserve every value already held by modern rows.
    `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS duration text`,
    // Preserve issuance evidence where it already exists.  Legacy paid online
    // rows gain a snapshot only when absent; existing expiries are never moved
    // backwards and no synthetic consent is manufactured.
    `UPDATE ${s}.course_enrollments enrollment SET
       access_days_snapshot = COALESCE(enrollment.access_days_snapshot, course.online_access_days),
       course_price_snapshot = COALESCE(enrollment.course_price_snapshot, course.price),
       duration_snapshot = COALESCE(enrollment.duration_snapshot, course.duration),
       extension_prices_snapshot = COALESCE(enrollment.extension_prices_snapshot,
         jsonb_build_object('oneMonth', course.extension_price_1_month, 'threeMonths', course.extension_price_3_months, 'sixMonths', course.extension_price_6_months)),
       access_expires_at = CASE WHEN enrollment.access_expires_at IS NULL
         THEN COALESCE(enrollment.access_granted_at, enrollment.purchased_at, now()) + make_interval(days => course.online_access_days)
         ELSE enrollment.access_expires_at END
     FROM ${s}.courses course
     WHERE enrollment.course_id = course.id AND course.format = 'online'
       AND enrollment.status IN ('active','completed') AND enrollment.payment_status = 'paid'
       AND course.online_access_days > 0`,
    `CREATE INDEX IF NOT EXISTS course_enrollments_access_expiry_idx ON ${s}.course_enrollments(user_id, access_expires_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.education_access_extensions (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES ${s}.course_enrollments(id) ON DELETE RESTRICT,
       purchaser_id uuid NOT NULL REFERENCES ${s}.users(id) ON DELETE RESTRICT, months integer NOT NULL CHECK(months IN (1,3,6)),
       amount integer NOT NULL CHECK(amount >= 0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','cancelled')),
       previous_access_expires_at timestamptz NOT NULL, extended_access_expires_at timestamptz NOT NULL,
       payment_obligation_id uuid REFERENCES ${s}.education_payment_obligations(id) ON DELETE RESTRICT,
       created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
     )`,
    `CREATE INDEX IF NOT EXISTS education_access_extensions_enrollment_idx ON ${s}.education_access_extensions(enrollment_id, created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_access_extensions_open_enrollment_unique
       ON ${s}.education_access_extensions(enrollment_id) WHERE status = 'pending'`,
    `ALTER TABLE ${s}.education_b2b_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE ${s}.education_b2b_orders ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'RECEIVED'`,
    `ALTER TABLE ${s}.education_b2b_orders ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
    `ALTER TABLE ${s}.education_b2b_orders ADD COLUMN IF NOT EXISTS refunded_amount_rsd integer NOT NULL DEFAULT 0`,
    `ALTER TABLE ${s}.education_b2b_orders ADD COLUMN IF NOT EXISTS settled_by_user_id uuid REFERENCES ${s}.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ${s}.education_b2b_orders ADD COLUMN IF NOT EXISTS settled_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS education_b2b_orders_qualified_spend_idx ON ${s}.education_b2b_orders(center_id, payment_status, fulfillment_status, completed_at)`,
    // v103 — leading indexes for every Education foreign key. PostgreSQL does
    // not create these automatically, and production never runs drizzle push.
    `CREATE INDEX IF NOT EXISTS course_enrollments_digital_consent_user_idx ON ${s}.course_enrollments(digital_content_consent_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_access_extensions_payment_obligation_idx ON ${s}.education_access_extensions(payment_obligation_id)`,
    `CREATE INDEX IF NOT EXISTS education_access_extensions_purchaser_idx ON ${s}.education_access_extensions(purchaser_id)`,
    `CREATE INDEX IF NOT EXISTS education_b2b_discount_audits_actor_idx ON ${s}.education_b2b_discount_audits(actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_b2b_discount_settings_updated_by_idx ON ${s}.education_b2b_discount_settings(updated_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_b2b_order_items_product_idx ON ${s}.education_b2b_order_items(product_id)`,
    `CREATE INDEX IF NOT EXISTS education_b2b_orders_purchaser_idx ON ${s}.education_b2b_orders(purchaser_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_b2b_orders_settled_by_idx ON ${s}.education_b2b_orders(settled_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_courses_course_idx ON ${s}.education_bundle_courses(course_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchase_escrows_center_status_idx ON ${s}.education_bundle_purchase_escrows(center_id, status)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchase_items_course_idx ON ${s}.education_bundle_purchase_items(course_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchases_bundle_idx ON ${s}.education_bundle_purchases(bundle_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchases_employee_idx ON ${s}.education_bundle_purchases(employee_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchases_learner_idx ON ${s}.education_bundle_purchases(learner_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchases_salon_idx ON ${s}.education_bundle_purchases(salon_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundle_purchases_settled_by_idx ON ${s}.education_bundle_purchases(settled_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_bundles_center_published_idx ON ${s}.education_bundles(center_id, published)`,
    `CREATE INDEX IF NOT EXISTS education_center_subscriptions_pending_plan_idx ON ${s}.education_center_subscriptions(pending_plan_id)`,
    `CREATE INDEX IF NOT EXISTS education_contact_history_actor_idx ON ${s}.education_contact_history(actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_contact_history_enrollment_idx ON ${s}.education_contact_history(enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS education_contact_history_learner_idx ON ${s}.education_contact_history(learner_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_financial_audit_actor_idx ON ${s}.education_financial_audit_log(actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_grace_notes_author_idx ON ${s}.education_grace_notes(author_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_inventory_center_idx ON ${s}.education_inventory_items(center_id)`,
    `CREATE INDEX IF NOT EXISTS education_inventory_product_idx ON ${s}.education_inventory_items(product_id)`,
    `CREATE INDEX IF NOT EXISTS education_inventory_movements_actor_idx ON ${s}.education_inventory_movements(actor_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_inventory_movements_center_idx ON ${s}.education_inventory_movements(center_id)`,
    `CREATE INDEX IF NOT EXISTS education_inventory_movements_course_idx ON ${s}.education_inventory_movements(course_id)`,
    `CREATE INDEX IF NOT EXISTS education_inventory_movements_session_idx ON ${s}.education_inventory_movements(session_id)`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_cancelled_by_idx ON ${s}.education_payment_obligations(cancelled_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_confirmed_by_idx ON ${s}.education_payment_obligations(confirmed_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_enrollment_idx ON ${s}.education_payment_obligations(enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_salon_idx ON ${s}.education_payment_obligations(salon_id)`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_subscription_idx ON ${s}.education_payment_obligations(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS education_session_resources_session_idx ON ${s}.education_session_resources(session_id)`,
    `CREATE INDEX IF NOT EXISTS education_trial_claims_center_idx ON ${s}.education_trial_claims(center_id)`,
    `CREATE INDEX IF NOT EXISTS education_trial_claims_user_idx ON ${s}.education_trial_claims(user_id)`,
    // v104 — canonical Education billing periods and immutable obligation periods.
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS current_period_start timestamptz`,
    `ALTER TABLE ${s}.education_center_subscriptions ADD COLUMN IF NOT EXISTS pending_billing_cycle text`,
    `ALTER TABLE ${s}.education_payment_obligations ADD COLUMN IF NOT EXISTS billing_cycle_snapshot text`,
    `ALTER TABLE ${s}.education_payment_obligations ADD COLUMN IF NOT EXISTS service_period_start timestamptz`,
    `ALTER TABLE ${s}.education_payment_obligations ADD COLUMN IF NOT EXISTS service_period_end timestamptz`,
    // v105 — database-enforced subscription obligation idempotency and cycle validation.
    `DO $$ BEGIN ALTER TABLE ${s}.education_center_subscriptions ADD CONSTRAINT education_center_subscriptions_pending_billing_cycle_check CHECK (pending_billing_cycle IS NULL OR pending_billing_cycle IN ('monthly','yearly')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TABLE ${s}.education_payment_obligations ADD CONSTRAINT education_payment_obligations_cycle_check CHECK (billing_cycle_snapshot IS NULL OR billing_cycle_snapshot IN ('monthly','yearly')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `WITH ranked AS (
       SELECT id, row_number() OVER (PARTITION BY subscription_id, kind ORDER BY issued_at, id) AS position
       FROM ${s}.education_payment_obligations
       WHERE status = 'pending' AND subscription_id IS NOT NULL AND kind IN ('subscription_renewal','subscription_upgrade')
     )
     UPDATE ${s}.education_payment_obligations target
     SET status = 'cancelled', cancelled_at = now()
     FROM ranked WHERE target.id = ranked.id AND ranked.position > 1`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_payment_obligations_pending_subscription_kind_uniq
       ON ${s}.education_payment_obligations(subscription_id, kind)
       WHERE status = 'pending' AND subscription_id IS NOT NULL AND kind IN ('subscription_renewal','subscription_upgrade')`,
    // v106 — renewal and upgrade obligations are mutually exclusive.
    `DROP INDEX IF EXISTS ${s}.education_payment_obligations_pending_subscription_kind_uniq`,
    `WITH ranked AS (
       SELECT id, row_number() OVER (
         PARTITION BY subscription_id
         ORDER BY CASE WHEN kind = 'subscription_upgrade' THEN 0 ELSE 1 END, issued_at DESC, id
       ) AS position
       FROM ${s}.education_payment_obligations
       WHERE status = 'pending' AND subscription_id IS NOT NULL AND kind IN ('subscription_renewal','subscription_upgrade')
     )
     UPDATE ${s}.education_payment_obligations target
     SET status = 'cancelled', cancelled_at = now()
     FROM ranked WHERE target.id = ranked.id AND ranked.position > 1`,
    `CREATE UNIQUE INDEX education_payment_obligations_pending_subscription_kind_uniq
       ON ${s}.education_payment_obligations(subscription_id)
       WHERE status = 'pending' AND subscription_id IS NOT NULL AND kind IN ('subscription_renewal','subscription_upgrade')`,
    // v107 — immutable renewal plan terms and one payable obligation per service period.
    `ALTER TABLE ${s}.education_payment_obligations ADD COLUMN IF NOT EXISTS plan_id_snapshot uuid REFERENCES ${s}.subscription_plans(id) ON DELETE RESTRICT`,
    `CREATE INDEX IF NOT EXISTS education_payment_obligations_plan_snapshot_idx ON ${s}.education_payment_obligations(plan_id_snapshot)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_payment_obligations_renewal_period_uniq
       ON ${s}.education_payment_obligations(subscription_id, service_period_start)
       WHERE kind = 'subscription_renewal' AND status IN ('pending','paid') AND subscription_id IS NOT NULL AND service_period_start IS NOT NULL`,
    // v110 — payment instructions are issuance snapshots. Bundle references are
    // derived from the purchase UUID, globally unique, and immutable thereafter.
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS charged_amount integer`,
    `ALTER TABLE ${s}.course_enrollments ADD COLUMN IF NOT EXISTS payment_instructions_snapshot jsonb`,
    `ALTER TABLE ${s}.education_installments ADD COLUMN IF NOT EXISTS payment_instructions_snapshot jsonb`,
    ...paymentInstructionSnapshotBackfillStatements(s),
    `ALTER TABLE ${s}.education_bundle_purchases ADD COLUMN IF NOT EXISTS payment_reference text`,
    `DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${s}.education_bundle_purchases`,
    `UPDATE ${s}.education_bundle_purchases
       SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),
           payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',
             to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)
       WHERE payment_reference IS NULL`,
    `UPDATE ${s}.education_bundle_purchases
       SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)
       WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference`,
    `ALTER TABLE ${s}.education_bundle_purchases ALTER COLUMN payment_reference SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchases_payment_reference_unique
       ON ${s}.education_bundle_purchases(payment_reference)`,
    `DO $$ BEGIN
       ALTER TABLE ${s}.education_bundle_purchases ADD CONSTRAINT education_bundle_purchases_payment_reference_snapshot_check
         CHECK (payment_instructions->>'reference' IS NOT NULL AND payment_instructions->>'reference' = payment_reference);
       EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${s}.reject_bundle_payment_reference_change() RETURNS trigger AS $$
       BEGIN
         IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
           OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN
           RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';
         END IF;
         RETURN NEW;
       END
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${s}.education_bundle_purchases`,
    `CREATE TRIGGER education_bundle_purchases_payment_reference_immutable
       BEFORE UPDATE OF payment_reference, payment_instructions ON ${s}.education_bundle_purchases
       FOR EACH ROW EXECUTE FUNCTION ${s}.reject_bundle_payment_reference_change()`,
    // v74 — every aftercare FK gets a leading index so deletes/updates on its
    // parent cannot force scans as recommendation and delivery history grows.
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
  // This runner is also used directly by isolated upgrade tests. Keep the
  // serialization boundary here so every caller serializes catalog/trigger
  // mutations before issuing any DDL.
  let locked = false;
  // Blocking is intentional: no process may report readiness until it has
  // acquired the stable cross-version lock and run its own current rollout.
  await client.query(
    "SELECT pg_advisory_lock($1)",
    [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY],
  );
  locked = true;
  try {
    // Constrain unqualified name resolution inside DO blocks to the target schema.
    await client.query(`SET search_path TO ${quoted}`);
    const rolloutTable = `${schemaName}.business_growth_schema_rollout`;
    const existingRollout = await client.query<{ relation: string | null }>(
      "SELECT to_regclass($1)::text AS relation", [rolloutTable],
    );
    if (existingRollout.rows[0]?.relation) {
      const state = await client.query<{ version: number }>(
        `SELECT version FROM ${quoted}.business_growth_schema_rollout WHERE singleton = true`,
      );
      if ((state.rows[0]?.version ?? 0) >= BUSINESS_GROWTH_SCHEMA_VERSION) {
        // Keep additive contract repairs replayable even for installations that
        // recorded the current version before an interrupted/manual rollout.
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_instructors ADD COLUMN IF NOT EXISTS portfolio_media jsonb NOT NULL DEFAULT '[]'::jsonb`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_center_reviews ADD COLUMN IF NOT EXISTS admin_note text`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_center_reviews ADD COLUMN IF NOT EXISTS moderated_at timestamptz`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_gift_vouchers ADD COLUMN IF NOT EXISTS recipient_name_snapshot text`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_gift_vouchers ADD COLUMN IF NOT EXISTS gift_message_snapshot text`);
        await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.prevent_education_gift_voucher_snapshot_update()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id
              OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
              OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot
              OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot
              OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot
              OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot
              OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
              OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4
              OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
              RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';
            END IF;
            RETURN NEW;
          END $$`);
        await client.query(`DROP TRIGGER IF EXISTS education_gift_vouchers_snapshot_immutable ON ${quoted}.education_gift_vouchers`);
        await client.query(`CREATE TRIGGER education_gift_vouchers_snapshot_immutable BEFORE UPDATE ON ${quoted}.education_gift_vouchers
          FOR EACH ROW EXECUTE FUNCTION ${quoted}.prevent_education_gift_voucher_snapshot_update()`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS payment_instructions_snapshot jsonb`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS charged_amount integer`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS duration_snapshot text`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS access_granted_at timestamptz`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS purchased_at timestamptz`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_text_snapshot text`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_version_snapshot text`);
        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_installments ADD COLUMN IF NOT EXISTS payment_instructions_snapshot jsonb`);
        for (const statement of paymentInstructionSnapshotBackfillStatements(quoted)) await client.query(statement);
        if ((await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [`${schemaName}.education_bundle_purchases`])).rows[0]?.exists) {
          await client.query(`ALTER TABLE ${quoted}.education_bundle_purchases ADD COLUMN IF NOT EXISTS payment_reference text`);
          await client.query(`DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${quoted}.education_bundle_purchases`);
          await client.query(`UPDATE ${quoted}.education_bundle_purchases
            SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),
                payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',
                  to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)
            WHERE payment_reference IS NULL`);
          await client.query(`UPDATE ${quoted}.education_bundle_purchases
            SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)
            WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference`);
          await client.query(`ALTER TABLE ${quoted}.education_bundle_purchases ALTER COLUMN payment_reference SET NOT NULL`);
          await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchases_payment_reference_unique
            ON ${quoted}.education_bundle_purchases(payment_reference)`);
          await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.reject_bundle_payment_reference_change() RETURNS trigger AS $$
            BEGIN
              IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
                OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN
                RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';
              END IF;
              RETURN NEW;
            END
          $$ LANGUAGE plpgsql`);
          await client.query(`CREATE TRIGGER education_bundle_purchases_payment_reference_immutable
            BEFORE UPDATE OF payment_reference, payment_instructions ON ${quoted}.education_bundle_purchases
            FOR EACH ROW EXECUTE FUNCTION ${quoted}.reject_bundle_payment_reference_change()`);
        }
        return;
      }
    }
    const statements: string[] = [];
    for (const [typeName, labels] of Object.entries(ENUM_LABELS)) {
      statements.push(...enumBootstrapStatements(quoted, typeName, labels));
    }
    statements.push(...tableStatements(quoted));

    // Most rollout statements intentionally autocommit (ALTER TYPE ADD VALUE
    // cannot be followed by use of the value in the same transaction).
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS ${quoted}.business_growth_schema_rollout (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
      version integer NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query(
      `INSERT INTO ${quoted}.business_growth_schema_rollout (singleton, version, completed_at)
       VALUES (true, $1, now())
       ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, completed_at = EXCLUDED.completed_at`,
      [BUSINESS_GROWTH_SCHEMA_VERSION],
    );
  } finally {
    // Custom GUCs are session scoped. Always close the narrowly-scoped
    // migration bypass before this client can return to the pool.
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`SELECT set_config('lumera.snapshot_backfill', 'off', false)`);
    if (locked) await client.query(
      "SELECT pg_advisory_unlock($1)",
      [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY],
    ).catch(() => {});
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
  const previousSearchPath = await currentSearchPath(client);
  try {
    await runBusinessGrowthSchemaDdl(client, schemaName);
    const cleanup = await client.query<{
      candidates: number; detached_users: number; deleted_salons: number; retired_salons: number;
    }>(`SELECT candidates, detached_users, deleted_salons, retired_salons
         FROM ${quoteSchema(schemaName)}.education_salon_cleanup_reports WHERE version = 99`);
    if (cleanup.rows[0]) {
      logger.info(
        { version: 99, ...cleanup.rows[0] },
        "Education registration salon cleanup report",
      );
    }
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
    client.release();
  }
}

async function currentSearchPath(client: PoolClient): Promise<string> {
  const result = await client.query<{ search_path: string }>("SHOW search_path");
  const value = result.rows[0]?.search_path;
  return value && value.trim().length ? value : '"$user", public';
}
