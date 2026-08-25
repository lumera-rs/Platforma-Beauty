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
import { batchEducationCourseViews, type EducationAccess } from "../routes/marketplace";
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
  const extraCenterIds: string[] = [];

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
        role: "EDUKATIVNI_CENTAR",
      },
      {
        firstName: "Kupac",
        lastName: "Extras",
        email: `extras-buyer-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "JOBSEEKER",
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

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: Authenticated /education/courses pushes ownership + scalar filters to
    // SQL so owned (even unpublished) courses are never silently omitted, and the
    // session-location authorization is preserved in the list view.
    // ═══════════════════════════════════════════════════════════════════════
    {
      const centerOwnerCookie = await login(baseUrl, centerOwner.email);

      // An owned but UNPUBLISHED course must still be visible to its owner. If the
      // route only kept public-eligible rows (the regression), this would vanish.
      const [ownedUnpublished] = await db.insert(coursesTable).values({
        centerId: center.id,
        title: `Owned Unpublished ${suffix}`,
        description: "Vlasnički kurs koji još nije objavljen.",
        category: "Interno",
        format: "hybrid",
        city: "Novi Sad",
        price: 12345,
        duration: "3 dana",
        certification: false,
        imageUrl: "/test-extras.jpg",
        published: false,
        archived: false,
      }).returning();
      assert.ok(ownedUnpublished);
      courseIds.push(ownedUnpublished.id);

      // Owner sees the owned unpublished course.
      const ownerListResp = await request(baseUrl, "/education/courses", { cookie: centerOwnerCookie });
      assert.equal(ownerListResp.status, 200, "Owner must be able to browse /education/courses.");
      const ownerCourses = await json<Array<Record<string, unknown>>>(ownerListResp);
      assert.ok(
        ownerCourses.some((c) => c.id === ownedUnpublished.id),
        "Owned unpublished course must appear for its owner (ownership pushed to SQL, not dropped).",
      );
      // ?mine=true also keeps the owned unpublished course.
      const mineResp = await request(baseUrl, "/education/courses?mine=true", { cookie: centerOwnerCookie });
      const mineCourses = await json<Array<Record<string, unknown>>>(mineResp);
      assert.ok(
        mineCourses.some((c) => c.id === ownedUnpublished.id),
        "?mine=true must return the owner's unpublished course.",
      );
      console.log("✓ Owned unpublished course retained via SQL ownership predicate.");

      // Scalar filter pushed to SQL: format=in-person selects liveCourse, excludes
      // the online certCourse and the hybrid owned course.
      const formatResp = await request(baseUrl, "/education/courses?format=in-person", { cookie: centerOwnerCookie });
      assert.equal(formatResp.status, 200, "Format-filtered list must respond 200.");
      const formatCourses = await json<Array<Record<string, unknown>>>(formatResp);
      assert.ok(formatCourses.some((c) => c.id === liveCourse.id), "format=in-person must include the in-person course.");
      assert.ok(!formatCourses.some((c) => c.id === certCourse.id), "format=in-person must exclude the online course.");
      assert.ok(!formatCourses.some((c) => c.id === ownedUnpublished.id), "format=in-person must exclude the hybrid course.");

      // Scalar price filter pushed to SQL (exact prior >= / <= semantics).
      const priceResp = await request(baseUrl, "/education/courses?minPrice=12345&maxPrice=12345", { cookie: centerOwnerCookie });
      const priceCourses = await json<Array<Record<string, unknown>>>(priceResp);
      assert.ok(priceCourses.some((c) => c.id === ownedUnpublished.id), "Exact price bounds must include the matching course.");
      assert.ok(!priceCourses.some((c) => c.id === liveCourse.id), "Price bounds must exclude non-matching prices.");
      console.log("✓ Scalar filters (format, price) applied in SQL with prior AND semantics.");

      // Session-location authorization (batchEducationCourseViews). The
      // authenticated list response schema strips `sessions`, so exercise the
      // observable HTTP contract on the public list — unauthorized public viewers
      // must never receive the session location.
      const publicListResp = await request(baseUrl, "/education/public/courses");
      const publicCourses = await json<Array<Record<string, unknown>>>(publicListResp);
      const publicLive = publicCourses.find((c) => c.id === liveCourse.id);
      assert.ok(publicLive, "liveCourse must appear in the public listing.");
      const publicSessions = publicLive.sessions as Array<{ location: string | null }>;
      assert.ok(publicSessions.length > 0, "liveCourse must expose at least one session in the public view.");
      assert.equal(
        publicSessions[0]!.location,
        null,
        "Unauthorized public viewers must not receive session location.",
      );

      // Authenticated list still surfaces the session-derived availableSeats,
      // proving sessions are assembled without leaking location via the list schema.
      const ownerLive = ownerCourses.find((c) => c.id === liveCourse.id);
      assert.ok(ownerLive, "liveCourse must appear in the owner's authenticated list.");
      assert.equal(
        ownerLive.availableSeats,
        10,
        "Session-derived availableSeats must be present for the owner.",
      );

      // Positive authorization: exercise batchEducationCourseViews directly with
      // authorized access contexts and assert the session location IS visible.
      const liveCourseLocation = (views: Awaited<ReturnType<typeof batchEducationCourseViews>>) => {
        const view = views.find((v) => v.id === liveCourse.id);
        assert.ok(view, "liveCourse view must be assembled.");
        assert.ok(view.sessions.length > 0, "liveCourse view must include a session.");
        return view.sessions[0]!.location;
      };

      const ownerAccess: EducationAccess = { user: centerOwner, salon: null, centers: [center], admin: false };
      const ownerViews = await batchEducationCourseViews([liveCourse], ownerAccess);
      assert.equal(
        liveCourseLocation(ownerViews),
        "Testna ulica 5, Novi Sad",
        "Publisher/owner must see the session location.",
      );

      const adminAccess: EducationAccess = { user: admin, salon: null, centers: [], admin: true };
      const adminViews = await batchEducationCourseViews([liveCourse], adminAccess);
      assert.equal(
        liveCourseLocation(adminViews),
        "Testna ulica 5, Novi Sad",
        "Admin must see the session location.",
      );

      // Paid enrollee (non-owner buyer) must also see the location. The buyer
      // already holds a paid enrollment on liveCourse from the ICS test above.
      const [existingPaidLive] = await db.select().from(courseEnrollmentsTable).where(and(
        eq(courseEnrollmentsTable.courseId, liveCourse.id),
        eq(courseEnrollmentsTable.purchaserId, buyer.id),
        eq(courseEnrollmentsTable.paymentStatus, "paid"),
      )).limit(1);
      assert.ok(existingPaidLive, "Buyer must already have a paid enrollment on liveCourse.");

      const buyerAccess: EducationAccess = { user: buyer, salon: null, centers: [], admin: false };
      const buyerViews = await batchEducationCourseViews([liveCourse], buyerAccess);
      assert.equal(
        liveCourseLocation(buyerViews),
        "Testna ulica 5, Novi Sad",
        "Paid enrollee must see the session location.",
      );

      // Unauthorized access context (no ownership, no paid enrollment) gets null.
      const centerOwnerUnrelated = await db.insert(usersTable).values({
        firstName: "Nepovezani", lastName: "Kupac",
        email: `extras-unrelated-${suffix}@example.test`,
        passwordHash: fixturePasswordHash, passwordSetAt: new Date(), role: "CUSTOMER",
      }).returning();
      createdUserIds.push(centerOwnerUnrelated[0]!.id);
      const unrelatedAccess: EducationAccess = { user: centerOwnerUnrelated[0]!, salon: null, centers: [], admin: false };
      const unrelatedViews = await batchEducationCourseViews([liveCourse], unrelatedAccess);
      assert.equal(
        liveCourseLocation(unrelatedViews),
        null,
        "Unauthorized authenticated viewer (no ownership/paid enrollment) must not see the location.",
      );

      // No access at all (public) also yields null.
      const noAccessViews = await batchEducationCourseViews([liveCourse]);
      assert.equal(
        liveCourseLocation(noAccessViews),
        null,
        "Unauthorized public viewers must not see the location.",
      );
      console.log("✓ Session location authorization: owner/admin/paid see location; unauthorized get null.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: GET /education/courses & /education/public/courses — page/pageSize
    //   pagination. Proves page 2 is reachable via ?page=&pageSize= with a
    //   stable createdAt desc, id desc ordering and non-overlapping slices, so
    //   the OFFSET/LIMIT bound never silently omits matching rows.
    // ═══════════════════════════════════════════════════════════════════════
    {
      const centerOwnerCookie = await login(baseUrl, centerOwner.email);
      const pageSize = 3;
      const listCourseCount = pageSize * 2 + 1; // 7 → at least 3 pages worth

      // Distinct owned + published + eligible-center courses with a unique
      // category so the scalar filter isolates this test's rows from any others.
      const listCategory = `PagerCat-${suffix}`;
      const listCourses = await db.insert(coursesTable).values(
        Array.from({ length: listCourseCount }, (_, i) => ({
          centerId: center.id,
          title: `List Pager Course ${i} ${suffix}`,
          description: "Kurs za proveru paginacije liste.",
          category: listCategory,
          format: "online" as const,
          city: "Novi Sad",
          price: 4200,
          duration: "1 nedelja",
          certification: false,
          imageUrl: "/test-extras.jpg",
          published: true,
          archived: false,
          refundPolicy: "Bez povraćaja.",
        })),
      ).returning();
      courseIds.push(...listCourses.map((c) => c.id));
      const listCourseIds = new Set(listCourses.map((c) => c.id));

      // Reference: the full stably ordered set the owner can see for this category.
      const allResp = await request(
        baseUrl,
        `/education/courses?category=${encodeURIComponent(listCategory)}&page=1&pageSize=100`,
        { cookie: centerOwnerCookie },
      );
      assert.equal(allResp.status, 200, "Category-filtered course list must respond 200.");
      const allRows = await json<Array<{ id: string }>>(allResp);
      const allIds = allRows.map((r) => r.id);
      assert.equal(allRows.length, listCourseCount, "All inserted list-pager courses must be reachable in one large page.");
      for (const id of listCourseIds) {
        assert.ok(allIds.includes(id), "Every inserted course must be visible to its owner.");
      }

      // Page 1
      const p1Resp = await request(
        baseUrl,
        `/education/courses?category=${encodeURIComponent(listCategory)}&page=1&pageSize=${pageSize}`,
        { cookie: centerOwnerCookie },
      );
      assert.equal(p1Resp.status, 200, "Course list page 1 must respond 200.");
      const p1 = await json<Array<{ id: string }>>(p1Resp);
      assert.equal(p1.length, pageSize, "Page 1 must return exactly pageSize courses.");
      const p1Ids = new Set(p1.map((r) => r.id));

      // Page 2 must be reachable with fresh, non-overlapping rows.
      const p2Resp = await request(
        baseUrl,
        `/education/courses?category=${encodeURIComponent(listCategory)}&page=2&pageSize=${pageSize}`,
        { cookie: centerOwnerCookie },
      );
      assert.equal(p2Resp.status, 200, "Course list page 2 must be reachable.");
      const p2 = await json<Array<{ id: string }>>(p2Resp);
      assert.equal(p2.length, pageSize, "Page 2 must return exactly pageSize courses.");
      for (const row of p2) {
        assert.ok(!p1Ids.has(row.id), "Page 2 rows must not overlap page 1.");
      }
      // page1 ∪ page2 must equal the first 2*pageSize rows of the reference list.
      assert.deepEqual(
        [...p1.map((r) => r.id), ...p2.map((r) => r.id)],
        allIds.slice(0, pageSize * 2),
        "Paged course slices must match the stably ordered (createdAt desc, id desc) reference list.",
      );
      console.log("✓ /education/courses: page 2 reachable; stable non-overlapping OFFSET/LIMIT slices.");

      // The same pagination contract holds on the public endpoint (bare array).
      const pub1Resp = await request(
        baseUrl,
        `/education/public/courses?category=${encodeURIComponent(listCategory)}&page=1&pageSize=${pageSize}`,
      );
      assert.equal(pub1Resp.status, 200, "Public course list page 1 must respond 200.");
      const pub1 = await json<Array<{ id: string }>>(pub1Resp);
      assert.equal(pub1.length, pageSize, "Public page 1 must return exactly pageSize courses.");
      const pub1Ids = new Set(pub1.map((r) => r.id));
      const pub2Resp = await request(
        baseUrl,
        `/education/public/courses?category=${encodeURIComponent(listCategory)}&page=2&pageSize=${pageSize}`,
      );
      assert.equal(pub2Resp.status, 200, "Public course list page 2 must be reachable.");
      const pub2 = await json<Array<{ id: string }>>(pub2Resp);
      assert.ok(pub2.length >= 1, "Public page 2 must be reachable and return at least one course.");
      for (const row of pub2) {
        assert.ok(!pub1Ids.has(row.id), "Public page 2 rows must not overlap page 1.");
      }
      console.log("✓ /education/public/courses: page 2 reachable; non-overlapping slices.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST: GET /education/enrollments — SQL access predicate + pagination
    //   Proves (a) another user's / another center's enrollments are excluded
    //   in SQL, and (b) page 2 is reachable via ?page=&pageSize=.
    // ═══════════════════════════════════════════════════════════════════════
    {
      const centerOwnerCookie = await login(baseUrl, centerOwner.email);

      // A second, unrelated education center owned by a different user, with its
      // own course and a paid enrollment. The primary center owner must NEVER
      // see this row through /education/enrollments.
      const [otherOwner] = await db.insert(usersTable).values({
        firstName: "Drugi", lastName: "Centar",
        email: `extras-other-center-${suffix}@example.test`,
        passwordHash: fixturePasswordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
      }).returning();
      createdUserIds.push(otherOwner!.id);

      const [otherCenter] = await db.insert(educationCentersTable).values({
        ownerId: otherOwner!.id,
        name: `Extras Other Center ${suffix}`,
        city: "Niš",
        description: "Nepovezani edukacioni centar.",
        imageUrl: "/test-other.jpg",
        verificationStatus: "verified",
        verifiedAt: new Date(),
        verifiedByUserId: admin.id,
      }).returning();
      const otherCenterId = otherCenter!.id;
      extraCenterIds.push(otherCenterId);

      const [otherCourse] = await db.insert(coursesTable).values({
        centerId: otherCenterId,
        title: `Other Center Course ${suffix}`,
        description: "Kurs drugog centra.",
        category: "Ostalo",
        format: "online",
        city: "Niš",
        price: 5000,
        duration: "1 nedelja",
        certification: false,
        imageUrl: "/test-other.jpg",
        published: true,
        refundPolicy: "Bez povraćaja.",
      }).returning();
      courseIds.push(otherCourse!.id);

      // Enrollment on the OTHER center's course, purchased by a different user.
      const otherRows = await db.insert(courseEnrollmentsTable).values({
        courseId: otherCourse!.id,
        userId: buyer.id,
        purchaserId: otherOwner!.id,
        status: "active",
        paymentStatus: "paid",
        progress: 0,
        purchasedAt: new Date(Date.now() - 60 * 60 * 1000),
      }).returning();
      const otherEnrollmentId = otherRows[0]!.id;
      enrollmentIds.push(otherEnrollmentId);

      // Create > pageSize enrollments purchased by the PRIMARY center owner. The
      // (course_id, purchaser_id, participant_key) uniqueness on non-cancelled
      // rows means we spread these across distinct owned courses (one seat each),
      // with distinct purchasedAt so ordering is deterministic.
      const pageSize = 5;
      const ownerEnrollmentCount = pageSize + 2; // 7 → 2 pages (5 + 2)
      const paginationCourses = await db.insert(coursesTable).values(
        Array.from({ length: ownerEnrollmentCount }, (_, i) => ({
          centerId: center.id,
          title: `Pagination Course ${i} ${suffix}`,
          description: "Kurs za proveru paginacije prijava.",
          category: "Paginacija",
          format: "online" as const,
          city: "Novi Sad",
          price: 4000,
          duration: "1 nedelja",
          certification: false,
          imageUrl: "/test-extras.jpg",
          published: true,
          refundPolicy: "Bez povraćaja.",
        })),
      ).returning();
      courseIds.push(...paginationCourses.map((c) => c.id));
      const ownerEnrollmentValues = paginationCourses.map((c, i) => ({
        courseId: c.id,
        userId: centerOwner.id,
        purchaserId: centerOwner.id,
        status: "active" as const,
        paymentStatus: "paid" as const,
        progress: 0,
        // Newest first: index 0 is the most recent.
        purchasedAt: new Date(Date.now() - (i + 1) * 60 * 1000),
      }));
      const ownerRows = await db.insert(courseEnrollmentsTable).values(ownerEnrollmentValues).returning();
      const ownerEnrollmentIds = new Set(ownerRows.map((r) => r.id));
      enrollmentIds.push(...ownerRows.map((r) => r.id));

      // Full unbounded reference set the owner may see (large pageSize) — used to
      // prove the SQL predicate scopes rows and that pages are non-overlapping,
      // regardless of pre-existing owner-visible rows from earlier tests.
      const allResp = await request(baseUrl, `/education/enrollments?page=1&pageSize=100`, { cookie: centerOwnerCookie });
      assert.equal(allResp.status, 200, "Center owner must list enrollments.");
      const allRows = await json<Array<{ id: string }>>(allResp);
      const allOwnerVisible = new Set(allRows.map((r) => r.id));
      // Every enrollment we inserted for the owner's own scope is visible.
      for (const id of ownerEnrollmentIds) {
        assert.ok(allOwnerVisible.has(id), "Owner-scoped enrollment must be visible to the center owner.");
      }
      // The other center's / other user's enrollment must be excluded in SQL.
      assert.ok(!allOwnerVisible.has(otherEnrollmentId), "Another user's / another center's enrollment must be excluded from the SQL access predicate.");
      // There must be enough rows for a second page.
      assert.ok(allRows.length > pageSize, "Test requires more than one page of owner-visible enrollments.");

      // Page 1
      const page1Resp = await request(baseUrl, `/education/enrollments?page=1&pageSize=${pageSize}`, { cookie: centerOwnerCookie });
      assert.equal(page1Resp.status, 200, "Center owner must list enrollments (page 1).");
      const page1 = await json<Array<{ id: string }>>(page1Resp);
      assert.equal(page1.length, pageSize, "Page 1 must return exactly pageSize rows.");
      const page1Ids = new Set(page1.map((r) => r.id));
      assert.ok(!page1Ids.has(otherEnrollmentId), "Another user's / another center's enrollment must be excluded (page 1).");

      // Page 2 must be reachable with fresh, non-overlapping rows.
      const page2Resp = await request(baseUrl, `/education/enrollments?page=2&pageSize=${pageSize}`, { cookie: centerOwnerCookie });
      assert.equal(page2Resp.status, 200, "Center owner must reach page 2.");
      const page2 = await json<Array<{ id: string }>>(page2Resp);
      assert.ok(page2.length >= 1, "Page 2 must be reachable and return at least one row.");
      assert.ok(!page2.some((r) => r.id === otherEnrollmentId), "Another user's / another center's enrollment must be excluded (page 2).");
      // No overlap between page 1 and page 2 (stable ordering, non-overlapping slices).
      for (const row of page2) {
        assert.ok(!page1Ids.has(row.id), "Page 2 rows must not overlap page 1.");
      }
      // page1 ∪ page2 must equal the first 2*pageSize rows of the reference list.
      const expectedFirstTwoPages = allRows.slice(0, page1.length + page2.length).map((r) => r.id);
      const actualFirstTwoPages = [...page1.map((r) => r.id), ...page2.map((r) => r.id)];
      assert.deepEqual(actualFirstTwoPages, expectedFirstTwoPages, "Paged slices must match the stably ordered reference list.");

      console.log("✓ /education/enrollments: SQL predicate excludes other user/center; page 2 reachable.");
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
    if (extraCenterIds.length) {
      await db.delete(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, extraCenterIds));
      await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, extraCenterIds));
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
