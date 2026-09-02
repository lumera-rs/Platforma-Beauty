/**
 * Durable delivery for education operational events.  Request handlers only
 * insert education_outbox rows; this module is the sole provider boundary.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  courseSessionsTable, coursesTable, db, educationBookingGroupsTable,
  educationBookingParticipantsTable, educationCenterStaffTable,
  educationNotificationsTable, educationOutboxTable, educationSessionEducatorsTable,
  usersTable,
} from "@workspace/db";
import { lumeraEmailHtml, sendTransactionalEmail } from "./brevo";
import { sendEducationSms } from "./education-sessions";
import { logger } from "./logger";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;
const APP_BASE_URL = (process.env["APP_BASE_URL"] ?? process.env["PUBLIC_APP_URL"] ?? "").replace(/\/$/, "");

function href(path: string) { return APP_BASE_URL ? `${APP_BASE_URL}${path}` : path; }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function retryDelay(attempt: number) { return Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(attempt, 8)); }
function retryable(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return !/invalid|recipient|email.*required|configuration/i.test(message);
}

type Claimed = { id: string; center_id: string; session_id: string | null; participant_id: string | null; event_type: string; dedupe_key: string; payload: Record<string, unknown>; attempts: number };

async function claim(batchSize: number): Promise<Claimed[]> {
  return db.transaction(async (tx) => {
    // A stale processing claim is deliberately eligible again.  The stable
    // provider/event key below makes an unknown post-send crash reconcilable.
    const result = await tx.execute<Claimed>(sql`
      WITH picked AS (
        SELECT id FROM education_outbox
        WHERE (status IN ('pending', 'failed') AND available_at <= now())
           OR (status = 'processing' AND leased_at < now() - interval '5 minutes')
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1, Math.min(batchSize, 100))}
      )
      UPDATE education_outbox o SET status = 'processing', leased_at = now(),
        attempts = o.attempts + 1
      FROM picked WHERE o.id = picked.id
      RETURNING o.id, o.center_id, o.session_id, o.participant_id, o.event_type,
        o.dedupe_key, o.payload, o.attempts
    `);
    return result.rows;
  });
}

async function audience(row: Claimed) {
  if (row.participant_id) {
    const [participant] = await db.select().from(educationBookingParticipantsTable)
      .where(eq(educationBookingParticipantsTable.id, row.participant_id)).limit(1);
    if (!participant) return null;
    const [user] = participant.userId ? await db.select().from(usersTable).where(eq(usersTable.id, participant.userId)).limit(1) : [];
    return { userId: participant.userId, email: participant.email ?? user?.email ?? null, phone: participant.phone ?? user?.phoneNormalized ?? null, name: participant.fullName };
  }
  const legacyRecipient = row.payload.legacyRecipient;
  if (legacyRecipient && typeof legacyRecipient === "object") {
    const value = legacyRecipient as Record<string, unknown>;
    return {
      userId: typeof value.userId === "string" ? value.userId : null,
      email: typeof value.email === "string" ? value.email : null,
      phone: typeof value.phone === "string" ? value.phone : null,
      name: typeof value.name === "string" ? value.name : "Polaznik",
    };
  }
  const staffId = typeof row.payload.educatorStaffId === "string" ? row.payload.educatorStaffId : null;
  if (!staffId) return null;
  const [staff] = await db.select().from(educationCenterStaffTable).where(eq(educationCenterStaffTable.id, staffId)).limit(1);
  const [user] = staff?.userId ? await db.select().from(usersTable).where(eq(usersTable.id, staff.userId)).limit(1) : [];
  return user ? { userId: user.id, email: user.email, phone: user.phoneNormalized, name: `${user.firstName} ${user.lastName}`.trim() } : null;
}

async function content(row: Claimed) {
  if (!row.session_id) return null;
  const [data] = await db.select({ course: coursesTable, session: courseSessionsTable })
    .from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .where(eq(courseSessionsTable.id, row.session_id)).limit(1);
  if (!data) return null;
  const date = new Intl.DateTimeFormat("sr-RS", { timeZone: "Europe/Belgrade", dateStyle: "medium", timeStyle: "short" }).format(data.session.startsAt);
  const path = `/edukacije/${data.course.id}`;
  const actionUrl = href(path);
  const ics = `${actionUrl}${actionUrl.includes("?") ? "&" : "?"}session=${encodeURIComponent(data.session.id)}&format=ics`;
  const messages: Record<string, [string, string]> = {
    session_reminder_24h: ["Podsetnik za edukaciju", `Kurs „${data.course.title}“ počinje ${date}.`],
    session_reminder_2h: ["Podsetnik za edukaciju", `Kurs „${data.course.title}“ počinje za približno dva sata (${date}).`],
    session_cancelled: ["Termin edukacije je otkazan", `Termin kursa „${data.course.title}“ je otkazan.`],
    session_cancelled_educator: ["Termin edukacije je otkazan", `Vaš termin za kurs „${data.course.title}“ je otkazan.`],
    booking_cancelled: ["Rezervacija je otkazana", `Vaša rezervacija za kurs „${data.course.title}“ je otkazana.`],
    booking_rescheduled: ["Rezervacija je promenjena", `Termin kursa „${data.course.title}“ je promenjen na ${date}.`],
    session_educator_substituted: ["Izmena edukatora", `Edukator za kurs „${data.course.title}“ je promenjen.`],
    minimum_enrollment_risk: ["Status termina edukacije", `Kurs „${data.course.title}“ još nema minimalan broj prijavljenih.`],
    minimum_enrollment_risk_manager: ["Rizik minimalnog broja polaznika", `Termin kursa „${data.course.title}“ nema minimalan broj prijavljenih.`],
  };
  const [title, body] = messages[row.event_type] ?? ["Obaveštenje o edukaciji", `Postoji novo obaveštenje za kurs „${data.course.title}“.`];
  return { title, body, actionUrl, ics };
}

export type EducationOutboxDeliveryDependencies = {
  sendSms?: typeof sendEducationSms;
  sendEmail?: typeof sendTransactionalEmail;
};

async function deliver(row: Claimed, dependencies: EducationOutboxDeliveryDependencies) {
  const sendSms = dependencies.sendSms ?? sendEducationSms;
  const sendEmail = dependencies.sendEmail ?? sendTransactionalEmail;
  const [recipient, message] = await Promise.all([audience(row), content(row)]);
  const outcomes = (row.payload.channelOutcomes ?? {}) as Record<string, string>;
  if (!recipient || !message) {
    row.payload.channelOutcomes = { ...outcomes, inApp: "skipped", email: "skipped", sms: "skipped" };
    await db.update(educationOutboxTable).set({ payload: row.payload }).where(eq(educationOutboxTable.id, row.id));
    return;
  }
  const recordOutcome = async (channel: string, outcome: string) => {
    outcomes[channel] = outcome;
    row.payload.channelOutcomes = outcomes;
    await db.update(educationOutboxTable).set({ payload: row.payload }).where(eq(educationOutboxTable.id, row.id));
  };
  if (recipient.userId && outcomes.inApp !== "sent") {
    await db.insert(educationNotificationsTable).values({
    userId: recipient.userId, type: row.event_type, title: message.title, body: message.body,
    actionUrl: message.actionUrl, eventKey: `${row.dedupe_key}:in-app`,
    }).onConflictDoNothing();
    await recordOutcome("inApp", "sent");
  } else if (!recipient.userId && !outcomes.inApp) await recordOutcome("inApp", "skipped");
  if (recipient.email && outcomes.email !== "sent") {
    await sendEmail({
    eventKey: `${row.dedupe_key}:email`, emailType: "education_operational",
    to: { email: recipient.email, name: recipient.name }, subject: `LUMERA Edukacije — ${message.title}`,
    htmlContent: lumeraEmailHtml(message.title, `<p>${escapeHtml(message.body)}</p><p><a href="${escapeHtml(message.actionUrl)}">Otvorite detalje</a>${row.event_type.includes("reminder") ? ` · <a href="${escapeHtml(message.ics)}">Dodajte u kalendar</a>` : ""}</p>`),
    metadata: { educationOutboxId: row.id, eventKey: row.dedupe_key },
    });
    await recordOutcome("email", "sent");
  } else if (!recipient.email && !outcomes.email) await recordOutcome("email", "skipped");
  if (recipient.phone && outcomes.sms !== "sent") {
    const sms = await sendSms({ eventKey: `${row.dedupe_key}:sms`, phone: recipient.phone, text: `LUMERA Edukacije: ${message.body}` });
    if ("failed" in sms && sms.failed) {
      await recordOutcome("sms", "failed");
      throw new Error("Education SMS provider failed");
    }
    await recordOutcome("sms", "sent" in sms && sms.sent ? "sent" : "skipped");
  } else if (!recipient.phone && !outcomes.sms) await recordOutcome("sms", "skipped");
}

export async function processEducationOutbox(batchSize = 25, dependencies: EducationOutboxDeliveryDependencies = {}) {
  const rows = await claim(batchSize);
  let sent = 0; let deferred = 0; let failed = 0;
  for (const row of rows) {
    try {
      await deliver(row, dependencies);
      await db.update(educationOutboxTable).set({ status: "sent", sentAt: new Date(), leasedAt: null })
        .where(and(eq(educationOutboxTable.id, row.id), eq(educationOutboxTable.status, "processing")));
      sent++;
    } catch (error) {
      const permanent = !retryable(error) || row.attempts >= MAX_ATTEMPTS;
      await db.update(educationOutboxTable).set({
        status: "failed", leasedAt: null,
        availableAt: new Date(Date.now() + (permanent ? 365 * 86_400_000 : retryDelay(row.attempts))),
      }).where(eq(educationOutboxTable.id, row.id));
      if (permanent) failed++; else deferred++;
      logger.warn({ outboxId: row.id, eventType: row.event_type, attempt: row.attempts }, "Education outbox delivery deferred");
    }
  }
  return { claimed: rows.length, sent, deferred, failed, leaseMs: LEASE_MS };
}

/** Enqueue participant and assigned-educator windows, never deliver in sweep. */
export async function enqueueEducationReminderSweep(now = new Date()) {
  const sessions = await db.select({ session: courseSessionsTable, centerId: coursesTable.centerId })
    .from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .where(and(sql`${courseSessionsTable.cancelledAt} is null`, sql`${courseSessionsTable.startsAt} > ${now}`, sql`${courseSessionsTable.startsAt} <= ${new Date(now.getTime() + 25 * 60 * 60_000)}`));
  let enqueued = 0;
  for (const { session, centerId } of sessions) {
    if (!centerId) continue;
    for (const hours of [24, 2]) {
      const leadMs = session.startsAt.getTime() - now.getTime();
      const intendedLeadMs = hours * 3_600_000;
      const deliveryToleranceMs = 60 * 60_000;
      if (leadMs < intendedLeadMs - deliveryToleranceMs || leadMs > intendedLeadMs + deliveryToleranceMs) continue;
      const event = `session_reminder_${hours}h`;
      const participants = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable)
        .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId))
        .where(and(eq(educationBookingGroupsTable.sessionId, session.id), eq(educationBookingGroupsTable.status, "active"), eq(educationBookingParticipantsTable.status, "reserved")));
      const educators = await db.select({ id: educationSessionEducatorsTable.staffId }).from(educationSessionEducatorsTable).where(eq(educationSessionEducatorsTable.sessionId, session.id));
      for (const participant of participants) {
        await db.insert(educationOutboxTable).values({ centerId, sessionId: session.id, participantId: participant.id, eventType: event, dedupeKey: `education-reminder:${session.id}:participant:${participant.id}:${hours}h`, payload: { windowHours: hours } }).onConflictDoNothing(); enqueued++;
      }
      for (const educator of educators) {
        await db.insert(educationOutboxTable).values({ centerId, sessionId: session.id, eventType: event, dedupeKey: `education-reminder:${session.id}:educator:${educator.id}:${hours}h`, payload: { educatorStaffId: educator.id, windowHours: hours } }).onConflictDoNothing(); enqueued++;
      }
    }
  }
  return { considered: sessions.length, enqueued };
}