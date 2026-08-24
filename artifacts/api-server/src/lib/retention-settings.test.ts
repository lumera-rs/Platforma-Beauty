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
 * 11c. Preview guards: above the (env-tunable) row-count cap the preview
 *     falls back to a clearly-flagged sampled estimate (isEstimate +
 *     sampleSize, sample clamped to the cap, boundary inclusive) instead of
 *     refusing; the time budget still turns a slow preview into a friendly
 *     503 — including when a SINGLE (final) batch overruns the budget after
 *     its work (deterministic fault-injected batch delay); the preview
 *     returns to exact mode once the guards are lifted
 * 11e. Preview share-ranking floor reads a positive integer env override,
 *      reports the effective value, and falls back to the default when invalid
 * 11d. Preview building blocks: the database-side statement_timeout cancels a
 *     slow query and surfaces as the friendly overload error, and SQL
 *     percentile_cont agrees exactly with computeSalonMedianSpend for odd and
 *     even price counts (so the preview median matches the CRM endpoints)
 * 16. Volume benchmark: with a realistic seeded volume (30 extra salons,
 *     12,000+ customers, 27,000 appointments including deep per-customer
 *     histories) the keyset-batched preview still answers correctly within
 *     the response-time bound; forcing estimate mode over the same volume
 *     answers a flagged estimate just as fast whose extrapolated counts land
 *     within a sampling-error corridor of the exact run
 * 12. Owner CRM list flips a 3-visit customer ACTIVE → VIP when the admin
 *     lowers vipMinCompletedVisits, and reports the active version
 * 13. Owner CRM detail turns AT_RISK → LOST under tuned lost thresholds and
 *     its explanation quotes the tuned threshold value
 * 14. History is newest-first and pairs every entry with the previous values
 * 16. Restore provenance is labelled truthfully; dishonest metadata rejected;
 *     no-op restores (values identical to active) → 400 NO_OP_RESTORE with no
 *     version recorded, while identical manual saves stay allowed
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
import { sql } from "drizzle-orm";
import {
  classifyRetention,
  computeSalonMedianSpend,
  DEFAULT_RETENTION_THRESHOLDS,
  type RetentionThresholds,
} from "./retention-classification";
import {
  RetentionPreviewOverloadError,
  calculateEstimatedCountMarginOfError,
  retentionPreviewGuardLimits,
  validateRetentionThresholds,
  withPreviewStatementTimeout,
} from "./retention-settings";

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

function testEstimatedPreviewMarginOfError() {
  // A 50/50 result has sampling uncertainty, while the Wilson interval also
  // keeps edge samples (0% or 100%) from being misreported as ±0.
  assert.ok(
    calculateEstimatedCountMarginOfError(50, 100, 10_000) > 0,
    "mixed samples report a positive margin",
  );
  assert.ok(
    calculateEstimatedCountMarginOfError(0, 10, 10_000) > 0,
    "an all-zero sample does not imply zero uncertainty",
  );
  assert.ok(
    calculateEstimatedCountMarginOfError(10, 10, 10_000) > 0,
    "an all-change sample does not imply zero uncertainty",
  );
  assert.equal(
    calculateEstimatedCountMarginOfError(50, 100, 100),
    0,
    "a census has no sampling uncertainty",
  );
  console.log("✓ Estimated preview margin of error");
}
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
      assert.equal(active0.changedByName, null, "platform defaults have no changer name");
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
    // Each body carries the CORRECT expectedVersion so the 400 is attributable
    // to the threshold problem itself, never to the concurrency precondition.
    const invalidBodies: [string, Record<string, unknown>][] = [
      ["lost ≤ atRisk", { ...DEFAULT_RETENTION_THRESHOLDS, atRiskIntervalPercent: 300, lostIntervalPercent: 300, expectedVersion: initialVersion }],
      ["below minimum", { ...DEFAULT_RETENTION_THRESHOLDS, newCustomerWindowDays: 0, expectedVersion: initialVersion }],
      ["above maximum", { ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 1000, expectedVersion: initialVersion }],
      ["non-integer", { ...DEFAULT_RETENTION_THRESHOLDS, atRiskIntervalPercent: 150.5, expectedVersion: initialVersion }],
      ["missing field", (() => { const { lostMinimumDays: _omit, ...rest } = DEFAULT_RETENTION_THRESHOLDS; return { ...rest, expectedVersion: initialVersion }; })()],
      ["missing expectedVersion", { ...DEFAULT_RETENTION_THRESHOLDS }],
      ["non-integer expectedVersion", { ...DEFAULT_RETENTION_THRESHOLDS, expectedVersion: 1.5 }],
      ["negative expectedVersion", { ...DEFAULT_RETENTION_THRESHOLDS, expectedVersion: -1 }],
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
    const baselineRes = await putSettings({ ...DEFAULT_RETENTION_THRESHOLDS, expectedVersion: initialVersion });
    assert.equal(baselineRes.status, 200);
    const baseline = (await baselineRes.json()) as any;
    assert.equal(baseline.version, initialVersion + 1, "versions increment sequentially");
    assert.equal(baseline.isDefault, false);
    assert.equal(baseline.changedByUserId, admin.id, "change records who made it");
    assert.equal(baseline.changedByName, "Retention Admin", "change resolves the admin's display name");
    assert.ok(baseline.changedAt, "change records when it was made");

    // The active-settings GET resolves the same name the history endpoint
    // shows, so the card can display "who last touched it" without history.
    const activeAfterBaseline = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    assert.equal(((await activeAfterBaseline.json()) as any).changedByName, "Retention Admin", "GET active settings resolves changedByName");
    console.log("✓ Valid update creates a new audited version");

    // ── 11c. Optimistic concurrency: stale expectedVersion → 409 ────────────
    // Simulates the second of two admins who both loaded the page at
    // initialVersion: the first save (baseline above) succeeded, so this save
    // based on the same stale version must be rejected — not silently applied.
    const staleRes = await putSettings({
      ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 7, expectedVersion: initialVersion,
    });
    assert.equal(staleRes.status, 409, "stale expectedVersion is rejected with 409");
    const staleBody = (await staleRes.json()) as any;
    assert.equal(staleBody.code, "VERSION_CONFLICT");
    assert.equal(staleBody.expectedVersion, initialVersion, "conflict echoes the client's version");
    assert.equal(staleBody.activeVersion, initialVersion + 1, "conflict reports the winning version");
    assert.equal(staleBody.changedByName, "Retention Admin", "conflict identifies the winning admin");
    assert.ok(staleBody.changedAt, "conflict reports when the winning version was saved");
    assert.equal(staleBody.changedAt, baseline.changedAt, "conflict reports the winning version timestamp");

    const afterStale = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    const afterStaleBody = (await afterStale.json()) as any;
    assert.equal(afterStaleBody.version, initialVersion + 1, "conflicting update records no version");
    assert.deepEqual(afterStaleBody.thresholds, DEFAULT_RETENTION_THRESHOLDS, "first admin's values survive the conflicting save");

    // A future expectedVersion is just as stale — only an exact match passes.
    const futureRes = await putSettings({
      ...DEFAULT_RETENTION_THRESHOLDS, expectedVersion: initialVersion + 99,
    });
    assert.equal(futureRes.status, 409, "non-matching (future) expectedVersion is rejected with 409");
    console.log("✓ Stale expectedVersion → 409 VERSION_CONFLICT, first write preserved");

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
    assert.deepEqual(identity.topAffectedSalons, [], "no affected salons for identical thresholds");
    assert.deepEqual(identity.topShareAffectedSalons, [], "no share-affected salons for identical thresholds");
    assert.equal(identity.shareRankingMinCustomers, 5, "preview reports the share-ranking customer floor");
    assert.ok(identity.totalCustomers >= 3, "platform-wide totals include the fixture customers");
    const sumCurrent = Object.values(identity.currentCounts as Record<string, number>)
      .reduce((s, n) => s + n, 0);
    assert.equal(sumCurrent, identity.totalCustomers, "every customer lands in exactly one status");

    // The share-ranking floor is operator-tunable like the other preview
    // guards. A valid override makes the 3-customer fixture salon eligible,
    // while an invalid value falls back to the safe default.
    try {
      process.env.RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS = "3";
      const overriddenFloorRes = await postPreview({
        ...DEFAULT_RETENTION_THRESHOLDS,
        vipMinCompletedVisits: 3,
      });
      assert.equal(overriddenFloorRes.status, 200);
      const overriddenFloor = (await overriddenFloorRes.json()) as any;
      assert.equal(overriddenFloor.shareRankingMinCustomers, 3, "preview reports the env-configured floor");
      assert.ok(
        (overriddenFloor.topShareAffectedSalons as any[]).some((s) => s.salonId === salon.id),
        "a 3-customer salon enters the share ranking when the floor is lowered to 3",
      );

      process.env.RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS = "0";
      const invalidFloorRes = await postPreview({
        ...DEFAULT_RETENTION_THRESHOLDS,
        vipMinCompletedVisits: 3,
      });
      assert.equal(invalidFloorRes.status, 200);
      const invalidFloor = (await invalidFloorRes.json()) as any;
      assert.equal(invalidFloor.shareRankingMinCustomers, 5, "invalid floor override uses the default");
      assert.ok(
        !(invalidFloor.topShareAffectedSalons as any[]).some((s) => s.salonId === salon.id),
        "invalid floor override does not loosen share-ranking eligibility",
      );
    } finally {
      delete process.env.RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS;
    }

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

    // Most-affected salons: the fixture salon must appear with its name and a
    // per-salon count, the list is capped at 10 and sorted largest-first, and
    // the per-salon counts never exceed the platform-wide reclassified total.
    const affected = previewBody.topAffectedSalons as any[];
    assert.ok(Array.isArray(affected) && affected.length >= 1, "preview reports affected salons");
    assert.ok(affected.length <= 10, "affected salons list is capped at 10");
    const fixtureSalon = affected.find((s) => s.salonId === salon.id);
    assert.ok(fixtureSalon, "the fixture salon appears among the most affected");
    assert.equal(fixtureSalon.salonName, salon.name, "affected salon carries its display name");
    assert.ok(fixtureSalon.reclassifiedCount >= 1, "fixture salon reports at least the moved customer");
    for (const s of affected) {
      assert.equal(typeof s.totalCustomers, "number", "each affected salon reports its total customers");
      assert.ok(
        s.totalCustomers >= s.reclassifiedCount,
        "a salon's total customers is never below its reclassified count",
      );
    }
    assert.ok(
      fixtureSalon.totalCustomers >= 3,
      "fixture salon's total covers all three fixture customers",
    );
    for (let i = 1; i < affected.length; i++) {
      assert.ok(
        affected[i - 1].reclassifiedCount >= affected[i].reclassifiedCount,
        "affected salons are sorted largest-first",
      );
    }
    const affectedSum = affected.reduce((s: number, x: any) => s + x.reclassifiedCount, 0);
    assert.ok(affectedSum <= previewBody.reclassifiedCount, "per-salon counts stay within the total");

    // Share-based ranking: every entry respects the minimum-customer floor
    // and the list is sorted by share, largest first. The fixture salon has
    // exactly 3 customers — below the floor of 5 — so despite its high share
    // it must appear ONLY in the count ranking above, never in the share one.
    const shareAffected = previewBody.topShareAffectedSalons as any[];
    assert.ok(Array.isArray(shareAffected), "preview reports a share-based ranking");
    assert.ok(shareAffected.length <= 10, "share ranking is capped at 10");
    for (const s of shareAffected) {
      assert.ok(
        s.totalCustomers >= previewBody.shareRankingMinCustomers,
        "share ranking only includes salons at or above the customer floor",
      );
      assert.ok(
        s.reclassifiedCount >= 1 && s.reclassifiedCount <= s.totalCustomers,
        "share entries carry consistent per-salon counts",
      );
    }
    for (let i = 1; i < shareAffected.length; i++) {
      const prev = shareAffected[i - 1];
      const cur = shareAffected[i];
      assert.ok(
        prev.reclassifiedCount / prev.totalCustomers >=
          cur.reclassifiedCount / cur.totalCustomers - 1e-9,
        "share ranking is sorted by share, largest first",
      );
    }
    assert.ok(
      !shareAffected.some((s) => s.salonId === salon.id),
      "a 3-customer salon stays below the share-ranking floor",
    );
    console.log("✓ Share ranking respects the minimum-customer floor and share order");


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

    // ── 11c. Preview guards: sampled fallback above the cap + time budget ───
    try {
      // Baseline exact preview: below the cap the counts are exact and carry
      // no estimate flag. Its totalCustomers pins the platform size for the
      // boundary assertions below.
      const exactBaseline = (await (await postPreview(DEFAULT_RETENTION_THRESHOLDS)).json()) as any;
      assert.equal(exactBaseline.isEstimate, false, "below the cap the preview stays exact");
      assert.equal(exactBaseline.sampleSize, null, "exact mode reports no sample size");
      assert.equal(
        exactBaseline.reclassifiedCountMarginOfError,
        null,
        "exact mode reports no margin of error",
      );
      assert.equal(
        exactBaseline.currentCountMarginsOfError,
        null,
        "exact mode reports no current-status margins",
      );
      assert.equal(
        exactBaseline.candidateCountMarginsOfError,
        null,
        "exact mode reports no candidate-status margins",
      );
      const platformCustomers = exactBaseline.totalCustomers as number;
      assert.ok(platformCustomers >= 3, "fixtures guarantee at least 3 customers");

      // Boundary: cap == platform size → still exact (the cap is inclusive).
      process.env.RETENTION_PREVIEW_MAX_CUSTOMERS = String(platformCustomers);
      const atCapRes = await postPreview(DEFAULT_RETENTION_THRESHOLDS);
      assert.equal(atCapRes.status, 200);
      const atCap = (await atCapRes.json()) as any;
      assert.equal(atCap.isEstimate, false, "exact mode holds up to and including the cap");
      assert.equal(atCap.totalCustomers, platformCustomers);

      // One over the cap → the preview no longer refuses: it answers with a
      // sampled estimate, clearly flagged. Identity thresholds keep the
      // assertion deterministic regardless of WHICH customers were sampled:
      // nothing can shift, so the estimated reclassified count must be 0.
      process.env.RETENTION_PREVIEW_MAX_CUSTOMERS = String(platformCustomers - 1);
      const overCapRes = await postPreview(DEFAULT_RETENTION_THRESHOLDS);
      assert.equal(overCapRes.status, 200, "over-cap preview answers a sampled estimate, not a 503");
      const overCap = (await overCapRes.json()) as any;
      assert.equal(overCap.isEstimate, true, "over-cap preview is flagged as an estimate");
      assert.ok(
        Number.isInteger(overCap.sampleSize) && overCap.sampleSize >= 1 && overCap.sampleSize <= platformCustomers - 1,
        "estimate reports how many customers were actually classified (at most the cap)",
      );
      assert.equal(overCap.totalCustomers, platformCustomers, "estimate reports the true platform size");
      assert.ok(
        Number.isInteger(overCap.reclassifiedCountMarginOfError) &&
          overCap.reclassifiedCountMarginOfError >= 0,
        "estimate reports a non-negative integer margin of error",
      );
      for (const status of Object.keys(overCap.currentCounts as Record<string, number>)) {
        assert.ok(
          Number.isInteger(overCap.currentCountMarginsOfError?.[status]) &&
            overCap.currentCountMarginsOfError[status] >= 0,
          `estimate reports a current ${status} margin`,
        );
        assert.ok(
          Number.isInteger(overCap.candidateCountMarginsOfError?.[status]) &&
            overCap.candidateCountMarginsOfError[status] >= 0,
          `estimate reports a candidate ${status} margin`,
        );
      }
      assert.equal(overCap.reclassifiedCount, 0, "identity thresholds reclassify nobody, even sampled");
      assert.deepEqual(overCap.shifts, [], "no shifts under identity thresholds");
      assert.deepEqual(overCap.topAffectedSalons, [], "per-salon breakdown is never extrapolated");
      assert.equal(
        overCap.salonRankingAvailable,
        false,
        "the default uniform sample explicitly withholds salon rankings",
      );
      // Extrapolated status counts cover approximately the whole platform
      // (rounding each of the 5 statuses independently drifts by < 0.5 each).
      const overCapSum = Object.values(overCap.currentCounts as Record<string, number>)
        .reduce((s, n) => s + n, 0);
      assert.ok(
        Math.abs(overCapSum - platformCustomers) <= 3,
        `extrapolated counts cover the platform (got ${overCapSum} of ${platformCustomers})`,
      );

      // Tiny cap (1) with a reclassifying candidate: the smallest possible
      // sample still produces an internally consistent, clearly-flagged
      // estimate — shifts sum to the reclassified total, and the sample is
      // clamped to the cap so estimate mode is never costlier than exact.
      process.env.RETENTION_PREVIEW_MAX_CUSTOMERS = "1";
      process.env.RETENTION_PREVIEW_SAMPLE_SIZE = "50";
      const tinyRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 3 });
      assert.equal(tinyRes.status, 200, "even a cap of 1 yields an estimate instead of a refusal");
      const tiny = (await tinyRes.json()) as any;
      assert.equal(tiny.isEstimate, true);
      assert.equal(tiny.sampleSize, 1, "sample is clamped to the exact-mode cap");
      assert.equal(tiny.totalCustomers, platformCustomers);
      const tinyShiftSum = (tiny.shifts as any[]).reduce((s: number, x: any) => s + x.count, 0);
      assert.equal(tinyShiftSum, tiny.reclassifiedCount, "estimated shifts add up to the estimated total");
      for (const status of Object.keys(tiny.currentCounts as Record<string, number>)) {
        const sampledCurrentCount = tiny.currentCounts[status] === platformCustomers ? 1 : 0;
        const sampledCandidateCount = tiny.candidateCounts[status] === platformCustomers ? 1 : 0;
        assert.equal(
          tiny.currentCountMarginsOfError[status],
          calculateEstimatedCountMarginOfError(sampledCurrentCount, 1, platformCustomers),
          `current ${status} margin uses the shared Wilson methodology`,
        );
        assert.equal(
          tiny.candidateCountMarginsOfError[status],
          calculateEstimatedCountMarginOfError(sampledCandidateCount, 1, platformCustomers),
          `candidate ${status} margin uses the shared Wilson methodology`,
        );
      }
      delete process.env.RETENTION_PREVIEW_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_MAX_CUSTOMERS;
      console.log("✓ Over-cap preview falls back to a clearly-flagged sampled estimate (boundary inclusive)");

      // 1 ms budget: the settings + count queries alone exceed it, so the
      // time guard must abort during setup, before any batch is loaded.
      process.env.RETENTION_PREVIEW_TIME_BUDGET_MS = "1";
      const timedOutRes = await postPreview(DEFAULT_RETENTION_THRESHOLDS);
      assert.equal(timedOutRes.status, 503, "over-budget preview returns 503");
      const timedOut = (await timedOutRes.json()) as any;
      assert.equal(timedOut.code, "PREVIEW_TIMEOUT");
      assert.ok(
        typeof timedOut.error === "string" && timedOut.error.length > 0,
        "time guard carries a friendly message",
      );
      delete process.env.RETENTION_PREVIEW_TIME_BUDGET_MS;

      // Single/final batch overrun: a fault-injected delay at the END of each
      // classification batch (honored only under NODE_ENV=test) guarantees
      // the batch finishes after the deadline, deterministically. The budget
      // (1.5 s) comfortably survives setup, so the ONLY way this can 503 is
      // the deadline check that runs AFTER a batch's work — the platform
      // currently fits in one batch, i.e. this is the sole/final batch.
      process.env.RETENTION_PREVIEW_TIME_BUDGET_MS = "1500";
      process.env.LUMERA_TEST_RETENTION_PREVIEW_BATCH_DELAY_MS = "2000";
      const finalBatchRes = await postPreview(DEFAULT_RETENTION_THRESHOLDS);
      assert.equal(finalBatchRes.status, 503, "final-batch overrun returns 503, not a stale 200");
      const finalBatch = (await finalBatchRes.json()) as any;
      assert.equal(finalBatch.code, "PREVIEW_TIMEOUT", "post-batch deadline check reports a timeout");
      assert.ok(
        typeof finalBatch.error === "string" && finalBatch.error.length > 0,
        "final-batch guard carries a friendly message",
      );
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_BATCH_DELAY_MS;

      // Database-side cancellation on the REAL request path: a pg_sleep is
      // injected at an exact labelled step inside that step's transaction, so
      // it outlives the budget-derived statement_timeout and PostgreSQL must
      // cancel it — the endpoint answers a friendly 503 instead of stalling.
      process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS = "60000";
      const slowSteps: [string, unknown][] = [
        // Setup path: the active-settings read and the platform-wide count.
        ["active-settings", DEFAULT_RETENTION_THRESHOLDS],
        ["customer-count", DEFAULT_RETENTION_THRESHOLDS],
        // Finalize path: the affected-salon-name lookup — the candidate must
        // reclassify fixture customers so the preview actually reaches it.
        ["salon-names", { ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 3 }],
      ];
      process.env.RETENTION_PREVIEW_TIME_BUDGET_MS = "2000";
      for (const [step, candidate] of slowSteps) {
        process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_AT = step;
        const slowRes = await postPreview(candidate);
        assert.equal(slowRes.status, 503, `blocked ${step} query is cancelled, not stalled`);
        assert.equal(((await slowRes.json()) as any).code, "PREVIEW_TIMEOUT");
      }
    } finally {
      delete process.env.RETENTION_PREVIEW_MAX_CUSTOMERS;
      delete process.env.RETENTION_PREVIEW_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_TIME_BUDGET_MS;
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_BATCH_DELAY_MS;
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_AT;
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS;
    }

    // Guards and estimates are strictly read-only: no settings row recorded,
    // and the preview is exact again once the limits are back to defaults.
    const afterGuardsRes = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    assert.equal(((await afterGuardsRes.json()) as any).version, initialVersion + 1, "guard trips record no settings version");
    const recoveredRes = await postPreview(DEFAULT_RETENTION_THRESHOLDS);
    assert.equal(recoveredRes.status, 200, "preview recovers once guards are lifted");
    const recovered = (await recoveredRes.json()) as any;
    assert.equal(recovered.isEstimate, false, "default limits restore exact mode");
    assert.equal(recovered.sampleSize, null, "exact mode reports no sample size");
      assert.equal(recovered.salonRankingAvailable, true, "exact previews support salon rankings");
    console.log("✓ Preview guards: sampled fallback, setup/step cancellation, final-batch overrun → then exact recovery");

    // ── 11d. Preview building blocks ────────────────────────────────────────
    // Database-side cancellation: a query slower than the remaining budget is
    // killed by PostgreSQL (statement_timeout) and surfaces as the SAME
    // friendly overload error — a slow query can never hold the request.
    await assert.rejects(
      () => withPreviewStatementTimeout(50, (tx) => tx.execute(sql`select pg_sleep(0.5)`)),
      (err: unknown) => {
        assert.ok(err instanceof RetentionPreviewOverloadError, "statement timeout maps to overload error");
        assert.equal(err.code, "PREVIEW_TIMEOUT");
        return true;
      },
    );
    // And a fast query inside the same wrapper still succeeds.
    await withPreviewStatementTimeout(5_000, (tx) => tx.execute(sql`select 1`));

    // Median parity: the preview aggregates salon medians database-side with
    // percentile_cont(0.5); it must agree EXACTLY with computeSalonMedianSpend
    // (the CRM endpoints' median) for odd and even price counts.
    const priceSets = [
      [3000],
      [1000, 2000],
      [1000, 2000, 4000],
      [500, 1000, 2000, 10000],
      [1500, 1500, 3000, 4500, 9000, 12000],
    ];
    for (const prices of priceSets) {
      const arrayLiteral = `ARRAY[${prices.join(",")}]::double precision[]`;
      const res: any = await db.execute(
        sql`select percentile_cont(0.5) within group (order by p) as m from unnest(${sql.raw(arrayLiteral)}) as p`,
      );
      const row = (res.rows ?? res)[0];
      assert.equal(
        Number(row.m),
        computeSalonMedianSpend(prices),
        `percentile_cont matches computeSalonMedianSpend for [${prices.join(", ")}]`,
      );
    }
    console.log("✓ Statement-timeout cancellation + SQL median parity with CRM endpoints");

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

    const v2Res = await putSettings({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 3, expectedVersion: initialVersion + 1 });
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
      expectedVersion: initialVersion + 2,
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

    const v4Res = await putSettings({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 100, expectedVersion: initialVersion + 3 });
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

    // ── 16. Volume benchmark: batched preview stays fast at realistic scale ─
    // 30 extra salons × 400 customers (12,000 customers) with 2 appointments
    // each (24,000 rows), plus 10 deep-history customers with 300 completed
    // visits each (3,000 more rows) so one batch carries a heavy appointment
    // load. The preview classifies customers in keyset batches of 1,000, so
    // this exercises 12+ batches end-to-end — including the high-history
    // case the guards must survive — and measures the actual response time
    // against the bound considered acceptable for the admin UI.
    const PERF_SALONS = 30;
    const PERF_CUSTOMERS_PER_SALON = 400;
    const PERF_RESPONSE_BOUND_MS = 5_000;

    const [perfOwner] = await db.insert(usersTable).values({
      firstName: "Perf", lastName: suffix,
      email: `perf-owner-${suffix}@rts.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
    }).returning();
    assert.ok(perfOwner);
    createdUserIds.push(perfOwner.id);

    const perfSalonRows = Array.from({ length: PERF_SALONS }, (_, s) => ({
      ownerId: perfOwner.id,
      name: `Perf Salon ${s} ${suffix}`,
      slug: `perf-salon-${s}-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: `Perf ${s}`, postalCode: "11000",
      phone: `+38160${String(1000000 + s).slice(-7)}`,
      email: `perf-salon-${s}-${suffix}@rts.test`,
      shortDescription: "Perf", description: "Perf salon", imageUrl: "/t.jpg",
    }));
    const perfSalons = await db.insert(salonsTable).values(perfSalonRows).returning({ id: salonsTable.id });
    assert.equal(perfSalons.length, PERF_SALONS);
    for (const s of perfSalons) createdSalonIds.push(s.id);

    const perfServices = await db.insert(servicesTable).values(perfSalons.map((s, i) => ({
      salonId: s.id, categoryName: "Hair", name: `Perf Svc ${i} ${suffix}`, description: "Perf",
      durationMinutes: 60, price: 2000, imageUrl: "/t.jpg", active: true,
    }))).returning({ id: servicesTable.id, salonId: servicesTable.salonId });
    const serviceBySalon = new Map(perfServices.map((s) => [s.salonId, s.id]));

    const customerRows = perfSalons.flatMap((s, si) =>
      Array.from({ length: PERF_CUSTOMERS_PER_SALON }, (_, ci) => ({
        salonId: s.id,
        firstName: `Perf${si}`,
        lastName: `Kupac${ci}`,
        email: `perf-${si}-${ci}-${suffix}@rts.test`,
        phone: null,
      })),
    );
    const insertedCustomers: { id: string; salonId: string }[] = [];
    for (let i = 0; i < customerRows.length; i += 1000) {
      const chunk = await db.insert(salonCustomersTable).values(customerRows.slice(i, i + 1000))
        .returning({ id: salonCustomersTable.id, salonId: salonCustomersTable.salonId });
      insertedCustomers.push(...chunk);
    }
    assert.equal(insertedCustomers.length, PERF_SALONS * PERF_CUSTOMERS_PER_SALON);

    // Two visits per customer with spread-out recency so every status bucket
    // is populated (NEW through LOST) and medians differ per salon.
    const appointmentRows = insertedCustomers.flatMap((c, i) => {
      const lastVisitDaysAgo = (i % 360) + 1;
      return [
        { daysAgo: lastVisitDaysAgo + 40, price: 1000 + (i % 7) * 500 },
        { daysAgo: lastVisitDaysAgo, price: 1000 + (i % 5) * 700 },
      ].map((v) => ({
        salonId: c.salonId,
        salonCustomerId: c.id,
        serviceId: serviceBySalon.get(c.salonId)!,
        date: isoDaysAgo(v.daysAgo),
        startTime: "10:00", endTime: "11:00", durationMinutes: 60,
        status: "completed" as const,
        price: v.price,
        treatmentLocation: "salon" as const,
      }));
    });
    for (let i = 0; i < appointmentRows.length; i += 1000) {
      await db.insert(appointmentsTable).values(appointmentRows.slice(i, i + 1000));
    }

    // Deep-history customers: 10 customers in the first perf salon with 300
    // completed visits each. Bounds are per customer batch, so a batch whose
    // customers carry thousands of appointment rows must still classify
    // correctly and inside the time budget.
    const DEEP_CUSTOMERS = 10;
    const DEEP_VISITS_EACH = 300;
    const firstPerfSalon = perfSalons[0]!;
    const deepCustomers = await db.insert(salonCustomersTable).values(
      Array.from({ length: DEEP_CUSTOMERS }, (_, i) => ({
        salonId: firstPerfSalon.id,
        firstName: "Deep",
        lastName: `Istorija${i}`,
        email: `perf-deep-${i}-${suffix}@rts.test`,
        phone: null,
      })),
    ).returning({ id: salonCustomersTable.id, salonId: salonCustomersTable.salonId });
    const deepAppointmentRows = deepCustomers.flatMap((c) =>
      Array.from({ length: DEEP_VISITS_EACH }, (_, v) => ({
        salonId: c.salonId,
        salonCustomerId: c.id,
        serviceId: serviceBySalon.get(c.salonId)!,
        date: isoDaysAgo(v + 1),
        startTime: "10:00", endTime: "11:00", durationMinutes: 60,
        status: "completed" as const,
        price: 2000,
        treatmentLocation: "salon" as const,
      })),
    );
    for (let i = 0; i < deepAppointmentRows.length; i += 1000) {
      await db.insert(appointmentsTable).values(deepAppointmentRows.slice(i, i + 1000));
    }

    // Small-salon share fixtures: a 5-customer salon where EVERY customer
    // flips under the candidate (100% share — hardest hit, but far too small
    // for the count top-10 on a platform this size), and a 1-customer salon
    // that also flips 100% but sits below the share floor of 5. Customers get
    // 2 completed visits (40 and 10 days ago, 2000 din each): under the
    // active thresholds (vipMinCompletedVisits=100) they are ACTIVE — spend
    // 4000 does NOT exceed 2× the salon median of 2000 (strictly-greater) —
    // and under the candidate (vipMinCompletedVisits=2) they all become VIP.
    const [shareSalonRow, floorSalonRow] = await db.insert(salonsTable).values([
      {
        ownerId: perfOwner.id, name: `Share Salon ${suffix}`, slug: `share-salon-${suffix}`,
        city: "Beograd", municipality: "Vračar", address: "Share 1", postalCode: "11000",
        phone: "+381609990001", email: `share-salon-${suffix}@rts.test`,
        shortDescription: "Share", description: "Share salon", imageUrl: "/t.jpg",
      },
      {
        ownerId: perfOwner.id, name: `Floor Salon ${suffix}`, slug: `floor-salon-${suffix}`,
        city: "Beograd", municipality: "Vračar", address: "Floor 1", postalCode: "11000",
        phone: "+381609990002", email: `floor-salon-${suffix}@rts.test`,
        shortDescription: "Floor", description: "Floor salon", imageUrl: "/t.jpg",
      },
    ]).returning({ id: salonsTable.id, name: salonsTable.name });
    assert.ok(shareSalonRow && floorSalonRow);
    createdSalonIds.push(shareSalonRow.id, floorSalonRow.id);
    const smallServices = await db.insert(servicesTable).values(
      [shareSalonRow.id, floorSalonRow.id].map((salonId, i) => ({
        salonId, categoryName: "Hair", name: `Small Svc ${i} ${suffix}`, description: "Small",
        durationMinutes: 60, price: 2000, imageUrl: "/t.jpg", active: true,
      })),
    ).returning({ id: servicesTable.id, salonId: servicesTable.salonId });
    const smallServiceBySalon = new Map(smallServices.map((s) => [s.salonId, s.id]));
    const smallCustomers = await db.insert(salonCustomersTable).values([
      ...Array.from({ length: 5 }, (_, i) => ({
        salonId: shareSalonRow.id, firstName: "Udeo", lastName: `Kupac${i}`,
        email: `share-cust-${i}-${suffix}@rts.test`, phone: null,
      })),
      {
        salonId: floorSalonRow.id, firstName: "Prag", lastName: "Kupac",
        email: `floor-cust-${suffix}@rts.test`, phone: null,
      },
    ]).returning({ id: salonCustomersTable.id, salonId: salonCustomersTable.salonId });
    await db.insert(appointmentsTable).values(
      smallCustomers.flatMap((c) =>
        [40, 10].map((daysAgo) => ({
          salonId: c.salonId,
          salonCustomerId: c.id,
          serviceId: smallServiceBySalon.get(c.salonId)!,
          date: isoDaysAgo(daysAgo),
          startTime: "10:00", endTime: "11:00", durationMinutes: 60,
          status: "completed" as const,
          price: 2000,
          treatmentLocation: "salon" as const,
        })),
      ),
    );

    const perfStartedAt = Date.now();
    const perfRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
    const perfElapsedMs = Date.now() - perfStartedAt;
    assert.equal(perfRes.status, 200, "volume preview succeeds under default guards");
    const perf = (await perfRes.json()) as any;
    assert.ok(
      perf.totalCustomers >= PERF_SALONS * PERF_CUSTOMERS_PER_SALON,
      "volume preview classifies every seeded customer",
    );
    const perfSum = Object.values(perf.currentCounts as Record<string, number>)
      .reduce((s: number, n) => s + (n as number), 0);
    assert.equal(perfSum, perf.totalCustomers, "batched counts still cover every customer exactly once");
    assert.ok(perf.reclassifiedCount >= 1, "lowering the VIP visit floor moves seeded repeat customers");
    assert.ok(
      perfElapsedMs <= PERF_RESPONSE_BOUND_MS,
      `preview over ${perf.totalCustomers} customers answered in ${perfElapsedMs} ms (bound ${PERF_RESPONSE_BOUND_MS} ms)`,
    );
    console.log(
      `✓ Volume benchmark: ${perf.totalCustomers} customers previewed in ${perfElapsedMs} ms (bound ${PERF_RESPONSE_BOUND_MS} ms)`,
    );

    // ── 16a. Oversized-platform estimate: sampled fallback stays fast ───────
    // Force estimate mode over the full seeded volume (cap far below the real
    // row count, sample of 1,000). The preview must answer a flagged estimate
    // within the same response-time bound — proving the sampling path
    // (TABLESAMPLE page sampling + sampled-salon-only medians) does no
    // platform-sized work — and its extrapolated counts must land within a
    // generous sampling-error corridor of the exact run above.
    try {
      process.env.RETENTION_PREVIEW_MAX_CUSTOMERS = "2000";
      process.env.RETENTION_PREVIEW_SAMPLE_SIZE = "1000";
      process.env.RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS = "3";
      const estStartedAt = Date.now();
      const estRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      const estElapsedMs = Date.now() - estStartedAt;
      assert.equal(estRes.status, 200, "oversized platform still gets a preview (estimate mode)");
      const est = (await estRes.json()) as any;
      assert.equal(est.isEstimate, true, "over-cap volume preview is a flagged estimate");
      assert.equal(est.sampleSize, 1000, "sample honors the configured size");
      assert.equal(est.totalCustomers, perf.totalCustomers, "estimate reports the true platform size");
      assert.equal(
        est.shareRankingMinCustomers,
        3,
        "estimate reports the env-configured share-ranking floor",
      );
      assert.ok(
        Number.isInteger(est.reclassifiedCountMarginOfError) &&
          est.reclassifiedCountMarginOfError >= 0,
        "volume estimate reports a non-negative integer margin of error",
      );
      for (const status of Object.keys(est.currentCounts as Record<string, number>)) {
        assert.ok(
          Number.isInteger(est.currentCountMarginsOfError?.[status]) &&
            est.currentCountMarginsOfError[status] >= 0,
          `volume estimate reports a current ${status} margin`,
        );
        assert.ok(
          Number.isInteger(est.candidateCountMarginsOfError?.[status]) &&
            est.candidateCountMarginsOfError[status] >= 0,
          `volume estimate reports a candidate ${status} margin`,
        );
      }
      assert.ok(
        estElapsedMs <= PERF_RESPONSE_BOUND_MS,
        `estimate over ${est.totalCustomers} customers answered in ${estElapsedMs} ms (bound ${PERF_RESPONSE_BOUND_MS} ms)`,
      );
      // Sampling corridor vs. the exact run. The production method deliberately
      // starts with PostgreSQL TABLESAMPLE SYSTEM, whose page-level clusters
      // can differ materially from a simple independent 1,000-row sample.
      // A 10% total-platform bound rejected legitimate runs (for example,
      // 4,377 estimated vs. 5,941 exact). Keep this deterministic 20% bound
      // for the fixed 1,000-row fixture: it covers the configured clustered
      // sampling method while still catching a materially broken extrapolation
      // such as returning unscaled sample counts.
      const corridor = Math.round(perf.totalCustomers * 0.2) + 50;
      for (const status of Object.keys(perf.currentCounts as Record<string, number>)) {
        assert.ok(
          Math.abs(est.currentCounts[status] - perf.currentCounts[status]) <= corridor,
          `estimated current ${status} within corridor (est ${est.currentCounts[status]}, exact ${perf.currentCounts[status]})`,
        );
        assert.ok(
          Math.abs(est.candidateCounts[status] - perf.candidateCounts[status]) <= corridor,
          `estimated candidate ${status} within corridor (est ${est.candidateCounts[status]}, exact ${perf.candidateCounts[status]})`,
        );
      }
      const estShiftSum = (est.shifts as any[]).reduce((s: number, x: any) => s + x.count, 0);
      assert.equal(estShiftSum, est.reclassifiedCount, "estimated shifts add up to the estimated total");
      assert.deepEqual(est.topAffectedSalons, [], "per-salon breakdown stays empty in estimate mode");
      assert.deepEqual(est.topShareAffectedSalons, [], "share ranking stays empty in estimate mode");
      assert.equal(
        est.salonRankingAvailable,
        false,
        "a platform-wide sample never claims it can rank individual salons",
      );
      for (const counts of [est.currentCounts, est.candidateCounts]) {
        const countSum = Object.values(counts as Record<string, number>)
          .reduce((s: number, n) => s + (n as number), 0);
        assert.ok(
          Math.abs(countSum - est.totalCustomers) <= 3,
          `estimated status counts cover the platform (got ${countSum} of ${est.totalCustomers})`,
        );
      }
      console.log(
        `✓ Oversized-platform estimate: 1,000-row sample previewed ${est.totalCustomers} customers in ${estElapsedMs} ms`,
      );

      // Opt-in stratified sampling draws a separate random sample within every
      // salon, so rankings are safe to restore with a per-salon confidence
      // margin. The combined strata stay within the explicitly configured
      // sample budget, and
      // each 400-customer salon receives 30 observations — at the 30-row
      // minimum. Small salons are censused, so their margin is null.
      process.env.RETENTION_PREVIEW_SAMPLE_SIZE = "20000";
      process.env.RETENTION_PREVIEW_SALON_SAMPLE_SIZE = "30";
      process.env.RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE = "30";
      process.env.RETENTION_PREVIEW_SALON_MAX_STRATA = "1000";
      const stratifiedRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      assert.equal(stratifiedRes.status, 200, "stratified estimate succeeds");
      const stratified = (await stratifiedRes.json()) as any;
      assert.equal(stratified.isEstimate, true);
      assert.equal(stratified.salonRankingAvailable, true, "validated strata unlock salon rankings");
      assert.ok(stratified.topAffectedSalons.length > 0, "stratified estimate returns a count ranking");
      for (const affectedSalon of stratified.topAffectedSalons as any[]) {
        assert.ok(
          affectedSalon.sampleSize >= 1 && affectedSalon.sampleSize <= 30,
          "each estimated salon reports its actual within-salon sample size",
        );
        assert.equal(
          affectedSalon.reclassifiedCountMarginOfError === null ||
            Number.isInteger(affectedSalon.reclassifiedCountMarginOfError),
          true,
          "each estimated salon exposes a confidence indicator (number or null for a census)",
        );
        assert.ok(
          affectedSalon.reclassifiedCount >= 0 &&
            affectedSalon.reclassifiedCount <= affectedSalon.totalCustomers,
          "estimated salon changes stay within its known population",
        );
      }
      const stratifiedShareSalon = (stratified.topShareAffectedSalons as any[]).find(
        (entry) => entry.salonId === shareSalonRow.id,
      );
      assert.ok(stratifiedShareSalon, "the fully sampled small salon is eligible for the share ranking");
      assert.equal(stratifiedShareSalon.sampleSize, 5, "small salons are fully sampled");
      assert.equal(
        stratifiedShareSalon.reclassifiedCountMarginOfError,
        null,
        "a full-salon census has no sampling uncertainty",
      );

      // The optional random-order query receives only a fraction of the
      // deadline. If it cannot finish, the preview must preserve enough time
      // for the bounded uniform estimate rather than returning an error or
      // exposing partial salon rankings.
      process.env.RETENTION_PREVIEW_TIME_BUDGET_MS = "3000";
      process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_AT = "salon-stratified-sample";
      process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS = "60000";
      const timedOutStrataRes = await postPreview({
        ...DEFAULT_RETENTION_THRESHOLDS,
        vipMinCompletedVisits: 2,
      });
      assert.equal(timedOutStrataRes.status, 200, "a slow optional strata query falls back to an estimate");
      const timedOutStrata = (await timedOutStrataRes.json()) as any;
      assert.equal(timedOutStrata.isEstimate, true);
      assert.equal(timedOutStrata.salonRankingAvailable, false, "timed-out strata keep rankings hidden");
      assert.deepEqual(timedOutStrata.topAffectedSalons, [], "timed-out strata return no partial ranking");
      delete process.env.RETENTION_PREVIEW_TIME_BUDGET_MS;
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_AT;
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS;

      // An opt-in request with too few observations per large salon must fail
      // closed: retain the useful platform estimate but never rank noisy salon
      // slices merely because the flag was present.
      process.env.RETENTION_PREVIEW_SALON_SAMPLE_SIZE = "10";
      process.env.RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE = "1";
      const underpoweredRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      assert.equal(underpoweredRes.status, 200, "underpowered strata still return the aggregate estimate");
      const underpowered = (await underpoweredRes.json()) as any;
      assert.equal(underpowered.salonRankingAvailable, false, "underpowered strata keep rankings unavailable");
      assert.deepEqual(underpowered.topAffectedSalons, [], "underpowered strata return no count ranking");
      assert.deepEqual(underpowered.topShareAffectedSalons, [], "underpowered strata return no share ranking");
      assert.equal(
        retentionPreviewGuardLimits().salonMinSampleSize,
        30,
        "operators cannot lower the statistical precision floor",
      );
      delete process.env.RETENTION_PREVIEW_SALON_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_SALON_MAX_STRATA;

      // Regression: an under-delivering page sample must NEVER widen the
      // scan. Force a tiny sampling percentage (test-only hook): the preview
      // keeps the smaller sample, reports its true size, and still
      // extrapolates to the real platform total — it never falls back to a
      // full-table read to "fill up" the target.
      process.env.LUMERA_TEST_RETENTION_PREVIEW_SAMPLE_PCT = "2.5";
      const underRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      assert.equal(underRes.status, 200, "under-delivering sample still answers an estimate");
      const under = (await underRes.json()) as any;
      assert.equal(under.isEstimate, true);
      assert.ok(
        under.sampleSize >= 1 && under.sampleSize < 1000,
        `forced 2.5% page sample stays below the 1,000 target (got ${under.sampleSize})`,
      );
      assert.ok(
        under.sampleSize < Math.floor(perf.totalCustomers / 4),
        `no full-table fallback occurred (classified ${under.sampleSize} of ${perf.totalCustomers})`,
      );
      assert.equal(under.totalCustomers, perf.totalCustomers, "small sample still reports the true platform size");
      const underSum = Object.values(under.currentCounts as Record<string, number>)
        .reduce((s: number, n) => s + (n as number), 0);
      assert.ok(
        Math.abs(underSum - perf.totalCustomers) <= 10,
        `truthful extrapolation from the smaller sample (counts sum ${underSum} vs ${perf.totalCustomers})`,
      );

      // Forced EMPTY sample (0%): refuse under the friendly overload
      // contract instead of widening the scan or returning all-zero
      // "estimates".
      process.env.LUMERA_TEST_RETENTION_PREVIEW_SAMPLE_PCT = "0";
      const emptyRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      assert.equal(emptyRes.status, 503, "an unobtainable sample refuses honestly");
      assert.equal(((await emptyRes.json()) as any).code, "PREVIEW_TOO_LARGE");
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_SAMPLE_PCT;
      console.log("✓ Under-delivering page sample: truthful smaller estimate, never a widened scan; empty sample refuses");
    } finally {
      delete process.env.RETENTION_PREVIEW_MAX_CUSTOMERS;
      delete process.env.RETENTION_PREVIEW_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS;
      delete process.env.RETENTION_PREVIEW_SALON_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE;
      delete process.env.RETENTION_PREVIEW_SALON_MAX_STRATA;
      delete process.env.LUMERA_TEST_RETENTION_PREVIEW_SAMPLE_PCT;
    }

    // ── 16a. Share ranking surfaces the hardest-hit small salon at volume ───
    // The 5-customer salon flips 100% of its clientele, so it must appear in
    // the share ranking even though its absolute count (5) is nowhere near
    // the count top-10 (perf salons flip dozens of customers each). The
    // 1-customer salon also flips 100% but sits below the floor of 5, so the
    // share ranking must exclude it.
    const perfShare = perf.topShareAffectedSalons as any[];
    assert.ok(perfShare.length >= 1, "volume preview reports share-affected salons");
    for (const s of perfShare) {
      assert.ok(
        s.totalCustomers >= perf.shareRankingMinCustomers,
        "share entries respect the customer floor at volume",
      );
    }
    for (let i = 1; i < perfShare.length; i++) {
      const prev = perfShare[i - 1];
      const cur = perfShare[i];
      assert.ok(
        prev.reclassifiedCount / prev.totalCustomers >=
          cur.reclassifiedCount / cur.totalCustomers - 1e-9,
        "volume share ranking is sorted by share, largest first",
      );
    }
    const shareEntry = perfShare.find((s) => s.salonId === shareSalonRow.id);
    assert.ok(shareEntry, "the fully-flipped 5-customer salon makes the share ranking");
    assert.equal(shareEntry.reclassifiedCount, 5, "all 5 small-salon customers flip");
    assert.equal(shareEntry.totalCustomers, 5, "small salon reports its full clientele");
    assert.equal(shareEntry.salonName, shareSalonRow.name, "share entry carries the salon name");
    assert.ok(
      !(perf.topAffectedSalons as any[]).some((s) => s.salonId === shareSalonRow.id),
      "the same salon never reaches the count top-10 on a platform this size",
    );
    assert.ok(
      !perfShare.some((s) => s.salonId === floorSalonRow.id),
      "a 1-of-1 salon stays below the share floor even at 100%",
    );
    console.log("✓ Share ranking surfaces the hardest-hit small salon that the count top-10 misses");

    // ── 16b. Deep-history stress: appointment row budget bounds memory ──────
    // Force a tiny appointment row budget (350 rows) so each 300-visit deep
    // customer nearly fills a sub-chunk alone — every keyset page splits into
    // many sub-chunks. The preview must still succeed and produce identical
    // classification results, proving sub-chunking changes memory shape only,
    // never semantics.
    try {
      process.env.RETENTION_PREVIEW_APPOINTMENT_ROW_BUDGET = "350";
      const chunkedStartedAt = Date.now();
      const chunkedRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      const chunkedElapsedMs = Date.now() - chunkedStartedAt;
      assert.equal(chunkedRes.status, 200, "preview succeeds with a tiny appointment row budget");
      const chunked = (await chunkedRes.json()) as any;
      assert.deepEqual(
        {
          totalCustomers: chunked.totalCustomers,
          reclassifiedCount: chunked.reclassifiedCount,
          currentCounts: chunked.currentCounts,
          candidateCounts: chunked.candidateCounts,
          shifts: chunked.shifts,
          topAffectedSalons: chunked.topAffectedSalons,
          topShareAffectedSalons: chunked.topShareAffectedSalons,
          shareRankingMinCustomers: chunked.shareRankingMinCustomers,
        },
        {
          totalCustomers: perf.totalCustomers,
          reclassifiedCount: perf.reclassifiedCount,
          currentCounts: perf.currentCounts,
          candidateCounts: perf.candidateCounts,
          shifts: perf.shifts,
          topAffectedSalons: perf.topAffectedSalons,
          topShareAffectedSalons: perf.topShareAffectedSalons,
          shareRankingMinCustomers: perf.shareRankingMinCustomers,
        },
        "row-budget sub-chunking yields identical results to the default budget",
      );
      assert.ok(
        chunkedElapsedMs <= PERF_RESPONSE_BOUND_MS,
        `sub-chunked preview answered in ${chunkedElapsedMs} ms (bound ${PERF_RESPONSE_BOUND_MS} ms)`,
      );
      console.log(
        `✓ Deep-history stress: 350-row budget preview matches default-budget results in ${chunkedElapsedMs} ms`,
      );

      // A single customer whose history alone exceeds the whole row budget
      // cannot be processed within the memory bound (full history is the
      // irreducible unit for parity with the CRM endpoints). The preview must
      // refuse with the same friendly overload contract, never silently blow
      // the budget: 250-row budget < 300-visit deep customers → 503.
      process.env.RETENTION_PREVIEW_APPOINTMENT_ROW_BUDGET = "250";
      const oversizedRes = await postPreview({ ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 2 });
      assert.equal(oversizedRes.status, 503, "oversized single-customer history is refused, not fetched");
      const oversized = (await oversizedRes.json()) as any;
      assert.equal(oversized.code, "PREVIEW_TOO_LARGE");
      assert.ok(
        typeof oversized.error === "string" && oversized.error.length > 0,
        "oversized-history refusal carries a friendly message",
      );
      console.log("✓ Single history above the row budget → friendly 503 refusal");
    } finally {
      delete process.env.RETENTION_PREVIEW_APPOINTMENT_ROW_BUDGET;
    }

    // ── 17. Restore provenance: labelled truthfully, rejected when it lies ──
    // Manual updates never carry restore metadata.
    const historySoFar = (await (await fetch(`${baseUrl}/growth/admin/retention-settings/history`, { headers: adminHeaders })).json()) as any[];
    for (const entry of historySoFar.filter((h) => h.version > initialVersion)) {
      assert.equal(entry.changeSource, "manual", `hand-edited v${entry.version} is labelled manual`);
      assert.equal(entry.restoredFromVersion, null, `hand-edited v${entry.version} has no source version`);
    }

    // Restore version (initialVersion + 2): thresholds must match that version.
    const v2Thresholds = { ...DEFAULT_RETENTION_THRESHOLDS, vipMinCompletedVisits: 3 };
    const restoreRes = await putSettings({
      ...v2Thresholds, changeSource: "restore_version", restoredFromVersion: initialVersion + 2,
      expectedVersion: initialVersion + 4,
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(((await restoreRes.json()) as any).version, initialVersion + 5);

    // The active-settings endpoint exposes the restore provenance too, so the
    // admin card can label a rollback without consulting the history list.
    const activeAfterVersionRestore = (await (await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders })).json()) as any;
    assert.equal(activeAfterVersionRestore.changeSource, "restore_version", "active settings expose restore provenance");
    assert.equal(activeAfterVersionRestore.restoredFromVersion, initialVersion + 2, "active settings expose the source version");

    // Restore platform defaults.
    const restoreDefaultsRes = await putSettings({
      ...DEFAULT_RETENTION_THRESHOLDS, changeSource: "restore_defaults",
      expectedVersion: initialVersion + 5,
    });
    assert.equal(restoreDefaultsRes.status, 200);
    assert.equal(((await restoreDefaultsRes.json()) as any).version, initialVersion + 6);

    const historyWithRestores = (await (await fetch(`${baseUrl}/growth/admin/retention-settings/history`, { headers: adminHeaders })).json()) as any[];
    const [restoredDefaults, restoredVersion] = historyWithRestores;
    assert.equal(restoredDefaults.version, initialVersion + 6);
    assert.equal(restoredDefaults.changeSource, "restore_defaults", "defaults restore is labelled");
    assert.equal(restoredDefaults.restoredFromVersion, null, "defaults restore has no source version");
    assert.equal(restoredVersion.version, initialVersion + 5);
    assert.equal(restoredVersion.changeSource, "restore_version", "version restore is labelled");
    assert.equal(restoredVersion.restoredFromVersion, initialVersion + 2, "version restore records its source");
    assert.deepEqual(restoredVersion.thresholds, v2Thresholds, "restored entry carries the restored values");

    // No-op restores are blocked: the active thresholds already equal the
    // platform defaults (initialVersion + 6), so restoring the defaults again
    // — or any version carrying the same values — must not record another
    // "no values changed" history entry.
    const noopDefaultsRes = await putSettings({
      ...DEFAULT_RETENTION_THRESHOLDS, changeSource: "restore_defaults",
      expectedVersion: initialVersion + 6,
    });
    assert.equal(noopDefaultsRes.status, 400, "no-op defaults restore is rejected");
    assert.equal(
      ((await noopDefaultsRes.json()) as any).code,
      "NO_OP_RESTORE",
      "no-op restore carries its own error code so the client can explain it",
    );

    // initialVersion + 1 was a manual save of the default values — restoring
    // it would change nothing either.
    const noopVersionRes = await putSettings({
      ...DEFAULT_RETENTION_THRESHOLDS,
      changeSource: "restore_version",
      restoredFromVersion: initialVersion + 1,
      expectedVersion: initialVersion + 6,
    });
    assert.equal(noopVersionRes.status, 400, "no-op version restore is rejected");
    assert.equal(((await noopVersionRes.json()) as any).code, "NO_OP_RESTORE");

    const afterNoopRestores = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    assert.equal(((await afterNoopRestores.json()) as any).version, initialVersion + 6, "no-op restores record no version");
    console.log("✓ No-op restores rejected (NO_OP_RESTORE), no version recorded");

    // Lying restore metadata is rejected without recording a version. Each
    // body carries the CORRECT expectedVersion so the 400 is attributable to
    // the restore metadata itself, never to the concurrency precondition.
    const expectedNow = initialVersion + 6;
    const badRestores: [string, Record<string, unknown>][] = [
      ["restore_version without source", { ...v2Thresholds, changeSource: "restore_version", expectedVersion: expectedNow }],
      ["source version on manual change", { ...v2Thresholds, changeSource: "manual", restoredFromVersion: initialVersion + 2, expectedVersion: expectedNow }],
      ["nonexistent source version", { ...v2Thresholds, changeSource: "restore_version", restoredFromVersion: 999_999, expectedVersion: expectedNow }],
      ["thresholds mismatch source version", { ...DEFAULT_RETENTION_THRESHOLDS, lostMinimumDays: 91, changeSource: "restore_version", restoredFromVersion: initialVersion + 2, expectedVersion: expectedNow }],
      ["restore_defaults with non-default values", { ...DEFAULT_RETENTION_THRESHOLDS, lostMinimumDays: 91, changeSource: "restore_defaults", expectedVersion: expectedNow }],
      ["unknown change source", { ...v2Thresholds, changeSource: "rollback", expectedVersion: expectedNow }],
    ];
    for (const [label, body] of badRestores) {
      const res = await putSettings(body);
      assert.equal(res.status, 400, `dishonest restore (${label}) must be rejected`);
    }
    const afterBadRestores = await fetch(`${baseUrl}/growth/admin/retention-settings`, { headers: adminHeaders });
    const activeAfterBadRestores = (await afterBadRestores.json()) as any;
    assert.equal(activeAfterBadRestores.version, initialVersion + 6, "rejected restores record no version");
    assert.equal(activeAfterBadRestores.changeSource, "restore_defaults", "active settings label a defaults restore");
    assert.equal(activeAfterBadRestores.restoredFromVersion, null, "defaults restore carries no source version");
    console.log("✓ Restores are labelled in history; dishonest restore metadata rejected");

    // The no-op guard applies only to restores: a manual save of identical
    // values still records an audited version (deliberate re-confirmation).
    const manualIdenticalRes = await putSettings({ ...DEFAULT_RETENTION_THRESHOLDS, expectedVersion: initialVersion + 6 });
    assert.equal(manualIdenticalRes.status, 200, "identical manual save is still allowed");
    assert.equal(((await manualIdenticalRes.json()) as any).version, initialVersion + 7);
    console.log("✓ Manual saves are unaffected by the no-op restore guard");

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
  testEstimatedPreviewMarginOfError();

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
