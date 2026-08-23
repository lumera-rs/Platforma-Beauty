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
  const employee = (await q<{ id: string }>(`INSERT INTO "${schema}".employees (salon_id, name) VALUES ($1, 'Emp') RETURNING id`, [salon.id])).rows[0]!;
  const service = (await q<{ id: string }>(`INSERT INTO "${schema}".services (salon_id, name) VALUES ($1, 'Svc') RETURNING id`, [salon.id])).rows[0]!;
  const customer = (await q<{ id: string }>(`INSERT INTO "${schema}".salon_customers (salon_id, display_name) VALUES ($1, 'Cust') RETURNING id`, [salon.id])).rows[0]!;
  const appointment = (await q<{ id: string }>(`INSERT INTO "${schema}".appointments (salon_id) VALUES ($1) RETURNING id`, [salon.id])).rows[0]!;
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
    const emailCount = (await q<{ n: string }>(`SELECT count(*)::text AS n FROM "${s}".email_deliveries`)).rows[0]!.n;
    assert.equal(emailCount, "1", "legacy email_deliveries row preserved");

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
    assert.ok(await columnExists("reviews", "employee_id"), "reviews.employee_id added");
    assert.ok(await columnExists("sms_deliveries", "processing_started_at"), "sms_deliveries.processing_started_at added");
    assert.ok(await columnExists("sms_deliveries", "submission_started_at"), "sms_deliveries.submission_started_at added");
    assert.ok(await columnExists("sms_deliveries", "claim_expires_at"), "sms_deliveries.claim_expires_at added");
    assert.ok(await columnExists("automation_runs", "sent_at"), "automation_runs.sent_at present");
    assert.ok(await columnExists("automation_deliveries", "claim_expires_at"), "automation_deliveries.claim_expires_at present");
    assert.ok(await columnExists("automation_deliveries", "failed_at"), "automation_deliveries.failed_at present (provider webhook failure state)");
    // v5: delivery-report freshness tracking (mirrors providerWebhookReceiptsTable).
    for (const column of ["provider", "last_event_at", "updated_at"]) {
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
      "sms_deliveries_claim_expiry_idx",
      "automation_runs_cooldown_idx",
      "automation_deliveries_claim_expiry_idx",
      "package_redemptions_purchase_appointment_unique",
      "employee_commission_settings_employee_unique",
      "customer_package_purchases_status_idx",
      "platform_retention_settings_version_unique",
      "email_deliveries_report_alert_history_idx",
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
