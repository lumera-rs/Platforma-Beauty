/**
 * Real-browser E2E coverage for Task #5 (employee location deactivation
 * scoping). Task #5's backend/API fix and its tsx-level regression test
 * (artifacts/api-server/src/lib/employee-location-deactivation-scoping.test.ts)
 * already prove the server-side contract. This spec exists only to close
 * the remaining QA gap: does the real owner/employee UI, driven through a
 * real browser against the real API and a real database, actually surface
 * that contract correctly -- selective staff-list removal, scheduling
 * exclusion, fresh-session login behavior, and reactivation -- without
 * mocking the deactivation endpoint.
 *
 * Three independent, self-contained scenarios:
 *   1. Primary scenario: an employee with active assignments at Salon A and
 *      Salon B. Deactivate at A only, verify B is untouched (staff list,
 *      scheduling, login), verify a FRESH employee session behaves
 *      correctly, then reactivate A and verify full recovery.
 *   2. Final-assignment scenario: an employee with a single active
 *      assignment. Deactivating it must disable login (403 on next login
 *      attempt, matching auth.ts's SALON_EMPLOYEE branch), and
 *      reactivating it must restore login -- exercised with fresh browser
 *      contexts at each checkpoint, never an already-authenticated page.
 *      Reactivation (Task #5C) is driven entirely through the owner UI's
 *      inactive-employees section and its "Reaktiviraj" button -- no direct
 *      API call -- since a single-salon owner has no per-location checkbox
 *      to use (that control only renders for owners with >= 2 locations).
 *   3. Cross-tenant scenario: a second, unrelated owner cannot deactivate,
 *      reactivate, or otherwise read another owner's employee assignment
 *      through the real, authenticated UI/API -- verified against actual
 *      DB state, not merely HTTP status.
 *
 * Note on scenario 3's scope: the product's data model does not allow a
 * single employee to hold assignments at salons owned by two different
 * owners (every assignment write is gated by common ownership -- see
 * employeeAndOwnedLocation in marketplace.ts). Fabricating such a row
 * directly in the database would require bypassing that exact invariant,
 * which the Task #5B brief explicitly forbids ("do not weaken
 * authorization or create test-only production bypasses"). This scenario
 * instead verifies the equivalent, reachable adversarial case: a foreign
 * owner attempting to act on an employee/assignment they do not own.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeesTable,
  salonsTable,
  servicesTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(response, `sign-in for ${email} must succeed`).toBeOK();
}

function employeeCard(page: Page, employeeName: string) {
  return page.locator("div.overflow-hidden", { has: page.getByRole("heading", { name: employeeName, exact: true }) });
}

// Task #5C added a dedicated inactive-employees section (owner/employees.tsx)
// alongside the active staff grid, so a bare employeeCard() lookup can now
// match either one. These two scope to exactly the section that matters for
// a given assertion instead of "somewhere on the page."
function activeEmployeeCard(page: Page, employeeName: string) {
  return page.getByTestId("active-employees-grid").locator("div.overflow-hidden", { has: page.getByRole("heading", { name: employeeName, exact: true }) });
}
function inactiveEmployeeCard(page: Page, employeeName: string) {
  return page.getByTestId("inactive-employees-section").locator("div.overflow-hidden", { has: page.getByRole("heading", { name: employeeName, exact: true }) });
}

/**
 * The location switcher does a full `window.location.assign` reload
 * (business-navbar.tsx), so waiting on the URL alone races the SPA's own
 * post-mount data fetch. Wait for the actual GET /api/salon/employees the
 * reloaded owner/employees.tsx issues instead -- the real observable state
 * the assertions that follow depend on.
 */
async function switchActiveSalonOnEmployeesPage(page: Page, salonId: string): Promise<void> {
  const switchResponse = page.waitForResponse((response) =>
    response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/salon/active-salon");
  const employeesResponse = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname === "/api/salon/employees");
  await page.getByRole("navigation").getByLabel("Aktivna lokacija").selectOption(salonId);
  expect((await switchResponse).status()).toBe(200);
  expect((await employeesResponse).status()).toBe(200);
}

// ---------------------------------------------------------------------------
// Scenario 1: primary multi-location deactivation/reactivation
// ---------------------------------------------------------------------------

type PrimaryFixture = {
  marker: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  employeeEmail: string;
  employeePassword: string;
  employeeUserId: string;
  employeeId: string;
  employeeName: string;
  salonAId: string;
  salonAName: string;
  salonBId: string;
  salonBName: string;
};

async function createPrimaryFixture(): Promise<PrimaryFixture> {
  const marker = randomUUID();
  const ownerEmail = `browser-dea-owner-${marker}@example.test`;
  const ownerPassword = "browser-dea-owner-password";
  const employeeEmail = `browser-dea-employee-${marker}@example.test`;
  const employeePassword = "browser-dea-employee-password";
  const employeeName = `Browser Zaposleni ${marker}`;
  const salonAName = `Browser Salon A ${marker}`;
  const salonBName = `Browser Salon B ${marker}`;
  let ownerId: string | undefined;
  let employeeUserId: string | undefined;
  let salonAId: string | undefined;
  let salonBId: string | undefined;

  try {
    const [owner, employeeUser] = await db.insert(usersTable).values([
      { firstName: "Browser", lastName: "Vlasnik", email: ownerEmail, passwordHash: await hashPassword(ownerPassword), passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Browser", lastName: "Zaposleni", email: employeeEmail, passwordHash: await hashPassword(employeePassword), passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
    ]).returning({ id: usersTable.id });
    if (!owner || !employeeUser) throw new Error("Primary fixture could not create its users.");
    ownerId = owner.id;
    employeeUserId = employeeUser.id;

    const [salonA, salonB] = await db.insert(salonsTable).values([
      { ownerId: owner.id, name: salonAName, slug: `browser-dea-a-${marker}`, city: "Beograd", municipality: "Vračar", address: "Test 401", phone: "+381110000401", email: `browser-dea-a-${marker}@example.test`, shortDescription: "Salon A.", description: "Prva lokacija za E2E proveru deaktivacije zaposlenog.", imageUrl: "/test-browser-dea.jpg" },
      { ownerId: owner.id, name: salonBName, slug: `browser-dea-b-${marker}`, city: "Novi Sad", municipality: "Centar", address: "Test 402", phone: "+381110000402", email: `browser-dea-b-${marker}@example.test`, shortDescription: "Salon B.", description: "Druga lokacija za E2E proveru deaktivacije zaposlenog.", imageUrl: "/test-browser-dea.jpg" },
    ]).returning({ id: salonsTable.id });
    if (!salonA || !salonB) throw new Error("Primary fixture could not create both salons.");
    salonAId = salonA.id;
    salonBId = salonB.id;

    const [employee] = await db.insert(employeesTable).values({
      salonId: salonA.id, userId: employeeUser.id, name: employeeName, role: "Terapeut", bio: "", avatarUrl: "/test-browser-dea.jpg", email: employeeEmail,
    }).returning({ id: employeesTable.id });
    if (!employee) throw new Error("Primary fixture could not create its employee.");

    await db.insert(employeeLocationAssignmentsTable).values([
      { employeeId: employee.id, salonId: salonA.id, active: true, isDefault: true },
      { employeeId: employee.id, salonId: salonB.id, active: true, isDefault: false },
    ]);
    await db.update(usersTable).set({ activeSalonId: salonA.id }).where(eq(usersTable.id, owner.id));

    return {
      marker, ownerEmail, ownerPassword, ownerId: owner.id,
      employeeEmail, employeePassword, employeeUserId: employeeUser.id, employeeId: employee.id, employeeName,
      salonAId: salonA.id, salonAName, salonBId: salonB.id, salonBName,
    };
  } catch (error) {
    if (salonAId) await db.delete(salonsTable).where(eq(salonsTable.id, salonAId));
    if (salonBId) await db.delete(salonsTable).where(eq(salonsTable.id, salonBId));
    if (employeeUserId) await db.delete(usersTable).where(eq(usersTable.id, employeeUserId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpPrimaryFixture(fixture: PrimaryFixture): Promise<void> {
  await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, [fixture.ownerId, fixture.employeeUserId]));
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, [fixture.ownerId, fixture.employeeUserId]));
  await db.delete(salonsTable).where(inArray(salonsTable.id, [fixture.salonAId, fixture.salonBId]));
  await db.delete(usersTable).where(inArray(usersTable.id, [fixture.ownerId, fixture.employeeUserId]));
}

test("owner deactivates and reactivates an employee scoped to a single salon while the sibling location and login stay intact", async ({ page, browser }) => {
  // Generous ceiling: this scenario drives ~6 full window.location.assign
  // reloads through the Vite dev server (business-navbar.tsx's location
  // switcher never does a client-side transition), which can be slow under
  // constrained CI/sandbox CPU -- not a fixed sleep, still driven by actual
  // page-load/network-response waits throughout.
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await createPrimaryFixture();

  try {
    // --- Step 1: baseline -----------------------------------------------
    await signIn(page, fixture.ownerEmail, fixture.ownerPassword);
    await page.goto("/vlasnik/zaposleni");
    await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();
    await expect(activeEmployeeCard(page, fixture.employeeName).getByText("Nalog aktivan")).toBeVisible();

    // Switch to Salon B via the real location switcher and confirm the
    // employee is visible there too (baseline: active in both locations).
    await switchActiveSalonOnEmployeesPage(page, fixture.salonBId);
    await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();

    await switchActiveSalonOnEmployeesPage(page, fixture.salonAId);
    await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();

    // Baseline employee-side access: both locations available before any change.
    {
      const employeeContext = await browser.newContext();
      const employeePage = await employeeContext.newPage();
      await signIn(employeePage, fixture.employeeEmail, fixture.employeePassword);
      const locationsResponse = await employeePage.request.get("/api/employee/locations");
      expect(locationsResponse.ok()).toBe(true);
      const locationsBody = await locationsResponse.json() as { locations: { salonId: string }[] };
      expect(locationsBody.locations.map((location) => location.salonId).sort())
        .toEqual([fixture.salonAId, fixture.salonBId].sort());
      await employeeContext.close();
    }

    // --- Step 2: deactivate Salon A through the real owner UI ------------
    const previewResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/deactivation-preview`);
    await activeEmployeeCard(page, fixture.employeeName).getByRole("button", { name: `Deaktiviraj ${fixture.employeeName}` }).click();
    expect((await previewResponse).status()).toBe(200);

    const confirmDialog = page.getByRole("dialog", { name: "Deaktivirati zaposlenog?" });
    await expect(confirmDialog).toBeVisible();
    // Task #5's frontend fix: this employee still has an active assignment
    // at Salon B, so the dialog must NOT warn about the login/account being
    // disabled -- it must say the employee stays active elsewhere instead.
    await expect(confirmDialog.getByText("Ovo je poslednja aktivna lokacija")).toHaveCount(0);
    await expect(confirmDialog.getByText("Zaposleni ostaje aktivan i prijavljen na svojim ostalim lokacijama")).toBeVisible();

    const deactivateResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/deactivate`);
    await confirmDialog.getByRole("button", { name: "Da, deaktiviraj" }).click();
    const deactivateBody = await (await deactivateResponse).json() as { loginAccountDeactivated: boolean };
    expect(deactivateBody.loginAccountDeactivated).toBe(false);
    await expect(confirmDialog).toBeHidden();

    // UI must reflect the employee as removed from Salon A's active staff --
    // but still discoverable (Task #5C) in the inactive section there, not
    // vanished without a trace, with the same reactivation control a
    // single-salon owner would see.
    await expect(activeEmployeeCard(page, fixture.employeeName)).toHaveCount(0);
    await expect(inactiveEmployeeCard(page, fixture.employeeName)).toBeVisible();
    await expect(inactiveEmployeeCard(page, fixture.employeeName).getByRole("button", { name: `Reaktiviraj ${fixture.employeeName}` })).toBeVisible();

    // --- Step 4a: scheduling exclusion at Salon A -------------------------
    {
      const employeesListResponse = page.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === "/api/salon/employees");
      await page.goto("/vlasnik/kalendar");
      await employeesListResponse;
      await page.getByTestId("calendar-new-appointment").click();
      const bookingDialog = page.getByRole("dialog", { name: "Zakazivanje" });
      await expect(bookingDialog).toBeVisible();
      await expect(bookingDialog.locator("select").nth(1).locator(`option[value="${fixture.employeeId}"]`))
        .toHaveCount(0, { timeout: 10_000 });
      await page.keyboard.press("Escape");
    }

    // Salon B must remain fully untouched: still visible, still active.
    {
      const employeesListResponse = page.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === "/api/salon/employees");
      await page.goto("/vlasnik/zaposleni");
      await employeesListResponse;
    }
    await switchActiveSalonOnEmployeesPage(page, fixture.salonBId);
    await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();
    await expect(activeEmployeeCard(page, fixture.employeeName).getByText("Nalog aktivan")).toBeVisible();

    // --- Step 4b: scheduling still offers the employee at Salon B --------
    {
      const employeesListResponse = page.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === "/api/salon/employees");
      await page.goto("/vlasnik/kalendar");
      await employeesListResponse;
      await page.getByTestId("calendar-new-appointment").click();
      const bookingDialog = page.getByRole("dialog", { name: "Zakazivanje" });
      await expect(bookingDialog).toBeVisible();
      await expect(bookingDialog.locator("select").nth(1).locator(`option[value="${fixture.employeeId}"]`))
        .toHaveCount(1, { timeout: 10_000 });
      await page.keyboard.press("Escape");
    }

    // --- Step 3: fresh-session login verification -------------------------
    {
      const employeeContext = await browser.newContext();
      const employeePage = await employeeContext.newPage();
      await signIn(employeePage, fixture.employeeEmail, fixture.employeePassword);
      const locationsResponse = await employeePage.request.get("/api/employee/locations");
      expect(locationsResponse.ok()).toBe(true);
      const locationsBody = await locationsResponse.json() as { activeSalonId: string; locations: { salonId: string }[] };
      // Salon A must no longer appear at all; the portal must have fallen
      // back to Salon B (resolveActiveEmployeeSalon's deterministic fallback).
      expect(locationsBody.locations.map((location) => location.salonId)).toEqual([fixture.salonBId]);
      expect(locationsBody.activeSalonId).toBe(fixture.salonBId);
      await employeeContext.close();
    }

    // --- Step 5: reactivate Salon A through the authorized owner flow ----
    // The employee card is only visible where they are active, so reactivate
    // A from the Salon B view via the per-location checkbox (this is the
    // exact code path Task #5 relaxed employeeAndOwnedLocation for).
    const assignmentsResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/locations`);
    await page.goto("/vlasnik/zaposleni");
    await assignmentsResponse;
    const card = activeEmployeeCard(page, fixture.employeeName);
    const salonACheckbox = card.getByRole("checkbox", { name: `${fixture.salonAName} aktivna lokacija` });
    await expect(salonACheckbox).not.toBeChecked();
    const reactivateResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/locations/${fixture.salonAId}`);
    await salonACheckbox.click();
    expect((await reactivateResponse).status()).toBe(200);
    await expect(salonACheckbox).toBeChecked();

    // Salon B must remain unchanged by the reactivation.
    const salonBCheckbox = card.getByRole("checkbox", { name: `${fixture.salonBName} aktivna lokacija` });
    await expect(salonBCheckbox).toBeChecked();

    // Employee account must be active again, and Salon A must offer them
    // as active staff once more.
    await switchActiveSalonOnEmployeesPage(page, fixture.salonAId);
    await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();
    await expect(activeEmployeeCard(page, fixture.employeeName).getByText("Nalog aktivan")).toBeVisible();

    {
      const employeeContext = await browser.newContext();
      const employeePage = await employeeContext.newPage();
      await signIn(employeePage, fixture.employeeEmail, fixture.employeePassword);
      const locationsResponse = await employeePage.request.get("/api/employee/locations");
      expect(locationsResponse.ok()).toBe(true);
      const locationsBody = await locationsResponse.json() as { locations: { salonId: string }[] };
      expect(locationsBody.locations.map((location) => location.salonId).sort())
        .toEqual([fixture.salonAId, fixture.salonBId].sort());
      await employeeContext.close();
    }

    // --- Regression: repeated deactivate -> reactivate -> deactivate stays
    // deterministic, entirely through the UI, both times. -------------------
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const previewAgain = page.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/deactivation-preview`);
      await activeEmployeeCard(page, fixture.employeeName).getByRole("button", { name: `Deaktiviraj ${fixture.employeeName}` }).click();
      await previewAgain;
      const dialogAgain = page.getByRole("dialog", { name: "Deaktivirati zaposlenog?" });
      const deactivateAgain = page.waitForResponse((response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/deactivate`);
      await dialogAgain.getByRole("button", { name: "Da, deaktiviraj" }).click();
      expect((await deactivateAgain).status()).toBe(200);
      await expect(activeEmployeeCard(page, fixture.employeeName)).toHaveCount(0);
      await expect(inactiveEmployeeCard(page, fixture.employeeName)).toBeVisible();

      const reactivateAgain = page.waitForResponse((response) =>
        response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/locations/${fixture.salonAId}`);
      await inactiveEmployeeCard(page, fixture.employeeName).getByRole("button", { name: `Reaktiviraj ${fixture.employeeName}` }).click();
      expect((await reactivateAgain).status()).toBe(200);
      await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();
      await expect(inactiveEmployeeCard(page, fixture.employeeName)).toHaveCount(0);
    }
  } finally {
    await cleanUpPrimaryFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// Scenario 2: final-assignment lifecycle
// ---------------------------------------------------------------------------

type FinalAssignmentFixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  employeeEmail: string;
  employeePassword: string;
  employeeUserId: string;
  employeeId: string;
  employeeName: string;
  salonId: string;
  appointmentId: string;
};

async function createFinalAssignmentFixture(): Promise<FinalAssignmentFixture> {
  const marker = randomUUID();
  const ownerEmail = `browser-dea-final-owner-${marker}@example.test`;
  const ownerPassword = "browser-dea-final-owner-password";
  const employeeEmail = `browser-dea-final-employee-${marker}@example.test`;
  const employeePassword = "browser-dea-final-employee-password";
  const employeeName = `Browser Poslednji ${marker}`;
  let ownerId: string | undefined;
  let employeeUserId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner, employeeUser] = await db.insert(usersTable).values([
      { firstName: "Browser", lastName: "Vlasnik", email: ownerEmail, passwordHash: await hashPassword(ownerPassword), passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Browser", lastName: "Poslednji", email: employeeEmail, passwordHash: await hashPassword(employeePassword), passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
    ]).returning({ id: usersTable.id });
    if (!owner || !employeeUser) throw new Error("Final-assignment fixture could not create its users.");
    ownerId = owner.id;
    employeeUserId = employeeUser.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id, name: `Browser Salon Poslednji ${marker}`, slug: `browser-dea-final-${marker}`,
      city: "Beograd", municipality: "Vračar", address: "Test 403", phone: "+381110000403",
      email: `browser-dea-final-${marker}@example.test`, shortDescription: "Salon.", description: "Salon za E2E proveru poslednje dodele.", imageUrl: "/test-browser-dea.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Final-assignment fixture could not create its salon.");
    salonId = salon.id;

    const [employee] = await db.insert(employeesTable).values({
      salonId: salon.id, userId: employeeUser.id, name: employeeName, role: "Terapeut", bio: "", avatarUrl: "", email: employeeEmail,
    }).returning({ id: employeesTable.id });
    if (!employee) throw new Error("Final-assignment fixture could not create its employee.");

    await db.insert(employeeLocationAssignmentsTable).values({
      employeeId: employee.id, salonId: salon.id, active: true, isDefault: true,
    });
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    // A past, completed appointment: must survive deactivation untouched --
    // this needs a service, so create the minimum required row for it.
    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id, categoryName: "Test", name: `Browser usluga ${marker}`, description: "Test.", durationMinutes: 30, price: 1500, imageUrl: "/test-browser-dea.jpg",
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Final-assignment fixture could not create its service.");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [appointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id, employeeId: employee.id, serviceId: service.id,
      date: yesterday, startTime: "10:00", endTime: "10:30", durationMinutes: 30, price: 1500, status: "completed",
    }).returning({ id: appointmentsTable.id });
    if (!appointment) throw new Error("Final-assignment fixture could not create its appointment.");

    return {
      ownerEmail, ownerPassword, ownerId: owner.id,
      employeeEmail, employeePassword, employeeUserId: employeeUser.id, employeeId: employee.id, employeeName,
      salonId: salon.id, appointmentId: appointment.id,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (employeeUserId) await db.delete(usersTable).where(eq(usersTable.id, employeeUserId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFinalAssignmentFixture(fixture: FinalAssignmentFixture): Promise<void> {
  await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, [fixture.ownerId, fixture.employeeUserId]));
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, [fixture.ownerId, fixture.employeeUserId]));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(inArray(usersTable.id, [fixture.ownerId, fixture.employeeUserId]));
}

test("deactivating an employee's last active assignment disables login and reactivation restores it", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await createFinalAssignmentFixture();

  try {
    // A fresh session established BEFORE deactivation must be invalidated by it.
    const preDeactivationContext = await browser.newContext();
    const preDeactivationPage = await preDeactivationContext.newPage();
    await signIn(preDeactivationPage, fixture.employeeEmail, fixture.employeePassword);

    await signIn(page, fixture.ownerEmail, fixture.ownerPassword);
    await page.goto("/vlasnik/zaposleni");
    const card = activeEmployeeCard(page, fixture.employeeName);
    await expect(card).toBeVisible();
    await expect(card.getByText("Nalog aktivan")).toBeVisible();

    const previewResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/deactivation-preview`);
    await card.getByRole("button", { name: `Deaktiviraj ${fixture.employeeName}` }).click();
    expect((await previewResponse).status()).toBe(200);

    const confirmDialog = page.getByRole("dialog", { name: "Deaktivirati zaposlenog?" });
    await expect(confirmDialog).toBeVisible();
    // This IS the employee's only assignment, so the dialog must warn
    // explicitly that the login/account is about to be disabled.
    await expect(confirmDialog.getByText("Ovo je poslednja aktivna lokacija ovog zaposlenog")).toBeVisible();

    const deactivateResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/deactivate`);
    await confirmDialog.getByRole("button", { name: "Da, deaktiviraj" }).click();
    const deactivateBody = await (await deactivateResponse).json() as { loginAccountDeactivated: boolean };
    expect(deactivateBody.loginAccountDeactivated).toBe(true);
    await expect(activeEmployeeCard(page, fixture.employeeName)).toHaveCount(0);

    // The session established before deactivation must now be dead.
    const meResponse = await preDeactivationPage.request.get("/api/auth/me");
    expect(meResponse.ok()).toBe(true);
    expect((await meResponse.json() as { user: unknown }).user).toBeNull();
    await preDeactivationContext.close();

    // A brand-new login attempt must be rejected with the account-disabled error.
    {
      const freshContext = await browser.newContext();
      const freshPage = await freshContext.newPage();
      const loginResponse = await freshPage.request.post("/api/auth/login", {
        data: { email: fixture.employeeEmail, password: fixture.employeePassword },
      });
      expect(loginResponse.status()).toBe(403);
      const loginBody = await loginResponse.json() as { error: string };
      expect(loginBody.error).toContain("deaktiviran");
      await freshContext.close();
    }

    // Historical data must survive untouched.
    const [appointmentRow] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, fixture.appointmentId));
    expect(appointmentRow?.employeeId).toBe(fixture.employeeId);
    expect(appointmentRow?.status).toBe("completed");

    // --- Step 7: the owner can still locate the inactive employee -----------
    // A single-salon owner has no "other location" to switch to, so the
    // per-location checkbox never renders for them. Task #5C's fix:
    // owner/employees.tsx now fetches includeInactive=true and renders a
    // dedicated inactive section instead of dropping the employee entirely.
    const inactiveSection = page.getByTestId("inactive-employees-section");
    await expect(inactiveSection).toBeVisible();
    const inactiveCard = inactiveEmployeeCard(page, fixture.employeeName);
    await expect(inactiveCard).toBeVisible();
    await expect(inactiveCard.getByText("Neaktivan na ovoj lokaciji")).toBeVisible();

    // --- Step 8: reactivate entirely through the real owner UI --------------
    // No direct API call from the test -- clicking this button is the ONLY
    // action that reactivates the assignment. It calls the exact same
    // PUT .../locations/:salonId operation the multi-location checkbox uses
    // (see reactivateEmployee in owner/employees.tsx); the backend's
    // syncEmployeeAccountState then derives employees.active/users.active.
    const reactivateResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/salon/employees/${fixture.employeeId}/locations/${fixture.salonId}`);
    await inactiveCard.getByRole("button", { name: `Reaktiviraj ${fixture.employeeName}` }).click();
    expect((await reactivateResponse).status()).toBe(200);

    await expect(inactiveSection).toHaveCount(0);
    await expect(activeEmployeeCard(page, fixture.employeeName)).toBeVisible();
    await expect(activeEmployeeCard(page, fixture.employeeName).getByText("Nalog aktivan")).toBeVisible();

    // --- Step 11b: back on the scheduling picker too -------------------------
    {
      const employeesListResponse = page.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === "/api/salon/employees");
      await page.goto("/vlasnik/kalendar");
      await employeesListResponse;
      await page.getByTestId("calendar-new-appointment").click();
      const bookingDialog = page.getByRole("dialog", { name: "Zakazivanje" });
      await expect(bookingDialog).toBeVisible();
      await expect(bookingDialog.locator("select").nth(1).locator(`option[value="${fixture.employeeId}"]`))
        .toHaveCount(1, { timeout: 10_000 });
      await page.keyboard.press("Escape");
    }

    // --- Step 10: fresh login succeeds again ---------------------------------
    {
      const freshContext = await browser.newContext();
      const freshPage = await freshContext.newPage();
      await signIn(freshPage, fixture.employeeEmail, fixture.employeePassword);
      const meResponse2 = await freshPage.request.get("/api/auth/me");
      const meBody = await meResponse2.json() as { user: { email: string } | null };
      expect(meBody.user?.email).toBe(fixture.employeeEmail);
      await freshContext.close();
    }

    // --- Step 12: historical appointment still intact after reactivation ----
    const [appointmentRowAfter] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, fixture.appointmentId));
    expect(appointmentRowAfter?.employeeId).toBe(fixture.employeeId);
    expect(appointmentRowAfter?.status).toBe("completed");
  } finally {
    await cleanUpFinalAssignmentFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// Scenario 3: cross-tenant / adversarial verification
// ---------------------------------------------------------------------------

type ForeignOwnerFixture = {
  foreignOwnerEmail: string;
  foreignOwnerPassword: string;
  foreignOwnerId: string;
  foreignSalonId: string;
};

async function createForeignOwnerFixture(): Promise<ForeignOwnerFixture> {
  const marker = randomUUID();
  const foreignOwnerEmail = `browser-dea-foreign-owner-${marker}@example.test`;
  const foreignOwnerPassword = "browser-dea-foreign-owner-password";
  const [foreignOwner] = await db.insert(usersTable).values({
    firstName: "Browser", lastName: "Tuđi Vlasnik", email: foreignOwnerEmail,
    passwordHash: await hashPassword(foreignOwnerPassword), passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning({ id: usersTable.id });
  if (!foreignOwner) throw new Error("Foreign-owner fixture could not create its owner.");
  try {
    const [foreignSalon] = await db.insert(salonsTable).values({
      ownerId: foreignOwner.id, name: `Browser Tuđi Salon ${marker}`, slug: `browser-dea-foreign-${marker}`,
      city: "Niš", municipality: "Medijana", address: "Test 404", phone: "+381110000404",
      email: `browser-dea-foreign-${marker}@example.test`, shortDescription: "Tuđi salon.", description: "Salon nepovezanog vlasnika za proveru izolacije.", imageUrl: "/test-browser-dea.jpg",
    }).returning({ id: salonsTable.id });
    if (!foreignSalon) throw new Error("Foreign-owner fixture could not create its salon.");
    await db.update(usersTable).set({ activeSalonId: foreignSalon.id }).where(eq(usersTable.id, foreignOwner.id));
    return { foreignOwnerEmail, foreignOwnerPassword, foreignOwnerId: foreignOwner.id, foreignSalonId: foreignSalon.id };
  } catch (error) {
    await db.delete(usersTable).where(eq(usersTable.id, foreignOwner.id));
    throw error;
  }
}

async function cleanUpForeignOwnerFixture(fixture: ForeignOwnerFixture): Promise<void> {
  await db.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.foreignOwnerId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.foreignSalonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.foreignOwnerId));
}

test("a foreign owner cannot deactivate, reactivate, or read another owner's employee assignment", async ({ page }) => {
  test.setTimeout(60_000);
  const employeeFixture = await createPrimaryFixture();
  const foreignFixture = await createForeignOwnerFixture();

  try {
    await signIn(page, foreignFixture.foreignOwnerEmail, foreignFixture.foreignOwnerPassword);

    const deactivateAttempt = await page.request.post(`/api/salon/employees/${employeeFixture.employeeId}/deactivate`);
    expect(deactivateAttempt.status()).toBe(404);

    const previewAttempt = await page.request.get(`/api/salon/employees/${employeeFixture.employeeId}/deactivation-preview`);
    expect(previewAttempt.status()).toBe(404);

    const reactivateOwnedAttempt = await page.request.put(
      `/api/salon/employees/${employeeFixture.employeeId}/locations/${employeeFixture.salonAId}`,
      { data: { active: true } },
    );
    expect(reactivateOwnedAttempt.status()).toBe(403);

    const reactivateForeignSalonAttempt = await page.request.put(
      `/api/salon/employees/${employeeFixture.employeeId}/locations/${foreignFixture.foreignSalonId}`,
      { data: { active: true } },
    );
    expect(reactivateForeignSalonAttempt.status()).toBe(403);

    const staffListResponse = await page.request.get("/api/salon/employees");
    expect(staffListResponse.ok()).toBe(true);
    const staffList = await staffListResponse.json() as { id: string }[];
    expect(staffList.some((entry) => entry.id === employeeFixture.employeeId)).toBe(false);

    // Verify actual DB state, not just HTTP status: nothing moved.
    const assignments = await db.select().from(employeeLocationAssignmentsTable)
      .where(eq(employeeLocationAssignmentsTable.employeeId, employeeFixture.employeeId));
    const bySalon = new Map(assignments.map((assignment) => [assignment.salonId, assignment.active]));
    expect(bySalon.get(employeeFixture.salonAId)).toBe(true);
    expect(bySalon.get(employeeFixture.salonBId)).toBe(true);
    const foreignSalonAssignment = assignments.find((assignment) => assignment.salonId === foreignFixture.foreignSalonId);
    expect(foreignSalonAssignment).toBeUndefined();
  } finally {
    await cleanUpForeignOwnerFixture(foreignFixture);
    await cleanUpPrimaryFixture(employeeFixture);
  }
});
