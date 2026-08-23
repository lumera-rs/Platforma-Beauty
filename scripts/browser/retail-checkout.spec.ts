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
let shippingRuleId: string | undefined;

let previousShippingRule: typeof shippingRulesTable.$inferSelect | undefined;
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
  await expect(page.getByRole("status")).toContainText("Promena iznosa je osvežena");
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

  // A second tab or device shares the same session cookie, so API calls from the
  // same browser context are exactly what emptying the cart elsewhere looks like.
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
  await expect(page.getByRole("status")).toContainText("Promena iznosa je osvežena");
  await expect(page.getByRole("status")).toContainText(`ukupno za plaćanje ${money(4_390)}`);
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
  const confirmButton = page.locator("form").getByRole("button", { name: "Potvrdi porudžbinu" });
  await expect(confirmButton).toBeEnabled();

  // A second tab or device shares the same session cookie, so API calls from the
  // same browser context are exactly what emptying the cart elsewhere looks like.
  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { items: Array<{ id: string }> };
  expect(cart.items.length).toBeGreaterThan(0);
  for (const item of cart.items) {
    const deleteResponse = await page.request.delete(`/api/retail/cart/items/${item.id}`);
    expect(deleteResponse.ok()).toBe(true);
  }

  // The poll must drop the stale quote and leave the payment form entirely.
  await expect(page.getByText("Korpa je prazna.")).toBeVisible({ timeout: 15_000 });
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

async function createCartAndOpenCartPage(page: Page) {
  const cartResponse = await page.request.get("/api/retail/cart");
  expect(cartResponse.ok()).toBe(true);
  const cart = await cartResponse.json() as { id: string };
  createdCartIds.push(cart.id);
  const addResponse = await page.request.post("/api/retail/cart/items", {
    data: { productId, quantity: 1 },
  });
  expect(addResponse.status()).toBe(201);
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

  await expect(page.getByText("Korpa je prazna.")).toBeVisible({ timeout: 15_000 });
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
  await createCartAndOpenCheckout(page);
  await fillCheckoutContact(page, "Novi Sad");
  const confirmButton = page.locator("form").getByRole("button", { name: "Potvrdi porudžbinu" });
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

    const checkoutCartId = createdCartIds.at(-1);
    expect(checkoutCartId).toBeTruthy();
    const [createdOrder] = await db.select({ id: retailOrdersTable.id }).from(retailOrdersTable)
      .where(eq(retailOrdersTable.cartId, checkoutCartId!)).limit(1);
    expect(createdOrder).toBeUndefined();

    const recovery = page.getByTestId("unavailable-item-recovery");
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("heading", { name: "Proizvod više nije dostupan" })).toBeVisible();
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
    await db.update(productsTable).set({ stock: product!.stock }).where(eq(productsTable.id, productId!));
  }
});
