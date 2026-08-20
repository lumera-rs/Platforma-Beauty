import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { backfillSalonCustomers, ensureDemoData } from "./seed";

const suffix = randomUUID();
const fixtureUserIds: string[] = [];
const fixtureSalonIds: string[] = [];
const fixtureServiceIds: string[] = [];
const fixtureAppointmentIds: string[] = [];

async function run(): Promise<void> {
  await ensureDemoData();

  const [owner] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (!owner) throw new Error("CRM backfill test requires at least one seeded user.");

  const [historicalUser] = await db.insert(usersTable).values({
    firstName: "Istorijski",
    lastName: "Klijent",
    email: `crm-backfill-${suffix}@example.test`,
    phone: "+381601234567",
    passwordHash: "test-only-password-hash",
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning();
  const [optOutUser] = await db.insert(usersTable).values({
    firstName: "SMS",
    lastName: "Klijent",
    email: `crm-backfill-optout-${suffix}@example.test`,
    phone: "+381601234568",
    passwordHash: "test-only-password-hash",
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning();
  fixtureUserIds.push(historicalUser!.id, optOutUser!.id);

  const [sourceSalon, otherSalon] = await db.insert(salonsTable).values([
    {
      ownerId: owner.id,
      name: `CRM backfill source ${suffix}`,
      slug: `crm-backfill-source-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 1",
      phone: "+381110000001",
      email: `crm-backfill-source-${suffix}@example.test`,
      shortDescription: "Test salon",
      description: "Test salon za CRM regresiju.",
      imageUrl: "/test.jpg",
    },
    {
      ownerId: owner.id,
      name: `CRM backfill other ${suffix}`,
      slug: `crm-backfill-other-${suffix}`,
      city: "Novi Sad",
      municipality: "Stari grad",
      address: "Test 2",
      phone: "+381210000002",
      email: `crm-backfill-other-${suffix}@example.test`,
      shortDescription: "Test salon",
      description: "Drugi test salon za CRM regresiju.",
      imageUrl: "/test.jpg",
    },
  ]).returning();
  fixtureSalonIds.push(sourceSalon!.id, otherSalon!.id);

  const [service] = await db.insert(servicesTable).values({
    salonId: sourceSalon!.id,
    categoryName: "Test",
    name: "Test tretman",
    description: "Test usluga za CRM regresiju.",
    durationMinutes: 60,
    price: 1000,
    imageUrl: "/test.jpg",
  }).returning();
  fixtureServiceIds.push(service!.id);

  const [historicalAppointment] = await db.insert(appointmentsTable).values({
    salonId: sourceSalon!.id,
    customerId: historicalUser!.id,
    serviceId: service!.id,
    date: "2024-01-10",
    startTime: "10:00",
    endTime: "11:00",
    durationMinutes: 60,
    price: 1000,
    status: "completed",
  }).returning();
  fixtureAppointmentIds.push(historicalAppointment!.id);

  const [otherSalonContact] = await db.insert(salonCustomersTable).values({
    salonId: otherSalon!.id,
    userId: historicalUser!.id,
    firstName: historicalUser!.firstName,
    lastName: historicalUser!.lastName,
    email: historicalUser!.email,
    phone: historicalUser!.phone,
    smsOptOut: true,
  }).returning();

  const [existingContact] = await db.insert(salonCustomersTable).values({
    salonId: sourceSalon!.id,
    userId: optOutUser!.id,
    firstName: optOutUser!.firstName,
    lastName: optOutUser!.lastName,
    email: optOutUser!.email,
    phone: optOutUser!.phone,
    smsOptOut: true,
  }).returning();
  const [optOutAppointment] = await db.insert(appointmentsTable).values({
    salonId: sourceSalon!.id,
    customerId: optOutUser!.id,
    serviceId: service!.id,
    date: "2024-01-11",
    startTime: "11:00",
    endTime: "12:00",
    durationMinutes: 60,
    price: 1000,
    status: "completed",
  }).returning();
  fixtureAppointmentIds.push(optOutAppointment!.id);

  await backfillSalonCustomers();

  const sourceContacts = await db.select().from(salonCustomersTable).where(and(
    eq(salonCustomersTable.salonId, sourceSalon!.id),
    eq(salonCustomersTable.userId, historicalUser!.id),
  ));
  assert.equal(sourceContacts.length, 1, "historical client should have exactly one source-salon CRM contact");
  assert.equal(sourceContacts[0]!.smsOptOut, false, "new CRM contact should use the default SMS preference");

  const [updatedHistoricalAppointment] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, historicalAppointment!.id));
  assert.equal(updatedHistoricalAppointment!.salonCustomerId, sourceContacts[0]!.id, "historical appointment should link to the source-salon contact");

  const [unchangedContact] = await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.id, existingContact!.id));
  assert.equal(unchangedContact!.smsOptOut, true, "existing SMS opt-out must remain unchanged");
  const [updatedOptOutAppointment] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, optOutAppointment!.id));
  assert.equal(updatedOptOutAppointment!.salonCustomerId, existingContact!.id, "appointment should reuse the existing source-salon contact");

  const [crossSalonAppointment] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.salonCustomerId, otherSalonContact!.id));
  assert.equal(crossSalonAppointment, undefined, "a contact from another salon must never be linked");
  const [unchangedOtherSalonContact] = await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.id, otherSalonContact!.id));
  assert.equal(unchangedOtherSalonContact!.smsOptOut, true, "other-salon contact data must remain unchanged");

  console.log("CRM historical-client backfill regression passed.");
}

try {
  await run();
} finally {
  if (fixtureAppointmentIds.length) {
    await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, fixtureAppointmentIds));
  }
  if (fixtureServiceIds.length) {
    await db.delete(servicesTable).where(inArray(servicesTable.id, fixtureServiceIds));
  }
  if (fixtureSalonIds.length) {
    await db.delete(salonsTable).where(inArray(salonsTable.id, fixtureSalonIds));
  }
  if (fixtureUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, fixtureUserIds));
  }
  await pool.end();
}