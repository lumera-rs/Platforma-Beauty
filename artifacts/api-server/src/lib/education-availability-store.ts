import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  courseSessionsTable,
  db,
  educationCenterStaffTable,
  educationEducatorAbsencesTable,
  educationEducatorWeeklyAvailabilityTable,
  educationSessionEducatorsTable,
} from "@workspace/db";
import {
  generateAvailability,
  type AvailabilitySlot,
  type BusyAppointment,
  wallClockNowInTimeZone,
} from "./availability-engine";

export const EDUCATION_TIME_ZONE = "Europe/Belgrade";

/** Reject Date's rollover behaviour (2026-02-31 must never become March). */
export function assertBelgradeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Datum mora biti YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const test = new Date(Date.UTC(year!, month! - 1, day!));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== month! - 1 || test.getUTCDate() !== day) {
    throw new Error("Datum ne postoji u kalendaru Europe/Belgrade.");
  }
  return value;
}

function belgradeDateTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EDUCATION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year"); const month = part("month"); const day = part("day");
  const hour = part("hour"); const minute = part("minute");
  if (!year || !month || !day || !hour || !minute) throw new Error("Belgrade wall-clock conversion failed.");
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

/** Europe/Belgrade calendar dates intersected by the half-open instant range. */
export function educationLocalDatesTouched(startsAt: Date, endsAt: Date): string[] {
  if (endsAt <= startsAt) throw new Error("Session end must be after its start.");
  const first = belgradeDateTime(startsAt).date;
  // A session ending exactly at local midnight does not occupy the new day.
  const last = belgradeDateTime(new Date(endsAt.getTime() - 1)).date;
  const result: string[] = [];
  for (let cursor = new Date(`${first}T12:00:00.000Z`);; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const date = cursor.toISOString().slice(0, 10);
    result.push(date);
    if (date === last) return result;
    if (result.length > 370) throw new Error("Session date range is unbounded.");
  }
}

function splitBusySession(employeeId: string, startsAt: Date, endsAt: Date): BusyAppointment[] {
  const start = belgradeDateTime(startsAt);
  const end = belgradeDateTime(endsAt);
  const dates = educationLocalDatesTouched(startsAt, endsAt);
  return dates.map((date) => ({
    employeeId,
    date,
    startTime: date === start.date ? start.time : "00:00",
    // 24:00 is an internal exclusive bound only; the slot generator never
    // emits it as a candidate wall-clock time.
    endTime: date === end.date ? end.time : "24:00",
  }));
}

/**
 * Education's DB adapter deliberately maps persisted facts into the shared pure
 * generateAvailability engine; it does not implement a second slot algorithm.
 */
export async function educationCanonicalAvailability(input: {
  centerId: string;
  educatorStaffId: string;
  dates: string[];
  durationMinutes: number;
  granularityMinutes?: number;
  store?: any;
  excludeSessionIds?: string[];
}): Promise<AvailabilitySlot[]> {
  const store = input.store ?? db;
  const dates = [...new Set(input.dates.map(assertBelgradeDate))].sort();
  if (!dates.length) return [];
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("Trajanje termina mora biti pozitivan ceo broj minuta.");
  }
  const [staff] = await store.select().from(educationCenterStaffTable).where(and(
    eq(educationCenterStaffTable.id, input.educatorStaffId),
    eq(educationCenterStaffTable.centerId, input.centerId),
    eq(educationCenterStaffTable.role, "educator"),
    eq(educationCenterStaffTable.active, true),
  )).limit(1);
  if (!staff) throw new Error("Aktivni edukator ne pripada izabranom centru.");
  const startDate = dates[0]!; const endDate = dates.at(-1)!;
  const schedules = await store.select().from(educationEducatorWeeklyAvailabilityTable)
    .where(eq(educationEducatorWeeklyAvailabilityTable.staffId, staff.id));
  const absences = await store.select().from(educationEducatorAbsencesTable).where(and(
    eq(educationEducatorAbsencesTable.staffId, staff.id),
    lte(educationEducatorAbsencesTable.startDate, endDate),
    gte(educationEducatorAbsencesTable.endDate, startDate),
  ));
  const assignments = await store.select({
    id: courseSessionsTable.id, startsAt: courseSessionsTable.startsAt, endsAt: courseSessionsTable.endsAt,
  }).from(educationSessionEducatorsTable)
    .innerJoin(courseSessionsTable, eq(courseSessionsTable.id, educationSessionEducatorsTable.sessionId))
    .where(and(
      eq(educationSessionEducatorsTable.staffId, staff.id),
      isNull(courseSessionsTable.cancelledAt),
    ));
  const busy: BusyAppointment[] = (assignments as Array<{ id: string; startsAt: Date; endsAt: Date }>)
    .filter((session: { id: string; startsAt: Date; endsAt: Date }) => !input.excludeSessionIds?.includes(session.id))
    .flatMap((session: { id: string; startsAt: Date; endsAt: Date }) =>
      splitBusySession(staff.id, session.startsAt, session.endsAt))
    .filter((session: BusyAppointment) => dates.includes(session.date));
  return generateAvailability({
    dates,
    durationMinutes: input.durationMinutes,
    granularityMinutes: input.granularityMinutes ?? 15,
    employees: [{ id: staff.id, name: staff.userId }],
    // Educator schedules are authoritative; the enclosing location must never
    // narrow them. A full-day window just feeds the common engine.
    salonHours: [],
    employeeSchedules: (schedules as Array<typeof educationEducatorWeeklyAvailabilityTable.$inferSelect>).map((row) => ({
      employeeId: staff.id, weekday: row.weekday, startTime: row.startTime, endTime: row.endTime,
    })),
    timeOff: (absences as Array<typeof educationEducatorAbsencesTable.$inferSelect>).map((row) => ({
      employeeId: staff.id, startDate: row.startDate, endDate: row.endDate,
      startTime: row.startTime, endTime: row.endTime,
    })),
    appointments: busy,
    resourceRequirements: [], resourceAllocations: [],
    now: wallClockNowInTimeZone(new Date(), EDUCATION_TIME_ZONE),
  });
}