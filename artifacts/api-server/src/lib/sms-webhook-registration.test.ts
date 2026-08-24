/**
 * Infobip SMS delivery-report webhook registration check — regression suite
 *
 * Infobip's public API cannot list the account-level delivery-report webhook
 * URL, so the SMS registration check cannot mirror Brevo's provider-side
 * listing. Instead it derives an evidence-based verdict
 * (smsWebhookRegistrationState) from what the app CAN verify: whether a
 * webhook secret is saved, when it was last saved, the last accepted VERIFIED
 * real report (admin self-check batches never count), and the delivery-report
 * silence warning. A regression here would either tell admins their
 * registration is fine when Infobip is silently rejecting reports (stale
 * secret / wrong domain), or cry wolf when there simply were no recent SMS
 * sends — the exact ambiguity the check exists to remove.
 *
 * The suite verifies:
 *   1. every branch of the pure smsWebhookRegistrationState classifier,
 *      including precedence (no secret → confirmed-since-save vs. newer
 *      silence → stale secret regardless of warning → warning → unconfirmed)
 *   2. the POST /admin/integrations/sms/verify-registration route: admin-only
 *      access, missing-secret 400 without a self-check, 200 verified:true for
 *      a provider-confirmed registration, 200 verified:false (NOT an error)
 *      when there is no traffic to judge by, and 409 for the misconfigured
 *      and stale-secret verdicts — so "misconfigured" is always
 *      distinguishable from "no recent SMS sends"
 *   3. the loopback self-check runs inside the route without bumping the
 *      real-report receipt (synthetic verification events never count as
 *      provider confirmation)
 *   4. GET /admin/integrations exposes the same standing verdict for the
 *      admin page panel
 *   5. cross-origin instructions: from a production-looking origin failure
 *      verdicts name this deployment's URL shape; from a development/preview
 *      origin they name the published-domain placeholder and qualify the
 *      finding — and the saved secret never appears in any response body
 *   6. saveIntegrationSettings only bumps updatedAt of rows whose value was
 *      actually written — saving an unrelated field, toggling enabled, or
 *      re-saving the identical secret must not make the webhook secret look
 *      freshly changed (that timestamp is the anchor of the stale-secret
 *      verdict)
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/sms-webhook-registration.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  integrationSettingsTable,
  pool,
  providerWebhookReceiptsTable,
  salonCustomersTable,
  salonsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  deliveryReportStatuses,
  resolveWebhookSecret,
  smsWebhookRegistrationState,
  webhookSecretSavedAt,
} from "./provider-events";
import { saveIntegrationSettings } from "./integrations";

const suffix = randomUUID().slice(0, 8);
const cleanup = { userIds: [] as string[], salonIds: [] as string[] };

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Receipt manipulation: recordWebhookReceipt is GREATEST-monotonic, so tests
// control the infobip row directly (delete + insert) and restore the exact
// prior row afterwards.
// ---------------------------------------------------------------------------

async function infobipReceipt(): Promise<Date | null> {
  const [row] = await db.select({ lastEventAt: providerWebhookReceiptsTable.lastEventAt })
    .from(providerWebhookReceiptsTable)
    .where(eq(providerWebhookReceiptsTable.provider, "infobip")).limit(1);
  return row?.lastEventAt ?? null;
}

async function setInfobipReceipt(lastEventAt: Date | null) {
  await db.delete(providerWebhookReceiptsTable).where(eq(providerWebhookReceiptsTable.provider, "infobip"));
  if (lastEventAt) {
    await db.insert(providerWebhookReceiptsTable).values({ provider: "infobip", lastEventAt });
  }
}

async function run() {
  // ── 1. Pure classifier: every branch and precedence ──────────────────────
  {
    const now = new Date();
    const earlier = new Date(now.getTime() - 2 * HOUR_MS);
    const state = smsWebhookRegistrationState;

    assert.equal(state({ secretSaved: false, secretSavedAt: null, lastEventAt: now, reportWarning: false }), "no_secret",
      "no secret wins over any other evidence");
    assert.equal(state({ secretSaved: false, secretSavedAt: null, lastEventAt: null, reportWarning: true }), "no_secret");

    assert.equal(state({ secretSaved: true, secretSavedAt: earlier, lastEventAt: now, reportWarning: false }), "confirmed",
      "real report after the secret save confirms the registration");
    assert.equal(state({ secretSaved: true, secretSavedAt: now, lastEventAt: now, reportWarning: false }), "confirmed",
      "report at exactly the save instant still counts (>=)");
    assert.equal(state({ secretSaved: true, secretSavedAt: null, lastEventAt: earlier, reportWarning: false }), "confirmed",
      "env-fallback secret (age unknown): any real report confirms");

    assert.equal(state({ secretSaved: true, secretSavedAt: earlier, lastEventAt: now, reportWarning: true }), "misconfigured",
      "silence NEWER than the confirmation means the registration broke after it");
    assert.equal(state({ secretSaved: true, secretSavedAt: null, lastEventAt: earlier, reportWarning: true }), "misconfigured");

    assert.equal(state({ secretSaved: true, secretSavedAt: now, lastEventAt: earlier, reportWarning: false }), "stale_secret",
      "report older than the secret change proves nothing about the current token");
    assert.equal(state({ secretSaved: true, secretSavedAt: now, lastEventAt: earlier, reportWarning: true }), "stale_secret",
      "stale secret explains the silence — it wins over the generic warning");

    assert.equal(state({ secretSaved: true, secretSavedAt: earlier, lastEventAt: null, reportWarning: true }), "misconfigured",
      "never-confirmed + silent despite sends = misconfigured");
    assert.equal(state({ secretSaved: true, secretSavedAt: earlier, lastEventAt: null, reportWarning: false }), "unconfirmed",
      "no report and no qualifying sends: nothing to judge by — NOT an error");
    assert.equal(state({ secretSaved: true, secretSavedAt: null, lastEventAt: null, reportWarning: false }), "unconfirmed");
    console.log("✓ pure classifier: all branches and precedence pinned");
  }

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  const prodHost = `lumera-prod-${suffix}.example.com`;
  const devHost = `swr-${suffix}.riker.replit.dev`;
  const origin = `https://${prodHost}`;
  const expectedHint = `${origin}/api/webhooks/infobip/<tajna>`;
  const publishedHint = "https://<domen-objavljene-aplikacije>/api/webhooks/infobip/<tajna>";

  // Host spoofing (fetch forbids it) via node:http; X-Forwarded-Proto is
  // honored through trust proxy — mirrors the Brevo registration suite.
  const requestWithHost = (path: string, options: { method?: string; host?: string; cookie?: string }) =>
    new Promise<{ status: number; raw: string }>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
        headers: {
          host: options.host ?? prodHost,
          "x-forwarded-proto": "https",
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, raw }));
      });
      req.on("error", reject);
      req.end();
    });

  // Snapshots for exact restoration: the infobip receipt row and every sms
  // integration_settings row (tests rewrite the webhookSecret and its
  // updatedAt; restoring the encrypted rows verbatim preserves the admin's
  // configuration byte for byte).
  const priorReceipt = await db.select().from(providerWebhookReceiptsTable)
    .where(eq(providerWebhookReceiptsTable.provider, "infobip"));
  const priorSmsRows = await db.select().from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, "sms"));

  const savedEnvSecret = process.env["SMS_WEBHOOK_SECRET"];
  const secretsToScan: string[] = [];
  const responseBodies: string[] = [];

  try {
    // ── Fixtures: admin (route requires it) + non-admin for access control ─
    const [admin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "SWR",
      email: `swr-admin-${suffix}@bg.test`, passwordHash: await hashPassword(`swr-admin-${suffix}`),
      passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    const [customer] = await db.insert(usersTable).values({
      firstName: "Kupac", lastName: "SWR",
      email: `swr-customer-${suffix}@bg.test`, passwordHash: await hashPassword(`swr-customer-${suffix}`),
      passwordSetAt: new Date(), role: "CUSTOMER",
    }).returning();
    assert.ok(admin && customer);
    cleanup.userIds.push(admin.id, customer.id);
    const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
    const customerCookie = `${sessionCookieName}=${await createSession(customer.id)}`;

    const verify = async (cookie?: string, host?: string) => {
      const { status, raw } = await requestWithHost("/api/admin/integrations/sms/verify-registration", {
        method: "POST", cookie, host,
      });
      responseBodies.push(raw);
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON */ }
      return { status, raw, body };
    };
    const errorOf = (result: { body: Record<string, unknown> | null }) => String(result.body?.["error"] ?? "");
    const messageOf = (result: { body: Record<string, unknown> | null }) => String(result.body?.["message"] ?? "");
    const registrationBlock = async () => {
      const { status, raw } = await requestWithHost("/api/admin/integrations", { cookie: adminCookie });
      responseBodies.push(raw);
      assert.equal(status, 200, "admin integrations page data must load");
      const body = JSON.parse(raw) as { smsWebhookRegistration?: { state: string; secretSavedAt: string | null; lastReportAt: string | null } };
      assert.ok(body.smsWebhookRegistration, "GET /admin/integrations must expose the standing sms registration verdict");
      return body.smsWebhookRegistration;
    };

    // ── 2. Access control ────────────────────────────────────────────────
    {
      const anonymous = await verify(undefined);
      assert.equal(anonymous.status, 401, "anonymous check must be rejected");
      const forbidden = await verify(customerCookie);
      assert.equal(forbidden.status, 403, "non-admin check must be rejected");
      console.log("✓ registration check is admin-only");
    }

    // ── 3. Missing secret → local 400 (no self-check possible) ────────────
    {
      delete process.env["SMS_WEBHOOK_SECRET"];
      if (!(await resolveWebhookSecret("sms"))) {
        const missing = await verify(adminCookie);
        assert.equal(missing.status, 400, "missing secret must be a local 400");
        assert.ok(errorOf(missing).includes("Webhook tajna nije sačuvana"),
          `missing secret surfaces its own instruction (got: ${missing.raw})`);
        console.log("✓ missing webhook secret surfaces its own 400 message");
      } else {
        console.log("• missing-secret branch skipped (database webhookSecret configured)");
      }
      if (savedEnvSecret !== undefined) process.env["SMS_WEBHOOK_SECRET"] = savedEnvSecret;
    }

    // Deterministic secret for the rest of the suite (env fallback, unless an
    // admin-configured database webhookSecret takes precedence).
    process.env["SMS_WEBHOOK_SECRET"] ??= `swr-secret-${suffix}`;
    const baseSecret = await resolveWebhookSecret("sms");
    assert.ok(baseSecret, "webhook secret must resolve for the verdict suite");
    secretsToScan.push(baseSecret);

    // ── 4. Unconfirmed: no report, no qualifying sends → 200, NOT an error ─
    // Only assertable when the shared development database has no ambient
    // grace-aged sms sends inside the freshness window.
    {
      await setInfobipReceipt(null);
      const ambient = (await deliveryReportStatuses()).infobip;
      if (!ambient.warning && ambient.lastEventAt === null) {
        const unconfirmed = await verify(adminCookie);
        assert.equal(unconfirmed.status, 200, `no-traffic verdict must NOT be an error (got: ${unconfirmed.raw})`);
        assert.equal(unconfirmed.body?.["verified"], false);
        assert.equal(unconfirmed.body?.["state"], "unconfirmed");
        assert.ok(messageOf(unconfirmed).includes("nema nedavnih automatskih SMS poruka"),
          "no-traffic verdict explains itself instead of alarming");
        assert.ok(messageOf(unconfirmed).includes(expectedHint),
          `production-origin instruction names this deployment's URL shape (got: ${unconfirmed.raw})`);
        assert.ok(!messageOf(unconfirmed).includes("razvojne adrese"), "no dev qualification from a production origin");

        const devUnconfirmed = await verify(adminCookie, devHost);
        assert.equal(devUnconfirmed.status, 200);
        assert.ok(messageOf(devUnconfirmed).includes(publishedHint),
          `development-origin instruction names the published-domain placeholder (got: ${devUnconfirmed.raw})`);
        assert.ok(messageOf(devUnconfirmed).includes("razvojne adrese"),
          "development-origin verdict is qualified as development-relative");
        assert.equal((await registrationBlock()).state, "unconfirmed");
        console.log("✓ no recent sends → 200 verified:false with guided setup, on both origins");
      } else {
        console.log("• unconfirmed branch skipped (ambient sms traffic in the development database)");
      }
    }

    // ── 5. Misconfigured: grace-aged send, no report → 409, distinguishable ─
    const [owner] = await db.insert(usersTable).values({
      firstName: "Owner", lastName: "SWR",
      email: `swr-owner-${suffix}@bg.test`, passwordHash: await hashPassword(`swr-owner-${suffix}`),
      passwordSetAt: new Date(), role: "SALON_OWNER",
    }).returning();
    assert.ok(owner);
    cleanup.userIds.push(owner.id);
    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id, name: `SWR Salon ${suffix}`, slug: `swr-salon-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
      phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
      email: `swr-salon-${suffix}@bg.test`,
      shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
    }).returning();
    assert.ok(salon);
    cleanup.salonIds.push(salon.id);
    const [salonCustomer] = await db.insert(salonCustomersTable).values({
      salonId: salon.id, firstName: "Kupac", lastName: "SWR", email: `swr-cust-${suffix}@bg.test`,
    }).returning();
    const [rule] = await db.insert(automationRulesTable).values({
      salonId: salon.id, name: `SWR pravilo ${suffix}`, trigger: "inactive_days",
      triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
    }).returning();
    assert.ok(salonCustomer && rule);
    const sentAt = new Date(Date.now() - 2 * HOUR_MS); // inside the 24h window, past the 30min grace
    const [smsRun] = await db.insert(automationRunsTable).values({
      eventKey: `swr-run-${suffix}`, ruleId: rule.id, salonId: salon.id, salonCustomerId: salonCustomer.id,
      status: "sent", executedAt: sentAt, sentAt,
    }).returning();
    assert.ok(smsRun);
    await db.insert(automationDeliveriesTable).values({
      runId: smsRun.id, salonId: salon.id, eventKey: `swr-run-${suffix}:sms`, channel: "sms",
      recipientPhone: "+381601234567", status: "sent", sentAt,
    });
    {
      await setInfobipReceipt(null);
      const misconfigured = await verify(adminCookie);
      assert.equal(misconfigured.status, 409, `silence despite sends must be an actionable conflict (got: ${misconfigured.raw})`);
      assert.equal(misconfigured.body?.["state"], "misconfigured", `misconfigured state expected (got: ${misconfigured.raw})`);
      assert.ok(errorOf(misconfigured).includes("nije dostavio nijedan izveštaj"),
        "misconfigured verdict names the silence, not a generic failure");
      assert.ok(errorOf(misconfigured).includes("probni događaj je prihvaćen"),
        "verdict confirms the endpoint itself works — the problem is provider-side");
      assert.ok(errorOf(misconfigured).includes(expectedHint), "verdict carries the guided URL shape");
      assert.equal((await registrationBlock()).state, "misconfigured");
      console.log("✓ recent sends without reports → 409 misconfigured (distinct from no-traffic)");
    }

    // ── 6. Confirmed: real report after the secret save → 200 verified ─────
    {
      const reportAt = new Date();
      await setInfobipReceipt(reportAt);
      const confirmed = await verify(adminCookie);
      assert.equal(confirmed.status, 200, `provider-confirmed registration must verify (got: ${confirmed.raw})`);
      assert.equal(confirmed.body?.["verified"], true);
      assert.equal(confirmed.body?.["state"], "confirmed");
      assert.ok(messageOf(confirmed).includes("potvrđena"), "confirmation message states the proof");
      // The route's loopback self-check posts a synthetic verification event —
      // it must never count as provider confirmation.
      const receiptAfter = await infobipReceipt();
      assert.equal(receiptAfter?.getTime(), reportAt.getTime(),
        "the self-check's synthetic event must not advance the real-report receipt");
      assert.equal((await registrationBlock()).state, "confirmed");
      console.log("✓ real report after secret save → 200 verified:true; synthetic self-check never counts");
    }

    // ── 7. Stale secret: secret saved AFTER the last confirmed report ──────
    const staleSecret = `swr-new-secret-${suffix}`;
    secretsToScan.push(staleSecret);
    {
      await saveIntegrationSettings({
        integration: "sms", enabled: true,
        values: { webhookSecret: staleSecret }, updatedByUserId: admin.id,
      });
      assert.equal(await resolveWebhookSecret("sms"), staleSecret, "database secret must take precedence");
      await setInfobipReceipt(new Date(Date.now() - 3 * HOUR_MS));
      const stale = await verify(adminCookie);
      assert.equal(stale.status, 409, `stale-secret verdict must be an actionable conflict (got: ${stale.raw})`);
      assert.equal(stale.body?.["state"], "stale_secret");
      assert.ok(errorOf(stale).includes("staru tajnu"), "verdict explains the old-token diagnosis");
      assert.ok(errorOf(stale).includes(expectedHint), "verdict carries the guided URL shape");
      assert.equal((await registrationBlock()).state, "stale_secret");
      console.log("✓ report older than the secret change → 409 stale_secret");
    }

    // ── 8. updatedAt semantics: only written values bump their row ─────────
    {
      const before = await webhookSecretSavedAt("sms");
      assert.ok(before, "webhookSecret row must exist after the stale-secret save");
      await new Promise((resolve) => setTimeout(resolve, 25));
      await saveIntegrationSettings({
        integration: "sms", enabled: false,
        values: { senderName: `SWR-${suffix}` }, updatedByUserId: admin.id,
      });
      const after = await webhookSecretSavedAt("sms");
      assert.equal(after?.getTime(), before.getTime(),
        "saving an unrelated field / toggling enabled must not make the secret look freshly changed");
      const [senderRow] = await db.select().from(integrationSettingsTable).where(and(
        eq(integrationSettingsTable.integration, "sms"),
        eq(integrationSettingsTable.settingKey, "senderName"),
      ));
      assert.ok(senderRow && senderRow.updatedAt.getTime() > before.getTime(),
        "the actually-written row does carry a fresh updatedAt");

      // A real report that arrives before an identical secret re-save must
      // continue to confirm the registration. If the no-op save bumped
      // updatedAt, the same evidence would incorrectly become stale_secret.
      const reportAt = new Date();
      await setInfobipReceipt(reportAt);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await saveIntegrationSettings({
        integration: "sms", enabled: false,
        values: { webhookSecret: staleSecret }, updatedByUserId: admin.id,
      });
      const afterIdenticalSecret = await webhookSecretSavedAt("sms");
      assert.equal(afterIdenticalSecret?.getTime(), before.getTime(),
        "re-saving the identical secret must leave its updatedAt untouched");
      assert.equal((await registrationBlock()).state, "confirmed",
        "a confirmed registration must stay confirmed after an identical secret re-save");
      console.log("✓ webhookSecret updatedAt moves only when the secret itself changes");
    }

    // ── 9. Integration saves roll back every SMS row on failure ─────────────
    {
      const beforeRows = await db.select().from(integrationSettingsTable)
        .where(eq(integrationSettingsTable.integration, "sms"));
      await assert.rejects(
        () => saveIntegrationSettings({
          integration: "sms",
          enabled: !Boolean(beforeRows[0]?.enabled),
          // The first field is written before the second field fails. The
          // transaction must roll back the value, timestamp, and enabled flag.
          values: {
            senderName: `SWR-rollback-${suffix}`,
            apiKey: undefined as unknown as string,
          },
          updatedByUserId: admin.id,
        }),
        TypeError,
      );
      const afterRows = await db.select().from(integrationSettingsTable)
        .where(eq(integrationSettingsTable.integration, "sms"));
      assert.deepEqual(afterRows, beforeRows,
        "a failed SMS save must leave every value, timestamp, and enabled state unchanged");
      console.log("✓ failed SMS integration save rolls back all prior writes");
    }

    // ── 10. No response ever leaks a secret ─────────────────────────────────
    {
      for (const secret of secretsToScan) {
        for (const body of responseBodies) {
          assert.ok(!body.includes(secret), "response bodies must never contain a webhook secret");
        }
      }
      assert.ok(responseBodies.some((body) => body.includes("<tajna>")),
        "instructions use the <tajna> placeholder instead of the secret");
      console.log("✓ no response body leaks a webhook secret");
    }

    console.log("\nAll SMS webhook registration checks passed.");
  } finally {
    // Restore the sms integration rows byte for byte, then the receipt row.
    await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.integration, "sms"));
    if (priorSmsRows.length) await db.insert(integrationSettingsTable).values(priorSmsRows);
    await db.delete(providerWebhookReceiptsTable).where(eq(providerWebhookReceiptsTable.provider, "infobip"));
    if (priorReceipt.length) await db.insert(providerWebhookReceiptsTable).values(priorReceipt);
    if (savedEnvSecret !== undefined) process.env["SMS_WEBHOOK_SECRET"] = savedEnvSecret;
    else delete process.env["SMS_WEBHOOK_SECRET"];
    // Salon cascade removes the customer, rule, run, and delivery fixtures.
    if (cleanup.salonIds.length) await db.delete(salonsTable).where(eq(salonsTable.id, cleanup.salonIds[0]!));
    for (const userId of cleanup.userIds) await db.delete(usersTable).where(eq(usersTable.id, userId));
    server.close();
    await pool.end();
  }
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
