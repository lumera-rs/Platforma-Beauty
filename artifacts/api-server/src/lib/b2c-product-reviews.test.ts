import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, productCategoriesTable, productsTable, retailCartsTable, retailOrderItemsTable,
  retailOrdersTable, retailProductReviewModerationAuditsTable, retailProductReviewReportsTable,
  retailProductReviewsTable, suppliersTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

const marker = `b2c-review-${randomUUID()}`;
let base = ""; let server: ReturnType<typeof app.listen>;
let supplierId = ""; let productId = ""; let otherProductId = "";
const users: string[] = []; const orders: string[] = []; const carts: string[] = [];
let customer = ""; let jobseeker = ""; let other = ""; let admin = "";
const cookie = async (id: string) => `${sessionCookieName}=${await createSession(id)}`;
const api = (path: string, session = "", init: RequestInit = {}) => fetch(`${base}${path}`, {
  ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(session ? { cookie: session } : {}) },
});

async function user(role: "CUSTOMER" | "JOBSEEKER" | "ADMIN") {
  const [row] = await db.insert(usersTable).values({
    firstName: role, lastName: "Private", email: `${role}-${randomUUID()}@example.test`,
    passwordHash: await hashPassword(marker), passwordSetAt: new Date(), role,
  }).returning();
  users.push(row!.id); return row!.id;
}
async function order(owner: string | null, product: string, status: "delivered" | "pending") {
  const [cart] = await db.insert(retailCartsTable).values({ tokenHash: randomUUID(), userId: owner }).returning();
  carts.push(cart!.id);
  const [row] = await db.insert(retailOrdersTable).values({
    orderNumber: `${marker}-${orders.length}`, cartId: cart!.id, userId: owner, trackingTokenHash: randomUUID(),
    idempotencyKey: randomUUID(), status, paymentMethod: "CARD", subtotal: 100, total: 100,
    shippingName: "Test", shippingAddress: "Test 1", shippingCity: "Beograd", shippingPostalCode: "11000",
    shippingPhone: "+381601234567", shippingEmail: "guest@example.test",
  }).returning();
  orders.push(row!.id);
  await db.insert(retailOrderItemsTable).values({
    orderId: row!.id, productId: product, productName: "Review product", productImageUrl: "/test.jpg",
    unitPrice: 100, quantity: 1, supplierId, supplierName: "Review supplier", supplierSlug: marker,
    lineSubtotal: 100, lineTotal: 100,
  });
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  [customer, jobseeker, other, admin] = await Promise.all([user("CUSTOMER"), user("JOBSEEKER"), user("CUSTOMER"), user("ADMIN")]);
  const [supplier] = await db.insert(suppliersTable).values({ name: marker, slug: marker, scope: "BOTH" }).returning(); supplierId = supplier!.id;
  const [category] = await db.insert(productCategoriesTable).values({ supplierId, name: marker, slug: marker }).returning();
  const created = await db.insert(productsTable).values([0, 1].map((i) => ({
    supplierId, categoryId: category!.id, categoryName: marker, name: `${marker}-${i}`, description: marker, publicDescription: marker,
    imageUrl: "/test.jpg", price: 100, publicPrice: 100, retailEnabled: true, professionalEnabled: false, stock: 10, sku: `${marker}-${i}`, unit: "kom",
  }))).returning();
  productId = created[0]!.id; otherProductId = created[1]!.id;
  await order(customer, productId, "delivered"); await order(jobseeker, productId, "delivered");
  await order(other, otherProductId, "delivered"); await order(customer, otherProductId, "pending"); await order(null, productId, "delivered");
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(retailProductReviewModerationAuditsTable).where(inArray(retailProductReviewModerationAuditsTable.moderatorUserId, users));
  await db.delete(retailProductReviewReportsTable).where(inArray(retailProductReviewReportsTable.reporterUserId, users));
  await db.delete(retailProductReviewsTable).where(inArray(retailProductReviewsTable.userId, users));
  await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, orders));
  await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, orders));
  await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, carts));
  await db.delete(productsTable).where(inArray(productsTable.id, [productId, otherProductId]));
  await db.delete(productCategoriesTable).where(eq(productCategoriesTable.supplierId, supplierId));
  await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
});

test("verified B2C review lifecycle, moderation and aggregate parity", async () => {
  const guest = await api(`/customer/retail-products/${productId}/reviews`, "", { method: "POST", body: JSON.stringify({ rating: 5, comment: "Guest" }) });
  assert.equal(guest.status, 401);
  const c = await cookie(customer); const j = await cookie(jobseeker); const o = await cookie(other); const a = await cookie(admin);
  assert.equal((await api(`/customer/retail-products/${productId}/review-context`, c)).status, 200);
  assert.equal((await api(`/customer/retail-products/${otherProductId}/reviews`, c, { method: "POST", body: JSON.stringify({ rating: 5, comment: "wrong" }) })).status, 403);
  const create = await api(`/customer/retail-products/${productId}/reviews`, c, { method: "POST", body: JSON.stringify({ rating: 5, comment: "Excellent" }) });
  assert.equal(create.status, 201); const review = await create.json() as { id: string };
  assert.equal((await api(`/customer/retail-products/${productId}/reviews`, c, { method: "POST", body: JSON.stringify({ rating: 5, comment: "duplicate" }) })).status, 409);
  assert.equal((await api(`/customer/retail-products/${productId}/reviews/${review.id}`, o, { method: "PATCH", body: JSON.stringify({ rating: 1, comment: "no" }) })).status, 403);
  assert.equal((await api(`/customer/retail-products/${productId}/reviews/${review.id}`, c, { method: "PATCH", body: JSON.stringify({ rating: 4, comment: "Still excellent" }) })).status, 200);
  const jobReviewResponse = await api(`/customer/retail-products/${productId}/reviews`, j, { method: "POST", body: JSON.stringify({ rating: 3, comment: "Solid" }) });
  assert.equal(jobReviewResponse.status, 201); const jobReview = await jobReviewResponse.json() as { id: string };
  assert.equal((await api(`/customer/retail-products/${productId}/reviews/${jobReview.id}`, j, { method: "DELETE" })).status, 204);
  assert.equal((await api(`/customer/retail-products/${productId}/reviews`, j, { method: "POST", body: JSON.stringify({ rating: 3, comment: "Solid again" }) })).status, 201);
  const publicBefore = await api(`/retail/products/${productId}/reviews`); const visible = await publicBefore.json() as Array<Record<string, unknown>>;
  assert.equal(visible.length, 2);
  assert.deepEqual(Object.keys(visible[0]!).sort(), ["comment", "createdAt", "id", "rating", "reviewerName", "updatedAt", "verifiedPurchase"].sort());
  assert.equal(visible[0]!.verifiedPurchase, true);
  await db.update(productsTable).set({ active: false }).where(eq(productsTable.id, productId));
  assert.equal((await api(`/retail/products/${productId}/reviews`)).status, 404);
  await db.update(productsTable).set({ active: true }).where(eq(productsTable.id, productId));
  await Promise.all([o, j, a].map(async (session, i) => api(`/retail-product-reviews/${review.id}/reports`, session, { method: "POST", body: JSON.stringify({ reason: i ? "SPAM" : "OTHER" }) })));
  const detail = await api(`/admin/retail-product-reviews/${review.id}`, a); assert.equal(detail.status, 200);
  assert.equal((await detail.json() as { moderationStatus: string }).moderationStatus, "AUTO_FLAGGED");
  const remove = await api(`/admin/retail-product-reviews/${review.id}/moderation`, a, { method: "POST", body: JSON.stringify({ action: "REMOVE", reason: "test" }) }); assert.equal(remove.status, 200);
  assert.equal((await api(`/retail/products/${productId}/reviews`)).status, 200);
  const restore = await api(`/admin/retail-product-reviews/${review.id}/moderation`, a, { method: "POST", body: JSON.stringify({ action: "RESTORE" }) }); assert.equal(restore.status, 200);
  const again = await api(`/admin/retail-product-reviews/${review.id}/moderation`, a, { method: "POST", body: JSON.stringify({ action: "RESTORE" }) }); assert.equal(again.status, 200);
  const audits = await db.select().from(retailProductReviewModerationAuditsTable).where(eq(retailProductReviewModerationAuditsTable.reviewId, review.id));
  assert.equal(audits.length, 2, "identical moderation retry is idempotent");
  const racingWrites = Promise.all([
    api(`/admin/retail-product-reviews/${review.id}/moderation`, a, { method: "POST", body: JSON.stringify({ action: "REMOVE" }) }),
    api(`/customer/retail-products/${productId}/reviews/${review.id}`, c, { method: "PATCH", body: JSON.stringify({ rating: 2, comment: "Concurrent edit" }) }),
    api(`/retail-product-reviews/${review.id}/reports`, o, { method: "POST", body: JSON.stringify({ reason: "SPAM" }) }),
    api(`/customer/retail-products/${productId}/reviews/${review.id}`, c, { method: "DELETE" }),
  ]);
  const raced = await Promise.race([
    racingWrites,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("concurrent review writes deadlocked")), 5_000)),
  ]);
  assert.equal(raced.length, 4);
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  const published = await db.select().from(retailProductReviewsTable).where(and(
    eq(retailProductReviewsTable.productId, productId),
    eq(retailProductReviewsTable.moderationStatus, "PUBLISHED"),
  ));
  assert.equal(product!.reviewCount, published.length, "aggregate matches the serialized concurrent result");
});