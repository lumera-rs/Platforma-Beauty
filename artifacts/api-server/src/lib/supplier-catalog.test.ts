import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  b2cDisplaySettingsTable,
  b2cRecentlyViewedProductsTable,
  type DatabasePoolClient,
  loyaltyPointLedgerTable,
  orderBundleComponentsTable,
  orderItemsTable,
  orderStatusHistoryTable,
  ordersTable,
  productBundleComponentsTable,
  productBundlesTable,
  pool,
  productCategoriesTable,
  productsTable,
  referralCreditLedgerTable,
  referralCreditRedemptionsTable,
  salonsTable,
  shopSettingsTable,
  shoppingCartItemsTable,
  shoppingCartsTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { ensureShippingConfigSchema } from "./shipping-config";
import { claimRecentlyViewedForUser } from "../routes/b2c-discovery";

type CategoryResponse = {
  id: string;
  supplierId: string;
  parentId: string | null;
  path?: string;
  depth?: number;
};

type ProductListResponse = {
  items: Array<{ id: string; supplierId: string }>;
};

const marker = `supplier-catalog-560-${randomUUID()}`;
const categoryIds: string[] = [];
const productIds: string[] = [];
const orderIds: string[] = [];
const bundleIds: string[] = [];
const supplierIds: string[] = [];
let adminId = "";
let ownerId = "";
let salonId = "";
let adminCookie = "";
let ownerCookie = "";
let supplierA: typeof suppliersTable.$inferSelect;
let supplierB: typeof suppliersTable.$inferSelect;
let orderedProduct: typeof productsTable.$inferSelect;
let conflictProduct: typeof productsTable.$inferSelect;
let b2cProduct: typeof productsTable.$inferSelect;
let supplierBRootId = "";
let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;
let lockClient: DatabasePoolClient | undefined;
let settingsBefore: typeof shopSettingsTable.$inferSelect | undefined;
let createdSettingsId: string | undefined;

async function api(path: string, cookie = "", init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function createCategory(
  supplierId: string,
  name: string,
  parentId: string | null = null,
): Promise<CategoryResponse> {
  const response = await api("/admin/product-categories", adminCookie, {
    method: "POST",
    body: JSON.stringify({ supplierId, name, parentId }),
  });
  assert.equal(response.status, 201);
  const category = await response.json() as CategoryResponse;
  categoryIds.push(category.id);
  return category;
}

async function addToCart(productId: string, quantity = 1, variantValue?: string) {
  const response = await api("/shop/cart/items", ownerCookie, {
    method: "POST",
    body: JSON.stringify({ productId, quantity, ...(variantValue ? { variantValue } : {}) }),
  });
  assert.equal(response.status, 200, await response.text());
}

async function addBundleToCart(bundleId: string, quantity = 1) {
  const response = await api("/shop/cart/items", ownerCookie, {
    method: "POST",
    body: JSON.stringify({ bundleId, quantity }),
  });
  assert.equal(response.status, 200, await response.text());
}

async function checkout() {
  return api("/shop/checkout", ownerCookie, {
    method: "POST",
    body: JSON.stringify({
      useSalonAddress: true,
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod: "courier",
      termsAccepted: true,
    }),
  });
}

async function expectStillPending<T>(promise: Promise<T>, message: string) {
  const result = await Promise.race([
    promise.then(() => "settled" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  assert.equal(result, "pending", message);
}

test.before(async () => {
  const client = await pool.connect();
  lockClient = client;
  await client.query("select pg_advisory_lock(hashtext($1))", ["supplier-catalog-task-560"]);
  await ensureBusinessGrowthSchema();
  await ensureShippingConfigSchema();

  const [admin, owner] = await db.insert(usersTable).values([
    {
      firstName: "Supplier",
      lastName: "Admin",
      email: `${marker}-admin@example.test`,
      passwordHash: await hashPassword(marker),
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Supplier",
      lastName: "Owner",
      email: `${marker}-owner@example.test`,
      passwordHash: await hashPassword(marker),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    },
  ]).returning();
  assert.ok(admin);
  assert.ok(owner);
  adminId = admin.id;
  ownerId = owner.id;

  const [salon] = await db.insert(salonsTable).values({
    ownerId,
    name: marker,
    slug: marker,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    postalCode: "11000",
    phone: "+381601234567",
    email: `${marker}@example.test`,
    shortDescription: marker,
    description: marker,
    imageUrl: "/supplier-catalog-test.jpg",
  }).returning();
  assert.ok(salon);
  salonId = salon.id;

  settingsBefore = (await db.select().from(shopSettingsTable).limit(1))[0];
  if (!settingsBefore) {
    const [created] = await db.insert(shopSettingsTable).values({}).returning();
    createdSettingsId = created?.id;
  }
  const [settings] = await db.select().from(shopSettingsTable).limit(1);
  assert.ok(settings);
  await db.update(shopSettingsTable).set({
    sellerCompanyName: `Supplier catalog seller ${marker}`,
    sellerTaxId: "101234567",
    sellerRegistrationNumber: "20123456",
    sellerAddress: "Seller street 1",
    sellerCity: "Beograd",
    sellerPostalCode: "11000",
    sellerBankAccount: "100-123456789-10",
    sellerContactEmail: `${marker}-seller@example.test`,
    sellerContactPhone: "+381601234567",
    version: settings.version + 1,
    updatedAt: new Date(),
  }).where(eq(shopSettingsTable.id, settings.id));

  [supplierA, supplierB] = await db.insert(suppliersTable).values([
    { name: `${marker} A`, slug: `${marker}-a`, scope: "BOTH" },
    { name: `${marker} B`, slug: `${marker}-b`, scope: "BOTH" },
  ]).returning() as [typeof suppliersTable.$inferSelect, typeof suppliersTable.$inferSelect];
  supplierIds.push(supplierA.id, supplierB.id);

  const [rootA, rootB] = await db.insert(productCategoriesTable).values([
    { supplierId: supplierA.id, name: `${marker} product root A`, slug: `${marker}-product-root-a` },
    { supplierId: supplierB.id, name: `${marker} product root B`, slug: `${marker}-product-root-b` },
  ]).returning();
  assert.ok(rootA);
  assert.ok(rootB);
  categoryIds.push(rootA.id, rootB.id);
  supplierBRootId = rootB.id;

  const products = await db.insert(productsTable).values([
    {
      supplierId: supplierA.id,
      categoryId: rootA.id,
      categoryName: rootA.name,
      name: `${marker} ordered`,
      description: "Wholesale secret description",
      publicDescription: "Public description",
      imageUrl: "/supplier-catalog-test.jpg",
      price: 4_000,
      discountPrice: 3_500,
      publicPrice: 5_000,
      publicDiscountPrice: 4_500,
      retailEnabled: true,
      professionalEnabled: true,
      stock: 20,
      sku: `${marker}-ordered`,
      unit: "kom",
      weightGrams: 750,
      variants: [{ label: "Secret variant", value: "secret", stock: 20, sku: `${marker}-variant` }],
    },
    {
      supplierId: supplierA.id,
      categoryId: rootA.id,
      categoryName: rootA.name,
      name: `${marker} conflict`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 2_000,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 2,
      sku: `${marker}-conflict`,
      unit: "kom",
      weightGrams: 100,
    },
    {
      supplierId: supplierB.id,
      categoryId: rootB.id,
      categoryName: rootB.name,
      name: `${marker} b2c`,
      description: marker,
      publicDescription: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 3_000,
      publicPrice: 3_500,
      professionalEnabled: false,
      retailEnabled: true,
      stock: 3,
      sku: `${marker}-b2c`,
      unit: "kom",
      weightGrams: 100,
    },
  ]).returning();
  [orderedProduct, conflictProduct, b2cProduct] = products as [
    typeof productsTable.$inferSelect,
    typeof productsTable.$inferSelect,
    typeof productsTable.$inferSelect,
  ];
  productIds.push(...products.map((product) => product.id));

  adminCookie = `${sessionCookieName}=${await createSession(adminId)}`;
  ownerCookie = `${sessionCookieName}=${await createSession(ownerId)}`;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

test.after(async () => {
  try {
    if (server) {
      const closed = new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table referral_credit_ledger disable trigger referral_credit_ledger_append_only`);
      await tx.execute(sql`alter table referral_credit_redemptions disable trigger referral_credit_redemptions_append_only`);
      try {
        if (orderIds.length) {
          await tx.delete(referralCreditRedemptionsTable).where(inArray(referralCreditRedemptionsTable.orderId, orderIds));
        }
        await tx.delete(referralCreditLedgerTable).where(eq(referralCreditLedgerTable.ownerUserId, ownerId));
      } finally {
        await tx.execute(sql`alter table referral_credit_ledger enable trigger referral_credit_ledger_append_only`);
        await tx.execute(sql`alter table referral_credit_redemptions enable trigger referral_credit_redemptions_append_only`);
      }
    });
    if (orderIds.length) {
      await db.delete(loyaltyPointLedgerTable).where(inArray(loyaltyPointLedgerTable.orderId, orderIds));
      await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
      await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
    }
    if (salonId) {
      const carts = await db.select({ id: shoppingCartsTable.id }).from(shoppingCartsTable)
        .where(eq(shoppingCartsTable.salonId, salonId));
      if (carts.length) {
        await db.delete(shoppingCartItemsTable).where(inArray(shoppingCartItemsTable.cartId, carts.map((cart) => cart.id)));
        await db.delete(shoppingCartsTable).where(inArray(shoppingCartsTable.id, carts.map((cart) => cart.id)));
      }
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    }
    if (bundleIds.length) {
      await db.delete(productBundleComponentsTable).where(inArray(productBundleComponentsTable.bundleId, bundleIds));
      await db.delete(productBundlesTable).where(inArray(productBundlesTable.id, bundleIds));
    }
    if (productIds.length) await db.delete(productsTable).where(inArray(productsTable.id, productIds));
    if (categoryIds.length) await db.delete(productCategoriesTable).where(inArray(productCategoriesTable.id, categoryIds));
    if (supplierIds.length) await db.delete(suppliersTable).where(inArray(suppliersTable.id, supplierIds));
    if (adminId || ownerId) await db.delete(usersTable).where(inArray(usersTable.id, [adminId, ownerId].filter(Boolean)));
    if (settingsBefore) {
      await db.update(shopSettingsTable).set(settingsBefore).where(eq(shopSettingsTable.id, settingsBefore.id));
    } else if (createdSettingsId) {
      await db.delete(shopSettingsTable).where(eq(shopSettingsTable.id, createdSettingsId));
    }
  } finally {
    if (lockClient) {
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", ["supplier-catalog-task-560"]);
      lockClient.release();
    }
  }
});

test("supplier category trees support arbitrary depth and safe subtree moves", async () => {
  const root = await createCategory(supplierA.id, `${marker} category root`);
  const level2 = await createCategory(supplierA.id, `${marker} category level 2`, root.id);
  const level3 = await createCategory(supplierA.id, `${marker} category level 3`, level2.id);
  const level4 = await createCategory(supplierA.id, `${marker} category level 4`, level3.id);
  const validParent = await createCategory(supplierA.id, `${marker} valid parent`);

  const categoriesResponse = await api(`/suppliers/${supplierA.slug}/categories`);
  assert.equal(categoriesResponse.status, 200);
  const categories = await categoriesResponse.json() as CategoryResponse[];
  const deepest = categories.find((category) => category.id === level4.id);
  assert.equal(deepest?.depth, 3);
  assert.equal(deepest?.path?.split("/").length, 4);

  const crossSupplier = await api("/admin/product-categories", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      supplierId: supplierB.id,
      name: `${marker} invalid cross supplier child`,
      parentId: root.id,
    }),
  });
  assert.equal(crossSupplier.status, 404);

  const cycle = await api(`/admin/product-categories/${root.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ parentId: level4.id }),
  });
  assert.equal(cycle.status, 409);

  const validMove = await api(`/admin/product-categories/${level2.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ parentId: validParent.id }),
  });
  assert.equal(validMove.status, 200);
  assert.equal((await validMove.json() as CategoryResponse).parentId, validParent.id);
  const [unchangedDescendant] = await db.select().from(productCategoriesTable)
    .where(eq(productCategoriesTable.id, level4.id));
  assert.equal(unchangedDescendant?.parentId, level3.id);
});

test("supplier B2B products require authentication and public products expose only the allowlist", async () => {
  const privateResponse = await api(`/suppliers/${supplierA.slug}/products`);
  assert.equal(privateResponse.status, 401);

  const publicResponse = await api(`/suppliers/${supplierA.slug}/public-products/${orderedProduct.id}`);
  assert.equal(publicResponse.status, 200);
  const product = await publicResponse.json() as Record<string, unknown>;
  assert.equal(product.price, orderedProduct.publicPrice);
  assert.equal(product.description, orderedProduct.publicDescription);
  for (const forbidden of [
    "sku", "stock", "weightGrams", "professionalEnabled",
    "publicPrice", "publicDiscountPrice",
  ]) {
    assert.equal(Object.hasOwn(product, forbidden), false, `public response leaked ${forbidden}`);
  }
  const publicVariants = product.variants as Array<Record<string, unknown>>;
  assert.deepEqual(publicVariants.map((variant) => variant.value), ["secret"]);
  assert.equal(Object.hasOwn(publicVariants[0]!, "stock"), false, "public variant leaked stock");
  assert.equal(Object.hasOwn(publicVariants[0]!, "sku"), false, "public variant leaked sku");
});

test("public detail is passive and explicit recent recording is idempotent and merge-capped", async () => {
  const detail = await api(`/suppliers/${supplierA.slug}/public-products/${orderedProduct.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("set-cookie"), null, "passive detail GET must not mint viewer identity");
  const dto = await detail.json() as Record<string, unknown>;
  assert.deepEqual(dto.reviewSummary, { averageRating: 0, reviewCount: 0 });

  const [display] = await db.select().from(b2cDisplaySettingsTable).limit(1);
  assert.ok(display);
  const originalMaximum = display.recentlyViewedMax;
  try {
    await db.update(b2cDisplaySettingsTable).set({ recentlyViewedMax: 100 }).where(eq(b2cDisplaySettingsTable.id, display.id));
    const first = await api(`/suppliers/${supplierA.slug}/recently-viewed/${orderedProduct.id}`, "", { method: "POST" });
    assert.equal(first.status, 204);
    const token = first.headers.get("set-cookie")?.match(/lumera_b2c_viewer=([^;]+)/)?.[1];
    assert.ok(token);
    const viewerCookie = `lumera_b2c_viewer=${token}`;
    const repeat = await api(`/suppliers/${supplierA.slug}/recently-viewed/${orderedProduct.id}`, viewerCookie, { method: "POST" });
    assert.equal(repeat.status, 204);
    const recent = await api(`/suppliers/${supplierA.slug}/recently-viewed`, viewerCookie);
    const recentItems = await recent.json() as Array<{ id: string }>;
    assert.deepEqual(recentItems.map((item) => item.id), [orderedProduct.id], "repeated recording keeps one product row");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await api(`/suppliers/${supplierB.slug}/recently-viewed/${b2cProduct.id}`, viewerCookie, { method: "POST" });
    assert.equal(second.status, 204);
    await db.update(b2cDisplaySettingsTable).set({ recentlyViewedMax: 1 }).where(eq(b2cDisplaySettingsTable.id, display.id));
    await claimRecentlyViewedForUser(
      { cookies: { lumera_b2c_viewer: token } } as unknown as Parameters<typeof claimRecentlyViewedForUser>[0],
      { clearCookie: () => undefined } as unknown as Parameters<typeof claimRecentlyViewedForUser>[1],
      ownerId,
    );
    const claimed = await db.select().from(b2cRecentlyViewedProductsTable)
      .where(eq(b2cRecentlyViewedProductsTable.userId, ownerId));
    assert.equal(claimed.length, 1, "guest-to-user merge is capped transactionally");
    assert.equal(claimed[0]?.productId, b2cProduct.id, "merge preserves the newest product");
  } finally {
    await db.delete(b2cRecentlyViewedProductsTable).where(eq(b2cRecentlyViewedProductsTable.userId, ownerId));
    await db.update(b2cDisplaySettingsTable).set({ recentlyViewedMax: originalMaximum }).where(eq(b2cDisplaySettingsTable.id, display.id));
  }
});

test("product merchandising validates, canonicalizes, isolates suppliers and returns channel-safe related cards", async () => {
  const categoryId = conflictProduct.categoryId!;
  const candidates = await db.insert(productsTable).values([1, 2, 3].map((index) => ({
    supplierId: supplierA.id,
    categoryId,
    categoryName: conflictProduct.categoryName,
    name: `${marker} related ${index}`,
    description: `${marker} wholesale ${index}`,
    publicDescription: `${marker} public ${index}`,
    imageUrl: "/supplier-catalog-test.jpg",
    price: 1_000 + index,
    publicPrice: 2_000 + index,
    professionalEnabled: true,
    retailEnabled: true,
    stock: 20,
    sku: `${marker}-related-${index}`,
    unit: "kom",
  }))).returning();
  productIds.push(...candidates.map((product) => product.id));

  const invalidTiers = await api(`/admin/products/${conflictProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ quantityPricingTiers: [
      { minQuantity: 1, maxQuantity: 5, unitPrice: 900 },
      { minQuantity: 5, maxQuantity: null, unitPrice: 800 },
    ] }),
  });
  assert.equal(invalidTiers.status, 400);
  const invalidCrossSell = await api(`/admin/products/${conflictProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ crossSellProductIds: candidates.slice(0, 2).map((product) => product.id) }),
  });
  assert.equal(invalidCrossSell.status, 400);
  const invalidSubscription = await api(`/admin/products/${conflictProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ subscriptionAllowed: true }),
  });
  assert.equal(invalidSubscription.status, 400);

  const update = await api(`/admin/products/${conflictProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({
      similarProductsMode: "MANUAL",
      similarProductIds: [candidates[1]!.id, candidates[0]!.id],
      crossSellProductIds: candidates.map((product) => product.id),
      quantityPricingTiers: [
        { minQuantity: 10, maxQuantity: null, unitPrice: 700 },
        { minQuantity: 2, maxQuantity: 9, unitPrice: 800 },
      ],
      minimumOrderQuantity: 2,
      deliveryBusinessDaysOverride: 7,
      subscriptionAllowed: true,
      subscriptionDiscountPercent: 15,
    }),
  });
  assert.equal(update.status, 200);
  const adminProduct = await update.json() as Record<string, unknown>;
  assert.deepEqual(adminProduct.quantityPricingTiers, [
    { minQuantity: 2, maxQuantity: 9, unitPrice: 800 },
    { minQuantity: 10, maxQuantity: null, unitPrice: 700 },
  ]);
  assert.equal(adminProduct.minimumOrderQuantity, 2);
  assert.equal(adminProduct.deliveryBusinessDaysOverride, 7);
  assert.equal(adminProduct.subscriptionAllowed, true);
  assert.equal(adminProduct.subscriptionDiscountPercent, 15);

  const manual = await api(`/suppliers/${supplierA.slug}/products/${conflictProduct.id}`, ownerCookie);
  assert.equal(manual.status, 200);
  const manualProduct = await manual.json() as { relatedProducts: Array<Record<string, unknown>> };
  assert.deepEqual(manualProduct.relatedProducts.map((product) => product.id), [candidates[1]!.id, candidates[0]!.id]);

  const supplierChange = await api(`/admin/products/${conflictProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ supplierId: supplierB.id, categoryId: supplierBRootId }),
  });
  assert.equal(supplierChange.status, 400);

  const publicManualUpdate = await api(`/admin/products/${orderedProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({
      variants: null,
      similarProductsMode: "MANUAL",
      similarProductIds: [candidates[0]!.id, conflictProduct.id],
    }),
  });
  assert.equal(publicManualUpdate.status, 200);
  const publicManual = await api(`/suppliers/${supplierA.slug}/public-products/${orderedProduct.id}`);
  assert.equal(publicManual.status, 200);
  const publicDetail = await publicManual.json() as { relatedProducts: Array<Record<string, unknown>> };
  assert.deepEqual(publicDetail.relatedProducts.map((product) => product.id), [candidates[0]!.id]);
  for (const forbidden of ["sku", "stock", "weightGrams", "variants", "supplierId", "similarProductIds", "priceAdjust"]) {
    assert.equal(Object.hasOwn(publicDetail.relatedProducts[0]!, forbidden), false, `public related card leaked ${forbidden}`);
  }
  const inboundSupplierChange = await api(`/admin/products/${candidates[0]!.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ supplierId: supplierB.id, categoryId: supplierBRootId }),
  });
  assert.equal(inboundSupplierChange.status, 409);
  const inboundDelete = await api(`/admin/products/${candidates[0]!.id}`, adminCookie, {
    method: "DELETE",
  });
  assert.equal(inboundDelete.status, 409);
  const [stillRelated] = await db.select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, candidates[0]!.id));
  assert.equal(stillRelated?.id, candidates[0]!.id);

  const autoUpdate = await api(`/admin/products/${orderedProduct.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ similarProductsMode: "AUTO_CATEGORY" }),
  });
  assert.equal(autoUpdate.status, 200);
  assert.deepEqual((await autoUpdate.json() as { similarProductIds: string[] }).similarProductIds, []);
  const auto = await api(`/suppliers/${supplierA.slug}/public-products/${orderedProduct.id}`);
  const autoDetail = await auto.json() as { relatedProducts: Array<{ id: string }> };
  assert.ok(autoDetail.relatedProducts.some((product) => product.id === candidates[0]!.id));
  assert.ok(!autoDetail.relatedProducts.some((product) => product.id === b2cProduct.id));
});

test("order item supplier and commercial snapshots survive catalog edits and reject direct updates", async () => {
  await db.update(productsTable).set({ variants: null }).where(eq(productsTable.id, orderedProduct.id));
  await addToCart(orderedProduct.id);
  const response = await checkout();
  assert.equal(response.status, 201);
  const created = await response.json() as { id: string };
  orderIds.push(created.id);

  const [before] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, created.id));
  assert.ok(before);
  assert.equal(before.supplierId, supplierA.id);
  assert.equal(before.supplierName, supplierA.name);
  assert.equal(before.supplierSlug, supplierA.slug);
  assert.equal(before.productSkuSnapshot, orderedProduct.sku);
  assert.equal(before.unitPrice, orderedProduct.discountPrice);
  assert.equal(before.lineTotal, orderedProduct.discountPrice);

  await db.update(productsTable).set({
    supplierId: supplierB.id,
    categoryId: supplierBRootId,
    categoryName: `${marker} product root B`,
    name: `${marker} edited name`,
    price: 9_000,
    discountPrice: null,
    sku: `${marker}-edited-sku`,
  }).where(eq(productsTable.id, orderedProduct.id));

  const [after] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.id, before.id));
  assert.deepEqual(
    {
      supplierId: after?.supplierId,
      supplierName: after?.supplierName,
      supplierSlug: after?.supplierSlug,
      productName: after?.productName,
      sku: after?.productSkuSnapshot,
      unitPrice: after?.unitPrice,
      lineSubtotal: after?.lineSubtotal,
      lineTotal: after?.lineTotal,
    },
    {
      supplierId: before.supplierId,
      supplierName: before.supplierName,
      supplierSlug: before.supplierSlug,
      productName: before.productName,
      sku: before.productSkuSnapshot,
      unitPrice: before.unitPrice,
      lineSubtotal: before.lineSubtotal,
      lineTotal: before.lineTotal,
    },
  );
  await assert.rejects(
    db.execute(sql`update order_items set unit_price = unit_price + 1 where id = ${before.id}`),
    (error: unknown) => {
      const cause = error instanceof Error ? error.cause : undefined;
      return cause instanceof Error && /Order item commercial snapshot is immutable/.test(cause.message);
    },
  );
});

test("supplier scope changes reject existing incompatible product channels", async () => {
  const response = await api(`/admin/suppliers/${supplierA.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ scope: "B2C" }),
  });
  assert.equal(response.status, 409, await response.text());
  const [unchanged] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplierA.id));
  assert.equal(unchanged?.scope, "BOTH");
});

test("supplier scope changes serialize with concurrent product creation at the database boundary", async () => {
  const [supplier] = await db.insert(suppliersTable).values({
    name: `${marker} concurrent supplier`,
    slug: `${marker}-concurrent-supplier`,
    scope: "BOTH",
  }).returning();
  assert.ok(supplier);
  supplierIds.push(supplier.id);
  const [category] = await db.insert(productCategoriesTable).values({
    supplierId: supplier.id,
    name: `${marker} concurrent category`,
    slug: `${marker}-concurrent-category`,
  }).returning();
  assert.ok(category);
  categoryIds.push(category.id);

  const scopeChange = await pool.connect();
  let productWrite: ReturnType<typeof db.insert> extends never ? never : Promise<unknown>;
  try {
    await scopeChange.query("begin");
    await scopeChange.query("select id from suppliers where id = $1 for update", [supplier.id]);
    productWrite = db.insert(productsTable).values({
      supplierId: supplier.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `${marker} concurrent professional product`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 1_000,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 1,
      sku: `${marker}-concurrent-product`,
      unit: "kom",
      weightGrams: 100,
    }).returning();
    await expectStillPending(productWrite, "product trigger must wait for the in-flight supplier scope update");
    await scopeChange.query("update suppliers set scope = 'B2C' where id = $1", [supplier.id]);
    await scopeChange.query("commit");
  } catch (error) {
    await scopeChange.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    scopeChange.release();
  }
  await assert.rejects(productWrite!, (error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined;
    const message = `${error instanceof Error ? error.message : ""} ${cause instanceof Error ? cause.message : ""}`;
    return /Product sales channels are not permitted by supplier scope/.test(message);
  });
  const [savedSupplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplier.id));
  assert.equal(savedSupplier?.scope, "B2C");
});

test("supplier and category changes serialize with checkout and return stable conflicts", async () => {
  assert.ok(orderIds[0]);
  await addToCart(conflictProduct.id, 2);

  const supplierChange = await pool.connect();
  let supplierCheckout: Promise<Response> | undefined;
  try {
    await supplierChange.query("begin");
    await supplierChange.query("update suppliers set active = false where id = $1", [supplierA.id]);
    supplierCheckout = checkout();
    await expectStillPending(supplierCheckout, "checkout must wait for the in-flight supplier update");
    await supplierChange.query("commit");
  } catch (error) {
    await supplierChange.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    supplierChange.release();
  }
  const supplierConflict = await supplierCheckout!;
  assert.equal(supplierConflict.status, 409, await supplierConflict.text());

  await db.update(suppliersTable).set({ active: true }).where(eq(suppliersTable.id, supplierA.id));
  const [conflictCategory] = await db.select().from(productCategoriesTable)
    .where(eq(productCategoriesTable.id, conflictProduct.categoryId!));
  assert.ok(conflictCategory);
  const categoryChange = await pool.connect();
  let categoryCheckout: Promise<Response> | undefined;
  try {
    await categoryChange.query("begin");
    await categoryChange.query("update product_categories set active = false where id = $1", [conflictCategory.id]);
    categoryCheckout = checkout();
    await expectStillPending(categoryCheckout, "checkout must wait for the in-flight category update");
    await categoryChange.query("commit");
  } catch (error) {
    await categoryChange.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    categoryChange.release();
  }
  const categoryConflict = await categoryCheckout!;
  assert.equal(categoryConflict.status, 409, await categoryConflict.text());
  const repeatedConflict = await checkout();
  assert.equal(repeatedConflict.status, 409, await repeatedConflict.text());

  const [savedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderIds[0]!));
  const [savedItem] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderIds[0]!));
  assert.ok(savedOrder);
  assert.ok(savedItem);
});

test("admin products remain cross-supplier by default and filter supplier, market, and low stock", async () => {
  const list = async (query = "") => {
    const response = await api(`/admin/products?pageSize=100${query}`, adminCookie);
    assert.equal(response.status, 200);
    return response.json() as Promise<ProductListResponse>;
  };
  const markerIds = new Set(productIds);
  const ids = (response: ProductListResponse) => response.items
    .filter((product) => markerIds.has(product.id))
    .map((product) => product.id);

  const all = await list();
  assert.ok(new Set(all.items.filter((product) => markerIds.has(product.id)).map((product) => product.supplierId)).size >= 2);

  const bySupplier = ids(await list(`&supplierId=${supplierA.id}`));
  assert.ok(bySupplier.includes(conflictProduct.id));
  assert.ok(bySupplier.every((id) => id !== b2cProduct.id));

  const b2b = ids(await list("&market=B2B"));
  assert.ok(b2b.includes(orderedProduct.id));
  assert.ok(b2b.includes(conflictProduct.id));
  assert.ok(!b2b.includes(b2cProduct.id));

  const b2c = ids(await list("&market=B2C"));
  assert.ok(b2c.includes(orderedProduct.id));
  assert.ok(b2c.includes(b2cProduct.id));
  assert.ok(!b2c.includes(conflictProduct.id));

  const lowStock = ids(await list("&lowStock=true"));
  assert.ok(lowStock.includes(conflictProduct.id));
  assert.ok(lowStock.includes(b2cProduct.id));
  assert.ok(!lowStock.includes(orderedProduct.id));
});

test("mixed B2B cancellation preserves explicit variant precedence, restores inventory once, and limits referral credit to clean lines", async () => {
  const [category] = await db.insert(productCategoriesTable).values({
    supplierId: supplierA.id,
    name: `${marker} cancellation category`,
    slug: `${marker}-cancellation-category`,
  }).returning();
  assert.ok(category);
  categoryIds.push(category.id);

  const fixtures = await db.insert(productsTable).values([
    {
      supplierId: supplierA.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `${marker} cancellation full price`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 1_000,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 50,
      sku: `${marker}-cancel-full`,
      unit: "kom",
      weightGrams: 100,
    },
    {
      supplierId: supplierA.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `${marker} cancellation sale variant`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 900,
      discountPrice: 700,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 40,
      sku: `${marker}-cancel-sale`,
      unit: "kom",
      weightGrams: 100,
      variants: [{
        label: "Crvena",
        value: "red",
        stock: 15,
        sku: `${marker}-cancel-sale-red`,
      }],
    },
    {
      supplierId: supplierA.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `${marker} cancellation explicit variant`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 1_000,
      discountPrice: 800,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 40,
      sku: `${marker}-cancel-explicit`,
      unit: "kom",
      weightGrams: 100,
      variants: [{
        label: "Plava",
        value: "blue",
        price: 650,
        priceAdjust: 25,
        stock: 15,
        sku: `${marker}-cancel-explicit-blue`,
      }],
    },
    {
      supplierId: supplierA.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `${marker} cancellation tier`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 800,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 50,
      sku: `${marker}-cancel-tier`,
      unit: "kom",
      weightGrams: 100,
      quantityPricingTiers: [{ minQuantity: 4, maxQuantity: null, unitPrice: 600 }],
    },
    {
      supplierId: supplierA.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `${marker} cancellation bundle component`,
      description: marker,
      imageUrl: "/supplier-catalog-test.jpg",
      price: 500,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 50,
      sku: `${marker}-cancel-component`,
      unit: "kom",
      weightGrams: 100,
    },
  ]).returning();
  assert.equal(fixtures.length, 5);
  productIds.push(...fixtures.map((product) => product.id));
  const [fullPriceProduct, saleVariantProduct, explicitVariantProduct, tierProduct, componentProduct] = fixtures;
  assert.ok(fullPriceProduct);
  assert.ok(saleVariantProduct);
  assert.ok(explicitVariantProduct);
  assert.ok(tierProduct);
  assert.ok(componentProduct);

  const bundleResponse = await api("/admin/bundles", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      supplierId: supplierA.id,
      name: `${marker} cancellation bundle`,
      description: marker,
      market: "B2B",
      b2bPrice: 2_500,
      b2cPrice: null,
      components: [
        { productId: fullPriceProduct.id, quantity: 2 },
        { productId: componentProduct.id, quantity: 3 },
      ],
    }),
  });
  assert.equal(bundleResponse.status, 201, await bundleResponse.clone().text());
  const bundle = await bundleResponse.json() as { id: string };
  bundleIds.push(bundle.id);

  const [cart] = await db.select({ id: shoppingCartsTable.id }).from(shoppingCartsTable)
    .where(eq(shoppingCartsTable.salonId, salonId));
  if (cart) await db.delete(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart.id));

  await addToCart(fullPriceProduct.id, 2);
  await addToCart(saleVariantProduct.id, 3, "red");
  await addToCart(explicitVariantProduct.id, 2, "blue");
  await addToCart(tierProduct.id, 4);
  await addBundleToCart(bundle.id, 2);

  const [creditSource] = await db.insert(referralCreditLedgerTable).values({
    walletKind: "B2B",
    ownerUserId: ownerId,
    salonId,
    type: "available",
    amountRsd: 10_000,
    effectiveAt: new Date(),
    reason: marker,
    idempotencyKey: `${marker}:mixed-cancellation-credit`,
    metadata: { marker },
  }).returning();
  assert.ok(creditSource);

  const previewResponse = await api("/shop/checkout-preview?desiredReferralCreditRsd=10000", ownerCookie);
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  const preview = await previewResponse.json() as {
    cart: { subtotal: number };
    shipping: { shippingCost: number };
    total: number;
    coupon: null;
    couponDiscountRsd: number;
    referralCreditAvailableRsd: number;
    referralCreditAppliedRsd: number;
    merchandiseSubtotalRsd: number;
    shippingRsd: number;
    payableTotalRsd: number;
  };
  assert.equal(JSON.stringify({
    subtotal: preview.cart.subtotal,
    couponDiscountRsd: preview.couponDiscountRsd,
    referralCreditAppliedRsd: preview.referralCreditAppliedRsd,
    merchandiseSubtotalRsd: preview.merchandiseSubtotalRsd,
  }), "{\"subtotal\":12800,\"couponDiscountRsd\":0,\"referralCreditAppliedRsd\":3300,\"merchandiseSubtotalRsd\":3300}");
  assert.equal(preview.coupon, null);
  assert.equal(preview.referralCreditAvailableRsd, 10_000);
  assert.doesNotMatch(JSON.stringify(preview), /adjustments|breakdown|COMMERCE_PRICING_POLICY|pricingPolicy/);

  const response = await api("/shop/checkout", ownerCookie, {
    method: "POST",
    body: JSON.stringify({
      useSalonAddress: true,
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod: "courier",
      termsAccepted: true,
      desiredReferralCreditRsd: 10_000,
      expectedSubtotal: preview.cart.subtotal,
      expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json() as { id: string };
  orderIds.push(created.id);

  const orderLines = await db.select().from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, created.id));
  const linesByProduct = new Map(orderLines.flatMap((line) => line.productId ? [[line.productId, line] as const] : []));
  assert.deepEqual(orderLines.map((line) => line.priceSource).sort(), ["BUNDLE", "FULL_PRICE", "FULL_PRICE", "SALE", "TIER"]);
  assert.equal(linesByProduct.get(fullPriceProduct.id)?.lineTotal, 2_000);
  assert.equal(linesByProduct.get(saleVariantProduct.id)?.lineTotal, 2_100);
  assert.equal(linesByProduct.get(tierProduct.id)?.lineTotal, 2_400);
  assert.equal(orderLines.find((line) => line.bundleId === bundle.id)?.lineTotal, 5_000);
  const explicitLine = linesByProduct.get(explicitVariantProduct.id);
  assert.deepEqual({
    price: explicitLine?.price,
    lineTotal: explicitLine?.lineTotal,
    priceSource: explicitLine?.priceSource,
    lineDiscount: explicitLine?.lineDiscount,
    discountSnapshot: explicitLine?.discountSnapshot,
  }, {
    price: 650,
    lineTotal: 1_300,
    priceSource: "FULL_PRICE",
    lineDiscount: 0,
    discountSnapshot: null,
  });

  const [savedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, created.id));
  assert.equal(savedOrder?.subtotal, preview.cart.subtotal);
  assert.equal(savedOrder?.shippingCost, preview.shippingRsd);
  assert.equal(savedOrder?.total, preview.payableTotalRsd);
  assert.equal(savedOrder?.referralCreditMerchandiseSubtotalRsd, preview.merchandiseSubtotalRsd);
  assert.equal(savedOrder?.referralCreditAppliedRsd, 3_300,
    "Explicit variant prices stay clean while SALE, TIER, and BUNDLE totals do not increase the referral-credit ceiling");
  const redemptions = await db.select().from(referralCreditRedemptionsTable)
    .where(eq(referralCreditRedemptionsTable.orderId, created.id));
  assert.deepEqual(redemptions.map((row) => ({
    ledgerEntryId: row.ledgerEntryId,
    amountRsd: row.amountRsd,
  })), [{ ledgerEntryId: creditSource.id, amountRsd: 3_300 }]);

  const inventoryAfterCheckout = Object.freeze({
    fullPrice: 44,
    saleProduct: 37,
    saleVariant: 12,
    tier: 46,
    component: 44,
  });
  const productsAfterCheckout = await db.select().from(productsTable)
    .where(inArray(productsTable.id, fixtures.map((product) => product.id)));
  const checkoutById = new Map(productsAfterCheckout.map((product) => [product.id, product]));
  assert.equal(checkoutById.get(fullPriceProduct.id)?.stock, inventoryAfterCheckout.fullPrice);
  assert.equal(checkoutById.get(saleVariantProduct.id)?.stock, inventoryAfterCheckout.saleProduct);
  assert.equal(checkoutById.get(saleVariantProduct.id)?.variants?.find((variant) => variant.value === "red")?.stock,
    inventoryAfterCheckout.saleVariant);
  assert.equal(checkoutById.get(tierProduct.id)?.stock, inventoryAfterCheckout.tier);
  assert.equal(checkoutById.get(componentProduct.id)?.stock, inventoryAfterCheckout.component);

  const bundleItem = orderLines.find((line) => line.priceSource === "BUNDLE");
  assert.ok(bundleItem);
  const immutableComponents = await db.select().from(orderBundleComponentsTable)
    .where(eq(orderBundleComponentsTable.orderItemId, bundleItem.id));
  assert.deepEqual(
    immutableComponents.map((component) => ({ productId: component.productId, quantity: component.quantity }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    [
      { productId: fullPriceProduct.id, quantity: 4 },
      { productId: componentProduct.id, quantity: 6 },
    ].sort((left, right) => left.productId.localeCompare(right.productId)),
  );

  await db.update(productBundleComponentsTable).set({ quantity: 9 })
    .where(eq(productBundleComponentsTable.bundleId, bundle.id));

  const historyBeforeConflict = await db.select({ id: orderStatusHistoryTable.id })
    .from(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, created.id));
  const contradictory = await api(`/admin/orders/${created.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "confirmed", fulfillmentStatus: "PACKING" }),
  });
  assert.equal(contradictory.status, 400);
  const [unchangedAfterConflict] = await db.select().from(ordersTable).where(eq(ordersTable.id, created.id));
  assert.equal(unchangedAfterConflict?.status, savedOrder?.status);
  assert.equal(unchangedAfterConflict?.fulfillmentStatus, savedOrder?.fulfillmentStatus);
  const historyAfterConflict = await db.select({ id: orderStatusHistoryTable.id })
    .from(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, created.id));
  assert.equal(historyAfterConflict.length, historyBeforeConflict.length);

  const cancel = () => api(`/admin/orders/${created.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ fulfillmentStatus: "CANCELLED" }),
  });
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [created.id]);
  const cancellation = cancel();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const staleLegacy = api(`/admin/orders/${created.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "confirmed" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  await blocker.query("COMMIT");
  blocker.release();
  const [cancelledResponse, staleResponse] = await Promise.all([cancellation, staleLegacy]);
  assert.equal(cancelledResponse.status, 200);
  assert.equal(staleResponse.status, 409);
  const [terminalOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, created.id));
  assert.equal(terminalOrder?.fulfillmentStatus, "CANCELLED");
  assert.equal(terminalOrder?.status, "cancelled");
  const repeated = await cancel();
  assert.equal(repeated.status, 200);

  const restoredProducts = await db.select().from(productsTable)
    .where(inArray(productsTable.id, fixtures.map((product) => product.id)));
  const restoredById = new Map(restoredProducts.map((product) => [product.id, product]));
  assert.equal(restoredById.get(fullPriceProduct.id)?.stock, 50);
  assert.equal(restoredById.get(saleVariantProduct.id)?.stock, 40);
  assert.equal(restoredById.get(saleVariantProduct.id)?.variants?.find((variant) => variant.value === "red")?.stock, 15);
  assert.equal(restoredById.get(tierProduct.id)?.stock, 50);
  assert.equal(restoredById.get(componentProduct.id)?.stock, 50);
});