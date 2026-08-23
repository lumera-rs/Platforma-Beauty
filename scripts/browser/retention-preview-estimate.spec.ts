/**
 * Retention preview estimate labels — browser regression.
 *
 * The API fallback to sampled estimates is covered by
 * artifacts/api-server/src/lib/retention-settings.test.ts. This spec guards
 * the admin page's promise that sampled counts are visibly approximate:
 *
 *  1. The dedicated harness runs this spec with
 *     RETENTION_PREVIEW_MAX_CUSTOMERS=1, while the fixture has seven customers.
 *  2. The page changes the new-customer window and VIP threshold, then clicks
 *     "Proveri uticaj".
 *  3. Estimate mode must show its badge and both explanatory notes, and every
 *     table/shift count must carry the "~" prefix.
 *  4. The harness runs the same spec again with a cap above the fixture size;
 *     the exact control run must show none of those estimate indicators.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  appointmentsTable,
  db,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";

const expectEstimate = process.env.LUMERA_RETENTION_PREVIEW_EXPECT_ESTIMATE === "1";

// This file is intentionally exercised by the disposable two-pass runner.
// Keep it out of the shared workflow, whose API process cannot be restarted
// with the cap override between the estimate and exact control runs.
test.skip(!process.env.LUMERA_RETENTION_PREVIEW_EXPECT_ESTIMATE, "Run through test:retention-preview.");

const password = "browser-retention-preview-password";
const suffix = randomUUID();
const adminEmail = `browser-retention-preview-admin-${suffix}@example.test`;
let smallSalonId: string;
let largeSalonId: string;
let smallSalonName: string;
let largeSalonName: string;

async function seedFixture(): Promise<void> {
  const passwordHash = await hashPassword(password);
  const [admin] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Retention Preview Admin",
    email: adminEmail,
    passwordHash,
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (!admin) throw new Error("The retention preview fixture could not create its admin.");

  const salons = await db.insert(salonsTable).values([
    {
      ownerId: admin.id,
      name: `Retention preview small salon ${suffix}`,
      slug: `retention-preview-small-${suffix}`,
      city: "Beograd",
      municipality: "Stari Grad",
      address: "Test 1",
      postalCode: "11000",
      phone: "+381110000000",
      email: `retention-preview-small-${suffix}@example.test`,
      shortDescription: "Mali salon za proveru pregleda retencije.",
      description: "Salon ispod minimuma za share rangiranje.",
      imageUrl: "/test-retention-preview.jpg",
    },
    {
      ownerId: admin.id,
      name: `Retention preview large salon ${suffix}`,
      slug: `retention-preview-large-${suffix}`,
      city: "Beograd",
      municipality: "Novi Beograd",
      address: "Test 2",
      postalCode: "11000",
      phone: "+381110000001",
      email: `retention-preview-large-${suffix}@example.test`,
      shortDescription: "Veći salon za proveru pregleda retencije.",
      description: "Salon iznad minimuma za share rangiranje.",
      imageUrl: "/test-retention-preview.jpg",
    },
  ]).returning();
  if (salons.length !== 2) throw new Error("The retention preview fixture could not create both salons.");
  const [smallSalon, largeSalon] = salons;
  if (!smallSalon || !largeSalon) throw new Error("The retention preview fixture salons are incomplete.");
  smallSalonId = smallSalon.id;
  largeSalonId = largeSalon.id;
  smallSalonName = smallSalon.name;
  largeSalonName = largeSalon.name;

  const services = await db.insert(servicesTable).values([
    {
      salonId: smallSalon.id,
      categoryName: "Kosa",
      name: "Retention preview small tretman",
      description: "Tretman za browser regresiju pregleda retencije.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test-retention-preview.jpg",
    },
    {
      salonId: largeSalon.id,
      categoryName: "Kosa",
      name: "Retention preview large tretman",
      description: "Tretman za browser regresiju pregleda retencije.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test-retention-preview.jpg",
    },
  ]).returning();
  if (services.length !== 2) throw new Error("The retention preview fixture could not create both services.");
  const [smallService, largeService] = services;
  if (!smallService || !largeService) throw new Error("The retention preview fixture services are incomplete.");

  const customers = await db.insert(salonCustomersTable).values([
    {
      salonId: smallSalon.id,
      firstName: "Prvi",
      lastName: "Mali",
      email: `retention-preview-small-a-${suffix}@example.test`,
    },
    {
      salonId: smallSalon.id,
      firstName: "Drugi",
      lastName: "Mali",
      email: `retention-preview-small-b-${suffix}@example.test`,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      salonId: largeSalon.id,
      firstName: `Veliki${index + 1}`,
      lastName: "Klijent",
      email: `retention-preview-large-${index + 1}-${suffix}@example.test`,
    })),
  ]).returning();
  if (customers.length !== 7) {
    throw new Error("The retention preview fixture could not create all customers.");
  }

  const recentVisitDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const priorVisitDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await db.insert(appointmentsTable).values([
    ...customers.slice(0, 2).map((customer) => ({
      salonId: smallSalon.id,
      salonCustomerId: customer.id,
      serviceId: smallService.id,
      date: recentVisitDate,
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      price: 1000,
      status: "completed" as const,
    })),
    ...customers.slice(2).flatMap((customer) => [
      {
        salonId: largeSalon.id,
        salonCustomerId: customer.id,
        serviceId: largeService.id,
        date: priorVisitDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "completed" as const,
      },
      {
        salonId: largeSalon.id,
        salonCustomerId: customer.id,
        serviceId: largeService.id,
        date: recentVisitDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "completed" as const,
      },
    ]),
  ]);
}

test.beforeAll(async () => {
  await seedFixture();
});


test("marks sampled retention counts as approximate and keeps exact counts unmarked", async ({ page }) => {
  test.setTimeout(120_000);

  const login = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password },
  });
  expect(login.ok(), "the retention preview admin must be able to sign in").toBe(true);

  await page.goto("/admin/retencija");
  const windowInput = page.getByTestId("input-newCustomerWindowDays");
  await expect(windowInput).toHaveValue("45");

  // Make both fixture groups change status under the candidate thresholds:
  // recent first visits leave NEW, while the two-visit customers become VIP.
  await windowInput.fill("1");
  await page.getByTestId("input-vipMinCompletedVisits").fill("2");
  const previewResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/growth/admin/retention-settings/preview",
  );
  await page.getByTestId("preview-retention-settings").click();
  expect((await previewResponse).status(), "the retention preview request must succeed").toBe(200);

  const previewPanel = page.getByTestId("retention-preview-panel");
  await expect(previewPanel).toBeVisible();

  const reclassifiedSummary = page.getByTestId("retention-preview-reclassified");
  const affectedSalons = page.getByTestId("retention-preview-affected-salons");
  const tableRows = previewPanel.locator("tbody tr");
  const shiftRows = previewPanel.locator('[data-testid^="retention-preview-shift-"]');

  if (expectEstimate) {
    await expect(page.getByTestId("retention-preview-estimate")).toBeVisible();
    await expect(page.getByTestId("retention-preview-estimate-note")).toBeVisible();
    await expect(page.getByTestId("retention-preview-no-salons-note")).toBeVisible();
    await expect(reclassifiedSummary).toHaveText(/^~\d+ ±\d+ od \d+ klijenata menja status$/);
    await expect(affectedSalons).toHaveCount(0);
    await expect(tableRows).toHaveCount(5);

    for (let index = 0; index < 5; index += 1) {
      const cells = tableRows.nth(index).locator("td");
      await expect(cells.nth(1)).toHaveText(/~/);
      await expect(cells.nth(2)).toHaveText(/~/);
      await expect(cells.nth(3)).toHaveText(/~/);
    }

    await expect(shiftRows).toHaveCount(1);
    await expect(shiftRows.first().locator("span.font-semibold")).toHaveText(/^~/);
  } else {
    await expect(page.getByTestId("retention-preview-estimate")).toHaveCount(0);
    await expect(page.getByTestId("retention-preview-estimate-note")).toHaveCount(0);
    await expect(page.getByTestId("retention-preview-no-salons-note")).toHaveCount(0);
    await expect(reclassifiedSummary).toHaveText(/^\d+ od \d+ klijenata menja status$/);
    await expect(affectedSalons).toBeVisible();
    await expect(tableRows).toHaveCount(5);

    for (let index = 0; index < 5; index += 1) {
      const cells = tableRows.nth(index).locator("td");
      await expect(cells.nth(1)).not.toHaveText(/~/);
      await expect(cells.nth(2)).not.toHaveText(/~/);
      await expect(cells.nth(3)).not.toHaveText(/~/);
    }

    await expect(shiftRows).toHaveCount(2);
    await expect(shiftRows.first().locator("span.font-semibold")).not.toHaveText(/~/);
  }
});

test("switches salon ranking between count and share views and preserves the toggle", async ({ page }) => {
  test.skip(expectEstimate, "Salon ranking is available only in exact preview mode.");
  test.setTimeout(120_000);

  const login = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password },
  });
  expect(login.ok(), "the retention preview admin must be able to sign in").toBe(true);

  await page.goto("/admin/retencija");
  const windowInput = page.getByTestId("input-newCustomerWindowDays");
  const vipInput = page.getByTestId("input-vipMinCompletedVisits");
  await expect(windowInput).toHaveValue("45");
  await expect(vipInput).toHaveValue("5");

  // First preview: the large salon moves five customers to VIP and the small
  // salon moves two NEW customers to ACTIVE. Both appear by count, but only
  // the large salon qualifies for the share ranking's five-customer floor.
  await windowInput.fill("1");
  await vipInput.fill("2");
  const firstPreviewResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/growth/admin/retention-settings/preview",
  );
  await page.getByTestId("preview-retention-settings").click();
  expect((await firstPreviewResponse).status(), "the first ranking preview must succeed").toBe(200);

  const previewPanel = page.getByTestId("retention-preview-panel");
  const affectedSalons = page.getByTestId("retention-preview-affected-salons");
  const salonRows = affectedSalons.locator("li");
  const countButton = page.getByTestId("retention-preview-ranking-count");
  const shareButton = page.getByTestId("retention-preview-ranking-share");
  await expect(previewPanel).toBeVisible();
  await expect(affectedSalons).toBeVisible();
  await expect(countButton).toHaveAttribute("aria-pressed", "true");
  await expect(salonRows).toHaveCount(2);
  await expect(salonRows.nth(0)).toContainText(largeSalonName);
  await expect(salonRows.nth(1)).toContainText(smallSalonName);
  await expect(page.getByTestId(`retention-preview-salon-${largeSalonId}`)).toBeVisible();
  await expect(page.getByTestId(`retention-preview-salon-${smallSalonId}`)).toBeVisible();

  await shareButton.click();
  await expect(shareButton).toHaveAttribute("aria-pressed", "true");
  await expect(countButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("retention-preview-share-floor-note")).toBeVisible();
  await expect(salonRows).toHaveCount(1);
  await expect(salonRows.first()).toContainText(largeSalonName);
  await expect(salonRows.first()).not.toContainText(smallSalonName);
  await expect(page.getByTestId("retention-preview-share-empty")).toHaveCount(0);

  // Second preview: retain the share toggle, but only the two-customer salon
  // changes. The UI must replace the old share list with its friendly empty
  // state rather than leaving a blank section or crashing.
  await vipInput.fill("5");
  const secondPreviewResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/growth/admin/retention-settings/preview",
  );
  await page.getByTestId("preview-retention-settings").click();
  expect((await secondPreviewResponse).status(), "the second ranking preview must succeed").toBe(200);
  await expect(shareButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("retention-preview-share-floor-note")).toBeVisible();
  await expect(page.getByTestId("retention-preview-share-empty")).toBeVisible();
  await expect(page.getByTestId("retention-preview-share-empty")).toContainText("Nijedan pogođeni salon");
  await expect(salonRows).toHaveCount(0);
});
