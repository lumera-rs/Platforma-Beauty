import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, salonsTable, subscriptionsTable, subscriptionPlansTable, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

// Regression coverage for stable DB pagination of admin list endpoints (Task 131).
// - A matching row beyond the first page is reachable via page/pageSize.
// - subscriptionStatus is applied in SQL BEFORE pagination, so an older matching
//   salon is never omitted just because newer non-matching salons pushed it past
//   the first page.

type SalonRow = { id: string; name: string; subscriptionStatus: string | null };

async function run(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const createdSalonIds: string[] = [];
  const createdOwnerIds: string[] = [];
  let planId: string | null = null;
  let adminId: string | null = null;

  const [admin] = await db.insert(usersTable).values({
    firstName: "Pagination",
    lastName: "Admin",
    email: `pagination-admin-${suffix}@example.test`,
    passwordHash: await hashPassword(`pagination-admin-${suffix}`),
    passwordSetAt: new Date(),
    role: "SUPER_ADMIN",
  }).returning();
  assert.ok(admin);
  adminId = admin.id;

  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Pagination Plan ${suffix}`,
    price: 1000,
  }).returning();
  assert.ok(plan);
  planId = plan.id;

  // Insert salons with strictly increasing createdAt so ordering is deterministic
  // (createdAt desc, id desc). The OLDEST salon is the one carrying the matching
  // subscription status; it must remain reachable behind pagination + filter.
  const total = 5;
  const baseTime = Date.now() - total * 60_000;
  const cityTag = `PgCity${suffix}`;
  for (let i = 0; i < total; i++) {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Pagination",
      lastName: `Owner${i}`,
      email: `pagination-owner-${i}-${suffix}@example.test`,
      passwordHash: await hashPassword(`pagination-owner-${i}-${suffix}`),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning();
    assert.ok(owner);
    createdOwnerIds.push(owner.id);

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Pagination Salon ${i} ${suffix}`,
      slug: `pagination-salon-${i}-${suffix}`,
      city: cityTag,
      municipality: "Vračar",
      address: "Test 1",
      phone: "+381600000000",
      email: `pagination-salon-${i}-${suffix}@example.test`,
      shortDescription: "Pagination fixture",
      description: "Pagination fixture",
      imageUrl: "",
      createdAt: new Date(baseTime + i * 60_000),
    }).returning();
    assert.ok(salon);
    createdSalonIds.push(salon.id);
  }

  // Give ONLY the oldest salon (index 0) an "active" subscription.
  const oldestSalonId = createdSalonIds[0];
  await db.insert(subscriptionsTable).values({
    salonId: oldestSalonId,
    planId: plan.id,
    status: "active",
    dueAmount: 1000,
  });

  const cookie = `${sessionCookieName}=${await createSession(admin.id)}`;
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const listSalons = async (query: string): Promise<SalonRow[]> => {
      const response = await fetch(`${baseUrl}/admin/salons?${query}`, { headers: { cookie } });
      const text = await response.text();
      assert.equal(response.status, 200, `GET /admin/salons?${query}: ${text.slice(0, 500)}`);
      return JSON.parse(text) as SalonRow[];
    };

    // 1) A matching row beyond the first page is reachable. Scope to our city so
    //    only our 5 fixtures match, then page with pageSize=2. The oldest salon
    //    sorts last (createdAt desc), landing on page 3.
    {
      const page1 = await listSalons(`city=${encodeURIComponent(cityTag)}&page=1&pageSize=2`);
      const page2 = await listSalons(`city=${encodeURIComponent(cityTag)}&page=2&pageSize=2`);
      const page3 = await listSalons(`city=${encodeURIComponent(cityTag)}&page=3&pageSize=2`);
      const ids1 = page1.map((s) => s.id);
      const ids2 = page2.map((s) => s.id);
      const ids3 = page3.map((s) => s.id);
      // No overlap across pages.
      assert.equal(new Set([...ids1, ...ids2, ...ids3]).size, 5, "pages must not overlap and must cover all rows");
      // The oldest salon is only reachable on page 3, never on page 1.
      assert.ok(!ids1.includes(oldestSalonId), "oldest salon must not appear on page 1");
      assert.ok(ids3.includes(oldestSalonId), "oldest salon must be reachable on a later page");
    }

    // 2) subscriptionStatus is filtered BEFORE pagination. With the filter applied,
    //    only the oldest salon matches, so it appears on page 1 even though it is
    //    the oldest — proving the filter runs in SQL before LIMIT/OFFSET rather
    //    than after a truncated fetch.
    {
      const filtered = await listSalons(`city=${encodeURIComponent(cityTag)}&subscriptionStatus=active&page=1&pageSize=2`);
      const ids = filtered.map((s) => s.id);
      assert.deepEqual(ids, [oldestSalonId], "subscriptionStatus filter must return exactly the matching salon before pagination");
      assert.equal(filtered[0]?.subscriptionStatus, "active");
    }

    process.stdout.write("✓ admin list pagination regression suite passed\n");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (createdSalonIds.length) {
      await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.salonId, createdSalonIds));
      await db.delete(salonsTable).where(inArray(salonsTable.id, createdSalonIds));
    }
    if (planId) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, [planId]));
    const userIds = [...createdOwnerIds, ...(adminId ? [adminId] : [])];
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
