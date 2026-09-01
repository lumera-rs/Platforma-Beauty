import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  customerPasswordSetupAuditsTable,
  customerPasswordSetupRateLimitsTable,
  customerPasswordSetupTokensTable,
  db,
  educationCentersTable,
  educationInstructorsTable,
  employeeLocationAssignmentsTable,
  employeesTable,
  legalEntitiesTable,
  salonsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

type CreatedSetup = {
  user: { id: string; role: string; email: string };
  setupUrl: string;
  expiresAt: string;
};

async function run(): Promise<void> {
  await ensureBusinessGrowthSchema();
  await db.delete(customerPasswordSetupRateLimitsTable);
  const suffix = randomUUID();
  const administratorPassword = randomBytes(24).toString("base64url");
  const customerPassword = randomBytes(24).toString("base64url");
  const salonPib = `1${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 8)}`;
  const centerPib = `2${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 8)}`;
  const rollbackPib = `3${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 8)}`;
  const conversionSalonPib = `4${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 8)}`;
  const conversionCenterPib = `5${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 8)}`;
  const createdUserIds: string[] = [];
  const actors = await db.insert(usersTable).values([
    {
      firstName: "Setup",
      lastName: "Superadmin",
      email: `setup-superadmin-${suffix}@example.test`,
      passwordHash: await hashPassword(administratorPassword),
      passwordSetAt: new Date(),
      role: "SUPER_ADMIN",
    },
    {
      firstName: "Setup",
      lastName: "Admin",
      email: `setup-admin-${suffix}@example.test`,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Setup",
      lastName: "Customer",
      email: `setup-existing-customer-${suffix}@example.test`,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    },
    {
      firstName: "Setup",
      lastName: "Owner",
      email: `setup-owner-${suffix}@example.test`,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    },
    {
      firstName: "Convert", lastName: "Owner",
      email: `convert-owner-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "CUSTOMER",
    },
    {
      firstName: "Convert", lastName: "Employee",
      email: `convert-employee-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "ADMIN",
    },
    {
      firstName: "Convert", lastName: "Center",
      email: `convert-center-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "STUDENT",
    },
    {
      firstName: "Convert", lastName: "Instructor",
      email: `convert-instructor-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "JOBSEEKER",
    },
    {
      firstName: "Convert", lastName: "Rollback",
      email: `convert-rollback-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "CUSTOMER",
    },
    {
      firstName: "Convert", lastName: "Inactive",
      email: `convert-inactive-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "CUSTOMER", active: false,
    },
    {
      firstName: "Convert", lastName: "Concurrent",
      email: `convert-concurrent-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "CUSTOMER",
    },
    {
      firstName: "Convert", lastName: "PatchRace",
      email: `convert-patch-race-${suffix}@example.test`, passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(), role: "CUSTOMER",
    },
  ]).returning();
  createdUserIds.push(...actors.map((actor) => actor.id));
  const [
    superAdmin, admin, existingCustomer, owner, conversionOwner, conversionEmployee,
    conversionCenter, conversionInstructor, conversionRollback, conversionInactive, conversionConcurrent, conversionPatchRace,
  ] = actors;
  assert.ok(superAdmin && admin && existingCustomer && owner && conversionOwner && conversionEmployee
    && conversionCenter && conversionInstructor && conversionRollback && conversionInactive && conversionConcurrent
    && conversionPatchRace);
  const cookies = {
    superAdmin: `${sessionCookieName}=${await createSession(superAdmin.id)}`,
    admin: `${sessionCookieName}=${await createSession(admin.id)}`,
    customer: `${sessionCookieName}=${await createSession(existingCustomer.id)}`,
    owner: `${sessionCookieName}=${await createSession(owner.id)}`,
  };
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const createBody = {
      firstName: "Production",
      lastName: "Customer",
      email: `setup-target-${suffix}@example.test`,
    };
    const create = (cookie?: string, body = createBody) => fetch(`${baseUrl}/admin/customers/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

    assert.equal((await create()).status, 401);
    assert.equal((await create(cookies.customer)).status, 403);
    assert.equal((await create(cookies.admin)).status, 403);
    assert.equal((await create(cookies.owner)).status, 403);
    const genericCreate = (body: Record<string, unknown>) => fetch(`${baseUrl}/admin/accounts/setup`, {
      method: "POST", headers: { cookie: cookies.superAdmin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const unauthorizedGenericCreate = (cookie?: string) => fetch(`${baseUrl}/admin/accounts/setup`, {
      method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ ...createBody, role: "ADMIN" }),
    });
    assert.equal((await unauthorizedGenericCreate()).status, 401);
    assert.equal((await unauthorizedGenericCreate(cookies.admin)).status, 403);
    const convert = (userId: string, body: Record<string, unknown>, cookie?: string) =>
      fetch(`${baseUrl}/admin/users/${userId}/business-conversion`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    assert.equal((await convert(conversionOwner.id, { role: "SALON_OWNER" })).status, 401);
    assert.equal((await convert(conversionOwner.id, { role: "SALON_OWNER" }, cookies.admin)).status, 403);
    assert.equal((await convert(conversionOwner.id, { role: "SALON_OWNER" }, cookies.customer)).status, 403);
    assert.equal((await convert(conversionOwner.id, { role: "SALON_OWNER" }, cookies.owner)).status, 403);
    assert.equal((await convert(randomUUID(), {
      role: "INSTRUCTOR", instructor: { centerId: randomUUID() },
    }, cookies.superAdmin)).status, 404);
    assert.equal((await convert(conversionOwner.id, {
      role: "SALON_OWNER", employee: { salonId: randomUUID(), jobTitle: "Pogrešno" },
    }, cookies.superAdmin)).status, 422);
    assert.equal((await db.select({ role: usersTable.role }).from(usersTable)
      .where(eq(usersTable.id, conversionOwner.id)))[0]?.role, "CUSTOMER");
    assert.equal((await convert(conversionInactive.id, {
      role: "INSTRUCTOR", instructor: { centerId: randomUUID() },
    }, cookies.superAdmin)).status, 422);
    assert.equal((await convert(owner.id, {
      role: "INSTRUCTOR", instructor: { centerId: randomUUID() },
    }, cookies.superAdmin)).status, 422, "business-to-business conversion is explicitly rejected");
    const standaloneResponse = await genericCreate({
      ...createBody, email: `setup-standalone-admin-${suffix}@example.test`, role: "ADMIN",
    });
    assert.equal(standaloneResponse.status, 201);
    const standalone = await standaloneResponse.json() as CreatedSetup;
    createdUserIds.push(standalone.user.id);
    assert.equal(standalone.user.role, "ADMIN");
    const incompleteRoleTransition = await fetch(`${baseUrl}/admin/users/${standalone.user.id}`, {
      method: "PATCH",
      headers: { cookie: cookies.superAdmin, "content-type": "application/json" },
      body: JSON.stringify({ role: "SALON_OWNER" }),
    });
    assert.equal(incompleteRoleTransition.status, 422);
    assert.equal((await db.select({ role: usersTable.role }).from(usersTable)
      .where(eq(usersTable.id, standalone.user.id)))[0]?.role, "ADMIN");
    const incompleteBusinessResponse = await genericCreate({
      ...createBody, email: `setup-incomplete-owner-${suffix}@example.test`, role: "SALON_OWNER",
    });
    assert.equal(incompleteBusinessResponse.status, 422);

    const ownerEmail = `setup-business-owner-${suffix}@example.test`;
    const ownerSetupResponse = await genericCreate({
      firstName: "Business", lastName: "Owner", email: ownerEmail, role: "SALON_OWNER",
      salon: {
        name: "Transactional salon", slug: `transactional-salon-${suffix}`, city: "Beograd",
        municipality: "Vračar", address: "Njegoševa 1", postalCode: "11000",
        phone: "+38160111222", email: ownerEmail, companyName: "Transactional Salon DOO",
        companyTaxId: salonPib, companyRegistrationNumber: `MB-${suffix}`,
        companyAddress: "Njegoševa 1", companyCity: "Beograd", companyPostalCode: "11000",
        shortDescription: "Salon created in one transaction.", description: "Complete salon business profile.",
      },
    });
    assert.equal(ownerSetupResponse.status, 201);
    const ownerSetup = await ownerSetupResponse.json() as CreatedSetup;
    createdUserIds.push(ownerSetup.user.id);
    const [createdSalon] = await db.select().from(salonsTable).where(eq(salonsTable.ownerId, ownerSetup.user.id));
    assert.ok(createdSalon);
    assert.equal((await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable)
      .where(eq(usersTable.id, ownerSetup.user.id)))[0]?.activeSalonId, createdSalon.id);
    assert.equal((await convert(ownerSetup.user.id, {
      role: "INSTRUCTOR", instructor: { centerId: randomUUID() },
    }, cookies.superAdmin)).status, 422);
    assert.equal((await db.select().from(salonsTable)
      .where(eq(salonsTable.id, createdSalon.id)))[0]?.ownerId, ownerSetup.user.id,
    "rejected business-source conversion preserves the existing companion");

    const employeeEmail = `setup-business-employee-${suffix}@example.test`;
    const employeeSetupResponse = await genericCreate({
      firstName: "Business", lastName: "Employee", email: employeeEmail, role: "SALON_EMPLOYEE",
      employee: { salonId: createdSalon.id, jobTitle: "Kozmetičar", bio: "Iskusan član tima." },
    });
    assert.equal(employeeSetupResponse.status, 201);
    const employeeSetup = await employeeSetupResponse.json() as CreatedSetup;
    createdUserIds.push(employeeSetup.user.id);
    const [createdEmployee] = await db.select().from(employeesTable).where(eq(employeesTable.userId, employeeSetup.user.id));
    assert.ok(createdEmployee);
    const [assignment] = await db.select().from(employeeLocationAssignmentsTable)
      .where(eq(employeeLocationAssignmentsTable.employeeId, createdEmployee.id));
    assert.equal(assignment?.salonId, createdSalon.id);
    assert.equal(assignment?.active, true);
    assert.equal(assignment?.isDefault, true);

    const centerEmail = `setup-business-center-${suffix}@example.test`;
    const centerSetupResponse = await genericCreate({
      firstName: "Education", lastName: "Owner", email: centerEmail, role: "EDUKATIVNI_CENTAR",
      educationCenter: {
        name: "Transactional academy", city: "Novi Sad", description: "Potpun opis edukativnih programa.",
        contactEmail: centerEmail, contactPhone: "+38161111222", contactAddress: "Bulevar 1",
        pib: centerPib,
      },
    });
    assert.equal(centerSetupResponse.status, 201);
    const centerSetup = await centerSetupResponse.json() as CreatedSetup;
    createdUserIds.push(centerSetup.user.id);
    const [createdCenter] = await db.select().from(educationCentersTable)
      .where(eq(educationCentersTable.ownerId, centerSetup.user.id));
    assert.ok(createdCenter);
    const [centerWorkspace] = await db.select().from(salonsTable).where(eq(salonsTable.ownerId, centerSetup.user.id));
    assert.equal(centerWorkspace, undefined, "education-center setup does not create a salon workspace");
    assert.equal((await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable)
      .where(eq(usersTable.id, centerSetup.user.id)))[0]?.activeSalonId, null);

    const instructorEmail = `setup-business-instructor-${suffix}@example.test`;
    const instructorSetupResponse = await genericCreate({
      firstName: "Course", lastName: "Instructor", email: instructorEmail, role: "INSTRUCTOR",
      instructor: {
        centerId: createdCenter.id, biography: "Predavač sa iskustvom.", industryYears: 9,
        experienceYears: 4, specializations: ["Nega kože"], qualifications: ["Sertifikat"],
      },
    });
    assert.equal(instructorSetupResponse.status, 201);
    const instructorSetup = await instructorSetupResponse.json() as CreatedSetup;
    createdUserIds.push(instructorSetup.user.id);
    const [createdInstructor] = await db.select().from(educationInstructorsTable)
      .where(eq(educationInstructorsTable.userId, instructorSetup.user.id));
    assert.equal(createdInstructor?.centerId, createdCenter.id);

    const convertedOwnerResponse = await convert(conversionOwner.id, {
      role: "SALON_OWNER",
      salon: {
        name: "Converted salon", slug: `converted-salon-${suffix}`, city: "Beograd",
        municipality: "Vračar", address: "Konverzija 1", phone: "+38160111999",
        email: conversionOwner.email, companyName: "Converted Salon DOO",
        companyTaxId: conversionSalonPib, companyRegistrationNumber: `CONV-${suffix}`,
        companyAddress: "Konverzija 1", companyCity: "Beograd",
        shortDescription: "Konvertovani salon.", description: "Potpun konvertovani poslovni profil.",
      },
    }, cookies.superAdmin);
    assert.equal(convertedOwnerResponse.status, 200);
    const [convertedSalon] = await db.select().from(salonsTable)
      .where(eq(salonsTable.ownerId, conversionOwner.id));
    assert.ok(convertedSalon);
    assert.equal((await db.select({ role: usersTable.role, activeSalonId: usersTable.activeSalonId })
      .from(usersTable).where(eq(usersTable.id, conversionOwner.id)))[0]?.activeSalonId, convertedSalon.id);

    assert.equal((await convert(conversionEmployee.id, {
      role: "SALON_EMPLOYEE",
      employee: { salonId: createdSalon.id, jobTitle: "Stilista", bio: "Konvertovani član tima." },
    }, cookies.superAdmin)).status, 200);
    const [convertedEmployee] = await db.select().from(employeesTable)
      .where(eq(employeesTable.userId, conversionEmployee.id));
    assert.ok(convertedEmployee);
    assert.equal((await db.select().from(employeeLocationAssignmentsTable)
      .where(eq(employeeLocationAssignmentsTable.employeeId, convertedEmployee.id)))[0]?.salonId, createdSalon.id);

    assert.equal((await convert(conversionCenter.id, {
      role: "EDUKATIVNI_CENTAR",
      educationCenter: {
        name: "Converted academy", city: "Niš", description: "Konvertovani edukativni centar.",
        contactEmail: conversionCenter.email, contactPhone: "+38161111999",
        contactAddress: "Akademija 1", pib: conversionCenterPib,
      },
    }, cookies.superAdmin)).status, 200);
    const [convertedEducationCenter] = await db.select().from(educationCentersTable)
      .where(eq(educationCentersTable.ownerId, conversionCenter.id));
    assert.ok(convertedEducationCenter);
    assert.equal((await db.select().from(salonsTable)
      .where(eq(salonsTable.ownerId, conversionCenter.id)))[0], undefined,
    "center conversion does not create a salon workspace");
    assert.equal((await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable)
      .where(eq(usersTable.id, conversionCenter.id)))[0]?.activeSalonId, null);

    assert.equal((await convert(conversionInstructor.id, {
      role: "INSTRUCTOR",
      instructor: {
        centerId: createdCenter.id, biography: "Konvertovani predavač.", industryYears: 8,
        experienceYears: 3, specializations: ["Nega"], qualifications: ["Sertifikat"],
      },
    }, cookies.superAdmin)).status, 200);
    assert.equal((await db.select().from(educationInstructorsTable)
      .where(eq(educationInstructorsTable.userId, conversionInstructor.id)))[0]?.centerId, createdCenter.id);

    const forbiddenTopLevel = await convert(conversionRollback.id, {
      role: "SALON_EMPLOYEE",
      employee: { salonId: createdSalon.id, jobTitle: "Stilista" },
      unexpected: true,
    }, cookies.superAdmin);
    assert.equal(forbiddenTopLevel.status, 422);
    const forbiddenNested = await convert(conversionRollback.id, {
      role: "SALON_EMPLOYEE",
      employee: { salonId: createdSalon.id, jobTitle: "Stilista", unexpected: true },
    }, cookies.superAdmin);
    assert.equal(forbiddenNested.status, 422);
    assert.equal((await db.select({ role: usersTable.role }).from(usersTable)
      .where(eq(usersTable.id, conversionRollback.id)))[0]?.role, "CUSTOMER");
    assert.equal((await db.select().from(employeesTable)
      .where(eq(employeesTable.userId, conversionRollback.id))).length, 0,
    "unknown conversion keys must not create a companion");

    const conversionConflict = await convert(conversionRollback.id, {
      role: "SALON_OWNER",
      salon: {
        name: "Rollback conversion", slug: createdSalon.slug, city: "Beograd",
        municipality: "Vračar", address: "Rollback 1", phone: "+38160111888",
        email: conversionRollback.email, companyName: "Rollback Conversion DOO",
        companyTaxId: rollbackPib, companyRegistrationNumber: `CONV-ROLLBACK-${suffix}`,
        companyAddress: "Rollback 1", companyCity: "Beograd",
        shortDescription: "Rollback.", description: "Ovaj poslovni profil ne sme ostati u bazi.",
      },
    }, cookies.superAdmin);
    assert.equal(conversionConflict.status, 409);
    assert.equal((await db.select({ role: usersTable.role, activeSalonId: usersTable.activeSalonId })
      .from(usersTable).where(eq(usersTable.id, conversionRollback.id)))[0]?.role, "CUSTOMER");
    assert.equal((await db.select().from(salonsTable)
      .where(eq(salonsTable.ownerId, conversionRollback.id))).length, 0,
    "companion conflict rolls back both role and companion");

    const concurrentBody = {
      role: "SALON_EMPLOYEE",
      employee: { salonId: createdSalon.id, jobTitle: "Istovremeni stilista" },
    };
    const concurrentStatuses = (await Promise.all([
      convert(conversionConcurrent.id, concurrentBody, cookies.superAdmin),
      convert(conversionConcurrent.id, concurrentBody, cookies.superAdmin),
    ])).map((response) => response.status).sort();
    assert.deepEqual(concurrentStatuses, [200, 422],
      "same-user conversions serialize instead of producing competing companions");
    const concurrentEmployees = await db.select().from(employeesTable)
      .where(eq(employeesTable.userId, conversionConcurrent.id));
    assert.equal(concurrentEmployees.length, 1);
    assert.equal(concurrentEmployees[0]?.salonId, createdSalon.id);
    const concurrentAssignments = await db.select().from(employeeLocationAssignmentsTable)
      .where(eq(employeeLocationAssignmentsTable.employeeId, concurrentEmployees[0]!.id));
    assert.equal(concurrentAssignments.length, 1);
    assert.equal(concurrentAssignments[0]?.salonId, createdSalon.id);
    assert.equal((await db.select().from(salonsTable)
      .where(eq(salonsTable.ownerId, conversionConcurrent.id))).length, 0);
    assert.equal((await db.select().from(educationCentersTable)
      .where(eq(educationCentersTable.ownerId, conversionConcurrent.id))).length, 0);
    assert.equal((await db.select().from(educationInstructorsTable)
      .where(eq(educationInstructorsTable.userId, conversionConcurrent.id))).length, 0,
    "the rejected concurrent request cannot leave mixed or orphan companions");

    const patchRole = (userId: string, role: string) => fetch(`${baseUrl}/admin/users/${userId}`, {
      method: "PATCH",
      headers: { cookie: cookies.superAdmin, "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const conversionPatchRaceStatuses = (await Promise.all([
      convert(conversionPatchRace.id, {
        role: "SALON_EMPLOYEE",
        employee: { salonId: createdSalon.id, jobTitle: "Trka stilista" },
      }, cookies.superAdmin),
      patchRole(conversionPatchRace.id, "SUPER_ADMIN"),
    ])).map((response) => response.status).sort();
    assert.deepEqual(conversionPatchRaceStatuses, [200, 422],
      "PATCH and conversion serialize on their shared per-user advisory lock");
    const [patchRaceUser] = await db.select({ role: usersTable.role }).from(usersTable)
      .where(eq(usersTable.id, conversionPatchRace.id));
    const patchRaceEmployees = await db.select().from(employeesTable)
      .where(eq(employeesTable.userId, conversionPatchRace.id));
    const patchRaceCenters = await db.select().from(educationCentersTable)
      .where(eq(educationCentersTable.ownerId, conversionPatchRace.id));
    const patchRaceInstructors = await db.select().from(educationInstructorsTable)
      .where(eq(educationInstructorsTable.userId, conversionPatchRace.id));
    const patchRaceSalons = await db.select().from(salonsTable)
      .where(eq(salonsTable.ownerId, conversionPatchRace.id));
    if (patchRaceUser?.role === "SALON_EMPLOYEE") {
      assert.equal(patchRaceEmployees.length, 1);
      assert.equal(patchRaceEmployees[0]?.salonId, createdSalon.id);
      assert.equal((await db.select().from(employeeLocationAssignmentsTable)
        .where(eq(employeeLocationAssignmentsTable.employeeId, patchRaceEmployees[0]!.id))).length, 1);
      assert.equal(patchRaceCenters.length + patchRaceInstructors.length + patchRaceSalons.length, 0);
    } else {
      assert.equal(patchRaceUser?.role, "SUPER_ADMIN");
      assert.equal(patchRaceEmployees.length + patchRaceCenters.length + patchRaceInstructors.length + patchRaceSalons.length, 0,
        "a non-business final role cannot retain a business companion");
    }

    const mismatchedEmail = `setup-mismatched-${suffix}@example.test`;
    assert.equal((await genericCreate({
      firstName: "Wrong", lastName: "Tenant", email: mismatchedEmail, role: "INSTRUCTOR",
      employee: { salonId: createdSalon.id, jobTitle: "Wrong" },
    })).status, 422);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, mismatchedEmail))).length, 0);

    const rollbackEmail = `setup-rollback-${suffix}@example.test`;
    const rollbackResponse = await genericCreate({
      firstName: "Rollback", lastName: "Owner", email: rollbackEmail, role: "SALON_OWNER",
      salon: {
        name: "Duplicate slug", slug: createdSalon.slug, city: "Beograd", municipality: "Vračar",
        address: "Test 2", phone: "+38160111333", email: rollbackEmail, companyName: "Rollback DOO",
        companyTaxId: rollbackPib, companyRegistrationNumber: `ROLLBACK-MB-${suffix}`,
        companyAddress: "Test 2", companyCity: "Beograd", shortDescription: "Rollback test.",
        description: "This relation must force the entire transaction to roll back.",
      },
    });
    assert.equal(rollbackResponse.status, 409);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, rollbackEmail))).length, 0,
      "failed companion insert rolls back the user, setup token, and audit");

    await db.update(salonsTable).set({ active: false }).where(eq(salonsTable.id, createdSalon.id));
    const isolatedEmail = `setup-inactive-tenant-${suffix}@example.test`;
    assert.equal((await genericCreate({
      firstName: "Inactive", lastName: "Tenant", email: isolatedEmail, role: "SALON_EMPLOYEE",
      employee: { salonId: createdSalon.id, jobTitle: "Kozmetičar" },
    })).status, 404);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, isolatedEmail))).length, 0);
    assert.equal((await convert(conversionRollback.id, {
      role: "SALON_EMPLOYEE", employee: { salonId: createdSalon.id, jobTitle: "Stilista" },
    }, cookies.superAdmin)).status, 404, "inactive foreign tenant cannot be linked");
    assert.equal((await db.select({ role: usersTable.role }).from(usersTable)
      .where(eq(usersTable.id, conversionRollback.id)))[0]?.role, "CUSTOMER");
    assert.equal((await db.select().from(employeesTable)
      .where(eq(employeesTable.userId, conversionRollback.id))).length, 0);
    await db.delete(customerPasswordSetupRateLimitsTable);

    const createdResponse = await create(cookies.superAdmin);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as CreatedSetup;
    createdUserIds.push(created.user.id);
    assert.equal(created.user.role, "CUSTOMER");
    assert.equal(created.user.email, createBody.email);
    const rawToken = new URL(created.setupUrl).hash.replace(/^#token=/, "");
    assert.ok(rawToken.length >= 32);

    const [storedToken] = await db.select()
      .from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.userId, created.user.id));
    assert.ok(storedToken);
    assert.notEqual(storedToken.tokenHash, rawToken);
    assert.equal(storedToken.tokenHash.length, 64);
    const audits = await db.select()
      .from(customerPasswordSetupAuditsTable)
      .where(eq(customerPasswordSetupAuditsTable.targetUserId, created.user.id));
    assert.deepEqual(audits.map((audit) => audit.action), ["CUSTOMER_CREATED"]);
    assert.equal(JSON.stringify(audits).includes(rawToken), false);

    const duplicateResponse = await create(cookies.superAdmin);
    assert.equal(duplicateResponse.status, 409);
    const duplicateRows = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, createBody.email));
    assert.equal(duplicateRows.length, 1);

    const validateResponse = await fetch(`${baseUrl}/auth/customer-password-setup/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: rawToken }),
    });
    assert.equal(validateResponse.status, 200);
    const reissue = () => fetch(`${baseUrl}/admin/customers/${created.user.id}/setup`, {
      method: "POST", headers: { cookie: cookies.superAdmin },
    });
    const [reissueA, reissueB] = await Promise.all([reissue(), reissue()]);
    assert.equal(reissueA.status, 201);
    assert.equal(reissueB.status, 201);
    const replacements = await Promise.all([reissueA.json(), reissueB.json()]) as CreatedSetup[];
    const activeTokens = await db.select().from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.userId, created.user.id));
    assert.equal(activeTokens.filter((row) => !row.consumedAt && !row.invalidatedAt).length, 1,
      "concurrent reissues leave exactly one active token");
    const activeTokenHash = activeTokens.find((row) => !row.consumedAt && !row.invalidatedAt)?.tokenHash;
    const replacementToken = replacements
      .map((replacement) => new URL(replacement.setupUrl).hash.replace(/^#token=/, ""))
      .find((token) => createHash("sha256").update(token).digest("hex") === activeTokenHash);
    assert.ok(replacementToken);
    const failedPolicyResponse = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: replacementToken, password: customerPassword, passwordConfirmation: `${customerPassword}x` }),
    });
    assert.equal(failedPolicyResponse.status, 400);
    const [attemptedToken] = await db.select().from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.tokenHash, createHash("sha256").update(replacementToken).digest("hex")));
    assert.equal(attemptedToken?.failedAttempts, 1, "policy failure consumes one active-token attempt");

    await createSession(created.user.id);
    const complete = () => fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: replacementToken, password: customerPassword, passwordConfirmation: customerPassword }),
    });
    const concurrentCompletionStatuses = (await Promise.all([complete(), complete()])).map((response) => response.status).sort();
    assert.deepEqual(concurrentCompletionStatuses, [200, 400], "only one concurrent completion consumes the token");
    const [completedToken] = await db.select()
      .from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.tokenHash, createHash("sha256").update(replacementToken).digest("hex")));
    assert.ok(completedToken?.consumedAt);
    const [completedUser] = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, created.user.id));
    assert.equal(completedUser?.role, "CUSTOMER");
    assert.ok(completedUser?.passwordSetAt);
    assert.equal(
      (await db.select().from(sessionsTable).where(eq(sessionsTable.userId, created.user.id))).length,
      0,
    );

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: createBody.email, password: customerPassword }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { user: { role: string } };
    assert.equal(login.user.role, "CUSTOMER");
    assert.equal((await fetch(`${baseUrl}/admin/accounts/${created.user.id}/setup`, {
      method: "POST", headers: { cookie: cookies.superAdmin },
    })).status, 404, "configured accounts cannot receive replacement setup tokens");

    const boundaryBody = { ...createBody, email: `setup-boundary-${suffix}@example.test` };
    const boundaryCreateResponse = await create(cookies.superAdmin, boundaryBody);
    assert.equal(boundaryCreateResponse.status, 201);
    const boundary = await boundaryCreateResponse.json() as CreatedSetup;
    createdUserIds.push(boundary.user.id);
    const boundaryToken = new URL(boundary.setupUrl).hash.replace(/^#token=/, "");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: boundaryToken, password: customerPassword, passwordConfirmation: `${customerPassword}-${attempt}` }),
      });
      assert.equal(response.status, 400);
    }
    const [boundedToken] = await db.select().from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.userId, boundary.user.id));
    assert.equal(boundedToken?.failedAttempts, 5);
    assert.ok(boundedToken?.invalidatedAt, "the max-attempt boundary invalidates the token atomically");

    const expiredBody = { ...createBody, email: `setup-expired-${suffix}@example.test` };
    const expiredCreateResponse = await create(cookies.superAdmin, expiredBody);
    assert.equal(expiredCreateResponse.status, 201);
    const expired = await expiredCreateResponse.json() as CreatedSetup;
    createdUserIds.push(expired.user.id);
    const expiredRawToken = new URL(expired.setupUrl).hash.replace(/^#token=/, "");
    await db.update(customerPasswordSetupTokensTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(customerPasswordSetupTokensTable.userId, expired.user.id));
    const expiredResponse = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: expiredRawToken, password: customerPassword, passwordConfirmation: customerPassword }),
    });
    assert.equal(expiredResponse.status, 400);
    await db.delete(customerPasswordSetupRateLimitsTable);
    let malformedStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      malformedStatus = (await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "short" }),
      })).status;
    }
    assert.equal(malformedStatus, 429, "malformed unknown tokens are bounded by the IP rate limit");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (createdUserIds.length) {
      await db.delete(customerPasswordSetupAuditsTable)
        .where(inArray(customerPasswordSetupAuditsTable.targetUserId, createdUserIds));
      await db.delete(customerPasswordSetupTokensTable)
        .where(inArray(customerPasswordSetupTokensTable.userId, createdUserIds));
      const createdEmployees = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(inArray(employeesTable.userId, createdUserIds));
      if (createdEmployees.length) {
        await db.delete(employeeLocationAssignmentsTable)
          .where(inArray(employeeLocationAssignmentsTable.employeeId, createdEmployees.map((row) => row.id)));
      }
      await db.delete(employeesTable).where(inArray(employeesTable.userId, createdUserIds));
      await db.delete(educationInstructorsTable).where(inArray(educationInstructorsTable.userId, createdUserIds));
      await db.delete(educationCentersTable).where(inArray(educationCentersTable.ownerId, createdUserIds));
      await db.delete(salonsTable).where(inArray(salonsTable.ownerId, createdUserIds));
      await db.delete(legalEntitiesTable).where(inArray(legalEntitiesTable.normalizedPib, [
        salonPib, centerPib, conversionSalonPib, conversionCenterPib, rollbackPib,
      ]));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    await db.delete(customerPasswordSetupRateLimitsTable);
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});