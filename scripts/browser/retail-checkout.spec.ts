import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { asc, eq, inArray } from "drizzle-orm";
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
let productName: string | undefined;

let secondProductId: string | undefined;
let sameNameProductId: string | undefined;
let shippingRuleId: string | undefined;

let previousShippingRule: typeof shippingRulesTable.$inferSelect | undefined;
const money = (amount: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency",
  currency: "RSD",
  maximumFractionDigits: 0,
}).format(amount);

async function createCartAndOpenCheckout(page: Page, productIds: string[] = [productId!]) {
  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { id: string };
  createdCartIds.push(cart.id);
  for (const productIdToAdd of productIds) {
    const addResponse = await page.request.post("/api/retail/cart/items", {
      data: { productId: productIdToAdd, quantity: 1 },
    });
    expect(addResponse.status()).toBe(201);
  }
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
  const shippingValues = {
    freeShippingThreshold: 10_000,
    tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    personalDeliveryEnabled: true,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 650,
    personalDeliveryDescription: "Test lična dostava.",
  };
  [previousShippingRule] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  if (previousShippingRule) {
    await db.update(shippingRulesTable).set({
      ...shippingValues,
      updatedAt: new Date(),
    }).where(eq(shippingRulesTable.id, previousShippingRule.id));
    shippingRuleId = previousShippingRule.id;
  } else {
    const [shippingRule] = await db.insert(shippingRulesTable).values(shippingValues).returning();
    shippingRuleId = shippingRule!.id;
  }

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
  productName = product!.name;

  const [secondProduct] = await db.insert(productsTable).values({
    categoryId: category!.id,
    categoryName: category!.name,
    name: `Drugi retail browser proizvod ${suffix}`,
    description: "Drugi test proizvod za browser checkout.",
    publicDescription: "Javni opis drugog retail proizvoda.",
    imageUrl: "/retail-browser-second-test.jpg",
    price: 3_000,
    publicPrice: 3_000,
    publicDiscountPrice: 2_400,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 8,
    sku: `retail-browser-second-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  secondProductId = secondProduct!.id;

  const [sameNameProduct] = await db.insert(productsTable).values({
    categoryId: category!.id,
    categoryName: category!.name,
    name: productName!,
    description: "Drugi proizvod sa istim nazivom za test obaveštenja.",
    publicDescription: "Javni opis drugog proizvoda sa istim nazivom.",
    imageUrl: "/retail-browser-same-name-test.jpg",
    price: 3_000,
    publicPrice: 3_000,
    publicDiscountPrice: 2_400,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 8,
    sku: `retail-browser-same-name-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  sameNameProductId = sameNameProduct!.id;
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
  if (secondProductId) await db.delete(productsTable).where(eq(productsTable.id, secondProductId));
  if (sameNameProductId) await db.delete(productsTable).where(eq(productsTable.id, sameNameProductId));
  if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
  if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
  if (previousShippingRule) {
    await db.update(shippingRulesTable).set({
      freeShippingThreshold: previousShippingRule.freeShippingThreshold,
      tiers: previousShippingRule.tiers,
      personalDeliveryEnabled: previousShippingRule.personalDeliveryEnabled,
      personalDeliveryName: previousShippingRule.personalDeliveryName,
      personalDeliveryPrice: previousShippingRule.personalDeliveryPrice,
      personalDeliveryDescription: previousShippingRule.personalDeliveryDescription,
      updatedAt: previousShippingRule.updatedAt,
    }).where(eq(shippingRulesTable.id, previousShippingRule.id));
  } else if (shippingRuleId) {
    await db.delete(shippingRulesTable).where(eq(shippingRulesTable.id, shippingRuleId));
  }
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

    const conflict = await response.json() as { code?: string };
    expect(response.status()).toBe(409);
    expect(conflict.code).toBe("CHECKOUT_QUOTE_CHANGED");

    await refreshStarted;
    await expect(confirmButton).toBeDisabled();
    releaseRefreshedPreview?.();

    const quoteStatus = page.locator('[role="status"]').filter({ hasText: "Promena iznosa je osvežena" });
    await expect(quoteStatus).toContainText("Promena iznosa je osvežena");
    await expect(quoteStatus).toContainText(`Dostava je sada ${money(390)}`);
    await expect(quoteStatus).toContainText(`ukupno za plaćanje ${money(2_190)}`);
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

    const conflict = await response.json() as { code?: string };
    expect(response.status()).toBe(409);
    expect(conflict.code).toBe("CHECKOUT_QUOTE_CHANGED");

    await refreshStarted;
    await expect(confirmButton).toBeDisabled();
    releaseRefreshedPreview?.();

    const quoteStatus = page.locator('[role="status"]').filter({ hasText: "Promena iznosa je osvežena" });
    await expect(quoteStatus).toContainText("Promena iznosa je osvežena");
    await expect(quoteStatus).toContainText(`Dostava je sada ${money(590)}`);
    await expect(quoteStatus).toContainText(`ukupno za plaćanje ${money(2_590)}`);
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

    const conflict = await response.json() as { code?: string };
    expect(response.status()).toBe(409);
    expect(conflict.code).toBe("CHECKOUT_QUOTE_CHANGED");

    const retryButton = page.getByRole("button", { name: "Pokušaj ponovo" });
    await expect(retryButton).toBeVisible();
    await expect(confirmButton).toBeDisabled();
    await expect(page.getByText(money(2_390), { exact: true })).not.toBeVisible();

    await retryButton.click();
    await expect(retryButton).not.toBeVisible();
    await expect(page.locator('[role="status"]').filter({ hasText: "Promena iznosa je osvežena" })).toContainText("Promena iznosa je osvežena");
    await expect(page.getByText(money(2_190), { exact: true })).toBeVisible();
    await expect(confirmButton).toBeEnabled();
  } finally {
    await db.update(productsTable).set({ publicDiscountPrice: 2_000 }).where(eq(productsTable.id, productId!));
  }
});

test("retail checkout offers a retry after the initial quote fails without reloading", async ({ page }) => {
  let allowPreview = false;
  const previewRequests: string[] = [];
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });
  await page.route("**/api/retail/checkout-preview?**", async (route) => {
    previewRequests.push(route.request().url());
    if (!allowPreview) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privremeno nije moguće učitati pregled." }),
      });
      return;
    }
    await route.continue();
  });

  await createCartAndOpenCheckout(page);
  const checkoutUrl = page.url();
  const confirmButton = page.locator("form").getByRole("button", { name: "Potvrdi porudžbinu" });
  const retryButton = page.getByRole("button", { name: "Pokušaj ponovo" });
  await expect(retryButton).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Privremeno nije moguće učitati pregled.");
  await expect(confirmButton).toBeDisabled();

  await fillCheckoutContact(page, "Beograd");
  await page.locator('input[type="radio"]').nth(1).check();
  await expect(retryButton).toBeVisible();

  allowPreview = true;
  const retriedPreview = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/retail/checkout-preview"
      && url.searchParams.get("deliveryMethod") === "personal_belgrade"
      && url.searchParams.get("city") === "Beograd";
  });
  await retryButton.click();
  await retriedPreview;

  await expect(retryButton).not.toBeVisible();
  await expect(page.locator('[role="status"]').filter({ hasText: "Promena iznosa je osvežena" })).toContainText("Promena iznosa je osvežena");
  await expect(confirmButton).toBeEnabled();
  expect(page.url()).toBe(checkoutUrl);
  expect(mainFrameNavigations).toBe(1);
  expect(previewRequests.length).toBeGreaterThanOrEqual(3);
});

test("retail checkout detects a cart changed in another tab and refreshes before confirmation", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button", { name: "Potvrdi porudžbinu" });
  await expect(confirmButton).toBeEnabled();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { items: Array<{ id: string }> };
  expect(cart.items.length).toBe(1);
  const patchResponse = await page.request.patch(`/api/retail/cart/items/${cart.items[0]!.id}`, {
    data: { quantity: 2 },
  });
  expect(patchResponse.ok()).toBe(true);

  const changeAlert = page.getByRole("alert").filter({ hasText: "Korpa je u međuvremenu izmenjena" });
  await expect(changeAlert).toBeVisible({ timeout: 15_000 });
  await expect(changeAlert).toContainText("Osvežite pregled");
  await expect(confirmButton).toBeDisabled();

  await changeAlert.getByRole("button", { name: "Osveži pregled" }).click();
  const quoteStatus = page.locator('[role="status"]').filter({ hasText: "Promena iznosa je osvežena" });
  await expect(quoteStatus).toContainText("Promena iznosa je osvežena");
  await expect(quoteStatus).toContainText(`ukupno za plaćanje ${money(4_390)}`);
  await expect(page.getByText(money(4_390), { exact: true })).toBeVisible();
  await expect(changeAlert).not.toBeVisible();
  await expect(confirmButton).toBeEnabled();
  expect(page.url()).toContain("/korpa/placanje");
  expect(mainFrameNavigations).toBe(1);
});

test("retail checkout backs out to the empty-cart state when the cart is emptied in another tab", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });
  const checkoutSubmissions: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/retail/checkout" && request.method() === "POST") {
      checkoutSubmissions.push(request.url());
    }
  });

  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const checkoutUrl = page.url();
  const paymentForm = page.locator("form");
  const confirmButton = paymentForm.getByRole("button");
  await expect(confirmButton).toBeEnabled();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { items: Array<{ id: string }> };
  expect(cart.items.length).toBeGreaterThan(0);
  for (const item of cart.items) {
    const deleteResponse = await page.request.delete(`/api/retail/cart/items/${item.id}`);
    expect(deleteResponse.ok()).toBe(true);
  }

  // The poll must drop the stale quote and leave the payment form entirely.
  await expect(page.getByRole("paragraph").filter({ hasText: "Korpa je prazna." })).toBeVisible({ timeout: 15_000 });
  const browseProductsLink = page.getByRole("link", { name: "Pregledajte proizvode" });
  await expect(browseProductsLink).toBeVisible();
  await expect(browseProductsLink).toHaveAttribute("href", "/proizvodi");
  await expect(paymentForm).toHaveCount(0);
  await expect(confirmButton).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // No confirmation was ever submitted and the transition happened without a reload.
  expect(checkoutSubmissions).toEqual([]);
  expect(page.url()).toBe(checkoutUrl);
  expect(mainFrameNavigations).toBe(1);
});

test("retail checkout recovers when an item is added after the cart was emptied elsewhere", async ({ page }) => {
  let holdRecoveryPreview = false;
  let notifyRecoveryPreviewStarted: (() => void) | undefined;
  let releaseRecoveryPreview: (() => void) | undefined;
  const recoveryPreviewStarted = new Promise<void>((resolve) => { notifyRecoveryPreviewStarted = resolve; });
  const releasePreview = new Promise<void>((resolve) => { releaseRecoveryPreview = resolve; });
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });
  await page.route("**/api/retail/checkout-preview?**", async (route) => {
    if (holdRecoveryPreview) {
      notifyRecoveryPreviewStarted?.();
      await releasePreview;
    }
    await route.continue();
  });

  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const checkoutUrl = page.url();
  const paymentForm = page.locator("form");
  const confirmButton = paymentForm.getByRole("button");
  await expect(confirmButton).toBeEnabled();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { items: Array<{ id: string }> };
  expect(cart.items.length).toBeGreaterThan(0);
  for (const item of cart.items) {
    const deleteResponse = await page.request.delete(`/api/retail/cart/items/${item.id}`);
    expect(deleteResponse.ok()).toBe(true);
  }

  await expect(page.getByRole("paragraph").filter({ hasText: "Korpa je prazna." })).toBeVisible({ timeout: 15_000 });
  await expect(paymentForm).toHaveCount(0);

  holdRecoveryPreview = true;
  try {
    const recoveryPreviewRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/retail/checkout-preview"
        && url.searchParams.get("deliveryMethod") === "courier"
        && url.searchParams.get("city") === "Novi Sad";
    });
    const addResponse = await page.request.post("/api/retail/cart/items", {
      data: { productId, quantity: 1 },
    });
    expect(addResponse.status()).toBe(201);

    await expect(paymentForm).toBeVisible({ timeout: 15_000 });
    await recoveryPreviewRequest;
    await recoveryPreviewStarted;
    await expect(confirmButton).toBeDisabled();
    expect(page.url()).toBe(checkoutUrl);

    releaseRecoveryPreview?.();
    await expect(confirmButton).toBeEnabled();
    await expect(page.getByText(money(2_390), { exact: true })).toBeVisible();
    expect(mainFrameNavigations).toBe(1);
  } finally {
    releaseRecoveryPreview?.();
  }
});

async function createCartAndOpenCartPage(page: Page, productIds: string[] = [productId!]) {
  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { id: string };
  createdCartIds.push(cart.id);
  for (const productIdToAdd of productIds) {
    const addResponse = await page.request.post("/api/retail/cart/items", {
      data: { productId: productIdToAdd, quantity: 1 },
    });
    expect(addResponse.status()).toBe(201);
  }
  await page.goto("/korpa");
  await expect(page.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
}

test("retail cart page updates lines and totals when the cart changes in another tab", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCartPage(page);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { items: Array<{ id: string }> };
  expect(cart.items.length).toBe(1);
  const patchResponse = await page.request.patch(`/api/retail/cart/items/${cart.items[0]!.id}`, {
    data: { quantity: 3 },
  });
  expect(patchResponse.ok()).toBe(true);

  await expect(page.getByText(money(6_000), { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  expect(mainFrameNavigations).toBe(1);
});

test("retail cart page announces a cross-tab line change without reloading", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCartPage(page);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  const otherTab = await page.context().newPage();
  try {
    await otherTab.goto("/korpa");
    await expect(otherTab.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
    await otherTab.getByRole("button", { name: `Povećaj količinu proizvoda ${productName}` }).click();

    await expect(page.getByTestId("status-cart-announcement")).toHaveText("Korpa sada ima 2 stavki.");
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText(
      `Proizvod ${productName} sada ima količinu 2.`,
    );
    await expect(page.getByText(money(4_000), { exact: true }).first()).toBeVisible();
    expect(mainFrameNavigations).toBe(1);
  } finally {
    await otherTab.close();
  }
});

test("retail cart coalesces rapid cross-tab announcements to the settled count", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCartPage(page);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  await page.evaluate(() => {
    const values: string[] = [];
    const count = document.querySelector('[data-testid="status-cart-announcement"]');
    const observer = new MutationObserver(() => {
      const value = count?.textContent ?? "";
      if (value && !values.includes(value)) values.push(value);
    });
    if (count) observer.observe(count, { childList: true, characterData: true, subtree: true });
    (window as Window & { __cartAnnouncementValues?: string[] }).__cartAnnouncementValues = values;
  });

  const otherTab = await page.context().newPage();
  try {
    await otherTab.goto("/korpa");
    await expect(otherTab.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
    const cartResponse = await otherTab.request.get("/api/retail/cart");
    expect(cartResponse.ok()).toBe(true);
    const cart = await cartResponse.json() as { items: Array<{ id: string }> };
    expect(cart.items).toHaveLength(1);
    const patchResponse = await otherTab.request.patch(`/api/retail/cart/items/${cart.items[0]!.id}`, {
      data: { quantity: 4 },
    });
    expect(patchResponse.ok()).toBe(true);

    await otherTab.evaluate(async () => {
      const key = "lumera:retail-cart-sync";
      for (const [itemCount, quantity] of [[2, 2], [3, 3], [4, 4]]) {
        localStorage.setItem(key, JSON.stringify({
          itemCount,
          changedItem: { name: "settled test item", productId: "settled-test-product", quantity },
          nonce: `${itemCount}-${quantity}`,
        }));
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
    });

    await expect(page.getByTestId("status-cart-announcement")).toHaveText("Korpa sada ima 4 stavki.", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText(
      "Proizvod settled test item sada ima količinu 4.",
    );
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __cartAnnouncementValues?: string[] }).__cartAnnouncementValues ?? [],
    )).toEqual(["Korpa sada ima 4 stavki."]);
    await expect(page.getByText(money(8_000), { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain("/korpa");
    expect(mainFrameNavigations).toBe(1);
  } finally {
    await otherTab.close();
  }
});

test("retail cart page clears a stale item announcement for a multi-line cross-tab update", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCartPage(page, [productId!, secondProductId!]);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  const otherTab = await page.context().newPage();
  try {
    await otherTab.goto("/korpa");
    await expect(otherTab.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
    const cartResponse = await otherTab.request.get("/api/retail/cart");
    expect(cartResponse.ok()).toBe(true);
    const cart = await cartResponse.json() as { items: Array<{ id: string; productId: string; quantity: number }> };
    expect(cart.items).toHaveLength(2);

    const firstItem = cart.items.find((item) => item.productId === productId);
    const secondItem = cart.items.find((item) => item.productId === secondProductId);
    expect(firstItem).toBeTruthy();
    expect(secondItem).toBeTruthy();

    const firstUpdate = await otherTab.request.patch(`/api/retail/cart/items/${firstItem!.id}`, {
      data: { quantity: 2 },
    });
    expect(firstUpdate.ok()).toBe(true);
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText(
      `Proizvod ${productName} sada ima količinu 2.`,
      { timeout: 15_000 },
    );

    const [updatedFirstItem, updatedSecondItem] = await Promise.all([
      otherTab.request.patch(`/api/retail/cart/items/${firstItem!.id}`, { data: { quantity: 3 } }),
      otherTab.request.patch(`/api/retail/cart/items/${secondItem!.id}`, { data: { quantity: 2 } }),
    ]);
    expect(updatedFirstItem.ok()).toBe(true);
    expect(updatedSecondItem.ok()).toBe(true);

    await expect(page.getByTestId("status-cart-announcement")).toHaveText("Korpa sada ima 5 stavki.", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText("");
    await expect(page.getByText(money(10_800), { exact: true }).first()).toBeVisible();
    expect(page.url()).toContain("/korpa");
    expect(mainFrameNavigations).toBe(1);
  } finally {
    await otherTab.close();
  }
});

test("retail cart suppresses an ambiguous item announcement for same-name products", async ({ page }) => {
  expect(productId).toBeTruthy();
  expect(productName).toBeTruthy();
  expect(sameNameProductId).toBeTruthy();

  await createCartAndOpenCartPage(page, [productId!, sameNameProductId!]);
  await expect(page.getByText(money(4_400), { exact: true }).first()).toBeVisible();

  await page.evaluate(() => {
    const values: string[] = [];
    const count = document.querySelector('[data-testid="status-cart-announcement"]');
    const observer = new MutationObserver(() => {
      const value = count?.textContent ?? "";
      if (value && !values.includes(value)) values.push(value);
    });
    if (count) observer.observe(count, { childList: true, characterData: true, subtree: true });
    (window as Window & { __cartAnnouncementValues?: string[] }).__cartAnnouncementValues = values;
  });

  const otherTab = await page.context().newPage();
  try {
    await otherTab.goto("/korpa");
    await expect(otherTab.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
    const cartResponse = await otherTab.request.get("/api/retail/cart");
    expect(cartResponse.ok()).toBe(true);
    const cart = await cartResponse.json() as {
      items: Array<{ id: string; productId: string; quantity: number }>;
    };
    expect(cart.items).toHaveLength(2);

    const firstItem = cart.items.find((item) => item.productId === productId);
    const sameNameItem = cart.items.find((item) => item.productId === sameNameProductId);
    expect(firstItem).toBeTruthy();
    expect(sameNameItem).toBeTruthy();

    const [firstUpdate, sameNameUpdate] = await Promise.all([
      otherTab.request.patch(`/api/retail/cart/items/${firstItem!.id}`, { data: { quantity: 2 } }),
      otherTab.request.patch(`/api/retail/cart/items/${sameNameItem!.id}`, { data: { quantity: 2 } }),
    ]);
    expect(firstUpdate.ok()).toBe(true);
    expect(sameNameUpdate.ok()).toBe(true);

    await otherTab.evaluate(async ({ firstProductId, sameNameProductId, name }) => {
      const key = "lumera:retail-cart-sync";
      for (const [itemCount, productId, quantity] of [
        [3, firstProductId, 2],
        [4, sameNameProductId, 2],
      ] as const) {
        localStorage.setItem(key, JSON.stringify({
          itemCount,
          changedItem: { name, productId, quantity },
          nonce: `${productId}-${quantity}`,
        }));
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
    }, { firstProductId: productId!, sameNameProductId: sameNameProductId!, name: productName! });

    await expect(page.getByTestId("status-cart-announcement")).toHaveText("Korpa sada ima 4 stavki.", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText("");
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __cartAnnouncementValues?: string[] }).__cartAnnouncementValues ?? [],
    )).toEqual(["Korpa sada ima 4 stavki."]);
    await expect(page.getByText(money(8_800), { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain("/korpa");
  } finally {
    await otherTab.close();
  }
});

test("retail cart distinguishes controls for same-name products", async ({ page }) => {
  expect(productId).toBeTruthy();
  expect(productName).toBeTruthy();
  expect(sameNameProductId).toBeTruthy();

  await createCartAndOpenCartPage(page, [productId!, sameNameProductId!]);
  await expect(page.getByText(money(4_400), { exact: true }).first()).toBeVisible();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as {
    items: Array<{ id: string; productId: string; sku: string; quantity: number }>;
  };
  expect(cart.items).toHaveLength(2);

  const firstItem = cart.items.find((item) => item.productId === productId);
  const sameNameItem = cart.items.find((item) => item.productId === sameNameProductId);
  expect(firstItem).toBeTruthy();
  expect(sameNameItem).toBeTruthy();
  expect(firstItem!.sku).not.toBe(productId);
  expect(sameNameItem!.sku).not.toBe(sameNameProductId);

  const firstLabel = `(šifra proizvoda ${firstItem!.sku})`;
  const sameNameLabel = `(šifra proizvoda ${sameNameItem!.sku})`;
  await expect(page.getByRole("button", { name: `Smanji količinu proizvoda ${productName} ${firstLabel}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Smanji količinu proizvoda ${productName} ${sameNameLabel}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Povećaj količinu proizvoda ${productName} ${firstLabel}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Povećaj količinu proizvoda ${productName} ${sameNameLabel}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Ukloni ${productName} ${firstLabel} iz korpe`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Ukloni ${productName} ${sameNameLabel} iz korpe`, exact: true })).toBeVisible();

  const increaseResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/retail/cart/items/${sameNameItem!.id}`
    && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: `Povećaj količinu proizvoda ${productName} ${sameNameLabel}`, exact: true }).click();
  const increasedCart = await (await increaseResponse).json() as { items: Array<{ productId: string; quantity: number }> };
  expect(increasedCart.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ productId: productId, quantity: 1 }),
    expect.objectContaining({ productId: sameNameProductId, quantity: 2 }),
  ]));

  const removeResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/retail/cart/items/${firstItem!.id}`
    && response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: `Ukloni ${productName} ${firstLabel} iz korpe`, exact: true }).click();
  const remainingCart = await (await removeResponse).json() as { items: Array<{ productId: string; quantity: number }> };
  expect(remainingCart.items.map(({ productId: itemProductId, quantity }) => ({ productId: itemProductId, quantity })))
    .toEqual([{ productId: sameNameProductId, quantity: 2 }]);
});

test("retail cart page announces a cross-tab line removal without reloading", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCartPage(page);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  const otherTab = await page.context().newPage();
  try {
    await otherTab.goto("/korpa");
    await expect(otherTab.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
    await otherTab.getByRole("button", { name: `Ukloni ${productName} iz korpe` }).click();

    await expect(page.getByTestId("status-cart-announcement")).toHaveText("Korpa je prazna.");
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText(
      `Proizvod ${productName} je uklonjen iz korpe.`,
    );
    await expect(page.getByRole("paragraph").filter({ hasText: "Korpa je prazna." })).toBeVisible();
    await expect(page.getByTestId("status-cart-count")).toHaveCount(0);
    expect(page.url()).toContain("/korpa");
    expect(mainFrameNavigations).toBe(1);
  } finally {
    await otherTab.close();
  }
});

test("retail cart page empties without a reload when the cart is cleared in another tab", async ({ page }) => {
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await createCartAndOpenCartPage(page);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { items: Array<{ id: string }> };
  expect(cart.items.length).toBe(1);
  const deleteResponse = await page.request.delete(`/api/retail/cart/items/${cart.items[0]!.id}`);
  expect(deleteResponse.ok()).toBe(true);

  await expect(page.getByRole("paragraph").filter({ hasText: "Korpa je prazna." })).toBeVisible({ timeout: 15_000 });
  expect(mainFrameNavigations).toBe(1);
});

test("retail cart page ignores a stale poll response while a local edit is in flight", async ({ page }) => {
  let holdNextCartGet = false;
  let notifyStaleCaptured: (() => void) | undefined;
  let releaseStaleResponse: (() => void) | undefined;
  const staleCaptured = new Promise<void>((resolve) => { notifyStaleCaptured = resolve; });
  const staleReleased = new Promise<void>((resolve) => { releaseStaleResponse = resolve; });
  await page.route("**/api/retail/cart", async (route) => {
    if (route.request().method() !== "GET" || !holdNextCartGet) {
      await route.continue();
      return;
    }
    holdNextCartGet = false;
    // Capture the server body NOW (still quantity 1), then deliver it only after the
    // local edit has already applied — a genuinely stale poll response.
    const staleResponse = await route.fetch();
    notifyStaleCaptured?.();
    await staleReleased;
    await route.fulfill({ response: staleResponse });
  });

  await createCartAndOpenCartPage(page);
  await expect(page.getByText(money(2_000), { exact: true }).first()).toBeVisible();

  try {
    holdNextCartGet = true;
    // Trigger the focus-driven freshness check so its response is the held stale one.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await staleCaptured;

    // Local edit while the stale poll response is still pending.
    await page.getByRole("button").filter({ has: page.locator("svg.lucide-plus") }).first().click();
    await expect(page.getByText(money(4_000), { exact: true }).first()).toBeVisible();

    releaseStaleResponse?.();
    // The stale quantity-1 body must be discarded, not rendered.
    await page.waitForTimeout(1_000);
    await expect(page.getByText(money(4_000), { exact: true }).first()).toBeVisible();
  } finally {
    releaseStaleResponse?.();
  }
});

test("retail checkout explains unavailable items and offers recovery without creating an order", async ({ page }) => {
  expect(secondProductId).toBeTruthy();
  await createCartAndOpenCheckout(page, [productId!, secondProductId!]);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button", { name: "Potvrdi porudžbinu" });
  await expect(confirmButton).toBeEnabled();

  expect(productId).toBeTruthy();
  const [product] = await db.select({ name: productsTable.name }).from(productsTable)
    .where(eq(productsTable.id, productId!)).limit(1);

  const [secondProduct] = await db.select({ name: productsTable.name, stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, secondProductId!)).limit(1);

  expect(product).toBeTruthy();
  expect(secondProduct).toBeTruthy();
  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, secondProductId!));
  try {
    const checkoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/retail/checkout" && response.request().method() === "POST",
    );
    await confirmButton.click();
    const response = await checkoutResponse;

    const conflict = await response.json() as { code?: string; unavailableItems?: Array<{ productId: string; name: string }> };
    expect(response.status()).toBe(409);
    expect(conflict.code).toBe("CHECKOUT_QUOTE_CHANGED");
    expect(conflict.unavailableItems).toEqual([{ productId: secondProductId, name: secondProduct!.name }]);
    const checkoutCartId = createdCartIds.at(-1);
    expect(checkoutCartId).toBeTruthy();
    const [createdOrder] = await db.select({ id: retailOrdersTable.id }).from(retailOrdersTable)
      .where(eq(retailOrdersTable.cartId, checkoutCartId!)).limit(1);
    expect(createdOrder).toBeUndefined();

    const recovery = page.getByTestId("unavailable-item-recovery");
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("heading", { name: "Proizvod više nije dostupan" })).toBeVisible();
    await expect(recovery).toContainText(secondProduct!.name);
    await expect(recovery).not.toContainText(product!.name);
    await expect(recovery).toContainText("rasprodat ili više nije aktivan");
    await expect(recovery).toContainText("Porudžbina nije kreirana");
    await expect(recovery.getByRole("link", { name: "Vrati se u korpu" })).toHaveAttribute("href", "/korpa");
    await expect(recovery.getByRole("link", { name: "Nastavi sa kupovinom" })).toHaveAttribute("href", "/proizvodi");
    await expect(page.getByRole("button", { name: "Potvrdi porudžbinu" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Porudžbina je primljena" })).not.toBeVisible();

    await recovery.getByRole("link", { name: "Vrati se u korpu" }).click();
    await expect(page).toHaveURL(/\/korpa$/);
    await expect(page.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();

    await page.goto("/korpa/placanje");
    const refreshedRecovery = page.getByTestId("unavailable-item-recovery");
    await expect(refreshedRecovery).toBeVisible();
    await refreshedRecovery.getByRole("link", { name: "Nastavi sa kupovinom" }).click();
    await expect(page).toHaveURL(/\/proizvodi$/);
  } finally {
    await db.update(productsTable).set({ stock: secondProduct!.stock }).where(eq(productsTable.id, secondProductId!));
  }
});

test("retail cart announces every shopper mutation through completed checkout", async ({ page }) => {
  expect(productId).toBeTruthy();
  expect(productName).toBeTruthy();

  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { id: string };
  createdCartIds.push(cart.id);

  const expectCartAnnouncement = async (itemCount: number) => {
    const announcement = itemCount === 0
      ? "Korpa je prazna."
      : `Korpa sada ima ${itemCount} ${itemCount === 1 ? "stavku" : "stavki"}.`;
    await expect(page.getByTestId("status-cart-announcement")).toHaveText(announcement);
    if (itemCount === 0) {
      await expect(page.getByTestId("status-cart-count")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("status-cart-count")).toHaveText(String(itemCount));
    }
  };
  const expectCartItemAnnouncement = async (announcement: string) => {
    await expect(page.getByTestId("status-cart-item-announcement")).toHaveText(announcement);
  };

  await page.goto("/proizvodi");
  const productSearch = page.getByTestId("public-product-search");
  await productSearch.fill(productName!);
  const productCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName!, exact: true }),
  }).first();
  await expect(productCard).toBeVisible();
  await productCard.getByRole("button", { name: "Dodaj u korpu" }).click();
  await expectCartAnnouncement(1);
  await expectCartItemAnnouncement(`Proizvod ${productName} sada ima količinu 1.`);

  await page.getByTestId("link-cart").click();
  await expect(page.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
  await page.getByRole("button", { name: `Povećaj količinu proizvoda ${productName}` }).click();
  await expectCartAnnouncement(2);
  await expectCartItemAnnouncement(`Proizvod ${productName} sada ima količinu 2.`);

  await page.getByRole("button", { name: `Smanji količinu proizvoda ${productName}` }).click();
  await expectCartAnnouncement(1);
  await expectCartItemAnnouncement(`Proizvod ${productName} sada ima količinu 1.`);

  await page.getByRole("button", { name: `Ukloni ${productName} iz korpe` }).click();
  await expectCartAnnouncement(0);
  await expectCartItemAnnouncement(`Proizvod ${productName} je uklonjen iz korpe.`);

  await page.goto("/proizvodi");
  await productSearch.fill(productName!);
  const secondProductCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName!, exact: true }),
  }).first();
  await expect(secondProductCard).toBeVisible();
  await secondProductCard.getByRole("button", { name: "Dodaj u korpu" }).click();
  await expectCartAnnouncement(1);
  await expectCartItemAnnouncement(`Proizvod ${productName} sada ima količinu 1.`);

  await page.getByTestId("link-cart").click();
  await expect(page.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
  await page.getByRole("link", { name: "Nastavi na dostavu i plaćanje" }).click();
  await expect(page.getByRole("heading", { name: "Dostava i plaćanje" })).toBeVisible();
  await fillCheckoutContact(page, "Novi Sad");

  const previewResponse = await page.request.get(
    "/api/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad",
  );
  expect(previewResponse.ok()).toBe(true);
  const preview = await previewResponse.json() as CheckoutPreview;
  await expect(page.getByRole("button", { name: "Potvrdi porudžbinu" })).toBeEnabled();
  await submitAndAssertOrder(page, preview);
  await expectCartAnnouncement(0);
  await expectCartItemAnnouncement("");
});
