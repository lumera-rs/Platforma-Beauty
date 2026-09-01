/**
 * SALON_OWNER critical-path browser regression:
 *  - automation rule create, edit, activate and pause;
 *  - B2B catalog add-to-cart, canonical checkout, order list and order detail.
 *
 * Each test owns a UUID-marked user/salon (and, for commerce, catalog rows).
 * Target operations are performed through the visible UI. Direct database
 * access is limited to fixture setup, persistence/safety assertions and
 * teardown.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  emailDeliveriesTable,
  loyaltyPointLedgerTable,
  orderItemsTable,
  ordersTable,
  productCategoriesTable,
  productsTable,
  salonsTable,
  shopSettingsTable,
  smsDeliveriesTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

type OwnerFixture = {
  marker: string;
  ownerId: string;
  ownerEmail: string;
  ownerPassword: string;
  salonId: string;
};

type ShopFixture = OwnerFixture & {
  supplierId: string;
  supplierSlug: string;
  categoryId: string;
  productId: string;
  productName: string;
  shopSettingsId: string;
  originalSellerSettings: SellerSettingsSnapshot;
};

type SellerSettingsSnapshot = {
  sellerCompanyName: string | null;
  sellerTaxId: string | null;
  sellerRegistrationNumber: string | null;
  sellerAddress: string | null;
  sellerCity: string | null;
  sellerPostalCode: string | null;
  sellerBankAccount: string | null;
  sellerContactEmail: string | null;
  sellerContactPhone: string | null;
  version: number;
  updatedAt: Date;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createOwnerFixture(prefix: string): Promise<OwnerFixture> {
  const marker = `${prefix}-${randomUUID()}`;
  const ownerPassword = "Browser-owner-regression-password";
  const ownerEmail = `${marker}@example.invalid`;
  let ownerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      phone: "+381110000099",
      passwordHash: await hashPassword(ownerPassword),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Could not create marker-owned SALON_OWNER.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon ${marker}`,
      slug: marker,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test ulica 99",
      postalCode: "11000",
      phone: "+381110000099",
      email: `${marker}-salon@example.invalid`,
      shortDescription: "Izolovan browser regresioni salon.",
      description: "Marker-owned fixture for SALON_OWNER browser coverage.",
      imageUrl: "/test-browser-owner-regression.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Could not create marker-owned salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
    return { marker, ownerId: owner.id, ownerEmail, ownerPassword, salonId: salon.id };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function createShopFixture(): Promise<ShopFixture> {
  const owner = await createOwnerFixture("browser-b2b-order");
  let supplierId: string | undefined;
  let categoryId: string | undefined;
  let productId: string | undefined;
  let shopSettingsId: string | undefined;
  let originalSellerSettings: SellerSettingsSnapshot | undefined;

  try {
    const [supplier] = await db.insert(suppliersTable).values({
      name: `Browser B2B dobavljač ${owner.marker}`,
      slug: `supplier-${owner.marker}`,
      scope: "B2B",
      active: true,
    }).returning({ id: suppliersTable.id, slug: suppliersTable.slug });
    if (!supplier) throw new Error("Could not create marker-owned B2B supplier.");
    supplierId = supplier.id;

    const categoryName = `Browser kategorija ${owner.marker}`;
    const [category] = await db.insert(productCategoriesTable).values({
      supplierId: supplier.id,
      name: categoryName,
      slug: `category-${owner.marker}`,
      active: true,
    }).returning({ id: productCategoriesTable.id });
    if (!category) throw new Error("Could not create marker-owned B2B category.");
    categoryId = category.id;

    const productName = `Browser profesionalni proizvod ${owner.marker}`;
    const [product] = await db.insert(productsTable).values({
      supplierId: supplier.id,
      categoryId: category.id,
      categoryName,
      name: productName,
      description: "Izolovan proizvod za browser proveru B2B kupovine.",
      shortDescription: "Browser B2B fixture",
      imageUrl: "/test-browser-owner-regression.jpg",
      price: 20_000,
      stock: 5,
      sku: `BROWSER-B2B-${owner.marker}`,
      unit: "kom",
      weightGrams: 500,
      professionalEnabled: true,
      retailEnabled: false,
      active: true,
    }).returning({ id: productsTable.id });
    if (!product) throw new Error("Could not create marker-owned B2B product.");
    productId = product.id;

    const [settings] = await db.select().from(shopSettingsTable).limit(1);
    if (!settings) {
      throw new Error("B2B browser fixture requires the canonical singleton shop_settings row.");
    }
    shopSettingsId = settings.id;
    originalSellerSettings = {
      sellerCompanyName: settings.sellerCompanyName,
      sellerTaxId: settings.sellerTaxId,
      sellerRegistrationNumber: settings.sellerRegistrationNumber,
      sellerAddress: settings.sellerAddress,
      sellerCity: settings.sellerCity,
      sellerPostalCode: settings.sellerPostalCode,
      sellerBankAccount: settings.sellerBankAccount,
      sellerContactEmail: settings.sellerContactEmail,
      sellerContactPhone: settings.sellerContactPhone,
      version: settings.version,
      updatedAt: settings.updatedAt,
    };
    const updated = await db.update(shopSettingsTable).set({
      sellerCompanyName: `Browser prodavac ${owner.marker}`,
      sellerTaxId: "101234567",
      sellerRegistrationNumber: "20123456",
      sellerAddress: "Test prodavca 1",
      sellerCity: "Beograd",
      sellerPostalCode: "11000",
      sellerBankAccount: "100-123456789-10",
      sellerContactEmail: `${owner.marker}-seller@example.invalid`,
      sellerContactPhone: "+381110000098",
      version: settings.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(shopSettingsTable.id, settings.id), eq(shopSettingsTable.version, settings.version)))
      .returning({ id: shopSettingsTable.id });
    if (updated.length !== 1) {
      throw new Error("Shop settings changed concurrently while creating the B2B browser fixture.");
    }

    return {
      ...owner,
      supplierId: supplier.id,
      supplierSlug: supplier.slug,
      categoryId: category.id,
      productId: product.id,
      productName,
      shopSettingsId: settings.id,
      originalSellerSettings,
    };
  } catch (error) {
    if (shopSettingsId && originalSellerSettings) {
      await db.update(shopSettingsTable).set(originalSellerSettings).where(eq(shopSettingsTable.id, shopSettingsId));
    }
    if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
    if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
    if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
    await cleanUpOwnerFixture(owner);
    throw error;
  }
}

async function cleanUpOwnerFixture(fixture: OwnerFixture): Promise<void> {
  // Delivery rows use SET NULL on salon deletion, so remove fixture-owned
  // outbox records first rather than leaving anonymized test residue.
  await db.delete(emailDeliveriesTable).where(eq(emailDeliveriesTable.salonId, fixture.salonId));
  await db.delete(smsDeliveriesTable).where(eq(smsDeliveriesTable.salonId, fixture.salonId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function cleanUpShopFixture(fixture: ShopFixture): Promise<void> {
  // Loyalty entries RESTRICT order/salon deletion. Order items and status
  // history cascade from the order; carts and notifications cascade from salon.
  await db.delete(loyaltyPointLedgerTable).where(eq(loyaltyPointLedgerTable.salonId, fixture.salonId));
  await db.delete(ordersTable).where(eq(ordersTable.salonId, fixture.salonId));
  await db.delete(productsTable).where(eq(productsTable.id, fixture.productId));
  await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, fixture.categoryId));
  await db.delete(suppliersTable).where(eq(suppliersTable.id, fixture.supplierId));
  await cleanUpOwnerFixture(fixture);
  const restored = await db.update(shopSettingsTable).set({
    ...fixture.originalSellerSettings,
  }).where(and(
    eq(shopSettingsTable.id, fixture.shopSettingsId),
    eq(shopSettingsTable.sellerContactEmail, `${fixture.marker}-seller@example.invalid`),
    eq(shopSettingsTable.version, fixture.originalSellerSettings.version + 1),
  )).returning({ id: shopSettingsTable.id });
  if (restored.length !== 1) {
    throw new Error("Refused to overwrite concurrently changed shop settings during B2B fixture cleanup.");
  }
}

async function signIn(page: Page, fixture: OwnerFixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The marker-owned SALON_OWNER must be able to sign in.").toBeOK();
}

test("SALON_OWNER creates, edits, activates and pauses an automation without deliveries", async ({ page }) => {
  const fixture = await createOwnerFixture("browser-automation-lifecycle");
  const initialName = `Nemoguća publika ${fixture.marker}`;
  const editedName = `Nemoguća publika izmenjena ${fixture.marker}`;

  try {
    await signIn(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    await page.getByRole("button", { name: "Novo pravilo" }).click();
    const createDialog = page.getByRole("dialog", { name: "Nova automatizacija" });
    await createDialog.locator("input").nth(0).fill(initialName);
    await createDialog.locator("select").nth(0).selectOption("visit_count");
    await createDialog.locator("input").nth(1).fill("999999");
    await createDialog.locator("select").nth(1).selectOption("send_email_and_sms");
    await createDialog.locator("input").nth(2).fill(`Nikad poslato ${fixture.marker}`);
    await createDialog.locator("textarea").nth(0).fill("Ova poruka nema nijednog primaoca.");
    await createDialog.locator("textarea").nth(1).fill("Ova SMS poruka nema nijednog primaoca.");
    await createDialog.getByRole("button", { name: "Sačuvaj pravilo" }).click();

    const ruleCard = page.getByRole("heading", { name: `${initialName} Pauzirano` })
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' border ')][1]");
    await expect(ruleCard).toBeVisible();
    await expect(ruleCard).toContainText("Pauzirano");

    const [created] = await db.select().from(automationRulesTable).where(and(
      eq(automationRulesTable.salonId, fixture.salonId),
      eq(automationRulesTable.name, initialName),
    ));
    expect(created, "UI create must persist exactly one marker-owned rule.").toBeDefined();
    expect(created?.status).toBe("draft");

    await ruleCard.getByRole("button", { name: "Izmeni" }).click();
    const editDialog = page.getByRole("dialog", { name: "Izmeni automatizaciju" });
    await editDialog.locator("input").nth(0).fill(editedName);
    await editDialog.locator("input").nth(1).fill("999998");
    await editDialog.getByRole("button", { name: "Sačuvaj pravilo" }).click();

    await page.reload();
    const editedCard = page.getByRole("heading", { name: `${editedName} Pauzirano` })
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' border ')][1]");
    await expect(editedCard).toBeVisible();
    await expect(editedCard).toContainText("Broj poseta dostigao (999998)");

    const [persisted] = await db.select().from(automationRulesTable).where(eq(automationRulesTable.id, created!.id));
    expect(persisted).toMatchObject({
      name: editedName,
      trigger: "visit_count",
      triggerConfig: { visitCount: 999998 },
      action: "send_email_and_sms",
    });

    await editedCard.getByRole("button", { name: "Aktiviraj" }).click();
    const activeCard = page.getByRole("heading", { name: `${editedName} Aktivno` })
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' border ')][1]");
    await expect(activeCard.getByRole("button", { name: "Pauziraj" })).toBeVisible();
    await expect.poll(async () => (
      await db.select({ status: automationRulesTable.status })
        .from(automationRulesTable).where(eq(automationRulesTable.id, created!.id))
    )[0]?.status).toBe("active");

    // Pause as soon as activation is acknowledged by the visible UI.
    await activeCard.getByRole("button", { name: "Pauziraj" }).click();
    await expect(page.getByRole("heading", { name: `${editedName} Pauzirano` })).toBeVisible();
    await page.reload();
    const pausedCard = page.getByRole("heading", { name: `${editedName} Pauzirano` })
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' border ')][1]");
    await expect(pausedCard).toContainText("Pauzirano");
    await expect(pausedCard.getByRole("button", { name: "Aktiviraj" })).toBeVisible();
    await expect.poll(async () => (
      await db.select({ status: automationRulesTable.status })
        .from(automationRulesTable).where(eq(automationRulesTable.id, created!.id))
    )[0]?.status).toBe("paused");

    const runs = await db.select({ id: automationRunsTable.id }).from(automationRunsTable)
      .where(eq(automationRunsTable.ruleId, created!.id));
    const deliveries = await db.select({ id: automationDeliveriesTable.id }).from(automationDeliveriesTable)
      .where(eq(automationDeliveriesTable.salonId, fixture.salonId));
    const emailOutbox = await db.select({ id: emailDeliveriesTable.id }).from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.salonId, fixture.salonId));
    const smsOutbox = await db.select({ id: smsDeliveriesTable.id }).from(smsDeliveriesTable)
      .where(eq(smsDeliveriesTable.salonId, fixture.salonId));
    expect({ runs: runs.length, deliveries: deliveries.length, emailOutbox: emailOutbox.length, smsOutbox: smsOutbox.length })
      .toEqual({ runs: 0, deliveries: 0, emailOutbox: 0, smsOutbox: 0 });
  } finally {
    await cleanUpOwnerFixture(fixture);
  }
});

test("SALON_OWNER completes canonical B2B checkout and sees the persisted order detail", async ({ page }) => {
  const fixture = await createShopFixture();
  let orderId: string | undefined;

  try {
    await signIn(page, fixture);
    await page.goto(`/vlasnik/shop/${fixture.supplierSlug}`);

    await expect(page.getByText(fixture.productName, { exact: true })).toBeVisible();
    await page.getByTestId(`button-add-cart-${fixture.productId}`).click();
    await expect(page.getByText("Dodato u korpu")).toBeVisible();

    await page.goto("/vlasnik/prodavnica/korpa");
    await expect(page.getByRole("heading", { name: fixture.productName })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: fixture.productName })).toBeVisible();
    await page.getByRole("link", { name: "Nastavi na dostavu" }).click();

    await expect(page.getByRole("heading", { name: "Dostava i faktura" })).toBeVisible();
    await page.getByRole("button", { name: "Nastavi na pregled i plaćanje" }).click();
    await expect(page.getByRole("heading", { name: "Pregled i plaćanje" })).toBeVisible();
    await expect(page.getByText(fixture.productName, { exact: false })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Potvrdi porudžbinu" }).click();

    await expect(page.getByRole("heading", { name: "Hvala vam na porudžbini!" })).toBeVisible();
    const orders = await db.select().from(ordersTable).where(eq(ordersTable.salonId, fixture.salonId));
    expect(orders, "Canonical checkout must create one marker-owned order.").toHaveLength(1);
    orderId = orders[0]!.id;
    expect(orders[0]).toMatchObject({
      salonId: fixture.salonId,
      status: "pending",
      subtotal: 20_000,
      paymentMethod: "BANK_TRANSFER",
    });
    expect(orders[0]!.total).toBe(orders[0]!.subtotal + orders[0]!.shippingCost);
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productId: fixture.productId,
      productName: fixture.productName,
      productSku: `BROWSER-B2B-${fixture.marker}`,
      quantity: 1,
      price: 20_000,
    });

    await page.reload();
    await expect(page.getByText(`#${orderId.slice(0, 8).toUpperCase()}`, { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "Prati status porudžbine" }).click();
    await expect(page).toHaveURL(new RegExp(`/vlasnik/porudzbine/${orderId}$`));
    await expect(page.getByText(fixture.productName, { exact: true })).toBeVisible();

    await page.goto("/vlasnik/porudzbine");
    await page.reload();
    const orderCard = page.locator("div.rounded-xl")
      .filter({ has: page.getByText(`#${orderId.slice(0, 8)}`, { exact: true }) })
      .filter({ has: page.getByRole("link", { name: "Detalji" }) })
      .first();
    await expect(orderCard).toBeVisible();
    await orderCard.getByRole("link", { name: "Detalji" }).click();
    await page.reload();
    await expect(page.getByText(fixture.productName, { exact: true })).toBeVisible();
    await expect(page.getByText(`${orders[0]!.total.toLocaleString("sr-RS")} RSD`, { exact: true }).last()).toBeVisible();
  } finally {
    await cleanUpShopFixture(fixture);
  }
});