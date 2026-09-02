import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  customerPasswordSetupAuditsTable,
  customerPasswordSetupTokensTable,
  educationCentersTable,
  educationInstructorsTable,
  employeesTable,
  legalEntitiesTable,
  legalEntityBusinessesTable,
  pool,
  salonsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

const suffix = randomUUID().slice(0, 8);
const createdUsers: string[] = [];

async function request(base: string, token: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      cookie: `${sessionCookieName}=${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function run() {
  const passwordHash = await hashPassword(`role-transition-${suffix}`);
  const users = await db.insert(usersTable).values([
    { firstName: "Super", lastName: suffix, email: `transition-super-${suffix}@test.invalid`, passwordHash, role: "SUPER_ADMIN" },
    { firstName: "Admin", lastName: suffix, email: `transition-admin-${suffix}@test.invalid`, passwordHash, role: "ADMIN" },
    { firstName: "Subject", lastName: suffix, email: `transition-subject-${suffix}@test.invalid`, passwordHash, role: "SALON_OWNER" },
    { firstName: "SalonTarget", lastName: suffix, email: `transition-salon-${suffix}@test.invalid`, passwordHash, role: "SALON_OWNER" },
    { firstName: "CenterTarget", lastName: suffix, email: `transition-center-${suffix}@test.invalid`, passwordHash, role: "EDUKATIVNI_CENTAR" },
    { firstName: "Convert", lastName: suffix, email: `transition-convert-${suffix}@test.invalid`, passwordHash, role: "CUSTOMER" },
  ]).returning();
  createdUsers.push(...users.map((user) => user.id));
  const [superUser, adminUser, subject, salonTarget, centerTarget, conversionUser] = users;
  const salonValues = (ownerId: string, label: string) => ({
    ownerId, name: `${label}-${suffix}`, slug: `${label.toLowerCase()}-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", phone: "060000000",
    email: `${label}-${suffix}@test.invalid`, shortDescription: "Test", description: "Test",
    imageUrl: "https://example.test/image.jpg",
  });
  const [ownedSalon, secondOwnedSalon, foreignSalon] = await db.insert(salonsTable).values([
    salonValues(subject!.id, "Owned"),
    salonValues(subject!.id, "SecondOwned"),
    salonValues(salonTarget!.id, "Foreign"),
  ]).returning();
  const [legalEntity] = await db.insert(legalEntitiesTable).values({
    normalizedPib: `transition-${suffix}`, legalName: `Transition ${suffix}`,
  }).returning();
  await db.insert(legalEntityBusinessesTable).values([
    { legalEntityId: legalEntity!.id, ownerUserId: subject!.id, salonId: ownedSalon!.id },
    { legalEntityId: legalEntity!.id, ownerUserId: subject!.id, salonId: secondOwnedSalon!.id },
  ]);
  const [employee] = await db.insert(employeesTable).values({
    salonId: ownedSalon!.id, userId: subject!.id, name: `Historical employee ${suffix}`, role: "Stylist",
    bio: "", avatarUrl: "https://example.test/avatar.jpg", active: true,
  }).returning();
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: subject!.id, name: `Center-${suffix}`, city: "Beograd", description: "Test",
    imageUrl: "https://example.test/center.jpg", verificationStatus: "verified",
  }).returning();
  const [instructor] = await db.insert(educationInstructorsTable).values({
    centerId: center!.id, userId: subject!.id, fullName: `Historical instructor ${suffix}`,
  }).returning();
  const superToken = await createSession(superUser!.id);
  const adminToken = await createSession(adminUser!.id);
  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const forbidden = await request(base, adminToken, `/admin/users/${subject!.id}/business-role-transition`);
    assert.equal(forbidden.status, 403, "ordinary ADMIN must not inspect transition relations");

    const state = await request(base, superToken, `/admin/users/${subject!.id}/business-role-transition`);
    assert.equal(state.status, 200);
    assert.deepEqual(new Set((state.body.salonOwnerships as Array<{ id: string }>).map((row) => row.id)),
      new Set([ownedSalon!.id, secondOwnedSalon!.id]));
    const [inspectionDuringSalonSetup, salonSetup] = await Promise.all([
      request(base, superToken, `/admin/users/${subject!.id}/business-role-transition`),
      request(base, superToken, "/admin/accounts/setup", "POST", {
        firstName: "Setup", lastName: `Salon ${suffix}`, email: `transition-setup-salon-${suffix}@test.invalid`,
        role: "SALON_EMPLOYEE", employee: { salonId: ownedSalon!.id, jobTitle: "Setup stylist" },
      }),
    ]);
    assert.equal(inspectionDuringSalonSetup.status, 200,
      "transition inspection must not deadlock against resource-first salon account setup");
    assert.equal(salonSetup.status, 201);
    createdUsers.push(((salonSetup.body.user as { id: string }).id));

    const invalid = await request(base, superToken, `/admin/users/${subject!.id}/business-role-transition`, "POST", {
      role: "CUSTOMER", active: true, activeSalonId: null,
      salonOwnerships: [
        { relationId: foreignSalon!.id, action: "deactivate" },
        { relationId: secondOwnedSalon!.id, action: "deactivate" },
      ],
      employments: [{ relationId: employee!.id, action: "unlink" }],
      educationCenterOwnerships: [{ relationId: center!.id, action: "transfer", targetUserId: centerTarget!.id }],
      instructorRelations: [{ relationId: instructor!.id, action: "unlink" }],
    });
    assert.equal(invalid.status, 422, "a foreign-tenant relation id must reject the complete transaction");
    const [unchanged] = await db.select().from(usersTable).where(eq(usersTable.id, subject!.id));
    const [unchangedSalon] = await db.select().from(salonsTable).where(eq(salonsTable.id, ownedSalon!.id));
    assert.equal(unchanged!.role, "SALON_OWNER", "validation failure must roll back the role");
    assert.equal(unchangedSalon!.ownerId, subject!.id, "validation failure must roll back all relations");

    const splitLegalEntity = await request(base, superToken, `/admin/users/${subject!.id}/business-role-transition`, "POST", {
      role: "CUSTOMER", active: true, activeSalonId: null,
      salonOwnerships: [
        { relationId: ownedSalon!.id, action: "transfer", targetUserId: salonTarget!.id },
        { relationId: secondOwnedSalon!.id, action: "deactivate" },
      ],
      employments: [{ relationId: employee!.id, action: "unlink" }],
      educationCenterOwnerships: [{ relationId: center!.id, action: "transfer", targetUserId: centerTarget!.id }],
      instructorRelations: [{ relationId: instructor!.id, action: "unlink" }],
    });
    assert.equal(splitLegalEntity.status, 409, "a partial transfer must not split one legal entity between owners");
    const legalBindingsAfterRejection = await db.select().from(legalEntityBusinessesTable)
      .where(eq(legalEntityBusinessesTable.legalEntityId, legalEntity!.id));
    assert.deepEqual(new Set(legalBindingsAfterRejection.map((row) => row.ownerUserId)), new Set([subject!.id]),
      "the complete legal-entity closure must roll back unchanged");

    const transition = {
      role: "CUSTOMER", active: true, activeSalonId: null,
      salonOwnerships: [
        { relationId: ownedSalon!.id, action: "transfer", targetUserId: salonTarget!.id },
        { relationId: secondOwnedSalon!.id, action: "transfer", targetUserId: salonTarget!.id },
      ],
      employments: [{ relationId: employee!.id, action: "unlink" }],
      educationCenterOwnerships: [{ relationId: center!.id, action: "transfer", targetUserId: centerTarget!.id }],
      instructorRelations: [{ relationId: instructor!.id, action: "unlink" }],
    };
    const concurrent = await Promise.all([
      request(base, superToken, `/admin/users/${subject!.id}/business-role-transition`, "POST", transition),
      request(base, superToken, `/admin/users/${subject!.id}/business-role-transition`, "POST", transition),
      request(base, superToken, `/admin/users/${conversionUser!.id}/business-conversion`, "POST", {
        role: "SALON_EMPLOYEE",
        employee: { salonId: ownedSalon!.id, jobTitle: "Concurrent stylist" },
      }),
      request(base, superToken, "/admin/accounts/setup", "POST", {
        firstName: "Setup", lastName: `Instructor ${suffix}`, email: `transition-setup-instructor-${suffix}@test.invalid`,
        role: "INSTRUCTOR", instructor: { centerId: center!.id },
      }),
    ]);
    assert.deepEqual(concurrent.slice(0, 2).map((item) => item.status).sort(), [200, 422],
      "concurrent transitions must serialize and only one stale decision set may commit");
    assert.equal(concurrent[2]!.status, 200,
      "employee conversion racing the salon transfer must complete without a lock inversion/deadlock");
    assert.equal(concurrent[3]!.status, 201,
      "instructor account setup racing center transfer must complete without a lock inversion/deadlock");
    createdUsers.push(((concurrent[3]!.body.user as { id: string }).id));

    const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.id, subject!.id));
    const [preservedSalon] = await db.select().from(salonsTable).where(eq(salonsTable.id, ownedSalon!.id));
    const [preservedEmployee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employee!.id));
    const [preservedCenter] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.id, center!.id));
    const [preservedInstructor] = await db.select().from(educationInstructorsTable).where(eq(educationInstructorsTable.id, instructor!.id));
    assert.equal(updatedUser!.role, "CUSTOMER");
    assert.equal(updatedUser!.activeSalonId, null);
    assert.equal(preservedSalon!.ownerId, salonTarget!.id);
    assert.equal(preservedCenter!.ownerId, centerTarget!.id);
    assert.equal(preservedEmployee!.userId, null);
    assert.equal(preservedInstructor!.userId, null);
    const [converted] = await db.select().from(usersTable).where(eq(usersTable.id, conversionUser!.id));
    assert.equal(converted!.role, "SALON_EMPLOYEE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

try {
  await run();
  console.log("Business role transition regression test passed.");
} finally {
  await db.delete(educationInstructorsTable).where(inArray(educationInstructorsTable.userId, createdUsers));
  await db.delete(educationInstructorsTable).where(eq(educationInstructorsTable.fullName, `Historical instructor ${suffix}`));
  await db.delete(employeesTable).where(eq(employeesTable.name, `Historical employee ${suffix}`));
  await db.delete(educationCentersTable).where(inArray(educationCentersTable.ownerId, createdUsers));
  await db.delete(salonsTable).where(inArray(salonsTable.ownerId, createdUsers));
  await db.delete(legalEntitiesTable).where(eq(legalEntitiesTable.normalizedPib, `transition-${suffix}`));
  await db.delete(customerPasswordSetupAuditsTable).where(inArray(customerPasswordSetupAuditsTable.targetUserId, createdUsers));
  await db.delete(customerPasswordSetupTokensTable).where(inArray(customerPasswordSetupTokensTable.userId, createdUsers));
  if (createdUsers.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUsers));
  await pool.end();
}