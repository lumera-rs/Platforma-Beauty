/**
 * Campaign stats → CRM client profile browser regression.
 *
 * The attributed-appointments API deliberately permits a realized appointment
 * with no linked salon customer (for example, a walk-in). The campaign
 * drill-down must only make the customer name a link when the API provides a
 * salonCustomerId, and that link must land on the CRM page where the query
 * parameter opens the matching detail dialog.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  appointmentsTable,
  automationRulesTable,
  automationRunsTable,
  db,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  ruleId: string;
  ruleName: string;
  customerId: string;
  linkedAppointmentId: string;
  walkInAppointmentId: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-client-profile-owner-${suffix}@example.test`;
  const ownerPassword = "browser-client-profile-password";
  const ruleName = `Browser CRM kampanja ${suffix}`;
  const linkedAppointmentId = randomUUID();
  const walkInAppointmentId = randomUUID();
  let ownerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash: await hashPassword(ownerPassword),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Client-profile browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za CRM ${suffix}`,
      slug: `browser-client-profile-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 93",
      phone: "+381110000093",
      email: `browser-client-profile-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za browser proveru CRM linka.",
      description: "Salon je napravljen samo za browser proveru skoka iz kampanje u CRM.",
      imageUrl: "/test-browser-client-profile.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Client-profile browser fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable)
      .set({ activeSalonId: salon.id })
      .where(eq(usersTable.id, owner.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: `Browser CRM usluga ${suffix}`,
      description: "Usluga za browser proveru CRM linka.",
      durationMinutes: 60,
      price: 2400,
      imageUrl: "/test-browser-client-profile.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Client-profile browser fixture could not create its service.");

    const [customer] = await db.insert(salonCustomersTable).values({
      id: randomUUID(),
      salonId: salon.id,
      firstName: "Povezani",
      lastName: "Klijent",
      email: `browser-client-profile-customer-${suffix}@example.test`,
      phone: "+381611000093",
      smsOptOut: false,
    }).returning({ id: salonCustomersTable.id });
    if (!customer) throw new Error("Client-profile browser fixture could not create its customer.");

    const [rule] = await db.insert(automationRulesTable).values({
      salonId: salon.id,
      name: ruleName,
      trigger: "inactive_days",
      triggerConfig: { inactiveDays: 30 },
      action: "send_email",
      emailSubject: "Test",
      emailBody: "Test",
      status: "active",
    }).returning({ id: automationRulesTable.id });
    if (!rule) throw new Error("Client-profile browser fixture could not create its rule.");

    const appointmentDate = new Date().toISOString().slice(0, 10);
    await db.insert(appointmentsTable).values([
      {
        id: linkedAppointmentId,
        salonId: salon.id,
        salonCustomerId: customer.id,
        serviceId: service.id,
        date: appointmentDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        status: "confirmed" as const,
        price: 2400,
        treatmentLocation: "salon",
      },
      {
        id: walkInAppointmentId,
        salonId: salon.id,
        salonCustomerId: null,
        serviceId: service.id,
        date: appointmentDate,
        startTime: "11:00",
        endTime: "12:00",
        durationMinutes: 60,
        status: "confirmed" as const,
        price: 2400,
        treatmentLocation: "salon",
      },
    ]);

    const sentAt = new Date();
    await db.insert(automationRunsTable).values([
      {
        eventKey: `browser-client-profile-${suffix}-linked`,
        ruleId: rule.id,
        salonId: salon.id,
        salonCustomerId: customer.id,
        status: "sent" as const,
        attributedAppointmentId: linkedAppointmentId,
        executedAt: sentAt,
        sentAt,
      },
      {
        eventKey: `browser-client-profile-${suffix}-walk-in`,
        ruleId: rule.id,
        salonId: salon.id,
        salonCustomerId: customer.id,
        status: "sent" as const,
        attributedAppointmentId: walkInAppointmentId,
        executedAt: sentAt,
        sentAt,
      },
    ]);

    return {
      ownerEmail,
      ownerPassword,
      ownerId: owner.id,
      salonId: salon.id,
      ruleId: rule.id,
      ruleName,
      customerId: customer.id,
      linkedAppointmentId,
      walkInAppointmentId,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The campaign CRM-link fixture owner must be able to sign in.").toBeOK();
}

test("campaign appointment client names link to CRM only when a customer id exists", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    await page.getByTestId(`overview-row-${fixture.ruleId}`)
      .getByRole("button", { name: fixture.ruleName })
      .click();
    const statsDialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(statsDialog).toBeVisible();

    const linkedClient = statsDialog.getByTestId(
      `link-attributed-client-${fixture.linkedAppointmentId}`,
    );
    const walkInClient = statsDialog.getByTestId(
      `attributed-appointment-client-${fixture.walkInAppointmentId}`,
    );

    await expect(linkedClient).toHaveCount(1);
    await expect(linkedClient).toHaveAttribute(
      "href",
      `/vlasnik/klijenti?klijent=${fixture.customerId}`,
    );
    await expect(linkedClient).toHaveText("Povezani Klijent");

    await expect(walkInClient).toHaveCount(1);
    await expect(walkInClient.locator("a")).toHaveCount(0);
    await expect(walkInClient).toHaveText("Nepoznat klijent");

    await linkedClient.click();
    await expect(page).toHaveURL(
      new RegExp(`/vlasnik/klijenti\\?klijent=${fixture.customerId}$`),
    );

    const customerDialog = page.getByRole("dialog");
    await expect(customerDialog).toBeVisible();
    await expect(customerDialog.getByRole("heading", { name: "Povezani Klijent" })).toBeVisible();

    await customerDialog.getByRole("button", { name: "Close" }).click();
    await expect(customerDialog).toBeHidden();
    await expect(page).toHaveURL(/\/vlasnik\/klijenti\/?$/);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("direct CRM client links survive a hard refresh and close cleanly", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await signInAsFixtureOwner(page, fixture);

    // Start from the copied CRM deep link itself. This deliberately does not
    // visit the campaign page, so the dialog can only be restored from the
    // authenticated session and the URL query parameter.
    const clientUrl = `/vlasnik/klijenti?klijent=${fixture.customerId}`;
    await page.goto("/vlasnik/klijenti");
    await page.goto(clientUrl);

    const customerDialog = page.getByRole("dialog");
    await expect(customerDialog).toBeVisible();
    await expect(customerDialog.getByRole("heading", { name: "Povezani Klijent" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/vlasnik/klijenti\\?klijent=${fixture.customerId}$`));

    await page.goBack();
    await expect(page).toHaveURL(/\/vlasnik\/klijenti\/?$/);
    await expect(customerDialog).toBeHidden();
    expect(new URL(page.url()).searchParams.has("klijent")).toBe(false);

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/vlasnik\/klijenti\\?klijent=${fixture.customerId}$`));
    await expect(customerDialog).toBeVisible();
    await expect(customerDialog.getByRole("heading", { name: "Povezani Klijent" })).toBeVisible();

    // The copied link must also keep restoring the dialog after a reload.
    await page.reload();
    await expect(customerDialog).toBeVisible();
    await expect(customerDialog.getByRole("heading", { name: "Povezani Klijent" })).toBeVisible();

    await customerDialog.getByRole("button", { name: "Close" }).click();
    await expect(customerDialog).toBeHidden();
    await expect(page).toHaveURL(/\/vlasnik\/klijenti\/?$/);
    expect(new URL(page.url()).searchParams.has("klijent")).toBe(false);
  } finally {
    await cleanUpFixture(fixture);
  }
});