import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import {
  appointmentTreatmentsTable,
  appointmentsTable,
  bookingGroupsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  pool,
  salonBookingSettingsTable,
  salonCustomersTable,
  salonResourcesTable,
  salonsTable,
  serviceResourceRequirementsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

async function post(baseUrl: string, path: string, session: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${sessionCookieName}=${session}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function patch(baseUrl: string, path: string, session: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: `${sessionCookieName}=${session}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function run(): Promise<void> {
  const suffix = randomUUID();
  const passwordHash = await hashPassword("test-password");
  const [owner, employeeUser] = await db.insert(usersTable).values([
    {
      firstName: "Owner", lastName: "P1", email: `owner-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER",
    },
    {
      firstName: "Employee", lastName: "P1", email: `employee-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE",
    },
  ]).returning();
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner!.id,
    name: `P1 salon ${suffix}`,
    slug: `p1-salon-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone: "+381110000001",
    email: `salon-${suffix}@example.test`,
    shortDescription: "P1 regression salon.",
    description: "P1 regression salon.",
    imageUrl: "/test.jpg",
  }).returning();
  await db.update(usersTable).set({ activeSalonId: salon!.id }).where(eq(usersTable.id, owner!.id));
  const [service] = await db.insert(servicesTable).values({
    salonId: salon!.id,
    categoryName: "Test",
    name: "P1 treatment",
    description: "P1 treatment.",
    durationMinutes: 30,
    bufferMinutes: 30,
    price: 1000,
    imageUrl: "/test.jpg",
  }).returning();
  const [employee, otherEmployee] = await db.insert(employeesTable).values([
    { salonId: salon!.id, userId: employeeUser!.id, name: "Own employee", role: "Stylist", bio: "", avatarUrl: "" },
    { salonId: salon!.id, name: "Other employee", role: "Stylist", bio: "", avatarUrl: "" },
  ]).returning();
  await db.insert(employeeLocationAssignmentsTable).values([
    { salonId: salon!.id, employeeId: employee!.id, active: true, isDefault: true },
    { salonId: salon!.id, employeeId: otherEmployee!.id, active: true },
  ]);
  await db.insert(employeeServicesTable).values([
    { employeeId: employee!.id, serviceId: service!.id },
    { employeeId: otherEmployee!.id, serviceId: service!.id },
  ]);
  const [resource] = await db.insert(salonResourcesTable).values({
    salonId: salon!.id,
    name: "P1 capacity one room",
    type: "room",
    capacity: 1,
  }).returning();
  await db.insert(serviceResourceRequirementsTable).values({
    serviceId: service!.id,
    resourceId: resource!.id,
    quantity: 1,
  });
  await db.insert(salonBookingSettingsTable).values({
    salonId: salon!.id,
    slotGranularityMinutes: 30,
    maxVisitGapMinutes: 0,
  });
  const [contact] = await db.insert(salonCustomersTable).values({
    salonId: salon!.id,
    firstName: "Anonymous",
    lastName: "Widget",
    phone: "+381611111111",
    phoneNormalized: "+381611111111",
  }).returning();
  const [group] = await db.insert(bookingGroupsTable).values({
    salonId: salon!.id,
    customerId: null,
    salonCustomerId: contact!.id,
  }).returning();
  const [appointment] = await db.insert(appointmentsTable).values({
    salonId: salon!.id,
    customerId: null,
    salonCustomerId: contact!.id,
    employeeId: employee!.id,
    serviceId: service!.id,
    bookingGroupId: group!.id,
    date: "2099-12-01",
    startTime: "10:00",
    endTime: "10:30",
    durationMinutes: 30,
    price: 1000,
    status: "confirmed",
  }).returning();
  await db.insert(appointmentTreatmentsTable).values({
    appointmentId: appointment!.id,
    serviceId: service!.id,
    employeeId: employee!.id,
    position: 0,
    durationMinutes: 30,
    bufferMinutes: 30,
    price: 1000,
    plannedStartTime: "10:00",
    plannedEndTime: "10:30",
  });

  const [ownerSession, employeeSession] = await Promise.all([
    createSession(owner!.id),
    createSession(employeeUser!.id),
  ]);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const groupedAvailability = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      treatments: [
        { serviceId: service!.id, employeeId: employee!.id },
        { serviceId: service!.id, employeeId: otherEmployee!.id },
      ],
      fromDate: "2099-12-02",
      toDate: "2099-12-02",
      allowMultipleDays: false,
    });
    assert.equal(groupedAvailability.status, 200);
    assert.equal(
      (groupedAvailability.body.candidates as unknown[]).length,
      0,
      "grouped availability must reject adjacent capacity-one treatments when the first treatment's resource buffer overlaps",
    );

    const offGridPreview = await post(baseUrl, "/employee/appointment-series/preview", employeeSession, {
      serviceId: service!.id,
      employeeId: employee!.id,
      slots: [{ date: "2099-12-02", startTime: "10:15" }],
    });
    assert.equal(offGridPreview.status, 200);
    assert.equal(
      ((offGridPreview.body.slots as Array<{ available: boolean }>)[0]?.available),
      false,
      "series preview must enforce persisted slot granularity through canonical availability",
    );

    const crossEmployee = await patch(baseUrl, `/booking-groups/${group!.id}/reschedule`, employeeSession, {
      treatments: [{
        appointmentId: appointment!.id,
        date: "2099-12-02",
        startTime: "10:00",
        employeeId: otherEmployee!.id,
      }],
    });
    assert.equal(crossEmployee.status, 403, "an employee must not reassign a grouped treatment to another employee");

    const [secondAppointment] = await db.insert(appointmentsTable).values({
      salonId: salon!.id,
      customerId: null,
      salonCustomerId: contact!.id,
      employeeId: otherEmployee!.id,
      serviceId: service!.id,
      bookingGroupId: group!.id,
      date: "2099-12-01",
      startTime: "11:00",
      endTime: "11:30",
      durationMinutes: 30,
      price: 1000,
      status: "confirmed",
    }).returning();
    await db.insert(appointmentTreatmentsTable).values({
      appointmentId: secondAppointment!.id, serviceId: service!.id, employeeId: otherEmployee!.id,
      position: 1, durationMinutes: 30, bufferMinutes: 30, price: 1000,
      plannedStartTime: "11:00", plannedEndTime: "11:30",
    });
    const bufferedResourceConflict = await patch(baseUrl, `/booking-groups/${group!.id}/reschedule`, ownerSession, {
      treatments: [
        { appointmentId: appointment!.id, date: "2099-12-02", startTime: "09:00", employeeId: employee!.id },
        { appointmentId: secondAppointment!.id, date: "2099-12-02", startTime: "09:30", employeeId: otherEmployee!.id },
      ],
    });
    assert.equal(bufferedResourceConflict.status, 409, "reschedule must reject a later treatment that overlaps the first treatment's buffered capacity-one resource reservation");
    const [unchanged] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointment!.id));
    assert.equal(unchanged!.date, "2099-12-01", "a rejected group reschedule must roll back every member");

    const anonymousReschedule = await patch(baseUrl, `/booking-groups/${group!.id}/reschedule`, ownerSession, {
      treatments: [{
        appointmentId: appointment!.id,
        date: "2099-12-02",
        startTime: "10:00",
        employeeId: employee!.id,
      }],
    });
    assert.equal(anonymousReschedule.status, 200, "owner reschedule of an anonymous widget group must commit");

    const anonymousCancel = await post(baseUrl, `/booking-groups/${group!.id}/cancel`, ownerSession, {
      appointmentIds: [appointment!.id],
      reason: "Regression test",
    });
    assert.equal(anonymousCancel.status, 200, "owner cancellation of an anonymous widget group must commit");
    const [cancelled] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointment!.id));
    assert.equal(cancelled!.status, "cancelled");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(salonsTable).where(eq(salonsTable.id, salon!.id));
    await db.delete(usersTable).where(eq(usersTable.id, owner!.id));
    await db.delete(usersTable).where(eq(usersTable.id, employeeUser!.id));
  }
}

try {
  await run();
  console.log("Booking P1 regressions passed.");
} finally {
  await pool.end();
}