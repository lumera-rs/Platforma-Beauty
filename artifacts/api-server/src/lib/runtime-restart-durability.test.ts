/**
 * Task #10: restart-durability proof for booking idempotency.
 *
 * education-b2b-checkout-idempotency.test.ts already proves B2B checkout
 * idempotency survives an HTTP listener close+reopen within the SAME
 * process (same imported `app` module, same in-memory JS objects) -- a
 * genuine and useful check, but not a full guarantee against an in-memory
 * cache bug, since that module is never actually reloaded.
 *
 * This file proves the stronger claim for booking idempotency: the
 * replay guarantee survives a genuine OS-level process restart -- the
 * first request is served by one Node.js child process, that process is
 * killed outright, and the replay request is served by a BRAND NEW child
 * process (fresh module graph, fresh in-memory state) that has never seen
 * the original request. Only Postgres-backed state can make that work.
 *
 * Reuses the same generic "start app.listen(), print PORT" child script
 * already used by http-security-hardening.test.ts (http-security-hsts-child.ts)
 * -- no new child-process helper was written for this.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/runtime-restart-durability.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  appointmentsTable, bookingCommandReceiptsTable, db, employeeLocationAssignmentsTable,
  employeeServicesTable, employeesTable, salonHoursTable, salonsTable, servicesTable,
  sessionsTable, usersTable,
} from "@workspace/db";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const tsxBin = path.resolve(thisDir, "../../../../scripts/node_modules/.bin/tsx");
const childScript = path.resolve(thisDir, "http-security-hsts-child.ts");

async function spawnApiChild(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(tsxBin, [childScript], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<number>((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const match = buffered.match(/PORT:(\d+)/);
      if (match) { child.stdout?.off("data", onData); resolve(Number(match[1])); }
    };
    child.stdout?.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`API child process exited early (code ${code})`)));
  });
  return { child, port };
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

async function post(port: number, path: string, cookie: string, body: unknown, idempotencyKey: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, cookie: `${sessionCookieName}=${cookie}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const suffix = randomUUID();
const userIds: string[] = [];
const salonIds: string[] = [];
const serviceIds: string[] = [];
let childA: ChildProcess | undefined;
let childB: ChildProcess | undefined;

try {
  const [owner] = await db.insert(usersTable).values({
    firstName: "Restart", lastName: "Owner", email: `restart-owner-${suffix}@example.test`,
    passwordHash: await hashPassword(`owner-${suffix}`), passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  const [customer] = await db.insert(usersTable).values({
    firstName: "Restart", lastName: "Customer", email: `restart-customer-${suffix}@example.test`,
    passwordHash: await hashPassword(`customer-${suffix}`), passwordSetAt: new Date(), role: "CUSTOMER",
  }).returning();
  userIds.push(owner!.id, customer!.id);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner!.id, name: `Restart Salon ${suffix}`, slug: `restart-salon-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: "+381110000002", email: `restart-salon-${suffix}@example.test`,
    shortDescription: "Test", description: "Restart durability test salon.", imageUrl: "/test.jpg",
    active: true,
  }).returning();
  salonIds.push(salon!.id);
  const [service] = await db.insert(servicesTable).values({
    salonId: salon!.id, categoryName: "Test", name: "Test Service",
    description: "Test", durationMinutes: 30, price: 2000, imageUrl: "/test.jpg",
  }).returning();
  serviceIds.push(service!.id);
  await db.insert(salonHoursTable).values(
    Array.from({ length: 7 }, (_, i) => ({ salonId: salon!.id, weekday: i + 1, openTime: "08:00", closeTime: "20:00", closed: false })),
  );
  const [stylist] = await db.insert(employeesTable).values({
    salonId: salon!.id, userId: owner!.id, name: "Test Stylist", role: "Stilist", bio: "", avatarUrl: "", active: true,
  }).returning();
  await db.insert(employeeServicesTable).values({ employeeId: stylist!.id, serviceId: service!.id });
  await db.insert(employeeLocationAssignmentsTable).values({ employeeId: stylist!.id, salonId: salon!.id, active: true, isDefault: true });

  const customerSession = await createSession(customer!.id);
  const idempotencyKey = `restart-durability-${suffix}`;
  const payload = { salonId: salon!.id, serviceId: service!.id, date: "2027-07-10", startTime: "09:00" };

  // --- Process A: create the booking ---
  const a = await spawnApiChild(); childA = a.child;
  const first = await post(a.port, "/appointments", customerSession, payload, idempotencyKey);
  assert.equal(first.status, 201, "the initial booking must succeed");
  await killChild(a.child); childA = undefined;

  // --- Process B: a genuinely separate OS process, replays the same request ---
  const b = await spawnApiChild(); childB = b.child;
  const replay = await post(b.port, "/appointments", customerSession, payload, idempotencyKey);
  await killChild(b.child); childB = undefined;

  assert.equal(replay.status, 201, "the replay from a brand-new process must still return the original success status");
  assert.deepEqual(replay.body, first.body, "the replay from a brand-new process must return the byte-identical original result");

  const receipts = await db.select().from(bookingCommandReceiptsTable).where(eq(bookingCommandReceiptsTable.idempotencyKey, idempotencyKey));
  assert.equal(receipts.length, 1, "exactly one receipt must exist -- the second (cross-process) request must not have created a second one");

  console.log("Task #10 runtime-restart-durability (booking, genuine cross-process restart): PASS.");
} finally {
  if (childA) await killChild(childA);
  if (childB) await killChild(childB);
  if (salonIds.length) await db.delete(bookingCommandReceiptsTable).where(inArray(bookingCommandReceiptsTable.salonId, salonIds));
  if (salonIds.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.salonId, salonIds));
  if (serviceIds.length) await db.delete(servicesTable).where(inArray(servicesTable.id, serviceIds));
  if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
  if (userIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
}
