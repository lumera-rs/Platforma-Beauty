export type AvailabilityWindow = { weekday: number; startTime: string; endTime: string; closed?: boolean };
export type AvailabilityOverride = { date: string; startTime?: string | null; endTime?: string | null; closed: boolean };
export type EmployeeWindow = AvailabilityWindow & { employeeId: string; breakStart?: string | null; breakEnd?: string | null };
export type TimeOffWindow = {
  employeeId: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
};
export type BusyAppointment = {
  employeeId: string | null;
  /** Complete treatment participant set; employeeId is retained for legacy rows. */
  employeeIds?: string[];
  date: string;
  startTime: string;
  endTime: string;
  bufferMinutes?: number;
  preProcessingMinutes?: number;
  processingMinutes?: number;
  postProcessingMinutes?: number;
  resourceIds?: string[];
};
export type ResourceRequirement = { resourceId: string; quantity: number; capacity: number; active: boolean };
export type ResourceAllocation = {
  resourceId: string;
  quantity: number;
  date: string;
  startTime: string;
  endTime: string;
  bufferMinutes?: number;
  preProcessingMinutes?: number;
  processingMinutes?: number;
  postProcessingMinutes?: number;
};
export type ResourceDowntime = { resourceId: string; date: string; startTime: string; endTime: string };
export type AvailabilityEmployee = { id: string; name: string };
export type AvailabilitySlot = {
  date: string; startTime: string; endTime: string; employeeId: string; employeeName: string;
  employeeIds: string[]; employeeNames: string[];
  /** Additive schedule-compaction hint; never participates in slot validity or identity. */
  score?: number;
  recommended?: boolean;
};

export type GenerateAvailabilityInput = {
  dates: string[];
  durationMinutes: number;
  bufferMinutes?: number;
  preProcessingMinutes?: number;
  processingMinutes?: number;
  postProcessingMinutes?: number;
  granularityMinutes?: number;
  employees: AvailabilityEmployee[];
  /** One entry per required position. Null positions are deterministically auto-assigned. */
  employeeIds?: Array<string | null>;
  requiredEmployeeCount?: number;
  salonHours: AvailabilityWindow[];
  dateOverrides?: AvailabilityOverride[];
  employeeSchedules: EmployeeWindow[];
  timeOff: TimeOffWindow[];
  appointments: BusyAppointment[];
  resourceRequirements: ResourceRequirement[];
  resourceAllocations: ResourceAllocation[];
  resourceDowntime?: ResourceDowntime[];
  limit?: number;
  now?: { date: string; time: string };
  minimumLeadTimeMinutes?: number;
};

export const DEFAULT_SALON_TIME_ZONE = "Europe/Belgrade";

export function wallClockNowInTimeZone(
  instant: Date,
  timeZone = DEFAULT_SALON_TIME_ZONE,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error(`Cannot resolve wall-clock time for ${timeZone}.`);
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function addMinutes(time: string, minutes: number): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const value = Number(match[1]) * 60 + Number(match[2]) + minutes;
  if (!Number.isInteger(minutes) || value < 0 || value > 1440) return null;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}

function overlaps(start: string, end: string, otherStart: string, otherEnd: string) {
  return start < otherEnd && end > otherStart;
}

type Interval = { start: string; end: string };

function employeeIntervals(
  startTime: string,
  endTime: string,
  bufferMinutes: number,
  preProcessingMinutes: number,
  processingMinutes: number,
  postProcessingMinutes: number,
  resourceBacked: boolean,
): Interval[] {
  const employeeEnd = resourceBacked ? endTime : addMinutes(endTime, bufferMinutes) ?? endTime;
  const segmented = preProcessingMinutes + processingMinutes + postProcessingMinutes > 0;
  return segmented
    ? [
        { start: startTime, end: addMinutes(startTime, preProcessingMinutes)! },
        { start: addMinutes(startTime, preProcessingMinutes + processingMinutes)!, end: employeeEnd },
      ].filter((interval) => interval.start < interval.end)
    : [{ start: startTime, end: employeeEnd }];
}

function compactnessPoints(candidate: Interval[], occupied: Interval[]): number | null {
  if (!occupied.length) return null;
  let nearestGap = Number.POSITIVE_INFINITY;
  for (const interval of candidate) {
    for (const existing of occupied) {
      if (existing.end <= interval.start) nearestGap = Math.min(nearestGap, minutes(interval.start) - minutes(existing.end));
      else if (existing.start >= interval.end) nearestGap = Math.min(nearestGap, minutes(existing.start) - minutes(interval.end));
    }
  }
  return Number.isFinite(nearestGap) ? Math.max(0, 240 - nearestGap) : 0;
}

const RECOMMENDATION_SIGNIFICANCE_MINUTES = 30;
const MAX_RECOMMENDATIONS_PER_ASSIGNMENT_DAY = 3;

/**
 * Decorates already-valid slots without changing their order, count or identity fields.
 * A recommendation requires an existing same-day employee/resource schedule and a
 * meaningful score boundary (30 minutes) versus the next alternative.
 */
export function decorateAvailabilitySlots(
  slots: AvailabilitySlot[],
  input: Pick<GenerateAvailabilityInput,
    "appointments" | "resourceAllocations" | "resourceRequirements" | "bufferMinutes"
    | "preProcessingMinutes" | "processingMinutes" | "postProcessingMinutes">,
): AvailabilitySlot[] {
  if (!slots.length) return slots;
  const buffer = Math.max(0, input.bufferMinutes ?? 0);
  const pre = Math.max(0, input.preProcessingMinutes ?? 0);
  const processing = Math.max(0, input.processingMinutes ?? 0);
  const post = Math.max(0, input.postProcessingMinutes ?? 0);
  const resourceIds = [...new Set(input.resourceRequirements.map((item) => item.resourceId))].sort();
  const scored = slots.map((slot) => {
    const candidateEmployeeIntervals = employeeIntervals(
      slot.startTime, slot.endTime, buffer, pre, processing, post, resourceIds.length > 0,
    );
    const points: number[] = [];
    for (const employeeId of slot.employeeIds) {
      const occupied = input.appointments
        .filter((appointment) => appointment.date === slot.date
          && (appointment.employeeIds?.length
            ? appointment.employeeIds
            : appointment.employeeId ? [appointment.employeeId] : []).includes(employeeId))
        .flatMap((appointment) => employeeIntervals(
          appointment.startTime,
          appointment.endTime,
          Math.max(0, appointment.bufferMinutes ?? 0),
          Math.max(0, appointment.preProcessingMinutes ?? 0),
          Math.max(0, appointment.processingMinutes ?? 0),
          Math.max(0, appointment.postProcessingMinutes ?? 0),
          Boolean(appointment.resourceIds?.length),
        ));
      const value = compactnessPoints(candidateEmployeeIntervals, occupied);
      if (value !== null) points.push(value);
    }
    for (const resourceId of resourceIds) {
      const occupied = input.resourceAllocations
        .filter((allocation) => allocation.resourceId === resourceId && allocation.date === slot.date)
        .map((allocation) => ({
          start: allocation.startTime,
          end: addMinutes(allocation.endTime, Math.max(0, allocation.bufferMinutes ?? 0)) ?? allocation.endTime,
        }));
      const value = compactnessPoints([{
        start: slot.startTime,
        end: addMinutes(slot.endTime, buffer) ?? slot.endTime,
      }], occupied);
      if (value !== null) points.push(value);
    }
    const score = points.length ? Math.round(points.reduce((sum, value) => sum + value, 0) / points.length) : 0;
    const groupKey = `${slot.date}|${slot.employeeIds.join(",")}|${resourceIds.join(",")}`;
    return { slot, score, groupKey, hasSchedule: points.length > 0 };
  });
  const recommendedIndexes = new Set<number>();
  const groups = new Map<string, number[]>();
  scored.forEach((item, index) => groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), index]));
  for (const indexes of groups.values()) {
    const ranked = indexes.filter((index) => scored[index]!.hasSchedule)
      .sort((left, right) => scored[right]!.score - scored[left]!.score || left - right);
    const maxPrefix = Math.min(MAX_RECOMMENDATIONS_PER_ASSIGNMENT_DAY, ranked.length - 1);
    let recommendationCount = 0;
    for (let count = 1; count <= maxPrefix; count += 1) {
      if (scored[ranked[count - 1]!]!.score - scored[ranked[count]!]!.score >= RECOMMENDATION_SIGNIFICANCE_MINUTES) {
        recommendationCount = count;
      }
    }
    ranked.slice(0, recommendationCount).forEach((index) => recommendedIndexes.add(index));
  }
  return scored.map((item, index) => ({
    ...item.slot,
    score: item.score,
    ...(recommendedIndexes.has(index) ? { recommended: true } : {}),
  }));
}

function weekday(date: string) {
  return ((new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
}

function locationWindows(input: GenerateAvailabilityInput, date: string) {
  const override = input.dateOverrides?.find((item) => item.date === date);
  if (override) {
    return override.closed || !override.startTime || !override.endTime
      ? []
      : [{ startTime: override.startTime, endTime: override.endTime }];
  }
  const rows = input.salonHours.filter((item) => item.weekday === weekday(date));
  // Existing salons predate explicit hours. Keep the historical window only
  // when no hours have been configured for this weekday.
  if (!rows.length) return [{ startTime: "09:00", endTime: "18:00" }];
  return rows.filter((item) => !item.closed).map((item) => ({ startTime: item.startTime, endTime: item.endTime }));
}

function employeeCanWork(input: GenerateAvailabilityInput, employeeId: string, date: string, intervals: Array<{ start: string; end: string }>) {
  if (input.timeOff.some((item) => item.employeeId === employeeId
    && item.startDate <= date && item.endDate >= date
    && (!item.startTime || !item.endTime || intervals.some(({ start, end }) => overlaps(start, end, item.startTime!, item.endTime!))))) return false;
  const rows = input.employeeSchedules.filter((item) => item.employeeId === employeeId && item.weekday === weekday(date));
  if (!rows.length) return true;
  return rows.some((item) => intervals.every(({ start, end }) => start >= item.startTime && end <= item.endTime
    && !(item.breakStart && item.breakEnd && overlaps(start, end, item.breakStart, item.breakEnd))));
}

function resourcesAvailable(input: GenerateAvailabilityInput, date: string, start: string, resourceEnd: string) {
  return input.resourceRequirements.every((requirement) => {
    if (!requirement.active || requirement.quantity > requirement.capacity) return false;
    if (input.resourceDowntime?.some((item) => item.resourceId === requirement.resourceId
      && item.date === date && overlaps(start, resourceEnd, item.startTime, item.endTime))) return false;
    const overlapping = input.resourceAllocations
      .filter((item) => item.resourceId === requirement.resourceId && item.date === date
        && overlaps(start, resourceEnd, item.startTime, addMinutes(item.endTime, item.bufferMinutes ?? 0) ?? item.endTime));
    // Capacity is point-in-time, not a sum over the whole requested interval:
    // two adjacent allocations must not be mistaken for two concurrent units.
    const checkpoints = [start, ...overlapping.map((item) => item.startTime)
      .filter((time) => time >= start && time < resourceEnd)];
    return checkpoints.every((time) => {
      const used = overlapping
        .filter((item) => item.startTime <= time
          && (addMinutes(item.endTime, item.bufferMinutes ?? 0) ?? item.endTime) > time)
        .reduce((sum, item) => sum + item.quantity, 0);
      return used + requirement.quantity <= requirement.capacity;
    });
  });
}

/** Pure canonical slot generator. All intervals are half-open wall-clock ranges. */
export function generateAvailability(input: GenerateAvailabilityInput): AvailabilitySlot[] {
  const granularity = input.granularityMinutes ?? 30;
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0
    || !Number.isInteger(granularity) || granularity <= 0 || granularity > 180) return [];
  const buffer = Math.max(0, input.bufferMinutes ?? 0);
  const minimumLead = Math.max(0, input.minimumLeadTimeMinutes ?? 0);
  const nowMinutes = input.now ? minutes(input.now.time) + minimumLead : null;
  const leadCutoffDate = input.now && nowMinutes !== null
    ? new Date(`${input.now.date}T12:00:00.000Z`)
    : null;
  if (leadCutoffDate && nowMinutes! >= 1440) {
    leadCutoffDate.setUTCDate(leadCutoffDate.getUTCDate() + Math.floor(nowMinutes! / 1440));
  }
  const leadCutoffTime = nowMinutes === null ? null : `${String(Math.floor((nowMinutes! % 1440) / 60)).padStart(2, "0")}:${String(nowMinutes! % 60).padStart(2, "0")}`;
  const resourceBacked = input.resourceRequirements.length > 0;
  const slots: AvailabilitySlot[] = [];
  const requiredEmployeeCount = input.requiredEmployeeCount ?? 1;
  if (!Number.isInteger(requiredEmployeeCount) || requiredEmployeeCount < 1 || requiredEmployeeCount > 20
    || (input.employeeIds && input.employeeIds.length !== requiredEmployeeCount)) return [];
  const orderedEmployees = [...input.employees].sort((a, b) => a.id.localeCompare(b.id));
  const explicitIds = input.employeeIds ?? [];
  const nonNullExplicit = explicitIds.filter((id): id is string => Boolean(id));
  if (new Set(nonNullExplicit).size !== nonNullExplicit.length) return [];
  const cap = input.limit ?? Number.POSITIVE_INFINITY;

  for (const date of input.dates) {
    for (const window of locationWindows(input, date)) {
      for (let cursor = minutes(window.startTime); cursor < minutes(window.endTime) && slots.length < cap; cursor += granularity) {
        const startTime = `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
        if (leadCutoffDate && leadCutoffTime && (
          date < leadCutoffDate.toISOString().slice(0, 10)
          || (date === leadCutoffDate.toISOString().slice(0, 10) && startTime < leadCutoffTime)
        )) continue;
        const endTime = addMinutes(startTime, input.durationMinutes);
        const blockedEnd = addMinutes(endTime ?? "", buffer);
        if (!endTime || !blockedEnd) continue;
        const employeeEnd = resourceBacked ? endTime : blockedEnd;
        const resourceEnd = resourceBacked ? blockedEnd : endTime;
        if (employeeEnd > window.endTime || resourceEnd > window.endTime) continue;
        if (!resourcesAvailable(input, date, startTime, resourceEnd)) continue;
        const pre = Math.max(0, input.preProcessingMinutes ?? 0);
        const processing = Math.max(0, input.processingMinutes ?? 0);
        const post = Math.max(0, input.postProcessingMinutes ?? 0);
        const segmented = pre + processing + post > 0;
        if (segmented && (pre + processing + post !== input.durationMinutes)) continue;
        const activeIntervals = segmented
          ? [
              { start: startTime, end: addMinutes(startTime, pre)! },
              { start: addMinutes(startTime, pre + processing)!, end: employeeEnd },
            ].filter((interval) => interval.start < interval.end)
          : [{ start: startTime, end: employeeEnd }];
        const eligible = orderedEmployees.filter((candidate) =>
          employeeCanWork(input, candidate.id, date, activeIntervals)
          && !input.appointments.some((appointment) => (appointment.employeeIds?.length
            ? appointment.employeeIds
            : appointment.employeeId ? [appointment.employeeId] : []).includes(candidate.id) && appointment.date === date
            && (() => {
              const appointmentPre = Math.max(0, appointment.preProcessingMinutes ?? 0);
              const appointmentProcessing = Math.max(0, appointment.processingMinutes ?? 0);
              const appointmentPost = Math.max(0, appointment.postProcessingMinutes ?? 0);
              const appointmentSegmented = appointmentPre + appointmentProcessing + appointmentPost > 0;
              const appointmentEnd = addMinutes(appointment.endTime, appointment.resourceIds?.length ? 0 : (appointment.bufferMinutes ?? 0)) ?? appointment.endTime;
              const busyIntervals = appointmentSegmented
                ? [{ start: appointment.startTime, end: addMinutes(appointment.startTime, appointmentPre)! }, { start: addMinutes(appointment.startTime, appointmentPre + appointmentProcessing)!, end: appointmentEnd }]
                  .filter((interval) => interval.start < interval.end)
                : [{ start: appointment.startTime, end: appointmentEnd }];
              return activeIntervals.some((interval) => busyIntervals.some((busy) => overlaps(interval.start, interval.end, busy.start, busy.end)));
             })()));
        const byId = new Map(eligible.map((employee) => [employee.id, employee]));
        const assigned: Array<AvailabilityEmployee | undefined> = explicitIds.length
          ? explicitIds.map((id) => id ? byId.get(id) : undefined)
          : Array.from({ length: requiredEmployeeCount });
        if (explicitIds.length && explicitIds.some((id, position) => id && !assigned[position])) continue;
        const used = new Set(assigned.filter(Boolean).map((employee) => employee!.id));
        for (const employee of eligible) {
          const position = assigned.findIndex((item) => !item);
          if (position < 0) break;
          if (!used.has(employee.id)) { assigned[position] = employee; used.add(employee.id); }
        }
        if (assigned.some((employee) => !employee)) continue;
        const participants = assigned as AvailabilityEmployee[];
        slots.push({
          date, startTime, endTime, employeeId: participants[0]!.id, employeeName: participants[0]!.name,
          employeeIds: participants.map((employee) => employee.id), employeeNames: participants.map((employee) => employee.name),
        });
      }
    }
    if (slots.length >= cap) break;
  }
  return slots;
}