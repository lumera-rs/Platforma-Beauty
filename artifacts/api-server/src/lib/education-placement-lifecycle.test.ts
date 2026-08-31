import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationPlacementSettingsTable,
  educationPlacementsTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const password = "education-placement-test-password";
const placementKey = and(
  eq(educationPlacementSettingsTable.kind, "featured_center"),
  eq(educationPlacementSettingsTable.scope, "home"),
);

type PlacementView = {
  id: string;
  status: string;
  price: number;
  paymentReference: string;
  startsAt: string | null;
  endsAt: string | null;
};

async function request(
  baseUrl: string,
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; cookie?: string } = {},
) {
  return fetch(`${baseUrl}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function assertStatus(response: Response, expected: number): Promise<void> {
  if (response.status !== expected) {
    assert.equal(response.status, expected, await response.text());
  }
}

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password },
  });
  await assertStatus(response, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${sessionCookieName}=`));
  if (!cookie) throw new Error(`Login for ${email} did not return a session cookie.`);
  return cookie;
}

async function withFrozenTime<T>(iso: string, operation: () => Promise<T>): Promise<T> {
  const OriginalDate = globalThis.Date;
  const frozenTime = OriginalDate.parse(iso);
  class FrozenDate extends OriginalDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? frozenTime : value instanceof OriginalDate ? value.getTime() : value);
    }
    static now() {
      return frozenTime;
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  try {
    return await operation();
  } finally {
    globalThis.Date = OriginalDate;
  }
}

async function patchSettings(
  baseUrl: string,
  adminCookie: string,
  price: number,
  slotCount: number,
  durationDays: number,
) {
  const response = await request(baseUrl, "/admin/education/placement-settings", {
    method: "PATCH",
    cookie: adminCookie,
    body: [{ kind: "featured_center", scope: "home", price, slotCount, durationDays }],
  });
  await assertStatus(response, 200);
}

async function purchase(baseUrl: string, centerCookie: string): Promise<PlacementView> {
  const response = await request(baseUrl, "/education/placements/purchase", {
    method: "POST",
    cookie: centerCookie,
    body: { kind: "featured_center", scope: "home" },
  });
  await assertStatus(response, 201);
  return responseJson<PlacementView>(response);
}

async function settle(
  baseUrl: string,
  adminCookie: string,
  paymentReference: string,
): Promise<{ response: Response; body: PlacementView | { error: string } }> {
  const response = await request(
    baseUrl,
    `/admin/education/placements/${encodeURIComponent(paymentReference)}/settle`,
    { method: "POST", cookie: adminCookie },
  );
  return { response, body: await responseJson<PlacementView | { error: string }>(response) };
}

async function run(): Promise<void> {
  await ensureDemoData();
  let server: ReturnType<typeof app.listen> | undefined;
  const userIds: string[] = [];
  let centerId: string | undefined;

  try {
    const passwordHash = await hashPassword(password);
    const [admin, owner] = await db.insert(usersTable).values([
      {
        firstName: "Placement",
        lastName: "Admin",
        email: `education-placement-admin-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SUPER_ADMIN",
      },
      {
        firstName: "Placement",
        lastName: "Owner",
        email: `education-placement-owner-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "EDUKATIVNI_CENTAR",
      },
    ]).returning();
    assert.ok(admin && owner);
    userIds.push(admin.id, owner.id);

    const [plan] = await db.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.active, true)).limit(1);
    assert.ok(plan, "Placement coverage requires an active subscription plan.");

    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner.id,
      name: `Placement lifecycle center ${suffix}`,
      city: "Beograd",
      description: "Izolovani centar za proveru životnog ciklusa plasmana.",
      imageUrl: "/test-education-placement.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: admin.id,
    }).returning();
    assert.ok(center);
    centerId = center.id;
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId,
      planId: plan.id,
      status: "active",
      dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [adminCookie, centerCookie] = await Promise.all([
      login(baseUrl, admin.email),
      login(baseUrl, owner.email),
    ]);

    await patchSettings(baseUrl, adminCookie, 12_345, 1, 1);
    const abandoned = await purchase(baseUrl, centerCookie);
    await db.update(educationPlacementsTable)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(educationPlacementsTable.id, abandoned.id));

    const reusable = await purchase(baseUrl, centerCookie);
    const [expiredRow, reusableRow] = await Promise.all([
      db.select().from(educationPlacementsTable)
        .where(eq(educationPlacementsTable.id, abandoned.id)).limit(1),
      db.select().from(educationPlacementsTable)
        .where(eq(educationPlacementsTable.id, reusable.id)).limit(1),
    ]);
    assert.equal(expiredRow[0]?.status, "expired", "A stale payment hold must expire on the next purchase.");
    assert.equal(reusableRow[0]?.slotNumber, 1, "The expired hold must release its slot.");

    const expiredSettlement = await settle(baseUrl, adminCookie, abandoned.paymentReference);
    assert.equal(expiredSettlement.response.status, 409, "An expired hold must not be settled later.");

    await patchSettings(baseUrl, adminCookie, 98_765, 2, 7);
    const springStart = "2026-03-28T11:00:00.000Z";
    await db.update(educationPlacementsTable)
      .set({ createdAt: new Date("2026-03-28T10:00:00.000Z") })
      .where(eq(educationPlacementsTable.id, reusable.id));
    const springSettlement = await withFrozenTime(springStart, () =>
      settle(baseUrl, adminCookie, reusable.paymentReference));
    assert.equal(springSettlement.response.status, 200);
    const spring = springSettlement.body as PlacementView;
    assert.equal(spring.price, 12_345, "Settlement must retain the purchased price after settings change.");
    assert.equal(spring.startsAt, springStart);
    assert.equal(spring.endsAt, "2026-03-29T10:00:00.000Z", "Spring-forward must add one Belgrade calendar day.");
    const [springRow] = await db.select().from(educationPlacementsTable)
      .where(eq(educationPlacementsTable.id, reusable.id)).limit(1);
    assert.equal(springRow?.durationDaysSnapshot, 1, "Settlement must retain the purchased duration.");

    await patchSettings(baseUrl, adminCookie, 22_222, 2, 1);
    const fallPurchase = await purchase(baseUrl, centerCookie);
    await db.update(educationPlacementsTable)
      .set({ createdAt: new Date("2026-10-24T09:00:00.000Z") })
      .where(eq(educationPlacementsTable.id, fallPurchase.id));
    const fallStart = "2026-10-24T10:00:00.000Z";
    const fallSettlement = await withFrozenTime(fallStart, async () => {
      const refreshedAdminCookie = await login(baseUrl, admin.email);
      return settle(baseUrl, refreshedAdminCookie, fallPurchase.paymentReference);
    });
    assert.equal(fallSettlement.response.status, 200);
    const fall = fallSettlement.body as PlacementView;
    assert.equal(fall.startsAt, fallStart);
    assert.equal(fall.endsAt, "2026-10-25T11:00:00.000Z", "Fall-back must add one Belgrade calendar day.");

    console.log("Education placement expiry, snapshot, slot reuse, and DST regressions passed.");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => error ? reject(error) : resolve()));
    }
    if (centerId) {
      await db.delete(educationPlacementsTable).where(eq(educationPlacementsTable.centerId, centerId));
      await db.delete(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.centerId, centerId));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    }
    await db.delete(educationPlacementSettingsTable).where(placementKey);
    if (userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});