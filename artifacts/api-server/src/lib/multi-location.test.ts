import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  salonLoyaltyStatusesTable,
  salonsTable,
  servicesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

type Json = Record<string, unknown>;

async function run(): Promise<void> {
  await ensureDemoData();
  const suffix = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const passwordHash = await hashPassword(`multi-location-${suffix}`);
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId: string | undefined;
  let otherOwnerId: string | undefined;
  let salonIds: string[] = [];
  let serviceIds: string[] = [];
  let planIds: string[] = [];

  try {
    const [owner, otherOwner] = await db.insert(usersTable).values([
      {
        firstName: "Multi",
        lastName: "Owner",
        email: `multi-owner-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Foreign",
        lastName: "Owner",
        email: `multi-foreign-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
    ]).returning();
    assert.ok(owner && otherOwner);
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;

    const [first, second, foreign] = await db.insert(salonsTable).values([
      {
        ownerId: owner.id,
        name: `Prva lokacija ${suffix}`,
        slug: `multi-first-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 1",
        phone: "+381110000101",
        email: `multi-first-${suffix}@example.test`,
        shortDescription: "Prva test lokacija.",
        description: "Prva lokacija za proveru poslovanja na više lokacija.",
        imageUrl: "/test.jpg",
      },
      {
        ownerId: owner.id,
        name: `Druga lokacija ${suffix}`,
        slug: `multi-second-${suffix}`,
        city: "Novi Sad",
        municipality: "Centar",
        address: "Test 2",
        phone: "+381110000102",
        email: `multi-second-${suffix}@example.test`,
        shortDescription: "Druga test lokacija.",
        description: "Druga lokacija za proveru poslovanja na više lokacija.",
        imageUrl: "/test.jpg",
      },
      {
        ownerId: otherOwner.id,
        name: `Tuđa lokacija ${suffix}`,
        slug: `multi-foreign-${suffix}`,
        city: "Niš",
        municipality: "Medijana",
        address: "Test 3",
        phone: "+381110000103",
        email: `multi-foreign-${suffix}@example.test`,
        shortDescription: "Tuđa test lokacija.",
        description: "Lokacija koja nikada ne sme postati aktivna drugom vlasniku.",
        imageUrl: "/test.jpg",
      },
    ]).returning();
    assert.ok(first && second && foreign);
    salonIds = [first.id, second.id, foreign.id];
    await db.update(usersTable).set({ activeSalonId: first.id }).where(eq(usersTable.id, owner.id));

    const [firstService, secondService] = await db.insert(servicesTable).values([
      {
        salonId: first.id,
        categoryName: "Test",
        name: `Usluga prve lokacije ${suffix}`,
        description: "Usluga koja pripada isključivo prvoj lokaciji.",
        durationMinutes: 45,
        price: 1200,
        imageUrl: "/test.jpg",
      },
      {
        salonId: second.id,
        categoryName: "Test",
        name: `Usluga druge lokacije ${suffix}`,
        description: "Usluga koja pripada isključivo drugoj lokaciji.",
        durationMinutes: 45,
        price: 2400,
        imageUrl: "/test.jpg",
      },
    ]).returning();
    assert.ok(firstService && secondService);
    serviceIds = [firstService.id, secondService.id];
    await db.insert(appointmentsTable).values([
      {
        salonId: first.id,
        serviceId: firstService.id,
        date: today,
        startTime: "10:00",
        endTime: "10:45",
        durationMinutes: 45,
        price: 1200,
        status: "completed",
      },
      {
        salonId: second.id,
        serviceId: secondService.id,
        date: today,
        startTime: "11:00",
        endTime: "11:45",
        durationMinutes: 45,
        price: 2400,
        status: "completed",
      },
    ]);

    await db.insert(salonLoyaltyStatusesTable).values([
      { salonId: first.id, currentPeriodSpend: 12000 },
      { salonId: second.id, currentPeriodSpend: 18000 },
    ]);
    const [activePlan, trialPlan] = await db.insert(subscriptionPlansTable).values([
      { name: `Multi active ${suffix}`, price: 4000, features: [], limits: {} },
      { name: `Multi trial ${suffix}`, price: 7000, features: [], limits: {} },
    ]).returning();
    assert.ok(activePlan && trialPlan);
    planIds = [activePlan.id, trialPlan.id];
    await db.insert(subscriptionsTable).values([
      { salonId: first.id, planId: activePlan.id, status: "active", dueAmount: activePlan.price },
      { salonId: second.id, planId: trialPlan.id, status: "active", dueAmount: 6500 },
    ]);

    const session = await createSession(owner.id);
    const cookie = `${sessionCookieName}=${session}`;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const get = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      return { response, body: await response.json() as Json };
    };

    const locationDashboard = await get("/salon/dashboard");
    assert.equal(locationDashboard.response.status, 200);
    assert.equal(locationDashboard.body.scope, "location");
    assert.equal(locationDashboard.body.loyaltyScope, "owner", "loyalty must be explicitly account-wide");
    assert.equal(locationDashboard.body.revenueThisMonth, 1200, "active location must keep its own revenue");
    assert.equal(locationDashboard.body.bookingsThisMonth, 1, "active location must keep its own booking count");
    assert.equal((locationDashboard.body.locations as Json[]).length, 1, "location dashboard must not merge locations");

    const allDashboard = await get("/salon/dashboard?scope=all");
    assert.equal(allDashboard.response.status, 200);
    assert.equal(allDashboard.body.scope, "all");
    assert.equal(allDashboard.body.revenueThisMonth, 3600, "all-locations dashboard must sum completed revenue");
    assert.equal(allDashboard.body.bookingsThisMonth, 2, "all-locations dashboard must sum bookings");
    assert.equal((allDashboard.body.locations as Json[]).length, 2, "all-locations dashboard must list each owned location");

    const loyalty = await get("/loyalty/status");
    assert.equal(loyalty.response.status, 200);
    assert.equal(loyalty.body.monthlySpend, 30000, "loyalty spend must aggregate legacy location rows");
    const discount = Number(loyalty.body.subscriptionDiscountPercent ?? 0);
    assert.equal(
      loyalty.body.subscriptionDue,
      loyalty.body.freeSubscription ? 0 : Math.round(6500 * (1 - discount / 100)),
      "legacy active subscriptions must use the highest recorded due amount as one owner-wide contract",
    );

    const switched = await fetch(`${baseUrl}/salon/active-salon`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ salonId: second.id }),
    });
    assert.equal(switched.status, 200, "owner must switch to another owned location");
    const secondDashboard = await get("/salon/dashboard");
    assert.equal(secondDashboard.body.revenueThisMonth, 2400, "switch must refresh the active location context");

    const forbiddenSwitch = await fetch(`${baseUrl}/salon/active-salon`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ salonId: foreign.id }),
    });
    assert.equal(forbiddenSwitch.status, 404, "owner must never select another owner's location");
    const afterForbidden = await get("/salon/dashboard");
    assert.equal(afterForbidden.body.revenueThisMonth, 2400, "forbidden selection must leave the authorized location unchanged");

    await db.update(usersTable).set({ activeSalonId: foreign.id }).where(eq(usersTable.id, owner.id));
    const recoveredDashboard = await get("/salon/dashboard");
    const recoveredSalonId = (recoveredDashboard.body.salon as Json).id;
    assert.ok([first.id, second.id].includes(String(recoveredSalonId)), "an invalid saved selection must recover to an owned location");
    const [recoveredOwner] = await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable).where(eq(usersTable.id, owner.id));
    assert.equal(recoveredOwner?.activeSalonId, recoveredSalonId, "recovered active location must be persisted for subsequent requests");

    const publicFirst = await fetch(`${baseUrl}/salons/${first.slug}`);
    const publicSecond = await fetch(`${baseUrl}/salons/${second.slug}`);
    assert.equal(publicFirst.status, 200);
    assert.equal(publicSecond.status, 200);
    const firstServices = (await publicFirst.json() as Json).services as Array<{ id: string }>;
    const secondServices = (await publicSecond.json() as Json).services as Array<{ id: string }>;
    assert.deepEqual(firstServices.map((service) => service.id), [firstService.id], "public profile must stay per-location");
    assert.deepEqual(secondServices.map((service) => service.id), [secondService.id], "public profile must not leak sibling services");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (salonIds.length) {
      await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, [ownerId, otherOwnerId].filter((id): id is string => Boolean(id))));
      await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.salonId, salonIds));
      await db.delete(salonLoyaltyStatusesTable).where(inArray(salonLoyaltyStatusesTable.salonId, salonIds));
      await db.delete(appointmentsTable).where(inArray(appointmentsTable.salonId, salonIds));
      if (serviceIds.length) await db.delete(servicesTable).where(inArray(servicesTable.id, serviceIds));
      await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    }
    if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
    const userIds = [ownerId, otherOwnerId].filter((id): id is string => Boolean(id));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});