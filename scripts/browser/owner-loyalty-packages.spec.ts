import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  customerPackagePurchasesTable,
  db,
  packagePurchaseServiceLinksTable,
  packageServiceLinksTable,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  treatmentPackagesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

type LoyaltyPackageFixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  salonId: string;
  salonSlug: string;
  serviceId: string;
  serviceName: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<LoyaltyPackageFixture> {
  const marker = randomUUID();
  const ownerPassword = "browser-loyalty-package-owner-password";
  const customerPassword = "browser-loyalty-package-customer-password";
  const ownerEmail = `browser-loyalty-package-owner-${marker}@example.test`;
  const customerEmail = `browser-loyalty-package-customer-${marker}@example.test`;
  const salonSlug = `browser-loyalty-package-${marker}`;
  const serviceName = `Browser paket usluga ${marker}`;
  let ownerId: string | undefined;
  let customerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner, customer] = await db.insert(usersTable).values([
      {
        firstName: "Browser",
        lastName: "Vlasnik paketa",
        email: ownerEmail,
        passwordHash: await hashPassword(ownerPassword),
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Browser",
        lastName: "Kupac paketa",
        email: customerEmail,
        passwordHash: await hashPassword(customerPassword),
        passwordSetAt: new Date(),
        role: "CUSTOMER",
        phone: "+381601112233",
        phoneNormalized: "+381601112233",
      },
    ]).returning({ id: usersTable.id });
    if (!owner || !customer) throw new Error("Loyalty/package browser fixture could not create its users.");
    ownerId = owner.id;
    customerId = customer.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser loyalty paket salon ${marker}`,
      slug: salonSlug,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 811",
      postalCode: "11000",
      phone: "+381110000811",
      email: `browser-loyalty-package-salon-${marker}@example.test`,
      shortDescription: "Izolovan salon za browser proveru paketa.",
      description: "Salon je marker-owned fixture za loyalty i package browser regresiju.",
      imageUrl: "/test-browser-loyalty-package.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Loyalty/package browser fixture could not create its salon.");
    salonId = salon.id;
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Browser paket",
      name: serviceName,
      description: "Marker-owned usluga za browser proveru paketa.",
      durationMinutes: 45,
      price: 2400,
      imageUrl: "/test-browser-loyalty-package.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Loyalty/package browser fixture could not create its service.");

    return {
      ownerEmail,
      ownerPassword,
      ownerId: owner.id,
      customerEmail,
      customerPassword,
      customerId: customer.id,
      salonId: salon.id,
      salonSlug,
      serviceId: service.id,
      serviceName,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (customerId) await db.delete(usersTable).where(eq(usersTable.id, customerId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: LoyaltyPackageFixture): Promise<void> {
  const purchases = await db.select({ id: customerPackagePurchasesTable.id })
    .from(customerPackagePurchasesTable)
    .where(eq(customerPackagePurchasesTable.salonId, fixture.salonId));
  for (const purchase of purchases) {
    await db.delete(packagePurchaseServiceLinksTable)
      .where(eq(packagePurchaseServiceLinksTable.purchaseId, purchase.id));
  }
  await db.delete(customerPackagePurchasesTable)
    .where(eq(customerPackagePurchasesTable.salonId, fixture.salonId));
  await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, fixture.salonId));

  const packages = await db.select({ id: treatmentPackagesTable.id })
    .from(treatmentPackagesTable)
    .where(eq(treatmentPackagesTable.salonId, fixture.salonId));
  for (const pkg of packages) {
    await db.delete(packageServiceLinksTable).where(eq(packageServiceLinksTable.packageId, pkg.id));
  }
  await db.delete(treatmentPackagesTable).where(eq(treatmentPackagesTable.salonId, fixture.salonId));
  await db.delete(servicesTable).where(eq(servicesTable.salonId, fixture.salonId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function switchUser(page: Page, email: string, password: string): Promise<void> {
  await page.request.post("/api/auth/logout");
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(response, `Fixture user ${email} must be able to sign in.`).toBeOK();
}

test("owner loyalty view persists and treatment packages complete the visible purchase entitlement lifecycle", async ({ page }) => {
  const fixture = await createFixture();
  const createdName = `Browser paket ${randomUUID()}`;
  const editedName = `${createdName} izmenjen`;
  let packageId: string | undefined;
  let purchaseId: string | undefined;

  try {
    await switchUser(page, fixture.ownerEmail, fixture.ownerPassword);

    await page.goto("/vlasnik/loyalty");
    await expect(page.getByRole("heading", { name: "Loyalty Program" })).toBeVisible();
    const loyaltyResponse = await page.request.get("/api/loyalty/status");
    expect(loyaltyResponse, "The owner loyalty view must have a readable canonical status.").toBeOK();
    const loyalty = await loyaltyResponse.json() as { currentTier: string };
    await expect(page.getByRole("heading", { name: `${loyalty.currentTier} Partner` })).toBeVisible();
    await expect(page.locator("input, textarea, [role=switch]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sačuvaj|izmeni|ažuriraj/i })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: `${loyalty.currentTier} Partner` })).toBeVisible();

    await page.goto("/vlasnik/paketi");
    await page.getByRole("button", { name: "Novi paket" }).click();
    let dialog = page.getByRole("dialog", { name: "Novi paket tretmana" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Npr. Paket 5 Masaža").fill(createdName);
    await dialog.getByPlaceholder("Kratak opis benefita").fill("Početni opis browser paketa.");
    await dialog.locator('input[type="number"]').nth(0).fill("7200");
    await dialog.locator('input[type="number"]').nth(1).fill("90");
    await dialog.getByTestId("package-definition-service-combobox").click();
    await page.getByTestId(`package-definition-service-combobox-option-${fixture.serviceId}`).click();
    await dialog.getByTestId(`package-definition-service-quota-${fixture.serviceId}`).fill("3");

    const createResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/growth/packages"
      && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Sačuvaj paket" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status(), "Visible package creation must succeed.").toBe(201);
    packageId = ((await createResponse.json()) as { id: string }).id;
    await expect(dialog).toBeHidden();
    await expect(page.getByText(createdName, { exact: true })).toBeVisible();
    await expect(page.getByText(/7[.,\s]200 RSD za 3 tretmana/)).toBeVisible();

    const packageHeading = page.getByText(createdName, { exact: true });
    await packageHeading.locator("xpath=ancestor::div[contains(@class,'justify-between')][1]")
      .getByRole("button", { name: "Izmeni" }).click();
    dialog = page.getByRole("dialog", { name: "Izmeni paket" });
    await dialog.getByPlaceholder("Npr. Paket 5 Masaža").fill(editedName);
    await dialog.getByPlaceholder("Kratak opis benefita").fill("Izmenjeni opis ostaje posle učitavanja.");
    await dialog.locator('input[type="number"]').nth(0).fill("6800");
    await dialog.locator('input[type="number"]').nth(1).fill("120");
    await dialog.getByTestId(`package-definition-service-quota-${fixture.serviceId}`).fill("4");
    const updateResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/growth/packages/${packageId}`
      && response.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "Sačuvaj paket" }).click();
    expect((await updateResponsePromise).status(), "Visible package editing must succeed.").toBe(200);
    await page.reload();
    await expect(page.getByText(editedName, { exact: true })).toBeVisible();
    await expect(page.getByText(/6[.,\s]800 RSD za 4 tretmana/)).toBeVisible();
    await expect(page.getByText("Izmenjeni opis ostaje posle učitavanja.", { exact: true })).toBeVisible();
    await expect(page.getByText(`${fixture.serviceName} × 4`, { exact: true })).toBeVisible();
    await expect(page.getByText("Validnost: 120 dana od kupovine", { exact: true })).toBeVisible();

    const [savedPackage] = await db.select().from(treatmentPackagesTable)
      .where(eq(treatmentPackagesTable.id, packageId)).limit(1);
    expect(savedPackage).toMatchObject({
      salonId: fixture.salonId,
      name: editedName,
      description: "Izmenjeni opis ostaje posle učitavanja.",
      priceInDinars: 6800,
      sessionCount: 4,
      validityDays: 120,
      active: true,
      quotaPolicy: "per_service",
    });
    const [savedLink] = await db.select().from(packageServiceLinksTable)
      .where(eq(packageServiceLinksTable.packageId, packageId)).limit(1);
    expect(savedLink).toMatchObject({ serviceId: fixture.serviceId, quota: 4 });

    await switchUser(page, fixture.customerEmail, fixture.customerPassword);
    await page.goto(`/saloni/${fixture.salonSlug}`);
    const publicPackage = page.getByText(editedName, { exact: true })
      .locator("xpath=ancestor::*[contains(@class,'rounded-xl')][1]");
    await expect(publicPackage).toContainText("4 tretmana");
    await publicPackage.getByRole("button", { name: "Kupi paket" }).click();
    const purchaseDialog = page.getByRole("dialog");
    await expect(purchaseDialog.getByText("Način plaćanja", { exact: true })).toBeVisible();
    const purchaseResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/growth/packages/${packageId}/purchases`
      && response.request().method() === "POST",
    );
    await purchaseDialog.getByRole("button", { name: "Potvrdi kupovinu" }).click();
    const purchaseResponse = await purchaseResponsePromise;
    expect(purchaseResponse.status(), "The customer's visible package purchase must be created pending payment.").toBe(201);
    purchaseId = ((await purchaseResponse.json()) as { id: string }).id;

    await page.goto("/moj-nalog?tab=packages");
    await expect(page.getByText(editedName, { exact: true })).toBeVisible();
    await expect(page.getByText("Čeka uplatu", { exact: true })).toBeVisible();
    await expect(page.getByText("4 / 4", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Čeka uplatu", { exact: true })).toBeVisible();
    expect((await db.select().from(customerPackagePurchasesTable)
      .where(eq(customerPackagePurchasesTable.id, purchaseId)).limit(1))[0]).toMatchObject({
      packageId,
      salonId: fixture.salonId,
      status: "pending_payment",
      totalSessions: 4,
      remainingSessions: 4,
      priceInDinars: 6800,
    });

    await switchUser(page, fixture.ownerEmail, fixture.ownerPassword);
    await page.goto("/vlasnik/paketi");
    await page.getByRole("tab", { name: "Prodati paketi" }).click();
    const soldPackage = page.getByText(editedName, { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
    await expect(soldPackage.getByText("Čeka uplatu", { exact: true })).toBeVisible();
    const confirmResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname
        === `/api/growth/packages/${packageId}/purchases/${purchaseId}/confirm-payment`
      && response.request().method() === "POST",
    );
    await soldPackage.getByRole("button", { name: "Potvrdi uplatu" }).click();
    expect((await confirmResponsePromise).status(), "The owner must visibly activate the paid entitlement.").toBe(200);
    await expect(soldPackage.getByText("Aktivan", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Prodati paketi" }).click();
    await expect(page.getByText("Aktivan", { exact: true })).toBeVisible();

    const [activated] = await db.select().from(customerPackagePurchasesTable)
      .where(eq(customerPackagePurchasesTable.id, purchaseId)).limit(1);
    expect(activated).toMatchObject({
      status: "active",
      paymentConfirmedByUserId: fixture.ownerId,
      remainingSessions: 4,
    });
    expect(activated?.paymentConfirmedAt).toBeInstanceOf(Date);

    await switchUser(page, fixture.customerEmail, fixture.customerPassword);
    await page.goto("/moj-nalog?tab=packages");
    await expect(page.getByText(editedName, { exact: true })).toBeVisible();
    await expect(page.getByText("Aktivan", { exact: true })).toBeVisible();
    await expect(page.getByText("4 / 4", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Aktivan", { exact: true })).toBeVisible();
  } finally {
    await cleanUpFixture(fixture);
  }
});