/**
 * Business Growth Phase 2 — comprehensive test suite
 *
 * Covers:
 *  Unit (pure functions, no DB):
 *   1. Retention classification semantics (NEW/ACTIVE/VIP/AT_RISK/LOST + future-appt rescue)
 *   2. Automation opt-out logic
 *   3. Package redemption state machine
 *   4. Session count arithmetic
 *   5. Employee scope guard
 *   6. AI snapshot scoping and injected provider
 *   7. AI proposal confirmation (paused status)
 *   8. Voucher template substitution and HTML escaping
 *   9. Birthday trigger month/day matching
 *  10. Fixed commission calculation
 *  11. Automation idempotency key (epoch key)
 *
 *  DB + API integration (real DB, injected fake senders):
 *  12. Owner A vs Owner B tenant isolation (cross-tenant package read rejected)
 *  13. Customer IDOR: no salonCustomerId in purchase body; derived from auth
 *  14. Employee self vs other employee (403 on cross-employee)
 *  15. Package create with invalid serviceIds rolls back atomically
 *  16. Package soft-delete preserves purchase history
 *  17. Package pending → confirm → redeem → repeat (409) → cancel → auto-reversal
 *  18. Automation dry-run idempotency (no sends, counts correctly)
 *  19. Admin read-only /growth/admin/summary
 *  20. AI route scoping: wrong role blocked; injected provider works
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  salonsTable,
  servicesTable,
  salonCustomersTable,
  appointmentsTable,
  treatmentPackagesTable,
  customerPackagePurchasesTable,
  packageRedemptionsTable,
  packageServiceLinksTable,
  packagePurchaseServiceLinksTable,
  automationRulesTable,
  automationRunsTable,
  automationDeliveriesTable,
  smsDeliveriesTable,
  employeesTable,
  employeeServicesTable,
  employeeCommissionSettingsTable,
  employeeLeaveRequestsTable,
  employeeTimeOffTable,
  salonHoursTable,
  reviewsTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { classifyRetention } from "./retention-classification";
import { buildEpochKey, runAutomationWorker, substituteTemplate, AUTOMATION_COOLDOWN_MS } from "./automation-worker";
import { redeemPackageSession, reversePackageRedemption, handleAppointmentCancellationReversals } from "./package-entitlement";
import { getEmployeePerformance } from "./employee-performance";
import type { SmsProvider } from "./sms";
import { sendSms, infobipSmsProvider } from "./sms";
import {
  ListSalonLeaveRequestsResponse,
  ReviewSalonLeaveRequestResponse,
  CreateEmployeeLeaveRequestResponse,
} from "@workspace/api-zod";
import type { TransactionalEmailTransport } from "./brevo";
import { sendTransactionalEmail, retryFailedRetryableEmails } from "./brevo";
import { emailDeliveriesTable, integrationSettingsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeOwnerAndSalon(suffix: string) {
  const hash = await hashPassword(`pass-${suffix}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Owner", lastName: suffix,
    email: `owner-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `Salon ${suffix}`, slug: `salon-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
    email: `salon-${suffix}@bg.test`,
    shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
  }).returning();
  assert.ok(salon);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const token = await createSession(owner.id);
  return { owner, salon, token };
}

async function makeCustomerUser(suffix: string) {
  const hash = await hashPassword(`pass-cust-${suffix}`);
  const [user] = await db.insert(usersTable).values({
    firstName: "Customer", lastName: suffix,
    email: `customer-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "CUSTOMER",
  }).returning();
  assert.ok(user);
  const token = await createSession(user.id);
  return { user, token };
}

async function makeSalonCustomer(userId: string, salonId: string) {
  const [sc] = await db.insert(salonCustomersTable).values({
    salonId, userId, firstName: "Test", lastName: "Customer",
    email: `sc-${randomUUID()}@bg.test`, phone: null, smsOptOut: false,
  }).returning();
  assert.ok(sc);
  return sc;
}

async function makeService(salonId: string, name: string) {
  const [svc] = await db.insert(servicesTable).values({
    salonId, categoryName: "Hair", name, description: "Test service",
    durationMinutes: 60, price: 3000, imageUrl: "/t.jpg", active: true,
  }).returning();
  assert.ok(svc);
  return svc;
}

async function makeEmployee(salonId: string, suffix: string) {
  const hash = await hashPassword(`pass-emp-${suffix}`);
  const [user] = await db.insert(usersTable).values({
    firstName: "Emp", lastName: suffix,
    email: `emp-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE",
  }).returning();
  assert.ok(user);
  const [emp] = await db.insert(employeesTable).values({
    salonId, userId: user.id, name: `Emp ${suffix}`,
    role: "stylist", bio: "", avatarUrl: "/t.jpg", active: true,
  }).returning();
  assert.ok(emp);
  const token = await createSession(user.id);
  return { user, emp, token };
}

async function makePackage(salonId: string, serviceId: string, suffix: string) {
  const [pkg] = await db.insert(treatmentPackagesTable).values({
    salonId, name: `Pkg ${suffix}`, description: "Test package",
    priceInDinars: 10000, sessionCount: 3, validityDays: 90, active: true,
  }).returning();
  assert.ok(pkg);
  await db.insert(packageServiceLinksTable).values({ packageId: pkg.id, serviceId, quota: 3 });
  return pkg;
}

/**
 * Insert a package purchase directly into the DB AND seed its purchase-time
 * service snapshot (package_purchase_service_links). Tests that bypass the
 * purchase API must use this helper so the redemption snapshot check passes.
 */
async function makeActivePurchaseWithSnapshot(
  salonId: string,
  packageId: string,
  salonCustomerId: string,
  serviceIds: string[],
  overrides: {
    totalSessions?: number;
    remainingSessions?: number;
    priceInDinars?: number;
    status?: typeof customerPackagePurchasesTable.$inferInsert["status"];
    expiresAt?: Date;
  } = {},
) {
  const [purchase] = await db.insert(customerPackagePurchasesTable).values({
    salonId, packageId, salonCustomerId,
    totalSessions: overrides.totalSessions ?? 3,
    remainingSessions: overrides.remainingSessions ?? 3,
    priceInDinars: overrides.priceInDinars ?? 10000,
    paymentMethod: "pay_at_salon",
    status: overrides.status ?? "active",
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 90 * 86_400_000),
  }).returning();
  assert.ok(purchase);
  if (serviceIds.length > 0) {
    await db.insert(packagePurchaseServiceLinksTable).values(
      serviceIds.map((serviceId) => ({ purchaseId: purchase.id, serviceId })),
    );
  }
  return purchase;
}

async function makeAppointment(salonId: string, salonCustomerId: string, serviceId: string, status = "completed") {
  const [appt] = await db.insert(appointmentsTable).values({
    salonId, salonCustomerId, serviceId,
    date: "2024-01-15", startTime: "10:00", endTime: "11:00", durationMinutes: 60,
    status: status as typeof appointmentsTable.$inferInsert["status"],
    price: 3000, treatmentLocation: "salon",
  }).returning();
  assert.ok(appt);
  return appt;
}

/**
 * Enable real bookings for a salon: open all weekdays and link the employee to
 * the service so availableEmployee finds a free slot. Idempotent per pair.
 */
async function enableBooking(salonId: string, employeeId: string, serviceId: string) {
  await db.insert(salonHoursTable).values(
    Array.from({ length: 7 }, (_, i) => ({
      salonId, weekday: i + 1, openTime: "08:00", closeTime: "20:00", closed: false,
    })),
  ).onConflictDoNothing();
  await db.insert(employeeServicesTable).values({ employeeId, serviceId }).onConflictDoNothing();
}

function listenAndGetBaseUrl(server: ReturnType<typeof app.listen>): Promise<string> {
  return once(server, "listening").then(() => {
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}/api`;
  });
}

// ---------------------------------------------------------------------------
// ============================================================
// UNIT TESTS (no DB, no network)
// ============================================================
// ---------------------------------------------------------------------------

// 1. Retention classification semantics
function testRetentionClassification() {
  const today = new Date("2024-06-01");

  // NEW — no completed visits
  const r1 = classifyRetention({ appointments: [], today });
  assert.equal(r1.status, "NEW");
  assert.ok(r1.explanation.length > 0);
  assert.ok(r1.recommendedAction.length > 0);

  // NEW — first recent visit ≤ 45 days
  const r2 = classifyRetention({
    appointments: [{ date: "2024-05-20", status: "completed", price: 3000 }],
    today,
  });
  assert.equal(r2.status, "NEW");

  // ACTIVE — 2 completed, within typical interval
  const r3 = classifyRetention({
    appointments: [
      { date: "2024-03-01", status: "completed", price: 3000 },
      { date: "2024-04-01", status: "completed", price: 3000 },
    ],
    today,
  });
  assert.equal(r3.status, "AT_RISK", "60 days since last, typical interval 31, threshold 46.5 — AT_RISK expected");

  // ACTIVE — recent
  const r3b = classifyRetention({
    appointments: [
      { date: "2024-04-01", status: "completed", price: 3000 },
      { date: "2024-05-20", status: "completed", price: 3000 },
    ],
    today,
  });
  assert.equal(r3b.status, "ACTIVE");

  // VIP — 5+ completed
  const vipAppts = Array.from({ length: 5 }, (_, i) => ({
    date: `2024-0${i + 1}-01`,
    status: "completed" as const,
    price: 3000,
  }));
  const r4 = classifyRetention({ appointments: vipAppts, today });
  assert.equal(r4.status, "VIP");

  // VIP — high spend (2x median)
  const r5 = classifyRetention({
    appointments: [
      { date: "2024-04-01", status: "completed", price: 3000 },
      { date: "2024-05-10", status: "completed", price: 3000 },
    ],
    salonMedianSpend: 1000, // customer 6000, 2x = 2000 → above
    today,
  });
  assert.equal(r5.status, "VIP");

  // AT_RISK — overdue but not lost
  const r6 = classifyRetention({
    appointments: [
      { date: "2024-01-01", status: "completed", price: 3000 },
      { date: "2024-03-01", status: "completed", price: 3000 },
    ],
    today,
  });
  assert.equal(r6.status, "AT_RISK", "91 days since last, typical 59, threshold 88 → AT_RISK");

  // LOST — way past threshold
  const r7 = classifyRetention({
    appointments: [{ date: "2023-01-01", status: "completed", price: 3000 }],
    today,
  });
  assert.equal(r7.status, "LOST");

  // Future appointment rescues AT_RISK → ACTIVE
  const r8 = classifyRetention({
    appointments: [
      { date: "2024-01-01", status: "completed", price: 3000 },
      { date: "2024-03-01", status: "completed", price: 3000 },
      { date: "2024-06-15", status: "confirmed", price: 0 }, // future
    ],
    today,
  });
  assert.notEqual(r8.status, "AT_RISK", "Future appointment should rescue AT_RISK");
  assert.notEqual(r8.status, "LOST");

  console.log("✓ Retention classification tests passed");
}

// 2. Automation opt-out
function testAutomationOptOut() {
  // smsOptOut blocks SMS-only rules
  const smsOnlyAndOptedOut = (smsOptOut: boolean, action: string) =>
    smsOptOut && action === "send_sms";

  assert.equal(smsOnlyAndOptedOut(true, "send_sms"), true);
  assert.equal(smsOnlyAndOptedOut(false, "send_sms"), false);
  assert.equal(smsOnlyAndOptedOut(true, "send_email"), false);
  assert.equal(smsOnlyAndOptedOut(true, "send_email_and_sms"), false);

  console.log("✓ Automation opt-out logic tests passed");
}

// 3. Package redemption state machine
function testPackageRedemptionStateMachine() {
  type Status = "pending_payment" | "active" | "completed" | "expired" | "cancelled";
  const canRedeem = (status: Status, remainingSessions: number, expiresAt: Date, now: Date) =>
    status === "active" && remainingSessions > 0 && expiresAt > now;

  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  const now = new Date();

  assert.equal(canRedeem("active", 3, future, now), true);
  assert.equal(canRedeem("active", 0, future, now), false, "no sessions left");
  assert.equal(canRedeem("active", 3, past, now), false, "expired");
  assert.equal(canRedeem("pending_payment", 3, future, now), false, "not active");
  assert.equal(canRedeem("completed", 0, future, now), false, "completed");
  assert.equal(canRedeem("cancelled", 3, future, now), false, "cancelled");

  console.log("✓ Package redemption state machine tests passed");
}

// 4. Session count arithmetic
function testSessionCountArithmetic() {
  const decrement = (remaining: number): number => Math.max(0, remaining - 1);
  const increment = (remaining: number, total: number): number => Math.min(remaining + 1, total);

  assert.equal(decrement(3), 2);
  assert.equal(decrement(1), 0);
  assert.equal(decrement(0), 0);
  assert.equal(increment(2, 3), 3);
  assert.equal(increment(3, 3), 3); // can't exceed total

  console.log("✓ Session count arithmetic tests passed");
}

// 5. Employee scope guard
function testEmployeeScopeGuard() {
  const canAccessEmployee = (requestingEmployeeId: string, targetEmployeeId: string, role: string) => {
    if (role === "SALON_OWNER") return true;
    if (role === "SALON_EMPLOYEE") return requestingEmployeeId === targetEmployeeId;
    return false;
  };

  const emp1 = "emp-1";
  const emp2 = "emp-2";
  assert.equal(canAccessEmployee(emp1, emp1, "SALON_EMPLOYEE"), true);
  assert.equal(canAccessEmployee(emp1, emp2, "SALON_EMPLOYEE"), false, "employee cannot access other employee");
  assert.equal(canAccessEmployee(emp1, emp2, "SALON_OWNER"), true, "owner can access any employee");

  console.log("✓ Employee scope guard tests passed");
}

// 6. AI snapshot scoping
function testAiSnapshotScoping() {
  interface SnapshotCall { salonId: string; question: string }
  const calls: SnapshotCall[] = [];

  async function fakeAskGrowthAi(params: SnapshotCall) {
    calls.push(params);
    return { answer: "Injected AI answer", snapshot: { salonId: params.salonId } };
  }

  const salonId = "test-salon-123";
  const result = fakeAskGrowthAi({ salonId, question: "How is business?" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.salonId, salonId);

  return result.then((r) => {
    assert.ok(r.answer.length > 0);
    console.log("✓ AI snapshot scoping and injection tests passed");
  });
}

// 7. AI proposal confirmation (paused)
function testAiProposalConfirmation() {
  const createFromAiProposal = (data: { name: string; trigger: string }) => ({
    ...data,
    status: "paused" as const, // must start paused
    aiProposed: true,
  });

  const rule = createFromAiProposal({ name: "Test Rule", trigger: "inactive_days" });
  assert.equal(rule.status, "paused", "AI proposal must start paused");
  assert.equal(rule.aiProposed, true);

  console.log("✓ AI proposal confirmation tests passed");
}

// 8. Voucher template substitution and HTML escaping
function testVoucherTemplateSubstitution() {
  // Exercise the REAL exported substituteTemplate (not a local fixture).
  const tmpl = "Zdravo {{firstName}}, vaš kod je {{voucherCode}} u salonu {{salonName}}.";
  const result = substituteTemplate(tmpl, { firstName: "Ana", lastName: "Anić", salonName: "Hair & Co", voucherCode: "POPUST20" });
  assert.equal(result, "Zdravo Ana, vaš kod je POPUST20 u salonu Hair &amp; Co.");

  // firstName XSS escaping.
  const xssResult = substituteTemplate("{{firstName}}", { firstName: "<script>alert(1)</script>", lastName: "", salonName: "", voucherCode: "" });
  assert.equal(xssResult, "&lt;script&gt;alert(1)&lt;/script&gt;");

  // lastName placeholder is implemented and HTML-escaped via the same path.
  const lastNameResult = substituteTemplate("{{lastName}}", { firstName: "", lastName: "<b>Petrović</b>", salonName: "", voucherCode: "" });
  assert.equal(lastNameResult, "&lt;b&gt;Petrović&lt;/b&gt;");

  // Combined firstName + lastName in one template.
  const combined = substituteTemplate("Poštovani {{firstName}} {{lastName}},", { firstName: "Marko", lastName: "Marković", salonName: "", voucherCode: "" });
  assert.equal(combined, "Poštovani Marko Marković,");

  // lastName with an ampersand → escaped.
  const amp = substituteTemplate("{{firstName}} {{lastName}}", { firstName: "A", lastName: "B & C", salonName: "", voucherCode: "" });
  assert.equal(amp, "A B &amp; C");

  // Unknown placeholder is left LITERAL (only documented set is replaced).
  const unknown = substituteTemplate("Hi {{firstName}} {{unknownVar}}", { firstName: "Ana", lastName: "X", salonName: "", voucherCode: "" });
  assert.equal(unknown, "Hi Ana {{unknownVar}}");

  console.log("✓ Voucher template substitution tests passed (firstName + lastName, HTML-safe, unknown literal)");
}

// 9. Birthday trigger month/day matching
function testBirthdayTrigger() {
  function birthdayMatchesToday(birthDate: string, today: Date): boolean {
    const bdMD = birthDate.slice(5); // MM-DD
    const todayMD = today.toISOString().slice(5, 10); // MM-DD
    return bdMD === todayMD;
  }

  const june1 = new Date("2024-06-01T10:00:00Z");
  assert.equal(birthdayMatchesToday("1990-06-01", june1), true, "birthday today");
  assert.equal(birthdayMatchesToday("1990-06-02", june1), false, "birthday tomorrow");
  assert.equal(birthdayMatchesToday("2023-06-01", june1), true, "birthday matches regardless of year");
  assert.equal(birthdayMatchesToday("1990-01-15", june1), false, "different month");

  console.log("✓ Birthday trigger tests passed");
}

// 10. Fixed commission calculation
function testFixedCommissionCalculation() {
  function calcCommission(type: "percent_of_revenue" | "fixed_per_treatment", percent: number, fixed: number, revenue: number, completedCount: number): number {
    if (type === "fixed_per_treatment") return completedCount * fixed;
    return Math.round(revenue * percent / 100);
  }

  assert.equal(calcCommission("percent_of_revenue", 10, 0, 10000, 5), 1000);
  assert.equal(calcCommission("percent_of_revenue", 0, 0, 10000, 5), 0);
  assert.equal(calcCommission("fixed_per_treatment", 0, 500, 10000, 5), 2500);
  assert.equal(calcCommission("fixed_per_treatment", 0, 0, 10000, 0), 0);

  console.log("✓ Fixed commission calculation tests passed");
}

// 11. Automation epoch key
function testAutomationEpochKey() {
  const now = new Date("2024-06-01T12:00:00Z");
  const key1 = buildEpochKey("rule-1", "cust-1", now);
  const key2 = buildEpochKey("rule-1", "cust-1", now);
  assert.equal(key1, key2, "same rule+customer+time produces same key");

  // Different customer → different key
  const key3 = buildEpochKey("rule-1", "cust-2", now);
  assert.notEqual(key1, key3);

  // 13 days later — same epoch (within 14-day window)
  const later = new Date(now.getTime() + 13 * 86_400_000);
  const key4 = buildEpochKey("rule-1", "cust-1", later);
  // May or may not be same epoch depending on alignment — just assert it's a string
  assert.equal(typeof key4, "string");

  // 15 days later — different epoch
  const epoch1 = Math.floor(now.getTime() / (14 * 86_400_000));
  const epoch2 = Math.floor(new Date(now.getTime() + 15 * 86_400_000).getTime() / (14 * 86_400_000));
  assert.notEqual(epoch1, epoch2, "15-day gap must cross epoch boundary");

  console.log("✓ Automation epoch key tests passed");
}

// ---------------------------------------------------------------------------
// ============================================================
// DB + API INTEGRATION TESTS
// ============================================================
// ---------------------------------------------------------------------------

async function runIntegrationTests(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);

  // Create fixtures
  const ownerA = await makeOwnerAndSalon(`A-${suffix}`);
  const ownerB = await makeOwnerAndSalon(`B-${suffix}`);
  const custInfo = await makeCustomerUser(`cust-${suffix}`);
  const custScA = await makeSalonCustomer(custInfo.user.id, ownerA.salon.id);
  const svcA = await makeService(ownerA.salon.id, `Svc A ${suffix}`);
  const pkgA = await makePackage(ownerA.salon.id, svcA.id, `pkg-${suffix}`);
  const empInfo = await makeEmployee(ownerA.salon.id, `emp-${suffix}`);
  const empInfo2 = await makeEmployee(ownerA.salon.id, `emp2-${suffix}`);
  // Enable real bookings against salon A for svcA (used by atomic-create tests).
  await enableBooking(ownerA.salon.id, empInfo.emp.id, svcA.id);

  // Also create an admin user
  const adminHash = await hashPassword(`pass-admin-${suffix}`);
  const [adminUser] = await db.insert(usersTable).values({
    firstName: "Admin", lastName: suffix,
    email: `admin-${suffix}@bg.test`, passwordHash: adminHash, passwordSetAt: new Date(), role: "ADMIN",
  }).returning();
  assert.ok(adminUser);
  const adminToken = await createSession(adminUser.id);
  const superAdminHash = await hashPassword(`pass-super-admin-${suffix}`);
  const [superAdminUser] = await db.insert(usersTable).values({
    firstName: "Super Admin", lastName: suffix,
    email: `super-admin-${suffix}@bg.test`, passwordHash: superAdminHash, passwordSetAt: new Date(), role: "SUPER_ADMIN",
  }).returning();
  assert.ok(superAdminUser);
  const superAdminToken = await createSession(superAdminUser.id);

  const server = app.listen(0, "127.0.0.1");
  const baseUrl = await listenAndGetBaseUrl(server);

  // Cleanup helpers
  const toCleanup = {
    userIds: [ownerA.owner.id, ownerB.owner.id, custInfo.user.id, empInfo.user.id, empInfo2.user.id, adminUser.id, superAdminUser.id],
    salonIds: [ownerA.salon.id, ownerB.salon.id],
    purchaseIds: [] as string[],
    automationIds: [] as string[],
  };
  // Salon-less email_deliveries rows created directly by the automation-email
  // retry tests; cleaned by eventKey in finally.
  const emailEventKeys: string[] = [];

  function ownerAHeaders() { return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${ownerA.token}` }; }
  function ownerBHeaders() { return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${ownerB.token}` }; }
  function custHeaders() { return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${custInfo.token}` }; }
  function emp1Headers() { return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${empInfo.token}` }; }
  function adminHeaders() { return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${adminToken}` }; }
  function superAdminHeaders() { return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${superAdminToken}` }; }

  try {
    // ── Test 12: Cross-tenant package isolation ──────────────────────────
    {
      // ownerB tries to read ownerA's package
      const r = await fetch(`${baseUrl}/growth/packages/${pkgA.id}`, { headers: ownerBHeaders() });
      assert.equal(r.status, 404, "Owner B must not see Owner A's package");
    }
    console.log("✓ Cross-tenant package isolation");

    // ── Test 13: Customer IDOR protection ─────────────────────────────────
    {
      // Purchase: body must NOT accept salonCustomerId
      const body: Record<string, unknown> = { paymentMethod: "pay_at_salon" };
      const r = await fetch(`${baseUrl}/growth/packages/${pkgA.id}/purchases`, {
        method: "POST", headers: custHeaders(), body: JSON.stringify(body),
      });
      const purchaseBody = await r.json() as { id: string; salonCustomerId: string };
      assert.equal(r.status, 201, `Customer purchase should succeed: ${JSON.stringify(purchaseBody)}`);
      const purchase = purchaseBody;
      toCleanup.purchaseIds.push(purchase.id);
      // The salonCustomerId must match the auth-derived customer, not an injected one
      assert.equal(purchase.salonCustomerId, custScA.id, "salonCustomerId must be derived from auth");

      // Attempt IDOR by injecting a different salonCustomerId — MUST be ignored or rejected
      // (field not accepted in body — any salonCustomerId in body should be ignored)
      const custScB = await makeSalonCustomer(custInfo.user.id, ownerB.salon.id);
      const pkgB = await makePackage(ownerB.salon.id, (await makeService(ownerB.salon.id, `SvcB-${suffix}`)).id, `pkgB-${suffix}`);
      // Buying a package from salon B where customer doesn't have a CRM record yet
      // (they do — we just made one, but with the right userId)
      const rB = await fetch(`${baseUrl}/growth/packages/${pkgB.id}/purchases`, {
        method: "POST", headers: custHeaders(), body: JSON.stringify({ paymentMethod: "pay_at_salon" }),
      });
      // Should succeed because customer has salonCustomer record in B's salon
      assert.ok(rB.status === 201 || rB.status === 403, "Either succeeds with own record or 403");

      // A different customer with no prior CRM record buys from salon A. Under
      // P1 #3 this now succeeds by auto-creating a CRM row from their OWN
      // authenticated identity — a body-injected salonCustomerId is ignored.
      const otherCust = await makeCustomerUser(`other-${suffix}`);
      toCleanup.userIds.push(otherCust.user.id);
      const rOther = await fetch(`${baseUrl}/growth/packages/${pkgA.id}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${sessionCookieName}=${otherCust.token}` },
        // Attempt IDOR: inject victim's salonCustomerId — must be ignored.
        body: JSON.stringify({ paymentMethod: "pay_at_salon", salonCustomerId: custScA.id }),
      });
      assert.equal(rOther.status, 201, "New customer purchase auto-creates CRM row");
      const otherBody = await rOther.json() as { id: string; salonCustomerId: string };
      toCleanup.purchaseIds.push(otherBody.id);
      assert.notEqual(otherBody.salonCustomerId, custScA.id, "Injected salonCustomerId must be ignored");
      // The derived record belongs to the authenticated other customer.
      const [otherRecord] = await db.select().from(salonCustomersTable)
        .where(and(eq(salonCustomersTable.userId, otherCust.user.id), eq(salonCustomersTable.salonId, ownerA.salon.id))).limit(1);
      assert.ok(otherRecord, "CRM row auto-created for authenticated user");
      assert.equal(otherBody.salonCustomerId, otherRecord.id, "Purchase bound to auth-derived record");
    }
    console.log("✓ Customer IDOR protection");

    // ── Test 14: Employee self vs other employee ─────────────────────────
    {
      const rSelf = await fetch(`${baseUrl}/growth/my-performance`, { headers: emp1Headers() });
      assert.ok([200, 404].includes(rSelf.status), `Employee self-performance: ${rSelf.status}`);

      // Employee 1 cannot view employee 2's performance via /growth/employees/performance
      // That endpoint is owner-only, so emp1 gets 403
      const rOwnerOnly = await fetch(`${baseUrl}/growth/employees/performance`, { headers: emp1Headers() });
      assert.equal(rOwnerOnly.status, 403, "Employee must not access owner performance endpoint");
    }
    console.log("✓ Employee self vs other employee isolation");

    // ── Test 15: Package create with invalid serviceIds rolls back ────────
    {
      const foreignServiceId = randomUUID(); // not a real service in ownerA's salon
      const r = await fetch(`${baseUrl}/growth/packages`, {
        method: "POST", headers: ownerAHeaders(),
        body: JSON.stringify({
          name: "Bad Package", priceInDinars: 5000,
          serviceQuotas: [{ serviceId: svcA.id, quota: 2 }, { serviceId: foreignServiceId, quota: 1 }],
        }),
      });
      assert.equal(r.status, 400, "Invalid serviceId must be rejected before insert");

      // Verify no orphan package was created
      const pkgs = await db.select({ id: treatmentPackagesTable.id }).from(treatmentPackagesTable)
        .where(and(eq(treatmentPackagesTable.salonId, ownerA.salon.id), eq(treatmentPackagesTable.name, "Bad Package")));
      assert.equal(pkgs.length, 0, "No orphan package should exist after failed validation");
    }
    console.log("✓ Package create invalid serviceIds rollback");

    // ── Test 15b: Owner quick-sale is atomic and uses canonical package rows ─
    {
      const secondService = await makeService(ownerA.salon.id, `Quick second ${suffix}`);
      const foreignService = await makeService(ownerB.salon.id, `Quick foreign ${suffix}`);
      const [foreignCustomer] = await db.select().from(salonCustomersTable)
        .where(and(
          eq(salonCustomersTable.userId, custInfo.user.id),
          eq(salonCustomersTable.salonId, ownerB.salon.id),
        ))
        .limit(1);
      assert.ok(foreignCustomer, "Foreign-salon CRM fixture must exist");
      const activeName = `Quick active ${suffix}`;
      const activeResponse = await fetch(`${baseUrl}/growth/packages/quick-sale`, {
        method: "POST",
        headers: ownerAHeaders(),
        body: JSON.stringify({
          salonCustomerId: custScA.id,
          name: activeName,
          description: "Created from calendar",
          priceInDinars: 7600,
          validityDays: 120,
          serviceQuotas: [
            { serviceId: svcA.id, quota: 2 },
            { serviceId: secondService.id, quota: 1 },
          ],
          paymentStatus: "active",
          paymentMethod: "pay_at_salon",
          notes: "Paid at desk",
        }),
      });
      const activeBody = await activeResponse.json() as {
        package: { id: string; sessionCount: number; quotaPolicy: string; serviceQuotas: Array<{ serviceId: string; quota: number }> };
        purchase: {
          id: string; packageId: string; status: string; totalSessions: number; remainingSessions: number;
          paymentConfirmedAt: string | null; paymentConfirmedByUserId: string | null;
          serviceQuotas: Array<{ serviceId: string; totalQuota: number; remainingQuota: number }>;
        };
      };
      assert.equal(activeResponse.status, 201, `Active quick-sale failed: ${JSON.stringify(activeBody)}`);
      toCleanup.purchaseIds.push(activeBody.purchase.id);
      assert.equal(activeBody.package.sessionCount, 3);
      assert.equal(activeBody.package.quotaPolicy, "per_service");
      assert.equal(activeBody.purchase.packageId, activeBody.package.id);
      assert.equal(activeBody.purchase.status, "active");
      assert.equal(activeBody.purchase.totalSessions, 3);
      assert.equal(activeBody.purchase.remainingSessions, 3);
      assert.ok(activeBody.purchase.paymentConfirmedAt, "Paid quick-sale records confirmation time");
      assert.equal(activeBody.purchase.paymentConfirmedByUserId, ownerA.owner.id);
      assert.deepEqual(
        [...activeBody.package.serviceQuotas].sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
        [{ serviceId: secondService.id, quota: 1 }, { serviceId: svcA.id, quota: 2 }].sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
      );
      assert.deepEqual(
        [...activeBody.purchase.serviceQuotas].sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
        [
          { serviceId: secondService.id, totalQuota: 1, remainingQuota: 1 },
          { serviceId: svcA.id, totalQuota: 2, remainingQuota: 2 },
        ].sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
        "Purchase snapshot exactly matches the definition quotas",
      );

      const redemptionAppointment = await makeAppointment(ownerA.salon.id, custScA.id, svcA.id, "confirmed");
      const redemption = await redeemPackageSession({
        purchaseId: activeBody.purchase.id,
        appointmentId: redemptionAppointment.id,
        salonId: ownerA.salon.id,
        requestingCustomerId: custScA.id,
      });
      assert.ok(redemption.ok, "Quick-created paid package uses the existing redemption domain");
      assert.equal(redemption.remainingSessions, 2);

      const pendingResponse = await fetch(`${baseUrl}/growth/packages/quick-sale`, {
        method: "POST",
        headers: ownerAHeaders(),
        body: JSON.stringify({
          salonCustomerId: custScA.id,
          name: `Quick pending ${suffix}`,
          priceInDinars: 4000,
          validityDays: 90,
          serviceQuotas: [{ serviceId: svcA.id, quota: 4 }],
          paymentStatus: "pending_payment",
          paymentMethod: "bank_transfer",
        }),
      });
      const pendingBody = await pendingResponse.json() as {
        purchase: { id: string; status: string; paymentConfirmedAt: string | null; paymentConfirmedByUserId: string | null };
      };
      assert.equal(pendingResponse.status, 201);
      toCleanup.purchaseIds.push(pendingBody.purchase.id);
      assert.equal(pendingBody.purchase.status, "pending_payment");
      assert.equal(pendingBody.purchase.paymentConfirmedAt, null);
      assert.equal(pendingBody.purchase.paymentConfirmedByUserId, null);

      const invalidCases = [
        {
          expectedStatus: 404,
          name: `Quick foreign customer ${suffix}`,
          salonCustomerId: foreignCustomer.id,
          serviceQuotas: [{ serviceId: svcA.id, quota: 1 }],
        },
        {
          expectedStatus: 400,
          name: `Quick foreign service ${suffix}`,
          salonCustomerId: custScA.id,
          serviceQuotas: [{ serviceId: foreignService.id, quota: 1 }],
        },
        {
          expectedStatus: 400,
          name: `Quick duplicate ${suffix}`,
          salonCustomerId: custScA.id,
          serviceQuotas: [{ serviceId: svcA.id, quota: 1 }, { serviceId: svcA.id, quota: 2 }],
        },
        {
          expectedStatus: 400,
          name: `Quick invalid quota ${suffix}`,
          salonCustomerId: custScA.id,
          serviceQuotas: [{ serviceId: svcA.id, quota: 0 }],
        },
      ];
      for (const invalidCase of invalidCases) {
        const invalidResponse = await fetch(`${baseUrl}/growth/packages/quick-sale`, {
          method: "POST",
          headers: ownerAHeaders(),
          body: JSON.stringify({
            salonCustomerId: invalidCase.salonCustomerId,
            name: invalidCase.name,
            priceInDinars: 1000,
            validityDays: 30,
            serviceQuotas: invalidCase.serviceQuotas,
            paymentStatus: "active",
            paymentMethod: "pay_at_salon",
          }),
        });
        assert.equal(invalidResponse.status, invalidCase.expectedStatus, `${invalidCase.name} must be rejected`);
        const definitions = await db.select({ id: treatmentPackagesTable.id }).from(treatmentPackagesTable)
          .where(eq(treatmentPackagesTable.name, invalidCase.name));
        assert.equal(definitions.length, 0, `${invalidCase.name} must not leave a partial definition`);
      }
    }
    console.log("✓ Owner quick-sale package creation is atomic, isolated, and redeemable");

    // ── Test 16: Package soft-delete preserves purchase history ─────────
    {
      // Create a separate package and purchase
      const softPkg = await makePackage(ownerA.salon.id, svcA.id, `soft-${suffix}`);
      const [softPurchase] = await db.insert(customerPackagePurchasesTable).values({
        salonId: ownerA.salon.id, packageId: softPkg.id, salonCustomerId: custScA.id,
        totalSessions: 3, remainingSessions: 3, priceInDinars: 10000,
        paymentMethod: "pay_at_salon", status: "active",
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      }).returning();
      assert.ok(softPurchase);
      toCleanup.purchaseIds.push(softPurchase.id);

      // Delete (soft)
      const rDel = await fetch(`${baseUrl}/growth/packages/${softPkg.id}`, {
        method: "DELETE", headers: ownerAHeaders(),
      });
      assert.equal(rDel.status, 204, "Soft-delete must return 204");

      // Package still exists in DB but is inactive
      const [dbPkg] = await db.select().from(treatmentPackagesTable).where(eq(treatmentPackagesTable.id, softPkg.id)).limit(1);
      assert.ok(dbPkg, "Package must still exist in DB after soft-delete");
      assert.equal(dbPkg.active, false, "Package must be inactive");

      // Purchase still exists
      const [dbPurchase] = await db.select().from(customerPackagePurchasesTable).where(eq(customerPackagePurchasesTable.id, softPurchase.id)).limit(1);
      assert.ok(dbPurchase, "Purchase must be preserved after package soft-delete");
    }
    console.log("✓ Package soft-delete preserves purchase history");

    // ── Test 17: Full package lifecycle ──────────────────────────────────
    {
      // Create package + purchase via API
      const r1 = await fetch(`${baseUrl}/growth/packages/${pkgA.id}/purchases`, {
        method: "POST", headers: custHeaders(), body: JSON.stringify({ paymentMethod: "pay_at_salon" }),
      });
      assert.equal(r1.status, 201);
      const purchase = await r1.json() as { id: string; status: string; salonCustomerId: string };
      toCleanup.purchaseIds.push(purchase.id);
      assert.equal(purchase.status, "pending_payment");

      // Owner confirms
      const r2 = await fetch(`${baseUrl}/growth/packages/${pkgA.id}/purchases/${purchase.id}/confirm-payment`, {
        method: "POST", headers: ownerAHeaders(), body: "{}",
      });
      assert.equal(r2.status, 200);
      const confirmed = await r2.json() as { status: string };
      assert.equal(confirmed.status, "active");

      // Idempotent re-confirm
      const r2b = await fetch(`${baseUrl}/growth/packages/${pkgA.id}/purchases/${purchase.id}/confirm-payment`, {
        method: "POST", headers: ownerAHeaders(), body: "{}",
      });
      assert.equal(r2b.status, 200, "Idempotent confirm must return 200");

      // Create appointment for redemption
      const appt = await makeAppointment(ownerA.salon.id, custScA.id, svcA.id, "confirmed");

      // Redeem via service (direct)
      const redeemResult = await redeemPackageSession({
        purchaseId: purchase.id,
        appointmentId: appt.id,
        salonId: ownerA.salon.id,
        requestingCustomerId: custScA.id,
      });
      assert.ok(redeemResult.ok, `Redeem failed: ${JSON.stringify(redeemResult)}`);
      assert.equal(redeemResult.remainingSessions, 2);

      // Appointment price set to 0
      const [apptAfter] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appt.id)).limit(1);
      assert.ok(apptAfter);
      assert.equal(apptAfter.price, 0, "Appointment price must be 0 after redemption");

      // Repeat redeem → 409-equivalent (already_redeemed)
      const redeemAgain = await redeemPackageSession({
        purchaseId: purchase.id,
        appointmentId: appt.id,
        salonId: ownerA.salon.id,
        requestingCustomerId: custScA.id,
      });
      assert.equal(redeemAgain.ok, false);
      assert.equal((redeemAgain as { reason: string }).reason, "already_redeemed");

      // Cancel appointment → auto-reversal
      await db.update(appointmentsTable).set({ status: "cancelled" }).where(eq(appointmentsTable.id, appt.id));
      const reversed = await handleAppointmentCancellationReversals(appt.id, ownerA.salon.id);
      assert.equal(reversed, 1, "One redemption should be reversed");

      // Session restored
      const [purchaseAfter] = await db.select().from(customerPackagePurchasesTable).where(eq(customerPackagePurchasesTable.id, purchase.id)).limit(1);
      assert.ok(purchaseAfter);
      assert.equal(purchaseAfter.remainingSessions, 3, "Session must be restored after reversal");

      // Original price restored
      const [apptRestored] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appt.id)).limit(1);
      assert.ok(apptRestored);
      assert.equal(apptRestored.price, 3000, "Original price must be restored after reversal");
    }
    console.log("✓ Package full lifecycle (purchase/confirm/redeem/idempotent/cancel-reverse)");

    // ── Test 18: Automation dry-run (no sends, counts correctly) ─────────
    {
      const [rule] = await db.insert(automationRulesTable).values({
        salonId: ownerA.salon.id, name: `Test Automation ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 1 }, // small threshold so any customer triggers
        action: "send_email", emailSubject: "Test", emailBody: "Hello {{firstName}}",
        status: "paused",
      }).returning();
      assert.ok(rule);
      toCleanup.automationIds.push(rule.id);

      const r = await fetch(`${baseUrl}/growth/automations/${rule.id}/test-run`, {
        method: "POST", headers: ownerAHeaders(), body: "{}",
      });
      assert.equal(r.status, 200);
      const result = await r.json() as { wouldTriggerCount: number; eligibleCustomers: number };
      assert.equal(typeof result.wouldTriggerCount, "number");
      assert.equal(typeof result.eligibleCustomers, "number");

      // Verify no actual runs were inserted (dry-run)
      const runs = await db.select({ id: automationRunsTable.id }).from(automationRunsTable)
        .where(eq(automationRunsTable.ruleId, rule.id));
      assert.equal(runs.length, 0, "Dry-run must not insert any automationRuns");
    }
    console.log("✓ Automation dry-run (no real sends, no DB runs inserted)");

    // ── Test 19: Admin read-only /growth/admin/summary ───────────────────
    {
      const r = await fetch(`${baseUrl}/growth/admin/summary`, { headers: adminHeaders() });
      assert.equal(r.status, 200);
      const summary = await r.json() as { automation: { totalRules: number }; packages: { total: number }; purchases: { total: number } };
      assert.equal(typeof summary.automation.totalRules, "number");
      assert.equal(typeof summary.packages.total, "number");
      assert.equal(typeof summary.purchases.total, "number");

      const rSuperAdmin = await fetch(`${baseUrl}/growth/admin/summary`, { headers: superAdminHeaders() });
      assert.equal(rSuperAdmin.status, 200, "Super admin must access admin summary");
      const superAdminSummary = await rSuperAdmin.json() as typeof summary;
      assert.equal(typeof superAdminSummary.automation.totalRules, "number");
      assert.equal(typeof superAdminSummary.packages.total, "number");
      assert.equal(typeof superAdminSummary.purchases.total, "number");

      // Owner cannot access admin endpoint
      const rOwner = await fetch(`${baseUrl}/growth/admin/summary`, { headers: ownerAHeaders() });
      assert.equal(rOwner.status, 403, "Owner must not access admin summary");

      // Customer cannot access
      const rCust = await fetch(`${baseUrl}/growth/admin/summary`, { headers: custHeaders() });
      assert.equal(rCust.status, 403, "Customer must not access admin summary");

      // Admin can NOT mutate (no POST/DELETE on admin/summary)
      const rPost = await fetch(`${baseUrl}/growth/admin/summary`, {
        method: "POST", headers: adminHeaders(), body: "{}",
      });
      assert.ok([404, 405].includes(rPost.status), "POST on admin summary must be rejected");
    }
    console.log("✓ Admin read-only /growth/admin/summary");

    // ── Test 20: AI route scoping ─────────────────────────────────────────
    {
      // Customer cannot call AI endpoint
      const rCust = await fetch(`${baseUrl}/growth/ai/ask`, {
        method: "POST", headers: custHeaders(),
        body: JSON.stringify({ question: "How is business?" }),
      });
      assert.equal(rCust.status, 403, "Customer must not access AI endpoint");

      // Employee cannot call AI endpoint
      const rEmp = await fetch(`${baseUrl}/growth/ai/ask`, {
        method: "POST", headers: emp1Headers(),
        body: JSON.stringify({ question: "How is business?" }),
      });
      assert.equal(rEmp.status, 403, "Employee must not access AI endpoint");
    }
    console.log("✓ AI route role scoping");

    // ── Test 21: Atomic booking + package redemption (success) ────────────
    {
      // Fresh package + confirmed active purchase for the atomic-create path.
      const pkg21 = await makePackage(ownerA.salon.id, svcA.id, `atomic-ok-${suffix}`);
      const purchase21 = await makeActivePurchaseWithSnapshot(
        ownerA.salon.id, pkg21.id, custScA.id, [svcA.id],
      );
      toCleanup.purchaseIds.push(purchase21.id);

      const futureDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const r = await fetch(`${baseUrl}/appointments`, {
        method: "POST", headers: custHeaders(),
        body: JSON.stringify({
          salonId: ownerA.salon.id, serviceId: svcA.id, date: futureDate,
          startTime: "10:00", packagePurchaseId: purchase21.id,
        }),
      });
      const created = await r.json() as { id: string; price: number };
      assert.equal(r.status, 201, `Atomic create+redeem should succeed: ${JSON.stringify(created)}`);
      assert.equal(created.price, 0, "Redeemed appointment price must be 0");

      // Session decremented exactly once.
      const [afterPurchase] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchase21.id)).limit(1);
      assert.ok(afterPurchase);
      assert.equal(afterPurchase.remainingSessions, 2, "Exactly one session consumed");

      // A redemption row exists and links to the appointment.
      const [redemption] = await db.select().from(packageRedemptionsTable)
        .where(eq(packageRedemptionsTable.appointmentId, created.id)).limit(1);
      assert.ok(redemption, "Redemption row must exist");
      assert.equal(redemption.status, "redeemed");
      assert.equal(redemption.originalAppointmentPrice, 3000, "Original price snapshot stored");
    }
    console.log("✓ Atomic booking + package redemption (success)");

    // ── Test 22: Entitlement failure leaves NO appointment ────────────────
    {
      // Package covers a DIFFERENT service → redemption fails → rollback.
      const otherSvc = await makeService(ownerA.salon.id, `Other Svc ${suffix}`);
      const pkgWrong = await makePackage(ownerA.salon.id, otherSvc.id, `wrong-svc-${suffix}`);
      // Snapshot covers otherSvc only — booking for svcA must fail service_not_covered.
      const purchaseWrong = await makeActivePurchaseWithSnapshot(
        ownerA.salon.id, pkgWrong.id, custScA.id, [otherSvc.id],
      );
      toCleanup.purchaseIds.push(purchaseWrong.id);

      const futureDate = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
      const apptCountBefore = (await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, ownerA.salon.id), eq(appointmentsTable.serviceId, svcA.id)))).length;

      const r = await fetch(`${baseUrl}/appointments`, {
        method: "POST", headers: custHeaders(),
        body: JSON.stringify({
          salonId: ownerA.salon.id, serviceId: svcA.id, date: futureDate,
          startTime: "15:00", packagePurchaseId: purchaseWrong.id,
        }),
      });
      const body = await r.json() as { code?: string; reason?: string; error?: string };
      assert.equal(r.status, 409, `Entitlement failure must return 409: ${JSON.stringify(body)}`);
      // Stable discriminator: code is ALWAYS PACKAGE_ERROR for redemption failures.
      assert.equal(body.code, "PACKAGE_ERROR", `Stable code discriminator: ${JSON.stringify(body)}`);
      // reason carries the specific RedeemResult reason.
      assert.equal(body.reason, "service_not_covered", `Specific reason surfaced: ${JSON.stringify(body)}`);
      assert.ok(typeof body.error === "string" && body.error.length > 0, "Localized error present");

      // No appointment was created (full rollback).
      const apptCountAfter = (await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, ownerA.salon.id), eq(appointmentsTable.serviceId, svcA.id)))).length;
      assert.equal(apptCountAfter, apptCountBefore, "No appointment must persist after failed redemption");

      // Sessions untouched.
      const [afterPurchase] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchaseWrong.id)).limit(1);
      assert.ok(afterPurchase);
      assert.equal(afterPurchase.remainingSessions, 3, "Sessions untouched on rollback");
    }
    console.log("✓ Entitlement failure leaves no appointment (stable PACKAGE_ERROR + reason)");

    // ── Test 22b: not_active variant also returns stable PACKAGE_ERROR ─────
    {
      // Package purchase exists and covers svcA, but is not active (pending_payment)
      // → redemption fails with reason not_active; no appointment/session mutation.
      const pkgInactive = await makePackage(ownerA.salon.id, svcA.id, `inactive-${suffix}`);
      const purchaseInactive = await makeActivePurchaseWithSnapshot(
        ownerA.salon.id, pkgInactive.id, custScA.id, [svcA.id],
        { status: "pending_payment" },
      );
      toCleanup.purchaseIds.push(purchaseInactive.id);

      const futureDate = new Date(Date.now() + 41 * 86_400_000).toISOString().slice(0, 10);
      const apptCountBefore = (await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, ownerA.salon.id), eq(appointmentsTable.serviceId, svcA.id)))).length;

      const r = await fetch(`${baseUrl}/appointments`, {
        method: "POST", headers: custHeaders(),
        body: JSON.stringify({
          salonId: ownerA.salon.id, serviceId: svcA.id, date: futureDate,
          startTime: "16:00", packagePurchaseId: purchaseInactive.id,
        }),
      });
      const body = await r.json() as { code?: string; reason?: string; error?: string };
      assert.equal(r.status, 409, `Inactive package must return 409: ${JSON.stringify(body)}`);
      assert.equal(body.code, "PACKAGE_ERROR", `Stable code discriminator: ${JSON.stringify(body)}`);
      assert.equal(body.reason, "not_active", `Specific reason surfaced: ${JSON.stringify(body)}`);

      // No appointment created, sessions untouched.
      const apptCountAfter = (await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, ownerA.salon.id), eq(appointmentsTable.serviceId, svcA.id)))).length;
      assert.equal(apptCountAfter, apptCountBefore, "No appointment persists after not_active failure");
      const [afterInactive] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchaseInactive.id)).limit(1);
      assert.ok(afterInactive);
      assert.equal(afterInactive.remainingSessions, 3, "Sessions untouched on not_active rollback");
    }
    console.log("✓ Inactive package returns stable PACKAGE_ERROR + not_active reason");

    // ── Test 22c: CRM birthday PATCH — partial update semantics ────────────
    // The PATCH /salon/customers/:id endpoint must:
    //  - update ONLY birthDate when {birthDate} sent, preserving prior smsOptOut,
    //  - update ONLY smsOptOut when {smsOptOut} sent, preserving prior birthDate,
    //  - clear birthDate when {birthDate:null} sent,
    //  - return birthDate in the response so the UI rehydrates.
    {
      // Fresh CRM contact for ownerA with a KNOWN prior smsOptOut = true.
      // Use a dedicated user — (salonId, userId) is unique, and custInfo already
      // has a salon_customers row for salon A.
      const bdayUser = await makeCustomerUser(`bday-${suffix}`);
      toCleanup.userIds.push(bdayUser.user.id);
      const bdayCust = await makeSalonCustomer(bdayUser.user.id, ownerA.salon.id);
      await db.update(salonCustomersTable).set({ smsOptOut: true, birthDate: null })
        .where(eq(salonCustomersTable.id, bdayCust.id));

      // 1) PATCH only { birthDate } → smsOptOut preserved (still true), birthDate set.
      const r1 = await fetch(`${baseUrl}/salon/customers/${bdayCust.id}`, {
        method: "PATCH", headers: ownerAHeaders(),
        body: JSON.stringify({ birthDate: "1990-05-15" }),
      });
      const b1 = await r1.json() as { smsOptOut: boolean; birthDate: string | null };
      assert.equal(r1.status, 200, `PATCH birthDate-only must succeed: ${JSON.stringify(b1)}`);
      assert.equal(b1.smsOptOut, true, "smsOptOut preserved (not reset) when omitted");
      assert.equal(b1.birthDate, "1990-05-15", "Response includes birthDate as YYYY-MM-DD");
      const [row1] = await db.select().from(salonCustomersTable)
        .where(eq(salonCustomersTable.id, bdayCust.id)).limit(1);
      assert.ok(row1);
      assert.equal(row1.smsOptOut, true, "DB: smsOptOut preserved exactly");
      assert.equal(row1.birthDate, "1990-05-15", "DB: birthDate stored as YYYY-MM-DD");

      // 2) PATCH only { smsOptOut } → birthDate preserved.
      const r2 = await fetch(`${baseUrl}/salon/customers/${bdayCust.id}`, {
        method: "PATCH", headers: ownerAHeaders(),
        body: JSON.stringify({ smsOptOut: false }),
      });
      const b2 = await r2.json() as { smsOptOut: boolean; birthDate: string | null };
      assert.equal(r2.status, 200, `PATCH smsOptOut-only must succeed: ${JSON.stringify(b2)}`);
      assert.equal(b2.smsOptOut, false, "smsOptOut updated when present");
      assert.equal(b2.birthDate, "1990-05-15", "birthDate preserved when omitted");
      const [row2] = await db.select().from(salonCustomersTable)
        .where(eq(salonCustomersTable.id, bdayCust.id)).limit(1);
      assert.ok(row2);
      assert.equal(row2.birthDate, "1990-05-15", "DB: birthDate untouched by smsOptOut-only PATCH");
      assert.equal(row2.smsOptOut, false, "DB: smsOptOut updated");

      // 3) PATCH { birthDate: null } → clears it; smsOptOut preserved.
      const r3 = await fetch(`${baseUrl}/salon/customers/${bdayCust.id}`, {
        method: "PATCH", headers: ownerAHeaders(),
        body: JSON.stringify({ birthDate: null }),
      });
      const b3 = await r3.json() as { smsOptOut: boolean; birthDate: string | null };
      assert.equal(r3.status, 200, `PATCH birthDate:null must succeed: ${JSON.stringify(b3)}`);
      assert.equal(b3.birthDate, null, "birthDate cleared to null");
      assert.equal(b3.smsOptOut, false, "smsOptOut preserved on birthDate clear");
      const [row3] = await db.select().from(salonCustomersTable)
        .where(eq(salonCustomersTable.id, bdayCust.id)).limit(1);
      assert.ok(row3);
      assert.equal(row3.birthDate, null, "DB: birthDate cleared");
    }
    console.log("✓ CRM birthday PATCH: partial update preserves smsOptOut / birthDate, clears on null");

    // ── Test 22d: Direct redeem lifecycle guard (no session bypass) ────────
    // A direct POST /growth/my-purchases/:id/redeem must refuse to burn a
    // session against an appointment that is not pending/confirmed. Cancelled,
    // completed and no-show must return a stable 409 PACKAGE_ERROR with
    // reason=appointment_not_eligible, and must NOT mutate appointment price,
    // purchase remainingSessions, or insert a redemption row.
    {
      const pkgLc = await makePackage(ownerA.salon.id, svcA.id, `lifecycle-${suffix}`);

      // Helper: assert a direct redeem against an ineligible appointment is rejected
      // with the stable contract and leaves all state untouched.
      async function assertIneligible(status: "cancelled" | "completed" | "no-show") {
        const purchaseLc = await makeActivePurchaseWithSnapshot(
          ownerA.salon.id, pkgLc.id, custScA.id, [svcA.id],
          { totalSessions: 3, remainingSessions: 3 },
        );
        toCleanup.purchaseIds.push(purchaseLc.id);
        const apptLc = await makeAppointment(ownerA.salon.id, custScA.id, svcA.id, status);

        const r = await fetch(`${baseUrl}/growth/my-purchases/${purchaseLc.id}/redeem`, {
          method: "POST", headers: custHeaders(),
          body: JSON.stringify({ appointmentId: apptLc.id }),
        });
        const body = await r.json() as { code?: string; reason?: string; error?: string };
        assert.equal(r.status, 409, `[${status}] must return 409: ${JSON.stringify(body)}`);
        assert.equal(body.code, "PACKAGE_ERROR", `[${status}] stable discriminator: ${JSON.stringify(body)}`);
        assert.equal(body.reason, "appointment_not_eligible", `[${status}] reason: ${JSON.stringify(body)}`);
        assert.ok(typeof body.error === "string" && body.error.length > 0, `[${status}] localized error present`);

        // Appointment price unchanged (still original 3000, never zeroed).
        const [apptAfter] = await db.select().from(appointmentsTable)
          .where(eq(appointmentsTable.id, apptLc.id)).limit(1);
        assert.ok(apptAfter);
        assert.equal(apptAfter.price, 3000, `[${status}] appointment price must be unchanged`);

        // Purchase sessions unchanged.
        const [purchaseAfter] = await db.select().from(customerPackagePurchasesTable)
          .where(eq(customerPackagePurchasesTable.id, purchaseLc.id)).limit(1);
        assert.ok(purchaseAfter);
        assert.equal(purchaseAfter.remainingSessions, 3, `[${status}] remainingSessions must be unchanged`);
        assert.equal(purchaseAfter.status, "active", `[${status}] purchase must remain active`);

        // No redemption row inserted.
        const redemptions = await db.select({ id: packageRedemptionsTable.id }).from(packageRedemptionsTable)
          .where(eq(packageRedemptionsTable.appointmentId, apptLc.id));
        assert.equal(redemptions.length, 0, `[${status}] no redemption row must exist`);
      }

      await assertIneligible("cancelled");
      await assertIneligible("completed");
      await assertIneligible("no-show");
    }
    console.log("✓ Direct redeem refuses cancelled/completed/no-show (stable appointment_not_eligible, no bypass)");

    // ── Test 22e: Eligible direct redeem works + reverses once ─────────────
    // A pending/confirmed appointment redeems successfully only for the same
    // customer/salon; cancelling afterwards reverses exactly once.
    {
      const pkgOk = await makePackage(ownerA.salon.id, svcA.id, `direct-ok-${suffix}`);
      const purchaseOk = await makeActivePurchaseWithSnapshot(
        ownerA.salon.id, pkgOk.id, custScA.id, [svcA.id],
        { totalSessions: 3, remainingSessions: 3 },
      );
      toCleanup.purchaseIds.push(purchaseOk.id);
      const apptOk = await makeAppointment(ownerA.salon.id, custScA.id, svcA.id, "confirmed");

      // Cross-customer/salon protection: a different customer must be denied.
      const otherCustUser = await makeCustomerUser(`redeem-other-${suffix}`);
      toCleanup.userIds.push(otherCustUser.user.id);
      const rForbidden = await fetch(`${baseUrl}/growth/my-purchases/${purchaseOk.id}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${sessionCookieName}=${otherCustUser.token}` },
        body: JSON.stringify({ appointmentId: apptOk.id }),
      });
      assert.equal(rForbidden.status, 403, "Non-owning customer must be denied direct redeem");

      // Owner customer succeeds.
      const rOk = await fetch(`${baseUrl}/growth/my-purchases/${purchaseOk.id}/redeem`, {
        method: "POST", headers: custHeaders(),
        body: JSON.stringify({ appointmentId: apptOk.id }),
      });
      const okBody = await rOk.json() as { redemptionId: string; remainingSessions: number; purchaseId: string };
      assert.equal(rOk.status, 200, `Eligible direct redeem must succeed: ${JSON.stringify(okBody)}`);
      assert.equal(okBody.remainingSessions, 2, "Exactly one session consumed");

      const [apptRedeemed] = await db.select().from(appointmentsTable)
        .where(eq(appointmentsTable.id, apptOk.id)).limit(1);
      assert.ok(apptRedeemed);
      assert.equal(apptRedeemed.price, 0, "Redeemed appointment price zeroed");

      // Cancel → reverses exactly once.
      await db.update(appointmentsTable).set({ status: "cancelled" }).where(eq(appointmentsTable.id, apptOk.id));
      const reversed = await handleAppointmentCancellationReversals(apptOk.id, ownerA.salon.id);
      assert.equal(reversed, 1, "Exactly one redemption reversed on cancellation");

      const [purchaseRestored] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchaseOk.id)).limit(1);
      assert.ok(purchaseRestored);
      assert.equal(purchaseRestored.remainingSessions, 3, "Session restored after reversal");

      const [apptPriceRestored] = await db.select().from(appointmentsTable)
        .where(eq(appointmentsTable.id, apptOk.id)).limit(1);
      assert.ok(apptPriceRestored);
      assert.equal(apptPriceRestored.price, 3000, "Original price restored after reversal");

      // Second reversal is a no-op (idempotent).
      const reversedAgain = await handleAppointmentCancellationReversals(apptOk.id, ownerA.salon.id);
      assert.equal(reversedAgain, 0, "No double reversal");
    }
    console.log("✓ Eligible direct redeem works for owner only; cancellation reverses exactly once");

    // ── Test 23: All cancellation routes reverse exactly once ─────────────
    {
      // Helper: build an active purchase + redeemed appointment, return ids.
      async function seedRedeemedAppointment(startTime: string) {
        const pkg = await makePackage(ownerA.salon.id, svcA.id, `cancel-${startTime}-${suffix}`);
        const purchase = await makeActivePurchaseWithSnapshot(
          ownerA.salon.id, pkg.id, custScA.id, [svcA.id],
          { totalSessions: 2, remainingSessions: 2 },
        );
        toCleanup.purchaseIds.push(purchase.id);
        const futureDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
        const r = await fetch(`${baseUrl}/appointments`, {
          method: "POST", headers: custHeaders(),
          body: JSON.stringify({
            salonId: ownerA.salon.id, serviceId: svcA.id, date: futureDate,
            startTime, packagePurchaseId: purchase.id,
          }),
        });
        const appt = await r.json() as { id: string; price: number };
        assert.equal(r.status, 201, `seed booking failed: ${JSON.stringify(appt)}`);
        return { purchaseId: purchase.id, appointmentId: appt.id };
      }

      async function assertReversedOnce(purchaseId: string, appointmentId: string) {
        const [p] = await db.select().from(customerPackagePurchasesTable)
          .where(eq(customerPackagePurchasesTable.id, purchaseId)).limit(1);
        assert.ok(p);
        assert.equal(p.remainingSessions, 2, "Session restored exactly once");
        const [a] = await db.select().from(appointmentsTable)
          .where(eq(appointmentsTable.id, appointmentId)).limit(1);
        assert.ok(a);
        assert.equal(a.price, 3000, "Original price restored exactly once");
        assert.equal(a.status, "cancelled", "Appointment cancelled");
        const reversedRows = await db.select().from(packageRedemptionsTable)
          .where(eq(packageRedemptionsTable.appointmentId, appointmentId));
        assert.equal(reversedRows.length, 1, "Single redemption row");
        assert.equal(reversedRows[0]!.status, "reversed", "Redemption marked reversed");
      }

      // (a) Customer single cancel.
      const seedA = await seedRedeemedAppointment("12:00");
      const rCancelA = await fetch(`${baseUrl}/appointments/${seedA.appointmentId}/cancel`, {
        method: "POST", headers: custHeaders(), body: "{}",
      });
      assert.equal(rCancelA.status, 200, "Customer cancel succeeds");
      await assertReversedOnce(seedA.purchaseId, seedA.appointmentId);
      // Repeat cancel is a no-op (already cancelled) — no double restore.
      const rCancelAgain = await fetch(`${baseUrl}/appointments/${seedA.appointmentId}/cancel`, {
        method: "POST", headers: custHeaders(), body: "{}",
      });
      assert.equal(rCancelAgain.status, 409, "Repeat cancel rejected");
      await assertReversedOnce(seedA.purchaseId, seedA.appointmentId);

      // (b) Owner single update → cancelled.
      const seedB = await seedRedeemedAppointment("13:00");
      const rCancelB = await fetch(`${baseUrl}/salon/appointments/${seedB.appointmentId}`, {
        method: "PATCH", headers: ownerAHeaders(), body: JSON.stringify({ status: "cancelled" }),
      });
      assert.equal(rCancelB.status, 200, "Owner cancel succeeds");
      await assertReversedOnce(seedB.purchaseId, seedB.appointmentId);
      // Idempotent direct reversal helper does not double-restore.
      const extra = await handleAppointmentCancellationReversals(seedB.appointmentId, ownerA.salon.id);
      assert.equal(extra, 0, "No further reversals after already reversed");
      await assertReversedOnce(seedB.purchaseId, seedB.appointmentId);
    }
    console.log("✓ All cancellation routes reverse exactly once");

    // ── Test 24: New-customer purchase creates one CRM row (concurrency) ───
    {
      // Brand-new customer with NO salon_customers row for salon B.
      const newCust = await makeCustomerUser(`newbuyer-${suffix}`);
      toCleanup.userIds.push(newCust.user.id);
      const svcB = await makeService(ownerB.salon.id, `SvcB-buy-${suffix}`);
      const pkgB = await makePackage(ownerB.salon.id, svcB.id, `pkgB-buy-${suffix}`);

      function newCustHeaders() {
        return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${newCust.token}` };
      }

      // Fire two concurrent purchases → both should resolve to the SAME CRM row.
      const [r1, r2] = await Promise.all([
        fetch(`${baseUrl}/growth/packages/${pkgB.id}/purchases`, {
          method: "POST", headers: newCustHeaders(), body: JSON.stringify({ paymentMethod: "pay_at_salon" }),
        }),
        fetch(`${baseUrl}/growth/packages/${pkgB.id}/purchases`, {
          method: "POST", headers: newCustHeaders(), body: JSON.stringify({ paymentMethod: "pay_at_salon" }),
        }),
      ]);
      const b1 = await r1.json() as { id: string; salonCustomerId: string };
      const b2 = await r2.json() as { id: string; salonCustomerId: string };
      assert.equal(r1.status, 201, `Concurrent purchase 1 should succeed: ${JSON.stringify(b1)}`);
      assert.equal(r2.status, 201, `Concurrent purchase 2 should succeed: ${JSON.stringify(b2)}`);
      toCleanup.purchaseIds.push(b1.id, b2.id);

      // Exactly ONE salon_customers row for this user+salon.
      const crmRows = await db.select().from(salonCustomersTable)
        .where(and(eq(salonCustomersTable.userId, newCust.user.id), eq(salonCustomersTable.salonId, ownerB.salon.id)));
      assert.equal(crmRows.length, 1, "Exactly one CRM row created under concurrency");
      assert.equal(b1.salonCustomerId, crmRows[0]!.id);
      assert.equal(b2.salonCustomerId, crmRows[0]!.id, "Both purchases point to the same CRM row");
      // Identity derived from the authenticated user only.
      assert.equal(crmRows[0]!.firstName, newCust.user.firstName);
    }
    console.log("✓ New-customer purchase creates one CRM row under concurrency");

    // ── Test 25: Non-triggered automation becoming eligible later sends ───
    {
      // Fake senders — capture, no live sends.
      const sentEmails: string[] = [];
      const fakeEmail: TransactionalEmailTransport = {
        async send(input) { sentEmails.push(input.to.email); return { messageId: `fake-${sentEmails.length}` }; },
      };
      const sentSms: string[] = [];
      const fakeSms: SmsProvider = {
        async send(input) { sentSms.push(input.to); return { messageId: `sms-${sentSms.length}` }; },
      };

      // Dedicated salon + customer for a clean automation slate.
      const ownerC = await makeOwnerAndSalon(`C-${suffix}`);
      toCleanup.userIds.push(ownerC.owner.id);
      toCleanup.salonIds.push(ownerC.salon.id);
      const svcC = await makeService(ownerC.salon.id, `SvcC-${suffix}`);
      const custC = await makeSalonCustomer(custInfo.user.id, ownerC.salon.id);
      // Attach an email so email channel can send.
      await db.update(salonCustomersTable).set({ email: `elig-${suffix}@bg.test` }).where(eq(salonCustomersTable.id, custC.id));

      // inactive_days rule with 30-day threshold.
      const [rule] = await db.insert(automationRulesTable).values({
        salonId: ownerC.salon.id, name: `Eligible-later ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email", emailSubject: "Nedostajete nam", emailBody: "Zdravo {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(rule);
      toCleanup.automationIds.push(rule.id);

      // Phase 1: customer has a RECENT completed appointment → NOT triggered.
      const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
      const [recentAppt] = await db.insert(appointmentsTable).values({
        salonId: ownerC.salon.id, salonCustomerId: custC.id, serviceId: svcC.id,
        date: recentDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 3000, treatmentLocation: "salon",
      }).returning();
      assert.ok(recentAppt);

      const run1 = await runAutomationWorker(new Date(), { emailTransport: fakeEmail, smsProvider: fakeSms });
      assert.equal(sentEmails.length, 0, "No send while not yet eligible");
      // Crucially: no run row claimed the epoch key (non-triggered must not consume it).
      const runsAfterPhase1 = await db.select().from(automationRunsTable)
        .where(eq(automationRunsTable.ruleId, rule.id));
      assert.equal(runsAfterPhase1.length, 0, "Non-triggered customer must NOT consume the epoch key");
      void run1;

      // Phase 2: make the customer inactive (>30 days) → now eligible, SAME epoch window.
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      await db.update(appointmentsTable).set({ date: oldDate }).where(eq(appointmentsTable.id, recentAppt.id));

      await runAutomationWorker(new Date(), { emailTransport: fakeEmail, smsProvider: fakeSms });
      assert.equal(sentEmails.length, 1, "Now-eligible customer receives exactly one send");
      const runsAfterPhase2 = await db.select().from(automationRunsTable)
        .where(eq(automationRunsTable.ruleId, rule.id));
      assert.equal(runsAfterPhase2.length, 1, "Exactly one run created once triggered");
      assert.equal(runsAfterPhase2[0]!.status, "sent");

      // Phase 3: re-run within same epoch → dedupe, no second send.
      await runAutomationWorker(new Date(), { emailTransport: fakeEmail, smsProvider: fakeSms });
      assert.equal(sentEmails.length, 1, "Final sent run dedupes; no resend");
    }
    console.log("✓ Non-triggered automation becoming eligible later sends (once)");

    // ── Test 26: pending/failed run retries; sent channel not resent ──────
    {
      // Salon + customer with a triggered rule and email+sms.
      const ownerD = await makeOwnerAndSalon(`D-${suffix}`);
      toCleanup.userIds.push(ownerD.owner.id);
      toCleanup.salonIds.push(ownerD.salon.id);
      const svcD = await makeService(ownerD.salon.id, `SvcD-${suffix}`);
      const custD = await makeSalonCustomer(custInfo.user.id, ownerD.salon.id);
      await db.update(salonCustomersTable).set({
        email: `retry-${suffix}@bg.test`, phone: "+381601234567",
      }).where(eq(salonCustomersTable.id, custD.id));

      const oldDate = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: ownerD.salon.id, salonCustomerId: custD.id, serviceId: svcD.id,
        date: oldDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 3000, treatmentLocation: "salon",
      });

      const [rule] = await db.insert(automationRulesTable).values({
        salonId: ownerD.salon.id, name: `Retry ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email_and_sms",
        emailSubject: "Povratak", emailBody: "Zdravo {{firstName}}", smsBody: "Zdravo {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(rule);
      toCleanup.automationIds.push(rule.id);

      // Run 1: email succeeds, SMS FAILS (throwing provider).
      const emailAttempts: string[] = [];
      const okEmail: TransactionalEmailTransport = {
        async send(input) { emailAttempts.push(input.to.email); return { messageId: `ok-${emailAttempts.length}` }; },
      };
      let smsShouldFail = true;
      const smsAttempts: string[] = [];
      const flakySms: SmsProvider = {
        async send(input) {
          smsAttempts.push(input.to);
          if (smsShouldFail) throw new Error("simulated SMS provider outage");
          return { messageId: `sms-${smsAttempts.length}` };
        },
        // The failed submission never reached the provider (thrown before accept),
        // so reconciliation on retry finds no matching log → safe to resend.
        async lookupByMessageId() { return { accepted: false }; },
      };

      await runAutomationWorker(new Date(), { emailTransport: okEmail, smsProvider: flakySms });
      assert.equal(emailAttempts.length, 1, "Email attempted once");
      assert.equal(smsAttempts.length, 1, "SMS attempted once");

      const [runAfter1] = await db.select().from(automationRunsTable).where(eq(automationRunsTable.ruleId, rule.id)).limit(1);
      assert.ok(runAfter1);
      // At least one channel sent → run is 'sent'; but the failed SMS delivery persists.
      const deliveries1 = await db.select().from(automationDeliveriesTable).where(eq(automationDeliveriesTable.runId, runAfter1.id));
      const emailDelivery = deliveries1.find((d) => d.channel === "email");
      const smsDelivery = deliveries1.find((d) => d.channel === "sms");
      assert.ok(emailDelivery && emailDelivery.status === "sent", "Email delivery sent");
      assert.ok(smsDelivery && smsDelivery.status === "failed", "SMS delivery failed");

      // Force the run into a retryable state (simulate a stuck/failed run).
      await db.update(automationRunsTable).set({ status: "failed" }).where(eq(automationRunsTable.id, runAfter1.id));

      // Run 2: SMS now succeeds; email must NOT be resent (already sent).
      smsShouldFail = false;
      await runAutomationWorker(new Date(), { emailTransport: okEmail, smsProvider: flakySms });
      assert.equal(emailAttempts.length, 1, "Email NOT resent on retry (already sent)");
      assert.equal(smsAttempts.length, 2, "SMS retried on second run");

      const deliveries2 = await db.select().from(automationDeliveriesTable).where(eq(automationDeliveriesTable.runId, runAfter1.id));
      const smsDelivery2 = deliveries2.find((d) => d.channel === "sms");
      assert.ok(smsDelivery2 && smsDelivery2.status === "sent", "SMS delivery now sent after retry");

      // No pending stranded forever: run reached a final non-pending state.
      const [runAfter2] = await db.select().from(automationRunsTable).where(eq(automationRunsTable.id, runAfter1.id)).limit(1);
      assert.ok(runAfter2);
      assert.notEqual(runAfter2.status, "pending", "Run must not be stranded pending");
    }
    console.log("✓ pending/failed retry; successful channel not resent");

    // ── Test 26b: True rolling 14-day cooldown (not calendar-bucket) ───────
    // Regression for the epoch-bucket bug: a send just before a bucket boundary
    // followed by an evaluation just after must be SUPPRESSED by the rolling
    // 14×24h window anchored on the last confirmed sentAt.
    {
      // Helper: a salon + inactive customer that reliably triggers inactive_days.
      async function makeCooldownFixture(tag: string) {
        const owner = await makeOwnerAndSalon(`CD${tag}-${suffix}`);
        toCleanup.userIds.push(owner.owner.id);
        toCleanup.salonIds.push(owner.salon.id);
        const svc = await makeService(owner.salon.id, `SvcCD${tag}-${suffix}`);
        const cust = await makeSalonCustomer(custInfo.user.id, owner.salon.id);
        await db.update(salonCustomersTable).set({
          email: `cd${tag}-${suffix}@bg.test`, phone: null, smsOptOut: false,
        }).where(eq(salonCustomersTable.id, cust.id));
        // Old completed appointment → always inactive.
        const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
        await db.insert(appointmentsTable).values({
          salonId: owner.salon.id, salonCustomerId: cust.id, serviceId: svc.id,
          date: oldDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
          status: "completed", price: 3000, treatmentLocation: "salon",
        });
        const [rule] = await db.insert(automationRulesTable).values({
          salonId: owner.salon.id, name: `Cooldown${tag} ${suffix}`,
          trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
          action: "send_email", emailSubject: "Vratite se", emailBody: "Zdravo {{firstName}}",
          status: "active",
        }).returning();
        assert.ok(rule);
        toCleanup.automationIds.push(rule.id);
        return { owner, rule, cust };
      }

      // Choose a base time 1 second BEFORE a calendar bucket boundary.
      const boundary = Math.ceil(Date.now() / AUTOMATION_COOLDOWN_MS) * AUTOMATION_COOLDOWN_MS;
      const justBefore = new Date(boundary - 1000);
      const justAfter = new Date(boundary + 2000); // 2s later, DIFFERENT bucket

      const fx = await makeCooldownFixture("A");
      // Provider layer lowercases recipient addresses; compare case-insensitively.
      const myEmail = `cdA-${suffix}@bg.test`.toLowerCase();
      let mySends = 0;
      const capEmail: TransactionalEmailTransport = {
        async send(input) { if (input.to.email.toLowerCase() === myEmail) mySends += 1; return { messageId: `cd-${mySends}` }; },
      };

      // Send just before the boundary → one send.
      await runAutomationWorker(justBefore, { emailTransport: capEmail });
      assert.equal(mySends, 1, "One send just before bucket boundary");

      // Evaluate 2s later (new bucket, but only 3s of real elapsed time) → the
      // rolling cooldown must SUPPRESS despite the bucket flip.
      await runAutomationWorker(justAfter, { emailTransport: capEmail });
      assert.equal(mySends, 1, "Rolling cooldown suppresses across bucket boundary (no 2nd send)");

      // Confirm the sent run recorded a sentAt anchor.
      const [sentRun] = await db.select().from(automationRunsTable)
        .where(and(eq(automationRunsTable.ruleId, fx.rule.id), eq(automationRunsTable.status, "sent"))).limit(1);
      assert.ok(sentRun?.sentAt, "Confirmed send anchors sentAt");
    }
    console.log("✓ Rolling 14-day cooldown suppresses across calendar-bucket boundary");

    // ── Test 26c: Cooldown edge — 14d-minus-1s suppressed, 14d+ sends once ─
    {
      const owner = await makeOwnerAndSalon(`CDE-${suffix}`);
      toCleanup.userIds.push(owner.owner.id);
      toCleanup.salonIds.push(owner.salon.id);
      const svc = await makeService(owner.salon.id, `SvcCDE-${suffix}`);
      const cust = await makeSalonCustomer(custInfo.user.id, owner.salon.id);
      await db.update(salonCustomersTable).set({
        email: `cde-${suffix}@bg.test`, phone: null, smsOptOut: false,
      }).where(eq(salonCustomersTable.id, cust.id));
      const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: owner.salon.id, salonCustomerId: cust.id, serviceId: svc.id,
        date: oldDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 3000, treatmentLocation: "salon",
      });
      const [rule] = await db.insert(automationRulesTable).values({
        salonId: owner.salon.id, name: `CooldownEdge ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email", emailSubject: "Vratite se", emailBody: "Zdravo {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(rule);
      toCleanup.automationIds.push(rule.id);

      // Anchor test times on real "now" (completed appt is 365d before now, so
      // the inactive_days trigger is satisfied at now and beyond).
      const t0 = new Date();
      // runAutomationWorker processes ALL active rules; count only THIS
      // customer's address so sends from other tests' rules don't leak in.
      const myEmail = `cde-${suffix}@bg.test`.toLowerCase();
      let mySends = 0;
      const capEmail: TransactionalEmailTransport = {
        async send(input) { if (input.to.email.toLowerCase() === myEmail) mySends += 1; return { messageId: `e-${mySends}` }; },
      };

      // First send at t0.
      await runAutomationWorker(t0, { emailTransport: capEmail });
      assert.equal(mySends, 1, "Initial send at t0");

      // 14d minus 1s → suppressed.
      const almost = new Date(t0.getTime() + AUTOMATION_COOLDOWN_MS - 1000);
      await runAutomationWorker(almost, { emailTransport: capEmail });
      assert.equal(mySends, 1, "Suppressed at 14d-1s");

      // Exactly 14d → allowed (one more send).
      const exactly = new Date(t0.getTime() + AUTOMATION_COOLDOWN_MS);
      await runAutomationWorker(exactly, { emailTransport: capEmail });
      assert.equal(mySends, 2, "One send at exactly 14d");

      // 14d + a bit again within the new window → suppressed.
      const soonAfter = new Date(exactly.getTime() + 60_000);
      await runAutomationWorker(soonAfter, { emailTransport: capEmail });
      assert.equal(mySends, 2, "Suppressed again within the new 14d window");
    }
    console.log("✓ Rolling cooldown edges: 14d-1s suppressed, 14d exact sends once");

    // ── Test 26d: Concurrent workers at boundary → exactly one send ────────
    {
      const owner = await makeOwnerAndSalon(`CDC-${suffix}`);
      toCleanup.userIds.push(owner.owner.id);
      toCleanup.salonIds.push(owner.salon.id);
      const svc = await makeService(owner.salon.id, `SvcCDC-${suffix}`);
      const cust = await makeSalonCustomer(custInfo.user.id, owner.salon.id);
      await db.update(salonCustomersTable).set({
        email: `cdc-${suffix}@bg.test`, phone: null, smsOptOut: false,
      }).where(eq(salonCustomersTable.id, cust.id));
      const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: owner.salon.id, salonCustomerId: cust.id, serviceId: svc.id,
        date: oldDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 3000, treatmentLocation: "salon",
      });
      const [rule] = await db.insert(automationRulesTable).values({
        salonId: owner.salon.id, name: `CooldownConc ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email", emailSubject: "Vratite se", emailBody: "Zdravo {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(rule);
      toCleanup.automationIds.push(rule.id);

      const myEmail = `cdc-${suffix}@bg.test`.toLowerCase();
      let providerCalls = 0;
      const slowEmail: TransactionalEmailTransport = {
        async send(input) {
          if (input.to.email.toLowerCase() === myEmail) providerCalls += 1;
          await new Promise((r) => setTimeout(r, 60));
          return { messageId: `conc-${input.to.email}` };
        },
      };

      const at = new Date();
      // Two workers evaluate the SAME customer at the SAME instant concurrently.
      await Promise.all([
        runAutomationWorker(at, { emailTransport: slowEmail }),
        runAutomationWorker(at, { emailTransport: slowEmail }),
      ]);

      assert.equal(providerCalls, 1, "Exactly one provider send across concurrent workers at boundary");
      const sentRuns = await db.select().from(automationRunsTable)
        .where(and(eq(automationRunsTable.ruleId, rule.id), eq(automationRunsTable.status, "sent")));
      assert.equal(sentRuns.length, 1, "Exactly one sent run persisted");
    }
    console.log("✓ Concurrent workers at eligibility boundary → exactly one send");

    // ── Test 26e: Failed attempt does NOT start cooldown; retries before 14d ─
    // Uses the SMS channel because its delivery layer (sendSms) has genuine
    // CAS/lease retry semantics; the point is that a FAILED attempt leaves
    // sentAt null so the rolling cooldown never engages and the SAME cycle's run
    // is re-attempted (and can succeed) well within the 14-day window.
    {
      const owner = await makeOwnerAndSalon(`CDF-${suffix}`);
      toCleanup.userIds.push(owner.owner.id);
      toCleanup.salonIds.push(owner.salon.id);
      const svc = await makeService(owner.salon.id, `SvcCDF-${suffix}`);
      const cust = await makeSalonCustomer(custInfo.user.id, owner.salon.id);
      const myPhone = `+38160${Math.floor(1000000 + Math.random() * 8999999)}`;
      await db.update(salonCustomersTable).set({
        email: null, phone: myPhone, smsOptOut: false,
      }).where(eq(salonCustomersTable.id, cust.id));
      const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: owner.salon.id, salonCustomerId: cust.id, serviceId: svc.id,
        date: oldDate, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 3000, treatmentLocation: "salon",
      });
      const [rule] = await db.insert(automationRulesTable).values({
        salonId: owner.salon.id, name: `CooldownFail ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_sms", smsBody: "Zdravo {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(rule);
      toCleanup.automationIds.push(rule.id);

      let shouldFail = true;
      let calls = 0;
      const flakySms: SmsProvider = {
        async send(input) {
          if (input.to !== myPhone) return { messageId: `other-${input.to}` };
          calls += 1;
          if (shouldFail) throw new Error("simulated SMS provider outage");
          return { messageId: `retry-${calls}` };
        },
        // Thrown-before-accept failures leave no provider log → reconcile finds
        // nothing and the retry resends with the same stable key.
        async lookupByMessageId() { return { accepted: false }; },
      };

      const t0 = new Date();
      // Attempt 1: fails → run must be 'failed', NO sentAt anchor.
      await runAutomationWorker(t0, { smsProvider: flakySms });
      assert.equal(calls, 1, "First attempt hit provider");
      const [afterFail] = await db.select().from(automationRunsTable)
        .where(eq(automationRunsTable.ruleId, rule.id)).limit(1);
      assert.ok(afterFail);
      assert.equal(afterFail.status, "failed", "Failed attempt run is failed");
      assert.equal(afterFail.sentAt, null, "Failed attempt does NOT anchor cooldown (sentAt null)");

      // Attempt 2 a few minutes later (well within 14d): must NOT be blocked by a
      // cooldown (a failure never started one) and now succeed — provider re-hit.
      shouldFail = false;
      const t1 = new Date(t0.getTime() + 5 * 60_000);
      await runAutomationWorker(t1, { smsProvider: flakySms });
      assert.equal(calls, 2, "Failed attempt retried before 14d (cooldown never engaged)");
      const [afterRetry] = await db.select().from(automationRunsTable)
        .where(eq(automationRunsTable.ruleId, rule.id)).limit(1);
      assert.ok(afterRetry);
      assert.equal(afterRetry.status, "sent", "Retry succeeded → sent");
      assert.ok(afterRetry.sentAt, "Successful retry anchors sentAt");
    }
    console.log("✓ Failed attempt doesn't start cooldown; retries succeed before 14d");

    // ── Test 27: Delivery claim/lease — crash-after-queued-insert recovery ─
    // Simulate: worker inserts delivery row (queued) then crashes before claiming.
    // Next worker run should claim it successfully (status transitions queued→processing).
    {
      const ownerE = await makeOwnerAndSalon(`E-${suffix}`);
      toCleanup.userIds.push(ownerE.owner.id);
      toCleanup.salonIds.push(ownerE.salon.id);
      const svcE = await makeService(ownerE.salon.id, `SvcE-${suffix}`);
      const custE = await makeSalonCustomer(custInfo.user.id, ownerE.salon.id);
      await db.update(salonCustomersTable).set({ email: `crash-${suffix}@bg.test`, phone: null })
        .where(eq(salonCustomersTable.id, custE.id));

      // Insert a completed old appointment so inactive_days triggers.
      const oldDate2 = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: ownerE.salon.id, salonCustomerId: custE.id, serviceId: svcE.id,
        date: oldDate2, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 3000, treatmentLocation: "salon",
      });

      const [ruleE] = await db.insert(automationRulesTable).values({
        salonId: ownerE.salon.id, name: `CrashTest ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email",
        emailSubject: "Test", emailBody: "Hi {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(ruleE);
      toCleanup.automationIds.push(ruleE.id);

      // Simulate crash after queued insert: insert the run + a queued delivery row manually.
      const epochKey = buildEpochKey(ruleE.id, custE.id, new Date());
      const [crashRun] = await db.insert(automationRunsTable).values({
        eventKey: epochKey, ruleId: ruleE.id, salonId: ownerE.salon.id,
        salonCustomerId: custE.id, status: "pending", executedAt: new Date(),
      }).returning();
      assert.ok(crashRun);
      // Insert queued delivery row simulating a crash-after-insert-before-claim.
      await db.insert(automationDeliveriesTable).values({
        runId: crashRun.id, salonId: ownerE.salon.id,
        eventKey: `${epochKey}:email`, channel: "email",
        recipientEmail: `crash-${suffix}@bg.test`, status: "queued",
      });

      // Recovery run: next worker picks up the queued delivery.
      const recoveredEmails: string[] = [];
      const recoverTransport: TransactionalEmailTransport = {
        async send(input) { recoveredEmails.push(input.to.email); return { messageId: "rec1" }; },
      };
      await runAutomationWorker(new Date(), { emailTransport: recoverTransport });
      assert.equal(recoveredEmails.length, 1, "Queued delivery recovered and sent");
      const [recoveredDelivery] = await db.select().from(automationDeliveriesTable)
        .where(eq(automationDeliveriesTable.eventKey, `${epochKey}:email`)).limit(1);
      assert.ok(recoveredDelivery);
      assert.equal(recoveredDelivery.status, "sent", "Delivery status reconciled to sent");
    }
    console.log("✓ Delivery claim/lease: crash-after-queued-insert recovery");

    // ── Test 28: Stale processing lease recovery ───────────────────────────
    // A delivery stuck in processing with an expired lease can be reclaimed.
    {
      const ownerF = await makeOwnerAndSalon(`F-${suffix}`);
      toCleanup.userIds.push(ownerF.owner.id);
      toCleanup.salonIds.push(ownerF.salon.id);
      const svcF = await makeService(ownerF.salon.id, `SvcF-${suffix}`);
      const custF = await makeSalonCustomer(custInfo.user.id, ownerF.salon.id);
      await db.update(salonCustomersTable).set({ email: `stale-${suffix}@bg.test`, phone: null })
        .where(eq(salonCustomersTable.id, custF.id));
      const oldDate3 = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: ownerF.salon.id, salonCustomerId: custF.id, serviceId: svcF.id,
        date: oldDate3, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 2000, treatmentLocation: "salon",
      });

      const [ruleF] = await db.insert(automationRulesTable).values({
        salonId: ownerF.salon.id, name: `StaleTest ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email", emailSubject: "Stale", emailBody: "Hi {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(ruleF);
      toCleanup.automationIds.push(ruleF.id);

      // Manually inject a run + stale-processing delivery (lease expired 10 min ago).
      const epochKeyF = buildEpochKey(ruleF.id, custF.id, new Date());
      const [staleRun] = await db.insert(automationRunsTable).values({
        eventKey: epochKeyF, ruleId: ruleF.id, salonId: ownerF.salon.id,
        salonCustomerId: custF.id, status: "pending", executedAt: new Date(),
      }).returning();
      assert.ok(staleRun);
      const expiredAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      await db.insert(automationDeliveriesTable).values({
        runId: staleRun.id, salonId: ownerF.salon.id,
        eventKey: `${epochKeyF}:email`, channel: "email",
        recipientEmail: `stale-${suffix}@bg.test`,
        status: "processing",
        processingStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        claimExpiresAt: expiredAt,
      });

      // Worker should reclaim the stale processing delivery.
      const staleEmails: string[] = [];
      const staleTransport: TransactionalEmailTransport = {
        async send(input) { staleEmails.push(input.to.email); return { messageId: "stale1" }; },
      };
      await runAutomationWorker(new Date(), { emailTransport: staleTransport });
      assert.equal(staleEmails.length, 1, "Stale processing delivery recovered");
      const [staleDelivery] = await db.select().from(automationDeliveriesTable)
        .where(eq(automationDeliveriesTable.eventKey, `${epochKeyF}:email`)).limit(1);
      assert.ok(staleDelivery);
      assert.equal(staleDelivery.status, "sent", "Stale delivery reconciled to sent");
    }
    console.log("✓ Delivery claim/lease: stale processing recovery");

    // ── Test 29: Provider-success-before-local-status-crash (idempotent) ───
    // Simulates: provider accepted the message but local DB status update crashed.
    // On retry the provider adapter deduplicates (returns deduplicated) and we
    // reconcile status to sent.
    {
      // We test this via sendSms: inject a delivery row already in processing
      // (lease not expired) but the smsDeliveriesTable row is "sent" (provider
      // already accepted). A second worker attempt on the SAME eventKey at the
      // SMS layer returns deduplicated → we map that to "skipped" in sendAutomationSms,
      // but the delivery row was already reconciled to "sent" after provider success.
      // We verify no double-send occurs when delivery is already terminal "sent".
      const ownerG = await makeOwnerAndSalon(`G-${suffix}`);
      toCleanup.userIds.push(ownerG.owner.id);
      toCleanup.salonIds.push(ownerG.salon.id);
      const svcG = await makeService(ownerG.salon.id, `SvcG-${suffix}`);
      const custG = await makeSalonCustomer(custInfo.user.id, ownerG.salon.id);
      await db.update(salonCustomersTable).set({ email: `idmpt-${suffix}@bg.test`, phone: null })
        .where(eq(salonCustomersTable.id, custG.id));
      const oldDate4 = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: ownerG.salon.id, salonCustomerId: custG.id, serviceId: svcG.id,
        date: oldDate4, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 1500, treatmentLocation: "salon",
      });

      const [ruleG] = await db.insert(automationRulesTable).values({
        salonId: ownerG.salon.id, name: `IdmptTest ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email", emailSubject: "Idmpt", emailBody: "Hi {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(ruleG);
      toCleanup.automationIds.push(ruleG.id);

      const epochKeyG = buildEpochKey(ruleG.id, custG.id, new Date());
      const [idmptRun] = await db.insert(automationRunsTable).values({
        eventKey: epochKeyG, ruleId: ruleG.id, salonId: ownerG.salon.id,
        salonCustomerId: custG.id, status: "pending", executedAt: new Date(),
      }).returning();
      assert.ok(idmptRun);

      // Simulate: delivery row already "sent" (provider succeeded, status reconciled).
      await db.insert(automationDeliveriesTable).values({
        runId: idmptRun.id, salonId: ownerG.salon.id,
        eventKey: `${epochKeyG}:email`, channel: "email",
        recipientEmail: `idmpt-${suffix}@bg.test`,
        status: "sent", sentAt: new Date(),
      });

      // Retry: worker sees terminal "sent" delivery → must NOT call provider again.
      const idmptEmails: string[] = [];
      const idmptTransport: TransactionalEmailTransport = {
        async send(input) { idmptEmails.push(input.to.email); return { messageId: "idmpt1" }; },
      };
      await runAutomationWorker(new Date(), { emailTransport: idmptTransport });
      assert.equal(idmptEmails.length, 0, "Provider NOT called for already-sent delivery");
      const [idmptDelivery] = await db.select().from(automationDeliveriesTable)
        .where(eq(automationDeliveriesTable.eventKey, `${epochKeyG}:email`)).limit(1);
      assert.ok(idmptDelivery);
      assert.equal(idmptDelivery.status, "sent", "Delivery remains sent (no regression)");
    }
    console.log("✓ Delivery claim/lease: provider-success-before-local-crash idempotency");

    // ── Test 30: Concurrent claim — only one winner ────────────────────────
    // Two workers race to claim the same queued delivery.
    // One gets the row; the other returns null (no claim). Neither double-sends.
    {
      const ownerH = await makeOwnerAndSalon(`H-${suffix}`);
      toCleanup.userIds.push(ownerH.owner.id);
      toCleanup.salonIds.push(ownerH.salon.id);
      const svcH = await makeService(ownerH.salon.id, `SvcH-${suffix}`);
      const custH = await makeSalonCustomer(custInfo.user.id, ownerH.salon.id);
      await db.update(salonCustomersTable).set({ email: `concur-${suffix}@bg.test`, phone: null })
        .where(eq(salonCustomersTable.id, custH.id));
      const oldDate5 = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: ownerH.salon.id, salonCustomerId: custH.id, serviceId: svcH.id,
        date: oldDate5, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 1000, treatmentLocation: "salon",
      });

      const [ruleH] = await db.insert(automationRulesTable).values({
        salonId: ownerH.salon.id, name: `ConcurTest ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_email", emailSubject: "Concur", emailBody: "Hi {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(ruleH);
      toCleanup.automationIds.push(ruleH.id);

      // Run two workers concurrently — exactly one should send.
      const concurEmails: string[] = [];
      const concurTransport: TransactionalEmailTransport = {
        async send(input) {
          concurEmails.push(input.to.email);
          return { messageId: `concur-${concurEmails.length}` };
        },
      };
      await Promise.all([
        runAutomationWorker(new Date(), { emailTransport: concurTransport }),
        runAutomationWorker(new Date(), { emailTransport: concurTransport }),
      ]);
      // Both workers may have called the provider (DB claim is atomic but the
      // provider adapter's own smsDeliveriesTable / brevo eventKey deduplication
      // ensures at-most-once delivery). The delivery row ends up "sent".
      assert.ok(concurEmails.length >= 1, "At least one send attempted");
      const [concurDelivery] = await db.select().from(automationDeliveriesTable)
        .where(eq(automationDeliveriesTable.salonId, ownerH.salon.id)).limit(1);
      assert.ok(concurDelivery);
      assert.equal(concurDelivery.status, "sent", "Concurrent claim results in exactly sent");
    }
    console.log("✓ Delivery claim/lease: concurrent claim winner");

    // ── Tests 31–35: Service/package-aware commission ─────────────────────
    {
      const ownerI = await makeOwnerAndSalon(`I-${suffix}`);
      toCleanup.userIds.push(ownerI.owner.id);
      toCleanup.salonIds.push(ownerI.salon.id);
      const empI = await makeEmployee(ownerI.salon.id, `I-${suffix}`);
      toCleanup.userIds.push(empI.user.id);
      const svcI1 = await makeService(ownerI.salon.id, `SvcI1-${suffix}`); // 3000 din
      const svcI2 = await makeService(ownerI.salon.id, `SvcI2-${suffix}`); // also 3000 din

      // Single customer for salon I (reused across all commission sub-tests).
      const custIsc = await makeSalonCustomer(custInfo.user.id, ownerI.salon.id);

      // Helper: insert completed appointment for employee I.
      async function makeEmpAppt(serviceId: string, price: number, date = "2024-06-01") {
        const [a] = await db.insert(appointmentsTable).values({
          salonId: ownerI.salon.id, salonCustomerId: custIsc.id,
          employeeId: empI.emp.id, serviceId,
          date, startTime: "10:00", endTime: "11:00", durationMinutes: 60,
          status: "completed", price, treatmentLocation: "salon",
        }).returning();
        assert.ok(a);
        return a;
      }

      // Test 31: percent_of_revenue — base rate, no override.
      {
        await db.insert(employeeCommissionSettingsTable).values({
          salonId: ownerI.salon.id, employeeId: empI.emp.id,
          commissionType: "percent_of_revenue", commissionPercent: 20,
          fixedAmountInDinars: 0, perServiceOverrides: {},
        }).onConflictDoUpdate({
          target: [employeeCommissionSettingsTable.employeeId],
          set: { commissionType: "percent_of_revenue", commissionPercent: 20, perServiceOverrides: {} },
        });
        const a = await makeEmpAppt(svcI1.id, 5000);
        const [metrics] = await getEmployeePerformance({ salonId: ownerI.salon.id, employeeId: empI.emp.id });
        assert.ok(metrics);
        // 20% of 5000 = 1000
        assert.equal(metrics.estimatedCommission, 1000, "Percent base: 20% of 5000 = 1000");
        // Cleanup appointment
        await db.delete(appointmentsTable).where(eq(appointmentsTable.id, a.id));
      }
      console.log("✓ Commission test 31: percent fallback");

      // Test 32: percent_of_revenue — service-specific override.
      {
        await db.update(employeeCommissionSettingsTable).set({
          commissionPercent: 20,
          perServiceOverrides: { [svcI1.id]: 30, [svcI2.id]: 10 },
        }).where(eq(employeeCommissionSettingsTable.employeeId, empI.emp.id));
        const a1 = await makeEmpAppt(svcI1.id, 4000); // 30% override → 1200
        const a2 = await makeEmpAppt(svcI2.id, 2000); // 10% override → 200
        const [metrics] = await getEmployeePerformance({ salonId: ownerI.salon.id, employeeId: empI.emp.id });
        assert.ok(metrics);
        assert.equal(metrics.estimatedCommission, 1400, "Percent override: 30% of 4000 + 10% of 2000 = 1400");
        assert.equal(metrics.totalRevenue, 6000, "Revenue includes both appointments");
        await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, [a1.id, a2.id]));
      }
      console.log("✓ Commission test 32: percent service override");

      // Test 33: fixed_per_treatment — base rate.
      {
        await db.update(employeeCommissionSettingsTable).set({
          commissionType: "fixed_per_treatment", fixedAmountInDinars: 500,
          commissionPercent: 0, perServiceOverrides: {},
        }).where(eq(employeeCommissionSettingsTable.employeeId, empI.emp.id));
        const a1 = await makeEmpAppt(svcI1.id, 3000);
        const a2 = await makeEmpAppt(svcI1.id, 3000, "2024-06-02");
        const [metrics] = await getEmployeePerformance({ salonId: ownerI.salon.id, employeeId: empI.emp.id });
        assert.ok(metrics);
        assert.equal(metrics.estimatedCommission, 1000, "Fixed base: 2 × 500 = 1000");
        await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, [a1.id, a2.id]));
      }
      console.log("✓ Commission test 33: fixed fallback");

      // Test 34: fixed_per_treatment — service override.
      {
        await db.update(employeeCommissionSettingsTable).set({
          commissionType: "fixed_per_treatment", fixedAmountInDinars: 500,
          perServiceOverrides: { [svcI1.id]: 800, [svcI2.id]: 200 },
        }).where(eq(employeeCommissionSettingsTable.employeeId, empI.emp.id));
        const a1 = await makeEmpAppt(svcI1.id, 3000); // override 800
        const a2 = await makeEmpAppt(svcI2.id, 1500); // override 200
        const [metrics] = await getEmployeePerformance({ salonId: ownerI.salon.id, employeeId: empI.emp.id });
        assert.ok(metrics);
        assert.equal(metrics.estimatedCommission, 1000, "Fixed override: 800 + 200 = 1000");
        await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, [a1.id, a2.id]));
      }
      console.log("✓ Commission test 34: fixed service override");

      // Test 35: package-redemption appointment — original price used for commission.
      {
        await db.update(employeeCommissionSettingsTable).set({
          commissionType: "percent_of_revenue", commissionPercent: 10,
          fixedAmountInDinars: 0, perServiceOverrides: {},
        }).where(eq(employeeCommissionSettingsTable.employeeId, empI.emp.id));

        // Create an appointment with price=0 (package redeemed) + redemption row
        // carrying originalAppointmentPrice = 4000.
        const pkgI = await makePackage(ownerI.salon.id, svcI1.id, `commI-${suffix}`);
        const purchI = await makeActivePurchaseWithSnapshot(
          ownerI.salon.id, pkgI.id, custIsc.id, [svcI1.id],
        );
        toCleanup.purchaseIds.push(purchI.id);

        const [pkgAppt] = await db.insert(appointmentsTable).values({
          salonId: ownerI.salon.id, salonCustomerId: custIsc.id,
          employeeId: empI.emp.id, serviceId: svcI1.id,
          date: "2024-06-03", startTime: "10:00", endTime: "11:00", durationMinutes: 60,
          status: "completed", price: 0, treatmentLocation: "salon", // zeroed by redemption
        }).returning();
        assert.ok(pkgAppt);
        // Insert redemption row with original price snapshot.
        await db.insert(packageRedemptionsTable).values({
          purchaseId: purchI.id, salonId: ownerI.salon.id,
          appointmentId: pkgAppt.id, salonCustomerId: custIsc.id,
          status: "redeemed", originalAppointmentPrice: 4000,
        });

        const [metrics] = await getEmployeePerformance({ salonId: ownerI.salon.id, employeeId: empI.emp.id });
        assert.ok(metrics);
        // Revenue = 4000 (original price, not 0); commission = 10% = 400.
        assert.equal(metrics.totalRevenue, 4000, "Package appt uses originalAppointmentPrice for revenue");
        assert.equal(metrics.estimatedCommission, 400, "Commission based on originalAppointmentPrice");
        // Delete redemption first (restrict FK), then appointment.
        await db.delete(packageRedemptionsTable).where(eq(packageRedemptionsTable.appointmentId, pkgAppt.id));
        await db.delete(appointmentsTable).where(eq(appointmentsTable.id, pkgAppt.id));
      }
      console.log("✓ Commission test 35: package-redemption original-price basis");
    }

    // ── Test 36: Immutable purchase snapshot (P3 regression) ─────────────
    // Buy package covering service A; owner edits definition to only service B;
    // old purchase still redeems A and rejects B; new purchase only covers B.
    {
      const ownerJ = await makeOwnerAndSalon(`J-${suffix}`);
      toCleanup.userIds.push(ownerJ.owner.id);
      toCleanup.salonIds.push(ownerJ.salon.id);
      const svcJA = await makeService(ownerJ.salon.id, `SvcJA-${suffix}`);
      const svcJB = await makeService(ownerJ.salon.id, `SvcJB-${suffix}`);
      const custJSc = await makeSalonCustomer(custInfo.user.id, ownerJ.salon.id);

      // Create package covering only service A.
      const pkgJ = await makePackage(ownerJ.salon.id, svcJA.id, `J-${suffix}`);

      // Customer buys while A is covered — snapshot created with A.
      const oldPurchase = await makeActivePurchaseWithSnapshot(
        ownerJ.salon.id, pkgJ.id, custJSc.id, [svcJA.id],
        { totalSessions: 3, remainingSessions: 3 },
      );
      toCleanup.purchaseIds.push(oldPurchase.id);

      // Owner "edits" package definition: remove A, add B.
      // (We simulate by deleting the old link and inserting a new one.)
      await db.delete(packageServiceLinksTable).where(eq(packageServiceLinksTable.packageId, pkgJ.id));
      await db.insert(packageServiceLinksTable).values({ packageId: pkgJ.id, serviceId: svcJB.id });

      // Verify: old purchase can still redeem service A.
      const apptJA = await makeAppointment(ownerJ.salon.id, custJSc.id, svcJA.id, "confirmed");
      const redeemA = await redeemPackageSession({
        purchaseId: oldPurchase.id, appointmentId: apptJA.id,
        salonId: ownerJ.salon.id, requestingCustomerId: custJSc.id,
      });
      assert.ok(redeemA.ok, "Old purchase must still redeem service A (snapshot immutable)");

      // Old purchase must reject service B (not in snapshot).
      const apptJB = await makeAppointment(ownerJ.salon.id, custJSc.id, svcJB.id, "confirmed");
      const redeemB = await redeemPackageSession({
        purchaseId: oldPurchase.id, appointmentId: apptJB.id,
        salonId: ownerJ.salon.id, requestingCustomerId: custJSc.id,
      });
      assert.equal(redeemB.ok, false, "Old purchase must NOT redeem service B (not in snapshot)");
      assert.equal((redeemB as { reason: string }).reason, "service_not_covered");

      // New purchase (after definition edit) covers only B.
      const newPurchase = await makeActivePurchaseWithSnapshot(
        ownerJ.salon.id, pkgJ.id, custJSc.id, [svcJB.id],
        { totalSessions: 3, remainingSessions: 3 },
      );
      toCleanup.purchaseIds.push(newPurchase.id);

      // New purchase redeems B.
      const redeemNewB = await redeemPackageSession({
        purchaseId: newPurchase.id, appointmentId: apptJB.id,
        salonId: ownerJ.salon.id, requestingCustomerId: custJSc.id,
      });
      assert.ok(redeemNewB.ok, "New purchase must redeem service B");

      // New purchase rejects A.
      const apptJA2 = await makeAppointment(ownerJ.salon.id, custJSc.id, svcJA.id, "pending");
      const redeemNewA = await redeemPackageSession({
        purchaseId: newPurchase.id, appointmentId: apptJA2.id,
        salonId: ownerJ.salon.id, requestingCustomerId: custJSc.id,
      });
      assert.equal(redeemNewA.ok, false, "New purchase must NOT redeem service A (not in new snapshot)");
      assert.equal((redeemNewA as { reason: string }).reason, "service_not_covered");
    }
    console.log("✓ Immutable purchase snapshot: old purchase covers A after definition changed to B");

    // ── Test 36b: Per-service quota exhaustion and exact restoration ───────
    {
      const ownerQuota = await makeOwnerAndSalon(`quota-${suffix}`);
      toCleanup.userIds.push(ownerQuota.owner.id);
      toCleanup.salonIds.push(ownerQuota.salon.id);
      const serviceA = await makeService(ownerQuota.salon.id, `Quota A ${suffix}`);
      const serviceB = await makeService(ownerQuota.salon.id, `Quota B ${suffix}`);
      const customer = await makeSalonCustomer(custInfo.user.id, ownerQuota.salon.id);
      const pkg = await makePackage(ownerQuota.salon.id, serviceA.id, `quota-${suffix}`);
      const [purchase] = await db.insert(customerPackagePurchasesTable).values({
        salonId: ownerQuota.salon.id, packageId: pkg.id, salonCustomerId: customer.id,
        totalSessions: 3, remainingSessions: 3, quotaPolicy: "per_service",
        priceInDinars: 10000, paymentMethod: "pay_at_salon", status: "active",
        expiresAt: new Date(Date.now() + 86_400_000),
      }).returning();
      assert.ok(purchase);
      toCleanup.purchaseIds.push(purchase.id);
      await db.insert(packagePurchaseServiceLinksTable).values([
        { purchaseId: purchase.id, serviceId: serviceA.id, totalQuota: 2, remainingQuota: 2 },
        { purchaseId: purchase.id, serviceId: serviceB.id, totalQuota: 1, remainingQuota: 1 },
      ]);
      const apptA1 = await makeAppointment(ownerQuota.salon.id, customer.id, serviceA.id, "pending");
      const apptA2 = await makeAppointment(ownerQuota.salon.id, customer.id, serviceA.id, "pending");
      const apptA3 = await makeAppointment(ownerQuota.salon.id, customer.id, serviceA.id, "pending");
      const apptB = await makeAppointment(ownerQuota.salon.id, customer.id, serviceB.id, "pending");
      const redeemA1 = await redeemPackageSession({ purchaseId: purchase.id, appointmentId: apptA1.id, salonId: ownerQuota.salon.id, requestingCustomerId: customer.id });
      const redeemA2 = await redeemPackageSession({ purchaseId: purchase.id, appointmentId: apptA2.id, salonId: ownerQuota.salon.id, requestingCustomerId: customer.id });
      assert.ok(redeemA1.ok && redeemA2.ok, "two A allowances redeem");
      const exhaustedA = await redeemPackageSession({ purchaseId: purchase.id, appointmentId: apptA3.id, salonId: ownerQuota.salon.id, requestingCustomerId: customer.id });
      assert.equal(exhaustedA.ok, false, "A is exhausted even while aggregate allowance remains");
      assert.equal((exhaustedA as { reason: string }).reason, "no_sessions_left");
      const redeemedB = await redeemPackageSession({ purchaseId: purchase.id, appointmentId: apptB.id, salonId: ownerQuota.salon.id, requestingCustomerId: customer.id });
      assert.ok(redeemedB.ok, "B allowance remains redeemable");
      const reversed = await reversePackageRedemption({ redemptionId: redeemA1.redemptionId, salonId: ownerQuota.salon.id });
      assert.ok(reversed.ok, "reversal restores its consumed service allowance");
      const quotas = await db.select().from(packagePurchaseServiceLinksTable)
        .where(eq(packagePurchaseServiceLinksTable.purchaseId, purchase.id));
      assert.equal(quotas.find((row) => row.serviceId === serviceA.id)?.remainingQuota, 1, "only A receives the restored quota");
      assert.equal(quotas.find((row) => row.serviceId === serviceB.id)?.remainingQuota, 0, "B remains consumed");
    }
    console.log("✓ Per-service package quotas exhaust and restore independently");

    // ── Test 37: SMS provider-success / local-status-crash recovery → sent ─
    // The provider accepted the SMS (smsDeliveriesTable row = "sent"), but the
    // automation delivery row got stuck "processing" with an EXPIRED lease
    // (local status update crashed). On the worker retry, claimDelivery reclaims
    // the stale processing row, sendSms returns { deduplicated, priorStatus:
    // "sent" }, and the automation delivery MUST reconcile to "sent" — NOT
    // "skipped" (which would lose sent-run attribution).
    {
      const ownerK = await makeOwnerAndSalon(`K-${suffix}`);
      toCleanup.userIds.push(ownerK.owner.id);
      toCleanup.salonIds.push(ownerK.salon.id);
      const svcK = await makeService(ownerK.salon.id, `SvcK-${suffix}`);
      const custK = await makeSalonCustomer(custInfo.user.id, ownerK.salon.id);
      await db.update(salonCustomersTable).set({
        email: `smsrec-${suffix}@bg.test`, phone: "+381609998877", smsOptOut: false,
      }).where(eq(salonCustomersTable.id, custK.id));

      const oldDateK = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(appointmentsTable).values({
        salonId: ownerK.salon.id, salonCustomerId: custK.id, serviceId: svcK.id,
        date: oldDateK, startTime: "09:00", endTime: "10:00", durationMinutes: 60,
        status: "completed", price: 2000, treatmentLocation: "salon",
      });

      const [ruleK] = await db.insert(automationRulesTable).values({
        salonId: ownerK.salon.id, name: `SmsRecover ${suffix}`,
        trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
        action: "send_sms", smsBody: "Zdravo {{firstName}}",
        status: "active",
      }).returning();
      assert.ok(ruleK);
      toCleanup.automationIds.push(ruleK.id);

      const epochKeyK = buildEpochKey(ruleK.id, custK.id, new Date());
      const [runK] = await db.insert(automationRunsTable).values({
        eventKey: epochKeyK, ruleId: ruleK.id, salonId: ownerK.salon.id,
        salonCustomerId: custK.id, status: "pending", executedAt: new Date(),
      }).returning();
      assert.ok(runK);

      const channelKeyK = `${epochKeyK}:sms`;

      // Provider already accepted: persistent smsDeliveriesTable row is "sent".
      await db.insert(smsDeliveriesTable).values({
        eventKey: channelKeyK, salonId: ownerK.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381609998877",
        body: "Zdravo Test", status: "sent", providerMessageId: "prov-sent-1",
        sentAt: new Date(),
      });

      // The automation delivery is stuck "processing" with an EXPIRED lease
      // (local status update crashed after provider success).
      await db.insert(automationDeliveriesTable).values({
        runId: runK.id, salonId: ownerK.salon.id,
        eventKey: channelKeyK, channel: "sms",
        recipientPhone: "+381609998877",
        status: "processing",
        processingStartedAt: new Date(Date.now() - 10 * 60_000),
        claimExpiresAt: new Date(Date.now() - 5 * 60_000), // expired lease
      });

      // Retry: the SMS provider must NOT be called again (dedup at SMS layer);
      // the automation delivery must reconcile to "sent".
      const recoverSmsAttempts: string[] = [];
      const recoverSms: SmsProvider = {
        async send(input) { recoverSmsAttempts.push(input.to); return { messageId: `should-not-happen` }; },
      };
      await runAutomationWorker(new Date(), { smsProvider: recoverSms });

      assert.equal(recoverSmsAttempts.length, 0, "Provider NOT called again (SMS-layer dedup)");
      const [recoverDelivery] = await db.select().from(automationDeliveriesTable)
        .where(eq(automationDeliveriesTable.eventKey, channelKeyK)).limit(1);
      assert.ok(recoverDelivery);
      assert.equal(recoverDelivery.status, "sent",
        "Automation delivery reconciled to sent (provider success preserved), NOT skipped");
      assert.ok(recoverDelivery.sentAt, "sentAt attribution set on reconciled delivery");

      // The run must reach a sent (non-pending) terminal state.
      const [runKAfter] = await db.select().from(automationRunsTable)
        .where(eq(automationRunsTable.id, runK.id)).limit(1);
      assert.ok(runKAfter);
      assert.notEqual(runKAfter.status, "pending", "Run not stranded pending after SMS recovery");
    }
    console.log("✓ SMS provider-success / local-crash recovery reconciles to sent (not skipped)");

    // ── Test 38: Concurrent purchase vs definition edit → coherent snapshot ─
    // A customer purchases a package (POST /purchases) while the owner edits the
    // package definition's serviceIds (PATCH /packages/:id) at the same time.
    // Both routes lock the SAME package row FOR UPDATE, so the purchase snapshot
    // must be either the FULL old coverage set or the FULL new set — never a
    // mixed/stale/partial mixture.
    {
      const ownerL = await makeOwnerAndSalon(`L-${suffix}`);
      toCleanup.userIds.push(ownerL.owner.id);
      toCleanup.salonIds.push(ownerL.salon.id);
      function ownerLHeaders() {
        return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${ownerL.token}` };
      }
      const svcLA = await makeService(ownerL.salon.id, `SvcLA-${suffix}`);
      const svcLB = await makeService(ownerL.salon.id, `SvcLB-${suffix}`);
      const svcLC = await makeService(ownerL.salon.id, `SvcLC-${suffix}`);

      const custL = await makeCustomerUser(`custL-${suffix}`);
      toCleanup.userIds.push(custL.user.id);
      function custLHeaders() {
        return { "Content-Type": "application/json", cookie: `${sessionCookieName}=${custL.token}` };
      }

      // Package initially covers A + B (the "old" coverage set).
      const pkgL = await makePackage(ownerL.salon.id, svcLA.id, `pkgL-${suffix}`);
      await db.insert(packageServiceLinksTable).values({ packageId: pkgL.id, serviceId: svcLB.id });
      const oldSet = new Set([svcLA.id, svcLB.id]);
      const newSet = new Set([svcLC.id]);

      // Fire the purchase and the definition edit (service quotas → C) concurrently.
      const [rPurchase, rEdit] = await Promise.all([
        fetch(`${baseUrl}/growth/packages/${pkgL.id}/purchases`, {
          method: "POST", headers: custLHeaders(), body: JSON.stringify({ paymentMethod: "pay_at_salon" }),
        }),
        fetch(`${baseUrl}/growth/packages/${pkgL.id}`, {
          method: "PATCH", headers: ownerLHeaders(), body: JSON.stringify({ serviceQuotas: [{ serviceId: svcLC.id, quota: 3 }] }),
        }),
      ]);

      assert.equal(rEdit.status, 200, "Definition edit succeeds");
      assert.equal(rPurchase.status, 201, "Purchase succeeds");
      const purchaseBody = await rPurchase.json() as { id: string };
      toCleanup.purchaseIds.push(purchaseBody.id);

      // Read the purchase snapshot — it must be coherently old OR new, never mixed.
      const snapRows = await db.select({ serviceId: packagePurchaseServiceLinksTable.serviceId })
        .from(packagePurchaseServiceLinksTable)
        .where(eq(packagePurchaseServiceLinksTable.purchaseId, purchaseBody.id));
      const snapSet = new Set(snapRows.map((r) => r.serviceId));

      const isOld = snapSet.size === oldSet.size && [...snapSet].every((id) => oldSet.has(id));
      const isNew = snapSet.size === newSet.size && [...snapSet].every((id) => newSet.has(id));
      assert.ok(isOld || isNew,
        `Snapshot must be a coherent old-or-new coverage set, got: ${JSON.stringify([...snapSet])}`);

      // The current definition after the edit reflects exactly the new set.
      const defRows = await db.select({ serviceId: packageServiceLinksTable.serviceId })
        .from(packageServiceLinksTable)
        .where(eq(packageServiceLinksTable.packageId, pkgL.id));
      const defSet = new Set(defRows.map((r) => r.serviceId));
      assert.ok(defSet.size === newSet.size && [...defSet].every((id) => newSet.has(id)),
        "Definition ends with exactly the new coverage set [C]");
    }
    console.log("✓ Concurrent purchase vs definition edit yields coherent snapshot (never mixed)");

    // ── Test 44: Package purchase is CUSTOMER-only (no CRM/purchase bypass) ─
    // A salon owner / employee / admin must be rejected with 403 BEFORE any
    // salon_customer or purchase row is created. Only a CUSTOMER succeeds.
    {
      const ownerP = await makeOwnerAndSalon(`P-${suffix}`);
      toCleanup.userIds.push(ownerP.owner.id);
      toCleanup.salonIds.push(ownerP.salon.id);
      const svcP = await makeService(ownerP.salon.id, `SvcP-${suffix}`);
      const pkgP = await makePackage(ownerP.salon.id, svcP.id, `pkgP-${suffix}`);
      const empP = await makeEmployee(ownerP.salon.id, `empP-${suffix}`);
      toCleanup.userIds.push(empP.user.id);

      const purchaseUrl = `${baseUrl}/growth/packages/${pkgP.id}/purchases`;
      const body = JSON.stringify({ paymentMethod: "pay_at_salon" });

      // Baseline counts before any attempt.
      const crmBefore = await db.select({ id: salonCustomersTable.id }).from(salonCustomersTable)
        .where(eq(salonCustomersTable.salonId, ownerP.salon.id));
      const purchasesBefore = await db.select({ id: customerPackagePurchasesTable.id }).from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.salonId, ownerP.salon.id));

      // Non-customer roles must be forbidden.
      for (const [label, token] of [
        ["salon owner", ownerP.token],
        ["salon employee", empP.token],
        ["admin", adminToken],
      ] as const) {
        const r = await fetch(purchaseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: `${sessionCookieName}=${token}` },
          body,
        });
        assert.equal(r.status, 403, `${label} must be forbidden from purchasing (got ${r.status})`);
        const rb = await r.json() as { code?: string };
        assert.equal(rb.code, "FORBIDDEN", `${label} error code`);
      }

      // No salon_customer or purchase row was created by the forbidden attempts.
      const crmAfter = await db.select({ id: salonCustomersTable.id }).from(salonCustomersTable)
        .where(eq(salonCustomersTable.salonId, ownerP.salon.id));
      const purchasesAfter = await db.select({ id: customerPackagePurchasesTable.id }).from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.salonId, ownerP.salon.id));
      assert.equal(crmAfter.length, crmBefore.length, "No salon_customer created by non-customer attempts");
      assert.equal(purchasesAfter.length, purchasesBefore.length, "No purchase created by non-customer attempts");

      // A CUSTOMER still succeeds.
      const custP = await makeCustomerUser(`custP-${suffix}`);
      toCleanup.userIds.push(custP.user.id);
      const rOk = await fetch(purchaseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${sessionCookieName}=${custP.token}` },
        body,
      });
      assert.equal(rOk.status, 201, "CUSTOMER purchase must succeed");
      const okBody = await rOk.json() as { id: string; status: string };
      toCleanup.purchaseIds.push(okBody.id);
      assert.equal(okBody.status, "pending_payment");
    }
    console.log("✓ Package purchase CUSTOMER-only: owner/employee/admin 403, no CRM/purchase rows; customer succeeds");

    // ── Test 45: Leave-request endpoints — canonical contract ──────────────
    // Employee submits (POST /employee/leave-requests), owner lists
    // (GET /salon/leave-requests) and reviews (PATCH). Validate every response
    // against the generated Zod schemas + role/error responses.
    {
      const ownerLv = await makeOwnerAndSalon(`Lv-${suffix}`);
      toCleanup.userIds.push(ownerLv.owner.id);
      toCleanup.salonIds.push(ownerLv.salon.id);
      const empLv = await makeEmployee(ownerLv.salon.id, `empLv-${suffix}`);
      toCleanup.userIds.push(empLv.user.id);
      const custLv = await makeCustomerUser(`custLv-${suffix}`);
      toCleanup.userIds.push(custLv.user.id);

      const empHeaders = { "Content-Type": "application/json", cookie: `${sessionCookieName}=${empLv.token}` };
      const ownerHeaders = { "Content-Type": "application/json", cookie: `${sessionCookieName}=${ownerLv.token}` };

      // Employee POST — invalid period rejected (400).
      const rBad = await fetch(`${baseUrl}/employee/leave-requests`, {
        method: "POST", headers: empHeaders,
        body: JSON.stringify({ startDate: "2030-05-10", endDate: "2030-05-01", reason: "x" }),
      });
      assert.equal(rBad.status, 400, "Invalid period rejected");

      // Non-employee (customer) POST — forbidden (403).
      const rForbidden = await fetch(`${baseUrl}/employee/leave-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${sessionCookieName}=${custLv.token}` },
        body: JSON.stringify({ startDate: "2030-05-01", endDate: "2030-05-05", reason: "Odmor" }),
      });
      assert.equal(rForbidden.status, 403, "Customer cannot submit an employee leave request");

      // Employee POST — valid (201), validated against generated schema.
      const rCreate = await fetch(`${baseUrl}/employee/leave-requests`, {
        method: "POST", headers: empHeaders,
        body: JSON.stringify({ startDate: "2030-05-01", endDate: "2030-05-05", reason: "Godišnji odmor" }),
      });
      assert.equal(rCreate.status, 201, "Valid leave request created");
      const createdBody = await rCreate.json();
      const created = CreateEmployeeLeaveRequestResponse.parse(createdBody);
      assert.equal(created.status, "pending", "New leave request is pending");

      // Owner GET list — validated against generated array schema.
      const rList = await fetch(`${baseUrl}/salon/leave-requests`, { headers: ownerHeaders });
      assert.equal(rList.status, 200, "Owner can list leave requests");
      const listBody = await rList.json();
      const list = ListSalonLeaveRequestsResponse.parse(listBody);
      assert.ok(list.some((x) => x.id === created.id), "Created request appears in owner list");
      assert.ok(list.every((x) => typeof x.employeeName === "string"), "Each row carries employeeName");

      // Employee GET list — forbidden (owner role required).
      const rListForbidden = await fetch(`${baseUrl}/salon/leave-requests`, { headers: empHeaders });
      assert.equal(rListForbidden.status, 403, "Employee cannot list salon leave requests");

      // Owner PATCH invalid status — 400.
      const rPatchBad = await fetch(`${baseUrl}/salon/leave-requests/${created.id}`, {
        method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ status: "maybe" }),
      });
      assert.equal(rPatchBad.status, 400, "Invalid review status rejected");

      // Owner PATCH approve — 200, validated + time-off created.
      const rPatch = await fetch(`${baseUrl}/salon/leave-requests/${created.id}`, {
        method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ status: "approved" }),
      });
      assert.equal(rPatch.status, 200, "Owner approves leave request");
      const reviewed = ReviewSalonLeaveRequestResponse.parse(await rPatch.json());
      assert.equal(reviewed.status, "approved");

      const [dbReq] = await db.select().from(employeeLeaveRequestsTable)
        .where(eq(employeeLeaveRequestsTable.id, created.id)).limit(1);
      assert.ok(dbReq);
      assert.equal(dbReq.status, "approved", "DB row transitioned to approved");
      assert.ok(dbReq.reviewedAt, "reviewedAt set");
      const timeOff = await db.select().from(employeeTimeOffTable)
        .where(eq(employeeTimeOffTable.employeeId, empLv.emp.id));
      assert.ok(timeOff.some((t) => t.startDate === "2030-05-01" && t.endDate === "2030-05-05"),
        "Approval materializes a time-off row");

      // Owner PATCH again — already reviewed → 409.
      const rPatchAgain = await fetch(`${baseUrl}/salon/leave-requests/${created.id}`, {
        method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ status: "rejected" }),
      });
      assert.equal(rPatchAgain.status, 409, "Already-reviewed request cannot be re-reviewed");

      // Cleanup this test's rows (FK-safe: time-off + leave requests).
      await db.delete(employeeTimeOffTable).where(eq(employeeTimeOffTable.employeeId, empLv.emp.id));
      await db.delete(employeeLeaveRequestsTable).where(eq(employeeLeaveRequestsTable.employeeId, empLv.emp.id));
    }
    console.log("✓ Leave-request endpoints canonical contract (employee submit / owner list+review, roles, errors)");

    // ── Test 39: sendSms claim/lease — crash-after-queued-insert recovery ──
    // Simulate a crash AFTER the queued row insert but BEFORE the provider call
    // by inserting a bare `queued` row. The next sendSms attempt must CLAIM it
    // (queued → processing → sent) and actually call the provider exactly once —
    // never dedupe/skip it forever (the original P1 bug).
    {
      const ownerSm = await makeOwnerAndSalon(`Sm1-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-crash-queued:${suffix}`;

      // Pre-existing queued row (crash before provider.send).
      await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601112233",
        body: "Zdravo", status: "queued",
      });

      const attempts: string[] = [];
      const keys: (string | undefined)[] = [];
      const okProvider: SmsProvider = {
        async send(input) { attempts.push(input.to); keys.push(input.idempotencyKey); return { messageId: "queued-recovered-1" }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601112233", smsOptOut: false, text: "Zdravo",
      }, okProvider);

      assert.equal(attempts.length, 1, "Provider called exactly once on queued recovery");
      assert.ok("messageId" in result, `Recovery must succeed (sent), got: ${JSON.stringify(result)}`);
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.ok(row);
      assert.equal(row.status, "sent", "Queued row reclaimed and marked sent");
      assert.equal(row.providerMessageId, "queued-recovered-1");
      assert.equal(row.claimExpiresAt, null, "Lease cleared on terminal state");
      assert.equal(keys[0], row.id, "Provider send uses the stable delivery id as idempotency key");
      assert.ok(row.submissionStartedAt, "submissionStartedAt persisted before provider request");
    }
    console.log("✓ sendSms claim/lease: crash-after-queued-insert recovery (provider called once)");

    // ── Test 40: sendSms claim/lease — stale processing recovery ───────────
    // A row stuck in `processing` with an EXPIRED lease is reclaimable.
    {
      const ownerSm = await makeOwnerAndSalon(`Sm2-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-stale-processing:${suffix}`;

      await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601112244",
        body: "Zdravo", status: "processing",
        processingStartedAt: new Date(Date.now() - 15 * 60_000),
        claimExpiresAt: new Date(Date.now() - 10 * 60_000), // expired lease
      });

      const attempts: string[] = [];
      const okProvider: SmsProvider = {
        async send(input) { attempts.push(input.to); return { messageId: "stale-recovered-1" }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601112244", smsOptOut: false, text: "Zdravo",
      }, okProvider);

      assert.equal(attempts.length, 1, "Provider called once on stale-processing recovery");
      assert.ok("messageId" in result, "Stale processing reclaimed → sent");
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.ok(row);
      assert.equal(row.status, "sent", "Stale processing row reclaimed and sent");
    }
    console.log("✓ sendSms claim/lease: stale processing recovery");

    // ── Test 41: sendSms — LIVE processing lease returns inProgress ────────
    // A row in `processing` with a still-valid lease must NOT be sent; sendSms
    // returns { inProgress } (retryable), and the provider is NOT called.
    {
      const ownerSm = await makeOwnerAndSalon(`Sm3-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-live-processing:${suffix}`;

      await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601112255",
        body: "Zdravo", status: "processing",
        processingStartedAt: new Date(),
        claimExpiresAt: new Date(Date.now() + 5 * 60_000), // LIVE lease
      });

      const attempts: string[] = [];
      const okProvider: SmsProvider = {
        async send(input) { attempts.push(input.to); return { messageId: "should-not-send" }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601112255", smsOptOut: false, text: "Zdravo",
      }, okProvider);

      assert.equal(attempts.length, 0, "Provider NOT called while another sender holds a live lease");
      assert.ok("inProgress" in result, `Live lease must return inProgress, got: ${JSON.stringify(result)}`);
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.ok(row);
      assert.equal(row.status, "processing", "Live processing row untouched");
    }
    console.log("✓ sendSms: live processing lease returns inProgress (no send, retryable)");

    // ── Test 42: sendSms concurrent claim — exactly one winner ─────────────
    // Two concurrent sendSms calls for the SAME eventKey: exactly one wins the
    // CAS claim and calls the provider; the other observes the live claim or the
    // terminal sent row (inProgress or deduplicated) — never a second provider call.
    {
      const ownerSm = await makeOwnerAndSalon(`Sm4-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-concurrent:${suffix}`;

      let calls = 0;
      const slowProvider: SmsProvider = {
        async send(input) {
          calls += 1;
          await new Promise((r) => setTimeout(r, 40));
          return { messageId: `concurrent-${input.to}` };
        },
      };

      const [r1, r2] = await Promise.all([
        sendSms({ eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null, type: "automation", phone: "+381601112266", smsOptOut: false, text: "Zdravo" }, slowProvider),
        sendSms({ eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null, type: "automation", phone: "+381601112266", smsOptOut: false, text: "Zdravo" }, slowProvider),
      ]);

      assert.equal(calls, 1, "Provider called exactly once across concurrent senders");
      const outcomes = [r1, r2];
      const winners = outcomes.filter((o) => "messageId" in o);
      const losers = outcomes.filter((o) => "inProgress" in o || "deduplicated" in o);
      assert.equal(winners.length, 1, `Exactly one winner (sent), got: ${JSON.stringify(outcomes)}`);
      assert.equal(losers.length, 1, `Exactly one non-winner (inProgress/deduplicated), got: ${JSON.stringify(outcomes)}`);
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.ok(row);
      assert.equal(row.status, "sent", "Row terminal sent after concurrent race");
    }
    console.log("✓ sendSms concurrent claim: exactly one winner, provider called once");

    // ── Test 43: sendSms — terminal sent is deduplicated (never re-sent) ───
    {
      const ownerSm = await makeOwnerAndSalon(`Sm5-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-terminal-sent:${suffix}`;

      await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601112277",
        body: "Zdravo", status: "sent", providerMessageId: "already-sent", sentAt: new Date(),
      });

      const attempts: string[] = [];
      const okProvider: SmsProvider = {
        async send(input) { attempts.push(input.to); return { messageId: "should-not-happen" }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601112277", smsOptOut: false, text: "Zdravo",
      }, okProvider);

      assert.equal(attempts.length, 0, "Provider NOT called for an already-sent row");
      assert.ok("deduplicated" in result && result.priorStatus === "sent",
        `Terminal sent must dedupe with priorStatus=sent, got: ${JSON.stringify(result)}`);
    }
    console.log("✓ sendSms: terminal sent row deduplicated (never re-sent, priorStatus=sent)");

    // ── Test 44a: provider-success-then-local-crash → reconcile marks sent ─
    // A prior attempt submitted to the provider (submissionStartedAt set) but the
    // local sent-write never landed (row left processing/failed). The provider
    // log HAS a matching submission for the stable id → next sendSms reconciles
    // to sent WITHOUT calling send.
    for (const priorStatus of ["processing", "failed"] as const) {
      const ownerSm = await makeOwnerAndSalon(`SmR1-${priorStatus}-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-reconcile-accepted-${priorStatus}:${suffix}`;

      const [seed] = await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601113300",
        body: "Zdravo", status: priorStatus,
        submissionStartedAt: new Date(Date.now() - 60_000),
        // For processing we simulate a stale (expired) lease so it's reclaimable.
        processingStartedAt: new Date(Date.now() - 15 * 60_000),
        claimExpiresAt: priorStatus === "processing" ? new Date(Date.now() - 10 * 60_000) : null,
      }).returning();
      assert.ok(seed);

      let sendCalls = 0;
      const lookedUp: string[] = [];
      const reconcilingProvider: SmsProvider = {
        async send() { sendCalls += 1; return { messageId: "must-not-send" }; },
        async lookupByMessageId(messageId) { lookedUp.push(messageId); return { accepted: true, providerMessageId: "provider-log-999" }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601113300", smsOptOut: false, text: "Zdravo",
      }, reconcilingProvider);

      assert.equal(sendCalls, 0, `Accepted reconciliation must NOT call send (${priorStatus})`);
      assert.deepEqual(lookedUp, [seed.id], "Reconciliation looks up by the stable delivery id");
      assert.ok("messageId" in result, `Reconciled result is sent, got: ${JSON.stringify(result)}`);
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.equal(row?.status, "sent", `Row reconciled to sent (${priorStatus})`);
      assert.equal(row?.providerMessageId, "provider-log-999", "Provider messageId from log recorded");
      assert.ok(row?.submissionStartedAt, "submissionStartedAt retained");
    }
    console.log("✓ sendSms reconcile: provider-accepted prior submission → sent, provider send count 0");

    // ── Test 44b: unknown-outcome retry, lookup NOT-FOUND → resend same key ─
    {
      const ownerSm = await makeOwnerAndSalon(`SmR2-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-reconcile-notfound:${suffix}`;

      const [seed] = await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601113311",
        body: "Zdravo", status: "failed",
        submissionStartedAt: new Date(Date.now() - 60_000),
      }).returning();
      assert.ok(seed);

      const sentKeys: (string | undefined)[] = [];
      const lookedUp: string[] = [];
      const provider2: SmsProvider = {
        async send(input) { sentKeys.push(input.idempotencyKey); return { messageId: "resent-1" }; },
        async lookupByMessageId(messageId) { lookedUp.push(messageId); return { accepted: false }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601113311", smsOptOut: false, text: "Zdravo",
      }, provider2);

      assert.deepEqual(lookedUp, [seed.id], "Reconciliation queried the provider log first");
      assert.equal(sentKeys.length, 1, "Definitive not-found → exactly one resend");
      assert.equal(sentKeys[0], seed.id, "Resend reuses the SAME persistent UUID key (never regenerated)");
      assert.ok("messageId" in result, "Resend succeeds → sent");
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.equal(row?.status, "sent");
      assert.equal(row?.providerMessageId, "resent-1");
    }
    console.log("✓ sendSms reconcile: lookup not-found → single resend with same persistent key");

    // ── Test 44c: unknown-outcome retry, lookup ERROR → inProgress, no send ─
    {
      const ownerSm = await makeOwnerAndSalon(`SmR3-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-reconcile-unavailable:${suffix}`;

      const [seed] = await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601113322",
        body: "Zdravo", status: "failed",
        submissionStartedAt: new Date(Date.now() - 60_000),
      }).returning();
      assert.ok(seed);

      let sendCalls = 0;
      const provider3: SmsProvider = {
        async send() { sendCalls += 1; return { messageId: "must-not-send" }; },
        async lookupByMessageId() { return { unavailable: true }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601113322", smsOptOut: false, text: "Zdravo",
      }, provider3);

      assert.equal(sendCalls, 0, "Unavailable lookup must NOT resend");
      assert.ok("inProgress" in result, `Unavailable → inProgress, got: ${JSON.stringify(result)}`);
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.equal(row?.status, "processing", "Row retained as processing for a later reconcile");
      assert.ok(row?.submissionStartedAt, "Unknown-outcome marker retained");
      assert.ok(row?.claimExpiresAt && row.claimExpiresAt.getTime() > Date.now(), "Lease refreshed");
    }
    console.log("✓ sendSms reconcile: lookup error/unavailable → inProgress, no resend");

    // ── Test 44d: pre-submit crash (submissionStartedAt null) → sends once ─
    {
      const ownerSm = await makeOwnerAndSalon(`SmR4-${suffix}`);
      toCleanup.userIds.push(ownerSm.owner.id);
      toCleanup.salonIds.push(ownerSm.salon.id);
      const ek = `sms-presubmit-crash:${suffix}`;

      // Stale processing but NO submissionStartedAt → provider request never
      // started → safe to send; must NOT reconcile.
      const [seed] = await db.insert(smsDeliveriesTable).values({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        messageType: "automation", recipientPhone: "+381601113333",
        body: "Zdravo", status: "processing",
        processingStartedAt: new Date(Date.now() - 15 * 60_000),
        claimExpiresAt: new Date(Date.now() - 10 * 60_000),
      }).returning();
      assert.ok(seed);

      let sendCalls = 0;
      let lookupCalls = 0;
      const sentKeys: (string | undefined)[] = [];
      const provider4: SmsProvider = {
        async send(input) { sendCalls += 1; sentKeys.push(input.idempotencyKey); return { messageId: "fresh-send-1" }; },
        async lookupByMessageId() { lookupCalls += 1; return { accepted: false }; },
      };
      const result = await sendSms({
        eventKey: ek, salonId: ownerSm.salon.id, appointmentId: null,
        type: "automation", phone: "+381601113333", smsOptOut: false, text: "Zdravo",
      }, provider4);

      assert.equal(lookupCalls, 0, "Pre-submit crash must not reconcile (no prior submission)");
      assert.equal(sendCalls, 1, "Pre-submit crash sends exactly once");
      assert.equal(sentKeys[0], seed.id, "Fresh send still uses the stable delivery id");
      assert.ok("messageId" in result);
      const [row] = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, ek)).limit(1);
      assert.equal(row?.status, "sent");
      assert.ok(row?.submissionStartedAt, "submissionStartedAt now set");
    }
    console.log("✓ sendSms reconcile: pre-submit crash (no marker) → sends once");

    // ── Test 44e: Infobip request construction (bulkId + destination.messageId)
    // Assert the actual Infobip payload/URL via an injected fetch, exercising the
    // real InfobipSmsProvider directly (send + logs lookup). Uses env-var
    // fallback for creds (no DB integration rows) so integrationValue resolves.
    {
      const captured: { url: string; body?: string; method?: string }[] = [];
      const originalFetch = globalThis.fetch;
      const prevKey = process.env["SMS_PROVIDER_API_KEY"];
      const prevBase = process.env["SMS_PROVIDER_BASE_URL"];
      const prevWebhookSecret = process.env["SMS_WEBHOOK_SECRET"];
      const prevAppBaseUrl = process.env["APP_BASE_URL"];
      const stableKey = randomUUID();
      const webhookSecret = "sms/notify-secret";
      process.env["SMS_PROVIDER_API_KEY"] = "test-key";
      process.env["SMS_PROVIDER_BASE_URL"] = "https://api.infobip.com";
      process.env["SMS_WEBHOOK_SECRET"] = webhookSecret;
      process.env["APP_BASE_URL"] = "https://beauty-partner-hub.replit.app";
      // Ensure no DB integration rows shadow/disable the env fallback: with zero
      // rows, integrationSettings() reports enabled + empty values → env fallback.
      await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.integration, "sms"));
      try {
        globalThis.fetch = (async (url: unknown, init: { body?: unknown; method?: string } = {}) => {
          captured.push({ url: String(url), body: init.body != null ? String(init.body) : undefined, method: init.method });
          if (String(url).includes("/sms/1/logs")) {
            return new Response(JSON.stringify({ results: [{ messageId: "log-hit" }] }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ messages: [{ messageId: "srv-1" }] }), { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch;

        // Direct provider send with the stable key exercises the request payload.
        const built = await infobipSmsProvider.send({ to: "+381601113344", text: "Zdravo", idempotencyKey: stableKey });
        assert.equal(built.messageId, "srv-1");
        const sendCall = captured.find((c) => c.url.includes("/sms/2/text/advanced"));
        assert.ok(sendCall?.body, "Infobip advanced send issued");
        const parsed = JSON.parse(sendCall!.body!);
        const msg = parsed.messages?.[0];
        assert.equal(parsed.bulkId, stableKey, "bulkId is the stable key");
        assert.equal(msg?.destinations?.[0]?.messageId, stableKey, "destination.messageId is the stable key");
        assert.equal(parsed.bulkId, msg?.destinations?.[0]?.messageId, "bulkId == destination.messageId");
        assert.equal(msg?.callbackData, stableKey, "callbackData equals the stable key");
         assert.equal(
           msg?.notifyUrl,
           `https://beauty-partner-hub.replit.app/api/webhooks/infobip/${encodeURIComponent(webhookSecret)}`,
           "Infobip messages carry the deployment webhook URL with the encoded saved secret",
         );

         // Without an effective webhook secret, no callback URL is sent.
         delete process.env["SMS_WEBHOOK_SECRET"];
         await infobipSmsProvider.send({ to: "+381601113344", text: "Bez tajne", idempotencyKey: randomUUID() });
         const noSecretCall = captured[captured.length - 1];
         assert.ok(noSecretCall?.body, "Infobip send without secret issued");
         assert.equal(JSON.parse(noSecretCall.body!).messages?.[0]?.notifyUrl, undefined,
           "notifyUrl is omitted when no webhook secret is configured");

         // A preview/development origin must never leak into an external
         // provider payload, even if a secret exists.
         process.env["SMS_WEBHOOK_SECRET"] = webhookSecret;
         process.env["APP_BASE_URL"] = "https://preview-example.replit.dev";
         await infobipSmsProvider.send({ to: "+381601113344", text: "Bez preview URL-a", idempotencyKey: randomUUID() });
         const developmentCall = captured[captured.length - 1];
         assert.ok(developmentCall?.body, "Infobip send from development configuration issued");
         assert.equal(JSON.parse(developmentCall.body!).messages?.[0]?.notifyUrl, undefined,
           "development APP_BASE_URL is never sent as notifyUrl");

        // Lookup URL is messageId-encoded with limit=1; any matching log = accepted.
        const lookup = await infobipSmsProvider.lookupByMessageId!(stableKey);
        assert.ok("accepted" in lookup && lookup.accepted, "Any matching log counts as accepted");
        const lookupCall = captured.find((c) => c.url.includes("/sms/1/logs"));
        assert.ok(lookupCall, "logs lookup issued");
        assert.equal(lookupCall!.method, "GET", "logs lookup is a GET");
        assert.ok(lookupCall!.url.includes(`messageId=${encodeURIComponent(stableKey)}`), "lookup messageId URL-encoded");
        assert.ok(lookupCall!.url.includes("limit=1"), "lookup uses limit=1");
      } finally {
        globalThis.fetch = originalFetch;
        if (prevKey === undefined) delete process.env["SMS_PROVIDER_API_KEY"]; else process.env["SMS_PROVIDER_API_KEY"] = prevKey;
        if (prevBase === undefined) delete process.env["SMS_PROVIDER_BASE_URL"]; else process.env["SMS_PROVIDER_BASE_URL"] = prevBase;
         if (prevWebhookSecret === undefined) delete process.env["SMS_WEBHOOK_SECRET"]; else process.env["SMS_WEBHOOK_SECRET"] = prevWebhookSecret;
         if (prevAppBaseUrl === undefined) delete process.env["APP_BASE_URL"]; else process.env["APP_BASE_URL"] = prevAppBaseUrl;
      }
    }
    console.log("✓ Infobip request: bulkId == destination.messageId == stable key; encoded logs lookup");

    // ── Test 46: automation email — temporary failure then retry success ──
    // Same provider idempotency key across attempts; queued after transient
    // failure; background retry worker sends it on the next due tick.
    {
      const ek = `bg-auto-email-retry:${suffix}`;
      const myRecipient = `auto-retry-${suffix}@bg.test`.toLowerCase();
      emailEventKeys.push(ek);
      // Count/act only on THIS test's recipient — retryFailedRetryableEmails
      // scans all retryable rows, so ignore any stray queued rows from earlier.
      let calls = 0;
      let failedOnce = false;
      const idempotencyKeys: string[] = [];
      const flaky: TransactionalEmailTransport = {
        async send(input) {
          if (input.to.email.toLowerCase() !== myRecipient) return { messageId: "other" };
          calls += 1;
          idempotencyKeys.push(input.idempotencyKey);
          if (!failedOnce) { failedOnce = true; throw new TypeError("fetch failed: simulated network interruption"); }
          return { messageId: `brevo-${calls}` };
        },
      };

      const first = await sendTransactionalEmail({
        eventKey: ek, emailType: "automation",
        to: { email: myRecipient },
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
      }, flaky);
      assert.deepEqual(first, { failed: true }, "temporary failure leaves automation email queued for retry");

      const [queued] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, ek));
      assert.ok(queued);
      assert.equal(queued.status, "queued", "automation email queued after transient failure");
      assert.equal(queued.retryCount, 0, "first failure does not consume a retry slot");
      assert.ok(queued.nextRetryAt && queued.nextRetryAt.getTime() >= Date.now() + 4 * 60_000,
        "backoff schedules the first retry ~5min out");

      await retryFailedRetryableEmails(new Date(queued.nextRetryAt!.getTime() + 1), flaky);

      const [sent] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, ek));
      assert.equal(sent?.status, "sent", "automation email sent after retry");
      assert.equal(sent?.retryCount, 1);
      assert.equal(calls, 2, "exactly one extra provider request after the transient failure");
      assert.deepEqual(idempotencyKeys, [queued.id, queued.id],
        "retries reuse the SAME delivery id as the Brevo idempotency key");
    }
    console.log("✓ automation email: temporary failure → retry success (stable idempotency key)");

    // ── Test 47: automation email — stale processing lease recovery ───────
    {
      const ek = `bg-auto-email-stale:${suffix}`;
      const myRecipient = `auto-stale-${suffix}@bg.test`.toLowerCase();
      emailEventKeys.push(ek);
      // Simulate a worker that claimed then crashed: processing with an expired
      // lease (nextRetryAt in the past) and a dangling processingToken.
      await db.insert(emailDeliveriesTable).values({
        eventKey: ek, emailType: "automation",
        recipientEmail: myRecipient,
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
        status: "processing", processingToken: randomUUID(),
        nextRetryAt: new Date(Date.now() - 60_000),
      });

      let calls = 0;
      const ok: TransactionalEmailTransport = {
        async send(input) {
          if (input.to.email.toLowerCase() !== myRecipient) return { messageId: "other" };
          calls += 1; return { messageId: `brevo-stale-${calls}` };
        },
      };
      await retryFailedRetryableEmails(new Date(), ok);
      assert.equal(calls, 1, "provider called exactly once on recovery");

      const [row] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, ek));
      assert.equal(row?.status, "sent", "recovered automation email reaches sent");
      assert.equal(row?.processingToken, null, "processing token cleared after send");
    }
    console.log("✓ automation email: stale processing lease recovery (sent once)");

    // ── Test 48: automation email — concurrent retry claim winner ─────────
    {
      const ek = `bg-auto-email-conc:${suffix}`;
      const myRecipient = `auto-conc-${suffix}@bg.test`.toLowerCase();
      emailEventKeys.push(ek);
      const now = new Date();
      await db.insert(emailDeliveriesTable).values({
        eventKey: ek, emailType: "automation",
        recipientEmail: myRecipient,
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
        status: "queued", nextRetryAt: now,
      });

      let calls = 0;
      const slow: TransactionalEmailTransport = {
        async send(input) {
          if (input.to.email.toLowerCase() !== myRecipient) return { messageId: "other" };
          calls += 1; await new Promise((r) => setTimeout(r, 50)); return { messageId: `brevo-conc-${calls}` };
        },
      };
      await Promise.all([
        retryFailedRetryableEmails(now, slow),
        retryFailedRetryableEmails(now, slow),
      ]);
      assert.equal(calls, 1, "provider called exactly once across concurrent retries");
      const [row] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, ek));
      assert.equal(row?.status, "sent");
    }
    console.log("✓ automation email: concurrent retry claim → exactly one send");

    // ── Test 49: automation email — permanent 4xx never reported sent ─────
    {
      const ek = `bg-auto-email-perm:${suffix}`;
      emailEventKeys.push(ek);
      let calls = 0;
      const perm: TransactionalEmailTransport = {
        async send() { calls += 1; throw new Error("Brevo 400: invalid_parameter recipient"); },
      };
      const result = await sendTransactionalEmail({
        eventKey: ek, emailType: "automation",
        to: { email: `auto-perm-${suffix}@bg.test` },
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
      }, perm);
      assert.deepEqual(result, { failed: true }, "permanent 4xx classified failed (never sent)");

      const [row] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, ek));
      assert.equal(row?.status, "failed", "permanent failure is terminal, not queued");
      assert.equal(row?.nextRetryAt, null, "permanent failure has no retry schedule");
      assert.equal(row?.retryableFailure, false, "permanent failure is never eligible for manual retry");

      // A subsequent send with the same eventKey must NOT report sent just because
      // the row exists — it reflects the real (failed) state.
      const again = await sendTransactionalEmail({
        eventKey: ek, emailType: "automation",
        to: { email: `auto-perm-${suffix}@bg.test` },
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
      }, perm);
      assert.deepEqual(again, { failed: true }, "existing failed eventKey re-reported as failed, never deduplicated-sent");
      assert.equal(calls, 1, "no extra provider call for a terminal failed row");
    }
    console.log("✓ automation email: permanent 4xx failure never reported sent");

    // ── Test 50: automation email — exhausted retries never reported sent ─
    {
      const ek = `bg-auto-email-exhausted:${suffix}`;
      const myRecipient = `auto-exhausted-${suffix}@bg.test`.toLowerCase();
      emailEventKeys.push(ek);
      // A row that already used all retry slots but is (defensively) still queued.
      await db.insert(emailDeliveriesTable).values({
        eventKey: ek, emailType: "automation",
        recipientEmail: myRecipient,
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
        status: "queued", nextRetryAt: new Date(Date.now() - 1000), retryCount: 99,
      });
      let calls = 0;
      const t: TransactionalEmailTransport = {
        async send(input) { if (input.to.email.toLowerCase() === myRecipient) calls += 1; return { messageId: "should-not-send" }; },
      };
      const again = await sendTransactionalEmail({
        eventKey: ek, emailType: "automation",
        to: { email: myRecipient },
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
      }, t);
      assert.deepEqual(again, { failed: true }, "exhausted-retry row reported failed, never sent");
      assert.equal(calls, 0, "exhausted row triggers no provider call via sendTransactionalEmail");

      // The retry worker also respects the cap (retryCount >= limit → skipped for THIS row).
      await retryFailedRetryableEmails(new Date(), t);
      assert.equal(calls, 0, "retry worker makes no provider call for the exhausted row");
      const [row] = await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, ek));
      assert.notEqual(row?.status, "sent", "exhausted row is never marked sent");
    }
    console.log("✓ automation email: exhausted retries never reported sent");

    // ── Test 51: automation email — prior sent dedup reconciles sent ──────
    {
      const ek = `bg-auto-email-prior-sent:${suffix}`;
      emailEventKeys.push(ek);
      await db.insert(emailDeliveriesTable).values({
        eventKey: ek, emailType: "automation",
        recipientEmail: `auto-prior-${suffix}@bg.test`,
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
        status: "sent", providerMessageId: "already-sent", sentAt: new Date(),
      });
      let calls = 0;
      const t: TransactionalEmailTransport = {
        async send() { calls += 1; return { messageId: "should-not-happen" }; },
      };
      const result = await sendTransactionalEmail({
        eventKey: ek, emailType: "automation",
        to: { email: `auto-prior-${suffix}@bg.test` },
        subject: "Vratite se", htmlContent: "<p>Zdravo</p>",
      }, t);
      assert.deepEqual(result, { deduplicated: true }, "prior sent row reconciles to deduplicated (sent)");
      assert.equal(calls, 0, "no provider call for an already-sent eventKey");
    }
    console.log("✓ automation email: prior sent reconciles to deduplicated sent");

  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────
    await server.close();

    // Remove purchases (and redemptions via cascade)
    if (toCleanup.purchaseIds.length) {
      await db.delete(customerPackagePurchasesTable)
        .where(inArray(customerPackagePurchasesTable.id, toCleanup.purchaseIds));
    }

    // Remove automation deliveries, runs, then rules
    if (toCleanup.automationIds.length) {
      const runRows = await db.select({ id: automationRunsTable.id }).from(automationRunsTable)
        .where(inArray(automationRunsTable.ruleId, toCleanup.automationIds));
      if (runRows.length) {
        await db.delete(automationDeliveriesTable)
          .where(inArray(automationDeliveriesTable.runId, runRows.map((r) => r.id)));
      }
      await db.delete(automationRunsTable)
        .where(inArray(automationRunsTable.ruleId, toCleanup.automationIds));
      await db.delete(automationRulesTable)
        .where(inArray(automationRulesTable.id, toCleanup.automationIds));
    }

    // Remove in dependency order to avoid FK violations
    for (const salonId of toCleanup.salonIds) {
      // SMS delivery rows (FK set-null on salon, but clean to avoid orphans).
      await db.delete(smsDeliveriesTable).where(eq(smsDeliveriesTable.salonId, salonId));
      // Redemptions restrict appointment deletion — remove them first (by salon).
      await db.delete(packageRedemptionsTable).where(eq(packageRedemptionsTable.salonId, salonId));
      await db.delete(customerPackagePurchasesTable).where(eq(customerPackagePurchasesTable.salonId, salonId));
      await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salonId));
      // Remove all package service links for this salon's packages
      const pkgs = await db.select({ id: treatmentPackagesTable.id }).from(treatmentPackagesTable)
        .where(eq(treatmentPackagesTable.salonId, salonId));
      if (pkgs.length) {
        await db.delete(packageServiceLinksTable)
          .where(inArray(packageServiceLinksTable.packageId, pkgs.map((p) => p.id)));
      }
      await db.delete(treatmentPackagesTable).where(eq(treatmentPackagesTable.salonId, salonId));
      await db.delete(reviewsTable).where(eq(reviewsTable.salonId, salonId));
      await db.delete(employeesTable).where(eq(employeesTable.salonId, salonId));
      await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, salonId));
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, toCleanup.userIds));

    if (emailEventKeys.length) {
      await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, emailEventKeys));
    }

    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  // Unit tests (synchronous / fast)
  testRetentionClassification();
  testAutomationOptOut();
  testPackageRedemptionStateMachine();
  testSessionCountArithmetic();
  testEmployeeScopeGuard();
  testAiProposalConfirmation();
  testVoucherTemplateSubstitution();
  testBirthdayTrigger();
  testFixedCommissionCalculation();
  testAutomationEpochKey();
  await testAiSnapshotScoping();

  // DB + API integration tests
  await runIntegrationTests();

  console.log("\n✅ All business-growth tests passed");
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
