import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  productCategoriesTable,
  productsTable,
  retailCartItemsTable,
  retailCartsTable,
  retailOrderItemsTable,
  retailOrdersTable,
  shippingRulesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureShippingConfigSchema } from "./shipping-config";

type RetailCart = {
  id: string;
  items: Array<{ id: string; sku: string; quantity: number }>;
};
type RetailCartSummary = { itemCount: number };
type RetailCheckoutPreview = {
  cart: { subtotal: number; items: Array<{ sku: string }> };
  shipping: { shippingCost: number };
  total: number;
};
type RetailOrder = {
  id: string;
  subtotal: number;
  shippingCost: number;
  total: number;
  items: Array<{ sku: string }>;
};
type ApiError = { error: string; code?: string };

const createdCartIds: string[] = [];
const createdOrderIds: string[] = [];
let createdCategoryId: string | undefined;
let createdProductId: string | undefined;
let createdShippingRuleId: string | undefined;
let previousShippingRule: typeof shippingRulesTable.$inferSelect | undefined;
let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;

function retailClient() {
  let cookie = "";
  return async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = response.headers.get("set-cookie");
    const token = setCookie?.match(/lumera_retail_cart=([^;]+)/)?.[1];
    if (token) cookie = `lumera_retail_cart=${token}`;
    return response;
  };
}

async function addRetailItem(request: ReturnType<typeof retailClient>, productId: string, quantity: number) {
  const cartResponse = await request("/retail/cart");
  assert.equal(cartResponse.status, 200);
  const cart = await cartResponse.json() as RetailCart;
  createdCartIds.push(cart.id);
  const addResponse = await request("/retail/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId, quantity }),
  });
  return addResponse;
}

async function checkoutAndAssertSavedAmount(
  productId: string,
  deliveryMethod: "courier" | "personal_belgrade",
  city: string,
) {
  const request = retailClient();
  const addResponse = await addRetailItem(request, productId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request(
    `/retail/checkout-preview?deliveryMethod=${deliveryMethod}&city=${encodeURIComponent(city)}`,
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;

  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-checkout-test-${randomUUID()}`,
      firstName: "Retail",
      lastName: "Kupac",
      email: `retail-${randomUUID()}@example.test`,
      phone: "+381601234567",
      street: "Test ulica 1",
      city,
      postalCode: "11000",
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod,
      expectedSubtotal: preview.cart.subtotal,
      expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(checkoutResponse.status, 201);
  const order = await checkoutResponse.json() as RetailOrder;
  createdOrderIds.push(order.id);

  assert.equal(order.subtotal, preview.cart.subtotal, `${deliveryMethod} preserves the displayed subtotal`);
  assert.equal(order.shippingCost, preview.shipping.shippingCost, `${deliveryMethod} preserves the displayed delivery cost`);
  assert.equal(order.total, preview.total, `${deliveryMethod} preserves the displayed total`);

  const [persisted] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, order.id)).limit(1);
  assert.ok(persisted, "checkout must persist the order");
  assert.equal(persisted.subtotal, preview.cart.subtotal);
  assert.equal(persisted.shippingCost, preview.shipping.shippingCost);
  assert.equal(persisted.total, preview.total);
}

test.before(async () => {
  await ensureShippingConfigSchema();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  previousShippingRule = (await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1))[0];
  const shippingValues = {
    freeShippingThreshold: 10_000,
    tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    personalDeliveryEnabled: true,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 650,
    personalDeliveryDescription: "Test lična dostava.",
    updatedAt: new Date(),
  };
  if (previousShippingRule) {
    await db.update(shippingRulesTable).set(shippingValues).where(eq(shippingRulesTable.id, previousShippingRule.id));
  } else {
    const [created] = await db.insert(shippingRulesTable).values(shippingValues).returning();
    createdShippingRuleId = created!.id;
  }

  const suffix = randomUUID();
  const [category] = await db.insert(productCategoriesTable).values({
    name: `Retail checkout test ${suffix}`,
    slug: `retail-checkout-test-${suffix}`,
    active: true,
  }).returning();
  createdCategoryId = category!.id;
  const [product] = await db.insert(productsTable).values({
    categoryId: category!.id,
    categoryName: category!.name,
    name: `Retail proizvod ${suffix}`,
    description: "Test proizvod za retail checkout.",
    publicDescription: "Javni opis retail proizvoda.",
    imageUrl: "/retail-checkout-test.jpg",
    price: 2_500,
    publicPrice: 2_500,
    publicDiscountPrice: 2_000,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 8,
    sku: `retail-checkout-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  createdProductId = product!.id;
});

test.after(async () => {
  if (createdOrderIds.length) {
    await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, createdOrderIds));
    await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, createdOrderIds));
  }
  if (createdCartIds.length) {
    await db.delete(retailCartItemsTable).where(inArray(retailCartItemsTable.cartId, createdCartIds));
    await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, createdCartIds));
  }
  if (createdProductId) await db.delete(productsTable).where(eq(productsTable.id, createdProductId));
  if (createdCategoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, createdCategoryId));
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
  } else if (createdShippingRuleId) {
    await db.delete(shippingRulesTable).where(eq(shippingRulesTable.id, createdShippingRuleId));
  }
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});

test("cart summary does not create a cart and returns the count for an existing cart", async () => {
  assert.ok(createdProductId);
  const cartsBefore = await db.select({ id: retailCartsTable.id }).from(retailCartsTable);

  const emptySummary = await fetch(`${baseUrl}/retail/cart-summary`);
  assert.equal(emptySummary.status, 200);
  assert.equal(emptySummary.headers.get("set-cookie"), null);
  assert.deepEqual(await emptySummary.json() as RetailCartSummary, { itemCount: 0 });

  const cartsAfterEmptySummary = await db.select({ id: retailCartsTable.id }).from(retailCartsTable);
  assert.equal(cartsAfterEmptySummary.length, cartsBefore.length, "a summary request must not create a persistent cart");

  const addResponse = await fetch(`${baseUrl}/retail/cart/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  });
  assert.equal(addResponse.status, 201);
  const cart = await addResponse.json() as RetailCart;
  createdCartIds.push(cart.id);
  const token = addResponse.headers.get("set-cookie")?.match(/lumera_retail_cart=([^;]+)/)?.[1];
  assert.ok(token);

  const existingSummary = await fetch(`${baseUrl}/retail/cart-summary`, {
    headers: { cookie: `lumera_retail_cart=${token}` },
  });
  assert.equal(existingSummary.status, 200);
  assert.equal(existingSummary.headers.get("set-cookie"), null);
  assert.deepEqual(await existingSummary.json() as RetailCartSummary, { itemCount: 1 });
});

test("cart and checkout retain the saved catalog reference after an SKU edit", async () => {
  assert.ok(createdProductId);
  const [product] = await db.select({
    catalogReference: productsTable.catalogReference,
    sku: productsTable.sku,
    stock: productsTable.stock,
  }).from(productsTable).where(eq(productsTable.id, createdProductId)).limit(1);
  assert.ok(product);

  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);
  const addedCart = await addResponse.json() as RetailCart;
  assert.equal(addedCart.items[0]?.sku, product.catalogReference);
  const [savedCartItem] = await db.select().from(retailCartItemsTable)
    .where(eq(retailCartItemsTable.cartId, addedCart.id)).limit(1);
  assert.equal(savedCartItem?.productCatalogReference, product.catalogReference);

  await db.update(productsTable).set({ sku: `retail-checkout-updated-${randomUUID()}` })
    .where(eq(productsTable.id, createdProductId));
  try {
    const cartResponse = await request("/retail/cart");
    assert.equal(cartResponse.status, 200);
    const cart = await cartResponse.json() as RetailCart;
    assert.equal(cart.items[0]?.sku, product.catalogReference);

    const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as RetailCheckoutPreview;
    assert.equal(preview.cart.items[0]?.sku, product.catalogReference);

    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-reference-test-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `reference-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 201);
    const order = await checkoutResponse.json() as RetailOrder;
    createdOrderIds.push(order.id);
    assert.equal(order.items[0]?.sku, product.catalogReference);
    const [savedOrderItem] = await db.select().from(retailOrderItemsTable)
      .where(eq(retailOrderItemsTable.orderId, order.id)).limit(1);
    assert.equal(savedOrderItem?.productCatalogReference, product.catalogReference);
  } finally {
    await db.update(productsTable).set({ sku: product.sku, stock: product.stock })
      .where(eq(productsTable.id, createdProductId));
  }
});

test("retail checkout saves the exact courier and personal-delivery previews", async () => {
  assert.ok(createdProductId);
  await checkoutAndAssertSavedAmount(createdProductId, "courier", "Novi Sad");
  await checkoutAndAssertSavedAmount(createdProductId, "personal_belgrade", "Beograd");
});

test("checkout and admin settings keep the canonical shipping rule after it is updated beside a duplicate", async () => {
  assert.ok(createdProductId);
  const canonicalShippingRuleId = "00000000-0000-0000-0000-000000000001";
  const [replacedShippingRule] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  assert.ok(replacedShippingRule);
  await db.execute(sql`drop index if exists "shipping_rules_singleton_unique"`);
  await db.insert(shippingRulesTable).values({
    id: canonicalShippingRuleId,
    freeShippingThreshold: 10_000,
    tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    personalDeliveryEnabled: true,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 700,
    personalDeliveryDescription: "Test lična dostava.",
    updatedAt: new Date(),
  });
  await ensureShippingConfigSchema();
  const [admin] = await db.insert(usersTable).values({
    firstName: "Retail",
    lastName: "Admin",
    email: `retail-admin-${randomUUID()}@example.test`,
    passwordHash: await hashPassword("retail-admin-test"),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  assert.ok(admin);
  const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
  const getAdminShipping = () => fetch(`${baseUrl}/admin/shipping`, {
    headers: { cookie: adminCookie },
  });
  try {
    const request = retailClient();
    assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
    const beforeUpdateResponse = await request("/retail/checkout-preview?deliveryMethod=personal_belgrade&city=Beograd");
    assert.equal(beforeUpdateResponse.status, 200);
    assert.equal((await beforeUpdateResponse.json() as RetailCheckoutPreview).shipping.shippingCost, 700);
    const beforeUpdateAdminResponse = await getAdminShipping();
    assert.equal(beforeUpdateAdminResponse.status, 200);
    assert.equal((await beforeUpdateAdminResponse.json() as { personalDeliveryPrice: number }).personalDeliveryPrice, 700);

    await db.update(shippingRulesTable).set({
      personalDeliveryPrice: 800,
      updatedAt: new Date(),
    }).where(eq(shippingRulesTable.id, canonicalShippingRuleId));

    const updatedRequest = retailClient();
    assert.equal((await addRetailItem(updatedRequest, createdProductId, 1)).status, 201);
    const afterUpdateResponse = await updatedRequest("/retail/checkout-preview?deliveryMethod=personal_belgrade&city=Beograd");
    assert.equal(afterUpdateResponse.status, 200);
    assert.equal((await afterUpdateResponse.json() as RetailCheckoutPreview).shipping.shippingCost, 800);
    const afterUpdateAdminResponse = await getAdminShipping();
    assert.equal(afterUpdateAdminResponse.status, 200);
    assert.equal((await afterUpdateAdminResponse.json() as { personalDeliveryPrice: number }).personalDeliveryPrice, 800);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    await db.delete(shippingRulesTable).where(eq(shippingRulesTable.id, canonicalShippingRuleId));
    const [restoredShippingRule] = await db.select({ id: shippingRulesTable.id }).from(shippingRulesTable)
      .where(eq(shippingRulesTable.id, replacedShippingRule.id))
      .limit(1);
    if (!restoredShippingRule) await db.insert(shippingRulesTable).values(replacedShippingRule);
    await ensureShippingConfigSchema();
  }
});

test("adding a second cart quantity above available stock returns 409", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 5 }).where(eq(productsTable.id, createdProductId));
  const request = retailClient();
  const firstAdd = await addRetailItem(request, createdProductId, 5);
  assert.equal(firstAdd.status, 201);

  const secondAdd = await request("/retail/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  });
  assert.equal(secondAdd.status, 409);

  const cartResponse = await request("/retail/cart");
  assert.equal(cartResponse.status, 200);
  const cart = await cartResponse.json() as RetailCart;
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0]?.quantity, 5, "the rejected aggregate quantity must not change the cart");
});

test("updating one duplicate cart row cannot exceed the product's aggregate stock", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 3);
  assert.equal(addResponse.status, 201);
  const cart = await addResponse.json() as RetailCart;
  const item = cart.items[0];
  assert.ok(item);

  await db.insert(retailCartItemsTable).values({
    cartId: cart.id,
    productId: createdProductId,
    variantValue: "test-duplicate",
    productName: "Duplicirana retail stavka",
    productImageUrl: "/retail-checkout-test.jpg",
    unitPrice: 2_000,
    quantity: 1,
    weightGrams: 500,
  });
  const updateResponse = await request(`/retail/cart/items/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity: 5 }),
  });
  assert.equal(updateResponse.status, 409);

  const afterResponse = await request("/retail/cart");
  assert.equal(afterResponse.status, 200);
  const after = await afterResponse.json() as RetailCart;
  assert.equal(after.items.reduce((sum, cartItem) => sum + cartItem.quantity, 0), 4);
});

test("duplicate cart rows cannot create a quote or order above aggregate stock", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 3);
  assert.equal(addResponse.status, 201);
  const cart = await addResponse.json() as RetailCart;
  await db.insert(retailCartItemsTable).values({
    cartId: cart.id,
    productId: createdProductId,
    variantValue: "test-duplicate",
    productName: "Duplicirana retail stavka",
    productImageUrl: "/retail-checkout-test.jpg",
    unitPrice: 2_000,
    quantity: 3,
    weightGrams: 500,
  });
  const [stockBefore] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, createdProductId)).limit(1);
  const [ordersBefore] = await db.select({ count: retailOrdersTable.id }).from(retailOrdersTable);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 409);
  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-duplicate-test-${randomUUID()}`,
      firstName: "Retail",
      lastName: "Kupac",
      email: `duplicate-${randomUUID()}@example.test`,
      phone: "+381601234567",
      street: "Test ulica 1",
      city: "Novi Sad",
      postalCode: "21000",
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod: "courier",
    }),
  });
  assert.equal(checkoutResponse.status, 409);

  const [stockAfter] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, createdProductId)).limit(1);
  const [ordersAfter] = await db.select({ count: retailOrdersTable.id }).from(retailOrdersTable);
  assert.equal(stockAfter?.stock, stockBefore?.stock);
  assert.equal(ordersAfter?.count, ordersBefore?.count);
  const afterResponse = await request("/retail/cart");
  const after = await afterResponse.json() as RetailCart;
  assert.equal(after.items.reduce((sum, item) => sum + item.quantity, 0), 6);
});

test("checkout marks a displayed-quote mismatch so shoppers can refresh it in place", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;

  await db.update(productsTable).set({ publicDiscountPrice: 1_800 }).where(eq(productsTable.id, createdProductId));
  try {
    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-quote-conflict-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `quote-conflict-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 409);
    const error = await checkoutResponse.json() as ApiError;
    assert.equal(error.code, "CHECKOUT_QUOTE_CHANGED");
  } finally {
    await db.update(productsTable).set({ publicDiscountPrice: 2_000 }).where(eq(productsTable.id, createdProductId));
  }
});

test("checkout marks a displayed-quote delivery change with the stable conflict code", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;
  const [shippingRule] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  assert.ok(shippingRule);
  const originalTiers = shippingRule.tiers;

  await db.update(shippingRulesTable).set({
    tiers: [{ maxWeightGrams: 1_000, price: 590, label: "do 1 kg" }],
    updatedAt: new Date(),
  }).where(eq(shippingRulesTable.id, shippingRule.id));
  try {
    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-delivery-conflict-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `delivery-conflict-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 409);
    const error = await checkoutResponse.json() as ApiError;
    assert.equal(error.code, "CHECKOUT_QUOTE_CHANGED");
  } finally {
    await db.update(shippingRulesTable).set({ tiers: originalTiers, updatedAt: new Date() })
      .where(eq(shippingRulesTable.id, shippingRule.id));
  }
});

test("checkout marks an unavailable displayed-quote item with the stable conflict code", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;
  const [product] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, createdProductId)).limit(1);
  assert.ok(product);

  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, createdProductId));
  try {
    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-stock-conflict-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `stock-conflict-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 409);
    const error = await checkoutResponse.json() as ApiError;
    assert.equal(error.code, "CHECKOUT_QUOTE_CHANGED");
  } finally {
    await db.update(productsTable).set({ stock: product.stock }).where(eq(productsTable.id, createdProductId));
  }
});