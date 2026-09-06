/**
 * Regression coverage for the MEDIUM finding: deactivating an employee from
 * one salon/location was cascading into a GLOBAL deactivation -- every other
 * assignment under the same owner, and the employee's login account, were
 * disabled too, even when the employee still had a valid active assignment
 * elsewhere.
 *
 * The fix scopes `GET /salon/employees/:employeeId/deactivation-preview` and
 * `POST /salon/employees/:employeeId/deactivate` to exactly the caller's
 * active salon (marketplace.ts's employeeDeactivationPreview/the deactivate
 * handler), and derives employeesTable.active / usersTable.active / session
 * validity from whether ANY employeeLocationAssignmentsTable row for that
 * employee is still active anywhere (syncEmployeeAccountState), instead of
 * unconditionally zeroing them out. employeeAndOwnedLocation's join was also
 * relaxed to not require an existing ACTIVE assignment, so an employee whose
 * last assignment was just deactivated remains reachable for reactivation
 * via PUT /salon/employees/:employeeId/locations/:salonId.
 *
 * This file exercises every scenario the fix's audit task required:
 *   1. single-salon employee deactivation (login disabled -- it was the only assignment)
 *   2. multi-salon-same-owner selective deactivation (login preserved)
 *   3. cross-tenant / adversarial ID manipulation (no state change for a non-owned target)
 *   4/10. multi-location deactivation down to zero assignments (login lifecycle)
 *   5. login persistence while another assignment stays active
 *   6. remaining-salon access after a sibling location is deactivated
 *   7. deactivated-salon access denial (404, not merely "inactive")
 *   8. scheduling/staff-listing exclusion at the deactivated location only
 *   9. appointment history preservation (no delete, no employeeId cascade)
 *   11. reactivation scoped to exactly the reactivated location
 *   12. deterministic repeat behavior
 * plus adversarial authorization checks against actual DB state (not just
 * HTTP status) and concurrency checks on the shared derived-state sync.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeesTable,
  salonsTable,
  servicesTable,
  sessionsTable,
  usersTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

type Json = Record<string, unknown>;

async function run(): Promise<void> {
  await ensureDemoData();
  const suffix = randomUUID();
  const passwordHash = await hashPassword(`employee-deactivation-scoping-${suffix}`);
  let server: ReturnType<typeof app.listen> | undefined;
  const userIds: string[] = [];
  const salonIds: string[] = [];
  const employeeIds: string[] = [];
  let serviceId: string | undefined;
  let appointmentId: string | undefined;

  try {
    const [ownerA, ownerB] = await db.insert(usersTable).values([
      { firstName: "Owner", lastName: "A", email: `dea-owner-a-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Owner", lastName: "B", email: `dea-owner-b-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
    ]).returning();
    assert.ok(ownerA && ownerB);
    userIds.push(ownerA.id, ownerB.id);

    const [salonA1, salonA2, salonB1] = await db.insert(salonsTable).values([
      {
        ownerId: ownerA.id, name: `Salon A1 ${suffix}`, slug: `dea-a1-${suffix}`, city: "Beograd", municipality: "Vračar",
        address: "Test A1", postalCode: "11000", phone: "+381110000201", email: `dea-a1-${suffix}@example.test`,
        companyName: `Firma A ${suffix}`, companyTaxId: "200000001", companyRegistrationNumber: "30000001",
        companyAddress: "Poslovna A1", companyCity: "Beograd", companyPostalCode: "11000",
        shortDescription: "Prva lokacija vlasnika A.", description: "Prva lokacija za proveru skopiranja deaktivacije.", imageUrl: "/test.jpg",
      },
      {
        ownerId: ownerA.id, name: `Salon A2 ${suffix}`, slug: `dea-a2-${suffix}`, city: "Novi Sad", municipality: "Centar",
        address: "Test A2", postalCode: "21000", phone: "+381110000202", email: `dea-a2-${suffix}@example.test`,
        companyName: `Firma A ${suffix}`, companyTaxId: "200000001", companyRegistrationNumber: "30000001",
        companyAddress: "Poslovna A2", companyCity: "Novi Sad", companyPostalCode: "21000",
        shortDescription: "Druga lokacija vlasnika A.", description: "Druga lokacija za proveru skopiranja deaktivacije.", imageUrl: "/test.jpg",
      },
      {
        ownerId: ownerB.id, name: `Salon B1 ${suffix}`, slug: `dea-b1-${suffix}`, city: "Niš", municipality: "Medijana",
        address: "Test B1", postalCode: "18000", phone: "+381110000203", email: `dea-b1-${suffix}@example.test`,
        companyName: `Firma B ${suffix}`, companyTaxId: "200000002", companyRegistrationNumber: "30000002",
        companyAddress: "Poslovna B1", companyCity: "Niš", companyPostalCode: "18000",
        shortDescription: "Tuđa lokacija.", description: "Lokacija koja nikada ne sme upravljati tuđim zaposlenima.", imageUrl: "/test.jpg",
      },
    ]).returning();
    assert.ok(salonA1 && salonA2 && salonB1);
    salonIds.push(salonA1.id, salonA2.id, salonB1.id);
    await db.update(usersTable).set({ activeSalonId: salonA1.id }).where(eq(usersTable.id, ownerA.id));
    await db.update(usersTable).set({ activeSalonId: salonB1.id }).where(eq(usersTable.id, ownerB.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salonA1.id, categoryName: "Test", name: `Usluga ${suffix}`, description: "Test usluga.",
      durationMinutes: 30, price: 2000, imageUrl: "/test.jpg",
    }).returning();
    assert.ok(service);
    serviceId = service.id;

    const [soloUser, multiUser] = await db.insert(usersTable).values([
      { firstName: "Solo", lastName: "Employee", email: `dea-solo-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
      { firstName: "Multi", lastName: "Employee", email: `dea-multi-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
    ]).returning();
    assert.ok(soloUser && multiUser);
    userIds.push(soloUser.id, multiUser.id);

    const [soloEmployee, multiEmployee] = await db.insert(employeesTable).values([
      { salonId: salonA1.id, userId: soloUser.id, name: `Solo ${suffix}`, role: "Stilista", bio: "", avatarUrl: "" },
      { salonId: salonA1.id, userId: multiUser.id, name: `Multi ${suffix}`, role: "Stilista", bio: "", avatarUrl: "" },
    ]).returning();
    assert.ok(soloEmployee && multiEmployee);
    employeeIds.push(soloEmployee.id, multiEmployee.id);

    await db.insert(employeeLocationAssignmentsTable).values([
      { employeeId: soloEmployee.id, salonId: salonA1.id, active: true, isDefault: true },
      { employeeId: multiEmployee.id, salonId: salonA1.id, active: true, isDefault: true },
      { employeeId: multiEmployee.id, salonId: salonA2.id, active: true, isDefault: false },
    ]);

    // Scenario #9 fixture: a past, completed appointment for soloEmployee at
    // A1 -- must survive deactivation untouched (no delete, employeeId kept).
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [appointment] = await db.insert(appointmentsTable).values({
      salonId: salonA1.id, employeeId: soloEmployee.id, serviceId: service.id,
      date: yesterday, startTime: "10:00", endTime: "10:30", durationMinutes: 30, price: 2000, status: "completed",
    }).returning();
    assert.ok(appointment);
    appointmentId = appointment.id;

    const soloSession = await createSession(soloUser.id);
    const multiSession = await createSession(multiUser.id);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    const ownerACookie = `${sessionCookieName}=${await createSession(ownerA.id)}`;
    const ownerBCookie = `${sessionCookieName}=${await createSession(ownerB.id)}`;
    const soloCookie = `${sessionCookieName}=${soloSession}`;
    const multiCookie = `${sessionCookieName}=${multiSession}`;

    const get = async (path: string, cookie: string) => {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      return { response, body: await response.json() as Json };
    };
    const post = async (path: string, cookie: string) => {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { cookie } });
      return { response, body: await response.json() as Json };
    };
    const put = async (path: string, cookie: string, data: unknown) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(data),
      });
      return { response, body: await response.json() as Json };
    };
    const setActiveSalon = (userId: string, salonId: string) =>
      db.update(usersTable).set({ activeSalonId: salonId }).where(eq(usersTable.id, userId));
    const assignment = async (employeeId: string, salonId: string) => {
      const [row] = await db.select().from(employeeLocationAssignmentsTable)
        .where(and(eq(employeeLocationAssignmentsTable.employeeId, employeeId), eq(employeeLocationAssignmentsTable.salonId, salonId))).limit(1);
      return row;
    };
    const employeeRow = async (employeeId: string) => {
      const [row] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId)).limit(1);
      return row!;
    };
    const userRow = async (userId: string) => {
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      return row!;
    };
    const sessionCount = async (userId: string) => {
      const rows = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.userId, userId));
      return rows.length;
    };
    // /auth/me always responds 200 (see marketplace.ts:6155-6159): it reports
    // session validity via `body.user` being null or not, never via status.
    const me = async (cookie: string) => {
      const response = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
      const body = await response.json() as { user: Json | null };
      return body.user;
    };

    // --- Scenario #1: single-salon employee deactivation --------------------
    await setActiveSalon(ownerA.id, salonA1.id);
    {
      const preview = await get(`/salon/employees/${soloEmployee.id}/deactivation-preview`, ownerACookie);
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.futureAppointmentCount, 0, "the fixture appointment is in the past and must not block deactivation");
      assert.equal(preview.body.hasLoginAccount, true);
      assert.equal(preview.body.willDeactivateLogin, true, "soloEmployee's only assignment is A1, so this action would take down its login");

      const result = await post(`/salon/employees/${soloEmployee.id}/deactivate`, ownerACookie);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.loginAccountDeactivated, true);

      const row = await assignment(soloEmployee.id, salonA1.id);
      assert.equal(row?.active, false);
      assert.equal(row?.isDefault, false);
      assert.equal((await employeeRow(soloEmployee.id)).active, false, "no other assignment exists, so the derived flag must flip");
      assert.equal((await userRow(soloUser.id)).active, false, "login account must be disabled once no active assignment remains");
      assert.equal(await sessionCount(soloUser.id), 0, "existing sessions must be revoked");

      assert.equal(await me(soloCookie), null, "the revoked session must no longer authenticate");
    }

    // --- Scenario #9: appointment/history preservation ----------------------
    {
      const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId!)).limit(1);
      assert.ok(row, "the historical appointment must not be deleted");
      assert.equal(row.employeeId, soloEmployee.id, "the appointment must keep its employee attribution");
      assert.equal(row.status, "completed");
    }

    // --- Scenario #7 & #12: deactivated-salon access denial, deterministic repeat ---
    {
      const first = await post(`/salon/employees/${soloEmployee.id}/deactivate`, ownerACookie);
      assert.equal(first.response.status, 404, "a location the employee is no longer assigned to must 404, not silently no-op 200");
      const second = await post(`/salon/employees/${soloEmployee.id}/deactivate`, ownerACookie);
      assert.equal(second.response.status, 404, "repeating the same request must behave identically");
      const preview = await get(`/salon/employees/${soloEmployee.id}/deactivation-preview`, ownerACookie);
      assert.equal(preview.response.status, 404);
      const row = await assignment(soloEmployee.id, salonA1.id);
      assert.equal(row?.active, false, "repeated no-op attempts must not change state");
    }

    // --- Scenario #2: multi-salon-same-owner selective deactivation ---------
    await setActiveSalon(ownerA.id, salonA1.id);
    {
      const preview = await get(`/salon/employees/${multiEmployee.id}/deactivation-preview`, ownerACookie);
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.willDeactivateLogin, false, "multiEmployee still has an active assignment at A2");

      const result = await post(`/salon/employees/${multiEmployee.id}/deactivate`, ownerACookie);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.loginAccountDeactivated, false, "the login must survive because A2 is still active");

      const rowA1 = await assignment(multiEmployee.id, salonA1.id);
      const rowA2 = await assignment(multiEmployee.id, salonA2.id);
      assert.equal(rowA1?.active, false, "the A1 assignment must be the one that changed");
      assert.equal(rowA2?.active, true, "the sibling A2 assignment must be completely untouched");
      assert.equal((await employeeRow(multiEmployee.id)).active, true, "the employee must not be globally disabled while A2 is active");
      assert.equal((await userRow(multiUser.id)).active, true, "the login account must remain enabled");
    }

    // --- Scenario #5: login persistence --------------------------------------
    {
      assert.ok(await me(multiCookie), "a session for an employee with a remaining active assignment must stay valid");
    }

    // --- Scenario #6: remaining-salon access ---------------------------------
    await setActiveSalon(ownerA.id, salonA2.id);
    {
      const staff = await get("/salon/employees", ownerACookie);
      assert.equal(staff.response.status, 200);
      const ids = (staff.body as unknown as Json[]).map((item) => (item as Json).id);
      assert.ok(ids.includes(multiEmployee.id), "A2 must still see the employee as active staff");

      const preview = await get(`/salon/employees/${multiEmployee.id}/deactivation-preview`, ownerACookie);
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.willDeactivateLogin, true, "A2 is now the only remaining active assignment");
    }

    // --- Scenario #7 & #8: deactivated-salon denial + scheduling exclusion ---
    await setActiveSalon(ownerA.id, salonA1.id);
    {
      const preview = await get(`/salon/employees/${multiEmployee.id}/deactivation-preview`, ownerACookie);
      assert.equal(preview.response.status, 404, "A1 no longer has an active assignment for this employee");

      const staff = await get("/salon/employees", ownerACookie);
      const ids = (staff.body as unknown as Json[]).map((item) => (item as Json).id);
      assert.ok(!ids.includes(multiEmployee.id), "A1's staff listing (and thus scheduling/employee-selection) must exclude the employee here");
    }

    // --- Scenario #3: cross-tenant / adversarial ID manipulation ------------
    {
      const attackDeactivate = await post(`/salon/employees/${multiEmployee.id}/deactivate`, ownerBCookie);
      assert.equal(attackDeactivate.response.status, 404, "owner B's active salon has no relationship to this employee");
      const attackPreview = await get(`/salon/employees/${multiEmployee.id}/deactivation-preview`, ownerBCookie);
      assert.equal(attackPreview.response.status, 404);

      // Try to reactivate ownerA's employee's inactive A1 slot from ownerB.
      const attackReactivateOwned = await put(`/salon/employees/${multiEmployee.id}/locations/${salonA1.id}`, ownerBCookie, { active: true });
      assert.equal(attackReactivateOwned.response.status, 403);

      // Try against ownerB's OWN salon, with an employee who has no relation to it.
      const attackForeignSalon = await put(`/salon/employees/${multiEmployee.id}/locations/${salonB1.id}`, ownerBCookie, { active: true });
      assert.equal(attackForeignSalon.response.status, 403);

      // Try against the fully-deactivated solo employee too.
      const attackSolo = await put(`/salon/employees/${soloEmployee.id}/locations/${salonA1.id}`, ownerBCookie, { active: true });
      assert.equal(attackSolo.response.status, 403);

      // Verify actual DB state, not just HTTP status: nothing must have moved.
      assert.equal((await assignment(multiEmployee.id, salonA1.id))?.active, false);
      assert.equal((await assignment(multiEmployee.id, salonA2.id))?.active, true);
      assert.equal((await assignment(soloEmployee.id, salonA1.id))?.active, false);
      const foreignRow = await db.select({ id: employeeLocationAssignmentsTable.id }).from(employeeLocationAssignmentsTable)
        .where(and(eq(employeeLocationAssignmentsTable.employeeId, multiEmployee.id), eq(employeeLocationAssignmentsTable.salonId, salonB1.id)));
      assert.equal(foreignRow.length, 0, "no assignment row may be created for a salon the attacker does not own");
    }

    // --- Scenario #4 & #10: multi-location deactivation to zero / final-assignment lifecycle ---
    await setActiveSalon(ownerA.id, salonA2.id);
    {
      const preview = await get(`/salon/employees/${multiEmployee.id}/deactivation-preview`, ownerACookie);
      assert.equal(preview.body.willDeactivateLogin, true);

      const result = await post(`/salon/employees/${multiEmployee.id}/deactivate`, ownerACookie);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.loginAccountDeactivated, true, "the last active assignment is gone, so the login must now be disabled");

      assert.equal((await assignment(multiEmployee.id, salonA2.id))?.active, false);
      assert.equal((await assignment(multiEmployee.id, salonA1.id))?.active, false, "A1 must remain exactly as it was left in scenario #2");
      assert.equal((await employeeRow(multiEmployee.id)).active, false);
      assert.equal((await userRow(multiUser.id)).active, false);
      assert.equal(await sessionCount(multiUser.id), 0);

      assert.equal(await me(multiCookie), null, "the last-assignment removal must revoke the login session");
    }

    // --- Scenario #11: reactivation scoping ----------------------------------
    {
      const reactivate = await put(`/salon/employees/${multiEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: true });
      assert.equal(reactivate.response.status, 200, "reactivating an employee's last-known assignment must succeed even with zero active assignments left");
      assert.equal(reactivate.body.active, true);

      assert.equal((await assignment(multiEmployee.id, salonA1.id))?.active, true);
      assert.equal((await assignment(multiEmployee.id, salonA2.id))?.active, false, "reactivating A1 must not resurrect the unrelated A2 assignment");
      assert.equal((await employeeRow(multiEmployee.id)).active, true, "the derived flag must recompute to true");
      assert.equal((await userRow(multiUser.id)).active, true, "the login account must be re-enabled");

      const freshMultiSession = await createSession(multiUser.id);
      assert.ok(await me(`${sessionCookieName}=${freshMultiSession}`), "login must work again after reactivation");
    }

    // --- Scenario #12: deterministic repeat behavior (assignment-level) ------
    {
      const first = await put(`/salon/employees/${multiEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: false });
      const second = await put(`/salon/employees/${multiEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: false });
      assert.equal(first.response.status, 200);
      assert.equal(second.response.status, 200);
      assert.equal((await employeeRow(multiEmployee.id)).active, false, "both A1 and A2 are inactive after this repeat, so the derived flag must be false");
      assert.equal((await userRow(multiUser.id)).active, false);

      const third = await put(`/salon/employees/${multiEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: true });
      const fourth = await put(`/salon/employees/${multiEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: true });
      assert.equal(third.response.status, 200);
      assert.equal(fourth.response.status, 200);
      assert.equal((await employeeRow(multiEmployee.id)).active, true);
      assert.equal((await userRow(multiUser.id)).active, true);
    }

    // --- Concurrency: two simultaneous deactivations of an employee's last
    // two locations must never both leave the account wrongly enabled. -------
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const concurrencySuffix = `${suffix}-cc${iteration}`;
      const [concurrentUser] = await db.insert(usersTable).values({
        firstName: "Concurrent", lastName: "Employee", email: `dea-concurrent-${concurrencySuffix}@example.test`,
        passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE",
      }).returning();
      assert.ok(concurrentUser);
      userIds.push(concurrentUser.id);
      const [concurrentEmployee] = await db.insert(employeesTable).values({
        salonId: salonA1.id, userId: concurrentUser.id, name: `Concurrent ${concurrencySuffix}`, role: "Stilista", bio: "", avatarUrl: "",
      }).returning();
      assert.ok(concurrentEmployee);
      employeeIds.push(concurrentEmployee.id);
      await db.insert(employeeLocationAssignmentsTable).values([
        { employeeId: concurrentEmployee.id, salonId: salonA1.id, active: true, isDefault: true },
        { employeeId: concurrentEmployee.id, salonId: salonA2.id, active: true, isDefault: false },
      ]);
      await createSession(concurrentUser.id);

      const [resultA1, resultA2] = await Promise.all([
        put(`/salon/employees/${concurrentEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: false }),
        put(`/salon/employees/${concurrentEmployee.id}/locations/${salonA2.id}`, ownerACookie, { active: false }),
      ]);
      assert.equal(resultA1.response.status, 200, `iteration ${iteration}: A1 deactivation must succeed`);
      assert.equal(resultA2.response.status, 200, `iteration ${iteration}: A2 deactivation must succeed`);

      const finalEmployee = await employeeRow(concurrentEmployee.id);
      const finalUser = await userRow(concurrentUser.id);
      assert.equal(finalEmployee.active, false, `iteration ${iteration}: no active assignment remains, so the derived flag must be false`);
      assert.equal(finalUser.active, false, `iteration ${iteration}: the account must not stay wrongly enabled after both locations are gone`);
      assert.equal(await sessionCount(concurrentUser.id), 0, `iteration ${iteration}: the session must be revoked exactly once, not left dangling`);
    }

    // --- Concurrency: simultaneous deactivate/reactivate of the SAME
    // assignment must never leave the derived flags out of sync with it. -----
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const flipSuffix = `${suffix}-flip${iteration}`;
      const [flipUser] = await db.insert(usersTable).values({
        firstName: "Flip", lastName: "Employee", email: `dea-flip-${flipSuffix}@example.test`,
        passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE",
      }).returning();
      assert.ok(flipUser);
      userIds.push(flipUser.id);
      const [flipEmployee] = await db.insert(employeesTable).values({
        salonId: salonA1.id, userId: flipUser.id, name: `Flip ${flipSuffix}`, role: "Stilista", bio: "", avatarUrl: "",
      }).returning();
      assert.ok(flipEmployee);
      employeeIds.push(flipEmployee.id);
      await db.insert(employeeLocationAssignmentsTable).values({
        employeeId: flipEmployee.id, salonId: salonA1.id, active: true, isDefault: true,
      });

      const [offResult, onResult] = await Promise.all([
        put(`/salon/employees/${flipEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: false }),
        put(`/salon/employees/${flipEmployee.id}/locations/${salonA1.id}`, ownerACookie, { active: true }),
      ]);
      assert.equal(offResult.response.status, 200, `iteration ${iteration}: the deactivate branch of the race must not error`);
      assert.equal(onResult.response.status, 200, `iteration ${iteration}: the reactivate branch of the race must not error`);

      const finalAssignment = await assignment(flipEmployee.id, salonA1.id);
      const finalEmployee = await employeeRow(flipEmployee.id);
      const finalUser = await userRow(flipUser.id);
      assert.equal(finalEmployee.active, finalAssignment?.active,
        `iteration ${iteration}: derived employee.active must always match the single assignment's final state, whichever write won`);
      assert.equal(finalUser.active, finalAssignment?.active,
        `iteration ${iteration}: derived account state must never diverge from the assignment it was derived from`);
    }

  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (appointmentId) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, appointmentId));
    if (employeeIds.length) await db.delete(employeeLocationAssignmentsTable).where(inArray(employeeLocationAssignmentsTable.employeeId, employeeIds));
    if (userIds.length) await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, userIds));
    if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    if (serviceId) await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
    if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    if (userIds.length) {
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
