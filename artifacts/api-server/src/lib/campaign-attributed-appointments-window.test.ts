/**
 * Campaign attributed-appointments window parity — regression suite
 *
 * The stats dialog shows the per-rule `attributedAppointments` count above the
 * drill-down list. These endpoints must apply identical run-window semantics:
 *
 *   1. A custom inclusive from/to range includes only runs in that range.
 *   2. The list total equals the stats count for custom ranges, every rolling
 *      preset, and all-time.
 *   3. Combining a preset period with from/to is rejected with 400 by both
 *      endpoints.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/campaign-attributed-appointments-window.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  automationRulesTable,
  automationRunsTable,
  db,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

const suffix = randomUUID().slice(0, 8);
const DAY_MS = 24 * 60 * 60 * 1000;
const FROZEN_NOW = Date.now();
const cleanup = {
  userIds: [] as string[],
  salonIds: [] as string[],
};

function daysAgo(days: number): Date {
  return new Date(FROZEN_NOW - days * DAY_MS);
}

function dateDaysAgo(days: number): string {
  return daysAgo(days).toISOString().slice(0, 10);
}

function startOfDateDaysAgo(days: number): Date {
  return new Date(`${dateDaysAgo(days)}T00:00:00.000Z`);
}

async function main() {
  const hash = await hashPassword(`pass-window-${suffix}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Owner",
    lastName: "Window",
    email: `window-owner-${suffix}@bg.test`,
    passwordHash: hash,
    passwordSetAt: new Date(),
    role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  cleanup.userIds.push(owner.id);

  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Window Salon ${suffix}`,
    slug: `window-salon-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    postalCode: "11000",
    phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
    email: `window-salon-${suffix}@bg.test`,
    shortDescription: "Test",
    description: "Test salon",
    imageUrl: "/t.jpg",
  }).returning();
  assert.ok(salon);
  cleanup.salonIds.push(salon.id);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const token = await createSession(owner.id);

  const [service] = await db.insert(servicesTable).values({
    salonId: salon.id,
    categoryName: "Hair",
    name: `Window Service ${suffix}`,
    description: "Test",
    durationMinutes: 60,
    price: 3000,
    imageUrl: "/t.jpg",
    active: true,
  }).returning();
  assert.ok(service);

  const [customer] = await db.insert(salonCustomersTable).values({
    salonId: salon.id,
    firstName: "Test",
    lastName: "Customer",
    email: `window-customer-${suffix}@bg.test`,
    phone: null,
    smsOptOut: false,
  }).returning();
  assert.ok(customer);

  const [rule] = await db.insert(automationRulesTable).values({
    salonId: salon.id,
    name: `Window Rule ${suffix}`,
    trigger: "inactive_days",
    triggerConfig: { inactiveDays: 30 },
    action: "send_email",
    emailSubject: "Test",
    emailBody: "Test",
    status: "active",
  }).returning();
  assert.ok(rule);

  // Keep boundary coverage in its own campaigns so it cannot change the
  // expected counts of the rolling-preset/custom-range parity fixture below.
  const [inclusiveStartRule] = await db.insert(automationRulesTable).values({
    salonId: salon.id,
    name: `Inclusive Start Rule ${suffix}`,
    trigger: "inactive_days",
    triggerConfig: { inactiveDays: 30 },
    action: "send_email",
    emailSubject: "Test",
    emailBody: "Test",
    status: "active",
  }).returning();
  assert.ok(inclusiveStartRule);

  const [inclusiveToRule] = await db.insert(automationRulesTable).values({
    salonId: salon.id,
    name: `Inclusive To Rule ${suffix}`,
    trigger: "inactive_days",
    triggerConfig: { inactiveDays: 30 },
    action: "send_email",
    emailSubject: "Test",
    emailBody: "Test",
    status: "active",
  }).returning();
  assert.ok(inclusiveToRule);

  const [exclusiveEndRule] = await db.insert(automationRulesTable).values({
    salonId: salon.id,
    name: `Exclusive End Rule ${suffix}`,
    trigger: "inactive_days",
    triggerConfig: { inactiveDays: 30 },
    action: "send_email",
    emailSubject: "Test",
    emailBody: "Test",
    status: "active",
  }).returning();
  assert.ok(exclusiveEndRule);

  const boundaryQuery = `from=${dateDaysAgo(6)}&to=${dateDaysAgo(1)}`;
  const boundaryCases = [
    {
      tag: "inclusive-start",
      ruleId: inclusiveStartRule.id,
      runAt: startOfDateDaysAgo(6),
      appointmentDate: dateDaysAgo(6),
    },
    {
      tag: "inclusive-to",
      ruleId: inclusiveToRule.id,
      runAt: startOfDateDaysAgo(1),
      appointmentDate: dateDaysAgo(1),
    },
    {
      tag: "exclusive-end",
      ruleId: exclusiveEndRule.id,
      runAt: new Date(startOfDateDaysAgo(1).getTime() + DAY_MS),
      appointmentDate: dateDaysAgo(0),
    },
  ] as const;
  const boundaryAppointmentIds = new Map<string, string>();
  for (const item of boundaryCases) {
    const [appointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id,
      salonCustomerId: customer.id,
      serviceId: service.id,
      date: item.appointmentDate,
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      status: "completed",
      price: 1000,
      treatmentLocation: "salon",
    }).returning();
    assert.ok(appointment);
    boundaryAppointmentIds.set(item.tag, appointment.id);

    await db.insert(automationRunsTable).values({
      eventKey: `window-boundary-run-${item.tag}-${suffix}`,
      ruleId: item.ruleId,
      salonId: salon.id,
      salonCustomerId: customer.id,
      status: "sent",
      executedAt: item.runAt,
      sentAt: item.runAt,
      attributedAppointmentId: appointment.id,
    });
  }

  // Two runs are inside the custom range [6 days ago, 1 day ago]. The other
  // two are outside it, while still giving distinct expected counts for each
  // rolling preset: 7d → 2, 30d → 3, 90d → 4.
  const cases = [
    { tag: "inside-recent", days: 2 },
    { tag: "inside-early", days: 5 },
    { tag: "outside-30d", days: 10 },
    { tag: "outside-90d", days: 40 },
  ] as const;
  const appointmentIds = new Map<string, string>();
  for (const item of cases) {
    const [appointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id,
      salonCustomerId: customer.id,
      serviceId: service.id,
      date: dateDaysAgo(item.days),
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      status: "completed",
      price: 1000,
      treatmentLocation: "salon",
    }).returning();
    assert.ok(appointment);
    appointmentIds.set(item.tag, appointment.id);

    await db.insert(automationRunsTable).values({
      eventKey: `window-run-${item.tag}-${suffix}`,
      ruleId: rule.id,
      salonId: salon.id,
      salonCustomerId: customer.id,
      status: "sent",
      executedAt: daysAgo(item.days),
      sentAt: daysAgo(item.days),
      attributedAppointmentId: appointment.id,
    });
  }

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { cookie: `${sessionCookieName}=${token}` },
    });
    return { status: response.status, body: await response.json() as any };
  };
  const listPath = `/api/growth/automations/${rule.id}/attributed-appointments`;
  const statsPath = `/api/growth/automations/${rule.id}/stats`;

  const realDateNow = Date.now;
  try {
    // Keep rolling-window cutoffs aligned with the timestamps seeded above.
    Date.now = () => FROZEN_NOW;

    const assertParity = async (query: string, expected: number, label: string) => {
      const [list, stats] = await Promise.all([
        get(`${listPath}?${query}&limit=100`),
        get(`${statsPath}?${query}`),
      ]);
      assert.equal(list.status, 200, `${label}: list succeeds`);
      assert.equal(stats.status, 200, `${label}: stats succeeds`);
      assert.equal(list.body.total, expected, `${label}: list has expected total`);
      assert.equal(
        list.body.total,
        stats.body.attributedAppointments,
        `${label}: list total matches stats attributedAppointments`,
      );
      assert.equal(list.body.items.length, expected, `${label}: all matching rows fit in the test page`);
    };

    const customQuery = `from=${dateDaysAgo(6)}&to=${dateDaysAgo(1)}`;
    await assertParity(customQuery, 2, "custom from/to range");
    const customList = await get(`${listPath}?${customQuery}&limit=100`);
    assert.deepEqual(
      new Set(customList.body.items.map((item: any) => item.appointmentId)),
      new Set([appointmentIds.get("inside-recent"), appointmentIds.get("inside-early")]),
      "custom range returns exactly the appointments inside its inclusive dates",
    );
    console.log("✓ custom date range list total matches stats and excludes outside runs");

    const assertBoundaryParity = async (
      ruleId: string,
      expected: number,
      label: string,
    ) => {
      const [list, stats] = await Promise.all([
        get(`/api/growth/automations/${ruleId}/attributed-appointments?${boundaryQuery}&limit=100`),
        get(`/api/growth/automations/${ruleId}/stats?${boundaryQuery}`),
      ]);
      assert.equal(list.status, 200, `${label}: list succeeds`);
      assert.equal(stats.status, 200, `${label}: stats succeeds`);
      assert.equal(list.body.total, expected, `${label}: list has expected total`);
      assert.equal(
        list.body.total,
        stats.body.attributedAppointments,
        `${label}: list total matches stats attributedAppointments`,
      );
      assert.equal(list.body.items.length, expected, `${label}: all matching rows fit in the test page`);
    };

    await assertBoundaryParity(inclusiveStartRule.id, 1, "inclusive from-day start");
    await assertBoundaryParity(inclusiveToRule.id, 1, "inclusive to-day start");
    await assertBoundaryParity(exclusiveEndRule.id, 0, "exclusive day-after-to boundary");
    const boundaryStartList = await get(
      `/api/growth/automations/${inclusiveStartRule.id}/attributed-appointments?${boundaryQuery}&limit=100`,
    );
    assert.equal(
      boundaryStartList.body.items[0]?.appointmentId,
      boundaryAppointmentIds.get("inclusive-start"),
      "inclusive from-day start returns its boundary appointment",
    );
    console.log("✓ custom date boundaries are counted once with half-open window semantics");

    for (const [query, expected] of [
      ["period=7d", 2],
      ["period=30d", 3],
      ["period=90d", 4],
      ["period=all", 4],
    ] as const) {
      await assertParity(query, expected, query);
    }
    console.log("✓ period presets and all-time list totals match stats");

    for (const path of [listPath, statsPath]) {
      const mixed = await get(`${path}?period=30d&from=${dateDaysAgo(6)}&to=${dateDaysAgo(1)}`);
      assert.equal(mixed.status, 400, `period plus from/to is rejected by ${path}`);
      assert.equal(mixed.body.code, "VALIDATION", `validation code returned by ${path}`);
    }
    console.log("✓ combining period with from/to returns 400 on both endpoints");
  } finally {
    Date.now = realDateNow;
    server.close();
    await db.delete(automationRunsTable).where(inArray(automationRunsTable.ruleId, [
      rule.id,
      inclusiveStartRule.id,
      inclusiveToRule.id,
      exclusiveEndRule.id,
    ]));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salon.id));
    await db.delete(automationRulesTable).where(inArray(automationRulesTable.id, [
      rule.id,
      inclusiveStartRule.id,
      inclusiveToRule.id,
      exclusiveEndRule.id,
    ]));
    await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, salon.id));
    await db.delete(servicesTable).where(eq(servicesTable.salonId, salon.id));
    await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, cleanup.userIds));
    await db.delete(salonsTable).where(inArray(salonsTable.id, cleanup.salonIds));
    await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
    await pool.end();
  }
  console.log("All campaign attributed-appointments window checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});