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
  date: string;
  startTime: string;
  endTime: string;
  bufferMinutes?: number;
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
};
export type ResourceDowntime = { resourceId: string; date: string; startTime: string; endTime: string };
export type AvailabilityEmployee = { id: string; name: string };
export type AvailabilitySlot = { date: string; startTime: string; endTime: string; employeeId: string; employeeName: string };

export type GenerateAvailabilityInput = {
  dates: string[];
  durationMinutes: number;
  bufferMinutes?: number;
  granularityMinutes?: number;
  employees: AvailabilityEmployee[];
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

function employeeCanWork(input: GenerateAvailabilityInput, employeeId: string, date: string, start: string, employeeEnd: string) {
  if (input.timeOff.some((item) => item.employeeId === employeeId
    && item.startDate <= date && item.endDate >= date
    && (!item.startTime || !item.endTime || overlaps(start, employeeEnd, item.startTime, item.endTime)))) return false;
  const rows = input.employeeSchedules.filter((item) => item.employeeId === employeeId && item.weekday === weekday(date));
  if (!rows.length) return true;
  return rows.some((item) => start >= item.startTime && employeeEnd <= item.endTime
    && !(item.breakStart && item.breakEnd && overlaps(start, employeeEnd, item.breakStart, item.breakEnd)));
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
        const employee = input.employees.find((candidate) =>
          employeeCanWork(input, candidate.id, date, startTime, employeeEnd)
          && !input.appointments.some((appointment) => appointment.employeeId === candidate.id && appointment.date === date
            && overlaps(startTime, employeeEnd, appointment.startTime,
              addMinutes(appointment.endTime, appointment.resourceIds?.length ? 0 : (appointment.bufferMinutes ?? 0)) ?? appointment.endTime)));
        if (employee) slots.push({ date, startTime, endTime, employeeId: employee.id, employeeName: employee.name });
      }
    }
    if (slots.length >= cap) break;
  }
  return slots;
}