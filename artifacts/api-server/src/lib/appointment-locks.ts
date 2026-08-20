import { sql } from "drizzle-orm";

export type AppointmentLockResource = {
  date: string;
  employeeId?: string | null;
};

/**
 * Appointment writes always lock in the same hierarchy:
 * salon -> calendar day -> employee/day.
 *
 * A series move can need to re-read its members after another request changes
 * one of them. The stable salon lock prevents deadlocks while it discovers and
 * locks the resulting dates.
 */
export async function lockAppointmentResources(store: any, salonId: string, resources: AppointmentLockResource[] = []) {
  await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:salon:${salonId}`}))`);
  const dates = [...new Set(resources.map((resource) => resource.date))].sort();
  for (const date of dates) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:day:${salonId}:${date}`}))`);
  }
  const employees = [...new Set(resources
    .filter((resource): resource is AppointmentLockResource & { employeeId: string } => Boolean(resource.employeeId))
    .map((resource) => `${resource.date}:${resource.employeeId}`))].sort();
  for (const employee of employees) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:employee:${salonId}:${employee}`}))`);
  }
}