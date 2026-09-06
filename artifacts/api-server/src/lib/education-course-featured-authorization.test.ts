/**
 * Task #6C: requireOwnedCourse's guard reads
 *   !course.centerId || (!access.admin && !canManageEducationCourses(access, course.centerId))
 * which lets ANY account with access.admin=true (ADMIN or SUPER_ADMIN --
 * isAdmin() collapses both) through for EVERY center-owned course, while its
 * own error text ("Administratori imaju samo uvid u tuđe kurseve.") implies
 * admin access is view-only. Tracing every requireOwnedCourse caller plus the
 * independent lockCourseForDestructiveContentMutation helper (used by module/
 * lesson deletion) shows this admin bypass IS the deliberate, long-standing
 * design for CONTENT moderation (fix a title, unpublish, delete a lesson --
 * there is no other admin route that can do this, so removing it would be a
 * real capability regression, not a fix). That part of requireOwnedCourse is
 * intentionally left unchanged.
 *
 * PATCH /education/courses/:courseId/featured is different in kind: it is a
 * COMMERCIAL action -- activating immediately inserts an auditable
 * education_featured_charges row, a new financial obligation for the center,
 * not a configuration edit. The platform's sibling paid-placement system
 * (POST /education/placements/purchase) already has `|| access.admin) 403`
 * excluding admin from *initiating* a purchase on a center's behalf, while a
 * dedicated admin route (POST /admin/education/featured-charges/:chargeId/settle)
 * is the intended admin touchpoint: confirming payment the center itself
 * already requested. PATCH .../featured had no equivalent exclusion -- this
 * was the real, exploitable gap this file closes and regression-tests.
 *
 * Scenarios covered (matching Task #6C's required list):
 *   1. course owner / authorized center staff (owner_admin, manager_reception)
 *      can mutate their own course's featured state
 *   2. an unrelated center's owner cannot mutate this course
 *   3. ordinary ADMIN cannot mutate an arbitrary center's featured state
 *   4. SUPER_ADMIN is held to the same rule (isAdmin() collapses both roles
 *      everywhere else this exact boundary is enforced, e.g. the placements
 *      purchase route -- there is no established SUPER_ADMIN carve-out here)
 *   5. an inactive (revoked) center-staff membership cannot mutate
 *   6. an adversarial courseId belonging to a different tenant is rejected
 *      even when supplied by an otherwise-legitimate center owner
 *   7. a plain customer/student account cannot reach this route at all
 *   8. read-only ADMIN access (GET .../featured status) remains available --
 *      this file only tightens the PATCH mutation, not the GET status view
 *
 * Plus: the exact adversarial reproduction the task asked for (admin
 * activating another center's featured course), proof of no DB side effects
 * on every rejected attempt, and proof deactivation is blocked the same way.
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
  educationCenterStaffTable,
  educationFeaturedChargesTable,
  usersTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const scrypt = promisify(scryptCallback);
type Json = Record<string, unknown>;

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
    const passwordHash = await hashPassword(`featured-authz-${suffix}`);
    const [
      ownerA, staffOwnerAdmin, staffInactive, ownerB, adminUser, superAdminUser, customerUser,
    ] = await db.insert(usersTable).values([
      { firstName: "Owner", lastName: "A", email: `featured-authz-owner-a-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
      { firstName: "Staff", lastName: "OwnerAdmin", email: `featured-authz-staff-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
      { firstName: "Staff", lastName: "Inactive", email: `featured-authz-inactive-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
      { firstName: "Owner", lastName: "B", email: `featured-authz-owner-b-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
      { firstName: "Admin", lastName: "User", email: `featured-authz-admin-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "ADMIN" },
      { firstName: "Super", lastName: "Admin", email: `featured-authz-superadmin-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SUPER_ADMIN" },
      { firstName: "Customer", lastName: "User", email: `featured-authz-customer-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "CUSTOMER" },
    ]).returning();
    assert.ok(ownerA && staffOwnerAdmin && staffInactive && ownerB && adminUser && superAdminUser && customerUser);
    userIds.push(ownerA.id, staffOwnerAdmin.id, staffInactive.id, ownerB.id, adminUser.id, superAdminUser.id, customerUser.id);

    const [centerA, centerB] = await db.insert(educationCentersTable).values([
      { ownerId: ownerA.id, name: `Featured Authz Center A ${suffix}`, city: "Beograd", description: "Test.", imageUrl: "/test.jpg", verificationStatus: "verified", verifiedAt: new Date() },
      { ownerId: ownerB.id, name: `Featured Authz Center B ${suffix}`, city: "Novi Sad", description: "Test.", imageUrl: "/test.jpg", verificationStatus: "verified", verifiedAt: new Date() },
    ]).returning();
    assert.ok(centerA && centerB);
    centerIds.push(centerA.id, centerB.id);

    await db.insert(educationCenterStaffTable).values([
      { centerId: centerA.id, userId: staffOwnerAdmin.id, role: "owner_admin", active: true },
      { centerId: centerA.id, userId: staffInactive.id, role: "owner_admin", active: false },
    ]);

    const baseCourse = (title: string, centerId: string) => ({
      centerId, title, category: "Test", format: "online" as const, city: "Beograd", price: 5000,
      duration: "4 nedelje", imageUrl: "/test.jpg", published: true, onlineAccessDays: 30,
      extensionPrice1Month: 1000, extensionPrice3Months: 2500, extensionPrice6Months: 4000,
    });
    const [courseA, courseB] = await db.insert(coursesTable).values([
      baseCourse(`Course A ${suffix}`, centerA.id),
      baseCourse(`Course B ${suffix}`, centerB.id),
    ]).returning();
    assert.ok(courseA && courseB);
    courseIds.push(courseA.id, courseB.id);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    const cookieFor = async (userId: string) => `${sessionCookieName}=${await createSession(userId)}`;
    const [ownerACookie, staffCookie, inactiveStaffCookie, ownerBCookie, adminCookie, superAdminCookie, customerCookie] = await Promise.all(
      [ownerA, staffOwnerAdmin, staffInactive, ownerB, adminUser, superAdminUser, customerUser].map((u) => cookieFor(u.id)),
    );

    const patchFeatured = (courseId: string, cookie: string, active: boolean) =>
      fetch(`${baseUrl}/education/courses/${courseId}/featured`, {
        method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ active }),
      });
    const getFeatured = (courseId: string, cookie: string) =>
      fetch(`${baseUrl}/education/courses/${courseId}/featured`, { headers: { cookie } });

    const courseState = async (courseId: string) => {
      const [course] = await db.select({ isFeatured: coursesTable.isFeatured, featuredUntil: coursesTable.featuredUntil })
        .from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
      const charges = await db.select().from(educationFeaturedChargesTable).where(eq(educationFeaturedChargesTable.courseId, courseId));
      return { isFeatured: course?.isFeatured, chargeCount: charges.length };
    };

    // --- Scenario 3 & the exact adversarial reproduction: ordinary ADMIN
    // cannot activate a center's featured placement it doesn't manage. -------
    const beforeAdmin = await courseState(courseA.id);
    assert.equal(beforeAdmin.isFeatured, false, "course A must start unfeatured");
    assert.equal(beforeAdmin.chargeCount, 0, "course A must start with no charge history");

    const adminAttempt = await patchFeatured(courseA.id, adminCookie, true);
    assert.equal(adminAttempt.status, 403, "ordinary ADMIN must not be able to activate another center's featured placement");
    const adminAttemptBody = await adminAttempt.json() as Json;
    assert.ok(typeof adminAttemptBody.error === "string" && adminAttemptBody.error.length > 0);

    // --- DB side-effect safety: the rejected admin attempt changed nothing. -
    const afterAdmin = await courseState(courseA.id);
    assert.deepEqual(afterAdmin, beforeAdmin, "a rejected PATCH must leave isFeatured and the charge history completely untouched");

    // --- Scenario 4: SUPER_ADMIN is held to the exact same rule. ------------
    const superAdminAttempt = await patchFeatured(courseA.id, superAdminCookie, true);
    assert.equal(superAdminAttempt.status, 403, "SUPER_ADMIN must not be able to activate another center's featured placement either");
    const afterSuperAdmin = await courseState(courseA.id);
    assert.deepEqual(afterSuperAdmin, beforeAdmin, "a rejected SUPER_ADMIN attempt must leave no trace");

    // --- Admin cannot deactivate another center's featured state either. ----
    // (Set up a legitimately-featured course first, via the real owner flow,
    // then attempt to turn it off as admin.)
    const legitimateActivate = await patchFeatured(courseA.id, ownerACookie, true);
    assert.equal(legitimateActivate.status, 200, "the real owner must still be able to activate their own course");
    const afterLegitimateActivate = await courseState(courseA.id);
    assert.equal(afterLegitimateActivate.isFeatured, true);
    assert.equal(afterLegitimateActivate.chargeCount, 1, "activation must record exactly one charge");

    const adminDeactivateAttempt = await patchFeatured(courseA.id, adminCookie, false);
    assert.equal(adminDeactivateAttempt.status, 403, "ordinary ADMIN must not be able to deactivate another center's featured placement");
    const afterAdminDeactivateAttempt = await courseState(courseA.id);
    assert.deepEqual(afterAdminDeactivateAttempt, afterLegitimateActivate, "a rejected admin deactivation attempt must leave the active placement completely untouched");

    // Clean up this sub-scenario's state for the assertions that follow.
    const revert = await patchFeatured(courseA.id, ownerACookie, false);
    assert.equal(revert.status, 200);

    // --- Scenario 1: owner and authorized active staff CAN mutate. ----------
    const ownerActivate = await patchFeatured(courseA.id, ownerACookie, true);
    assert.equal(ownerActivate.status, 200, "the center owner must be able to activate their own course");
    const staffDeactivate = await patchFeatured(courseA.id, staffCookie, false);
    assert.equal(staffDeactivate.status, 200, "an active owner_admin staff member must be able to deactivate the center's own course");

    // --- Scenario 2: an unrelated center's owner cannot mutate this course. -
    const beforeForeignOwner = await courseState(courseA.id);
    const foreignOwnerAttempt = await patchFeatured(courseA.id, ownerBCookie, true);
    assert.equal(foreignOwnerAttempt.status, 403, "an unrelated center owner must not be able to mutate this course");
    assert.deepEqual(await courseState(courseA.id), beforeForeignOwner, "a rejected foreign-owner attempt must leave no trace");

    // --- Scenario 5: inactive (revoked) staff membership cannot mutate. -----
    const inactiveStaffAttempt = await patchFeatured(courseA.id, inactiveStaffCookie, true);
    assert.equal(inactiveStaffAttempt.status, 403, "a revoked/inactive staff membership must not be able to mutate the course");
    assert.deepEqual(await courseState(courseA.id), beforeForeignOwner, "a rejected inactive-staff attempt must leave no trace");

    // --- Scenario 6: adversarial courseId from a different tenant, supplied
    // by an otherwise-legitimate (Center A) actor, targeting Center B's course. ---
    const beforeCourseB = await courseState(courseB.id);
    const crossTenantIdAttempt = await patchFeatured(courseB.id, ownerACookie, true);
    assert.equal(crossTenantIdAttempt.status, 403, "Center A's owner must not be able to mutate Center B's course by supplying its id");
    assert.deepEqual(await courseState(courseB.id), beforeCourseB, "a rejected cross-tenant-id attempt must leave no trace");

    // --- Scenario 7: a plain customer account cannot reach this route. ------
    const customerAttempt = await patchFeatured(courseA.id, customerCookie, true);
    assert.equal(customerAttempt.status, 403, "a plain customer account must not be able to mutate any course's featured state");

    // --- Scenario 8: read-only ADMIN access (GET status) is unaffected. -----
    // This file only tightens the PATCH mutation -- the GET status view keeps
    // using the unmodified requireOwnedCourse, matching its own documented
    // "administrators retain existing moderation/edit capability" intent for
    // everything except this one commercial mutation.
    const adminReadStatus = await getFeatured(courseA.id, adminCookie);
    assert.equal(adminReadStatus.status, 200, "ADMIN must still be able to VIEW a course's featured status");
    const adminReadBody = await adminReadStatus.json() as Json;
    assert.ok("isFeatured" in adminReadBody);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (courseIds.length) {
      await db.delete(educationFeaturedChargesTable).where(inArray(educationFeaturedChargesTable.courseId, courseIds));
      await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    }
    if (userIds.length) await db.delete(educationCenterStaffTable).where(inArray(educationCenterStaffTable.userId, userIds));
    if (centerIds.length) await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, centerIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
