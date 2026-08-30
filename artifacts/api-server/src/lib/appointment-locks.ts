import { sql } from "drizzle-orm";

export type AppointmentLockResource = {
  date: string;
  employeeId?: string | null;
  resourceId?: string | null;
};

/**
 * Appointment writes always lock in the same hierarchy:
 * salon -> calendar day -> employee/day -> resource/day.
 *
 * Resource locks are acquired after employee locks to extend the deterministic
 * ordering without breaking existing employee-level semantics.
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
    // Employee occupancy is global across assigned locations. Do not include
    // salonId in this key or simultaneous bookings at sibling locations race.
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:employee:${employee}`}))`);
  }
  // Resource locks come after employee locks, stable-sorted to prevent deadlocks.
  const resourceKeys = [...new Set(resources
    .filter((resource): resource is AppointmentLockResource & { resourceId: string } => Boolean(resource.resourceId))
    .map((resource) => `${resource.date}:${resource.resourceId}`))].sort();
  for (const resourceKey of resourceKeys) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:resource:${salonId}:${resourceKey}`}))`);
  }
}

/**
 * Appends employee/resource locks after the caller already owns the salon/day
 * locks. This avoids reacquiring identical transaction-scoped advisory locks.
 */
export async function lockAppointmentParticipants(store: any, salonId: string, resources: AppointmentLockResource[]) {
  const employees = [...new Set(resources
    .filter((resource): resource is AppointmentLockResource & { employeeId: string } => Boolean(resource.employeeId))
    .map((resource) => `${resource.date}:${resource.employeeId}`))].sort();
  for (const employee of employees) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:employee:${employee}`}))`);
  }
  const resourceKeys = [...new Set(resources
    .filter((resource): resource is AppointmentLockResource & { resourceId: string } => Boolean(resource.resourceId))
    .map((resource) => `${resource.date}:${resource.resourceId}`))].sort();
  for (const resourceKey of resourceKeys) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:appointments:resource:${salonId}:${resourceKey}`}))`);
  }
}
