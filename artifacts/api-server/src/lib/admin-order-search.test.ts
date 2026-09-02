import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, ordersTable, salonsTable, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

// Regression coverage for GET /admin/orders search/filter semantics (Task 131).
// - status/paymentStatus/deliveryMethod/from/to/salon filters are ANDed.
// - search matches order id, shippingName, or the order's salon (name/email).
// - when salon and search are both present, search must not escape the salon filter.

type OrderRow = { id: string; salonId: string; shippingName: string };

async function makeSalon(suffix: string, label: string): Promise<{ ownerId: string; salonId: string }> {
  const [owner] = await db.insert(usersTable).values({
    firstName: "Order",
    lastName: "Search",
    email: `order-search-owner-${label}-${suffix}@example.test`,
    passwordHash: await hashPassword(`order-search-${suffix}`),
    passwordSetAt: new Date(),
    role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Order Search ${label} ${suffix}`,
    slug: `order-search-${label}-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone: "+381600000000",
    email: `order-search-salon-${label}-${suffix}@example.test`,
    shortDescription: "Order search fixture",
    description: "Order search fixture",
    imageUrl: "",
  }).returning();
  assert.ok(salon);
  return { ownerId: owner.id, salonId: salon.id };
}

async function run(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const alpha = await makeSalon(suffix, "Alpha");
  const beta = await makeSalon(suffix, "Beta");

  const uniqueName = `Marija Petrović ${suffix}`;
  const otherName = `Nikola Jovanović ${suffix}`;

  const [alphaOrder] = await db.insert(ordersTable).values({
    salonId: alpha.salonId,
    total: 1000,
    shippingName: uniqueName,
    shippingAddress: "Adresa 1",
    paymentMethod: "CASH_ON_DELIVERY",
  }).returning();
  const [betaOrder] = await db.insert(ordersTable).values({
    salonId: beta.salonId,
    total: 2000,
    shippingName: otherName,
    shippingAddress: "Adresa 2",
    paymentMethod: "CASH_ON_DELIVERY",
  }).returning();
  assert.ok(alphaOrder);
  assert.ok(betaOrder);

  const [admin] = await db.insert(usersTable).values({
    firstName: "Order",
    lastName: "Admin",
    email: `order-search-admin-${suffix}@example.test`,
    passwordHash: await hashPassword(`order-search-admin-${suffix}`),
    passwordSetAt: new Date(),
    role: "SUPER_ADMIN",
  }).returning();
  assert.ok(admin);
  const cookie = `${sessionCookieName}=${await createSession(admin.id)}`;

  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const listOrders = async (query: string): Promise<OrderRow[]> => {
      const response = await fetch(`${baseUrl}/admin/orders?${query}`, { headers: { cookie } });
      const text = await response.text();
      assert.equal(response.status, 200, `GET /admin/orders?${query}: ${text.slice(0, 500)}`);
      return JSON.parse(text) as OrderRow[];
    };

    // Search-only on shippingName finds the matching order and excludes the other.
    {
      const results = await listOrders(`search=${encodeURIComponent(uniqueName)}`);
      const ids = results.map((o) => o.id);
      assert.ok(ids.includes(alphaOrder.id), "search by shippingName must include the matching order");
      assert.ok(!ids.includes(betaOrder.id), "search by shippingName must exclude non-matching orders");
    }

    // Search-only on order id finds exactly that order.
    {
      const results = await listOrders(`search=${encodeURIComponent(betaOrder.id)}`);
      const ids = results.map((o) => o.id);
      assert.ok(ids.includes(betaOrder.id), "search by order id must include that order");
      assert.ok(!ids.includes(alphaOrder.id), "search by order id must exclude other orders");
    }

    // Combined salon + search must not escape the salon filter: searching for the
    // beta order's shippingName while scoped to the alpha salon returns nothing.
    {
      const results = await listOrders(
        `salon=${encodeURIComponent(`Order Search Alpha ${suffix}`)}&search=${encodeURIComponent(otherName)}`,
      );
      const ids = results.map((o) => o.id);
      assert.ok(!ids.includes(betaOrder.id), "salon+search must not surface orders from another salon");
      assert.ok(!ids.includes(alphaOrder.id), "salon+search with a non-matching term returns nothing in-scope");
    }

    // Combined salon + search that does match within scope returns the in-scope order.
    {
      const results = await listOrders(
        `salon=${encodeURIComponent(`Order Search Alpha ${suffix}`)}&search=${encodeURIComponent(uniqueName)}`,
      );
      const ids = results.map((o) => o.id);
      assert.ok(ids.includes(alphaOrder.id), "salon+search must return the matching in-scope order");
      assert.ok(!ids.includes(betaOrder.id), "salon+search must never include the other salon's order");
    }

    process.stdout.write("✓ admin order search regression suite passed\n");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(ordersTable).where(inArray(ordersTable.id, [alphaOrder.id, betaOrder.id]));
    await db.delete(salonsTable).where(inArray(salonsTable.id, [alpha.salonId, beta.salonId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [admin.id, alpha.ownerId, beta.ownerId]));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
