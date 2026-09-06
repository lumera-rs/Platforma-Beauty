import { and, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import {
  appointmentEmployeesTable,
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
  salonsTable,
  salonResourcesTable,
  salonResourceDowntimeTable,
  serviceResourceRequirementsTable,
  servicesTable,
} from "@workspace/db";
import {
  DEFAULT_SALON_TIME_ZONE,
  generateAvailability,
  type AvailabilitySlot,
  type BusyAppointment,
  type GenerateAvailabilityInput,
  type ResourceAllocation,
  type ResourceRequirement,
  wallClockNowInTimeZone,
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
  appointments: Array<{
    id: string; employeeId: string | null; serviceId: string; date: string;
    startTime: string; endTime: string;
    preProcessingMinutes: number; processingMinutes: number; postProcessingMinutes: number;
    bufferMinutes: number; seatCount: number;
    service: typeof servicesTable.$inferSelect;
  }>;
  resourceIdsByAppointment: Map<string, string[]>;
  /** Every employee each appointment commits, primary plus participants. */
  employeeIdsByAppointment: Map<string, string[]>;
  schedules: Array<typeof employeeLocationSchedulesTable.$inferSelect>;
  timeOff: Array<typeof employeeTimeOffTable.$inferSelect>;
  salonHours: Array<typeof salonHoursTable.$inferSelect>;
  requirementsByServiceId: Map<string, Array<{ resourceId: string; quantity: number; capacity: number; active: boolean }>>;
  resourceAllocations: Array<{ appointmentId: string; resourceId: string; quantity: number; date: string; startTime: string; endTime: string; service: typeof servicesTable.$inferSelect }>;
  downtime: Array<typeof salonResourceDowntimeTable.$inferSelect>;
};

/**
 * Base-service requirements plus whatever the chosen add-ons need, summed per
 * resource. An add-on that pulls in a resource the base treatment does not use
 * must be checked by the same revalidation, not a separate one.
 */
function mergeResourceRequirements(
  base: ResourceRequirement[],
  addOns: ResourceRequirement[] | undefined,
): ResourceRequirement[] {
  if (!addOns?.length) return base;
  const merged = new Map<string, ResourceRequirement>();
  for (const requirement of [...base, ...addOns]) {
    const existing = merged.get(requirement.resourceId);
    merged.set(requirement.resourceId, existing
      ? { ...existing, quantity: existing.quantity + requirement.quantity }
      : { ...requirement });
  }
  return [...merged.values()];
}

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
  if (!employeeIds.length) return { salonId: input.salonId, startDate, endDate, settings, dateHours, employees, employeeServiceLinks: [], appointments: [], resourceIdsByAppointment: new Map(), employeeIdsByAppointment: new Map(), schedules: [], timeOff: [], salonHours, requirementsByServiceId, resourceAllocations: [], downtime: downtimeRows.map((row: { downtime: typeof salonResourceDowntimeTable.$inferSelect }) => row.downtime) };
  const [employeeServiceLinks, appointments, schedules, timeOff] = await Promise.all([
    store.select().from(employeeServicesTable).where(and(inArray(employeeServicesTable.employeeId, employeeIds), inArray(employeeServicesTable.serviceId, serviceIds))),
    // An appointment is relevant when ANY employee it commits is a candidate —
    // the primary on the row, or a participant on a multi-employee treatment.
    store.select({
      id: appointmentsTable.id, employeeId: appointmentsTable.employeeId,
      serviceId: appointmentsTable.serviceId,
      date: appointmentsTable.date, startTime: appointmentsTable.startTime, endTime: appointmentsTable.endTime,
      preProcessingMinutes: appointmentsTable.preProcessingMinutes,
      processingMinutes: appointmentsTable.processingMinutes,
      postProcessingMinutes: appointmentsTable.postProcessingMinutes,
      bufferMinutes: appointmentsTable.bufferMinutes,
      seatCount: appointmentsTable.seatCount,
      service: servicesTable,
    }).from(appointmentsTable).innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId)).where(and(
      or(
        inArray(appointmentsTable.employeeId, employeeIds),
        sql`exists (select 1 from ${appointmentEmployeesTable} ae
          where ae.appointment_id = ${appointmentsTable.id}
            and ae.employee_id in ${employeeIds})`,
      ),
      gte(appointmentsTable.date, startDate), lte(appointmentsTable.date, endDate),
      ne(appointmentsTable.status, "cancelled"),
    )),
    store.select().from(employeeLocationSchedulesTable).where(and(inArray(employeeLocationSchedulesTable.employeeId, employeeIds), eq(employeeLocationSchedulesTable.salonId, input.salonId))),
    store.select().from(employeeTimeOffTable).where(and(inArray(employeeTimeOffTable.employeeId, employeeIds), lte(employeeTimeOffTable.startDate, endDate), gte(employeeTimeOffTable.endDate, startDate), or(isNull(employeeTimeOffTable.salonId), eq(employeeTimeOffTable.salonId, input.salonId)))),
  ]);
  const appointmentIds = appointments.map((appointment: { id: string }) => appointment.id);
  const allocationLinks = appointmentIds.length ? await store.select().from(appointmentResourceAllocationsTable).where(inArray(appointmentResourceAllocationsTable.appointmentId, appointmentIds)) : [];
  const resourceIds = [...new Set(typedRequirements.map((requirement) => requirement.resourceId))];
  const resourceAllocations = resourceIds.length ? await store.select({ appointmentId: appointmentsTable.id, resourceId: appointmentResourceAllocationsTable.resourceId, quantity: appointmentResourceAllocationsTable.quantity, date: appointmentsTable.date, startTime: appointmentsTable.startTime, endTime: appointmentsTable.endTime, service: servicesTable }).from(appointmentResourceAllocationsTable).innerJoin(appointmentsTable, eq(appointmentsTable.id, appointmentResourceAllocationsTable.appointmentId)).innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId)).where(and(inArray(appointmentResourceAllocationsTable.resourceId, resourceIds), gte(appointmentsTable.date, startDate), lte(appointmentsTable.date, endDate), ne(appointmentsTable.status, "cancelled"))) : [];
  const resourceIdsByAppointment = new Map<string, string[]>();
  for (const allocation of allocationLinks) resourceIdsByAppointment.set(allocation.appointmentId, [...(resourceIdsByAppointment.get(allocation.appointmentId) ?? []), allocation.resourceId]);
  const participantRows = appointmentIds.length
    ? await store.select().from(appointmentEmployeesTable).where(inArray(appointmentEmployeesTable.appointmentId, appointmentIds))
    : [];
  const employeeIdsByAppointment = new Map<string, string[]>();
  for (const appointment of appointments as Array<{ id: string; employeeId: string | null }>) {
    if (appointment.employeeId) employeeIdsByAppointment.set(appointment.id, [appointment.employeeId]);
  }
  for (const participant of participantRows as Array<{ appointmentId: string; employeeId: string }>) {
    const current = employeeIdsByAppointment.get(participant.appointmentId) ?? [];
    if (!current.includes(participant.employeeId)) {
      employeeIdsByAppointment.set(participant.appointmentId, [...current, participant.employeeId]);
    }
  }
  return { salonId: input.salonId, startDate, endDate, settings, dateHours, employees, employeeServiceLinks, appointments, resourceIdsByAppointment, employeeIdsByAppointment, schedules, timeOff, salonHours, requirementsByServiceId, resourceAllocations, downtime: downtimeRows.map((row: { downtime: typeof salonResourceDowntimeTable.$inferSelect }) => row.downtime) };
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
  /** Extra active minutes contributed by the add-ons chosen for this booking. */
  addOnMinutes?: number;
  /** Seats requested in a shared-capacity treatment. Defaults to 1. */
  seatCount?: number;
  /** Resources the chosen add-ons require on top of the base service. */
  addOnResourceRequirements?: ResourceRequirement[];
  /**
   * Overrides the service's own crew size. The booking transaction picks the
   * crew once, then revalidates each member individually — at which point the
   * question is "is THIS person free", not "are N people free", so it passes 1.
   */
  requiredEmployeeCount?: number;
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
    const effectiveNow = input.now ?? wallClockNowInTimeZone(new Date(), DEFAULT_SALON_TIME_ZONE);
    const linked = new Set(context.employeeServiceLinks.filter((link) => link.serviceId === input.service.id).map((link) => link.employeeId));
    const candidates = context.employees.filter((employee) => linked.has(employee.id) && (!input.employeeId || employee.id === input.employeeId));
    if (!candidates.length) return [];
    const candidateIds = new Set(candidates.map((employee) => employee.id));
    const requirements = mergeResourceRequirements(
      input.resourceRequirements ?? context.requirementsByServiceId.get(input.service.id) ?? [],
      input.addOnResourceRequirements,
    );
    const requirementIds = new Set(requirements.map((item) => item.resourceId));
    const resourceDowntime = context.downtime.flatMap((downtime) => input.dates.flatMap((date) => {
      const dayStart = new Date(`${date}T00:00:00.000Z`); const dayEnd = new Date(`${date}T24:00:00.000Z`);
      if (downtime.endsAt <= dayStart || downtime.startsAt >= dayEnd) return [];
      const start = downtime.startsAt > dayStart ? downtime.startsAt : dayStart;
      const end = downtime.endsAt < dayEnd ? downtime.endsAt : dayEnd;
      return [{ resourceId: downtime.resourceId, date, startTime: start.toISOString().slice(11, 16), endTime: end.getTime() === dayEnd.getTime() ? "24:00" : end.toISOString().slice(11, 16) }];
    }));
    const shape = input.service as unknown as Record<string, unknown>;
    return generateAvailability({
      dates: input.dates, durationMinutes: input.service.durationMinutes,
      bufferMinutes: optionalNumber(shape.bufferMinutes, 0),
      // The treatment's real shape. Absent or zero segments behave exactly as
      // an unsegmented block, so services predating this keep their behaviour.
      preProcessingMinutes: optionalNumber(shape.preProcessingMinutes, 0),
      processingMinutes: optionalNumber(shape.processingMinutes, 0),
      postProcessingMinutes: optionalNumber(shape.postProcessingMinutes, 0),
      requiredEmployeeCount: input.requiredEmployeeCount ?? optionalNumber(shape.requiredEmployeeCount, 1),
      seatCapacity: optionalNumber(shape.seatCapacity, 1),
      addOnMinutes: input.addOnMinutes ?? 0,
      seatCount: input.seatCount ?? 1,
      serviceId: input.service.id,
      granularityMinutes: granularity, employees: candidates,
      salonHours: context.salonHours.map((hours) => ({ weekday: hours.weekday, startTime: hours.openTime, endTime: hours.closeTime, closed: hours.closed })),
      dateOverrides: context.dateHours.map((hours) => ({ date: hours.date, startTime: hours.openTime, endTime: hours.closeTime, closed: hours.closed })),
      employeeSchedules: context.schedules.filter((schedule) => candidateIds.has(schedule.employeeId)),
      timeOff: context.timeOff.filter((timeOff) => candidateIds.has(timeOff.employeeId)),
      appointments: [
        ...context.appointments.filter((appointment) => {
          if (input.excludeAppointmentIds?.includes(appointment.id)) return false;
          // A multi-employee appointment blocks every participant, so it is
          // relevant whenever ANY of its employees is a candidate here.
          const committed = context.employeeIdsByAppointment.get(appointment.id)
            ?? (appointment.employeeId ? [appointment.employeeId] : []);
          return committed.some((employeeId) => candidateIds.has(employeeId));
        }).map((appointment) => {
          const row = appointment as unknown as Record<string, unknown>;
          return {
            employeeId: appointment.employeeId, date: appointment.date,
            startTime: appointment.startTime, endTime: appointment.endTime,
            // The appointment's own buffer snapshot, falling back to the
            // service's for rows booked before appointments carried one.
            bufferMinutes: optionalNumber(row.bufferMinutes,
              optionalNumber((appointment.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0)),
            preProcessingMinutes: optionalNumber(row.preProcessingMinutes, 0),
            processingMinutes: optionalNumber(row.processingMinutes, 0),
            postProcessingMinutes: optionalNumber(row.postProcessingMinutes, 0),
            seatCount: optionalNumber(row.seatCount, 1),
            serviceId: appointment.serviceId,
            employeeIds: context.employeeIdsByAppointment.get(appointment.id)
              ?? (appointment.employeeId ? [appointment.employeeId] : []),
            resourceIds: context.resourceIdsByAppointment.get(appointment.id) ?? [],
          };
        }),
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
  const [policy] = await store.select({
    slotGranularityMinutes: sql<number | null>`(select ${salonBookingSettingsTable.slotGranularityMinutes} from ${salonBookingSettingsTable} where ${salonBookingSettingsTable.salonId} = ${input.salonId} limit 1)`,
    minimumLeadTimeMinutes: sql<number | null>`(select ${salonBookingSettingsTable.minimumLeadTimeMinutes} from ${salonBookingSettingsTable} where ${salonBookingSettingsTable.salonId} = ${input.salonId} limit 1)`,
    dateHours: sql<Array<{ date: string; openTime: string; closeTime: string; closed: boolean }>>`coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', ${salonDateHoursTable.date},
        'openTime', ${salonDateHoursTable.openTime},
        'closeTime', ${salonDateHoursTable.closeTime},
        'closed', ${salonDateHoursTable.closed}
      ))
      from ${salonDateHoursTable}
      where ${salonDateHoursTable.salonId} = ${input.salonId}
        and ${salonDateHoursTable.date} >= ${startDate}
        and ${salonDateHoursTable.date} <= ${endDate}
    ), '[]'::jsonb)`,
    salonHours: sql<Array<{ weekday: number; openTime: string; closeTime: string; closed: boolean }>>`coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', ${salonHoursTable.weekday},
        'openTime', ${salonHoursTable.openTime},
        'closeTime', ${salonHoursTable.closeTime},
        'closed', ${salonHoursTable.closed}
      ))
      from ${salonHoursTable}
      where ${salonHoursTable.salonId} = ${input.salonId}
    ), '[]'::jsonb)`,
  }).from(salonsTable).where(eq(salonsTable.id, input.salonId)).limit(1);
  // A pre-policy salon has the same effective defaults exposed by the settings
  // endpoint. Do not let a public query select an unconfigured cadence.
  const granularity = policy?.slotGranularityMinutes ?? 15;
  const minimumLeadTimeMinutes = policy?.minimumLeadTimeMinutes ?? 0;
  const effectiveNow = input.now ?? wallClockNowInTimeZone(new Date(), DEFAULT_SALON_TIME_ZONE);
  const dateHours = policy?.dateHours ?? [];
  const employeeRows = await store.select({ employee: employeesTable }).from(employeesTable)
    .innerJoin(employeeLocationAssignmentsTable, and(
      eq(employeeLocationAssignmentsTable.employeeId, employeesTable.id),
      eq(employeeLocationAssignmentsTable.salonId, input.salonId),
      eq(employeeLocationAssignmentsTable.active, true),
    ))
    .innerJoin(employeeServicesTable, and(
      eq(employeeServicesTable.employeeId, employeesTable.id),
      eq(employeeServicesTable.serviceId, input.service.id),
    ))
    .where(and(
      eq(employeesTable.active, true),
      input.employeeId ? eq(employeesTable.id, input.employeeId) : undefined,
    )) as Array<{ employee: typeof employeesTable.$inferSelect }>;
  const allEmployees = employeeRows.map((row) => row.employee);
  const employeeIds = allEmployees.map((employee) => employee.id);
  if (!employeeIds.length) return [];
  const candidates = allEmployees.filter((employee) => !input.employeeId || employee.id === input.employeeId);
  if (!candidates.length) return [];
  const candidateIds = candidates.map((employee) => employee.id);

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
  const effectiveRequirements = mergeResourceRequirements(requirements, input.addOnResourceRequirements);
  const requirementIds = effectiveRequirements.map((item) => item.resourceId);

  // Sequential reads also make this adapter safe to use with a transaction's
  // single pg client during final booking revalidation.
  const appointmentIds = requirements.length
    ? await store.select({ id: appointmentsTable.id })
      .from(appointmentsTable).where(and(
        inArray(appointmentsTable.employeeId, candidateIds),
        gte(appointmentsTable.date, startDate),
        lte(appointmentsTable.date, endDate),
        ne(appointmentsTable.status, "cancelled"),
        input.excludeAppointmentIds?.length ? notInArray(appointmentsTable.id, input.excludeAppointmentIds) : undefined,
      )) as Array<{ id: string }>
    : [];
  const allocationLinks = requirements.length && appointmentIds.length
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
    serviceId: appointmentsTable.serviceId,
    date: appointmentsTable.date,
    startTime: appointmentsTable.startTime,
    endTime: appointmentsTable.endTime,
    preProcessingMinutes: appointmentsTable.preProcessingMinutes,
    processingMinutes: appointmentsTable.processingMinutes,
    postProcessingMinutes: appointmentsTable.postProcessingMinutes,
    bufferMinutes: appointmentsTable.bufferMinutes,
    seatCount: appointmentsTable.seatCount,
    service: servicesTable,
  }).from(appointmentsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
    .where(and(
      // Same rule as the preloaded branch: any committed employee makes the
      // appointment relevant, not only the one on the row.
      or(
        inArray(appointmentsTable.employeeId, candidateIds),
        sql`exists (select 1 from ${appointmentEmployeesTable} ae
          where ae.appointment_id = ${appointmentsTable.id}
            and ae.employee_id in ${candidateIds})`,
      ),
      gte(appointmentsTable.date, startDate),
      lte(appointmentsTable.date, endDate),
      ne(appointmentsTable.status, "cancelled"),
      input.excludeAppointmentIds?.length ? notInArray(appointmentsTable.id, input.excludeAppointmentIds) : undefined,
    )) as Array<{
      id: string; employeeId: string | null; serviceId: string; date: string; startTime: string; endTime: string;
      preProcessingMinutes: number; processingMinutes: number; postProcessingMinutes: number;
      bufferMinutes: number; seatCount: number;
      service: typeof servicesTable.$inferSelect;
    }>;
  const busyParticipants = busyAppointments.length
    ? await store.select().from(appointmentEmployeesTable)
      .where(inArray(appointmentEmployeesTable.appointmentId, busyAppointments.map((item) => item.id))) as Array<{
        appointmentId: string; employeeId: string;
      }>
    : [];
  const busyEmployeeIdsByAppointment = new Map<string, string[]>();
  for (const appointment of busyAppointments) {
    if (appointment.employeeId) busyEmployeeIdsByAppointment.set(appointment.id, [appointment.employeeId]);
  }
  for (const participant of busyParticipants) {
    const current = busyEmployeeIdsByAppointment.get(participant.appointmentId) ?? [];
    if (!current.includes(participant.employeeId)) {
      busyEmployeeIdsByAppointment.set(participant.appointmentId, [...current, participant.employeeId]);
    }
  }
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
  const salonHours = policy?.salonHours ?? [];
  const downtimeRows = requirements.length
    ? await store.select({ downtime: salonResourceDowntimeTable })
      .from(salonResourceDowntimeTable)
      .innerJoin(salonResourcesTable, eq(salonResourcesTable.id, salonResourceDowntimeTable.resourceId))
      .where(eq(salonResourcesTable.salonId, input.salonId)) as Array<{
        downtime: typeof salonResourceDowntimeTable.$inferSelect;
      }>
    : [];
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

  const shape = input.service as unknown as Record<string, unknown>;
  return generateAvailability({
    dates: input.dates,
    durationMinutes: input.service.durationMinutes,
    bufferMinutes: optionalNumber(shape.bufferMinutes, 0),
    preProcessingMinutes: optionalNumber(shape.preProcessingMinutes, 0),
    processingMinutes: optionalNumber(shape.processingMinutes, 0),
    postProcessingMinutes: optionalNumber(shape.postProcessingMinutes, 0),
    requiredEmployeeCount: input.requiredEmployeeCount ?? optionalNumber(shape.requiredEmployeeCount, 1),
    seatCapacity: optionalNumber(shape.seatCapacity, 1),
    addOnMinutes: input.addOnMinutes ?? 0,
    seatCount: input.seatCount ?? 1,
    serviceId: input.service.id,
    granularityMinutes: granularity,
    employees: candidates,
    salonHours: salonHours.map((hours: { weekday: number; openTime: string; closeTime: string; closed: boolean }) => ({
      weekday: hours.weekday,
      startTime: hours.openTime,
      endTime: hours.closeTime,
      closed: hours.closed,
    })),
    dateOverrides: dateHours.map((hours: { date: string; openTime: string; closeTime: string; closed: boolean }) => ({
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
        serviceId: appointment.serviceId,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        bufferMinutes: optionalNumber(appointment.bufferMinutes,
          optionalNumber((appointment.service as unknown as { bufferMinutes?: unknown }).bufferMinutes, 0)),
        preProcessingMinutes: optionalNumber(appointment.preProcessingMinutes, 0),
        processingMinutes: optionalNumber(appointment.processingMinutes, 0),
        postProcessingMinutes: optionalNumber(appointment.postProcessingMinutes, 0),
        seatCount: optionalNumber(appointment.seatCount, 1),
        employeeIds: busyEmployeeIdsByAppointment.get(appointment.id)
          ?? (appointment.employeeId ? [appointment.employeeId] : []),
        resourceIds: resourceIdsByAppointment.get(appointment.id) ?? [],
      })),
      ...(input.reservedAppointments ?? []),
    ],
    resourceRequirements: effectiveRequirements,
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