/**
 * Integration tests for education session cancellation, waitlist promotion,
 * and the scheduled job hook.
 *
 * Covers:
 *  - Owner-initiated session cancellation with escrow refund
 *  - Admin-initiated session cancellation with escrow refund
 *  - Cancellation notifications (in-app records)
 *  - Waitlist entries cancelled when session is cancelled
 *  - Waitlist offer: next waiting user gets "offered" status with expiresAt
 *  - Scheduled job: processUpcomingEducationSessions runs without error
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationCenterStaffTable,
  educationEscrowsTable,
  educationBookingGroupsTable,
  educationBookingParticipantsTable,
  educationFinancialEventsTable,
  educationFinancialAuditLogTable,
  educationGiftVouchersTable,
  educationLedgerEntriesTable,
  educationNotificationsTable,
  educationOutboxTable,
  educationPriceSnapshotsTable,
  educationSessionEducatorsTable,
  educationInstallmentsTable,
  educationPlatformSettingsTable,
  educationWaitlistTable,
  pool,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";
import {
  VALID_TEST_IPS_SETTINGS,
  buildValidOnlineEducationCourse,
  buildValidOnlineEducationEnrollmentRequest,
} from "./education-test-fixtures";

const suffix = randomUUID();
const password = "education-sessions-test-password";
const SETTINGS_LOCK = "education-online-access-transfer-settings";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  cookie?: string;
  headers?: Record<string, string>;
};

async function request(baseUrl: string, path: string, options: RequestOptions = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function normalizedPersistedValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizedPersistedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, normalizedPersistedValue(nested)]));
  }
  return value;
}

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, `Login for ${email} must succeed.`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${sessionCookieName}=`), `Login for ${email} must set a cookie.`);
  return cookie!;
}

async function run(): Promise<void> {
  await ensureDemoData();
  const settingsLockClient = await pool.connect();
  await settingsLockClient.query("select pg_advisory_lock(hashtext($1))", [SETTINGS_LOCK]);

  let server: ReturnType<typeof app.listen> | undefined;
  const createdUserIds: string[] = [];
  const courseIds: string[] = [];
  const enrollmentIds: string[] = [];
  const giftVoucherIds: string[] = [];
  let centerId: string | undefined;
  let settingsSnapshot: typeof educationPlatformSettingsTable.$inferSelect | undefined;

  try {
    [settingsSnapshot] = await db.select().from(educationPlatformSettingsTable)
      .orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
    assert.ok(settingsSnapshot, "Global Education platform settings are required.");
    // Enrolling in a paid course renders IPS payment instructions from these
    // platform settings, and educationIpsQrPayload() refuses to render them
    // without a recipient name, account and purpose (the route answers 503).
    // seed() leaves all three null, so a database seeded from scratch - which
    // is what CI builds - had no recipient at all; setting only the account
    // environment was not enough. VALID_TEST_IPS_SETTINGS is the shared test
    // recipient the sibling Education suites already install, and it carries
    // ipsAccountEnvironment: "test", so it subsumes the previous update. The
    // snapshot taken above is restored in the finally block.
    await db.update(educationPlatformSettingsTable).set({ ...VALID_TEST_IPS_SETTINGS })
      .where(eq(educationPlatformSettingsTable.id, settingsSnapshot.id));
    // ── Fixture users ────────────────────────────────────────────────────────
    const passwordHash = await hashPassword(password);
    const fixtureUsers = await db.insert(usersTable).values([
      {
        firstName: "Sessions",
        lastName: "Admin",
        email: `sessions-admin-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SUPER_ADMIN" as const,
      },
      {
        firstName: "Sessions",
        lastName: "CenterOwner",
        email: `sessions-center-owner-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "EDUKATIVNI_CENTAR" as const,
      },
      {
        firstName: "Sessions",
        lastName: "Buyer",
        email: `sessions-buyer-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER" as const,
      },
      {
        firstName: "Sessions",
        lastName: "Waiter",
        email: `sessions-waiter-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "STUDENT" as const,
      },
    ]).returning();
    createdUserIds.push(...fixtureUsers.map((u) => u.id));
    const [adminUser, centerOwner, buyer, waiter] = fixtureUsers as [
      typeof usersTable.$inferSelect,
      typeof usersTable.$inferSelect,
      typeof usersTable.$inferSelect,
      typeof usersTable.$inferSelect,
    ];

    // ── Subscription plan ────────────────────────────────────────────────────
    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.active, true))
      .limit(1);
    assert.ok(plan, "An active subscription plan must exist for this test.");

    // ── Education center ─────────────────────────────────────────────────────
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: centerOwner.id,
      name: `Sessions test center ${suffix}`,
      city: "Beograd",
      description: "Izolovani centar za testiranje termina.",
      imageUrl: "/test-sessions.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: adminUser.id,
    }).returning();
    centerId = center!.id;

    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: center!.id,
      planId: plan.id,
      status: "active",
      dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // ── Platform settings ────────────────────────────────────────────────────
    await db.insert(educationPlatformSettingsTable).values({
      commissionPercent: 15,
      reservePercent: 10,
      onlineRefundDays: 14,
      liveAppealDays: 7,
    }).onConflictDoNothing();

    // ── Course with a live session ───────────────────────────────────────────
    const [course] = await db.insert(coursesTable).values({
      centerId: center!.id,
      title: `Sessions test course ${suffix}`,
      description: "Kurs za testiranje termina.",
      category: "Stilizovanje",
      format: "in-person",
      city: "Beograd",
      price: 5000,
      duration: "2 dana",
      imageUrl: "/test-sessions.jpg",
      published: true,
    }).returning();
    courseIds.push(course!.id);

    const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 8 * 60 * 60 * 1000);

    const [session] = await db.insert(courseSessionsTable).values({
      courseId: course!.id,
      startsAt: futureStart,
      endsAt: futureEnd,
      capacity: 2,
      reservedSeats: 0,
    }).returning();

    // ── Enrollment + escrow for buyer (simulates a settled purchase) ─────────
    const [enrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      sessionId: session!.id,
      status: "active",
      paymentStatus: "paid",
      accessGrantedAt: new Date(),
      auditData: { source: "test" },
    }).returning();
    enrollmentIds.push(enrollment!.id);

    // Update reserved seats to reflect the enrollment.
    await db.update(courseSessionsTable)
      .set({ reservedSeats: 1 })
      .where(eq(courseSessionsTable.id, session!.id));

    const settings = await db.select().from(educationPlatformSettingsTable).limit(1);
    const settingsRow = settings[0] ?? { commissionPercent: 15, reservePercent: 10, liveAppealDays: 7, onlineRefundDays: 14 };
    const platformFee = Math.floor(course!.price * settingsRow.commissionPercent / 100);
    const reserveAmount = Math.floor(course!.price * settingsRow.reservePercent / 100);
    const netAmount = course!.price - platformFee - reserveAmount;
    const releaseAt = new Date(futureEnd.getTime() + settingsRow.liveAppealDays * 24 * 60 * 60 * 1000);

    const [escrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: enrollment!.id,
      centerId: center!.id,
      grossAmount: course!.price,
      platformFee,
      reserveAmount,
      netAmount,
      releaseAt,
      status: "held",
      paymentReference: `test:${suffix}`,
    }).returning();
    const [operationalGroup] = await db.insert(educationBookingGroupsTable).values({
      centerId: center!.id, courseId: course!.id, sessionId: session!.id, purchaserId: waiter.id,
      createdByUserId: waiter.id, idempotencyKey: `retained-mixed-${suffix}`, requestFingerprint: "m".repeat(64), status: "active",
    }).returning();
    const [operationalParticipant] = await db.insert(educationBookingParticipantsTable).values({
      bookingGroupId: operationalGroup!.id, userId: waiter.id, fullName: "Operational learner", email: waiter.email, status: "reserved",
    }).returning();
    const [operationalSnapshot] = await db.insert(educationPriceSnapshotsTable).values({
      bookingGroupId: operationalGroup!.id, courseId: course!.id, grossAmount: 5_000, platformFee: 750,
      reserveAmount: 500, netAmount: 3_750, installmentCount: 2, depositDisposition: "refund",
    }).returning();
    await db.insert(educationInstallmentsTable).values([
      { priceSnapshotId: operationalSnapshot!.id, installmentNumber: 1, amount: 2_500, paymentReference: `MIX-A-${suffix}`, status: "settled", settledAt: new Date(), settledByUserId: adminUser.id },
      { priceSnapshotId: operationalSnapshot!.id, installmentNumber: 2, amount: 2_500, paymentReference: `MIX-B-${suffix}`, status: "pending" },
    ]);
    const [operationalEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: waiter.id, purchaserId: waiter.id, sessionId: session!.id,
      bookingGroupId: operationalGroup!.id, participantId: operationalParticipant!.id,
      status: "active", paymentStatus: "paid", chargedAmount: 2_500, accessGrantedAt: new Date(),
    }).returning();
    enrollmentIds.push(operationalEnrollment!.id);
    const [operationalEscrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: operationalEnrollment!.id, centerId: center!.id, grossAmount: 2_500,
      platformFee: 375, reserveAmount: 250, netAmount: 1_875, releaseAt, status: "held", paymentReference: `MIX-A-${suffix}`,
    }).returning();

    // ── Waitlist entry for waiter ────────────────────────────────────────────
    // Force the session to appear "full" so we can insert a waitlist entry.
    await db.update(courseSessionsTable)
      .set({ reservedSeats: 2 })
      .where(eq(courseSessionsTable.id, session!.id));

    const [waitlistEntry] = await db.insert(educationWaitlistTable).values({
      sessionId: session!.id,
      courseId: course!.id,
      userId: waiter.id,
      purchaserId: waiter.id,
      position: 1,
      status: "waiting",
    }).returning();

    // Both legacy and operational seats are reserved.
    await db.update(courseSessionsTable)
      .set({ reservedSeats: 2 })
      .where(eq(courseSessionsTable.id, session!.id));

    // ── Start server ─────────────────────────────────────────────────────────
    server = app.listen(0);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://localhost:${port}`;

    const adminCookie = await login(baseUrl, adminUser.email);
    const ownerCookie = await login(baseUrl, centerOwner.email);
    const buyerCookie = await login(baseUrl, buyer.email);
    const fixedCompatibilityCookie = await login(baseUrl, waiter.email);

    // Retained fixed-group creation must require an educator only when this
    // center actually has an active staff membership with the educator role.
    const fixedCompatibilityManagers = await db.insert(educationCenterStaffTable).values([
      { centerId: center!.id, userId: centerOwner.id, role: "owner_admin", active: true },
      { centerId: center!.id, userId: waiter.id, role: "manager_reception", active: true },
    ]).returning();
    const [inactiveEducator] = await db.insert(educationCenterStaffTable).values({
      centerId: center!.id, userId: buyer.id, role: "educator", active: false,
    }).returning();
    const [fixedCompatibilityCourse] = await db.insert(coursesTable).values({
      centerId: center!.id,
      title: `Fixed compatibility ${suffix}`,
      category: "Test",
      format: "in-person",
      price: 2_000,
      duration: "1h",
      imageUrl: "/fixed-compatibility.jpg",
      schedulingMode: "fixed_group",
      published: true,
    }).returning();
    courseIds.push(fixedCompatibilityCourse!.id);
    const fixedStart = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const fixedCreateBody = {
      startsAt: fixedStart.toISOString(),
      endsAt: new Date(fixedStart.getTime() + 3_600_000).toISOString(),
      capacity: 3,
    };
    const unassignedFixedResponse = await request(baseUrl, `/education/courses/${fixedCompatibilityCourse!.id}/sessions`, {
      method: "POST", cookie: ownerCookie, body: fixedCreateBody,
    });
    assert.equal(unassignedFixedResponse.status, 201);
    const unassignedFixed = await json<{ id: string; educatorStaffId: string | null }>(unassignedFixedResponse);
    assert.equal(unassignedFixed.educatorStaffId, null);
    const visibleFixedResponse = await request(baseUrl, `/education/courses/${fixedCompatibilityCourse!.id}/sessions`, {
      cookie: ownerCookie,
    });
    assert.equal(visibleFixedResponse.status, 200);
    assert.ok((await json<Array<{ id: string; educatorStaffId: string | null }>>(visibleFixedResponse))
      .some((row) => row.id === unassignedFixed.id && row.educatorStaffId === null));
    const legacyCompatibleBooking = await request(baseUrl, `/education/courses/${fixedCompatibilityCourse!.id}/enrollments`, {
      method: "POST", cookie: fixedCompatibilityCookie, body: { sessionId: unassignedFixed.id },
    });
    assert.equal(legacyCompatibleBooking.status, 201);
    enrollmentIds.push((await json<{ id: string }>(legacyCompatibleBooking)).id);

    await db.update(educationCenterStaffTable).set({ active: true })
      .where(eq(educationCenterStaffTable.id, inactiveEducator!.id));
    const activeMissingEducatorStart = new Date(fixedStart.getTime() + 2 * 3_600_000);
    const activeMissingEducatorBody = {
      ...fixedCreateBody,
      startsAt: activeMissingEducatorStart.toISOString(),
      endsAt: new Date(activeMissingEducatorStart.getTime() + 3_600_000).toISOString(),
    };
    assert.equal((await request(baseUrl, `/education/courses/${fixedCompatibilityCourse!.id}/sessions`, {
      method: "POST", cookie: ownerCookie, body: activeMissingEducatorBody,
    })).status, 400);
    const assignedFixedStart = new Date(fixedStart.getTime() + 4 * 3_600_000);
    const assignedFixedResponse = await request(baseUrl, `/education/courses/${fixedCompatibilityCourse!.id}/sessions`, {
      method: "POST",
      cookie: ownerCookie,
      body: {
        ...fixedCreateBody,
        startsAt: assignedFixedStart.toISOString(),
        endsAt: new Date(assignedFixedStart.getTime() + 3_600_000).toISOString(),
        educatorStaffId: inactiveEducator!.id,
      },
    });
    assert.equal(assignedFixedResponse.status, 201);
    const assignedFixed = await json<{ id: string; educatorStaffId: string | null }>(assignedFixedResponse);
    assert.equal(assignedFixed.educatorStaffId, inactiveEducator!.id);
    assert.equal((await db.select().from(educationSessionEducatorsTable)
      .where(eq(educationSessionEducatorsTable.sessionId, assignedFixed.id))).length, 1);
    // Restore the buyer's original lack of center permissions before the
    // retained cancellation authorization controls below.
    await db.update(educationCenterStaffTable).set({ active: false })
      .where(eq(educationCenterStaffTable.id, inactiveEducator!.id));
    await db.update(educationCenterStaffTable).set({ active: false })
      .where(eq(educationCenterStaffTable.id, fixedCompatibilityManagers[1]!.id));

    const retainedPatchBody = {
      startsAt: new Date(futureStart.getTime() + 60_000).toISOString(),
      endsAt: new Date(futureEnd.getTime() + 60_000).toISOString(),
      capacity: 4,
    };
    const operationalBeforePatch = (await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session!.id)))[0]!;
    const operationalPatch = await request(baseUrl, `/education/sessions/${session!.id}`, { method: "PATCH", cookie: ownerCookie, body: retainedPatchBody });
    assert.equal(operationalPatch.status, 409);
    assert.equal((await json<{ code: string }>(operationalPatch)).code, "OPERATIONAL_SESSION_REQUIRES_SCHEDULER");
    const operationalAfterPatch = (await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session!.id)))[0]!;
    assert.equal(operationalAfterPatch.startsAt.getTime(), operationalBeforePatch.startsAt.getTime());
    assert.equal(operationalAfterPatch.endsAt.getTime(), operationalBeforePatch.endsAt.getTime());
    assert.equal(operationalAfterPatch.capacity, operationalBeforePatch.capacity);
    const [legacyDraftCourse] = await db.insert(coursesTable).values({
      centerId: center!.id, title: `Draft legacy ${suffix}`, category: "Test", format: "in-person",
      price: 1_000, duration: "1h", imageUrl: "/draft.jpg", published: false,
    }).returning();
    courseIds.push(legacyDraftCourse!.id);
    const [legacyDraftSession] = await db.insert(courseSessionsTable).values({ courseId: legacyDraftCourse!.id, startsAt: futureStart, endsAt: futureEnd, capacity: 2 }).returning();
    const legacyPatch = await request(baseUrl, `/education/sessions/${legacyDraftSession!.id}`, { method: "PATCH", cookie: ownerCookie, body: retainedPatchBody });
    assert.equal(legacyPatch.status, 200);
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, legacyDraftSession!.id)))[0]!.capacity, 4);

    // ── 1. Owner cancel requires a reason ────────────────────────────────────
    const noReasonResponse = await request(baseUrl, `/education/sessions/${session!.id}/cancel`, {
      method: "POST",
      cookie: ownerCookie,
      body: {},
    });
    assert.equal(noReasonResponse.status, 400, "Cancel without reason must be rejected.");

    // ── 2. Buyer cannot cancel a session ─────────────────────────────────────
    const buyerCancelResponse = await request(baseUrl, `/education/sessions/${session!.id}/cancel`, {
      method: "POST",
      cookie: buyerCookie,
      body: { reason: "Kupac pokušava otkazati." },
    });
    assert.equal(buyerCancelResponse.status, 403, "Buyers must not be able to cancel sessions.");

    // ── 3. Owner successfully cancels the session ─────────────────────────────
    const cancelResponse = await request(baseUrl, `/education/sessions/${session!.id}/cancel`, {
      method: "POST",
      cookie: ownerCookie,
      body: { reason: "Nedovoljan broj polaznika — test." },
    });
    assert.equal(cancelResponse.status, 200, "Owner must be able to cancel a session.");
    const cancelResult = await json<{
      ok: boolean;
      sessionId: string;
      refundedEnrollments: number;
      cancelledWaitlistEntries: number;
      notifiedUsers: number;
    }>(cancelResponse);
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.sessionId, session!.id);
    assert.equal(cancelResult.refundedEnrollments, 2, "Both paid enrollment escrows must be refunded.");
    assert.equal(cancelResult.cancelledWaitlistEntries, 1, "The waiting waitlist entry must be cancelled.");
    assert.ok(cancelResult.notifiedUsers >= 2, "Both buyer and waiter must be notified.");

    // ── 4. Verify DB state after cancellation ─────────────────────────────────
    const [cancelledSession] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session!.id)).limit(1);
    assert.ok(cancelledSession?.cancelledAt, "Session must have cancelledAt set.");
    assert.equal(cancelledSession?.cancellationReason, "Nedovoljan broj polaznika — test.");

    const [refundedEscrow] = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, escrow!.id)).limit(1);
    assert.equal(refundedEscrow?.status, "refunded", "Escrow must be refunded.");

    const [cancelledEnrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollment!.id)).limit(1);
    assert.equal(cancelledEnrollment?.status, "cancelled", "Enrollment must be cancelled.");
    assert.equal(cancelledEnrollment?.paymentStatus, "refunded", "Payment status must be refunded.");
    assert.equal(cancelledEnrollment?.accessGrantedAt, null, "Cancellation must revoke legacy access.");
    const [cancelledOperationalEnrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, operationalEnrollment!.id)).limit(1);
    assert.equal(cancelledOperationalEnrollment?.status, "cancelled");
    assert.equal(cancelledOperationalEnrollment?.paymentStatus, "refunded");
    assert.equal(cancelledOperationalEnrollment?.accessGrantedAt, null);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, operationalGroup!.id)))[0]!.status, "cancelled");
    assert.equal((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, operationalParticipant!.id)))[0]!.status, "cancelled");
    assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, operationalEscrow!.id)))[0]!.status, "refunded");
    const mixedInstallments = await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, operationalSnapshot!.id));
    assert.equal(mixedInstallments.find((row) => row.installmentNumber === 1)!.refundedAmount, 2_500);
    assert.equal(mixedInstallments.find((row) => row.installmentNumber === 2)!.status, "cancelled");
    const cancellationOutbox = await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, session!.id));
    assert.equal(cancellationOutbox.filter((row) => row.participantId === operationalParticipant!.id && row.eventType === "session_cancelled").length, 1);
    assert.equal(cancellationOutbox.filter((row) => row.dedupeKey.endsWith(`legacy-enrollment:${enrollment!.id}`)).length, 1);
    assert.equal((cancellationOutbox.find((row) => row.dedupeKey.endsWith(`legacy-enrollment:${enrollment!.id}`))!.payload as any).legacyRecipient.userId, buyer.id);

    const [cancelledWaitlist] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, waitlistEntry!.id)).limit(1);
    assert.equal(cancelledWaitlist?.status, "cancelled", "Waitlist entry must be cancelled.");

    // Verify ledger entry was created.
    const ledgerEntries = await db.select().from(educationLedgerEntriesTable)
      .where(and(eq(educationLedgerEntriesTable.escrowId, escrow!.id), eq(educationLedgerEntriesTable.type, "refund")));
    assert.equal(ledgerEntries.length, 1, "One refund ledger entry must be created.");
    assert.equal(ledgerEntries[0]?.amount, -course!.price, "Refund amount must equal the gross course price (negative).");

    // Verify financial event.
    const financialEvents = await db.select().from(educationFinancialEventsTable)
      .where(and(eq(educationFinancialEventsTable.escrowId, escrow!.id), eq(educationFinancialEventsTable.eventType, "session_cancelled_refund")));
    assert.equal(financialEvents.length, 1, "One session_cancelled_refund event must be created.");

    // Verify in-app notifications were created.
    const buyerNotifications = await db.select().from(educationNotificationsTable)
      .where(and(eq(educationNotificationsTable.userId, buyer.id), eq(educationNotificationsTable.type, "session_cancelled")));
    assert.ok(buyerNotifications.length >= 1, "Buyer must have a session_cancelled notification.");

    const waiterNotifications = await db.select().from(educationNotificationsTable)
      .where(and(eq(educationNotificationsTable.userId, waiter.id), eq(educationNotificationsTable.type, "session_cancelled")));
    assert.ok(waiterNotifications.length >= 1, "Waiter must have a session_cancelled notification.");

    // ── 5. Idempotency: cancelling again must return 409 ─────────────────────
    const repeatCancelResponse = await request(baseUrl, `/education/sessions/${session!.id}/cancel`, {
      method: "POST",
      cookie: ownerCookie,
      body: { reason: "Ponovni pokušaj." },
    });
    assert.equal(repeatCancelResponse.status, 409, "Cancelling an already-cancelled session must return 409.");
    assert.equal((await db.select().from(educationLedgerEntriesTable).where(inArray(educationLedgerEntriesTable.escrowId, [escrow!.id, operationalEscrow!.id]))).length, 2);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, session!.id))).length, cancellationOutbox.length);

    // ── 6. Admin cancel route ────────────────────────────────────────────────
    // Create a fresh session + enrollment + escrow.
    const [session2] = await db.insert(courseSessionsTable).values({
      courseId: course!.id,
      startsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      capacity: 5,
      reservedSeats: 0,
    }).returning();

    const [enrollment2] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      sessionId: session2!.id,
      status: "active",
      paymentStatus: "paid",
      accessGrantedAt: new Date(),
      auditData: { source: "test" },
    }).returning();
    enrollmentIds.push(enrollment2!.id);

    await db.update(courseSessionsTable)
      .set({ reservedSeats: 1 })
      .where(eq(courseSessionsTable.id, session2!.id));

    const releaseAt2 = new Date(session2!.endsAt.getTime() + settingsRow.liveAppealDays * 24 * 60 * 60 * 1000);
    const [escrow2] = await db.insert(educationEscrowsTable).values({
      enrollmentId: enrollment2!.id,
      centerId: center!.id,
      grossAmount: course!.price,
      platformFee,
      reserveAmount,
      netAmount,
      releaseAt: releaseAt2,
      status: "held",
      paymentReference: `test2:${suffix}`,
    }).returning();

    const adminCancelResponse = await request(baseUrl, `/admin/education/sessions/${session2!.id}/cancel`, {
      method: "POST",
      cookie: adminCookie,
      body: { reason: "Administrator otkazuje termin." },
    });
    assert.equal(adminCancelResponse.status, 200, "Admin must be able to cancel a session via admin route.");
    const adminCancelResult = await json<{ ok: boolean; refundedEnrollments: number }>(adminCancelResponse);
    assert.equal(adminCancelResult.ok, true);
    assert.equal(adminCancelResult.refundedEnrollments, 1);

    const [refundedEscrow2] = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, escrow2!.id)).limit(1);
    assert.equal(refundedEscrow2?.status, "refunded", "Admin-cancelled session's escrow must be refunded.");

    // ── 7. Waitlist promotion test ───────────────────────────────────────────
    // Create a fresh session, fill it to capacity, add a waiting user,
    // then cancel one enrollment to free a seat and check if the promotion
    // would work correctly (we do this via the process endpoint).
    const [session3] = await db.insert(courseSessionsTable).values({
      courseId: course!.id,
      startsAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      capacity: 1,
      reservedSeats: 0,
    }).returning();

    const [waitlistEntry2] = await db.insert(educationWaitlistTable).values({
      sessionId: session3!.id,
      courseId: course!.id,
      userId: waiter.id,
      purchaserId: waiter.id,
      position: 1,
      status: "waiting",
    }).returning();

    // Mark a fake "offered" entry that is already expired so the process
    // endpoint will expire it and then try to promote the next entry.
    const [waitlistEntry3] = await db.insert(educationWaitlistTable).values({
      sessionId: session3!.id,
      courseId: course!.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      position: 0,
      status: "offered",
      offeredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    }).returning();

    // ── Minimum-enrollment scheduler boundaries and warning dedupe ───────────
    const schedulerNow = new Date();
    const createSchedulerCourse = async (label: string, deadline: Date) => {
      const [created] = await db.insert(coursesTable).values({
        centerId: center!.id,
        title: `Scheduler ${label} ${suffix}`,
        category: "Test",
        format: "in-person",
        price: 4_000,
        duration: "1h",
        imageUrl: "/scheduler.jpg",
        published: true,
        minimumEnrollmentRiskDeadline: deadline,
      }).returning();
      courseIds.push(created!.id);
      return created!;
    };
    const protectedCourse = await createSchedulerCourse("protected", new Date(schedulerNow.getTime() - 60_000));
    const protectedSessions = await db.insert(courseSessionsTable).values([
      {
        courseId: protectedCourse.id,
        startsAt: new Date(schedulerNow.getTime() - 30 * 60_000),
        endsAt: new Date(schedulerNow.getTime() + 30 * 60_000),
        capacity: 3, reservedSeats: 1, minimumEnrollments: 2,
      },
      {
        courseId: protectedCourse.id,
        startsAt: new Date(schedulerNow.getTime() - 2 * 60 * 60_000),
        endsAt: new Date(schedulerNow.getTime() - 60 * 60_000),
        capacity: 3, reservedSeats: 0, minimumEnrollments: 2,
      },
    ]).returning();
    const [protectedEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: protectedCourse.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      sessionId: protectedSessions[0]!.id,
      status: "active",
      paymentStatus: "paid",
      chargedAmount: 4_000,
      accessGrantedAt: new Date(),
    }).returning();
    enrollmentIds.push(protectedEnrollment!.id);
    const [protectedEscrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: protectedEnrollment!.id,
      centerId: center!.id,
      grossAmount: 4_000,
      platformFee: 600,
      reserveAmount: 400,
      netAmount: 3_000,
      releaseAt: new Date(schedulerNow.getTime() + 86_400_000),
      status: "held",
      paymentReference: `MIN-PROTECTED-${suffix}`,
    }).returning();
    const protectedBefore = {
      enrollment: protectedEnrollment!,
      escrow: protectedEscrow!,
      ledgerCount: (await db.select().from(educationLedgerEntriesTable)
        .where(eq(educationLedgerEntriesTable.enrollmentId, protectedEnrollment!.id))).length,
      outboxCount: (await db.select().from(educationOutboxTable)
        .where(eq(educationOutboxTable.sessionId, protectedSessions[0]!.id))).length,
    };

    const dueCourse = await createSchedulerCourse("due", new Date(schedulerNow.getTime() - 60_000));
    const [dueSession] = await db.insert(courseSessionsTable).values({
      courseId: dueCourse.id,
      startsAt: new Date(schedulerNow.getTime() + 48 * 60 * 60_000),
      endsAt: new Date(schedulerNow.getTime() + 49 * 60 * 60_000),
      capacity: 3, reservedSeats: 1, minimumEnrollments: 2,
    }).returning();
    const [dueEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: dueCourse.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      sessionId: dueSession!.id,
      status: "active",
      paymentStatus: "paid",
      chargedAmount: 4_000,
      accessGrantedAt: new Date(),
    }).returning();
    enrollmentIds.push(dueEnrollment!.id);
    const [dueEscrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: dueEnrollment!.id,
      centerId: center!.id,
      grossAmount: 4_000,
      platformFee: 600,
      reserveAmount: 400,
      netAmount: 3_000,
      releaseAt: new Date(schedulerNow.getTime() + 72 * 60 * 60_000),
      status: "held",
      paymentReference: `MIN-DUE-${suffix}`,
    }).returning();
    const dueNotificationsBefore = (await db.select().from(educationNotificationsTable)
      .where(and(eq(educationNotificationsTable.userId, buyer.id), eq(educationNotificationsTable.type, "session_cancelled")))).length;

    const warningCourse = await createSchedulerCourse("warning", new Date(schedulerNow.getTime() + 12 * 60 * 60_000));
    const [warningSession] = await db.insert(courseSessionsTable).values({
      courseId: warningCourse.id,
      startsAt: new Date(schedulerNow.getTime() + 48 * 60 * 60_000),
      endsAt: new Date(schedulerNow.getTime() + 49 * 60 * 60_000),
      capacity: 3, reservedSeats: 1, minimumEnrollments: 2,
    }).returning();
    const [warningGroup] = await db.insert(educationBookingGroupsTable).values({
      centerId: center!.id, courseId: warningCourse.id, sessionId: warningSession!.id,
      purchaserId: buyer.id, createdByUserId: buyer.id, idempotencyKey: `risk-${suffix}`,
      requestFingerprint: "r".repeat(64), status: "active",
    }).returning();
    const [warningParticipant] = await db.insert(educationBookingParticipantsTable).values({
      bookingGroupId: warningGroup!.id, userId: buyer.id, fullName: "Risk Learner", status: "reserved",
    }).returning();

    const distantWarningCourse = await createSchedulerCourse("distant-warning", new Date(schedulerNow.getTime() + 48 * 60 * 60_000));
    const [distantWarningSession] = await db.insert(courseSessionsTable).values({
      courseId: distantWarningCourse.id,
      startsAt: new Date(schedulerNow.getTime() + 72 * 60 * 60_000),
      endsAt: new Date(schedulerNow.getTime() + 73 * 60 * 60_000),
      capacity: 3, reservedSeats: 0, minimumEnrollments: 2,
    }).returning();
    const pastWarningCourse = await createSchedulerCourse("past-warning", new Date(schedulerNow.getTime() + 12 * 60 * 60_000));
    const [pastWarningSession] = await db.insert(courseSessionsTable).values({
      courseId: pastWarningCourse.id,
      startsAt: new Date(schedulerNow.getTime() - 30 * 60_000),
      endsAt: new Date(schedulerNow.getTime() + 30 * 60_000),
      capacity: 3, reservedSeats: 0, minimumEnrollments: 2,
    }).returning();

    // Session has capacity=1 and reservedSeats=0, so after expiry the
    // process hook should promote the waiter.
    const processResponse = await request(baseUrl, "/admin/education/sessions/process", {
      method: "POST",
      cookie: adminCookie,
    });
    assert.equal(processResponse.status, 200, "Scheduled job hook must succeed.");
    const processResult = await json<{
      ok: boolean;
      minimumCancelled: string[];
      waitlistExpired: number;
      waitlistPromoted: number;
    }>(processResponse);
    assert.equal(processResult.ok, true);
    assert.ok(processResult.waitlistExpired >= 1, "Expired waitlist offer must be counted.");
    assert.ok(processResult.waitlistPromoted >= 1, "Next waiting user must be promoted.");
    assert.ok(processResult.minimumCancelled.includes(dueSession!.id));
    assert.ok(!processResult.minimumCancelled.includes(protectedSessions[0]!.id));
    assert.ok(!processResult.minimumCancelled.includes(protectedSessions[1]!.id));
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, protectedSessions[0]!.id)))[0]!.cancelledAt, null);
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, protectedSessions[1]!.id)))[0]!.cancelledAt, null);
    assert.deepEqual((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, protectedEnrollment!.id)))[0], protectedBefore.enrollment);
    assert.deepEqual((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, protectedEscrow!.id)))[0], protectedBefore.escrow);
    assert.equal((await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, protectedEnrollment!.id))).length, protectedBefore.ledgerCount);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, protectedSessions[0]!.id))).length, protectedBefore.outboxCount);
    const cancelledDueEnrollment = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, dueEnrollment!.id)))[0]!;
    assert.equal(cancelledDueEnrollment.status, "cancelled");
    assert.equal(cancelledDueEnrollment.paymentStatus, "refunded");
    assert.equal(cancelledDueEnrollment.accessGrantedAt, null);
    assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, dueEscrow!.id)))[0]!.status, "refunded");
    assert.ok((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, dueSession!.id))).length >= 1);
    assert.ok((await db.select().from(educationNotificationsTable)
      .where(and(eq(educationNotificationsTable.userId, buyer.id), eq(educationNotificationsTable.type, "session_cancelled")))).length > dueNotificationsBefore);
    const warningRows = await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, warningSession!.id));
    assert.equal(warningRows.filter((row) => row.eventType === "minimum_enrollment_risk" && row.participantId === warningParticipant!.id).length, 1);
    assert.equal(warningRows.filter((row) => row.eventType === "minimum_enrollment_risk_manager").length, 1);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, distantWarningSession!.id))).length, 0);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, pastWarningSession!.id))).length, 0);
    const warningReplay = await request(baseUrl, "/admin/education/sessions/process", { method: "POST", cookie: adminCookie });
    assert.equal(warningReplay.status, 200);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, warningSession!.id))).length, warningRows.length);

    // Candidate selection happens before canonical cancellation acquires its
    // schedule lock. Reproduce that race and prove the DB-clock check under
    // the lock rejects a session which started while the scheduler waited.
    const raceCourse = await createSchedulerCourse("lock-race", new Date(schedulerNow.getTime() - 60_000));
    const [raceSession] = await db.insert(courseSessionsTable).values({
      courseId: raceCourse.id,
      startsAt: new Date(schedulerNow.getTime() + 96 * 60 * 60_000),
      endsAt: new Date(schedulerNow.getTime() + 97 * 60 * 60_000),
      capacity: 3, reservedSeats: 1, minimumEnrollments: 2,
    }).returning();
    const [raceEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: raceCourse.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      sessionId: raceSession!.id,
      status: "active",
      paymentStatus: "paid",
      chargedAmount: 4_000,
      accessGrantedAt: new Date(),
    }).returning();
    enrollmentIds.push(raceEnrollment!.id);
    const [raceEscrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: raceEnrollment!.id,
      centerId: center!.id,
      grossAmount: 4_000,
      platformFee: 600,
      reserveAmount: 400,
      netAmount: 3_000,
      releaseAt: new Date(schedulerNow.getTime() + 120 * 60 * 60_000),
      status: "held",
      paymentReference: `MIN-RACE-${suffix}`,
    }).returning();
    const raceBefore = {
      enrollment: raceEnrollment!,
      escrow: raceEscrow!,
      ledgerCount: (await db.select().from(educationLedgerEntriesTable)
        .where(eq(educationLedgerEntriesTable.enrollmentId, raceEnrollment!.id))).length,
      outboxCount: (await db.select().from(educationOutboxTable)
        .where(eq(educationOutboxTable.sessionId, raceSession!.id))).length,
      notificationCount: (await db.select().from(educationNotificationsTable)
        .where(and(eq(educationNotificationsTable.userId, buyer.id), eq(educationNotificationsTable.type, "session_cancelled")))).length,
    };
    let releaseScheduleLock!: () => void;
    let scheduleLockAcquired!: () => void;
    const scheduleLockRelease = new Promise<void>((resolve) => { releaseScheduleLock = resolve; });
    const scheduleLockReady = new Promise<void>((resolve) => { scheduleLockAcquired = resolve; });
    const heldScheduleLock = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education:schedule:center:${center!.id}`}))`);
      scheduleLockAcquired();
      await scheduleLockRelease;
    });
    await scheduleLockReady;
    const racedProcessPromise = request(baseUrl, "/admin/education/sessions/process", {
      method: "POST",
      cookie: adminCookie,
    });
    let observedBlockedScheduler = false;
    try {
      for (let attempt = 0; attempt < 250; attempt++) {
        const locks = (await db.execute(sql`
          select count(*)::int as count
          from pg_locks
          where locktype = 'advisory' and granted = false
        `)).rows as Array<{ count: number }>;
        if (Number(locks[0]?.count ?? 0) > 0) {
          observedBlockedScheduler = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(observedBlockedScheduler, true, "Scheduler must select the candidate and block on the held schedule lock.");
      const databaseClock = (await db.execute(sql`select now() as now`)).rows as Array<{ now: Date }>;
      const raceNow = new Date(databaseClock[0]!.now);
      await db.update(courseSessionsTable).set({
        startsAt: new Date(raceNow.getTime() - 2 * 60 * 60_000),
        endsAt: new Date(raceNow.getTime() - 60 * 60_000),
      }).where(eq(courseSessionsTable.id, raceSession!.id));
    } finally {
      releaseScheduleLock();
      await heldScheduleLock;
    }
    const racedProcessResponse = await racedProcessPromise;
    assert.equal(racedProcessResponse.status, 200);
    const racedProcess = await json<{ minimumCancelled: string[] }>(racedProcessResponse);
    assert.ok(!racedProcess.minimumCancelled.includes(raceSession!.id));
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, raceSession!.id)))[0]!.cancelledAt, null);
    assert.deepEqual((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, raceEnrollment!.id)))[0], raceBefore.enrollment);
    assert.deepEqual((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, raceEscrow!.id)))[0], raceBefore.escrow);
    assert.equal((await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, raceEnrollment!.id))).length, raceBefore.ledgerCount);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, raceSession!.id))).length, raceBefore.outboxCount);
    assert.equal((await db.select().from(educationNotificationsTable)
      .where(and(eq(educationNotificationsTable.userId, buyer.id), eq(educationNotificationsTable.type, "session_cancelled")))).length, raceBefore.notificationCount);

    // Verify the expired entry is now "expired".
    const [expiredEntry] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, waitlistEntry3!.id)).limit(1);
    assert.equal(expiredEntry?.status, "expired", "Timed-out offer must become expired.");

    // Verify the next waiting user was promoted to "offered".
    const [promotedEntry] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, waitlistEntry2!.id)).limit(1);
    assert.equal(promotedEntry?.status, "offered", "Next waiting user must be promoted to offered.");
    assert.ok(promotedEntry?.expiresAt, "Promoted entry must have an expiresAt.");
    const expiresInMs = promotedEntry!.expiresAt!.getTime() - Date.now();
    assert.ok(expiresInMs > 23 * 60 * 60 * 1000 && expiresInMs <= 24 * 60 * 60 * 1000 + 5000,
      "Offer expiry must be approximately 24 hours from now.");

    // ── Seat hold: the live offer must reserve exactly one seat so settlement
    //    and other buyers cannot bypass it during the 24-hour window. ─────────
    const [heldSession] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session3!.id)).limit(1);
    assert.equal(heldSession?.reservedSeats, 1, "A live waitlist offer must hold exactly one reserved seat.");
    assert.equal(heldSession!.reservedSeats, heldSession!.capacity, "The held seat must make the session appear full to other buyers.");

    // In-app notification for promoted user.
    const promotedNotifications = await db.select().from(educationNotificationsTable)
      .where(and(eq(educationNotificationsTable.userId, waiter.id), eq(educationNotificationsTable.type, "waitlist_offered")));
    assert.ok(promotedNotifications.length >= 1, "Promoted user must receive a waitlist_offered in-app notification.");

    // ── 7b. Accepting the held offer must NOT double-reserve the seat ────────
    const waiterCookie = await login(baseUrl, waiter.email);
    const acceptResponse = await request(baseUrl, `/education/waitlist/${promotedEntry!.id}/accept`, {
      method: "POST",
      cookie: waiterCookie,
    });
    assert.equal(acceptResponse.status, 201, "Accepting a live offer must succeed.");
    const acceptedEnrollment = await json<{ id: string; status: string; paymentStatus: string }>(acceptResponse);
    enrollmentIds.push(acceptedEnrollment.id);
    assert.equal(acceptedEnrollment.status, "pending", "Accepted offer must create a pending enrollment.");
    assert.equal(acceptedEnrollment.paymentStatus, "pending", "Accepted offer enrollment must be pending payment.");

    const [afterAcceptSession] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session3!.id)).limit(1);
    assert.equal(afterAcceptSession?.reservedSeats, 1, "Accepting the held offer must not push reservedSeats above the held seat.");

    const [enrolledEntry] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, promotedEntry!.id)).limit(1);
    assert.equal(enrolledEntry?.status, "enrolled", "Accepted offer entry must flip to enrolled.");

    // ── 7c. Expiring a held offer releases its seat and re-promotes ──────────
    const [seatHoldSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id,
      startsAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      capacity: 1,
      reservedSeats: 1, // an expired offer is holding this single seat
    }).returning();
    // The expired offer that holds the seat.
    const [expiringHeldOffer] = await db.insert(educationWaitlistTable).values({
      sessionId: seatHoldSession!.id,
      courseId: course!.id,
      userId: buyer.id,
      purchaserId: buyer.id,
      position: 0,
      status: "offered",
      offeredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    }).returning();
    // The next waiter that should inherit the released seat.
    const [nextWaiter] = await db.insert(educationWaitlistTable).values({
      sessionId: seatHoldSession!.id,
      courseId: course!.id,
      userId: waiter.id,
      purchaserId: waiter.id,
      position: 1,
      status: "waiting",
    }).returning();

    const process2 = await request(baseUrl, "/admin/education/sessions/process", { method: "POST", cookie: adminCookie });
    assert.equal(process2.status, 200, "Second process run must succeed.");

    const [reHeldSession] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, seatHoldSession!.id)).limit(1);
    assert.equal(reHeldSession?.reservedSeats, 1, "Released seat must be re-held by the newly promoted offer, staying at capacity.");
    const [expiredHeld] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, expiringHeldOffer!.id)).limit(1);
    assert.equal(expiredHeld?.status, "expired", "Timed-out held offer must become expired.");
    const [rePromoted] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, nextWaiter!.id)).limit(1);
    assert.equal(rePromoted?.status, "offered", "Next waiter must inherit the released seat as a new offer.");

    // ── 7d. Notifications + offers endpoint surfaces the active offer ────────
    const inboxResponse = await request(baseUrl, "/education/notifications", { cookie: waiterCookie });
    assert.equal(inboxResponse.status, 200, "Learner must be able to load their education inbox.");
    const inbox = await json<{ notifications: unknown[]; offers: { id: string; expiresAt: string | null }[] }>(inboxResponse);
    assert.ok(Array.isArray(inbox.offers), "Inbox must expose an offers array.");
    assert.ok(inbox.offers.some((o) => o.id === rePromoted!.id), "The active offer must appear in the learner's inbox.");

    // ── 7e. Gift refund payout boundary + one-transaction seat lifecycle ─────
    async function redeemedGiftFixture(format: "online" | "in-person", withWaiter = false) {
      const sharedCourse = {
        centerId: center!.id, title: `Gift refund ${format} ${randomUUID()}`,
        description: "Izolovani refund fixture.", category: "Stilizovanje",
        price: 5000, duration: "1 dan",
        imageUrl: "/gift-refund.jpg", published: true, giftVoucherEligible: true,
      };
      const courseValues = format === "online"
        ? buildValidOnlineEducationCourse({ ...sharedCourse, format, city: null })
        : { ...sharedCourse, format, city: "Beograd" };
      const [giftCourse] = await db.insert(coursesTable).values(courseValues).returning();
      courseIds.push(giftCourse!.id);
      let giftSession: typeof courseSessionsTable.$inferSelect | undefined;
      if (format === "in-person") {
        [giftSession] = await db.insert(courseSessionsTable).values({
          courseId: giftCourse!.id, startsAt: new Date(Date.now() + 40 * 86400_000),
          endsAt: new Date(Date.now() + 40 * 86400_000 + 3600_000), capacity: 1, reservedSeats: 0,
        }).returning();
      }
      const purchase = await request(baseUrl, "/education/gift-vouchers", {
        method: "POST", cookie: buyerCookie, headers: { "idempotency-key": randomUUID() },
        body: { courseId: giftCourse!.id, recipientUserId: buyer.id },
      });
      assert.equal(purchase.status, 201);
      const purchased = await json<{ id: string; redemptionCode: string }>(purchase);
      giftVoucherIds.push(purchased.id);
      assert.equal((await request(baseUrl, `/admin/education/gift-vouchers/${purchased.id}/settle`, {
        method: "POST", cookie: adminCookie, body: {},
      })).status, 200);
      const redeemed = await request(baseUrl, "/education/gift-vouchers/redeem", {
        method: "POST", cookie: buyerCookie,
        body: format === "online"
          ? buildValidOnlineEducationEnrollmentRequest({ code: purchased.redemptionCode })
          : { code: purchased.redemptionCode },
      });
      assert.equal(redeemed.status, 201);
      const enrollment = await json<{ id: string }>(redeemed);
      enrollmentIds.push(enrollment.id);
      let waiting: typeof educationWaitlistTable.$inferSelect | undefined;
      if (giftSession && withWaiter) {
        [waiting] = await db.insert(educationWaitlistTable).values({
          sessionId: giftSession.id, courseId: giftCourse!.id, userId: waiter.id,
          purchaserId: waiter.id, position: 1, status: "waiting",
        }).returning();
      }
      const [escrow] = await db.select().from(educationEscrowsTable)
        .where(eq(educationEscrowsTable.enrollmentId, enrollment.id)).limit(1);
      return { voucherId: purchased.id, enrollmentId: enrollment.id, escrow: escrow!, session: giftSession, waiting };
    }

    async function refundState(fixture: Awaited<ReturnType<typeof redeemedGiftFixture>>) {
      const [voucher] = await db.select().from(educationGiftVouchersTable).where(eq(educationGiftVouchersTable.id, fixture.voucherId));
      const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, fixture.enrollmentId));
      const [escrow] = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, fixture.escrow.id));
      const ledger = await db.select().from(educationLedgerEntriesTable)
        .where(eq(educationLedgerEntriesTable.enrollmentId, fixture.enrollmentId));
      const financialEvents = await db.select().from(educationFinancialEventsTable)
        .where(eq(educationFinancialEventsTable.enrollmentId, fixture.enrollmentId));
      const sessionRow = fixture.session
        ? (await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, fixture.session.id)))[0] : null;
      const waitlist = fixture.session
        ? await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.sessionId, fixture.session.id)) : [];
      return normalizedPersistedValue({
        voucher,
        enrollment,
        escrow,
        ledgerRows: ledger.sort((a, b) => a.id.localeCompare(b.id)),
        financialEventRows: financialEvents.sort((a, b) => a.id.localeCompare(b.id)),
        session: sessionRow,
        waitlistRows: waitlist.sort((a, b) => a.id.localeCompare(b.id)),
      }) as {
        voucher: typeof voucher; enrollment: typeof enrollment; escrow: typeof escrow;
        ledgerRows: Array<typeof educationLedgerEntriesTable.$inferSelect>;
        financialEventRows: Array<typeof educationFinancialEventsTable.$inferSelect>;
        session: typeof sessionRow;
        waitlistRows: Array<typeof educationWaitlistTable.$inferSelect>;
      };
    }

    for (const payoutCase of ["paid_out", "netPaidAt", "reservePaidAt"] as const) {
      const fixture = await redeemedGiftFixture("in-person", true);
      await db.update(educationEscrowsTable).set(
        payoutCase === "paid_out" ? { status: "paid_out" }
          : payoutCase === "netPaidAt" ? { netPaidAt: new Date() } : { reservePaidAt: new Date() },
      ).where(eq(educationEscrowsTable.id, fixture.escrow.id));
      const before = await refundState(fixture);
      const response = await request(baseUrl, `/admin/education/gift-vouchers/${fixture.voucherId}/refund`, {
        method: "POST", cookie: adminCookie, body: { note: `blocked ${payoutCase}` },
      });
      assert.equal(response.status, 409, `${payoutCase} must require post-payout reconciliation.`);
      assert.deepEqual(await refundState(fixture), before, `${payoutCase} rejection must be mutation-free.`);
    }

    const successful = await redeemedGiftFixture("in-person", true);
    const successBefore = await refundState(successful);
    const successResponse = await request(baseUrl, `/admin/education/gift-vouchers/${successful.voucherId}/refund`, {
      method: "POST", cookie: adminCookie, body: { note: "Atomic successful refund" },
    });
    assert.equal(successResponse.status, 200);
    const successState = await refundState(successful);
    assert.equal(successState.voucher.status, "refunded");
    assert.equal(successState.voucher.refundNote, "Atomic successful refund");
    assert.ok(successState.voucher.refundedAt);
    assert.equal(successState.voucher.refundedByUserId, adminUser.id);
    assert.equal(successState.voucher.disputeId, null);
    assert.equal(successState.enrollment.status, "cancelled");
    assert.equal(successState.enrollment.paymentStatus, "refunded");
    assert.equal(successState.escrow.status, "refunded");
    const originalSuccessLedger = successBefore.ledgerRows.filter((row) => row.type !== "refund");
    const retainedSuccessLedger = successState.ledgerRows.filter((row) => row.type !== "refund");
    assert.deepEqual(retainedSuccessLedger, originalSuccessLedger,
      "Refund must preserve every complete original ledger row unchanged.");
    assert.deepEqual(
      originalSuccessLedger.map((row) => row.type).sort(),
      ["charge", "platform_fee", "reserve_hold"],
      "Fixture must prove all three original voucher accounting rows are preserved.",
    );
    const successRefundLedger = successState.ledgerRows.filter((row) => row.type === "refund");
    assert.equal(successRefundLedger.length, 1);
    assert.equal(successRefundLedger[0]!.amount, -successful.escrow.grossAmount);
    assert.equal(successRefundLedger[0]!.idempotencyKey, `gift:${successful.voucherId}:refund`);
    assert.equal(successState.ledgerRows.length, successBefore.ledgerRows.length + 1,
      "Successful refund adds exactly one ledger row and no others.");
    const successRefundEvents = successState.financialEventRows
      .filter((row) => row.eventType === "enrollment_cancelled_refund");
    assert.equal(successRefundEvents.length, 1);
    assert.equal(successRefundEvents[0]!.previousStatus, "held");
    assert.equal(successRefundEvents[0]!.nextStatus, "refunded");
    assert.equal(successState.session?.reservedSeats, 1, "Promoted offer re-holds the released seat.");
    assert.equal(successState.waitlistRows.find((row) => row.id === successful.waiting!.id)?.status, "offered");
    const repeatedSuccess = await request(baseUrl, `/admin/education/gift-vouchers/${successful.voucherId}/refund`, {
      method: "POST", cookie: adminCookie, body: { note: "must not duplicate" },
    });
    assert.equal(repeatedSuccess.status, 409);
    assert.deepEqual(await refundState(successful), successState,
      "Repeated terminal refund cannot duplicate or mutate any persisted effect.");

    const rollback = await redeemedGiftFixture("in-person", true);
    const rollbackBefore = await refundState(rollback);
    await db.execute(sql`CREATE OR REPLACE FUNCTION education_test_reject_gift_refund() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'refunded' THEN RAISE EXCEPTION 'injected late voucher failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql.raw(`CREATE TRIGGER gift_refund_failure BEFORE UPDATE ON education_gift_vouchers
      FOR EACH ROW EXECUTE FUNCTION education_test_reject_gift_refund()`));
    const failed = await request(baseUrl, `/admin/education/gift-vouchers/${rollback.voucherId}/refund`, {
      method: "POST", cookie: adminCookie, body: { note: "must roll back" },
    });
    assert.equal(failed.status, 409);
    assert.deepEqual(await refundState(rollback), rollbackBefore, "Late failure must roll back finance, seat and waitlist.");
    await db.execute(sql.raw("DROP TRIGGER gift_refund_failure ON education_gift_vouchers"));
    await db.execute(sql.raw("DROP FUNCTION education_test_reject_gift_refund()"));
    const retry = await request(baseUrl, `/admin/education/gift-vouchers/${rollback.voucherId}/refund`, {
      method: "POST", cookie: adminCookie, body: { note: "retry succeeds" },
    });
    assert.equal(retry.status, 200);
    const retryState = await refundState(rollback);
    assert.equal(retryState.voucher.status, "refunded");
    assert.equal(retryState.enrollment.status, "cancelled");
    assert.equal(retryState.enrollment.paymentStatus, "refunded");
    assert.equal(retryState.escrow.status, "refunded");
    assert.deepEqual(
      retryState.ledgerRows.filter((row) => row.type !== "refund"),
      rollbackBefore.ledgerRows.filter((row) => row.type !== "refund"),
      "Retry must preserve complete original voucher ledger rows unchanged.",
    );
    assert.equal(retryState.ledgerRows.filter((row) => row.type === "refund").length, 1);
    assert.equal(retryState.ledgerRows.length, rollbackBefore.ledgerRows.length + 1);
    assert.equal(retryState.financialEventRows
      .filter((row) => row.eventType === "enrollment_cancelled_refund").length, 1);
    assert.equal(retryState.waitlistRows.filter((row) => row.status === "offered").length, 1);
    assert.equal(retryState.session?.reservedSeats, 1);
    const retryTerminalSnapshot = await refundState(rollback);
    assert.equal((await request(baseUrl, `/admin/education/gift-vouchers/${rollback.voucherId}/refund`, {
      method: "POST", cookie: adminCookie, body: { note: "second retry blocked" },
    })).status, 409);
    assert.deepEqual(await refundState(rollback), retryTerminalSnapshot);

    const online = await redeemedGiftFixture("online");
    assert.equal((await request(baseUrl, `/admin/education/gift-vouchers/${online.voucherId}/refund`, {
      method: "POST", cookie: adminCookie, body: { note: "online refund" },
    })).status, 200);
    const onlineState = await refundState(online);
    assert.equal(onlineState.session, null);
    assert.equal(onlineState.waitlistRows.length, 0);
    assert.equal(onlineState.ledgerRows.filter((row) => row.type === "refund").length, 1);
    assert.equal(onlineState.financialEventRows
      .filter((row) => row.eventType === "enrollment_cancelled_refund").length, 1);

    // Admin voucher operations are global (not purchaser/recipient scoped), but
    // the list remains code-safe and paginated for settlement/refund screens.
    const forbiddenVoucherList = await request(baseUrl, "/admin/education/gift-vouchers", {
      cookie: buyerCookie,
    });
    assert.equal(forbiddenVoucherList.status, 403);
    const adminVoucherList = await request(baseUrl, "/admin/education/gift-vouchers?status=refunded&page=1&pageSize=1", {
      cookie: adminCookie,
    });
    assert.equal(adminVoucherList.status, 200);
    const adminVoucherPage = await json<{ items: Array<Record<string, unknown>>; page: number; pageSize: number; total: number }>(adminVoucherList);
    assert.equal(adminVoucherPage.page, 1);
    assert.equal(adminVoucherPage.pageSize, 1);
    assert.ok(adminVoucherPage.total >= 3, "Unrelated admin sees all customer refunded vouchers.");
    assert.equal(adminVoucherPage.items.length, 1);
    assert.ok(typeof adminVoucherPage.items[0]!.maskedCode === "string");
    const adminVoucherSerialized = JSON.stringify(adminVoucherPage);
    assert.ok(!adminVoucherSerialized.includes("codeHash"));
    assert.ok(!adminVoucherSerialized.includes("redemptionCode"));
    assert.ok(!adminVoucherSerialized.includes("idempotencyKey"));
    console.log("✓ 6 voucher refund integration cases passed.");

    // ── 8. Non-admin cannot call the process endpoint ────────────────────────
    const buyerProcessResponse = await request(baseUrl, "/admin/education/sessions/process", {
      method: "POST",
      cookie: buyerCookie,
    });
    assert.equal(buyerProcessResponse.status, 403, "Non-admin must not be able to trigger the process endpoint.");
    const operationalRouteSource = await readFile(new URL("../routes/education-operations.ts", import.meta.url), "utf8");
    const cancellationServiceSource = await readFile(new URL("./education-sessions.ts", import.meta.url), "utf8");
    const centerCancelSource = operationalRouteSource.slice(
      operationalRouteSource.indexOf('router.post("/education/operations/centers/:centerId/sessions/:sessionId/cancel"'),
      operationalRouteSource.indexOf('router.get("/education/operations/bookings/:bookingGroupId/installments', operationalRouteSource.indexOf('router.post("/education/operations/centers/:centerId/sessions/:sessionId/cancel"')),
    );
    assert.match(centerCancelSource, /cancelEducationSession\(/);
    assert.doesNotMatch(centerCancelSource, /educationLedgerEntriesTable|type:\s*"refund"|for\s*\(const escrow/);
    assert.doesNotMatch(cancellationServiceSource, /cancelLegacyEducationSessionEnrollmentsInTx/);

    console.log("Education session cancellation, waitlist promotion, and scheduled job tests passed.");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    if (giftVoucherIds.length) {
      await db.delete(educationGiftVouchersTable).where(inArray(educationGiftVouchersTable.id, giftVoucherIds));
    }
    if (enrollmentIds.length) {
      await db.delete(educationFinancialEventsTable)
        .where(inArray(educationFinancialEventsTable.enrollmentId, enrollmentIds));
      await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, enrollmentIds));
    }
    if (courseIds.length) {
      const snapshots = await db.select({ id: educationPriceSnapshotsTable.id }).from(educationPriceSnapshotsTable)
        .where(inArray(educationPriceSnapshotsTable.courseId, courseIds));
      if (snapshots.length) {
        await db.delete(educationInstallmentsTable).where(inArray(educationInstallmentsTable.priceSnapshotId, snapshots.map((row) => row.id)));
        await db.delete(educationPriceSnapshotsTable).where(inArray(educationPriceSnapshotsTable.id, snapshots.map((row) => row.id)));
      }
      await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    }
    if (centerId) {
      await db.delete(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.centerId, centerId));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    }
    if (createdUserIds.length) {
      await db.delete(educationFinancialAuditLogTable)
        .where(inArray(educationFinancialAuditLogTable.actorUserId, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    try {
      if (settingsSnapshot) {
        await db.update(educationPlatformSettingsTable).set(settingsSnapshot)
          .where(eq(educationPlatformSettingsTable.id, settingsSnapshot.id));
      }
    } finally {
      try {
        await settingsLockClient.query("select pg_advisory_unlock(hashtext($1))", [SETTINGS_LOCK]);
      } finally {
        settingsLockClient.release();
      }
    }
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
