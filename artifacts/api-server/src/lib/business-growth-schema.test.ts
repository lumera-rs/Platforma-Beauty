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
  await q(`CREATE TABLE "${schema}".users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL
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
  await q(`CREATE TABLE "${schema}".salon_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE,
    display_name text NOT NULL
  )`);
  await q(`CREATE TABLE "${schema}".appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id uuid NOT NULL REFERENCES "${schema}".salons(id) ON DELETE CASCADE
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

  // Populate legacy rows that MUST survive the upgrade.
  const salon = (await q<{ id: string }>(`INSERT INTO "${schema}".salons (name) VALUES ('Legacy Salon') RETURNING id`)).rows[0]!;
  const user = (await q<{ id: string }>(`INSERT INTO "${schema}".users (email) VALUES ('legacy@bg.test') RETURNING id`)).rows[0]!;
  const employee = (await q<{ id: string }>(`INSERT INTO "${schema}".employees (salon_id, name) VALUES ($1, 'Emp') RETURNING id`, [salon.id])).rows[0]!;
  const service = (await q<{ id: string }>(`INSERT INTO "${schema}".services (salon_id, name) VALUES ($1, 'Svc') RETURNING id`, [salon.id])).rows[0]!;
  const customer = (await q<{ id: string }>(`INSERT INTO "${schema}".salon_customers (salon_id, display_name) VALUES ($1, 'Cust') RETURNING id`, [salon.id])).rows[0]!;
  const appointment = (await q<{ id: string }>(`INSERT INTO "${schema}".appointments (salon_id) VALUES ($1) RETURNING id`, [salon.id])).rows[0]!;
  await q(`INSERT INTO "${schema}".reviews (salon_id, customer_id, service_name, rating, text) VALUES ($1, $2, 'Svc', 5, 'Great')`, [salon.id, user.id]);
  // Legacy row uses an OLD message_type label (automation did not exist yet).
  await q(`INSERT INTO "${schema}".sms_deliveries (event_key, salon_id, message_type, recipient_phone, body, status) VALUES ('legacy-sms-1', $1, 'appointment_confirmation', '+381600000000', 'Zdravo', 'sent')`, [salon.id]);

  return { salon, user, employee, service, customer, appointment };
}

async function run() {
  const s = TEST_SCHEMA;
  try {
    const fixtures = await seedLegacySchema(s);

    // ── Run the rollout TWICE (idempotency) ────────────────────────────────
    const client = await pool.connect();
    try {
      await runBusinessGrowthSchemaDdl(client, s);
      await runBusinessGrowthSchemaDdl(client, s); // second run must be a no-op
    } finally {
      await client.query(`SET search_path TO "$user", public`).catch(() => {});
      client.release();
    }

    // Reset connection search_path for our raw assertions (pool client rotates).
    await q(`SET search_path TO "${s}"`);

    // ── Legacy rows preserved ──────────────────────────────────────────────
    const smsCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".sms_deliveries`)).rows[0]!.n;
    assert.equal(smsCount, "1", "legacy sms_deliveries row preserved");
    const reviewCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".reviews`)).rows[0]!.n;
    assert.equal(reviewCount, "1", "legacy reviews row preserved");
    const custCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".salon_customers`)).rows[0]!.n;
    assert.equal(custCount, "1", "legacy salon_customers row preserved");

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
      "education_waitlist_offer", "education_session_cancelled", "automation",
    ]) {
      assert.ok(messageTypeLabels.includes(label), `sms_message_type now includes '${label}'`);
    }
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
    assert.ok(await columnExists("reviews", "employee_id"), "reviews.employee_id added");
    assert.ok(await columnExists("sms_deliveries", "processing_started_at"), "sms_deliveries.processing_started_at added");
    assert.ok(await columnExists("sms_deliveries", "submission_started_at"), "sms_deliveries.submission_started_at added");
    assert.ok(await columnExists("sms_deliveries", "claim_expires_at"), "sms_deliveries.claim_expires_at added");
    assert.ok(await columnExists("automation_runs", "sent_at"), "automation_runs.sent_at present");
    assert.ok(await columnExists("automation_deliveries", "claim_expires_at"), "automation_deliveries.claim_expires_at present");

    // ── Key indexes ────────────────────────────────────────────────────────
    async function indexExists(name: string) {
      return objectExists(
        `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2) AS exists`,
        [s, name],
      );
    }
    for (const idx of [
      "reviews_employee_visible_idx",
      "sms_deliveries_claim_expiry_idx",
      "automation_runs_cooldown_idx",
      "automation_deliveries_claim_expiry_idx",
      "package_redemptions_purchase_appointment_unique",
      "employee_commission_settings_employee_unique",
      "customer_package_purchases_status_idx",
    ]) {
      assert.ok(await indexExists(idx), `index ${idx} exists`);
    }

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
