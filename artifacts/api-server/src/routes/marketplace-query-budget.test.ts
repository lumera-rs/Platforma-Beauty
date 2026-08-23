import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import app from "../app";
import { observeDatabaseQueries, pool, type DatabaseQueryObservation } from "@workspace/db";
import { selectPopularPublicCourses } from "../lib/education-public-course-order";

async function countedRequest(url: string, init?: RequestInit) {
  const queries: DatabaseQueryObservation[] = [];
  const stopObserving = observeDatabaseQueries((query) => queries.push(query));
  try {
    const response = await fetch(url, init);
    await response.arrayBuffer();
    return { response, queries };
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await pool.end();
  }
});