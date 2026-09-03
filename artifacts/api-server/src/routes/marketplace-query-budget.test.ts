import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import app from "../app";
import {
  databaseQueryObservationHeader,
  db,
  isDatabaseQueryObservationRuntimeAllowed,
  observeDatabaseQueries,
  pool,
  runWithDatabaseQueryObservation,
  type DatabaseQueryObservation,
} from "@workspace/db";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { createSession, sessionCookieName } from "../lib/auth";
import { selectPopularPublicCourses } from "../lib/education-public-course-order";

assertDestructiveTestRuntimeAllowed(process.env, "Marketplace query budget tests");

test("database query observation runtime guard allows only explicit non-production runtimes", () => {
  assert.equal(isDatabaseQueryObservationRuntimeAllowed({ NODE_ENV: "test" }), true);
  assert.equal(
    isDatabaseQueryObservationRuntimeAllowed({
      NODE_ENV: "development",
      DATABASE_QUERY_OBSERVATION_ENABLED: "1",
    }),
    true,
  );
  assert.equal(isDatabaseQueryObservationRuntimeAllowed({ NODE_ENV: "development" }), false);
  assert.equal(
    isDatabaseQueryObservationRuntimeAllowed({
      NODE_ENV: "production",
      DATABASE_QUERY_OBSERVATION_ENABLED: "1",
    }),
    false,
  );
  assert.equal(
    isDatabaseQueryObservationRuntimeAllowed({
      NODE_ENV: "test",
      REPLIT_DEPLOYMENT: "1",
      DATABASE_QUERY_OBSERVATION_ENABLED: "1",
    }),
    false,
  );
  assert.equal(
    isDatabaseQueryObservationRuntimeAllowed({
      NODE_ENV: "test",
      REPL_DEPLOYMENT: "1",
    }),
    false,
  );
});

async function countedRequest(url: string, init?: RequestInit) {
  const queries: DatabaseQueryObservation[] = [];
  return observeDatabaseQueries((query) => queries.push(query), async (captureId) => {
    const headers = new Headers(init?.headers);
    headers.set(databaseQueryObservationHeader, captureId);
    const response = await fetch(url, { ...init, headers });
    const body = await response.text();
    return { response, body, queries };
  });
}

test("parallel SQL capture sessions observe only their own async context", async () => {
  const markers = [randomUUID(), randomUUID()];
  const capturedParams = await Promise.all(markers.map(async (marker) => {
    const params: unknown[][] = [];
    await observeDatabaseQueries(
      (query) => params.push(query.params),
      async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await db.execute(sql`select ${marker}::text as observation_marker`);
      },
    );
    return params;
  }));

  for (const [index, marker] of markers.entries()) {
    assert.ok(
      capturedParams[index]!.some((params) => params.includes(marker)),
      "each capture session must observe its own query",
    );
    assert.ok(
      capturedParams[index]!.every((params) => !params.includes(markers[1 - index])),
      "parallel capture sessions must not observe each other's queries",
    );
  }
});

test("failed nested SQL captures unregister stale IDs without disturbing the outer capture", async () => {
  const failingMarker = randomUUID();
  const staleInnerMarker = randomUUID();
  const outerContinuationMarker = randomUUID();
  const staleOuterMarker = randomUUID();
  const outerParams: unknown[][] = [];
  let outerCaptureId: string | undefined;
  let innerCaptureId: string | undefined;
  let innerObserverCalls = 0;

  await observeDatabaseQueries(
    (query) => outerParams.push(query.params),
    async (captureId) => {
      outerCaptureId = captureId;

      await assert.rejects(
        observeDatabaseQueries(
          () => {
            innerObserverCalls += 1;
            throw new Error("intentional observer failure");
          },
          async (nestedCaptureId) => {
            innerCaptureId = nestedCaptureId;
            await db.execute(sql`select ${failingMarker}::text as observation_marker`);
          },
        ),
        /intentional observer failure/,
      );

      assert.equal(innerObserverCalls, 1);
      assert.ok(innerCaptureId);
      await runWithDatabaseQueryObservation(innerCaptureId, () =>
        db.execute(sql`select ${staleInnerMarker}::text as observation_marker`),
      );
      await db.execute(sql`select ${outerContinuationMarker}::text as observation_marker`);
    },
  );

  assert.ok(
    outerParams.some((params) => params.includes(failingMarker)),
    "the outer capture must observe the query that failed the nested observer",
  );
  assert.ok(
    outerParams.some((params) => params.includes(staleInnerMarker)),
    "the outer capture must remain active after nested cleanup",
  );
  assert.ok(
    outerParams.some((params) => params.includes(outerContinuationMarker)),
    "the outer capture must continue observing later queries",
  );

  const capturedCountAfterOuterCleanup = outerParams.length;
  assert.ok(outerCaptureId);
  await runWithDatabaseQueryObservation(outerCaptureId, () =>
    db.execute(sql`select ${staleOuterMarker}::text as observation_marker`),
  );
  assert.equal(
    outerParams.length,
    capturedCountAfterOuterCleanup,
    "a later request must not reactivate a completed capture ID",
  );
});

test("pre-SQL capture rejection unregisters its ID without disturbing the outer capture", async () => {
  const staleInnerMarker = randomUUID();
  const outerContinuationMarker = randomUUID();
  const outerParams: unknown[][] = [];
  const innerParams: unknown[][] = [];
  let innerCaptureId: string | undefined;

  await observeDatabaseQueries(
    (query) => outerParams.push(query.params),
    async () => {
      await assert.rejects(
        observeDatabaseQueries(
          (query) => innerParams.push(query.params),
          async (captureId) => {
            innerCaptureId = captureId;
            throw new Error("intentional pre-SQL failure");
          },
        ),
        /intentional pre-SQL failure/,
      );

      assert.ok(innerCaptureId);
      await runWithDatabaseQueryObservation(innerCaptureId, () =>
        db.execute(sql`select ${staleInnerMarker}::text as observation_marker`),
      );
      await db.execute(sql`select ${outerContinuationMarker}::text as observation_marker`);
    },
  );

  assert.deepEqual(
    innerParams,
    [],
    "a rejected capture ID must not observe a later direct request",
  );
  assert.ok(
    outerParams.some((params) => params.includes(staleInnerMarker)),
    "the enclosing capture must remain active while a stale nested ID is ignored",
  );
  assert.ok(
    outerParams.some((params) => params.includes(outerContinuationMarker)),
    "the enclosing capture must continue observing after the nested rejection",
  );
});

test("HTTP query observation headers cannot activate captures in production", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const previousNodeEnv = process.env.NODE_ENV;
  const observedQueries: DatabaseQueryObservation[] = [];

  try {
    await observeDatabaseQueries(
      (query) => observedQueries.push(query),
      async (captureId) => {
        process.env.NODE_ENV = "production";
        const response = await fetch(
          `http://127.0.0.1:${port}/api/salons?page=1&pageSize=1`,
          { headers: { [databaseQueryObservationHeader]: captureId } },
        );
        assert.equal(response.status, 200);
        await response.arrayBuffer();
      },
    );
    assert.deepEqual(
      observedQueries,
      [],
      "production HTTP requests must ignore registered observation capture IDs",
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("HTTP query observation ignores a rejected capture ID and preserves an enclosing capture", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/salons?page=1&pageSize=1`;
  const outerQueries: DatabaseQueryObservation[] = [];
  const rejectedQueries: DatabaseQueryObservation[] = [];
  let rejectedCaptureId: string | undefined;

  try {
    await observeDatabaseQueries(
      (query) => outerQueries.push(query),
      async (outerCaptureId) => {
        await assert.rejects(
          observeDatabaseQueries(
            (query) => rejectedQueries.push(query),
            async (captureId) => {
              rejectedCaptureId = captureId;
              throw new Error("intentional pre-SQL HTTP capture failure");
            },
          ),
          /intentional pre-SQL HTTP capture failure/,
        );

        assert.ok(rejectedCaptureId);
        const staleResponse = await fetch(url, {
          headers: { [databaseQueryObservationHeader]: rejectedCaptureId },
        });
        assert.equal(staleResponse.status, 200);
        await staleResponse.arrayBuffer();
        assert.deepEqual(
          rejectedQueries,
          [],
          "a later HTTP request must not invoke the rejected capture observer",
        );
        assert.deepEqual(
          outerQueries,
          [],
          "the stale capture header must not leak into the enclosing capture",
        );

        const outerResponse = await fetch(url, {
          headers: { [databaseQueryObservationHeader]: outerCaptureId },
        });
        assert.equal(outerResponse.status, 200);
        await outerResponse.arrayBuffer();
        assert.ok(
          outerQueries.length > 0,
          "the enclosing capture must continue observing its own HTTP request",
        );
        assert.deepEqual(
          rejectedQueries,
          [],
          "the rejected observer must remain unregistered during later HTTP requests",
        );
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

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
  let availabilityOwnerId: string | undefined;
  let availabilitySalonId: string | undefined;

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

    const [parallelSalons, parallelCourses] = await Promise.all([
      countedRequest(`${baseUrl}/salons?page=1&pageSize=1`),
      countedRequest(`${baseUrl}/education/public/courses?page=1&pageSize=1`),
    ]);
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

    const productResult = await pool.query<{
      id: string;
      catalog_reference: string;
      supplier_id: string;
      supplier_name: string;
      supplier_slug: string;
      sku: string | null;
    }>(
      `SELECT product.id, product.catalog_reference, product.supplier_id,
              supplier.name AS supplier_name, supplier.slug AS supplier_slug, product.sku
       FROM products AS product
       INNER JOIN suppliers AS supplier ON supplier.id = product.supplier_id
       ORDER BY product.id LIMIT 1`,
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
         product_catalog_reference, variant_value, variant_label, unit_price, quantity,
         supplier_id, supplier_name, supplier_slug, product_sku_snapshot,
         line_subtotal, line_total
       )
       SELECT orders.id, $2::uuid, 'Query budget product', '/query-budget.jpg',
              $3, NULL, NULL, 100, 1,
              $4::uuid, $5, $6, $7, 100, 100
       FROM fixture_orders AS orders`,
      [
        fixtureMarker,
        productResult.rows[0].id,
        productResult.rows[0].catalog_reference,
        productResult.rows[0].supplier_id,
        productResult.rows[0].supplier_name,
        productResult.rows[0].supplier_slug,
        productResult.rows[0].sku,
      ],
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
         product_catalog_reference, variant_value, variant_label, unit_price, quantity,
         supplier_id, supplier_name, supplier_slug, product_sku_snapshot,
         line_subtotal, line_total
       )
       SELECT orders.id, $2::uuid, 'Saved Customer Snapshot', '/customer-query-budget.jpg',
              CASE WHEN series_number % 2 = 0 THEN $1 || '-snapshot-' || series_number ELSE $4 END,
              NULL, NULL, 100, 1,
              $5::uuid, $6, $7, $8, 100, 100
       FROM fixture_orders AS orders
       CROSS JOIN LATERAL (
         SELECT substring(orders.order_number from '[0-9]+$')::integer AS series_number
       ) AS series`,
      [
        fixtureMarker,
        productResult.rows[0].id,
        customerId,
        productResult.rows[0].catalog_reference,
        productResult.rows[0].supplier_id,
        productResult.rows[0].supplier_name,
        productResult.rows[0].supplier_slug,
        productResult.rows[0].sku,
      ],
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
    assert.ok(smallCourses.queries.length <= 17, `public education courses used ${smallCourses.queries.length} SQL queries`);
    assert.ok(largeCourses.queries.length <= 17, `public education courses used ${largeCourses.queries.length} SQL queries`);
    assert.ok(
      largeCourses.queries.length <= smallCourses.queries.length + 2,
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

    const availabilityOwner = await pool.query<{ id: string }>(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ('Query budget', 'Owner', $1, 'query-budget-fixture-password', 'SALON_OWNER')
       RETURNING id`,
      [`${fixtureMarker}-owner@example.test`],
    );
    availabilityOwnerId = availabilityOwner.rows[0]?.id;
    assert.ok(availabilityOwnerId, "availability query budget owner must be created");
    const availabilitySalon = await pool.query<{ id: string }>(
      `INSERT INTO salons (
         owner_id, name, slug, city, municipality, address, phone, email,
         short_description, description, image_url, active
       )
       VALUES ($1, 'Availability query budget', $2, 'Novi Sad', 'Centar',
               'Query budget 1', '+381601111111', $3, 'Fixture', 'Fixture',
               '/query-budget.jpg', true)
       RETURNING id`,
      [
        availabilityOwnerId,
        `${fixtureMarker}-salon`,
        `${fixtureMarker}-salon@example.test`,
      ],
    );
    availabilitySalonId = availabilitySalon.rows[0]?.id;
    assert.ok(availabilitySalonId, "availability query budget salon must be created");
    const availabilityService = await pool.query<{ id: string }>(
      `INSERT INTO services (
         salon_id, category_name, name, description, duration_minutes, price,
         image_url, active
       )
       VALUES ($1, 'Query budget', 'Canonical service', 'Fixture', 60, 1000,
               '/query-budget-service.jpg', true)
       RETURNING id`,
      [availabilitySalonId],
    );
    const availabilityServiceId = availabilityService.rows[0]?.id;
    assert.ok(availabilityServiceId, "availability query budget service must be created");
    await pool.query(
      `INSERT INTO salon_hours (salon_id, weekday, open_time, close_time, closed)
       SELECT $1, weekday, '09:00', '18:00', false
       FROM generate_series(1, 7) AS weekdays(weekday)`,
      [availabilitySalonId],
    );
    const firstEmployee = await pool.query<{ id: string }>(
      `WITH employee AS (
         INSERT INTO employees (salon_id, name, role, bio, avatar_url, active)
         VALUES ($1, 'Employee 01', 'Stylist', 'Fixture', '/employee.jpg', true)
         RETURNING id
       ), link AS (
         INSERT INTO employee_services (employee_id, service_id)
         SELECT id, $2 FROM employee
       )
       SELECT id FROM employee`,
      [availabilitySalonId, availabilityServiceId],
    );
    const firstEmployeeId = firstEmployee.rows[0]?.id;
    assert.ok(firstEmployeeId, "availability query budget employee must be created");
    await pool.query(
      `WITH assignment AS (
         INSERT INTO employee_location_assignments (employee_id, salon_id, active, is_default)
         VALUES ($1, $2, true, true)
       )
       INSERT INTO employee_location_schedules (employee_id, salon_id, weekday, start_time, end_time)
       SELECT $1, $2, weekday, '09:00', '18:00'
       FROM generate_series(1, 7) AS weekdays(weekday)`,
      [firstEmployeeId, availabilitySalonId],
    );
    const resource = await pool.query<{ id: string }>(
      `INSERT INTO salon_resources (salon_id, name, type, capacity)
       VALUES ($1, 'Shared room', 'room', 40)
       RETURNING id`,
      [availabilitySalonId],
    );
    const resourceId = resource.rows[0]?.id;
    assert.ok(resourceId, "availability query budget resource must be created");
    await pool.query(
      `INSERT INTO service_resource_requirements (service_id, resource_id, quantity)
       VALUES ($1, $2, 1)`,
      [availabilityServiceId, resourceId],
    );
    const firstAppointment = await pool.query<{ id: string }>(
      `INSERT INTO appointments (
         salon_id, employee_id, service_id, appointment_date, start_time,
         end_time, duration_minutes, price, status
       )
       VALUES ($1, $2, $3, '2099-12-14', '17:00', '18:00', 60, 1000, 'confirmed')
       RETURNING id`,
      [availabilitySalonId, firstEmployeeId, availabilityServiceId],
    );
    await pool.query(
      `INSERT INTO appointment_resource_allocations (appointment_id, resource_id, quantity)
       VALUES ($1, $2, 1)`,
      [firstAppointment.rows[0]!.id, resourceId],
    );
    const ownerCookie = `${sessionCookieName}=${await createSession(availabilityOwnerId)}`;
    const searchPath = `/salon/availability/search?serviceId=${availabilityServiceId}&startDate=2099-12-14&limit=50`;
    const smallAvailability = await countedRequest(`${baseUrl}${searchPath}`, {
      headers: { cookie: ownerCookie },
    });
    assert.equal(smallAvailability.response.status, 200);
    const completeAvailability = await countedRequest(
      `${baseUrl}/salon/availability/search?serviceId=${availabilityServiceId}&startDate=2099-12-14`,
      { headers: { cookie: ownerCookie } },
    );
    assert.equal(completeAvailability.response.status, 200);
    const completeSlots = JSON.parse(completeAvailability.body) as Array<{ date: string }>;
    assert.ok(completeSlots.length > 50, "an omitted owner-search limit must not truncate later days");
    assert.ok(completeSlots.some((slot) => slot.date === "2099-12-20"), "an omitted owner-search limit retains the seventh calendar day");

    await pool.query(
      `WITH new_employees AS (
         INSERT INTO employees (salon_id, name, role, bio, avatar_url, active)
         SELECT $1, 'Employee ' || lpad(series_number::text, 2, '0'),
                'Stylist', 'Fixture', '/employee.jpg', true
         FROM generate_series(2, 40) AS series(series_number)
         RETURNING id
        ), assignments AS (
          INSERT INTO employee_location_assignments (employee_id, salon_id, active, is_default)
          SELECT id, $1, true, true FROM new_employees
        ), links AS (
         INSERT INTO employee_services (employee_id, service_id)
         SELECT id, $2 FROM new_employees
       )
        INSERT INTO employee_location_schedules (employee_id, salon_id, weekday, start_time, end_time)
        SELECT employees.id, $1, weekdays.weekday, '09:00', '18:00'
       FROM new_employees AS employees
       CROSS JOIN generate_series(1, 7) AS weekdays(weekday)`,
      [availabilitySalonId, availabilityServiceId],
    );
    await pool.query(
      `INSERT INTO employee_time_off (employee_id, start_date, end_date, start_time, end_time, reason)
       SELECT id, '2099-12-14', '2099-12-14', '12:00', '13:00', 'Fixture block'
       FROM employees
       WHERE salon_id = $1 AND name <> 'Employee 01'`,
      [availabilitySalonId],
    );
    await pool.query(
      `WITH fixture_appointments AS (
         INSERT INTO appointments (
           salon_id, employee_id, service_id, appointment_date, start_time,
           end_time, duration_minutes, price, status
         )
         SELECT $1, id, $2, '2099-12-14', '17:00', '18:00', 60, 1000, 'confirmed'
         FROM employees
          WHERE salon_id = $1 AND id <> $4
         RETURNING id
       )
       INSERT INTO appointment_resource_allocations (appointment_id, resource_id, quantity)
       SELECT id, $3, 1 FROM fixture_appointments`,
      [availabilitySalonId, availabilityServiceId, resourceId, firstEmployeeId],
    );

    const largeAvailability = await countedRequest(`${baseUrl}${searchPath}`, {
      headers: { cookie: ownerCookie },
    });
    assert.equal(largeAvailability.response.status, 200);
    const largeAvailabilitySlots = JSON.parse(largeAvailability.body) as Array<{
      date: string;
      startTime: string;
      employeeId: string;
    }>;
    assert.ok(largeAvailabilitySlots.length > 0, "large availability fixture must retain available slots");
    assert.ok(
      largeAvailability.queries.length <= 17,
      `seven-day availability search used ${largeAvailability.queries.length} SQL queries for 40 employees`,
    );
    assert.ok(
      largeAvailability.queries.length <= smallAvailability.queries.length,
      `availability query count grew with candidate count (${smallAvailability.queries.length} -> ${largeAvailability.queries.length})`,
    );

    const selectedSearch = await countedRequest(
      `${baseUrl}/salon/availability/search?serviceId=${availabilityServiceId}&employeeId=${firstEmployeeId}&startDate=2099-12-14&limit=14`,
      { headers: { cookie: ownerCookie } },
    );
    const publicAvailability = await fetch(
      `${baseUrl}/salons/${availabilitySalonId}/availability?serviceId=${availabilityServiceId}&employeeId=${firstEmployeeId}&date=2099-12-14`,
    );
    assert.equal(selectedSearch.response.status, 200);
    assert.equal(publicAvailability.status, 200);
    const selectedSlots = JSON.parse(selectedSearch.body) as Array<{ date: string; startTime: string }>;
    const publicSlots = await publicAvailability.json() as Array<{ start: string }>;
    assert.deepEqual(
      selectedSlots.filter((slot) => slot.date === "2099-12-14").map((slot) => slot.startTime),
      publicSlots.map((slot) => slot.start),
      "batched owner search must preserve the public canonical availability result",
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
    if (availabilitySalonId) await pool.query("DELETE FROM salons WHERE id = $1", [availabilitySalonId]);
    if (availabilityOwnerId) await pool.query("DELETE FROM users WHERE id = $1", [availabilityOwnerId]);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await pool.end();
  }
});
