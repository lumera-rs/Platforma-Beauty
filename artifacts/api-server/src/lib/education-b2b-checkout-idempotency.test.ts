/**
 * Regression coverage for the MEDIUM finding: POST /education/b2b/checkout
 * had no durable idempotency/replay protection. A double-click, network
 * retry, timeout retry, or deliberate replay could create a second
 * educationB2bOrdersTable row and decrement product stock a second time for
 * what was intended to be one checkout.
 *
 * education-b2b-discounts.ts's checkout handler now requires a client
 * Idempotency-Key header, fingerprints the canonical request payload, and
 * -- inside a single db.transaction() serialized by a
 * pg_advisory_xact_lock(centerId, idempotencyKey) (the same durable pattern
 * already used by the retail checkout and education operational bookings)
 * -- either performs the checkout once (validate quote, decrement stock,
 * insert the order) or replays the exact original result for a repeat of
 * the same key. The (centerId, idempotencyKey) pair is also enforced by a
 * partial unique database index, so the guarantee holds even outside this
 * one request path. This file verifies, against a real running Express app
 * instance, real HTTP requests, and real Postgres state:
 *
 *   1. The first request creates exactly one order and decrements stock once.
 *   2. The same key + same payload returns the original result (replay).
 *   3. Replay does not create another order.
 *   4. Replay does not decrement stock again.
 *   5. The same key with a different payload returns 409 and touches
 *      neither stock nor the order table.
 *   6. Two concurrent requests with the same key create exactly one order
 *      and decrement stock exactly once, with no 500 from a duplicate-key
 *      race.
 *   7. Different keys with the same payload create two separate,
 *      legitimate orders.
 *   8. The same key reused by a different education center does not
 *      collide -- each center gets its own independent order.
 *   9. Replay still returns the original result after the HTTP server
 *      (process) restarts, because the idempotency record is Postgres-
 *      backed, not process-memory-only.
 *  10. A failure before commit (insufficient stock) does not poison the
 *      key: a later retry with a satisfiable payload succeeds normally.
 *
 * Also verified: a missing Idempotency-Key header is rejected with 400
 * without touching stock or creating an order, and existing
 * insufficient-stock behavior still holds when two distinct-key requests
 * race for the same limited stock (exactly one wins).
 *
 * Run:
 *   NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
 *     ../artifacts/api-server/src/lib/education-b2b-checkout-idempotency.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db, educationB2bOrderItemsTable, educationB2bOrdersTable, educationCentersTable,
  productsTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

const marker = `edu-b2b-idem-${randomUUID().slice(0, 8)}`;
const passwordHash = await hashPassword(marker);
const createdUserIds: string[] = [];
const createdCenterIds: string[] = [];
const createdProductIds: string[] = [];

async function createCenterOwner(prefix: string) {
  const [owner] = await db.insert(usersTable).values({
    firstName: "Center", lastName: `${marker}-${prefix}`, email: `${prefix}-${marker}@example.test`,
    passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
  }).returning();
  createdUserIds.push(owner!.id);
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: owner!.id, name: `${marker}-${prefix}`, city: "Beograd", description: marker, imageUrl: "/test.jpg",
  }).returning();
  createdCenterIds.push(center!.id);
  const cookie = `${sessionCookieName}=${await createSession(owner!.id)}`;
  return { owner: owner!, center: center!, cookie };
}

async function createProduct(prefix: string, stock: number, price = 1000) {
  const [product] = await db.insert(productsTable).values({
    categoryName: "Test", name: `${marker}-${prefix}`, description: marker, imageUrl: "/test.jpg",
    price, publicPrice: price, retailEnabled: true, stock, sku: `${marker}-${prefix}`,
    unit: "kom", professionalEnabled: true,
  }).returning();
  createdProductIds.push(product!.id);
  return product!;
}

async function startServer() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
}

async function stopServer(server: ReturnType<typeof app.listen>) {
  server.close();
  await once(server, "close");
}

async function quoteFor(baseUrl: string, cookie: string, lines: Array<{ productId: string; quantity: number }>) {
  const response = await fetch(`${baseUrl}/education/b2b/quote`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ lines }),
  });
  assert.equal(response.status, 200, "quote must succeed to compute the authoritative expectedTotalRsd for the test");
  return await response.json() as { payableTotalRsd: number };
}

async function checkout(baseUrl: string, cookie: string, key: string | null, body: unknown) {
  const response = await fetch(`${baseUrl}/education/b2b/checkout`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...(key === null ? {} : { "Idempotency-Key": key }) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

async function stockOf(productId: string) {
  const [row] = await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, productId));
  return row?.stock ?? null;
}

async function orderCount(centerId: string) {
  const rows = await db.select({ id: educationB2bOrdersTable.id }).from(educationB2bOrdersTable).where(eq(educationB2bOrdersTable.centerId, centerId));
  return rows.length;
}

async function run(): Promise<void> {
  let { server, baseUrl } = await startServer();

  try {
    await test("first request creates one order and decrements stock; replay returns the identical result with no side effects", async () => {
      const { cookie, center } = await createCenterOwner("basic");
      const product = await createProduct("basic", 10, 1000);
      const quote = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 2 }]);
      const key = randomUUID();
      const body = { lines: [{ productId: product.id, quantity: 2 }], expectedTotalRsd: quote.payableTotalRsd };

      const first = await checkout(baseUrl, cookie, key, body);
      assert.equal(first.status, 201, "the first request must create the order");
      assert.equal(await stockOf(product.id), 8, "stock must be decremented exactly once");
      assert.equal(await orderCount(center.id), 1, "exactly one order must exist");

      const replay = await checkout(baseUrl, cookie, key, body);
      assert.equal(replay.status, 200, "a replay of the same key+payload must not be treated as a new creation");
      assert.deepEqual(replay.body, first.body, "a replay must return the exact original canonical result");
      assert.equal(await stockOf(product.id), 8, "a replay must not decrement stock again");
      assert.equal(await orderCount(center.id), 1, "a replay must not create a second order");
    });

    await test("the same key with a different payload returns 409 without touching stock or creating an order", async () => {
      const { cookie, center } = await createCenterOwner("mismatch");
      const product = await createProduct("mismatch", 10, 1000);
      const key = randomUUID();
      const quote1 = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 1 }]);
      const first = await checkout(baseUrl, cookie, key, { lines: [{ productId: product.id, quantity: 1 }], expectedTotalRsd: quote1.payableTotalRsd });
      assert.equal(first.status, 201);
      const stockAfterFirst = await stockOf(product.id);

      const quote2 = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 2 }]);
      const conflict = await checkout(baseUrl, cookie, key, { lines: [{ productId: product.id, quantity: 2 }], expectedTotalRsd: quote2.payableTotalRsd });
      assert.equal(conflict.status, 409, "reusing the key with a materially different payload must be an explicit conflict");
      assert.equal(await stockOf(product.id), stockAfterFirst, "a rejected mismatched replay must not touch stock");
      assert.equal(await orderCount(center.id), 1, "a rejected mismatched replay must not create an order");
    });

    await test("two concurrent requests with the same key and payload create exactly one order and decrement stock once", async () => {
      const { cookie, center } = await createCenterOwner("concurrent");
      const product = await createProduct("concurrent", 10, 1000);
      const quote = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 3 }]);
      const key = randomUUID();
      const body = { lines: [{ productId: product.id, quantity: 3 }], expectedTotalRsd: quote.payableTotalRsd };

      const [a, b] = await Promise.all([
        checkout(baseUrl, cookie, key, body),
        checkout(baseUrl, cookie, key, body),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      assert.deepEqual(statuses, [200, 201], "exactly one racing request must create the order (201) and the other must cleanly replay it (200), never both, never neither, never a 500");
      assert.equal(a.body.id, b.body.id, "both callers must observe the same canonical order id");
      assert.equal(await orderCount(center.id), 1, "the race must not create a duplicate order");
      assert.equal(await stockOf(product.id), 7, "the race must not decrement stock twice");
    });

    await test("different idempotency keys with the same payload create two separate legitimate orders", async () => {
      const { cookie, center } = await createCenterOwner("distinct-keys");
      const product = await createProduct("distinct-keys", 10, 1000);
      const quote = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 1 }]);
      const body = { lines: [{ productId: product.id, quantity: 1 }], expectedTotalRsd: quote.payableTotalRsd };

      const first = await checkout(baseUrl, cookie, randomUUID(), body);
      const second = await checkout(baseUrl, cookie, randomUUID(), body);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.notEqual(first.body.id, second.body.id, "two distinct keys must produce two distinct orders even with an identical payload");
      assert.equal(await orderCount(center.id), 2);
      assert.equal(await stockOf(product.id), 8);
    });

    await test("the same idempotency key reused by a different education center does not collide", async () => {
      const centerA = await createCenterOwner("tenant-a");
      const centerB = await createCenterOwner("tenant-b");
      const productA = await createProduct("tenant-a-product", 10, 1000);
      const productB = await createProduct("tenant-b-product", 10, 1000);
      const key = randomUUID();
      const quoteA = await quoteFor(baseUrl, centerA.cookie, [{ productId: productA.id, quantity: 1 }]);
      const quoteB = await quoteFor(baseUrl, centerB.cookie, [{ productId: productB.id, quantity: 1 }]);

      const resultA = await checkout(baseUrl, centerA.cookie, key, { lines: [{ productId: productA.id, quantity: 1 }], expectedTotalRsd: quoteA.payableTotalRsd });
      const resultB = await checkout(baseUrl, centerB.cookie, key, { lines: [{ productId: productB.id, quantity: 1 }], expectedTotalRsd: quoteB.payableTotalRsd });
      assert.equal(resultA.status, 201);
      assert.equal(resultB.status, 201, "a different center reusing the exact same key literal must get its own order, not a replay or a conflict");
      assert.notEqual(resultA.body.id, resultB.body.id);
      assert.equal(await orderCount(centerA.center.id), 1);
      assert.equal(await orderCount(centerB.center.id), 1);
    });

    await test("replay still returns the original result after the HTTP server process restarts", async () => {
      const { cookie, center } = await createCenterOwner("restart");
      const product = await createProduct("restart", 10, 1000);
      const quote = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 1 }]);
      const key = randomUUID();
      const body = { lines: [{ productId: product.id, quantity: 1 }], expectedTotalRsd: quote.payableTotalRsd };
      const first = await checkout(baseUrl, cookie, key, body);
      assert.equal(first.status, 201);

      await stopServer(server);
      const restarted = await startServer();
      server = restarted.server;
      baseUrl = restarted.baseUrl;

      const replay = await checkout(baseUrl, cookie, key, body);
      assert.equal(replay.status, 200, "the idempotency record is database-backed, so it must survive a process restart");
      assert.deepEqual(replay.body, first.body);
      assert.equal(await stockOf(product.id), 9, "the restart-surviving replay must still not double-decrement stock");
      assert.equal(await orderCount(center.id), 1);
    });

    await test("a failure before commit (insufficient stock) does not poison the idempotency key for a later retry", async () => {
      const { cookie, center } = await createCenterOwner("recover");
      const product = await createProduct("recover", 1, 1000);
      const key = randomUUID();
      const quoteTooMany = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 5 }]);
      const failed = await checkout(baseUrl, cookie, key, { lines: [{ productId: product.id, quantity: 5 }], expectedTotalRsd: quoteTooMany.payableTotalRsd });
      assert.equal(failed.status, 409, "insufficient stock must still be rejected");
      assert.equal(await orderCount(center.id), 0, "a failed attempt must not have created an order");
      assert.equal(await stockOf(product.id), 1, "a failed attempt must not have touched stock");

      const quoteOk = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 1 }]);
      const retried = await checkout(baseUrl, cookie, key, { lines: [{ productId: product.id, quantity: 1 }], expectedTotalRsd: quoteOk.payableTotalRsd });
      assert.equal(retried.status, 201, "retrying the same key with a satisfiable payload after a rolled-back failure must succeed normally, not be treated as a stale/poisoned key");
      assert.equal(await orderCount(center.id), 1);
      assert.equal(await stockOf(product.id), 0);
    });

    await test("a missing Idempotency-Key header is rejected with 400 and touches neither stock nor the order table", async () => {
      const { cookie, center } = await createCenterOwner("missing-key");
      const product = await createProduct("missing-key", 10, 1000);
      const quote = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 1 }]);
      const missing = await checkout(baseUrl, cookie, null, { lines: [{ productId: product.id, quantity: 1 }], expectedTotalRsd: quote.payableTotalRsd });
      assert.equal(missing.status, 400);
      assert.equal(await orderCount(center.id), 0);
      assert.equal(await stockOf(product.id), 10);
    });

    await test("concurrent checkouts with different keys competing for the same single unit of stock still only let one succeed", async () => {
      const { cookie, center } = await createCenterOwner("stock-race");
      const product = await createProduct("stock-race", 1, 1000);
      const quote = await quoteFor(baseUrl, cookie, [{ productId: product.id, quantity: 1 }]);
      const body = { lines: [{ productId: product.id, quantity: 1 }], expectedTotalRsd: quote.payableTotalRsd };
      const [a, b] = await Promise.all([
        checkout(baseUrl, cookie, randomUUID(), body),
        checkout(baseUrl, cookie, randomUUID(), body),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      assert.deepEqual(statuses, [201, 409], "with one unit of stock and two distinct keys, exactly one checkout must succeed and the other must be rejected for insufficient stock");
      assert.equal(await orderCount(center.id), 1);
      assert.equal(await stockOf(product.id), 0);
    });
  } finally {
    await stopServer(server);
    if (createdCenterIds.length) {
      const orders = await db.select({ id: educationB2bOrdersTable.id }).from(educationB2bOrdersTable)
        .where(inArray(educationB2bOrdersTable.centerId, createdCenterIds));
      if (orders.length) {
        await db.delete(educationB2bOrderItemsTable).where(inArray(educationB2bOrderItemsTable.orderId, orders.map((row) => row.id)));
      }
      await db.delete(educationB2bOrdersTable).where(inArray(educationB2bOrdersTable.centerId, createdCenterIds));
      await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, createdCenterIds));
    }
    if (createdProductIds.length) await db.delete(productsTable).where(inArray(productsTable.id, createdProductIds));
    if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
