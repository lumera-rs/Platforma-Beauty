import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

type Fixture = {
  ownerId: string;
  ownerEmail: string;
  employeeUserId: string;
  employeeEmail: string;
  customerId: string;
  customerEmail: string;
  password: string;
  salonId: string;
  lateAppointmentId: string;
  noShowAppointmentId: string;
  date: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const password = "browser-appointment-status-password";
  const passwordHash = await hashPassword(password);
  const date = localDateKey();
  let ownerId: string | undefined;
  let employeeUserId: string | undefined;
  let customerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner, employeeUser, customer] = await db.insert(usersTable).values([
      {
        firstName: "Status",
        lastName: "Vlasnik",
        email: `browser-status-owner-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Status",
        lastName: "Zaposleni",
        email: `browser-status-employee-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
      {
        firstName: "Status",
        lastName: "Klijent",
        email: `browser-status-customer-${suffix}@example.test`,
        phone: `+38162${suffix.replaceAll("-", "").slice(0, 8)}`,
        phoneNormalized: `+38162${suffix.replaceAll("-", "").slice(0, 8)}`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
    ]).returning();
    if (!owner || !employeeUser || !customer) throw new Error("Appointment status fixture could not create users.");
    ownerId = owner.id;
    employeeUserId = employeeUser.id;
    customerId = customer.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Status salon ${suffix}`,
      slug: `browser-appointment-status-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 591",
      phone: "+381110000591",
      email: `browser-status-salon-${suffix}@example.test`,
      shortDescription: "Salon za regresiju prikaza statusa termina.",
      description: "Marker-owned salon za responsive booking status test.",
      imageUrl: "/test-browser-appointment-status.jpg",
      active: true,
      isVerified: true,
    }).returning();
    if (!salon) throw new Error("Appointment status fixture could not create salon.");
    salonId = salon.id;

    const [employee] = await db.insert(employeesTable).values({
      salonId: salon.id,
      userId: employeeUser.id,
      name: "Status terapeut",
      role: "Terapeut",
      bio: "Test zaposleni",
      avatarUrl: "/test-browser-appointment-status.jpg",
      email: employeeUser.email,
    }).returning();
    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: "Status tretman",
      description: "Tretman za proveru kašnjenja i nedolaska.",
      durationMinutes: 60,
      price: 2500,
      imageUrl: "/test-browser-appointment-status.jpg",
    }).returning();
    if (!employee || !service) throw new Error("Appointment status fixture could not create employee and service.");

    await db.insert(employeeLocationAssignmentsTable).values({
      employeeId: employee.id,
      salonId: salon.id,
      active: true,
      isDefault: true,
    });
    await db.insert(employeeServicesTable).values({ employeeId: employee.id, serviceId: service.id });
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, employeeUser.id));

    const [lateAppointment, noShowAppointment] = await db.insert(appointmentsTable).values([
      {
        salonId: salon.id,
        customerId: customer.id,
        employeeId: employee.id,
        serviceId: service.id,
        date,
        startTime: "10:00",
        endTime: "11:00",
        plannedDate: date,
        plannedStartTime: "10:00",
        plannedEndTime: "11:00",
        durationMinutes: 60,
        price: 2500,
        status: "confirmed",
        confirmedAt: new Date(`${date}T09:50:00`),
        arrivedAt: new Date(`${date}T10:10:00`),
        actualStartedAt: new Date(`${date}T10:15:00`),
        notes: "Opšta napomena za aktivni termin",
      },
      {
        salonId: salon.id,
        customerId: customer.id,
        employeeId: employee.id,
        serviceId: service.id,
        date,
        startTime: "09:00",
        endTime: "10:00",
        plannedDate: date,
        plannedStartTime: "09:00",
        plannedEndTime: "10:00",
        durationMinutes: 60,
        price: 2500,
        status: "no-show",
        noShowAt: new Date(`${date}T09:15:00`),
        notes: "Opšta napomena ostaje odvojena",
      },
    ]).returning();
    if (!lateAppointment || !noShowAppointment) throw new Error("Appointment status fixture could not create appointments.");

    return {
      ownerId: owner.id,
      ownerEmail: owner.email,
      employeeUserId: employeeUser.id,
      employeeEmail: employeeUser.email,
      customerId: customer.id,
      customerEmail: customer.email,
      password,
      salonId: salon.id,
      lateAppointmentId: lateAppointment.id,
      noShowAppointmentId: noShowAppointment.id,
      date,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (employeeUserId) await db.delete(usersTable).where(eq(usersTable.id, employeeUserId));
    if (customerId) await db.delete(usersTable).where(eq(usersTable.id, customerId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.ownerId));
    await tx.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.employeeUserId));
    await tx.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.employeeUserId));
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
  });
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(response).toBeOK();
}

async function verifyStatusViews(page: Page, fixture: Fixture, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.clock.install({ time: new Date(`${fixture.date}T10:30:00`) });

  await signIn(page, fixture.ownerEmail, fixture.password);
  await page.goto("/vlasnik/kalendar");
  await page.getByRole("button", { name: "Danas", exact: true }).click();
  await expect(page.getByTestId(`timeline-appointment-${fixture.noShowAppointmentId}`)).toContainText("Nije došao");
  await expect(page.getByTestId(`timeline-appointment-${fixture.lateAppointmentId}`).getByTestId(`late-policy-${fixture.lateAppointmentId}`)).toContainText("Kašnjenje: 15 min");
  await page.getByTestId("tab-list").click();
  const ownerNoShow = page.getByTestId(`list-appointment-${fixture.noShowAppointmentId}`);
  const ownerLate = page.getByTestId(`list-appointment-${fixture.lateAppointmentId}`);
  await expect(ownerLate.getByTestId(`late-policy-${fixture.lateAppointmentId}`)).toContainText("Preostalo do fiksnog kraja: 30 min");
  await expect(ownerNoShow.getByText("Nije došao", { exact: true })).toBeVisible();
  await expect(ownerNoShow.getByTestId(`no-show-note-${fixture.noShowAppointmentId}`)).toBeVisible();
  await expect(ownerNoShow.getByText("Napomena termina", { exact: true })).toBeVisible();

  await signIn(page, fixture.employeeEmail, fixture.password);
  await page.goto("/zaposleni");
  const lateNotice = page.getByTestId(`late-policy-${fixture.lateAppointmentId}`);
  await expect(lateNotice).toContainText("Kašnjenje: 15 min");
  await expect(lateNotice).toContainText("Preostalo do fiksnog kraja: 30 min");
  await expect(page.getByTestId(`no-show-note-${fixture.noShowAppointmentId}`)).toBeVisible();
  await expect(page.getByText("Napomena termina", { exact: true })).toHaveCount(2);

  await signIn(page, fixture.customerEmail, fixture.password);
  await page.goto("/moj-nalog");
  const customerLate = page.getByTestId(`late-policy-${fixture.lateAppointmentId}`);
  await expect(customerLate).toContainText("Kašnjenje: 15 min");
  await expect(customerLate).toContainText("Preostalo do fiksnog kraja: 30 min");
  const customerNoShow = page.getByTestId(`no-show-note-${fixture.noShowAppointmentId}`);
  await expect(customerNoShow).toBeVisible();
  await expect(customerNoShow).toContainText("Napomena o nedolasku");
  await expect(page.getByText("Nije došao", { exact: true })).toBeVisible();
  await expect(page.getByText("Napomena termina", { exact: true })).toHaveCount(2);
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`late and no-show booking states stay consistent on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createFixture();
    try {
      await verifyStatusViews(page, fixture, viewport);
    } finally {
      await cleanUpFixture(fixture);
    }
  });
}