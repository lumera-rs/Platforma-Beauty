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
  salonDateHoursTable,
  salonResourcesTable,
  salonsTable,
  serviceResourceRequirementsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBookingCommandSchema } from "./booking-command-schema";

assertDestructiveTestRuntimeAllowed(process.env, "Booking P1 regression tests");

async function post(baseUrl: string, path: string, session: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
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

async function getRequest(baseUrl: string, session: string, path: string) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: { cookie: `${sessionCookieName}=${session}` },
  });
  return { status: response.status, body: await response.json() as unknown };
}

function belgradeDateOffset(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const date = new Date(`${parts.find((item) => item.type === "year")!.value}-${parts.find((item) => item.type === "month")!.value}-${parts.find((item) => item.type === "day")!.value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function run(): Promise<void> {
  await ensureBookingCommandSchema();
  const suffix = randomUUID();
  const passwordHash = await hashPassword("test-password");
  const [owner, employeeUser, customerUser] = await db.insert(usersTable).values([
    {
      firstName: "Owner", lastName: "P1", email: `owner-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER",
    },
    {
      firstName: "Employee", lastName: "P1", email: `employee-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE",
    },
    {
      firstName: "Customer", lastName: "P1", email: `customer-${suffix}@example.test`,
      passwordHash, passwordSetAt: new Date(), role: "CUSTOMER",
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
    slotGranularityMinutes: 15,
    maxVisitGapMinutes: 0,
  });
  await db.insert(salonDateHoursTable).values({
    salonId: salon!.id,
    date: "2099-12-03",
    closed: true,
    openTime: null,
    closeTime: null,
    reason: "Calendar availability regression",
  });
  const [contact] = await db.insert(salonCustomersTable).values({
    salonId: salon!.id,
    firstName: "Anonymous",
    lastName: "Widget",
    phone: "+381611111111",
    phoneNormalized: "+381611111111",
  }).returning();
  const [customerContact] = await db.insert(salonCustomersTable).values({
    salonId: salon!.id,
    userId: customerUser!.id,
    firstName: customerUser!.firstName,
    lastName: customerUser!.lastName,
    email: customerUser!.email,
    phone: "+381622222222",
    phoneNormalized: "+381622222222",
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

  const [ownerSession, employeeSession, customerSession] = await Promise.all([
    createSession(owner!.id),
    createSession(employeeUser!.id),
    createSession(customerUser!.id),
  ]);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const originalQuery = pool.query.bind(pool);
  let requestQueryCount = 0;
  pool.query = ((...args: Parameters<typeof pool.query>) => {
    requestQueryCount += 1;
    return originalQuery(...args);
  }) as typeof pool.query;

  try {
    const ownerManualGroup = await post(baseUrl, "/salon/booking-groups", ownerSession, {
      salonCustomerId: customerContact!.id,
      treatments: [{
        serviceId: service!.id,
        employeeId: otherEmployee!.id,
        date: "2099-12-16",
        startTime: "10:00",
      }],
      notes: "Owner manual grouped booking",
    });
    assert.equal(ownerManualGroup.status, 201, "an authenticated owner can create a manual booking group");
    const ownerManualAppointments = ownerManualGroup.body.appointments as Array<{ id: string; bookingGroupId: string }>;
    assert.equal(ownerManualAppointments.length, 1);
    assert.equal(ownerManualAppointments[0]!.bookingGroupId, ownerManualGroup.body.id,
      "owner manual creation must link appointments through the real booking group id");
    const [storedOwnerGroup] = await db.select().from(bookingGroupsTable)
      .where(eq(bookingGroupsTable.id, String(ownerManualGroup.body.id)));
    assert.ok(storedOwnerGroup, "owner manual creation must persist a booking_groups row");
    const legacyCustomerMove = await patch(baseUrl, `/appointments/${ownerManualAppointments[0]!.id}`, customerSession, {
      date: "2099-12-16",
      startTime: "11:00",
    });
    assert.equal(legacyCustomerMove.status, 409,
      "single-appointment reschedule must not bypass the booking-group invariant");
    assert.equal(legacyCustomerMove.body.code, "BOOKING_GROUP_MUTATION_REQUIRED");
    const legacyLifecycleCancel = await post(baseUrl,
      `/appointments/${ownerManualAppointments[0]!.id}/lifecycle`, ownerSession, { action: "cancel" });
    assert.equal(legacyLifecycleCancel.status, 409,
      "single-appointment lifecycle cancellation must not bypass the booking-group invariant");
    assert.equal(legacyLifecycleCancel.body.code, "BOOKING_GROUP_MUTATION_REQUIRED");

    const employeeManualGroup = await post(baseUrl, "/employee/booking-groups", employeeSession, {
      salonCustomerId: contact!.id,
      treatments: [{
        serviceId: service!.id,
        employeeId: employee!.id,
        date: "2099-12-17",
        startTime: "10:00",
      }],
      notes: "Employee manual grouped booking",
    });
    assert.equal(employeeManualGroup.status, 201, "an authenticated employee can create a manual booking group");
    const employeeManualAppointments = employeeManualGroup.body.appointments as Array<{ id: string; bookingGroupId: string; employeeId: string }>;
    assert.equal(employeeManualAppointments[0]!.bookingGroupId, employeeManualGroup.body.id,
      "employee manual creation must link appointments through the real booking group id");
    assert.equal(employeeManualAppointments[0]!.employeeId, employee!.id,
      "employee manual creation must remain assigned to the authenticated employee");
    const employeeGroupCancellation = await post(
      baseUrl,
      `/booking-groups/${employeeManualGroup.body.id}/cancel`,
      employeeSession,
      { appointmentIds: [employeeManualAppointments[0]!.id], reason: "Employee group UI regression" },
    );
    assert.equal(employeeGroupCancellation.status, 200,
      "an employee can cancel their assigned treatment through the canonical booking-group endpoint");

    const racingManualBody = {
      salonCustomerId: contact!.id,
      treatments: [{
        serviceId: service!.id,
        employeeId: otherEmployee!.id,
        date: "2099-12-18",
        startTime: "10:00",
      }],
    };
    const racingManualGroups = await Promise.all([
      post(baseUrl, "/salon/booking-groups", ownerSession, racingManualBody),
      post(baseUrl, "/salon/booking-groups", ownerSession, racingManualBody),
    ]);
    assert.deepEqual(
      racingManualGroups.map((result) => result.status).sort(),
      [201, 409],
      "resource and employee locks must allow exactly one winner for racing grouped creation",
    );

    const [cancelLayoutGroup] = await db.insert(bookingGroupsTable).values({
      salonId: salon!.id,
      salonCustomerId: contact!.id,
      createdByUserId: owner!.id,
    }).returning();
    const cancelLayoutAppointments = await db.insert(appointmentsTable).values(
      ["13:00", "13:30", "14:00"].map((startTime, position) => ({
        salonId: salon!.id,
        salonCustomerId: contact!.id,
        employeeId: position === 1 ? otherEmployee!.id : employee!.id,
        serviceId: service!.id,
        bookingGroupId: cancelLayoutGroup!.id,
        date: "2099-12-19",
        startTime,
        endTime: ["13:30", "14:00", "14:30"][position]!,
        durationMinutes: 30,
        price: 1000,
        status: "confirmed" as const,
      })),
    ).returning();
    await db.insert(appointmentTreatmentsTable).values(cancelLayoutAppointments.map((item, position) => ({
      appointmentId: item.id,
      serviceId: service!.id,
      employeeId: item.employeeId,
      position,
      durationMinutes: 30,
      bufferMinutes: 30,
      price: 1000,
      plannedStartTime: item.startTime,
      plannedEndTime: item.endTime,
    })));
    const incoherentCancel = await post(baseUrl, `/booking-groups/${cancelLayoutGroup!.id}/cancel`, ownerSession, {
      appointmentIds: [cancelLayoutAppointments[1]!.id],
      reason: "Would split the active visit",
    });
    assert.equal(incoherentCancel.status, 409, "subset cancellation must reject an incoherent active remainder");
    assert.equal(incoherentCancel.body.code, "BOOKING_GROUP_LAYOUT_CONFLICT");
    const [middleAfterRejectedCancel] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, cancelLayoutAppointments[1]!.id));
    assert.equal(middleAfterRejectedCancel!.status, "confirmed",
      "layout rejection must roll back cancellation and its side effects");

    const legacyList = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      treatments: [{ serviceId: service!.id, employeeId: employee!.id }],
      fromDate: "2099-12-02",
      toDate: "2099-12-02",
      allowMultipleDays: false,
    });
    assert.equal(legacyList.status, 200);
    assert.equal((legacyList.body.candidates as unknown[]).length, 20, "list availability must use the same safe per-day cap as calendar mode");
    assert.match(
      String((legacyList.body.candidates as Array<{ date: string }>)[0]?.date),
      /^\d{4}-\d{2}-\d{2}$/,
      "list candidates must preserve the date-only booking contract",
    );

    const calendarAvailability = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      resultMode: "calendar",
      treatments: [{ serviceId: service!.id, employeeId: employee!.id }],
      fromDate: "2099-12-02",
      toDate: "2099-12-03",
      allowMultipleDays: false,
    });
    assert.equal(calendarAvailability.status, 200);
    const calendarDays = calendarAvailability.body.calendarDays as Array<{ date: string; candidates: unknown[]; truncated: boolean }>;
    assert.equal(calendarDays.length, 2, "calendar mode must return every requested date");
    assert.equal(calendarDays[0]!.date, "2099-12-02", "calendar days must preserve the date-only booking contract");
    assert.equal(calendarDays[0]!.candidates.length, 20, "an open day must respect the explicit safe per-day candidate cap");
    assert.equal(calendarDays[1]!.candidates.length, 0, "a closed day must not expose an incomplete candidate");
    assert.equal(calendarDays[0]!.truncated, true, "a capped calendar day must report truncation");

    requestQueryCount = 0;
    const boundedCalendar = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      resultMode: "calendar",
      treatments: [
        { serviceId: service!.id, employeeId: employee!.id },
        { serviceId: service!.id, employeeId: otherEmployee!.id },
      ],
      fromDate: "2099-12-02",
      toDate: "2099-12-15",
      allowMultipleDays: false,
    });
    assert.equal(boundedCalendar.status, 200);
    assert.ok(
      requestQueryCount <= 16,
      `14-day calendar availability used ${requestQueryCount} queries; invariant availability facts must be loaded once per request`,
    );

    const groupedAvailability = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      resultMode: "calendar",
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
      ((groupedAvailability.body.calendarDays as Array<{ candidates: unknown[] }>)[0]?.candidates.length),
      0,
      "calendar candidates must reject adjacent capacity-one treatments when the first treatment's resource buffer overlaps",
    );

    const oversizedCalendarRange = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      resultMode: "calendar",
      treatments: [{ serviceId: service!.id }],
      fromDate: "2099-12-01",
      toDate: "2099-12-15",
      allowMultipleDays: false,
    });
    assert.equal(oversizedCalendarRange.status, 400, "calendar mode must reject ranges over 14 days");

    const offGridPreview = await post(baseUrl, "/employee/appointment-series/preview", employeeSession, {
      serviceId: service!.id,
      employeeId: employee!.id,
      slots: [{ date: "2099-12-02", startTime: "10:07" }],
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
    assert.equal(anonymousReschedule.status, 409, "a subset reschedule must reject an incoherent active remainder");
    assert.equal(
      anonymousReschedule.body.code,
      "BOOKING_GROUP_LAYOUT_CONFLICT",
      "layout rejections must expose the stable conflict discriminator",
    );
    const [notPartiallyMoved] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointment!.id));
    assert.equal(notPartiallyMoved!.date, "2099-12-01", "layout rejection must roll back the complete subset reschedule");

    // A-6 integration coverage: the persisted policy must constrain both
    // advertised candidates and forged customer commands, while legacy NULL
    // remains unlimited and stored appointments remain manageable.
    const horizonBoundary = belgradeDateOffset(1);
    const horizonBeyond = belgradeDateOffset(2);
    await db.update(salonBookingSettingsTable).set({ maxBookingHorizonDays: 1 })
      .where(eq(salonBookingSettingsTable.salonId, salon!.id));
    const boundedAvailability = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      resultMode: "calendar",
      treatments: [{ serviceId: service!.id, employeeId: employee!.id }],
      fromDate: horizonBoundary, toDate: horizonBeyond, allowMultipleDays: false,
    });
    assert.equal(boundedAvailability.status, 200);
    const boundedDays = boundedAvailability.body.calendarDays as Array<{
      date: string;
      candidates: Array<{ startTime: string; treatments: Array<{ employeeId: string }> }>;
    }>;
    const boundaryCandidate = boundedDays.find((day) => day.date === horizonBoundary)!.candidates[0];
    assert.ok(boundaryCandidate,
      "configured horizon must advertise the exact last valid date");
    assert.equal(boundedDays.find((day) => day.date === horizonBeyond)!.candidates.length, 0,
      "configured horizon must suppress availability beyond the boundary");

    const boundaryBooking = await post(baseUrl, "/appointments", customerSession, {
      salonId: salon!.id, serviceId: service!.id,
      employeeId: boundaryCandidate.treatments[0]!.employeeId,
      date: horizonBoundary, startTime: boundaryCandidate.startTime,
    });
    assert.equal(boundaryBooking.status, 201, "a forged customer booking at the boundary must succeed");
    const beyondBooking = await post(baseUrl, "/appointments", customerSession, {
      salonId: salon!.id, serviceId: service!.id, employeeId: otherEmployee!.id,
      date: horizonBeyond, startTime: "09:00",
    });
    assert.equal(beyondBooking.status, 409, "a forged customer booking beyond the horizon must be rejected");
    const employeeBeyond = await post(baseUrl, "/employee/booking-groups", employeeSession, {
      salonCustomerId: customerContact!.id,
      treatments: [{ serviceId: service!.id, employeeId: employee!.id, date: horizonBeyond, startTime: "09:00" }],
    });
    assert.notEqual(employeeBeyond.status, 201, "employee manual creation must share the horizon policy");
    const preservedRead = await getRequest(baseUrl, ownerSession,
      `/salon/appointments?from=2099-12-01&to=2099-12-01`);
    assert.equal(preservedRead.status, 200, "stored appointments beyond a reduced horizon remain readable");
    assert.ok((preservedRead.body as Array<{ id: string }>).some((item) => item.id === appointment!.id),
      "the existing appointment remains in the owner calendar");
    const preservedDate = (await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, appointment!.id)))[0]!;
    assert.equal(preservedDate.date, "2099-12-01",
      "reducing the horizon must not modify an existing appointment date");

    await db.update(salonBookingSettingsTable).set({ maxBookingHorizonDays: null })
      .where(eq(salonBookingSettingsTable.salonId, salon!.id));
    const unlimitedAvailability = await post(baseUrl, `/salons/${salon!.id}/grouped-availability`, ownerSession, {
      resultMode: "calendar",
      treatments: [{ serviceId: service!.id, employeeId: employee!.id }],
      fromDate: horizonBeyond, toDate: horizonBeyond, allowMultipleDays: false,
    });
    assert.ok((unlimitedAvailability.body.calendarDays as Array<{ candidates: unknown[] }>)[0]!.candidates.length > 0,
      "NULL horizon must preserve unlimited legacy availability");

    const anonymousCancel = await post(baseUrl, `/booking-groups/${group!.id}/cancel`, ownerSession, {
      appointmentIds: [appointment!.id],
      reason: "Regression test",
    });
    assert.equal(anonymousCancel.status, 200, "owner cancellation of an anonymous widget group must commit");
    const [cancelled] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointment!.id));
    assert.equal(cancelled!.status, "cancelled");
  } finally {
    pool.query = originalQuery;
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