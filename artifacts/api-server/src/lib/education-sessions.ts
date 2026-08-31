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
  isNull,
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
  educationCenterStaffTable,
  educationBookingGroupsTable,
  educationBookingParticipantsTable,
  educationInstallmentsTable,
  educationPriceSnapshotsTable,
  educationSessionEducatorsTable,
  educationEscrowsTable,
  educationFinancialEventsTable,
  educationLedgerEntriesTable,
  educationNotificationsTable,
  educationOutboxTable,
  educationWaitlistTable,
  usersTable,
} from "@workspace/db";
import { lumeraEmailHtml, sendTransactionalEmail } from "./brevo";
import { logger } from "./logger";
import { recordEducationEnrollmentReferralTransitionInTx } from "./referral-service";
import { notifyCustomer } from "./customer-notifications";
import { educationLocalDatesTouched } from "./education-availability-store";
import { lockEducationScheduleResources } from "./education-locks";

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
export async function sendEducationSms(input: {
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
  cancelledParticipants: number;
  cancelledEnrollments: number;
  refundAmount: number;
};

export type CancelEducationSessionOptions = {
  allowAlreadyCancelled?: boolean;
  centerCaused?: boolean;
  source?: "marketplace" | "operational" | "scheduler";
};

function emptyCancellationResult(sessionId: string): CancelEducationSessionResult {
  return {
    sessionId,
    refundedEnrollments: 0,
    cancelledWaitlistEntries: 0,
    notifiedUsers: 0,
    cancelledParticipants: 0,
    cancelledEnrollments: 0,
    refundAmount: 0,
  };
}

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
  options: CancelEducationSessionOptions = {},
): Promise<CancelEducationSessionResult> {
  // 1. Load session and course outside the transaction so we have the data for
  //    notifications even if the transaction rolls back early.
  const [session] = await db
    .select()
    .from(courseSessionsTable)
    .where(eq(courseSessionsTable.id, sessionId))
    .limit(1);
  if (!session) throw new Error("Termin nije pronađen.");
  if (session.cancelledAt) {
    if (options.allowAlreadyCancelled) return emptyCancellationResult(sessionId);
    throw new Error("Termin je već otkazan.");
  }

  const [course] = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, session.courseId))
    .limit(1);
  if (!course) throw new Error("Kurs nije pronađen.");

  const centerId = course.centerId;

  // 2. Transactional core: mark session cancelled, refund escrows, cancel
  //    waitlist entries, record ledger / audit events.
  const {
    refundedEnrollmentIds,
    cancelledWaitlistIds,
    enrolledUserIds,
    cancelledParticipants,
    cancelledEnrollments,
    refundAmount,
  } =
    await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select({ staffId: educationSessionEducatorsTable.staffId })
        .from(educationSessionEducatorsTable)
        .where(eq(educationSessionEducatorsTable.sessionId, sessionId))
        .limit(1);

      // Use the same schedule-resource ordering as every operational mutation,
      // then serialize the center's financial aggregate.
      if (centerId) {
        await lockEducationScheduleResources(
          tx,
          educationLocalDatesTouched(session.startsAt, session.endsAt).map((date) => ({
            centerId,
            date,
            educatorStaffId: assignment?.staffId,
          })),
        );
      }
      if (centerId) await lockEducationCenterFinancials(tx, centerId);

      // Re-read session under lock.
      const [locked] = await tx
        .select()
        .from(courseSessionsTable)
        .where(eq(courseSessionsTable.id, sessionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("Termin nije pronađen.");
      if (locked.cancelledAt) {
        if (options.allowAlreadyCancelled) {
          return {
            refundedEnrollmentIds: [] as string[],
            cancelledWaitlistIds: [] as string[],
            enrolledUserIds: [] as string[],
            cancelledParticipants: 0,
            cancelledEnrollments: 0,
            refundAmount: 0,
          };
        }
        throw new Error("Termin je već otkazan.");
      }
      if (options.source === "scheduler") {
        const [futureSession] = await tx.select({ id: courseSessionsTable.id })
          .from(courseSessionsTable)
          .where(and(
            eq(courseSessionsTable.id, sessionId),
            sql`${courseSessionsTable.startsAt} > now()`,
          ))
          .limit(1);
        if (!futureSession) throw new Error("SESSION_ALREADY_STARTED");
      }

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
      const allEscrows = enrollmentIds.length
        ? await tx
            .select()
            .from(educationEscrowsTable)
            .where(inArray(educationEscrowsTable.enrollmentId, enrollmentIds))
            .orderBy(asc(educationEscrowsTable.id))
            .for("update")
        : [];
      if (allEscrows.some((escrow) => escrow.netPaidAt || escrow.reservePaidAt || ["paid_out", "partially_refunded"].includes(escrow.status))) throw new Error("PAYOUT");
      const escrows = allEscrows.filter((escrow) => ["held", "ready_for_payout", "frozen"].includes(escrow.status));

      const refundedEnrollmentIds: string[] = [];
      let refundAmount = 0;
      const refundedByGroup = new Map<string, number>();
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
        refundAmount += escrow.grossAmount;
        const enrollment = enrollments.find((candidate) => candidate.id === escrow.enrollmentId);
        if (enrollment?.bookingGroupId) refundedByGroup.set(enrollment.bookingGroupId, (refundedByGroup.get(enrollment.bookingGroupId) ?? 0) + escrow.grossAmount);
      }

      // Preserve each enrollment's payment state: only an enrollment whose
      // own escrow was refunded becomes refunded; pending requests stay pending.
      for (const enrollment of enrollments) {
        await tx.update(courseEnrollmentsTable).set({
          status: "cancelled",
          paymentStatus: refundedEnrollmentIds.includes(enrollment.id) ? "refunded" : enrollment.paymentStatus,
          accessGrantedAt: null,
          updatedAt: new Date(),
        }).where(and(eq(courseEnrollmentsTable.id, enrollment.id), inArray(courseEnrollmentsTable.status, ["pending", "active"])));
        if (centerId && enrollment.userId) await recordEducationEnrollmentReferralTransitionInTx(tx, {
          enrollmentId: enrollment.id, studentUserId: enrollment.userId, centerId,
          occurredAt: new Date(), valid: false, reason: "education_session_cancelled",
        });
      }

      // Operational named-seat records are part of the same commercial
      // cancellation aggregate; retained and scheduled callers must not leave
      // groups/participants live after cancelling their enrollments.
      const operationalEnrollments = enrollments.filter((enrollment) => enrollment.participantId && enrollment.bookingGroupId);
      const operationalParticipantIds = operationalEnrollments.flatMap((enrollment) => enrollment.participantId ? [enrollment.participantId] : []);
      const operationalGroupIds = [...new Set(operationalEnrollments.flatMap((enrollment) => enrollment.bookingGroupId ? [enrollment.bookingGroupId] : []))];
      if (operationalParticipantIds.length) await tx.update(educationBookingParticipantsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(inArray(educationBookingParticipantsTable.id, operationalParticipantIds));
      if (operationalGroupIds.length) {
        const snapshots = await tx.select({ id: educationPriceSnapshotsTable.id, bookingGroupId: educationPriceSnapshotsTable.bookingGroupId }).from(educationPriceSnapshotsTable)
          .where(inArray(educationPriceSnapshotsTable.bookingGroupId, operationalGroupIds)).for("update");
        const snapshotIds = snapshots.map((snapshot) => snapshot.id);
        if (snapshotIds.length) {
          await tx.update(educationInstallmentsTable).set({ status: "cancelled" })
            .where(and(inArray(educationInstallmentsTable.priceSnapshotId, snapshotIds), eq(educationInstallmentsTable.status, "pending")));
          for (const snapshot of snapshots) {
            let remaining = refundedByGroup.get(snapshot.bookingGroupId) ?? 0;
            const settled = await tx.select().from(educationInstallmentsTable).where(and(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id), eq(educationInstallmentsTable.status, "settled"))).orderBy(asc(educationInstallmentsTable.installmentNumber)).for("update");
            for (const installment of settled) {
              const refund = Math.min(Math.max(0, installment.amount - installment.refundedAmount), remaining);
              if (refund) await tx.update(educationInstallmentsTable).set({ refundedAmount: installment.refundedAmount + refund }).where(eq(educationInstallmentsTable.id, installment.id));
              remaining -= refund;
            }
            if (remaining) throw new Error("PAYOUT");
          }
        }
        await tx.update(educationBookingGroupsTable).set({ status: "cancelled", updatedAt: new Date() })
          .where(inArray(educationBookingGroupsTable.id, operationalGroupIds));
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
      const enrolledUserIds = enrollments.flatMap((e) => e.userId ? [e.userId] : []);
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
      // Provider work is durable and is intentionally not performed by this
      // transaction or its caller. Operational cancellation rows use the same
      // worker as route-originated cancellations.
      if (centerId) {
        for (const participantId of operationalParticipantIds) {
          await tx.insert(educationOutboxTable).values({
            centerId, sessionId, participantId, eventType: "session_cancelled",
            dedupeKey: `education-session-cancel:${sessionId}:participant:${participantId}`,
            payload: { reason, cancellationSource: options.source ?? "marketplace" },
          }).onConflictDoNothing();
        }
        const legacyRecipients = await tx.select({ enrollment: courseEnrollmentsTable, user: usersTable })
          .from(courseEnrollmentsTable).innerJoin(usersTable, eq(usersTable.id, courseEnrollmentsTable.userId))
          .where(and(
            inArray(courseEnrollmentsTable.id, enrollmentIds.length ? enrollmentIds : ["00000000-0000-0000-0000-000000000000"]),
            isNull(courseEnrollmentsTable.participantId),
          ));
        for (const row of legacyRecipients) await tx.insert(educationOutboxTable).values({
          centerId, sessionId, eventType: "session_cancelled",
          dedupeKey: `education-session-cancel:${sessionId}:legacy-enrollment:${row.enrollment.id}`,
          payload: {
            reason,
            cancellationSource: options.source ?? "marketplace",
            legacyRecipient: { userId: row.user.id, email: row.user.email, phone: row.user.phoneNormalized, name: `${row.user.firstName} ${row.user.lastName}`.trim() },
          },
        }).onConflictDoNothing();
        if (assignment) await tx.insert(educationOutboxTable).values({
          centerId,
          sessionId,
          eventType: "session_cancelled_educator",
          dedupeKey: `education-session-cancel:${sessionId}:educator:${assignment.staffId}`,
          payload: {
            educatorStaffId: assignment.staffId,
            reason,
            cancellationSource: options.source ?? "marketplace",
          },
        }).onConflictDoNothing();
      }

      return {
        refundedEnrollmentIds,
        cancelledWaitlistIds,
        enrolledUserIds: allUserIds,
        cancelledParticipants: operationalParticipantIds.length,
        cancelledEnrollments: enrollments.length,
        refundAmount,
      };
    });

  return {
    sessionId,
    refundedEnrollments: new Set(refundedEnrollmentIds).size,
    cancelledWaitlistEntries: cancelledWaitlistIds.length,
    notifiedUsers: enrolledUserIds.length,
    cancelledParticipants,
    cancelledEnrollments,
    refundAmount,
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
    // Operational named seats are the canonical queue. The locked session row
    // serializes releases/promotions, while participant createdAt/id provides
    // deterministic FIFO ordering across online and center-created bookings.
    const [waiting] = await tx
      .select({ participant: educationBookingParticipantsTable, group: educationBookingGroupsTable })
      .from(educationBookingParticipantsTable)
      .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId))
      .where(and(
        eq(educationBookingGroupsTable.sessionId, session.id),
        eq(educationBookingParticipantsTable.status, "waitlisted"),
      ))
      .orderBy(asc(educationBookingParticipantsTable.createdAt), asc(educationBookingParticipantsTable.id))
      .for("update")
      .limit(1);
    if (waiting) {
      const [promoted] = await tx.update(educationBookingParticipantsTable)
        .set({ status: "reserved", updatedAt: new Date() })
        .where(and(eq(educationBookingParticipantsTable.id, waiting.participant.id), eq(educationBookingParticipantsTable.status, "waitlisted")))
        .returning();
      if (promoted) {
        await tx.update(courseSessionsTable).set({ reservedSeats: nextReserved + 1 }).where(eq(courseSessionsTable.id, session.id));
        const [enrollment] = await tx.select().from(courseEnrollmentsTable)
          .where(eq(courseEnrollmentsTable.participantId, promoted.id)).for("update").limit(1);
        const installments = await tx.select({ status: educationInstallmentsTable.status })
          .from(educationPriceSnapshotsTable)
          .innerJoin(educationInstallmentsTable, eq(educationInstallmentsTable.priceSnapshotId, educationPriceSnapshotsTable.id))
          .where(and(
            eq(educationPriceSnapshotsTable.bookingGroupId, waiting.group.id),
          )).for("update");
        const settled = installments.filter((row: any) => row.status === "settled");
        const paymentStatus = installments.length > 0 && settled.length === installments.length ? "paid" : "pending";
        if (enrollment) await tx.update(courseEnrollmentsTable).set({
          sessionId: session.id,
          status: settled.length ? "active" : "pending",
          paymentStatus,
          accessGrantedAt: settled.length ? enrollment.accessGrantedAt ?? new Date() : null,
          updatedAt: new Date(),
        }).where(eq(courseEnrollmentsTable.id, enrollment.id));
        await tx.update(educationBookingGroupsTable)
          .set({ status: settled.length ? "active" : "pending", updatedAt: new Date() })
          .where(eq(educationBookingGroupsTable.id, waiting.group.id));
        await tx.insert(educationOutboxTable).values({
          centerId: waiting.group.centerId,
          sessionId: session.id,
          participantId: promoted.id,
          eventType: "waitlist_offer",
          dedupeKey: `education-operational-waitlist:${promoted.id}:promoted`,
          payload: { bookingGroupId: waiting.group.id, participantId: promoted.id, courseId: course.id, sessionId: session.id },
        }).onConflictDoNothing();
        return null;
      }
    }
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
      if (course.centerId && locked.userId) await recordEducationEnrollmentReferralTransitionInTx(tx, {
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
async function cancelSessionsBelowMinimum(): Promise<{ cancelled: string[] }> {
  const now = new Date();
  const legacyHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const sessions = await db
    .select({ session: courseSessionsTable })
    .from(courseSessionsTable)
    .innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .where(
      and(
        sql`${courseSessionsTable.minimumEnrollments} is not null`,
        sql`${courseSessionsTable.cancelledAt} is null`,
        sql`${courseSessionsTable.startsAt} > ${now}`,
        // Older courses had no explicit deadline; preserve their historical
        // 24-hour policy while new operational courses cancel only at deadline.
        sql`(${coursesTable.minimumEnrollmentRiskDeadline} <= ${now} OR (${coursesTable.minimumEnrollmentRiskDeadline} is null AND ${courseSessionsTable.startsAt} < ${legacyHorizon}))`,
        sql`${courseSessionsTable.reservedSeats} < ${courseSessionsTable.minimumEnrollments}`,
      ),
    );

  const cancelled: string[] = [];
  for (const { session } of sessions) {
    try {
      await cancelEducationSession(
        session.id,
        null,
        "Minimalni broj polaznika nije dostignut.",
        { source: "scheduler" },
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

async function enqueueMinimumEnrollmentRiskWarnings(now = new Date()) {
  const warningHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const candidates = await db.select({ session: courseSessionsTable, centerId: coursesTable.centerId })
    .from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .where(and(sql`${courseSessionsTable.minimumEnrollments} is not null`, sql`${courseSessionsTable.cancelledAt} is null`,
      sql`${courseSessionsTable.reservedSeats} < ${courseSessionsTable.minimumEnrollments}`,
      sql`${courseSessionsTable.startsAt} > ${now}`,
      sql`${coursesTable.minimumEnrollmentRiskDeadline} is not null`,
      sql`${coursesTable.minimumEnrollmentRiskDeadline} > ${now}`,
      sql`${coursesTable.minimumEnrollmentRiskDeadline} <= ${warningHorizon}`));
  let warned = 0;
  for (const { session, centerId } of candidates) {
    if (!centerId) continue;
    const participants = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable)
      .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId))
      .where(and(eq(educationBookingGroupsTable.sessionId, session.id), eq(educationBookingGroupsTable.status, "active"), eq(educationBookingParticipantsTable.status, "reserved")));
    for (const participant of participants) {
      await db.insert(educationOutboxTable).values({ centerId, sessionId: session.id, participantId: participant.id, eventType: "minimum_enrollment_risk", dedupeKey: `education-risk:${session.id}:participant:${participant.id}`, payload: {} }).onConflictDoNothing();
      warned++;
    }
    const managers = await db.select({ id: educationCenterStaffTable.id }).from(educationCenterStaffTable)
      .where(and(eq(educationCenterStaffTable.centerId, centerId), inArray(educationCenterStaffTable.role, ["owner_admin", "manager_reception"]), eq(educationCenterStaffTable.active, true)));
    for (const manager of managers) {
      await db.insert(educationOutboxTable).values({ centerId, sessionId: session.id, eventType: "minimum_enrollment_risk_manager", dedupeKey: `education-risk:${session.id}:manager:${manager.id}`, payload: { educatorStaffId: manager.id } }).onConflictDoNothing();
      warned++;
    }
  }
  return warned;
}

export type ProcessUpcomingEducationSessionsResult = {
  minimumCancelled: string[];
  minimumRiskWarnings: number;
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
  const [{ cancelled }, { expired, promoted }, minimumRiskWarnings] = await Promise.all([
    cancelSessionsBelowMinimum(),
    expireWaitlistOffers(),
    enqueueMinimumEnrollmentRiskWarnings(),
  ]);
  return {
    minimumCancelled: cancelled,
    minimumRiskWarnings,
    waitlistExpired: expired,
    waitlistPromoted: promoted,
  };
}
