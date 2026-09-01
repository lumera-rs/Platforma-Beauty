import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { asc, eq, inArray } from "drizzle-orm";
import {
  courseEnrollmentsTable, coursesTable, db, educationBundleCoursesTable,
  educationBundlePurchaseEscrowsTable, educationBundlePurchaseItemsTable,
  educationBundlePurchaseLedgerEntriesTable, educationBundlePurchasesTable,
  educationBundlesTable, educationCentersTable, educationEscrowsTable, educationPlatformSettingsTable, employeesTable,
  salonsTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, sessionCookieName } from "./auth";
import { educationIpsQrPayload, educationIpsRuntimeEnvironment } from "./education-marketplace-domain";

const suffix = randomUUID();
const password = "bundle-purchase-test-password";
type Options = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: Record<string, unknown>; cookie?: string; headers?: Record<string, string> };
async function request(baseUrl: string, path: string, options: Options = {}) {
  return fetch(`${baseUrl}/api${path}`, { method: options.method ?? "GET", headers: {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers,
  }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
}
async function login(baseUrl: string, email: string) {
  const response = await request(baseUrl, "/auth/login", { method: "POST", body: { email, password } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${sessionCookieName}=`));
  return cookie!;
}

async function run() {
  let server: ReturnType<typeof app.listen> | undefined;
  const userIds: string[] = [], salonIds: string[] = [], employeeIds: string[] = [], courseIds: string[] = [];
  let centerId: string | undefined, bundleId: string | undefined, purchaseId: string | undefined;
  let financeSettings: typeof educationPlatformSettingsTable.$inferSelect | undefined;
  try {
    const environment = { NODE_ENV: process.env.NODE_ENV, REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT, REPL_DEPLOYMENT: process.env.REPL_DEPLOYMENT, REPLIT_ENVIRONMENT: process.env.REPLIT_ENVIRONMENT };
    const classify = (values: Partial<typeof environment>) => {
      for (const key of Object.keys(environment) as Array<keyof typeof environment>) {
        if (key in values) process.env[key] = values[key];
        else delete process.env[key];
      }
      return educationIpsRuntimeEnvironment();
    };
    assert.equal(classify({ NODE_ENV: "production", REPLIT_DEPLOYMENT: "true" }), "production");
    assert.equal(classify({ NODE_ENV: "production", REPL_DEPLOYMENT: "1" }), "production");
    assert.equal(classify({ NODE_ENV: "production", REPLIT_DEPLOYMENT: "yes", REPLIT_ENVIRONMENT: "test" }), "test");
    assert.equal(classify({ NODE_ENV: "development", REPLIT_DEPLOYMENT: "true" }), "test");
    for (const key of Object.keys(environment) as Array<keyof typeof environment>) {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    }
    const individualPayload = educationIpsQrPayload({ recipientName: "Test centar", recipientAccount: "111111111111111111", purpose: "Test", amount: 1000, reference: "TEST-1", recipientType: "education_center_individual", transactionType: "course_enrollment", accountEnvironment: "test", runtimeEnvironment: "test" });
    assert.equal(individualPayload.paymentCode, "289");
    assert.match(individualPayload.payload, /SF:289/);
    assert.equal(educationIpsQrPayload({ recipientName: "Platforma", recipientAccount: "111111111111111111", purpose: "Test", amount: 1000, reference: "TEST-2", recipientType: "platform", transactionType: "subscription", accountEnvironment: "test", runtimeEnvironment: "test" }).paymentCode, "221");
    assert.throws(() => educationIpsQrPayload({ recipientName: "Platforma", recipientAccount: "111111111111111111", purpose: "Test", amount: 1000, reference: "TEST-3", recipientType: "platform", transactionType: "subscription", accountEnvironment: "production", runtimeEnvironment: "test" }), /IPS_PAYMENT_PRODUCTION_ACCOUNT_BLOCKED/);
    assert.throws(() => educationIpsQrPayload({ recipientName: "Platforma", recipientAccount: "123", purpose: "Test", amount: 1000, reference: "TEST-4", recipientType: "platform", transactionType: "subscription", accountEnvironment: "test", runtimeEnvironment: "test" }), /IPS_PAYMENT_ACCOUNT_INVALID/);
    const passwordHash = await hashPassword(password);
    const users = await db.insert(usersTable).values([
      { firstName: "Admin", lastName: "Bundle", email: `bundle-admin-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SUPER_ADMIN" },
      { firstName: "Center", lastName: "Owner", email: `bundle-center-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
      { firstName: "Individual", lastName: "Buyer", email: `bundle-buyer-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "STUDENT" },
      { firstName: "Salon", lastName: "Owner", email: `bundle-owner-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Other", lastName: "Owner", email: `bundle-other-owner-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Authorized", lastName: "Employee", email: `bundle-employee-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
      { firstName: "Foreign", lastName: "Employee", email: `bundle-foreign-employee-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" },
    ]).returning();
    userIds.push(...users.map(user => user.id));
    const [admin, centerOwner, buyer, salonOwner, otherOwner, employeeUser, foreignEmployeeUser] = users;
    const [existingSettings] = await db.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
    assert.ok(existingSettings, "Bundle settlement coverage requires platform settings.");
    financeSettings = existingSettings;
    await db.update(educationPlatformSettingsTable).set({ ipsRecipientName: "LUMERA TEST", ipsRecipientAccount: "111111111111111111", ipsPurpose: "Test uplata", ipsAccountEnvironment: "test" }).where(eq(educationPlatformSettingsTable.id, existingSettings.id));
    const [center] = await db.insert(educationCentersTable).values({ ownerId: centerOwner.id, name: `Bundle test ${suffix}`, city: "Beograd", description: "Test", imageUrl: "/test.jpg", verificationStatus: "verified" }).returning();
    assert.ok(center.paymentReferenceNumber?.startsWith("EDU"));
    await assert.rejects(db.update(educationCentersTable).set({ paymentReferenceNumber: `CHANGED-${suffix}` }).where(eq(educationCentersTable.id, center.id)));
    centerId = center.id;
    const courses = await db.insert(coursesTable).values([
      { centerId, title: "Bundle course one", description: "Test", category: "Test", format: "online", city: "Beograd", price: 12000, duration: "2 weeks", certification: true, imageUrl: "/test.jpg", published: true },
      { centerId, title: "Bundle course two", description: "Test", category: "Test", format: "online", city: "Beograd", price: 14000, duration: "3 weeks", certification: true, imageUrl: "/test.jpg", published: true },
    ]).returning();
    courseIds.push(...courses.map(course => course.id));
    const [bundle] = await db.insert(educationBundlesTable).values({ centerId, title: "Published bundle", description: "Test bundle", price: 21000, active: true, published: true }).returning();
    const testBundleId = bundle.id;
    bundleId = testBundleId;
    await db.insert(educationBundleCoursesTable).values(courses.map((course, sortOrder) => ({ bundleId: testBundleId, courseId: course.id, sortOrder })));
    const salons = await db.insert(salonsTable).values([
      { ownerId: salonOwner.id, name: `Owner salon ${suffix}`, slug: `bundle-owner-${suffix}`, city: "Beograd", municipality: "Vracar", address: "Test 1", phone: "111", email: `bundle-owner-salon-${suffix}@example.test`, shortDescription: "Test", description: "Test", imageUrl: "/test.jpg" },
      { ownerId: otherOwner.id, name: `Other salon ${suffix}`, slug: `bundle-other-${suffix}`, city: "Beograd", municipality: "Vracar", address: "Test 2", phone: "222", email: `bundle-other-salon-${suffix}@example.test`, shortDescription: "Test", description: "Test", imageUrl: "/test.jpg" },
    ]).returning();
    salonIds.push(...salons.map(salon => salon.id));
    assert.ok(salons.every(salon => salon.paymentReferenceNumber?.startsWith("SAL")));
    const employees = await db.insert(employeesTable).values([
      { salonId: salons[0].id, userId: employeeUser.id, name: "Authorized employee", role: "Stylist", bio: "Test", avatarUrl: "/test.jpg" },
      { salonId: salons[1].id, userId: foreignEmployeeUser.id, name: "Foreign employee", role: "Stylist", bio: "Test", avatarUrl: "/test.jpg" },
    ]).returning();
    employeeIds.push(...employees.map(employee => employee.id));

    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [adminCookie, centerCookie, buyerCookie, ownerCookie] = await Promise.all([login(baseUrl, admin.email), login(baseUrl, centerOwner.email), login(baseUrl, buyer.email), login(baseUrl, salonOwner.email)]);

    for (const body of [
      { price: 22000 },
      { name: "Edited published bundle" },
      { courseIds: [courses[0].id] },
    ]) {
      assert.equal((await request(baseUrl, `/education/centers/${centerId}/bundles/${testBundleId}`, { method: "PATCH", cookie: centerCookie, body })).status, 409,
        "Published bundle commercial terms and course set are immutable.");
    }
    assert.equal((await request(baseUrl, `/education/centers/${centerId}/bundles/${testBundleId}`, { method: "PATCH", cookie: centerCookie, body: { published: false } })).status, 200,
      "Center may unpublish a bundle.");
    assert.equal((await request(baseUrl, `/education/bundles/${testBundleId}`)).status, 404, "Unpublished bundle is not public.");
    assert.equal((await request(baseUrl, `/education/centers/${centerId}/bundles/${testBundleId}`, { method: "PATCH", cookie: centerCookie, body: { published: true } })).status, 200,
      "Center may republish an otherwise unchanged qualifying bundle.");
    const list = await request(baseUrl, "/education/bundles");
    assert.equal(list.status, 200);
    const listedBundle = (await list.json() as Array<{ id: string; courses: Array<{ courseId: string }> }>).find(row => row.id === testBundleId);
    assert.ok(listedBundle, "Published bundle must be listed publicly.");
    const detail = await request(baseUrl, `/education/bundles/${testBundleId}`);
    assert.equal(detail.status, 200);
    const detailBundle = await detail.json() as { courses: Array<{ courseId: string }> };
    const qualifyingCourseIds = courseIds.slice().sort();
    assert.deepEqual(listedBundle.courses.map(course => course.courseId).sort(), qualifyingCourseIds);
    assert.deepEqual(detailBundle.courses.map(course => course.courseId).sort(), qualifyingCourseIds);
    await db.update(coursesTable).set({ published: false }).where(eq(coursesTable.id, courses[1].id));
    assert.equal((await request(baseUrl, "/education/bundles")).status, 200);
    assert.equal((await (await request(baseUrl, "/education/bundles")).json() as Array<{ id: string }>).some(row => row.id === testBundleId), false,
      "A bundle with an inconsistent linked course set is not publicly listed.");
    assert.equal((await request(baseUrl, `/education/bundles/${testBundleId}`)).status, 409);
    assert.equal((await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: buyerCookie, headers: { "Idempotency-Key": `inconsistent-${suffix}` }, body: { targetType: "individual" } })).status, 409);
    await db.update(coursesTable).set({ published: true }).where(eq(coursesTable.id, courses[1].id));

    assert.equal((await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: buyerCookie, body: { targetType: "individual" } })).status, 400, "Idempotency-Key is required.");
    const key = `individual-${suffix}`;
    const created = await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: buyerCookie, headers: { "Idempotency-Key": key }, body: { targetType: "individual" } });
    assert.equal(created.status, 201);
    const purchase = await created.json() as { id: string; amount: number; paymentInstructions: { reference: string; recipientAccount: string } };
    purchaseId = purchase.id; assert.equal(purchase.amount, 21000); assert.ok(purchase.paymentInstructions);
    assert.equal(purchase.paymentInstructions.recipientAccount, "111111111111111111");
    const secondPurchaseResponse = await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, {
      method: "POST", cookie: buyerCookie, headers: { "Idempotency-Key": `individual-second-${suffix}` },
      body: { targetType: "individual" },
    });
    assert.equal(secondPurchaseResponse.status, 201, "The same bundle can issue a separate purchase reference.");
    const secondPurchase = await secondPurchaseResponse.json() as { id: string; paymentInstructions: { reference: string } };
    assert.notEqual(secondPurchase.id, purchase.id);
    assert.notEqual(secondPurchase.paymentInstructions.reference, purchase.paymentInstructions.reference,
      "Bundle payment references derive from the purchase UUID, not the bundle UUID.");
    await db.update(educationPlatformSettingsTable).set({ ipsRecipientAccount: "222222222222222222" }).where(eq(educationPlatformSettingsTable.id, financeSettings.id));
    const pdfResponse = await request(baseUrl, `/education/payment-slips/bundle/${purchaseId}`, { cookie: buyerCookie });
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get("content-type") ?? "", /application\/pdf/);
    const pdfText = Buffer.from(await pdfResponse.arrayBuffer()).toString("latin1");
    assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length, 1, "A4 uplatnica must contain exactly one page.");
    assert.match(pdfText, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(pdfText, /(?:31){18}/, "PDF renders the hex-encoded account snapshot captured by this purchase.");
    assert.doesNotMatch(pdfText, /(?:32){18}/, "PDF never regenerates from current platform settings.");
    assert.deepEqual((await db.select().from(educationBundlePurchaseItemsTable).where(eq(educationBundlePurchaseItemsTable.purchaseId, purchaseId))).map(item => item.courseId).sort(), qualifyingCourseIds,
      "Purchase snapshots exactly the same qualifying course set shown publicly.");
    const replay = await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: buyerCookie, headers: { "Idempotency-Key": key }, body: { targetType: "individual" } });
    assert.equal(replay.status, 200); assert.equal((await replay.json() as { id: string }).id, purchaseId);
    assert.equal((await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: buyerCookie, headers: { "Idempotency-Key": key }, body: { targetType: "salon_employee", salonId: salons[0].id, employeeId: employees[0].id } })).status, 409);
    assert.equal((await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.id, purchaseId))).length, 1);

    assert.equal((await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: ownerCookie, headers: { "Idempotency-Key": `foreign-${suffix}` }, body: { targetType: "salon_employee", salonId: salons[1].id, employeeId: employees[1].id } })).status, 403);
    const employeePurchaseResponse = await request(baseUrl, `/education/bundles/${testBundleId}/purchases`, { method: "POST", cookie: ownerCookie, headers: { "Idempotency-Key": `employee-${suffix}` }, body: { targetType: "salon_employee", salonId: salons[0].id, employeeId: employees[0].id } });
    assert.equal(employeePurchaseResponse.status, 201, "Salon owner may buy for their active employee.");
    const employeePurchaseId = (await employeePurchaseResponse.json() as { id: string }).id;
    assert.equal((await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.id, employeePurchaseId)))[0]?.learnerUserId, employeeUser.id,
      "Employee purchase snapshots the employee's linked learner account.");

    const purchaserList = await request(baseUrl, "/education/bundle-purchases", { cookie: buyerCookie });
    assert.ok(Object.hasOwn((await purchaserList.json() as Array<object>)[0]!, "paymentInstructions"), "Only purchaser receives payment instructions.");
    const centerList = await request(baseUrl, `/education/centers/${centerId}/bundle-purchases`, { cookie: centerCookie });
    assert.equal(centerList.status, 200);
    const centerPurchase = (await centerList.json() as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(Object.keys(centerPurchase).sort(), ["amount", "bundleId", "id", "participantName", "requestedAt", "settledAt", "status", "targetType"]);
    for (const privateField of ["purchaserId", "learnerUserId", "salonId", "employeeId", "paymentInstructions"]) assert.equal(Object.hasOwn(centerPurchase, privateField), false);
    const adminList = await request(baseUrl, "/admin/education/bundle-purchases/pending", { cookie: adminCookie });
    assert.equal(adminList.status, 200); assert.equal(Object.hasOwn((await adminList.json() as Array<object>)[0]!, "paymentInstructions"), false);

    const beforeItems = await db.select().from(educationBundlePurchaseItemsTable).where(eq(educationBundlePurchaseItemsTable.purchaseId, purchaseId));
    assert.equal((await request(baseUrl, `/education/centers/${centerId}/bundles/${testBundleId}`, { method: "PATCH", cookie: centerCookie, body: { price: 99999, courseIds: [courses[0].id] } })).status, 409,
      "A purchased bundle remains immutable.");
    const afterItems = await db.select().from(educationBundlePurchaseItemsTable).where(eq(educationBundlePurchaseItemsTable.purchaseId, purchaseId));
    assert.equal((await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.id, purchaseId)))[0]?.amount, 21000);
    assert.deepEqual(afterItems.map(item => item.courseId).sort(), beforeItems.map(item => item.courseId).sort(), "Purchased course snapshot must survive later bundle edits.");
    assert.deepEqual(afterItems.map(item => item.courseTerms), beforeItems.map(item => item.courseTerms), "Purchased terms must survive later course edits.");

    await db.update(educationPlatformSettingsTable).set({ commissionPercent: 60, reservePercent: 50 }).where(eq(educationPlatformSettingsTable.id, financeSettings.id));
    assert.equal((await request(baseUrl, `/admin/education/bundle-purchases/${purchaseId}/settle`, { method: "POST", cookie: adminCookie })).status, 409,
      "Settlement rejects commission and reserve totals above 100%.");
    assert.equal((await db.select().from(educationBundlePurchaseEscrowsTable).where(eq(educationBundlePurchaseEscrowsTable.purchaseId, purchaseId))).length, 0);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bundlePurchaseId, purchaseId))).length, 0);
    await db.update(educationPlatformSettingsTable).set({ commissionPercent: financeSettings.commissionPercent, reservePercent: financeSettings.reservePercent }).where(eq(educationPlatformSettingsTable.id, financeSettings.id));
    await db.update(employeesTable).set({ userId: foreignEmployeeUser.id }).where(eq(employeesTable.id, employees[0].id));
    assert.equal((await request(baseUrl, `/admin/education/bundle-purchases/${employeePurchaseId}/settle`, { method: "POST", cookie: adminCookie })).status, 409,
      "Settlement rejects an employee identity relink.");
    assert.equal((await db.select().from(educationBundlePurchaseEscrowsTable).where(eq(educationBundlePurchaseEscrowsTable.purchaseId, employeePurchaseId))).length, 0);
    await db.update(employeesTable).set({ userId: employeeUser.id }).where(eq(employeesTable.id, employees[0].id));
    assert.equal((await request(baseUrl, `/admin/education/bundle-purchases/${employeePurchaseId}/settle`, { method: "POST", cookie: adminCookie })).status, 200,
      "Settlement succeeds once the original employee identity is restored.");
    assert.ok((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bundlePurchaseId, employeePurchaseId))).every(row => row.userId === employeeUser.id));
    const settled = await request(baseUrl, `/admin/education/bundle-purchases/${purchaseId}/settle`, { method: "POST", cookie: adminCookie });
    assert.equal(settled.status, 200); assert.equal(Object.hasOwn(await settled.json() as object, "paymentInstructions"), false);
    assert.equal((await request(baseUrl, `/admin/education/bundle-purchases/${purchaseId}/settle`, { method: "POST", cookie: adminCookie })).status, 200, "Settlement replay is safe.");
    const escrows = await db.select().from(educationBundlePurchaseEscrowsTable).where(eq(educationBundlePurchaseEscrowsTable.purchaseId, purchaseId));
    assert.equal(escrows.length, 1);
    assert.equal(escrows[0].grossAmount, 21000);
    assert.ok(escrows[0].platformFeeAmount >= 0 && escrows[0].reserveAmount >= 0 && escrows[0].netAmount >= 0);
    assert.equal(escrows[0].netAmount, escrows[0].grossAmount - escrows[0].platformFeeAmount - escrows[0].reserveAmount);
    const ledger = await db.select().from(educationBundlePurchaseLedgerEntriesTable).where(eq(educationBundlePurchaseLedgerEntriesTable.escrowId, escrows[0].id));
    assert.deepEqual(ledger.map(row => row.entryType).sort(), ["charge", "platform_fee", "reserve_hold"]);
    assert.equal(ledger.find(row => row.entryType === "charge")?.amount, escrows[0].grossAmount);
    assert.equal(ledger.find(row => row.entryType === "platform_fee")?.amount, escrows[0].platformFeeAmount);
    assert.equal(ledger.find(row => row.entryType === "reserve_hold")?.amount, escrows[0].reserveAmount);
    const enrollments = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bundlePurchaseId, purchaseId));
    assert.equal(enrollments.length, beforeItems.length); assert.ok(enrollments.every(row => row.bundlePurchaseId === purchaseId && row.status === "active" && row.paymentStatus === "paid"));
    assert.equal((await db.select().from(educationEscrowsTable).where(inArray(educationEscrowsTable.enrollmentId, enrollments.map(row => row.id)))).length, 0, "Bundle children never receive independent escrow/ledger rows.");
    assert.equal((await request(baseUrl, `/education/centers/${centerId}/bundles/${testBundleId}`, { method: "DELETE", cookie: centerCookie })).status, 204,
      "Center may archive a bundle.");
    console.log("Education bundle purchase regression passed.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (financeSettings) await db.update(educationPlatformSettingsTable).set({
      commissionPercent: financeSettings.commissionPercent, reservePercent: financeSettings.reservePercent,
      ipsRecipientName: financeSettings.ipsRecipientName, ipsRecipientAccount: financeSettings.ipsRecipientAccount,
      ipsPurpose: financeSettings.ipsPurpose, ipsAccountEnvironment: financeSettings.ipsAccountEnvironment,
    }).where(eq(educationPlatformSettingsTable.id, financeSettings.id));
    if (bundleId) {
      const purchases = await db.select({ id: educationBundlePurchasesTable.id }).from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.bundleId, bundleId));
      if (purchases.length) {
        const ids = purchases.map(row => row.id);
        await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.bundlePurchaseId, ids));
        await db.delete(educationBundlePurchasesTable).where(inArray(educationBundlePurchasesTable.id, ids));
      }
      await db.delete(educationBundleCoursesTable).where(eq(educationBundleCoursesTable.bundleId, bundleId));
      await db.delete(educationBundlesTable).where(eq(educationBundlesTable.id, bundleId));
    }
    if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    if (courseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    if (centerId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    if (financeSettings) await db.update(educationPlatformSettingsTable).set({ commissionPercent: financeSettings.commissionPercent, reservePercent: financeSettings.reservePercent }).where(eq(educationPlatformSettingsTable.id, financeSettings.id));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });