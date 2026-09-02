import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  db,
  employeeLocationAssignmentsTable,
  employeeLocationSchedulesTable,
  employeeServicesTable,
  employeesTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

type Fixture = {
  employeeEmail: string;
  employeePassword: string;
  employeeUserId: string;
  employeeId: string;
  ownerId: string;
  firstSalonId: string;
  secondSalonId: string;
  firstServiceId: string;
  secondServiceId: string;
  firstServiceName: string;
  secondServiceName: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const employeeEmail = `browser-employee-location-${suffix}@example.test`;
  const employeePassword = "browser-employee-location-password";
  const ownerPasswordHash = await hashPassword("browser-employee-location-owner-password");
  const employeePasswordHash = await hashPassword(employeePassword);
  const firstServiceName = `Usluga prve lokacije ${suffix}`;
  const secondServiceName = `Usluga druge lokacije ${suffix}`;
  let ownerId: string | undefined;
  let employeeUserId: string | undefined;
  let firstSalonId: string | undefined;
  let secondSalonId: string | undefined;

  try {
    const [owner, employeeUser] = await db.insert(usersTable).values([
      {
        firstName: "Browser",
        lastName: "Vlasnik",
        email: `browser-employee-location-owner-${suffix}@example.test`,
        passwordHash: ownerPasswordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Browser",
        lastName: "Zaposleni",
        email: employeeEmail,
        passwordHash: employeePasswordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
    ]).returning({ id: usersTable.id });
    if (!owner || !employeeUser) throw new Error("Employee-location fixture could not create its users.");
    ownerId = owner.id;
    employeeUserId = employeeUser.id;

    const [firstSalon, secondSalon] = await db.insert(salonsTable).values([
      {
        ownerId: owner.id,
        name: `Prva lokacija ${suffix}`,
        slug: `browser-employee-location-first-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 301",
        phone: "+381110000301",
        email: `browser-employee-location-first-${suffix}@example.test`,
        shortDescription: "Prva lokacija employee booking regresije.",
        description: "Marker-owned lokacija za browser regresiju promene lokacije zaposlenog.",
        imageUrl: "/test-browser-employee-location.jpg",
      },
      {
        ownerId: owner.id,
        name: `Druga lokacija ${suffix}`,
        slug: `browser-employee-location-second-${suffix}`,
        city: "Novi Sad",
        municipality: "Centar",
        address: "Test 302",
        phone: "+381110000302",
        email: `browser-employee-location-second-${suffix}@example.test`,
        shortDescription: "Druga lokacija employee booking regresije.",
        description: "Marker-owned lokacija za browser regresiju promene lokacije zaposlenog.",
        imageUrl: "/test-browser-employee-location.jpg",
      },
    ]).returning({ id: salonsTable.id });
    if (!firstSalon || !secondSalon) throw new Error("Employee-location fixture could not create both salons.");
    firstSalonId = firstSalon.id;
    secondSalonId = secondSalon.id;

    const [firstService, secondService] = await db.insert(servicesTable).values([
      {
        salonId: firstSalon.id,
        categoryName: "Test",
        name: firstServiceName,
        description: "Usluga dostupna samo na prvoj lokaciji.",
        durationMinutes: 30,
        price: 1300,
        imageUrl: "/test-browser-employee-location.jpg",
      },
      {
        salonId: secondSalon.id,
        categoryName: "Test",
        name: secondServiceName,
        description: "Usluga dostupna samo na drugoj lokaciji.",
        durationMinutes: 30,
        price: 2300,
        imageUrl: "/test-browser-employee-location.jpg",
      },
    ]).returning({ id: servicesTable.id });
    if (!firstService || !secondService) throw new Error("Employee-location fixture could not create both services.");

    const [employee] = await db.insert(employeesTable).values({
      salonId: firstSalon.id,
      userId: employeeUser.id,
      name: `Browser zaposleni ${suffix}`,
      role: "Terapeut",
      bio: "Zaposleni sa dve lokacije za browser regresiju.",
      avatarUrl: "/test-browser-employee-location.jpg",
      email: employeeEmail,
    }).returning({ id: employeesTable.id });
    if (!employee) throw new Error("Employee-location fixture could not create its employee.");

    await db.insert(employeeLocationAssignmentsTable).values([
      { employeeId: employee.id, salonId: firstSalon.id, active: true, isDefault: true },
      { employeeId: employee.id, salonId: secondSalon.id, active: true, isDefault: false },
    ]);
    await db.insert(employeeServicesTable).values([
      { employeeId: employee.id, serviceId: firstService.id },
      { employeeId: employee.id, serviceId: secondService.id },
    ]);
    await db.insert(employeeLocationSchedulesTable).values(
      Array.from({ length: 7 }, (_, index) => [
        { employeeId: employee.id, salonId: firstSalon.id, weekday: index + 1, startTime: "09:00", endTime: "10:00" },
        { employeeId: employee.id, salonId: secondSalon.id, weekday: index + 1, startTime: "14:00", endTime: "15:00" },
      ]).flat(),
    );
    await db.update(usersTable).set({ activeSalonId: firstSalon.id }).where(eq(usersTable.id, employeeUser.id));

    return {
      employeeEmail,
      employeePassword,
      employeeUserId: employeeUser.id,
      employeeId: employee.id,
      ownerId: owner.id,
      firstSalonId: firstSalon.id,
      secondSalonId: secondSalon.id,
      firstServiceId: firstService.id,
      secondServiceId: secondService.id,
      firstServiceName,
      secondServiceName,
    };
  } catch (error) {
    if (firstSalonId) await db.delete(salonsTable).where(eq(salonsTable.id, firstSalonId));
    if (secondSalonId) await db.delete(salonsTable).where(eq(salonsTable.id, secondSalonId));
    if (employeeUserId) await db.delete(usersTable).where(eq(usersTable.id, employeeUserId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.employeeUserId));
    await tx.delete(salonsTable).where(eq(salonsTable.id, fixture.firstSalonId));
    await tx.delete(salonsTable).where(eq(salonsTable.id, fixture.secondSalonId));
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.employeeUserId));
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
  });
}

async function signIn(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.employeeEmail, password: fixture.employeePassword },
  });
  expect(response, "The multi-location employee fixture must be able to sign in.").toBeOK();
}

async function verifyLocationSwitchClearsBooking(
  page: Page,
  fixture: Fixture,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await signIn(page, fixture);
  await page.goto("/zaposleni");

  const locationSelect = page.getByLabel("Izaberite lokaciju");
  await expect(locationSelect).toHaveValue(fixture.firstSalonId);
  const firstAvailabilityResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/employee/availability/search"
      && url.searchParams.get("serviceId") === fixture.firstServiceId;
  });
  await page.getByRole("button", { name: "Zakaži termin", exact: true }).click();

  let dialog = page.getByRole("dialog", { name: "Zakaži termin za svog klijenta" });
  await expect(dialog.getByRole("option", { name: new RegExp(fixture.firstServiceName) })).toHaveCount(1);
  await expect(dialog.getByRole("option", { name: new RegExp(fixture.secondServiceName) })).toHaveCount(0);
  expect(await (await firstAvailabilityResponse).json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ startTime: "09:00", employeeId: fixture.employeeId }),
  ]));

  const firstSlot = dialog.getByRole("button", { name: /Izaberite termin 09:00/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
  await expect(firstSlot).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Zakaži termin", exact: true })).toBeEnabled();

  const switchResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && new URL(response.url()).pathname === "/api/employee/active-location",
  );
  await locationSelect.evaluate((select, salonId) => {
    const element = select as HTMLSelectElement;
    element.value = salonId;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, fixture.secondSalonId);
  expect((await switchResponse).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(locationSelect).toHaveValue(fixture.secondSalonId);

  const secondAvailabilityResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/employee/availability/search"
      && url.searchParams.get("serviceId") === fixture.secondServiceId;
  });
  await page.getByRole("button", { name: "Zakaži termin", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Zakaži termin za svog klijenta" });
  await expect(dialog.getByRole("option", { name: new RegExp(fixture.firstServiceName) })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: new RegExp(fixture.secondServiceName) })).toHaveCount(1);
  expect(await (await secondAvailabilityResponse).json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ startTime: "14:00", employeeId: fixture.employeeId }),
  ]));
  await expect(dialog.getByRole("button", { name: /Izaberite termin 09:00/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Izaberite termin 14:00/ }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zakaži termin", exact: true })).toBeDisabled();
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`employee location switch clears the old booking on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(45_000);
    const fixture = await createFixture();
    try {
      await verifyLocationSwitchClearsBooking(page, fixture, viewport);
    } finally {
      await cleanUpFixture(fixture);
    }
  });
}