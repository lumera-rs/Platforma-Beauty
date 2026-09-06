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
  /**
   * Segment snapshot of the appointment already in the calendar. Present since
   * segmented treatments exist; absent or all-zero means one continuous block,
   * which is what every appointment booked before segments looks like.
   */
  preProcessingMinutes?: number;
  processingMinutes?: number;
  postProcessingMinutes?: number;
  /** Every employee committed to this appointment, not only the primary. */
  employeeIds?: string[];
  /** Seats consumed in a shared-capacity slot. Defaults to 1. */
  seatCount?: number;
  /** Needed to decide whether a shared-capacity slot may take another client. */
  serviceId?: string;
};

/** A half-open wall-clock range. */
export type Interval = { start: string; end: string };

/**
 * What one treatment actually occupies.
 *
 * This is the single definition of occupancy in the system. Availability
 * generation and the in-transaction booking revalidation both derive their
 * answer from it, so a slot can never be offered under one set of rules and
 * committed under another.
 */
export type TreatmentOccupancy = {
  /** Stretches the assigned employees must be free for. */
  employee: Interval[];
  /** The client is committed for the whole treatment, processing gap included. */
  client: Interval;
  /** Resources are held across the treatment plus its buffer. */
  resource: Interval;
  /** Latest wall-clock instant the salon must still be open for. */
  end: string;
};

export type TreatmentShape = {
  durationMinutes: number;
  bufferMinutes?: number;
  preProcessingMinutes?: number;
  processingMinutes?: number;
  postProcessingMinutes?: number;
  /** Minutes added by chosen add-ons; extends the active tail of the treatment. */
  addOnMinutes?: number;
};

/**
 * Expands a treatment into the intervals it really occupies.
 *
 * A segmented treatment frees the employee during processing — a colour
 * developing needs nobody — but the client and any room stay committed
 * throughout. An unsegmented treatment yields exactly one employee interval, so
 * every caller written before segments keeps the behaviour it had.
 *
 * Add-on minutes extend the active tail rather than the gap: an add-on is work,
 * and work cannot happen while the colour is developing.
 */
export function treatmentOccupancy(shape: TreatmentShape, startTime: string): TreatmentOccupancy | null {
  const addOn = Math.max(0, shape.addOnMinutes ?? 0);
  const pre = Math.max(0, shape.preProcessingMinutes ?? 0);
  const processing = Math.max(0, shape.processingMinutes ?? 0);
  const post = Math.max(0, shape.postProcessingMinutes ?? 0);
  const segmented = processing > 0 && pre + processing + post > 0;
  const total = (segmented ? pre + processing + post : shape.durationMinutes) + addOn;
  if (!Number.isInteger(total) || total <= 0) return null;

  const clientEnd = addMinutes(startTime, total);
  const resourceEnd = addMinutes(startTime, total + Math.max(0, shape.bufferMinutes ?? 0));
  if (!clientEnd || !resourceEnd) return null;

  if (!segmented) {
    return {
      employee: [{ start: startTime, end: clientEnd }],
      client: { start: startTime, end: clientEnd },
      resource: { start: startTime, end: resourceEnd },
      end: resourceEnd > clientEnd ? resourceEnd : clientEnd,
    };
  }

  const preEnd = addMinutes(startTime, pre);
  const postStart = addMinutes(startTime, pre + processing);
  if (!preEnd || !postStart) return null;
  const employee: Interval[] = [];
  if (pre > 0) employee.push({ start: startTime, end: preEnd });
  // The tail carries the post-processing work and every add-on.
  if (post + addOn > 0) employee.push({ start: postStart, end: clientEnd });
  // A treatment that is pure processing would occupy nobody; that is not a
  // treatment anyone can book, so fall back to holding the employee throughout.
  if (!employee.length) employee.push({ start: startTime, end: clientEnd });
  return {
    employee,
    client: { start: startTime, end: clientEnd },
    resource: { start: startTime, end: resourceEnd },
    end: resourceEnd > clientEnd ? resourceEnd : clientEnd,
  };
}

/** The intervals an already-booked appointment holds its employees for. */
export function busyEmployeeIntervals(appointment: BusyAppointment): Interval[] {
  const occupancy = treatmentOccupancy({
    durationMinutes: minutes(appointment.endTime) - minutes(appointment.startTime),
    // A booked appointment's buffer only extends resource occupancy when it
    // holds no resources of its own — the rule the engine already applied.
    bufferMinutes: appointment.resourceIds?.length ? 0 : (appointment.bufferMinutes ?? 0),
    preProcessingMinutes: appointment.preProcessingMinutes,
    processingMinutes: appointment.processingMinutes,
    postProcessingMinutes: appointment.postProcessingMinutes,
  }, appointment.startTime);
  if (!occupancy) return [{ start: appointment.startTime, end: appointment.endTime }];
  const trailing = addMinutes(appointment.endTime, appointment.resourceIds?.length ? 0 : (appointment.bufferMinutes ?? 0));
  const last = occupancy.employee[occupancy.employee.length - 1]!;
  // Buffer extends the final active stretch, never the processing gap.
  return occupancy.employee.map((interval, index) =>
    index === occupancy.employee.length - 1 && trailing && trailing > last.end
      ? { start: interval.start, end: trailing }
      : interval);
}
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
export type AvailabilitySlot = {
  date: string; startTime: string; endTime: string;
  /** The primary assignee, mirroring `appointments.employee_id`. */
  employeeId: string; employeeName: string;
  /** Every employee the slot commits — one entry unless the service needs several. */
  employeeIds?: string[]; employeeNames?: string[];
};

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
  /** Segment shape of the treatment being booked. Absent means one block. */
  preProcessingMinutes?: number;
  processingMinutes?: number;
  postProcessingMinutes?: number;
  /** Extra active minutes from chosen add-ons. */
  addOnMinutes?: number;
  /** Employees who must ALL be free. Defaults to 1. */
  requiredEmployeeCount?: number;
  /** Clients one slot can hold. Above 1 the slot is shared rather than exclusive. */
  seatCapacity?: number;
  /** Seats this request wants. Defaults to 1. */
  seatCount?: number;
  /** Identity of the treatment being booked; used to match shareable groups. */
  serviceId?: string;
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
  if (!rows.length) {
    // A salon that has configured *any* opening hours has said everything it
    // means to say: a weekday with no row is a day it does not trade. Falling
    // back per weekday made every salon bookable on the days it had left out —
    // Sunday, for a salon that only ever entered Monday to Saturday.
    //
    // The historical 09:00-18:00 window survives only for salons that predate
    // the column and have no hours at all. New salons are given real rows when
    // they are created, so they never reach this branch.
    if (input.salonHours.length) return [];
    return [{ startTime: "09:00", endTime: "18:00" }];
  }
  return rows.filter((item) => !item.closed).map((item) => ({ startTime: item.startTime, endTime: item.endTime }));
}

function employeeCanWorkIntervals(
  input: GenerateAvailabilityInput,
  employeeId: string,
  date: string,
  intervals: Interval[],
): boolean {
  return intervals.every((interval) =>
    employeeCanWork(input, employeeId, date, interval.start, interval.end));
}

function employeeCanWork(input: GenerateAvailabilityInput, employeeId: string, date: string, start: string, employeeEnd: string) {
  if (input.timeOff.some((item) => item.employeeId === employeeId
    && item.startDate <= date && item.endDate >= date
    && (!item.startTime || !item.endTime || overlaps(start, employeeEnd, item.startTime, item.endTime)))) return false;
  const rows = input.employeeSchedules.filter((item) => item.employeeId === employeeId && item.weekday === weekday(date));
  if (!rows.length) {
    // Same rule as opening hours: once an employee has a schedule at all, a
    // weekday with no row is a day they do not work. Falling back per weekday
    // offered every employee on their days off.
    //
    // An employee with no schedule anywhere still follows the salon window, for
    // salons whose staff predate the table. New employees are given a schedule
    // when they are added, so they never rely on that.
    return !input.employeeSchedules.some((item) => item.employeeId === employeeId);
  }
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

/** Every employee an already-booked appointment commits, primary included. */
function committedEmployeeIds(appointment: BusyAppointment): string[] {
  const ids = appointment.employeeIds?.length
    ? appointment.employeeIds
    : appointment.employeeId ? [appointment.employeeId] : [];
  return ids;
}

/**
 * Appointments that share a slot with this request instead of blocking it.
 *
 * A group treatment (seatCapacity > 1) is one employee serving several clients
 * in the same window. Another booking for the same service, at the same times,
 * joins that group rather than colliding with it — while there are seats left.
 */
function shareableGroup(
  input: GenerateAvailabilityInput,
  date: string,
  startTime: string,
  endTime: string,
): { seatsTaken: number; employeeIds: string[] } | null {
  const capacity = Math.max(1, input.seatCapacity ?? 1);
  if (capacity <= 1 || !input.serviceId) return null;
  const members = input.appointments.filter((appointment) =>
    appointment.date === date
    && appointment.serviceId === input.serviceId
    && appointment.startTime === startTime
    && appointment.endTime === endTime);
  if (!members.length) return { seatsTaken: 0, employeeIds: [] };
  const seatsTaken = members.reduce((sum, member) => sum + Math.max(1, member.seatCount ?? 1), 0);
  return { seatsTaken, employeeIds: committedEmployeeIds(members[0]!) };
}

/** Pure canonical slot generator. All intervals are half-open wall-clock ranges. */
export function generateAvailability(input: GenerateAvailabilityInput): AvailabilitySlot[] {
  const granularity = input.granularityMinutes ?? 30;
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0
    || !Number.isInteger(granularity) || granularity <= 0 || granularity > 180) return [];
  const requiredEmployees = Math.max(1, input.requiredEmployeeCount ?? 1);
  const seatCapacity = Math.max(1, input.seatCapacity ?? 1);
  const requestedSeats = Math.max(1, input.seatCount ?? 1);
  if (requestedSeats > seatCapacity) return [];
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

        // One definition of what this treatment occupies, shared with the
        // in-transaction revalidation. Segments free the employee during
        // processing; the client and any resource stay held throughout.
        const occupancy = treatmentOccupancy({
          durationMinutes: input.durationMinutes,
          // A treatment that holds resources keeps its buffer on the resource
          // side only; without resources the buffer trails the employee.
          bufferMinutes: resourceBacked ? (input.bufferMinutes ?? 0) : 0,
          preProcessingMinutes: input.preProcessingMinutes,
          processingMinutes: input.processingMinutes,
          postProcessingMinutes: input.postProcessingMinutes,
          addOnMinutes: input.addOnMinutes,
        }, startTime);
        if (!occupancy) continue;
        const endTime = occupancy.client.end;
        const employeeIntervals = resourceBacked
          ? occupancy.employee
          : occupancy.employee.map((interval, index) => index === occupancy.employee.length - 1
            ? { start: interval.start, end: addMinutes(interval.end, input.bufferMinutes ?? 0) ?? interval.end }
            : interval);
        const employeeEnd = employeeIntervals[employeeIntervals.length - 1]!.end;
        const resourceEnd = occupancy.resource.end;
        if (employeeEnd > window.endTime || resourceEnd > window.endTime) continue;
        if (!resourcesAvailable(input, date, startTime, resourceEnd)) continue;

        // A shared-capacity slot is joined, not contested, while seats remain.
        const group = shareableGroup(input, date, startTime, endTime);
        if (group && group.seatsTaken > 0) {
          if (group.seatsTaken + requestedSeats > seatCapacity) continue;
          const holder = group.employeeIds[0];
          const employee = holder ? input.employees.find((candidate) => candidate.id === holder) : undefined;
          if (!employee) continue;
          const names = group.employeeIds
            .map((id) => input.employees.find((candidate) => candidate.id === id)?.name)
            .filter((name): name is string => Boolean(name));
          slots.push({
            date, startTime, endTime,
            employeeId: employee.id, employeeName: employee.name,
            employeeIds: group.employeeIds, employeeNames: names,
          });
          continue;
        }

        // Ordinary exclusivity: an employee must be free for every active
        // stretch, judged against what each existing appointment really holds.
        const free = input.employees.filter((candidate) =>
          employeeCanWorkIntervals(input, candidate.id, date, employeeIntervals)
          && !input.appointments.some((appointment) => {
            if (appointment.date !== date) return false;
            if (!committedEmployeeIds(appointment).includes(candidate.id)) return false;
            const busy = busyEmployeeIntervals(appointment);
            return busy.some((held) => employeeIntervals.some((wanted) =>
              overlaps(wanted.start, wanted.end, held.start, held.end)));
          }));
        if (free.length < requiredEmployees) continue;
        // Deterministic: the eligible employees in their given order, so the
        // slot advertised is the slot the booking transaction will assign.
        const chosen = free.slice(0, requiredEmployees);
        slots.push({
          date, startTime, endTime,
          employeeId: chosen[0]!.id, employeeName: chosen[0]!.name,
          employeeIds: chosen.map((employee) => employee.id),
          employeeNames: chosen.map((employee) => employee.name),
        });
      }
    }
    if (slots.length >= cap) break;
  }
  return slots;
}
