import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  b2bCartImportsTable, db, productCategoriesTable, productsTable, productWishlistsTable,
  salonsTable, shoppingCartItemsTable, shoppingCartsTable, suppliersTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

const marker = `import-wishlist-${randomUUID()}`;
let server: ReturnType<typeof app.listen>;
let base = "";
let ownerCookie = "", customerCookie = "", otherCustomerCookie = "";
let ownerId = "", customerId = "", otherCustomerId = "", salonId = "", supplierId = "", categoryId = "";
const productIds: string[] = [];
let variantSku = "", validSku = "", outScopeSku = "", moqSku = "", stockSku = "", publicProductId = "";

async function request(path: string, cookie = "", init: RequestInit = {}) {
  return fetch(`${base}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });
}
async function user(role: "SALON_OWNER" | "CUSTOMER") {
  const [row] = await db.insert(usersTable).values({
    firstName: marker, lastName: role, email: `${marker}-${role}-${randomUUID()}@example.test`,
    passwordHash: await hashPassword(marker), passwordSetAt: new Date(), role,
  }).returning();
  assert.ok(row); return row;
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  const owner = await user("SALON_OWNER"), customer = await user("CUSTOMER"), other = await user("CUSTOMER");
  ownerId = owner.id; customerId = customer.id; otherCustomerId = other.id;
  ownerCookie = `${sessionCookieName}=${await createSession(owner.id)}`;
  customerCookie = `${sessionCookieName}=${await createSession(customer.id)}`;
  otherCustomerCookie = `${sessionCookieName}=${await createSession(other.id)}`;
  const [salon] = await db.insert(salonsTable).values({ ownerId, name: marker, slug: marker, city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000", phone: "+381601234567", email: `${marker}@test`, shortDescription: marker, description: marker, imageUrl: "/test.jpg" }).returning();
  salonId = salon!.id;
  const [supplier] = await db.insert(suppliersTable).values({ name: marker, slug: marker, scope: "BOTH" }).returning(); supplierId = supplier!.id;
  const [category] = await db.insert(productCategoriesTable).values({ supplierId, name: marker, slug: marker }).returning(); categoryId = category!.id;
  const make = (sku: string, extra: Partial<typeof productsTable.$inferInsert> = {}) => ({
    supplierId, categoryId, categoryName: marker, name: sku, description: marker, imageUrl: "/test.jpg", price: 1000,
    publicDescription: marker, publicPrice: 1200, retailEnabled: true, professionalEnabled: true, stock: 10, sku, unit: "kom", ...extra,
  });
  variantSku = `${marker}-variant`; validSku = `${marker}-valid`; outScopeSku = `${marker}-scope`; moqSku = `${marker}-moq`; stockSku = `${marker}-stock`;
  const created = await db.insert(productsTable).values([
    make(`${marker}-base`, { variants: [{ label: "V", value: "v", sku: variantSku, stock: 5 }] }),
    make(validSku), make(outScopeSku), make(moqSku, { minimumOrderQuantity: 3 }), make(stockSku, { stock: 1 }),
  ]).returning();
  productIds.push(...created.map((p) => p.id)); publicProductId = created[1]!.id;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(productWishlistsTable).where(inArray(productWishlistsTable.userId, [customerId, otherCustomerId]));
  const carts = await db.select({ id: shoppingCartsTable.id }).from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salonId));
  if (carts.length) {
    await db.delete(b2bCartImportsTable).where(eq(b2bCartImportsTable.salonId, salonId));
    await db.delete(shoppingCartItemsTable).where(inArray(shoppingCartItemsTable.cartId, carts.map((c) => c.id)));
    await db.delete(shoppingCartsTable).where(inArray(shoppingCartsTable.id, carts.map((c) => c.id)));
  }
  if (productIds.length) await db.delete(productsTable).where(inArray(productsTable.id, productIds));
  await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
  await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  await db.delete(usersTable).where(inArray(usersTable.id, [ownerId, customerId, otherCustomerId]));
});

test("CSV import diagnoses variant, unknown, scope, MOQ and stock rows and applies only after confirmation", async () => {
  // A separate supplier makes just this SKU B2B-ineligible.
  const [scopeSupplier] = await db.insert(suppliersTable).values({ name: `${marker}-scope`, slug: `${marker}-scope`, scope: "B2C" }).returning();
  await db.update(productsTable).set({ supplierId: scopeSupplier!.id, categoryId: null, professionalEnabled: false }).where(eq(productsTable.sku, outScopeSku));
  const csv = `SKU,Quantity\r\n${variantSku},2\r\nUNKNOWN,1\r\n${outScopeSku},1\r\n${moqSku},1\r\n${stockSku},2\r\n`;
  const preview = await request("/shop/order-import/preview", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: csv }) });
  assert.equal(preview.status, 200); const result = await preview.json() as { matchedRows: unknown[]; unmatchedRows: Array<{ code: string }>; invalidRows: Array<{ code: string }> };
  assert.equal(result.matchedRows.length, 1); assert.deepEqual(result.unmatchedRows.map((x) => x.code), ["SKU_NOT_FOUND"]);
  assert.deepEqual(new Set(result.invalidRows.map((x) => x.code)), new Set(["SUPPLIER_SCOPE", "MOQ_NOT_MET", "INSUFFICIENT_STOCK"]));
  const denied = await request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: csv, confirmed: false, idempotencyKey: `${marker}-confirm` }) });
  assert.equal(denied.status, 409);
  const applied = await request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: csv, confirmed: true, idempotencyKey: `${marker}-confirm` }) });
  assert.equal(applied.status, 201);
});

test("CSV apply revalidates catalog and aggregate cart stock under transaction locks", async () => {
  const csv = `SKU,Quantity\r\n${validSku},2\r\n`;
  const preview = () => request("/shop/order-import/preview", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: csv }) });
  const apply = (key: string) => request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: csv, confirmed: true, idempotencyKey: `${marker}-${key}` }) });

  assert.equal((await preview()).status, 200);
  await db.update(productsTable).set({ active: false }).where(eq(productsTable.sku, validSku));
  assert.equal((await db.select({ active: productsTable.active }).from(productsTable).where(eq(productsTable.sku, validSku)))[0]?.active, false);
  assert.equal((await apply("inactive-product")).status, 409);
  await db.update(productsTable).set({ active: true }).where(eq(productsTable.sku, validSku));

  assert.equal((await preview()).status, 200);
  await db.update(productCategoriesTable).set({ active: false }).where(eq(productCategoriesTable.id, categoryId));
  assert.equal((await apply("inactive-category")).status, 409);
  await db.update(productCategoriesTable).set({ active: true }).where(eq(productCategoriesTable.id, categoryId));

  assert.equal((await preview()).status, 200);
  await db.update(suppliersTable).set({ scope: "B2C" }).where(eq(suppliersTable.id, supplierId));
  assert.equal((await apply("supplier-scope")).status, 409);
  await db.update(suppliersTable).set({ scope: "BOTH" }).where(eq(suppliersTable.id, supplierId));

  await db.update(productsTable).set({ stock: 3 }).where(eq(productsTable.sku, validSku));
  assert.equal((await preview()).status, 200);
  const [cart] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salonId));
  const [product] = await db.select().from(productsTable).where(eq(productsTable.sku, validSku));
  const [existing] = await db.insert(shoppingCartItemsTable).values({ cartId: cart!.id, productId: product!.id, productName: product!.name, productImageUrl: product!.imageUrl, productSku: product!.sku, unitPrice: product!.price, quantity: 2 }).returning();
  assert.equal((await apply("aggregate-stock")).status, 409);
  await db.delete(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.id, existing!.id));
  await db.update(productsTable).set({ stock: 10 }).where(eq(productsTable.sku, validSku));
});

test("CSV import idempotency is salon scoped and never doubles cart quantity", async () => {
  const csv = `SKU,Quantity\r\n${validSku},2\r\n`;
  for (const expected of [201, 200]) {
    const response = await request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: csv, confirmed: false, idempotencyKey: `${marker}-retry` }) });
    assert.equal(response.status, expected);
  }
  const mismatch = await request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: `SKU,Quantity\r\n${validSku},3\r\n`, confirmed: false, idempotencyKey: `${marker}-retry` }) });
  assert.equal(mismatch.status, 409);
  const malformedRetry = await request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: "SKU,Quantity\r\n\"unterminated,2", confirmed: true, idempotencyKey: `${marker}-retry` }) });
  assert.equal(malformedRetry.status, 409);
  const invalidUnconfirmedRetry = await request("/shop/order-import/apply", ownerCookie, { method: "POST", body: JSON.stringify({ csvText: "SKU,Quantity\r\nUNKNOWN,1\r\n", confirmed: false, idempotencyKey: `${marker}-retry` }) });
  assert.equal(invalidUnconfirmedRetry.status, 409);
  const [line] = await db.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.productSku, validSku));
  assert.equal(line?.quantity, 2);
});

test("wishlist is customer isolated, idempotent, toggleable, and retains unavailable rows", async () => {
  assert.equal((await request("/retail/wishlist")).status, 401);
  const input = { productId: publicProductId };
  assert.equal((await request("/retail/wishlist", customerCookie, { method: "POST", body: JSON.stringify(input) })).status, 201);
  assert.equal((await request("/retail/wishlist", customerCookie, { method: "POST", body: JSON.stringify(input) })).status, 200);
  const otherList = await request("/retail/wishlist", otherCustomerCookie);
  assert.equal((await otherList.json() as unknown[]).length, 0);
  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, publicProductId));
  const list = await request("/retail/wishlist", customerCookie);
  const [saved] = await list.json() as Array<{ available: boolean; unavailableReason: string }>;
  assert.equal(saved?.available, false); assert.equal(saved?.unavailableReason, "OUT_OF_STOCK");
  assert.equal((await request("/retail/wishlist/toggle", customerCookie, { method: "POST", body: JSON.stringify(input) })).status, 200);
  assert.equal((await request(`/retail/wishlist/${publicProductId}`, customerCookie, { method: "DELETE" })).status, 204);
  const variantInput = { productId: productIds[0]!, variantValue: "v" };
  assert.equal((await request("/retail/wishlist", customerCookie, { method: "POST", body: JSON.stringify(variantInput) })).status, 201);
  await db.update(productsTable).set({ variants: [{ label: "V", value: "v", sku: variantSku, stock: 0 }] }).where(eq(productsTable.id, variantInput.productId));
  assert.equal((await request(`/retail/wishlist/${variantInput.productId}?variantValue=v`, customerCookie, { method: "DELETE" })).status, 204);
});