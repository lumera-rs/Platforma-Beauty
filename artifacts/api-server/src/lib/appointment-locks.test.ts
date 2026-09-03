import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  appointmentResourceAllocationsTable,
  appointmentTreatmentEmployeesTable,
  appointmentTreatmentsTable,
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  pool,
  salonResourcesTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { lockAppointmentResources } from "./appointment-locks";
import { canonicalAvailability } from "./availability-store";
import { assertNoPgBusyClientWarnings } from "./pg-busy-client.test-support";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const date = "2099-10-18";
const movedDate = "2099-10-19";
const crossLocationDate = "2099-10-20";
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function run(): Promise<void> {
  await ensureDemoData();
  const [owner] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (!owner) throw new Error("Appointment concurrency test requires a seeded owner.");

  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Concurrency salon ${suffix}`,
    slug: `concurrency-salon-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 26",
    phone: "+381110000026",
    email: `concurrency-${suffix}@example.test`,
    shortDescription: "Salon za proveru paralelnih izmena termina.",
    description: "Izolovan salon za proveru zaključavanja termina.",
    imageUrl: "/test.jpg",
  }).returning();
  const [service] = await db.insert(servicesTable).values({
    salonId: salon!.id,
    categoryName: "Test",
    name: "Termin sa zaključavanjem",
    description: "Usluga za konkurentni test.",
    durationMinutes: 60,
    requiredEmployeeCount: 2,
    price: 1000,
    imageUrl: "/test.jpg",
  }).returning();
  const [employee] = await db.insert(employeesTable).values({
    salonId: salon!.id,
    name: "Test zaposleni",
    role: "Stilist",
    bio: "",
    avatarUrl: "",
  }).returning();
  await db.insert(employeeLocationAssignmentsTable).values({
    employeeId: employee!.id,
    salonId: salon!.id,
    active: true,
    isDefault: true,
  });
  await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: service!.id });
  const [siblingSalon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Sibling concurrency salon ${suffix}`,
    slug: `sibling-concurrency-salon-${suffix}`,
    city: "Novi Sad",
    municipality: "Centar",
    address: "Test 27",
    phone: "+381110000027",
    email: `sibling-concurrency-${suffix}@example.test`,
    shortDescription: "Druga lokacija za proveru globalnog zaključavanja.",
    description: "Izolovana sestrinska lokacija.",
    imageUrl: "/test.jpg",
  }).returning();
  const [siblingService] = await db.insert(servicesTable).values({
    salonId: siblingSalon!.id,
    categoryName: "Test",
    name: "Termin druge lokacije",
    description: "Usluga za globalno zaključavanje zaposlenog.",
    durationMinutes: 60,
    requiredEmployeeCount: 2,
    price: 1000,
    imageUrl: "/test.jpg",
  }).returning();
  await db.insert(employeeLocationAssignmentsTable).values({
    employeeId: employee!.id,
    salonId: siblingSalon!.id,
    active: true,
  });
  await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: siblingService!.id });
  const [secondaryEmployee] = await db.insert(employeesTable).values({
    salonId: salon!.id,
    name: "Test sekundarni zaposleni",
    role: "Asistent",
    bio: "",
    avatarUrl: "",
  }).returning();
  await db.insert(employeeLocationAssignmentsTable).values([
    { employeeId: secondaryEmployee!.id, salonId: salon!.id, active: true },
    { employeeId: secondaryEmployee!.id, salonId: siblingSalon!.id, active: true },
  ]);
  await db.insert(employeeServicesTable).values([
    { employeeId: secondaryEmployee!.id, serviceId: service!.id },
    { employeeId: secondaryEmployee!.id, serviceId: siblingService!.id },
  ]);

  try {
    // -------------------------------------------------------------------------
    // Existing test: employee double-booking concurrency
    // -------------------------------------------------------------------------
    const createAtSameTime = async () => db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date, employeeId: employee!.id }]);
      const existing = await tx.select().from(appointmentsTable).where(and(
        eq(appointmentsTable.salonId, salon!.id),
        eq(appointmentsTable.employeeId, employee!.id),
        eq(appointmentsTable.date, date),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
      ));
      const occupied = existing.some((item) => item.startTime < "11:00" && item.endTime > "10:00");
      if (occupied) return false;
      await pause(40);
      await tx.insert(appointmentsTable).values({
        salonId: salon!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      });
      return true;
    });

    const created = await Promise.all([createAtSameTime(), createAtSameTime()]);
    assert.equal(created.filter(Boolean).length, 1, "only one concurrent booking may claim an employee slot");

    const createWithNullEmployee = async (
      targetSalon: typeof salon,
      targetService: typeof service,
      requestedEmployeeIds: string[],
    ) => db.transaction(async (tx) => {
      await lockAppointmentResources(tx, targetSalon!.id, [{ date: crossLocationDate }]);
      const initial = await canonicalAvailability({
        salonId: targetSalon!.id,
        service: targetService!,
        dates: [crossLocationDate],
        employeeIds: requestedEmployeeIds,
        store: tx,
      });
      const selected = initial.find((slot) => slot.startTime === "10:00");
      if (!selected) return null;
      await lockAppointmentResources(tx, targetSalon!.id, selected.employeeIds.map((employeeId) => ({
        date: crossLocationDate,
        employeeId,
      })));
      const locked = await canonicalAvailability({
        salonId: targetSalon!.id,
        service: targetService!,
        dates: [crossLocationDate],
        employeeIds: selected.employeeIds,
        store: tx,
      });
      if (!locked.some((slot) => slot.startTime === "10:00")) return null;
      await pause(40);
      const [appointment] = await tx.insert(appointmentsTable).values({
        salonId: targetSalon!.id,
        employeeId: selected.employeeId,
        serviceId: targetService!.id,
        date: crossLocationDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      }).returning();
      const [treatment] = await tx.insert(appointmentTreatmentsTable).values({
        appointmentId: appointment!.id,
        serviceId: targetService!.id,
        employeeId: selected.employeeIds[0],
        position: 0,
        durationMinutes: 60,
        price: 1000,
        plannedStartTime: "10:00",
        plannedEndTime: "11:00",
      }).returning();
      await tx.insert(appointmentTreatmentEmployeesTable).values(selected.employeeIds.map((employeeId, position) => ({
        appointmentTreatmentId: treatment!.id,
        employeeId,
        position,
      })));
      return appointment!.id;
    });
    const crossLocationCreated = await Promise.all([
      createWithNullEmployee(salon, service, [employee!.id, secondaryEmployee!.id]),
      createWithNullEmployee(siblingSalon, siblingService, [secondaryEmployee!.id, employee!.id]),
    ]);
    assert.equal(
      crossLocationCreated.filter(Boolean).length,
      1,
      "opposite participant orders at sibling locations must serialize without deadlock and only one may claim the shared staff",
    );
    const winningAppointmentId = crossLocationCreated.find(Boolean)!;
    const [winningTreatment] = await db.select().from(appointmentTreatmentsTable)
      .where(eq(appointmentTreatmentsTable.appointmentId, winningAppointmentId)).limit(1);
    const persistedParticipants = await db.select().from(appointmentTreatmentEmployeesTable)
      .where(eq(appointmentTreatmentEmployeesTable.appointmentTreatmentId, winningTreatment!.id));
    assert.equal(persistedParticipants.length, 2, "the winning treatment persists its complete participant set");

    const [seriesMember] = await db.insert(appointmentsTable).values({
      salonId: salon!.id,
      employeeId: employee!.id,
      serviceId: service!.id,
      date,
      startTime: "12:00",
      endTime: "13:00",
      durationMinutes: 60,
      price: 1000,
      status: "confirmed",
    }).returning();

    const move = db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [
        { date, employeeId: employee!.id },
        { date: movedDate, employeeId: employee!.id },
      ]);
      const [current] = await tx.select().from(appointmentsTable).where(eq(appointmentsTable.id, seriesMember!.id)).for("update").limit(1);
      if (!current || !["pending", "confirmed"].includes(current.status)) return false;
      await pause(40);
      const [moved] = await tx.update(appointmentsTable).set({ date: movedDate }).where(and(
        eq(appointmentsTable.id, current.id),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
      )).returning();
      return Boolean(moved);
    });
    const cancel = db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date, employeeId: employee!.id }]);
      const [cancelled] = await tx.update(appointmentsTable).set({ status: "cancelled" }).where(and(
        eq(appointmentsTable.id, seriesMember!.id),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
      )).returning();
      return Boolean(cancelled);
    });
    await Promise.all([move, cancel]);

    const [finalMember] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, seriesMember!.id));
    assert.equal(finalMember!.status, "cancelled", "a concurrent cancellation must not be overwritten by a series move");
    assert.ok([date, movedDate].includes(finalMember!.date), "a series member must end in one complete schedule state");
    console.log("Appointment concurrency regression passed.");

    // -------------------------------------------------------------------------
    // New test: capacity-1 resource concurrency
    // -------------------------------------------------------------------------
    const [resource1] = await db.insert(salonResourcesTable).values({
      salonId: salon!.id,
      name: `Kabina 1 ${suffix}`,
      type: "room",
      capacity: 1,
    }).returning();

    // Two transactions race to allocate the same capacity-1 resource.
    const bookWithResource = async (startTime: string, endTime: string) => db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date, resourceId: resource1!.id }]);
      // Count already-allocated units in the window.
      const [row] = await tx.select({
        usedQty: count(appointmentResourceAllocationsTable.id),
      }).from(appointmentResourceAllocationsTable)
        .innerJoin(appointmentsTable, eq(appointmentResourceAllocationsTable.appointmentId, appointmentsTable.id))
        .where(and(
          eq(appointmentResourceAllocationsTable.resourceId, resource1!.id),
          eq(appointmentsTable.date, date),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
        ));
      // capacity is 1, quantity required is 1
      if ((row?.usedQty ?? 0) >= 1) return false;
      await pause(40);
      const [appt] = await tx.insert(appointmentsTable).values({
        salonId: salon!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date,
        startTime,
        endTime,
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      }).returning();
      await tx.insert(appointmentResourceAllocationsTable).values({
        appointmentId: appt!.id,
        resourceId: resource1!.id,
        quantity: 1,
      });
      return true;
    });

    const resourceCreated = await Promise.all([
      bookWithResource("14:00", "15:00"),
      bookWithResource("14:00", "15:00"),
    ]);
    assert.equal(
      resourceCreated.filter(Boolean).length, 1,
      "capacity-1 resource: only one overlapping booking may succeed",
    );

    // -------------------------------------------------------------------------
    // New test: capacity-N resource allows N concurrent bookings
    // -------------------------------------------------------------------------
    const [resourceN] = await db.insert(salonResourcesTable).values({
      salonId: salon!.id,
      name: `Kabina N ${suffix}`,
      type: "room",
      capacity: 2,
    }).returning();

    const bookWithResourceN = async (startTime: string, endTime: string) => db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date, resourceId: resourceN!.id }]);
      const [row] = await tx.select({
        usedQty: count(appointmentResourceAllocationsTable.id),
      }).from(appointmentResourceAllocationsTable)
        .innerJoin(appointmentsTable, eq(appointmentResourceAllocationsTable.appointmentId, appointmentsTable.id))
        .where(and(
          eq(appointmentResourceAllocationsTable.resourceId, resourceN!.id),
          eq(appointmentsTable.date, date),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
        ));
      if ((row?.usedQty ?? 0) >= 2) return false;
      await pause(20);
      const [appt] = await tx.insert(appointmentsTable).values({
        salonId: salon!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date,
        startTime,
        endTime,
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      }).returning();
      await tx.insert(appointmentResourceAllocationsTable).values({
        appointmentId: appt!.id,
        resourceId: resourceN!.id,
        quantity: 1,
      });
      return true;
    });

    // Two bookings for same slot: both should succeed (capacity 2).
    const nCreated = await Promise.all([
      bookWithResourceN("16:00", "17:00"),
      bookWithResourceN("16:00", "17:00"),
    ]);
    assert.equal(
      nCreated.filter(Boolean).length, 2,
      "capacity-2 resource: two concurrent overlapping bookings must both succeed",
    );

    // A third booking for same slot must fail.
    const thirdCreated = await bookWithResourceN("16:00", "17:00");
    assert.equal(thirdCreated, false, "capacity-2 resource: a third overlapping booking must be rejected");

    // -------------------------------------------------------------------------
    // New test: independent resources do not block each other
    // -------------------------------------------------------------------------
    const [resourceA, resourceB] = await db.insert(salonResourcesTable).values([
      { salonId: salon!.id, name: `Kabina A ${suffix}`, type: "room", capacity: 1 },
      { salonId: salon!.id, name: `Kabina B ${suffix}`, type: "room", capacity: 1 },
    ]).returning();

    const bookResourceA = db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date: movedDate, resourceId: resourceA!.id }]);
      await pause(30);
      const [appt] = await tx.insert(appointmentsTable).values({
        salonId: salon!.id, employeeId: employee!.id, serviceId: service!.id,
        date: movedDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60, price: 1000, status: "confirmed",
      }).returning();
      await tx.insert(appointmentResourceAllocationsTable).values({ appointmentId: appt!.id, resourceId: resourceA!.id, quantity: 1 });
      return true;
    });
    const bookResourceB = db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date: movedDate, resourceId: resourceB!.id }]);
      await pause(30);
      const [appt] = await tx.insert(appointmentsTable).values({
        salonId: salon!.id, employeeId: employee!.id, serviceId: service!.id,
        date: movedDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60, price: 1000, status: "confirmed",
      }).returning();
      await tx.insert(appointmentResourceAllocationsTable).values({ appointmentId: appt!.id, resourceId: resourceB!.id, quantity: 1 });
      return true;
    });

    const [resultA, resultB] = await Promise.all([bookResourceA, bookResourceB]);
    assert.equal(resultA, true, "independent resource A booking must succeed");
    assert.equal(resultB, true, "independent resource B booking must succeed without blocking A");

    const [historyEmployee] = await db.insert(employeesTable).values({
      salonId: salon!.id, name: "History employee", role: "Stilist", bio: "", avatarUrl: "",
    }).returning();
    const [historyAppointment] = await db.insert(appointmentsTable).values({
      salonId: salon!.id, serviceId: service!.id, date: crossLocationDate,
      startTime: "14:00", endTime: "15:00", durationMinutes: 60, price: 1000, status: "confirmed",
    }).returning();
    const [historyTreatment] = await db.insert(appointmentTreatmentsTable).values({
      appointmentId: historyAppointment!.id, serviceId: service!.id, position: 0,
      durationMinutes: 60, price: 1000, plannedStartTime: "14:00", plannedEndTime: "15:00",
    }).returning();
    await db.insert(appointmentTreatmentEmployeesTable).values({
      appointmentTreatmentId: historyTreatment!.id, employeeId: historyEmployee!.id, position: 0,
    });
    await assert.rejects(
      db.delete(employeesTable).where(eq(employeesTable.id, historyEmployee!.id)),
      "history-safe junction FK must reject direct employee deletion while its treatment survives",
    );
    await db.transaction(async (tx) => {
      await tx.delete(salonsTable).where(inArray(salonsTable.id, [salon!.id, siblingSalon!.id]));
    });
    assert.equal((await db.select({ value: count() }).from(salonsTable)
      .where(inArray(salonsTable.id, [salon!.id, siblingSalon!.id])))[0]!.value, 0,
    "deferred employee FK must permit atomic multi-location tenant graph teardown");

    console.log("Resource capacity concurrency tests passed.");
  } finally {
    await db.transaction(async (tx) => {
      await tx.delete(salonsTable).where(inArray(salonsTable.id, [salon!.id, siblingSalon!.id]));
    });
  }
}

try {
  await assertNoPgBusyClientWarnings(run);
} finally {
  await pool.end();
}
