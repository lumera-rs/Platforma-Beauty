import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  couponRedemptionsTable,
  couponsTable,
  db,
  commerceCustomerNotificationsTable,
  loyaltyPointLedgerTable,
  observeDatabaseQueries,
  pool,
  productCategoriesTable,
  productWaitlistNotificationOutboxTable,
  productWaitlistTable,
  productsTable,
  productBundlesTable,
  productBundleComponentsTable,
  reorderActionsTable,
  retailCartItemsTable,
  retailCartsTable,
  retailOrderItemsTable,
  retailOrderStatusHistoryTable,
  retailTrackingRateLimitsTable,
  retailOrdersTable,
  savedRetailCartItemsTable,
  shopSettingsTable,
  shippingRulesTable,
  suppliersTable,
  usersTable,
  aftercareRecommendationsTable,
  aftercareRecommendationLinesTable,
} from "@workspace/db";
import app from "../app";
import {
  AdminGetRetailOrderResponse,
  GetCustomerRetailOrderResponse,
  TrackRetailOrderResponse,
} from "@workspace/api-zod";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { runProductWaitlistNotificationWorker } from "./product-waitlist-worker";
import { ensureShippingConfigSchema } from "./shipping-config";
import { reconcileAftercareConversions } from "./aftercare-worker";

type RetailCart = {
  id: string;
  items: Array<{ id: string; sku: string; quantity: number }>;
  savedItems?: Array<{ id: string; quantity: number }>;
};
type RetailCartSummary = { itemCount: number };
type RetailCheckoutPreview = {
  cart: { subtotal: number; items: Array<{ sku: string }> };
  shipping: { shippingCost: number };
  total: number;
  merchandiseSubtotalRsd: number;
};
type RetailOrder = {
  id: string;
  orderNumber?: string;
  trackingToken?: string | null;
  subtotal: number;
  shippingCost: number;
  total: number;
  items: Array<{ sku: string }>;
};
type ApiError = { error: string; code?: string };

const createdCartIds: string[] = [];
const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];
const createdAuxiliaryProductIds: string[] = [];
const createdCouponIds: string[] = [];
const createdBundleIds: string[] = [];
let createdCategoryId: string | undefined;
let createdProductId: string | undefined;
let createdAftercareProductId: string | undefined;
let createdSupplierId: string | undefined;
let createdShippingRuleId: string | undefined;
let previousShippingRule: typeof shippingRulesTable.$inferSelect | undefined;
let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;

function retailClient(sessionCookie = "") {
  let cookie = "";
  return async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(cookie || sessionCookie ? { cookie: [cookie, sessionCookie].filter(Boolean).join("; ") } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = response.headers.get("set-cookie");
    const token = setCookie?.match(/lumera_retail_cart=([^;]+)/)?.[1];
    if (token) cookie = `lumera_retail_cart=${token}`;
    return response;
  };
}

function retailCartCookie(response: Response) {
  const token = response.headers.get("set-cookie")?.match(/lumera_retail_cart=([^;]+)/)?.[1];
  assert.ok(token, "response must set a retail cart cookie");
  return `lumera_retail_cart=${token}`;
}

async function createTestUser(role: "CUSTOMER" | "JOBSEEKER" | "ADMIN" = "CUSTOMER") {
  const marker = randomUUID();
  const [user] = await db.insert(usersTable).values({
    firstName: "Retail",
    lastName: `Regression ${marker}`,
    email: `retail-regression-${marker}@example.test`,
    passwordHash: await hashPassword(`retail-regression-${marker}`),
    passwordSetAt: new Date(),
    role,
  }).returning();
  assert.ok(user);
  createdUserIds.push(user.id);
  return { user, cookie: `${sessionCookieName}=${await createSession(user.id)}` };
}

async function seedAftercareRecommendation(userId: string, overrides: Partial<{
  status: "PENDING" | "ACTIVE" | "CONVERTED" | "EXPIRED" | "CANCELLED";
  activatesAt: Date; entitlementExpiresAt: Date; firstSentAt: Date | null; convertedAt: Date | null;
}> = {}) {
  const now = new Date();
  const [recommendation] = await db.insert(aftercareRecommendationsTable).values({
    customerUserId: userId, settingsVersion: 1, entitlementTokenHash: `test-${randomUUID()}`,
    status: "ACTIVE", windowStartedAt: now, windowEndsAt: new Date(now.getTime() + 86_400_000),
    activatesAt: now, entitlementExpiresAt: new Date(now.getTime() + 86_400_000), firstSentAt: now,
    settingsSnapshot: {}, treatmentSnapshot: [], ...overrides,
  }).returning();
  assert.ok(recommendation);
  return recommendation;
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
  const [snapshot] = await db.select().from(retailOrderItemsTable)
    .where(eq(retailOrderItemsTable.orderId, order.id)).limit(1);
  assert.equal(snapshot?.unitCostPriceRsd, 900);
  assert.equal(snapshot?.lineCogsRsd, 900);
  assert.equal(snapshot?.realizedRevenueRsd, snapshot?.lineTotal);
  assert.equal(
    persisted.referralCreditMerchandiseSubtotalRsd,
    preview.merchandiseSubtotalRsd,
    "locked checkout persists the same referral base as preview",
  );
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
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
  const [supplier] = await db.insert(suppliersTable).values({
    name: `Retail checkout supplier ${suffix}`,
    slug: `retail-checkout-supplier-${suffix}`,
    scope: "BOTH",
    active: true,
  }).returning();
  createdSupplierId = supplier!.id;
  const [category] = await db.insert(productCategoriesTable).values({
    supplierId: supplier!.id,
    name: `Retail checkout test ${suffix}`,
    slug: `retail-checkout-test-${suffix}`,
    active: true,
  }).returning();
  createdCategoryId = category!.id;
  const [product] = await db.insert(productsTable).values({
    supplierId: supplier!.id,
    categoryId: category!.id,
    categoryName: category!.name,
    name: `Retail proizvod ${suffix}`,
    description: "Test proizvod za retail checkout.",
    publicDescription: "Javni opis retail proizvoda.",
    imageUrl: "/retail-checkout-test.jpg",
    price: 2_500,
    publicPrice: 2_500,
    publicDiscountPrice: 2_000,
    costPriceRsd: 900,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 8,
    sku: `retail-checkout-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  createdProductId = product!.id;
  const [aftercareProduct] = await db.insert(productsTable).values({
    supplierId: supplier!.id,
    categoryId: category!.id,
    categoryName: category!.name,
    name: `Aftercare retail proizvod ${suffix}`,
    description: "Izolovan test proizvod za aftercare checkout.",
    publicDescription: "Javni opis aftercare proizvoda.",
    imageUrl: "/aftercare-retail-checkout-test.jpg",
    price: 2_500,
    publicPrice: 2_500,
    publicDiscountPrice: 2_000,
    costPriceRsd: 900,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 20,
    sku: `aftercare-retail-checkout-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  createdAftercareProductId = aftercareProduct!.id;
});

test.after(async () => {
  if (createdUserIds.length) {
    await db.delete(loyaltyPointLedgerTable).where(inArray(loyaltyPointLedgerTable.userId, createdUserIds));
    await db.delete(reorderActionsTable).where(inArray(reorderActionsTable.userId, createdUserIds));
    await db.delete(commerceCustomerNotificationsTable).where(inArray(commerceCustomerNotificationsTable.userId, createdUserIds));
    await db.delete(productWaitlistTable).where(inArray(productWaitlistTable.userId, createdUserIds));
  }
  if (createdCouponIds.length) {
    await db.delete(couponRedemptionsTable).where(inArray(couponRedemptionsTable.couponId, createdCouponIds));
  }
  if (createdOrderIds.length) {
    await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, createdOrderIds));
    await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, createdOrderIds));
  }
  if (createdCouponIds.length) {
    await db.delete(couponsTable).where(inArray(couponsTable.id, createdCouponIds));
  }
  if (createdCartIds.length) {
    await db.delete(retailCartItemsTable).where(inArray(retailCartItemsTable.cartId, createdCartIds));
    await db.delete(savedRetailCartItemsTable).where(inArray(savedRetailCartItemsTable.cartId, createdCartIds));
    await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, createdCartIds));
  }
  if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  if (createdBundleIds.length) {
    await db.delete(productBundleComponentsTable).where(inArray(productBundleComponentsTable.bundleId, createdBundleIds));
    await db.delete(productBundlesTable).where(inArray(productBundlesTable.id, createdBundleIds));
  }
  if (createdAuxiliaryProductIds.length) {
    await db.delete(productsTable).where(inArray(productsTable.id, createdAuxiliaryProductIds));
  }
  if (createdAftercareProductId) await db.delete(productsTable).where(eq(productsTable.id, createdAftercareProductId));
  if (createdProductId) await db.delete(productsTable).where(eq(productsTable.id, createdProductId));
  if (createdCategoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, createdCategoryId));
  if (createdSupplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, createdSupplierId));
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
  const afterIds = new Set(cartsAfterEmptySummary.map((cart) => cart.id));
  assert.ok(cartsBefore.every((cart) => afterIds.has(cart.id)),
    "a summary request must not mutate pre-existing carts (parallel suites may create unrelated carts)");

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

test("owned active aftercare recommendation is capped, previewed, and persisted only on B2C item", async () => {
  assert.ok(createdAftercareProductId);
  const customer = await createTestUser();
  const request = retailClient(customer.cookie);
  assert.equal((await addRetailItem(request, createdAftercareProductId, 1)).status, 201);
  const now = new Date();
  const [recommendation] = await db.insert(aftercareRecommendationsTable).values({
    customerUserId: customer.user.id, settingsVersion: 1, status: "ACTIVE",
    entitlementTokenHash: `test-${randomUUID()}`, windowStartedAt: now,
    windowEndsAt: new Date(now.getTime() + 86_400_000), activatesAt: now,
    entitlementExpiresAt: new Date(now.getTime() + 86_400_000), firstSentAt: now,
    settingsSnapshot: {}, treatmentSnapshot: [],
  }).returning();
  assert.ok(recommendation);
  await db.insert(aftercareRecommendationLinesTable).values({
    recommendationId: recommendation.id, kind: "PRODUCT", productId: createdAftercareProductId,
    treatmentIds: ["00000000-0000-4000-8000-000000000001"], coveredProductIds: [createdAftercareProductId],
    catalogSnapshot: {}, pricingSnapshot: {}, discountKind: "POST_TREATMENT_RECOMMENDATION_DISCOUNT", discountPercent: 10,
  });
  const previewResponse = await request(`/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${recommendation.id}`);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview & { postTreatmentRecommendationDiscountRsd: number };
  assert.equal(preview.postTreatmentRecommendationDiscountRsd, 200);
  const checkout = await request("/retail/checkout", { method: "POST", body: JSON.stringify({
    idempotencyKey: `aftercare-${randomUUID()}`, firstName: "Aftercare", lastName: "Kupac",
    email: `aftercare-${randomUUID()}@example.test`, phone: "+381601234567", street: "Test 1",
    city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    aftercareRecommendationId: recommendation.id, expectedSubtotal: preview.cart.subtotal,
    expectedShippingCost: preview.shipping.shippingCost, expectedTotal: preview.total,
  }) });
  assert.equal(checkout.status, 201);
  const order = await checkout.json() as RetailOrder;
  createdOrderIds.push(order.id);
  const [item] = await db.select().from(retailOrderItemsTable).where(eq(retailOrderItemsTable.orderId, order.id));
  assert.equal(item?.aftercareRecommendationId, recommendation.id);
  assert.equal(item?.postTreatmentRecommendationDiscountRsd, 200);
  assert.equal(item?.personalizedTreatmentBundleDiscountRsd, 0);
  assert.equal(item?.lineCogsRsd, 900);
  assert.equal(item?.realizedRevenueRsd, item?.lineTotal);
});

test("premade bundle keeps fixed pricing and caps only explicit post-treatment bundle evidence", async () => {
  assert.ok(createdAftercareProductId && createdSupplierId);
  const [component] = await db.insert(productsTable).values({
    supplierId: createdSupplierId, categoryId: createdCategoryId, categoryName: "Aftercare bundle",
    name: `Aftercare component ${randomUUID()}`, description: "Bundle component", publicDescription: "Bundle component",
    imageUrl: "/retail-checkout-test.jpg", price: 1_000, publicPrice: 1_000, costPriceRsd: 300,
    retailEnabled: true, professionalEnabled: false, stock: 8, sku: `aftercare-component-${randomUUID()}`,
    unit: "kom", weightGrams: 100, active: true,
  }).returning();
  assert.ok(component); createdAuxiliaryProductIds.push(component.id);
  const [bundle] = await db.insert(productBundlesTable).values({
    supplierId: createdSupplierId, name: `Aftercare fixed ${randomUUID()}`, market: "B2C", b2cPrice: 1_500,
  }).returning();
  assert.ok(bundle); createdBundleIds.push(bundle.id);
  await db.insert(productBundleComponentsTable).values({
    bundleId: bundle.id, productId: createdAftercareProductId, quantity: 1, sortOrder: 0,
  });
  await db.insert(productBundleComponentsTable).values({
    bundleId: bundle.id, productId: component.id, quantity: 1, sortOrder: 1,
  });
  const customer = await createTestUser();
  const request = retailClient(customer.cookie);
  const add = await request("/retail/cart/items", {
    method: "POST", body: JSON.stringify({ bundleId: bundle.id, quantity: 2 }),
  });
  assert.equal(add.status, 201);
  const recommendation = await seedAftercareRecommendation(customer.user.id);
  await db.insert(aftercareRecommendationLinesTable).values({
    recommendationId: recommendation.id, kind: "PREMADE_BUNDLE", bundleId: bundle.id,
    treatmentIds: ["00000000-0000-4000-8000-000000000003"], coveredProductIds: [createdAftercareProductId],
    catalogSnapshot: { bundleId: bundle.id, quantity: 1, priceSource: "FIXED_BUNDLE_PRICE" },
    pricingSnapshot: { fixedUnitPriceRsd: 1_500 }, discountKind: "POST_TREATMENT_RECOMMENDATION_DISCOUNT",
    discountPercent: 10,
  });
  const previewResponse = await request(`/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${recommendation.id}`);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview & {
    personalizedTreatmentBundleDiscountRsd: number; postTreatmentRecommendationDiscountRsd: number;
  };
  assert.equal(preview.cart.subtotal, 3_000);
  assert.equal(preview.personalizedTreatmentBundleDiscountRsd, 0);
  assert.equal(preview.postTreatmentRecommendationDiscountRsd, 150,
    "only one explicitly covered bundle unit receives aftercare discount");
  const final = await request("/retail/checkout", { method: "POST", body: JSON.stringify({
    idempotencyKey: `aftercare-fixed-${randomUUID()}`, firstName: "Bundle", lastName: "Kupac",
    email: `bundle-${randomUUID()}@example.test`, phone: "+381601234567", street: "Test 1",
    city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    aftercareRecommendationId: recommendation.id, expectedSubtotal: preview.cart.subtotal,
    expectedShippingCost: preview.shipping.shippingCost, expectedTotal: preview.total,
  }) });
  assert.equal(final.status, 201);
  const order = await final.json() as RetailOrder; createdOrderIds.push(order.id);
  const [item] = await db.select().from(retailOrderItemsTable).where(eq(retailOrderItemsTable.orderId, order.id));
  assert.equal(item?.priceSource, "BUNDLE", "persisted BUNDLE source denotes the canonical fixed bundle price");
  assert.equal(item?.baseUnitPrice, 1_500);
  assert.equal(item?.effectiveUnitPrice, 1_500);
  assert.equal(item?.personalizedTreatmentBundleDiscountRsd, 0);
  assert.equal(item?.postTreatmentRecommendationDiscountRsd, preview.postTreatmentRecommendationDiscountRsd);
  assert.equal(item?.lineSubtotal, preview.cart.subtotal);
  assert.equal(item?.lineTotal, preview.cart.subtotal - preview.postTreatmentRecommendationDiscountRsd);
  assert.equal(item?.referralDiscountRsd, 0,
    "an uncovered/full-price allocation is not reclassified as aftercare-discounted referral exclusion");

  const sibling = await createTestUser();
  const siblingRequest = retailClient(sibling.cookie);
  assert.equal((await siblingRequest("/retail/cart/items", {
    method: "POST", body: JSON.stringify({ bundleId: bundle.id, quantity: 1 }),
  })).status, 201);
  const siblingRecommendation = await seedAftercareRecommendation(sibling.user.id);
  await db.insert(aftercareRecommendationLinesTable).values({
    recommendationId: siblingRecommendation.id, kind: "PREMADE_BUNDLE", bundleId: bundle.id,
    treatmentIds: ["00000000-0000-4000-8000-000000000004"], coveredProductIds: [createdAftercareProductId],
    catalogSnapshot: { id: bundle.id }, pricingSnapshot: { fixedBundlePriceRsd: 1_500 },
    discountKind: "FIXED_BUNDLE_PRICE", discountPercent: 0,
  });
  const siblingPreview = await siblingRequest(`/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${siblingRecommendation.id}`);
  assert.equal(siblingPreview.status, 200);
  const noEvidence = await siblingPreview.json() as { personalizedTreatmentBundleDiscountRsd: number; postTreatmentRecommendationDiscountRsd: number };
  assert.equal(noEvidence.personalizedTreatmentBundleDiscountRsd, 0);
  assert.equal(noEvidence.postTreatmentRecommendationDiscountRsd, 0);
  const siblingFinal = await siblingRequest("/retail/checkout", { method: "POST", body: JSON.stringify({
    idempotencyKey: `aftercare-fixed-negative-${randomUUID()}`, firstName: "Bundle", lastName: "Bez evidence",
    email: `bundle-negative-${randomUUID()}@example.test`, phone: "+381601234567", street: "Test 1",
    city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    aftercareRecommendationId: siblingRecommendation.id,
  }) });
  assert.equal(siblingFinal.status, 201);
  const siblingOrder = await siblingFinal.json() as RetailOrder; createdOrderIds.push(siblingOrder.id);
  const [siblingItem] = await db.select().from(retailOrderItemsTable)
    .where(eq(retailOrderItemsTable.orderId, siblingOrder.id));
  assert.equal(siblingItem?.priceSource, "BUNDLE");
  assert.equal(siblingItem?.personalizedTreatmentBundleDiscountRsd, 0);
  assert.equal(siblingItem?.postTreatmentRecommendationDiscountRsd, 0);
  assert.equal(siblingItem?.aftercareRecommendationId, siblingRecommendation.id);

  const uncovered = await createTestUser();
  const uncoveredRequest = retailClient(uncovered.cookie);
  assert.equal((await uncoveredRequest("/retail/cart/items", {
    method: "POST", body: JSON.stringify({ bundleId: bundle.id, quantity: 1 }),
  })).status, 201);
  const uncoveredRecommendation = await seedAftercareRecommendation(uncovered.user.id);
  await db.insert(aftercareRecommendationLinesTable).values({
    recommendationId: uncoveredRecommendation.id, kind: "PRODUCT", productId: createdAftercareProductId,
    treatmentIds: ["00000000-0000-4000-8000-000000000005"], coveredProductIds: [createdAftercareProductId],
    catalogSnapshot: {}, pricingSnapshot: {}, discountKind: "POST_TREATMENT_RECOMMENDATION_DISCOUNT", discountPercent: 10,
  });
  const uncoveredPreview = await uncoveredRequest(`/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${uncoveredRecommendation.id}`);
  assert.equal(uncoveredPreview.status, 409);
  assert.equal((await uncoveredPreview.json() as ApiError).code, "AFTERCARE_RECOMMENDATION_UNAVAILABLE");
});

test("aftercare IDs fail closed identically for guest, wrong-owner, expired, converted, unsent and tampered checkout", async () => {
  assert.ok(createdAftercareProductId);
  const owner = await createTestUser();
  const other = await createTestUser();
  const now = new Date();
  const cases = [
    (await seedAftercareRecommendation(owner.user.id)).id,
    (await seedAftercareRecommendation(other.user.id, {
      activatesAt: new Date(now.getTime() - 172_800_000), entitlementExpiresAt: new Date(now.getTime() - 86_400_000),
    })).id,
    (await seedAftercareRecommendation(other.user.id, { status: "CONVERTED", convertedAt: now })).id,
    (await seedAftercareRecommendation(other.user.id, { firstSentAt: null })).id,
    "not-a-recommendation-id",
  ];
  for (const id of cases) {
    const request = retailClient(other.cookie);
    assert.equal((await addRetailItem(request, createdAftercareProductId, 1)).status, 201);
    const preview = await request(`/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${id}`);
    assert.equal(preview.status, 409);
    assert.equal((await preview.json() as ApiError).code, "AFTERCARE_RECOMMENDATION_UNAVAILABLE");
    const final = await request("/retail/checkout", { method: "POST", body: JSON.stringify({
      idempotencyKey: `aftercare-denied-${randomUUID()}`, firstName: "Test", lastName: "Kupac",
      email: `denied-${randomUUID()}@example.test`, phone: "+381601234567", street: "Test 1",
      city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
      aftercareRecommendationId: id,
    }) });
    assert.equal(final.status, 409);
    assert.equal((await final.json() as ApiError).code, "AFTERCARE_RECOMMENDATION_UNAVAILABLE");
  }
  const guest = retailClient();
  assert.equal((await addRetailItem(guest, createdAftercareProductId, 1)).status, 201);
  const guestPreview = await guest(`/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${cases[0]}`);
  assert.equal(guestPreview.status, 409);
  const guestFinal = await guest("/retail/checkout", { method: "POST", body: JSON.stringify({
    idempotencyKey: `aftercare-guest-${randomUUID()}`, firstName: "Test", lastName: "Gost",
    email: `guest-${randomUUID()}@example.test`, phone: "+381601234567", street: "Test 1",
    city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    aftercareRecommendationId: cases[0],
  }) });
  assert.equal(guestFinal.status, 409);
  assert.equal((await guestFinal.json() as ApiError).code, "AFTERCARE_RECOMMENDATION_UNAVAILABLE");
});

test("concurrent authenticated aftercare checkout replay creates one order and one immutable evidence allocation", async () => {
  assert.ok(createdAftercareProductId);
  const customer = await createTestUser();
  const request = retailClient(customer.cookie);
  assert.equal((await addRetailItem(request, createdAftercareProductId, 1)).status, 201);
  const recommendation = await seedAftercareRecommendation(customer.user.id);
  await db.insert(aftercareRecommendationLinesTable).values({
    recommendationId: recommendation.id, kind: "PRODUCT", productId: createdAftercareProductId,
    treatmentIds: ["00000000-0000-4000-8000-000000000002"], coveredProductIds: [createdAftercareProductId],
    catalogSnapshot: {}, pricingSnapshot: {}, discountKind: "POST_TREATMENT_RECOMMENDATION_DISCOUNT", discountPercent: 10,
  });
  const key = `aftercare-concurrent-${randomUUID()}`;
  const body = JSON.stringify({
    idempotencyKey: key, firstName: "Concurrent", lastName: "Kupac",
    email: `concurrent-${randomUUID()}@example.test`, phone: "+381601234567", street: "Test 1",
    city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    aftercareRecommendationId: recommendation.id,
  });
  const responses = await Promise.all([
    request("/retail/checkout", { method: "POST", body }),
    request("/retail/checkout", { method: "POST", body }),
  ]);
  assert.ok(responses.every((response) => response.status === 200 || response.status === 201 || response.status === 409));
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  const orders = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.idempotencyKey, key));
  assert.equal(orders.length, 1);
  createdOrderIds.push(orders[0]!.id);
  const evidence = await db.select().from(retailOrderItemsTable).where(eq(retailOrderItemsTable.orderId, orders[0]!.id));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]!.aftercareRecommendationId, recommendation.id);
  assert.equal(evidence[0]!.postTreatmentRecommendationDiscountRsd, 200);
});

const assertCheckoutAftercareEvidenceReconciliation = async () => {
  const marker = `aftercare-reconciliation-${randomUUID()}`;
  const orderIds: string[] = [];
  const cartIds: string[] = [];
  let userId: string | undefined;
  let recommendationId: string | undefined;
  let productId: string | undefined;
  let categoryId: string | undefined;
  let supplierId: string | undefined;
  try {
    const [supplier] = await db.insert(suppliersTable).values({
      name: `Aftercare reconciliation ${marker}`, slug: marker, scope: "B2C", active: true,
    }).returning();
    supplierId = supplier!.id;
    const [category] = await db.insert(productCategoriesTable).values({
      supplierId: supplierId!, name: `Aftercare reconciliation ${marker}`, slug: `${marker}-category`, active: true,
    }).returning();
    categoryId = category!.id;
    const [product] = await db.insert(productsTable).values({
      supplierId: supplierId!, categoryId: categoryId!, categoryName: category!.name, name: `Aftercare reconciliation ${marker}`,
      description: "Isolated aftercare reconciliation product.", publicDescription: "Isolated product.",
      imageUrl: "/aftercare-reconciliation.jpg", price: 2_500, publicPrice: 2_500, publicDiscountPrice: 2_000,
      costPriceRsd: 900, retailEnabled: true, professionalEnabled: false, stock: 10,
      sku: marker, unit: "kom", weightGrams: 500, active: true,
    }).returning();
    productId = product!.id;
    const [customerUser] = await db.insert(usersTable).values({
      firstName: "Aftercare", lastName: marker, email: `${marker}@example.test`,
      passwordHash: await hashPassword(marker), passwordSetAt: new Date(), role: "CUSTOMER",
    }).returning();
    assert.ok(customerUser);
    userId = customerUser.id;
    const customer = {
      user: customerUser,
      cookie: `${sessionCookieName}=${await createSession(customerUser.id)}`,
    };
    const recommendation = await seedAftercareRecommendation(userId!);
    recommendationId = recommendation.id;
    await db.insert(aftercareRecommendationLinesTable).values({
      recommendationId: recommendationId!, kind: "PRODUCT", productId: productId!,
      treatmentIds: ["00000000-0000-4000-8000-000000000005"], coveredProductIds: [productId!],
      catalogSnapshot: {}, pricingSnapshot: {}, discountKind: "POST_TREATMENT_RECOMMENDATION_DISCOUNT", discountPercent: 10,
    });
    const checkout = async (suffix: string) => {
      const request = retailClient(customer.cookie);
      const cartResponse = await request("/retail/cart");
      assert.equal(cartResponse.status, 200);
      cartIds.push((await cartResponse.json() as RetailCart).id);
      assert.equal((await request("/retail/cart/items", {
        method: "POST", body: JSON.stringify({ productId, quantity: 1 }),
      })).status, 201);
      const previewResponse = await request(
        `/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&aftercareRecommendationId=${recommendationId}`,
      );
      assert.equal(previewResponse.status, 200);
      const preview = await previewResponse.json() as RetailCheckoutPreview;
      const response = await request("/retail/checkout", { method: "POST", body: JSON.stringify({
        idempotencyKey: `${marker}-${suffix}`, firstName: "Evidence", lastName: "Kupac",
        email: `${marker}-${suffix}@example.test`, phone: "+381601234567", street: "Test 1",
        city: "Novi Sad", postalCode: "21000", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
        aftercareRecommendationId: recommendationId!, expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost, expectedTotal: preview.total,
      }) });
      assert.equal(response.status, 201);
      const order = await response.json() as RetailOrder;
      orderIds.push(order.id);
      await db.update(retailOrdersTable).set({ status: "delivered", paymentStatus: "paid" })
        .where(eq(retailOrdersTable.id, order.id));
      const [item] = await db.select().from(retailOrderItemsTable)
        .where(eq(retailOrderItemsTable.orderId, order.id));
      assert.ok(item?.aftercareRecommendationId === recommendationId);
      assert.ok((item?.postTreatmentRecommendationDiscountRsd ?? 0) > 0);
      assert.ok((item?.lineCogsRsd ?? 0) > 0);
      assert.ok((item?.realizedRevenueRsd ?? 0) > 0);
      return { order, item: item! };
    };

    const first = await checkout("first");
  const firstEvidence = {
    aftercareRecommendationId: first.item.aftercareRecommendationId,
    postTreatmentRecommendationDiscountRsd: first.item.postTreatmentRecommendationDiscountRsd,
    personalizedTreatmentBundleDiscountRsd: first.item.personalizedTreatmentBundleDiscountRsd,
    lineCogsRsd: first.item.lineCogsRsd,
    realizedRevenueRsd: first.item.realizedRevenueRsd,
  };
    await reconcileAftercareConversions();
  let [attributed] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, recommendationId));
  let [line] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendationId));
  assert.equal(attributed?.convertedOrderId, first.order.id);
  assert.equal(line?.purchasedOrderId, first.order.id);

    await db.update(retailOrdersTable).set({ status: "cancelled", paymentStatus: "refunded" })
    .where(eq(retailOrdersTable.id, first.order.id));
    await reconcileAftercareConversions();
  [attributed] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, recommendationId));
  [line] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendationId));
  assert.equal(attributed?.convertedOrderId, null);
  assert.equal(line?.purchasedOrderId, null);
  const [firstAfterRefund] = await db.select().from(retailOrderItemsTable)
    .where(eq(retailOrderItemsTable.id, first.item.id));
  assert.deepEqual({
    aftercareRecommendationId: firstAfterRefund?.aftercareRecommendationId,
    postTreatmentRecommendationDiscountRsd: firstAfterRefund?.postTreatmentRecommendationDiscountRsd,
    personalizedTreatmentBundleDiscountRsd: firstAfterRefund?.personalizedTreatmentBundleDiscountRsd,
    lineCogsRsd: firstAfterRefund?.lineCogsRsd,
    realizedRevenueRsd: firstAfterRefund?.realizedRevenueRsd,
  }, firstEvidence);

    const second = await checkout("second");
  await db.update(retailOrdersTable).set({ createdAt: new Date(Date.now() + 1_000) })
    .where(eq(retailOrdersTable.id, second.order.id));
  const secondEvidence = {
    aftercareRecommendationId: second.item.aftercareRecommendationId,
    postTreatmentRecommendationDiscountRsd: second.item.postTreatmentRecommendationDiscountRsd,
    personalizedTreatmentBundleDiscountRsd: second.item.personalizedTreatmentBundleDiscountRsd,
    lineCogsRsd: second.item.lineCogsRsd,
    realizedRevenueRsd: second.item.realizedRevenueRsd,
  };
    await reconcileAftercareConversions();
  [attributed] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, recommendationId));
  [line] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendationId));
  assert.equal(attributed?.convertedOrderId, second.order.id);
  assert.equal(line?.purchasedOrderId, second.order.id);
  const evidenceRows = await db.select().from(retailOrderItemsTable)
    .where(inArray(retailOrderItemsTable.id, [first.item.id, second.item.id]));
  assert.equal(evidenceRows.length, 2);
  assert.deepEqual(evidenceRows.find((item) => item.id === first.item.id) && {
    aftercareRecommendationId: evidenceRows.find((item) => item.id === first.item.id)!.aftercareRecommendationId,
    postTreatmentRecommendationDiscountRsd: evidenceRows.find((item) => item.id === first.item.id)!.postTreatmentRecommendationDiscountRsd,
    personalizedTreatmentBundleDiscountRsd: evidenceRows.find((item) => item.id === first.item.id)!.personalizedTreatmentBundleDiscountRsd,
    lineCogsRsd: evidenceRows.find((item) => item.id === first.item.id)!.lineCogsRsd,
    realizedRevenueRsd: evidenceRows.find((item) => item.id === first.item.id)!.realizedRevenueRsd,
  }, firstEvidence);
    assert.deepEqual(evidenceRows.find((item) => item.id === second.item.id) && {
    aftercareRecommendationId: evidenceRows.find((item) => item.id === second.item.id)!.aftercareRecommendationId,
    postTreatmentRecommendationDiscountRsd: evidenceRows.find((item) => item.id === second.item.id)!.postTreatmentRecommendationDiscountRsd,
    personalizedTreatmentBundleDiscountRsd: evidenceRows.find((item) => item.id === second.item.id)!.personalizedTreatmentBundleDiscountRsd,
    lineCogsRsd: evidenceRows.find((item) => item.id === second.item.id)!.lineCogsRsd,
    realizedRevenueRsd: evidenceRows.find((item) => item.id === second.item.id)!.realizedRevenueRsd,
    }, secondEvidence);
  } finally {
    if (orderIds.length) {
      await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, orderIds));
      await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, orderIds));
    }
    if (cartIds.length) {
      await db.delete(retailCartItemsTable).where(inArray(retailCartItemsTable.cartId, cartIds));
      await db.delete(savedRetailCartItemsTable).where(inArray(savedRetailCartItemsTable.cartId, cartIds));
      await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, cartIds));
    }
    if (recommendationId) await db.delete(aftercareRecommendationLinesTable)
      .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendationId));
    if (recommendationId) await db.delete(aftercareRecommendationsTable)
      .where(eq(aftercareRecommendationsTable.id, recommendationId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
    if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
    if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  }
};

test("an excluded B2C free-shipping coupon cannot waive checkout delivery", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  const baselineResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(baselineResponse.status, 200);
  const baseline = await baselineResponse.json() as RetailCheckoutPreview;
  assert.ok(baseline.shipping.shippingCost > 0);

  const code = `B2C-FREE-${randomUUID().slice(0, 8)}`.toUpperCase();
  const [restrictedCoupon] = await db.insert(couponsTable).values({
    code,
    audience: "B2C",
    discountType: "FIXED_RSD",
    discountValue: 1,
    freeShipping: true,
    excludeProductIds: [createdProductId],
  }).returning();
  try {
    const restrictedPreview = await request(
      `/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&couponCode=${encodeURIComponent(code)}`,
    );
    assert.equal(restrictedPreview.status, 409);
    assert.equal((await restrictedPreview.json() as ApiError).code, "COUPON_APPLICABILITY");

    const restrictedCheckout = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-restricted-coupon-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `retail-restricted-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        couponCode: code,
        expectedSubtotal: baseline.cart.subtotal,
        expectedShippingCost: baseline.shipping.shippingCost,
        expectedTotal: baseline.total,
      }),
    });
    assert.equal(restrictedCheckout.status, 409);
    assert.equal((await restrictedCheckout.json() as ApiError).code, "COUPON_APPLICABILITY");
  } finally {
    await db.delete(couponsTable).where(eq(couponsTable.id, restrictedCoupon!.id));
  }
});

test("B2C preview, final checkout and persistence keep the literal legacy pricing projection", async () => {
  assert.ok(createdSupplierId);
  assert.ok(createdCategoryId);
  const marker = randomUUID();
  const [category] = await db.select().from(productCategoriesTable)
    .where(eq(productCategoriesTable.id, createdCategoryId)).limit(1);
  assert.ok(category);
  const [product] = await db.insert(productsTable).values({
    supplierId: createdSupplierId,
    categoryId: createdCategoryId,
    categoryName: category.name,
    name: `Pricing parity ${marker}`,
    description: "Pricing parity fixture.",
    publicDescription: "Pricing parity public fixture.",
    imageUrl: "/retail-checkout-test.jpg",
    price: 1_000,
    publicPrice: 1_000,
    publicDiscountPrice: 800,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 5,
    sku: `pricing-parity-${marker}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  assert.ok(product);
  createdAuxiliaryProductIds.push(product.id);
  const code = `PARITY-${marker.slice(0, 8)}`.toUpperCase();
  const [coupon] = await db.insert(couponsTable).values({
    code,
    audience: "B2C",
    discountType: "FIXED_RSD",
    discountValue: 100,
    includeProductIds: [product.id],
  }).returning();
  assert.ok(coupon);
  createdCouponIds.push(coupon.id);

  const request = retailClient();
  assert.equal((await addRetailItem(request, product.id, 1)).status, 201);
  const previewResponse = await request(
    `/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&couponCode=${encodeURIComponent(code)}`,
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview & {
    couponDiscountRsd: number;
    coupon: { code: string; discountRsd: number; freeShipping: boolean; allocations: Record<string, number> };
    referralCreditAppliedRsd: number;
    shippingRsd: number;
    payableTotalRsd: number;
  };
  assert.equal(JSON.stringify({
    subtotal: preview.cart.subtotal,
    couponDiscountRsd: preview.couponDiscountRsd,
    referralCreditAppliedRsd: preview.referralCreditAppliedRsd,
    merchandiseSubtotalRsd: preview.merchandiseSubtotalRsd,
    shippingRsd: preview.shippingRsd,
    payableTotalRsd: preview.payableTotalRsd,
    total: preview.total,
  }), "{\"subtotal\":800,\"couponDiscountRsd\":100,\"referralCreditAppliedRsd\":0,\"merchandiseSubtotalRsd\":0,\"shippingRsd\":390,\"payableTotalRsd\":1090,\"total\":1090}");
  assert.equal(preview.coupon.discountRsd, 100);
  assert.equal(Object.values(preview.coupon.allocations).reduce((sum, amount) => sum + amount, 0), 100);
  assert.doesNotMatch(JSON.stringify(preview), /adjustments|breakdown|COMMERCE_PRICING_POLICY|pricingPolicy/);

  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-pricing-parity-${marker}`,
      firstName: "Pricing",
      lastName: "Parity",
      email: `pricing-parity-${marker}@example.test`,
      phone: "+381601234567",
      street: "Test ulica 1",
      city: "Novi Sad",
      postalCode: "21000",
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod: "courier",
      couponCode: code,
      expectedSubtotal: preview.cart.subtotal,
      expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(checkoutResponse.status, 201, await checkoutResponse.clone().text());
  const order = await checkoutResponse.json() as RetailOrder;
  createdOrderIds.push(order.id);
  assert.doesNotMatch(JSON.stringify(order), /adjustments|breakdown|COMMERCE_PRICING_POLICY|pricingPolicy/);

  const [[savedOrder], savedLines] = await Promise.all([
    db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, order.id)),
    db.select().from(retailOrderItemsTable).where(eq(retailOrderItemsTable.orderId, order.id)),
  ]);
  assert.ok(savedOrder);
  assert.equal(savedLines.length, 1);
  assert.deepEqual({
    subtotal: savedOrder.subtotal,
    couponDiscountRsd: savedOrder.couponDiscountRsd,
    referralBaseRsd: savedOrder.referralCreditMerchandiseSubtotalRsd,
    referralAppliedRsd: savedOrder.referralCreditAppliedRsd,
    shippingRsd: savedOrder.shippingCost,
    payableTotalRsd: savedOrder.total,
    unitPriceRsd: savedLines[0]!.unitPrice,
    lineSubtotalRsd: savedLines[0]!.lineSubtotal,
    lineCouponRsd: savedLines[0]!.couponDiscountRsd,
    lineTotalRsd: savedLines[0]!.lineTotal,
    priceSource: savedLines[0]!.priceSource,
  }, {
    subtotal: preview.cart.subtotal,
    couponDiscountRsd: preview.couponDiscountRsd,
    referralBaseRsd: preview.merchandiseSubtotalRsd,
    referralAppliedRsd: preview.referralCreditAppliedRsd,
    shippingRsd: preview.shippingRsd,
    payableTotalRsd: preview.payableTotalRsd,
    unitPriceRsd: 800,
    lineSubtotalRsd: 800,
    lineCouponRsd: 100,
    lineTotalRsd: 700,
    priceSource: "SALE",
  });
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

    const skuAfterOrder = `retail-checkout-after-order-${randomUUID()}`;
    await db.update(productsTable).set({ sku: skuAfterOrder }).where(eq(productsTable.id, createdProductId));
    const [admin] = await db.insert(usersTable).values({
      firstName: "Retail",
      lastName: "Search Admin",
      email: `retail-reference-admin-${randomUUID()}@example.test`,
      passwordHash: await hashPassword(`retail-reference-admin-${randomUUID()}`),
      passwordSetAt: new Date(),
      role: "ADMIN",
    }).returning();
    assert.ok(admin);
    try {
      const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
      const searchQueries: string[] = [];
      const stopObserving = observeDatabaseQueries(({ sql: query }) => searchQueries.push(query));
      let byCatalogReference: Response;
      try {
        byCatalogReference = await fetch(
          `${baseUrl}/admin/retail-orders?search=${encodeURIComponent(product.catalogReference.toLowerCase())}`,
          { headers: { cookie: adminCookie } },
        );
      } finally {
        stopObserving();
      }
      assert.equal(byCatalogReference.status, 200);
      const referenceResults = await byCatalogReference.json() as Array<{ id: string }>;
      assert.ok(referenceResults.some((candidate) => candidate.id === order.id), "an order must remain searchable by its saved catalog reference");
      const retailOrderSearch = searchQueries.find((query) => (
        query.includes('from "retail_order_items" inner join "retail_orders"')
        && query.includes('"product_catalog_reference" =')
      ));
      assert.ok(retailOrderSearch, "canonical reference search must begin at retail order items and join matching orders");
      assert.ok(
        !searchQueries.some((query) => /^select "order_id" from "retail_order_items"/i.test(query)),
        "reference search must not load an unbounded order-id list into application memory",
      );

      const byEditedSku = await fetch(
        `${baseUrl}/admin/retail-orders?search=${encodeURIComponent(skuAfterOrder)}`,
        { headers: { cookie: adminCookie } },
      );
      assert.equal(byEditedSku.status, 200);
      const skuResults = await byEditedSku.json() as Array<{ id: string }>;
      assert.ok(!skuResults.some((candidate) => candidate.id === order.id), "admin search must not use the product's current editable SKU");

      const planMarker = `retail-reference-plan-${randomUUID()}`;
      let planText = "";
      try {
        await pool.query(
          `WITH inserted_orders AS (
             INSERT INTO retail_orders (
               id, order_number, cart_id, user_id, tracking_token_hash, idempotency_key,
               status, payment_method, payment_status, delivery_method,
               subtotal, shipping_cost, total,
               shipping_name, shipping_address, shipping_city, shipping_postal_code,
               shipping_phone, shipping_email, shipping_note, created_at, updated_at
             )
             SELECT gen_random_uuid(), $2 || '-' || sequence_number, source.cart_id, NULL,
                    $2 || '-tracking-' || sequence_number, $2 || '-idempotency-' || sequence_number,
                    'pending', 'BANK_TRANSFER', 'unpaid', 'courier',
                    1, 0, 1,
                    'Plan fixture', 'Test ulica 1', 'Novi Sad', '21000',
                    '+381601234567', $2 || '-' || sequence_number || '@example.test',
                    'Retail reference plan fixture', now(), now()
             FROM retail_orders AS source
             CROSS JOIN generate_series(1, 1500) AS sequence_number
             WHERE source.id = $1
             RETURNING id
           )
           INSERT INTO retail_order_items (
             order_id, product_id, product_name, product_image_url,
             product_catalog_reference, variant_value, variant_label, unit_price, quantity,
             supplier_id, supplier_name, supplier_slug, product_sku_snapshot,
             line_subtotal, line_total
           )
           SELECT inserted_order.id, product.id, 'Plan distractor', '/reference-plan.jpg',
                  $2 || '-reference-' || inserted_order.id, NULL, NULL, 1, 1,
                  product.supplier_id, supplier.name, supplier.slug, product.sku, 1, 1
           FROM inserted_orders AS inserted_order
           CROSS JOIN products AS product
           INNER JOIN suppliers AS supplier ON supplier.id = product.supplier_id
           WHERE product.id = $3::uuid`,
          [order.id, planMarker, createdProductId],
        );
        await pool.query("ANALYZE retail_orders, retail_order_items");
        const explained = await pool.query(
          `EXPLAIN (COSTS OFF, FORMAT TEXT)
           SELECT DISTINCT retail_order.id, retail_order.created_at
           FROM retail_order_items AS retail_item
           INNER JOIN retail_orders AS retail_order ON retail_item.order_id = retail_order.id
           WHERE retail_item.product_catalog_reference = $1
           ORDER BY retail_order.created_at DESC, retail_order.id DESC
           LIMIT 100`,
          [product.catalogReference],
        );
        planText = explained.rows.map((row) => String(row["QUERY PLAN"])).join("\n");
      } finally {
        await pool.query(`DELETE FROM retail_orders WHERE order_number LIKE $1`, [`${planMarker}-%`]);
      }
      assert.match(
        planText,
        /retail_order_items_catalog_reference_order_idx/,
        "normal canonical-reference plan must use the covering item index with a large order history",
      );
      assert.doesNotMatch(planText, /Seq Scan on retail_order_items/, "canonical reference lookup must not scan all retail order items");
      assert.doesNotMatch(planText, /Seq Scan on retail_orders/, "canonical reference lookup must not scan all retail orders");
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    }
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

test("guest checkout stays anonymous while CUSTOMER and JOBSEEKER orders are owned and isolated", async () => {
  assert.ok(createdProductId);
  const place = async (request: ReturnType<typeof retailClient>, marker: string) => {
    assert.equal((await addRetailItem(request, createdProductId!, 1)).status, 201);
    const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as RetailCheckoutPreview;
    const response = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-account-${marker}-${randomUUID()}`,
        firstName: "Retail", lastName: "Kupac", email: `${marker}-${randomUUID()}@example.test`,
        phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
        paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal, expectedShippingCost: preview.shipping.shippingCost, expectedTotal: preview.total,
      }),
    });
    assert.equal(response.status, 201);
    const order = await response.json() as RetailOrder;
    createdOrderIds.push(order.id);
    return order;
  };

  const guest = await place(retailClient(), "guest");
  const [guestRow] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, guest.id));
  assert.equal(guestRow?.userId, null, "guest checkout must never create or attach an account");

  const customer = await createTestUser("CUSTOMER");
  const jobseeker = await createTestUser("JOBSEEKER");
  const customerOrder = await place(retailClient(customer.cookie), "customer");
  const jobseekerOrder = await place(retailClient(jobseeker.cookie), "jobseeker");
  const [customerRow, jobseekerRow] = await Promise.all([
    db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, customerOrder.id)).then((rows) => rows[0]),
    db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, jobseekerOrder.id)).then((rows) => rows[0]),
  ]);
  assert.equal(customerRow?.userId, customer.user.id);
  assert.equal(jobseekerRow?.userId, jobseeker.user.id);

  const customerHistory = await retailClient(customer.cookie)("/customer/retail-orders");
  assert.equal(customerHistory.status, 200);
  assert.ok((await customerHistory.json() as RetailOrder[]).some((order) => order.id === customerOrder.id));
  const jobseekerHistory = await retailClient(jobseeker.cookie)("/customer/retail-orders");
  assert.equal(jobseekerHistory.status, 200);
  assert.ok((await jobseekerHistory.json() as RetailOrder[]).some((order) => order.id === jobseekerOrder.id));
  const denied = await retailClient(jobseeker.cookie)(`/customer/retail-orders/${customerOrder.id}`);
  assert.equal(denied.status, 404, "another retail account cannot read an order by id");
});

test("B2C sale lines are excluded from the referral base in preview and final checkout", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;
  assert.equal(preview.merchandiseSubtotalRsd, 0);

  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-referral-stacking-${randomUUID()}`,
      firstName: "Retail", lastName: "Kupac", email: `stacking-${randomUUID()}@example.test`,
      phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
      paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
      expectedSubtotal: preview.cart.subtotal,
      expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(checkoutResponse.status, 201);
  const order = await checkoutResponse.json() as RetailOrder;
  createdOrderIds.push(order.id);
  const [persisted] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, order.id));
  assert.equal(persisted?.referralCreditMerchandiseSubtotalRsd, preview.merchandiseSubtotalRsd);
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

test("two customers concurrently claiming one anonymous cart produce one winner and one isolated loser", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  const anonymous = await fetch(`${baseUrl}/retail/cart/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  });
  assert.equal(anonymous.status, 201);
  const anonymousCart = await anonymous.json() as RetailCart;
  createdCartIds.push(anonymousCart.id);
  const sharedCookie = retailCartCookie(anonymous);
  const [first, second] = await Promise.all([createTestUser(), createTestUser()]);

  const responses = await Promise.all([first, second].map(({ cookie }) => fetch(`${baseUrl}/retail/cart`, {
    headers: { cookie: `${sharedCookie}; ${cookie}` },
  })));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const carts = await Promise.all(responses.map((response) => response.json() as Promise<RetailCart>));
  for (const cart of carts) if (!createdCartIds.includes(cart.id)) createdCartIds.push(cart.id);

  const winners = carts.filter((cart) => cart.id === anonymousCart.id && cart.items.length === 1);
  const losers = carts.filter((cart) => cart.id !== anonymousCart.id && cart.items.length === 0);
  assert.equal(winners.length, 1, "exactly one account claims the anonymous cart and its item");
  assert.equal(losers.length, 1, "the losing account receives a distinct empty cart");
  const persisted = await db.select().from(retailCartsTable).where(inArray(retailCartsTable.id, carts.map((cart) => cart.id)));
  assert.equal(new Set(persisted.map((cart) => cart.userId)).size, 2);
  assert.ok(persisted.every((cart) => cart.userId === first.user.id || cart.userId === second.user.id));
});

test("logout and account switching hide bound active and saved items, while the owner can restore them", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  const owner = await createTestUser();
  const other = await createTestUser();
  const added = await fetch(`${baseUrl}/retail/cart/items`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({ productId: createdProductId, quantity: 2 }),
  });
  assert.equal(added.status, 201);
  const original = await added.json() as RetailCart;
  createdCartIds.push(original.id);
  const ownerCartCookie = retailCartCookie(added);
  const ownerRequest = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      cookie: `${ownerCartCookie}; ${owner.cookie}`,
      ...(init.headers ?? {}),
    },
  });
  const item = original.items[0];
  assert.ok(item);
  const savedResponse = await ownerRequest(`/retail/cart/items/${item.id}/save-for-later`, { method: "POST" });
  assert.equal(savedResponse.status, 200);
  const savedCart = await savedResponse.json() as RetailCart;
  const savedItem = savedCart.savedItems?.[0];
  assert.ok(savedItem);
  assert.equal((await ownerRequest("/retail/cart/items", {
    method: "POST", body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  })).status, 201);

  const [bound] = await db.select().from(retailCartsTable).where(eq(retailCartsTable.id, original.id)).limit(1);
  assert.equal(bound?.userId, owner.user.id);
  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { cookie: `${ownerCartCookie}; ${owner.cookie}` },
  });
  assert.equal(logout.status, 204);
  const tokenOnlyResponse = await fetch(`${baseUrl}/retail/cart`, {
    headers: { cookie: ownerCartCookie },
  });
  assert.equal(tokenOnlyResponse.status, 200);
  const tokenOnlyCart = await tokenOnlyResponse.json() as RetailCart;
  createdCartIds.push(tokenOnlyCart.id);
  assert.notEqual(tokenOnlyCart.id, original.id);
  assert.deepEqual(tokenOnlyCart.items, []);
  assert.deepEqual(tokenOnlyCart.savedItems ?? [], []);

  const switchedResponse = await fetch(`${baseUrl}/retail/cart`, {
    headers: { cookie: `${ownerCartCookie}; ${other.cookie}` },
  });
  assert.equal(switchedResponse.status, 200);
  const switchedCart = await switchedResponse.json() as RetailCart;
  createdCartIds.push(switchedCart.id);
  assert.notEqual(switchedCart.id, original.id);
  assert.deepEqual(switchedCart.items, []);
  assert.deepEqual(switchedCart.savedItems ?? [], []);

  const restored = await fetch(`${baseUrl}/retail/cart/saved-items/${savedItem.id}/restore`, {
    method: "POST",
    headers: { cookie: `${ownerCartCookie}; ${sessionCookieName}=${await createSession(owner.user.id)}` },
  });
  assert.equal(restored.status, 200);
  const ownerCart = await restored.json() as RetailCart;
  assert.equal(ownerCart.id, original.id);
  assert.equal(ownerCart.items[0]?.quantity, 3);
  assert.deepEqual(ownerCart.savedItems ?? [], []);
});

test("a cart created under an old MOQ cannot be previewed or checked out after the MOQ rises", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  const request = retailClient();
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  await db.update(productsTable).set({ minimumOrderQuantity: 2 }).where(eq(productsTable.id, createdProductId));
  try {
    const preview = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(preview.status, 200, "the stale cart remains visible so the shopper can correct it");
    const checkout = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-stale-moq-${randomUUID()}`,
        firstName: "Retail", lastName: "MOQ", email: `moq-${randomUUID()}@example.test`,
        phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
        paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
      }),
    });
    assert.equal(checkout.status, 409);
    assert.equal((await checkout.json() as ApiError).code, "MINIMUM_ORDER_QUANTITY");
  } finally {
    await db.update(productsTable).set({ minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  }
});

test("waitlist stock transitions create one outbox event and worker replay creates one notification", async () => {
  assert.ok(createdProductId);
  const customer = await createTestUser();
  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, createdProductId));
  const subscribe = await fetch(`${baseUrl}/shop/public/products/${createdProductId}/waitlist`, {
    method: "POST",
    headers: { cookie: customer.cookie },
  });
  assert.equal(subscribe.status, 201);
  const waitlist = await subscribe.json() as { id: string };

  await db.update(productsTable).set({ stock: 1 }).where(eq(productsTable.id, createdProductId));
  await db.update(productsTable).set({ stock: 2 }).where(eq(productsTable.id, createdProductId));
  const outbox = await db.select().from(productWaitlistNotificationOutboxTable)
    .where(eq(productWaitlistNotificationOutboxTable.waitlistId, waitlist.id));
  assert.equal(outbox.length, 1, "one availability episode has one durable outbox row");
  await db.update(productWaitlistNotificationOutboxTable).set({ createdAt: new Date(0) })
    .where(eq(productWaitlistNotificationOutboxTable.id, outbox[0]!.id));
  assert.deepEqual(await runProductWaitlistNotificationWorker(1), { processed: 1 });
  await db.update(productWaitlistNotificationOutboxTable).set({ processedAt: null, createdAt: new Date(0) })
    .where(eq(productWaitlistNotificationOutboxTable.id, outbox[0]!.id));
  assert.deepEqual(await runProductWaitlistNotificationWorker(1), { processed: 1 });
  const notifications = await db.select().from(commerceCustomerNotificationsTable)
    .where(eq(commerceCustomerNotificationsTable.waitlistId, waitlist.id));
  assert.equal(notifications.length, 1, "replaying a delivered outbox row is notification-idempotent");
});

test("authenticated checkout awards and reverses loyalty once, and repeat-last is request-idempotent", async () => {
  assert.ok(createdProductId);
  const customer = await createTestUser();
  const admin = await createTestUser("ADMIN");
  let [settingsBefore] = await db.select().from(shopSettingsTable).limit(1);
  const ownsSettings = !settingsBefore;
  if (!settingsBefore) {
    [settingsBefore] = await db.insert(shopSettingsTable).values({
      showLoyaltyPoints: true,
      pointsPer100Rsd: 1,
      lowStockThreshold: 5,
      defaultDeliveryBusinessDays: 3,
    }).returning();
  }
  assert.ok(settingsBefore);
  const [productBefore] = await db.select().from(productsTable).where(eq(productsTable.id, createdProductId)).limit(1);
  assert.ok(productBefore);
  await db.update(shopSettingsTable).set({ showLoyaltyPoints: true, pointsPer100Rsd: 2 })
    .where(eq(shopSettingsTable.id, settingsBefore.id));
  await db.update(productsTable).set({
    stock: 10, minimumOrderQuantity: 1, publicDiscountPrice: null, quantityPricingTiers: [],
  }).where(eq(productsTable.id, createdProductId));
  try {
    const request = retailClient(customer.cookie);
    assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
    const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as RetailCheckoutPreview;
    const checkout = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-loyalty-${randomUUID()}`,
        firstName: "Retail", lastName: "Loyalty", email: customer.user.email,
        phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
        paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal, expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkout.status, 201);
    const order = await checkout.json() as RetailOrder;
    createdOrderIds.push(order.id);
    const awards = await db.select().from(loyaltyPointLedgerTable).where(eq(loyaltyPointLedgerTable.retailOrderId, order.id));
    assert.equal(awards.length, 1);
    assert.equal(awards[0]?.type, "AWARD");
    assert.equal(awards[0]?.points, 50);

    const reorderKey = `repeat-${randomUUID()}`;
    const repeated = await Promise.all([1, 2].map(() => request("/retail/orders/repeat-last", {
      method: "POST", headers: { "Idempotency-Key": reorderKey },
    })));
    assert.deepEqual(repeated.map((response) => response.status), [200, 200]);
    const outcomes = await Promise.all(repeated.map((response) => response.json()));
    assert.deepEqual(outcomes[0], outcomes[1]);
    const cartAfterRepeat = (outcomes[0] as { cart: RetailCart }).cart;
    assert.equal(cartAfterRepeat.items[0]?.quantity, 1, "a replay must not add the order twice");
    const actions = await db.select().from(reorderActionsTable).where(and(
      eq(reorderActionsTable.userId, customer.user.id),
      eq(reorderActionsTable.idempotencyKey, reorderKey),
    ));
    assert.equal(actions.length, 1);

    const cancel = () => fetch(`${baseUrl}/admin/retail-orders/${order.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ status: "cancelled" }),
    });
    assert.equal((await cancel()).status, 200);
    assert.equal((await cancel()).status, 200);
    const fulfillmentHistory = await db.select().from(retailOrderStatusHistoryTable)
      .where(eq(retailOrderStatusHistoryTable.retailOrderId, order.id));
    assert.equal(fulfillmentHistory.filter((event) => event.field === "fulfillmentStatus").length, 1);
    assert.equal(fulfillmentHistory.find((event) => event.field === "fulfillmentStatus")?.nextValue, "CANCELLED");
    const ledger = await db.select().from(loyaltyPointLedgerTable)
      .where(eq(loyaltyPointLedgerTable.retailOrderId, order.id));
    assert.equal(ledger.filter((entry) => entry.type === "AWARD").length, 1);
    assert.equal(ledger.filter((entry) => entry.type === "REVERSAL").length, 1);
    assert.equal(ledger.reduce((sum, entry) => sum + entry.points, 0), 0);
    const [stockAfter] = await db.select({ stock: productsTable.stock }).from(productsTable)
      .where(eq(productsTable.id, createdProductId)).limit(1);
    assert.equal(stockAfter?.stock, 10, "repeated cancellation restores checkout stock only once");
  } finally {
    if (ownsSettings) {
      await db.delete(shopSettingsTable).where(eq(shopSettingsTable.id, settingsBefore.id));
    } else {
      await db.update(shopSettingsTable).set({
        showLoyaltyPoints: settingsBefore.showLoyaltyPoints,
        pointsPer100Rsd: settingsBefore.pointsPer100Rsd,
      }).where(eq(shopSettingsTable.id, settingsBefore.id));
    }
    await db.update(productsTable).set({
      publicDiscountPrice: productBefore.publicDiscountPrice,
      quantityPricingTiers: productBefore.quantityPricingTiers,
      minimumOrderQuantity: productBefore.minimumOrderQuantity,
    }).where(eq(productsTable.id, createdProductId));
  }
});

test("retail tracking is minimized, expires, rotates by exact lookup, and is rate limited", async () => {
  await db.delete(retailTrackingRateLimitsTable);
  assert.ok(createdProductId);
  const customer = await createTestUser("CUSTOMER");
  const request = retailClient(customer.cookie);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 })
    .where(eq(productsTable.id, createdProductId));
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  const preview = await (await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad")).json() as RetailCheckoutPreview;
  const checkout = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-tracking-${randomUUID()}`,
      firstName: "Retail", lastName: "Tracking", email: customer.user.email.toUpperCase(),
      phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
      paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
      expectedSubtotal: preview.cart.subtotal, expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(checkout.status, 201);
  const order = await checkout.json() as RetailOrder;
  createdOrderIds.push(order.id);
  assert.ok(order.trackingToken);
  assert.ok(order.orderNumber);

  const tracked = await request(`/retail/orders/track?token=${encodeURIComponent(order.trackingToken)}`);
  assert.equal(tracked.status, 200);
  const publicOrder = await tracked.json() as Record<string, unknown>;
  assert.equal(TrackRetailOrderResponse.safeParse(publicOrder).success, true);
  assert.deepEqual(Object.keys(publicOrder).sort(), [
    "courierUrl", "createdAt", "orderNumber", "progressStage", "status",
    "statusLabel", "statusUpdatedAt", "trackingNumber",
  ]);
  assert.equal("items" in publicOrder, false);
  assert.equal("total" in publicOrder, false);
  const customerDetail = await request(`/customer/retail-orders/${order.id}`);
  assert.equal(customerDetail.status, 200);
  const customerDetailBody = await customerDetail.json() as Record<string, unknown>;
  assert.equal(GetCustomerRetailOrderResponse.safeParse(customerDetailBody).success, true);
  assert.equal("fulfillmentHistory" in customerDetailBody, false);
  const admin = await createTestUser("ADMIN");
  const adminDetail = await retailClient(admin.cookie)(`/admin/retail-orders/${order.id}`);
  assert.equal(adminDetail.status, 200);
  const adminDetailBody = await adminDetail.json() as Record<string, unknown>;
  assert.equal(AdminGetRetailOrderResponse.safeParse(adminDetailBody).success, true);
  assert.ok(Array.isArray(adminDetailBody.fulfillmentHistory));

  await db.update(retailOrdersTable).set({ trackingTokenExpiresAt: new Date(0) })
    .where(eq(retailOrdersTable.id, order.id));
  assert.equal((await request(`/retail/orders/track?token=${encodeURIComponent(order.trackingToken)}`)).status, 404);
  const lookup = await request("/retail/orders/track/lookup", {
    method: "POST",
    body: JSON.stringify({ orderNumber: order.orderNumber, email: `  ${customer.user.email.toUpperCase()} ` }),
  });
  assert.equal(lookup.status, 200);
  assert.equal((await request(`/retail/orders/track?token=${encodeURIComponent(order.trackingToken)}`)).status, 404);
  const wrongBody = JSON.stringify({ orderNumber: order.orderNumber, email: "wrong@example.test" });
  const failures: Response[] = [];
  for (let index = 0; index < 10; index += 1) {
    failures.push(await request("/retail/orders/track/lookup", {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.${index + 1}` },
      body: wrongBody,
    }));
  }
  assert.equal(failures.at(-1)?.status, 429);
  assert.deepEqual(await failures[0]!.json(), await failures.at(-1)!.json());
});

test("checkout aftercare evidence remains immutable while reconciliation clears and supersedes attribution",
  assertCheckoutAftercareEvidenceReconciliation);