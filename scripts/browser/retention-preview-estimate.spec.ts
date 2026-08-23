/**
 * Retention preview estimate labels — browser regression.
 *
 * The API fallback to sampled estimates is covered by
 * artifacts/api-server/src/lib/retention-settings.test.ts. This spec guards
 * the admin page's promise that sampled counts are visibly approximate:
 *
 *  1. The dedicated harness runs this spec with
 *     RETENTION_PREVIEW_MAX_CUSTOMERS=1, while the fixture has two customers.
 *  2. The page changes the new-customer window and clicks "Proveri uticaj".
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

  const [salon] = await db.insert(salonsTable).values({
    ownerId: admin.id,
    name: `Retention preview salon ${suffix}`,
    slug: `retention-preview-${suffix}`,
    city: "Beograd",
    municipality: "Stari Grad",
    address: "Test 1",
    postalCode: "11000",
    phone: "+381110000000",
    email: `retention-preview-salon-${suffix}@example.test`,
    shortDescription: "Salon za proveru pregleda retencije.",
    description: "Salon za proveru približnih i tačnih brojanja u pregledu retencije.",
    imageUrl: "/test-retention-preview.jpg",
  }).returning();
  if (!salon) throw new Error("The retention preview fixture could not create its salon.");

  const [service] = await db.insert(servicesTable).values({
    salonId: salon.id,
    categoryName: "Kosa",
    name: "Retention preview tretman",
    description: "Tretman za browser regresiju pregleda retencije.",
    durationMinutes: 60,
    price: 1000,
    imageUrl: "/test-retention-preview.jpg",
  }).returning();
  if (!service) throw new Error("The retention preview fixture could not create its service.");

  const customers = await db.insert(salonCustomersTable).values([
    {
      salonId: salon.id,
      firstName: "Prvi",
      lastName: "Klijent",
      email: `retention-preview-customer-a-${suffix}@example.test`,
    },
    {
      salonId: salon.id,
      firstName: "Drugi",
      lastName: "Klijent",
      email: `retention-preview-customer-b-${suffix}@example.test`,
    },
  ]).returning();
  if (customers.length !== 2) {
    throw new Error("The retention preview fixture could not create both customers.");
  }

  // Both customers are recent enough for the default 45-day window, but not
  // for the candidate 1-day window. Either sampled customer therefore
  // produces the same NEW -> ACTIVE shift.
  const visitDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await db.insert(appointmentsTable).values(customers.map((customer) => ({
    salonId: salon.id,
    salonCustomerId: customer.id,
    serviceId: service.id,
    date: visitDate,
    startTime: "10:00",
    endTime: "11:00",
    durationMinutes: 60,
    price: 1000,
    status: "completed" as const,
  })));
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

  // Make both fixture customers change status under the candidate thresholds.
  await windowInput.fill("1");
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
    await expect(reclassifiedSummary).toHaveText(/^~\d+ od \d+ klijenata menja status$/);
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

    await expect(shiftRows).toHaveCount(1);
    await expect(shiftRows.first().locator("span.font-semibold")).not.toHaveText(/~/);
  }
});