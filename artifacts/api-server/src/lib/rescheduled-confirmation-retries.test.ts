import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentSeriesTable,
  appointmentsTable,
  db,
  emailDeliveriesTable,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { moveAppointmentSeries } from "../routes/marketplace";
import {
  retryFailedRescheduledEmailConfirmations,
  sendTransactionalEmail,
  type TransactionalEmailTransport,
} from "./brevo";
import { runScheduledRescheduledConfirmationRetries } from "./rescheduled-confirmation-retries";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const eventKeys: string[] = [];
const fixtureSalonIds: string[] = [];
const fixtureServiceIds: string[] = [];
const fixtureEmployeeIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSeriesIds: string[] = [];
const fixtureAppointmentIds: string[] = [];
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type MockBrevoOptions = {
  failFirst?: boolean;
  delayMs?: number;
};

function mockBrevo(options: MockBrevoOptions = {}) {
  let calls = 0;
  const idempotencyKeys: string[] = [];
  const transport: TransactionalEmailTransport = {
    async send(input) {
      calls += 1;
      idempotencyKeys.push(input.idempotencyKey);
      if (options.delayMs) await pause(options.delayMs);
      if (options.failFirst && calls === 1) throw new TypeError("fetch failed: simulated network interruption");
      return { messageId: `brevo-${calls}` };
    },
  };
  return { transport, calls: () => calls, idempotencyKeys };
}

async function deliveryByEventKey(eventKey: string) {
  const [delivery] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, eventKey));
  return delivery;
}

function rescheduledEmail(eventKey: string, scheduledAt?: Date) {
  eventKeys.push(eventKey);
  return {
    eventKey,
    emailType: "appointment_rescheduled",
    to: { email: `client-${suffix}@example.test`, name: "Test Klijent" },
    subject: "LUMERA — termin je pomeren",
    htmlContent: "<p>Test potvrda promene termina.</p>",
    salonId: fixtureSalonIds[0],
    appointmentId: fixtureAppointmentIds[0],
    metadata: { test: "rescheduled-confirmation-retries" },
    ...(scheduledAt ? { scheduledAt } : {}),
  } as const;
}

async function testTemporaryFailureRetryScheduleAndSuccess() {
  const eventKey = `test-rescheduled-retry:${suffix}`;
  const brevo = mockBrevo({ failFirst: true });
  const result = await sendTransactionalEmail(rescheduledEmail(eventKey), brevo.transport);
  assert.deepEqual(result, { failed: true }, "temporary Brevo failure should leave the delivery for retry");

  const queued = await deliveryByEventKey(eventKey);
  assert.equal(queued?.status, "queued");
  assert.equal(queued?.retryCount, 0, "the first failed attempt must not consume a retry slot");
  assert.ok(queued?.nextRetryAt, "temporary failures must receive a retry timestamp");
  assert.ok(
    queued.nextRetryAt.getTime() >= Date.now() + 4 * 60_000,
    "the first retry should be scheduled roughly five minutes later",
  );

  const retry = await retryFailedRescheduledEmailConfirmations(new Date(queued.nextRetryAt.getTime() + 1), brevo.transport);
  assert.equal(retry.retried, 1);

  const sent = await deliveryByEventKey(eventKey);
  assert.equal(sent?.status, "sent");
  assert.equal(sent?.retryCount, 1);
  assert.equal(sent?.providerMessageId, "brevo-2");
  assert.equal(brevo.calls(), 2, "the retry should issue one more provider request after the temporary failure");
  assert.deepEqual(brevo.idempotencyKeys, [queued.id, queued.id], "retries must reuse the delivery id as the Brevo idempotency key");
}

async function testParallelWorkersClaimOnlyOnce() {
  const eventKey = `test-rescheduled-parallel:${suffix}`;
  eventKeys.push(eventKey);
  const now = new Date();
  await db.insert(emailDeliveriesTable).values({
    eventKey,
    emailType: "appointment_rescheduled",
    salonId: fixtureSalonIds[0],
    appointmentId: fixtureAppointmentIds[0],
    recipientEmail: `parallel-${suffix}@example.test`,
    recipientName: "Paralelni Klijent",
    subject: "LUMERA — paralelni retry",
    htmlContent: "<p>Jedna potvrda za dva workera.</p>",
    nextRetryAt: now,
    metadata: { test: "parallel-workers" },
  });

  const brevo = mockBrevo({ delayMs: 50 });
  const [first, second] = await Promise.all([
    retryFailedRescheduledEmailConfirmations(now, brevo.transport),
    retryFailedRescheduledEmailConfirmations(now, brevo.transport),
  ]);
  assert.equal(first.retried + second.retried, 1, "exactly one worker may claim a due delivery");
  assert.equal(brevo.calls(), 1, "parallel retry workers must make one provider request");

  const sent = await deliveryByEventKey(eventKey);
  assert.equal(sent?.status, "sent");
  assert.equal(sent?.processingToken, null);
}

async function testScheduledWorkerFailureDoesNotReject() {
  let attempts = 0;
  await assert.doesNotReject(
    runScheduledRescheduledConfirmationRetries(async () => {
      attempts += 1;
      throw new Error("simulated scheduled worker failure");
    }),
    "a scheduled retry failure must not become an unhandled rejection",
  );
  assert.equal(attempts, 1);
}

async function createSeriesFixture() {
  await ensureDemoData();
  const [owner] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (!owner) throw new Error("Rescheduled confirmation test requires a seeded owner.");

  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Confirmation test salon ${suffix}`,
    slug: `confirmation-test-salon-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 28",
    phone: "+381110000028",
    email: `confirmation-salon-${suffix}@example.test`,
    shortDescription: "Salon za test potvrda.",
    description: "Izolovan salon za test trajnog outbox-a.",
    imageUrl: "/test.jpg",
  }).returning();
  fixtureSalonIds.push(salon!.id);

  const [service] = await db.insert(servicesTable).values({
    salonId: salon!.id,
    categoryName: "Test",
    name: "Test pomeranje termina",
    description: "Usluga za test trajnog outbox-a.",
    durationMinutes: 60,
    price: 1000,
    imageUrl: "/test.jpg",
  }).returning();
  fixtureServiceIds.push(service!.id);

  const [employee] = await db.insert(employeesTable).values({
    salonId: salon!.id,
    name: "Test terapeut",
    role: "Terapeut",
    bio: "",
    avatarUrl: "",
  }).returning();
  fixtureEmployeeIds.push(employee!.id);
  await db.insert(employeeLocationAssignmentsTable).values({
    salonId: salon!.id,
    employeeId: employee!.id,
    active: true,
    isDefault: true,
  });
  await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: service!.id });

  const [customer] = await db.insert(salonCustomersTable).values({
    salonId: salon!.id,
    firstName: "Test",
    lastName: "Klijent",
    email: `series-${suffix}@example.test`,
    phone: "+381601234569",
  }).returning();
  fixtureCustomerIds.push(customer!.id);

  const [series] = await db.insert(appointmentSeriesTable).values({
    salonId: salon!.id,
    salonCustomerId: customer!.id,
    serviceId: service!.id,
    employeeId: employee!.id,
    totalAppointments: 1,
    createdByUserId: owner.id,
  }).returning();
  fixtureSeriesIds.push(series!.id);

  const [appointment] = await db.insert(appointmentsTable).values({
    salonId: salon!.id,
    salonCustomerId: customer!.id,
    employeeId: employee!.id,
    serviceId: service!.id,
    seriesId: series!.id,
    date: "2099-10-18",
    startTime: "10:00",
    endTime: "11:00",
    durationMinutes: 60,
    price: 1000,
    status: "confirmed",
  }).returning();
  fixtureAppointmentIds.push(appointment!.id);

  return { salon: salon!, customer: customer!, series: series!, appointment: appointment! };
}

async function testMovePersistsBeforeSendAndKeepsEachMoveConfirmation() {
  const fixture = await createSeriesFixture();
  const moveEventIds = {
    ab: `move-a-b:${suffix}`,
    bc: `move-b-c:${suffix}`,
    cb: `move-c-b:${suffix}`,
  };
  const brevo = mockBrevo();

  await moveAppointmentSeries({
    salonId: fixture.salon.id,
    seriesId: fixture.series.id,
    move: { dayOffset: 1 },
    contact: fixture.customer,
    salon: fixture.salon,
    moveEventId: moveEventIds.ab,
  });
  const firstEventKey = `appointment-rescheduled:${moveEventIds.ab}:${fixture.appointment.id}:email`;
  const persistedBeforeRestart = await deliveryByEventKey(firstEventKey);
  assert.equal(persistedBeforeRestart?.status, "queued", "the move must commit the outbox before any send attempt");
  assert.equal(brevo.calls(), 0, "a process interruption before the first send must not lose the confirmation");

  const firstRetry = await retryFailedRescheduledEmailConfirmations(new Date(Date.now() + 1), brevo.transport);
  assert.equal(firstRetry.retried, 1, "a restarted worker must send the committed confirmation");
  assert.equal((await deliveryByEventKey(firstEventKey))?.status, "sent");

  await moveAppointmentSeries({
    salonId: fixture.salon.id,
    seriesId: fixture.series.id,
    move: { dayOffset: 1 },
    contact: fixture.customer,
    salon: fixture.salon,
    moveEventId: moveEventIds.bc,
  });
  await moveAppointmentSeries({
    salonId: fixture.salon.id,
    seriesId: fixture.series.id,
    move: { dayOffset: -1 },
    contact: fixture.customer,
    salon: fixture.salon,
    moveEventId: moveEventIds.cb,
  });

  const moveRows = await db.select().from(emailDeliveriesTable).where(and(
    eq(emailDeliveriesTable.appointmentId, fixture.appointment.id),
    eq(emailDeliveriesTable.emailType, "appointment_rescheduled"),
  ));
  assert.equal(moveRows.length, 3, "A→B→C→B must create three separate confirmations");
  assert.deepEqual(
    new Set(moveRows.map((row) => row.metadata.moveEventId)),
    new Set(Object.values(moveEventIds)),
  );

  const finalRetry = await retryFailedRescheduledEmailConfirmations(new Date(Date.now() + 1), brevo.transport);
  assert.equal(finalRetry.retried, 2);
  const sentRows = await db.select().from(emailDeliveriesTable).where(and(
    eq(emailDeliveriesTable.appointmentId, fixture.appointment.id),
    eq(emailDeliveriesTable.emailType, "appointment_rescheduled"),
  ));
  assert.ok(sentRows.every((row) => row.status === "sent"));
  assert.equal(brevo.calls(), 3, "each distinct move event should result in one provider request");
}

async function run() {
  try {
    await testTemporaryFailureRetryScheduleAndSuccess();
    await testParallelWorkersClaimOnlyOnce();
    await testScheduledWorkerFailureDoesNotReject();
    await testMovePersistsBeforeSendAndKeepsEachMoveConfirmation();
    console.log("Rescheduled confirmation outbox regression passed.");
  } finally {
    if (eventKeys.length) await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, eventKeys));
    if (fixtureAppointmentIds.length) {
      await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.appointmentId, fixtureAppointmentIds));
    }
    if (fixtureAppointmentIds.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, fixtureAppointmentIds));
    if (fixtureSeriesIds.length) await db.delete(appointmentSeriesTable).where(inArray(appointmentSeriesTable.id, fixtureSeriesIds));
    if (fixtureCustomerIds.length) await db.delete(salonCustomersTable).where(inArray(salonCustomersTable.id, fixtureCustomerIds));
    if (fixtureEmployeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, fixtureEmployeeIds));
    if (fixtureServiceIds.length) await db.delete(servicesTable).where(inArray(servicesTable.id, fixtureServiceIds));
    if (fixtureSalonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, fixtureSalonIds));
    await pool.end();
  }
}

await run();