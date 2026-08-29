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
  // Drizzle's transaction session is structurally compatible with db but has
  // an intentionally non-exported generic type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store?: any;
}): Promise<AvailabilitySlot[]> {
  const store = input.store ?? db;
  if (!input.dates.length) return [];
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
  const requirements = await store.select({
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