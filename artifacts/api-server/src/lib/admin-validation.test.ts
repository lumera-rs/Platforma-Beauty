import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

type InvalidCase = {
  name: string;
  method: "POST" | "PATCH" | "PUT";
  path: string;
  body: unknown;
  expectedStatus?: number;
};

const invalidCases: InvalidCase[] = [
  {
    name: "category rejects an empty numeric string",
    method: "POST",
    path: "/admin/product-categories",
    body: { name: "Test", sortOrder: "" },
  },
  {
    name: "category rejects whitespace numeric input",
    method: "POST",
    path: "/admin/product-categories",
    body: { name: "Test", sortOrder: " " },
  },
  {
    name: "category rejects negative order",
    method: "POST",
    path: "/admin/product-categories",
    body: { name: "Test", sortOrder: -1 },
  },
  {
    name: "category rejects textual order",
    method: "POST",
    path: "/admin/product-categories",
    body: { name: "Test", sortOrder: "nije-broj" },
  },
  {
    name: "category rejects non-finite JSON representation",
    method: "POST",
    path: "/admin/product-categories",
    body: { name: "Test", sortOrder: null },
  },
  {
    name: "category rejects an unknown field",
    method: "POST",
    path: "/admin/product-categories",
    body: { name: "Test", sortOrder: 1, systemRole: "SUPER_ADMIN" },
  },
  {
    name: "product rejects a textual price",
    method: "POST",
    path: "/admin/products",
    body: {
      name: "Neispravan proizvod",
      categoryId: null,
      categoryName: "Test",
      description: "Test",
      imageUrl: "/test.jpg",
      price: "besplatno",
      stock: 1,
      sku: `INVALID-${randomUUID()}`,
      unit: "kom",
      weightGrams: 100,
    },
  },
  {
    name: "loyalty rejects a percent above one hundred",
    method: "POST",
    path: "/admin/loyalty-tiers",
    body: {
      name: "Neispravan nivo",
      sortOrder: 1,
      spendThreshold: 0,
      period: "monthly",
      subscriptionDiscountPercent: 101,
      productDiscountPercent: 0,
      freeSubscription: false,
      premiumListing: false,
      freeShipping: false,
      benefits: [],
      active: true,
    },
  },
  {
    name: "subscription rejects a negative trial",
    method: "POST",
    path: "/admin/subscription-plans",
    body: {
      name: "Neispravan paket",
      price: 1000,
      trialDays: -1,
      features: [],
      limits: {},
      active: true,
    },
  },
  {
    name: "shipping rejects duplicate weight thresholds",
    method: "PUT",
    path: "/admin/shipping",
    body: {
      freeShippingThreshold: 5000,
      tiers: [
        { maxWeightGrams: 1000, price: 400, label: "Do 1 kg" },
        { maxWeightGrams: 1000, price: 500, label: "Ponovljeno" },
      ],
      personalDeliveryEnabled: false,
      personalDeliveryName: "Lična dostava",
      personalDeliveryPrice: 0,
      personalDeliveryDescription: "",
    },
  },
  {
    name: "service template rejects inverted price range",
    method: "POST",
    path: "/admin/service-templates",
    body: {
      name: "Neispravan šablon",
      mainCategory: "Test",
      subcategory: "Test",
      typicalDurationMinutes: 30,
      priceMin: 2000,
      priceMax: 1000,
      description: null,
      active: true,
    },
  },
  {
    name: "education settings reject a non-integer percent",
    method: "PATCH",
    path: "/admin/education/settings",
    body: {
      commissionPercent: 10.5,
      reservePercent: 10,
      onlineRefundDays: 14,
      liveAppealDays: 7,
      featuredCoursePrice: 0,
    },
  },
];

async function run(): Promise<void> {
  const suffix = randomUUID();
  const passwordHash = await hashPassword(`admin-validation-${suffix}`);
  const [admin] = await db.insert(usersTable).values({
    firstName: "Validation",
    lastName: "Admin",
    email: `admin-validation-${suffix}@example.test`,
    passwordHash,
    passwordSetAt: new Date(),
    role: "SUPER_ADMIN",
  }).returning();
  assert.ok(admin);

  const token = await createSession(admin.id);
  const cookie = `${sessionCookieName}=${token}`;
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    for (const testCase of invalidCases) {
      const response = await fetch(`${baseUrl}${testCase.path}`, {
        method: testCase.method,
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(testCase.body),
      });
      const responseBody = await response.json() as { error?: unknown; code?: unknown };
      assert.equal(
        response.status,
        testCase.expectedStatus ?? 400,
        `${testCase.name}: ${JSON.stringify(responseBody)}`,
      );
      assert.equal(typeof responseBody.error, "string", `${testCase.name}: missing user-facing error`);
      assert.equal(typeof responseBody.code, "string", `${testCase.name}: missing structured error code`);
      assert.notEqual(response.status, 500, `${testCase.name}: expected input must never become 500`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});