/** Calendar-only primitives for business rules expressed in Europe/Belgrade. */
export const EDUCATION_BELGRADE_TIME_ZONE = "Europe/Belgrade";

export type EducationBelgradeDateParts = {
  year: number;
  month: number;
  day: number;
};

export type EducationBelgradeDateTimeParts = EducationBelgradeDateParts & {
  hour: number;
  minute: number;
  second: number;
};

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: EDUCATION_BELGRADE_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
// UTC is used only as a stable Gregorian-date ordinal representation here;
// this is never an elapsed-time calculation.
const UTC_CALENDAR_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error("Europe/Belgrade wall-clock conversion failed.");
  return Number(value);
}

export function educationBelgradeDateTimeParts(instant: Date): EducationBelgradeDateTimeParts {
  if (Number.isNaN(instant.getTime())) throw new Error("Instant nije ispravan.");
  const parts = formatter.formatToParts(instant);
  return {
    year: numberPart(parts, "year"), month: numberPart(parts, "month"), day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"), minute: numberPart(parts, "minute"), second: numberPart(parts, "second"),
  };
}

function dateKey(parts: EducationBelgradeDateParts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Rejects Date's rollover behaviour, e.g. 2026-02-31. */
export function assertEducationBelgradeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Datum mora biti YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const test = new Date(Date.UTC(year!, month! - 1, day!));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== month! - 1 || test.getUTCDate() !== day) {
    throw new Error("Datum ne postoji u kalendaru Europe/Belgrade.");
  }
  return value;
}

export function educationBelgradeDateKey(instant: Date): string {
  return dateKey(educationBelgradeDateTimeParts(instant));
}

export function educationBelgradeDateParts(value: string): EducationBelgradeDateParts {
  assertEducationBelgradeDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Adds local calendar dates; it intentionally has no elapsed-millisecond meaning. */
export function addEducationBelgradeDateDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Broj kalendarskih dana nije ispravan.");
  const parts = educationBelgradeDateParts(value);
  const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return dateKey({ year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() });
}

/** Difference between named calendar dates, independent of DST day length. */
export function educationBelgradeCalendarDayDifference(start: string, end: string): number {
  const left = educationBelgradeDateParts(start);
  const right = educationBelgradeDateParts(end);
  return (Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / UTC_CALENDAR_DAY_MILLISECONDS;
}

/** Adds calendar months and clamps the day to the destination month's final day. */
export function addEducationBelgradeDateMonths(value: string, months: number): string {
  if (!Number.isInteger(months)) throw new Error("Broj kalendarskih meseci nije ispravan.");
  const parts = educationBelgradeDateParts(value);
  const first = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return dateKey({ year: first.getUTCFullYear(), month: first.getUTCMonth() + 1, day: Math.min(parts.day, lastDay) });
}

export function educationBelgradeWallClockInstant(date: string, time: string, second = 0, millisecond = 0): Date {
  const parts = educationBelgradeDateParts(date);
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Vreme mora biti HH:MM.");
  const [hour, minute] = time.split(":").map(Number);
  if (hour! > 23 || minute! > 59 || !Number.isInteger(second) || second < 0 || second > 59 || !Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999) {
    throw new Error("Vreme nije ispravno.");
  }
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, hour!, minute!, second, millisecond);
  let candidate = target - 3 * 3_600_000;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = educationBelgradeDateTimeParts(new Date(candidate));
    const observedWallClock = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second, millisecond);
    if (observedWallClock === target) return new Date(candidate);
    candidate += target - observedWallClock;
  }
  throw new Error("Izabrano vreme ne postoji u vremenskoj zoni Europe/Belgrade.");
}

export function addEducationBelgradeCalendarDays(instant: Date, days: number): Date {
  if (!Number.isInteger(days)) throw new Error("Broj kalendarskih dana nije ispravan.");
  const current = educationBelgradeDateTimeParts(instant);
  return educationBelgradeWallClockInstant(
    addEducationBelgradeDateDays(dateKey(current), days),
    `${String(current.hour).padStart(2, "0")}:${String(current.minute).padStart(2, "0")}`,
    current.second,
    instant.getUTCMilliseconds(),
  );
}

export function addEducationBelgradeCalendarMonths(instant: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new Error("Broj kalendarskih meseci nije ispravan.");
  const current = educationBelgradeDateTimeParts(instant);
  return educationBelgradeWallClockInstant(
    addEducationBelgradeDateMonths(dateKey(current), months),
    `${String(current.hour).padStart(2, "0")}:${String(current.minute).padStart(2, "0")}`,
    current.second,
    instant.getUTCMilliseconds(),
  );
}