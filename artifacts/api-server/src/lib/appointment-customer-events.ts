import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
} from "drizzle-orm";
import {
  appointmentsTable,
  db,
  emailDeliveriesTable,
  phoneVerificationProofsTable,
  reviewInvitationsTable,
  salonBookingSettingsTable,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { lumeraEmailHtml, sendTransactionalEmail } from "./brevo";
import { notifyCustomer } from "./customer-notifications";
import { sendSms } from "./sms";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function zonedAppointmentStart(date: string, time: string) {
  const desired = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  let result = desired;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(result));
    const value = (kind: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === kind)?.value);
    const represented = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
    result += desired - represented;
  }
  return new Date(result);
}

async function recipientForAppointments(items: Array<typeof appointmentsTable.$inferSelect>) {
  const first = items[0]!;
  const [contact] = first.salonCustomerId
    ? await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.id, first.salonCustomerId)).limit(1)
    : [];
  const userId = first.customerId ?? contact?.userId ?? null;
  const [user] = userId
    ? await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1)
    : [];
  return { contact, user: user?.active ? user : undefined, userId };
}

async function verifiedPhone(user: typeof usersTable.$inferSelect | undefined) {
  if (!user?.phoneNormalized) return null;
  const [proof] = await db.select({ id: phoneVerificationProofsTable.id }).from(phoneVerificationProofsTable)
    .where(and(
      eq(phoneVerificationProofsTable.userId, user.id),
      eq(phoneVerificationProofsTable.phoneNormalized, user.phoneNormalized),
      isNull(phoneVerificationProofsTable.revokedAt),
    )).limit(1);
  return proof ? user.phoneNormalized : null;
}

/** Emits one confirmation per group, never one per treatment. */
export async function sendBookingGroupConfirmation(bookingGroupId: string) {
  const items = await db.select().from(appointmentsTable)
    .where(eq(appointmentsTable.bookingGroupId, bookingGroupId));
  if (!items.length) return { email: false, sms: false };
  items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, items[0]!.salonId)).limit(1);
  if (!salon) return { email: false, sms: false };
  const { contact, user } = await recipientForAppointments(items);
  await notifyCustomer(db, {
    userId: user?.id,
    eventKey: `booking-group:${bookingGroupId}:created`,
    category: "booking",
    title: "Termini su zakazani",
    body: `Zakazano je ${items.length} tretmana u salonu ${salon.name}.`,
    deepLink: "/moji-termini",
    metadata: { bookingGroupId, appointmentIds: items.map((item) => item.id) },
  });
  const email = user?.email ?? contact?.email ?? null;
  const first = items[0]!;
  if (email) {
    await sendTransactionalEmail({
      eventKey: `booking-group:${bookingGroupId}:confirmation:email`,
      emailType: "appointment_confirmation",
      salonId: salon.id,
      appointmentId: first.id,
      to: { email, name: user?.firstName ?? contact?.firstName },
      subject: `LUMERA — potvrda grupne rezervacije`,
      htmlContent: lumeraEmailHtml("Rezervacija je primljena", `<p>Rezervisali ste ${items.length} tretmana u salonu <strong>${escapeHtml(salon.name)}</strong>.</p><p>Prvi tretman je ${first.date} u ${first.startTime}.</p>`),
      metadata: { bookingGroupId, appointmentIds: items.map((item) => item.id) },
    });
  }
  const phone = await verifiedPhone(user);
  if (phone) {
    await sendSms({
      eventKey: `booking-group:${bookingGroupId}:confirmation:sms`,
      salonId: salon.id,
      appointmentId: first.id,
      type: "appointment_confirmation",
      phone,
      smsOptOut: contact?.smsOptOut,
      text: `LUMERA: primljena je rezervacija ${items.length} tretmana u salonu ${salon.name}. Prvi termin je ${first.date} u ${first.startTime}.`,
    });
  }
  return { email: Boolean(email), sms: Boolean(phone && !contact?.smsOptOut) };
}

/** Creates the invitation atomically with appointment completion. */
export async function createAppointmentReviewInvitationInTx(
  tx: Transaction,
  appointment: typeof appointmentsTable.$inferSelect,
) {
  if (!appointment.customerId) return null;
  const [salon] = await tx.select({ slug: salonsTable.slug, name: salonsTable.name })
    .from(salonsTable).where(eq(salonsTable.id, appointment.salonId)).limit(1);
  if (!salon) return null;
  const eventKey = `appointment:${appointment.id}:review-invitation`;
  const notification = await notifyCustomer(tx, {
    userId: appointment.customerId,
    eventKey,
    category: "review",
    title: "Kako je prošao tretman?",
    body: `Podelite utiske o poseti salonu ${salon.name}.`,
    deepLink: `/saloni/${encodeURIComponent(salon.slug)}#reviews`,
    metadata: { appointmentId: appointment.id, salonId: appointment.salonId, bookingGroupId: appointment.bookingGroupId },
  });
  const [invitation] = await tx.insert(reviewInvitationsTable).values({
    eventKey,
    appointmentId: appointment.id,
    customerId: appointment.customerId,
    notificationId: notification?.id ?? null,
  }).onConflictDoNothing().returning();
  return invitation ?? null;
}

type ReminderAppointmentIdentity = Pick<
  typeof appointmentsTable.$inferSelect,
  "id" | "bookingGroupId" | "date"
>;

/**
 * A booking group can span several dates. Reminders belong to the visit on a
 * particular date, rather than to the first treatment in the whole checkout.
 */
export function appointmentReminderGroupingKey(appointment: ReminderAppointmentIdentity) {
  return `${appointment.bookingGroupId ?? appointment.id}:date:${appointment.date}`;
}

type ReminderChannel = "push" | "email" | "sms";
const SUPPORTED_REMINDER_OFFSETS = new Set([120, 720, 1440]);

/**
 * Runs only configured reminder channels. A channel callback reports whether
 * this sweep made a new or meaningful delivery attempt for the window.
 */
export async function deliverSelectedReminderChannels(
  channels: Iterable<ReminderChannel>,
  deliveries: Partial<Record<ReminderChannel, () => Promise<boolean>>>,
) {
  const selected = new Set(channels);
  let attempted = false;
  for (const channel of ["push", "email", "sms"] as const) {
    const deliver = deliveries[channel];
    if (!selected.has(channel) || !deliver) continue;
    if (await deliver()) attempted = true;
  }
  return attempted;
}

/**
 * Restart-safe reminder sweep. Each configured salon offset is an independent
 * durable window. Late scheduler runs catch up until the appointment starts.
 */
export async function runAppointmentReminderSweep(now = new Date()) {
  const from = now.toISOString().slice(0, 10);
  const until = new Date(now.getTime() + 31 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({ appointment: appointmentsTable, settings: salonBookingSettingsTable })
    .from(appointmentsTable)
    .innerJoin(salonBookingSettingsTable, eq(salonBookingSettingsTable.salonId, appointmentsTable.salonId))
    .where(and(
      eq(appointmentsTable.status, "confirmed"),
      gte(appointmentsTable.date, from),
      lte(appointmentsTable.date, until),
    ));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = appointmentReminderGroupingKey(row.appointment);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let emitted = 0;
  for (const [groupKey, groupRows] of groups) {
    groupRows.sort((a, b) => a.appointment.date.localeCompare(b.appointment.date) || a.appointment.startTime.localeCompare(b.appointment.startTime));
    const first = groupRows[0]!.appointment;
    const start = zonedAppointmentStart(first.date, first.startTime);
    if (start <= now) continue;
    const channels = new Set(groupRows[0]!.settings.reminderChannels);
    const { contact, user, userId } = await recipientForAppointments(groupRows.map((row) => row.appointment));
    const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, first.salonId)).limit(1);
    const serviceIds = [...new Set(groupRows.map((row) => row.appointment.serviceId))];
    const services = await db.select({ name: servicesTable.name }).from(servicesTable).where(inArray(servicesTable.id, serviceIds));
    if (!salon) continue;
    for (const offset of [...new Set(groupRows[0]!.settings.reminderOffsetsMinutes)]) {
      if (!SUPPORTED_REMINDER_OFFSETS.has(offset) || now < new Date(start.getTime() - offset * 60_000)) continue;
      const eventBase = `appointment-reminder:${groupKey}:offset:${offset}`;
      const body = `${groupRows.length > 1 ? `${groupRows.length} tretmana` : services[0]?.name ?? "Tretman"} u salonu ${salon.name} počinje ${first.date} u ${first.startTime}.`;
      const email = user?.email ?? contact?.email;
      const attempted = await deliverSelectedReminderChannels(channels, {
        push: async () => Boolean(await notifyCustomer(db, {
          userId, eventKey: eventBase, category: "reminder", title: "Podsetnik za termin",
          body, deepLink: "/moji-termini", metadata: { bookingGroupId: first.bookingGroupId, appointmentIds: groupRows.map((row) => row.appointment.id), offsetMinutes: offset },
        })),
        ...(email ? {
          email: async () => {
            const emailEventKey = `${eventBase}:email`;
            const [existing] = await db.select({ id: emailDeliveriesTable.id }).from(emailDeliveriesTable)
              .where(eq(emailDeliveriesTable.eventKey, emailEventKey)).limit(1);
            const result = await sendTransactionalEmail({
              eventKey: emailEventKey, emailType: "appointment_reminder", salonId: salon.id,
              appointmentId: first.id, to: { email, name: user?.firstName ?? contact?.firstName },
              subject: "LUMERA — podsetnik za termin", htmlContent: lumeraEmailHtml("Podsetnik za termin", `<p>${escapeHtml(body)}</p>`),
              metadata: { bookingGroupId: first.bookingGroupId, offsetMinutes: offset },
            });
            return !existing && !("deduplicated" in result);
          },
        } : {}),
        sms: async () => {
          const phone = await verifiedPhone(user);
          if (!phone) return false;
          const result = await sendSms({
            eventKey: `${eventBase}:sms`, salonId: salon.id, appointmentId: first.id,
            type: "appointment_reminder", phone, smsOptOut: contact?.smsOptOut, text: `LUMERA podsetnik: ${body}`,
          });
          return !("deduplicated" in result) && !("inProgress" in result);
        },
      });
      if (attempted) emitted++;
    }
  }
  return { considered: groups.size, emitted };
}

/** Catch-up for appointments completed through legacy/admin paths. */
export function reviewInvitationSweepBounds(options: {
  batchSize?: number;
  maxPages?: number;
} = {}) {
  const batchSize = Math.max(1, Math.min(250, Math.floor(options.batchSize ?? 100)));
  const maxPages = Math.max(1, Math.min(20, Math.floor(options.maxPages ?? 5)));
  return { batchSize, maxPages };
}

export async function runAppointmentReviewInvitationSweep(options: {
  batchSize?: number;
  maxPages?: number;
} = {}) {
  const { batchSize, maxPages } = reviewInvitationSweepBounds(options);
  let created = 0;
  let considered = 0;
  let pages = 0;
  let cursor: string | undefined;
  while (pages < maxPages) {
    const candidates = await db.select({ appointment: appointmentsTable })
      .from(appointmentsTable)
      .leftJoin(reviewInvitationsTable, eq(reviewInvitationsTable.appointmentId, appointmentsTable.id))
      .where(and(
        eq(appointmentsTable.status, "completed"),
        isNotNull(appointmentsTable.customerId),
        isNull(reviewInvitationsTable.id),
        cursor ? gt(appointmentsTable.id, cursor) : undefined,
      ))
      .orderBy(asc(appointmentsTable.id))
      .limit(batchSize);
    if (!candidates.length) break;
    pages++;
    considered += candidates.length;
    for (const { appointment } of candidates) {
      const invitation = await db.transaction((tx) => createAppointmentReviewInvitationInTx(tx, appointment));
      if (invitation) created++;
    }
    cursor = candidates.at(-1)!.appointment.id;
    if (candidates.length < batchSize) break;
  }
  return { considered, created, pages };
}