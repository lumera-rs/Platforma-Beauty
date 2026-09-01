import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeLocationSchedulesTable,
  employeeServicesTable,
  employeesTable,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

type OwnerManagementFixture = {
  marker: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  serviceId: string;
  serviceName: string;
  employeeId: string;
  employeeName: string;
};

function localDateKey(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createOwnerManagementFixture(): Promise<OwnerManagementFixture> {
  const marker = randomUUID();
  const ownerEmail = `browser-owner-management-${marker}@example.test`;
  const ownerPassword = "browser-owner-management-password";
  const serviceName = `Browser usluga ${marker}`;
  const employeeName = `Browser terapeut ${marker}`;
  const passwordHash = await hashPassword(ownerPassword);

  return db.transaction(async (tx) => {
    const [owner] = await tx.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Owner-management browser fixture could not create its owner.");

    const [salon] = await tx.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon ${marker}`,
      slug: `browser-owner-management-${marker}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 401",
      phone: "+381110000401",
      email: `browser-owner-management-salon-${marker}@example.test`,
      shortDescription: "Marker-owned salon za browser regresiju vlasnika.",
      description: "Izolovan salon za proveru termina, zaposlenih i rasporeda.",
      imageUrl: "/test-browser-owner-management.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Owner-management browser fixture could not create its salon.");

    const [service] = await tx.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: serviceName,
      description: "Marker-owned usluga za browser regresiju vlasnika.",
      durationMinutes: 30,
      price: 2100,
      imageUrl: "/test-browser-owner-management.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Owner-management browser fixture could not create its service.");

    const [employee] = await tx.insert(employeesTable).values({
      salonId: salon.id,
      name: employeeName,
      role: "Terapeut",
      bio: "Marker-owned zaposleni za zakazivanje termina.",
      avatarUrl: "",
      email: `browser-existing-employee-${marker}@example.test`,
      specialties: ["Test tretman"],
    }).returning({ id: employeesTable.id });
    if (!employee) throw new Error("Owner-management browser fixture could not create its employee.");

    await tx.insert(employeeLocationAssignmentsTable).values({
      employeeId: employee.id,
      salonId: salon.id,
      active: true,
      isDefault: true,
    });
    await tx.insert(employeeServicesTable).values({ employeeId: employee.id, serviceId: service.id });
    await tx.insert(employeeLocationSchedulesTable).values(
      Array.from({ length: 7 }, (_, index) => ({
        employeeId: employee.id,
        salonId: salon.id,
        weekday: index + 1,
        startTime: "09:00",
        endTime: "17:00",
      })),
    );
    await tx.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    return {
      marker,
      ownerEmail,
      ownerPassword,
      ownerId: owner.id,
      salonId: salon.id,
      serviceId: service.id,
      serviceName,
      employeeId: employee.id,
      employeeName,
    };
  });
}

async function cleanUpOwnerManagementFixture(fixture: OwnerManagementFixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.ownerId));
    await tx.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
  });
}

async function signInAsFixtureOwner(page: Page, fixture: OwnerManagementFixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated owner fixture must be able to sign in.").toBeOK();
}

function fieldInput(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("..").locator("input");
}

test("SALON_OWNER creates and edits an appointment through the calendar UI", async ({ page }) => {
  const fixture = await createOwnerManagementFixture();
  const appointmentDate = localDateKey(2);
  const guestFirstName = "Browser";
  const guestLastName = `Gost ${fixture.marker}`;
  const guestPhone = `+3816${fixture.marker.replaceAll("-", "").slice(0, 8).split("").map((character) => Number.parseInt(character, 16) % 10).join("")}`;
  const initialNote = `Početna napomena ${fixture.marker}`;
  const editedNote = `Izmenjena napomena ${fixture.marker}`;

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/kalendar");
    await page.getByRole("button", { name: "Prekosutra", exact: true }).click();
    await page.getByTestId("calendar-new-appointment").click();

    const createDialog = page.getByRole("dialog", { name: "Zakazivanje" });
    await expect(createDialog).toBeVisible();
    await createDialog.locator("select").nth(0).selectOption(fixture.serviceId);
    await createDialog.locator("select").nth(1).selectOption(fixture.employeeId);
    const slot = createDialog.getByTestId(`owner-appointment-availability-slot-${appointmentDate}-10:00-${fixture.employeeId}`);
    await expect(slot).toBeVisible();
    await slot.click();
    await fieldInput(createDialog, "Ime").fill(guestFirstName);
    await fieldInput(createDialog, "Prezime").fill(guestLastName);
    await fieldInput(createDialog, "Telefon").fill(guestPhone);
    await createDialog.locator("textarea").fill(initialNote);

    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/salon/appointments",
    );
    await createDialog.getByRole("button", { name: "Sačuvaj termin", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status(), "The UI appointment create must succeed.").toBe(201);
    const created = await createResponse.json() as { id: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(createDialog).toBeHidden();

    const [persisted] = await db.select({
      id: appointmentsTable.id,
      salonId: appointmentsTable.salonId,
      serviceId: appointmentsTable.serviceId,
      employeeId: appointmentsTable.employeeId,
      date: appointmentsTable.date,
      startTime: appointmentsTable.startTime,
      endTime: appointmentsTable.endTime,
      durationMinutes: appointmentsTable.durationMinutes,
      price: appointmentsTable.price,
      notes: appointmentsTable.notes,
      status: appointmentsTable.status,
      salonCustomerId: appointmentsTable.salonCustomerId,
    }).from(appointmentsTable).where(eq(appointmentsTable.id, created.id));
    expect(persisted).toEqual({
      id: created.id,
      salonId: fixture.salonId,
      serviceId: fixture.serviceId,
      employeeId: fixture.employeeId,
      date: appointmentDate,
      startTime: "10:00",
      endTime: "10:30",
      durationMinutes: 30,
      price: 2100,
      notes: initialNote,
      status: "confirmed",
      salonCustomerId: expect.any(String),
    });
    const [customer] = await db.select({
      salonId: salonCustomersTable.salonId,
      firstName: salonCustomersTable.firstName,
      lastName: salonCustomersTable.lastName,
      phone: salonCustomersTable.phone,
    }).from(salonCustomersTable).where(eq(salonCustomersTable.id, persisted!.salonCustomerId!));
    expect(customer).toEqual({ salonId: fixture.salonId, firstName: guestFirstName, lastName: guestLastName, phone: guestPhone });

    await page.getByTestId("tab-list").click();
    let appointmentRow = page.getByTestId(`list-appointment-${created.id}`);
    await expect(appointmentRow).toContainText(initialNote);

    await page.reload();
    await page.getByRole("button", { name: "Prekosutra", exact: true }).click();
    await page.getByTestId("tab-list").click();
    appointmentRow = page.getByTestId(`list-appointment-${created.id}`);
    await expect(appointmentRow).toContainText(initialNote);
    await appointmentRow.getByRole("button", { name: `Izmeni termin za ${guestFirstName} ${guestLastName}`, exact: true }).click();

    const editDialog = page.getByRole("dialog", { name: "Izmeni termin" });
    await expect(editDialog.locator("textarea")).toHaveValue(initialNote);
    await editDialog.locator("textarea").fill(editedNote);
    const updateResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/salon/appointments/${created.id}`,
    );
    await editDialog.getByRole("button", { name: "Sačuvaj izmene", exact: true }).click();
    expect((await updateResponsePromise).status(), "The UI appointment edit must succeed.").toBe(200);
    await expect(editDialog).toBeHidden();

    const [updated] = await db.select({
      id: appointmentsTable.id,
      employeeId: appointmentsTable.employeeId,
      notes: appointmentsTable.notes,
    }).from(appointmentsTable).where(eq(appointmentsTable.id, created.id));
    expect(updated).toEqual({ id: created.id, employeeId: fixture.employeeId, notes: editedNote });

    await page.reload();
    await page.getByRole("button", { name: "Prekosutra", exact: true }).click();
    await page.getByTestId("tab-list").click();
    await expect(page.getByTestId(`list-appointment-${created.id}`)).toContainText(editedNote);
  } finally {
    await cleanUpOwnerManagementFixture(fixture);
  }
});

test("SALON_OWNER creates an employee and edits the location schedule through UI", async ({ page }) => {
  const fixture = await createOwnerManagementFixture();
  const employeeName = `Novi zaposleni ${fixture.marker}`;
  const employeeRole = "Kolorista";
  const employeeEmail = `browser-new-employee-${fixture.marker}@example.test`;
  const employeeBio = `Biografija ${fixture.marker}`;

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/zaposleni");
    await page.getByRole("button", { name: "Dodaj zaposlenog", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Novi zaposleni" });
    await fieldInput(dialog, "Ime i prezime").fill(employeeName);
    await fieldInput(dialog, "Uloga").fill(employeeRole);
    await fieldInput(dialog, "Email zaposlenog").fill(employeeEmail);
    await fieldInput(dialog, "Kratka biografija").fill(employeeBio);
    await fieldInput(dialog, "Specijalnosti (odvojite zarezom)").fill("Kolorista, Stilista");
    await dialog.locator("label").filter({ hasText: "Sme samostalno da naručuje" }).getByRole("checkbox").click();
    await dialog.locator("label").filter({ hasText: fixture.serviceName }).getByRole("checkbox").click();

    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/salon/employees",
    );
    await dialog.getByRole("button", { name: "Sačuvaj zaposlenog", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status(), "The UI employee create must succeed.").toBe(201);
    const created = await createResponse.json() as { id: string };
    await expect(dialog).toBeHidden();

    const [employee] = await db.select({
      id: employeesTable.id,
      salonId: employeesTable.salonId,
      name: employeesTable.name,
      role: employeesTable.role,
      bio: employeesTable.bio,
      avatarUrl: employeesTable.avatarUrl,
      email: employeesTable.email,
      specialties: employeesTable.specialties,
      canOrderIndependently: employeesTable.canOrderIndependently,
      active: employeesTable.active,
    }).from(employeesTable).where(eq(employeesTable.id, created.id));
    expect(employee).toEqual({
      id: created.id,
      salonId: fixture.salonId,
      name: employeeName,
      role: employeeRole,
      bio: employeeBio,
      avatarUrl: "",
      email: employeeEmail,
      specialties: ["Kolorista", "Stilista"],
      canOrderIndependently: true,
      active: true,
    });
    const assignments = await db.select({
      employeeId: employeeLocationAssignmentsTable.employeeId,
      salonId: employeeLocationAssignmentsTable.salonId,
      active: employeeLocationAssignmentsTable.active,
      isDefault: employeeLocationAssignmentsTable.isDefault,
    }).from(employeeLocationAssignmentsTable).where(eq(employeeLocationAssignmentsTable.employeeId, created.id));
    expect(assignments).toEqual([{ employeeId: created.id, salonId: fixture.salonId, active: true, isDefault: true }]);
    const serviceLinks = await db.select({
      employeeId: employeeServicesTable.employeeId,
      serviceId: employeeServicesTable.serviceId,
    }).from(employeeServicesTable).where(eq(employeeServicesTable.employeeId, created.id));
    expect(serviceLinks).toEqual([{ employeeId: created.id, serviceId: fixture.serviceId }]);

    await page.reload();
    const employeeHeading = page.getByRole("heading", { name: employeeName, exact: true });
    await expect(employeeHeading).toBeVisible();
    const employeeCard = employeeHeading.locator("..").locator("..").locator("..");
    await expect(employeeCard).toContainText(employeeRole);
    await expect(employeeCard).toContainText(fixture.serviceName);

    await page.goto("/vlasnik/radno-vreme");
    await page.locator("#schedule-employee").selectOption(created.id);
    const mondayStart = page.getByLabel("Ponedeljak početak", { exact: true });
    const mondayEnd = page.getByLabel("Ponedeljak kraj", { exact: true });
    await mondayStart.fill("10:00");
    await mondayEnd.fill("18:00");
    const scheduleResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/salon/employees/${created.id}/locations/${fixture.salonId}/schedule`,
    );
    await page.getByRole("button", { name: "Sačuvaj raspored lokacije", exact: true }).click();
    expect((await scheduleResponsePromise).status(), "The UI schedule edit must succeed.").toBe(200);

    const schedule = await db.select({
      employeeId: employeeLocationSchedulesTable.employeeId,
      salonId: employeeLocationSchedulesTable.salonId,
      weekday: employeeLocationSchedulesTable.weekday,
      startTime: employeeLocationSchedulesTable.startTime,
      endTime: employeeLocationSchedulesTable.endTime,
      breakStart: employeeLocationSchedulesTable.breakStart,
      breakEnd: employeeLocationSchedulesTable.breakEnd,
    }).from(employeeLocationSchedulesTable)
      .where(and(
        eq(employeeLocationSchedulesTable.employeeId, created.id),
        eq(employeeLocationSchedulesTable.salonId, fixture.salonId),
      ))
      .orderBy(asc(employeeLocationSchedulesTable.weekday));
    expect(schedule).toEqual([{
      employeeId: created.id,
      salonId: fixture.salonId,
      weekday: 1,
      startTime: "10:00",
      endTime: "18:00",
      breakStart: null,
      breakEnd: null,
    }]);

    await page.reload();
    await page.locator("#schedule-employee").selectOption(created.id);
    await expect(page.getByLabel("Ponedeljak početak", { exact: true })).toHaveValue("10:00");
    await expect(page.getByLabel("Ponedeljak kraj", { exact: true })).toHaveValue("18:00");
  } finally {
    await cleanUpOwnerManagementFixture(fixture);
  }
});