import { sql } from "drizzle-orm";

export type EducationLockResource = {
  centerId: string;
  date: string;
  educatorStaffId?: string | null;
};

/**
 * Shared education write protocol. Call before reading availability, capacity,
 * assignments or absences and rerun validation using the transaction snapshot.
 * The order is center -> day -> educator/day, stable across bulk writes.
 */
export async function lockEducationScheduleResources(store: any, resources: EducationLockResource[]) {
  const centers = [...new Set(resources.map((item) => item.centerId))].sort();
  for (const centerId of centers) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`education:schedule:center:${centerId}`}))`);
  }
  const days = [...new Set(resources.map((item) => `${item.centerId}:${item.date}`))].sort();
  for (const key of days) {
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`education:schedule:day:${key}`}))`);
  }
  const educators = [...new Set(resources
    .filter((item): item is EducationLockResource & { educatorStaffId: string } => Boolean(item.educatorStaffId))
    .map((item) => `${item.date}:${item.educatorStaffId}`))].sort();
  for (const key of educators) {
    // Educator identity is global: the unique-active-membership backstop means
    // it cannot be double-booked through a different center.
    await store.execute(sql`select pg_advisory_xact_lock(hashtext(${`education:schedule:educator:${key}`}))`);
  }
}