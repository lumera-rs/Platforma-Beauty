import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import app from "../app";
import { observeDatabaseQueries, pool, type DatabaseQueryObservation } from "@workspace/db";
import { createSession, sessionCookieName } from "../lib/auth";
import { selectPopularPublicCourses } from "../lib/education-public-course-order";

async function countedRequest(url: string, init?: RequestInit) {
  const queries: DatabaseQueryObservation[] = [];
  const stopObserving = observeDatabaseQueries((query) => queries.push(query));
  try {
    const response = await fetch(url, init);
    const body = await response.text();
    return { response, body, queries };
  } finally {
    stopObserving();
  }
}

test("popular education ordering uses only paid featured placements before slicing", () => {
  const courses = [
    { id: "highest-rating", rating: 50, createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "paid-featured", rating: 40, createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "unpaid-newest", rating: 40, createdAt: new Date("2026-03-01T00:00:00.000Z") },
    { id: "ordinary-older", rating: 40, createdAt: new Date("2026-02-01T00:00:00.000Z") },
  ];
  const ordered = selectPopularPublicCourses(
    courses,
    new Map([
      ["paid-featured", true],
      ["unpaid-newest", false],
    ]),
    3,
  );
  assert.deepEqual(
    ordered.map((course) => course.id),
    ["highest-rating", "paid-featured", "unpaid-newest"],
  );
});

test("optimized marketplace lists stay within fixed SQL query budgets", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const fixtureMarker = `retail-query-budget-${randomUUID()}`;
  let customerId: string | undefined;

  try {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@lumera.local",
        password: process.env.LUMERA_DEMO_PASSWORD ?? "LumeraDemo2026!",
      }),
    });
    assert.equal(login.status, 200, "demo super-admin login must succeed");
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "login must set a session cookie");

    const smallOrders = await countedRequest(`${baseUrl}/admin/orders?page=1&pageSize=1`, {
      headers: { cookie },
    });
    const largeOrders = await countedRequest(`${baseUrl}/admin/orders?page=1&pageSize=50`, {
      headers: { cookie },
    });
    assert.equal(smallOrders.response.status, 200);
    assert.equal(largeOrders.response.status, 200);
    assert.ok(smallOrders.queries.length <= 10, `admin orders used ${smallOrders.queries.length} SQL queries`);
    assert.ok(largeOrders.queries.length <= 10, `admin orders used ${largeOrders.queries.length} SQL queries`);
    assert.ok(
      largeOrders.queries.length <= smallOrders.queries.length + 1,
      `admin order query count grew with page size (${smallOrders.queries.length} -> ${largeOrders.queries.length})`,
    );

    const productResult = await pool.query<{ id: string; catalog_reference: string }>(
      "SELECT id, catalog_reference FROM products ORDER BY id LIMIT 1",
    );
    assert.ok(productResult.rows[0], "retail query budget fixture requires a product");
    await pool.query(
      `WITH fixture_carts AS (
         INSERT INTO retail_carts (token_hash)
         SELECT $1 || '-cart-' || series_number
         FROM generate_series(1, 100) AS series(series_number)
         RETURNING id, token_hash
       ),
       fixture_orders AS (
         INSERT INTO retail_orders (
           order_number, cart_id, tracking_token_hash, idempotency_key,
           status, payment_method, payment_status, delivery_method,
           subtotal, shipping_cost, total,
           shipping_name, shipping_address, shipping_city, shipping_postal_code,
           shipping_phone, shipping_email, shipping_note
         )
         SELECT $1 || '-order-' || series_number, carts.id,
                $1 || '-tracking-' || series_number, $1 || '-idempotency-' || series_number,
                'pending', 'BANK_TRANSFER', 'unpaid', 'courier',
                100, 0, 100,
                'Query budget fixture', 'Test ulica 1', 'Novi Sad', '21000',
                '+381601234567', $1 || '-' || series_number || '@example.test', NULL
         FROM generate_series(1, 100) AS series(series_number)
         INNER JOIN fixture_carts AS carts
           ON carts.token_hash = $1 || '-cart-' || series_number
         RETURNING id, order_number
       )
       INSERT INTO retail_order_items (
         order_id, product_id, product_name, product_image_url,
         product_catalog_reference, variant_value, variant_label, unit_price, quantity
       )
       SELECT orders.id, $2::uuid, 'Query budget product', '/query-budget.jpg',
              NULL, NULL, NULL, 100, 1
       FROM fixture_orders AS orders`,
      [fixtureMarker, productResult.rows[0].id],
    );

    const retailOrders = await countedRequest(
      `${baseUrl}/admin/retail-orders?search=${encodeURIComponent(fixtureMarker)}`,
      { headers: { cookie } },
    );
    assert.equal(retailOrders.response.status, 200);
    const retailOrderResults = JSON.parse(retailOrders.body) as Array<{ items: Array<{ sku: string }> }>;
    assert.equal(retailOrderResults.length, 100, "retail fixture search must return all 100 orders");
    assert.ok(retailOrderResults.every((order) => order.items[0]?.sku), "retail items must retain fallback catalog references");
    assert.ok(
      retailOrders.queries.length <= 6,
      `retail order search used ${retailOrders.queries.length} SQL queries for 100 orders`,
    );

    const customerResult = await pool.query<{ id: string }>(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ('Query budget', 'Customer', $1, 'query-budget-fixture-password', 'CUSTOMER')
       RETURNING id`,
      [`${fixtureMarker}-customer@example.test`],
    );
    customerId = customerResult.rows[0]?.id;
    assert.ok(customerId, "retail query budget fixture customer must be created");
    const customerCookie = `${sessionCookieName}=${await createSession(customerId)}`;

    await pool.query(
      `WITH fixture_carts AS (
         INSERT INTO retail_carts (token_hash)
         SELECT $1 || '-customer-cart-' || series_number
         FROM generate_series(1, 100) AS series(series_number)
         RETURNING id, token_hash
       ),
       fixture_orders AS (
         INSERT INTO retail_orders (
           order_number, cart_id, user_id, tracking_token_hash, idempotency_key,
           status, payment_method, payment_status, delivery_method,
           subtotal, shipping_cost, total,
           shipping_name, shipping_address, shipping_city, shipping_postal_code,
           shipping_phone, shipping_email, shipping_note
         )
         SELECT $1 || '-customer-order-' || series_number, carts.id, $3::uuid,
                $1 || '-customer-tracking-' || series_number, $1 || '-customer-idempotency-' || series_number,
                'pending', 'BANK_TRANSFER', 'unpaid', 'courier',
                100, 0, 100,
                'Saved Customer Snapshot', 'Customer ulica 1', 'Novi Sad', '21000',
                '+381601234567', $1 || '-customer-' || series_number || '@example.test', NULL
         FROM generate_series(1, 100) AS series(series_number)
         INNER JOIN fixture_carts AS carts
           ON carts.token_hash = $1 || '-customer-cart-' || series_number
         RETURNING id, order_number
       )
       INSERT INTO retail_order_items (
         order_id, product_id, product_name, product_image_url,
         product_catalog_reference, variant_value, variant_label, unit_price, quantity
       )
       SELECT orders.id, $2::uuid, 'Saved Customer Snapshot', '/customer-query-budget.jpg',
              CASE WHEN series_number % 2 = 0 THEN $1 || '-snapshot-' || series_number ELSE NULL END,
              NULL, NULL, 100, 1
       FROM fixture_orders AS orders
       CROSS JOIN LATERAL (
         SELECT substring(orders.order_number from '[0-9]+$')::integer AS series_number
       ) AS series`,
      [fixtureMarker, productResult.rows[0].id, customerId],
    );

    const customerOrders = await countedRequest(`${baseUrl}/customer/retail-orders`, {
      headers: { cookie: customerCookie },
    });
    assert.equal(customerOrders.response.status, 200);
    const customerOrderResults = JSON.parse(customerOrders.body) as Array<{
      orderNumber: string;
      items: Array<{ sku: string; name: string; imageUrl: string }>;
    }>;
    assert.equal(customerOrderResults.length, 100, "customer fixture must return all 100 saved orders");
    assert.ok(
      customerOrderResults.every((order) =>
        order.items.length === 1
        && order.items[0]?.name === "Saved Customer Snapshot"
        && order.items[0]?.imageUrl === "/customer-query-budget.jpg"),
      "customer order history must preserve item snapshots",
    );
    const savedReferenceOrder = customerOrderResults.find(
      (order) => order.orderNumber === `${fixtureMarker}-customer-order-100`,
    );
    const fallbackReferenceOrder = customerOrderResults.find(
      (order) => order.orderNumber === `${fixtureMarker}-customer-order-99`,
    );
    assert.equal(savedReferenceOrder?.items[0]?.sku, `${fixtureMarker}-snapshot-100`);
    assert.equal(fallbackReferenceOrder?.items[0]?.sku, productResult.rows[0].catalog_reference);
    assert.ok(
      customerOrders.queries.length <= 6,
      `customer order history used ${customerOrders.queries.length} SQL queries for 100 orders`,
    );

    const smallCourses = await countedRequest(`${baseUrl}/education/public/courses?page=1&pageSize=1`);
    const largeCourses = await countedRequest(`${baseUrl}/education/public/courses?page=1&pageSize=24`);
    assert.equal(smallCourses.response.status, 200);
    assert.equal(largeCourses.response.status, 200);
    assert.ok(smallCourses.queries.length <= 16, `public education courses used ${smallCourses.queries.length} SQL queries`);
    assert.ok(largeCourses.queries.length <= 16, `public education courses used ${largeCourses.queries.length} SQL queries`);
    assert.ok(
      largeCourses.queries.length <= smallCourses.queries.length + 1,
      `education query count grew with page size (${smallCourses.queries.length} -> ${largeCourses.queries.length})`,
    );

    const categorySalons = await countedRequest(`${baseUrl}/salons?category=Frizerski%20saloni&page=1&pageSize=6`);
    assert.equal(categorySalons.response.status, 200, "public category filtering must support JSONB service tags");
    assert.ok(
      !categorySalons.queries.some((query) => query.sql.includes("generate_series")),
      "ordinary salon browsing must not evaluate the rolling availability expression",
    );

    const firstAvailableSalons = await countedRequest(`${baseUrl}/salons?sort=first-available&page=1&pageSize=6`);
    assert.equal(firstAvailableSalons.response.status, 200, "first-available salon sorting must remain available");
    assert.ok(
      firstAvailableSalons.queries.some((query) => query.sql.includes("generate_series")),
      "first-available sorting must retain its canonical availability expression",
    );
  } finally {
    await pool.query(
      "DELETE FROM retail_orders WHERE order_number LIKE $1 OR order_number LIKE $2",
      [`${fixtureMarker}-order-%`, `${fixtureMarker}-customer-order-%`],
    );
    await pool.query(
      "DELETE FROM retail_carts WHERE token_hash LIKE $1 OR token_hash LIKE $2",
      [`${fixtureMarker}-cart-%`, `${fixtureMarker}-customer-cart-%`],
    );
    if (customerId) await pool.query("DELETE FROM users WHERE id = $1", [customerId]);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await pool.end();
  }
});