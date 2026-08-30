import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appointmentsTable,
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationCentersTable,
  employeesTable,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { backfillSalonCustomers, ensureDemoData, restoreDemoEducationOwnerRole, seedEducationContent } from "./seed";
import { repairProductionMarketplaceDemoIdentity } from "./production-marketplace-demo-seed";

const suffix = randomUUID();
const fixtureUserIds: string[] = [];
const fixtureSalonIds: string[] = [];
const fixtureServiceIds: string[] = [];
const fixtureAppointmentIds: string[] = [];

async function run(): Promise<void> {
  await ensureDemoData();

  const [educationOwner] = await db.select({
    id: usersTable.id,
    role: usersTable.role,
    active: usersTable.active,
  }).from(usersTable).where(eq(usersTable.email, "edukacija@lumera.local")).limit(1);
  assert.equal(educationOwner?.role, "EDUKATIVNI_CENTAR", "education demo keeps the canonical owner role");
  assert.equal(educationOwner?.active, true, "education demo remains active");
  const ownedCenters = educationOwner
    ? await db.select({ id: educationCentersTable.id }).from(educationCentersTable)
      .where(eq(educationCentersTable.ownerId, educationOwner.id))
    : [];
  assert.ok(ownedCenters.length > 0, "education demo remains linked to an education center");
  let educationEnrollmentRepairVerified = false;
  try {
    await db.transaction(async (tx) => {
      const [course] = await tx.select({ id: coursesTable.id }).from(coursesTable).limit(1);
      const [owner] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "SALON_OWNER")).limit(1);
      const [learner] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.email, "zaposleni@lumera.local"))
        .limit(1);
      const [employee] = learner
        ? await tx.select({ id: employeesTable.id }).from(employeesTable)
          .where(eq(employeesTable.userId, learner.id))
          .limit(1)
        : [];
      if (!course || !owner || !employee) throw new Error("education enrollment seed test requires the demo learner fixture");
      const [enrollment] = await tx.select().from(courseEnrollmentsTable).where(and(
        eq(courseEnrollmentsTable.courseId, course.id),
        eq(courseEnrollmentsTable.purchaserId, owner.id),
        eq(courseEnrollmentsTable.employeeId, employee.id),
        sql`${courseEnrollmentsTable.status} <> 'cancelled'`,
      )).limit(1);
      if (!enrollment) throw new Error("education enrollment seed test requires the demo enrollment");

      const completedAt = new Date("2026-08-30T10:00:00.000Z");
      const certificateIssuedAt = new Date("2026-08-30T10:01:00.000Z");
      await tx.update(courseEnrollmentsTable).set({
        status: "completed",
        paymentStatus: "paid",
        progress: 100,
        completedAt,
        certificateIssuedAt,
        certificateNumber: `seed-test-${suffix}`,
      }).where(eq(courseEnrollmentsTable.id, enrollment.id));
      await seedEducationContent(tx);
      const [preserved] = await tx.select().from(courseEnrollmentsTable)
        .where(eq(courseEnrollmentsTable.id, enrollment.id));
      assert.equal(preserved!.status, "completed", "incremental seed must not reopen a completed employee enrollment");
      assert.equal(preserved!.progress, 100, "incremental seed must preserve completed enrollment progress");
      assert.deepEqual(preserved!.completedAt, completedAt, "incremental seed must preserve completion time");
      assert.deepEqual(preserved!.certificateIssuedAt, certificateIssuedAt, "incremental seed must preserve certificate time");
      assert.equal(preserved!.certificateNumber, `seed-test-${suffix}`, "incremental seed must preserve certificate data");

      await tx.update(courseEnrollmentsTable).set({
        status: "pending",
        paymentStatus: "pending",
        accessGrantedAt: null,
      }).where(eq(courseEnrollmentsTable.id, enrollment.id));
      await seedEducationContent(tx);
      const [repaired] = await tx.select().from(courseEnrollmentsTable)
        .where(eq(courseEnrollmentsTable.id, enrollment.id));
      assert.equal(repaired!.status, "active", "incremental seed should activate the pending demo employee enrollment");
      assert.equal(repaired!.paymentStatus, "paid", "incremental seed should make the pending demo employee enrollment accessible");
      assert.ok(repaired!.accessGrantedAt, "incremental seed should record when access was granted");
      educationEnrollmentRepairVerified = true;
      tx.rollback();
    });
  } catch (error) {
    if (!educationEnrollmentRepairVerified) throw error;
  }
  let repairVerified = false;
  try {
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ role: "ADMIN", active: false })
        .where(eq(usersTable.id, educationOwner!.id));
      await repairProductionMarketplaceDemoIdentity(tx);
      const [repaired] = await tx.select({
        id: usersTable.id,
        role: usersTable.role,
        active: usersTable.active,
      }).from(usersTable).where(eq(usersTable.email, "edukacija@lumera.local")).limit(1);
      const repairedCenters = await tx.select({ id: educationCentersTable.id })
        .from(educationCentersTable)
        .where(eq(educationCentersTable.ownerId, educationOwner!.id));
      assert.deepEqual(repaired, educationOwner, "production bootstrap repair preserves identity while restoring role and active state");
      assert.deepEqual(repairedCenters, ownedCenters, "production bootstrap repair preserves education-center ownership");
      repairVerified = true;
      tx.rollback();
    });
  } catch (error) {
    if (!repairVerified) throw error;
  }

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