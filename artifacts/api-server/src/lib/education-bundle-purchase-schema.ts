import { pool } from "@workspace/db";

/** Additive, replay-safe production rollout for parent-only bundle finance. */
export async function ensureEducationBundlePurchaseSchema(schemaName = "public"): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) throw new Error("Invalid schema name.");
  const schema = `"${schemaName}"`, client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [0x4542554e]);
    await client.query(`DO $$ BEGIN CREATE TYPE ${schema}.education_bundle_purchase_status AS ENUM ('pending_payment','settled','cancelled','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query(`DO $$ BEGIN CREATE TYPE ${schema}.education_bundle_purchase_target AS ENUM ('individual','salon_employee'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.education_bundle_purchases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bundle_id uuid NOT NULL REFERENCES ${schema}.education_bundles(id) ON DELETE RESTRICT,
      center_id uuid NOT NULL REFERENCES ${schema}.education_centers(id) ON DELETE RESTRICT, purchaser_id uuid NOT NULL REFERENCES ${schema}.users(id) ON DELETE RESTRICT,
      target_type ${schema}.education_bundle_purchase_target NOT NULL, learner_user_id uuid REFERENCES ${schema}.users(id) ON DELETE RESTRICT,
      salon_id uuid REFERENCES ${schema}.salons(id) ON DELETE RESTRICT, employee_id uuid REFERENCES ${schema}.employees(id) ON DELETE RESTRICT,
      amount integer NOT NULL CHECK(amount >= 0), currency text NOT NULL DEFAULT 'RSD', status ${schema}.education_bundle_purchase_status NOT NULL DEFAULT 'pending_payment',
       payment_method payment_method, payment_reference text NOT NULL UNIQUE, payment_instructions jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key text NOT NULL, idempotency_fingerprint text NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz, settled_by_user_id uuid REFERENCES ${schema}.users(id) ON DELETE SET NULL,
      cancelled_at timestamptz, refunded_at timestamptz, audit_data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((target_type='individual' AND learner_user_id IS NOT NULL AND salon_id IS NULL AND employee_id IS NULL) OR (target_type='salon_employee' AND learner_user_id IS NOT NULL AND salon_id IS NOT NULL AND employee_id IS NOT NULL)),
      UNIQUE(purchaser_id,idempotency_key))`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchases ADD COLUMN IF NOT EXISTS payment_reference text`);
    await client.query(`DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${schema}.education_bundle_purchases`);
    await client.query(`UPDATE ${schema}.education_bundle_purchases
      SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),
          payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',
            to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)
      WHERE payment_reference IS NULL`);
    await client.query(`UPDATE ${schema}.education_bundle_purchases
      SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)
      WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchases ALTER COLUMN payment_reference SET NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchases_payment_reference_unique ON ${schema}.education_bundle_purchases(payment_reference)`);
    await client.query(`DO $$ BEGIN
      ALTER TABLE ${schema}.education_bundle_purchases ADD CONSTRAINT education_bundle_purchases_payment_reference_snapshot_check
        CHECK (payment_instructions->>'reference' IS NOT NULL AND payment_instructions->>'reference' = payment_reference);
      EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
    await client.query(`CREATE OR REPLACE FUNCTION ${schema}.reject_bundle_payment_reference_change() RETURNS trigger AS $$
      BEGIN
        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN
          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';
        END IF;
        RETURN NEW;
      END
    $$ LANGUAGE plpgsql`);
    await client.query(`DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${schema}.education_bundle_purchases`);
    await client.query(`CREATE TRIGGER education_bundle_purchases_payment_reference_immutable
      BEFORE UPDATE OF payment_reference, payment_instructions ON ${schema}.education_bundle_purchases
      FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_bundle_payment_reference_change()`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchases DROP CONSTRAINT IF EXISTS education_bundle_purchases_check`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchases DROP CONSTRAINT IF EXISTS education_bundle_purchases_target_check`);
    await client.query(`UPDATE ${schema}.education_bundle_purchases purchase
      SET learner_user_id = employee.user_id
      FROM ${schema}.employees employee
      WHERE purchase.target_type = 'salon_employee' AND purchase.employee_id = employee.id
        AND purchase.learner_user_id IS NULL AND employee.user_id IS NOT NULL`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchases ADD CONSTRAINT education_bundle_purchases_target_check
      CHECK ((target_type='individual' AND learner_user_id IS NOT NULL AND salon_id IS NULL AND employee_id IS NULL)
        OR (target_type='salon_employee' AND learner_user_id IS NOT NULL AND salon_id IS NOT NULL AND employee_id IS NOT NULL)) NOT VALID`);
    await client.query(`ALTER TABLE ${schema}.course_enrollments ADD COLUMN IF NOT EXISTS bundle_purchase_id uuid REFERENCES ${schema}.education_bundle_purchases(id) ON DELETE RESTRICT`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.education_bundle_purchase_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES ${schema}.education_bundle_purchases(id) ON DELETE CASCADE,
      course_id uuid NOT NULL REFERENCES ${schema}.courses(id) ON DELETE RESTRICT, course_title text NOT NULL, course_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
      sort_order integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(purchase_id,course_id), UNIQUE(purchase_id,sort_order))`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.education_bundle_purchase_escrows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL UNIQUE REFERENCES ${schema}.education_bundle_purchases(id) ON DELETE CASCADE,
      center_id uuid NOT NULL REFERENCES ${schema}.education_centers(id) ON DELETE RESTRICT, gross_amount integer NOT NULL, platform_fee_amount integer NOT NULL DEFAULT 0,
      reserve_amount integer NOT NULL DEFAULT 0, net_amount integer NOT NULL, status education_escrow_status NOT NULL DEFAULT 'held', release_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT education_bundle_purchase_escrows_amounts_check CHECK (gross_amount >= 0 AND platform_fee_amount >= 0 AND reserve_amount >= 0 AND net_amount >= 0 AND platform_fee_amount + reserve_amount <= gross_amount AND net_amount = gross_amount - platform_fee_amount - reserve_amount))`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchase_escrows DROP CONSTRAINT IF EXISTS education_bundle_purchase_escrows_amounts_check`);
    await client.query(`ALTER TABLE ${schema}.education_bundle_purchase_escrows ADD CONSTRAINT education_bundle_purchase_escrows_amounts_check CHECK (gross_amount >= 0 AND platform_fee_amount >= 0 AND reserve_amount >= 0 AND net_amount >= 0 AND platform_fee_amount + reserve_amount <= gross_amount AND net_amount = gross_amount - platform_fee_amount - reserve_amount)`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.education_bundle_purchase_ledger_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escrow_id uuid NOT NULL REFERENCES ${schema}.education_bundle_purchase_escrows(id) ON DELETE CASCADE,
      entry_type education_ledger_entry_type NOT NULL, amount integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb)`);
    await client.query(`CREATE INDEX IF NOT EXISTS education_bundle_purchases_center_status_idx ON ${schema}.education_bundle_purchases(center_id,status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS course_enrollments_bundle_purchase_idx ON ${schema}.course_enrollments(bundle_purchase_id)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchase_ledger_charge_unique ON ${schema}.education_bundle_purchase_ledger_entries(escrow_id) WHERE entry_type='charge'`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchase_ledger_fee_unique ON ${schema}.education_bundle_purchase_ledger_entries(escrow_id) WHERE entry_type='platform_fee'`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchase_ledger_reserve_unique ON ${schema}.education_bundle_purchase_ledger_entries(escrow_id) WHERE entry_type='reserve_hold'`);
  } finally { try { await client.query("SELECT pg_advisory_unlock($1)", [0x4542554e]); } finally { client.release(); } }
}