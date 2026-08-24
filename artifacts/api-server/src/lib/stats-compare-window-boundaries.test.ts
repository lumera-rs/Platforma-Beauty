/**
 * Trend-comparison window boundaries — regression suite
 *
 * The compare=previous aggregation on /growth/automation-stats and
 * /growth/automations/:id/stats splits history into two adjacent half-open
 * windows over coalesce(executedAt|sentAt, createdAt):
 *
 *   previous: [prevCutoff, cutoff)      current: [cutoff, now]
 *
 * A regression in either boundary (>= flipping to >, < flipping to <=, or a
 * miscomputed prevCutoff) would let a run or delivery count in both windows
 * or in neither, silently inflating or deflating trend arrows. This suite
 * pins the exact boundary semantics:
 *
 *   1. Runs and deliveries seeded exactly AT and 1ms AROUND both window edges
 *      are each counted in exactly one window (verified against a frozen
 *      clock so the cutoffs are known to the millisecond)
 *   2. Rows with no executedAt/sentAt fall back to createdAt for window
 *      membership (coalesce), on both the run and delivery aggregates
 *      including email/SMS opened and provider-failed delivery outcomes
 *   3. Rows older than both windows count in neither (but still appear in
 *      the all-time aggregate), and current + previous + outside = all-time,
 *      so no row is ever double-counted or dropped
 *   4. compare validation: compare=previous with period=all or with no period
 *      → 400; a complete custom from/to range is accepted; any compare value
 *      other than the literal "previous" → 400 — on both stats endpoints
 *   5. a separate 30d fixture crossing the 2026 fall daylight-saving
 *      transition keeps the repeated local hour on the correct side of both
 *      windows, on both stats endpoints
 *
 * The frozen clock only affects Date.now() (used by parseStatsWindow for the
 * rolling presets); every SQL comparison binds JS-provided parameters against
 * explicitly seeded timestamps, so no database clock is involved. The fixed
 * instant is deliberately chosen so the 30d current window crosses the
 * 2026-03-08 daylight-saving transition; all fixture timestamps remain UTC
 * epoch values and therefore do not depend on the machine timezone.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/stats-compare-window-boundaries.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

const suffix = randomUUID().slice(0, 8);
const DAY_MS = 24 * 60 * 60 * 1000;

// Freeze the request-time clock so the 30d preset cutoffs are exact. This
// instant makes the current window [2026-03-08T12:00Z, 2026-04-07T12:00Z),
// which crosses the US daylight-saving transition on 2026-03-08. Keeping the
// instant explicit in UTC makes the fixture independent of machine timezone.
// cutoff = FROZEN_NOW - 30d and prevCutoff = FROZEN_NOW - 60d, allowing rows
// seeded 1ms around each edge to deterministically land on one side.
const FROZEN_NOW = Date.parse("2026-04-07T12:00:00.000Z");
const CUTOFF = FROZEN_NOW - 30 * DAY_MS;
const PREV_CUTOFF = FROZEN_NOW - 60 * DAY_MS;

// A second explicit UTC instant makes the current 30d window
// [2026-10-10T12:00Z, 2026-11-09T12:00Z), crossing the US fall-back
// transition on 2026-11-01. The preceding window is
// [2026-09-10T12:00Z, 2026-10-10T12:00Z).
const FALL_FROZEN_NOW = Date.parse("2026-11-09T12:00:00.000Z");
const FALL_CUTOFF = FALL_FROZEN_NOW - 30 * DAY_MS;
const FALL_PREV_CUTOFF = FALL_FROZEN_NOW - 60 * DAY_MS;

async function main() {
  const hash = await hashPassword(`pass-wb-${suffix}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Owner", lastName: "WB",
    email: `wb-owner-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `WB Salon ${suffix}`, slug: `wb-salon-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
    email: `wb-salon-${suffix}@bg.test`,
    shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
  }).returning();
  assert.ok(salon);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const token = await createSession(owner.id);

  const [svc] = await db.insert(servicesTable).values({
    salonId: salon.id, categoryName: "Hair", name: `WB Service ${suffix}`, description: "Test",
    durationMinutes: 60, price: 3000, imageUrl: "/t.jpg", active: true,
  }).returning();
  assert.ok(svc);
  const [cust] = await db.insert(salonCustomersTable).values({
    salonId: salon.id, firstName: "Test", lastName: "Customer",
    email: `wb-cust-${suffix}@bg.test`, phone: null, smsOptOut: false,
  }).returning();
  assert.ok(cust);
  const [rule] = await db.insert(automationRulesTable).values({
    salonId: salon.id, name: `WB Rule ${suffix}`,
    trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
    action: "send_email", emailSubject: "T", emailBody: "T",
    status: "active",
  }).returning();
  assert.ok(rule);

  // ── Seed runs, one per boundary case, each with an attributed completed
  //    appointment so it contributes to both the current-window
  //    attributedAppointments count and the previous-window one. ────────────
  // executedAt=null → the row must fall back to createdAt (coalesce).
  const runCases: Array<{ tag: string; executedAt: number | null; createdAt?: number }> = [
    { tag: "outside-before", executedAt: PREV_CUTOFF - 1 },          // 1ms before the previous window → neither
    { tag: "prev-first-ms", executedAt: PREV_CUTOFF },               // exactly at prevCutoff → previous
    { tag: "prev-last-ms", executedAt: CUTOFF - 1 },                 // 1ms before cutoff → previous
    { tag: "cur-first-ms", executedAt: CUTOFF },                     // exactly at cutoff → current
    { tag: "cur-recent", executedAt: FROZEN_NOW - 1000 },            // well inside current
    { tag: "prev-fallback", executedAt: null, createdAt: CUTOFF - 1 }, // no executedAt → createdAt decides → previous
  ];
  for (const c of runCases) {
    const [appt] = await db.insert(appointmentsTable).values({
      salonId: salon.id, salonCustomerId: cust.id, serviceId: svc.id,
      date: "2026-02-01", startTime: "10:00", endTime: "11:00", durationMinutes: 60,
      status: "completed", price: 1000, treatmentLocation: "salon",
    }).returning();
    assert.ok(appt);
    const [run] = await db.insert(automationRunsTable).values({
      eventKey: `wb-run-${c.tag}-${suffix}`, ruleId: rule.id, salonId: salon.id, salonCustomerId: cust.id,
      status: c.executedAt === null ? "failed" : "sent",
      executedAt: c.executedAt === null ? null : new Date(c.executedAt),
      sentAt: c.executedAt === null ? null : new Date(c.executedAt),
      attributedAppointmentId: appt.id,
    }).returning();
    assert.ok(run);
    if (c.createdAt !== undefined) {
      await db.update(automationRunsTable)
        .set({ createdAt: new Date(c.createdAt) })
        .where(eq(automationRunsTable.id, run.id));
    }
  }

  // ── Seed email deliveries around the same edges (windowed independently on
  //    coalesce(sentAt, createdAt)); all delivered+opened so the delivered and
  //    opened counters both track pure window membership. ───────────────────
  const [hostRun] = await db.select({ id: automationRunsTable.id }).from(automationRunsTable)
    .where(eq(automationRunsTable.eventKey, `wb-run-cur-recent-${suffix}`)).limit(1);
  assert.ok(hostRun);
  const deliveryCases: Array<{ tag: string; sentAt: number | null; createdAt?: number }> = [
    { tag: "outside-before", sentAt: PREV_CUTOFF - 1 },
    { tag: "prev-first-ms", sentAt: PREV_CUTOFF },
    { tag: "prev-last-ms", sentAt: CUTOFF - 1 },
    { tag: "cur-first-ms", sentAt: CUTOFF },
    { tag: "cur-recent", sentAt: FROZEN_NOW - 1000 },
    { tag: "prev-fallback", sentAt: null, createdAt: PREV_CUTOFF }, // no sentAt → createdAt decides → previous
  ];
  for (const c of deliveryCases) {
    const [delivery] = await db.insert(automationDeliveriesTable).values({
      runId: hostRun.id, salonId: salon.id, eventKey: `wb-delivery-${c.tag}-${suffix}`,
      channel: "email", recipientEmail: `wb-rcpt-${suffix}@bg.test`, status: "sent",
      sentAt: c.sentAt === null ? null : new Date(c.sentAt),
      deliveredAt: new Date(FROZEN_NOW), openedAt: new Date(FROZEN_NOW),
    }).returning();
    assert.ok(delivery);
    if (c.createdAt !== undefined) {
      await db.update(automationDeliveriesTable)
        .set({ createdAt: new Date(c.createdAt) })
        .where(eq(automationDeliveriesTable.id, delivery.id));
    }
  }

  // Keep provider-outcome fallback coverage isolated from the sent/delivered
  // boundary rows above and from provider-event integration fixtures. Every
  // row intentionally omits sentAt: createdAt alone must place the opened or
  // failed outcome on the correct side of the current-window cutoff.
  const [outcomeRule] = await db.insert(automationRulesTable).values({
    salonId: salon.id, name: `WB Provider Outcome Rule ${suffix}`,
    trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
    action: "send_email_and_sms", emailSubject: "T", emailBody: "T",
    smsBody: "T", status: "active",
  }).returning();
  assert.ok(outcomeRule);
  const [outcomeRun] = await db.insert(automationRunsTable).values({
    eventKey: `wb-provider-outcome-run-${suffix}`, ruleId: outcomeRule.id,
    salonId: salon.id, salonCustomerId: cust.id, status: "sent",
    executedAt: new Date(FROZEN_NOW - 1_000), sentAt: new Date(FROZEN_NOW - 1_000),
  }).returning();
  assert.ok(outcomeRun);

  const providerOutcomeCases = [
    { tag: "previous-email-open", channel: "email", outcome: "opened", createdAt: CUTOFF - DAY_MS },
    { tag: "current-email-open", channel: "email", outcome: "opened", createdAt: CUTOFF },
    { tag: "previous-email-failed", channel: "email", outcome: "failed", createdAt: CUTOFF - DAY_MS },
    { tag: "current-email-failed", channel: "email", outcome: "failed", createdAt: CUTOFF },
    { tag: "previous-sms-open", channel: "sms", outcome: "opened", createdAt: CUTOFF - DAY_MS },
    { tag: "current-sms-open", channel: "sms", outcome: "opened", createdAt: CUTOFF },
    { tag: "previous-sms-failed", channel: "sms", outcome: "failed", createdAt: CUTOFF - DAY_MS },
    { tag: "current-sms-failed", channel: "sms", outcome: "failed", createdAt: CUTOFF },
  ] as const;
  for (const c of providerOutcomeCases) {
    const [delivery] = await db.insert(automationDeliveriesTable).values({
      runId: outcomeRun.id, salonId: salon.id, eventKey: `wb-provider-outcome-${c.tag}-${suffix}`,
      channel: c.channel,
      recipientEmail: c.channel === "email" ? `wb-outcome-${suffix}@bg.test` : null,
      recipientPhone: c.channel === "sms" ? `+381641234${c.tag.endsWith("open") ? "01" : "02"}` : null,
      status: "sent",
      // sentAt is deliberately omitted so stats must use createdAt.
      createdAt: new Date(c.createdAt),
      openedAt: c.outcome === "opened" ? new Date(FROZEN_NOW) : null,
      failedAt: c.outcome === "failed" ? new Date(FROZEN_NOW) : null,
    }).returning();
    assert.equal(delivery?.sentAt, null, `${c.tag}: sentAt remains omitted`);
    assert.equal(delivery?.createdAt?.getTime(), c.createdAt, `${c.tag}: createdAt is the boundary fixture timestamp`);
  }

  // Keep a separate campaign with activity only in the current window. Its
  // absent previous run/delivery aggregate rows must still become an explicit
  // zero-valued comparison block on both stats endpoints.
  const [currentOnlyRule] = await db.insert(automationRulesTable).values({
    salonId: salon.id, name: `WB Current Only Rule ${suffix}`,
    trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
    action: "send_email", emailSubject: "T", emailBody: "T",
    status: "active",
  }).returning();
  assert.ok(currentOnlyRule);
  const [currentOnlyAppointment] = await db.insert(appointmentsTable).values({
    salonId: salon.id, salonCustomerId: cust.id, serviceId: svc.id,
    date: "2026-04-07", startTime: "14:00", endTime: "15:00", durationMinutes: 60,
    status: "completed", price: 1500, treatmentLocation: "salon",
  }).returning();
  assert.ok(currentOnlyAppointment);
  const [currentOnlyRun] = await db.insert(automationRunsTable).values({
    eventKey: `wb-current-only-run-${suffix}`, ruleId: currentOnlyRule.id, salonId: salon.id,
    salonCustomerId: cust.id, status: "sent",
    executedAt: new Date(FROZEN_NOW - 2_000), sentAt: new Date(FROZEN_NOW - 2_000),
    attributedAppointmentId: currentOnlyAppointment.id,
  }).returning();
  assert.ok(currentOnlyRun);
  await db.insert(automationDeliveriesTable).values({
    runId: currentOnlyRun.id, salonId: salon.id, eventKey: `wb-current-only-delivery-${suffix}`,
    channel: "email", recipientEmail: `wb-current-only-${suffix}@bg.test`, status: "sent",
    sentAt: new Date(FROZEN_NOW - 2_000), deliveredAt: new Date(FROZEN_NOW - 1_000),
    openedAt: new Date(FROZEN_NOW - 500),
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: `${sessionCookieName}=${token}` } });
    return { status: response.status, body: await response.json() as any };
  };
  const overviewRow = async (qs: string, targetRuleId = rule.id) => {
    const r = await get(`/api/growth/automation-stats${qs}`);
    assert.equal(r.status, 200, `expected 200 for overview ${qs}`);
    const row = r.body.find((x: any) => x.ruleId === targetRuleId);
    assert.ok(row, `overview must include the rule for ${qs}`);
    return row;
  };
  const perRule = async (qs: string, targetRuleId = rule.id) => {
    const r = await get(`/api/growth/automations/${targetRuleId}/stats${qs}`);
    assert.equal(r.status, 200, `expected 200 for per-rule stats ${qs}`);
    return r.body;
  };

  const realDateNow = Date.now;
  try {
    // Freeze request-time "now" so the preset cutoffs equal the constants the
    // rows were seeded against, making 1ms-edge assertions deterministic.
    Date.now = () => FROZEN_NOW;

    // Expected membership out of the 6 seeded rows per kind:
    //   current  = { cur-first-ms, cur-recent }                      → 2
    //   previous = { prev-first-ms, prev-last-ms, prev-fallback }    → 3
    //   neither  = { outside-before }                                → 1
    const CURRENT = 2, PREVIOUS = 3, TOTAL = 6;

    // ── 1+2. Each edge row lands in exactly one window (both endpoints) ────
    for (const [label, row] of [
      ["overview", await overviewRow("?period=30d&compare=previous")],
      ["per-rule", await perRule("?period=30d&compare=previous")],
    ] as const) {
      assert.equal(row.totalRuns, CURRENT, `${label}: current window counts exactly the at-cutoff and recent runs`);
      assert.equal(row.attributedAppointments, CURRENT, `${label}: current attributed count matches current runs`);
      assert.ok(row.previous, `${label}: previous block present for compare=previous`);
      assert.equal(row.previous.attributedAppointments, PREVIOUS,
        `${label}: previous window counts exactly the two edge runs plus the createdAt-fallback run`);
      assert.equal(row.newClientShare, 0,
        `${label}: current new-client share is calculated only from clients with known history`);
      assert.equal(row.knownClientCount, CURRENT,
        `${label}: current share reports the exact known-client denominator`);
      assert.equal(row.unknownClientCount, 0,
        `${label}: current unknown-client count remains separate from the denominator`);
      assert.equal(row.previous.newClientShare, 0,
        `${label}: previous new-client share follows the exact same previous run window`);
      assert.equal(row.previous.knownClientCount, PREVIOUS,
        `${label}: previous share uses the same known-client denominator`);
      if (label === "per-rule") {
        assert.equal(row.previous.newClientCount, 0,
          "per-rule: previous new-client count uses the same returning derivation as the attributed-appointments summary");
        assert.equal(row.previous.returningClientCount, PREVIOUS,
          "per-rule: previous returning-client count follows the exact previous run window");
      }
      assert.equal(row.emailDeliveredCount, CURRENT, `${label}: current delivered count`);
      assert.equal(row.emailOpenedCount, CURRENT, `${label}: current opened count`);
      assert.equal(row.previous.emailDeliveredCount, PREVIOUS, `${label}: previous delivered count`);
      assert.equal(row.previous.emailOpenedCount, PREVIOUS, `${label}: previous opened count`);
    }
    console.log("✓ rows 1ms around and exactly at both edges each count in exactly one window (runs + deliveries, both endpoints)");

    // Provider outcomes use the delivery window, not the webhook timestamp:
    // with sentAt missing, each current row is at the cutoff and each
    // previous row is on the preceding calendar day. Both endpoints must classify the shared
    // email outcome totals identically; the per-rule endpoint also exposes the
    // combined email+SMS opened total.
    const assertProviderOutcomeCounts = async (
      label: string,
      row: any,
      expectedOpened: number,
      expectedEmailOpened: number,
      expectedEmailFailed: number,
      expectedSmsFailed: number,
    ) => {
      assert.equal(row.emailOpenedCount, expectedEmailOpened, `${label}: email opened count`);
      assert.equal(row.emailFailedCount, expectedEmailFailed, `${label}: email provider-failed count`);
      assert.equal(row.smsFailedCount, expectedSmsFailed, `${label}: SMS provider-failed count`);
      if (label === "per-rule") {
        assert.equal(row.openedCount, expectedOpened, `${label}: combined opened count`);
      }
    };

    const currentOutcomeRows = [
      ["overview", await overviewRow("?period=30d&compare=previous", outcomeRule.id)],
      ["per-rule", await perRule("?period=30d&compare=previous", outcomeRule.id)],
    ] as const;
    for (const [label, row] of currentOutcomeRows) {
      await assertProviderOutcomeCounts(label, row, 2, 1, 1, 1);
      assert.ok(row.previous, `${label}: provider outcome previous block present`);
      assert.equal(row.previous.emailOpenedCount, 1,
        `${label}: createdAt on the preceding day is in the previous opened total`);
    }

    // The compact comparison block does not expose provider-failed totals, so
    // use a bounded custom date window for the preceding calendar day and
    // exercise every previous-side outcome as the current aggregate too.
    const previousOutcomeRows = [
      ["overview", await overviewRow("?from=2026-03-07&to=2026-03-07", outcomeRule.id)],
      ["per-rule", await perRule("?from=2026-03-07&to=2026-03-07", outcomeRule.id)],
    ] as const;
    for (const [label, row] of previousOutcomeRows) {
      await assertProviderOutcomeCounts(label, row, 2, 1, 1, 1);
    }
    console.log("✓ email/SMS opened and provider-failed outcomes fall back to createdAt on both sides of the cutoff");

    // ── 3. Conservation: current + previous + outside = all-time ───────────
    const allTime = await overviewRow("?period=all");
    assert.equal(allTime.totalRuns, TOTAL, "all-time sees every seeded run, including the one outside both windows");
    assert.equal(allTime.attributedAppointments, TOTAL, "all-time attributed count");
    assert.equal(allTime.emailDeliveredCount, TOTAL, "all-time sees every seeded delivery");
    assert.equal(CURRENT + PREVIOUS, TOTAL - 1,
      "exactly one row (the pre-previous one) is outside both comparison windows; none is double-counted");

    // A shorter preset shifts both windows forward: every boundary row from
    // the 30d seeding is now older than [now-14d, now-7d) ∪ [now-7d, now] and
    // must vanish from both windows, not leak into either.
    const short = await overviewRow("?period=7d&compare=previous");
    assert.equal(short.totalRuns, 1, "7d current window keeps only the recent run");
    assert.equal(short.previous.attributedAppointments, 0, "7d previous window contains none of the 30/60-day edge rows");
    assert.equal(short.previous.newClientShare, null, "7d previous window has no known clients, so its share is unavailable rather than 0%");
    assert.equal(short.emailDeliveredCount, 1, "7d current window keeps only the recent delivery");
    assert.equal(short.previous.emailDeliveredCount, 0, "7d previous window contains no old deliveries");
    console.log("✓ conservation holds: no double-count, no dropped row; shifted windows exclude all old edge rows");

    // ── 4. Known-client denominator excludes unknown clients ────────────────
    const [newCustomer] = await db.insert(salonCustomersTable).values({
      salonId: salon.id, firstName: "New", lastName: "Client",
      email: `wb-new-${suffix}@bg.test`, phone: null, smsOptOut: false,
    }).returning();
    assert.ok(newCustomer);
    const [newClientAppointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id, salonCustomerId: newCustomer.id, serviceId: svc.id,
      date: "2026-04-07", startTime: "12:00", endTime: "13:00", durationMinutes: 60,
      status: "completed", price: 1000, treatmentLocation: "salon",
    }).returning();
    const [unknownClientAppointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id, serviceId: svc.id,
      date: "2026-04-07", startTime: "13:00", endTime: "14:00", durationMinutes: 60,
      status: "completed", price: 1000, treatmentLocation: "salon",
    }).returning();
    assert.ok(newClientAppointment && unknownClientAppointment);
    await db.insert(automationRunsTable).values([
      {
        eventKey: `wb-new-client-${suffix}`, ruleId: rule.id, salonId: salon.id,
        salonCustomerId: newCustomer.id, status: "sent", executedAt: new Date(FROZEN_NOW - 2_000),
        sentAt: new Date(FROZEN_NOW - 2_000), attributedAppointmentId: newClientAppointment.id,
      },
      {
        eventKey: `wb-unknown-client-${suffix}`, ruleId: rule.id, salonId: salon.id,
        salonCustomerId: newCustomer.id, status: "sent", executedAt: new Date(FROZEN_NOW - 1_000),
        sentAt: new Date(FROZEN_NOW - 1_000), attributedAppointmentId: unknownClientAppointment.id,
      },
    ]);

    for (const [label, row] of [
      ["overview", await overviewRow("?period=30d&compare=previous")],
      ["per-rule", await perRule("?period=30d&compare=previous")],
    ] as const) {
      assert.equal(row.newClientCount, 1, `${label}: first-time client is counted as new`);
      assert.equal(row.knownClientCount, CURRENT + 1,
        `${label}: denominator contains returning and new clients only`);
      assert.equal(row.unknownClientCount, 1,
        `${label}: appointment without a linked customer remains a separate bucket`);
      assert.equal(row.newClientShare, 33.33,
        `${label}: unknown appointment cannot dilute the new-client share`);
      assert.equal(row.previous.knownClientCount, PREVIOUS,
        `${label}: previous window keeps its own known-client basis`);
    }
    console.log("✓ new-client share exposes its known-client denominator and excludes unknown clients");

    // ── 4b. Empty preceding comparison remains explicit ────────────────────
    const emptyOverviewPrevious = {
      attributedAppointments: 0,
      attributedRevenue: 0,
      noShowAttributedAppointments: 0,
      noShowAttributedRevenue: 0,
      newClientCount: 0,
      knownClientCount: 0,
      newClientShare: null,
      emailDeliveredCount: 0,
      emailOpenedCount: 0,
      smsDeliveredCount: 0,
    };
    const emptyPerRulePrevious = {
      ...emptyOverviewPrevious,
      returningClientCount: 0,
      unknownClientCount: 0,
    };
    const overviewCurrentOnly = await overviewRow("?period=30d&compare=previous", currentOnlyRule.id);
    assert.equal(overviewCurrentOnly.totalRuns, 1, "overview: current-only campaign has one current run");
    assert.equal(overviewCurrentOnly.attributedAppointments, 1, "overview: current-only campaign has one current attribution");
    assert.equal(overviewCurrentOnly.emailDeliveredCount, 1, "overview: current-only campaign has one current delivery");
    assert.equal(overviewCurrentOnly.emailOpenedCount, 1, "overview: current-only campaign has one current open");
    assert.deepEqual(overviewCurrentOnly.previous, emptyOverviewPrevious,
      "overview: no previous aggregate rows become an explicit zero-valued comparison block");

    const perRuleCurrentOnly = await perRule("?period=30d&compare=previous", currentOnlyRule.id);
    assert.equal(perRuleCurrentOnly.totalRuns, 1, "per-rule: current-only campaign has one current run");
    assert.equal(perRuleCurrentOnly.attributedAppointments, 1, "per-rule: current-only campaign has one current attribution");
    assert.equal(perRuleCurrentOnly.emailDeliveredCount, 1, "per-rule: current-only campaign has one current delivery");
    assert.equal(perRuleCurrentOnly.emailOpenedCount, 1, "per-rule: current-only campaign has one current open");
    assert.deepEqual(perRuleCurrentOnly.previous, emptyPerRulePrevious,
      "per-rule: no previous aggregate rows become an explicit zero-valued comparison block");
    console.log("✓ current-only campaign keeps an explicit zero previous block on both stats endpoints");

    // ── 5. compare validation on both endpoints ─────────────────────────────
    const expect400 = async (qs: string, label: string) => {
      for (const path of [
        `/api/growth/automation-stats${qs}`,
        `/api/growth/automations/${rule.id}/stats${qs}`,
      ]) {
        const r = await get(path);
        assert.equal(r.status, 400, `${label} must be rejected with 400 (${path})`);
        assert.equal(r.body.code, "VALIDATION", `${label} rejection carries the VALIDATION code`);
      }
    };
    await expect400("?period=all&compare=previous", "compare=previous with period=all");
    await expect400("?compare=previous", "compare=previous with no period (defaults to all-time)");
    for (const path of [
      `/api/growth/automation-stats?from=2026-01-01&to=2026-02-01&compare=previous`,
      `/api/growth/automations/${rule.id}/stats?from=2026-01-01&to=2026-02-01&compare=previous`,
    ]) {
      const r = await get(path);
      assert.equal(r.status, 200, `complete custom range is accepted (${path})`);
      assert.ok(r.body.previous ?? r.body.find?.((x: any) => x.ruleId === rule.id)?.previous,
        `complete custom range returns previous counts (${path})`);
    }
    await expect400("?period=30d&compare=next", "unknown compare value");
    await expect400("?period=30d&compare=Previous", "case-mismatched compare value");
    console.log("✓ compare validation: unbounded periods and unknown compare values rejected with 400 on both endpoints");

    // ── 5. Fall-back transition fixture ─────────────────────────────────────
    // Keep this as a separate rule so the spring fixture above remains
    // untouched while the overview endpoint is exercised with a second
    // independently seeded campaign.
    const [fallRule] = await db.insert(automationRulesTable).values({
      salonId: salon.id, name: `WB Fall Rule ${suffix}`,
      trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
      action: "send_email", emailSubject: "T", emailBody: "T",
      status: "active",
    }).returning();
    assert.ok(fallRule);

    const fallRunCases: Array<{ tag: string; executedAt: number | null; createdAt: number }> = [
      { tag: "outside-before", executedAt: FALL_PREV_CUTOFF - 1, createdAt: FALL_PREV_CUTOFF - 1 },
      { tag: "prev-first-ms", executedAt: FALL_PREV_CUTOFF, createdAt: FALL_PREV_CUTOFF },
      { tag: "prev-last-ms", executedAt: FALL_CUTOFF - 1, createdAt: FALL_CUTOFF - 1 },
      { tag: "cur-first-ms", executedAt: FALL_CUTOFF, createdAt: FALL_CUTOFF },
      { tag: "cur-recent", executedAt: FALL_FROZEN_NOW - 1_000, createdAt: FALL_FROZEN_NOW - 1_000 },
      { tag: "prev-fallback", executedAt: null, createdAt: FALL_CUTOFF - 1 },
    ];
    for (const c of fallRunCases) {
      const [appt] = await db.insert(appointmentsTable).values({
        salonId: salon.id, salonCustomerId: cust.id, serviceId: svc.id,
        date: "2026-11-01", startTime: "10:00", endTime: "11:00", durationMinutes: 60,
        status: "completed", price: 1000, treatmentLocation: "salon",
      }).returning();
      assert.ok(appt);
      const [run] = await db.insert(automationRunsTable).values({
        eventKey: `wb-fall-run-${c.tag}-${suffix}`, ruleId: fallRule.id, salonId: salon.id, salonCustomerId: cust.id,
        status: c.executedAt === null ? "failed" : "sent",
        executedAt: c.executedAt === null ? null : new Date(c.executedAt),
        sentAt: c.executedAt === null ? null : new Date(c.executedAt),
        createdAt: new Date(c.createdAt),
        attributedAppointmentId: appt.id,
      }).returning();
      assert.ok(run);
    }

    const [fallHostRun] = await db.select({ id: automationRunsTable.id }).from(automationRunsTable)
      .where(eq(automationRunsTable.eventKey, `wb-fall-run-cur-recent-${suffix}`)).limit(1);
    assert.ok(fallHostRun);
    const fallDeliveryCases: Array<{ tag: string; sentAt: number | null; createdAt: number }> = [
      { tag: "outside-before", sentAt: FALL_PREV_CUTOFF - 1, createdAt: FALL_PREV_CUTOFF - 1 },
      { tag: "prev-first-ms", sentAt: FALL_PREV_CUTOFF, createdAt: FALL_PREV_CUTOFF },
      { tag: "prev-last-ms", sentAt: FALL_CUTOFF - 1, createdAt: FALL_CUTOFF - 1 },
      { tag: "cur-first-ms", sentAt: FALL_CUTOFF, createdAt: FALL_CUTOFF },
      { tag: "cur-recent", sentAt: FALL_FROZEN_NOW - 1_000, createdAt: FALL_FROZEN_NOW - 1_000 },
      { tag: "prev-fallback", sentAt: null, createdAt: FALL_PREV_CUTOFF },
    ];
    for (const c of fallDeliveryCases) {
      const [delivery] = await db.insert(automationDeliveriesTable).values({
        runId: fallHostRun.id, salonId: salon.id, eventKey: `wb-fall-delivery-${c.tag}-${suffix}`,
        channel: "email", recipientEmail: `wb-fall-rcpt-${suffix}@bg.test`, status: "sent",
        sentAt: c.sentAt === null ? null : new Date(c.sentAt),
        createdAt: new Date(c.createdAt),
        deliveredAt: new Date(FALL_FROZEN_NOW), openedAt: new Date(FALL_FROZEN_NOW),
      }).returning();
      assert.ok(delivery);
    }

    Date.now = () => FALL_FROZEN_NOW;
    const FALL_CURRENT = 2, FALL_PREVIOUS = 3;
    for (const [label, row] of [
      ["overview", await overviewRow("?period=30d&compare=previous", fallRule.id)],
      ["per-rule", await perRule("?period=30d&compare=previous", fallRule.id)],
    ] as const) {
      assert.equal(row.totalRuns, FALL_CURRENT,
        `${label}: fall-back current window contains only the cutoff and recent runs`);
      assert.equal(row.attributedAppointments, FALL_CURRENT,
        `${label}: fall-back current attributed appointments match current runs`);
      assert.ok(row.previous, `${label}: fall-back previous block present`);
      assert.equal(row.previous.attributedAppointments, FALL_PREVIOUS,
        `${label}: fall-back previous window contains both edges and the createdAt fallback`);
      assert.equal(row.emailDeliveredCount, FALL_CURRENT,
        `${label}: fall-back current delivered count`);
      assert.equal(row.emailOpenedCount, FALL_CURRENT,
        `${label}: fall-back current opened count`);
      assert.equal(row.previous.emailDeliveredCount, FALL_PREVIOUS,
        `${label}: fall-back previous delivered count`);
      assert.equal(row.previous.emailOpenedCount, FALL_PREVIOUS,
        `${label}: fall-back previous opened count`);
    }
    console.log("✓ fall-back transition keeps exact previous/current membership on both stats endpoints");
  } finally {
    Date.now = realDateNow;
    server.close();
    await db.delete(automationDeliveriesTable).where(eq(automationDeliveriesTable.salonId, salon.id));
    await db.delete(automationRunsTable).where(eq(automationRunsTable.salonId, salon.id));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salon.id));
    await db.delete(automationRulesTable).where(eq(automationRulesTable.salonId, salon.id));
    await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, salon.id));
    await db.delete(servicesTable).where(eq(servicesTable.salonId, salon.id));
    await db.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, owner.id));
    await db.delete(salonsTable).where(eq(salonsTable.id, salon.id));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner.id]));
    await pool.end();
  }
  console.log("All comparison-window boundary checks passed.");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
