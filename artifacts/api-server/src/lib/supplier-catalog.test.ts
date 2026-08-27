import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  type DatabasePoolClient,
  orderItemsTable,
  ordersTable,
  pool,
  productCategoriesTable,
  productsTable,
  salonsTable,
  shoppingCartItemsTable,
  shoppingCartsTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { ensureShippingConfigSchema } from "./shipping-config";

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

async function addToCart(productId: string, quantity = 1) {
  const response = await api("/shop/cart/items", ownerCookie, {
    method: "POST",
    body: JSON.stringify({ productId, quantity }),
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
      variants: [{ label: "Secret variant", value: "secret", stock: 10, sku: `${marker}-variant` }],
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
    if (orderIds.length) {
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
    if (productIds.length) await db.delete(productsTable).where(inArray(productsTable.id, productIds));
    if (categoryIds.length) await db.delete(productCategoriesTable).where(inArray(productCategoriesTable.id, categoryIds));
    if (supplierIds.length) await db.delete(suppliersTable).where(inArray(suppliersTable.id, supplierIds));
    if (adminId || ownerId) await db.delete(usersTable).where(inArray(usersTable.id, [adminId, ownerId].filter(Boolean)));
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
    "sku", "stock", "weightGrams", "variants", "professionalEnabled",
    "publicPrice", "publicDiscountPrice",
  ]) {
    assert.equal(Object.hasOwn(product, forbidden), false, `public response leaked ${forbidden}`);
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