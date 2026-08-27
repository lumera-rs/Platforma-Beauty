import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, productsTable, productCategoriesTable, retailCartsTable, retailOrderItemsTable, retailOrdersTable,
  retailProductSubscriptionAttemptsTable, retailProductSubscriptionsTable, sessionsTable, suppliersTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { runRetailSubscriptionWorker } from "./retail-subscription-worker";
import { nextRetailSubscriptionDueAt } from "./retail-subscription-worker";
import { ensureShippingConfigSchema } from "./shipping-config";

let url = ""; let server: ReturnType<typeof app.listen>;
const ids: { users: string[]; subscriptions: string[]; orders: string[]; products: string[]; categories: string[]; suppliers: string[] } =
  { users: [], subscriptions: [], orders: [], products: [], categories: [], suppliers: [] };

async function user() {
  const id = randomUUID();
  const [row] = await db.insert(usersTable).values({ firstName: "Recurring", lastName: "Test", email: `${id}@example.test`,
    passwordHash: await hashPassword(id), passwordSetAt: new Date(), role: "CUSTOMER", active: true }).returning();
  ids.users.push(row!.id); return row!;
}
async function product(stock = 10, allowed = true, discount = 20) {
  const marker = randomUUID(); const [supplier] = await db.insert(suppliersTable).values({ name: marker, slug: marker, active: true }).returning();
  const [category] = await db.insert(productCategoriesTable).values({ supplierId: supplier!.id, name: marker, slug: marker }).returning();
  const [row] = await db.insert(productsTable).values({ supplierId: supplier!.id, categoryId: category!.id, categoryName: marker, name: marker,
    description: marker, imageUrl: "/test.jpg", price: 1000, publicPrice: 1000, retailEnabled: true, professionalEnabled: false,
    subscriptionAllowed: allowed, subscriptionDiscountPercent: discount, stock, sku: marker, unit: "kom" }).returning();
  ids.suppliers.push(supplier!.id); ids.categories.push(category!.id); ids.products.push(row!.id); return row!;
}
function request(cookie: string, path: string, body?: unknown) {
  return fetch(`${url}${path}`, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
}
function input(productId: string) {
  return { productId, quantity: 2, frequency: "WEEKLY", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    contact: { firstName: "A", lastName: "B", email: "a@example.test", phone: "+381601234567" },
    delivery: { street: "Ulica 1", city: "Novi Sad", postalCode: "21000" }, firstDueAt: new Date(Date.now() - 1_000).toISOString() };
}

test.before(async () => { await ensureBusinessGrowthSchema(); await ensureShippingConfigSchema(); server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`; });
test.after(async () => {
  const orders = ids.users.length ? await db.select({ id: retailOrdersTable.id }).from(retailOrdersTable).where(inArray(retailOrdersTable.userId, ids.users)) : [];
  ids.orders.push(...orders.map((row) => row.id));
  if (ids.subscriptions.length) await db.delete(retailProductSubscriptionsTable).where(inArray(retailProductSubscriptionsTable.id, ids.subscriptions));
  if (ids.orders.length) { await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, ids.orders)); await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, ids.orders)); }
  if (ids.products.length) await db.delete(productsTable).where(inArray(productsTable.id, ids.products));
  if (ids.categories.length) await db.delete(productCategoriesTable).where(inArray(productCategoriesTable.id, ids.categories));
  if (ids.suppliers.length) await db.delete(suppliersTable).where(inArray(suppliersTable.id, ids.suppliers));
  if (ids.users.length) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, ids.users));
    await db.delete(retailCartsTable).where(inArray(retailCartsTable.userId, ids.users));
    await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
  }
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
});

test("customer eligibility, ownership, and idempotent lifecycle", async () => {
  const owner = await user(); const stranger = await user(); const item = await product();
  const cookie = `${sessionCookieName}=${await createSession(owner.id)}`;
  const create = await request(cookie, "/customer/retail-subscriptions", input(item.id)); assert.equal(create.status, 201);
  const subscription = await create.json() as { id: string; discountPercent: number; status: string }; ids.subscriptions.push(subscription.id);
  assert.equal(subscription.discountPercent, 20);
  assert.equal((await request(`${sessionCookieName}=${await createSession(stranger.id)}`, `/customer/retail-subscriptions/${subscription.id}`)).status, 404);
  for (const action of ["pause", "pause", "resume", "resume", "cancel", "cancel"]) {
    const response = await request(cookie, `/customer/retail-subscriptions/${subscription.id}/${action}`, {});
    assert.equal(response.status, 200);
  }
  const forbidden = await product(5, false);
  assert.equal((await request(cookie, "/customer/retail-subscriptions", input(forbidden.id))).status, 409);
});

test("concurrent cycles are exact-once, price from discount snapshot, and stock failure has no side effects", async () => {
  const owner = await user(); const item = await product(6, true, 25);
  const [subscription] = await db.insert(retailProductSubscriptionsTable).values({
    userId: owner.id, productId: item.id, quantity: 2, frequency: "WEEKLY", discountPercentSnapshot: 25,
    paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier", contactSnapshot: { firstName: "A", lastName: "B", email: "a@example.test", phone: "1" },
    deliverySnapshot: { street: "Ulica 1", city: "Novi Sad", postalCode: "21000", shippingCost: 0 }, anchorDay: 1, nextDueAt: new Date(Date.now() - 1_000),
  }).returning(); ids.subscriptions.push(subscription!.id);
  await Promise.all([runRetailSubscriptionWorker(), runRetailSubscriptionWorker()]);
  const attempts = await db.select().from(retailProductSubscriptionAttemptsTable).where(eq(retailProductSubscriptionAttemptsTable.subscriptionId, subscription!.id));
  assert.equal(attempts.length, 1); assert.equal(attempts[0]!.status, "CREATED");
  const [line] = await db.select().from(retailOrderItemsTable).where(eq(retailOrderItemsTable.orderId, attempts[0]!.orderId!)); assert.equal(line!.unitPrice, 750);
  const [after] = await db.select().from(productsTable).where(eq(productsTable.id, item.id)); assert.equal(after!.stock, 4);
  const out = await product(0); const [blocked] = await db.insert(retailProductSubscriptionsTable).values({
    userId: owner.id, productId: out.id, quantity: 1, frequency: "WEEKLY", discountPercentSnapshot: 0, paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
    contactSnapshot: { firstName: "A", lastName: "B", email: "a@example.test", phone: "1" }, deliverySnapshot: { street: "x", city: "Novi Sad", postalCode: "1", shippingCost: 0 }, anchorDay: 1, nextDueAt: new Date(Date.now() - 1_000),
  }).returning(); ids.subscriptions.push(blocked!.id); await runRetailSubscriptionWorker();
  const [blockedRow] = await db.select().from(retailProductSubscriptionsTable).where(eq(retailProductSubscriptionsTable.id, blocked!.id));
  const blockedAttempts = await db.select().from(retailProductSubscriptionAttemptsTable).where(eq(retailProductSubscriptionAttemptsTable.subscriptionId, blocked!.id));
  assert.equal(blockedAttempts[0]!.status, "INSUFFICIENT_STOCK"); assert.ok(blockedRow!.blockedUntil);
  const [outAfter] = await db.select().from(productsTable).where(eq(productsTable.id, out.id)); assert.equal(outAfter!.stock, 0);
});

test("calendar cadence keeps the original end-of-month anchor", () => {
  const atNoon = (value: string) => new Date(`${value}T12:34:56.000Z`);
  assert.equal(nextRetailSubscriptionDueAt(atNoon("2023-01-31"), "MONTHLY", 31).toISOString(), "2023-02-28T12:34:56.000Z");
  assert.equal(nextRetailSubscriptionDueAt(atNoon("2023-02-28"), "MONTHLY", 31).toISOString(), "2023-03-31T12:34:56.000Z");
  assert.equal(nextRetailSubscriptionDueAt(atNoon("2024-01-31"), "MONTHLY", 31).toISOString(), "2024-02-29T12:34:56.000Z");
  assert.equal(nextRetailSubscriptionDueAt(atNoon("2024-02-29"), "MONTHLY", 31).toISOString(), "2024-03-31T12:34:56.000Z");
  assert.equal(nextRetailSubscriptionDueAt(atNoon("2023-12-31"), "EVERY_TWO_MONTHS", 31).toISOString(), "2024-02-29T12:34:56.000Z");
  assert.equal(nextRetailSubscriptionDueAt(atNoon("2024-02-29"), "EVERY_TWO_MONTHS", 31).toISOString(), "2024-04-30T12:34:56.000Z");
});