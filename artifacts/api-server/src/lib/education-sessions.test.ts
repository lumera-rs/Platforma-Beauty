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
import { and, eq, inArray } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationEscrowsTable,
  educationFinancialEventsTable,
  educationLedgerEntriesTable,
  educationNotificationsTable,
  educationPlatformSettingsTable,
  educationWaitlistTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const password = "education-sessions-test-password";

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

  let server: ReturnType<typeof app.listen> | undefined;
  const createdUserIds: string[] = [];
  const courseIds: string[] = [];
  const enrollmentIds: string[] = [];
  let centerId: string | undefined;

  try {
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
        role: "EDUCATION_CENTER_OWNER" as const,
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
        role: "CUSTOMER" as const,
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

    // Reset to 1 reserved seat (buyer).
    await db.update(courseSessionsTable)
      .set({ reservedSeats: 1 })
      .where(eq(courseSessionsTable.id, session!.id));

    // ── Start server ─────────────────────────────────────────────────────────
    server = app.listen(0);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://localhost:${port}`;

    const adminCookie = await login(baseUrl, adminUser.email);
    const ownerCookie = await login(baseUrl, centerOwner.email);
    const buyerCookie = await login(baseUrl, buyer.email);

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
    assert.equal(cancelResult.refundedEnrollments, 1, "The paid enrollment's escrow must be refunded.");
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

    // ── 8. Non-admin cannot call the process endpoint ────────────────────────
    const buyerProcessResponse = await request(baseUrl, "/admin/education/sessions/process", {
      method: "POST",
      cookie: buyerCookie,
    });
    assert.equal(buyerProcessResponse.status, 403, "Non-admin must not be able to trigger the process endpoint.");

    console.log("Education session cancellation, waitlist promotion, and scheduled job tests passed.");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    if (enrollmentIds.length) {
      await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, enrollmentIds));
    }
    if (courseIds.length) {
      await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    }
    if (centerId) {
      await db.delete(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.centerId, centerId));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    }
    if (createdUserIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
