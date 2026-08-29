/**
 * Education session lifecycle automation.
 *
 * Responsibilities:
 *  - cancelEducationSession: owner/admin cancels a live session → refund all
 *    active escrows, expunge reserved-seat counts, notify enrolled students
 *    (in-app, email, SMS) and cancel all pending waitlist entries.
 *  - promoteWaitlistEntry: give the next "waiting" user a 24-hour offer,
 *    write an in-app notification, send email and SMS (best-effort).
 *  - expireWaitlistOffers: expire any "offered" entries whose deadline passed
 *    and cascade-promote the next waiting user.
 *  - processUpcomingEducationSessions: scheduled-job entry point; runs
 *    minimum-enrollment checks for sessions starting within 24 h and drains
 *    the waitlist offer queue.
 */

import {
  and,
  asc,
  eq,
  inArray,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import {
  courseEnrollmentsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationEscrowsTable,
  educationFinancialEventsTable,
  educationLedgerEntriesTable,
  educationNotificationsTable,
  educationWaitlistTable,
  usersTable,
} from "@workspace/db";
import { lumeraEmailHtml, sendTransactionalEmail } from "./brevo";
import { logger } from "./logger";
import { recordEducationEnrollmentReferralTransitionInTx } from "./referral-service";
import { notifyCustomer } from "./customer-notifications";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function lockEducationCenterFinancials(tx: any, centerId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`education-center:${centerId}`}))`,
  );
}

function emailSafe(value: string) {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/** Send an education-specific SMS through the platform integration. We import
 *  lazily to avoid a circular-dep risk; the send function is always available
 *  at runtime. */
async function sendEducationSms(input: {
  eventKey: string;
  phone: string | null | undefined;
  text: string;
}) {
  if (!input.phone) return { skipped: true };
  try {
    // Inline the bare-minimum delivery pattern rather than calling the
    // appointment-flavoured sendSms helper that requires salonId/appointmentId.
    const { integrationSettings } = await import("./integrations");
    const smsSettings = await integrationSettings("sms");
    if (!smsSettings.enabled) return { skipped: true };
    const apiKey =
      (smsSettings.values.apiKey as string | undefined) ??
      process.env["SMS_PROVIDER_API_KEY"];
    const baseUrl =
      (smsSettings.values.baseUrl as string | undefined) ??
      process.env["SMS_PROVIDER_BASE_URL"] ??
      "";
    const sender =
      (smsSettings.values.senderName as string | undefined) ??
      process.env["SMS_SENDER_NAME"] ??
      "LUMERA";
    if (!apiKey || !baseUrl) return { skipped: true };
    const apiBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const response = await fetch(`${apiBaseUrl}/sms/2/text/advanced`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `App ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        messages: [
          { destinations: [{ to: input.phone }], from: sender, text: input.text },
        ],
      }),
    });
    if (!response.ok) return { failed: true };
    return { sent: true };
  } catch (error) {
    logger.warn({ err: error, eventKey: input.eventKey }, "Education SMS delivery failed");
    return { failed: true };
  }
}

// ---------------------------------------------------------------------------
// Session cancellation
// ---------------------------------------------------------------------------

export type CancelEducationSessionResult = {
  sessionId: string;
  refundedEnrollments: number;
  cancelledWaitlistEntries: number;
  notifiedUsers: number;
};

/**
 * Cancel a course session, refund all paid escrows, and notify every enrolled
 * student and every waiting/offered waitlist entry.
 *
 * The caller must have already verified that the actor has permission to cancel
 * the session (owner of the course's center/salon, or admin).
 */
export async function cancelEducationSession(
  sessionId: string,
  actorUserId: string | null,
  reason: string,
): Promise<CancelEducationSessionResult> {
  // 1. Load session and course outside the transaction so we have the data for
  //    notifications even if the transaction rolls back early.
  const [session] = await db
    .select()
    .from(courseSessionsTable)
    .where(eq(courseSessionsTable.id, sessionId))
    .limit(1);
  if (!session) throw new Error("Termin nije pronađen.");
  if (session.cancelledAt) throw new Error("Termin je već otkazan.");

  const [course] = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, session.courseId))
    .limit(1);
  if (!course) throw new Error("Kurs nije pronađen.");

  const centerId = course.centerId;

  // 2. Transactional core: mark session cancelled, refund escrows, cancel
  //    waitlist entries, record ledger / audit events.
  const { refundedEnrollmentIds, cancelledWaitlistIds, enrolledUserIds } =
    await db.transaction(async (tx) => {
      // Take the center advisory lock (same key as all other financial ops).
      if (centerId) await lockEducationCenterFinancials(tx, centerId);

      // Re-read session under lock.
      const [locked] = await tx
        .select()
        .from(courseSessionsTable)
        .where(eq(courseSessionsTable.id, sessionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("Termin nije pronađen.");
      if (locked.cancelledAt) throw new Error("Termin je već otkazan.");

      // Mark session cancelled.
      await tx
        .update(courseSessionsTable)
        .set({ cancelledAt: new Date(), cancellationReason: reason })
        .where(eq(courseSessionsTable.id, sessionId));

      // Find all active enrollments for this session.
      const enrollments = await tx
        .select()
        .from(courseEnrollmentsTable)
        .where(
          and(
            eq(courseEnrollmentsTable.sessionId, sessionId),
            inArray(courseEnrollmentsTable.status, ["pending", "active"]),
          ),
        )
        .for("update");

      const enrollmentIds = enrollments.map((e) => e.id);

      // Find escrows for those enrollments and refund held/ready ones.
      const escrows = enrollmentIds.length
        ? await tx
            .select()
            .from(educationEscrowsTable)
            .where(
              and(
                inArray(educationEscrowsTable.enrollmentId, enrollmentIds),
                inArray(educationEscrowsTable.status, [
                  "held",
                  "ready_for_payout",
                  "frozen",
                ]),
              ),
            )
            .for("update")
        : [];

      const refundedEnrollmentIds: string[] = [];
      for (const escrow of escrows) {
        const [updated] = await tx
          .update(educationEscrowsTable)
          .set({ status: "refunded", updatedAt: new Date() })
          .where(
            and(
              eq(educationEscrowsTable.id, escrow.id),
              inArray(educationEscrowsTable.status, [
                "held",
                "ready_for_payout",
                "frozen",
              ]),
              sql`${educationEscrowsTable.netPaidAt} is null`,
              sql`${educationEscrowsTable.reservePaidAt} is null`,
            ),
          )
          .returning();
        if (!updated) continue;

        await tx.insert(educationLedgerEntriesTable).values({
          escrowId: escrow.id,
          enrollmentId: escrow.enrollmentId,
          centerId: escrow.centerId,
          type: "refund",
          amount: -escrow.grossAmount,
          note: `Termin je otkazan: ${reason}`,
          actorUserId,
          idempotencyKey: `education-session-cancel:${sessionId}:escrow:${escrow.id}`,
          metadata: { sessionId, reason },
        });

        await tx.insert(educationFinancialEventsTable).values({
          escrowId: escrow.id,
          enrollmentId: escrow.enrollmentId,
          actorUserId,
          eventType: "session_cancelled_refund",
          previousStatus: escrow.status,
          nextStatus: "refunded",
          amount: -escrow.grossAmount,
          note: reason,
          metadata: { sessionId, reason },
        });

        refundedEnrollmentIds.push(escrow.enrollmentId);
      }

      // Preserve each enrollment's payment state: only an enrollment whose
      // own escrow was refunded becomes refunded; pending requests stay pending.
      for (const enrollment of enrollments) {
        await tx.update(courseEnrollmentsTable).set({
          status: "cancelled",
          paymentStatus: refundedEnrollmentIds.includes(enrollment.id) ? "refunded" : enrollment.paymentStatus,
          updatedAt: new Date(),
        }).where(and(eq(courseEnrollmentsTable.id, enrollment.id), inArray(courseEnrollmentsTable.status, ["pending", "active"])));
        if (centerId) await recordEducationEnrollmentReferralTransitionInTx(tx, {
          enrollmentId: enrollment.id, studentUserId: enrollment.userId, centerId,
          occurredAt: new Date(), valid: false, reason: "education_session_cancelled",
        });
      }

      // Release reserved seats (set to 0 – session is cancelled).
      await tx
        .update(courseSessionsTable)
        .set({ reservedSeats: 0 })
        .where(eq(courseSessionsTable.id, sessionId));

      // Cancel all waiting/offered waitlist entries.
      const waitlistEntries = await tx
        .select()
        .from(educationWaitlistTable)
        .where(
          and(
            eq(educationWaitlistTable.sessionId, sessionId),
            inArray(educationWaitlistTable.status, ["waiting", "offered"]),
          ),
        )
        .for("update");

      const cancelledWaitlistIds = waitlistEntries.map((w) => w.id);
      if (cancelledWaitlistIds.length) {
        await tx
          .update(educationWaitlistTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(inArray(educationWaitlistTable.id, cancelledWaitlistIds));
      }

      // Collect all user IDs who need notifications.
      const enrolledUserIds = enrollments.map((e) => e.userId);
      const waitlistUserIds = waitlistEntries.map((w) => w.userId);
      const allUserIds = [...new Set([...enrolledUserIds, ...waitlistUserIds])];

      // Write in-app notification records for each affected user.
      for (const userId of allUserIds) {
        const eventKey = `education-session-cancel:${sessionId}:notify:${userId}`;
        await tx.insert(educationNotificationsTable).values({
          userId,
          type: "session_cancelled",
          title: "Termin edukacije je otkazan",
          body: `Termin kursa „${course.title}" je otkazan. ${reason ? reason.slice(0, 200) : ""}`.trim(),
          actionUrl: `/edukacije/${course.id}`,
          eventKey,
        }).onConflictDoNothing();
         await notifyCustomer(tx, {
           userId,
           eventKey: `education-session-cancel:${sessionId}:customer:${userId}`,
           category: "education",
           title: "Termin edukacije je otkazan",
           body: `Termin kursa „${course.title}" je otkazan.`,
           deepLink: `/edukacije/${course.id}`,
           metadata: { courseId: course.id, sessionId },
         });
      }

      return { refundedEnrollmentIds, cancelledWaitlistIds, enrolledUserIds: allUserIds };
    });

  // 3. Out-of-transaction: send email and SMS notifications (best-effort).
  const users = enrolledUserIds.length
    ? await db
        .select()
        .from(usersTable)
        .where(inArray(usersTable.id, enrolledUserIds))
    : [];

  await Promise.allSettled(
    users.map(async (user) => {
      await sendTransactionalEmail({
        eventKey: `education-session-cancel:${sessionId}:email:${user.id}`,
        emailType: "education_session_cancelled",
        to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
        subject: "LUMERA Edukacije — termin je otkazan",
        htmlContent: lumeraEmailHtml(
          "Termin edukacije je otkazan",
          `<p>Žao nam je, ali termin kursa <strong>${emailSafe(course.title)}</strong> je otkazan.</p>${reason ? `<p>Razlog: ${emailSafe(reason)}</p>` : ""}<p>Ako ste platili, povraćaj će biti obrađen prema platformskim pravilima.</p>`,
        ),
        metadata: { sessionId, courseId: course.id, reason },
      });
      // SMS: users who registered a phone can be fetched via their user record.
      // The usersTable does not expose phone directly (it's in salonCustomersTable
      // for CRM contacts), so we fire best-effort only for known phone fields.
      const phone = (user as any).phone as string | undefined;
      if (phone) {
        await sendEducationSms({
          eventKey: `education-session-cancel:${sessionId}:sms:${user.id}`,
          phone,
          text: `LUMERA Edukacije: termin kursa „${course.title}" je otkazan. ${reason ? reason.slice(0, 80) : ""}`.trim(),
        });
      }
    }),
  );

  return {
    sessionId,
    refundedEnrollments: refundedEnrollmentIds.length,
    cancelledWaitlistEntries: cancelledWaitlistIds.length,
    notifiedUsers: enrolledUserIds.length,
  };
}

// ---------------------------------------------------------------------------
// In-transaction seat release + promotion helper
// ---------------------------------------------------------------------------

/**
 * Release exactly one reserved seat on a session and promote exactly one
 * waiting waitlist entry if capacity is now available.  MUST be called from
 * inside a transaction that already holds the center advisory lock.  Locks the
 * session row itself.  Returns the promoted entry (so the caller can fire
 * out-of-transaction notifications) or null.
 *
 * Idempotency for seat accounting is the caller's responsibility: call this
 * exactly once per cancelled seat.
 */
export async function releaseSeatAndPromoteWaiter(
  tx: any,
  sessionId: string,
  course: typeof coursesTable.$inferSelect,
): Promise<typeof educationWaitlistTable.$inferSelect | null> {
  const [session] = await tx
    .select()
    .from(courseSessionsTable)
    .where(eq(courseSessionsTable.id, sessionId))
    .for("update")
    .limit(1);
  if (!session || session.cancelledAt) return null;

  const nextReserved = Math.max(0, session.reservedSeats - 1);
  if (nextReserved !== session.reservedSeats) {
    await tx
      .update(courseSessionsTable)
      .set({ reservedSeats: nextReserved })
      .where(eq(courseSessionsTable.id, session.id));
  }
  const refreshed = { ...session, reservedSeats: nextReserved };
  if (refreshed.reservedSeats < refreshed.capacity) {
    // The freed seat is not left available: promoteNextWaitlistEntry re-holds
    // it for the promoted offer's 24-hour window (net reservedSeats unchanged
    // when a waiter is promoted). Only if there is no waiter does the seat
    // actually stay free.
    return promoteNextWaitlistEntry(tx, refreshed, course);
  }
  return null;
}

/** Public best-effort wrapper so route handlers can notify a promoted waiter. */
export async function notifyPromotedWaiter(
  entry: typeof educationWaitlistTable.$inferSelect,
  course: typeof coursesTable.$inferSelect,
): Promise<void> {
  await sendWaitlistOfferNotifications(entry, course).catch((error) => {
    logger.warn({ err: error }, "Failed to send waitlist offer notifications");
  });
}

// ---------------------------------------------------------------------------
// Individual enrollment cancellation / refund
// ---------------------------------------------------------------------------

export type CancelEducationEnrollmentResult = {
  enrollmentId: string;
  refunded: boolean;
  seatReleased: boolean;
  promotedWaitlistId: string | null;
};

/**
 * Cancel a single course enrollment, refund its escrow (if any active/held one
 * exists), decrement the session's reservedSeats by exactly one and promote
 * exactly one waiting waitlist entry for that session.
 *
 * All of it happens under the center advisory lock and inside a single
 * transaction so seat accounting and waitlist promotion stay consistent under
 * concurrency. Refund is idempotent: an already-cancelled enrollment is a
 * no-op that returns refunded=false.
 *
 * The caller must have verified the actor is entitled to cancel this
 * enrollment (purchaser, owning center/salon, or admin). `refund` controls
 * whether the escrow is refunded; dispute-driven cancellations that already
 * handled the escrow separately can pass refund=false.
 */
export async function cancelEducationEnrollment(input: {
  enrollmentId: string;
  actorUserId: string;
  reason: string;
  refund?: boolean;
  /**
   * When true, skip refunding the escrow here (the caller already transitioned
   * it — e.g. dispute resolution) but still release the seat and promote a
   * waiter. The enrollment status/paymentStatus are left to the caller too.
   */
  seatOnly?: boolean;
}): Promise<CancelEducationEnrollmentResult> {
  const shouldRefund = input.refund ?? true;

  const [enrollment] = await db
    .select()
    .from(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.id, input.enrollmentId))
    .limit(1);
  if (!enrollment) throw new Error("Prijava nije pronađena.");

  const [course] = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, enrollment.courseId))
    .limit(1);
  if (!course) throw new Error("Kurs nije pronađen.");

  let promoted: typeof educationWaitlistTable.$inferSelect | null = null;

  const result = await db.transaction(async (tx) => {
    if (course.centerId) await lockEducationCenterFinancials(tx, course.centerId);

    // Re-read the enrollment under lock.
    const [locked] = await tx
      .select()
      .from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.id, input.enrollmentId))
      .for("update")
      .limit(1);
    if (!locked) throw new Error("Prijava nije pronađena.");
    // A fully-cancelled enrollment is a refund no-op. When the caller only
    // wants the seat released + a waiter promoted (seatOnly, e.g. after a
    // dispute refund already flipped the enrollment) we still continue.
    if (locked.status === "cancelled" && !input.seatOnly) {
      return { refunded: false, seatReleased: false } as const;
    }

    // Refund the escrow (best-effort; only active/held escrows are touched).
    let refunded = false;
    if (shouldRefund && !input.seatOnly) {
      const escrows = await tx
        .select()
        .from(educationEscrowsTable)
        .where(
          and(
            eq(educationEscrowsTable.enrollmentId, locked.id),
            inArray(educationEscrowsTable.status, ["held", "ready_for_payout", "frozen"]),
          ),
        )
        .for("update");
      for (const escrow of escrows) {
        const [updated] = await tx
          .update(educationEscrowsTable)
          .set({ status: "refunded", updatedAt: new Date() })
          .where(
            and(
              eq(educationEscrowsTable.id, escrow.id),
              inArray(educationEscrowsTable.status, ["held", "ready_for_payout", "frozen"]),
              sql`${educationEscrowsTable.netPaidAt} is null`,
              sql`${educationEscrowsTable.reservePaidAt} is null`,
            ),
          )
          .returning();
        if (!updated) continue;

        await tx.insert(educationLedgerEntriesTable).values({
          escrowId: escrow.id,
          enrollmentId: escrow.enrollmentId,
          centerId: escrow.centerId,
          type: "refund",
          amount: -escrow.grossAmount,
          note: `Prijava je otkazana: ${input.reason}`,
          actorUserId: input.actorUserId,
          idempotencyKey: `education-enrollment-cancel:${locked.id}:escrow:${escrow.id}`,
          metadata: { enrollmentId: locked.id, reason: input.reason },
        });

        await tx.insert(educationFinancialEventsTable).values({
          escrowId: escrow.id,
          enrollmentId: escrow.enrollmentId,
          actorUserId: input.actorUserId,
          eventType: "enrollment_cancelled_refund",
          previousStatus: escrow.status,
          nextStatus: "refunded",
          amount: -escrow.grossAmount,
          note: input.reason,
          metadata: { enrollmentId: locked.id, reason: input.reason },
        });
        refunded = true;
      }
    }

    // Mark the enrollment cancelled unless the caller manages that itself.
    if (!input.seatOnly) {
      await tx
        .update(courseEnrollmentsTable)
        .set({
          status: "cancelled",
          paymentStatus: refunded ? "refunded" : locked.paymentStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(courseEnrollmentsTable.id, locked.id),
            sql`${courseEnrollmentsTable.status} <> 'cancelled'`,
          ),
        );
      if (course.centerId) await recordEducationEnrollmentReferralTransitionInTx(tx, {
        enrollmentId: locked.id, studentUserId: locked.userId, centerId: course.centerId,
        occurredAt: new Date(), valid: false, reason: "education_enrollment_cancelled_or_refunded",
      });
    }

    // Release exactly one reserved seat and promote one waiter.
    let seatReleased = false;
    const holdsSeat = Boolean((locked.auditData as { seatReserved?: boolean } | null)?.seatReserved);
    if (locked.sessionId && holdsSeat) {
      const [session] = await tx
        .select({ reservedSeats: courseSessionsTable.reservedSeats })
        .from(courseSessionsTable)
        .where(eq(courseSessionsTable.id, locked.sessionId))
        .limit(1);
      const before = session?.reservedSeats;
      promoted = await releaseSeatAndPromoteWaiter(tx, locked.sessionId, course);
      const [after] = await tx
        .select({ reservedSeats: courseSessionsTable.reservedSeats })
        .from(courseSessionsTable)
        .where(eq(courseSessionsTable.id, locked.sessionId))
        .limit(1);
      seatReleased = before != null && after != null && after.reservedSeats < before;
    }

    return { refunded, seatReleased } as const;
  });

  // Out-of-transaction: notify the promoted waiter (best-effort).
  if (promoted) {
    await sendWaitlistOfferNotifications(promoted, course).catch((error) => {
      logger.warn({ err: error }, "Failed to send waitlist offer notifications after enrollment cancel");
    });
  }

  return {
    enrollmentId: input.enrollmentId,
    refunded: result.refunded,
    seatReleased: result.seatReleased,
    promotedWaitlistId: promoted ? (promoted as typeof educationWaitlistTable.$inferSelect).id : null,
  };
}

// ---------------------------------------------------------------------------
// Waitlist promotion
// ---------------------------------------------------------------------------

/**
 * Promote the next "waiting" entry for a session to "offered" status with a
 * 24-hour acceptance window.  Writes an in-app notification and fires email +
 * SMS (best-effort).
 *
 * IMPORTANT — seat hold: promoting a waiter ATOMICALLY reserves one seat on the
 * session for the duration of the 24-hour offer window.  While the offer is
 * live, the session's `reservedSeats` reflects that hold, so no regular buyer
 * and no admin settlement can claim the freed seat out from under the offered
 * waiter.  The held seat is only released when the offer is accepted (the seat
 * transfers to the resulting enrollment), expires, or the session is cancelled.
 *
 * The caller MUST have already verified there is capacity for the hold
 * (`reservedSeats < capacity`) under the session row lock.  If, under the lock,
 * capacity is no longer available, no offer is made and null is returned.
 *
 * Must be called from inside a transaction that already holds the center
 * advisory lock AND has locked the session row.  Returns the promoted entry, or
 * null if there are no waiting entries or no capacity to hold a seat.
 */
async function promoteNextWaitlistEntry(
  tx: any,
  session: typeof courseSessionsTable.$inferSelect,
  course: typeof coursesTable.$inferSelect,
): Promise<typeof educationWaitlistTable.$inferSelect | null> {
  // Guard: never offer without a seat to hold. The caller passes the
  // seat-locked session row; re-check capacity here so the hold is atomic.
  if (session.reservedSeats >= session.capacity) return null;

  const [next] = await tx
    .select()
    .from(educationWaitlistTable)
    .where(
      and(
        eq(educationWaitlistTable.sessionId, session.id),
        eq(educationWaitlistTable.status, "waiting"),
      ),
    )
    .orderBy(asc(educationWaitlistTable.position))
    .for("update")
    .limit(1);

  if (!next) return null;

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const offeredAt = new Date();

  const [promoted] = await tx
    .update(educationWaitlistTable)
    .set({
      status: "offered",
      offeredAt,
      expiresAt,
      notifiedAt: offeredAt,
      updatedAt: offeredAt,
    })
    .where(
      and(
        eq(educationWaitlistTable.id, next.id),
        eq(educationWaitlistTable.status, "waiting"),
      ),
    )
    .returning();

  if (!promoted) return null;

  // Hold the seat for the 24-hour offer window. Conditional on the observed
  // reservedSeats so a concurrent claim can't push us over capacity.
  const [held] = await tx
    .update(courseSessionsTable)
    .set({ reservedSeats: session.reservedSeats + 1 })
    .where(
      and(
        eq(courseSessionsTable.id, session.id),
        eq(courseSessionsTable.reservedSeats, session.reservedSeats),
        sql`${courseSessionsTable.reservedSeats} < ${courseSessionsTable.capacity}`,
      ),
    )
    .returning();
  if (!held) {
    // Capacity vanished under us; roll the entry back to waiting so no offer
    // exists without a held seat.
    await tx
      .update(educationWaitlistTable)
      .set({ status: "waiting", offeredAt: null, expiresAt: null, notifiedAt: null, updatedAt: new Date() })
      .where(eq(educationWaitlistTable.id, promoted.id));
    return null;
  }

  // In-app notification (inside transaction so it's atomic with the status change).
  await tx
    .insert(educationNotificationsTable)
    .values({
      userId: promoted.userId,
      waitlistId: promoted.id,
      type: "waitlist_offered",
      title: "Slobodno mesto je dostupno!",
      body: `Vaše mesto na listi čekanja za kurs „${course.title}" je sada dostupno. Prijavite se u roku od 24 sata.`,
      actionUrl: `/edukacije/${course.id}`,
      eventKey: `education-waitlist:${promoted.id}:offered`,
    })
    .onConflictDoNothing();
  await notifyCustomer(tx, {
    userId: promoted.userId,
    eventKey: `education-waitlist:${promoted.id}:offered:customer`,
    category: "education",
    title: "Slobodno mesto je dostupno!",
    body: `Vaše mesto za kurs „${course.title}" je dostupno naredna 24 sata.`,
    deepLink: `/edukacije/${course.id}`,
    metadata: { courseId: course.id, sessionId: session.id, waitlistId: promoted.id, expiresAt },
  });

  return promoted;
}

/**
 * Expire all "offered" waitlist entries whose 24-hour window has passed, then
 * cascade-promote the next "waiting" entry for each affected session.
 *
 * Safe to call repeatedly (idempotent per entry: once expired it won't be
 * re-processed).
 */
export async function expireWaitlistOffers(): Promise<{
  expired: number;
  promoted: number;
}> {
  // Find expired offers without taking a global lock first.
  const expiredEntries = await db
    .select()
    .from(educationWaitlistTable)
    .where(
      and(
        eq(educationWaitlistTable.status, "offered"),
        lte(educationWaitlistTable.expiresAt, new Date()),
      ),
    );

  let totalExpired = 0;
  let totalPromoted = 0;

  // Group by session so we can cascade per session once.
  const bySession = new Map<string, (typeof educationWaitlistTable.$inferSelect)[]>();
  for (const entry of expiredEntries) {
    const bucket = bySession.get(entry.sessionId) ?? [];
    bucket.push(entry);
    bySession.set(entry.sessionId, bucket);
  }

  for (const [sessionId, entries] of bySession) {
    const [session] = await db
      .select()
      .from(courseSessionsTable)
      .where(eq(courseSessionsTable.id, sessionId))
      .limit(1);
    if (!session || session.cancelledAt) continue;

    const [course] = await db
      .select()
      .from(coursesTable)
      .where(eq(coursesTable.id, session.courseId))
      .limit(1);
    if (!course) continue;

    // One transaction per session to keep the critical section tight.
    let promoted: typeof educationWaitlistTable.$inferSelect | null = null;
    await db.transaction(async (tx) => {
      if (course.centerId) await lockEducationCenterFinancials(tx, course.centerId);

      // Lock the session row up front: expiring an offer releases the seat that
      // offer was holding, so seat accounting must be serialized with the same
      // row lock every other capacity mutation takes.
      const [lockedSession] = await tx
        .select()
        .from(courseSessionsTable)
        .where(eq(courseSessionsTable.id, sessionId))
        .for("update")
        .limit(1);
      if (!lockedSession) return;

      // Lock and expire each timed-out offer, releasing its held seat.
      let releasedSeats = 0;
      for (const entry of entries) {
        const [expired] = await tx
          .update(educationWaitlistTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(educationWaitlistTable.id, entry.id),
              eq(educationWaitlistTable.status, "offered"),
              lte(educationWaitlistTable.expiresAt, new Date()),
            ),
          )
          .returning();
        if (expired) {
          totalExpired++;
          // Each live offer held exactly one seat. Release it (unless the
          // session was already cancelled, which zeroed reservedSeats).
          if (!lockedSession.cancelledAt) releasedSeats++;
          await tx
            .insert(educationNotificationsTable)
            .values({
              userId: entry.userId,
              waitlistId: entry.id,
              type: "waitlist_expired",
              title: "Ponuda za mesto je istekla",
              body: `Niste iskoristili ponudu za kurs „${course.title}". Vaše mesto je prepušteno sledećem korisniku.`,
              actionUrl: `/edukacije/${course.id}`,
              eventKey: `education-waitlist:${entry.id}:expired`,
            })
            .onConflictDoNothing();
        }
      }

      if (lockedSession.cancelledAt) return;

      // Apply the released seats to the locked session row.
      let currentReserved = lockedSession.reservedSeats;
      if (releasedSeats > 0) {
        currentReserved = Math.max(0, lockedSession.reservedSeats - releasedSeats);
        await tx
          .update(courseSessionsTable)
          .set({ reservedSeats: currentReserved })
          .where(eq(courseSessionsTable.id, sessionId));
      }

      // Re-promote the next waiter, re-holding one of the just-freed seats for
      // the new 24-hour window.
      const refreshed = { ...lockedSession, reservedSeats: currentReserved };
      if (refreshed.reservedSeats < refreshed.capacity) {
        promoted = await promoteNextWaitlistEntry(tx, refreshed, course);
        if (promoted) totalPromoted++;
      }
    });

    // Out-of-transaction: send offer notifications (best-effort).
    if (promoted) {
      await sendWaitlistOfferNotifications(promoted, course).catch((error) => {
        logger.warn({ err: error }, "Failed to send waitlist offer notifications");
      });
    }
  }

  return { expired: totalExpired, promoted: totalPromoted };
}

/** Fire email + SMS for a waitlist "offered" promotion (best-effort). */
async function sendWaitlistOfferNotifications(
  entry: typeof educationWaitlistTable.$inferSelect,
  course: typeof coursesTable.$inferSelect,
) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, entry.userId))
    .limit(1);
  if (!user) return;

  await sendTransactionalEmail({
    eventKey: `education-waitlist:${entry.id}:offered:email`,
    emailType: "education_waitlist_offered",
    to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
    subject: "LUMERA Edukacije — slobodno mesto je dostupno!",
    htmlContent: lumeraEmailHtml(
      "Slobodno mesto je dostupno!",
      `<p>Vaše mesto na listi čekanja za kurs <strong>${emailSafe(course.title)}</strong> je sada dostupno.</p><p>Imate <strong>24 sata</strong> da prihvatite ponudu i dovršite prijavu.</p><p><a href="/edukacije/${course.id}">Prijavite se odmah →</a></p>`,
    ),
    metadata: {
      waitlistId: entry.id,
      sessionId: entry.sessionId,
      courseId: course.id,
      expiresAt: entry.expiresAt?.toISOString(),
    },
  });

  const phone = (user as any).phone as string | undefined;
  if (phone) {
    await sendEducationSms({
      eventKey: `education-waitlist:${entry.id}:offered:sms`,
      phone,
      text: `LUMERA Edukacije: Slobodno mesto za kurs „${course.title}"! Prijavite se u narednih 24h.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Minimum-enrollment auto-cancellation
// ---------------------------------------------------------------------------

/**
 * Find sessions with a set minimum-enrollment threshold that start in the
 * next `horizonMs` milliseconds and haven't yet met the minimum.  Cancel them
 * automatically and fire full refund + notification pipelines.
 */
async function cancelSessionsBelowMinimum(
  horizonMs = 24 * 60 * 60 * 1000,
): Promise<{ cancelled: string[] }> {
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonMs);

  const sessions = await db
    .select()
    .from(courseSessionsTable)
    .where(
      and(
        sql`${courseSessionsTable.minimumEnrollments} is not null`,
        sql`${courseSessionsTable.cancelledAt} is null`,
        lt(courseSessionsTable.startsAt, horizon),
        sql`${courseSessionsTable.startsAt} > now()`,
        sql`${courseSessionsTable.reservedSeats} < ${courseSessionsTable.minimumEnrollments}`,
      ),
    );

  const cancelled: string[] = [];
  for (const session of sessions) {
    try {
      await cancelEducationSession(
        session.id,
        null,
        "Minimalni broj polaznika nije dostignut.",
      );
      cancelled.push(session.id);
    } catch (error) {
      logger.warn(
        { err: error, sessionId: session.id },
        "Auto-cancel below minimum failed",
      );
    }
  }
  return { cancelled };
}

// ---------------------------------------------------------------------------
// Scheduled job entry point
// ---------------------------------------------------------------------------

export type ProcessUpcomingEducationSessionsResult = {
  minimumCancelled: string[];
  waitlistExpired: number;
  waitlistPromoted: number;
};

/**
 * Runnable scheduled job hook.  Call this from a cron job or a POST endpoint
 * protected by an internal secret.
 *
 * Steps:
 *  1. Auto-cancel sessions below minimum enrollment (starts in ≤24 h).
 *  2. Expire timed-out waitlist offers and promote the next waiting user.
 */
export async function processUpcomingEducationSessions(): Promise<ProcessUpcomingEducationSessionsResult> {
  const [{ cancelled }, { expired, promoted }] = await Promise.all([
    cancelSessionsBelowMinimum(),
    expireWaitlistOffers(),
  ]);
  return {
    minimumCancelled: cancelled,
    waitlistExpired: expired,
    waitlistPromoted: promoted,
  };
}
