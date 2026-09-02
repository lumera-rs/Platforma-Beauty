import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  courseSessionsTable,
  coursesTable,
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
import {
  EDUCATION_BELGRADE_TIME_ZONE,
  addEducationBelgradeDateDays,
  assertEducationBelgradeDate,
  educationBelgradeDateKey,
  educationBelgradeDateTimeParts,
  educationBelgradeWallClockInstant,
} from "./education-belgrade-calendar";

export const EDUCATION_TIME_ZONE = EDUCATION_BELGRADE_TIME_ZONE;

/** Reject Date's rollover behaviour (2026-02-31 must never become March). */
export function assertBelgradeDate(value: string): string {
  return assertEducationBelgradeDate(value);
}

export function educationBelgradeInstant(date: string, time: string): Date {
  return educationBelgradeWallClockInstant(date, time);
}

function belgradeDateTime(value: Date) {
  const parts = educationBelgradeDateTimeParts(value);
  return {
    date: educationBelgradeDateKey(value),
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

/** Europe/Belgrade calendar dates intersected by the half-open instant range. */
export function educationLocalDatesTouched(startsAt: Date, endsAt: Date): string[] {
  if (endsAt <= startsAt) throw new Error("Session end must be after its start.");
  const first = belgradeDateTime(startsAt).date;
  // A session ending exactly at local midnight does not occupy the new day.
  const last = belgradeDateTime(new Date(endsAt.getTime() - 1)).date;
  const result: string[] = [];
  for (let date = first;; date = addEducationBelgradeDateDays(date, 1)) {
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

export type EducationAbsenceConflict = {
  sessionId: string;
  courseId: string;
  courseTitle: string;
  startsAt: Date;
  endsAt: Date;
  reservedSeats: number;
};

function nextEducationDate(date: string): string {
  return addEducationBelgradeDateDays(date, 1);
}

export function educationAbsenceOverlapsSession(
  absence: { startDate: string; endDate: string; startTime?: string | null; endTime?: string | null },
  startsAt: Date,
  endsAt: Date,
): boolean {
  return educationLocalDatesTouched(startsAt, endsAt).some((date) => {
    if (date < absence.startDate || date > absence.endDate) return false;
    const absenceStartsAt = educationBelgradeInstant(date, absence.startTime ?? "00:00");
    const absenceEndsAt = educationBelgradeInstant(
      absence.endTime ? date : nextEducationDate(date),
      absence.endTime ?? "00:00",
    );
    return startsAt < absenceEndsAt && endsAt > absenceStartsAt;
  });
}

export async function educationEducatorHasAbsenceOverlap(input: {
  educatorStaffId: string;
  startsAt: Date;
  endsAt: Date;
  store?: any;
}): Promise<boolean> {
  const store = input.store ?? db;
  const dates = educationLocalDatesTouched(input.startsAt, input.endsAt);
  const absences = await store.select().from(educationEducatorAbsencesTable).where(and(
    eq(educationEducatorAbsencesTable.staffId, input.educatorStaffId),
    lte(educationEducatorAbsencesTable.startDate, dates.at(-1)!),
    gte(educationEducatorAbsencesTable.endDate, dates[0]!),
  ));
  return (absences as Array<typeof educationEducatorAbsencesTable.$inferSelect>).some((absence) =>
    educationAbsenceOverlapsSession(absence, input.startsAt, input.endsAt));
}

export async function educationAbsenceConflicts(input: {
  centerId: string;
  educatorStaffId: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  store?: any;
}): Promise<EducationAbsenceConflict[]> {
  const store = input.store ?? db;
  const startDate = assertBelgradeDate(input.startDate);
  const endDate = assertBelgradeDate(input.endDate);
  const rows = await store.select({
    sessionId: courseSessionsTable.id,
    courseId: courseSessionsTable.courseId,
    courseTitle: coursesTable.title,
    startsAt: courseSessionsTable.startsAt,
    endsAt: courseSessionsTable.endsAt,
    reservedSeats: courseSessionsTable.reservedSeats,
  }).from(educationSessionEducatorsTable)
    .innerJoin(courseSessionsTable, eq(courseSessionsTable.id, educationSessionEducatorsTable.sessionId))
    .innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .where(and(
      eq(educationSessionEducatorsTable.staffId, input.educatorStaffId),
      eq(coursesTable.centerId, input.centerId),
      isNull(courseSessionsTable.cancelledAt),
    ));
  return (rows as EducationAbsenceConflict[])
    .filter((session) => educationAbsenceOverlapsSession({
      startDate, endDate, startTime: input.startTime, endTime: input.endTime,
    }, session.startsAt, session.endsAt))
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
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