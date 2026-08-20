import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeeServicesTable,
  employeesTable,
  pool,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { lockAppointmentResources } from "./appointment-locks";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const date = "2099-10-18";
const movedDate = "2099-10-19";
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
  await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: service!.id });

  try {
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
  } finally {
    await db.delete(salonsTable).where(eq(salonsTable.id, salon!.id));
  }
}

try {
  await run();
} finally {
  await pool.end();
}