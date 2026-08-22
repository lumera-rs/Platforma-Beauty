/**
 * Integration tests for Education extras:
 *  1. PDF certificate download (GET /education/enrollments/:id/certificate)
 *  2. ICS calendar export (GET /education/enrollments/:id/session.ics)
 *  3. Refund policy visible in public course list
 *  4. Multi-employee group enrollment with server-validated group discount
 *
 * Run: node --experimental-vm-modules src/lib/education-extras.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationEscrowsTable,
  educationLedgerEntriesTable,
  employeesTable,
  lessonProgressTable,
  courseModulesTable,
  courseLessonsTable,
  subscriptionPlansTable,
  usersTable,
  salonsTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const password = "edu-extras-test-password-2025";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  cookie?: string;
  headers?: Record<string, string>;
};

async function request(baseUrl: string, path: string, options: RequestOptions = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await request(baseUrl, "/auth/login", { method: "POST", body: { email, password } });
  assert.equal(response.status, 200, `Fixture user ${email} must be able to sign in.`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${sessionCookieName}=`), `Login for ${email} must establish a session.`);
  if (!cookie) throw new Error(`Login for ${email} did not return a session cookie.`);
  return cookie;
}

async function run(): Promise<void> {
  await ensureDemoData();

  let server: ReturnType<typeof app.listen> | undefined;
  const createdUserIds: string[] = [];
  const courseIds: string[] = [];
  const enrollmentIds: string[] = [];
  let centerId: string | undefined;
  let salonId: string | undefined;

  try {
    const fixturePasswordHash = await hashPassword(password);
    const fixtureUsers = await db.insert(usersTable).values([
      {
        firstName: "Extras",
        lastName: "Admin",
        email: `extras-admin-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "SUPER_ADMIN",
      },
      {
        firstName: "Centar",
        lastName: "Extras",
        email: `extras-center-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "EDUCATION_CENTER_OWNER",
      },
      {
        firstName: "Kupac",
        lastName: "Extras",
        email: `extras-buyer-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
      {
        firstName: "Salon",
        lastName: "Vlasnik",
        email: `extras-salon-owner-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      // Employee user accounts (they authenticate as SALON_EMPLOYEE)
      {
        firstName: "Zaposleni",
        lastName: "Jedan",
        email: `extras-emp1-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
      {
        firstName: "Zaposleni",
        lastName: "Dva",
        email: `extras-emp2-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
    ]).returning();
    createdUserIds.push(...fixtureUsers.map((u) => u.id));

    const admin = fixtureUsers[0]!;
    const centerOwner = fixtureUsers[1]!;
    const buyer = fixtureUsers[2]!;
    const salonOwner = fixtureUsers[3]!;
    const empUser1 = fixtureUsers[4]!;
    const empUser2 = fixtureUsers[5]!;

    const [plan] = await db.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.active, true)).limit(1);
    assert.ok(plan, "Education extras test requires an active subscription plan.");

    // Create and verify the education center
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: centerOwner.id,
      name: `Extras Coverage Center ${suffix}`,
      city: "Novi Sad",
      description: "Centar za proveru edukacionih ekstra funkcija.",
      imageUrl: "/test-extras.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: admin.id,
    }).returning();
    assert.ok(center);
    centerId = center.id;

    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: center.id,
      planId: plan.id,
      status: "active",
      dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // Create a salon for the salon owner
    const [salon] = await db.insert(salonsTable).values({
      ownerId: salonOwner.id,
      name: `Extras Test Salon ${suffix}`,
      slug: `extras-test-salon-${suffix.slice(0, 8)}`,
      city: "Novi Sad",
      municipality: "Novi Sad",
      address: "Testna ulica 1",
      phone: "+381601234567",
      email: `extras-salon-${suffix}@example.test`,
      shortDescription: "Test salon za extras proveru.",
      description: "Test salon.",
      imageUrl: "/test-salon.jpg",
    }).returning();
    assert.ok(salon);
    salonId = salon.id;

    // Create employee records linked to the salon and user accounts
    const [emp1, emp2] = await db.insert(employeesTable).values([
      { salonId: salon.id, userId: empUser1.id, name: "Zaposleni Jedan", role: "employee", bio: "", avatarUrl: "", active: true },
      { salonId: salon.id, userId: empUser2.id, name: "Zaposleni Dva", role: "employee", bio: "", avatarUrl: "", active: true },
    ]).returning();
    assert.ok(emp1);
    assert.ok(emp2);

    // ── Courses ──────────────────────────────────────────────────────────────

    // 1. Online certification course (for PDF certificate test)
    const [certCourse] = await db.insert(coursesTable).values({
      centerId: center.id,
      title: `Certificate Course ${suffix}`,
      description: "Kurs sa sertifikatom za proveru PDF preuzimanja.",
      category: "Sertifikacija",
      format: "online",
      city: "Novi Sad",
      price: 8000,
      duration: "2 nedelje",
      certification: true,
      imageUrl: "/test-extras.jpg",
      published: true,
      refundPolicy: "Povraćaj unutar 14 dana od kupovine.",
      groupDiscountMinimum: 2,
      groupDiscountPercent: 15,
    }).returning();
    assert.ok(certCourse);
    courseIds.push(certCourse.id);

    // 2. Live session course (for ICS export test)
    const futureStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 8 * 60 * 60 * 1000);
    const [liveCourse] = await db.insert(coursesTable).values({
      centerId: center.id,
      title: `ICS Session Course ${suffix}`,
      description: "Kurs uživo za proveru ICS eksporta.",
      category: "Uživo",
      format: "in-person",
      city: "Novi Sad",
      price: 9000,
      duration: "1 dan",
      certification: false,
      imageUrl: "/test-extras.jpg",
      published: true,
      refundPolicy: "Bez povraćaja manje od 48h pre termina.",
    }).returning();
    assert.ok(liveCourse);
    courseIds.push(liveCourse.id);

    const [liveSession] = await db.insert(courseSessionsTable).values({
      courseId: liveCourse.id,
      startsAt: futureStart,
      endsAt: futureEnd,
      location: "Testna ulica 5, Novi Sad",
      capacity: 10,
    }).returning();
    assert.ok(liveSession);

    // ── Module + lessons for certCourse (needed for completion) ───────────────
    const [module] = await db.insert(courseModulesTable).values({
      courseId: certCourse.id,
      title: "Modul 1",
      sortOrder: 1,
    }).returning();
    assert.ok(module);

    const [lesson] = await db.insert(courseLessonsTable).values({
      moduleId: module.id,
      title: "Lekcija 1",
      content: "Sadržaj lekcije.",
      durationMinutes: 10,
      sortOrder: 1,
    }).returning();
    assert.ok(lesson);

    // Start the HTTP server
    server = app.listen(0);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://localhost:${port}`;

    const adminCookie = await login(baseUrl, admin.email);
    const buyerCookie = await login(baseUrl, buyer.email);
    const salonOwnerCookie = await login(baseUrl, salonOwner.email);

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: Refund policy visible in public course list
    // ═══════════════════════════════════════════════════════════════════════
    {
      const pubResp = await request(baseUrl, "/education/public/courses");
      assert.equal(pubResp.status, 200, "Public courses endpoint must respond 200.");
      const courses = await json<Array<Record<string, unknown>>>(pubResp);
      const found = courses.find((c) => c.id === certCourse.id);
      assert.ok(found, "certCourse must appear in public listing.");
      assert.equal(found.refundPolicy, "Povraćaj unutar 14 dana od kupovine.", "refundPolicy must be present in public course view.");
      assert.equal(found.groupDiscountMinimum, 2, "groupDiscountMinimum must be included.");
      assert.equal(found.groupDiscountPercent, 15, "groupDiscountPercent must be included.");
      console.log("✓ Refund policy and group discount info visible in public course listing.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: Certificate endpoint rejects non-completed enrollment
    // ═══════════════════════════════════════════════════════════════════════
    {
      // Create a pending enrollment for buyer
      const [pendingEnrollment] = await db.insert(courseEnrollmentsTable).values({
        courseId: certCourse.id,
        userId: buyer.id,
        purchaserId: buyer.id,
        status: "pending",
        paymentStatus: "pending",
      }).returning();
      assert.ok(pendingEnrollment);
      enrollmentIds.push(pendingEnrollment.id);

      const certResp = await request(baseUrl, `/education/enrollments/${pendingEnrollment.id}/certificate`, { cookie: buyerCookie });
      assert.equal(certResp.status, 409, "Certificate must be rejected for non-completed/non-paid enrollment.");
      const certBody = await json<{ error: string }>(certResp);
      assert.ok(certBody.error, "Error message must be present.");
      console.log("✓ Certificate rejected for pending enrollment.");

      // Clean up pending enrollment (replace with active completed one below)
      await db.delete(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, pendingEnrollment.id));
      enrollmentIds.length = 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: Certificate downloads successfully for completed paid enrollment
    // ═══════════════════════════════════════════════════════════════════════
    {
      // Insert a completed paid enrollment for buyer on certCourse
      const [completedEnrollment] = await db.insert(courseEnrollmentsTable).values({
        courseId: certCourse.id,
        userId: buyer.id,
        purchaserId: buyer.id,
        status: "completed",
        paymentStatus: "paid",
        progress: 100,
        accessGrantedAt: new Date(),
        completedAt: new Date(),
      }).returning();
      assert.ok(completedEnrollment);
      enrollmentIds.push(completedEnrollment.id);

      // Mark lesson as completed (not required for route, just for coherence)
      await db.insert(lessonProgressTable).values({
        enrollmentId: completedEnrollment.id,
        lessonId: lesson.id,
        completedByUserId: buyer.id,
      });

      const certResp = await request(baseUrl, `/education/enrollments/${completedEnrollment.id}/certificate`, { cookie: buyerCookie });
      assert.equal(certResp.status, 200, "Certificate must download for completed paid enrollment.");
      assert.equal(certResp.headers.get("content-type"), "application/pdf", "Content-Type must be application/pdf.");
      const disposition = certResp.headers.get("content-disposition") ?? "";
      assert.ok(disposition.includes("attachment"), "Content-Disposition must be attachment.");
      assert.ok(disposition.includes(".pdf"), "Filename must end with .pdf.");
      const pdfBytes = Buffer.from(await certResp.arrayBuffer());
      assert.ok(pdfBytes.length > 500, "PDF must have non-trivial size.");
      assert.ok(pdfBytes.subarray(0, 4).toString() === "%PDF", "Response must start with PDF magic bytes.");
      console.log(`✓ PDF certificate downloaded (${pdfBytes.length} bytes).`);

      // Verify certificate number was persisted
      const [updated] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, completedEnrollment.id)).limit(1);
      assert.ok(updated?.certificateNumber, "certificateNumber must be set after first certificate download.");
      assert.ok(updated?.certificateIssuedAt, "certificateIssuedAt must be set.");

      // Second download must return the same cert number (idempotent)
      const certResp2 = await request(baseUrl, `/education/enrollments/${completedEnrollment.id}/certificate`, { cookie: buyerCookie });
      assert.equal(certResp2.status, 200, "Second certificate download must succeed.");
      const [updated2] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, completedEnrollment.id)).limit(1);
      assert.equal(updated2?.certificateNumber, updated?.certificateNumber, "Certificate number must be stable across downloads.");
      console.log("✓ Certificate number is stable (idempotent).");

      // Non-owner cannot download
      const otherResp = await request(baseUrl, `/education/enrollments/${completedEnrollment.id}/certificate`, { cookie: salonOwnerCookie });
      assert.equal(otherResp.status, 403, "Non-purchaser must not download another user's certificate.");
      console.log("✓ Certificate access control enforced.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: Certificate rejected when course has certification=false
    // ═══════════════════════════════════════════════════════════════════════
    {
      const [noCertEnrollment] = await db.insert(courseEnrollmentsTable).values({
        courseId: liveCourse.id,
        userId: buyer.id,
        purchaserId: buyer.id,
        status: "completed",
        paymentStatus: "paid",
        progress: 100,
        accessGrantedAt: new Date(),
        completedAt: new Date(),
        sessionId: liveSession.id,
      }).returning();
      assert.ok(noCertEnrollment);
      enrollmentIds.push(noCertEnrollment.id);

      const certResp = await request(baseUrl, `/education/enrollments/${noCertEnrollment.id}/certificate`, { cookie: buyerCookie });
      assert.equal(certResp.status, 409, "Certificate must be rejected for a course without certification.");
      console.log("✓ Certificate rejected for non-certification course.");

      // ── ICS export for this live enrollment ────────────────────────────
      const icsResp = await request(baseUrl, `/education/enrollments/${noCertEnrollment.id}/session.ics`, { cookie: buyerCookie });
      assert.equal(icsResp.status, 200, "ICS must download for paid live enrollment with sessionId.");
      const contentType = icsResp.headers.get("content-type") ?? "";
      assert.ok(contentType.startsWith("text/calendar"), "Content-Type must be text/calendar.");
      const icsText = await icsResp.text();
      // RFC 5545 §3.1: content lines longer than 75 octets are folded with
      // CRLF + a single leading space. Unfold before validating property values
      // so a long SUMMARY that was legitimately split is decoded correctly.
      const icsUnfolded = icsText.replace(/\r\n[ \t]/g, "");
      assert.ok(icsText.startsWith("BEGIN:VCALENDAR"), "ICS must start with VCALENDAR.");
      assert.ok(icsText.includes("BEGIN:VEVENT"), "ICS must contain a VEVENT.");
      assert.ok(icsText.includes("END:VCALENDAR"), "ICS must end with END:VCALENDAR.");
      // Every folded (continuation) line must begin with a space or tab, and no
      // content line may exceed 75 octets — proving the folding is RFC-valid.
      for (const line of icsText.replace(/\r\n$/, "").split("\r\n")) {
        assert.ok(Buffer.byteLength(line, "utf8") <= 75, `ICS content line must not exceed 75 octets: ${line}`);
      }
      assert.ok(icsUnfolded.includes(`LOCATION:Testna ulica 5\\, Novi Sad`), "ICS must include the RFC 5545-escaped session location.");
      assert.ok(icsUnfolded.includes(liveCourse.title), "Unfolded ICS must include course title in SUMMARY.");
      assert.ok(icsUnfolded.includes(`SUMMARY:LUMERA Edukacije: ${liveCourse.title}`), "Decoded SUMMARY must carry the full course title.");
      console.log("✓ ICS calendar file generated, RFC-folded, and validated.");

      // ICS for enrollment without sessionId must return 409
      const [enrollmentNoSession] = await db.insert(courseEnrollmentsTable).values({
        courseId: certCourse.id,
        userId: salonOwner.id,
        purchaserId: salonOwner.id,
        status: "active",
        paymentStatus: "paid",
        accessGrantedAt: new Date(),
      }).returning();
      assert.ok(enrollmentNoSession);
      enrollmentIds.push(enrollmentNoSession.id);

      const salonOwnerOnCertCookie = salonOwnerCookie; // reuse
      const icsNoSession = await request(baseUrl, `/education/enrollments/${enrollmentNoSession.id}/session.ics`, { cookie: salonOwnerOnCertCookie });
      assert.equal(icsNoSession.status, 409, "ICS export must fail when enrollment has no session.");
      console.log("✓ ICS rejected for enrollment without session.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: Group enrollment — discount validation
    // ═══════════════════════════════════════════════════════════════════════
    {
      // Single employee should be rejected (below minimum)
      const groupResp1 = await request(baseUrl, `/education/courses/${certCourse.id}/group-enrollments`, {
        method: "POST",
        cookie: salonOwnerCookie,
        headers: { "idempotency-key": randomUUID() },
        body: { employeeIds: [emp1.id] },
      });
      assert.equal(groupResp1.status, 400, "Group enrollment with fewer than minimum employees must return 400.");
      const groupBody1 = await json<{ error: string; minimumRequired: number }>(groupResp1);
      assert.ok(groupBody1.error.includes("2"), "Error must mention the minimum requirement.");
      assert.equal(groupBody1.minimumRequired, 2);
      console.log("✓ Group enrollment rejected below minimum (server-validated).");

      // Two employees should succeed
      const iKey = randomUUID();
      const groupResp2 = await request(baseUrl, `/education/courses/${certCourse.id}/group-enrollments`, {
        method: "POST",
        cookie: salonOwnerCookie,
        headers: { "idempotency-key": iKey },
        body: { employeeIds: [emp1.id, emp2.id] },
      });
      assert.equal(groupResp2.status, 201, "Group enrollment with enough employees must return 201.");
      const groupBody2 = await json<{
        enrollments: Array<{ id: string; employeeId?: string | null }>;
        discountPercent: number;
        unitPrice: number;
        totalPrice: number;
      }>(groupResp2);
      assert.equal(groupBody2.enrollments.length, 2, "Must create one enrollment per employee.");
      assert.equal(groupBody2.discountPercent, 15, "Discount percent must match course configuration.");
      const expectedUnitPrice = Math.round(certCourse.price * (1 - 15 / 100));
      assert.equal(groupBody2.unitPrice, expectedUnitPrice, "Unit price must reflect discount.");
      assert.equal(groupBody2.totalPrice, expectedUnitPrice * 2, "Total price must be unitPrice × count.");
      for (const enrollment of groupBody2.enrollments) {
        enrollmentIds.push(enrollment.id);
      }
      const empIds = new Set(groupBody2.enrollments.map((e) => e.employeeId));
      assert.ok(empIds.has(emp1.id), "emp1 must have an enrollment.");
      assert.ok(empIds.has(emp2.id), "emp2 must have an enrollment.");
      console.log(`✓ Group enrollment succeeded: 2 enrollments, ${groupBody2.discountPercent}% discount, unit price ${groupBody2.unitPrice} RSD.`);

      // ── Discounted charged amount must persist on each seat ─────────────────
      const groupEnrollmentRows = await db.select().from(courseEnrollmentsTable)
        .where(inArray(courseEnrollmentsTable.id, groupBody2.enrollments.map((e) => e.id)));
      assert.equal(groupEnrollmentRows.length, 2, "Both group enrollment rows must exist.");
      for (const row of groupEnrollmentRows) {
        assert.equal(row.status, "pending", "Center group seat must start pending.");
        assert.equal(row.paymentStatus, "pending", "Center group seat must start unpaid.");
        assert.equal(row.chargedAmount, expectedUnitPrice, "Discounted charged amount must persist on the seat.");
      }
      console.log("✓ Discounted charged amount persisted on each group seat.");

      // ── Settlement must charge the discounted amount, not the list price ────
      const seatToSettle = groupEnrollmentRows[0]!;
      const settleResp = await request(baseUrl, `/admin/education/enrollments/${seatToSettle.id}/settle`, {
        method: "POST",
        cookie: adminCookie,
      });
      assert.equal(settleResp.status, 200, "Admin must settle a pending group seat.");
      const [settledEscrow] = await db.select().from(educationEscrowsTable)
        .where(eq(educationEscrowsTable.enrollmentId, seatToSettle.id)).limit(1);
      assert.ok(settledEscrow, "Settling must create an escrow.");
      assert.equal(settledEscrow!.grossAmount, expectedUnitPrice,
        "Escrow gross must equal the discounted charged amount, not the list price.");
      const [chargeLedger] = await db.select().from(educationLedgerEntriesTable)
        .where(and(eq(educationLedgerEntriesTable.escrowId, settledEscrow!.id), eq(educationLedgerEntriesTable.type, "charge")));
      assert.ok(chargeLedger, "A charge ledger entry must exist.");
      assert.equal(chargeLedger!.amount, expectedUnitPrice,
        "Charge ledger amount must equal the discounted charged amount.");
      assert.ok(settledEscrow!.grossAmount < certCourse.price,
        "Discounted escrow must be below the undiscounted course price.");
      console.log("✓ Settlement, escrow and ledger use the discounted charged amount.");

      // Duplicate group enrollment (same idempotency key) must fail due to unique constraint
      const groupResp3 = await request(baseUrl, `/education/courses/${certCourse.id}/group-enrollments`, {
        method: "POST",
        cookie: salonOwnerCookie,
        headers: { "idempotency-key": randomUUID() }, // different key, but same participants
        body: { employeeIds: [emp1.id, emp2.id] },
      });
      assert.equal(groupResp3.status, 409, "Duplicate group enrollment must return 409.");
      console.log("✓ Duplicate group enrollment rejected with 409.");

      // Employee from another salon must be rejected
      const groupResp4 = await request(baseUrl, `/education/courses/${certCourse.id}/group-enrollments`, {
        method: "POST",
        cookie: salonOwnerCookie,
        headers: { "idempotency-key": randomUUID() },
        body: { employeeIds: [emp1.id, randomUUID()] }, // second is a fake ID
      });
      assert.equal(groupResp4.status, 403, "Foreign or non-existent employee ID must return 403.");
      console.log("✓ Foreign employee ID rejected in group enrollment.");
    }

    console.log("\nAll Education extras tests passed. ✓");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    }
    if (enrollmentIds.length) {
      await db.delete(lessonProgressTable).where(inArray(lessonProgressTable.enrollmentId, enrollmentIds));
      await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, enrollmentIds));
    }
    if (courseIds.length) {
      await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    }
    if (centerId) {
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    }
    if (salonId) {
      await db.delete(employeesTable).where(eq(employeesTable.salonId, salonId));
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    }
    if (createdUserIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
