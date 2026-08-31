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
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationEscrowsTable,
  educationFinancialEventsTable,
  educationGiftVouchersTable,
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

  let server: ReturnType<typeof app.listen> | undefined;
  const createdUserIds: string[] = [];
  const courseIds: string[] = [];
  const enrollmentIds: string[] = [];
  const giftVoucherIds: string[] = [];
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

    // ── 7e. Gift refund payout boundary + one-transaction seat lifecycle ─────
    async function redeemedGiftFixture(format: "online" | "in-person", withWaiter = false) {
      const [giftCourse] = await db.insert(coursesTable).values({
        centerId: center!.id, title: `Gift refund ${format} ${randomUUID()}`,
        description: "Izolovani refund fixture.", category: "Stilizovanje", format,
        city: format === "online" ? null : "Beograd", price: 5000, duration: "1 dan",
        imageUrl: "/gift-refund.jpg", published: true, giftVoucherEligible: true,
      }).returning();
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
        method: "POST", cookie: buyerCookie, body: { code: purchased.redemptionCode },
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
