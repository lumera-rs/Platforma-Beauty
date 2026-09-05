/**
 * Task #10: runtime adversarial authorization coverage.
 *
 * Fills genuine gaps left by the existing test suite (tenant-isolation.test.ts,
 * appointment-routes.test.ts, admin/education authz scripts, etc.) rather
 * than re-proving what those already cover. Specifically:
 *
 *  1. Cross-customer appointment mutation: no existing test drives a real
 *     PATCH/cancel against another customer's appointment (only a GET
 *     salon-contact cross-customer case exists in appointment-routes.test.ts).
 *  2. Mass-assignment/overposting on representative write endpoints, with a
 *     DB read after the request (not just response inspection).
 *  3. Vertical privilege escalation across five representative role
 *     transitions, with exact HTTP status recorded.
 *  4. Cross-actor idempotency-key scope: proves two different customers can
 *     safely reuse the identical literal Idempotency-Key string without
 *     collision (booking-command.ts scopes receipts by
 *     (salonId, actorType, actorId, idempotencyKey), not by key alone).
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/runtime-adversarial-authorization.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  appointmentsTable, bookingCommandReceiptsTable, coursesTable, db,
  educationCenterStaffTable, educationCenterSubscriptionsTable, educationCentersTable,
  educationFinancialAuditLogTable, employeeLocationAssignmentsTable, employeeServicesTable,
  employeesTable, salonHoursTable, salonsTable, servicesTable, sessionsTable,
  subscriptionPlansTable, usersTable,
} from "@workspace/db";

const suffix = randomUUID();
const userIds: string[] = [];
const salonIds: string[] = [];
const serviceIds: string[] = [];
const appointmentIds: string[] = [];
const centerIds: string[] = [];
const courseIds: string[] = [];
const planIds: string[] = [];
let server: ReturnType<typeof app.listen> | undefined;

type HttpResult = { status: number; body: any };

async function call(base: string, path: string, method: string, cookie?: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResult> {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie: `${sessionCookieName}=${cookie}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function makeUser(role: string, label: string) {
  const [user] = await db.insert(usersTable).values({
    firstName: label, lastName: suffix.slice(0, 8), email: `${label}-${suffix}@example.test`,
    passwordHash: await hashPassword(`${label}-${suffix}`), passwordSetAt: new Date(), role: role as any,
  }).returning();
  userIds.push(user!.id);
  const session = await createSession(user!.id);
  return { user: user!, session };
}

try {
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // --- Shared fixtures ------------------------------------------------

  const ownerA = await makeUser("SALON_OWNER", "owner-a");
  const [salonA] = await db.insert(salonsTable).values({
    ownerId: ownerA.user.id, name: `Salon A ${suffix}`, slug: `salon-a-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: "+381110000001", email: `salon-a-${suffix}@example.test`,
    shortDescription: "Test", description: "Test salon A.", imageUrl: "/test.jpg",
    active: true,
  }).returning();
  salonIds.push(salonA!.id);
  const [serviceA] = await db.insert(servicesTable).values({
    salonId: salonA!.id, categoryName: "Test", name: "Test Service",
    description: "Test", durationMinutes: 30, price: 2000, imageUrl: "/test.jpg",
  }).returning();
  serviceIds.push(serviceA!.id);
  await db.insert(salonHoursTable).values(
    // ISO weekday scheme (Monday=1 .. Sunday=7), matching
    // availability-engine.ts's weekday() helper.
    Array.from({ length: 7 }, (_, i) => ({
      salonId: salonA!.id, weekday: i + 1, openTime: "08:00", closeTime: "20:00", closed: false,
    })),
  );
  const stylistUser = await makeUser("SALON_EMPLOYEE", "stylist-a");
  const [stylist] = await db.insert(employeesTable).values({
    salonId: salonA!.id, userId: stylistUser.user.id, name: "Test Stylist",
    role: "Stilist", bio: "", avatarUrl: "", active: true,
  }).returning();
  await db.insert(employeeServicesTable).values({ employeeId: stylist!.id, serviceId: serviceA!.id });
  await db.insert(employeeLocationAssignmentsTable).values({
    employeeId: stylist!.id, salonId: salonA!.id, active: true, isDefault: true,
  });

  const customerA = await makeUser("CUSTOMER", "customer-a");
  const customerB = await makeUser("CUSTOMER", "customer-b");
  const [apptB] = await db.insert(appointmentsTable).values({
    salonId: salonA!.id, customerId: customerB.user.id, serviceId: serviceA!.id,
    date: "2027-06-15", startTime: "10:00", endTime: "10:30", durationMinutes: 30, price: 2000,
    status: "confirmed",
  }).returning();
  appointmentIds.push(apptB!.id);

  // ======================================================================
  // 1. Cross-customer appointment mutation
  // ======================================================================

  const crossPatch = await call(base, `/appointments/${apptB!.id}`, "PATCH", customerA.session, { startTime: "14:00" });
  assert.equal(crossPatch.status, 404, "customer A must not be able to PATCH customer B's appointment");
  const crossCancel = await call(base, `/appointments/${apptB!.id}/cancel`, "POST", customerA.session, { reason: "adversarial" });
  assert.equal(crossCancel.status, 404, "customer A must not be able to cancel customer B's appointment");
  const [afterCrossAttempts] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, apptB!.id));
  assert.equal(afterCrossAttempts!.startTime, "10:00", "appointment B startTime must be unchanged after the cross-customer PATCH attempt");
  assert.equal(afterCrossAttempts!.status, "confirmed", "appointment B status must be unchanged after the cross-customer cancel attempt");
  console.log("Cross-customer appointment mutation: PASS (404, DB unchanged).");

  // ======================================================================
  // 2. Mass-assignment / overposting
  // ======================================================================

  // 2a. Business registration: inject role -- must never create a
  // privileged account regardless of what the request body claims.
  const [educationPlan] = await db.insert(subscriptionPlansTable).values({
    name: `Overpost Plan ${suffix}`, price: 5000, audience: "education", active: true,
  }).returning();
  planIds.push(educationPlan!.id);
  const overpostEmail = `overpost-register-${suffix}@example.test`;
  const registerOverpost = await call(base, "/auth/business-register", "POST", undefined, {
    firstName: "Overpost", lastName: "Test", email: overpostEmail, password: "StrongPass123!",
    phone: `+3816${suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "9")}`,
    businessType: "EDUCATION_CENTER", businessName: `Overpost Centar ${suffix}`,
    pib: suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "1"),
    registrationNumber: suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "2"),
    bankAccount: suffix.replace(/\D/g, "").slice(0, 18).padEnd(18, "3"),
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    description: `Overpost test ${suffix}`, planId: educationPlan!.id, billingCycle: "monthly",
    // Overposted fields:
    role: "SUPER_ADMIN", id: randomUUID(), active: true, verified: true,
  });
  assert.equal(registerOverpost.status, 201, "business-register must still succeed with unauthorized extra fields present");
  const [overpostUser] = await db.select().from(usersTable).where(eq(usersTable.email, overpostEmail));
  assert.ok(overpostUser); userIds.push(overpostUser!.id);
  assert.notEqual(overpostUser!.role, "SUPER_ADMIN", "overposted role must never be persisted");
  assert.equal(overpostUser!.role, "EDUKATIVNI_CENTAR", "role must be derived from businessType server-side, not the request body");
  const [overpostCenter] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, overpostUser!.id));
  assert.ok(overpostCenter); centerIds.push(overpostCenter!.id);
  assert.equal(overpostCenter!.verificationStatus, "pending", "overposted verified/active must not skip the real verification workflow");
  console.log("Mass-assignment (business-register role) : PASS.");

  // 2b. Salon profile update: owner overposts ownerId / isVerified / featured / topSalon.
  const salonBefore = (await db.select().from(salonsTable).where(eq(salonsTable.id, salonA!.id)))[0]!;
  const salonOverpost = await call(base, "/salon/profile", "PATCH", ownerA.session, {
    shortDescription: "Legitimate update via overpost test",
    ownerId: customerA.user.id, isVerified: true, featured: true, topSalon: true, active: false,
  });
  assert.ok([200, 400].includes(salonOverpost.status), `salon profile overpost must be a clean 200 (fields ignored) or 400, got ${salonOverpost.status}`);
  const [salonAfter] = await db.select().from(salonsTable).where(eq(salonsTable.id, salonA!.id));
  assert.equal(salonAfter!.ownerId, ownerA.user.id, "salon ownerId must never change via profile PATCH overposting");
  assert.equal(salonAfter!.isVerified, salonBefore.isVerified, "salon isVerified must be unaffected by overposting");
  assert.equal(salonAfter!.featured, salonBefore.featured, "salon featured must be unaffected by overposting");
  assert.equal(salonAfter!.topSalon, salonBefore.topSalon, "salon topSalon must be unaffected by overposting");
  console.log("Mass-assignment (salon profile ownerId/isVerified/featured) : PASS.");

  // 2c. Appointment PATCH: legitimate owner (customer B) overposts customerId.
  const apptOverpost = await call(base, `/appointments/${apptB!.id}`, "PATCH", customerB.session, {
    startTime: "11:00", customerId: customerA.user.id,
  });
  assert.ok([200, 400, 409].includes(apptOverpost.status), `appointment overpost must be a normal booking-domain status, got ${apptOverpost.status}`);
  const [apptAfterOverpost] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, apptB!.id));
  assert.equal(apptAfterOverpost!.customerId, customerB.user.id, "appointment customerId must never change via PATCH overposting");
  console.log("Mass-assignment (appointment customerId) : PASS.");

  // ======================================================================
  // 3. Vertical privilege escalation (exact status recorded)
  // ======================================================================

  const vertical: Array<{ label: string; result: HttpResult; expected: number }> = [];

  // 3a. CUSTOMER -> SALON_OWNER operation.
  vertical.push({
    label: "CUSTOMER -> PATCH /salon/profile (owner-only)",
    result: await call(base, "/salon/profile", "PATCH", customerA.session, { shortDescription: "hijack" }),
    expected: 403,
  });

  // 3b. SALON_EMPLOYEE -> owner-only operation.
  const employeeUser = await makeUser("SALON_EMPLOYEE", "employee-a");
  vertical.push({
    label: "SALON_EMPLOYEE -> PATCH /salon/profile (owner-only)",
    result: await call(base, "/salon/profile", "PATCH", employeeUser.session, { shortDescription: "hijack" }),
    expected: 403,
  });

  // 3c. SALON_OWNER -> ADMIN operation.
  vertical.push({
    label: "SALON_OWNER -> PATCH /admin/salons/:id (admin-only)",
    result: await call(base, `/admin/salons/${salonA!.id}`, "PATCH", ownerA.session, { featured: true }),
    expected: 403,
  });

  // 3d. Education staff (manager_reception, general course-management
  // rights) -> center-owner-only commercial-policy field.
  const centerOwner = await makeUser("EDUKATIVNI_CENTAR", "center-owner");
  const [centerX] = await db.insert(educationCentersTable).values({
    ownerId: centerOwner.user.id, name: `Center X ${suffix}`, city: "Beograd",
    description: "Test", imageUrl: "/test.jpg", verificationStatus: "verified", verifiedAt: new Date(),
  }).returning();
  centerIds.push(centerX!.id);
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: centerX!.id, planId: educationPlan!.id, status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  const [courseX] = await db.insert(coursesTable).values({
    centerId: centerX!.id, title: `Course X ${suffix}`, category: "Test", format: "in-person",
    price: 10_000, duration: "2 nedelje", imageUrl: "/test.jpg",
  }).returning();
  courseIds.push(courseX!.id);
  const staffUser = await makeUser("EDUKATIVNI_CENTAR", "center-staff");
  await db.insert(educationCenterStaffTable).values({
    centerId: centerX!.id, userId: staffUser.user.id, role: "manager_reception", active: true,
  });
  vertical.push({
    label: "education staff (manager_reception) -> PATCH course price (owner-only commercial field)",
    result: await call(base, `/education/courses/${courseX!.id}`, "PATCH", staffUser.session, { price: 1 }),
    expected: 403,
  });
  const [courseAfterStaffAttempt] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseX!.id));
  assert.equal(courseAfterStaffAttempt!.price, 10_000, "course price must be unchanged after the staff-role escalation attempt");

  // 3e. ADMIN -> SUPER_ADMIN-only operation.
  const adminUser = await makeUser("ADMIN", "admin-user");
  vertical.push({
    label: "ADMIN -> PATCH /admin/education/centers/:id planId (super-admin-only)",
    result: await call(base, `/admin/education/centers/${centerX!.id}`, "PATCH", adminUser.session, { planId: randomUUID() }),
    expected: 403,
  });

  for (const item of vertical) {
    assert.equal(item.result.status, item.expected, `${item.label}: expected ${item.expected}, got ${item.result.status} (body: ${JSON.stringify(item.result.body)})`);
  }
  console.log("Vertical privilege escalation matrix (5 transitions) : PASS.");
  for (const item of vertical) console.log(`  - ${item.label} -> ${item.result.status}`);

  // ======================================================================
  // 4. Cross-actor idempotency-key scope safety
  // ======================================================================

  const sharedKey = `shared-literal-key-${suffix}`;
  const bookingA = await call(base, "/appointments", "POST", customerA.session, {
    salonId: salonA!.id, serviceId: serviceA!.id, date: "2027-06-20", startTime: "09:00",
  }, { "idempotency-key": sharedKey });
  const bookingB = await call(base, "/appointments", "POST", customerB.session, {
    salonId: salonA!.id, serviceId: serviceA!.id, date: "2027-06-20", startTime: "15:00",
  }, { "idempotency-key": sharedKey });
  if (bookingA.status !== 201) console.log("DEBUG bookingA:", JSON.stringify(bookingA.body));
  if (bookingB.status !== 201) console.log("DEBUG bookingB:", JSON.stringify(bookingB.body));
  assert.equal(bookingA.status, 201, "customer A booking with a literal key already used by another actor must still succeed");
  assert.equal(bookingB.status, 201, "customer B booking with the identical literal key must independently succeed (no cross-actor collision)");
  assert.notEqual(bookingA.body.id, bookingB.body.id, "the two bookings must be genuinely distinct appointments");
  appointmentIds.push(bookingA.body.id, bookingB.body.id);
  const receiptsForKey = await db.select().from(bookingCommandReceiptsTable)
    .where(eq(bookingCommandReceiptsTable.idempotencyKey, sharedKey));
  assert.equal(receiptsForKey.length, 2, "two independent receipts (one per actor) must exist for the shared literal key");
  const receiptActorIds = new Set(receiptsForKey.map((r) => r.actorId));
  assert.ok(receiptActorIds.has(customerA.user.id) && receiptActorIds.has(customerB.user.id));
  console.log("Cross-actor idempotency-key scope (booking) : PASS -- same literal key, two actors, no collision.");

  console.log("Task #10 runtime-adversarial-authorization: ALL CHECKS PASSED.");
} finally {
  if (server) server.close();
  if (courseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
  if (centerIds.length) await db.delete(educationCenterStaffTable).where(inArray(educationCenterStaffTable.centerId, centerIds));
  if (centerIds.length) await db.delete(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds));
  if (centerIds.length) await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, centerIds));
  if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
  if (salonIds.length) await db.delete(bookingCommandReceiptsTable).where(inArray(bookingCommandReceiptsTable.salonId, salonIds));
  if (salonIds.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.salonId, salonIds));
  if (serviceIds.length) await db.delete(servicesTable).where(inArray(servicesTable.id, serviceIds));
  if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
  if (userIds.length) await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
  if (userIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
}
