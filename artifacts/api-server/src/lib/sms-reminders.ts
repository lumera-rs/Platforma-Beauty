import { runAppointmentReminderSweep } from "./appointment-customer-events";

function dateInBelgrade(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Compatibility entry point for the old external cron. Delivery is delegated
 * to the canonical sweep so event keys, grouping, settings and verified-user
 * contact policy cannot diverge. Historical/future dates are never replayed by
 * this endpoint.
 */
export async function sendDailyAppointmentReminders(date = dateInBelgrade()) {
  const now = new Date();
  if (date !== dateInBelgrade(now)) {
    return { date, considered: 0, emitted: 0, redirected: true, skipped: "Only the current Belgrade date can be swept." };
  }
  return { date, ...(await runAppointmentReminderSweep(now)), redirected: true };
}