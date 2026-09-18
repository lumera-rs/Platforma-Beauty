import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  employeeLocationAssignmentsTable,
  employeesTable,
  salonsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { initializeDevelopmentTestFixtures } from "./seed";

async function run() {
  await initializeDevelopmentTestFixtures();
  app.set("trust proxy", true);
  const suffix = randomUUID();
  const password = `Reset-before-${suffix}`;
  const userIds: string[] = [];
  let salonId: string | undefined;
  let server: ReturnType<typeof app.listen> | undefined;

  try {
    const passwordHash = await hashPassword(password);
    const [owner, employeeUser] = await db.insert(usersTable).values([
      { firstName: "Reset", lastName: "Owner", email: `reset-owner-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Reset", lastName: "Employee", email: `reset-employee-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE", mustChangePassword: false },
    ]).returning();
    assert.ok(owner && employeeUser);
    userIds.push(owner.id, employeeUser.id);

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id, name: `Reset ${suffix}`, slug: `reset-${suffix}`, city: "Beograd", municipality: "Vračar",
      address: "Test 1", phone: "+381601234567", email: `reset-salon-${suffix}@example.test`,
      shortDescription: "Reset test", description: "Reset test", imageUrl: "",
    }).returning();
    assert.ok(salon);
    salonId = salon.id;
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [employee] = await db.insert(employeesTable).values({
      salonId: salon.id, userId: employeeUser.id, name: "Reset Employee", role: "Stilista", bio: "", avatarUrl: "",
    }).returning();
    assert.ok(employee);
    await db.insert(employeeLocationAssignmentsTable).values({
      employeeId: employee.id, salonId: salon.id, active: true, isDefault: true,
    });

    const ownerCookie = `${sessionCookieName}=${await createSession(owner.id)}`;
    const oldEmployeeCookie = `${sessionCookieName}=${await createSession(employeeUser.id)}`;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    const reset = await fetch(`${baseUrl}/salon/employees/${employee.id}/access/reset-password`, {
      method: "POST",
      headers: { cookie: ownerCookie },
    });
    const resetBody = await reset.json() as { temporaryPassword?: string };
    assert.equal(reset.status, 200);
    assert.ok(resetBody.temporaryPassword);

    const oldSessionProbe = await fetch(`${baseUrl}/employee/portal`, { headers: { cookie: oldEmployeeCookie } });
    assert.equal(oldSessionProbe.status, 401, "the old employee session must be revoked, not reach the must-change-password 428 gate");

    const remainingSessions = await db.select({ id: sessionsTable.id }).from(sessionsTable)
      .where(eq(sessionsTable.userId, employeeUser.id));
    assert.equal(remainingSessions.length, 0);

    const temporaryLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.${Number.parseInt(suffix.slice(0, 2), 16)}.${Number.parseInt(suffix.slice(2, 4), 16)}.7` },
      body: JSON.stringify({ email: employeeUser.email, password: resetBody.temporaryPassword }),
    });
    assert.equal(temporaryLogin.status, 200, "the newly issued temporary password must remain usable");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});