import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentSeriesTable,
  appointmentsTable,
  db,
  employeeServicesTable,
  employeesTable,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { assertNoPgBusyClientWarnings } from "./pg-busy-client.test-support";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const primarySalonDate = "2099-10-18";
const movedSeriesDate = "2099-10-19";
const completedOrCancelledDate = "2099-10-20";
const employeeBookingDate = "2099-10-21";
const customerBookingDate = "2099-10-23";
const updatedCustomerBookingDate = "2099-10-24";
const salonBookingDate = "2099-10-25";

type HttpResult = {
  status: number;
  body: unknown;
};

function fixtureEmail(role: string) {
  return `${role}-${suffix}@example.test`;
}

function assertCalendarDate(value: string, expected: string, message: string): void {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${message} must be a YYYY-MM-DD calendar date`);
  assert.equal(value, expected, message);
}

async function request(
  baseUrl: string,
  session: string,
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, unknown>,
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${sessionCookieName}=${session}`,
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getRequest(baseUrl: string, session: string, path: string): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: { cookie: `${sessionCookieName}=${session}` },
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function run(): Promise<void> {
  await ensureDemoData();
  const passwordHash = await hashPassword("test-password");
  const createdUserIds: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;

  try {
    const [owner, customer, employeeUser] = await db.insert(usersTable).values([
      {
        firstName: "Vlasnik",
        lastName: "HTTP test",
        email: fixtureEmail("owner"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Kupac",
        lastName: "HTTP test",
        email: fixtureEmail("customer"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
      {
        firstName: "Zaposleni",
        lastName: "HTTP test",
        email: fixtureEmail("employee"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
    ]).returning();
    createdUserIds.push(owner!.id, customer!.id, employeeUser!.id);

    const [salon, foreignSalon] = await db.insert(salonsTable).values([
      {
        ownerId: owner!.id,
        name: `HTTP termin salon ${suffix}`,
        slug: `http-appointment-salon-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 29",
        phone: "+381110000029",
        email: fixtureEmail("salon"),
        shortDescription: "Izolovan salon za HTTP regresione testove termina.",
        description: "Izolovan salon za proveru zaključavanja, statusa i autorizacije termina.",
        imageUrl: "/test.jpg",
      },
      {
        ownerId: owner!.id,
        name: `Drugi HTTP salon ${suffix}`,
        slug: `foreign-http-appointment-salon-${suffix}`,
        city: "Novi Sad",
        municipality: "Centar",
        address: "Test 30",
        phone: "+381110000030",
        email: fixtureEmail("foreign-salon"),
        shortDescription: "Drugi izolovan salon za autorizacioni test.",
        description: "Salon koji sadrži zaposlenog nedostupnog vlasniku aktivnog salona.",
        imageUrl: "/test.jpg",
      },
    ]).returning();
    await db.update(usersTable).set({ activeSalonId: salon!.id }).where(eq(usersTable.id, owner!.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon!.id,
      categoryName: "Test",
      name: "HTTP zaključavanje termina",
      description: "Usluga za proveru HTTP tokova termina.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test.jpg",
    }).returning();
    const [employee, foreignEmployee] = await db.insert(employeesTable).values([
      {
        salonId: salon!.id,
        userId: employeeUser!.id,
        name: "Zaposleni za HTTP test",
        role: "Stilist",
        bio: "",
        avatarUrl: "",
      },
      {
        salonId: foreignSalon!.id,
        name: "Zaposleni drugog salona",
        role: "Stilist",
        bio: "",
        avatarUrl: "",
      },
    ]).returning();
    await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: service!.id });

    const [contact] = await db.insert(salonCustomersTable).values({
      salonId: salon!.id,
      userId: customer!.id,
      firstName: customer!.firstName,
      lastName: customer!.lastName,
      phone: "+381611234529",
      phoneNormalized: "+381611234529",
    }).returning();

    // The employee booking route only permits existing clients they have served.
    await db.insert(appointmentsTable).values({
      salonId: salon!.id,
      customerId: customer!.id,
      salonCustomerId: contact!.id,
      employeeId: employee!.id,
      serviceId: service!.id,
      date: "2099-10-17",
      startTime: "09:00",
      endTime: "10:00",
      durationMinutes: 60,
      price: 1000,
      status: "completed",
    });

    const [series] = await db.insert(appointmentSeriesTable).values({
      salonId: salon!.id,
      salonCustomerId: contact!.id,
      serviceId: service!.id,
      employeeId: employee!.id,
      totalAppointments: 1,
      createdByUserId: owner!.id,
    }).returning();
    const [seriesAppointment, completionRaceAppointment, cancelledAppointment] = await db.insert(appointmentsTable).values([
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        seriesId: series!.id,
        date: primarySalonDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      },
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date: completedOrCancelledDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      },
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date: "2099-10-22",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "cancelled",
      },
    ]).returning();

    const [ownerSession, customerSession, employeeSession] = await Promise.all([
      createSession(owner!.id),
      createSession(customer!.id),
      createSession(employeeUser!.id),
    ]);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const availability = await fetch(
      `${baseUrl}/api/salons/${salon!.id}/availability?serviceId=${service!.id}&date=${employeeBookingDate}&employeeId=${employee!.id}`,
    );
    assert.equal(availability.status, 200, "parallel availability reads must use pool clients safely");

    const customerBooking = await request(baseUrl, customerSession, "/appointments", "POST", {
      salonId: salon!.id,
      serviceId: service!.id,
      date: customerBookingDate,
      startTime: "12:00",
      employeeId: employee!.id,
    });
    assert.equal(customerBooking.status, 201, "a customer must be able to create an available appointment");
    const createdCustomerAppointment = customerBooking.body as { id: string; date: string; startTime: string };
    const [persistedCustomerAppointment] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, createdCustomerAppointment.id));
    assert.equal(persistedCustomerAppointment!.customerId, customer!.id, "customer booking must persist its customer ownership");

    const customerAppointments = await getRequest(baseUrl, customerSession, "/appointments");
    assert.equal(customerAppointments.status, 200, "a customer must be able to list their appointments");
    assert.ok(
      (customerAppointments.body as Array<{ id: string; date: string; startTime: string }>).some((appointment) =>
        appointment.id === createdCustomerAppointment.id
        && appointment.date === customerBookingDate
        && appointment.startTime === "12:00",
      ),
      "the customer appointment list must immediately include the newly created appointment",
    );

    const customerUpdate = await request(baseUrl, customerSession, `/appointments/${createdCustomerAppointment.id}`, "PATCH", {
      date: updatedCustomerBookingDate,
    });
    assert.equal(customerUpdate.status, 200, "a customer must be able to reschedule their appointment");
    assertCalendarDate(
      (customerUpdate.body as { date: string }).date,
      updatedCustomerBookingDate,
      "the customer appointment update response date",
    );

    const customerCancellation = await request(baseUrl, customerSession, `/appointments/${createdCustomerAppointment.id}/cancel`, "POST", {
      reason: "HTTP provera formata datuma",
    });
    assert.equal(customerCancellation.status, 200, "a customer must be able to cancel their rescheduled appointment");
    assertCalendarDate(
      (customerCancellation.body as { date: string }).date,
      updatedCustomerBookingDate,
      "the customer appointment cancellation response date",
    );

    const salonBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      employeeId: employee!.id,
      date: salonBookingDate,
      startTime: "12:00",
    });
    assert.equal(salonBooking.status, 201, "a salon owner must be able to create an appointment");
    const createdSalonAppointment = salonBooking.body as { id: string; date: string };
    assertCalendarDate(
      createdSalonAppointment.date,
      salonBookingDate,
      "the salon appointment creation response date",
    );

    const salonUpdate = await request(baseUrl, ownerSession, `/salon/appointments/${createdSalonAppointment.id}`, "PATCH", {
      status: "confirmed",
      notes: "HTTP provera formata datuma",
    });
    assert.equal(salonUpdate.status, 200, "a salon owner must be able to update an appointment");
    assertCalendarDate(
      (salonUpdate.body as { date: string }).date,
      salonBookingDate,
      "the salon appointment update response date",
    );

    const bookingPayload = {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      slots: [{ date: employeeBookingDate, startTime: "10:00" }],
    };
    const [firstBooking, secondBooking] = await Promise.all([
      request(baseUrl, employeeSession, "/employee/appointments", "POST", bookingPayload),
      request(baseUrl, employeeSession, "/employee/appointments", "POST", bookingPayload),
    ]);
    assert.deepEqual(
      [firstBooking.status, secondBooking.status].sort((left, right) => left - right),
      [201, 409],
      "parallel employee booking requests must leave one overlapping slot unavailable",
    );
    const overlappingBookings = await db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salon!.id),
      eq(appointmentsTable.employeeId, employee!.id),
      eq(appointmentsTable.date, employeeBookingDate),
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    ));
    assert.equal(overlappingBookings.length, 1, "one employee must have only one active appointment in the same slot");

    const [moveSeries, cancelSeriesAppointment] = await Promise.all([
      request(baseUrl, ownerSession, `/salon/appointment-series/${series!.id}/move`, "POST", { dayOffset: 1 }),
      request(baseUrl, customerSession, `/appointments/${seriesAppointment!.id}/cancel`, "POST", { reason: "HTTP konkurentno otkazivanje" }),
    ]);
    assert.ok([200, 409].includes(moveSeries.status), "series move must either complete before cancellation or report a concurrent change");
    assert.equal(cancelSeriesAppointment.status, 200, "customer cancellation must remain successful while a series move is in flight");
    const [cancelledSeriesAppointment] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, seriesAppointment!.id));
    assert.equal(cancelledSeriesAppointment!.status, "cancelled", "a series move must never overwrite a concurrent cancellation");
    assert.ok(
      [primarySalonDate, movedSeriesDate].includes(cancelledSeriesAppointment!.date),
      "the moved series member must finish in one complete date state",
    );

    const [completeAppointment, cancelCompletedAppointment] = await Promise.all([
      request(baseUrl, employeeSession, `/employee/appointments/${completionRaceAppointment!.id}`, "PATCH", { status: "completed" }),
      request(baseUrl, customerSession, `/appointments/${completionRaceAppointment!.id}/cancel`, "POST", { reason: "HTTP konkurentno otkazivanje" }),
    ]);
    assert.deepEqual(
      [completeAppointment.status, cancelCompletedAppointment.status].sort((left, right) => left - right),
      [200, 409],
      "completion and cancellation must allow exactly one status transition",
    );
    const [completedOrCancelled] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, completionRaceAppointment!.id));
    assert.ok(
      completedOrCancelled!.status === "completed" || completedOrCancelled!.status === "cancelled",
      "the final status must be the single winning terminal transition",
    );

    const crossSalonAssignment = await request(
      baseUrl,
      ownerSession,
      `/salon/appointments/${cancelledAppointment!.id}`,
      "PATCH",
      { employeeId: foreignEmployee!.id },
    );
    assert.equal(crossSalonAssignment.status, 403, "an owner must not assign a cancelled appointment to an employee from another salon");
    const [stillCancelled] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, cancelledAppointment!.id));
    assert.equal(stillCancelled!.status, "cancelled", "a rejected cross-salon assignment must not change appointment status");
    assert.equal(stillCancelled!.employeeId, employee!.id, "a rejected cross-salon assignment must preserve the original employee");

    console.log("Appointment HTTP route regression passed.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await db.delete(salonsTable).where(inArray(salonsTable.slug, [
      `http-appointment-salon-${suffix}`,
      `foreign-http-appointment-salon-${suffix}`,
    ]));
    if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

try {
  await assertNoPgBusyClientWarnings(run);
} finally {
  await pool.end();
}
