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
 *   3. Rows older than both windows count in neither (but still appear in
 *      the all-time aggregate), and current + previous + outside = all-time,
 *      so no row is ever double-counted or dropped
 *   4. compare validation: compare=previous with period=all or with no period
 *      → 400; a complete custom from/to range is accepted; any compare value
 *      other than the literal "previous" → 400 — on both stats endpoints
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

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: `${sessionCookieName}=${token}` } });
    return { status: response.status, body: await response.json() as any };
  };
  const overviewRow = async (qs: string) => {
    const r = await get(`/api/growth/automation-stats${qs}`);
    assert.equal(r.status, 200, `expected 200 for overview ${qs}`);
    const row = r.body.find((x: any) => x.ruleId === rule.id);
    assert.ok(row, `overview must include the rule for ${qs}`);
    return row;
  };
  const perRule = async (qs: string) => {
    const r = await get(`/api/growth/automations/${rule.id}/stats${qs}`);
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
      assert.equal(row.previous.newClientShare, 0,
        `${label}: previous new-client share follows the exact same previous run window`);
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

    // ── 4. compare validation on both endpoints ─────────────────────────────
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
  } finally {
    Date.now = realDateNow;
    server.close();
    await db.delete(automationDeliveriesTable).where(eq(automationDeliveriesTable.salonId, salon.id));
    await db.delete(automationRunsTable).where(eq(automationRunsTable.ruleId, rule.id));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salon.id));
    await db.delete(automationRulesTable).where(eq(automationRulesTable.id, rule.id));
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
