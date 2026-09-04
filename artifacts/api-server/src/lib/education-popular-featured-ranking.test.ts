/**
 * Regression coverage for the confirmed MEDIUM finding: GET /education/public/popular
 * ordered results by the raw `coursesTable.isFeatured` column, which a center owner
 * can flip to `true` immediately on activation (PATCH /education/courses/:courseId/featured)
 * BEFORE any fee is actually paid -- a non-zero fee charge is inserted as
 * education_featured_charges.status="pending" and only becomes "paid" once an admin
 * settles it (POST /admin/education/featured-charges/:chargeId/settle). So an unpaid,
 * still-pending "featured" toggle was already enough to jump the ranking queue, even
 * though the SAME response's own `featured` display field (computed by
 * batchEducationCourseViews) was already correctly gated on a paid charge existing --
 * ranking and display disagreed.
 *
 * The fix (marketplace.ts's /education/public/popular handler) replaces the raw
 * `desc(coursesTable.isFeatured)` ORDER BY term with a SQL boolean that mirrors the
 * SAME authoritative "paid featured" rule batchEducationCourseViews already uses for
 * the `featured` field: isFeatured=true AND (featuredUntil is null OR in the future)
 * AND an education_featured_charges row for that course has status="paid". Nothing
 * else about the formula (rating DESC, then this term, then createdAt DESC, then id
 * DESC) changed, and the WHERE clause (publicEducationCoursePredicate) is untouched.
 *
 * Note (superseded by Task #6B): at the time this test was written, there was a
 * pre-existing pure-function helper (education-public-course-order.ts's
 * selectPopularPublicCourses) with its own correct unit test in
 * marketplace-query-budget.test.ts asserting this exact intended ordering -- but the
 * real route never called it, which is exactly how this bug shipped silently green.
 * Task #6B removed that dead duplicate implementation once the canonical eligibility
 * rule (education-featured-eligibility.ts) made it fully redundant. This file
 * exercises the REAL HTTP endpoint end-to-end and remains the regression proof that
 * the original bypass stays closed under the now-unified rule (see
 * education-featured-eligibility-consistency.test.ts for the broader cross-endpoint
 * consistency coverage Task #6B added).
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
import { createSession, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const scrypt = promisify(scryptCallback);
type Json = Record<string, unknown>;

// Astronomically above any realistic (or demo-seeded, ~45-52) course rating, so this
// fixture's courses always occupy the top of /education/public/popular regardless of
// whatever else exists in the shared dev database -- the test still filters the
// response down to its own course ids before asserting order, as defense in depth.
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

    const passwordHash = await hashPassword(`popular-ranking-${suffix}`);
    const [ownerA, ownerB] = await db.insert(usersTable).values([
      { firstName: "Center", lastName: "A", email: `popular-ranking-owner-a-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
      { firstName: "Center", lastName: "B", email: `popular-ranking-owner-b-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
    ]).returning();
    assert.ok(ownerA && ownerB);
    userIds.push(ownerA.id, ownerB.id);

    const [centerA, centerB] = await db.insert(educationCentersTable).values([
      { ownerId: ownerA.id, name: `Popular Ranking Center A ${suffix}`, city: "Beograd", description: "Test.", imageUrl: "/test.jpg", verificationStatus: "verified", verifiedAt: new Date() },
      { ownerId: ownerB.id, name: `Popular Ranking Center B ${suffix}`, city: "Novi Sad", description: "Test.", imageUrl: "/test.jpg", verificationStatus: "verified", verifiedAt: new Date() },
    ]).returning();
    assert.ok(centerA && centerB);
    centerIds.push(centerA.id, centerB.id);

    await db.insert(educationCenterSubscriptionsTable).values([
      { centerId: centerA.id, planId: plan.id, status: "active", dueAmount: plan.price, currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      { centerId: centerB.id, planId: plan.id, status: "active", dueAmount: plan.price, currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    ]);

    const baseCourse = (title: string, centerId: string, createdAt: Date, isFeatured: boolean, featuredUntil: Date | null) => ({
      centerId, title, category: "Test", format: "online" as const, city: "Beograd", price: 5000,
      duration: "4 nedelje", imageUrl: "/test.jpg", published: true, onlineAccessDays: 30,
      rating: DOMINANT_RATING, isFeatured, featuredUntil, createdAt, updatedAt: createdAt,
    });

    // All timestamps distinct and ordered so createdAt DESC tie-breaking is unambiguous.
    const t = (day: number) => new Date(`2020-01-${String(day).padStart(2, "0")}T00:00:00.000Z`);

    const inserted = await db.insert(coursesTable).values([
      baseCourse(`Highest rating ${suffix}`, centerA.id, t(1), false, null), // 0: rating tiebreak winner (kept at DOMINANT_RATING+1 below)
      baseCourse(`Paid featured ${suffix}`, centerA.id, t(1), true, null), // 1: paid, oldest of the tier -> must still rank #1 of the tier
      baseCourse(`Expired featured ${suffix}`, centerA.id, t(2), true, t(1)), // 2: paid but featuredUntil already passed
      baseCourse(`Cancelled charge ${suffix}`, centerA.id, t(3), true, null), // 3: charge status=cancelled
      baseCourse(`Refunded charge ${suffix}`, centerA.id, t(4), true, null), // 4: charge status=refunded
      baseCourse(`Center B own course, no charge ${suffix}`, centerB.id, t(5), true, null), // 5: isFeatured=true, no charge at all, different tenant
      baseCourse(`Ordinary older ${suffix}`, centerA.id, t(6), false, null), // 6: never featured, purely organic
      baseCourse(`Center B paid featured ${suffix}`, centerB.id, t(7), true, null), // 7: legitimately paid, different tenant
      baseCourse(`Unpaid pending newest ${suffix}`, centerA.id, t(8), true, null), // 8: isFeatured=true, charge still pending -- THE BYPASS CASE
    ]).returning();
    assert.equal(inserted.length, 9);
    const [highestRating, paidFeatured, expiredFeatured, cancelledCourse, refundedCourse, centerBOwnCourse, ordinaryOlder, centerBPaidFeatured, unpaidPendingNewest] = inserted;
    courseIds.push(...inserted.map((c) => c.id));
    // Make the single organic rating winner unambiguous over the rest of the tied tier.
    await db.update(coursesTable).set({ rating: DOMINANT_RATING + 1 }).where(eq(coursesTable.id, highestRating!.id));

    await db.insert(educationFeaturedChargesTable).values([
      { courseId: paidFeatured!.id, centerId: centerA.id, amount: 2000, status: "paid" },
      { courseId: expiredFeatured!.id, centerId: centerA.id, amount: 2000, status: "paid" }, // paid, but the course itself already expired
      { courseId: cancelledCourse!.id, centerId: centerA.id, amount: 2000, status: "cancelled" },
      { courseId: refundedCourse!.id, centerId: centerA.id, amount: 2000, status: "refunded" },
      { courseId: centerBPaidFeatured!.id, centerId: centerB.id, amount: 2000, status: "paid" },
      { courseId: unpaidPendingNewest!.id, centerId: centerA.id, amount: 2000, status: "pending" },
      // centerBOwnCourse intentionally has NO charge row at all.
    ]);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const myIds = new Set(courseIds);

    const fetchPopularMineOnly = async (): Promise<string[]> => {
      const response = await fetch(`${baseUrl}/education/public/popular?limit=12`);
      assert.equal(response.status, 200);
      const body = await response.json() as Json[];
      return body.filter((course) => myIds.has(course.id as string)).map((course) => course.id as string);
    };

    // --- Scenarios 1,2,3,4,5,6,7,8,9,10: one deterministic full-order assertion ---
    const order = await fetchPopularMineOnly();
    assert.deepEqual(order, [
      highestRating!.id, // #1: highest rating always wins regardless of featured state
      centerBPaidFeatured!.id, // #2: paid + active, newest among the paid-featured pair (scenario 2, 8, 10)
      paidFeatured!.id, // #3: paid + active, older than the above but still boosted over ALL non-paid peers despite being the oldest course in the whole tier (scenario 2, 8, 10)
      unpaidPendingNewest!.id, // #4: isFeatured=true but charge is "pending" (not yet paid) -- gets NO boost despite being the newest course overall (scenario 1, 3, 9: this is the exact original bypass)
      ordinaryOlder!.id, // #5: never featured, ranks purely by recency among the non-boosted set (scenario 7: organic ranking preserved)
      centerBOwnCourse!.id, // #6: isFeatured=true, zero charge rows at all, AND a stray unrelated course under the SAME center has a paid charge -- proves the paid-check is scoped per-course, not per-center/tenant (scenario 6)
      refundedCourse!.id, // #7: charge status=refunded -- no boost (scenario 5)
      cancelledCourse!.id, // #8: charge status=cancelled -- no boost (scenario 5)
      expiredFeatured!.id, // #9: charge IS paid, but featuredUntil already passed -- no boost (scenario 4)
    ], "ranking must follow rating, then ONLY paid+active featured placements, then recency -- never a bare isFeatured flag");

    // --- Adversarial: exercise the exact original bypass through the real owner-facing
    // activation endpoint (not a raw DB poke), with a non-zero fee so the resulting
    // charge is recorded as "pending", then confirm /popular grants no advantage. ---
    const [ownerAAdversarial] = await db.insert(usersTable).values({
      firstName: "Adversarial", lastName: "Owner", email: `popular-ranking-adversarial-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
    }).returning();
    assert.ok(ownerAAdversarial);
    userIds.push(ownerAAdversarial.id);
    const [adversarialCenter] = await db.insert(educationCentersTable).values({
      ownerId: ownerAAdversarial.id, name: `Adversarial Center ${suffix}`, city: "Beograd", description: "Test.", imageUrl: "/test.jpg",
      verificationStatus: "verified", verifiedAt: new Date(),
      // Force a non-zero effective featured fee regardless of the platform-wide
      // default (lib/db/src/schema/education.ts's featuredCoursePrice defaults to
      // 0), so activation is guaranteed to record a "pending" charge below.
      featuredCoursePriceOverride: 2500,
    }).returning();
    assert.ok(adversarialCenter);
    centerIds.push(adversarialCenter.id);
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: adversarialCenter.id, planId: plan.id, status: "active", dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const [adversarialCourse] = await db.insert(coursesTable).values(
      baseCourse(`Adversarial newest ${suffix}`, adversarialCenter.id, t(9), false, null),
    ).returning();
    assert.ok(adversarialCourse);
    courseIds.push(adversarialCourse.id);
    myIds.add(adversarialCourse.id);

    const session = await createSession(ownerAAdversarial.id);
    const cookie = `${sessionCookieName}=${session}`;
    const patchResponse = await fetch(`${baseUrl}/education/courses/${adversarialCourse.id}/featured`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ active: true }),
    });
    assert.equal(patchResponse.status, 200, "the real activation endpoint must succeed");
    const patchBody = await patchResponse.json() as { charge: { status: string } | null };
    // The platform's configured featured fee for a fresh center defaults to a positive
    // amount, so activation must record a still-"pending" charge, not an auto-paid one.
    // (If billing settings ever configure a zero fee, the charge is auto-"paid" and
    // legitimately earns the boost -- this assertion documents that assumption.)
    assert.ok(patchBody.charge, "activating featured must record a charge");
    assert.equal(patchBody.charge!.status, "pending", "a non-zero featured fee must stay pending until an admin settles it");

    const [dbCourse] = await db.select({ isFeatured: coursesTable.isFeatured }).from(coursesTable).where(eq(coursesTable.id, adversarialCourse.id));
    assert.equal(dbCourse?.isFeatured, true, "isFeatured is set immediately on activation -- this is the exact vulnerable state");

    const afterBypassAttempt = await fetchPopularMineOnly();
    // The adversarial course is the newest course overall, and it has isFeatured=true,
    // but ONLY a pending charge -- so it must rank exactly where an equally-fresh
    // ORGANIC (non-featured) course would: ahead of older organic courses purely by
    // recency, but never ahead of the two genuinely paid+active featured courses. It
    // must land immediately after `paidFeatured` (the older of the two legitimately
    // boosted courses) and immediately before `unpaidPendingNewest` (the next-newest
    // non-boosted course) -- proving isFeatured=true alone bought it no queue-jump
    // over its actual publication recency.
    const paidFeaturedIndex = order.indexOf(paidFeatured!.id);
    const expectedWithBypassAttempt = [
      ...order.slice(0, paidFeaturedIndex + 1),
      adversarialCourse.id,
      ...order.slice(paidFeaturedIndex + 1),
    ];
    assert.deepEqual(afterBypassAttempt, expectedWithBypassAttempt,
      "flipping isFeatured=true through the real activation endpoint without a paid charge must rank the course by recency only, never with a featured boost");
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
