import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { runEducationSubscriptionLifecycle } from "./education-subscription-worker";
import { getEducationPlatformSettings } from "./education-billing";
import {
  courseEnrollmentsTable, coursesTable, db, educationAccessExtensionsTable,
  educationCenterSubscriptionsTable, educationCentersTable, educationFinancialAuditLogTable,
  educationPaymentObligationsTable, educationPlatformSettingsTable, educationTrialClaimsTable, emailDeliveriesTable,
  sessionsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";

const marker = `edu-subscription-${randomUUID()}`;
const DAY = 86_400_000;
const userIds: string[] = [];
let centerId: string | undefined;
let observerCenterId: string | undefined;
let courseId: string | undefined;
const courseIds: string[] = [];
let planId: string | undefined;
let server: ReturnType<typeof app.listen> | undefined;
let settingsEnvironmentRestore: string | undefined;

const call = async (base: string, cookie: string, path: string, method = "GET", body?: unknown) => {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() as any };
};

try {
  const platformSettings = await getEducationPlatformSettings();
  settingsEnvironmentRestore = platformSettings.ipsAccountEnvironment;
  await db.update(educationPlatformSettingsTable).set({ ipsAccountEnvironment: "test" }).where(eq(educationPlatformSettingsTable.id, platformSettings.id));
  const [owner, learner1, learner2, learner3, observer, admin] = await db.insert(usersTable).values([
    { firstName: "Owner", lastName: marker, email: `owner-${marker}@example.test`, passwordHash: "fixture", passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
    { firstName: "Learner1", lastName: marker, email: `learner1-${marker}@example.test`, passwordHash: "fixture", passwordSetAt: new Date(), role: "STUDENT" },
    { firstName: "Learner2", lastName: marker, email: `learner2-${marker}@example.test`, passwordHash: "fixture", passwordSetAt: new Date(), role: "STUDENT" },
    { firstName: "Learner3", lastName: marker, email: `learner3-${marker}@example.test`, passwordHash: "fixture", passwordSetAt: new Date(), role: "STUDENT" },
    { firstName: "Observer", lastName: marker, email: `observer-${marker}@example.test`, passwordHash: "fixture", passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
    { firstName: "Admin", lastName: marker, email: `admin-${marker}@example.test`, passwordHash: "fixture", passwordSetAt: new Date(), role: "SUPER_ADMIN" },
  ]).returning();
  userIds.push(owner!.id, learner1!.id, learner2!.id, learner3!.id, observer!.id, admin!.id);
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: marker, price: 12_345, trialDays: 30, audience: "education", courseLimit: 5,
    vatIncluded: true, priceCopy: "Cena uključuje PDV.", limits: { courses: 5 }, active: true,
  }).returning();
  planId = plan!.id;
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: owner!.id, name: marker, city: "Beograd", description: marker,
    imageUrl: "/test.jpg", verificationStatus: "verified", bankAccount: "840000000000000000", bankAccountEnvironment: "test",
  }).returning();
  centerId = center!.id;
  const [observerCenter] = await db.insert(educationCentersTable).values({
    ownerId: observer!.id, name: `Observer ${marker}`, city: "Beograd", description: marker, imageUrl: "/test.jpg",
  }).returning();
  observerCenterId = observerCenter!.id;
  const [course] = await db.insert(coursesTable).values({
    centerId, title: marker, category: "Test", format: "online", price: 20_000,
    duration: "1h", imageUrl: "/test.jpg", published: true,
    extensionPrice1Month: 1_100, extensionPrice3Months: 2_900, extensionPrice6Months: 5_000,
  }).returning();
  courseId = course!.id;
  courseIds.push(course.id);
  const initialExpiry = new Date(Date.UTC(2027, 0, 15, 12));
  const learners = [learner1!, learner2!, learner3!];
  const enrollments = await db.insert(courseEnrollmentsTable).values(([1, 3, 6] as const).map((_months, index) => ({
    courseId: courseId!, userId: learners[index]!.id, purchaserId: learners[index]!.id, status: "active" as const,
    paymentStatus: "paid" as const, accessGrantedAt: new Date(), accessExpiresAt: initialExpiry,
    idempotencyKey: `${marker}-${index}`,
    accessDaysSnapshot: 30,
    extensionPricesSnapshot: { oneMonth: 1_111, threeMonths: 3_333, sixMonths: 6_666 },
  }))).returning();

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerCookie = `${sessionCookieName}=${await createSession(owner!.id)}`;
  const learnerCookies = await Promise.all(learners.map(async (learner) => `${sessionCookieName}=${await createSession(learner.id)}`));
  const observerCookie = `${sessionCookieName}=${await createSession(observer!.id)}`;
  const adminCookie = `${sessionCookieName}=${await createSession(admin!.id)}`;

  const selected = await call(base, ownerCookie, "/education/subscription/select-plan", "POST", { planId, billingCycle: "monthly" });
  assert.equal(selected.status, 201);
  assert.equal(selected.body.status, "trial");
  assert.equal((await db.select().from(educationTrialClaimsTable).where(eq(educationTrialClaimsTable.centerId, centerId))).length, 1);
  const selectedAgain = await call(base, ownerCookie, "/education/subscription/select-plan", "POST", { planId, billingCycle: "monthly" });
  assert.equal(selectedAgain.status, 201);
  assert.equal(selectedAgain.body.status, "trial", "Repeating the active plan selection must be idempotent.");
  assert.equal(selectedAgain.body.change, "unchanged");

  const [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
  assert.ok(subscription);
  await db.update(educationCenterSubscriptionsTable).set({
    status: "cancelled", currentPeriodStart: null, currentPeriodEnd: null,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  const selectedAfterCancellation = await call(base, ownerCookie, "/education/subscription/select-plan", "POST", { planId, billingCycle: "monthly" });
  assert.equal(selectedAfterCancellation.status, 201);
  assert.equal(selectedAfterCancellation.body.status, "past_due", "A consumed trial must not restart after cancellation.");
  for (const days of [7, 5, 2]) {
    await db.update(educationCenterSubscriptionsTable).set({
      status: "trial", trialEndsAt: new Date(Date.now() + (days - 0.25) * DAY),
      currentPeriodEnd: null, graceEndsAt: null,
    }).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
    await runEducationSubscriptionLifecycle();
  }
  const reminderRows = await db.select().from(emailDeliveriesTable)
    .where(like(emailDeliveriesTable.eventKey, `education-subscription-expiry:${subscription.id}:%`));
  assert.deepEqual(new Set(reminderRows.map((row) => Number((row.metadata as any).daysRemaining))), new Set([7, 5, 2]));

  const extraCourses = await db.insert(coursesTable).values([1, 2].map((index) => ({
    centerId: centerId!,
    title: `${marker} reactivation ${index}`,
    category: "Test",
    format: "online" as const,
    price: 20_000,
    duration: "1h",
    imageUrl: "/test.jpg",
    published: true,
  }))).returning();
  courseIds.push(...extraCourses.map((row) => row.id));

  await db.update(educationCenterSubscriptionsTable).set({
    status: "trial", trialEndsAt: new Date(Date.now() - DAY), currentPeriodEnd: null, graceEndsAt: null,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  await runEducationSubscriptionLifecycle();
  let [lifecycle] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  assert.equal(lifecycle!.status, "past_due");
  assert.ok(lifecycle!.graceEndsAt && lifecycle!.graceEndsAt > new Date());
  const graceStatus = await call(base, ownerCookie, "/education/subscription/status");
  assert.equal(graceStatus.status, 200);
  assert.equal(graceStatus.body.inGrace, true);
  assert.equal(graceStatus.body.graceDaysRemaining, 5, "Every status fetch must report server-derived Belgrade calendar days.");
  assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, courseId)))[0]!.published, true);

  await db.update(educationCenterSubscriptionsTable).set({ graceEndsAt: new Date(Date.now() - DAY) })
    .where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  await runEducationSubscriptionLifecycle();
  [lifecycle] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  assert.equal(lifecycle!.status, "suspended");
  assert.ok(lifecycle!.deactivatedAt);
  assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, courseId)))[0]!.published, false);
  const catalog = await call(base, observerCookie, `/education/courses?q=${encodeURIComponent(marker)}`);
  assert.equal(catalog.status, 200);
  assert.ok(!catalog.body.some((item: any) => item.id === courseId), "Suspended center must disappear from the public catalog.");
  for (let index = 0; index < enrollments.length; index++) {
    const purchases = await call(base, learnerCookies[index]!, "/education/purchases");
    assert.equal(purchases.status, 200);
    assert.ok(purchases.body.some((item: any) => item.id === enrollments[index]!.id),
      "Existing enrollment must remain readable after center suspension.");
  }

  const reactivated = await call(base, adminCookie, `/admin/education/centers/${centerId}/reactivate`, "POST", { reason: "Uplata potvrđena nakon provere" });
  assert.equal(reactivated.status, 409, "Admin reactivation must not create a paid period without settlement.");
  assert.equal((await call(base, adminCookie, `/admin/education/centers/${centerId}/reactivate`, "POST", { reason: "" })).status, 400,
    "Admin reactivation must require an audit reason.");

  const [renewal] = await db.select().from(educationPaymentObligationsTable)
    .where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscription.id),
      eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
      eq(educationPaymentObligationsTable.status, "pending"),
    )).limit(1);
  assert.ok(renewal, "Grace transition must leave a payable renewal obligation.");
  await db.update(educationPaymentObligationsTable).set({ courseLimitSnapshot: 1 })
    .where(eq(educationPaymentObligationsTable.id, renewal!.id));
  const settledRenewal = await call(base, adminCookie, `/admin/education/payment-obligations/${renewal!.id}/settle`, "POST", {
    confirmedAmountRsd: renewal!.expectedAmount,
    reason: "Tačna uplata za reaktivaciju",
  });
  assert.equal(settledRenewal.status, 200);
  [lifecycle] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  assert.equal(lifecycle!.status, "suspended", "Settlement must not bypass the explicit reactivation boundary.");
  assert.equal((await db.select().from(coursesTable).where(inArray(coursesTable.id, courseIds))).filter((row) => row.published).length, 0,
    "Settlement must not republish suspended courses before the center selects and admin reactivates.");

  const selectionStatus = await call(base, ownerCookie, "/education/subscription/status");
  assert.equal(selectionStatus.body.reactivation.state, "selection_required");
  assert.equal(selectionStatus.body.reactivation.requiredKeepCount, 1);
  assert.equal(selectionStatus.body.reactivation.candidateCourses.length, 3);
  assert.equal((await call(base, adminCookie, `/admin/education/centers/${centerId}/reactivate`, "POST", {
    reason: "Pokušaj pre izbora",
  })).status, 409);
  const chosenCourseId = extraCourses[0]!.id;
  const savedSelection = await call(base, ownerCookie, "/education/subscription/reactivation-selection", "POST", {
    keepCourseIds: [chosenCourseId],
  });
  assert.equal(savedSelection.status, 200);
  assert.equal(savedSelection.body.reactivation.state, "ready");

  const concurrentReactivations = await Promise.all([
    call(base, adminCookie, `/admin/education/centers/${centerId}/reactivate`, "POST", { reason: "Prva završna provera" }),
    call(base, adminCookie, `/admin/education/centers/${centerId}/reactivate`, "POST", { reason: "Konkurentna završna provera" }),
  ]);
  assert.deepEqual(concurrentReactivations.map((result) => result.status).sort(), [200, 409],
    "Concurrent reactivation attempts must produce one state transition.");
  const successfulReactivation = concurrentReactivations.find((result) => result.status === 200)!;
  assert.equal(successfulReactivation.body.subscription.plan.id, planId,
    "Reactivation response must include the plan required by the published API contract.");
  [lifecycle] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  assert.equal(lifecycle!.status, "active");
  const reactivationCourses = await db.select().from(coursesTable).where(inArray(coursesTable.id, courseIds));
  assert.deepEqual(reactivationCourses.filter((row) => row.published).map((row) => row.id), [chosenCourseId],
    "Only the course selected by the center may be republished.");
  const reactivationAudits = await db.select().from(educationFinancialAuditLogTable)
    .where(and(
      eq(educationFinancialAuditLogTable.entityId, centerId),
      eq(educationFinancialAuditLogTable.action, "education_center_reactivated"),
    ));
  assert.equal(reactivationAudits.length, 1, "One successful reactivation must create exactly one audit row.");

  const expiredPaidPeriod = new Date(Date.now() - 1_000);
  await db.update(educationCenterSubscriptionsTable).set({
    status: "suspended",
    deactivatedAt: new Date(),
    currentPeriodEnd: expiredPaidPeriod,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  await db.update(educationPaymentObligationsTable).set({ servicePeriodEnd: expiredPaidPeriod })
    .where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscription.id),
      eq(educationPaymentObligationsTable.status, "paid"),
    ));
  await db.update(coursesTable).set({ published: false, subscriptionSuspended: true })
    .where(eq(coursesTable.id, chosenCourseId));
  const customContract = await call(base, adminCookie, `/admin/education/centers/${centerId}/custom-contract`, "POST", {
    amountRsd: 55_000,
    billingCycle: "monthly",
    courseLimit: 1,
    autoRenew: true,
    contractEndsAt: new Date(Date.now() + 60 * DAY).toISOString(),
    reason: "Novi ugovor za deaktiviran centar",
  });
  assert.equal(customContract.status, 200);
  assert.equal(customContract.body.status, "suspended", "A custom contract must preserve the manual reactivation boundary.");
  assert.ok(customContract.body.deactivatedAt);
  const customInstructions = await call(base, ownerCookie, "/education/subscription/renewal-instructions", "POST");
  assert.equal(customInstructions.status, 200);
  const [customObligation] = await db.select().from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.referenceSnapshot, customInstructions.body.reference));
  assert.equal((await call(base, adminCookie, `/admin/education/payment-obligations/${customObligation!.id}/settle`, "POST", {
    confirmedAmountRsd: customObligation!.expectedAmount,
    reason: "Uplata posebnog ugovora",
  })).status, 200);
  [lifecycle] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription.id));
  assert.equal(lifecycle!.status, "suspended", "Custom-contract settlement must still require explicit admin reactivation.");
  assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, chosenCourseId)))[0]!.published, false,
    "Custom-contract settlement must not silently republish courses.");

  await db.update(coursesTable).set({
    extensionPrice1Month: 9_100, extensionPrice3Months: 9_300, extensionPrice6Months: 9_600,
  }).where(eq(coursesTable.id, courseId));
  await db.update(courseEnrollmentsTable).set({
    extensionPricesSnapshot: { oneMonth: 0, threeMonths: 3_333, sixMonths: 6_666 },
  }).where(eq(courseEnrollmentsTable.id, enrollments[0]!.id));
  assert.equal((await call(base, learnerCookies[0]!, `/education/enrollments/${enrollments[0]!.id}/extension`, "POST", { months: 1 })).status, 409,
    "Legacy zero extension snapshots are rejected cleanly.");
  assert.equal((await db.select().from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.enrollmentId, enrollments[0]!.id))).length, 0,
  "Zero-price rejection happens before payment-obligation creation.");
  await db.update(courseEnrollmentsTable).set({
    extensionPricesSnapshot: { oneMonth: 1_111, threeMonths: 3_333, sixMonths: 6_666 },
  }).where(eq(courseEnrollmentsTable.id, enrollments[0]!.id));
  const expected = [1_111, 3_333, 6_666];
  for (let index = 0; index < enrollments.length; index++) {
    const months = ([1, 3, 6] as const)[index]!;
    const enrollment = enrollments[index]!;
    const requested = await call(base, learnerCookies[index]!, `/education/enrollments/${enrollment.id}/extension`, "POST", { months });
    assert.equal(requested.status, 200);
    assert.equal(requested.body.extension.amount, expected[index]);
    const ips = JSON.parse(requested.body.payment.ipsPayloadSnapshot) as { payload: string };
    assert.match(ips.payload, new RegExp(`\\|I:RSD${expected[index]},00\\|`),
      "Access extensions use the canonical NBS amount field.");
    assert.equal(new Date(requested.body.extension.previousAccessExpiresAt).getTime(), initialExpiry.getTime());
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollment.id)))[0]!.accessExpiresAt!.getTime(), initialExpiry.getTime());
    const obligationId = requested.body.payment.id as string;
    assert.equal((await call(base, adminCookie, `/admin/education/payment-obligations/${obligationId}/settle`, "POST", {
      confirmedAmountRsd: expected[index]! - 1, reason: "Pogrešan iznos",
    })).status, 409);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollment.id)))[0]!.accessExpiresAt!.getTime(), initialExpiry.getTime());
    assert.equal((await call(base, adminCookie, `/admin/education/payment-obligations/${obligationId}/settle`, "POST", {
      confirmedAmountRsd: expected[index], reason: "Uplata potvrđena",
    })).status, 200);
    assert.equal((await call(base, adminCookie, `/admin/education/payment-obligations/${obligationId}/settle`, "POST", {
      confirmedAmountRsd: expected[index], reason: "Dupli pokušaj",
    })).status, 409);
    const [updatedEnrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollment.id));
    assert.ok(updatedEnrollment!.accessExpiresAt! > initialExpiry);
  }
  assert.equal((await db.select().from(educationAccessExtensionsTable)
    .where(inArray(educationAccessExtensionsTable.enrollmentId, enrollments.map((row) => row.id)))).filter((row) => row.status === "settled").length, 3);

  console.log("education subscription billing tests passed");
} finally {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (courseId) {
    const enrollmentIds = (await db.select({ id: courseEnrollmentsTable.id }).from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.courseId, courseId))).map((row) => row.id);
    if (enrollmentIds.length) {
      await db.delete(educationAccessExtensionsTable).where(inArray(educationAccessExtensionsTable.enrollmentId, enrollmentIds));
      await db.delete(educationPaymentObligationsTable).where(inArray(educationPaymentObligationsTable.enrollmentId, enrollmentIds));
      await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, enrollmentIds));
    }
  }
  if (centerId) {
    await db.delete(educationFinancialAuditLogTable).where(eq(educationFinancialAuditLogTable.entityId, centerId));
    const subscriptions = await db.select({ id: educationCenterSubscriptionsTable.id }).from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
    for (const subscription of subscriptions) {
      await db.delete(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.subscriptionId, subscription.id));
      await db.delete(educationFinancialAuditLogTable).where(eq(educationFinancialAuditLogTable.entityId, subscription.id));
      await db.delete(emailDeliveriesTable).where(like(emailDeliveriesTable.eventKey, `education-subscription-expiry:${subscription.id}:%`));
    }
    await db.delete(educationTrialClaimsTable).where(eq(educationTrialClaimsTable.centerId, centerId));
    await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
    if (courseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
  }
  if (observerCenterId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id, observerCenterId));
  if (userIds.length) {
    await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (planId) await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (settingsEnvironmentRestore) {
    const platformSettings = await getEducationPlatformSettings();
    await db.update(educationPlatformSettingsTable).set({ ipsAccountEnvironment: settingsEnvironmentRestore }).where(eq(educationPlatformSettingsTable.id, platformSettings.id));
  }
}