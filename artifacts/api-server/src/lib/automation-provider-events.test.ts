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
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  emailDeliveriesTable,
  pool,
  providerWebhookReceiptsTable,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  smsDeliveriesTable,
  usersTable,
} from "@workspace/db";
import app, { safePathname, redactPathSecrets } from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  deliveryReportWarning,
  missingBrevoWebhookEvents,
  recordWebhookReceipt,
  resolveWebhookSecret,
  WEBHOOK_VERIFICATION_REFERENCE_PREFIX,
  type DeliveryReportProvider,
  type DeliveryReportStatus,
} from "./provider-events";
import {
  DELIVERY_REPORT_ALERT_COOLDOWN_MS,
  runDeliveryReportSilenceAlerts,
  staleDeliveryReportProviders,
} from "./delivery-report-alerts";
import type { TransactionalEmailTransport } from "./brevo";

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

async function run() {
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
      type ReportedStatus = { lastEventAt: string | null; lastAutomationSentAt: string | null; recentSendCount: number; warning: boolean };
      const body = await response.json() as {
        deliveryReports?: {
          providers?: Record<string, ReportedStatus>;
          windowHours?: number;
          graceMinutes?: number;
        };
      };
      assert.ok(body.deliveryReports, "admin integrations response must include deliveryReports");
      assert.equal(typeof body.deliveryReports.windowHours, "number");
      assert.equal(typeof body.deliveryReports.graceMinutes, "number");
      for (const provider of ["brevo", "infobip"] as const) {
        const providerStatus: ReportedStatus | undefined = body.deliveryReports.providers?.[provider];
        assert.ok(providerStatus, `deliveryReports.providers.${provider} present`);
        assert.equal(typeof providerStatus.recentSendCount, "number");
        assert.equal(typeof providerStatus.warning, "boolean");
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
      const healthy: DeliveryReportStatus = { lastEventAt: null, lastAutomationSentAt: null, recentSendCount: 0, warning: false };
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

      // One qualifying (grace-aged, receipt-less) email send per evaluation
      // time, so brevo reads silent at alertNow, boundaryProbe AND
      // afterCooldown — each probe then genuinely exercises the cooldown.
      const staleRunKey = `pe-run-stale-${suffix}`;
      const firstStaleSentAt = new Date(alertNow.getTime() - 35 * 60_000);
      const [staleRun] = await db.insert(automationRunsTable).values({
        eventKey: staleRunKey, ruleId: ruleC.id, salonId: c.salon.id, salonCustomerId: customerC.id,
        status: "sent", executedAt: firstStaleSentAt, sentAt: firstStaleSentAt,
      }).returning();
      assert.ok(staleRun);
      const staleSentAts = [firstStaleSentAt,
        new Date(boundaryProbe.getTime() - 35 * 60_000),
        new Date(afterCooldown.getTime() - 35 * 60_000)];
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
      const [alertAdmin] = await db.insert(usersTable).values({
        firstName: "Admin", lastName: "Alerts",
        email: alertAdminEmail, passwordHash: await hashPassword(`pe-alert-${suffix}`),
        passwordSetAt: new Date(), role: "SUPER_ADMIN",
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
      // A confirmed appointment counts toward both the attributed count and
      // the attributed revenue; a cancelled one contributes to neither.
      const [service] = await db.insert(servicesTable).values({
        salonId: a.salon.id, categoryName: "PE", name: `PE Service ${suffix}`,
        description: "Test", durationMinutes: 30, price: 3000, imageUrl: "/t.jpg",
      }).returning();
      assert.ok(service);

      const makeAppointment = async (status: "confirmed" | "cancelled", price: number) => {
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

      await db.update(automationRunsTable).set({ attributedAppointmentId: kept.id })
        .where(eq(automationRunsTable.id, runA.run.id));
      await db.update(automationRunsTable).set({ attributedAppointmentId: cancelled.id })
        .where(eq(automationRunsTable.id, runA2.run.id));

      const statsResponse = await fetch(`${baseUrl}/api/growth/automations/${ruleA.id}/stats`, {
        headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(statsResponse.status, 200);
      const attributionStats = await statsResponse.json() as Record<string, number>;
      assert.equal(attributionStats["attributedAppointments"], 1, "cancelled appointment must not count as attributed");
      assert.equal(attributionStats["attributedRevenue"], 3000, "cancelled appointment revenue must be excluded");

      const overviewResponse = await fetch(`${baseUrl}/api/growth/automation-stats`, {
        headers: { cookie: `${sessionCookieName}=${a.token}` },
      });
      assert.equal(overviewResponse.status, 200);
      const overviewRows = await overviewResponse.json() as Array<Record<string, unknown>>;
      const overviewRow = overviewRows.find((row) => row["ruleId"] === ruleA.id);
      assert.ok(overviewRow);
      assert.equal(overviewRow["attributedAppointments"], 1, "overview must apply the same cancelled filter");
      assert.equal(overviewRow["attributedRevenue"], 3000, "overview revenue must match the per-rule stats");
      console.log("✓ cancelled appointments are excluded from attributed counts and revenue in both endpoints");
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
