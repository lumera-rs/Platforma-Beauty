import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, count, eq } from "drizzle-orm";
import {
  appointmentStatusHistoryTable,
  appointmentsTable,
  bookingCommandReceiptsTable,
  bookingGroupsTable,
  customerNotificationsTable,
  db,
  emailDeliveriesTable,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  pool,
  salonCustomersTable,
  salonDateHoursTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { lockAppointmentResources } from "./appointment-locks";
import { ensureBookingCommandSchema } from "./booking-command-schema";
import { bookingPayloadFingerprint } from "./booking-command";

type HttpResult = { status: number; body: unknown; replayed: boolean };

async function request(
  baseUrl: string,
  session: string,
  path: string,
  method: "GET" | "PATCH" | "POST" | "PUT",
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<HttpResult> {
  const commandKey = idempotencyKey ?? (method === "POST" ? randomUUID() : undefined);
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(commandKey ? { "idempotency-key": commandKey } : {}),
      cookie: `${sessionCookieName}=${session}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let responseBody: unknown = null;
  if (text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }
  return {
    status: response.status,
    body: responseBody,
    replayed: response.headers.get("idempotency-replayed") === "true",
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function run(): Promise<void> {
  await ensureBookingCommandSchema();
  const suffix = randomUUID();
  const passwordHash = await hashPassword("final-booking-hardening");
  const [ownerA, ownerB, customerA, customerB] = await db.insert(usersTable).values([
    { firstName: "Owner", lastName: "A", email: `final-owner-a-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
    { firstName: "Owner", lastName: "B", email: `final-owner-b-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
    { firstName: "Customer", lastName: "A", email: `final-customer-a-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "CUSTOMER" },
    { firstName: "Customer", lastName: "B", email: `final-customer-b-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "CUSTOMER" },
  ]).returning();
  const [salonA, salonB] = await db.insert(salonsTable).values([
    {
      ownerId: ownerA!.id, name: `Final booking A ${suffix}`, slug: `final-booking-a-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: "QA 1", phone: "+381110009901",
      email: `final-salon-a-${suffix}@example.test`, shortDescription: "Final booking QA",
      description: "Final booking QA", imageUrl: "/test.jpg", instantBooking: true,
    },
    {
      ownerId: ownerB!.id, name: `Final booking B ${suffix}`, slug: `final-booking-b-${suffix}`,
      city: "Novi Sad", municipality: "Centar", address: "QA 2", phone: "+381110009902",
      email: `final-salon-b-${suffix}@example.test`, shortDescription: "Foreign final booking QA",
      description: "Foreign final booking QA", imageUrl: "/test.jpg", instantBooking: true,
    },
  ]).returning();
  await db.update(usersTable).set({ activeSalonId: salonA!.id }).where(eq(usersTable.id, ownerA!.id));
  await db.update(usersTable).set({ activeSalonId: salonB!.id }).where(eq(usersTable.id, ownerB!.id));
  await db.update(salonsTable).set({ isVerified: true }).where(eq(salonsTable.id, salonA!.id));
  const [serviceA, serviceB] = await db.insert(servicesTable).values([
    { salonId: salonA!.id, categoryName: "QA", name: "Final service A", description: "QA", durationMinutes: 30, price: 1100, imageUrl: "/test.jpg" },
    { salonId: salonB!.id, categoryName: "QA", name: "Final service B", description: "QA", durationMinutes: 30, price: 2200, imageUrl: "/test.jpg" },
  ]).returning();
  const [employeeA, employeeB] = await db.insert(employeesTable).values([
    { salonId: salonA!.id, name: "Final employee A", role: "Stylist", bio: "", avatarUrl: "" },
    { salonId: salonB!.id, name: "Final employee B", role: "Stylist", bio: "", avatarUrl: "" },
  ]).returning();
  await db.insert(employeeLocationAssignmentsTable).values([
    { salonId: salonA!.id, employeeId: employeeA!.id, active: true, isDefault: true },
    { salonId: salonB!.id, employeeId: employeeB!.id, active: true, isDefault: true },
  ]);
  await db.insert(employeeServicesTable).values([
    { employeeId: employeeA!.id, serviceId: serviceA!.id },
    { employeeId: employeeB!.id, serviceId: serviceB!.id },
  ]);
  const [contactA, contactB] = await db.insert(salonCustomersTable).values([
    { salonId: salonA!.id, userId: customerA!.id, firstName: "Customer", lastName: "A", email: customerA!.email, phone: "+381611119901", phoneNormalized: "+381611119901" },
    { salonId: salonB!.id, userId: customerB!.id, firstName: "Customer", lastName: "B", email: customerB!.email, phone: "+381611119902", phoneNormalized: "+381611119902" },
  ]).returning();

  const [ownerASession, ownerBSession, customerASession, customerBSession] = await Promise.all([
    createSession(ownerA!.id), createSession(ownerB!.id), createSession(customerA!.id), createSession(customerB!.id),
  ]);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const customerBody = (date: string, startTime: string) => ({
      salonId: salonA!.id, serviceId: serviceA!.id, employeeId: employeeA!.id, date, startTime,
    });

    const impossibleFutureDate = "2099-02-30";
    assert.equal((await request(baseUrl, "", `/salons/${salonA!.id}/grouped-availability`, "POST", {
      fromDate: impossibleFutureDate,
      toDate: "2099-03-02",
      treatments: [{ serviceId: serviceA!.id, employeeId: employeeA!.id }],
    })).status, 400, "grouped availability must reject an impossible raw date before coercion");
    assert.equal((await request(baseUrl, customerASession, "/booking-groups", "POST", {
      salonId: salonA!.id,
      date: impossibleFutureDate,
      treatments: [{ serviceId: serviceA!.id, employeeId: employeeA!.id, startTime: "09:00" }],
    })).status, 400, "customer grouped booking must reject an impossible top-level raw date");
    assert.equal((await request(baseUrl, customerASession, "/booking-groups", "POST", {
      salonId: salonA!.id,
      date: "2099-03-01",
      treatments: [{
        serviceId: serviceA!.id,
        employeeId: employeeA!.id,
        date: impossibleFutureDate,
        startTime: "09:00",
      }],
    })).status, 400, "customer grouped booking must reject an impossible treatment raw date");
    assert.equal((await request(baseUrl, ownerASession, "/salon/booking-groups", "POST", {
      salonCustomerId: contactA!.id,
      treatments: [{
        serviceId: serviceA!.id,
        employeeId: employeeA!.id,
        date: impossibleFutureDate,
        startTime: "09:00",
      }],
    })).status, 400, "staff grouped booking must reject an impossible treatment raw date");
    assert.equal((await request(baseUrl, ownerASession, "/salon/appointments", "POST", {
      salonCustomerId: contactA!.id,
      serviceId: serviceA!.id,
      employeeId: employeeA!.id,
      date: impossibleFutureDate,
      startTime: "09:00",
    })).status, 400, "manual booking must reject an impossible raw date");
    assert.equal((await request(baseUrl, ownerASession, "/salon/booking-settings", "PUT", {
      slotGranularityMinutes: 15,
      minimumLeadTimeMinutes: 0,
      cancellationDeadlineMinutes: 1440,
      reminderOffsetsMinutes: [],
      reminderChannels: [],
      maxVisitGapMinutes: 0,
      minimumUsefulLateTreatmentMinutes: 0,
      dateHours: [{
        date: impossibleFutureDate,
        closed: true,
        openTime: null,
        closeTime: null,
        reason: "Impossible date",
      }],
      resourceDowntime: [],
    })).status, 400, "booking settings must reject an impossible date-hours raw date");
    assert.equal((await request(baseUrl, "", `/widget/salons/${salonA!.slug}/booking-groups`, "POST", {
      firstName: "Calendar",
      lastName: "Boundary",
      phone: "+381611110099",
      treatments: [{
        serviceId: serviceA!.id,
        employeeId: employeeA!.id,
        date: impossibleFutureDate,
        startTime: "09:00",
      }],
    })).status, 400, "widget grouped booking must reject an impossible treatment raw date");

    // Exact retries are not allowed to duplicate the durable booking, even when
    // both requests arrive before either response is available.
    const duplicateKey = `customer-retry-${suffix}`;
    const duplicateResults = await Promise.all([
      request(baseUrl, customerASession, "/appointments", "POST", customerBody("2099-12-07", "10:00"), duplicateKey),
      request(baseUrl, customerASession, "/appointments", "POST", customerBody("2099-12-07", "10:00"), duplicateKey),
    ]);
    assert.deepEqual(duplicateResults.map((item) => item.status).sort(), [201, 201]);
    assert.deepEqual(duplicateResults[0]!.body, duplicateResults[1]!.body,
      "concurrent exact retries must replay the byte-equivalent JSON outcome");
    const [duplicateCount] = await db.select({ value: count() }).from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salonA!.id),
      eq(appointmentsTable.customerId, customerA!.id),
      eq(appointmentsTable.date, "2099-12-07"),
      eq(appointmentsTable.startTime, "10:00"),
    ));
    assert.equal(duplicateCount!.value, 1, "an exact customer retry must produce only one durable appointment");
    const reorderedReplay = await request(baseUrl, customerASession, "/appointments", "POST", {
      startTime: "10:00",
      date: "2099-12-07",
      employeeId: employeeA!.id,
      serviceId: serviceA!.id,
      salonId: salonA!.id,
    }, duplicateKey);
    assert.equal(reorderedReplay.status, 201, "recursive canonical object ordering must replay");
    assert.deepEqual(reorderedReplay.body, duplicateResults[0]!.body);
    const pastPayload = customerBody("2020-01-02", "10:00");
    const pastReceiptKey = `past-replay-${suffix}`;
    await db.insert(bookingCommandReceiptsTable).values({
      salonId: salonA!.id,
      actorType: "user",
      actorId: customerA!.id,
      idempotencyKey: pastReceiptKey,
      commandType: "customer.appointment.create",
      payloadFingerprint: bookingPayloadFingerprint(pastPayload),
      responseStatus: 201,
      responseBody: duplicateResults[0]!.body,
    });
    const replayAfterDateRollover = await request(
      baseUrl, customerASession, "/appointments", "POST", pastPayload, pastReceiptKey,
    );
    assert.equal(replayAfterDateRollover.status, 201,
      "a receipt must replay after its original appointment date becomes past");
    assert.equal(replayAfterDateRollover.replayed, true);
    assert.deepEqual(replayAfterDateRollover.body, duplicateResults[0]!.body);
    await db.update(usersTable).set({ role: "JOBSEEKER" }).where(eq(usersTable.id, customerA!.id));
    assert.equal((await request(
      baseUrl, customerASession, "/appointments", "POST",
      customerBody("2099-12-07", "10:00"), duplicateKey,
    )).status, 403, "role revocation must still deny a matching customer receipt");
    await db.update(usersTable).set({ role: "CUSTOMER" }).where(eq(usersTable.id, customerA!.id));
    const changedPayload = await request(baseUrl, customerASession, "/appointments", "POST", {
      ...customerBody("2099-12-07", "10:30"),
    }, duplicateKey);
    assert.equal(changedPayload.status, 409);
    assert.deepEqual(changedPayload.body, {
      code: "IDEMPOTENCY_KEY_REUSED",
      error: "Idempotency-Key je već upotrebljen za drugačiji zahtev.",
    });
    const recovered = await request(
      baseUrl, customerASession,
      `/booking-commands/${encodeURIComponent(duplicateKey)}?salonId=${salonA!.id}`, "GET",
    );
    assert.equal(recovered.status, 200, "a durable receipt must be recoverable independently of API memory");
    assert.equal((recovered.body as { responseStatus: number }).responseStatus, 201);
    assert.deepEqual((recovered.body as { responseBody: unknown }).responseBody, duplicateResults[0]!.body);
    assert.equal((await request(
      baseUrl, customerBSession,
      `/booking-commands/${encodeURIComponent(duplicateKey)}?salonId=${salonA!.id}`, "GET",
    )).status, 404, "receipt lookup must be actor scoped");
    assert.equal((await request(baseUrl, customerBSession, "/appointments", "POST", {
      salonId: salonB!.id, serviceId: serviceB!.id, employeeId: employeeB!.id,
      date: "2099-12-07", startTime: "10:00",
    }, duplicateKey)).status, 201, "the same key must be independent for a different actor and tenant");

    const widgetKey = `widget-replay-${suffix}`;
    const widgetBody = {
      firstName: "Widget", lastName: "Replay", phone: "+381611119955",
      serviceId: serviceA!.id, employeeId: employeeA!.id,
      date: "2099-12-21", startTime: "12:00",
    };
    const widgetCreated = await request(
      baseUrl, "", `/widget/salons/${salonA!.slug}/appointments`,
      "POST", widgetBody, widgetKey,
    );
    assert.equal(widgetCreated.status, 201);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(
        baseUrl, "", `/widget/salons/${salonA!.slug}/appointments`,
        "POST", { phone: "+381611119955" }, `widget-rate-${attempt}-${suffix}`,
      );
    }
    const widgetReplayUnderRateLimit = await request(
      baseUrl, "", `/widget/salons/${salonA!.slug}/appointments`,
      "POST", widgetBody, widgetKey,
    );
    assert.equal(widgetReplayUnderRateLimit.status, 201,
      "a known widget replay must bypass saturated booking rate limits");
    assert.equal(widgetReplayUnderRateLimit.replayed, true);
    assert.deepEqual(widgetReplayUnderRateLimit.body, widgetCreated.body);
    await db.update(usersTable).set({ role: "JOBSEEKER" }).where(eq(usersTable.id, customerA!.id));
    assert.equal((await request(
      baseUrl, customerASession, `/widget/salons/${salonA!.slug}/appointments`,
      "POST", widgetBody, widgetKey,
    )).status, 403, "JOBSEEKER role must deny a matching widget receipt");
    await db.update(usersTable).set({ role: "CUSTOMER" }).where(eq(usersTable.id, customerA!.id));

    const groupBody = {
      salonId: salonA!.id,
      date: "2099-12-08",
      treatments: [
        { serviceId: serviceA!.id, employeeId: employeeA!.id, startTime: "10:00" },
        { serviceId: serviceA!.id, employeeId: employeeA!.id, startTime: "10:30" },
      ],
      notes: "Concurrent exact group retry",
    };
    const groupResults = await Promise.all([
      request(baseUrl, customerASession, "/booking-groups", "POST", groupBody, `group-retry-${suffix}`),
      request(baseUrl, customerASession, "/booking-groups", "POST", groupBody, `group-retry-${suffix}`),
    ]);
    assert.deepEqual(groupResults.map((item) => item.status).sort(), [201, 201]);
    assert.deepEqual(groupResults[0]!.body, groupResults[1]!.body);
    const [groupAppointmentCount] = await db.select({ value: count() }).from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salonA!.id), eq(appointmentsTable.date, "2099-12-08"),
    ));
    assert.equal(groupAppointmentCount!.value, 2, "an exact group retry must leave one complete group, not duplicate or partial members");
    const [groupCount] = await db.select({ value: count() }).from(bookingGroupsTable).where(eq(bookingGroupsTable.salonId, salonA!.id));
    assert.equal(groupCount!.value, 1, "an exact group retry must persist one group");
    const createdGroup = groupResults.find((item) => item.status === 201)!.body as {
      id: string;
      appointments: Array<{ id: string }>;
    };
    const groupReplayKey = `group-retry-${suffix}`;
    const [groupReceipt] = await db.select({ id: bookingCommandReceiptsTable.id }).from(bookingCommandReceiptsTable)
      .where(and(eq(bookingCommandReceiptsTable.salonId, salonA!.id),
        eq(bookingCommandReceiptsTable.actorId, customerA!.id),
        eq(bookingCommandReceiptsTable.idempotencyKey, groupReplayKey))).limit(1);
    const [groupConfirmation] = await db.select({ value: count() }).from(emailDeliveriesTable).where(eq(
      emailDeliveriesTable.eventKey, `booking-group:${createdGroup.id}:confirmation:email`,
    ));
    const [groupNotification] = await db.select({ value: count() }).from(customerNotificationsTable).where(eq(
      customerNotificationsTable.eventKey, `booking-group:${createdGroup.id}:created`,
    ));
    assert.ok(groupReceipt, "a committed grouped-booking receipt must exist");
    assert.equal(groupConfirmation!.value, 1,
      "a committed grouped-booking receipt must atomically include its deduplicated email outbox row");
    assert.equal(groupNotification!.value, 1,
      "a committed grouped-booking receipt must atomically include its customer notification row");
    assert.equal((await request(baseUrl, customerASession, `/booking-groups/${createdGroup.id}/reschedule`, "PATCH", {
      treatments: [{
        appointmentId: createdGroup.appointments[0]!.id,
        date: impossibleFutureDate,
        startTime: "10:00",
      }],
    })).status, 400, "group reschedule must reject an impossible treatment raw date");
    assert.equal((await db.select({ value: count() }).from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salonA!.id),
      eq(appointmentsTable.date, "2099-03-02"),
    )))[0]!.value, 0, "impossible input must never be normalized into a durable March booking");

    // Manual salon creation and customer creation use the same server-side
    // authority and lock namespace.
    const manualRace = await Promise.all([
      request(baseUrl, ownerASession, "/salon/appointments", "POST", {
        serviceId: serviceA!.id, employeeId: employeeA!.id, salonCustomerId: contactA!.id,
        date: "2099-12-09", startTime: "11:00",
      }),
      request(baseUrl, customerASession, "/appointments", "POST", customerBody("2099-12-09", "11:00")),
    ]);
    assert.deepEqual(manualRace.map((item) => item.status).sort(), [201, 409]);
    const ownerReplayKey = `owner-access-replay-${suffix}`;
    const ownerReplayBody = {
      serviceId: serviceA!.id, employeeId: employeeA!.id, salonCustomerId: contactA!.id,
      date: "2099-12-19", startTime: "11:00",
    };
    const ownerCreated = await request(
      baseUrl, ownerASession, "/salon/appointments", "POST", ownerReplayBody, ownerReplayKey,
    );
    assert.equal(ownerCreated.status, 201);
    await db.update(salonsTable).set({ ownerId: ownerB!.id }).where(eq(salonsTable.id, salonA!.id));
    assert.equal((await request(
      baseUrl, ownerASession, "/salon/appointments", "POST", ownerReplayBody, ownerReplayKey,
    )).status, 403, "ownership removal must deny a matching owner receipt");
    assert.equal((await request(
      baseUrl, ownerASession,
      `/booking-commands/${encodeURIComponent(ownerReplayKey)}?salonId=${salonA!.id}`, "GET",
    )).status, 403, "ownership removal must deny receipt reconciliation");
    await db.update(salonsTable).set({ ownerId: ownerA!.id }).where(eq(salonsTable.id, salonA!.id));

    // IDs are always re-derived under the authenticated salon/customer tenant;
    // deliberately mixed valid IDs must not be accepted.
    assert.equal((await request(baseUrl, customerASession, "/appointments", "POST", {
      salonId: salonA!.id, serviceId: serviceB!.id, employeeId: employeeA!.id, date: "2099-12-10", startTime: "10:00",
    })).status, 404);
    assert.equal((await request(baseUrl, customerASession, "/appointments", "POST", {
      salonId: salonA!.id, serviceId: serviceA!.id, employeeId: employeeB!.id, date: "2099-12-10", startTime: "10:00",
    })).status, 409);
    assert.equal((await request(baseUrl, ownerASession, "/salon/appointments", "POST", {
      serviceId: serviceB!.id, employeeId: employeeB!.id, salonCustomerId: contactB!.id,
      date: "2099-12-10", startTime: "10:00",
    })).status, 404);
    assert.equal((await request(baseUrl, ownerASession, "/salon/appointments", "POST", {
      serviceId: serviceA!.id, employeeId: employeeA!.id, salonCustomerId: contactB!.id,
      date: "2099-12-10", startTime: "10:00",
    })).status, 404);

    // An assignment revoked while a booking is waiting to enter its critical
    // section is observed by the locked availability recheck.
    const lockHeld = deferred();
    const releaseLock = deferred();
    const blocker = db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salonA!.id, [{ date: "2099-12-11", employeeId: employeeA!.id }]);
      lockHeld.resolve();
      await releaseLock.promise;
    });
    await lockHeld.promise;
    const unavailableRequest = request(
      baseUrl, customerASession, "/appointments", "POST", customerBody("2099-12-11", "10:00"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await db.update(employeeLocationAssignmentsTable).set({ active: false }).where(and(
      eq(employeeLocationAssignmentsTable.salonId, salonA!.id),
      eq(employeeLocationAssignmentsTable.employeeId, employeeA!.id),
    ));
    releaseLock.resolve();
    await blocker;
    assert.equal((await unavailableRequest).status, 409, "an employee revoked before the write must not receive the booking");
    await db.update(employeeLocationAssignmentsTable).set({ active: true }).where(and(
      eq(employeeLocationAssignmentsTable.salonId, salonA!.id),
      eq(employeeLocationAssignmentsTable.employeeId, employeeA!.id),
    ));

    const raceCreated = await request(
      baseUrl, customerASession, "/appointments", "POST", customerBody("2099-12-12", "10:00"),
    );
    assert.equal(raceCreated.status, 201);
    const raceId = (raceCreated.body as { id: string }).id;
    assert.equal((await request(baseUrl, customerBSession, `/appointments/${raceId}/cancel`, "POST", {})).status, 404);
    assert.equal((await request(baseUrl, ownerBSession, `/salon/appointments/${raceId}`, "PATCH", { notes: "foreign" })).status, 404);

    const [rescheduleResult, cancelResult] = await Promise.all([
      request(baseUrl, customerASession, `/appointments/${raceId}`, "PATCH", { date: "2099-12-13", startTime: "10:00" }),
      request(baseUrl, customerASession, `/appointments/${raceId}/cancel`, "POST", { reason: "Concurrent cancellation" }),
    ]);
    assert.equal(cancelResult.status, 200, "cancellation must win or follow a concurrent reschedule");
    assert.ok([200, 409].includes(rescheduleResult.status));
    const [raceFinal] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, raceId));
    assert.equal(raceFinal!.status, "cancelled");
    assert.ok(["2099-12-12", "2099-12-13"].includes(raceFinal!.date), "the race must commit one complete schedule state");
    const raceCancellationHistory = await db.select().from(appointmentStatusHistoryTable).where(and(
      eq(appointmentStatusHistoryTable.appointmentId, raceId),
      eq(appointmentStatusHistoryTable.status, "cancelled"),
    ));
    assert.equal(raceCancellationHistory.length, 1, "a cancellation/reschedule race writes one cancellation history event");

    const durableCreated = await request(
      baseUrl, customerASession, "/appointments", "POST", customerBody("2099-12-14", "12:00"),
    );
    assert.equal(durableCreated.status, 201);
    const durableId = (durableCreated.body as { id: string }).id;
    await db.update(servicesTable).set({ active: false, durationMinutes: 90, price: 9999 }).where(eq(servicesTable.id, serviceA!.id));
    await db.update(employeesTable).set({ active: false }).where(eq(employeesTable.id, employeeA!.id));
    await db.update(salonsTable).set({ active: false }).where(eq(salonsTable.id, salonA!.id));
    await db.insert(salonDateHoursTable).values({
      salonId: salonA!.id, date: "2099-12-14", closed: true, openTime: null, closeTime: null, reason: "Configuration changed",
    });
    const listedAfterConfigurationChange = await request(
      baseUrl,
      customerASession,
      "/appointments?scope=upcoming&pageSize=100",
      "GET",
    );
    assert.equal(listedAfterConfigurationChange.status, 200);
    assert.ok((listedAfterConfigurationChange.body as Array<{ id: string }>).some((item) => item.id === durableId),
      "existing appointments remain visible after salon, service, employee, and schedule deactivation");
    const [durableRow] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, durableId));
    assert.equal(durableRow!.durationMinutes, 30, "existing appointment duration remains historical");
    assert.equal(durableRow!.price, 1100, "existing appointment price remains historical");
    assert.equal((await request(baseUrl, customerASession, `/appointments/${durableId}/cancel`, "POST", {
      reason: "Configuration changed after booking",
    })).status, 200, "existing appointments retain their lifecycle after configuration changes");
    const durableHistory = await db.select().from(appointmentStatusHistoryTable)
      .where(eq(appointmentStatusHistoryTable.appointmentId, durableId));
    assert.deepEqual(durableHistory.map((item) => item.status).sort(), ["cancelled", "confirmed"],
      "creation and cancellation history survives later configuration changes");

    // A database-side cancellation (the SQLSTATE PostgreSQL uses for statement
    // timeouts) in the middle of grouped creation must roll the whole unit back.
    await db.update(servicesTable).set({ active: true }).where(eq(servicesTable.id, serviceA!.id));
    await db.update(employeesTable).set({ active: true }).where(eq(employeesTable.id, employeeA!.id));
    await db.update(salonsTable).set({ active: true }).where(eq(salonsTable.id, salonA!.id));
    await pool.query(`
      CREATE OR REPLACE FUNCTION final_booking_timeout_${suffix.replaceAll("-", "_")}() RETURNS trigger AS $$
      BEGIN
        IF NEW.notes = 'INJECT_DB_TIMEOUT' THEN
          RAISE EXCEPTION USING ERRCODE = '57014', MESSAGE = 'injected statement timeout';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER final_booking_timeout_trigger
      BEFORE INSERT ON appointments
      FOR EACH ROW EXECUTE FUNCTION final_booking_timeout_${suffix.replaceAll("-", "_")}();
    `);
    const groupsBeforeTimeout = (await db.select({ value: count() }).from(bookingGroupsTable))[0]!.value;
    const timeoutResult = await request(baseUrl, customerASession, "/booking-groups", "POST", {
      salonId: salonA!.id, date: "2099-12-15", notes: "INJECT_DB_TIMEOUT",
      treatments: [{ serviceId: serviceA!.id, employeeId: employeeA!.id, startTime: "10:00" }],
    });
    assert.equal(timeoutResult.status, 500);
    const groupsAfterTimeout = (await db.select({ value: count() }).from(bookingGroupsTable))[0]!.value;
    assert.equal(groupsAfterTimeout, groupsBeforeTimeout, "a database timeout must roll back the booking group row");
    assert.equal((await db.select({ value: count() }).from(appointmentsTable).where(and(
      eq(appointmentsTable.date, "2099-12-15"), eq(appointmentsTable.salonId, salonA!.id),
    )))[0]!.value, 0, "a database timeout must not leave a partial appointment");

    console.log("Final booking hardening checks passed.");
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS final_booking_timeout_trigger ON appointments");
    await pool.query(`DROP FUNCTION IF EXISTS final_booking_timeout_${suffix.replaceAll("-", "_")}()`);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
}

await run();
