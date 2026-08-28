/**
 * Business Growth production schema rollout — legacy-upgrade proof.
 *
 * Verifies ensureBusinessGrowthSchema()'s DDL against an ISOLATED temporary
 * schema seeded to look like a previously-populated legacy production database:
 *   - minimal legacy base tables (salons/users/employees/services/appointments/
 *     salon_customers/reviews/sms_deliveries),
 *   - an OLD `sms_delivery_status` enum that LACKS `processing`,
 *   - populated legacy rows in salon_customers / reviews / sms_deliveries.
 *
 * It then runs the bootstrap TWICE and asserts: rows preserved; the enum now
 * accepts `processing`; every growth table exists; key new columns/indexes/FKs/
 * unique constraints exist; representative growth inserts succeed; and the
 * second run is a no-op (idempotent). The temp schema is dropped in `finally`;
 * public tables are never touched.
 */
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import {
  BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY,
  BUSINESS_GROWTH_SCHEMA_VERSION,
  runBusinessGrowthSchemaDdl,
} from "./business-growth-schema";

const TEST_SCHEMA = `bg_upgrade_test_${Date.now()}`;

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return pool.query<T>(sql, params);
}

async function objectExists(sql: string, params: unknown[]): Promise<boolean> {
  const res = await q<{ exists: boolean }>(sql, params);
  return Boolean(res.rows[0]?.exists);
}

async function seedLegacySchema(schema: string) {
  await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await q(`CREATE SCHEMA "${schema}"`);
  await q(`SET search_path TO "${schema}"`);

  // Minimal legacy base tables — only the columns the growth FKs/inserts need.
  // v29 upgrades the pre-existing core role enum rather than recreating users.
  // Keep this deliberately old: it has CUSTOMER but not JOBSEEKER.
  await q(`CREATE TYPE "${schema}".user_role AS ENUM ('CUSTOMER', 'SALON_OWNER', 'EDUCATION_CENTER_OWNER')`);
  await q(`CREATE TABLE "${schema}".users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    role "${schema}".user_role NOT NULL DEFAULT 'CUSTOMER'
  )`);
  await q(`CREATE TABLE "${schema}".education_centers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES "${schema}".users(id),
    name text NOT NULL,
    city text NOT NULL,
    description text NOT NULL,
    image_url text NOT NULL,
    verification_status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE "${schema}".course_enrollments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES "${schema}".users(id) ON DELETE CASCADE,
    purchaser_id uuid NOT NULL REFERENCES "${schema}".users(id) ON DELETE CASCADE
  )`);
  await q(`CREATE TABLE "${schema}".salons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
  )`);
  await q(`CREATE TABLE "${schema}".employees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    name text NOT NULL
  )`);
  await q(`CREATE TABLE "${schema}".employee_time_off (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES "${schema}".employees(id) ON DELETE CASCADE,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text NOT NULL
  )`);
  await q(`CREATE TABLE "${schema}".services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    name text NOT NULL
  )`);
  // Legacy catalog tables before supplier ownership and customer-safe public
  // storefront fields. The upgrade must replace global category uniqueness
  // without losing the existing hierarchy.
  await q(`CREATE TABLE "${schema}".product_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    slug text NOT NULL UNIQUE,
    parent_id uuid REFERENCES "${schema}".product_categories(id),
    sort_order integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE "${schema}".products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid REFERENCES "${schema}".product_categories(id),
    name text NOT NULL,
    description text NOT NULL,
    sku text,
    stock integer NOT NULL DEFAULT 0,
    variants jsonb,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  // App Storage metadata is an existing platform dependency, not part of the
  // Business Growth rollout. The legacy fixture needs only its referenced key.
  await q(`CREATE TABLE "${schema}".media_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  )`);
  // Legacy retail carts used a unique index that treated NULL variant values as
  // distinct, so the same un-varianted product could be stored twice.
  await q(`CREATE TABLE "${schema}".retail_carts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    user_id uuid REFERENCES "${schema}".users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE "${schema}".retail_cart_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id uuid NOT NULL REFERENCES "${schema}".retail_carts(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES "${schema}".products(id) ON DELETE CASCADE,
    variant_value text,
    product_name text NOT NULL,
    product_image_url text NOT NULL,
    unit_price integer NOT NULL,
    quantity integer NOT NULL,
    weight_grams integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE UNIQUE INDEX retail_cart_items_cart_product_variant_unique
    ON "${schema}".retail_cart_items (cart_id, product_id, variant_value)`);
  // Legacy B2B cart tables predate bundle targets. The v42 rollout must
  // upgrade these rows in place without assuming a freshly created schema.
  await q(`CREATE TABLE "${schema}".shopping_carts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE "${schema}".shopping_cart_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id uuid NOT NULL REFERENCES "${schema}".shopping_carts(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES "${schema}".products(id) ON DELETE CASCADE,
    variant_value text,
    quantity integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  // Existing core commerce dependency used by phase-3 inventory movements.
  await q(`CREATE TABLE "${schema}".orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  )`);
  await q(`CREATE TABLE "${schema}".order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES "${schema}".orders(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES "${schema}".products(id),
    product_name text NOT NULL,
    product_sku text,
    price integer NOT NULL,
    quantity integer NOT NULL
  )`);
  await q(`CREATE TABLE "${schema}".salon_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    display_name text NOT NULL
  )`);
  await q(`CREATE TABLE "${schema}".appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    salon_customer_id uuid,
    appointment_date date,
    status text
  )`);
  await q(`CREATE TABLE "${schema}".reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES "${schema}".users(id),
    service_name text NOT NULL,
    rating integer NOT NULL,
    text text NOT NULL,
    visible boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  // OLD sms_delivery_status enum WITHOUT `processing` (legacy version).
  await q(`CREATE TYPE "${schema}".sms_delivery_status AS ENUM ('queued', 'sent', 'failed', 'skipped')`);
  // OLD sms_message_type enum WITHOUT `automation` (legacy version) — a real
  // schema-qualified enum, not text, so the bootstrap must ADD VALUE it.
  await q(`CREATE TYPE "${schema}".sms_message_type AS ENUM (
    'appointment_confirmation', 'appointment_reminder', 'education_session_reminder',
    'education_waitlist_offer', 'education_session_cancelled'
  )`);
  await q(`CREATE TABLE "${schema}".sms_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key text NOT NULL UNIQUE,
    salon_id uuid REFERENCES "${schema}".salons(id) ON DELETE SET NULL,
    message_type "${schema}".sms_message_type NOT NULL,
    recipient_phone text NOT NULL,
    body text NOT NULL,
    status "${schema}".sms_delivery_status NOT NULL DEFAULT 'queued',
    provider_message_id text,
    error_message text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  // Legacy email_deliveries WITHOUT the v8 delivery-report alert history
  // partial index — the bootstrap must create it on the existing table.
  await q(`CREATE TABLE "${schema}".email_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key text NOT NULL UNIQUE,
    email_type text NOT NULL,
    salon_id uuid REFERENCES "${schema}".salons(id) ON DELETE SET NULL,
    recipient_email text NOT NULL,
    subject text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  // OLD platform_retention_settings WITHOUT the v6 change-provenance columns
  // (change_source / restored_from_version) — the ALTER path must add them
  // and backfill existing audit rows as 'manual'.
  await q(`CREATE TABLE "${schema}".platform_retention_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version integer NOT NULL,
    new_customer_window_days integer NOT NULL,
    default_interval_days integer NOT NULL,
    at_risk_interval_percent integer NOT NULL,
    lost_interval_percent integer NOT NULL,
    lost_minimum_days integer NOT NULL,
    vip_min_completed_visits integer NOT NULL,
    vip_spend_percent_of_median integer NOT NULL,
    changed_by_user_id uuid REFERENCES "${schema}".users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  // Populate legacy rows that MUST survive the upgrade.
  const salon = (await q<{ id: string }>(`INSERT INTO "${schema}".salons (name) VALUES ('Legacy Salon') RETURNING id`)).rows[0]!;
  const user = (await q<{ id: string }>(`INSERT INTO "${schema}".users (email) VALUES ('legacy@bg.test') RETURNING id`)).rows[0]!;
  const enrollmentLearner = (await q<{ id: string }>(
    `INSERT INTO "${schema}".users (email) VALUES ('legacy-learner@bg.test') RETURNING id`,
  )).rows[0]!;
  const enrollmentPurchaser = (await q<{ id: string }>(
    `INSERT INTO "${schema}".users (email, role) VALUES ('legacy-purchaser@bg.test', 'SALON_OWNER') RETURNING id`,
  )).rows[0]!;
  const legacyEducationOwner = (await q<{ id: string }>(
    `INSERT INTO "${schema}".users (email, role) VALUES ('legacy-education@bg.test', 'EDUCATION_CENTER_OWNER') RETURNING id`,
  )).rows[0]!;
  const legacyEducationCenter = (await q<{ id: string }>(
    `INSERT INTO "${schema}".education_centers
       (owner_id, name, city, description, image_url)
     VALUES ($1, 'Legacy Education Center', 'Beograd', 'Legacy center', '/legacy-center.jpg')
     RETURNING id`,
    [legacyEducationOwner.id],
  )).rows[0]!;
  const enrollment = (await q<{ id: string }>(
    `INSERT INTO "${schema}".course_enrollments (user_id, purchaser_id) VALUES ($1, $2) RETURNING id`,
    [enrollmentLearner.id, enrollmentPurchaser.id],
  )).rows[0]!;
  const employee = (await q<{ id: string }>(`INSERT INTO "${schema}".employees (salon_id, name) VALUES ($1, 'Emp') RETURNING id`, [salon.id])).rows[0]!;
  const service = (await q<{ id: string }>(`INSERT INTO "${schema}".services (salon_id, name) VALUES ($1, 'Svc') RETURNING id`, [salon.id])).rows[0]!;
  const customer = (await q<{ id: string }>(`INSERT INTO "${schema}".salon_customers (salon_id, display_name) VALUES ($1, 'Cust') RETURNING id`, [salon.id])).rows[0]!;
  const appointment = (await q<{ id: string }>(`INSERT INTO "${schema}".appointments (salon_id) VALUES ($1) RETURNING id`, [salon.id])).rows[0]!;
  const retailCategory = (await q<{ id: string }>(
    `INSERT INTO "${schema}".product_categories (name, slug)
     VALUES ('Legacy retail category', 'legacy-retail-category') RETURNING id`,
  )).rows[0]!;
  const retailProduct = (await q<{ id: string }>(
    `INSERT INTO "${schema}".products (category_id, name, description)
     VALUES ($1, 'Legacy retail product', 'Legacy retail description') RETURNING id`,
    [retailCategory.id],
  )).rows[0]!;
  const retailCart = (await q<{ id: string }>(
    `INSERT INTO "${schema}".retail_carts (token_hash) VALUES ('legacy-retail-cart') RETURNING id`,
  )).rows[0]!;
  await q(
    `INSERT INTO "${schema}".retail_cart_items
       (cart_id, product_id, product_name, product_image_url, unit_price, quantity)
     VALUES
       ($1, $2, 'Legacy retail product', '/legacy-retail.jpg', 1000, 2),
       ($1, $2, 'Legacy retail product', '/legacy-retail.jpg', 1000, 3)`,
    [retailCart.id, retailProduct.id],
  );
  await q(`INSERT INTO "${schema}".reviews (salon_id, customer_id, service_name, rating, text) VALUES ($1, $2, 'Svc', 5, 'Great')`, [salon.id, user.id]);
  // Legacy row uses an OLD message_type label (automation did not exist yet).
  await q(`INSERT INTO "${schema}".sms_deliveries (event_key, salon_id, message_type, recipient_phone, body, status) VALUES ('legacy-sms-1', $1, 'appointment_confirmation', '+381600000000', 'Zdravo', 'sent')`, [salon.id]);
  // Legacy alert-history row that the v8 partial index must cover in place.
  await q(
    `INSERT INTO "${schema}".email_deliveries (event_key, email_type, recipient_email, subject, metadata)
     VALUES ('legacy-silence-alert-1', 'delivery_report_silence_alert', 'legacy@bg.test', 'Alert',
             '{"provider":"brevo","alertAt":"2026-01-01T00:00:00.000Z","sequence":1}'::jsonb)`,
  );
  // Legacy audited settings version predating change-provenance columns.
  await q(
    `INSERT INTO "${schema}".platform_retention_settings
       (version, new_customer_window_days, default_interval_days, at_risk_interval_percent,
        lost_interval_percent, lost_minimum_days, vip_min_completed_visits, vip_spend_percent_of_median,
        changed_by_user_id)
     VALUES (900, 45, 45, 150, 250, 180, 5, 200, $1)`,
    [user.id],
  );

  return {
    salon, user, enrollmentLearner, enrollmentPurchaser, enrollment, legacyEducationOwner, legacyEducationCenter,
    employee, service, customer, appointment, retailCart, retailProduct,
  };
}

async function run() {
  const s = TEST_SCHEMA;
  try {
    assert.equal(BUSINESS_GROWTH_SCHEMA_VERSION, 72, "v72 is the current production schema rollout");
    const fixtures = await seedLegacySchema(s);

    // ── Run the rollout, then exercise its legacy conversion on rerun ──────
    const client = await pool.connect();
    try {
      await runBusinessGrowthSchemaDdl(client, s);
      // Reproduce a partially-completed v65 upgrade: the commercial immutable
      // trigger already exists, while a historical line still needs its new
      // realized-revenue snapshot backfilled.  This used to fail on replay
      // because the trigger rejected the migration's own UPDATE.
      const productSnapshot = (await q<{
        supplier_id: string; supplier_name: string; supplier_slug: string;
        catalog_reference: string; sku: string | null;
      }>(`SELECT p.supplier_id, sup.name supplier_name, sup.slug supplier_slug,
           p.catalog_reference, p.sku
          FROM "${s}".products p JOIN "${s}".suppliers sup ON sup.id = p.supplier_id
          WHERE p.id = $1`, [fixtures.retailProduct.id])).rows[0]!;
      const replayOrder = (await q<{ id: string }>(
        `INSERT INTO "${s}".retail_orders
           (order_number, cart_id, tracking_token_hash, idempotency_key, payment_method,
            subtotal, shipping_cost, total, shipping_name, shipping_address, shipping_city,
            shipping_postal_code, shipping_phone, shipping_email)
         VALUES ('TRIGGER-REPLAY-1', $1, 'trigger-replay-token', 'trigger-replay-key',
           'BANK_TRANSFER', 1000, 0, 1000, 'Legacy', 'Ulica 1', 'Beograd', '11000',
           '+381600000000', 'legacy@bg.test') RETURNING id`,
        [fixtures.retailCart.id],
      )).rows[0]!;
      await q(
        `INSERT INTO "${s}".retail_order_items
           (order_id, product_id, product_name, product_image_url, product_catalog_reference,
            product_sku_snapshot, supplier_id, supplier_name, supplier_slug, market, currency,
            unit_price, quantity, line_subtotal, line_total, base_unit_price, effective_unit_price,
            price_source, line_discount, realized_revenue_rsd)
         VALUES ($1, $2, 'Trigger replay product', '/legacy-retail.jpg', $3, $4, $5, $6, $7,
           'B2C', 'RSD', 1000, 1, 1000, 1000, 1000, 1000, 'FULL_PRICE', 0, 0)`,
        [replayOrder.id, fixtures.retailProduct.id, productSnapshot.catalog_reference,
          productSnapshot.sku, productSnapshot.supplier_id, productSnapshot.supplier_name, productSnapshot.supplier_slug],
      );
      // Model an old checkout worker writing an incomplete pre-constraint line
      // while a later bootstrap is about to replay.  The replay must repair it
      // even though the immutable trigger is already present; before the
      // transactional table lock/gated backfill this shape made validation fail.
      await q(`ALTER TABLE "${s}".retail_order_items ALTER COLUMN supplier_id DROP NOT NULL`);
      await q(`ALTER TABLE "${s}".retail_order_items ALTER COLUMN supplier_name DROP NOT NULL`);
      await q(`ALTER TABLE "${s}".retail_order_items ALTER COLUMN supplier_slug DROP NOT NULL`);
      const incompleteOrder = (await q<{ id: string }>(
        `INSERT INTO "${s}".retail_orders
           (order_number, cart_id, tracking_token_hash, idempotency_key, payment_method,
            subtotal, shipping_cost, total, shipping_name, shipping_address, shipping_city,
            shipping_postal_code, shipping_phone, shipping_email)
         VALUES ('TRIGGER-RACE-1', $1, 'trigger-race-token', 'trigger-race-key',
           'BANK_TRANSFER', 1000, 0, 1000, 'Legacy', 'Ulica 1', 'Beograd', '11000',
           '+381600000001', 'legacy@bg.test') RETURNING id`,
        [fixtures.retailCart.id],
      )).rows[0]!;
      await q(
        `INSERT INTO "${s}".retail_order_items
           (order_id, product_id, product_name, product_image_url, product_catalog_reference,
            unit_price, quantity, line_subtotal, line_total, base_unit_price,
            effective_unit_price, price_source, line_discount)
         VALUES ($1, $2, 'Concurrent legacy line', '/legacy-retail.jpg', $3,
           1000, 1, 1000, 1000, 1000, 1000, 'FULL_PRICE', 0)`,
        [incompleteOrder.id, fixtures.retailProduct.id, productSnapshot.catalog_reference],
      );
      await q(`UPDATE "${s}".business_growth_schema_rollout SET version = 65 WHERE singleton = true`);
      // A legacy individual listing is exactly the historical data that v29
      // converts.  Its FK remains intact when the account role changes.
      const category = (await q<{ id: string }>(
        `SELECT id FROM "${s}".beauty_job_categories WHERE slug = 'frizeri'`,
      )).rows[0]!;
      await q(
        `INSERT INTO "${s}".beauty_job_listings
           (category_id, user_id, posted_by_type, type, title, description, city, region, expires_at)
         VALUES ($1, $2, 'user', 'job', 'Legacy individual listing', 'Legacy conversion fixture', 'Beograd', 'Vračar', now() + interval '1 day')`,
        [category.id, fixtures.user.id],
      );
      await runBusinessGrowthSchemaDdl(client, s); // second run must be a no-op
      const replaySnapshot = (await q<{ realized_revenue_rsd: number }>(
        `SELECT realized_revenue_rsd FROM "${s}".retail_order_items WHERE order_id = $1`,
        [replayOrder.id],
      )).rows[0]!;
      assert.equal(replaySnapshot.realized_revenue_rsd, 1000,
        "trigger-present replay backfills realized revenue before restoring strict immutability");
      const repairedConcurrentLine = (await q<{ supplier_id: string; supplier_name: string; supplier_slug: string }>(
        `SELECT supplier_id, supplier_name, supplier_slug FROM "${s}".retail_order_items WHERE order_id = $1`,
        [incompleteOrder.id],
      )).rows[0]!;
      assert.equal(repairedConcurrentLine.supplier_id, productSnapshot.supplier_id);
      assert.equal(repairedConcurrentLine.supplier_name, productSnapshot.supplier_name);
      assert.equal(repairedConcurrentLine.supplier_slug, productSnapshot.supplier_slug);
      await assert.rejects(
        q(`UPDATE "${s}".retail_order_items SET realized_revenue_rsd = 1 WHERE order_id = $1`, [replayOrder.id]),
        /immutable/,
        "strict commercial snapshot immutability is restored after the replay backfill",
      );
      // Reproduce a completed v71 deployment with the historical shared
      // function rebound to B2B order_items. The old body names retail-only
      // aftercare columns that do not physically exist on order_items.
      await q(`UPDATE "${s}".business_growth_schema_rollout SET version = 71 WHERE singleton = true`);
      await q(`CREATE OR REPLACE FUNCTION "${s}".prevent_order_item_commercial_snapshot_update()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.unit_price IS DISTINCT FROM OLD.unit_price
            OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd THEN
            RAISE EXCEPTION 'Order item commercial snapshot is immutable';
          END IF;
          RETURN NEW;
        END $$`);
      await q(`DROP TRIGGER IF EXISTS order_items_commercial_snapshot_immutable ON "${s}".order_items`);
      await q(`CREATE TRIGGER order_items_commercial_snapshot_immutable BEFORE UPDATE ON "${s}".order_items
        FOR EACH ROW EXECUTE FUNCTION "${s}".prevent_order_item_commercial_snapshot_update()`);
      await q(`DROP TRIGGER IF EXISTS retail_order_items_commercial_snapshot_immutable ON "${s}".retail_order_items`);
      await q(`CREATE TRIGGER retail_order_items_commercial_snapshot_immutable BEFORE UPDATE ON "${s}".retail_order_items
        FOR EACH ROW EXECUTE FUNCTION "${s}".prevent_order_item_commercial_snapshot_update()`);
      const v71SharedBinding = (await q<{ proname: string; prosrc: string }>(
        `SELECT p.proname, p.prosrc
         FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
         WHERE t.tgrelid=$1::regclass AND t.tgname='order_items_commercial_snapshot_immutable'`,
        [`${s}.order_items`],
      )).rows[0]!;
      assert.equal(v71SharedBinding.proname, "prevent_order_item_commercial_snapshot_update");
      assert.match(v71SharedBinding.prosrc, /personalized_treatment_bundle_discount_rsd/i,
        "legacy v71 fixture retains the old shared function with a retail-only field");
      await runBusinessGrowthSchemaDdl(client, s); // v71 → v72 repair
      await runBusinessGrowthSchemaDdl(client, s); // v72 replay is idempotent
      // Direct callers must serialize too (not only ensureBusinessGrowthSchema).
      // Two independently held pool connections concurrently rebuilding trigger
      // and system-catalog objects used to intermittently fail with XX000
      // "tuple concurrently updated".
      const [concurrentA, concurrentB] = await Promise.all([pool.connect(), pool.connect()]);
      try {
        // Simulate an older-version process: it owns the same stable lock even
        // though its schema version constant would differ. The current runner
        // must block and may not return/skip before that owner completes.
        await concurrentA.query("SELECT pg_advisory_lock($1)", [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY]);
        let currentReturned = false;
        const currentRun = runBusinessGrowthSchemaDdl(concurrentB, s)
          .then(() => { currentReturned = true; });
        await new Promise((resolve) => setTimeout(resolve, 75));
        assert.equal(currentReturned, false,
          "current-version rollout waits for the stable lock held by an older-version owner");
        await concurrentA.query("SELECT pg_advisory_unlock($1)", [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY]);
        await currentRun;
        assert.equal(currentReturned, true, "waiting rollout runs and verifies readiness after lock acquisition");
      } finally {
        concurrentA.release();
        concurrentB.release();
      }
    } finally {
      await client.query(`SET search_path TO "$user", public`).catch(() => {});
      client.release();
    }

    // Reset connection search_path for our raw assertions (pool client rotates).
    await q(`SET search_path TO "${s}"`);

    // ── v29 JOBSEEKER account boundary ────────────────────────────────────
    const roleLabels = (await q<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'user_role' AND n.nspname = $1`,
      [s],
    )).rows.map((row) => row.enumlabel);
    assert.ok(roleLabels.includes("JOBSEEKER"), "legacy user_role enum gains JOBSEEKER");
    assert.ok(roleLabels.includes("EDUKATIVNI_CENTAR"), "legacy education role is renamed");
    assert.ok(!roleLabels.includes("EDUCATION_CENTER_OWNER"), "obsolete education role label is removed");
    const migratedEducationOwner = (await q<{ role: string }>(
      `SELECT role FROM "${s}".users WHERE id = $1`, [fixtures.legacyEducationOwner.id],
    )).rows[0]!;
    assert.equal(migratedEducationOwner.role, "EDUKATIVNI_CENTAR", "legacy education owner row is preserved and migrated");
    assert.ok(await columnExists("users", "date_of_birth"), "users.date_of_birth added");
    for (const column of [
      "pib",
      "commission_percent_override",
      "reserve_percent_override",
      "online_refund_days_override",
      "live_appeal_days_override",
      "featured_course_price_override",
    ]) {
      assert.ok(await columnExists("education_centers", column), `education_centers.${column} added`);
    }
    const legacyCenter = (await q<{
      id: string;
      pib: string | null;
      commission_percent_override: number | null;
      reserve_percent_override: number | null;
    }>(
      `SELECT id, pib, commission_percent_override, reserve_percent_override
       FROM "${s}".education_centers WHERE id = $1`,
      [fixtures.legacyEducationCenter.id],
    )).rows[0]!;
    assert.equal(legacyCenter.id, fixtures.legacyEducationCenter.id, "legacy education center row is preserved");
    assert.equal(legacyCenter.pib, null, "legacy education center may keep a null PIB");
    assert.equal(legacyCenter.commission_percent_override, null, "legacy center inherits global commission");
    assert.equal(legacyCenter.reserve_percent_override, null, "legacy center inherits global reserve");
    const convertedUser = (await q<{ role: string }>(
      `SELECT role FROM "${s}".users WHERE id = $1`, [fixtures.user.id],
    )).rows[0]!;
    assert.equal(convertedUser.role, "JOBSEEKER", "legacy CUSTOMER listing author converts exactly once");
    const convertedLearner = (await q<{ role: string }>(
      `SELECT role FROM "${s}".users WHERE id = $1`, [fixtures.enrollmentLearner.id],
    )).rows[0]!;
    assert.equal(convertedLearner.role, "JOBSEEKER", "legacy CUSTOMER learner converts when another account purchased the seat");
    const preservedEnrollment = (await q<{ user_id: string; purchaser_id: string }>(
      `SELECT user_id, purchaser_id FROM "${s}".course_enrollments WHERE id = $1`,
      [fixtures.enrollment.id],
    )).rows[0]!;
    assert.equal(preservedEnrollment.user_id, fixtures.enrollmentLearner.id, "conversion preserves enrollment learner FK");
    assert.equal(preservedEnrollment.purchaser_id, fixtures.enrollmentPurchaser.id, "conversion preserves enrollment purchaser FK");
    const preservedListingAuthor = (await q<{ user_id: string }>(
      `SELECT user_id FROM "${s}".beauty_job_listings WHERE title = 'Legacy individual listing'`,
    )).rows[0]!;
    assert.equal(preservedListingAuthor.user_id, fixtures.user.id, "conversion preserves listing user FK");
    for (const table of ["jobseeker_profiles", "jobseeker_salon_interests"]) {
      assert.ok(await objectExists(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS exists`,
        [s, table],
      ), `${table} exists`);
    }
    await q(`UPDATE "${s}".users SET date_of_birth = date '1995-05-10' WHERE id = $1`, [fixtures.user.id]);
    await q(
      `INSERT INTO "${s}".jobseeker_profiles (user_id, portfolio_media)
       VALUES ($1, '["/one.jpg", "/two.jpg", "/three.jpg"]'::jsonb)`,
      [fixtures.user.id],
    );
    await q(
      `INSERT INTO "${s}".jobseeker_salon_interests (user_id, salon_id) VALUES ($1, $2)`,
      [fixtures.user.id, fixtures.salon.id],
    );
    await assert.rejects(
      q(`INSERT INTO "${s}".jobseeker_salon_interests (user_id, salon_id) VALUES ($1, $2)`, [fixtures.user.id, fixtures.salon.id]),
      /duplicate key|unique/i,
      "jobseeker salon interests remain unique per user and salon",
    );

    // ── Legacy rows preserved ──────────────────────────────────────────────
    const smsCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".sms_deliveries`)).rows[0]!.n;
    assert.equal(smsCount, "1", "legacy sms_deliveries row preserved");
    const reviewCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".reviews`)).rows[0]!.n;
    assert.equal(reviewCount, "1", "legacy reviews row preserved");
    const custCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".salon_customers`)).rows[0]!.n;
    assert.equal(custCount, "1", "legacy salon_customers row preserved");
    const emailCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".email_deliveries`)).rows[0]!.n;
    assert.equal(emailCount, "1", "legacy email_deliveries row preserved");
    const consolidatedRetailItems = (await q<{ quantity: number; product_catalog_reference: string }>(
      `SELECT quantity, product_catalog_reference
       FROM "${s}".retail_cart_items
       WHERE cart_id = $1
         AND product_id = $2
         AND variant_value IS NULL`,
      [fixtures.retailCart.id, fixtures.retailProduct.id],
    )).rows;
    assert.equal(consolidatedRetailItems.length, 1, "legacy duplicate null-variant cart lines consolidate to one row");
    assert.equal(consolidatedRetailItems[0]?.quantity, 5, "legacy duplicate cart quantity is preserved");
    assert.match(
      consolidatedRetailItems[0]?.product_catalog_reference ?? "",
      /^LUM-[A-F0-9]{12}$/,
      "legacy cart line receives the product's customer-facing catalog reference",
    );

    // ── Enum now accepts `processing` ──────────────────────────────────────
    const enumLabels = (await q<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'sms_delivery_status' AND n.nspname = $1`,
      [s],
    )).rows.map((r) => r.enumlabel);
    for (const label of ["queued", "processing", "sent", "failed", "skipped"]) {
      assert.ok(enumLabels.includes(label), `sms_delivery_status now includes '${label}'`);
    }
    // Prove the new label is actually usable on the existing table.
    await q(`UPDATE "${s}".sms_deliveries SET status = 'processing' WHERE event_key = 'legacy-sms-1'`);
    const updated = (await q<{ status: string }>(`SELECT status FROM "${s}".sms_deliveries WHERE event_key = 'legacy-sms-1'`)).rows[0]!;
    assert.equal(updated.status, "processing", "existing sms row updatable to processing");

    // ── sms_message_type now accepts `automation` (mirrors core.ts labels) ──
    const messageTypeLabels = (await q<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'sms_message_type' AND n.nspname = $1`,
      [s],
    )).rows.map((r) => r.enumlabel);
    for (const label of [
      "appointment_confirmation", "appointment_reminder", "education_session_reminder",
      "education_waitlist_offer", "education_session_cancelled", "automation", "admin_alert",
    ]) {
      assert.ok(messageTypeLabels.includes(label), `sms_message_type now includes '${label}'`);
    }
    // v7: a platform-level admin alert SMS (no salon) is insertable with the
    // new label — exactly what the delivery-report silence SMS fallback writes.
    await q(
      `INSERT INTO "${s}".sms_deliveries (event_key, salon_id, message_type, recipient_phone, body, status)
       VALUES ('new-admin-alert-sms', NULL, 'admin_alert', '+381600000002', 'Upozorenje', 'queued')`,
    );
    const adminAlertSms = (await q<{ message_type: string; salon_id: string | null }>(
      `SELECT message_type, salon_id FROM "${s}".sms_deliveries WHERE event_key = 'new-admin-alert-sms'`,
    )).rows[0]!;
    assert.equal(adminAlertSms.message_type, "admin_alert", "new admin_alert SMS delivery insertable");
    assert.equal(adminAlertSms.salon_id, null, "admin alert SMS carries no salon");
    // A new SMS delivery with message_type='automation' can be inserted...
    await q(
      `INSERT INTO "${s}".sms_deliveries (event_key, salon_id, message_type, recipient_phone, body, status)
       VALUES ('new-automation-sms', $1, 'automation', '+381600000001', 'Zdravo', 'queued')`,
      [fixtures.salon.id],
    );
    const newSms = (await q<{ message_type: string }>(`SELECT message_type FROM "${s}".sms_deliveries WHERE event_key = 'new-automation-sms'`)).rows[0]!;
    assert.equal(newSms.message_type, "automation", "new automation SMS delivery insertable");
    // ...and the existing legacy row can be updated to 'automation'...
    await q(`UPDATE "${s}".sms_deliveries SET message_type = 'automation' WHERE event_key = 'legacy-sms-1'`);
    const legacyUpdated = (await q<{ message_type: string }>(`SELECT message_type FROM "${s}".sms_deliveries WHERE event_key = 'legacy-sms-1'`)).rows[0]!;
    assert.equal(legacyUpdated.message_type, "automation", "legacy sms row updatable to automation");
    // ...while the old row's data (recipient) is otherwise intact after upgrade.
    const legacyRow = (await q<{ recipient_phone: string }>(`SELECT recipient_phone FROM "${s}".sms_deliveries WHERE event_key = 'legacy-sms-1'`)).rows[0]!;
    assert.equal(legacyRow.recipient_phone, "+381600000000", "legacy sms row data preserved through upgrade");

    // ── Growth enums created ───────────────────────────────────────────────
    for (const typeName of [
      "automation_trigger", "automation_action", "automation_status", "automation_run_status",
      "customer_retention_status", "package_purchase_status", "package_redemption_status",
      "commission_type", "package_payment_method",
    ]) {
      const exists = await objectExists(
        `SELECT EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = $1 AND n.nspname = $2) AS exists`,
        [typeName, s],
      );
      assert.ok(exists, `enum ${typeName} created`);
    }

    // ── Every growth table exists ──────────────────────────────────────────
    const growthTables = [
      "automation_rules", "automation_runs", "automation_deliveries",
      "treatment_packages", "package_service_links", "customer_package_purchases",
      "package_purchase_service_links", "package_redemptions",
      "employee_commission_settings", "employee_ratings",
      "platform_retention_settings",
      "provider_webhook_receipts",
    ];
    for (const tbl of growthTables) {
      const exists = await objectExists(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS exists`,
        [s, tbl],
      );
      assert.ok(exists, `table ${tbl} exists`);
    }

    // ── Key new columns on existing tables ─────────────────────────────────
    async function columnExists(table: string, column: string) {
      return objectExists(
        `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS exists`,
        [s, table, column],
      );
    }
    assert.ok(await columnExists("salon_customers", "birth_date"), "salon_customers.birth_date added");
    assert.ok(await columnExists("employee_time_off", "start_time"), "employee_time_off.start_time added");
    assert.ok(await columnExists("employee_time_off", "end_time"), "employee_time_off.end_time added");
    await q(
      `INSERT INTO "${s}".employee_time_off (employee_id, start_date, end_date, start_time, end_time, reason)
       VALUES ($1, date '2099-01-01', date '2099-01-01', '10:00', '11:00', 'Intraday block')`,
      [fixtures.employee.id],
    );
    await assert.rejects(
      q(`INSERT INTO "${s}".employee_time_off (employee_id, start_date, end_date, start_time, reason)
         VALUES ($1, date '2099-01-02', date '2099-01-02', '10:00', 'Invalid block')`, [fixtures.employee.id]),
      /employee_time_off_times_together_check/,
      "time-off bootstrap enforces both-or-neither times",
    );
    await assert.rejects(
      q(`INSERT INTO "${s}".employee_time_off (employee_id, start_date, end_date, start_time, end_time, reason)
         VALUES ($1, date '2099-01-03', date '2099-01-03', '11:00', '10:00', 'Invalid block')`, [fixtures.employee.id]),
      /employee_time_off_time_order_check/,
      "time-off bootstrap enforces chronological block times",
    );
    for (const column of [
      "retail_enabled", "professional_enabled", "public_description", "public_price",
      "public_discount_price", "catalog_reference", "similar_products_mode",
      "similar_product_ids", "cross_sell_product_ids", "quantity_pricing_tiers",
      "minimum_order_quantity", "delivery_business_days_override",
      "subscription_allowed", "subscription_discount_percent",
    ]) {
      assert.ok(await columnExists("products", column), `products.${column} added for retail storefront`);
    }
    assert.ok(await columnExists("retail_cart_items", "product_catalog_reference"), "retail cart reference snapshot column added");
    assert.ok(await columnExists("retail_order_items", "product_catalog_reference"), "retail order reference snapshot column added");
    assert.ok(await columnExists("reviews", "employee_id"), "reviews.employee_id added");
    assert.ok(await columnExists("users", "marketing_emails_enabled"), "users.marketing_emails_enabled added");
    for (const column of [
      "appointment_id", "recipient_name", "html_content", "status", "scheduled_at",
      "retry_count", "retryable_failure", "next_retry_at", "processing_token",
    ]) {
      assert.ok(await columnExists("email_deliveries", column), `email_deliveries.${column} added`);
    }
    assert.ok(await columnExists("sms_deliveries", "processing_started_at"), "sms_deliveries.processing_started_at added");
    assert.ok(await columnExists("sms_deliveries", "submission_started_at"), "sms_deliveries.submission_started_at added");
    assert.ok(await columnExists("sms_deliveries", "claim_expires_at"), "sms_deliveries.claim_expires_at added");
    assert.ok(await columnExists("automation_runs", "sent_at"), "automation_runs.sent_at present");
    assert.ok(await columnExists("automation_deliveries", "claim_expires_at"), "automation_deliveries.claim_expires_at present");
    assert.ok(await columnExists("automation_deliveries", "failed_at"), "automation_deliveries.failed_at present (provider webhook failure state)");
    for (const [table, column] of [
      ["treatment_packages", "quota_policy"],
      ["package_service_links", "quota"],
      ["customer_package_purchases", "quota_policy"],
      ["package_purchase_service_links", "total_quota"],
      ["package_purchase_service_links", "remaining_quota"],
      ["package_redemptions", "purchase_service_link_id"],
      ["package_redemptions", "service_id"],
    ] as const) {
      assert.ok(await columnExists(table, column), `${table}.${column} present for per-service package quotas`);
    }
    // v5+: delivery-report freshness plus bounded malformed-payload tracking
    // (mirrors providerWebhookReceiptsTable).
    for (const column of ["provider", "last_event_at", "rejected_payload_count", "last_rejected_at", "updated_at"]) {
      assert.ok(await columnExists("provider_webhook_receipts", column), `provider_webhook_receipts.${column} present`);
    }
    // The monotonic receipt upsert used at runtime must work on the rolled-out table.
    await q(
      `INSERT INTO "${s}".provider_webhook_receipts (provider, last_event_at, updated_at)
       VALUES ('brevo', now(), now())
       ON CONFLICT (provider) DO UPDATE SET
         last_event_at = greatest(provider_webhook_receipts.last_event_at, excluded.last_event_at),
         updated_at = excluded.updated_at`,
    );
    const receiptBefore = (await q<{ last_event_at: string }>(`SELECT last_event_at FROM "${s}".provider_webhook_receipts WHERE provider = 'brevo'`)).rows[0]!;
    await q(
      `INSERT INTO "${s}".provider_webhook_receipts (provider, last_event_at, updated_at)
       VALUES ('brevo', now() - interval '1 hour', now())
       ON CONFLICT (provider) DO UPDATE SET
         last_event_at = greatest(provider_webhook_receipts.last_event_at, excluded.last_event_at),
         updated_at = excluded.updated_at`,
    );
    const receiptAfter = (await q<{ last_event_at: string }>(`SELECT last_event_at FROM "${s}".provider_webhook_receipts WHERE provider = 'brevo'`)).rows[0]!;
    assert.equal(receiptAfter.last_event_at.toString(), receiptBefore.last_event_at.toString(), "stale receipt upsert never regresses last_event_at");

    // ── Key indexes ────────────────────────────────────────────────────────
    async function indexExists(name: string) {
      return objectExists(
        `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2) AS exists`,
        [s, name],
      );
    }
    for (const idx of [
      "reviews_employee_visible_idx",
      "products_retail_active_created_idx",
      "products_professional_active_created_idx",
      "products_catalog_reference_unique",
      "retail_cart_items_cart_product_variant_unique",
      "retail_order_items_catalog_reference_order_idx",
      "sms_deliveries_claim_expiry_idx",
      "automation_runs_cooldown_idx",
      "automation_deliveries_claim_expiry_idx",
      "package_redemptions_purchase_appointment_unique",
      "employee_commission_settings_employee_unique",
      "customer_package_purchases_status_idx",
      "platform_retention_settings_version_unique",
      "email_deliveries_report_alert_history_idx",
      "email_deliveries_provider_message_idx",
      "email_deliveries_retry_index",
      "email_deliveries_beauty_job_issue_idx",
      "email_deliveries_beauty_job_alert_history_idx",
      "beauty_job_notifications_expiry_warning_unique",
      "appointments_salon_customer_completed_date_idx",
      "salon_customers_salon_id_idx",
    ]) {
      assert.ok(await indexExists(idx), `index ${idx} exists`);
    }
    const attributionIndex = (await q<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = $1 AND indexname = 'appointments_salon_customer_completed_date_idx'`,
      [s],
    )).rows[0]?.indexdef;
    assert.match(
      attributionIndex ?? "",
      /ON .*appointments USING btree \(salon_customer_id, appointment_date\).*WHERE \(status = 'completed'::text\)/i,
      "attribution index covers customer/date and only completed history",
    );

    // ── Returning-client attribution plan proof ────────────────────────────
    // Use a non-trivial history and several campaign attributions so this
    // checks the lookup shape used by the overview, not just that the index
    // definition exists. The fixture lives entirely in the temporary schema.
    await q(
      `INSERT INTO "${s}".appointments
         (salon_id, salon_customer_id, appointment_date, status)
       SELECT $1, $2, date '2024-01-01' + day, 'completed'
       FROM generate_series(0, 127) AS history(day)`,
      [fixtures.salon.id, fixtures.customer.id],
    );
    const campaignRule = (await q<{ id: string }>(
      `INSERT INTO "${s}".automation_rules
         (salon_id, name, trigger, action, status)
       VALUES ($1, 'Attribution plan fixture', 'inactive_days', 'send_email', 'active')
       RETURNING id`,
      [fixtures.salon.id],
    )).rows[0]!;
    const campaignAppointments = (await q<{ id: string }>(
      `INSERT INTO "${s}".appointments
         (salon_id, salon_customer_id, appointment_date, status)
       SELECT $1, $2, date '2026-02-01' + day, 'confirmed'
       FROM generate_series(0, 3) AS campaign(day)
       RETURNING id`,
      [fixtures.salon.id, fixtures.customer.id],
    )).rows;
    assert.equal(campaignAppointments.length, 4, "campaign attribution fixture has four appointments");
    await q(
      `INSERT INTO "${s}".automation_runs
         (event_key, rule_id, salon_id, salon_customer_id, status,
          attributed_appointment_id, sent_at, executed_at)
       SELECT 'plan-run-' || row_number() OVER (ORDER BY appointment.id),
              $1, $2, $3, 'sent', appointment.id,
              timestamptz '2026-01-31 10:00:00+00',
              timestamptz '2026-01-31 10:00:00+00'
       FROM "${s}".appointments appointment
       WHERE appointment.id = ANY($4::uuid[])`,
      [
        campaignRule.id,
        fixtures.salon.id,
        fixtures.customer.id,
        campaignAppointments.map((appointment) => appointment.id),
      ],
    );
    const campaignRun = (await q<{ id: string }>(
      `SELECT id
       FROM "${s}".automation_runs
       WHERE rule_id = $1
       ORDER BY event_key
       LIMIT 1`,
      [campaignRule.id],
    )).rows[0];
    assert.ok(campaignRun, "campaign attribution fixture has a run");

    const planClient = await pool.connect();
    let explainResult: { rows: Array<{ "QUERY PLAN": unknown }> };
    try {
      await planClient.query("BEGIN");
      // Disabling sequential scans makes the assertion independent of table
      // size and routine planner cost changes while still requiring the
      // partial index to be structurally usable by this predicate.
      await planClient.query("SET LOCAL enable_seqscan = off");
      explainResult = await planClient.query(
        `EXPLAIN (COSTS OFF, FORMAT JSON)
         SELECT 1
         FROM "${s}".automation_runs AS campaign_run
         JOIN "${s}".appointments AS attributed
           ON attributed.id = campaign_run.attributed_appointment_id
         WHERE campaign_run.id = $1
           AND EXISTS (
             SELECT 1
             FROM "${s}".appointments AS prior
             WHERE prior.salon_customer_id = attributed.salon_customer_id
               AND prior.id <> attributed.id
               AND prior.status = 'completed'
               AND prior.appointment_date
                   < (coalesce(
                        campaign_run.sent_at,
                        campaign_run.executed_at,
                        campaign_run.created_at
                      ))::date
           )`,
        [campaignRun.id],
      );
      await planClient.query("COMMIT");
    } catch (error) {
      await planClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      planClient.release();
    }
    const planText = JSON.stringify(explainResult!.rows[0]?.["QUERY PLAN"] ?? "");
    assert.match(
      planText,
      /appointments_salon_customer_completed_date_idx/,
      "returning-client lookup plan uses the completed-history index",
    );
    assert.match(
      planText,
      /Index Scan|Index Only Scan|Bitmap Index Scan/,
      "returning-client lookup plan contains an index access",
    );
    console.log("Returning-client attribution plan uses the completed-history index.");

    const retailCartUniqueIndex = (await q<{ indnullsnotdistinct: boolean }>(
      `SELECT index_definition.indnullsnotdistinct
       FROM pg_index index_definition
       JOIN pg_class index_relation ON index_relation.oid = index_definition.indexrelid
       JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
       WHERE index_schema.nspname = $1
         AND index_relation.relname = 'retail_cart_items_cart_product_variant_unique'`,
      [s],
    )).rows[0];
    assert.equal(
      retailCartUniqueIndex?.indnullsnotdistinct,
      true,
      "retail cart uniqueness treats a NULL variant value as a real cart-line key",
    );
    await assert.rejects(
      q(
        `INSERT INTO "${s}".retail_cart_items
           (cart_id, product_id, product_name, product_image_url, unit_price, quantity)
         VALUES ($1, $2, 'Legacy retail product', '/legacy-retail.jpg', 1000, 1)`,
        [fixtures.retailCart.id, fixtures.retailProduct.id],
      ),
      /duplicate key|unique/i,
      "the rollout rejects a second null-variant line for the same product and cart",
    );

    // ── Public product rollout query proof ─────────────────────────────────
    // Insert both an approved public product and a private B2B product after
    // upgrading the old catalog table. The anonymous selection mirrors the
    // public storefront's eligibility predicate and explicit public fields.
    const publicProduct = (await q<{ id: string }>(
      `INSERT INTO "${s}".products
         (name, description, retail_enabled, public_description, public_price, public_discount_price)
       VALUES ('Javni proizvod', 'Interni B2B opis', true, 'Opis za kupce', 2499, 1999)
       RETURNING id`,
    )).rows[0]!;
    await q(
      `INSERT INTO "${s}".products (name, description, retail_enabled, public_price)
       VALUES ('Privatni B2B proizvod', 'Ne sme biti javan', false, 999)`,
    );
    const publicList = (await q<{
      id: string;
      name: string;
      description: string;
      price: number;
      discount_price: number | null;
    }>(
      `SELECT id, name, public_description AS description, public_price AS price,
              public_discount_price AS discount_price
       FROM "${s}".products
       WHERE active = true
         AND retail_enabled = true
         AND public_description IS NOT NULL
         AND public_price IS NOT NULL
       ORDER BY created_at, id`,
    )).rows;
    assert.equal(publicList.length, 1, "public eligibility query excludes private B2B products");
    assert.deepEqual(publicList[0], {
      id: publicProduct.id,
      name: "Javni proizvod",
      description: "Opis za kupce",
      price: 2499,
      discount_price: 1999,
    }, "public list can select only customer-facing catalog fields after upgrade");
    const publicDetail = (await q<{ description: string; price: number }>(
      `SELECT public_description AS description, public_price AS price
       FROM "${s}".products
       WHERE id = $1
         AND active = true
         AND retail_enabled = true
         AND public_description IS NOT NULL
         AND public_price IS NOT NULL`,
      [publicProduct.id],
    )).rows[0]!;
    assert.deepEqual(publicDetail, { description: "Opis za kupce", price: 2499 },
      "public detail eligibility query succeeds after legacy schema upgrade");

    // ── Leading FK-column indexes (DB standards audit requirement) ──────────
    // Each FK column below must have an index whose LEADING (0-based position 0)
    // column is exactly that FK column, matching the backend-standards audit.
    async function leadingIndexColumn(indexName: string): Promise<string | null> {
      const res = await q<{ attname: string }>(
        `SELECT a.attname
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = i.relnamespace
         JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ix.indkey[0]
         WHERE n.nspname = $1 AND i.relname = $2`,
        [s, indexName],
      );
      return res.rows[0]?.attname ?? null;
    }
    const leadingFkIndexes: Array<[string, string]> = [
      ["automation_runs_attributed_appointment_idx", "attributed_appointment_id"],
      ["automation_runs_salon_customer_idx", "salon_customer_id"],
      ["b2b_quotes_source_cart_idx", "source_cart_id"],
      ["catalog_sync_runs_requested_by_idx", "requested_by_user_id"],
      ["commerce_experience_settings_updated_by_idx", "updated_by_user_id"],
      ["customer_package_purchases_payment_confirmed_by_idx", "payment_confirmed_by_user_id"],
      ["customer_package_purchases_customer_idx", "salon_customer_id"],
      ["employee_commission_settings_updated_by_idx", "updated_by_user_id"],
      ["package_purchase_service_links_service_idx", "service_id"],
      ["package_redemptions_reversed_by_idx", "reversed_by_user_id"],
      ["package_redemptions_customer_idx", "salon_customer_id"],
      ["platform_retention_settings_changed_by_idx", "changed_by_user_id"],
      ["price_inquiries_product_created_idx", "product_id"],
      ["price_inquiries_supplier_idx", "supplier_id"],
      ["rma_status_history_actor_user_idx", "actor_user_id"],
      ["rmas_order_item_idx", "order_item_id"],
      ["rmas_requester_user_idx", "requester_user_id"],
      ["rmas_retail_order_item_idx", "retail_order_item_id"],
    ];
    for (const [idxName, fkColumn] of leadingFkIndexes) {
      assert.ok(await indexExists(idxName), `leading FK index ${idxName} exists`);
      assert.equal(
        await leadingIndexColumn(idxName),
        fkColumn,
        `${idxName} leads with FK column ${fkColumn}`,
      );
    }

    // ── Key constraints (unique + FK) ──────────────────────────────────────
    async function constraintExists(name: string) {
      return objectExists(
        `SELECT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND c.conname = $2) AS exists`,
        [s, name],
      );
    }
    assert.ok(await constraintExists("reviews_employee_id_employees_id_fk"), "reviews.employee_id FK created");
    assert.ok(await constraintExists("automation_runs_event_key_unique"), "automation_runs event_key unique constraint");
    assert.ok(await constraintExists("automation_deliveries_event_key_unique"), "automation_deliveries event_key unique constraint");
    for (const constraint of [
      "education_centers_commission_override_check",
      "education_centers_reserve_override_check",
      "education_centers_online_refund_override_check",
      "education_centers_live_appeal_override_check",
      "education_centers_featured_price_override_check",
    ]) {
      assert.ok(await constraintExists(constraint), `${constraint} created`);
    }
    await q(
      `UPDATE "${s}".education_centers SET
         pib = '101010101',
         commission_percent_override = 0,
         reserve_percent_override = 100,
         online_refund_days_override = 365,
         live_appeal_days_override = 0,
         featured_course_price_override = 0
       WHERE id = $1`,
      [fixtures.legacyEducationCenter.id],
    );
    await assert.rejects(
      q(
        `UPDATE "${s}".education_centers
         SET commission_percent_override = 101
         WHERE id = $1`,
        [fixtures.legacyEducationCenter.id],
      ),
      /education_centers_commission_override_check|check constraint/i,
    );

    // ── Representative growth inserts succeed ──────────────────────────────
    const rule = (await q<{ id: string }>(
      `INSERT INTO "${s}".automation_rules (salon_id, name, trigger, action, status)
       VALUES ($1, 'R', 'inactive_days', 'send_email', 'active') RETURNING id`,
      [fixtures.salon.id],
    )).rows[0]!;
    const runRow = (await q<{ id: string }>(
      `INSERT INTO "${s}".automation_runs (event_key, rule_id, salon_id, salon_customer_id, status, sent_at)
       VALUES ('run-1', $1, $2, $3, 'sent', now()) RETURNING id`,
      [rule.id, fixtures.salon.id, fixtures.customer.id],
    )).rows[0]!;
    await q(
      `INSERT INTO "${s}".automation_deliveries (run_id, salon_id, event_key, channel, status)
       VALUES ($1, $2, 'run-1:email', 'email', 'sent')`,
      [runRow.id, fixtures.salon.id],
    );
    const pkg = (await q<{ id: string }>(
      `INSERT INTO "${s}".treatment_packages (salon_id, name, price_in_dinars, session_count)
       VALUES ($1, 'Pkg', 1000, 5) RETURNING id`,
      [fixtures.salon.id],
    )).rows[0]!;
    await q(`INSERT INTO "${s}".package_service_links (package_id, service_id) VALUES ($1, $2)`, [pkg.id, fixtures.service.id]);
    const purchase = (await q<{ id: string }>(
      `INSERT INTO "${s}".customer_package_purchases (salon_id, package_id, salon_customer_id, total_sessions, remaining_sessions, price_in_dinars, payment_method, status, expires_at)
       VALUES ($1, $2, $3, 5, 5, 1000, 'bank_transfer', 'active', now() + interval '365 days') RETURNING id`,
      [fixtures.salon.id, pkg.id, fixtures.customer.id],
    )).rows[0]!;
    await q(`INSERT INTO "${s}".package_purchase_service_links (purchase_id, service_id) VALUES ($1, $2)`, [purchase.id, fixtures.service.id]);
    await q(
      `INSERT INTO "${s}".package_redemptions (purchase_id, salon_id, appointment_id, salon_customer_id, status)
       VALUES ($1, $2, $3, $4, 'redeemed')`,
      [purchase.id, fixtures.salon.id, fixtures.appointment.id, fixtures.customer.id],
    );
    await q(
      `INSERT INTO "${s}".employee_commission_settings (salon_id, employee_id, commission_type, commission_percent)
       VALUES ($1, $2, 'fixed_per_treatment', 0)`,
      [fixtures.salon.id, fixtures.employee.id],
    );
    await q(
      `INSERT INTO "${s}".employee_ratings (salon_id, employee_id, average_rating, review_count)
       VALUES ($1, $2, 48, 3)`,
      [fixtures.salon.id, fixtures.employee.id],
    );
    // Populate the new reviews.employee_id + birth_date on existing rows.
    await q(`UPDATE "${s}".reviews SET employee_id = $1`, [fixtures.employee.id]);
    await q(`UPDATE "${s}".salon_customers SET birth_date = '1990-05-01'`);

    // Retention settings: an audited version row is insertable with the FK to users.
    await q(
      `INSERT INTO "${s}".platform_retention_settings
         (version, new_customer_window_days, default_interval_days, at_risk_interval_percent,
          lost_interval_percent, lost_minimum_days, vip_min_completed_visits, vip_spend_percent_of_median,
          changed_by_user_id)
       VALUES (1, 45, 45, 150, 250, 180, 5, 200, $1)`,
      [fixtures.user.id],
    );
    const settingsRow = (await q<{ version: number; changed_by_user_id: string }>(
      `SELECT version, changed_by_user_id FROM "${s}".platform_retention_settings WHERE version = 1`,
    )).rows[0]!;
    assert.equal(settingsRow.version, 1, "platform_retention_settings row insertable");
    assert.equal(settingsRow.changed_by_user_id, fixtures.user.id, "retention settings audit FK stored");
    // Version uniqueness enforced (append-only versioned config).
    await assert.rejects(
      q(
        `INSERT INTO "${s}".platform_retention_settings
           (version, new_customer_window_days, default_interval_days, at_risk_interval_percent,
            lost_interval_percent, lost_minimum_days, vip_min_completed_visits, vip_spend_percent_of_median)
         VALUES (1, 45, 45, 150, 250, 180, 5, 200)`,
      ),
      /duplicate key|unique/i,
      "platform_retention_settings.version uniqueness enforced",
    );
    // v6: change-provenance columns exist; legacy rows backfill as 'manual'.
    assert.ok(await columnExists("platform_retention_settings", "change_source"), "platform_retention_settings.change_source added");
    assert.ok(await columnExists("platform_retention_settings", "restored_from_version"), "platform_retention_settings.restored_from_version added");
    const legacySettings = (await q<{ change_source: string; restored_from_version: number | null }>(
      `SELECT change_source, restored_from_version FROM "${s}".platform_retention_settings WHERE version = 900`,
    )).rows[0]!;
    assert.equal(legacySettings.change_source, "manual", "pre-upgrade settings rows backfill change_source = 'manual'");
    assert.equal(legacySettings.restored_from_version, null, "pre-upgrade settings rows have no restored_from_version");
    // A restore-labelled version row is insertable on the rolled-out table.
    await q(
      `INSERT INTO "${s}".platform_retention_settings
         (version, new_customer_window_days, default_interval_days, at_risk_interval_percent,
          lost_interval_percent, lost_minimum_days, vip_min_completed_visits, vip_spend_percent_of_median,
          changed_by_user_id, change_source, restored_from_version)
       VALUES (2, 45, 45, 150, 250, 180, 5, 200, $1, 'restore_version', 900)`,
      [fixtures.user.id],
    );
    const restoredRow = (await q<{ change_source: string; restored_from_version: number }>(
      `SELECT change_source, restored_from_version FROM "${s}".platform_retention_settings WHERE version = 2`,
    )).rows[0]!;
    assert.equal(restoredRow.change_source, "restore_version", "restore-labelled row stores its change source");
    assert.equal(restoredRow.restored_from_version, 900, "restore-labelled row stores the source version");

    // ── Beauty Poslovi author and rental privacy invariants ────────────────
    const beautyCategory = (await q<{ id: string }>(
      `SELECT id FROM "${s}".beauty_job_categories WHERE slug = 'iznajmljivanje-opreme'`,
    )).rows[0]!;
    const supportCategory = (await q<{ name: string; enabled: boolean; subtype_labels: string[] }>(
      `SELECT name, enabled, subtype_labels FROM "${s}".beauty_job_categories WHERE slug = 'pomocno-osoblje'`,
    )).rows[0]!;
    assert.equal(supportCategory.name, "Pomoćno osoblje", "support staff category is seeded");
    assert.equal(supportCategory.enabled, true, "support staff category is enabled");
    assert.deepEqual(supportCategory.subtype_labels, ["Recepcija", "Asistent u salonu", "Šampon"], "support staff subtypes are seeded");
    const expectedTaxonomy = new Map([
      ["frizeri", "Frizeri"],
      ["barberi", "Barberi"],
      ["kozmeticari", "Kozmetičari"],
      ["nokti", "Nokti (Manikir/Pedikir)"],
      ["lash-brow", "Lash/Brow"],
      ["masaza-terapeuti", "Masaža/Terapeuti"],
      ["sminkeri", "Šminkeri"],
      ["pmu", "PMU"],
      ["estetika-anti-aging", "Estetika/anti-aging"],
      ["pomocno-osoblje", "Pomoćno osoblje"],
      ["tattoo-piercing", "Tattoo/Piercing"],
    ]);
    const taxonomyRows = (await q<{ slug: string; name: string; enabled: boolean }>(
      `SELECT slug, name, enabled FROM "${s}".beauty_job_categories WHERE slug = ANY($1::text[])`,
      [[...expectedTaxonomy.keys()]],
    )).rows;
    assert.equal(taxonomyRows.length, expectedTaxonomy.size, "complete Beauty Poslovi taxonomy is seeded");
    for (const category of taxonomyRows) {
      assert.equal(category.name, expectedTaxonomy.get(category.slug), `${category.slug} retains its canonical label`);
      assert.equal(category.enabled, true, `${category.slug} is visible in the public category catalog`);
    }
    const beautyListing = (await q<{ id: string }>(
      `INSERT INTO "${s}".beauty_job_listings
        (category_id, salon_id, posted_by_type, type, title, description, city, region, expires_at)
       VALUES ($1, $2, 'salon', 'equipment_rental', 'Sto', 'Iznajmljivanje profesionalnog stola.', 'Beograd', 'Vračar', now() + interval '30 days')
       RETURNING id`,
      [beautyCategory.id, fixtures.salon.id],
    )).rows[0]!;
    assert.ok(await columnExists("beauty_job_listings", "is_urgent"), "beauty_job_listings.is_urgent added");
    await assert.rejects(
      q(
        `INSERT INTO "${s}".beauty_job_listings
           (category_id, user_id, posted_by_type, type, is_urgent, title, description, city, region, expires_at)
         VALUES ($1, $2, 'user', 'job', true, 'Nevažeće hitno', 'Hitno je samo za freelance.', 'Beograd', 'Vračar', now())`,
        [beautyCategory.id, fixtures.user.id],
      ),
      /beauty_job_listings_urgent_only_freelance|check constraint/i,
      "database rejects urgent non-freelance listings",
    );
    await q(
      `INSERT INTO "${s}".beauty_job_listings
         (category_id, user_id, posted_by_type, type, is_urgent, title, description, city, region, expires_at)
       VALUES ($1, $2, 'user', 'freelance', true, 'Hitni freelance', 'Dozvoljeni hitni freelance oglas.', 'Beograd', 'Vračar', now())`,
      [beautyCategory.id, fixtures.user.id],
    );
    await q(
      `INSERT INTO "${s}".beauty_job_listing_availability (listing_id, availability_pattern)
       VALUES ($1, 'Po dogovoru')`,
      [beautyListing.id],
    );
    const rentalSlot = (await q<{ id: string }>(
      `INSERT INTO "${s}".beauty_job_rental_slots (listing_id, starts_at, ends_at)
       VALUES ($1, now() + interval '2 days', now() + interval '2 days 2 hours')
       RETURNING id`,
      [beautyListing.id],
    )).rows[0]!;
    await q(
      `INSERT INTO "${s}".beauty_job_rental_requests (listing_id, slot_id, applicant_user_id, status)
       VALUES ($1, $2, $3, 'accepted')`,
      [beautyListing.id, rentalSlot.id, fixtures.user.id],
    );
    await assert.rejects(
      q(
        `INSERT INTO "${s}".beauty_job_rental_requests (listing_id, slot_id, applicant_user_id, status)
         VALUES ($1, $2, $3, 'accepted')`,
        [beautyListing.id, rentalSlot.id, fixtures.employee.id],
      ),
      /duplicate key|unique/i,
      "only one accepted rental request is allowed per slot",
    );
    await assert.rejects(
      q(
        `INSERT INTO "${s}".beauty_job_listings
          (category_id, salon_id, user_id, posted_by_type, type, title, description, city, region, expires_at)
         VALUES ($1, $2, $3, 'salon', 'equipment_rental', 'Nevažeće', 'Nevažeći autor.', 'Beograd', 'Vračar', now())`,
        [beautyCategory.id, fixtures.salon.id, fixtures.user.id],
      ),
      /beauty_job_listings_exactly_one_author|check constraint/i,
      "Beauty Poslovi requires exactly one author",
    );
    assert.equal(
      (await q<{ address_count: number }>(
        `SELECT count(*)::integer AS address_count FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'beauty_job_listings' AND column_name ILIKE '%address%'`,
        [s],
      )).rows[0]!.address_count,
      0,
      "Beauty Poslovi listings have no exact-address storage column",
    );

    // ── Unique constraint actually enforced ────────────────────────────────
    await assert.rejects(
      q(
        `INSERT INTO "${s}".automation_runs (event_key, rule_id, salon_id, salon_customer_id, status)
         VALUES ('run-1', $1, $2, $3, 'pending')`,
        [rule.id, fixtures.salon.id, fixtures.customer.id],
      ),
      /duplicate key|unique/i,
      "automation_runs.event_key uniqueness enforced",
    );

    // ── v68/v69 B2C aftercare legacy upgrade and evidence fences ─────────
    assert.ok(await columnExists("products", "average_duration_days"), "products.average_duration_days added");
    assert.ok(await columnExists("product_bundles", "linked_treatment_id"), "bundle treatment link added");
    for (const table of [
      "treatment_taxonomy", "product_treatment_mappings", "aftercare_settings",
      "aftercare_completion_events", "aftercare_recommendations",
      "aftercare_recommendation_appointments", "aftercare_recommendation_lines", "aftercare_deliveries",
    ]) {
      const exists = (await q<{ present: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS present`, [`${s}.${table}`],
      )).rows[0]!.present;
      assert.equal(exists, true, `${table} created`);
    }
    const settings = (await q<{
      version: number; first_timing: string; cooldown_days: number; second_reminder_delay_days: number;
      personalized_bundle_discount_percent: number; combination_window_days: number;
    }>(`SELECT version, first_timing, cooldown_days, second_reminder_delay_days,
               personalized_bundle_discount_percent, combination_window_days
          FROM "${s}".aftercare_settings WHERE is_current`)).rows[0]!;
    assert.deepEqual(settings, {
      version: 1, first_timing: "IMMEDIATE_AFTER_COMPLETION", cooldown_days: 30,
      second_reminder_delay_days: 6, personalized_bundle_discount_percent: 10,
      combination_window_days: 30,
    }, "v68 seeds one current settings version with canonical defaults");
    await assert.rejects(
      q(`UPDATE "${s}".products SET average_duration_days = 0 WHERE id = $1`, [fixtures.retailProduct.id]),
      /products_average_duration_days_check|check constraint/i,
    );
    await q(`UPDATE "${s}".products SET average_duration_days = 45 WHERE id = $1`, [fixtures.retailProduct.id]);
    const treatment = (await q<{ id: string }>(
      `INSERT INTO "${s}".treatment_taxonomy (taxonomy_key, category_name, treatment_name)
       VALUES ('nega-lica', 'Lice', 'Nega lica') RETURNING id`,
    )).rows[0]!;
    await q(
      `INSERT INTO "${s}".product_treatment_mappings (product_id, treatment_id) VALUES ($1, $2)`,
      [fixtures.retailProduct.id, treatment.id],
    );
    await assert.rejects(
      q(`INSERT INTO "${s}".product_treatment_mappings (product_id, treatment_id) VALUES ($1, $2)`,
        [fixtures.retailProduct.id, treatment.id]),
      /duplicate key|unique/i,
      "product-treatment mapping is deduplicated",
    );
    await q(
      `INSERT INTO "${s}".aftercare_completion_events
         (appointment_id, customer_user_id, transition_key, completed_at)
       VALUES ($1, $2, 'completed:1', now())`,
      [fixtures.appointment.id, fixtures.user.id],
    );
    await assert.rejects(
      q(`INSERT INTO "${s}".aftercare_completion_events
           (appointment_id, customer_user_id, transition_key, completed_at)
         VALUES ($1, $2, 'completed:1', now())`, [fixtures.appointment.id, fixtures.user.id]),
      /duplicate key|unique/i,
      "completion transition wakeup is idempotent",
    );
    const recommendation = (await q<{ id: string }>(
      `INSERT INTO "${s}".aftercare_recommendations
         (customer_user_id, settings_version, entitlement_token_hash, window_started_at, window_ends_at,
          activates_at, entitlement_expires_at, settings_snapshot, treatment_snapshot)
       VALUES ($1, 1, 'opaque-token-hash', now(), now() + interval '30 days', now(),
         now() + interval '30 days', '{"cooldownDays":30}'::jsonb,
         '[{"id":"${treatment.id}","key":"nega-lica","category":"Lice","name":"Nega lica"}]'::jsonb)
       RETURNING id`, [fixtures.user.id],
    )).rows[0]!;
    const line = (await q<{ id: string }>(
      `INSERT INTO "${s}".aftercare_recommendation_lines
         (recommendation_id, kind, product_id, treatment_ids, covered_product_ids, catalog_snapshot,
          pricing_snapshot, discount_kind, discount_percent)
       VALUES ($1, 'PRODUCT', $2, $3::jsonb, $4::jsonb, '{"name":"Legacy retail product"}',
         '{"unitPriceRsd":1000}', 'POST_TREATMENT_RECOMMENDATION_DISCOUNT', 10) RETURNING id`,
      [recommendation.id, fixtures.retailProduct.id, JSON.stringify([treatment.id]), JSON.stringify([fixtures.retailProduct.id])],
    )).rows[0]!;
    await q(
      `INSERT INTO "${s}".aftercare_deliveries
         (recommendation_id, line_id, kind, event_key, scheduled_at, payload_snapshot)
       VALUES ($1, $2, 'REPLENISHMENT', 'replenishment-1', now(), '{}')`,
      [recommendation.id, line.id],
    );
    await assert.rejects(
      q(`UPDATE "${s}".aftercare_recommendations SET settings_snapshot = '{}' WHERE id = $1`, [recommendation.id]),
      /aftercare recommendation evidence is immutable/i,
    );
    await assert.rejects(
      q(`UPDATE "${s}".aftercare_recommendation_lines SET discount_percent = 20 WHERE id = $1`, [line.id]),
      /aftercare recommendation line evidence is immutable/i,
    );
    const expectedIndexes = [
      "aftercare_completion_events_due_idx", "aftercare_recommendations_customer_created_idx",
      "aftercare_recommendations_stats_idx", "aftercare_recommendation_lines_product_cooldown_idx",
      "aftercare_recommendation_lines_replenishment_idx", "aftercare_deliveries_due_claim_idx",
      "aftercare_deliveries_provider_idx",
    ];
    const foundIndexes = (await q<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])`,
      [s, expectedIndexes],
    )).rows.map((row) => row.indexname);
    assert.deepEqual(foundIndexes.sort(), expectedIndexes.sort(), "v68 worker/customer/stats indexes exist");
    for (const column of [
      "personalized_treatment_bundle_discount_rsd",
      "post_treatment_recommendation_discount_rsd",
      "aftercare_recommendation_id",
    ]) assert.ok(await columnExists("retail_order_items", column), `v69 ${column} added to B2C items only`);
    const aftercareColumns = (await q<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_schema=$1 AND table_name='retail_order_items'
         AND column_name IN ('personalized_treatment_bundle_discount_rsd','post_treatment_recommendation_discount_rsd')`,
      [s],
    )).rows;
    assert.equal(aftercareColumns.length, 2);
    assert.ok(aftercareColumns.every((column) => column.column_default?.includes("0")),
      "v69 allocations default safely to zero for legacy retail rows");
    const v70Constraints = (await q<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid=$1::regclass
       AND conname IN ('retail_order_items_aftercare_recommendation_fk','retail_order_items_aftercare_discount_check')`,
      [`${s}.retail_order_items`],
    )).rows;
    assert.deepEqual(v70Constraints.map((row) => row.conname).sort(), [
      "retail_order_items_aftercare_discount_check",
      "retail_order_items_aftercare_recommendation_fk",
    ], "v70 keeps entitlement FK and allocation conservation check");
    assert.equal(v70Constraints.find((row) => row.conname === "retail_order_items_aftercare_recommendation_fk")?.confdeltype,
      "r", "v70 restricts deletion rather than nulling immutable aftercare evidence");
    // Seed a legacy evidence reference with the commercial immutability trigger
    // disabled, then prove deletion is rejected by the FK rather than attempting
    // the v69 SET NULL update that immutable evidence forbids.
    const evidenceOrder = (await q<{ order_id: string }>(
      `SELECT order_id FROM "${s}".retail_order_items LIMIT 1`,
    )).rows[0]!;
    await q(`ALTER TABLE "${s}".retail_order_items DISABLE TRIGGER retail_order_items_commercial_snapshot_immutable`);
    await q(`UPDATE "${s}".retail_order_items SET aftercare_recommendation_id=$1
      WHERE order_id=$2`, [recommendation.id, evidenceOrder.order_id]);
    await q(`ALTER TABLE "${s}".retail_order_items ENABLE TRIGGER retail_order_items_commercial_snapshot_immutable`);
    await assert.rejects(
      q(`DELETE FROM "${s}".aftercare_recommendations WHERE id=$1`, [recommendation.id]),
      /violates foreign key constraint/i,
      "v70 does not null immutable retail evidence during recommendation cleanup",
    );
    const b2bImmutableFunction = (await q<{ prosrc: string }>(
      `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname=$1 AND p.proname='prevent_order_item_commercial_snapshot_update'`,
      [s],
    )).rows[0]!.prosrc;
    const retailImmutableFunction = (await q<{ prosrc: string }>(
      `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=$1 AND p.proname='prevent_retail_order_item_commercial_snapshot_update'`,
      [s],
    )).rows[0]!.prosrc;
    assert.doesNotMatch(b2bImmutableFunction, /aftercare_recommendation_id/i,
      "the B2B trigger function never references retail-only aftercare evidence");
    assert.ok(retailImmutableFunction.length > 0, "the retail immutable trigger function is installed");
    const immutableTriggerBindings = (await q<{ tgname: string; proname: string }>(
      `SELECT t.tgname, p.proname
       FROM pg_trigger t
       JOIN pg_proc p ON p.oid=t.tgfoid
       WHERE t.tgrelid IN ($1::regclass, $2::regclass)
         AND t.tgname IN ('order_items_commercial_snapshot_immutable', 'retail_order_items_commercial_snapshot_immutable')
       ORDER BY t.tgname`,
      [`${s}.order_items`, `${s}.retail_order_items`],
    )).rows;
    assert.deepEqual(immutableTriggerBindings, [
      { tgname: "order_items_commercial_snapshot_immutable", proname: "prevent_order_item_commercial_snapshot_update" },
      { tgname: "retail_order_items_commercial_snapshot_immutable", proname: "prevent_retail_order_item_commercial_snapshot_update" },
    ], "v72 repairs B2B and retail immutable trigger bindings");
    const b2bOrder = (await q<{ id: string }>(`INSERT INTO "${s}".orders DEFAULT VALUES RETURNING id`)).rows[0]!;
    const b2bProductSnapshot = (await q<{
      supplier_id: string; supplier_name: string; supplier_slug: string; catalog_reference: string; sku: string | null;
    }>(`SELECT p.supplier_id, sup.name supplier_name, sup.slug supplier_slug, p.catalog_reference, p.sku
        FROM "${s}".products p JOIN "${s}".suppliers sup ON sup.id=p.supplier_id WHERE p.id=$1`,
      [fixtures.retailProduct.id],
    )).rows[0]!;
    const b2bLine = (await q<{ id: string }>(
      `INSERT INTO "${s}".order_items
        (order_id, product_id, product_name, product_sku, price, quantity, supplier_id, supplier_name,
         supplier_slug, product_catalog_reference, product_sku_snapshot, unit_price, line_subtotal, line_total)
       VALUES ($1, $2, 'B2B immutable regression line', $3, 1000, 1, $4, $5, $6, $7, $3, 1000, 1000, 1000)
       RETURNING id`,
      [b2bOrder.id, fixtures.retailProduct.id, b2bProductSnapshot.sku, b2bProductSnapshot.supplier_id,
        b2bProductSnapshot.supplier_name, b2bProductSnapshot.supplier_slug, b2bProductSnapshot.catalog_reference],
    )).rows[0]!;
    await assert.rejects(
      q(`UPDATE "${s}".order_items SET unit_price=1001 WHERE id=$1`, [b2bLine.id]),
      (error: unknown) => error instanceof Error
        && error.message === "Order item commercial snapshot is immutable",
      "B2B immutable updates fail with the intended exception rather than a missing retail aftercare field",
    );
    await assert.rejects(
      q(`UPDATE "${s}".retail_order_items SET personalized_treatment_bundle_discount_rsd=1 WHERE order_id=$1`, [evidenceOrder.order_id]),
      (error: unknown) => error instanceof Error
        && error.message === "Order item commercial snapshot is immutable",
      "retail aftercare allocation updates are protected by its separate trigger",
    );
    await assert.rejects(
      q(`UPDATE "${s}".retail_order_items SET aftercare_recommendation_id=NULL WHERE order_id=$1`, [evidenceOrder.order_id]),
      (error: unknown) => error instanceof Error
        && error.message === "Order item commercial snapshot is immutable",
      "retail aftercare evidence references are protected by its separate trigger",
    );

    console.log("Business Growth schema rollout legacy-upgrade test passed.");
  } finally {
    await q(`SET search_path TO "$user", public`).catch(() => {});
    await q(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`).catch(() => {});
    await pool.end();
  }
}

await run();
