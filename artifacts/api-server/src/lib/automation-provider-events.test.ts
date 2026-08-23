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
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  emailDeliveriesTable,
  pool,
  salonCustomersTable,
  salonsTable,
  smsDeliveriesTable,
  usersTable,
} from "@workspace/db";
import app, { safePathname, redactPathSecrets } from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { resolveWebhookSecret } from "./provider-events";

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
      console.log("✓ malformed payloads rejected (400)");
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
