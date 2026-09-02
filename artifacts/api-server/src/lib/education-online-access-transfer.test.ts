import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  courseEnrollmentsTable, courseLessonsTable, courseModulesTable, coursesTable, db, educationCenterSubscriptionsTable,
  educationCentersTable, educationEscrowsTable, educationFinancialAuditLogTable,
  educationFinancialEventsTable, educationLedgerEntriesTable, educationPaymentObligationsTable,
  educationGiftVouchersTable, employeeLocationAssignmentsTable, employeesTable,
  lessonProgressTable, pool, salonsTable, sessionsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";
import { CreateEducationGroupEnrollmentsBody, RedeemEducationGiftVoucherBody } from "@workspace/api-zod";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { DIGITAL_CONTENT_CONSENT_TEXT, DIGITAL_CONTENT_CONSENT_VERSION } from "./education-entitlement";
import { ensureDemoData } from "./seed";
import {
  buildValidOnlineEducationCourse,
  buildValidOnlineEducationEnrollmentRequest,
  installTemporaryEducationIpsSettings,
} from "./education-test-fixtures";

const marker = `online-access-${randomUUID()}`;
async function request(base: string, cookie: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
}

async function run(): Promise<void> {
  await ensureDemoData();
  const { restore: restoreIpsSettings } = await installTemporaryEducationIpsSettings();
  let server: ReturnType<typeof app.listen> | undefined;
  const userIds: string[] = [];
  const employeeIds: string[] = [];
  let salonId: string | undefined;
  let foreignSalonId: string | undefined;
  let centerId: string | undefined;
  let courseId: string | undefined;
  let raceCourseId: string | undefined;
  let planId: string | undefined;
  try {
    const passwordHash = await hashPassword("online-access-test-password");
    const [admin, centerOwner, centerTransferTarget, owner, foreignOwner, sourceUser, targetUser, groupUser, inactiveUser, unlinkedUser, outsider] =
      await db.insert(usersTable).values([
        { firstName: "Admin", lastName: marker, email: `admin-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SUPER_ADMIN" },
        { firstName: "Center", lastName: marker, email: `center-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
        { firstName: "CenterTarget", lastName: marker, email: `center-target-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
        { firstName: "Owner", lastName: marker, email: `owner-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
        { firstName: "Foreign", lastName: marker, email: `foreign-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
        { firstName: "Source", lastName: marker, email: `source-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
        { firstName: "Target", lastName: marker, email: `target-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
        { firstName: "Group", lastName: marker, email: `group-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
        { firstName: "Inactive", lastName: marker, email: `inactive-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
        { firstName: "Unlinked", lastName: marker, email: `unlinked-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
        { firstName: "Outsider", lastName: marker, email: `outsider-${marker}@test.invalid`, passwordHash, passwordSetAt: new Date(), role: "STUDENT" },
      ]).returning();
    userIds.push(...[admin, centerOwner, centerTransferTarget, owner, foreignOwner, sourceUser, targetUser, groupUser, inactiveUser, unlinkedUser, outsider].map((user) => user!.id));

    const [plan] = await db.insert(subscriptionPlansTable).values({ name: marker, price: 1, active: true }).returning();
    planId = plan!.id;
    const [salon, foreignSalon] = await db.insert(salonsTable).values([
      { ownerId: owner!.id, name: marker, slug: `online-access-${randomUUID()}`, city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000", phone: "+381601110001", email: `salon-${marker}@test.invalid`, shortDescription: marker, description: marker, imageUrl: "/test.jpg" },
      { ownerId: foreignOwner!.id, name: `foreign-${marker}`, slug: `foreign-online-${randomUUID()}`, city: "Beograd", municipality: "Vračar", address: "Test 2", postalCode: "11000", phone: "+381601110002", email: `foreign-salon-${marker}@test.invalid`, shortDescription: marker, description: marker, imageUrl: "/test.jpg" },
    ]).returning();
    salonId = salon!.id; foreignSalonId = foreignSalon!.id;
    await db.update(usersTable).set({ activeSalonId: salonId }).where(eq(usersTable.id, owner!.id));
    const workers = await db.insert(employeesTable).values([
      { salonId, userId: sourceUser!.id, name: "Source", role: "Test", bio: "", avatarUrl: "" },
      { salonId, userId: targetUser!.id, name: "Target", role: "Test", bio: "", avatarUrl: "" },
      { salonId, userId: groupUser!.id, name: "Group", role: "Test", bio: "", avatarUrl: "" },
      { salonId, name: "Group Two", role: "Test", bio: "", avatarUrl: "" },
      { salonId, userId: inactiveUser!.id, name: "Inactive", role: "Test", bio: "", avatarUrl: "", active: false },
      { salonId, userId: unlinkedUser!.id, name: "Unlinked", role: "Test", bio: "", avatarUrl: "" },
    ]).returning();
    employeeIds.push(...workers.map((worker) => worker.id));
    const [source, target, groupWorker, groupWorkerTwo, inactive, unlinked] = workers;
    await db.insert(employeeLocationAssignmentsTable).values([
      { employeeId: source!.id, salonId, active: true, isDefault: true },
      { employeeId: target!.id, salonId, active: true, isDefault: true },
      { employeeId: groupWorker!.id, salonId, active: true, isDefault: true },
      { employeeId: groupWorkerTwo!.id, salonId, active: true, isDefault: true },
      { employeeId: inactive!.id, salonId, active: true, isDefault: true },
    ]);
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: centerOwner!.id, name: `center-${marker}`, city: "Beograd", description: marker, imageUrl: "/test.jpg",
      verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: admin!.id,
      bankAccount: "160000000000000000", bankAccountEnvironment: "test",
    }).returning();
    centerId = center!.id;
    await db.insert(educationCenterSubscriptionsTable).values({ centerId, planId, status: "active", dueAmount: 1, currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    const [course] = await db.insert(coursesTable).values(buildValidOnlineEducationCourse({
      centerId, title: marker, description: marker, category: "Test", format: "online", city: "Beograd",
      price: 12_000, duration: "4 nedelje", imageUrl: "/test.jpg", published: true, onlineAccessDays: 45,
      extensionPrice1Month: 1_000, extensionPrice3Months: 2_500, extensionPrice6Months: 4_000, giftVoucherEligible: true,
      certification: true,
    })).returning();
    courseId = course!.id;
    const [raceCourse] = await db.insert(coursesTable).values({
      centerId, title: `${marker}-consent-race`, description: marker, category: "Test", format: "hybrid", city: "Beograd",
      price: 11_000, duration: "3 nedelje", imageUrl: "/test.jpg", published: true, onlineAccessDays: 30,
      extensionPrice1Month: 900, extensionPrice3Months: 2_200, extensionPrice6Months: 3_800,
    }).returning();
    raceCourseId = raceCourse!.id;
    const [courseModule] = await db.insert(courseModulesTable).values({
      courseId, title: marker, description: marker, sortOrder: 1,
    }).returning();
    const [courseLesson] = await db.insert(courseLessonsTable).values({
      moduleId: courseModule!.id, title: marker, description: marker, content: marker, durationMinutes: 10, sortOrder: 1,
    }).returning();
    const [cancelledModule] = await db.insert(courseModulesTable).values({
      courseId: raceCourseId, title: `${marker}-cancelled`, description: marker, sortOrder: 1,
    }).returning();
    const [cancelledLesson] = await db.insert(courseLessonsTable).values({
      moduleId: cancelledModule!.id, title: `${marker}-cancelled`, description: marker, content: marker, durationMinutes: 10, sortOrder: 1,
    }).returning();
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookie = async (userId: string) => `${sessionCookieName}=${await createSession(userId)}`;
    const [centerOwnerCookie, centerTargetCookie, ownerCookie, foreignCookie, sourceCookie, targetCookie, outsiderCookie, adminCookie] = await Promise.all(
      [centerOwner!.id, centerTransferTarget!.id, owner!.id, foreignOwner!.id, sourceUser!.id, targetUser!.id, outsider!.id, admin!.id].map(cookie),
    );

    let directConsentRace!: Promise<{ status: number; body: any }>;
    await db.transaction(async (tx) => {
      await tx.select({ id: coursesTable.id }).from(coursesTable)
        .where(eq(coursesTable.id, raceCourseId!)).for("update");
      directConsentRace = request(base, outsiderCookie, `/education/courses/${raceCourseId}/enrollments`, "POST", {
        paymentMode: "online_full",
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      await tx.update(coursesTable).set({ format: "online" }).where(eq(coursesTable.id, raceCourseId!));
    });
    assert.equal((await directConsentRace).status, 409,
      "Direct enrollment must revalidate omitted consent after the locked course becomes online.");
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.courseId, raceCourseId!))).length, 0,
      "Direct consent race creates no enrollment or consent evidence.");

    await db.update(coursesTable).set({ format: "hybrid" }).where(eq(coursesTable.id, raceCourseId));
    let groupConsentRace!: Promise<{ status: number; body: any }>;
    await db.transaction(async (tx) => {
      await tx.select({ id: coursesTable.id }).from(coursesTable)
        .where(eq(coursesTable.id, raceCourseId!)).for("update");
      groupConsentRace = request(base, ownerCookie, `/education/courses/${raceCourseId}/group-enrollments`, "POST", {
        employeeIds: [groupWorker!.id],
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      await tx.update(coursesTable).set({ format: "online" }).where(eq(coursesTable.id, raceCourseId!));
    });
    assert.equal((await groupConsentRace).status, 409,
      "Group enrollment must revalidate omitted consent after the locked course becomes online.");
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.courseId, raceCourseId!))).length, 0,
      "Group consent race creates no enrollment or consent evidence.");

    await db.update(coursesTable).set({ format: "hybrid" }).where(eq(coursesTable.id, raceCourseId));
    assert.equal((await request(base, outsiderCookie, `/education/courses/${raceCourseId}/enrollments`, "POST", {
      paymentMode: "online_full",
    })).status, 201, "Non-online individual enrollment must not require digital-content consent.");
    assert.equal((await request(base, ownerCookie, `/education/courses/${raceCourseId}/group-enrollments`, "POST", {
      employeeIds: [groupWorker!.id, groupWorkerTwo!.id],
    })).status, 201, "Non-online group enrollment must not require digital-content consent.");

    assert.equal((await request(base, outsiderCookie, `/education/courses/${courseId}/enrollments`, "POST", { paymentMode: "online_full" })).status, 400,
      "Ordinary online enrollment requires explicit consent.");
    assert.equal((await request(base, ownerCookie, `/education/courses/${courseId}/group-enrollments`, "POST", {
      employeeIds: [groupWorker!.id],
    })).status, 400, "Online group enrollment requires explicit consent.");
    assert.deepEqual(
      CreateEducationGroupEnrollmentsBody.parse({
        employeeIds: [groupWorker!.id, groupWorkerTwo!.id],
        digitalContentConsent: true,
      }),
      {
        employeeIds: [groupWorker!.id, groupWorkerTwo!.id],
        digitalContentConsent: true,
      },
      "Generated group-enrollment contract accepts employee IDs and explicit digital-content consent.",
    );
    const group = await request(base, ownerCookie, `/education/courses/${courseId}/group-enrollments`, "POST", {
      ...buildValidOnlineEducationEnrollmentRequest({ employeeIds: [groupWorker!.id, groupWorkerTwo!.id] }),
    });
    assert.equal(group.status, 201);
    assert.equal(group.body.enrollments.length, 2, "Every selected group member receives a separate enrollment.");
    const groupEnrollmentIds = group.body.enrollments.map((item: { id: string }) => item.id);
    const groupedInstructions = group.body.paymentInstructions.find(
      (item: { enrollmentId: string }) => item.enrollmentId === groupEnrollmentIds[0],
    );
    const individualInstructions = await request(
      base,
      ownerCookie,
      `/education/enrollments/${groupEnrollmentIds[0]}/payment-instructions`,
      "GET",
    );
    assert.equal(individualInstructions.status, 200);
    assert.deepEqual(
      individualInstructions.body,
      groupedInstructions,
      "Group and individual flows expose the same IPS snapshot structure and settlement notice.",
    );
    assert.equal(
      groupedInstructions.settlementNotice,
      "Uplata i pristup kursu biće evidentirani tek nakon ručne potvrde LUMERA administracije.",
    );
    const pendingGroups = await db.select().from(courseEnrollmentsTable)
      .where(inArray(courseEnrollmentsTable.id, groupEnrollmentIds));
    assert.equal(pendingGroups.length, 2);
    for (const pendingGroup of pendingGroups) {
      assert.equal(pendingGroup.accessExpiresAt, null, "Pending online group access has no expiry before settlement.");
      assert.equal(pendingGroup.digitalContentConsentUserId, owner!.id);
      assert.ok(pendingGroup.digitalContentConsentAt, "Every grouped enrollment has a server-owned consent time.");
      assert.equal(pendingGroup.digitalContentConsentTextSnapshot, DIGITAL_CONTENT_CONSENT_TEXT);
      assert.equal(pendingGroup.digitalContentConsentVersionSnapshot, DIGITAL_CONTENT_CONSENT_VERSION);
    }
    assert.equal(
      new Set(pendingGroups.map((item) => item.id)).size,
      2,
      "Grouped consent evidence is persisted on two distinct enrollment rows.",
    );
    const groupEnrollmentId = groupEnrollmentIds[0]!;
    const pendingGroup = pendingGroups.find((item) => item.id === groupEnrollmentId)!;
    assert.equal(pendingGroup!.accessExpiresAt, null, "Pending online group access has no expiry before settlement.");
    assert.equal(pendingGroup!.digitalContentConsentUserId, owner!.id);
    assert.equal((await request(base, adminCookie, `/admin/education/enrollments/${groupEnrollmentId}/settle`, "POST")).status, 200);
    const [settledGroup] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, groupEnrollmentId));
    assert.ok(settledGroup!.accessGrantedAt && settledGroup!.accessExpiresAt);
    assert.equal(settledGroup!.accessExpiresAt!.getTime() - settledGroup!.accessGrantedAt!.getTime(), 45 * 86_400_000);

    const voucherPurchase = await request(base, ownerCookie, "/education/gift-vouchers", "POST", {
      courseId, recipientUserId: outsider!.id,
    });
    assert.equal(voucherPurchase.status, 400, "Gift voucher requires an idempotency key.");
    const voucherCreated = await fetch(`${base}/api/education/gift-vouchers`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "Idempotency-Key": `voucher-${marker}` },
      body: JSON.stringify({ courseId, recipientUserId: outsider!.id }),
    });
    assert.equal(voucherCreated.status, 201);
    const voucher = await voucherCreated.json() as { id: string; redemptionCode: string };
    assert.equal((await request(base, adminCookie, `/admin/education/gift-vouchers/${voucher.id}/settle`, "POST")).status, 200);
    assert.equal((await request(base, outsiderCookie, "/education/gift-vouchers/redeem", "POST", { code: voucher.redemptionCode })).status, 409,
      "Online voucher redemption requires explicit consent.");
    const redemption = await request(base, outsiderCookie, "/education/gift-vouchers/redeem", "POST", {
      ...buildValidOnlineEducationEnrollmentRequest({ code: voucher.redemptionCode }),
    });
    assert.deepEqual(
      RedeemEducationGiftVoucherBody.parse({ code: voucher.redemptionCode, digitalContentConsent: true }),
      { code: voucher.redemptionCode, digitalContentConsent: true },
      "Generated voucher redemption contract accepts explicit digital-content consent.",
    );
    assert.equal(redemption.status, 201);
    const [voucherEnrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, redemption.body.id));
    assert.equal(voucherEnrollment!.digitalContentConsentUserId, outsider!.id);
    assert.ok(voucherEnrollment!.accessGrantedAt && voucherEnrollment!.accessExpiresAt);
    assert.equal(voucherEnrollment!.accessExpiresAt!.getTime() - voucherEnrollment!.accessGrantedAt!.getTime(), 45 * 86_400_000);

    const pending = await request(base, ownerCookie, `/education/courses/${courseId}/enrollments`, "POST", {
      ...buildValidOnlineEducationEnrollmentRequest({ employeeId: source!.id, paymentMode: "online_full" }),
    });
    assert.equal(pending.status, 201);
    const enrollmentId = pending.body.id as string;
    const [beforeSettlement] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.deepEqual({
      price: beforeSettlement!.coursePriceSnapshot, duration: beforeSettlement!.durationSnapshot, days: beforeSettlement!.accessDaysSnapshot,
      extensions: beforeSettlement!.extensionPricesSnapshot, consentUser: beforeSettlement!.digitalContentConsentUserId,
      consentText: beforeSettlement!.digitalContentConsentTextSnapshot, consentVersion: beforeSettlement!.digitalContentConsentVersionSnapshot,
    }, { price: 12_000, duration: "4 nedelje", days: 45, extensions: { oneMonth: 1_000, threeMonths: 2_500, sixMonths: 4_000 },
      consentUser: owner!.id, consentText: DIGITAL_CONTENT_CONSENT_TEXT, consentVersion: DIGITAL_CONTENT_CONSENT_VERSION });
    assert.ok(beforeSettlement!.digitalContentConsentAt, "Consent time is server-owned.");
    await db.update(coursesTable).set({
      format: "hybrid", price: 99_000, duration: "99 dana", onlineAccessDays: 2,
      extensionPrice1Month: 9, extensionPrice3Months: 9, extensionPrice6Months: 9,
    }).where(eq(coursesTable.id, courseId));
    assert.equal((await request(base, adminCookie, `/admin/education/enrollments/${enrollmentId}/settle`, "POST")).status, 200);
    const [settled] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal(settled!.accessExpiresAt!.getTime(), settled!.accessGrantedAt!.getTime() + 45 * 86_400_000);
    assert.deepEqual(settled!.extensionPricesSnapshot, beforeSettlement!.extensionPricesSnapshot);
    assert.equal(settled!.coursePriceSnapshot, beforeSettlement!.coursePriceSnapshot);
    assert.equal(settled!.durationSnapshot, beforeSettlement!.durationSnapshot);
    await db.update(coursesTable).set({ format: "in-person" }).where(eq(coursesTable.id, courseId));

    assert.equal((await request(base, centerOwnerCookie, `/education/lessons/${courseLesson!.id}`, "DELETE")).status, 409,
      "A valid paid entitlement must protect a lesson from physical deletion.");
    assert.equal((await request(base, centerOwnerCookie, `/education/modules/${courseModule!.id}`, "DELETE")).status, 409,
      "A valid paid entitlement must protect a module and its lessons from physical deletion.");
    assert.equal((await db.select({ id: courseLessonsTable.id }).from(courseLessonsTable)
      .where(eq(courseLessonsTable.id, courseLesson!.id))).length, 1, "Rejected lesson deletion leaves content intact.");
    assert.equal((await request(base, centerOwnerCookie, `/education/courses/${courseId}`, "DELETE")).status, 204,
      "Archiving remains available while purchased private access exists.");
    const [archivedCourse] = await db.select({ archived: coursesTable.archived, published: coursesTable.published })
      .from(coursesTable).where(eq(coursesTable.id, courseId));
    assert.deepEqual(archivedCourse, { archived: true, published: false }, "Archive never physically removes protected course content.");

    const blockedShutdown = await request(base, adminCookie, `/admin/users/${centerOwner!.id}/business-role-transition`, "POST", {
      role: "CUSTOMER", active: false, activeSalonId: null,
      salonOwnerships: [], employments: [],
      educationCenterOwnerships: [{ relationId: centerId, action: "deactivate" }],
      instructorRelations: [],
    });
    assert.equal(blockedShutdown.status, 409, "A center with valid purchased access cannot be shut down with its owner account.");
    const [centerBeforeSuspension] = await db.select({ verificationStatus: educationCentersTable.verificationStatus })
      .from(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    assert.equal(centerBeforeSuspension!.verificationStatus, "verified", "Rejected shutdown is atomic.");

    await db.update(educationCentersTable).set({ verificationStatus: "suspended" }).where(eq(educationCentersTable.id, centerId));
    await db.update(educationCenterSubscriptionsTable).set({ status: "suspended" }).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
    assert.equal((await request(base, sourceCookie, `/education/enrollments/${enrollmentId}/lms`)).status, 200, "Suspension cannot revoke an unexpired purchased LMS entitlement.");
    assert.equal((await request(base, centerOwnerCookie, `/education/lessons/${courseLesson!.id}`, "DELETE")).status, 409,
      "Center suspension does not weaken protection for purchased private content.");
    assert.equal((await request(base, outsiderCookie, `/education/public/courses/${courseId}`)).status, 404);
    const catalog = await request(base, outsiderCookie, `/education/public/courses?q=${encodeURIComponent(marker)}`);
    assert.ok(!catalog.body.some((row: { id: string }) => row.id === courseId), "Suspended course must be absent from public listings.");

    const transfer = await request(base, ownerCookie, `/education/enrollments/${enrollmentId}/transfer`, "POST", { targetEmployeeId: target!.id });
    assert.equal(transfer.status, 200);
    const [transferred] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal(transferred!.employeeId, target!.id); assert.equal(transferred!.userId, targetUser!.id);
    for (const field of ["purchaserId", "coursePriceSnapshot", "durationSnapshot", "accessDaysSnapshot", "extensionPricesSnapshot", "digitalContentConsentAt", "digitalContentConsentUserId", "digitalContentConsentTextSnapshot", "digitalContentConsentVersionSnapshot", "accessExpiresAt"] as const) {
      assert.deepEqual(transferred![field], settled![field], `${field} must remain purchase evidence after transfer`);
    }
    assert.equal((await request(base, centerOwnerCookie, `/education/modules/${courseModule!.id}`, "DELETE")).status, 409,
      "A transferred valid entitlement still protects the original course content.");
    for (const [label, actorCookie, targetEmployeeId] of [
      ["cross salon", foreignCookie, source!.id], ["non owner", outsiderCookie, source!.id], ["inactive", ownerCookie, inactive!.id], ["unlinked", ownerCookie, unlinked!.id],
    ] as const) assert.equal((await request(base, actorCookie, `/education/enrollments/${enrollmentId}/transfer`, "POST", { targetEmployeeId })).status, 409, `${label} transfer rejected`);
    const concurrent = await Promise.all([
      request(base, ownerCookie, `/education/enrollments/${enrollmentId}/transfer`, "POST", { targetEmployeeId: source!.id }),
      request(base, ownerCookie, `/education/enrollments/${enrollmentId}/transfer`, "POST", { targetEmployeeId: source!.id }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 200).length, 1, "Concurrent transfer has at most one mutation.");
    assert.equal((await request(base, ownerCookie, `/education/enrollments/${enrollmentId}/transfer`, "POST", { targetEmployeeId: source!.id })).status, 409, "Stale source transfer is rejected.");
    await db.update(courseEnrollmentsTable).set({ accessExpiresAt: new Date(Date.now() - 1) }).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal((await request(base, ownerCookie, `/education/enrollments/${enrollmentId}/transfer`, "POST", { targetEmployeeId: target!.id })).status, 409, "Expired access cannot transfer.");
    const [afterExpiredTransfer] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal(afterExpiredTransfer!.employeeId, source!.id, "Expired transfer cannot mutate the immutable seat assignment.");
    assert.equal((await request(base, sourceCookie, `/education/enrollments/${enrollmentId}/lms`)).status, 403, "Expired access cannot open LMS.");
    assert.equal((await request(base, sourceCookie, `/education/enrollments/${enrollmentId}/lessons/${courseLesson!.id}/complete`, "POST")).status, 403,
      "Expired access cannot mutate lesson progress.");
    assert.equal((await db.select().from(lessonProgressTable).where(eq(lessonProgressTable.enrollmentId, enrollmentId))).length, 0,
      "Expired lesson completion must not write progress.");
    await db.update(courseEnrollmentsTable).set({ status: "completed", progress: 100, completedAt: new Date() }).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal((await request(base, sourceCookie, `/education/enrollments/${enrollmentId}/certificate`)).status, 403,
      "Expired completed enrollment cannot issue or download its certificate.");
    const [expiredCompleted] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal(expiredCompleted!.certificateNumber, null, "Expired certificate denial must happen before issuance.");
    await db.update(courseEnrollmentsTable).set({
      extensionPricesSnapshot: { ...expiredCompleted!.extensionPricesSnapshot!, oneMonth: 0 },
    }).where(eq(courseEnrollmentsTable.id, enrollmentId));
    const obligationsBeforeLegacyZero = await db.select().from(educationPaymentObligationsTable)
      .where(eq(educationPaymentObligationsTable.enrollmentId, enrollmentId));
    assert.equal((await request(base, sourceCookie, `/education/enrollments/${enrollmentId}/extension`, "POST", { months: 1 })).status, 409,
      "Snapshot-online enrollment remains extension-governed after a format edit, while a legacy zero price is rejected.");
    assert.equal((await db.select().from(educationPaymentObligationsTable)
      .where(eq(educationPaymentObligationsTable.enrollmentId, enrollmentId))).length, obligationsBeforeLegacyZero.length,
    "Rejected zero-price extension creates no payment obligation.");

    const raceEnrollments = await db.select({ id: courseEnrollmentsTable.id }).from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.courseId, raceCourseId));
    assert.ok(raceEnrollments.length >= 3, "Non-blocking access states need isolated enrollment fixtures.");
    await db.update(courseEnrollmentsTable).set({ status: "cancelled", paymentStatus: "paid" })
      .where(eq(courseEnrollmentsTable.id, raceEnrollments[0]!.id));
    await db.update(courseEnrollmentsTable).set({ status: "active", paymentStatus: "refunded" })
      .where(eq(courseEnrollmentsTable.id, raceEnrollments[1]!.id));
    const [pendingRaceEnrollment] = await db.select({
      status: courseEnrollmentsTable.status,
      paymentStatus: courseEnrollmentsTable.paymentStatus,
    }).from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, raceEnrollments[2]!.id));
    assert.deepEqual(pendingRaceEnrollment, { status: "pending", paymentStatus: "pending" });
    assert.equal((await request(base, centerOwnerCookie, `/education/lessons/${cancelledLesson!.id}`, "DELETE")).status, 204,
      "Cancelled, refunded, and pending access do not block lesson cleanup.");
    assert.equal((await request(base, centerOwnerCookie, `/education/modules/${cancelledModule!.id}`, "DELETE")).status, 204,
      "Cancelled, refunded, and pending access do not block module cleanup.");

    await db.update(courseEnrollmentsTable).set({ accessExpiresAt: new Date(Date.now() - 1) })
      .where(and(
        eq(courseEnrollmentsTable.courseId, courseId),
        inArray(courseEnrollmentsTable.status, ["active", "completed"]),
        eq(courseEnrollmentsTable.paymentStatus, "paid"),
      ));
    await db.update(courseEnrollmentsTable).set({
      status: "completed", accessExpiresAt: new Date(Date.now() + 86_400_000),
    }).where(eq(courseEnrollmentsTable.id, enrollmentId));
    assert.equal((await request(base, centerOwnerCookie, `/education/lessons/${courseLesson!.id}`, "DELETE")).status, 409,
      "Completed paid access remains protected until its online entitlement expires.");
    await db.update(courseEnrollmentsTable).set({ accessExpiresAt: new Date(Date.now() - 1) })
      .where(eq(courseEnrollmentsTable.id, enrollmentId));

    const ownershipLock = await pool.connect();
    await ownershipLock.query("select pg_advisory_lock(hashtext($1))", [`business-resource:education-center:${centerId}`]);
    const transferCenter = request(base, adminCookie, `/admin/users/${centerOwner!.id}/business-role-transition`, "POST", {
      role: "CUSTOMER", active: true, activeSalonId: null,
      salonOwnerships: [], employments: [],
      educationCenterOwnerships: [{ relationId: centerId, action: "transfer", targetUserId: centerTransferTarget!.id }],
      instructorRelations: [],
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const staleOwnerDelete = request(base, centerOwnerCookie, `/education/lessons/${courseLesson!.id}`, "DELETE");
    await new Promise(resolve => setTimeout(resolve, 100));
    await ownershipLock.query("select pg_advisory_unlock(hashtext($1))", [`business-resource:education-center:${centerId}`]);
    ownershipLock.release();
    const [transferredCenter, rejectedStaleDelete] = await Promise.all([transferCenter, staleOwnerDelete]);
    assert.equal(transferredCenter.status, 200, "Center ownership transfer must complete under the shared resource lock.");
    assert.equal(rejectedStaleDelete.status, 403,
      "A delete authorized before ownership transfer must revalidate and reject the former owner.");
    assert.equal((await db.select({ id: courseLessonsTable.id }).from(courseLessonsTable)
      .where(eq(courseLessonsTable.id, courseLesson!.id))).length, 1, "Stale owner cannot remove course content.");

    assert.equal((await request(base, centerTargetCookie, `/education/lessons/${courseLesson!.id}`, "DELETE")).status, 204,
      "Expired online entitlements do not block lesson cleanup.");
    assert.equal((await request(base, centerTargetCookie, `/education/modules/${courseModule!.id}`, "DELETE")).status, 204,
      "Expired online entitlements do not block module cleanup.");
    const allowedShutdown = await request(base, adminCookie, `/admin/users/${centerTransferTarget!.id}/business-role-transition`, "POST", {
      role: "CUSTOMER", active: false, activeSalonId: null,
      salonOwnerships: [], employments: [],
      educationCenterOwnerships: [{ relationId: centerId, action: "deactivate" }],
      instructorRelations: [],
    });
    assert.equal(allowedShutdown.status, 200, "Expired and cancelled access no longer blocks center shutdown.");
    console.log("education online access transfer tests passed");
  } finally {
    if (server) { server.close(); await once(server, "close"); }
    for (const cleanupCourseId of [courseId, raceCourseId].filter((id): id is string => Boolean(id))) {
      const ids = (await db.select({ id: courseEnrollmentsTable.id }).from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.courseId, cleanupCourseId))).map((row) => row.id);
      if (ids.length) {
        await db.delete(educationGiftVouchersTable).where(eq(educationGiftVouchersTable.courseId, cleanupCourseId));
        await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.entityId, ids));
        await db.delete(educationLedgerEntriesTable).where(inArray(educationLedgerEntriesTable.enrollmentId, ids));
        await db.delete(educationFinancialEventsTable).where(inArray(educationFinancialEventsTable.enrollmentId, ids));
        await db.delete(educationEscrowsTable).where(inArray(educationEscrowsTable.enrollmentId, ids));
        await db.delete(educationPaymentObligationsTable).where(inArray(educationPaymentObligationsTable.enrollmentId, ids));
        await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, ids));
      }
      await db.delete(coursesTable).where(eq(coursesTable.id, cleanupCourseId));
    }
    if (centerId) await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
    if (centerId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (foreignSalonId) await db.delete(salonsTable).where(eq(salonsTable.id, foreignSalonId));
    if (userIds.length) {
      await db.delete(educationFinancialAuditLogTable)
        .where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
    if (planId) await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
    await restoreIpsSettings();
  }
}

void run();