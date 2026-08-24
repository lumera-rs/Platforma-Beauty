/**
 * Attributed-appointments drill-down pagination — regression suite
 *
 * Verifies that GET /growth/automations/:automationId/attributed-appointments:
 *   1. defaults to a 25-row page and caps limit at 100; rejects invalid
 *      limit/offset/period with 400
 *   2. pages deterministically (newest first, id tiebreaker): walking pages by
 *      offset covers every attributed appointment exactly once, no overlap
 *   3. exercises every status in the campaign classification map, excludes
 *      cancelled/excluded statuses from rows and `total`, and keeps `total`
 *      equal to the stats endpoint's attributedAppointments count
 *   4. honors the same `period` window as the stats endpoints, so the total
 *      matches the count shown above the list for every period choice
 *   5. stays owner-scoped: another owner's session gets 404 for a foreign rule
 *
 * Also guards the overview trend comparison (/growth/automation-stats with
 * compare=previous): the previous-window attributed count must exclude
 * cancelled and no-show appointments exactly like the current window, or trend
 * arrows mislead owners whenever prior-period appointments fell through.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/attributed-appointments-pagination.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
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
import { CAMPAIGN_APPOINTMENT_STATUS_BUCKETS } from "../routes/growth";
import { createSession, hashPassword, sessionCookieName } from "./auth";

const suffix = randomUUID().slice(0, 8);
const cleanup = {
  userIds: [] as string[],
  salonIds: [] as string[],
};

async function makeOwnerAndSalon(tag: string) {
  const hash = await hashPassword(`pass-${tag}-${suffix}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Owner", lastName: tag,
    email: `pg-owner-${tag}-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  cleanup.userIds.push(owner.id);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `PG Salon ${tag} ${suffix}`, slug: `pg-salon-${tag}-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
    email: `pg-salon-${tag}-${suffix}@bg.test`,
    shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
  }).returning();
  assert.ok(salon);
  cleanup.salonIds.push(salon.id);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const token = await createSession(owner.id);
  return { owner, salon, token };
}

async function main() {
  const a = await makeOwnerAndSalon("a");
  const b = await makeOwnerAndSalon("b");

  const [svc] = await db.insert(servicesTable).values({
    salonId: a.salon.id, categoryName: "Hair", name: `PG Service ${suffix}`, description: "Test",
    durationMinutes: 60, price: 3000, imageUrl: "/t.jpg", active: true,
  }).returning();
  assert.ok(svc);
  const [cust] = await db.insert(salonCustomersTable).values({
    salonId: a.salon.id, firstName: "Test", lastName: "Customer",
    email: `pg-cust-${suffix}@bg.test`, phone: null, smsOptOut: false,
  }).returning();
  assert.ok(cust);
  const [rule] = await db.insert(automationRulesTable).values({
    salonId: a.salon.id, name: `PG Rule ${suffix}`,
    trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
    action: "send_email", emailSubject: "T", emailBody: "T",
    status: "active",
  }).returning();
  assert.ok(rule);

  // 60 attributed realized appointments + 3 cancelled and 1 no-show ones.
  // The first RECENT_TOTAL runs executed just now; the rest (including all
  // excluded-status ones) executed 45 days ago, so a 30d window splits the
  // set and the 45-day-old runs land safely inside the previous 30d comparison
  // window [60d, 30d). Appointments share startTime to exercise the id
  // tiebreaker in the deterministic ordering.
  const TOTAL = 60;
  const RECENT_TOTAL = 40;
  const RECENT_RUN_AT = new Date();
  const OLD_RUN_AT = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const campaignStatusCases = Object.entries(CAMPAIGN_APPOINTMENT_STATUS_BUCKETS).flatMap(([bucket, statuses]) =>
    statuses.map((status) => ({ bucket, status })),
  );
  const realizedStatusCases = campaignStatusCases.filter(
    ({ bucket }) => bucket === "completed" || bucket === "upcoming",
  );
  const EXPECTED_ALL_TOTAL = TOTAL + realizedStatusCases.length;
  const EXPECTED_RECENT_TOTAL = RECENT_TOTAL + realizedStatusCases.length;
  const statusFixtures: Array<{
    status: (typeof appointmentsTable.status.enumValues)[number];
    bucket: string;
    appointmentId: string;
  }> = [];

  for (let i = 0; i < TOTAL + 4; i++) {
    const cancelled = i >= TOTAL && i < TOTAL + 3;
    const noShow = i === TOTAL + 3;
    const day = String((i % 28) + 1).padStart(2, "0");
    const [appt] = await db.insert(appointmentsTable).values({
      salonId: a.salon.id, salonCustomerId: cust.id, serviceId: svc.id,
      date: `2026-05-${day}`, startTime: "10:00", endTime: "11:00", durationMinutes: 60,
      status: cancelled ? "cancelled" : noShow ? "no-show" : "completed",
      price: 1000 + i, treatmentLocation: "salon",
    }).returning();
    assert.ok(appt);
    const executedAt = i < RECENT_TOTAL ? RECENT_RUN_AT : OLD_RUN_AT;
    await db.insert(automationRunsTable).values({
      eventKey: `pg-run-${i}-${suffix}`, ruleId: rule.id, salonId: a.salon.id, salonCustomerId: cust.id,
      status: "sent", executedAt, sentAt: executedAt,
      attributedAppointmentId: appt.id,
    });
  }
  // Keep this endpoint-level fixture coupled to the exhaustive campaign
  // policy: one run per mapped status makes a newly added/reclassified status
  // fail loudly if the drill-down and aggregate stop agreeing.
  for (const [i, { status, bucket }] of campaignStatusCases.entries()) {
    const [appt] = await db.insert(appointmentsTable).values({
      salonId: a.salon.id, salonCustomerId: cust.id, serviceId: svc.id,
      date: "2026-08-23", startTime: `12:${String(i).padStart(2, "0")}`,
      endTime: `13:${String(i).padStart(2, "0")}`, durationMinutes: 60,
      status, price: 2000 + i, treatmentLocation: "salon",
    }).returning();
    assert.ok(appt);
    statusFixtures.push({ status, bucket, appointmentId: appt.id });
    await db.insert(automationRunsTable).values({
      eventKey: `pg-status-run-${i}-${suffix}`, ruleId: rule.id, salonId: a.salon.id,
      salonCustomerId: cust.id, status: "sent", executedAt: RECENT_RUN_AT, sentAt: RECENT_RUN_AT,
      attributedAppointmentId: appt.id,
    });
  }

  const server = app.listen(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string, token = a.token) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: `${sessionCookieName}=${token}` } });
    return { status: response.status, body: await response.json() as any };
  };
  const listPath = `/api/growth/automations/${rule.id}/attributed-appointments`;

  try {
    // ── 1. Default page size + excluded-status-exclusive total ───────────────
    const first = await get(listPath);
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 25, "default page size is 25");
    assert.equal(
      first.body.total,
      EXPECTED_ALL_TOTAL,
      "total includes every realized mapped status and excludes cancelled/excluded statuses",
    );
    assert.equal(first.body.limit, 25);
    assert.equal(first.body.offset, 0);
    assert.equal(
      first.body.items[0].salonCustomerId, cust.id,
      "rows expose the linked salon customer id for the CRM deep link",
    );
    console.log("✓ default page size and excluded-status-exclusive total");

    // ── 2. Total matches the stats count for every period choice ───────────
    for (const [period, expected] of [
      ["all", EXPECTED_ALL_TOTAL],
      ["30d", EXPECTED_RECENT_TOTAL],
      ["7d", EXPECTED_RECENT_TOTAL],
      ["90d", EXPECTED_ALL_TOTAL],
    ] as const) {
      const page = await get(`${listPath}?period=${period}`);
      assert.equal(page.status, 200);
      assert.equal(page.body.total, expected, `period=${period} total`);
      const stats = await get(`/api/growth/automations/${rule.id}/stats?period=${period}`);
      assert.equal(stats.status, 200);
      assert.equal(page.body.total, stats.body.attributedAppointments, `period=${period} total matches stats count`);
    }
    console.log("✓ paginated total matches stats attributedAppointments for every period");

    // ── 3. Deterministic pages: full coverage, no overlap, period respected ─
    const walk = async (query: string, expectedTotal: number) => {
      const seen = new Set<string>();
      let offset = 0;
      for (;;) {
        const page = await get(`${listPath}?${query}&limit=25&offset=${offset}`);
        assert.equal(page.status, 200);
        if (page.body.items.length === 0) break;
        for (const item of page.body.items) {
          assert.ok(!seen.has(item.appointmentId), `no duplicate row across pages (${item.appointmentId})`);
          seen.add(item.appointmentId);
        }
        offset += page.body.items.length;
      }
      assert.equal(seen.size, expectedTotal, `pages cover exactly ${expectedTotal} rows for ${query}`);
    };
    await walk("period=all", EXPECTED_ALL_TOTAL);
    await walk("period=30d", EXPECTED_RECENT_TOTAL);
    console.log("✓ deterministic pages cover the full set with no overlap, honoring the period");

    // ── 4. Newest-first ordering within the maximum page ───────────────────
    const all = await get(`${listPath}?limit=100`);
    assert.equal(all.body.items.length, EXPECTED_ALL_TOTAL, "limit=100 returns all realized rows in one page");
    const listedIds = new Set(all.body.items.map((item: { appointmentId: string }) => item.appointmentId));
    for (const fixture of statusFixtures) {
      const shouldBeListed = fixture.bucket === "completed" || fixture.bucket === "upcoming";
      assert.equal(
        listedIds.has(fixture.appointmentId),
        shouldBeListed,
        `${fixture.status} (${fixture.bucket}) must ${shouldBeListed ? "" : "not "}appear in the drill-down`,
      );
    }
    const stats = await get(`/api/growth/automations/${rule.id}/stats?period=all`);
    assert.equal(stats.status, 200);
    const expectedBucketCounts = Object.fromEntries(
      Object.entries(CAMPAIGN_APPOINTMENT_STATUS_BUCKETS).map(([bucket, statuses]) => [
        bucket,
        statuses.length,
      ]),
    ) as Record<string, number>;
    assert.equal(
      stats.body.completedAppointments,
      TOTAL + expectedBucketCounts.completed,
      "stats completed count must include every status mapped to completed",
    );
    assert.equal(
      stats.body.upcomingAppointments,
      expectedBucketCounts.upcoming,
      "stats upcoming count must include every status mapped to upcoming",
    );
    assert.equal(
      stats.body.cancelledAttributedAppointments,
      3 + expectedBucketCounts.cancelledAttributed,
      "stats cancelled count must include every status mapped to cancelledAttributed",
    );
    assert.equal(
      stats.body.noShowAttributedAppointments,
      1 + expectedBucketCounts.excluded,
      "stats no-show count must include every status mapped to excluded",
    );
    const dates = all.body.items.map((i: any) => i.date);
    const sorted = [...dates].sort((x: string, y: string) => (x < y ? 1 : x > y ? -1 : 0));
    assert.deepEqual(dates, sorted, "newest-first ordering");
    console.log("✓ newest-first ordering and max page size");

    // ── 5. Validation ───────────────────────────────────────────────────────
    for (const bad of ["limit=0", "limit=101", "limit=abc", "limit=2.5", "offset=-1", "offset=abc", "period=14d"]) {
      const response = await get(`${listPath}?${bad}`);
      assert.equal(response.status, 400, `rejects ${bad}`);
    }
    console.log("✓ invalid limit/offset/period rejected");

    // ── 6. Trend: previous window excludes cancelled and no-show appointments
    const overview = await get(`/api/growth/automation-stats?period=30d&compare=previous`);
    assert.equal(overview.status, 200);
    const mine = overview.body.find((r: any) => r.ruleId === rule.id);
    assert.ok(mine, "rule present in overview stats");
    assert.equal(mine.attributedAppointments, EXPECTED_RECENT_TOTAL, "current-window count includes every realized mapped status");
    assert.ok(mine.previous, "previous window returned for compare=previous");
    assert.equal(
      mine.previous.attributedAppointments,
      TOTAL - RECENT_TOTAL,
      "previous-window count excludes cancelled and no-show appointments like the current window",
    );
    const detail = await get(`/api/growth/automations/${rule.id}/stats?period=30d&compare=previous`);
    assert.equal(detail.status, 200);
    assert.equal(
      detail.body.previous.attributedAppointments,
      TOTAL - RECENT_TOTAL,
      "per-rule previous-window count excludes cancelled and no-show appointments like the current window",
    );
    console.log("✓ trend comparison excludes cancelled and no-show appointments in both endpoints");

    // ── 7. Owner scoping ────────────────────────────────────────────────────
    const foreign = await get(listPath, b.token);
    assert.equal(foreign.status, 404, "foreign rule is not found for another owner");
    const anonymous = await fetch(`${baseUrl}${listPath}`);
    assert.ok([401, 403].includes(anonymous.status), "anonymous request rejected");
    console.log("✓ owner scoping preserved");
  } finally {
    server.close();
    await db.delete(automationRunsTable).where(eq(automationRunsTable.ruleId, rule.id));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, a.salon.id));
    await db.delete(automationRulesTable).where(eq(automationRulesTable.id, rule.id));
    await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, a.salon.id));
    await db.delete(servicesTable).where(eq(servicesTable.salonId, a.salon.id));
    await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, cleanup.userIds));
    await db.delete(salonsTable).where(inArray(salonsTable.id, cleanup.salonIds));
    await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
    await pool.end();
  }
  console.log("All attributed-appointments pagination checks passed.");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
