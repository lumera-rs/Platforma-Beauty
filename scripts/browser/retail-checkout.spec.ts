import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  productCategoriesTable,
  productsTable,
  retailCartItemsTable,
  retailCartsTable,
  retailOrderItemsTable,
  retailOrdersTable,
  shippingRulesTable,
} from "@workspace/db";

type CheckoutPreview = {
  cart: { id: string; subtotal: number };
  shipping: { shippingCost: number };
  total: number;
};
type CheckoutOrder = {
  id: string;
  subtotal: number;
  shippingCost: number;
  total: number;
};

const createdCartIds: string[] = [];
const createdOrderIds: string[] = [];
let categoryId: string | undefined;
let productId: string | undefined;
let shippingRuleId: string | undefined;

const money = (amount: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency",
  currency: "RSD",
  maximumFractionDigits: 0,
}).format(amount);

async function createCartAndOpenCheckout(page: Page) {
  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { id: string };
  createdCartIds.push(cart.id);
  const addResponse = await page.request.post("/api/retail/cart/items", {
    data: { productId, quantity: 1 },
  });
  expect(addResponse.status()).toBe(201);
  await page.goto("/korpa/placanje");
}

async function fillCheckoutContact(page: Page, city: string) {
  const textInputs = page.locator('input[type="text"]');
  await textInputs.nth(0).fill("Retail");
  await textInputs.nth(1).fill("Kupac");
  await page.locator('input[type="email"]').fill(`retail-browser-${randomUUID()}@example.test`);
  await textInputs.nth(2).fill("+381601234567");
  await textInputs.nth(3).fill("Test ulica 1");
  await textInputs.nth(4).fill(city);
  await textInputs.nth(5).fill("11000");
}

async function assertDisplayedAndSavedTotal(
  page: Page,
  deliveryMethod: "courier" | "personal_belgrade",
  city: string,
) {
  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, city);

  if (deliveryMethod === "personal_belgrade") {
    await page.locator('input[type="radio"]').nth(1).check();
    const previewResponse = await page.request.get(
      `/api/retail/checkout-preview?deliveryMethod=personal_belgrade&city=${encodeURIComponent(city)}`,
    );
    expect(previewResponse.ok()).toBe(true);
    const preview = await previewResponse.json() as CheckoutPreview;
    await expect(page.getByText(money(preview.total), { exact: true })).toBeVisible();
    await submitAndAssertOrder(page, preview);
    return;
  }

  await page.locator('input[type="radio"]').first().check();
  const previewResponse = await page.request.get(
    `/api/retail/checkout-preview?deliveryMethod=courier&city=${encodeURIComponent(city)}`,
  );
  expect(previewResponse.ok()).toBe(true);
  const preview = await previewResponse.json() as CheckoutPreview;
  await expect(page.getByText(money(preview.total), { exact: true })).toBeVisible();
  await submitAndAssertOrder(page, preview);
}

async function submitAndAssertOrder(page: Page, preview: CheckoutPreview) {
  const checkoutResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/retail/checkout" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Potvrdi porudžbinu" }).click();
  const response = await checkoutResponse;
  expect(response.status()).toBe(201);
  const order = await response.json() as CheckoutOrder;
  createdOrderIds.push(order.id);
  expect(order.subtotal).toBe(preview.cart.subtotal);
  expect(order.shippingCost).toBe(preview.shipping.shippingCost);
  expect(order.total).toBe(preview.total);
  await expect(page.getByRole("heading", { name: "Porudžbina je primljena" })).toBeVisible();

  const [persisted] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, order.id)).limit(1);
  expect(persisted?.subtotal).toBe(preview.cart.subtotal);
  expect(persisted?.shippingCost).toBe(preview.shipping.shippingCost);
  expect(persisted?.total).toBe(preview.total);
}

test.beforeAll(async () => {
  const suffix = randomUUID();
  const [shippingRule] = await db.insert(shippingRulesTable).values({
    freeShippingThreshold: 10_000,
    tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    personalDeliveryEnabled: true,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 650,
    personalDeliveryDescription: "Test lična dostava.",
  }).returning();
  shippingRuleId = shippingRule!.id;

  const [category] = await db.insert(productCategoriesTable).values({
    name: `Retail browser ${suffix}`,
    slug: `retail-browser-${suffix}`,
    active: true,
  }).returning();
  categoryId = category!.id;
  const [product] = await db.insert(productsTable).values({
    categoryId: category!.id,
    categoryName: category!.name,
    name: `Retail browser proizvod ${suffix}`,
    description: "Test proizvod za browser checkout.",
    publicDescription: "Javni opis retail proizvoda.",
    imageUrl: "/retail-browser-test.jpg",
    price: 2_500,
    publicPrice: 2_500,
    publicDiscountPrice: 2_000,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 8,
    sku: `retail-browser-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  productId = product!.id;
});

test.afterAll(async () => {
  if (createdOrderIds.length) {
    await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, createdOrderIds));
    await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, createdOrderIds));
  }
  if (createdCartIds.length) {
    await db.delete(retailCartItemsTable).where(inArray(retailCartItemsTable.cartId, createdCartIds));
    await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, createdCartIds));
  }
  if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
  if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
  if (shippingRuleId) await db.delete(shippingRulesTable).where(eq(shippingRulesTable.id, shippingRuleId));
});

test("retail checkout displays and saves identical totals for courier and personal delivery", async ({ page }) => {
  await assertDisplayedAndSavedTotal(page, "courier", "Novi Sad");
  await page.context().clearCookies();
  await assertDisplayedAndSavedTotal(page, "personal_belgrade", "Beograd");
});

test("retail checkout refreshes a changed quote before allowing confirmation again", async ({ page }) => {
  let holdRefreshedPreview = false;
  let notifyRefreshStarted: (() => void) | undefined;
  let releaseRefreshedPreview: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => { notifyRefreshStarted = resolve; });
  const releasePreview = new Promise<void>((resolve) => { releaseRefreshedPreview = resolve; });
  await page.route("**/api/retail/checkout-preview?**", async (route) => {
    if (holdRefreshedPreview) {
      notifyRefreshStarted?.();
      await releasePreview;
    }
    await route.continue();
  });

  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button");
  await expect(confirmButton).toBeEnabled();

  expect(productId).toBeTruthy();
  await db.update(productsTable).set({ publicDiscountPrice: 1_800 }).where(eq(productsTable.id, productId!));
  holdRefreshedPreview = true;
  try {
    const checkoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/retail/checkout" && response.request().method() === "POST",
    );
    await confirmButton.click();
    const response = await checkoutResponse;
    expect(response.status()).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("CHECKOUT_QUOTE_CHANGED");

    await refreshStarted;
    await expect(confirmButton).toBeDisabled();
    releaseRefreshedPreview?.();

    await expect(page.getByRole("status")).toContainText("Promena iznosa je osvežena");
    await expect(page.getByRole("status")).toContainText(`Dostava je sada ${money(390)}`);
    await expect(page.getByRole("status")).toContainText(`ukupno za plaćanje ${money(2_190)}`);
    await expect(page.getByText(money(2_190), { exact: true })).toBeVisible();
    await expect(confirmButton).toBeEnabled();
  } finally {
    releaseRefreshedPreview?.();
    await db.update(productsTable).set({ publicDiscountPrice: 2_000 }).where(eq(productsTable.id, productId!));
  }
});

test("retail checkout refreshes a changed delivery fee before allowing confirmation again", async ({ page }) => {
  let holdRefreshedPreview = false;
  let notifyRefreshStarted: (() => void) | undefined;
  let releaseRefreshedPreview: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => { notifyRefreshStarted = resolve; });
  const releasePreview = new Promise<void>((resolve) => { releaseRefreshedPreview = resolve; });
  await page.route("**/api/retail/checkout-preview?**", async (route) => {
    if (holdRefreshedPreview) {
      notifyRefreshStarted?.();
      await releasePreview;
    }
    await route.continue();
  });

  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button");
  await expect(confirmButton).toBeEnabled();

  expect(shippingRuleId).toBeTruthy();
  await db.update(shippingRulesTable).set({
    tiers: [{ maxWeightGrams: 1_000, price: 590, label: "do 1 kg" }],
  }).where(eq(shippingRulesTable.id, shippingRuleId!));
  holdRefreshedPreview = true;
  try {
    const checkoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/retail/checkout" && response.request().method() === "POST",
    );
    await confirmButton.click();
    const response = await checkoutResponse;
    expect(response.status()).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("CHECKOUT_QUOTE_CHANGED");

    await refreshStarted;
    await expect(confirmButton).toBeDisabled();
    releaseRefreshedPreview?.();

    await expect(page.getByRole("status")).toContainText("Promena iznosa je osvežena");
    await expect(page.getByRole("status")).toContainText(`Dostava je sada ${money(590)}`);
    await expect(page.getByRole("status")).toContainText(`ukupno za plaćanje ${money(2_590)}`);
    await expect(page.getByText(money(2_590), { exact: true })).toBeVisible();
    await expect(confirmButton).toBeEnabled();
  } finally {
    releaseRefreshedPreview?.();
    await db.update(shippingRulesTable).set({
      tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    }).where(eq(shippingRulesTable.id, shippingRuleId!));
  }
});

test("retail checkout offers a retry after a failed quote refresh", async ({ page }) => {
  let failNextPreview = false;
  await page.route("**/api/retail/checkout-preview?**", async (route) => {
    if (failNextPreview) {
      failNextPreview = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privremeno nije moguće osvežiti pregled." }),
      });
      return;
    }
    await route.continue();
  });

  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button", { name: "Potvrdi porudžbinu" });
  await expect(confirmButton).toBeEnabled();

  expect(productId).toBeTruthy();
  await db.update(productsTable).set({ publicDiscountPrice: 1_800 }).where(eq(productsTable.id, productId!));
  failNextPreview = true;
  try {
    const checkoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/retail/checkout" && response.request().method() === "POST",
    );
    await confirmButton.click();
    const response = await checkoutResponse;
    expect(response.status()).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("CHECKOUT_QUOTE_CHANGED");

    const retryButton = page.getByRole("button", { name: "Pokušaj ponovo" });
    await expect(retryButton).toBeVisible();
    await expect(confirmButton).toBeDisabled();
    await expect(page.getByText(money(2_390), { exact: true })).not.toBeVisible();

    await retryButton.click();
    await expect(retryButton).not.toBeVisible();
    await expect(page.getByRole("status")).toContainText("Promena iznosa je osvežena");
    await expect(page.getByText(money(2_190), { exact: true })).toBeVisible();
    await expect(confirmButton).toBeEnabled();
  } finally {
    await db.update(productsTable).set({ publicDiscountPrice: 2_000 }).where(eq(productsTable.id, productId!));
  }
});

test("retail checkout cannot submit an old preview after the item becomes unavailable", async ({ page }) => {
  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button");
  await expect(confirmButton).toBeEnabled();

  expect(productId).toBeTruthy();
  const [product] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, productId!)).limit(1);
  expect(product).toBeTruthy();
  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, productId!));
  try {
    const checkoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/retail/checkout" && response.request().method() === "POST",
    );
    await confirmButton.click();
    const response = await checkoutResponse;
    expect(response.status()).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("CHECKOUT_QUOTE_CHANGED");
    await expect(confirmButton).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Porudžbina je primljena" })).not.toBeVisible();
  } finally {
    await db.update(productsTable).set({ stock: product!.stock }).where(eq(productsTable.id, productId!));
  }
});