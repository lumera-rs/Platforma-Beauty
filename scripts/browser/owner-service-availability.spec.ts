import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, salonsTable, servicesTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

type ServiceAvailabilityFixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  serviceId: string;
  serviceName: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createServiceAvailabilityFixture(): Promise<ServiceAvailabilityFixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-service-availability-owner-${suffix}@example.test`;
  const ownerPassword = "browser-service-availability-password";
  const serviceName = `Browser dolazak ${suffix}`;
  let ownerId: string | undefined;
  let salonId: string | undefined;
  let serviceId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash: await hashPassword(ownerPassword),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Service-availability browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za dolazak ${suffix}`,
      slug: `browser-service-availability-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 91",
      phone: "+381110000091",
      email: `browser-service-availability-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru dostupnosti dolaska.",
      description: "Salon je napravljen samo za browser regresioni test dostupnosti dolaska.",
      imageUrl: "/test-browser-service-availability.jpg",
      homeService: false,
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Service-availability browser fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: serviceName,
      description: "Usluga za browser proveru dostupnosti dolaska.",
      durationMinutes: 45,
      price: 1800,
      imageUrl: "/test-browser-service-availability.jpg",
      active: true,
      homeServiceAvailable: false,
      homeServiceFee: 0,
      homeServiceMinimumOrder: null,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Service-availability browser fixture could not create its service.");
    serviceId = service.id;

    return { ownerEmail, ownerPassword, ownerId: owner.id, salonId: salon.id, serviceId: service.id, serviceName };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpServiceAvailabilityFixture(fixture: ServiceAvailabilityFixture): Promise<void> {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: ServiceAvailabilityFixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated salon owner fixture must be able to sign in.").toBeOK();
}

async function editHomeServiceAvailability(page: Page, serviceName: string, enabled: boolean): Promise<void> {
  const serviceRow = page.locator(".divide-y > div").filter({ hasText: serviceName });
  await expect(serviceRow).toHaveCount(1);
  await serviceRow.getByRole("button", { name: "Izmeni" }).click();

  const dialog = page.getByRole("dialog", { name: "Izmeni uslugu" });
  await expect(dialog).toBeVisible();
  const homeServiceSwitch = dialog.getByRole("switch").nth(1);
  await expect(homeServiceSwitch).toHaveAttribute("aria-checked", enabled ? "false" : "true");
  await homeServiceSwitch.click();

  const updateResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && new URL(response.url()).pathname.startsWith("/api/salon/services/"),
  );
  await dialog.getByRole("button", { name: "Sačuvaj izmene" }).click();
  expect((await updateResponse).status(), "Changing home-service availability must be saved.").toBe(200);
  await expect(dialog).toBeHidden();
}

test("owner sees home-visit availability change with service edits", async ({ page }) => {
  const fixture = await createServiceAvailabilityFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/usluge");

    const availabilityNotice = page.getByTestId("home-service-availability");
    await expect(availabilityNotice).toContainText("Dolazak na adresu nije dostupan ni za jednu aktivnu uslugu");
    await expect(availabilityNotice).toBeVisible();

    await editHomeServiceAvailability(page, fixture.serviceName, true);
    await expect(availabilityNotice).toContainText("Dolazak na adresu je dostupan za 1 aktivnu uslugu");
    await expect(availabilityNotice).toBeVisible();

    await editHomeServiceAvailability(page, fixture.serviceName, false);
    await expect(availabilityNotice).toContainText("Dolazak na adresu nije dostupan ni za jednu aktivnu uslugu");
    await expect(availabilityNotice).toBeVisible();
  } finally {
    await cleanUpServiceAvailabilityFixture(fixture);
  }
});