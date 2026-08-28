import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  b2bQuotesTable, catalogSyncRunsTable, couponsTable, db, emailDeliveriesTable, loyaltyPointLedgerTable, mediaAssetsTable, priceInquiriesTable,
  orderItemsTable, ordersTable, productCategoriesTable, productsTable,
  retailCartItemsTable, retailCartsTable, retailOrderItemsTable, retailOrdersTable, reviewRewardIssuancesTable,
  retailProductReviewAttachmentsTable, retailProductReviewsTable, rmaAttachmentsTable, rmaStatusHistoryTable, rmasTable, salonsTable, shopSettingsTable,
  shoppingCartItemsTable, shoppingCartsTable, suppliersTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { runRetailReviewInvitationSweep } from "./review-invitations";
import { validatedSwatch } from "../routes/commerce-ef";
import { settledCommerceSpend } from "./deo-g2-rule-loader";

const marker = `commerce-ef-${randomUUID()}`;
const ids = { users: [] as string[], salons: [] as string[], suppliers: [] as string[], categories: [] as string[], products: [] as string[], carts: [] as string[], orders: [] as string[], retailCarts: [] as string[], retailOrders: [] as string[], assets: [] as string[] };
let base = ""; let server: ReturnType<typeof app.listen>; let salonOwner = ""; let customer = ""; let otherCustomer = ""; let admin = "";
let salonId = ""; let productId = ""; let zeroProductId = ""; let simpleRetailProductId = ""; let hiddenRelatedProductId = ""; let explicitBuyer = ""; let b2bOrderId = ""; let b2bItemId = ""; let retailOrderId = ""; let retailItemId = "";
let settings: typeof shopSettingsTable.$inferSelect | undefined;
const cookie = async (id: string) => `${sessionCookieName}=${await createSession(id)}`;
const api = (path: string, session = "", init: RequestInit = {}) => fetch(`${base}${path}`, {
  ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(session ? { cookie: session } : {}), ...(init.headers ?? {}) },
});

async function makeUser(role: "SALON_OWNER" | "CUSTOMER" | "ADMIN", suffix = "") {
  const [row] = await db.insert(usersTable).values({
    firstName: `${role}${suffix}`, lastName: marker, email: `${role}${suffix}-${marker}@example.test`,
    passwordHash: await hashPassword(marker), passwordSetAt: new Date(), role,
  }).returning();
  ids.users.push(row!.id); return row!.id;
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  process.env.APP_BASE_URL = "https://catalog.example.test";
  [salonOwner, customer, otherCustomer, explicitBuyer, admin] = await Promise.all([
    makeUser("SALON_OWNER"), makeUser("CUSTOMER"), makeUser("CUSTOMER", "-OTHER"), makeUser("CUSTOMER", "-EXPLICIT"), makeUser("ADMIN"),
  ]);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: salonOwner, name: marker, slug: marker, city: "Beograd", municipality: "Vračar", address: "Test 1",
    phone: "+381601234567", email: `${marker}@example.test`, shortDescription: marker, description: marker, imageUrl: "/test.jpg",
  }).returning(); salonId = salon!.id; ids.salons.push(salonId);
  await db.update(usersTable).set({ activeSalonId: salonId }).where(eq(usersTable.id, salonOwner));
  const [supplier] = await db.insert(suppliersTable).values({ name: marker, slug: marker, scope: "BOTH" }).returning(); ids.suppliers.push(supplier!.id);
  const [category] = await db.insert(productCategoriesTable).values({ supplierId: supplier!.id, name: marker, slug: marker }).returning(); ids.categories.push(category!.id);
  const [hiddenCategory] = await db.insert(productCategoriesTable).values({ supplierId: supplier!.id, parentId: category!.id, name: `${marker} hidden`, slug: `${marker}-hidden`, active: false }).returning(); ids.categories.push(hiddenCategory!.id);
  const created = await db.insert(productsTable).values([
    { supplierId: supplier!.id, categoryId: category!.id, categoryName: marker, name: `${marker} stocked`, description: marker, publicDescription: marker, imageUrl: "/test.jpg", price: 1000, publicPrice: 1000, professionalEnabled: true, retailEnabled: true, bulkMatrixEnabled: true, stock: 5, sku: `${marker}-1`, unit: "kom", variants: [{ value: "red", label: "Red", stock: 5, priceAdjust: 0, swatch: { kind: "COLOR", hex: "#aabbcc" } }] },
    { supplierId: supplier!.id, categoryId: category!.id, categoryName: marker, name: `${marker} zero`, description: marker, publicDescription: marker, imageUrl: "/test.jpg", price: 2000, publicPrice: 2000, professionalEnabled: true, retailEnabled: true, bulkMatrixEnabled: true, stock: 0, sku: `${marker}-2`, unit: "kom", variants: [{ value: "none", label: "None", stock: 0 }] },
    { supplierId: supplier!.id, categoryId: category!.id, categoryName: marker, name: `${marker} simple retail`, description: marker, publicDescription: marker, imageUrl: "/test.jpg", price: 900, publicPrice: 900, professionalEnabled: false, retailEnabled: true, stock: 5, sku: `${marker}-3`, unit: "kom", variants: [{ value: "shared", label: "Shared inventory" }] },
    { supplierId: supplier!.id, categoryId: hiddenCategory!.id, categoryName: hiddenCategory!.name, name: `${marker} hidden related`, description: marker, publicDescription: marker, imageUrl: "/test.jpg", price: 1100, publicPrice: 1100, professionalEnabled: false, retailEnabled: true, stock: 5, sku: `${marker}-4`, unit: "kom" },
  ]).returning();
  productId = created[0]!.id; zeroProductId = created[1]!.id; simpleRetailProductId = created[2]!.id; hiddenRelatedProductId = created[3]!.id;
  ids.products.push(productId, zeroProductId, simpleRetailProductId, hiddenRelatedProductId);
  await db.update(productsTable).set({ similarProductsMode: "MANUAL", similarProductIds: [zeroProductId, hiddenRelatedProductId] }).where(eq(productsTable.id, simpleRetailProductId));
  const [cart] = await db.insert(shoppingCartsTable).values({ salonId }).returning(); ids.carts.push(cart!.id);
  await db.insert(shoppingCartItemsTable).values({ cartId: cart!.id, productId, productName: "snapshot", productImageUrl: "/before.jpg", productSku: "before", unitPrice: 777, quantity: 2 });
  const [b2bOrder] = await db.insert(ordersTable).values({
    salonId, status: "delivered", total: 1000, subtotal: 1000, shippingName: marker,
    shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000", paymentMethod: "BANK_TRANSFER",
  }).returning();
  b2bOrderId = b2bOrder!.id; ids.orders.push(b2bOrderId);
  const [b2bItem] = await db.insert(orderItemsTable).values({
    orderId: b2bOrderId, productId, productName: marker, quantity: 1, price: 1000,
    supplierId: supplier!.id, supplierName: marker, supplierSlug: marker,
    unitPrice: 1000, lineSubtotal: 1000, lineTotal: 1000,
  }).returning();
  b2bItemId = b2bItem!.id;
  const [retailCart] = await db.insert(retailCartsTable).values({ tokenHash: randomUUID(), userId: customer }).returning(); ids.retailCarts.push(retailCart!.id);
  const [otherRetailCart] = await db.insert(retailCartsTable).values({ tokenHash: randomUUID(), userId: otherCustomer }).returning(); ids.retailCarts.push(otherRetailCart!.id);
  const [retailOrder] = await db.insert(retailOrdersTable).values({ orderNumber: marker, cartId: retailCart!.id, userId: customer, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", paymentMethod: "CARD", subtotal: 1000, total: 1000, shippingName: marker, shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test`, updatedAt: new Date("2025-01-01T00:00:00Z") }).returning();
  retailOrderId = retailOrder!.id; ids.retailOrders.push(retailOrderId);
  const [retailItem] = await db.insert(retailOrderItemsTable).values({ orderId: retailOrderId, productId, productName: marker, productImageUrl: "/test.jpg", unitPrice: 1000, quantity: 1, supplierId: supplier!.id, supplierName: marker, supplierSlug: marker, lineSubtotal: 1000, lineTotal: 1000 }).returning(); retailItemId = retailItem!.id;
  settings = (await db.select().from(shopSettingsTable).limit(1))[0];
  assert.ok(settings); await db.update(shopSettingsTable).set({ reviewRewardsEnabled: true, reviewInvitationDelayDays: 7, reviewRewardPercent: 17, reviewRewardValidityDays: 31 }).where(eq(shopSettingsTable.id, settings!.id));
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

test("loyalty settled spend includes paid and delivered COD only in both markets", async () => {
  const retailRows = await db.insert(retailOrdersTable).values([
    { orderNumber: `${marker}-loyalty-paid`, cartId: ids.retailCarts[0]!, userId: customer, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", paymentMethod: "CARD", paymentStatus: "paid", subtotal: 1000, total: 1000, shippingName: marker, shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test` },
    { orderNumber: `${marker}-loyalty-cod`, cartId: ids.retailCarts[0]!, userId: customer, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", paymentMethod: "CASH_ON_DELIVERY", paymentStatus: "unpaid", subtotal: 2000, total: 2000, shippingName: marker, shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test` },
    { orderNumber: `${marker}-loyalty-bank`, cartId: ids.retailCarts[0]!, userId: customer, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", paymentMethod: "BANK_TRANSFER", paymentStatus: "unpaid", subtotal: 4000, total: 4000, shippingName: marker, shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test` },
    { orderNumber: `${marker}-loyalty-refunded`, cartId: ids.retailCarts[0]!, userId: customer, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", paymentMethod: "CARD", paymentStatus: "refunded", subtotal: 8000, total: 8000, shippingName: marker, shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test` },
  ]).returning({ id: retailOrdersTable.id });
  ids.retailOrders.push(...retailRows.map((row) => row.id));

  const b2bRows = await db.insert(ordersTable).values([
    { salonId, status: "delivered", total: 1000, subtotal: 1000, shippingName: marker, shippingAddress: "Test 1", paymentMethod: "CARD", paymentStatus: "paid" },
    { salonId, status: "delivered", total: 2000, subtotal: 2000, shippingName: marker, shippingAddress: "Test 1", paymentMethod: "CASH_ON_DELIVERY", paymentStatus: "unpaid" },
    { salonId, status: "delivered", total: 4000, subtotal: 4000, shippingName: marker, shippingAddress: "Test 1", paymentMethod: "BANK_TRANSFER", paymentStatus: "unpaid" },
    { salonId, status: "delivered", total: 8000, subtotal: 8000, shippingName: marker, shippingAddress: "Test 1", paymentMethod: "CARD", paymentStatus: "refunded" },
  ]).returning({ id: ordersTable.id });
  ids.orders.push(...b2bRows.map((row) => row.id));

  assert.equal(await settledCommerceSpend(db, { market: "B2C", userId: customer }), 3000);
  assert.equal(await settledCommerceSpend(db, { market: "B2B", ownerUserId: salonOwner }), 3000);
  assert.equal(await settledCommerceSpend(db, { market: "B2B", salonId }), 3000);
});

test("admin profitability aggregates immutable B2C/B2B snapshots and excludes cancelled/refunded lines", async () => {
  const at = new Date("2025-01-15T12:00:00.000Z");
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  assert.ok(product);
  const snapshot = {
    productId, productName: `${marker} profitability`, supplierId: product!.supplierId,
    supplierName: marker, supplierSlug: marker, categoryIdSnapshot: product!.categoryId,
    categoryNameSnapshot: marker, brandSnapshot: marker, baseUnitPrice: 1000,
  };
  const [includedB2b] = await db.insert(ordersTable).values({ salonId, status: "delivered", fulfillmentStatus: "COMPLETED", paymentStatus: "paid", total: 2000, subtotal: 2000, shippingName: marker, shippingAddress: "Test", paymentMethod: "CARD", createdAt: at }).returning();
  ids.orders.push(includedB2b!.id);
  await db.insert(orderItemsTable).values({ orderId: includedB2b!.id, ...snapshot, quantity: 2, price: 1000, unitPrice: 1000, lineSubtotal: 2000, lineTotal: 2000, unitCostPriceRsd: 300, lineCogsRsd: 600, realizedRevenueRsd: 1800 });
  const [includedB2c] = await db.insert(retailOrdersTable).values({ orderNumber: `${marker}-profit-included`, cartId: ids.retailCarts[0]!, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", fulfillmentStatus: "COMPLETED", paymentStatus: "paid", paymentMethod: "CARD", subtotal: 1000, total: 1000, shippingName: marker, shippingAddress: "Test", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test`, createdAt: at }).returning();
  ids.retailOrders.push(includedB2c!.id);
  await db.insert(retailOrderItemsTable).values({ orderId: includedB2c!.id, ...snapshot, productImageUrl: "/test.jpg", unitPrice: 1000, quantity: 1, lineSubtotal: 1000, lineTotal: 1000, unitCostPriceRsd: 400, lineCogsRsd: 400, realizedRevenueRsd: 900 });

  const [excludedB2b] = await db.insert(ordersTable).values({ salonId, status: "cancelled", fulfillmentStatus: "CANCELLED", paymentStatus: "paid", total: 999, subtotal: 999, shippingName: marker, shippingAddress: "Test", paymentMethod: "CARD", createdAt: at }).returning();
  ids.orders.push(excludedB2b!.id);
  await db.insert(orderItemsTable).values({ orderId: excludedB2b!.id, ...snapshot, quantity: 1, price: 999, unitPrice: 999, lineSubtotal: 999, lineTotal: 999, unitCostPriceRsd: 1, lineCogsRsd: 1, realizedRevenueRsd: 999 });
  const [excludedB2c] = await db.insert(retailOrdersTable).values({ orderNumber: `${marker}-profit-refund`, cartId: ids.retailCarts[0]!, trackingTokenHash: randomUUID(), idempotencyKey: randomUUID(), status: "delivered", fulfillmentStatus: "COMPLETED", paymentStatus: "refunded", paymentMethod: "CARD", subtotal: 999, total: 999, shippingName: marker, shippingAddress: "Test", shippingCity: "Beograd", shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test`, createdAt: at }).returning();
  ids.retailOrders.push(excludedB2c!.id);
  await db.insert(retailOrderItemsTable).values({ orderId: excludedB2c!.id, ...snapshot, productImageUrl: "/test.jpg", unitPrice: 999, quantity: 1, lineSubtotal: 999, lineTotal: 999, unitCostPriceRsd: 1, lineCogsRsd: 1, realizedRevenueRsd: 999 });

  const adminCookie = await cookie(admin);
  const get = (extra = "") => api(`/admin/commerce/profitability?from=2025-01-15&to=2025-01-15&productId=${productId}${extra}`, adminCookie);
  for (const [granularity, period] of [["DAY", "2025-01-15"], ["WEEK", "2025-01-13"], ["MONTH", "2025-01-01"]] as const) {
    const response = await get(`&granularity=${granularity}`);
    assert.equal(response.status, 200);
    const report = await response.json() as { kpis: { revenueRsd: number; cogsRsd: number; profitRsd: number; marginPercent: number; units: number }; timeSeries: Array<{ period: string }>; products: Array<{ productId: string; realizedRevenueRsd: number; cogsRsd: number }> };
    assert.deepEqual(report.kpis, { revenueRsd: 2700, cogsRsd: 1000, profitRsd: 1700, marginPercent: 62.96, units: 3 });
    assert.equal(report.timeSeries[0]?.period, period);
    assert.deepEqual(report.products.map((row) => ({ productId: row.productId, revenueRsd: row.realizedRevenueRsd, cogsRsd: row.cogsRsd })), [{ productId, revenueRsd: 2700, cogsRsd: 1000 }]);
  }
  for (const [market, revenue, cogs, units] of [["B2C", 900, 400, 1], ["B2B", 1800, 600, 2], ["BOTH", 2700, 1000, 3]] as const) {
    const response = await get(`&market=${market}&supplierId=${product!.supplierId}&categoryId=${product!.categoryId}&brand=${encodeURIComponent(marker)}`);
    const report = await response.json() as { kpis: { revenueRsd: number; cogsRsd: number; units: number } };
    assert.equal(response.status, 200); assert.deepEqual(report.kpis, { revenueRsd: revenue, cogsRsd: cogs, profitRsd: revenue - cogs, marginPercent: Math.round((revenue - cogs) * 10000 / revenue) / 100, units });
  }
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(emailDeliveriesTable).where(eq(emailDeliveriesTable.recipientEmail, `CUSTOMER-${marker}@example.test`));
  await db.delete(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.requestedByUserId, admin));
  const rewardCoupons = (await db.select({ couponId: reviewRewardIssuancesTable.couponId }).from(reviewRewardIssuancesTable).where(eq(reviewRewardIssuancesTable.orderId, retailOrderId))).map((row) => row.couponId);
  await db.delete(reviewRewardIssuancesTable).where(eq(reviewRewardIssuancesTable.orderId, retailOrderId));
  if (rewardCoupons.length) await db.delete(couponsTable).where(inArray(couponsTable.id, rewardCoupons));
  const reviews = (await db.select({ id: retailProductReviewsTable.id }).from(retailProductReviewsTable).where(eq(retailProductReviewsTable.userId, customer))).map((row) => row.id);
  if (reviews.length) await db.delete(retailProductReviewAttachmentsTable).where(inArray(retailProductReviewAttachmentsTable.reviewId, reviews));
  if (reviews.length) await db.delete(retailProductReviewsTable).where(inArray(retailProductReviewsTable.id, reviews));
  await db.delete(rmaAttachmentsTable).where(inArray(rmaAttachmentsTable.rmaId, (await db.select({ id: rmasTable.id }).from(rmasTable).where(eq(rmasTable.requesterUserId, customer))).map(x => x.id)));
  await db.delete(rmaStatusHistoryTable).where(inArray(rmaStatusHistoryTable.actorUserId, ids.users));
  await db.delete(rmasTable).where(inArray(rmasTable.requesterUserId, [customer, salonOwner]));
  await db.delete(mediaAssetsTable).where(inArray(mediaAssetsTable.id, ids.assets));
  await db.delete(loyaltyPointLedgerTable).where(inArray(loyaltyPointLedgerTable.retailOrderId, ids.retailOrders));
  await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, ids.retailOrders)); await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, ids.retailOrders)); await db.delete(retailCartItemsTable).where(inArray(retailCartItemsTable.cartId, ids.retailCarts)); await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, ids.retailCarts));
  await db.delete(shoppingCartItemsTable).where(inArray(shoppingCartItemsTable.cartId, ids.carts)); await db.delete(b2bQuotesTable).where(eq(b2bQuotesTable.salonId, salonId)); await db.delete(shoppingCartsTable).where(inArray(shoppingCartsTable.id, ids.carts));
  await db.delete(priceInquiriesTable).where(inArray(priceInquiriesTable.productId, ids.products));
  await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, ids.orders)); await db.delete(ordersTable).where(inArray(ordersTable.id, ids.orders));
  await db.delete(productsTable).where(inArray(productsTable.id, ids.products)); await db.delete(productCategoriesTable).where(inArray(productCategoriesTable.id, ids.categories)); await db.delete(suppliersTable).where(inArray(suppliersTable.id, ids.suppliers)); await db.delete(salonsTable).where(inArray(salonsTable.id, ids.salons));
  if (settings) await db.update(shopSettingsTable).set({ reviewRewardsEnabled: settings.reviewRewardsEnabled, reviewInvitationDelayDays: settings.reviewInvitationDelayDays, reviewRewardPercent: settings.reviewRewardPercent, reviewRewardValidityDays: settings.reviewRewardValidityDays }).where(eq(shopSettingsTable.id, settings.id));
  await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
});

test("Deo E/F quote, POR matrix/feed, review reward/invitation, and RMA fences", async (t) => {
  await t.test("quote is owner-bound immutable evidence and restore replaces the cart exactly", async () => {
    const owner = await cookie(salonOwner);
    const made = await api("/shop/quotes", owner, { method: "POST", body: JSON.stringify({ validityDays: 7 }) }); assert.equal(made.status, 201);
    const quote = await made.json() as {
      publicId: string;
      sellerSnapshot: {
        companyName: string;
        recipient?: {
          companyName: string;
          registeredCompanyName?: string;
          taxId?: string;
          registrationNumber?: string;
          address?: string;
          city?: string;
          postalCode?: string;
          email?: string;
          phone?: string;
        };
      };
      itemSnapshots: Array<{ unitPrice: number; quantity: number }>;
    };
    assert.deepEqual(quote.itemSnapshots.map(x => [x.unitPrice, x.quantity]), [[777, 2]]);
    assert.equal(quote.sellerSnapshot.recipient?.companyName, marker);
    assert.equal(quote.sellerSnapshot.recipient?.registeredCompanyName, undefined);
    const [legacyQuote] = await db.insert(b2bQuotesTable).values({
      publicId: `legacy-${marker}`,
      salonId,
      sellerSnapshot: { companyName: "LUMERA" },
      itemSnapshots: [],
      subtotalWithoutVat: 0,
      vatAmount: 0,
      totalWithVat: 0,
      validUntil: new Date(Date.now() + 86_400_000),
    }).returning();
    const legacyResponse = await api(`/shop/quotes/${legacyQuote!.publicId}`, owner);
    assert.equal(legacyResponse.status, 200);
    assert.equal("recipient" in ((await legacyResponse.json() as { sellerSnapshot: object }).sellerSnapshot), false);
    await db.update(shoppingCartItemsTable).set({ quantity: 99, unitPrice: 1 }).where(eq(shoppingCartItemsTable.cartId, ids.carts[0]!));
    assert.equal((await api(`/shop/quotes/${quote.publicId}/restore-cart`, owner, { method: "POST" })).status, 200);
    const restored = await db.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, ids.carts[0]!));
    assert.deepEqual(restored.map(x => [x.unitPrice, x.quantity]), [[777, 2]]);
    assert.equal((await api(`/shop/quotes/${quote.publicId}`, await cookie(customer))).status, 403);
    await db.update(b2bQuotesTable).set({ validUntil: new Date(Date.now() - 1_000) }).where(eq(b2bQuotesTable.publicId, quote.publicId));
    assert.equal((await api(`/shop/quotes/${quote.publicId}/restore-cart`, owner, { method: "POST" })).status, 409);
  });
  await t.test("zero stock is price-on-request everywhere and matrix validation is atomic", async () => {
    const matrix = await api(`/public/products/${zeroProductId}/bulk-matrix`); const body = await matrix.json() as { priceOnRequest: boolean; cartEligible: boolean; rows: Array<Record<string, unknown>> };
    assert.equal(body.priceOnRequest, true); assert.equal(body.cartEligible, false); assert.equal("unitPrice" in body.rows[0]!, false);
    assert.equal((await api(`/public/suppliers/${ids.suppliers[0]}/products/${zeroProductId}/price-inquiries`, "", { method: "POST", body: JSON.stringify({ name: "Test User", email: "test@example.test", phone: "+381601234567", message: "Need a price for this item." }) })).status, 201);
    const adminInquiries = await (await api("/admin/price-inquiries", await cookie(admin))).json() as Array<Record<string, unknown>>;
    const adminInquiry = adminInquiries.find((inquiry) => inquiry.productId === zeroProductId);
    assert.equal(adminInquiry?.contactName, "Test User"); assert.equal(adminInquiry?.contactEmail, "test@example.test");
    assert.equal(adminInquiry?.productName, `${marker} zero`); assert.equal(adminInquiry?.supplierName, marker);
    const before = await db.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, ids.carts[0]!));
    assert.equal((await api("/shop/cart/bulk-matrix", await cookie(salonOwner), { method: "POST", body: JSON.stringify({ rows: [{ productId, variantValue: "red", quantity: 1 }, { productId: zeroProductId, variantValue: "none", quantity: 1 }] }) })).status, 409);
    assert.equal((await db.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, ids.carts[0]!))).length, before.length);
    const feed = await (await api("/catalog/feed")).json() as { items: Array<{ id: string; url: string }> };
    const [zeroProduct] = await db.select().from(productsTable).where(eq(productsTable.id, zeroProductId));
    assert.ok(!feed.items.some(x => x.id === zeroProduct!.catalogReference)); assert.ok(feed.items.every(x => x.url.startsWith("https://catalog.example.test/")));
    const [listedProduct] = await db.select({ catalogReference: productsTable.catalogReference, supplierSlug: suppliersTable.slug })
      .from(productsTable).innerJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id)).where(eq(productsTable.id, productId));
    assert.equal(feed.items.find(x => x.id === listedProduct!.catalogReference)?.url, `https://catalog.example.test/shop/${listedProduct!.supplierSlug}/proizvod/${productId}`);
    const sharedStockPublicProduct = await (await api(`/shop/public/products/${simpleRetailProductId}`)).json() as {
      price: number | null; priceOnRequest: boolean; cartEligible: boolean;
    };
    assert.equal(sharedStockPublicProduct.price, 900); assert.equal(sharedStockPublicProduct.priceOnRequest, false); assert.equal(sharedStockPublicProduct.cartEligible, true);
    const canonicalDetail = await (await api(`/suppliers/${marker}/public-products/${simpleRetailProductId}`)).json() as {
      relatedProducts: Array<{ id: string; price: number | null; priceOnRequest: boolean; cartEligible: boolean }>;
    };
    const relatedPor = canonicalDetail.relatedProducts.find((item) => item.id === zeroProductId);
    assert.equal(relatedPor?.id, zeroProductId); assert.equal(relatedPor?.price, null);
    assert.equal(relatedPor?.priceOnRequest, true); assert.equal(relatedPor?.cartEligible, false);
    assert.equal(canonicalDetail.relatedProducts.some((item) => item.id === hiddenRelatedProductId), false);
    const validOrigin = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "not-a-valid-origin";
    const failedValidation = await (await api("/admin/catalog/meta/validate", await cookie(admin), { method: "POST" })).json() as {
      run: { itemCount: number; validationErrors: string[] };
    };
    assert.ok(failedValidation.run.itemCount >= 1); assert.ok(failedValidation.run.validationErrors.length >= 1);
    const failedStatus = await (await api("/admin/catalog/meta/status", await cookie(admin))).json() as {
      latestRun: { validationErrors: string[] };
    };
    assert.deepEqual(failedStatus.latestRun.validationErrors, failedValidation.run.validationErrors);
    process.env.APP_BASE_URL = validOrigin;
    const explicitSession = await cookie(explicitBuyer);
    const addedExplicitResponse = await api("/retail/cart/items", explicitSession, {
      method: "POST", body: JSON.stringify({ productId, variantValue: "red", quantity: 1 }),
    });
    assert.equal(addedExplicitResponse.status, 201);
    const addedExplicit = await addedExplicitResponse.json() as { id: string };
    ids.retailCarts.push(addedExplicit.id);
    const retailCartCookie = addedExplicitResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(retailCartCookie);
    const explicitBrowserSession = `${explicitSession}; ${retailCartCookie}`;
    assert.equal((await api("/retail/checkout-preview", explicitBrowserSession)).status, 200);
    const checkoutResponse = await api("/retail/checkout", explicitBrowserSession, {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: randomUUID(), firstName: "Explicit", lastName: "Buyer",
        email: `CUSTOMER-EXPLICIT-${marker}@example.test`, phone: "+381601234567",
        street: "Test 2", city: "Beograd", postalCode: "11000",
        paymentMethod: "CASH_ON_DELIVERY", deliveryMethod: "courier", desiredReferralCreditRsd: 0,
      }),
    });
    const checkedOut = await checkoutResponse.json() as { id: string; error?: string };
    assert.equal(checkoutResponse.status, 201, JSON.stringify(checkedOut));
    ids.retailOrders.push(checkedOut.id);
    const [afterExplicitCheckout] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
    assert.equal(afterExplicitCheckout!.stock, 4); assert.equal(afterExplicitCheckout!.variants?.[0]?.stock, 4);
    const repeatResponse = await api("/retail/orders/repeat-last", explicitBrowserSession, {
      method: "POST", headers: { "Idempotency-Key": randomUUID() },
    });
    assert.equal(repeatResponse.status, 200);
    const repeated = await repeatResponse.json() as {
      cart: {
        items: Array<{ id: string; kind: string; productId?: string; variantValue?: string | null }>;
        savedItems: Array<{ id: string; productId?: string | null; variantValue?: string | null }>;
      };
    };
    const repeatedVariant = repeated.cart.items.find((item) => item.kind === "product" && item.productId === productId);
    assert.equal(repeatedVariant?.variantValue, "red");
    const saveResponse = await api(`/retail/cart/items/${repeatedVariant!.id}/save-for-later`, explicitBrowserSession, { method: "POST" });
    assert.equal(saveResponse.status, 200);
    const savedCart = await saveResponse.json() as typeof repeated.cart;
    const savedVariant = savedCart.savedItems.find((item) => item.productId === productId);
    assert.equal(savedVariant?.variantValue, "red");
    const restoreResponse = await api(`/retail/cart/saved-items/${savedVariant!.id}/restore`, explicitBrowserSession, { method: "POST" });
    assert.equal(restoreResponse.status, 200);
    const restoredCart = await restoreResponse.json() as typeof repeated.cart;
    assert.equal(restoredCart.items.find((item) => item.kind === "product" && item.productId === productId)?.variantValue, "red");
    assert.deepEqual(validatedSwatch({ kind: "COLOR", hex: "#aabbcc" }), { kind: "COLOR", hex: "#AABBCC" }); assert.equal(validatedSwatch({ kind: "COLOR", hex: "#fff" }), null); assert.equal(validatedSwatch({ kind: "IMAGE", imageUrl: "https://evil.test/a" }), null);
  });
  await t.test("concurrent review creation gives one order reward and one invitation outbox row", async () => {
    const adminSession = await cookie(admin);
    const loadedSettings = await (await api("/admin/review-rewards", adminSession)).json() as {
      settings: { enabled: boolean; invitationDelayDays: number; percent: number; validityDays: number; version: number };
      stats: { issued: number };
    };
    assert.ok(loadedSettings.settings.version >= 1); assert.ok(loadedSettings.stats.issued >= 0);
    const savedSettingsResponse = await api("/admin/review-rewards", adminSession, {
      method: "PATCH",
      body: JSON.stringify(loadedSettings.settings),
    });
    assert.equal(savedSettingsResponse.status, 200);
    const savedSettings = await savedSettingsResponse.json() as { version: number };
    assert.equal(savedSettings.version, loadedSettings.settings.version + 1);
    const session = await cookie(customer);
    const firstAsset = randomUUID(); const replacementAsset = randomUUID(); ids.assets.push(firstAsset, replacementAsset);
    await db.insert(mediaAssetsTable).values([firstAsset, replacementAsset].map((id) => ({ id, ownerUserId: customer, scope: "retail-review-photo", visibility: "private", originalFileName: "review.jpg", originalContentType: "image/jpeg", width: 1, height: 1, contentHash: `${marker}-${id}` })));
    const result = await Promise.all([api(`/customer/retail-products/${productId}/reviews`, session, { method: "POST", body: JSON.stringify({ rating: 5, comment: "Excellent product", photoUrls: [`/api/media/${firstAsset}`] }) }), api(`/customer/retail-products/${productId}/reviews`, session, { method: "POST", body: JSON.stringify({ rating: 4, comment: "Race review" }) })]);
    assert.equal(result.filter(x => x.status === 201).length, 1);
    const successful = result.find((response) => response.status === 201)!;
    const review = await successful.json() as { id: string };
    assert.equal((await api(`/customer/retail-products/${productId}/reviews/${review.id}`, session, { method: "PATCH", body: JSON.stringify({ rating: 5, comment: "Replacement photo", photoUrls: [`/api/media/${replacementAsset}`] }) })).status, 200);
    const attachments = await db.select().from(retailProductReviewAttachmentsTable).where(eq(retailProductReviewAttachmentsTable.reviewId, review.id));
    assert.deepEqual(attachments.map((attachment) => attachment.mediaAssetId), [replacementAsset], "replacement must release the old private attachment rather than retain it");
    const issuance = await db.select({ issuance: reviewRewardIssuancesTable, coupon: couponsTable }).from(reviewRewardIssuancesTable).innerJoin(couponsTable, eq(reviewRewardIssuancesTable.couponId, couponsTable.id)).where(eq(reviewRewardIssuancesTable.orderId, retailOrderId));
    assert.equal(issuance.length, 1); assert.equal(issuance[0]!.issuance.percentSnapshot, 17); assert.equal(issuance[0]!.coupon.discountValue, 17); assert.ok(issuance[0]!.issuance.expiresAt > new Date());
    const rewardEvents = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, `retail-review-reward:${retailOrderId}`));
    assert.equal(rewardEvents.length, 1); assert.equal(rewardEvents[0]!.status, "queued"); assert.match(rewardEvents[0]!.htmlContent ?? "", new RegExp(issuance[0]!.coupon.code));
    const otherSession = await cookie(otherCustomer);
    assert.equal((await api("/retail/cart/items", otherSession, { method: "POST", body: JSON.stringify({ productId: simpleRetailProductId, variantValue: "shared", quantity: 1 }) })).status, 201);
    const boundResponse = await api(`/retail/checkout-preview?couponCode=${encodeURIComponent(issuance[0]!.coupon.code)}`, otherSession);
    const boundBody = await boundResponse.json() as Record<string, unknown>;
    assert.equal(boundResponse.status, 409, JSON.stringify(boundBody));
    assert.equal(boundBody.code, "COUPON_CUSTOMER_BOUND");
    await Promise.all([runRetailReviewInvitationSweep(new Date("2025-01-09T00:00:00Z")), runRetailReviewInvitationSweep(new Date("2025-01-09T00:00:00Z"))]);
    const events = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, `retail-review-invitation:${retailOrderId}`)); assert.equal(events.length, 1); assert.equal(events[0]!.status, "queued");
  });
  await t.test("retail RMA requires owned delivered item, claims private photo, and no-op status sends no email", async () => {
    const assetId = randomUUID(); ids.assets.push(assetId);
    await db.insert(mediaAssetsTable).values({ id: assetId, ownerUserId: customer, scope: "rma-photo", visibility: "private", originalFileName: "x.jpg", originalContentType: "image/jpeg", width: 1, height: 1, contentHash: marker });
    const made = await api(`/retail/orders/${retailOrderId}/rmas`, await cookie(customer), { method: "POST", body: JSON.stringify({ orderItemId: retailItemId, quantity: 1, reason: "Damaged", description: "The item arrived visibly damaged.", photoUrls: [`/api/media/${assetId}`] }) }); assert.equal(made.status, 201);
    // The item fixture has quantity one. Both sequential and racing attempts
    // must see the first non-rejected claim and consume no further capacity.
    const repeated = JSON.stringify({ orderItemId: retailItemId, quantity: 1, reason: "Damaged", description: "The item arrived visibly damaged." });
    const [again, concurrent] = await Promise.all([
      api(`/retail/orders/${retailOrderId}/rmas`, await cookie(customer), { method: "POST", body: repeated }),
      api(`/retail/orders/${retailOrderId}/rmas`, await cookie(customer), { method: "POST", body: repeated }),
    ]);
    assert.equal(again.status, 409); assert.equal(concurrent.status, 409);
    const rma = await made.json() as { id: string }; assert.equal((await db.select().from(rmaAttachmentsTable).where(eq(rmaAttachmentsTable.rmaId, rma.id))).length, 1); assert.equal((await db.select().from(rmaStatusHistoryTable).where(eq(rmaStatusHistoryTable.rmaId, rma.id))).length, 1);
    const b2bMade = await api(`/orders/${b2bOrderId}/rmas`, await cookie(salonOwner), { method: "POST", body: JSON.stringify({ orderItemId: b2bItemId, quantity: 1, reason: "Wrong item", description: "The delivered B2B item does not match the order." }) });
    assert.equal(b2bMade.status, 201);
    const b2bRma = await b2bMade.json() as { id: string };
    const adminCookie = await cookie(admin);
    const adminRows = await (await api("/admin/rmas", adminCookie)).json() as Array<{ id: string; target: string; orderId: string; owner: Record<string, unknown> }>;
    assert.equal(adminRows.find((row) => row.id === rma.id)?.target, "b2c"); assert.equal(adminRows.find((row) => row.id === rma.id)?.orderId, retailOrderId);
    assert.equal(adminRows.find((row) => row.id === b2bRma.id)?.target, "b2b"); assert.equal(adminRows.find((row) => row.id === b2bRma.id)?.owner.businessName, marker);
    const retailDetail = await (await api(`/admin/rmas/${rma.id}`, adminCookie)).json() as { items: Array<{ productName: string; quantity: number }>; privatePhotos: string[]; auditTrail: Array<{ action: string }> };
    assert.deepEqual(retailDetail.items, [{ orderItemId: retailItemId, productName: marker, quantity: 1 }]);
    assert.deepEqual(retailDetail.privatePhotos, [`/api/media/${assetId}`]); assert.match(retailDetail.auditTrail[0]!.action, /RECEIVED/);
    const b2bDetail = await (await api(`/admin/rmas/${b2bRma.id}`, adminCookie)).json() as { items: Array<{ productName: string }> };
    assert.equal(b2bDetail.items[0]?.productName, marker);
    assert.equal((await api(`/admin/rmas/${rma.id}/status`, adminCookie, { method: "PATCH", body: JSON.stringify({ status: "RECEIVED" }) })).status, 200);
    assert.equal((await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, `rma:${rma.id}:status:RECEIVED`))).length, 0);
  });
  await t.test("supplier-scoped bestseller ranking never crosses supplier or category", async () => {
    const [supplierB] = await db.insert(suppliersTable).values({ name: `${marker} B`, slug: `${marker}-b`, scope: "BOTH" }).returning();
    ids.suppliers.push(supplierB!.id);
    const [categoryB] = await db.insert(productCategoriesTable).values({ supplierId: supplierB!.id, name: `${marker} B cat`, slug: `${marker}-b-cat` }).returning();
    ids.categories.push(categoryB!.id);
    const [productB] = await db.insert(productsTable).values({
      supplierId: supplierB!.id, categoryId: categoryB!.id, categoryName: categoryB!.name,
      name: `${marker} B product`, description: marker, publicDescription: marker, imageUrl: "/test.jpg",
      price: 1200, publicPrice: 1200, professionalEnabled: true, retailEnabled: true, stock: 8, sku: `${marker}-B`, unit: "kom",
    }).returning();
    ids.products.push(productB!.id);
    const [orderA, orderB] = await db.insert(ordersTable).values([
      { salonId, status: "delivered", total: 1000, subtotal: 1000, shippingName: marker, shippingAddress: "Test", shippingCity: "Beograd", shippingPostalCode: "11000", paymentMethod: "BANK_TRANSFER" },
      { salonId, status: "delivered", total: 1200, subtotal: 1200, shippingName: marker, shippingAddress: "Test", shippingCity: "Beograd", shippingPostalCode: "11000", paymentMethod: "BANK_TRANSFER" },
    ]).returning();
    ids.orders.push(orderA!.id, orderB!.id);
    await db.insert(orderItemsTable).values([
      { orderId: orderA!.id, productId, productName: marker, quantity: 2, price: 1000, unitPrice: 1000, lineSubtotal: 2000, lineTotal: 2000, supplierId: ids.suppliers[0], supplierName: marker, supplierSlug: marker },
      { orderId: orderB!.id, productId: productB!.id, productName: `${marker} B`, quantity: 9, price: 1200, unitPrice: 1200, lineSubtotal: 10800, lineTotal: 10800, supplierId: supplierB!.id, supplierName: supplierB!.name, supplierSlug: supplierB!.slug },
    ]);
    const owner = await cookie(salonOwner);
    const scoped = await api(`/commerce/bestsellers?audience=B2B&periodDays=30&supplierSlug=${encodeURIComponent(marker)}`, owner);
    assert.equal(scoped.status, 200);
    const scopedRows = await scoped.json() as Array<{ productId: string }>;
    assert.deepEqual(scopedRows.map((row) => row.productId), [productId]);
    const categoryScoped = await api(`/commerce/bestsellers?audience=B2B&periodDays=30&supplierSlug=${encodeURIComponent(marker)}&categoryId=${categoryB!.id}`, owner);
    assert.equal(categoryScoped.status, 200);
    assert.deepEqual(await categoryScoped.json(), [], "Supplier A plus supplier B category must return no cross-supplier ranking.");
  });
});