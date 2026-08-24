/**
 * Automation provider delivery events — regression suite
 *
 * Verifies that the Brevo (email) and Infobip (SMS) webhook endpoints:
 *   1. reject forged / invalid tokens (401) and unconfigured secrets (503)
 *      without any state change
 *   2. idempotently update automation deliveries to delivered/opened/failed
 *      (duplicate events are no-ops; out-of-order events never regress state)
 *   3. never modify automation_deliveries.status (no worker-resend hazard)
 *   4. never leak across salons: matching is by globally-unique provider
 *      message reference of a persisted outbound send, and forged references
 *      touch nothing
 *   5. feed accurate per-salon / per-rule delivered + opened counts into the
 *      owner stats endpoint, including per-channel counts (SMS has no opens)
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/automation-provider-events.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  emailDeliveriesTable,
  observeDatabaseQueries,
  pool,
  providerWebhookReceiptsTable,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  smsDeliveriesTable,
  usersTable,
} from "@workspace/db";
import app, { safePathname, redactPathSecrets } from "../app";
import {
  CAMPAIGN_APPOINTMENT_STATUS_BUCKETS,
  getCampaignAppointmentStatusBucket,
} from "../routes/growth";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  applyBrevoEvents,
  applyInfobipReports,
  deliveryReportStatuses,
  deliveryReportWarning,
  malformedWebhookState,
  missingBrevoWebhookEvents,
  recordWebhookRejection,
  recordWebhookReceipt,
  resolveWebhookSecret,
  WEBHOOK_REJECTION_ALERT_THRESHOLD,
  WEBHOOK_REJECTION_WINDOW_HOURS,
  WEBHOOK_VERIFICATION_REFERENCE_PREFIX,
  type DeliveryReportProvider,
  type DeliveryReportStatus,
} from "./provider-events";
import {
  DELIVERY_REPORT_ALERT_COOLDOWN_MS,
  DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX,
  MALFORMED_WEBHOOK_ALERT_COOLDOWN_MS,
  malformedWebhookAlertProviders,
  runDeliveryReportRecoveryAlerts,
  runDeliveryReportSilenceAlerts,
  runMalformedWebhookAlerts,
  staleDeliveryReportProviders,
} from "./delivery-report-alerts";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { BREVO_WEBHOOK_EVENTS, type TransactionalEmailTransport } from "./brevo";
import type { SmsProvider } from "./sms";

const suffix = randomUUID().slice(0, 8);
const cleanup = {
  userIds: [] as string[],
  salonIds: [] as string[],
  emailEventKeys: [] as string[],
  smsEventKeys: [] as string[],
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeOwnerAndSalon(tag: string) {
  const hash = await hashPassword(`pass-${tag}-${suffix}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Owner", lastName: tag,
    email: `pe-owner-${tag}-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  cleanup.userIds.push(owner.id);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `PE Salon ${tag} ${suffix}`, slug: `pe-salon-${tag}-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
    email: `pe-salon-${tag}-${suffix}@bg.test`,
    shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
  }).returning();
  assert.ok(salon);
  cleanup.salonIds.push(salon.id);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const token = await createSession(owner.id);
  return { owner, salon, token };
}

/**
 * Create one confirmed-sent automation run with an email and an SMS delivery,
 * mirroring exactly what the automation worker persists after a send:
 *   - automation_deliveries rows (status 'sent', per-channel event keys)
 *   - the outbound email_deliveries row holding the Brevo providerMessageId
 *   - the outbound sms_deliveries row whose stable id is the Infobip messageId
 */
async function makeSentRun(salonId: string, ruleId: string, customerId: string, tag: string) {
  const runKey = `pe-run-${tag}-${suffix}`;
  const [run] = await db.insert(automationRunsTable).values({
    eventKey: runKey, ruleId, salonId, salonCustomerId: customerId,
    status: "sent", executedAt: new Date(), sentAt: new Date(),
  }).returning();
  assert.ok(run);

  const emailKey = `${runKey}:email`;
  const smsKey = `${runKey}:sms`;
  const brevoMessageId = `<pe-${tag}-${suffix}@smtp-relay.mailin.fr>`;

  const [emailDelivery] = await db.insert(automationDeliveriesTable).values({
    runId: run.id, salonId, eventKey: emailKey, channel: "email",
    recipientEmail: `pe-${tag}-${suffix}@bg.test`, status: "sent", sentAt: new Date(),
  }).returning();
  const [smsDelivery] = await db.insert(automationDeliveriesTable).values({
    runId: run.id, salonId, eventKey: smsKey, channel: "sms",
    recipientPhone: "+381601234567", status: "sent", sentAt: new Date(),
  }).returning();
  assert.ok(emailDelivery && smsDelivery);

  cleanup.emailEventKeys.push(emailKey);
  const [outboundEmail] = await db.insert(emailDeliveriesTable).values({
    eventKey: emailKey, emailType: "automation", salonId,
    recipientEmail: `pe-${tag}-${suffix}@bg.test`, subject: "PE test",
    htmlContent: "<p>test</p>", status: "sent", providerMessageId: brevoMessageId, sentAt: new Date(),
  }).returning();
  assert.ok(outboundEmail);

  cleanup.smsEventKeys.push(smsKey);
  const [outboundSms] = await db.insert(smsDeliveriesTable).values({
    eventKey: smsKey, salonId, appointmentId: null, messageType: "automation",
    recipientPhone: "+381601234567", body: "PE test", status: "sent", sentAt: new Date(),
  }).returning();
  assert.ok(outboundSms);
  await db.update(smsDeliveriesTable).set({ providerMessageId: outboundSms.id })
    .where(eq(smsDeliveriesTable.id, outboundSms.id));

  return { run, emailKey, smsKey, brevoMessageId, smsMessageId: outboundSms.id };
}

async function automationDelivery(eventKey: string) {
  const [row] = await db.select().from(automationDeliveriesTable)
    .where(eq(automationDeliveriesTable.eventKey, eventKey)).limit(1);
  assert.ok(row, `automation delivery ${eventKey} must exist`);
  return row;
}

/** Current last-accepted-event timestamp for a provider (null if never). */
async function webhookReceipt(provider: DeliveryReportProvider): Promise<Date | null> {
  const [row] = await db.select({ lastEventAt: providerWebhookReceiptsTable.lastEventAt })
    .from(providerWebhookReceiptsTable)
    .where(eq(providerWebhookReceiptsTable.provider, provider)).limit(1);
  return row?.lastEventAt ?? null;
}

async function webhookRejection(provider: DeliveryReportProvider): Promise<{ count: number; lastRejectedAt: Date | null }> {
  const [row] = await db.select({
    count: providerWebhookReceiptsTable.rejectedPayloadCount,
    lastRejectedAt: providerWebhookReceiptsTable.lastRejectedAt,
  })
    .from(providerWebhookReceiptsTable)
    .where(eq(providerWebhookReceiptsTable.provider, provider)).limit(1);
  return { count: row?.count ?? 0, lastRejectedAt: row?.lastRejectedAt ?? null };
}
async function countDatabaseQueries<T>(operation: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0;
  const stopObserving = observeDatabaseQueries(() => { queries += 1; });
  try {
    return { result: await operation(), queries };
  } finally {
    stopObserving();
  }
}
/**
 * Spawn the logcheck helper as a real child process and capture everything it
 * writes (the app's pino-http + slow-request logs go to its stdout). Returns
 * combined output + exit code so the caller can assert the webhook token was
 * redacted from every emitted log line.
 */
async function captureWebhookLogs(): Promise<{ output: string; exitCode: number | null }> {
  const helperPath = fileURLToPath(new URL("./automation-provider-events.logcheck.ts", import.meta.url));
  const tsxBin = "node_modules/.bin/tsx";
  const [command, args] = existsSync(tsxBin)
    ? [tsxBin, [helperPath]] as const
    : [process.execPath, ["--import", "tsx", helperPath]] as const;
  const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const [exitCode] = (await once(child, "close")) as [number | null];
  return { output, exitCode };
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
async function run() {
  // This direct Express harness bypasses production startup, which normally
  // performs additive schema rollout before webhook routes can query receipts.
  await ensureBusinessGrowthSchema();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const postJson = async (path: string, body: unknown) => {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    try { parsed = await response.json(); } catch { /* non-JSON error body */ }
    return { status: response.status, body: parsed as Record<string, unknown> | null };
  };

  // Receipt tracking is shared monitoring state rather than a salon-scoped
  // fixture. Snapshot it so this suite can exercise accepted and rejected
  // requests without leaking freshness changes into other tests.
  const priorReceiptRows = await db.select().from(providerWebhookReceiptsTable);

  try {
    // ── 0a. Log redaction: token-bearing webhook paths never reach logs ────
    {
      assert.equal(safePathname("/api/webhooks/brevo/super-secret-token?x=1"), "/api/webhooks/brevo/:token");
      assert.equal(safePathname("/api/webhooks/infobip/tok.en_123"), "/api/webhooks/infobip/:token");
      assert.equal(redactPathSecrets("/api/webhooks/brevo/abc"), "/api/webhooks/brevo/:token");
      assert.equal(safePathname("/api/growth/automations/x/stats"), "/api/growth/automations/x/stats", "non-webhook paths untouched");
      console.log("✓ log path redaction masks webhook capability tokens");
    }

    // ── 0a'. Registration event coverage (missingBrevoWebhookEvents) ───────
    {
      // Fully subscribed, Brevo API camelCase names → nothing missing.
      assert.deepEqual(
        missingBrevoWebhookEvents(["delivered", "uniqueOpened", "hardBounce", "softBounce", "blocked", "invalid", "error"]),
        [],
        "camelCase registration names must fully cover the required events",
      );
      // Payload-style snake_case names must count as equivalent.
      assert.deepEqual(
        missingBrevoWebhookEvents(["delivered", "unique_opened", "hard_bounce", "soft_bounce", "blocked", "invalid_email", "error"]),
        [],
        "snake_case event names must fully cover the required events",
      );
      // ANY opened-family event covers the open capability.
      assert.ok(
        !missingBrevoWebhookEvents(["delivered", "opened", "hardBounce", "softBounce", "blocked", "invalid", "error"]).length,
        "plain 'opened' must cover the open capability",
      );
      // "delivered"-only registration silently drops opens and every failure.
      const deliveredOnly = missingBrevoWebhookEvents(["delivered"]);
      assert.equal(deliveredOnly.length, 6, "'delivered' only must miss opens and all five failure events");
      assert.ok(deliveredOnly.some((label) => label.includes("opened")), "missing labels must include opens");
      assert.ok(deliveredOnly.some((label) => label.includes("hardBounce")), "missing labels must include hard bounces");
      // Each failure event is its own capability — hardBounce alone is not enough.
      const partialFailures = missingBrevoWebhookEvents(["delivered", "opened", "hardBounce"]);
      assert.ok(partialFailures.some((label) => label.includes("softBounce")), "softBounce must be reported missing");
      assert.ok(partialFailures.some((label) => label.includes("blocked")), "blocked must be reported missing");
      assert.ok(partialFailures.some((label) => label.includes("error")), "error must be reported missing");
      assert.ok(!partialFailures.some((label) => label.includes("hardBounce")), "subscribed hardBounce must not be reported");
      // Empty events array (missing/malformed at Brevo) → everything reported.
      assert.equal(missingBrevoWebhookEvents([]).length, 7, "no events must report every required capability");
      // Irrelevant subscriptions (clicks, spam, …) cover nothing.
      assert.equal(missingBrevoWebhookEvents(["click", "spam", "deferred", "request"]).length, 7, "unrelated events cover nothing");
      // Drift guard: the exact event set the one-click registration submits
      // to Brevo must fully satisfy the registration check — a freshly
      // one-click-registered webhook can never be warned about missing events.
      assert.deepEqual(
        missingBrevoWebhookEvents([...BREVO_WEBHOOK_EVENTS]),
        [],
        "one-click registration event set must pass the registration check with nothing missing",
      );
      console.log("✓ registration event coverage flags missing delivery subscriptions");
    }

    // ── 0b. Unconfigured secret → 503, events never accepted open ──────────
    {
      const savedBrevo = process.env["BREVO_WEBHOOK_SECRET"];
      const savedSms = process.env["SMS_WEBHOOK_SECRET"];
      delete process.env["BREVO_WEBHOOK_SECRET"];
      delete process.env["SMS_WEBHOOK_SECRET"];
      try {
        // Only assertable when no admin-configured database secret exists.
        if (!(await resolveWebhookSecret("brevo"))) {
          const brevo503 = await postJson("/webhooks/brevo/any-token", {
            event: "delivered", "message-id": "<x@y>",
          });
          assert.equal(brevo503.status, 503, "unconfigured Brevo webhook must reject with 503");
        }
        if (!(await resolveWebhookSecret("sms"))) {
          const sms503 = await postJson("/webhooks/infobip/any-token", { results: [] });
          assert.equal(sms503.status, 503, "unconfigured Infobip webhook must reject with 503");
        }
        console.log("✓ unconfigured webhook secrets reject all events (503)");
      } finally {
        if (savedBrevo !== undefined) process.env["BREVO_WEBHOOK_SECRET"] = savedBrevo;
        if (savedSms !== undefined) process.env["SMS_WEBHOOK_SECRET"] = savedSms;
      }
    }

    // Deterministic secrets for the rest of the suite: env fallback is used
    // unless an admin configured a database webhookSecret (in which case
    // resolveWebhookSecret returns it and the test uses that value).
    process.env["BREVO_WEBHOOK_SECRET"] ??= `pe-brevo-secret-${suffix}`;
    process.env["SMS_WEBHOOK_SECRET"] ??= `pe-sms-secret-${suffix}`;
    const brevoSecret = await resolveWebhookSecret("brevo");
    const smsSecret = await resolveWebhookSecret("sms");
    assert.ok(brevoSecret && smsSecret, "webhook secrets must resolve");

    // ── Fixtures: two isolated salons with one sent run each ───────────────
    const a = await makeOwnerAndSalon("a");
    const b = await makeOwnerAndSalon("b");
    const [customerA] = await db.insert(salonCustomersTable).values({
      salonId: a.salon.id, firstName: "Kupac", lastName: "A", email: `pe-cust-a-${suffix}@bg.test`,
    }).returning();
    const [customerB] = await db.insert(salonCustomersTable).values({
      salonId: b.salon.id, firstName: "Kupac", lastName: "B", email: `pe-cust-b-${suffix}@bg.test`,
    }).returning();
    assert.ok(customerA && customerB);
    const [ruleA] = await db.insert(automationRulesTable).values({
      salonId: a.salon.id, name: `PE pravilo A ${suffix}`, trigger: "inactive_days",
      triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
    }).returning();
    const [ruleB] = await db.insert(automationRulesTable).values({
      salonId: b.salon.id, name: `PE pravilo B ${suffix}`, trigger: "inactive_days",
      triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
    }).returning();
    assert.ok(ruleA && ruleB);

    const runA = await makeSentRun(a.salon.id, ruleA.id, customerA.id, "a1");
    const runA2 = await makeSentRun(a.salon.id, ruleA.id, customerA.id, "a2");
    const runA3 = await makeSentRun(a.salon.id, ruleA.id, customerA.id, "a3");
    const runB = await makeSentRun(b.salon.id, ruleB.id, customerB.id, "b1");

    // Baseline receipt state — rejected/malformed requests must not move it.
    const baselineBrevoReceipt = await webhookReceipt("brevo");
    const baselineInfobipReceipt = await webhookReceipt("infobip");
    const suiteStart = new Date();

    // ── 1. Forged / invalid tokens are rejected with no state change ───────
    {
      const forged = await postJson(`/webhooks/brevo/${encodeURIComponent(`${brevoSecret}x`)}`, {
        event: "delivered", "message-id": runA.brevoMessageId, ts_event: Math.floor(Date.now() / 1000),
      });
      assert.equal(forged.status, 401, "forged Brevo token must be rejected");
      const forgedSms = await postJson(`/webhooks/infobip/${encodeURIComponent(`${smsSecret}x`)}`, {
        results: [{ messageId: runA.smsMessageId, status: { groupName: "DELIVERED" }, doneAt: new Date().toISOString() }],
      });
      assert.equal(forgedSms.status, 401, "forged Infobip token must be rejected");
      const untouched = await automationDelivery(runA.emailKey);
      assert.equal(untouched.deliveredAt, null, "forged events must not change state");
      console.log("✓ forged webhook tokens rejected (401), no state change");
    }

    // ── 2. Malformed payloads are rejected after authentication ────────────
    {
      const bad = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, { nope: true });
      assert.equal(bad.status, 400, "malformed Brevo payload must be 400");
      const badSms = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, { results: "x" });
      assert.equal(badSms.status, 400, "malformed Infobip payload must be 400");

      // Neither unconfigured (503), forged (401), nor malformed (400) requests
      // may count as a received delivery report.
      assert.equal(
        (await webhookReceipt("brevo"))?.getTime() ?? null,
        baselineBrevoReceipt?.getTime() ?? null,
        "rejected Brevo requests must not update the receipt timestamp",
      );
      assert.equal(
        (await webhookReceipt("infobip"))?.getTime() ?? null,
        baselineInfobipReceipt?.getTime() ?? null,
        "rejected Infobip requests must not update the receipt timestamp",
      );
      console.log("✓ malformed payloads rejected (400); rejected requests leave receipts untouched");
    }

    // ── 3. Delivered → opened lifecycle + duplicate replays are no-ops ─────
    {
      const deliveredTs = Math.floor(Date.now() / 1000) - 600;
      const first = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": runA.brevoMessageId, ts_event: deliveredTs,
      });
      assert.equal(first.status, 200);
      assert.equal(first.body?.["updated"], 1, "delivered event must update the delivery");
      const afterDelivered = await automationDelivery(runA.emailKey);
      assert.ok(afterDelivered.deliveredAt, "deliveredAt set");
      assert.equal(afterDelivered.deliveredAt.getTime(), deliveredTs * 1000, "deliveredAt uses provider timestamp");
      assert.equal(afterDelivered.openedAt, null);
      assert.equal(afterDelivered.status, "sent", "webhooks must never change lifecycle status");

      // Replay the exact same event — no state change, reported as duplicate.
      const replay = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": runA.brevoMessageId, ts_event: deliveredTs + 300,
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body?.["updated"], 0, "replayed delivered event must not update");
      assert.equal(replay.body?.["duplicates"], 1, "replay reported as duplicate");
      const afterReplay = await automationDelivery(runA.emailKey);
      assert.equal(afterReplay.deliveredAt?.getTime(), deliveredTs * 1000, "original deliveredAt preserved");

      // Open event (array payload) → openedAt set, deliveredAt untouched.
      const opened = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, [
        { event: "unique_opened", "message-id": runA.brevoMessageId, ts_event: deliveredTs + 60 },
      ]);
      assert.equal(opened.body?.["updated"], 1);
      const afterOpened = await automationDelivery(runA.emailKey);
      assert.ok(afterOpened.openedAt, "openedAt set");
      assert.equal(afterOpened.deliveredAt?.getTime(), deliveredTs * 1000);

      // A failure event arriving after delivery must never downgrade.
      const lateFailure = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "hard_bounce", "message-id": runA.brevoMessageId, ts_event: deliveredTs + 900,
      });
      assert.equal(lateFailure.body?.["updated"], 0, "failure after delivery is a no-op");
      const afterLateFailure = await automationDelivery(runA.emailKey);
      assert.equal(afterLateFailure.failedAt, null, "failedAt stays null after confirmed delivery");
      assert.equal(afterLateFailure.status, "sent");
      console.log("✓ email delivered/opened updates idempotent; replays and late failures are no-ops");
    }

    // ── 4. Out-of-order: opened before delivered; delivered can't regress ──
    {
      const openTs = Math.floor(Date.now() / 1000) - 120;
      const opened = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "opened", "message-id": runA2.brevoMessageId, ts_event: openTs,
      });
      assert.equal(opened.body?.["updated"], 1);
      const afterOpened = await automationDelivery(runA2.emailKey);
      assert.equal(afterOpened.openedAt?.getTime(), openTs * 1000);
      assert.equal(afterOpened.deliveredAt?.getTime(), openTs * 1000, "opened backfills deliveredAt");

      const lateDelivered = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": runA2.brevoMessageId, ts_event: openTs - 30,
      });
      assert.equal(lateDelivered.body?.["updated"], 0, "out-of-order delivered after opened is a no-op");
      const final = await automationDelivery(runA2.emailKey);
      assert.equal(final.openedAt?.getTime(), openTs * 1000, "openedAt never regresses");
      console.log("✓ out-of-order events never regress state");
    }

    // ── 5. Failure recorded, then delivery confirmation wins ───────────────
    {
      const bounce = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "soft_bounce", "message-id": runA3.brevoMessageId,
        ts_event: Math.floor(Date.now() / 1000) - 300, reason: "mailbox full",
      });
      assert.equal(bounce.body?.["updated"], 1);
      const afterBounce = await automationDelivery(runA3.emailKey);
      assert.ok(afterBounce.failedAt, "provider failure recorded");
      assert.equal(afterBounce.status, "sent", "status untouched — no worker resend hazard");

      const bounceReplay = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "soft_bounce", "message-id": runA3.brevoMessageId, ts_event: Math.floor(Date.now() / 1000),
      });
      assert.equal(bounceReplay.body?.["updated"], 0, "duplicate failure is a no-op");

      const delivered = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": runA3.brevoMessageId, ts_event: Math.floor(Date.now() / 1000) - 60,
      });
      assert.equal(delivered.body?.["updated"], 1);
      const afterDelivered = await automationDelivery(runA3.emailKey);
      assert.ok(afterDelivered.deliveredAt);
      assert.equal(afterDelivered.failedAt, null, "delivery confirmation clears the failure");
      console.log("✓ provider failures recorded idempotently; delivery confirmation wins");
    }

    // ── 6. Forged message references and non-automation sends match nothing ─
    {
      const unknown = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": `<forged-${suffix}@nowhere>`, ts_event: Math.floor(Date.now() / 1000),
      });
      assert.equal(unknown.body?.["updated"], 0);
      assert.equal(unknown.body?.["unmatched"], 1, "unknown message id is unmatched");

      // A non-automation outbound email with a matching provider id must not map
      // onto automation deliveries.
      const otherKey = `pe-non-automation-${suffix}`;
      cleanup.emailEventKeys.push(otherKey);
      await db.insert(emailDeliveriesTable).values({
        eventKey: otherKey, emailType: "appointment_rescheduled", salonId: a.salon.id,
        recipientEmail: `pe-other-${suffix}@bg.test`, subject: "x", htmlContent: "<p>x</p>",
        status: "sent", providerMessageId: `<pe-non-auto-${suffix}@smtp-relay.mailin.fr>`, sentAt: new Date(),
      });
      const nonAutomation = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": `<pe-non-auto-${suffix}@smtp-relay.mailin.fr>`,
      });
      assert.equal(nonAutomation.body?.["unmatched"], 1, "non-automation email events are unmatched");

      // Unknown / non-terminal event types are ignored.
      const ignored = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "click", "message-id": runA.brevoMessageId,
      });
      assert.equal(ignored.body?.["ignored"], 1, "click events carry no delivery state");
      console.log("✓ forged references unmatched; non-automation and non-terminal events ignored");
    }

    // ── 6b. Mixed batches resolve through ONE matching query per request ───
    {
      // One Brevo request carrying matched + duplicate + unmatched (forged and
      // synthetic self-check) + ignored events: the batched matching must
      // classify each exactly like the per-event path did, and per-event
      // guarded updates must still apply sequentially (the in-batch replay
      // reports duplicate, not updated). Isolated salon so the owner-stats
      // assertions later stay untouched.
      const mix = await makeOwnerAndSalon("mix");
      const [customerMix] = await db.insert(salonCustomersTable).values({
        salonId: mix.salon.id, firstName: "Kupac", lastName: "Mix", email: `pe-cust-mix-${suffix}@bg.test`,
      }).returning();
      assert.ok(customerMix);
      const [ruleMix] = await db.insert(automationRulesTable).values({
        salonId: mix.salon.id, name: `PE pravilo Mix ${suffix}`, trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
      }).returning();
      assert.ok(ruleMix);
      const runA4 = await makeSentRun(mix.salon.id, ruleMix.id, customerMix.id, "mix1");
      const batchTs = Math.floor(Date.now() / 1000) - 300;
      const mixed = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, [
        { event: "delivered", "message-id": runA4.brevoMessageId, ts_event: batchTs },
        { event: "delivered", "message-id": runA4.brevoMessageId, ts_event: batchTs + 120 },
        { event: "delivered", "message-id": `<forged-batch-${suffix}@nowhere>`, ts_event: batchTs },
        { event: "delivered", "message-id": `${WEBHOOK_VERIFICATION_REFERENCE_PREFIX}${suffix}` },
        { event: "click", "message-id": runA4.brevoMessageId },
      ]);
      assert.equal(mixed.status, 200);
      assert.equal(mixed.body?.["processed"], 5);
      assert.equal(mixed.body?.["updated"], 1, "matched event in a mixed batch must update");
      assert.equal(mixed.body?.["duplicates"], 1, "in-batch replay must stay a guarded per-event no-op");
      assert.equal(mixed.body?.["unmatched"], 2, "forged and synthetic self-check references stay unmatched");
      assert.equal(mixed.body?.["ignored"], 1, "non-terminal events stay ignored in a batch");
      const afterMixed = await automationDelivery(runA4.emailKey);
      assert.equal(afterMixed.deliveredAt?.getTime(), batchTs * 1000, "first event's provider timestamp wins");
      assert.equal(afterMixed.status, "sent", "batched path must never change lifecycle status");

      // A malformed optional field must reject the whole Brevo batch before
      // the valid neighboring event can update its delivery.
      const malformed = await makeOwnerAndSalon("malformed");
      const [customerMalformed] = await db.insert(salonCustomersTable).values({
        salonId: malformed.salon.id, firstName: "Kupac", lastName: "Malformed",
        email: `pe-cust-malformed-${suffix}@bg.test`,
      }).returning();
      assert.ok(customerMalformed);
      const [ruleMalformed] = await db.insert(automationRulesTable).values({
        salonId: malformed.salon.id, name: `PE pravilo Malformed ${suffix}`, trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
      }).returning();
      assert.ok(ruleMalformed);
      const malformedRun = await makeSentRun(
        malformed.salon.id, ruleMalformed.id, customerMalformed.id, "malformed",
      );
      const receiptsBeforeMalformedBatches = {
        brevo: await webhookReceipt("brevo"),
        infobip: await webhookReceipt("infobip"),
      };
      const rejectionsBeforeMalformedBatches = {
        brevo: await webhookRejection("brevo"),
        infobip: await webhookRejection("infobip"),
      };
      const emailBeforeMalformedBatch = await automationDelivery(malformedRun.emailKey);
      const invalidBrevoBatch = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, [
        { event: "delivered", "message-id": malformedRun.brevoMessageId },
        { event: "delivered", "message-id": malformedRun.brevoMessageId, reason: 42 },
      ]);
      assert.equal(invalidBrevoBatch.status, 400);
      assert.equal(invalidBrevoBatch.body?.["code"], "INVALID_PAYLOAD");
      assert.deepEqual(
        await automationDelivery(malformedRun.emailKey),
        emailBeforeMalformedBatch,
        "a malformed Brevo batch must not partially update a delivery",
      );
      assert.equal(
        (await webhookReceipt("brevo"))?.getTime() ?? null,
        receiptsBeforeMalformedBatches.brevo?.getTime() ?? null,
        "a rejected Brevo batch must not advance the freshness timestamp",
      );
      assert.equal(
        (await webhookReceipt("infobip"))?.getTime() ?? null,
        receiptsBeforeMalformedBatches.infobip?.getTime() ?? null,
        "a rejected Brevo batch must not change Infobip freshness either",
      );

      // The same all-or-nothing guarantee applies to malformed nested
      // Infobip report fields.
      const smsBeforeMalformedBatch = await automationDelivery(malformedRun.smsKey);
      const invalidInfobipBatch = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, {
        results: [
          { messageId: malformedRun.smsMessageId, status: { groupName: "DELIVERED" } },
          { messageId: malformedRun.smsMessageId, status: "DELIVERED" },
        ],
      });
      assert.equal(invalidInfobipBatch.status, 400);
      assert.equal(invalidInfobipBatch.body?.["code"], "INVALID_PAYLOAD");
      assert.deepEqual(
        await automationDelivery(malformedRun.smsKey),
        smsBeforeMalformedBatch,
        "a malformed Infobip batch must not partially update a delivery",
      );
      assert.equal(
        (await webhookReceipt("brevo"))?.getTime() ?? null,
        receiptsBeforeMalformedBatches.brevo?.getTime() ?? null,
        "a rejected Infobip batch must not change Brevo freshness either",
      );
      assert.equal(
        (await webhookReceipt("infobip"))?.getTime() ?? null,
        receiptsBeforeMalformedBatches.infobip?.getTime() ?? null,
        "a rejected Infobip batch must not advance the freshness timestamp",
      );
      for (const provider of ["brevo", "infobip"] as const) {
        const rejection = await webhookRejection(provider);
        assert.equal(
          rejection.count,
          rejectionsBeforeMalformedBatches[provider].count + 1,
          `one malformed ${provider} batch must increment its aggregate rejection signal exactly once`,
        );
        assert.ok(rejection.lastRejectedAt, `malformed ${provider} batch must retain only its server receipt time`);
      }
      console.log("✓ malformed mixed Brevo and Infobip batches reject atomically, preserve freshness, and create privacy-safe aggregate signals");

      // Same mixed shape for Infobip: matched + unknown UUID + synthetic
      // self-check (non-UUID) + PENDING in one payload.
      const smsDoneAt = new Date(Date.now() - 60_000);
      const mixedSms = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, {
        results: [
          { messageId: runA4.smsMessageId, status: { groupName: "DELIVERED" }, doneAt: smsDoneAt.toISOString() },
          { messageId: randomUUID(), status: { groupName: "DELIVERED" }, doneAt: smsDoneAt.toISOString() },
          { messageId: `${WEBHOOK_VERIFICATION_REFERENCE_PREFIX}${suffix}`, status: { groupName: "DELIVERED" } },
          { messageId: runA4.smsMessageId, status: { groupName: "PENDING", name: "PENDING_ENROUTE" } },
        ],
      });
      assert.equal(mixedSms.status, 200);
      assert.equal(mixedSms.body?.["updated"], 1);
      assert.equal(mixedSms.body?.["unmatched"], 2, "unknown UUID and synthetic reference stay unmatched");
      assert.equal(mixedSms.body?.["ignored"], 1, "PENDING stays ignored in a mixed batch");
      const smsAfterMixed = await automationDelivery(runA4.smsKey);
      assert.equal(smsAfterMixed.deliveredAt?.getTime(), smsDoneAt.getTime());
      assert.equal(smsAfterMixed.status, "sent");

      // Interleaved kinds for the same key must preserve the original
      // first-write-wins order even though the batch implementation groups
      // guarded UPDATEs by kind. The first failure is recorded, delivery
      // clears it, opening preserves delivery's earlier timestamp, and the
      // later same-kind replays are duplicates.
      const ordered = await makeSentRun(mix.salon.id, ruleMix.id, customerMix.id, "mix-ordered");
      const orderedTs = Math.floor(Date.now() / 1000) - 240;
      const orderedBatch = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, [
        { event: "soft_bounce", "message-id": ordered.brevoMessageId, ts_event: orderedTs, reason: "mailbox full" },
        { event: "delivered", "message-id": ordered.brevoMessageId, ts_event: orderedTs + 30 },
        { event: "soft_bounce", "message-id": ordered.brevoMessageId, ts_event: orderedTs + 60, reason: "late replay" },
        { event: "opened", "message-id": ordered.brevoMessageId, ts_event: orderedTs + 90 },
        { event: "delivered", "message-id": ordered.brevoMessageId, ts_event: orderedTs + 120 },
      ]);
      assert.equal(orderedBatch.status, 200);
      assert.equal(orderedBatch.body?.["updated"], 3, "failure, delivery, then open must each retain their sequential transition");
      assert.equal(orderedBatch.body?.["duplicates"], 2, "same-kind replays in an interleaved batch must remain duplicates");
      const afterOrderedBatch = await automationDelivery(ordered.emailKey);
      assert.equal(afterOrderedBatch.failedAt, null, "delivery confirmation must still clear the first failure");
      assert.equal(afterOrderedBatch.deliveredAt?.getTime(), (orderedTs + 30) * 1000, "delivery's timestamp must survive the later open");
      assert.equal(afterOrderedBatch.openedAt?.getTime(), (orderedTs + 90) * 1000, "opened timestamp must use its own provider time");

      // A different delivery can establish a kind first globally without
      // changing another delivery's local event order. This catches an unsafe
      // global kind grouping (delivered before opened/failed for every key).
      const leading = await makeSentRun(mix.salon.id, ruleMix.id, customerMix.id, "mix-leading");
      const target = await makeSentRun(mix.salon.id, ruleMix.id, customerMix.id, "mix-target");
      const crossKeyTs = Math.floor(Date.now() / 1000) - 180;
      const crossedEmail = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, [
        { event: "delivered", "message-id": leading.brevoMessageId, ts_event: crossKeyTs },
        { event: "opened", "message-id": target.brevoMessageId, ts_event: crossKeyTs + 20 },
        { event: "delivered", "message-id": target.brevoMessageId, ts_event: crossKeyTs + 40 },
      ]);
      assert.equal(crossedEmail.status, 200);
      assert.equal(crossedEmail.body?.["updated"], 2);
      assert.equal(crossedEmail.body?.["duplicates"], 1, "target delivery after its open must remain a duplicate");
      const crossedEmailTarget = await automationDelivery(target.emailKey);
      assert.equal(crossedEmailTarget.deliveredAt?.getTime(), (crossKeyTs + 20) * 1000, "target open must backfill its own earlier delivery time");
      assert.equal(crossedEmailTarget.openedAt?.getTime(), (crossKeyTs + 20) * 1000);

      const crossedSms = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, {
        results: [
          { messageId: leading.smsMessageId, status: { groupName: "DELIVERED" }, doneAt: new Date(crossKeyTs * 1000).toISOString() },
          { messageId: target.smsMessageId, status: { groupName: "UNDELIVERABLE", description: "No coverage" }, doneAt: new Date((crossKeyTs + 20) * 1000).toISOString() },
          { messageId: target.smsMessageId, status: { groupName: "DELIVERED" }, doneAt: new Date((crossKeyTs + 40) * 1000).toISOString() },
        ],
      });
      assert.equal(crossedSms.status, 200);
      assert.equal(crossedSms.body?.["updated"], 3, "target failure then delivery must both retain their local input order");
      assert.equal(crossedSms.body?.["duplicates"], 0);
      const crossedSmsTarget = await automationDelivery(target.smsKey);
      assert.equal(crossedSmsTarget.deliveredAt?.getTime(), (crossKeyTs + 40) * 1000);
      assert.equal(crossedSmsTarget.failedAt, null, "target delivery must clear its earlier provider failure");

      // `opened` uses the per-key timestamp CASE twice, making it the largest
      // state-update statement. More than 10,000 distinct keys proves the
      // implementation chunks that statement below PostgreSQL's bind-parameter
      // limit, both on the first write and a duplicate-heavy replay.
      const largeBatchSize = 10_001;
      const largeEventAt = new Date(Math.floor((Date.now() - 30_000) / 1_000) * 1_000);
      const largeEvents = Array.from({ length: largeBatchSize }, (_, index) => {
        const eventKey = `pe-large-batch-${suffix}-${index}:email`;
        const messageId = `<pe-large-batch-${suffix}-${index}@smtp-relay.mailin.fr>`;
        return { eventKey, messageId };
      });
      cleanup.emailEventKeys.push(...largeEvents.map((event) => event.eventKey));
      for (let start = 0; start < largeEvents.length; start += 1_000) {
        const chunk = largeEvents.slice(start, start + 1_000);
        await db.insert(automationDeliveriesTable).values(chunk.map((event) => ({
          runId: target.run.id, salonId: mix.salon.id, eventKey: event.eventKey, channel: "email",
          recipientEmail: `pe-large-${suffix}@bg.test`, status: "sent", sentAt: largeEventAt,
        })));
        await db.insert(emailDeliveriesTable).values(chunk.map((event) => ({
          eventKey: event.eventKey, emailType: "automation" as const, salonId: mix.salon.id,
          recipientEmail: `pe-large-${suffix}@bg.test`, subject: "PE large batch", htmlContent: "<p>test</p>",
          status: "sent" as const, providerMessageId: event.messageId, sentAt: largeEventAt,
        })));
      }
      const largePayload = largeEvents.map((event) => ({
        event: "opened",
        "message-id": event.messageId,
        ts_event: Math.floor(largeEventAt.getTime() / 1000),
      }));
      const largeFirst = await applyBrevoEvents(largePayload, largeEventAt);
      assert.equal(largeFirst.updated, largeBatchSize, "large distinct batch must complete every state transition");
      assert.equal(largeFirst.duplicates, 0);
      const largeReplayRun = await countDatabaseQueries(() => applyBrevoEvents(largePayload, largeEventAt));
      const largeReplay = largeReplayRun.result;
      assert.equal(largeReplay.updated, 0);
      assert.equal(largeReplay.duplicates, largeBatchSize, "large replay must complete without per-event SQL failures");
      assert.ok(
        largeReplayRun.queries <= 6,
        `large duplicate-heavy Brevo replay used ${largeReplayRun.queries} queries; expected a bounded batched count`,
      );
      assert.equal((await automationDelivery(largeEvents[0]!.eventKey)).openedAt?.getTime(), largeEventAt.getTime());
      assert.equal((await automationDelivery(largeEvents.at(-1)!.eventKey)).openedAt?.getTime(), largeEventAt.getTime());

      const largeInfobipReplay = Array.from({ length: largeBatchSize }, () => ({
        messageId: runA4.smsMessageId,
        status: { groupName: "DELIVERED" },
        doneAt: new Date(largeEventAt.getTime() + 60_000).toISOString(),
      }));
      const largeInfobipReplayRun = await countDatabaseQueries(() =>
        applyInfobipReports(largeInfobipReplay, largeEventAt),
      );
      assert.equal(largeInfobipReplayRun.result.updated, 0);
      assert.equal(
        largeInfobipReplayRun.result.duplicates,
        largeBatchSize,
        "large duplicate-heavy Infobip replay must report every event as a duplicate",
      );
      assert.ok(
        largeInfobipReplayRun.queries <= 6,
        `large duplicate-heavy Infobip replay used ${largeInfobipReplayRun.queries} queries; expected a bounded batched count`,
      );
      assert.equal(
        (await automationDelivery(runA4.smsKey)).deliveredAt?.getTime(),
        smsDoneAt.getTime(),
        "large Infobip replay must preserve the first delivery timestamp",
      );

      const largeUnknownSms = await applyInfobipReports(
        Array.from({ length: largeBatchSize }, () => ({
          messageId: randomUUID(),
          status: { groupName: "DELIVERED" },
          doneAt: largeEventAt.toISOString(),
        })),
        largeEventAt,
      );
      assert.equal(largeUnknownSms.processed, largeBatchSize);
      assert.equal(largeUnknownSms.unmatched, largeBatchSize, "large Infobip lookup must split without rejecting valid UUID references");

      // These payloads exceed Express's default 100 KB JSON limit, so they
      // confirm the real webhook route installs its bounded large-batch parser
      // before the app-wide parser. Unknown references make this a pure
      // ingestion/accounting test without creating another large fixture.
      const httpLargeBatchSize = 2_000;
      const httpLargeBrevoPayload = Array.from({ length: httpLargeBatchSize }, (_, index) => ({
        event: "delivered",
        "message-id": `<pe-http-limit-${suffix}-${index}@nowhere>`,
        ts_event: Math.floor(largeEventAt.getTime() / 1_000),
      }));
      assert.ok(Buffer.byteLength(JSON.stringify(httpLargeBrevoPayload)) > 100 * 1_024);
      const httpLargeBrevo = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, httpLargeBrevoPayload);
      assert.equal(httpLargeBrevo.status, 200, "over-100 KB Brevo replay must reach the optimized handler");
      assert.equal(httpLargeBrevo.body?.["unmatched"], httpLargeBatchSize);

      const httpLargeInfobipPayload = {
        results: Array.from({ length: httpLargeBatchSize }, () => ({
          messageId: randomUUID(),
          status: { groupName: "DELIVERED" },
          doneAt: largeEventAt.toISOString(),
        })),
      };
      assert.ok(Buffer.byteLength(JSON.stringify(httpLargeInfobipPayload)) > 100 * 1_024);
      const httpLargeInfobip = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, httpLargeInfobipPayload);
      assert.equal(httpLargeInfobip.status, 200, "over-100 KB Infobip replay must reach the optimized handler");
      assert.equal(httpLargeInfobip.body?.["unmatched"], httpLargeBatchSize);
      console.log("✓ mixed batches preserve sequential monotonic updates through set-based groups");
    }

    // ── 7. SMS delivery reports (no opens for SMS) ──────────────────────────
    {
      const doneAt = new Date(Date.now() - 120_000);
      const delivered = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, {
        results: [
          { messageId: runA.smsMessageId, status: { groupName: "DELIVERED" }, doneAt: doneAt.toISOString() },
          { messageId: randomUUID(), status: { groupName: "DELIVERED" }, doneAt: doneAt.toISOString() },
          { messageId: runA2.smsMessageId, status: { groupName: "PENDING", name: "PENDING_ENROUTE" } },
        ],
      });
      assert.equal(delivered.status, 200);
      assert.equal(delivered.body?.["updated"], 1);
      assert.equal(delivered.body?.["unmatched"], 1, "unknown SMS reference is unmatched");
      assert.equal(delivered.body?.["ignored"], 1, "PENDING carries no terminal state");
      const smsRow = await automationDelivery(runA.smsKey);
      assert.equal(smsRow.deliveredAt?.getTime(), doneAt.getTime());
      assert.equal(smsRow.openedAt, null, "SMS never gets opens");
      assert.equal(smsRow.status, "sent");

      const replay = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, {
        results: [{ messageId: runA.smsMessageId, status: { groupName: "DELIVERED" }, doneAt: new Date().toISOString() }],
      });
      assert.equal(replay.body?.["duplicates"], 1, "replayed SMS report is a no-op");
      const afterReplay = await automationDelivery(runA.smsKey);
      assert.equal(afterReplay.deliveredAt?.getTime(), doneAt.getTime());

      const undeliverable = await postJson(`/webhooks/infobip/${encodeURIComponent(smsSecret)}`, {
        results: [{ messageId: runA2.smsMessageId, status: { groupName: "UNDELIVERABLE", description: "No coverage" }, doneAt: new Date().toISOString() }],
      });
      assert.equal(undeliverable.body?.["updated"], 1);
      const failedRow = await automationDelivery(runA2.smsKey);
      assert.ok(failedRow.failedAt, "UNDELIVERABLE records provider failure");
      assert.equal(failedRow.status, "sent", "status untouched");
      console.log("✓ SMS reports update delivered/failed idempotently; PENDING ignored");
    }

    // ── 7b. Accepted verified events update per-provider receipt tracking ──
    {
      const brevoReceipt = await webhookReceipt("brevo");
      const infobipReceipt = await webhookReceipt("infobip");
      assert.ok(brevoReceipt && brevoReceipt.getTime() >= suiteStart.getTime(),
        "accepted verified Brevo events must record a fresh receipt timestamp");
      assert.ok(infobipReceipt && infobipReceipt.getTime() >= suiteStart.getTime(),
        "accepted verified Infobip reports must record a fresh receipt timestamp");

      // Monotonic: an out-of-order/stale recording can never move it backwards.
      await recordWebhookReceipt("brevo", new Date(suiteStart.getTime() - 60 * 60 * 1000));
      const afterStale = await webhookReceipt("brevo");
      assert.equal(afterStale?.getTime(), brevoReceipt.getTime(),
        "stale receipt recording must not regress the timestamp");

      // Pure warning decision: silence = grace-aged recent send with no event since.
      const t0 = new Date("2026-08-23T10:00:00Z");
      const later = new Date(t0.getTime() + 60_000);
      assert.equal(deliveryReportWarning({ lastEventAt: null, lastQualifyingSentAt: null }), false, "no recent sends → no warning");
      assert.equal(deliveryReportWarning({ lastEventAt: t0, lastQualifyingSentAt: null }), false, "events but no recent sends → no warning");
      assert.equal(deliveryReportWarning({ lastEventAt: null, lastQualifyingSentAt: t0 }), true, "grace-aged send and no event ever → warning");
      assert.equal(deliveryReportWarning({ lastEventAt: t0, lastQualifyingSentAt: later }), true, "no event since the newest grace-aged send → warning");
      assert.equal(deliveryReportWarning({ lastEventAt: later, lastQualifyingSentAt: t0 }), false, "event after the newest grace-aged send → healthy");
      console.log("✓ receipt tracking is fresh + monotonic; warning fires only on report silence");
    }

    // ── 7c. Admin integrations endpoint surfaces delivery-report freshness ─
    let adminToken = "";
    {
      const adminHash = await hashPassword(`pe-admin-${suffix}`);
      const [admin] = await db.insert(usersTable).values({
        firstName: "Admin", lastName: "PE",
        email: `pe-admin-${suffix}@bg.test`, passwordHash: adminHash, passwordSetAt: new Date(), role: "ADMIN",
      }).returning();
      assert.ok(admin);
      cleanup.userIds.push(admin.id);
      adminToken = await createSession(admin.id);

      const response = await fetch(`${baseUrl}/api/admin/integrations`, {
        headers: { cookie: `${sessionCookieName}=${adminToken}` },
      });
      assert.equal(response.status, 200);
      type ReportedStatus = {
        lastEventAt: string | null;
        rejectedPayloadCount: number;
        lastRejectedAt: string | null;
        malformedWebhookState: "normal" | "observing" | "alerted" | "recovered";
        lastAutomationSentAt: string | null;
        recentSendCount: number;
        warning: boolean;
      };
      const body = await response.json() as {
        deliveryReports?: {
          providers?: Record<string, ReportedStatus>;
          windowHours?: number;
          graceMinutes?: number;
           rejectionAlertThreshold?: number;
        };
      };
      assert.ok(body.deliveryReports, "admin integrations response must include deliveryReports");
      assert.equal(typeof body.deliveryReports.windowHours, "number");
      assert.equal(typeof body.deliveryReports.graceMinutes, "number");
       assert.equal(body.deliveryReports.rejectionAlertThreshold, WEBHOOK_REJECTION_ALERT_THRESHOLD);
      for (const provider of ["brevo", "infobip"] as const) {
        const providerStatus: ReportedStatus | undefined = body.deliveryReports.providers?.[provider];
        assert.ok(providerStatus, `deliveryReports.providers.${provider} present`);
        assert.equal(typeof providerStatus.recentSendCount, "number");
        assert.equal(typeof providerStatus.warning, "boolean");
        assert.ok(providerStatus.rejectedPayloadCount > 0, `admin response must expose the recent malformed ${provider} payload count`);
        assert.ok(providerStatus.lastRejectedAt, `admin response must expose when ${provider} last sent malformed payload data`);
         assert.equal(
           providerStatus.malformedWebhookState === "observing" || providerStatus.malformedWebhookState === "alerted",
           true,
           `recent malformed ${provider} batches are visibly being monitored`,
         );
        // This suite just accepted verified events for both providers, so the
        // receipt is newer than any grace-aged send — never a warning here.
        assert.ok(providerStatus.lastEventAt, `last accepted event surfaced for ${provider}`);
        assert.ok(new Date(providerStatus.lastEventAt).getTime() >= suiteStart.getTime(), `fresh receipt surfaced for ${provider}`);
        assert.equal(providerStatus.warning, false, `fresh receipts must read healthy for ${provider}`);
      }

      // Unauthenticated / non-admin callers see nothing (security unchanged).
      const anonymous = await fetch(`${baseUrl}/api/admin/integrations`);
      assert.equal(anonymous.status, 401, "anonymous integrations read rejected");
      console.log("✓ admin integrations endpoint exposes per-provider delivery-report freshness");
    }

    // ── 7d. Admin webhook self-check: end-to-end, no state/receipt change ──
    {
      const brevoReceiptBefore = await webhookReceipt("brevo");
      const infobipReceiptBefore = await webhookReceipt("infobip");

      // Synthetic verification events still require a valid token — the
      // marker never bypasses the timing-safe check.
      const forged = await postJson(`/webhooks/brevo/${encodeURIComponent(`${brevoSecret}x`)}`, {
        event: "delivered", "message-id": `${WEBHOOK_VERIFICATION_REFERENCE_PREFIX}${randomUUID()}`,
      });
      assert.equal(forged.status, 401, "verification events must still pass token verification");

      // Direct synthetic post with the valid token: accepted, unmatched, and
      // therefore incapable of changing any delivery state.
      const synthetic = await postJson(`/webhooks/brevo/${encodeURIComponent(brevoSecret)}`, {
        event: "delivered", "message-id": `${WEBHOOK_VERIFICATION_REFERENCE_PREFIX}${randomUUID()}`,
      });
      assert.equal(synthetic.status, 200);
      assert.equal(synthetic.body?.["unmatched"], 1, "synthetic reference must be unmatched");
      assert.equal(synthetic.body?.["updated"], 0, "synthetic events never change delivery state");

      // Admin self-check endpoint succeeds end-to-end for both providers.
      const verify = (integration: string) => fetch(`${baseUrl}/api/admin/integrations/${integration}/verify-webhook`, {
        method: "POST", headers: { cookie: `${sessionCookieName}=${adminToken}` },
      });
      for (const integration of ["brevo", "sms"] as const) {
        const response = await verify(integration);
        const body = await response.json() as { message?: string; error?: string };
        assert.equal(response.status, 200, `${integration} self-check must succeed: ${JSON.stringify(body)}`);
        assert.ok(body.message && body.message.includes("webhook radi"), `${integration} self-check reports success in Serbian`);
      }

      // None of the verification traffic above may count as a provider report.
      assert.equal(
        (await webhookReceipt("brevo"))?.getTime() ?? null,
        brevoReceiptBefore?.getTime() ?? null,
        "self-checks must not refresh Brevo delivery-report freshness",
      );
      assert.equal(
        (await webhookReceipt("infobip"))?.getTime() ?? null,
        infobipReceiptBefore?.getTime() ?? null,
        "self-checks must not refresh Infobip delivery-report freshness",
      );

      // Access control: anonymous and non-admin callers rejected; the check
      // exists only for the two webhook-bearing integrations.
      const anonymous = await fetch(`${baseUrl}/api/admin/integrations/brevo/verify-webhook`, { method: "POST" });
      assert.equal(anonymous.status, 401, "anonymous self-check rejected");
      const nonAdmin = await fetch(`${baseUrl}/api/admin/integrations/brevo/verify-webhook`, {
        method: "POST", headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(nonAdmin.status, 403, "non-admin self-check rejected");
      const unknown = await verify("google_oauth");
      assert.equal(unknown.status, 404, "self-check exists only for SMS and Brevo");
      console.log("✓ admin webhook self-check verifies end-to-end without touching state or freshness");
    }

    // ── 7e. Admin copy endpoint returns the complete webhook URL ───────────
    {
      const copyUrl = (integration: string, token?: string) => fetch(
        `${baseUrl}/api/admin/integrations/${integration}/webhook-url`,
        token ? { headers: { cookie: `${sessionCookieName}=${token}` } } : undefined,
      );

      // Admin gets the full URL with the saved secret already substituted.
      const expectations = [
        { integration: "brevo", path: "brevo", secret: brevoSecret },
        { integration: "sms", path: "infobip", secret: smsSecret },
      ] as const;
      for (const { integration, path, secret } of expectations) {
        const response = await copyUrl(integration, adminToken);
        const body = await response.json() as { url?: string; error?: string };
        assert.equal(response.status, 200, `${integration} webhook URL must be returned: ${JSON.stringify(body)}`);
        assert.ok(body.url, `${integration} response carries a url`);
        assert.ok(
          body.url.endsWith(`/api/webhooks/${path}/${encodeURIComponent(secret)}`),
          `${integration} URL must embed the saved secret on the ${path} webhook path (got ${body.url})`,
        );
        assert.ok(/^https?:\/\//.test(body.url), `${integration} URL must be absolute`);
        assert.ok(!body.url.includes("<tajna>"), "no placeholder remains in the copied URL");
      }

      // Access control mirrors the other admin integration endpoints.
      const anonymous = await copyUrl("brevo");
      assert.equal(anonymous.status, 401, "anonymous webhook URL read rejected");
      const nonAdmin = await copyUrl("brevo", a.token);
      assert.equal(nonAdmin.status, 403, "non-admin webhook URL read rejected");
      const unknown = await copyUrl("google_oauth", adminToken);
      assert.equal(unknown.status, 404, "webhook URL exists only for SMS and Brevo");
      console.log("✓ admin webhook-url copy endpoint returns the complete URL to admins only");
    }

    // ── 7f. Silence → dashboard stale list + rate-limited admin alert email ─
    {
      // Pure selector shared by the dashboard summary endpoint and the email
      // alert — both surfaces must agree with the integrations page warning.
      const healthy: DeliveryReportStatus = {
        lastEventAt: null,
        rejectedPayloadCount: 0,
        lastRejectedAt: null,
        malformedWebhookState: "normal",
        lastAutomationSentAt: null,
        recentSendCount: 0,
        warning: false,
      };
      assert.deepEqual(staleDeliveryReportProviders({ brevo: healthy, infobip: healthy }), []);
      assert.deepEqual(staleDeliveryReportProviders({ brevo: { ...healthy, warning: true }, infobip: healthy }), ["brevo"]);
      assert.deepEqual(
        staleDeliveryReportProviders({ brevo: { ...healthy, warning: true }, infobip: { ...healthy, warning: true } }),
        ["brevo", "infobip"],
      );

      // Isolated fixtures (own salon/rule/customer) so the extra "sent" email
      // delivery can never distort the per-rule stats assertions in section 8.
      const c = await makeOwnerAndSalon("alerts");
      const [customerC] = await db.insert(salonCustomersTable).values({
        salonId: c.salon.id, firstName: "Kupac", lastName: "C", email: `pe-cust-c-${suffix}@bg.test`,
      }).returning();
      const [ruleC] = await db.insert(automationRulesTable).values({
        salonId: c.salon.id, name: `PE pravilo C ${suffix}`, trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
      }).returning();
      assert.ok(customerC && ruleC);

      // Evaluation times. alertNow = now+40min makes a send at now+5min both
      // grace-aged (35 min old) and newer than every receipt this suite
      // recorded (receipts are monotonic and stay at ~now) — brevo reads
      // silent while infobip stays healthy (its last receipt postdates every
      // SMS send in each probed window). Nudge alertNow off an exact
      // cooldown-bucket start so a boundary probe strictly inside the
      // rolling cooldown is guaranteed to exist.
      let alertNow = new Date(Date.now() + 40 * 60_000);
      if (alertNow.getTime() % DELIVERY_REPORT_ALERT_COOLDOWN_MS < 2 * 60_000) {
        alertNow = new Date(alertNow.getTime() + 5 * 60_000);
      }
      const bucketOf = (at: Date) => Math.floor(at.getTime() / DELIVERY_REPORT_ALERT_COOLDOWN_MS);
      // One minute past the next fixed 24h bucket boundary — a fixed-window
      // key scheme would happily alert again here, but a full rolling
      // cooldown has NOT yet elapsed since alertNow.
      const boundaryProbe = new Date((bucketOf(alertNow) + 1) * DELIVERY_REPORT_ALERT_COOLDOWN_MS + 60_000);
      assert.equal(bucketOf(boundaryProbe), bucketOf(alertNow) + 1, "probe crosses the fixed bucket boundary");
      assert.ok(
        boundaryProbe.getTime() - alertNow.getTime() < DELIVERY_REPORT_ALERT_COOLDOWN_MS,
        "probe stays inside the rolling cooldown",
      );
      const afterCooldown = new Date(alertNow.getTime() + DELIVERY_REPORT_ALERT_COOLDOWN_MS + 30 * 60_000);
      // Anchors for the total-email-outage SMS fallback runs below — each a
      // full rolling cooldown apart so alert emails are attempted again.
      const fallbackNow = new Date(afterCooldown.getTime() + DELIVERY_REPORT_ALERT_COOLDOWN_MS + 30 * 60_000);
      const partialFailureNow = new Date(fallbackNow.getTime() + DELIVERY_REPORT_ALERT_COOLDOWN_MS + 30 * 60_000);
      const allSkippedNow = new Date(partialFailureNow.getTime() + DELIVERY_REPORT_ALERT_COOLDOWN_MS + 30 * 60_000);

      // One qualifying (grace-aged, receipt-less) email send per evaluation
      // time, so brevo reads silent at alertNow, boundaryProbe, afterCooldown
      // AND the fallback anchors — each probe then genuinely exercises the
      // cooldown / fallback decision.
      const staleRunKey = `pe-run-stale-${suffix}`;
      const firstStaleSentAt = new Date(alertNow.getTime() - 35 * 60_000);
      const [staleRun] = await db.insert(automationRunsTable).values({
        eventKey: staleRunKey, ruleId: ruleC.id, salonId: c.salon.id, salonCustomerId: customerC.id,
        status: "sent", executedAt: firstStaleSentAt, sentAt: firstStaleSentAt,
      }).returning();
      assert.ok(staleRun);
      const staleSentAts = [firstStaleSentAt,
        new Date(boundaryProbe.getTime() - 35 * 60_000),
        new Date(afterCooldown.getTime() - 35 * 60_000),
        new Date(fallbackNow.getTime() - 35 * 60_000),
        new Date(partialFailureNow.getTime() - 35 * 60_000),
        new Date(allSkippedNow.getTime() - 35 * 60_000)];
      for (const [index, sentAt] of staleSentAts.entries()) {
        const [staleDelivery] = await db.insert(automationDeliveriesTable).values({
          runId: staleRun.id, salonId: c.salon.id, eventKey: `${staleRunKey}:email:${index}`, channel: "email",
          recipientEmail: `pe-stale-${suffix}@bg.test`, status: "sent", sentAt,
        }).returning();
        assert.ok(staleDelivery);
      }

      // Dedicated admin recipient (other admins may exist in the shared dev
      // DB; assertions below only require ours to be among the recipients).
      const alertAdminEmail = `pe-alert-admin-${suffix}@bg.test`;
      // Unique phone so the SMS fallback has a recipient (users_phone_normalized
      // is unique; derive digits from the random suffix + time).
      const alertAdminPhone = `+38160${String(Date.now()).slice(-7)}`;
      const [alertAdmin] = await db.insert(usersTable).values({
        firstName: "Admin", lastName: "Alerts",
        email: alertAdminEmail, passwordHash: await hashPassword(`pe-alert-${suffix}`),
        passwordSetAt: new Date(), role: "SUPER_ADMIN",
        phone: alertAdminPhone, phoneNormalized: alertAdminPhone.replace(/\D/g, ""),
      }).returning();
      assert.ok(alertAdmin);
      cleanup.userIds.push(alertAdmin.id);

      const makeFakeTransport = () => {
        const calls: { email: string; subject: string }[] = [];
        const transport: TransactionalEmailTransport = {
          async send(input) {
            calls.push({ email: input.to.email, subject: input.subject });
            return { messageId: `pe-fake-${calls.length}` };
          },
        };
        return { calls, transport };
      };

      // First tick while silent: exactly one email per admin, brevo only.
      const first = makeFakeTransport();
      const firstRun = await runDeliveryReportSilenceAlerts(alertNow, first.transport);
      cleanup.emailEventKeys.push(...firstRun.attemptedEventKeys);
      assert.deepEqual(firstRun.staleProviders, ["brevo"], "only the silent provider alerts");
      assert.ok(firstRun.recipientCount >= 1, "at least our admin receives the alert");
      assert.equal(firstRun.attemptedEventKeys.length, firstRun.recipientCount, "one alert per admin per stale provider");
      assert.equal(firstRun.cooldownSuppressedCount, 0, "no prior alerts → nothing suppressed");
      assert.equal(firstRun.failedDeliveryCount, 0);
      assert.equal(firstRun.skippedDeliveryCount, 0);
      assert.equal(first.calls.length, firstRun.recipientCount, "every recipient got exactly one provider call");
      assert.ok(first.calls.some((call) => call.email === alertAdminEmail), "our admin is a recipient");
      assert.ok(first.calls.every((call) => call.subject.includes("Brevo")), "alert names the silent provider");
      assert.equal(firstRun.smsFallback.triggered, false, "successful emails never trigger the SMS fallback");

      // Immediate repeat tick: suppressed by the rolling cooldown — no
      // outbox attempt, no provider contact.
      const second = makeFakeTransport();
      const secondRun = await runDeliveryReportSilenceAlerts(alertNow, second.transport);
      assert.deepEqual(secondRun.staleProviders, ["brevo"], "still silent");
      assert.equal(secondRun.attemptedEventKeys.length, 0, "repeat tick attempts no outbox writes");
      assert.ok(secondRun.cooldownSuppressedCount >= 1, "repeat tick is cooldown-suppressed");
      assert.equal(second.calls.length, 0, "repeat tick within the cooldown sends nothing");
      assert.equal(secondRun.failedDeliveryCount, 0);

      // Boundary regression: one minute past the next FIXED 24h bucket
      // boundary the provider is still silent, but under 24h have elapsed
      // since the first alert — a rolling cooldown must stay quiet where a
      // fixed-bucket key scheme would alert again minutes after the first.
      const boundary = makeFakeTransport();
      const boundaryRun = await runDeliveryReportSilenceAlerts(boundaryProbe, boundary.transport);
      assert.deepEqual(boundaryRun.staleProviders, ["brevo"], "still silent across the bucket boundary");
      assert.equal(boundaryRun.attemptedEventKeys.length, 0, "no outbox attempt across the bucket boundary");
      assert.ok(boundaryRun.cooldownSuppressedCount >= 1, "bucket-boundary tick is cooldown-suppressed");
      assert.equal(boundary.calls.length, 0, "no second email until a full cooldown has elapsed");

      // Once a full rolling cooldown HAS elapsed and the provider is still
      // silent, each admin gets exactly one fresh alert under new event keys.
      const renewed = makeFakeTransport();
      const renewedRun = await runDeliveryReportSilenceAlerts(afterCooldown, renewed.transport);
      cleanup.emailEventKeys.push(...renewedRun.attemptedEventKeys);
      assert.deepEqual(renewedRun.staleProviders, ["brevo"], "still silent after the cooldown");
      assert.equal(renewedRun.cooldownSuppressedCount, 0, "cooldown fully elapsed for every recipient");
      assert.equal(renewed.calls.length, renewedRun.recipientCount, "one renewed alert per admin");
      assert.ok(renewed.calls.some((call) => call.email === alertAdminEmail), "our admin gets the renewed alert");
      for (const eventKey of renewedRun.attemptedEventKeys) {
        assert.ok(!firstRun.attemptedEventKeys.includes(eventKey), "renewed alerts use fresh outbox keys");
      }
      assert.equal(renewedRun.smsFallback.triggered, false, "renewed successful emails trigger no SMS fallback");

      // Healthy statuses (evaluated at the real current time, where the
      // crafted future send is not yet grace-aged and receipts are fresh)
      // must produce no alert and touch no transport.
      const idle = makeFakeTransport();
      const idleRun = await runDeliveryReportSilenceAlerts(new Date(), idle.transport);
      assert.deepEqual(idleRun.staleProviders, [], "fresh receipts → no stale providers");
      assert.equal(idle.calls.length, 0, "healthy state never contacts the provider");

      // Admin dashboard summary carries the same signal end-to-end. Receipts
      // are fresh at the real current time, so the list must parse and read
      // healthy here; the stale path is covered by the future-time runs above.
      const alertAdminToken = await createSession(alertAdmin.id);
      const summaryResponse = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { cookie: `${sessionCookieName}=${alertAdminToken}` },
      });
      assert.equal(summaryResponse.status, 200);
      const summaryBody = await summaryResponse.json() as { deliveryReportStaleProviders?: unknown };
      assert.ok(Array.isArray(summaryBody.deliveryReportStaleProviders), "summary exposes deliveryReportStaleProviders");
      for (const provider of summaryBody.deliveryReportStaleProviders as unknown[]) {
        assert.ok(provider === "brevo" || provider === "infobip", "stale list only ever names known providers");
      }
      assert.deepEqual(summaryBody.deliveryReportStaleProviders, [], "fresh receipts read healthy on the dashboard");
      console.log("✓ silence alerts email admins once per cooldown window and feed the dashboard summary");

      // ── 7g. Total-email-outage SMS fallback ──────────────────────────────
      // When Brevo SENDING is down too, every alert email fails — admins must
      // still be paged over the independent SMS channel (Infobip), with the
      // same cooldown-window dedup so the fallback can never spam.
      {
        const makeFakeSms = () => {
          const calls: { to: string; text: string }[] = [];
          const provider: SmsProvider = {
            async send(input) {
              calls.push({ to: input.to, text: input.text });
              return { messageId: `pe-fake-sms-${calls.length}` };
            },
          };
          return { calls, provider };
        };
        const failingTransport: TransactionalEmailTransport = {
          async send() { throw new Error("Brevo 503: send API unavailable"); },
        };

        // Total outage: every alert email fails → fallback SMS to admins
        // with phone numbers.
        const outageSms = makeFakeSms();
        const outageRun = await runDeliveryReportSilenceAlerts(fallbackNow, failingTransport, outageSms.provider);
        cleanup.emailEventKeys.push(...outageRun.attemptedEventKeys);
        cleanup.smsEventKeys.push(...outageRun.smsFallback.attemptedEventKeys);
        assert.deepEqual(outageRun.staleProviders, ["brevo"], "brevo still silent at the outage probe");
        assert.ok(outageRun.attemptedEventKeys.length >= 1, "cooldown elapsed → emails attempted again");
        assert.equal(outageRun.failedDeliveryCount, outageRun.attemptedEventKeys.length, "every alert email failed");
        assert.equal(outageRun.smsFallback.triggered, true, "total email failure triggers the SMS fallback");
        assert.ok(outageRun.smsFallback.recipientCount >= 1, "at least our phone-carrying admin is an SMS recipient");
        assert.equal(
          outageRun.smsFallback.attemptedEventKeys.length,
          outageRun.smsFallback.recipientCount,
          "one fallback SMS per phone-carrying admin",
        );
        for (const eventKey of outageRun.smsFallback.attemptedEventKeys) {
          assert.ok(
            eventKey.startsWith(`${DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX}:brevo:`),
            "fallback SMS keys are namespaced per provider",
          );
        }
        assert.ok(outageSms.calls.some((call) => call.to === alertAdminPhone), "our admin's phone is paged");
        assert.ok(outageSms.calls.every((call) => call.text.includes("Brevo")), "SMS names the affected channel");
        assert.equal(outageRun.smsFallback.sentCount, outageSms.calls.length, "every fallback SMS was accepted");
        assert.equal(outageRun.smsFallback.failedCount, 0);

        // The fallback rows live in the durable SMS outbox as platform-level
        // admin alerts (no salon), so racing instances dedup on eventKey.
        const fallbackRows = await db.select().from(smsDeliveriesTable)
          .where(inArray(smsDeliveriesTable.eventKey, outageRun.smsFallback.attemptedEventKeys));
        assert.equal(fallbackRows.length, outageRun.smsFallback.attemptedEventKeys.length, "every fallback SMS is persisted");
        for (const row of fallbackRows) {
          assert.equal(row.messageType, "admin_alert", "fallback SMS is an admin alert");
          assert.equal(row.salonId, null, "fallback SMS belongs to no salon");
          assert.equal(row.status, "sent", "fallback SMS reached the provider");
        }

        // Immediate repeat tick: the email cooldown suppresses all attempts,
        // so the fallback is never evaluated — no second SMS (no spam).
        const repeatSms = makeFakeSms();
        const repeatRun = await runDeliveryReportSilenceAlerts(fallbackNow, failingTransport, repeatSms.provider);
        assert.equal(repeatRun.attemptedEventKeys.length, 0, "repeat tick attempts no emails");
        assert.equal(repeatRun.smsFallback.triggered, false, "suppressed tick never evaluates the fallback");
        assert.equal(repeatSms.calls.length, 0, "no repeat SMS inside the cooldown window");

        // Partial failure: at least one alert email still goes through → the
        // primary path worked for someone, so no SMS fallback fires.
        const partialAdminEmail = `pe-partial-admin-${suffix}@bg.test`;
        const [partialAdmin] = await db.insert(usersTable).values({
          firstName: "Admin", lastName: "Partial",
          email: partialAdminEmail, passwordHash: await hashPassword(`pe-partial-${suffix}`),
          passwordSetAt: new Date(), role: "ADMIN",
        }).returning();
        assert.ok(partialAdmin);
        cleanup.userIds.push(partialAdmin.id);
        const partialTransport: TransactionalEmailTransport = {
          async send(input) {
            if (input.to.email === partialAdminEmail) throw new Error("Brevo 503: send API unavailable");
            return { messageId: `pe-partial-${input.to.email}` };
          },
        };
        const partialSms = makeFakeSms();
        const partialRun = await runDeliveryReportSilenceAlerts(partialFailureNow, partialTransport, partialSms.provider);
        cleanup.emailEventKeys.push(...partialRun.attemptedEventKeys);
        assert.ok(partialRun.failedDeliveryCount >= 1, "the new admin's alert email failed");
        assert.ok(
          partialRun.failedDeliveryCount < partialRun.attemptedEventKeys.length,
          "other alert emails still succeeded",
        );
        assert.equal(partialRun.smsFallback.triggered, false, "a partially working email path fires no SMS fallback");
        assert.equal(partialSms.calls.length, 0, "no SMS while email still reaches someone");

        // All skipped (e.g. Brevo integration unconfigured) counts as a total
        // primary-path failure too, and a fresh window mints fresh SMS keys.
        const skippingTransport: TransactionalEmailTransport = {
          async send() { return { skipped: true, errorMessage: "Brevo nije podešen." }; },
        };
        const skippedSms = makeFakeSms();
        const skippedRun = await runDeliveryReportSilenceAlerts(allSkippedNow, skippingTransport, skippedSms.provider);
        cleanup.emailEventKeys.push(...skippedRun.attemptedEventKeys);
        cleanup.smsEventKeys.push(...skippedRun.smsFallback.attemptedEventKeys);
        assert.ok(skippedRun.skippedDeliveryCount >= 1, "alert emails were skipped");
        assert.equal(skippedRun.smsFallback.triggered, true, "all-skipped emails trigger the SMS fallback");
        assert.ok(skippedSms.calls.some((call) => call.to === alertAdminPhone), "our admin's phone is paged again");
        for (const eventKey of skippedRun.smsFallback.attemptedEventKeys) {
          assert.ok(
            !outageRun.smsFallback.attemptedEventKeys.includes(eventKey),
            "a new cooldown window mints fresh fallback SMS keys",
          );
        }

        // INFOBIP alert outage (regression: fallback was brevo-only): the
        // silence alert ABOUT infobip also travels over Brevo's send API, so
        // when it fails for everyone, admins must be paged too — with an SMS
        // naming Infobip and its own provider-namespaced dedup keys. A probe
        // one cooldown past allSkippedNow, with a fresh grace-aged SMS
        // automation send and no receipt after it, reads infobip (and ONLY
        // infobip — the brevo email sends have aged out of the 24h window)
        // as silent.
        const infobipOutageNow = new Date(allSkippedNow.getTime() + DELIVERY_REPORT_ALERT_COOLDOWN_MS + 30 * 60_000);
        const [infobipStaleDelivery] = await db.insert(automationDeliveriesTable).values({
          runId: staleRun.id, salonId: c.salon.id, eventKey: `${staleRunKey}:sms:fallback`, channel: "sms",
          recipientPhone: "+381601234567", status: "sent",
          sentAt: new Date(infobipOutageNow.getTime() - 35 * 60_000),
        }).returning();
        assert.ok(infobipStaleDelivery);

        const infobipSms = makeFakeSms();
        const infobipRun = await runDeliveryReportSilenceAlerts(infobipOutageNow, failingTransport, infobipSms.provider);
        cleanup.emailEventKeys.push(...infobipRun.attemptedEventKeys);
        cleanup.smsEventKeys.push(...infobipRun.smsFallback.attemptedEventKeys);
        assert.deepEqual(infobipRun.staleProviders, ["infobip"], "only infobip reads silent at this probe");
        assert.ok(infobipRun.attemptedEventKeys.length >= 1, "infobip alert emails were attempted");
        assert.equal(
          infobipRun.failedDeliveryCount,
          infobipRun.attemptedEventKeys.length,
          "every infobip alert email failed",
        );
        assert.equal(infobipRun.smsFallback.triggered, true, "a total email failure for the infobip alert triggers the SMS fallback");
        assert.ok(infobipRun.smsFallback.recipientCount >= 1, "our phone-carrying admin is an SMS recipient");
        assert.equal(
          infobipRun.smsFallback.attemptedEventKeys.length,
          infobipRun.smsFallback.recipientCount,
          "one fallback SMS per phone-carrying admin",
        );
        for (const eventKey of infobipRun.smsFallback.attemptedEventKeys) {
          assert.ok(
            eventKey.startsWith(`${DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX}:infobip:`),
            "fallback SMS keys are namespaced to the affected provider",
          );
        }
        assert.ok(infobipSms.calls.some((call) => call.to === alertAdminPhone), "our admin's phone is paged about infobip");
        assert.ok(infobipSms.calls.every((call) => call.text.includes("Infobip")), "SMS names the affected provider");
        assert.equal(infobipRun.smsFallback.sentCount, infobipSms.calls.length, "every infobip fallback SMS was accepted");
        assert.equal(infobipRun.smsFallback.failedCount, 0);

        // Persisted in the same durable admin-alert SMS outbox.
        const infobipFallbackRows = await db.select().from(smsDeliveriesTable)
          .where(inArray(smsDeliveriesTable.eventKey, infobipRun.smsFallback.attemptedEventKeys));
        assert.equal(
          infobipFallbackRows.length,
          infobipRun.smsFallback.attemptedEventKeys.length,
          "every infobip fallback SMS is persisted",
        );
        for (const row of infobipFallbackRows) {
          assert.equal(row.messageType, "admin_alert", "infobip fallback SMS is an admin alert");
          assert.equal(row.salonId, null, "infobip fallback SMS belongs to no salon");
          assert.equal(row.status, "sent", "infobip fallback SMS reached the provider");
        }

        // Immediate repeat tick: the email cooldown (anchored by the failed
        // infobip alert rows) suppresses all attempts, so the fallback is
        // never evaluated — same no-spam guarantee as the brevo path.
        const infobipRepeatSms = makeFakeSms();
        const infobipRepeatRun = await runDeliveryReportSilenceAlerts(infobipOutageNow, failingTransport, infobipRepeatSms.provider);
        assert.equal(infobipRepeatRun.attemptedEventKeys.length, 0, "repeat tick attempts no infobip alert emails");
        assert.equal(infobipRepeatRun.smsFallback.triggered, false, "suppressed tick never evaluates the fallback");
        assert.equal(infobipRepeatSms.calls.length, 0, "no repeat SMS inside the cooldown window");

        // When both delivery-report channels are silent in the same run and
        // the email path is fully down, combine the pages into one SMS per
        // phone-carrying administrator. The provider set and both sequences
        // are part of the durable key, so racing runs still collide.
        const combinedNow = new Date(infobipOutageNow.getTime() + DELIVERY_REPORT_ALERT_COOLDOWN_MS + 30 * 60_000);
        const combinedSentAt = new Date(combinedNow.getTime() - 35 * 60_000);
        await db.insert(automationDeliveriesTable).values([
          {
            runId: staleRun.id, salonId: c.salon.id, eventKey: `${staleRunKey}:combined:email`,
            channel: "email", recipientEmail: `pe-combined-${suffix}@bg.test`,
            status: "sent", sentAt: combinedSentAt,
          },
          {
            runId: staleRun.id, salonId: c.salon.id, eventKey: `${staleRunKey}:combined:sms`,
            channel: "sms", recipientPhone: "+381601234567",
            status: "sent", sentAt: combinedSentAt,
          },
        ]);

        const combinedSms = makeFakeSms();
        const combinedRun = await runDeliveryReportSilenceAlerts(combinedNow, failingTransport, combinedSms.provider);
        cleanup.emailEventKeys.push(...combinedRun.attemptedEventKeys);
        cleanup.smsEventKeys.push(...combinedRun.smsFallback.attemptedEventKeys);
        assert.deepEqual(combinedRun.staleProviders, ["brevo", "infobip"], "both channels read silent at the combined probe");
        assert.equal(combinedRun.failedDeliveryCount, combinedRun.attemptedEventKeys.length, "every combined alert email failed");
        assert.equal(combinedRun.smsFallback.triggered, true, "both failed channels trigger the SMS fallback");
        assert.equal(
          combinedRun.smsFallback.attemptedEventKeys.length,
          combinedRun.smsFallback.recipientCount,
          "combined outage sends one fallback SMS per phone-carrying admin",
        );
        assert.equal(combinedSms.calls.length, combinedRun.smsFallback.recipientCount, "combined outage makes one provider call per admin");
        for (const eventKey of combinedRun.smsFallback.attemptedEventKeys) {
          assert.ok(
            eventKey.startsWith(`${DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX}:brevo+infobip:`),
            "combined fallback keys are namespaced by the affected provider set",
          );
          assert.ok(!eventKey.includes(":brevo:"), "combined fallback does not use a Brevo-only key");
          assert.ok(!eventKey.includes(":infobip:"), "combined fallback does not use an Infobip-only key");
        }
        for (const call of combinedSms.calls) {
          assert.ok(call.text.includes("Brevo"), "combined SMS names Brevo");
          assert.ok(call.text.includes("Infobip"), "combined SMS names Infobip");
        }
        const combinedFallbackRows = await db.select().from(smsDeliveriesTable)
          .where(inArray(smsDeliveriesTable.eventKey, combinedRun.smsFallback.attemptedEventKeys));
        assert.equal(
          combinedFallbackRows.length,
          combinedRun.smsFallback.attemptedEventKeys.length,
          "combined fallback has one durable outbox row per admin",
        );

        const combinedRepeatSms = makeFakeSms();
        const combinedRepeatRun = await runDeliveryReportSilenceAlerts(combinedNow, failingTransport, combinedRepeatSms.provider);
        assert.equal(combinedRepeatRun.attemptedEventKeys.length, 0, "combined repeat tick attempts no alert emails");
        assert.equal(combinedRepeatRun.smsFallback.triggered, false, "combined repeat tick never evaluates the fallback");
        assert.equal(combinedRepeatSms.calls.length, 0, "combined repeat tick sends no SMS inside the cooldown");
        console.log("✓ SMS fallback pages admins exactly when the alert email path is fully down, once per window");

        // ── 7f2. Repeated malformed webhook format alerts ─────────────────
        // This must remain aggregate-only: malformed payloads increment a
        // bounded provider counter, but the alert never receives request data.
        const formatAdminEmail = `pe-format-admin-${suffix}@bg.test`;
        const [formatAdmin] = await db.insert(usersTable).values({
          firstName: "Admin", lastName: "Webhook format",
          email: formatAdminEmail, passwordHash: await hashPassword(`pe-format-${suffix}`),
          passwordSetAt: new Date(), role: "ADMIN",
        }).returning();
        assert.ok(formatAdmin);
        cleanup.userIds.push(formatAdmin.id);

        // Start from a deterministic count for both providers so the
        // provider-isolation and below-threshold assertions do not depend on
        // malformed fixtures earlier in this suite.
        await db.update(providerWebhookReceiptsTable).set({
          rejectedPayloadCount: 0,
          rejectedPayloadTimes: [],
          lastRejectedAt: null,
        }).where(inArray(providerWebhookReceiptsTable.provider, ["brevo", "infobip"]));
        const formatAlertNow = new Date();
        const noFormatAlert = makeFakeTransport();
        const baselineFormatRun = await runMalformedWebhookAlerts(formatAlertNow, noFormatAlert.transport);
        assert.deepEqual(baselineFormatRun.malformedProviders, [], "quiet providers never alert");
        assert.equal(noFormatAlert.calls.length, 0, "quiet providers never contact the email transport");

        for (let index = 0; index < WEBHOOK_REJECTION_ALERT_THRESHOLD - 1; index += 1) {
          await recordWebhookRejection("brevo", formatAlertNow);
        }
        const observingFormatRun = await runMalformedWebhookAlerts(formatAlertNow, makeFakeTransport().transport);
        assert.deepEqual(observingFormatRun.malformedProviders, [], "below the deliberate malformed-batch threshold stays quiet");
        assert.equal(
          malformedWebhookState({
            rejectedPayloadCount: WEBHOOK_REJECTION_ALERT_THRESHOLD - 1,
            lastRejectedAt: formatAlertNow,
            now: formatAlertNow,
          }),
          "observing",
          "below-threshold traffic is visibly monitored without an alert",
        );

        await recordWebhookRejection("brevo", formatAlertNow);
        const firstFormatAlert = makeFakeTransport();
        const firstFormatRun = await runMalformedWebhookAlerts(formatAlertNow, firstFormatAlert.transport);
        cleanup.emailEventKeys.push(...firstFormatRun.attemptedEventKeys);
        assert.deepEqual(firstFormatRun.malformedProviders, ["brevo"], "only the provider crossing the threshold alerts");
        assert.ok(firstFormatRun.recipientCount >= 1, "administrators are an audience for the format alert");
        assert.equal(firstFormatAlert.calls.length, firstFormatRun.recipientCount, "one aggregate alert is sent to every administrator");
        assert.ok(firstFormatAlert.calls.some((call) => call.email === formatAdminEmail), "the dedicated administrator receives the format alert");
        assert.ok(firstFormatAlert.calls.every((call) => call.subject.includes("Brevo")), "the alert names the affected provider");
        assert.deepEqual(
          malformedWebhookAlertProviders({
            brevo: {
              lastEventAt: null, rejectedPayloadCount: WEBHOOK_REJECTION_ALERT_THRESHOLD,
              lastRejectedAt: formatAlertNow.toISOString(), malformedWebhookState: "alerted",
              lastAutomationSentAt: null, recentSendCount: 0, warning: false,
            },
            infobip: {
              lastEventAt: null, rejectedPayloadCount: 0, lastRejectedAt: null,
              malformedWebhookState: "normal", lastAutomationSentAt: null, recentSendCount: 0, warning: false,
            },
          }),
          ["brevo"],
          "the selector preserves per-provider isolation",
        );
        const [formatAlertRow] = await db.select().from(emailDeliveriesTable).where(and(
          eq(emailDeliveriesTable.emailType, "malformed_webhook_alert"),
          eq(emailDeliveriesTable.recipientEmail, formatAdminEmail),
        ));
        assert.ok(formatAlertRow, "the format alert is persisted in the durable email outbox");
        assert.deepEqual(Object.keys(formatAlertRow.metadata).sort(), ["count", "provider", "windowEnd", "windowStart"]);
        assert.equal(formatAlertRow.metadata.provider, "brevo");
        assert.equal(formatAlertRow.metadata.count, WEBHOOK_REJECTION_ALERT_THRESHOLD);
        assert.ok(formatAlertRow.htmlContent, "the format alert has an aggregate-only email body");
        assert.equal(formatAlertRow.htmlContent.includes(brevoSecret), false, "alert body never includes a webhook secret");
        assert.equal(formatAlertRow.htmlContent.includes(smsSecret), false, "alert body never includes another provider secret");
        assert.equal(formatAlertRow.htmlContent.includes(runA.brevoMessageId), false, "alert body never includes a message reference");

        const repeatFormatAlert = makeFakeTransport();
        const repeatFormatRun = await runMalformedWebhookAlerts(
          new Date(formatAlertNow.getTime() + 15 * 60_000),
          repeatFormatAlert.transport,
        );
        assert.equal(repeatFormatRun.attemptedEventKeys.length, 0, "same provider is rate-limited inside the cooldown");
        assert.ok(repeatFormatRun.cooldownSuppressedCount >= 1, "the durable provider cooldown suppresses the next scheduler tick");
        assert.equal(repeatFormatAlert.calls.length, 0, "suppressed format alerts never contact the email transport");

        const recoveryNow = new Date(formatAlertNow.getTime() + WEBHOOK_REJECTION_WINDOW_HOURS * 60 * 60_000 + 1);
        assert.equal(
          malformedWebhookState({
            rejectedPayloadCount: WEBHOOK_REJECTION_ALERT_THRESHOLD,
            lastRejectedAt: formatAlertNow,
            now: recoveryNow,
          }),
          "recovered",
          "the integrations lifecycle visibly reports recovery after a quiet window",
        );
        const renewedFormatNow = new Date(formatAlertNow.getTime() + MALFORMED_WEBHOOK_ALERT_COOLDOWN_MS + 1);
        for (let index = 0; index < WEBHOOK_REJECTION_ALERT_THRESHOLD; index += 1) {
          await recordWebhookRejection("brevo", renewedFormatNow);
        }
        const renewedFormatAlert = makeFakeTransport();
        const renewedFormatRun = await runMalformedWebhookAlerts(renewedFormatNow, renewedFormatAlert.transport);
        cleanup.emailEventKeys.push(...renewedFormatRun.attemptedEventKeys);
        assert.ok(renewedFormatRun.attemptedEventKeys.length >= 1, "a new sustained episode can alert after the rolling cooldown");
        assert.ok(renewedFormatAlert.calls.some((call) => call.email === formatAdminEmail), "the new episode notifies administrators again");

        // Four batches in the current 24h window must remain below the
        // threshold even when four much older batches were previously
        // recorded in an uninterrupted low-rate stream.
        await db.update(providerWebhookReceiptsTable).set({
          rejectedPayloadCount: 0,
          rejectedPayloadTimes: [],
          lastRejectedAt: null,
        }).where(eq(providerWebhookReceiptsTable.provider, "brevo"));
        const rollingNow = new Date();
        const expiredBatchAt = new Date(rollingNow.getTime() - 26 * 60 * 60_000);
        const currentBatchAt = new Date(rollingNow.getTime() - 60 * 60_000);
        for (let index = 0; index < WEBHOOK_REJECTION_ALERT_THRESHOLD - 1; index += 1) {
          await recordWebhookRejection("brevo", expiredBatchAt);
          await recordWebhookRejection("brevo", currentBatchAt);
        }
        const rollingBelowThreshold = await deliveryReportStatuses(rollingNow);
        assert.equal(rollingBelowThreshold.brevo.rejectedPayloadCount, WEBHOOK_REJECTION_ALERT_THRESHOLD - 1);
        assert.equal(rollingBelowThreshold.brevo.malformedWebhookState, "observing");
        await recordWebhookRejection("brevo", currentBatchAt);
        const rollingThreshold = await deliveryReportStatuses(rollingNow);
        assert.equal(rollingThreshold.brevo.rejectedPayloadCount, WEBHOOK_REJECTION_ALERT_THRESHOLD);
        assert.equal(rollingThreshold.brevo.malformedWebhookState, "alerted");
        console.log("✓ malformed webhook alerts are thresholded, private, provider-scoped, rate-limited, and recover visibly");
      }
    }

    // ── 7g. Recovery → one-time "reports arriving again" notice ────────────
    {
      // Two fresh admins: one with a (synthetic, past) silence-alert history
      // for brevo, one that never alerted. Only the first may ever receive a
      // recovery notice, and only once per silence episode.
      const recoveryAdminEmail = `pe-recovery-admin-${suffix}@bg.test`;
      const witnessAdminEmail = `pe-recovery-witness-${suffix}@bg.test`;
      const [recoveryAdmin] = await db.insert(usersTable).values({
        firstName: "Admin", lastName: "Recovery",
        email: recoveryAdminEmail, passwordHash: await hashPassword(`pe-recovery-${suffix}`),
        passwordSetAt: new Date(), role: "ADMIN",
      }).returning();
      const [witnessAdmin] = await db.insert(usersTable).values({
        firstName: "Admin", lastName: "Witness",
        email: witnessAdminEmail, passwordHash: await hashPassword(`pe-witness-${suffix}`),
        passwordSetAt: new Date(), role: "ADMIN",
      }).returning();
      assert.ok(recoveryAdmin && witnessAdmin);
      cleanup.userIds.push(recoveryAdmin.id, witnessAdmin.id);

      // Guarantee a fresh verified-event receipt for brevo (monotonic; the
      // suite's earlier webhook posts already recorded receipts around now).
      await recordWebhookReceipt("brevo");
      const brevoReceipt = await webhookReceipt("brevo");
      assert.ok(brevoReceipt, "brevo receipt exists after verified events");

      const makeFakeTransport = () => {
        const calls: { email: string; subject: string }[] = [];
        const transport: TransactionalEmailTransport = {
          async send(input) {
            calls.push({ email: input.to.email, subject: input.subject });
            return { messageId: `pe-recovery-fake-${calls.length}` };
          },
        };
        return { calls, transport };
      };
      // The 7f alert admin's silence alerts carry FUTURE alertAt anchors
      // (crafted evaluation times) — verified events have NOT arrived after
      // them, so recovery must stay quiet for that admin throughout.
      const futureAlertedAdminEmail = `pe-alert-admin-${suffix}@bg.test`;

      // Baseline tick: neither fresh admin has silence history → no notice.
      const baseline = makeFakeTransport();
      const baselineRun = await runDeliveryReportRecoveryAlerts(new Date(), baseline.transport);
      cleanup.emailEventKeys.push(...baselineRun.attemptedEventKeys);
      for (const email of [recoveryAdminEmail, witnessAdminEmail, futureAlertedAdminEmail]) {
        assert.ok(baseline.calls.every((call) => call.email !== email),
          `no recovery notice without a qualifying silence alert (${email})`);
      }

      // Synthetic past silence episode #1 for the recovery admin only.
      const silenceKey1 = `pe-recovery-silence-1-${suffix}`;
      const alert1At = new Date(Date.now() - 2 * 60 * 60_000);
      cleanup.emailEventKeys.push(silenceKey1);
      await db.insert(emailDeliveriesTable).values({
        eventKey: silenceKey1, emailType: "delivery_report_silence_alert",
        recipientEmail: recoveryAdminEmail, subject: "PE silence 1", htmlContent: "<p>x</p>",
        status: "sent", sentAt: alert1At,
        metadata: { provider: "brevo", alertAt: alert1At.toISOString(), sequence: 1 },
      });
      assert.ok(brevoReceipt.getTime() > alert1At.getTime(), "verified events postdate the synthetic alert");

      // Old/manual outbox rows can contain non-numeric JSON. The history
      // aggregate must ignore that row rather than crashing the entire
      // scheduler cycle while it evaluates a legitimate recovery.
      const malformedRecoveryKey = `pe-recovery-malformed-sequence-${suffix}`;
      cleanup.emailEventKeys.push(malformedRecoveryKey);
      await db.insert(emailDeliveriesTable).values({
        eventKey: malformedRecoveryKey, emailType: "delivery_report_recovery_alert",
        recipientEmail: recoveryAdminEmail, subject: "PE malformed recovery", htmlContent: "<p>x</p>",
        status: "sent", sentAt: alert1At,
        metadata: { provider: "brevo", silenceSequence: "not-a-number" },
      });

      // While the provider still reads SILENT, history + resumed events must
      // not trigger a notice. probeAt is far enough ahead that a grace-aged
      // qualifying email send exists with no receipt after it.
      const g = await makeOwnerAndSalon("recovery");
      const [customerG] = await db.insert(salonCustomersTable).values({
        salonId: g.salon.id, firstName: "Kupac", lastName: "G", email: `pe-cust-g-${suffix}@bg.test`,
      }).returning();
      const [ruleG] = await db.insert(automationRulesTable).values({
        salonId: g.salon.id, name: `PE pravilo G ${suffix}`, trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
      }).returning();
      assert.ok(customerG && ruleG);
      const probeAt = new Date(Date.now() + 48 * 60 * 60_000);
      const probeSentAt = new Date(probeAt.getTime() - 35 * 60_000);
      const probeRunKey = `pe-run-recovery-${suffix}`;
      const [probeRun] = await db.insert(automationRunsTable).values({
        eventKey: probeRunKey, ruleId: ruleG.id, salonId: g.salon.id, salonCustomerId: customerG.id,
        status: "sent", executedAt: probeSentAt, sentAt: probeSentAt,
      }).returning();
      assert.ok(probeRun);
      const [probeDelivery] = await db.insert(automationDeliveriesTable).values({
        runId: probeRun.id, salonId: g.salon.id, eventKey: `${probeRunKey}:email`, channel: "email",
        recipientEmail: `pe-recovery-stale-${suffix}@bg.test`, status: "sent", sentAt: probeSentAt,
      }).returning();
      assert.ok(probeDelivery);
      const stale = makeFakeTransport();
      const staleRun = await runDeliveryReportRecoveryAlerts(probeAt, stale.transport);
      cleanup.emailEventKeys.push(...staleRun.attemptedEventKeys);
      assert.ok(!staleRun.notifiedProviders.includes("brevo"), "a still-silent provider never announces recovery");
      assert.ok(stale.calls.every((call) => call.email !== recoveryAdminEmail),
        "no recovery notice while the warning is still active");

      // Healthy tick at the real current time: exactly one notice, naming the
      // provider, to the alerted admin only.
      const first = makeFakeTransport();
      const firstRun = await runDeliveryReportRecoveryAlerts(new Date(), first.transport);
      cleanup.emailEventKeys.push(...firstRun.attemptedEventKeys);
      const firstMine = first.calls.filter((call) => call.email === recoveryAdminEmail);
      assert.equal(firstMine.length, 1, "exactly one recovery notice for the alerted admin");
      assert.ok(firstMine[0]!.subject.includes("ponovo stižu"), "notice says reports are arriving again");
      assert.ok(firstMine[0]!.subject.includes("Brevo"), "notice names the recovered provider");
      assert.ok(firstRun.notifiedProviders.includes("brevo"), "brevo reported as notified");
      assert.equal(firstRun.failedDeliveryCount, 0);
      assert.equal(firstRun.skippedDeliveryCount, 0);
      assert.ok(first.calls.every((call) => call.email !== witnessAdminEmail),
        "an admin that never alerted gets no recovery notice");
      assert.ok(first.calls.every((call) => call.email !== futureAlertedAdminEmail),
        "no notice when verified events have not arrived after the newest alert");

      // Repeat tick: the episode is answered — nothing new for our admin, and
      // the suppression happens without contacting the provider.
      const second = makeFakeTransport();
      const secondRun = await runDeliveryReportRecoveryAlerts(new Date(), second.transport);
      cleanup.emailEventKeys.push(...secondRun.attemptedEventKeys);
      assert.ok(second.calls.every((call) => call.email !== recoveryAdminEmail),
        "repeat tick sends no second notice for the same episode");
      assert.ok(secondRun.alreadyNotifiedCount >= 1, "answered episode is suppressed before the outbox");

      // A NEW silence episode (fresh alert after the recovery) re-arms the
      // notice under a fresh outbox key — flapping without a new alert never
      // spams, a genuine new alert closes its own loop.
      const silenceKey2 = `pe-recovery-silence-2-${suffix}`;
      const alert2At = new Date(Date.now() - 60 * 60_000);
      cleanup.emailEventKeys.push(silenceKey2);
      await db.insert(emailDeliveriesTable).values({
        eventKey: silenceKey2, emailType: "delivery_report_silence_alert",
        recipientEmail: recoveryAdminEmail, subject: "PE silence 2", htmlContent: "<p>x</p>",
        status: "sent", sentAt: alert2At,
        metadata: { provider: "brevo", alertAt: alert2At.toISOString(), sequence: 2 },
      });
      const third = makeFakeTransport();
      const thirdRun = await runDeliveryReportRecoveryAlerts(new Date(), third.transport);
      cleanup.emailEventKeys.push(...thirdRun.attemptedEventKeys);
      const thirdMine = third.calls.filter((call) => call.email === recoveryAdminEmail);
      assert.equal(thirdMine.length, 1, "a new silence episode earns exactly one new recovery notice");
      for (const eventKey of thirdRun.attemptedEventKeys) {
        assert.ok(!firstRun.attemptedEventKeys.includes(eventKey), "new episode uses a fresh outbox key");
      }
      console.log("✓ recovery notices close the loop once per silence episode and never fire without a prior alert");
    }

    // ── 8. Cross-salon isolation + owner stats accuracy ────────────────────
    {
      // Salon B's rows must be completely untouched by all salon-A traffic.
      for (const key of [runB.emailKey, runB.smsKey]) {
        const row = await automationDelivery(key);
        assert.equal(row.deliveredAt, null, `salon B delivery ${key} untouched`);
        assert.equal(row.openedAt, null);
        assert.equal(row.failedAt, null);
      }

      const getStats = async (token: string, ruleId: string) => {
        const response = await fetch(`${baseUrl}/api/growth/automations/${ruleId}/stats`, {
          headers: { cookie: `${sessionCookieName}=${token}` },
        });
        assert.equal(response.status, 200);
        return response.json() as Promise<Record<string, number>>;
      };

      const statsA = await getStats(a.token, ruleA.id);
      // Email: a1 delivered+opened, a2 opened (delivered backfilled), a3 delivered.
      assert.equal(statsA["emailSentCount"], 3);
      assert.equal(statsA["emailDeliveredCount"], 3);
      assert.equal(statsA["emailOpenedCount"], 2);
      assert.equal(statsA["emailFailedCount"], 0, "cleared failure not counted");
      // SMS: a1 delivered, a2 failed, a3 nothing.
      assert.equal(statsA["smsSentCount"], 3);
      assert.equal(statsA["smsDeliveredCount"], 1);
      assert.equal(statsA["smsFailedCount"], 1);
      assert.equal(statsA["deliveredCount"], 4);
      assert.equal(statsA["openedCount"], 2);

      const statsB = await getStats(b.token, ruleB.id);
      assert.equal(statsB["deliveredCount"], 0, "salon B sees no cross-salon deliveries");
      assert.equal(statsB["openedCount"], 0);
      assert.equal(statsB["emailSentCount"], 1);
      assert.equal(statsB["smsSentCount"], 1);

      // Owner B must not read rule A's stats at all.
      const cross = await fetch(`${baseUrl}/api/growth/automations/${ruleA.id}/stats`, {
        headers: { cookie: `${sessionCookieName}=${b.token}` },
      });
      assert.equal(cross.status, 404, "cross-salon stats read must 404");
      console.log("✓ cross-salon isolation holds; owner stats expose accurate per-channel counts");

      // Aggregate campaign overview must mirror the per-rule counts and stay
      // strictly scoped to the requesting owner's salon.
      const getOverview = async (token: string) => {
        const response = await fetch(`${baseUrl}/api/growth/automation-stats`, {
          headers: { cookie: `${sessionCookieName}=${token}` },
        });
        assert.equal(response.status, 200);
        return response.json() as Promise<Array<Record<string, unknown>>>;
      };

      const overviewA = await getOverview(a.token);
      const overviewRowA = overviewA.find((row) => row["ruleId"] === ruleA.id);
      assert.ok(overviewRowA, "overview must include salon A's rule");
      assert.equal(overviewRowA["ruleName"], ruleA.name);
      assert.equal(overviewRowA["ruleStatus"], "active");
      assert.equal(overviewRowA["emailSentCount"], statsA["emailSentCount"]);
      assert.equal(overviewRowA["emailDeliveredCount"], statsA["emailDeliveredCount"]);
      assert.equal(overviewRowA["emailOpenedCount"], statsA["emailOpenedCount"]);
      assert.equal(overviewRowA["emailFailedCount"], statsA["emailFailedCount"]);
      assert.equal(overviewRowA["smsSentCount"], statsA["smsSentCount"]);
      assert.equal(overviewRowA["smsDeliveredCount"], statsA["smsDeliveredCount"]);
      assert.equal(overviewRowA["smsFailedCount"], statsA["smsFailedCount"]);
      assert.equal(overviewRowA["attributedAppointments"], statsA["attributedAppointments"]);
      assert.ok(!overviewA.some((row) => row["ruleId"] === ruleB.id), "overview must never include another salon's rules");

      const overviewB = await getOverview(b.token);
      assert.ok(overviewB.some((row) => row["ruleId"] === ruleB.id), "salon B sees its own rule");
      assert.ok(!overviewB.some((row) => row["ruleId"] === ruleA.id), "salon B never sees salon A's rules");

      const overviewAnon = await fetch(`${baseUrl}/api/growth/automation-stats`);
      assert.equal(overviewAnon.status, 403, "unauthenticated overview read must be rejected");
      console.log("✓ aggregate campaign overview matches per-rule counts and is salon-scoped");
    }

    // ── 8b. ?period= windows filter run/delivery aggregation ───────────────
    {
      // A run sent ~100 days ago must show up for all time but stay outside
      // every 7/30/90-day window on both stats endpoints.
      const old = await makeSentRun(a.salon.id, ruleA.id, customerA.id, "a-old");
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await db.update(automationRunsTable)
        .set({ executedAt: oldDate, sentAt: oldDate, createdAt: oldDate })
        .where(eq(automationRunsTable.id, old.run.id));
      await db.update(automationDeliveriesTable)
        .set({ sentAt: oldDate, createdAt: oldDate })
        .where(eq(automationDeliveriesTable.runId, old.run.id));

      const getOverviewRow = async (period?: string) => {
        const qs = period ? `?period=${period}` : "";
        const response = await fetch(`${baseUrl}/api/growth/automation-stats${qs}`, {
          headers: { cookie: `${sessionCookieName}=${a.token}` },
        });
        assert.equal(response.status, 200);
        const rows = await response.json() as Array<Record<string, unknown>>;
        const row = rows.find((r) => r["ruleId"] === ruleA.id);
        assert.ok(row, "overview must include salon A's rule");
        return row;
      };

      const allTimeDefault = await getOverviewRow();
      const allTimeExplicit = await getOverviewRow("all");
      assert.equal(allTimeDefault["totalRuns"], 4, "all-time includes the 100-day-old run");
      assert.equal(allTimeDefault["emailSentCount"], 4, "all-time includes the old email delivery");
      assert.equal(allTimeExplicit["totalRuns"], 4, "period=all matches the default");

      for (const period of ["7d", "30d", "90d"]) {
        const windowed = await getOverviewRow(period);
        assert.equal(windowed["totalRuns"], 3, `${period} window excludes the 100-day-old run`);
        assert.equal(windowed["emailSentCount"], 3, `${period} window excludes the old email delivery`);
      }

      const perRuleStats = async (period: string) => {
        const response = await fetch(`${baseUrl}/api/growth/automations/${ruleA.id}/stats?period=${period}`, {
          headers: { cookie: `${sessionCookieName}=${a.token}` },
        });
        assert.equal(response.status, 200);
        return response.json() as Promise<Record<string, number>>;
      };
      const perRule30 = await perRuleStats("30d");
      assert.equal(perRule30["totalRuns"], 3, "per-rule 30d window excludes the old run");
      assert.equal(perRule30["emailSentCount"], 3, "per-rule 30d window excludes the old delivery");
      const perRuleAll = await perRuleStats("all");
      assert.equal(perRuleAll["totalRuns"], 4, "per-rule all-time includes the old run");

      const invalid = await fetch(`${baseUrl}/api/growth/automation-stats?period=14d`, {
        headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(invalid.status, 400, "unknown period value must be rejected explicitly");
      console.log("✓ ?period= windows run/delivery aggregation on both stats endpoints; unknown values rejected");

      // ── 8c. ?from=/?to= custom date ranges ────────────────────────────────
      const toDateParam = (d: Date) => d.toISOString().slice(0, 10);
      const dayMs = 24 * 60 * 60 * 1000;

      const getOverviewRowQs = async (qs: string) => {
        const response = await fetch(`${baseUrl}/api/growth/automation-stats${qs}`, {
          headers: { cookie: `${sessionCookieName}=${a.token}` },
        });
        assert.equal(response.status, 200, `expected 200 for ${qs}`);
        const rows = await response.json() as Array<Record<string, unknown>>;
        const row = rows.find((r) => r["ruleId"] === ruleA.id);
        assert.ok(row, `overview must include salon A's rule for ${qs}`);
        return row;
      };

      // Range around only the 100-day-old run isolates exactly that run.
      const oldOnly = await getOverviewRowQs(
        `?from=${toDateParam(new Date(oldDate.getTime() - dayMs))}&to=${toDateParam(new Date(oldDate.getTime() + dayMs))}`,
      );
      assert.equal(oldOnly["totalRuns"], 1, "custom range around the old run isolates it");
      assert.equal(oldOnly["emailSentCount"], 1, "custom range isolates the old delivery");

      // Recent range (last 10 days, inclusive of today) excludes the old run.
      const recent = await getOverviewRowQs(
        `?from=${toDateParam(new Date(Date.now() - 10 * dayMs))}&to=${toDateParam(new Date())}`,
      );
      assert.equal(recent["totalRuns"], 3, "recent custom range excludes the old run; to= is end-of-day inclusive");
      assert.equal(recent["emailSentCount"], 3, "recent custom range excludes the old delivery");

      // Open-ended sides: from-only and to-only.
      const fromOnly = await getOverviewRowQs(`?from=${toDateParam(new Date(Date.now() - 10 * dayMs))}`);
      assert.equal(fromOnly["totalRuns"], 3, "from-only range is open-ended toward now");
      const toOnly = await getOverviewRowQs(`?to=${toDateParam(new Date(oldDate.getTime() + dayMs))}`);
      assert.equal(toOnly["totalRuns"], 1, "to-only range is open-ended toward the past");

      // Per-rule endpoint honors the same custom range.
      const perRuleCustom = await fetch(
        `${baseUrl}/api/growth/automations/${ruleA.id}/stats?from=${toDateParam(new Date(oldDate.getTime() - dayMs))}&to=${toDateParam(new Date(oldDate.getTime() + dayMs))}`,
        { headers: { cookie: `${sessionCookieName}=${a.token}` } },
      );
      assert.equal(perRuleCustom.status, 200);
      const perRuleCustomBody = await perRuleCustom.json() as Record<string, number>;
      assert.equal(perRuleCustomBody["totalRuns"], 1, "per-rule custom range isolates the old run");

      // Invalid ranges are rejected explicitly (400), never silently ignored.
      const expect400 = async (qs: string, label: string) => {
        for (const url of [
          `${baseUrl}/api/growth/automation-stats${qs}`,
          `${baseUrl}/api/growth/automations/${ruleA.id}/stats${qs}`,
        ]) {
          const response = await fetch(url, { headers: { cookie: `${sessionCookieName}=${a.token}` } });
          assert.equal(response.status, 400, `${label} must be rejected with 400 (${url})`);
        }
      };
      await expect400("?from=2026-02-01&to=2026-01-01", "inverted range (from > to)");
      await expect400("?from=not-a-date", "malformed from date");
      await expect400("?to=2026-02-30", "impossible calendar date");
      await expect400("?period=30d&from=2026-01-01", "combining period with from/to");
      console.log("✓ ?from=/?to= custom ranges window both stats endpoints; invalid ranges rejected with 400");
    }

    // ── 8c. Attribution excludes cancelled appointments ─────────────────────
    {
      const statusesByBucket = new Map<string, string[]>();
      for (const [bucket, statuses] of Object.entries(CAMPAIGN_APPOINTMENT_STATUS_BUCKETS)) {
        for (const status of statuses) {
          const buckets = statusesByBucket.get(status) ?? [];
          buckets.push(bucket);
          statusesByBucket.set(status, buckets);
        }
      }
      for (const status of appointmentsTable.status.enumValues) {
        const buckets = statusesByBucket.get(status) ?? [];
        assert.equal(
          buckets.length,
          1,
          `appointment status "${status}" must be explicitly classified into exactly one campaign bucket (completed, upcoming, cancelled-attributed, or excluded); update CAMPAIGN_APPOINTMENT_STATUS_BUCKETS`,
        );
        assert.equal(
          getCampaignAppointmentStatusBucket(status),
          buckets[0],
          `campaign consumers must resolve "${status}" through the canonical campaign bucket`,
        );
      }
      assert.deepEqual(
        [...statusesByBucket.keys()].sort(),
        [...appointmentsTable.status.enumValues].sort(),
        "campaign bucket classification must not contain statuses outside appointmentsTable.status.enumValues",
      );

      // A confirmed appointment counts toward both the attributed count and
      // the attributed revenue; cancelled and no-show appointments contribute
      // to neither realized total.
      const [service] = await db.insert(servicesTable).values({
        salonId: a.salon.id, categoryName: "PE", name: `PE Service ${suffix}`,
        description: "Test", durationMinutes: 30, price: 3000, imageUrl: "/t.jpg",
      }).returning();
      assert.ok(service);

      const makeAppointment = async (status: "confirmed" | "cancelled" | "completed" | "no-show", price: number) => {
        const [appointment] = await db.insert(appointmentsTable).values({
          salonId: a.salon.id, salonCustomerId: customerA.id, serviceId: service.id,
          date: "2026-08-20", startTime: "10:00", endTime: "10:30",
          durationMinutes: 30, price, status,
        }).returning();
        assert.ok(appointment);
        return appointment;
      };
      const kept = await makeAppointment("confirmed", 3000);
      const cancelled = await makeAppointment("cancelled", 5000);
      const earned = await makeAppointment("completed", 2000);
      const missed = await makeAppointment("no-show", 7000);

      const runA4 = await makeSentRun(a.salon.id, ruleA.id, customerA.id, "a4");
      await db.update(automationRunsTable).set({ attributedAppointmentId: kept.id })
        .where(eq(automationRunsTable.id, runA.run.id));
      await db.update(automationRunsTable).set({ attributedAppointmentId: cancelled.id })
        .where(eq(automationRunsTable.id, runA2.run.id));
      await db.update(automationRunsTable).set({ attributedAppointmentId: earned.id })
        .where(eq(automationRunsTable.id, runA3.run.id));
      await db.update(automationRunsTable).set({ attributedAppointmentId: missed.id })
        .where(eq(automationRunsTable.id, runA4.run.id));

      const statsResponse = await fetch(`${baseUrl}/api/growth/automations/${ruleA.id}/stats`, {
        headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(statsResponse.status, 200);
      const attributionStats = await statsResponse.json() as Record<string, number>;
      assert.equal(attributionStats["attributedAppointments"], 2, "cancelled and no-show appointments must not count as attributed");
      assert.equal(attributionStats["attributedRevenue"], 5000, "cancelled and no-show appointment revenue must be excluded");
      // The cancelled line ("otkazano") reports the fallen-through bookings
      // separately: count and lost revenue, without touching realized numbers.
      assert.equal(attributionStats["cancelledAttributedAppointments"], 1, "cancelled appointment must be reported in the separate cancelled count");
      assert.equal(attributionStats["cancelledAttributedRevenue"], 5000, "cancelled revenue must be reported separately as lost revenue");
      assert.equal(attributionStats["noShowAttributedAppointments"], 1, "no-show appointment must be reported in the separate no-show count");
      assert.equal(attributionStats["noShowAttributedRevenue"], 7000, "no-show revenue must be reported separately as not realized");
      assert.equal(
        (attributionStats["attributedAppointments"] ?? 0)
          + (attributionStats["cancelledAttributedAppointments"] ?? 0)
          + (attributionStats["noShowAttributedAppointments"] ?? 0),
        4,
        "realized + cancelled + no-show must reconcile with every attributed run",
      );
      assert.equal(
        (attributionStats["attributedRevenue"] ?? 0)
          + (attributionStats["cancelledAttributedRevenue"] ?? 0)
          + (attributionStats["noShowAttributedRevenue"] ?? 0),
        17000,
        "realized + cancelled + no-show revenue must reconcile with every attributed appointment price",
      );
      // Completed vs upcoming split: completed money is separated from the
      // still-upcoming (confirmed) appointment, the no-show lands in neither
      // bucket, and the buckets sum exactly to the attributed totals.
      assert.equal(attributionStats["completedAppointments"], 1, "only the completed appointment counts as earned");
      assert.equal(attributionStats["completedRevenue"], 2000, "earned revenue is the completed appointment's price");
      assert.equal(attributionStats["upcomingAppointments"], 1, "only the confirmed appointment counts as upcoming — never the no-show");
      assert.equal(attributionStats["upcomingRevenue"], 3000, "upcoming revenue is the confirmed appointment's price — no-show money is excluded");
      assert.equal(
        attributionStats["completedRevenue"]! + attributionStats["upcomingRevenue"]!,
        attributionStats["attributedRevenue"],
        "split revenue must sum to the attributed total",
      );
      assert.equal(
        attributionStats["completedAppointments"]! + attributionStats["upcomingAppointments"]!,
        attributionStats["attributedAppointments"],
        "split counts must sum to the attributed total",
      );

      const overviewResponse = await fetch(`${baseUrl}/api/growth/automation-stats`, {
        headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(overviewResponse.status, 200);
      const overviewRows = await overviewResponse.json() as Array<Record<string, unknown>>;
      const overviewRow = overviewRows.find((row) => row["ruleId"] === ruleA.id);
      assert.ok(overviewRow);
      assert.equal(overviewRow["attributedAppointments"], 2, "overview must apply the same cancelled/no-show filter");
      assert.equal(overviewRow["attributedRevenue"], 5000, "overview revenue must match the per-rule stats");
      assert.equal(overviewRow["completedAppointments"], 1, "overview must expose the same completed count");
      assert.equal(overviewRow["completedRevenue"], 2000, "overview must expose the same completed revenue");
      assert.equal(overviewRow["upcomingAppointments"], 1, "overview must expose the same upcoming count — never the no-show");
      assert.equal(overviewRow["upcomingRevenue"], 3000, "overview must expose the same upcoming revenue — no-show money is excluded");
      assert.equal(overviewRow["cancelledAttributedAppointments"], 1, "overview must report the cancelled count separately");
      assert.equal(overviewRow["cancelledAttributedRevenue"], 5000, "overview must report cancelled (lost) revenue separately");
      assert.equal(overviewRow["noShowAttributedAppointments"], 1, "overview must report the no-show count separately");
      assert.equal(overviewRow["noShowAttributedRevenue"], 7000, "overview must report no-show (not realized) revenue separately");
      assert.equal(
        (overviewRow["attributedAppointments"] as number)
          + (overviewRow["cancelledAttributedAppointments"] as number)
          + (overviewRow["noShowAttributedAppointments"] as number),
        4,
        "overview outcome counts must reconcile to every attributed run",
      );
      assert.equal(
        (overviewRow["attributedRevenue"] as number)
          + (overviewRow["cancelledAttributedRevenue"] as number)
          + (overviewRow["noShowAttributedRevenue"] as number),
        17000,
        "overview outcome revenue must reconcile to every attributed appointment price",
      );
      console.log("✓ cancelled and no-show appointments are excluded from realized numbers; all outcome buckets reconcile in both endpoints");
    }

    // ── 8d. compare=previous: previous-window counts share the same filters ─
    {
      // Isolated rule so counts stay deterministic: one run in the current
      // 7-day window (email delivered + opened) and three runs in the
      // preceding window (one email delivered, one SMS delivered; attributed
      // to a confirmed, a cancelled, and a no-show appointment). Cancelled
      // and no-show appointments must not count in the previous window either
      // — it uses the exact same realized join as the current-period aggregate.
      const [ruleT] = await db.insert(automationRulesTable).values({
        salonId: a.salon.id, name: `PE trend pravilo ${suffix}`, trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 }, action: "send_email_and_sms", status: "active",
      }).returning();
      assert.ok(ruleT);

      const currentRun = await makeSentRun(a.salon.id, ruleT.id, customerA.id, "t-cur");
      await db.update(automationDeliveriesTable)
        .set({ deliveredAt: new Date(), openedAt: new Date() })
        .where(eq(automationDeliveriesTable.eventKey, currentRun.emailKey));

      const prevDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const shiftToPreviousWindow = async (runId: string) => {
        await db.update(automationRunsTable)
          .set({ executedAt: prevDate, sentAt: prevDate, createdAt: prevDate })
          .where(eq(automationRunsTable.id, runId));
        await db.update(automationDeliveriesTable)
          .set({ sentAt: prevDate, createdAt: prevDate })
          .where(eq(automationDeliveriesTable.runId, runId));
      };
      const prevRun1 = await makeSentRun(a.salon.id, ruleT.id, customerA.id, "t-prev1");
      const prevRun2 = await makeSentRun(a.salon.id, ruleT.id, customerA.id, "t-prev2");
      const prevRun3 = await makeSentRun(a.salon.id, ruleT.id, customerA.id, "t-prev3");
      await shiftToPreviousWindow(prevRun1.run.id);
      await shiftToPreviousWindow(prevRun2.run.id);
      await shiftToPreviousWindow(prevRun3.run.id);
      await db.update(automationDeliveriesTable)
        .set({ deliveredAt: prevDate })
        .where(inArray(automationDeliveriesTable.eventKey, [prevRun1.emailKey, prevRun1.smsKey]));

      const [trendService] = await db.insert(servicesTable).values({
        salonId: a.salon.id, categoryName: "PE", name: `PE Trend Service ${suffix}`,
        description: "Test", durationMinutes: 30, price: 2000, imageUrl: "/t.jpg",
      }).returning();
      assert.ok(trendService);
      const makeTrendAppointment = async (status: "confirmed" | "cancelled" | "no-show", price: number) => {
        const [appointment] = await db.insert(appointmentsTable).values({
          salonId: a.salon.id, salonCustomerId: customerA.id, serviceId: trendService.id,
          date: "2026-08-13", startTime: "11:00", endTime: "11:30",
          durationMinutes: 30, price, status,
        }).returning();
        assert.ok(appointment);
        return appointment;
      };
      const keptPrev = await makeTrendAppointment("confirmed", 2000);
      const cancelledPrev = await makeTrendAppointment("cancelled", 4000);
      const missedPrev = await makeTrendAppointment("no-show", 6000);
      await db.update(automationRunsTable).set({ attributedAppointmentId: keptPrev.id })
        .where(eq(automationRunsTable.id, prevRun1.run.id));
      await db.update(automationRunsTable).set({ attributedAppointmentId: cancelledPrev.id })
        .where(eq(automationRunsTable.id, prevRun2.run.id));
      await db.update(automationRunsTable).set({ attributedAppointmentId: missedPrev.id })
        .where(eq(automationRunsTable.id, prevRun3.run.id));

      const perRuleTrend = async (qs: string) => fetch(
        `${baseUrl}/api/growth/automations/${ruleT.id}/stats${qs}`,
        { headers: { cookie: `${sessionCookieName}=${a.token}` } },
      );

      const trendResponse = await perRuleTrend("?period=7d&compare=previous");
      assert.equal(trendResponse.status, 200);
      const trend = await trendResponse.json() as Record<string, unknown>;
      assert.equal(trend["emailSentCount"], 1, "current window has exactly one email send");
      assert.equal(trend["emailDeliveredCount"], 1);
      assert.equal(trend["emailOpenedCount"], 1);
      assert.equal(trend["attributedAppointments"], 0, "no attribution in the current window");
      const previous = trend["previous"] as Record<string, number> | undefined;
      assert.ok(previous, "compare=previous must include a previous block");
      assert.equal(previous["emailDeliveredCount"], 1, "previous window email delivery counted");
      assert.equal(previous["emailOpenedCount"], 0, "no opens in the previous window");
      assert.equal(previous["smsDeliveredCount"], 1, "previous window SMS delivery counted");
      assert.equal(previous["attributedAppointments"], 1,
        "cancelled and no-show appointments must not count as attributed in the previous window");
      assert.equal(previous["attributedRevenue"], 2000,
        "previous window revenue must sum only realized (non-cancelled, non-no-show) attributed appointments");
      assert.equal(previous["noShowAttributedAppointments"], 1,
        "previous window must expose no-show appointments separately from realized attribution");
      assert.equal(previous["noShowAttributedRevenue"], 6000,
        "previous window must expose no-show value separately from realized revenue");

      // The overview endpoint must apply the same cancelled/no-show filter to
      // its previous block, so both surfaces show the same trend direction.
      const overviewTrendResponse = await fetch(`${baseUrl}/api/growth/automation-stats?period=7d&compare=previous`, {
        headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(overviewTrendResponse.status, 200);
      const overviewTrendRows = await overviewTrendResponse.json() as Array<Record<string, unknown>>;
      const overviewTrendRow = overviewTrendRows.find((row) => row["ruleId"] === ruleT.id);
      assert.ok(overviewTrendRow);
      const overviewPrevious = overviewTrendRow["previous"] as Record<string, number> | undefined;
      assert.ok(overviewPrevious, "overview compare=previous must include a previous block");
      assert.equal(overviewPrevious["attributedAppointments"], 1,
        "overview previous window must exclude cancelled and no-show appointments too");
      assert.equal(overviewPrevious["attributedRevenue"], 2000,
        "overview previous window revenue must match the per-rule stats");
      assert.equal(overviewPrevious["noShowAttributedAppointments"], 1,
        "overview previous window must expose no-show appointments separately");
      assert.equal(overviewPrevious["noShowAttributedRevenue"], 6000,
        "overview previous window must expose no-show value separately");
      assert.equal(overviewPrevious["emailDeliveredCount"], 1);
      assert.equal(overviewPrevious["smsDeliveredCount"], 1);

      // Without the compare flag there must be no previous block at all.
      const plainResponse = await perRuleTrend("?period=7d");
      assert.equal(plainResponse.status, 200);
      const plain = await plainResponse.json() as Record<string, unknown>;
      assert.ok(!("previous" in plain), "no compare flag → no previous block");

      // Validation: compare=previous needs a bounded period; unknown compare
      // values are rejected explicitly.
      assert.equal((await perRuleTrend("?period=all&compare=previous")).status, 400,
        "compare=previous with all-time must be rejected");
      assert.equal((await perRuleTrend("?compare=previous")).status, 400,
        "compare=previous without a period (defaults to all time) must be rejected");
      assert.equal((await perRuleTrend("?period=7d&compare=bogus")).status, 400,
        "unknown compare value must be rejected");
      console.log("✓ compare=previous returns previous-window counts with the same realized (non-cancelled, non-no-show) attribution filter on both endpoints");
    }

    // ── 9. End-to-end: authenticated webhook calls never log the token ─────
    {
      const { output, exitCode } = await captureWebhookLogs();
      assert.equal(exitCode, 0, `logcheck child must succeed (output:\n${output})`);
      assert.ok(output.includes("request completed"), "child must have produced request logs");
      assert.ok(!output.includes(brevoSecret), "webhook token must never appear in any log output");
      assert.ok(output.includes("/api/webhooks/brevo/:token"), "logged webhook path must be redacted to :token");
      console.log("✓ authenticated webhook requests log a redacted path, never the token");
    }

    console.log("\n✅ All automation provider-event tests passed");
  } finally {
    server.close();
    // Restore shared monitoring state after accepted webhook coverage.
    await db.delete(providerWebhookReceiptsTable).where(
      inArray(providerWebhookReceiptsTable.provider, ["brevo", "infobip"]),
    );
    if (priorReceiptRows.length) await db.insert(providerWebhookReceiptsTable).values(priorReceiptRows);
    // Cleanup in dependency order.
    if (cleanup.emailEventKeys.length) {
      await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, cleanup.emailEventKeys));
    }
    if (cleanup.smsEventKeys.length) {
      await db.delete(smsDeliveriesTable).where(inArray(smsDeliveriesTable.eventKey, cleanup.smsEventKeys));
    }
    for (const salonId of cleanup.salonIds) {
      await db.delete(automationDeliveriesTable).where(eq(automationDeliveriesTable.salonId, salonId));
      await db.delete(automationRunsTable).where(eq(automationRunsTable.salonId, salonId));
      await db.delete(automationRulesTable).where(eq(automationRulesTable.salonId, salonId));
      await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, salonId));
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    }
    if (cleanup.userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
    }
    await pool.end();
  }
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
