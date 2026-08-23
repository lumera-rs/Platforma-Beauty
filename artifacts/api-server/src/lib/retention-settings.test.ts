/**
 * Platform retention settings — test suite
 *
 * Unit (pure functions, no DB):
 *  1. Defaults preserve historical classification behaviour
 *  2. NEW window boundary (exactly N days → NEW; N+1 → not NEW)
 *  3. AT_RISK boundary is strictly greater-than (equal → not overdue)
 *  4. LOST minimum-days boundary is strictly greater-than
 *  5. VIP completed-visit count boundary (tunable)
 *  6. VIP spend boundary is strictly greater-than the tuned percent of median
 *  7. validateRetentionThresholds rejects non-integers, out-of-range and
 *     ill-ordered (lost ≤ atRisk) values
 *
 * DB + API integration (real DB, real Express app):
 *  8. GET returns active settings (defaults as version 0 when untouched)
 *  9. Non-admin (salon owner) → 403 on GET/PUT/history
 * 10. PUT with ill-ordered percents / out-of-range / non-integer / missing
 *     field → 400 and no version recorded
 * 11. Valid PUTs create sequential audited versions (who + when recorded)
 * 11b. Preview dry-runs candidate thresholds: identity candidate moves nobody,
 *     a tuned candidate reports counts + shifts, and NO settings version or
 *     row is ever recorded (including for invalid candidates → 400)
 * 12. Owner CRM list flips a 3-visit customer ACTIVE → VIP when the admin
 *     lowers vipMinCompletedVisits, and reports the active version
 * 13. Owner CRM detail turns AT_RISK → LOST under tuned lost thresholds and
 *     its explanation quotes the tuned threshold value
 * 14. History is newest-first and pairs every entry with the previous values
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, gt } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  salonsTable,
  servicesTable,
  salonCustomersTable,
  appointmentsTable,
  platformRetentionSettingsTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  classifyRetention,
  DEFAULT_RETENTION_THRESHOLDS,
  type RetentionThresholds,
} from "./retention-classification";
import { validateRetentionThresholds } from "./retention-settings";

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

const T = (overrides: Partial<RetentionThresholds> = {}): RetentionThresholds => ({
  ...DEFAULT_RETENTION_THRESHOLDS,
  ...overrides,
});

function testDefaultsPreserveBehaviour() {
  const today = new Date("2024-06-01");
  const fixtures = [
    { appointments: [] },
    { appointments: [{ date: "2024-05-20", status: "completed" as const, price: 3000 }] },
    {
      appointments: [
        { date: "2024-03-01", status: "completed" as const, price: 3000 },
        { date: "2024-04-01", status: "completed" as const, price: 3000 },
      ],
    },
    { appointments: [{ date: "2023-01-01", status: "completed" as const, price: 3000 }] },
  ];
  for (const fixture of fixtures) {
    const implicit = classifyRetention({ ...fixture, today });
    const explicit = classifyRetention({ ...fixture, today, thresholds: T() });
    assert.equal(implicit.status, explicit.status);
    assert.equal(implicit.explanation, explicit.explanation);
  }
  console.log("✓ Defaults preserve historical behaviour");
}

function testNewWindowBoundary() {
  const today = new Date("2024-06-01");
  const thresholds = T({ newCustomerWindowDays: 30 });

  // Exactly 30 days ago → still NEW
  const atBoundary = classifyRetention({
    appointments: [{ date: "2024-05-02", status: "completed", price: 3000 }],
    today,
    thresholds,
  });
  assert.equal(atBoundary.status, "NEW", "visit exactly newCustomerWindowDays ago stays NEW");

  // 31 days ago → no longer NEW (falls through to interval logic → ACTIVE)
  const pastBoundary = classifyRetention({
    appointments: [{ date: "2024-05-01", status: "completed", price: 3000 }],
    today,
    thresholds,
  });
  assert.equal(pastBoundary.status, "ACTIVE", "one day past the NEW window leaves NEW");
  console.log("✓ NEW window boundary");
}

function testAtRiskBoundary() {
  const today = new Date("2024-04-10");
  // Two visits 40 days apart; last visit exactly 60 days ago.
  const appointments = [
    { date: "2024-01-01", status: "completed" as const, price: 3000 },
    { date: "2024-02-10", status: "completed" as const, price: 3000 },
  ];

  // Threshold 40 × 150% = 60 → 60 > 60 is false → still ACTIVE
  const atBoundary = classifyRetention({
    appointments, today, thresholds: T({ atRiskIntervalPercent: 150 }),
  });
  assert.equal(atBoundary.status, "ACTIVE", "exactly at the at-risk threshold is not overdue");

  // Threshold 40 × 149% = 59.6 → 60 > 59.6 → AT_RISK
  const pastBoundary = classifyRetention({
    appointments, today, thresholds: T({ atRiskIntervalPercent: 149 }),
  });
  assert.equal(pastBoundary.status, "AT_RISK", "one percent tighter tips into AT_RISK");
  console.log("✓ AT_RISK boundary (strict greater-than)");
}

function testLostMinimumDaysBoundary() {
  const today = new Date("2024-07-19");
  // Two visits 40 days apart; last visit exactly 200 days ago.
  // Interval-based lost threshold: 40 × 250% = 100 < lostMinimumDays → the
  // minimum dominates, so the boundary under test is lostMinimumDays itself.
  const appointments = [
    { date: "2023-11-22", status: "completed" as const, price: 3000 },
    { date: "2024-01-01", status: "completed" as const, price: 3000 },
  ];

  const atBoundary = classifyRetention({
    appointments, today, thresholds: T({ lostMinimumDays: 200 }),
  });
  assert.equal(atBoundary.status, "AT_RISK", "exactly at lostMinimumDays is not yet LOST");

  const pastBoundary = classifyRetention({
    appointments, today, thresholds: T({ lostMinimumDays: 199 }),
  });
  assert.equal(pastBoundary.status, "LOST", "one day beyond lostMinimumDays is LOST");
  assert.ok(
    pastBoundary.explanation.includes("199"),
    "LOST explanation quotes the tuned threshold",
  );
  console.log("✓ LOST minimum-days boundary (strict greater-than)");
}

function testVipVisitCountBoundary() {
  const today = new Date("2024-06-01");
  // Visits spaced 15 days apart, the last one 5 days before "today", so the
  // customer is never overdue and the VIP branch is actually reached.
  const recentVisits = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      const d = new Date(today.getTime() - (5 + 15 * (count - 1 - i)) * 86_400_000);
      return { date: d.toISOString().slice(0, 10), status: "completed" as const, price: 3000 };
    });

  // Tuned down to 3 visits
  const vip = classifyRetention({
    appointments: recentVisits(3), today, thresholds: T({ vipMinCompletedVisits: 3 }),
  });
  assert.equal(vip.status, "VIP", "exactly vipMinCompletedVisits completed → VIP");

  const notYet = classifyRetention({
    appointments: recentVisits(2), today, thresholds: T({ vipMinCompletedVisits: 3 }),
  });
  assert.notEqual(notYet.status, "VIP", "one visit short of the tuned count is not VIP");

  // Default 5 still applies when untouched
  const fourVisits = classifyRetention({ appointments: recentVisits(4), today, thresholds: T() });
  assert.notEqual(fourVisits.status, "VIP", "4 visits under default threshold of 5 is not VIP");
  console.log("✓ VIP completed-visit count boundary");
}

function testVipSpendBoundary() {
  const today = new Date("2024-06-01");
  const thresholds = T({ vipSpendPercentOfMedian: 300 });
  // Two visits 15 days apart, the last 7 days before "today" — not overdue,
  // so classification reaches the VIP spend check.
  const base = (prices: number[]) =>
    prices.map((price, i) => {
      const d = new Date(today.getTime() - (7 + 15 * (prices.length - 1 - i)) * 86_400_000);
      return { date: d.toISOString().slice(0, 10), status: "completed" as const, price };
    });

  // Median 1000 × 300% = 3000; spend exactly 3000 → not VIP (strict >)
  const atBoundary = classifyRetention({
    appointments: base([1500, 1500]), today, salonMedianSpend: 1000, thresholds,
  });
  assert.notEqual(atBoundary.status, "VIP", "spend equal to the tuned threshold is not VIP");

  const pastBoundary = classifyRetention({
    appointments: base([1500, 1501]), today, salonMedianSpend: 1000, thresholds,
  });
  assert.equal(pastBoundary.status, "VIP", "spend one dinar over the tuned threshold is VIP");
  console.log("✓ VIP spend boundary (strict greater-than)");
}

function testThresholdValidation() {
  assert.deepEqual(validateRetentionThresholds(T()), [], "defaults are valid");

  const nonInteger = validateRetentionThresholds(T({ atRiskIntervalPercent: 150.5 }));
  assert.ok(nonInteger.some((p) => p.includes("atRiskIntervalPercent")), "non-integer rejected");

  const outOfRange = validateRetentionThresholds(T({ newCustomerWindowDays: 0 }));
  assert.ok(outOfRange.some((p) => p.includes("newCustomerWindowDays")), "below-minimum rejected");

  const tooLarge = validateRetentionThresholds(T({ lostMinimumDays: 5000 }));
  assert.ok(tooLarge.some((p) => p.includes("lostMinimumDays")), "above-maximum rejected");

  const illOrdered = validateRetentionThresholds(
    T({ atRiskIntervalPercent: 300, lostIntervalPercent: 300 }),
  );
  assert.ok(
    illOrdered.some((p) => p.includes("lostIntervalPercent")),
    "lost ≤ atRisk rejected",
  );
  console.log("✓ Threshold validation rules");
}

// ---------------------------------------------------------------------------
// DB + API integration
// ---------------------------------------------------------------------------

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function integrationTests() {
  const suffix = `rts-${Date.now()}`;
  const createdUserIds: string[] = [];
  const createdSalonIds: string[] = [];

  const server = app.listen(0, "127.0.0.1");
  const baseUrl = await once(server, "listening").then(() => {
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}/api`;
  });

  // Versions inserted by this test are removed afterwards (version > initial).
  const versions = await db
    .select({ version: platformRetentionSettingsTable.version })
    .from(platformRetentionSettingsTable);
  const initialVersion = versions.reduce((max, r) => Math.max(max, r.version), 0);

  try {
    // ── Fixtures ────────────────────────────────────────────────────────────
    const hash = await hashPassword(`pass-${suffix}`);
    const [admin] = await db.insert(usersTable).values({
      firstName: "Retention", lastName: "Admin",
      email: `admin-${suffix}@rts.test`, passwordHash: hash, passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    assert.ok(admin);
    createdUserIds.push(admin.id);
    const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;

    const [owner] = await db.insert(usersTable).values({
      firstName: "Owner", lastName: suffix,
      email: `owner-${suffix}@rts.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
    }).returning();
    assert.ok(owner);
    createdUserIds.push(owner.id);
    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id, name: `Salon ${suffix}`, slug: `salon-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
      phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
      email: `salon-${suffix}@rts.test`,
      shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
    }).returning();
    assert.ok(salon);
    createdSalonIds.push(salon.id);
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
    const ownerCookie = `${sessionCookieName}=${await createSession(owner.id)}`;

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id, categoryName: "Hair", name: `Svc ${suffix}`, description: "Test",
      durationMinutes: 60, price: 3000, imageUrl: "/t.jpg", active: true,
    }).returning();
    assert.ok(service);

    const addAppointment = (salonCustomerId: string, daysAgo: number, price: number) =>
      db.insert(appointmentsTable).values({
        salonId: salon.id, salonCustomerId, serviceId: service.id,
        date: isoDaysAgo(daysAgo), startTime: "10:00", endTime: "11:00", durationMinutes: 60,
        status: "completed", price, treatmentLocation: "salon",
      });
    const addCustomer = async (firstName: string, lastName: string) => {
      const [c] = await db.insert(salonCustomersTable).values({
        salonId: salon.id, firstName, lastName,
        email: `${firstName.toLowerCase()}-${suffix}@rts.test`, phone: null,
      }).returning();
      assert.ok(c);
      return c;
    };

    // Customer A: 3 recent low-price visits (interval 15d, last 10d ago).
    // Under defaults: ACTIVE (3 < 5 visits; spend 3000 ≤ 2× median 2000).
    // Once vipMinCompletedVisits drops to 3 → VIP.
    const customerA = await addCustomer("Ana", "Vip");
    for (const daysAgo of [40, 25, 10]) await addAppointment(customerA.id, daysAgo, 1000);

    // Customer C exists to anchor the salon median spend at 2000 so that A's
    // total (3000) stays under the default VIP spend threshold (2 × 2000).
    const customerC = await addCustomer("Ceca", "Median");
    for (const daysAgo of [40, 25, 10]) await addAppointment(customerC.id, daysAgo, 2000);

    // Customer B: single visit 100 days ago.
    // Defaults: AT_RISK (lost threshold max(45×2.5, 180) = 180 not reached).
    // With defaultIntervalDays 30 + lostMinimumDays 90: threshold 90 → LOST.
    const customerB = await addCustomer("Bojan", "Lost");
    await addAppointment(customerB.id, 100, 3000);

    const adminHeaders = { cookie: adminCookie, "content-type": "application/json" };
    const putSettings = (body: unknown) =>
      fetch(`${baseUrl}/growth/admin/retention-settings`, {
        method: "PUT", headers: adminHeaders, body: JSON.stringify(body),
      });
    const getOwnerList = async () => {
      const res = await fetch(`${baseUrl}/growth/retention`, { headers: { cookie: ownerCookie } });
      assert.equal(res.status, 200);
      return res.json() as Promise<any>;
    };

    // ── 8. GET active settings ──────────────────────────────────────────────
    const getRes = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    assert.equal(getRes.status, 200);
    const active0 = (await getRes.json()) as any;
    assert.equal(active0.version, initialVersion);
    assert.deepEqual(active0.defaults, DEFAULT_RETENTION_THRESHOLDS, "response exposes the platform defaults");
    if (initialVersion === 0) {
      assert.equal(active0.isDefault, true);
      assert.deepEqual(active0.thresholds, DEFAULT_RETENTION_THRESHOLDS);
      assert.equal(active0.changedByUserId, null);
      assert.equal(active0.changedAt, null);
    }
    console.log("✓ GET active settings");

    // ── 9. Non-admin is rejected ────────────────────────────────────────────
    for (const [method, path] of [
      ["GET", "/growth/admin/retention-settings"],
      ["PUT", "/growth/admin/retention-settings"],
      ["GET", "/growth/admin/retention-settings/history"],
      ["POST", "/growth/admin/retention-settings/preview"],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(DEFAULT_RETENTION_THRESHOLDS),
      });
      assert.equal(res.status, 403, `${method} ${path} must reject non-admin`);
    }
    console.log("✓ Non-admin rejected (403)");

    // ── 10. Invalid updates are rejected without recording a version ────────
    const invalidBodies: [string, Record<string, unknown>][] = [
      ["lost ≤ atRisk", { ...DEFAULT_RETENTION_THRESHOLDS, atRiskIntervalPercent: 300, lostIntervalPercent: 300 }],
      ["below minimum", { ...DEFAULT_RETENTION_THRESHOLDS, newCustomerWindowDays: 0 }],
      ["above maximum", { ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 1000 }],
      ["non-integer", { ...DEFAULT_RETENTION_THRESHOLDS, atRiskIntervalPercent: 150.5 }],
      ["missing field", (() => { const { lostMinimumDays: _omit, ...rest } = DEFAULT_RETENTION_THRESHOLDS; return rest; })()],
    ];
    for (const [label, body] of invalidBodies) {
      const res = await putSettings(body);
      assert.equal(res.status, 400, `invalid update (${label}) must be rejected`);
    }
    const afterInvalid = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    assert.equal(((await afterInvalid.json()) as any).version, initialVersion, "rejected updates record no version");
    console.log("✓ Invalid updates rejected (400), no version recorded");

    // ── 11a. Baseline: explicitly activate the defaults ─────────────────────
    // Makes every later classification assertion deterministic even if the
    // development database already carried tuned settings.
    const baselineRes = await putSettings(DEFAULT_RETENTION_THRESHOLDS);
    assert.equal(baselineRes.status, 200);
    const baseline = (await baselineRes.json()) as any;
    assert.equal(baseline.version, initialVersion + 1, "versions increment sequentially");
    assert.equal(baseline.isDefault, false);
    assert.equal(baseline.changedByUserId, admin.id, "change records who made it");
    assert.ok(baseline.changedAt, "change records when it was made");
    console.log("✓ Valid update creates a new audited version");

    // ── 11b. Preview: dry-run counts, never records a version ───────────────
    const postPreview = (body: unknown) =>
      fetch(`${baseUrl}/growth/admin/retention-settings/preview`, {
        method: "POST", headers: adminHeaders, body: JSON.stringify(body),
      });

    // Identity candidate (== active thresholds) → nothing moves, deterministically.
    const identityRes = await postPreview(DEFAULT_RETENTION_THRESHOLDS);
    assert.equal(identityRes.status, 200);
    const identity = (await identityRes.json()) as any;
    assert.equal(identity.currentVersion, initialVersion + 1, "preview reports the active version");
    assert.equal(identity.reclassifiedCount, 0, "identical thresholds reclassify nobody");
    assert.deepEqual(identity.candidateCounts, identity.currentCounts, "counts agree for identical thresholds");
    assert.deepEqual(identity.shifts, [], "no shifts for identical thresholds");
    assert.ok(identity.totalCustomers >= 3, "platform-wide totals include the fixture customers");
    const sumCurrent = Object.values(identity.currentCounts as Record<string, number>)
      .reduce((s, n) => s + n, 0);
    assert.equal(sumCurrent, identity.totalCustomers, "every customer lands in exactly one status");

    // Tuned candidate: lowering vipMinCompletedVisits to 3 moves customer A
    // (3 completed visits, ACTIVE under defaults) into VIP. The platform DB may
    // hold other customers, so assertions are lower bounds where appropriate.
    const previewRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 3 });
    assert.equal(previewRes.status, 200);
    const previewBody = (await previewRes.json()) as any;
    assert.ok(previewBody.reclassifiedCount >= 1, "lowering the VIP threshold moves at least customer A");
    assert.ok(
      previewBody.candidateCounts.VIP - previewBody.currentCounts.VIP >= 1,
      "candidate counts gain at least one VIP",
    );
    const activeToVip = (previewBody.shifts as any[]).find(
      (s) => s.fromStatus === "ACTIVE" && s.toStatus === "VIP",
    );
    assert.ok(activeToVip && activeToVip.count >= 1, "shifts report the ACTIVE → VIP move");
    const shiftSum = (previewBody.shifts as any[]).reduce((s: number, x: any) => s + x.count, 0);
    assert.equal(shiftSum, previewBody.reclassifiedCount, "shift counts add up to the reclassified total");
    const sumCandidate = Object.values(previewBody.candidateCounts as Record<string, number>)
      .reduce((s: number, n) => s + (n as number), 0);
    assert.equal(sumCandidate, previewBody.totalCustomers, "candidate counts cover every customer");

    // Invalid candidate → 400 (same validation as PUT).
    const badPreviewRes = await postPreview({
      ...DEFAULT_RETENTION_THRESHOLDS, atRiskIntervalPercent: 300, lostIntervalPercent: 300,
    });
    assert.equal(badPreviewRes.status, 400, "ill-ordered candidate rejected");

    // Preview must be strictly read-only: no version, no settings rows.
    const afterPreviewRes = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    assert.equal(((await afterPreviewRes.json()) as any).version, initialVersion + 1, "preview records no settings version");
    const rowsAfterPreview = await db
      .select({ version: platformRetentionSettingsTable.version })
      .from(platformRetentionSettingsTable)
      .where(gt(platformRetentionSettingsTable.version, initialVersion + 1));
    assert.equal(rowsAfterPreview.length, 0, "preview inserts no settings rows");
    console.log("✓ Preview dry-runs candidate thresholds without persisting");

    // ── 12. Owner CRM flips ACTIVE → VIP under tuned visit count ────────────
    const listBefore = await getOwnerList();
    const rowBefore = listBefore.find((c: { salonCustomerId: string }) => c.salonCustomerId === customerA.id);
    assert.ok(rowBefore);
    assert.equal(rowBefore.status, "ACTIVE", "3 visits stay ACTIVE under default VIP threshold of 5");
    assert.equal(rowBefore.thresholdVersion, initialVersion + 1, "list reports the active settings version");

    // List and detail must agree for a VIP-by-spend customer: C's total (6000)
    // exceeds 2× the salon median (2000), which only holds if the DETAIL
    // endpoint feeds the same salon-wide median into classification.
    const rowC = listBefore.find((c: { salonCustomerId: string }) => c.salonCustomerId === customerC.id);
    assert.ok(rowC);
    assert.equal(rowC.status, "VIP", "high-spend customer is VIP by spend in the list");
    const detailCRes = await fetch(`${baseUrl}/growth/retention/${customerC.id}`, { headers: { cookie: ownerCookie } });
    assert.equal(detailCRes.status, 200);
    const detailC = (await detailCRes.json()) as any;
    assert.equal(detailC.status, "VIP", "detail agrees with the list for VIP-by-spend classification");
    console.log("✓ List and detail agree on VIP-by-spend (shared salon median)");

    const v2Res = await putSettings({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 3 });
    assert.equal(v2Res.status, 200);
    assert.equal(((await v2Res.json()) as any).version, initialVersion + 2);

    const listAfter = await getOwnerList();
    const rowAfter = listAfter.find((c: { salonCustomerId: string }) => c.salonCustomerId === customerA.id);
    assert.ok(rowAfter);
    assert.equal(rowAfter.status, "VIP", "3 visits become VIP once the admin lowers the threshold");
    assert.equal(rowAfter.thresholdVersion, initialVersion + 2, "list reflects the new settings version");
    assert.ok(rowAfter.explanation.includes("3"), "explanation reflects the tuned visit count");
    console.log("✓ Owner CRM list flips ACTIVE → VIP under tuned threshold + reports version");

    // ── 13. Owner CRM detail: AT_RISK → LOST under tuned lost thresholds ────
    const detailBeforeRes = await fetch(`${baseUrl}/growth/retention/${customerB.id}`, { headers: { cookie: ownerCookie } });
    assert.equal(detailBeforeRes.status, 200);
    const detailBefore = (await detailBeforeRes.json()) as any;
    assert.equal(detailBefore.status, "AT_RISK", "100 days ago is AT_RISK under defaults");

    const v3Body = {
      ...DEFAULT_RETENTION_THRESHOLDS,
      vipMinCompletedVisits: 3,
      defaultIntervalDays: 30,
      lostMinimumDays: 90,
    };
    const v3Res = await putSettings(v3Body);
    assert.equal(v3Res.status, 200);
    assert.equal(((await v3Res.json()) as any).version, initialVersion + 3);

    const detailAfterRes = await fetch(`${baseUrl}/growth/retention/${customerB.id}`, { headers: { cookie: ownerCookie } });
    assert.equal(detailAfterRes.status, 200);
    const detailAfter = (await detailAfterRes.json()) as any;
    // Lost threshold = max(30 × 250%, 90) = 90 < ~100 days since last visit.
    assert.equal(detailAfter.status, "LOST", "customer turns LOST under the tuned thresholds");
    assert.ok(
      detailAfter.explanation.includes("90"),
      `LOST explanation quotes the tuned threshold (got: ${detailAfter.explanation})`,
    );
    assert.equal(detailAfter.thresholdVersion, initialVersion + 3, "detail reports the active settings version");
    console.log("✓ Owner CRM detail explanation reflects tuned LOST threshold + version");

    // ── 14. History: newest first, previous values paired per entry ─────────
    const historyRes = await fetch(`${baseUrl}/growth/admin/retention-settings/history`, { headers: adminHeaders });
    assert.equal(historyRes.status, 200);
    const history = (await historyRes.json()) as any[];
    assert.ok(history.length >= 3);
    const [newest, second, third] = history;
    assert.equal(newest.version, initialVersion + 3, "history is newest-first");
    assert.equal(second.version, initialVersion + 2);
    assert.equal(third.version, initialVersion + 1);
    assert.deepEqual(newest.previousThresholds, second.thresholds, "previous values are the prior version");
    assert.deepEqual(second.previousThresholds, third.thresholds);
    assert.equal(newest.thresholds.lostMinimumDays, 90);
    assert.equal(newest.previousThresholds.lostMinimumDays, DEFAULT_RETENTION_THRESHOLDS.lostMinimumDays);
    assert.equal(newest.changedByUserId, admin.id);
    assert.equal(newest.changedByName, "Retention Admin");
    assert.ok(newest.changedAt);
    if (initialVersion === 0) {
      const first = history[history.length - 1];
      assert.deepEqual(first.previousThresholds, DEFAULT_RETENTION_THRESHOLDS, "first change pairs against defaults");
    }
    console.log("✓ History records who/when/previous values, newest first");

    // ── 15. Detail classifies from FULL history (>50 visits) ────────────────
    // Customer D has exactly 100 completed visits. With the admin-tunable
    // maximum vipMinCompletedVisits = 100, D is VIP only if the classifier
    // sees every visit — a detail endpoint truncated to the 50 most recent
    // would report ACTIVE with half the spend. List and detail must agree on
    // status, counts, spend, and explanation.
    const customerD = await addCustomer("Dara", "Stalna");
    const bulkVisits = Array.from({ length: 100 }, (_, i) => ({
      salonId: salon.id,
      salonCustomerId: customerD.id,
      serviceId: service.id,
      date: isoDaysAgo(i + 1),
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      status: "completed" as const,
      price: 500,
      treatmentLocation: "salon" as const,
    }));
    await db.insert(appointmentsTable).values(bulkVisits);

    const v4Res = await putSettings({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 100 });
    assert.equal(v4Res.status, 200);
    assert.equal(((await v4Res.json()) as any).version, initialVersion + 4);

    const listFull = await getOwnerList();
    const rowD = listFull.find((c: { salonCustomerId: string }) => c.salonCustomerId === customerD.id);
    assert.ok(rowD);
    const detailDRes = await fetch(`${baseUrl}/growth/retention/${customerD.id}`, { headers: { cookie: ownerCookie } });
    assert.equal(detailDRes.status, 200);
    const detailD = (await detailDRes.json()) as any;

    assert.equal(rowD.status, "VIP", "exactly 100 completed visits reach the tuned VIP boundary in the list");
    assert.equal(detailD.status, "VIP", "detail sees the full history and agrees at the 100-visit boundary");
    assert.equal(rowD.completedCount, 100, "list counts all 100 visits");
    assert.equal(detailD.completedCount, 100, "detail counts all 100 visits (not truncated to 50)");
    assert.equal(rowD.totalSpend, 100 * 500, "list totals the full spend");
    assert.equal(detailD.totalSpend, 100 * 500, "detail totals the full spend");
    assert.equal(detailD.explanation, rowD.explanation, "list and detail explanations agree");
    assert.equal(detailD.typicalIntervalDays, rowD.typicalIntervalDays, "typical interval agrees");
    assert.equal(detailD.thresholdVersion, initialVersion + 4);
    assert.ok(Array.isArray(detailD.recentAppointments) && detailD.recentAppointments.length === 50,
      "UI appointment list stays capped at 50");
    console.log("✓ Detail classifies from full history; list/detail agree beyond 50 visits");
  } finally {
    // Remove only rows created by this run; earlier versions stay untouched.
    await db.delete(platformRetentionSettingsTable)
      .where(gt(platformRetentionSettingsTable.version, initialVersion));
    for (const salonId of createdSalonIds) {
      await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salonId));
      await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, salonId));
      await db.delete(servicesTable).where(eq(servicesTable.salonId, salonId));
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    }
    for (const userId of createdUserIds) {
      await db.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    server.close();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("— Unit tests —");
  testDefaultsPreserveBehaviour();
  testNewWindowBoundary();
  testAtRiskBoundary();
  testLostMinimumDaysBoundary();
  testVipVisitCountBoundary();
  testVipSpendBoundary();
  testThresholdValidation();

  console.log("— Integration tests —");
  await integrationTests();

  console.log("\nAll retention settings tests passed ✅");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
