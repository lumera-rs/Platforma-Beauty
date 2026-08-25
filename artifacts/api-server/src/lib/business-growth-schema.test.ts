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
import { runBusinessGrowthSchemaDdl } from "./business-growth-schema";

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
  await q(`CREATE TABLE "${schema}".services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    name text NOT NULL
  )`);
  // Legacy catalog table before customer-safe public storefront fields.
  // The upgrade must add those fields without exposing B2B description/prices.
  await q(`CREATE TABLE "${schema}".products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
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
  // Existing core commerce dependency used by phase-3 inventory movements.
  await q(`CREATE TABLE "${schema}".orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
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
  const retailProduct = (await q<{ id: string }>(
    `INSERT INTO "${schema}".products (name, description) VALUES ('Legacy retail product', 'Legacy retail description') RETURNING id`,
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
    const fixtures = await seedLegacySchema(s);

    // ── Run the rollout, then exercise its legacy conversion on rerun ──────
    const client = await pool.connect();
    try {
      await runBusinessGrowthSchemaDdl(client, s);
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
      await runBusinessGrowthSchemaDdl(client, s); // conversion is idempotent
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
    for (const column of ["retail_enabled", "professional_enabled", "public_description", "public_price", "public_discount_price", "catalog_reference"]) {
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
      ["customer_package_purchases_payment_confirmed_by_idx", "payment_confirmed_by_user_id"],
      ["customer_package_purchases_customer_idx", "salon_customer_id"],
      ["employee_commission_settings_updated_by_idx", "updated_by_user_id"],
      ["package_purchase_service_links_service_idx", "service_id"],
      ["package_redemptions_reversed_by_idx", "reversed_by_user_id"],
      ["package_redemptions_customer_idx", "salon_customer_id"],
      ["platform_retention_settings_changed_by_idx", "changed_by_user_id"],
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

    console.log("Business Growth schema rollout legacy-upgrade test passed.");
  } finally {
    await q(`SET search_path TO "$user", public`).catch(() => {});
    await q(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`).catch(() => {});
    await pool.end();
  }
}

await run();
