import { and, eq, inArray } from "drizzle-orm";
import { appointmentsTable, db, salonCustomersTable, salonsTable, servicesTable } from "@workspace/db";
import { sendSms } from "./sms";

function dateInBelgrade() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function sendDailyAppointmentReminders(date = dateInBelgrade()) {
  const appointments = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.date, date), eq(appointmentsTable.status, "confirmed")));
  const contactIds = appointments.flatMap((appointment) => appointment.salonCustomerId ? [appointment.salonCustomerId] : []);
  if (!contactIds.length) return { date, considered: 0 };
  const [contacts, salons, services] = await Promise.all([
    db.select().from(salonCustomersTable).where(inArray(salonCustomersTable.id, [...new Set(contactIds)])),
    db.select().from(salonsTable).where(inArray(salonsTable.id, [...new Set(appointments.map((appointment) => appointment.salonId))])),
    db.select().from(servicesTable).where(inArray(servicesTable.id, [...new Set(appointments.map((appointment) => appointment.serviceId))])),
  ]);
  await Promise.all(appointments.map(async (appointment) => {
    const contact = contacts.find((item) => item.id === appointment.salonCustomerId);
    const salon = salons.find((item) => item.id === appointment.salonId);
    const service = services.find((item) => item.id === appointment.serviceId);
    if (!contact || !salon || !service) return;
    await sendSms({
      eventKey: `appointment-reminder:${appointment.id}:${date}`, salonId: salon.id, appointmentId: appointment.id,
      type: "appointment_reminder", phone: contact.phone, smsOptOut: contact.smsOptOut,
      text: `LUMERA podsetnik: danas u ${appointment.startTime} imate ${service.name} u salonu ${salon.name}.`,
    });
  }));
  return { date, considered: appointments.length };
}