/**
 * Task #6B: unify the public-featured eligibility rule into one canonical
 * source of truth (education-featured-eligibility.ts) and prove every public
 * reader now agrees. This file is the cross-endpoint consistency test the
 * task requires: for the same course at the same instant,
 *   - GET /education/public/courses/:courseId (single detail)
 *   - GET /education/public/popular (ranking + card list)
 *   - GET /education/public/featured (dedicated featured list)
 * must never disagree about whether that course is publicly featured.
 *
 * It also resolves, with an explicit test, the exact ambiguity Task #6B was
 * asked not to guess at: an already-active, already-PAID featured course
 * whose owner (deliberately or via a double-activation race -- there is no
 * "renew" UI, see business-education.tsx's Switch bound straight to
 * isFeatured) triggers a NEW, still-pending charge. See "paid then pending
 * renewal" below for the resolved rule and why.
 *
 * Charge-history matrix covered (courses are independent, all under one
 * verified+active center):
 *   1. no charge at all
 *   2. one pending charge
 *   3. one paid, active charge
 *   4. paid (older) then a new pending charge (the scrutinized case)
 *   5. pending (older, superseded) then a new paid charge
 *   6. paid (older) then a new cancelled charge
 *   7. paid (older) then a new refunded charge (not reachable via any
 *      current write path -- see education-featured-eligibility.ts -- but
 *      the read rule must still handle it correctly if it ever occurs)
 *   8. multiple historical paid charges (only the latest matters)
 *   9. expired featuredUntil despite a paid charge
 *  10. isFeatured=false despite a historical paid charge
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import {
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationFeaturedChargesTable,
  subscriptionPlansTable,
  usersTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { ensureDemoData } from "./seed";

const scrypt = promisify(scryptCallback);
type Json = Record<string, unknown>;

// Dominates any realistic (or demo-seeded, ~45-52) rating so this fixture's
// courses always land inside /education/public/popular's max limit=12.
const DOMINANT_RATING = 1_000_000;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function run(): Promise<void> {
  await ensureDemoData();
  const suffix = randomUUID();
  let server: ReturnType<typeof app.listen> | undefined;
  const userIds: string[] = [];
  const centerIds: string[] = [];
  const courseIds: string[] = [];

  try {
    const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.active, true)).limit(1);
    assert.ok(plan, "an active subscription plan is required by demo seed data");

    const passwordHash = await hashPassword(`featured-eligibility-${suffix}`);
    const [owner] = await db.insert(usersTable).values({
      firstName: "Featured", lastName: "Owner", email: `featured-eligibility-owner-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
    }).returning();
    assert.ok(owner);
    userIds.push(owner.id);

    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner.id, name: `Featured Eligibility Center ${suffix}`, city: "Beograd", description: "Test.", imageUrl: "/test.jpg",
      verificationStatus: "verified", verifiedAt: new Date(),
    }).returning();
    assert.ok(center);
    centerIds.push(center.id);
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: center.id, planId: plan.id, status: "active", dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const baseCourse = (title: string, isFeatured: boolean, featuredUntil: Date | null) => ({
      centerId: center.id, title, category: "Test", format: "online" as const, city: "Beograd", price: 5000,
      duration: "4 nedelje", imageUrl: "/test.jpg", published: true, onlineAccessDays: 30,
      rating: DOMINANT_RATING, isFeatured, featuredUntil,
    });
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const older = new Date(Date.now() - 60 * 60 * 1000);
    const newer = new Date(Date.now() - 30 * 60 * 1000);

    const inserted = await db.insert(coursesTable).values([
      baseCourse(`No charge ${suffix}`, true, null),
      baseCourse(`One pending ${suffix}`, true, null),
      baseCourse(`One paid active ${suffix}`, true, null),
      baseCourse(`Paid then pending renewal ${suffix}`, true, null),
      baseCourse(`Pending then paid ${suffix}`, true, null),
      baseCourse(`Paid then cancelled ${suffix}`, true, null),
      baseCourse(`Paid then refunded ${suffix}`, true, null),
      baseCourse(`Multiple historical paid ${suffix}`, true, null),
      baseCourse(`Expired featuredUntil ${suffix}`, true, past),
      baseCourse(`isFeatured false despite paid history ${suffix}`, false, past),
    ]).returning();
    assert.equal(inserted.length, 10);
    const [
      noCharge, onePending, onePaidActive, paidThenPendingRenewal, pendingThenPaid,
      paidThenCancelled, paidThenRefunded, multipleHistoricalPaid, expiredFeaturedUntil, isFeaturedFalseDespitePaidHistory,
    ] = inserted;
    courseIds.push(...inserted.map((c) => c.id));

    await db.insert(educationFeaturedChargesTable).values([
      // noCharge: intentionally no rows.
      { courseId: onePending!.id, centerId: center.id, amount: 2000, status: "pending", createdAt: older },
      { courseId: onePaidActive!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: older },
      // The scrutinized case: an OLDER charge is paid (course has been legitimately
      // featured), then a NEWER charge exists with status="pending". Resolved rule:
      // the course must stop being publicly featured. There is no "renewal" concept
      // anywhere in this feature -- PATCH .../featured {active:true} unconditionally
      // resets featuredActivatedAt and inserts a fresh charge every time it's called,
      // whether or not isFeatured was already true, and featuredUntil never holds a
      // real future expiry (only null-while-active or "now" set at deactivation). So
      // a second activation is, by the system's own bookkeeping, indistinguishable
      // from a first one -- and the first one already must wait for its own payment
      // before counting publicly. Treating the newer pending charge as inert (i.e.
      // "any paid charge ever" logic) would also reopen a variant of the Task #6
      // bypass: pay once, deactivate, reactivate forever without ever paying again.
      { courseId: paidThenPendingRenewal!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: older },
      { courseId: paidThenPendingRenewal!.id, centerId: center.id, amount: 2000, status: "pending", createdAt: newer },
      // Mirror image: an older, superseded pending charge, then the CURRENT charge
      // is paid (e.g. an admin settled it). Must be featured -- latest governs.
      { courseId: pendingThenPaid!.id, centerId: center.id, amount: 2000, status: "pending", createdAt: older },
      { courseId: pendingThenPaid!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: newer },
      { courseId: paidThenCancelled!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: older },
      { courseId: paidThenCancelled!.id, centerId: center.id, amount: 2000, status: "cancelled", createdAt: newer },
      { courseId: paidThenRefunded!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: older },
      { courseId: paidThenRefunded!.id, centerId: center.id, amount: 2000, status: "refunded", createdAt: newer },
      { courseId: multipleHistoricalPaid!.id, centerId: center.id, amount: 0, status: "paid", createdAt: new Date(older.getTime() - 60 * 60 * 1000) },
      { courseId: multipleHistoricalPaid!.id, centerId: center.id, amount: 0, status: "paid", createdAt: older },
      { courseId: multipleHistoricalPaid!.id, centerId: center.id, amount: 0, status: "paid", createdAt: newer },
      { courseId: expiredFeaturedUntil!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: older },
      { courseId: isFeaturedFalseDespitePaidHistory!.id, centerId: center.id, amount: 2000, status: "paid", createdAt: older },
    ]);

    const expected: [typeof noCharge, boolean, string][] = [
      [noCharge, false, "no charge at all"],
      [onePending, false, "one pending charge"],
      [onePaidActive, true, "one paid active charge"],
      [paidThenPendingRenewal, false, "paid then pending renewal -- latest charge governs, must NOT stay featured"],
      [pendingThenPaid, true, "pending then paid -- latest charge governs, must become featured"],
      [paidThenCancelled, false, "paid then cancelled -- latest charge governs"],
      [paidThenRefunded, false, "paid then refunded -- latest charge governs"],
      [multipleHistoricalPaid, true, "multiple historical paid charges -- only the latest matters, still featured"],
      [expiredFeaturedUntil, false, "expired featuredUntil overrides an otherwise-paid charge"],
      [isFeaturedFalseDespitePaidHistory, false, "isFeatured=false overrides a historical paid charge"],
    ];

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const myIds = new Set(courseIds);

    // --- Endpoint 1: single-course public detail --------------------------
    const detailFeatured = new Map<string, boolean>();
    for (const [course] of expected) {
      const response = await fetch(`${baseUrl}/education/public/courses/${course!.id}`);
      assert.equal(response.status, 200, `course detail must be reachable for ${course!.title}`);
      const body = await response.json() as Json;
      detailFeatured.set(course!.id, body.featured === true);
    }

    // --- Endpoint 2: /education/public/popular (ranking + card list) ------
    const popularResponse = await fetch(`${baseUrl}/education/public/popular?limit=12`);
    assert.equal(popularResponse.status, 200);
    const popularBody = await popularResponse.json() as Json[];
    const popularMine = popularBody.filter((c) => myIds.has(c.id as string));
    assert.equal(popularMine.length, 10, "all 10 fixture courses must appear within the dominant-rating top-12 window");
    const popularFeatured = new Map(popularMine.map((c) => [c.id as string, c.featured === true]));

    // --- Endpoint 3: /education/public/featured (dedicated featured list) -
    const featuredListResponse = await fetch(`${baseUrl}/education/public/featured`);
    assert.equal(featuredListResponse.status, 200);
    const featuredListBody = await featuredListResponse.json() as Json[];
    const featuredListIds = new Set(featuredListBody.map((c) => c.id as string));

    // --- Consistency + correctness assertions, per course ------------------
    for (const [course, isFeatured, description] of expected) {
      const id = course!.id;
      assert.equal(detailFeatured.get(id), isFeatured, `detail: ${description}`);
      assert.equal(popularFeatured.get(id), isFeatured, `popular: ${description}`);
      assert.equal(featuredListIds.has(id), isFeatured, `featured list membership: ${description}`);
      // The three endpoints must agree with EACH OTHER, not just with the
      // expected value independently -- this is the actual "no disagreement"
      // requirement, restated as a direct three-way comparison.
      assert.equal(detailFeatured.get(id), popularFeatured.get(id), `detail vs popular must agree: ${description}`);
      assert.equal(popularFeatured.get(id), featuredListIds.has(id), `popular vs featured-list must agree: ${description}`);
    }

    // --- Regression: the original Task #6 bypass stays closed --------------
    // isFeatured=true with literally zero charge history (never paid, never
    // even attempted payment) must never be featured anywhere.
    assert.equal(detailFeatured.get(noCharge!.id), false);
    assert.equal(popularFeatured.get(noCharge!.id), false);
    assert.equal(featuredListIds.has(noCharge!.id), false);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (courseIds.length) {
      await db.delete(educationFeaturedChargesTable).where(inArray(educationFeaturedChargesTable.courseId, courseIds));
      await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    }
    if (centerIds.length) {
      await db.delete(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds));
      await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, centerIds));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
