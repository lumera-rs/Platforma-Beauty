import { and, eq, gte, inArray, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import {
  appointmentResourceAllocationsTable,
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeLocationSchedulesTable,
  employeesTable,
  employeeServicesTable,
  employeeTimeOffTable,
  salonHoursTable,
  salonBookingSettingsTable,
  salonDateHoursTable,
  salonResourcesTable,
  salonResourceDowntimeTable,
  serviceResourceRequirementsTable,
  servicesTable,
} from "@workspace/db";
import {
  generateAvailability,
  type AvailabilitySlot,
  type BusyAppointment,
  type GenerateAvailabilityInput,
  type ResourceAllocation,
} from "./availability-engine";

function optionalNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Request-scoped facts for availability previews.  It intentionally contains
 * only persisted state: callers still pass their branch-local tentative
 * reservations to canonicalAvailability, which reruns generateAvailability.
 */
export type CanonicalAvailabilityContext = {
  salonId: string;
  startDate: string;
  endDate: string;
  settings: typeof salonBookingSettingsTable.$inferSelect | undefined;
  dateHours: Array<typeof salonDateHoursTable.$inferSelect>;
  employees: Array<typeof employeesTable.$inferSelect>;
  employeeServiceLinks: Array<typeof employeeServicesTable.$inferSelect>;
  appointments: Array<{ id: string; employeeId: string | null; date: string; startTime: string; endTime: string; service: typeof servicesTable.$inferSelect }>;
  resourceIdsByAppointment: Map<string, string[]>;
  schedules: Array<typeof employeeLocationSchedulesTable.$inferSelect>;
  timeOff: Array<typeof employeeTimeOffTable.$inferSelect>;
  salonHours: Array<typeof salonHoursTable.$inferSelect>;
  requirementsByServiceId: Map<string, Array<{ resourceId: string; quantity: number; capacity: number; active: boolean }>>;
  resourceAllocations: Array<{ appointmentId: string; resourceId: string; quantity: number; date: string; startTime: string; endTime: string; service: typeof servicesTable.$inferSelect }>;
  downtime: Array<typeof salonResourceDowntimeTable.$inferSelect>;
};

/** Load invariant persisted availability facts once for a bounded request window. */
export async function preloadCanonicalAvailability(input: {
  salonId: string;
  dates: string[];
  serviceIds: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store?: any;
}): Promise<CanonicalAvailabilityContext> {
  const store = input.store ?? db;
  const startDate = [...input.dates].sort()[0]!;
  const endDate = [...input.dates].sort().at(-1)!;
  const serviceIds = [...new Set(input.serviceIds)];
  const [[settings], dateHours, employeeRows, salonHours, requirementRows, downtimeRows] = await Promise.all([
    store.select().from(salonBookingSettingsTable).where(eq(salonBookingSettingsTable.salonId, input.salonId)).limit(1),
    store.select().from(salonDateHoursTable).where(and(eq(salonDateHoursTable.salonId, input.salonId), gte(salonDateHoursTable.date, startDate), lte(salonDateHoursTable.date, endDate))),
    store.select({ employee: employeesTable }).from(employeesTable).innerJoin(employeeLocationAssignmentsTable, and(
      eq(employeeLocationAssignmentsTable.employeeId, employeesTable.id), eq(employeeLocationAssignmentsTable.salonId, input.salonId), eq(employeeLocationAssignmentsTable.active, true),
    )).where(eq(employeesTable.active, true)),
    store.select().from(salonHoursTable).where(eq(salonHoursTable.salonId, input.salonId)),
    store.select({ serviceId: serviceResourceRequirementsTable.serviceId, resourceId: serviceResourceRequirementsTable.resourceId, quantity: serviceResourceRequirementsTable.quantity, capacity: salonResourcesTable.capacity, active: salonResourcesTable.active })
      .from(serviceResourceRequirementsTable).innerJoin(salonResourcesTable, eq(salonResourcesTable.id, serviceResourceRequirementsTable.resourceId))
      .where(inArray(serviceResourceRequirementsTable.serviceId, serviceIds)),
    store.select({ downtime: salonResourceDowntimeTable }).from(salonResourceDowntimeTable)
      .innerJoin(salonResourcesTable, eq(salonResourcesTable.id, salonResourceDowntimeTable.resourceId))
      .where(eq(salonResourcesTable.salonId, input.salonId)),
  ]);
  const employees = employeeRows.map((row: { employee: typeof employeesTable.$inferSelect }) => row.employee);
  const employeeIds = employees.map((employee: typeof employeesTable.$inferSelect) => employee.id);
  const typedRequirements = requirementRows as Array<{ serviceId: string; resourceId: string; quantity: number; capacity: number; active: boolean }>;
  const requirementsByServiceId = new Map<string, Array<{ resourceId: string; quantity: number; capacity: number; active: boolean }>>();
  for (const requirement of typedRequirements) requirementsByServiceId.set(requirement.serviceId, [...(requirementsByServiceId.get(requirement.serviceId) ?? []), requirement]);
  if (!employeeIds.length) return { salonId: input.salonId, startDate, endDate, settings, dateHours, employees, employeeServiceLinks: [], appointments: [], resourceIdsByAppointment: new Map(), schedules: [], timeOff: [], salonHours, requirementsByServiceId, resourceAllocations: [], downtime: downtimeRows.map((row: { downtime: typeof salonResourceDowntimeTable.$inferSelect }) => row.downtime) };
  const [employeeServiceLinks, appointments, schedules, timeOff] = await Promise.all([
    store.select().from(employeeServicesTable).where(and(inArray(employeeServicesTable.employeeId, employeeIds), inArray(employeeServicesTable.serviceId, serviceIds))),
    store.select({ id: appointmentsTable.id, employeeId: appointmentsTable.employeeId, date: appointmentsTable.date, startTime: appointmentsTable.startTime, endTime: appointmentsTable.endTime, service: servicesTable }).from(appointmentsTable).innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId)).where(and(inArray(appointmentsTable.employeeId, employeeIds), gte(appointmentsTable.date, startDate), lte(appointmentsTable.date, endDate), ne(appointmentsTable.status, "cancelled"))),
    store.select().from(employeeLocationSchedulesTable).where(and(inArray(employeeLocationSchedulesTable.employeeId, employeeIds), eq(employeeLocationSchedulesTable.salonId, input.salonId))),
    store.select().from(employeeTimeOffTable).where(and(inArray(employeeTimeOffTable.employeeId, employeeIds), lte(employeeTimeOffTable.startDate, endDate), gte(employeeTimeOffTable.endDate, startDate), or(isNull(employeeTimeOffTable.salonId), eq(employeeTimeOffTable.salonId, input.salonId)))),
  ]);
  const appointmentIds = appointments.map((appointment: { id: string }) => appointment.id);
  const allocationLinks = appointmentIds.length ? await store.select().from(appointmentResourceAllocationsTable).where(inArray(appointmentResourceAllocationsTable.appointmentId, appointmentIds)) : [];
  const resourceIds = [...new Set(typedRequirements.map((requirement) => requirement.resourceId))];
  const resourceAllocations = resourceIds.length ? await store.select({ appointmentId: appointmentsTable.id, resourceId: appointmentResourceAllocationsTable.resourceId, quantity: appointmentResourceAllocationsTable.quantity, date: appointmentsTable.date, startTime: appointmentsTable.startTime, endTime: appointmentsTable.endTime, service: servicesTable }).from(appointmentResourceAllocationsTable).innerJoin(appointmentsTable, eq(appointmentsTable.id, appointmentResourceAllocationsTable.appointmentId)).innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId)).where(and(inArray(appointmentResourceAllocationsTable.resourceId, resourceIds), gte(appointmentsTable.date, startDate), lte(appointmentsTable.date, endDate), ne(appointmentsTable.status, "cancelled"))) : [];
  const resourceIdsByAppointment = new Map<string, string[]>();
  for (const allocation of allocationLinks) resourceIdsByAppointment.set(allocation.appointmentId, [...(resourceIdsByAppointment.get(allocation.appointmentId) ?? []), allocation.resourceId]);
  return { salonId: input.salonId, startDate, endDate, settings, dateHours, employees, employeeServiceLinks, appointments, resourceIdsByAppointment, schedules, timeOff, salonHours, requirementsByServiceId, resourceAllocations, downtime: downtimeRows.map((row: { downtime: typeof salonResourceDowntimeTable.$inferSelect }) => row.downtime) };
}

/**
 * DB adapter for the pure availability engine. Policy, exceptional hours and
 * resource downtime are always read from the owning location, including when
 * this is called inside a booking transaction.
 */
export async function canonicalAvailability(input: {
  salonId: string;
  service: typeof servicesTable.$inferSelect;
  dates: string[];
  employeeId?: string | null;
  limit?: number;
  /** Retained for callers compiled before policy enforcement; DB policy wins. */
  granularityMinutes?: number;
  now?: GenerateAvailabilityInput["now"];
  excludeAppointmentIds?: string[];
  /** Tentative members of the same preview/write batch, not persisted yet. */
  reservedAppointments?: BusyAppointment[];
  /** Tentative resource usage by members of the same preview/write batch. */
  resourceReservations?: ResourceAllocation[];
  /**
   * Optional route-level preload. Group previews call this adapter repeatedly
   * while extending candidates, so supplying this avoids re-reading the same
   * service requirements for every branch.
   */
  resourceRequirements?: Array<{
    resourceId: string;
    quantity: number;
    capacity: number;
    active: boolean;
  }>;
  context?: CanonicalAvailabilityContext;
  // Drizzle's transaction session is structurally compatible with db but has
  // an intentionally non-exported generic type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store?: any;
}): Promise<AvailabilitySlot[]> {
  const store = input.store ?? db;
  if (!input.dates.length) return [];
  if (input.context) {
    const context = input.context;
    if (context.salonId !== input.salonId || input.dates.some((date) => date < context.startDate || date > context.endDate)) {
      throw new Error("Canonical availability context does not cover this salon/date window.");
    }
    const granularity = context.settings?.slotGranularityMinutes ?? 15;
    const minimumLeadTimeMinutes = context.settings?.minimumLeadTimeMinutes ?? 0;
    const systemNow = new Date();
    const effectiveNow = input.now ?? { date: systemNow.toISOString().slice(0, 10), time: systemNow.toISOString().slice(11, 16) };
    const linked = new Set(context.employeeServiceLinks.filter((link) => link.serviceId === input.service.id).map((link) => link.employeeId));
    const candidates = context.employees.filter((employee) => linked.has(employee.id) && (!input.employeeId || employee.id === input.employeeId));
    if (!candidates.length) return [];
    const candidateIds = new Set(candidates.map((employee) => employee.id));
    const requirements = input.resourceRequirements ?? context.requirementsByServiceId.get(input.service.id) ?? [];
    const requirementIds = new Set(requirements.map((item) => item.resourceId));
    const resourceDowntime = context.downtime.flatMap((downtime) => input.dates.flatMap((date) => {
      const dayStart = new Date(`${date}T00:00:00.000Z`); const dayEnd = new Date(`${date}T24:00:00.000Z`);
      if (downtime.endsAt <= dayStart || downtime.startsAt >= dayEnd) return [];
      const start = downtime.startsAt > dayStart ? downtime.startsAt : dayStart;
      const end = downtime.endsAt < dayEnd ? downtime.endsAt : dayEnd;
      return [{ resourceId: downtime.resourceId, date, startTime: start.toISOString().slice(11, 16), endTime: end.getTime() === dayEnd.getTime() ? "24:00" : end.toISOString().slice(11, 16) }];
    }));
    return generateAvailability({
      dates: input.dates, durationMinutes: input.service.durationMinutes,
      bufferMinutes: optionalNumber((input.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0),
      granularityMinutes: granularity, employees: candidates,
      salonHours: context.salonHours.map((hours) => ({ weekday: hours.weekday, startTime: hours.openTime, endTime: hours.closeTime, closed: hours.closed })),
      dateOverrides: context.dateHours.map((hours) => ({ date: hours.date, startTime: hours.openTime, endTime: hours.closeTime, closed: hours.closed })),
      employeeSchedules: context.schedules.filter((schedule) => candidateIds.has(schedule.employeeId)),
      timeOff: context.timeOff.filter((timeOff) => candidateIds.has(timeOff.employeeId)),
      appointments: [
        ...context.appointments.filter((appointment) => !!appointment.employeeId && candidateIds.has(appointment.employeeId) && (!input.excludeAppointmentIds?.includes(appointment.id))).map((appointment) => ({
          employeeId: appointment.employeeId, date: appointment.date, startTime: appointment.startTime, endTime: appointment.endTime,
          bufferMinutes: optionalNumber((appointment.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0),
          resourceIds: context.resourceIdsByAppointment.get(appointment.id) ?? [],
        })),
        ...(input.reservedAppointments ?? []),
      ],
      resourceRequirements: requirements,
      resourceAllocations: [
        ...context.resourceAllocations.filter((allocation) => requirementIds.has(allocation.resourceId) && (!input.excludeAppointmentIds?.includes(allocation.appointmentId))).map((allocation) => ({
          ...allocation, bufferMinutes: optionalNumber((allocation.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0),
        })),
        ...(input.resourceReservations ?? []),
      ],
      resourceDowntime, limit: input.limit, now: effectiveNow, minimumLeadTimeMinutes,
    });
  }
  const startDate = [...input.dates].sort()[0]!;
  const endDate = [...input.dates].sort().at(-1)!;
  const settingsRows = (await store.select().from(salonBookingSettingsTable)
    .where(eq(salonBookingSettingsTable.salonId, input.salonId)).limit(1)
  ) as (typeof salonBookingSettingsTable.$inferSelect)[];
  const [settings] = settingsRows;
  // A pre-policy salon has the same effective defaults exposed by the settings
  // endpoint. Do not let a public query select an unconfigured cadence.
  const granularity = settings?.slotGranularityMinutes ?? 15;
  const minimumLeadTimeMinutes = settings?.minimumLeadTimeMinutes ?? 0;
  const systemNow = new Date();
  const effectiveNow = input.now ?? {
    date: systemNow.toISOString().slice(0, 10),
    time: systemNow.toISOString().slice(11, 16),
  };
  const dateHours = await store.select().from(salonDateHoursTable).where(and(
    eq(salonDateHoursTable.salonId, input.salonId),
    gte(salonDateHoursTable.date, startDate),
    lte(salonDateHoursTable.date, endDate),
  )) as (typeof salonDateHoursTable.$inferSelect)[];
  const employeeRows = await store.select({ employee: employeesTable }).from(employeesTable)
    .innerJoin(employeeLocationAssignmentsTable, and(
      eq(employeeLocationAssignmentsTable.employeeId, employeesTable.id),
      eq(employeeLocationAssignmentsTable.salonId, input.salonId),
      eq(employeeLocationAssignmentsTable.active, true),
    ))
    .where(eq(employeesTable.active, true)) as Array<{ employee: typeof employeesTable.$inferSelect }>;
  const allEmployees = employeeRows.map((row) => row.employee);
  const employeeIds = allEmployees.map((employee) => employee.id);
  if (!employeeIds.length) return [];
  const links = await store.select().from(employeeServicesTable).where(and(
    inArray(employeeServicesTable.employeeId, employeeIds),
    eq(employeeServicesTable.serviceId, input.service.id),
  )) as (typeof employeeServicesTable.$inferSelect)[];
  const linked = new Set(links.map((link) => link.employeeId));
  const candidates = allEmployees.filter((employee) => linked.has(employee.id)
    && (!input.employeeId || employee.id === input.employeeId));
  if (!candidates.length) return [];
  const candidateIds = candidates.map((employee) => employee.id);

  // Sequential reads also make this adapter safe to use with a transaction's
  // single pg client during final booking revalidation.
  const appointmentIds = await store.select({ id: appointmentsTable.id })
    .from(appointmentsTable).where(and(
      inArray(appointmentsTable.employeeId, candidateIds),
      gte(appointmentsTable.date, startDate),
      lte(appointmentsTable.date, endDate),
      ne(appointmentsTable.status, "cancelled"),
      input.excludeAppointmentIds?.length ? notInArray(appointmentsTable.id, input.excludeAppointmentIds) : undefined,
    )) as Array<{ id: string }>;
  const allocationLinks = appointmentIds.length
    ? await store.select().from(appointmentResourceAllocationsTable)
      .where(inArray(appointmentResourceAllocationsTable.appointmentId, appointmentIds.map((item) => item.id)))
    : [] as (typeof appointmentResourceAllocationsTable.$inferSelect)[];
  const resourceIdsByAppointment = new Map<string, string[]>();
  for (const allocation of allocationLinks) {
    resourceIdsByAppointment.set(allocation.appointmentId, [
      ...(resourceIdsByAppointment.get(allocation.appointmentId) ?? []),
      allocation.resourceId,
    ]);
  }
  // Keep appointment IDs and service buffers associated without relying on a
  // not-yet-generated service.bufferMinutes type.
  const busyAppointments = await store.select({
    id: appointmentsTable.id,
    employeeId: appointmentsTable.employeeId,
    date: appointmentsTable.date,
    startTime: appointmentsTable.startTime,
    endTime: appointmentsTable.endTime,
    service: servicesTable,
  }).from(appointmentsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
    .where(and(
      inArray(appointmentsTable.employeeId, candidateIds),
      gte(appointmentsTable.date, startDate),
      lte(appointmentsTable.date, endDate),
      ne(appointmentsTable.status, "cancelled"),
      input.excludeAppointmentIds?.length ? notInArray(appointmentsTable.id, input.excludeAppointmentIds) : undefined,
    )) as Array<{
      id: string; employeeId: string | null; date: string; startTime: string; endTime: string;
      service: typeof servicesTable.$inferSelect;
    }>;
  const schedules = await store.select().from(employeeLocationSchedulesTable).where(and(
    inArray(employeeLocationSchedulesTable.employeeId, candidateIds),
    eq(employeeLocationSchedulesTable.salonId, input.salonId),
  )) as (typeof employeeLocationSchedulesTable.$inferSelect)[];
  const timeOff = await store.select().from(employeeTimeOffTable).where(and(
    inArray(employeeTimeOffTable.employeeId, candidateIds),
    lte(employeeTimeOffTable.startDate, endDate),
    gte(employeeTimeOffTable.endDate, startDate),
    or(isNull(employeeTimeOffTable.salonId), eq(employeeTimeOffTable.salonId, input.salonId)),
  )) as (typeof employeeTimeOffTable.$inferSelect)[];
  const salonHours = await store.select().from(salonHoursTable)
    .where(eq(salonHoursTable.salonId, input.salonId)) as (typeof salonHoursTable.$inferSelect)[];
  const requirements = input.resourceRequirements ?? await store.select({
    resourceId: serviceResourceRequirementsTable.resourceId,
    quantity: serviceResourceRequirementsTable.quantity,
    capacity: salonResourcesTable.capacity,
    active: salonResourcesTable.active,
  }).from(serviceResourceRequirementsTable)
    .innerJoin(salonResourcesTable, eq(salonResourcesTable.id, serviceResourceRequirementsTable.resourceId))
    .where(eq(serviceResourceRequirementsTable.serviceId, input.service.id)) as Array<{
      resourceId: string; quantity: number; capacity: number; active: boolean;
    }>;
  const requirementIds = requirements.map((item) => item.resourceId);
  const downtimeRows = await store.select({ downtime: salonResourceDowntimeTable })
    .from(salonResourceDowntimeTable)
    .innerJoin(salonResourcesTable, eq(salonResourcesTable.id, salonResourceDowntimeTable.resourceId))
    .where(eq(salonResourcesTable.salonId, input.salonId)) as Array<{
      downtime: typeof salonResourceDowntimeTable.$inferSelect;
    }>;
  const resourceDowntime = downtimeRows.flatMap(({ downtime }) => input.dates.flatMap((date) => {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T24:00:00.000Z`);
    if (downtime.endsAt <= dayStart || downtime.startsAt >= dayEnd) return [];
    const start = downtime.startsAt > dayStart ? downtime.startsAt : dayStart;
    const end = downtime.endsAt < dayEnd ? downtime.endsAt : dayEnd;
    return [{
      resourceId: downtime.resourceId,
      date,
      startTime: start.toISOString().slice(11, 16),
      // 24:00 retains a downtime that runs through the end of this day.
      endTime: end.getTime() === dayEnd.getTime() ? "24:00" : end.toISOString().slice(11, 16),
    }];
  }));
  const resourceAllocations = requirementIds.length
    ? await store.select({
      resourceId: appointmentResourceAllocationsTable.resourceId,
      quantity: appointmentResourceAllocationsTable.quantity,
      date: appointmentsTable.date,
      startTime: appointmentsTable.startTime,
      endTime: appointmentsTable.endTime,
      service: servicesTable,
    }).from(appointmentResourceAllocationsTable)
      .innerJoin(appointmentsTable, eq(appointmentsTable.id, appointmentResourceAllocationsTable.appointmentId))
      .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
      .where(and(
        inArray(appointmentResourceAllocationsTable.resourceId, requirementIds),
        gte(appointmentsTable.date, startDate),
        lte(appointmentsTable.date, endDate),
        ne(appointmentsTable.status, "cancelled"),
        input.excludeAppointmentIds?.length ? notInArray(appointmentsTable.id, input.excludeAppointmentIds) : undefined,
      ))
    : [] as Array<{
      resourceId: string; quantity: number; date: string; startTime: string; endTime: string;
      service: typeof servicesTable.$inferSelect;
    }>;

  return generateAvailability({
    dates: input.dates,
    durationMinutes: input.service.durationMinutes,
    bufferMinutes: optionalNumber((input.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0),
    granularityMinutes: granularity,
    employees: candidates,
    salonHours: salonHours.map((hours) => ({
      weekday: hours.weekday,
      startTime: hours.openTime,
      endTime: hours.closeTime,
      closed: hours.closed,
    })),
    dateOverrides: dateHours.map((hours) => ({
      date: hours.date,
      startTime: hours.openTime,
      endTime: hours.closeTime,
      closed: hours.closed,
    })),
    employeeSchedules: schedules,
    timeOff,
    appointments: [
      ...busyAppointments.map((appointment) => ({
        employeeId: appointment.employeeId,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        bufferMinutes: optionalNumber((appointment.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0),
        resourceIds: resourceIdsByAppointment.get(appointment.id) ?? [],
      })),
      ...(input.reservedAppointments ?? []),
    ],
    resourceRequirements: requirements,
    resourceAllocations: [
      ...resourceAllocations.map((allocation: {
        resourceId: string; quantity: number; date: string; startTime: string; endTime: string;
        service: typeof servicesTable.$inferSelect;
      }) => ({
        ...allocation,
        bufferMinutes: optionalNumber((allocation.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0),
      })),
      ...(input.resourceReservations ?? []),
    ],
    resourceDowntime,
    limit: input.limit,
    now: effectiveNow,
    minimumLeadTimeMinutes,
  });
}