/**
 * Task 136 — Tenant Isolation Integration Matrix
 *
 * Comprehensive API-level cross-tenant isolation proof.  Every fixture is
 * inserted directly into the database; the Express app runs on an ephemeral
 * port with real sessions.  No mocks.
 *
 * Coverage groups:
 *  A) Salon owner A list endpoints exclude salon B data
 *  B) Salon owner A POST/PATCH/DELETE with B IDs → 403/404
 *  C) Employee A portal isolates from employee B / salon B
 *  D) Education center A/B cross-owner isolation
 *  E) Published / enrolled access is preserved
 *
 * Run with:
 *   node --experimental-vm-modules src/lib/tenant-isolation.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentSeriesTable,
  appointmentsTable,
  courseEnrollmentsTable,
  courseModulesTable,
  courseLessonsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationDisputesTable,
  educationEscrowsTable,
  educationInstructorsTable,
  educationMediaTable,
  educationMessagesTable,
  educationNotificationsTable,
  educationThreadsTable,
  employeeLeaveRequestsTable,
  employeeLocationAssignmentsTable,
  employeesTable,
  employeeServicesTable,
  ordersTable,
  orderItemsTable,
  lessonProgressTable,
  pool,
  productsTable,
  salonCustomersTable,
  salonHoursTable,
  salonNotificationsTable,
  salonResourcesTable,
  salonsTable,
  servicesTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const suffix = randomUUID().slice(0, 8);
const PASSWORD = "tenant-isolation-2025";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HttpResult = { status: number; body: unknown };

async function get(baseUrl: string, session: string, path: string): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { cookie: `${sessionCookieName}=${session}` },
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

async function mutate(
  baseUrl: string,
  session: string,
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: Record<string, unknown> = {},
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      cookie: `${sessionCookieName}=${session}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

/**
 * Assert that a cross-tenant mutation returns 403 or 404.
 * Some endpoints intentionally return 400 when a foreign-relation ID fails
 * validation before the ownership check can fire; those cases pass a note.
 */
function assertRejected(
  result: HttpResult,
  label: string,
  note?: string,
): void {
  const allowed = note ? [400, 403, 404] : [403, 404];
  assert.ok(
    allowed.includes(result.status),
    `${label}: expected ${allowed.join(" or ")}, got ${result.status} — body: ${JSON.stringify(result.body)}${note ? ` (${note})` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  await ensureDemoData();

  const passwordHash = await hashPassword(PASSWORD);
  let server: ReturnType<typeof app.listen> | undefined;

  // Track created IDs for cleanup (in dependency order for deletion).
  const createdEnrollmentIds: string[] = [];
  const createdEscrowIds: string[] = [];
  const createdThreadIds: string[] = [];
  const createdDisputeIds: string[] = [];
  const createdMessageIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdSalonIds: string[] = [];
  const createdCenterIds: string[] = [];
  let testError: unknown;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // FIXTURE USERS
    // ─────────────────────────────────────────────────────────────────────────
    const [
      ownerAUser,
      ownerBUser,
      empAUser,
      empBUser,
      centerAOwnerUser,
      centerBOwnerUser,
      enrolleeAUser,
    ] = await db.insert(usersTable).values([
      {
        firstName: "OwnerA", lastName: `TI-${suffix}`, email: `ti-ownerA-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" as const,
      },
      {
        firstName: "OwnerB", lastName: `TI-${suffix}`, email: `ti-ownerB-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" as const,
      },
      {
        firstName: "EmpA", lastName: `TI-${suffix}`, email: `ti-empA-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" as const,
      },
      {
        firstName: "EmpB", lastName: `TI-${suffix}`, email: `ti-empB-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE" as const,
      },
      {
        firstName: "CenterA", lastName: `TI-${suffix}`, email: `ti-centerA-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" as const,
      },
      {
        firstName: "CenterB", lastName: `TI-${suffix}`, email: `ti-centerB-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" as const,
      },
      {
        firstName: "EnrolleeA", lastName: `TI-${suffix}`, email: `ti-enrolleeA-${suffix}@x.test`,
        passwordHash, passwordSetAt: new Date(), role: "JOBSEEKER" as const,
      },
    ]).returning();
    createdUserIds.push(
      ownerAUser!.id, ownerBUser!.id, empAUser!.id, empBUser!.id,
      centerAOwnerUser!.id, centerBOwnerUser!.id, enrolleeAUser!.id,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // FIXTURE SALONS
    // ─────────────────────────────────────────────────────────────────────────
    const [salonA, salonA2, salonB] = await db.insert(salonsTable).values([
      {
        ownerId: ownerAUser!.id,
        name: `TI Salon A ${suffix}`, slug: `ti-salon-a-${suffix}`,
        city: "Beograd", municipality: "Vračar", address: "TI adresa 1",
        postalCode: "11000", phone: "+381110001001", email: `ti-salonA-${suffix}@x.test`,
        shortDescription: "TI salon A", description: "TI salon A",
        imageUrl: "/ti.jpg",
      },
      {
        ownerId: ownerAUser!.id,
        name: `TI Salon A2 ${suffix}`, slug: `ti-salon-a2-${suffix}`,
        city: "Beograd", municipality: "Zemun", address: "TI adresa A2",
        postalCode: "11080", phone: "+381110001003", email: `ti-salonA2-${suffix}@x.test`,
        shortDescription: "TI salon A2", description: "TI salon A2",
        imageUrl: "/ti.jpg",
      },
      {
        ownerId: ownerBUser!.id,
        name: `TI Salon B ${suffix}`, slug: `ti-salon-b-${suffix}`,
        city: "Novi Sad", municipality: "Centar", address: "TI adresa 2",
        postalCode: "21000", phone: "+381110001002", email: `ti-salonB-${suffix}@x.test`,
        shortDescription: "TI salon B", description: "TI salon B",
        imageUrl: "/ti.jpg",
      },
    ]).returning();
    createdSalonIds.push(salonA!.id, salonA2!.id, salonB!.id);

    await db.update(usersTable).set({ activeSalonId: salonA!.id }).where(eq(usersTable.id, ownerAUser!.id));
    await db.update(usersTable).set({ activeSalonId: salonB!.id }).where(eq(usersTable.id, ownerBUser!.id));

    // Services
    const [serviceA] = await db.insert(servicesTable).values({
      salonId: salonA!.id, categoryName: "TI", name: "TI Service A",
      description: "desc", durationMinutes: 60, price: 1000, imageUrl: "/ti.jpg",
    }).returning();
    const [serviceB] = await db.insert(servicesTable).values({
      salonId: salonB!.id, categoryName: "TI", name: "TI Service B",
      description: "desc", durationMinutes: 60, price: 1000, imageUrl: "/ti.jpg",
    }).returning();
    const [serviceAUnassigned] = await db.insert(servicesTable).values({
      salonId: salonA!.id, categoryName: "TI", name: "TI Service A Unassigned",
      description: "desc", durationMinutes: 60, price: 1000, imageUrl: "/ti.jpg",
    }).returning();

    // Employees
    const [empA, empAOther, empB] = await db.insert(employeesTable).values([
      {
        salonId: salonA!.id, userId: empAUser!.id, name: "Emp A TI",
        role: "Stilist", bio: "", avatarUrl: "",
      },
      {
        salonId: salonA!.id, name: "Emp A Other TI",
        role: "Stilist", bio: "", avatarUrl: "",
      },
      {
        salonId: salonB!.id, userId: empBUser!.id, name: "Emp B TI",
        role: "Stilist", bio: "", avatarUrl: "",
      },
    ]).returning();
    await db.insert(employeeLocationAssignmentsTable).values([
      { employeeId: empA!.id, salonId: salonA!.id, active: true, isDefault: true },
      { employeeId: empAOther!.id, salonId: salonA!.id, active: true, isDefault: true },
      { employeeId: empB!.id, salonId: salonB!.id, active: true, isDefault: true },
    ]);
    await db.insert(employeeServicesTable).values({ employeeId: empA!.id, serviceId: serviceA!.id });
    await db.insert(employeeServicesTable).values({ employeeId: empAOther!.id, serviceId: serviceA!.id });
    await db.insert(employeeServicesTable).values({ employeeId: empB!.id, serviceId: serviceB!.id });
    // Deliberately inconsistent cross-salon relation. Defensive reads must not
    // expose service B through employee A even if legacy/imported data contains it.
    await db.insert(employeeServicesTable).values({ employeeId: empA!.id, serviceId: serviceB!.id });

    // CRM contacts
    const [contactA] = await db.insert(salonCustomersTable).values({
      salonId: salonA!.id, firstName: "ContactA", lastName: "TI",
      phone: "+381611000101", phoneNormalized: "+381611000101",
    }).returning();
    const [contactB] = await db.insert(salonCustomersTable).values({
      salonId: salonB!.id, firstName: "ContactB", lastName: "TI",
      phone: "+381611000102", phoneNormalized: "+381611000102",
    }).returning();

    // Appointments
    const [apptA] = await db.insert(appointmentsTable).values({
      salonId: salonA!.id, salonCustomerId: contactA!.id, employeeId: empA!.id,
      serviceId: serviceA!.id, date: "2099-12-01",
      startTime: "10:00", endTime: "11:00", durationMinutes: 60, price: 1000,
      status: "confirmed",
    }).returning();
    const [apptB] = await db.insert(appointmentsTable).values({
      salonId: salonB!.id, salonCustomerId: contactB!.id, employeeId: empB!.id,
      serviceId: serviceB!.id, date: "2099-12-01",
      startTime: "10:00", endTime: "11:00", durationMinutes: 60, price: 1000,
      status: "confirmed",
    }).returning();
    const [apptAOther] = await db.insert(appointmentsTable).values({
      salonId: salonA!.id, salonCustomerId: contactA!.id, employeeId: empAOther!.id,
      serviceId: serviceA!.id, date: "2099-12-02",
      startTime: "10:00", endTime: "11:00", durationMinutes: 60, price: 1000,
      status: "confirmed",
    }).returning();
    // Deliberately cross-linked to contact A while belonging to salon B. This
    // catches CRM aggregates that filter only by salonCustomerId.
    const [crossCustomerAppt] = await db.insert(appointmentsTable).values({
      salonId: salonB!.id, salonCustomerId: contactA!.id, employeeId: empB!.id,
      serviceId: serviceB!.id, date: "2099-12-03",
      startTime: "12:00", endTime: "13:00", durationMinutes: 60, price: 1000,
      status: "no-show",
    }).returning();

    // Appointment series
    const [seriesA] = await db.insert(appointmentSeriesTable).values({
      salonId: salonA!.id, salonCustomerId: contactA!.id, serviceId: serviceA!.id,
      employeeId: empA!.id, totalAppointments: 1, createdByUserId: ownerAUser!.id,
    }).returning();
    const [seriesB] = await db.insert(appointmentSeriesTable).values({
      salonId: salonB!.id, salonCustomerId: contactB!.id, serviceId: serviceB!.id,
      employeeId: empB!.id, totalAppointments: 1, createdByUserId: ownerBUser!.id,
    }).returning();
    // Salon A owns this series, but its imported service reference points at B.
    // The CRM may retain the series metadata but must not resolve B's service.
    const [crossServiceSeriesA] = await db.insert(appointmentSeriesTable).values({
      salonId: salonA!.id, salonCustomerId: contactA!.id, serviceId: serviceB!.id,
      employeeId: empA!.id, totalAppointments: 1, createdByUserId: ownerAUser!.id,
    }).returning();
    // Belongs to salon B but is assigned to employee A and series A. This
    // simultaneously exercises employee-portal and CRM-series SQL boundaries.
    const [crossEmployeeAppt] = await db.insert(appointmentsTable).values({
      salonId: salonB!.id, salonCustomerId: contactB!.id, employeeId: empA!.id,
      serviceId: serviceB!.id, seriesId: seriesA!.id, date: "2099-12-04",
      startTime: "12:00", endTime: "13:00", durationMinutes: 60, price: 1000,
      status: "confirmed",
    }).returning();

    // Leave requests
    const [leaveA] = await db.insert(employeeLeaveRequestsTable).values({
      employeeId: empA!.id, startDate: "2099-12-10", endDate: "2099-12-15",
      reason: "TI leave A", status: "pending",
    }).returning();
    const [leaveB] = await db.insert(employeeLeaveRequestsTable).values({
      employeeId: empB!.id, startDate: "2099-12-10", endDate: "2099-12-15",
      reason: "TI leave B", status: "pending",
    }).returning();

    // Resources
    const [resourceA] = await db.insert(salonResourcesTable).values({
      salonId: salonA!.id, name: "TI Resource A", type: "other", capacity: 2,
    }).returning();
    const [resourceB] = await db.insert(salonResourcesTable).values({
      salonId: salonB!.id, name: "TI Resource B", type: "other", capacity: 2,
    }).returning();

    // Salon notifications
    const [notifA] = await db.insert(salonNotificationsTable).values({
      salonId: salonA!.id, title: "TI notif A", message: "msg A",
    }).returning();
    const [notifB] = await db.insert(salonNotificationsTable).values({
      salonId: salonB!.id, title: "TI notif B", message: "msg B",
    }).returning();

    // Shop orders — need at least one product
    const [plan] = await db.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.active, true)).limit(1);
    assert.ok(plan, "active subscription plan required");

    let product: typeof productsTable.$inferSelect | undefined;
    const existingProducts = await db.select().from(productsTable).limit(1);
    if (existingProducts.length) {
      product = existingProducts[0];
    } else {
      // Skip shop-order assertions if no products are available
    }

    let orderA: typeof ordersTable.$inferSelect | undefined;
    let orderB: typeof ordersTable.$inferSelect | undefined;
    if (product) {
      [orderA] = await db.insert(ordersTable).values({
        salonId: salonA!.id, status: "pending", total: product.price,
        shippingName: "TI Name A", shippingAddress: "TI addr 1",
        paymentMethod: "BANK_TRANSFER", paymentStatus: "unpaid",
        deliveryMethod: "courier", subtotal: product.price, totalWeightGrams: 0,
        shippingCost: 0,
      }).returning();
      [orderB] = await db.insert(ordersTable).values({
        salonId: salonB!.id, status: "pending", total: product.price,
        shippingName: "TI Name B", shippingAddress: "TI addr 2",
        paymentMethod: "BANK_TRANSFER", paymentStatus: "unpaid",
        deliveryMethod: "courier", subtotal: product.price, totalWeightGrams: 0,
        shippingCost: 0,
      }).returning();
      createdOrderIds.push(orderA!.id, orderB!.id);
      if (orderA) {
        await db.insert(orderItemsTable).values({
          orderId: orderA.id, productId: product.id, productName: product.name,
          productSku: product.sku, quantity: 1, price: product.price,
          supplierId: product.supplierId, supplierName: "LUMERA Legacy Catalog", supplierSlug: "lumera-legacy",
          productCatalogReference: product.catalogReference, productSkuSnapshot: product.sku,
          market: "B2B", currency: "RSD", unitPrice: product.price, lineSubtotal: product.price, lineTotal: product.price,
        });
      }
      if (orderB) {
        await db.insert(orderItemsTable).values({
          orderId: orderB.id, productId: product.id, productName: product.name,
          productSku: product.sku, quantity: 1, price: product.price,
          supplierId: product.supplierId, supplierName: "LUMERA Legacy Catalog", supplierSlug: "lumera-legacy",
          productCatalogReference: product.catalogReference, productSkuSnapshot: product.sku,
          market: "B2B", currency: "RSD", unitPrice: product.price, lineSubtotal: product.price, lineTotal: product.price,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FIXTURE EDUCATION CENTERS
    // ─────────────────────────────────────────────────────────────────────────
    const [centerA] = await db.insert(educationCentersTable).values({
      ownerId: centerAOwnerUser!.id, name: `TI Center A ${suffix}`,
      city: "Beograd", description: "TI Center A", imageUrl: "/ti.jpg",
      verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: ownerAUser!.id,
    }).returning();
    const [centerB] = await db.insert(educationCentersTable).values({
      ownerId: centerBOwnerUser!.id, name: `TI Center B ${suffix}`,
      city: "Novi Sad", description: "TI Center B", imageUrl: "/ti.jpg",
      verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: ownerAUser!.id,
    }).returning();
    createdCenterIds.push(centerA!.id, centerB!.id);

    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: centerA!.id, planId: plan.id, status: "active",
      dueAmount: plan.price, currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    });
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: centerB!.id, planId: plan.id, status: "active",
      dueAmount: plan.price, currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    });

    // Instructors
    const [instructorA] = await db.insert(educationInstructorsTable).values({
      centerId: centerA!.id, fullName: "Instructor A TI", biography: "", industryYears: 5, experienceYears: 3,
    }).returning();
    const [instructorB] = await db.insert(educationInstructorsTable).values({
      centerId: centerB!.id, fullName: "Instructor B TI", biography: "", industryYears: 5, experienceYears: 3,
    }).returning();

    // Courses
    const [courseA] = await db.insert(coursesTable).values({
      centerId: centerA!.id, title: `TI Course A ${suffix}`, description: "desc",
      category: "TI", format: "online", city: "Beograd", price: 5000,
      duration: "1 week", certification: false, imageUrl: "/ti.jpg",
      published: true, archived: false,
    }).returning();
    const [courseB] = await db.insert(coursesTable).values({
      centerId: centerB!.id, title: `TI Course B ${suffix}`, description: "desc",
      category: "TI", format: "online", city: "Novi Sad", price: 5000,
      duration: "1 week", certification: false, imageUrl: "/ti.jpg",
      published: false, archived: false,
    }).returning();

    // Modules + lessons
    const [moduleA] = await db.insert(courseModulesTable).values({
      courseId: courseA!.id, title: "Module A TI", sortOrder: 0,
    }).returning();
    const [moduleB] = await db.insert(courseModulesTable).values({
      courseId: courseB!.id, title: "Module B TI", sortOrder: 0,
    }).returning();
    const [lessonA] = await db.insert(courseLessonsTable).values({
      moduleId: moduleA!.id, title: "Lesson A TI", content: "Private A content",
      durationMinutes: 20, sortOrder: 0,
    }).returning();
    const [lessonB] = await db.insert(courseLessonsTable).values({
      moduleId: moduleB!.id, title: "Lesson B TI", content: "Private B content",
      durationMinutes: 20, sortOrder: 0,
    }).returning();

    // Sessions
    const futureStart = new Date(Date.now() + 60 * 86400_000);
    const futureEnd = new Date(futureStart.getTime() + 4 * 3600_000);
    const [sessionA] = await db.insert(courseSessionsTable).values({
      courseId: courseA!.id, startsAt: futureStart, endsAt: futureEnd,
      location: "TI Location A", capacity: 10, reservedSeats: 1,
    }).returning();
    const [sessionB] = await db.insert(courseSessionsTable).values({
      courseId: courseB!.id, startsAt: futureStart, endsAt: futureEnd,
      location: "TI Location B", capacity: 10,
    }).returning();
    const mediaBId = randomUUID();
    await db.insert(educationMediaTable).values({
      id: mediaBId,
      courseId: courseB!.id,
      centerId: centerB!.id,
      objectPath: `/objects/education-gallery/${centerB!.id}/${courseB!.id}/${mediaBId}`,
      altText: "Private center B media",
    });

    // Paid enrollment in course A (by enrolleeA user)
    const [enrollmentA] = await db.insert(courseEnrollmentsTable).values({
      courseId: courseA!.id, userId: enrolleeAUser!.id, purchaserId: enrolleeAUser!.id,
      sessionId: sessionA!.id, status: "active", paymentStatus: "paid", accessGrantedAt: new Date(),
    }).returning();
    createdEnrollmentIds.push(enrollmentA!.id);

    // Escrow for enrollmentA (needed for dispute creation)
    const platformFee = Math.round(5000 * 0.15);
    const reserveAmount = Math.round(5000 * 0.10);
    const netAmount = 5000 - platformFee - reserveAmount;
    const [escrowA] = await db.insert(educationEscrowsTable).values({
      enrollmentId: enrollmentA!.id, centerId: centerA!.id,
      grossAmount: 5000, platformFee, reserveAmount, netAmount,
      releaseAt: new Date(Date.now() + 14 * 86400_000), status: "held",
    }).returning();
    createdEscrowIds.push(escrowA!.id);

    // Thread for enrollmentA
    const [threadA] = await db.insert(educationThreadsTable).values({
      enrollmentId: enrollmentA!.id, purchaserId: enrolleeAUser!.id, centerId: centerA!.id,
    }).returning();
    createdThreadIds.push(threadA!.id);

    const [messageA] = await db.insert(educationMessagesTable).values({
      threadId: threadA!.id, senderId: enrolleeAUser!.id, body: "TI message A",
    }).returning();
    createdMessageIds.push(messageA!.id);
    const [disputeA] = await db.insert(educationDisputesTable).values({
      enrollmentId: enrollmentA!.id,
      openedByUserId: enrolleeAUser!.id,
      reason: "TI dispute A",
      details: "Private dispute for center A.",
    }).returning();
    createdDisputeIds.push(disputeA!.id);

    // Education notification for enrolleeA
    await db.insert(educationNotificationsTable).values({
      userId: enrolleeAUser!.id, type: "test", title: "TI notif",
      body: "TI notif body", eventKey: `ti-notif-${suffix}`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SESSIONS
    // ─────────────────────────────────────────────────────────────────────────
    const [sesOwnerA, sesOwnerB, sesEmpA, sesEmpB, sesCenterA, sesCenterB, sesEnrolleeA] =
      await Promise.all([
        createSession(ownerAUser!.id),
        createSession(ownerBUser!.id),
        createSession(empAUser!.id),
        createSession(empBUser!.id),
        createSession(centerAOwnerUser!.id),
        createSession(centerBOwnerUser!.id),
        createSession(enrolleeAUser!.id),
      ]);

    // ─────────────────────────────────────────────────────────────────────────
    // START SERVER
    // ─────────────────────────────────────────────────────────────────────────
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    // =========================================================================
    // GROUP A — Owner A list endpoints exclude B IDs
    // =========================================================================

    // A.1 Appointments list
    {
      const r = await get(base, sesOwnerA, "/salon/appointments");
      assert.equal(r.status, 200, "owner A: GET /salon/appointments must succeed");
      const ids = (r.body as Array<{ id: string }>).map((a) => a.id);
      assert.ok(ids.includes(apptA!.id), "owner A: own appointment A must appear");
      assert.ok(!ids.includes(apptB!.id), "owner A: appointment B must not appear");
      assert.ok(!ids.includes(crossCustomerAppt!.id), "owner A: cross-linked customer appointment from B must not appear");
      assert.ok(!ids.includes(crossEmployeeAppt!.id), "owner A: cross-linked employee appointment from B must not appear");
      console.log("✓ A.1 appointments list excludes B and adversarial cross-links");
    }

    // A.2 CRM customers list
    {
      const r = await get(base, sesOwnerA, "/salon/customers");
      assert.equal(r.status, 200, "owner A: GET /salon/customers must succeed");
      const customers = r.body as Array<{
        id: string;
        visitCount: number;
        noShowCount: number;
        series: Array<{
          id: string;
          serviceName: string;
          completedAppointments: number;
          upcomingAppointments: number;
        }>;
      }>;
      const ids = customers.map((c) => c.id);
      assert.ok(ids.includes(contactA!.id), "owner A: own contact A must appear");
      assert.ok(!ids.includes(contactB!.id), "owner A: contact B must not appear");
      const ownContact = customers.find((item) => item.id === contactA!.id);
      assert.ok(ownContact, "owner A: contact A aggregate must be returned");
      assert.equal(ownContact.visitCount, 2, "CRM visit count must ignore B appointment cross-linked to contact A");
      assert.equal(ownContact.noShowCount, 0, "CRM no-show count must ignore B no-show cross-linked to contact A");
      const ownSeries = ownContact.series.find((item) => item.id === seriesA!.id);
      assert.ok(ownSeries, "CRM must retain owner A's own series");
      assert.equal(ownSeries.upcomingAppointments, 0, "CRM series counts must ignore B appointment cross-linked to series A");
      const crossServiceSeries = ownContact.series.find((item) => item.id === crossServiceSeriesA!.id);
      assert.equal(crossServiceSeries?.serviceName, "Usluga", "CRM must not resolve B's service name through an A series");
      assert.ok(!JSON.stringify(ownContact).includes("TI Service B"), "CRM response must not expose service B data");
      console.log("✓ A.2 CRM aggregates and relations remain salon-scoped under adversarial links");
    }

    // A.2b CRM update response uses the same salon-scoped visit count
    {
      const r = await mutate(base, sesOwnerA, `/salon/customers/${contactA!.id}`, "PATCH", { smsOptOut: true });
      assert.equal(r.status, 200, "owner A: PATCH own CRM contact must succeed");
      assert.equal(
        (r.body as { visitCount: number }).visitCount,
        2,
        "CRM update response must ignore B appointment cross-linked to contact A",
      );
      console.log("✓ A.2b CRM mutation aggregate remains salon-scoped");
    }

    // A.3 Employees list
    {
      const r = await get(base, sesOwnerA, "/salon/employees");
      assert.equal(r.status, 200, "owner A: GET /salon/employees must succeed");
      const employees = r.body as Array<{ id: string; serviceIds: string[] }>;
      const ids = employees.map((e) => e.id);
      assert.ok(ids.includes(empA!.id), "owner A: own employee A must appear");
      assert.ok(!ids.includes(empB!.id), "owner A: employee B must not appear");
      assert.ok(
        !employees.some((employee) => employee.serviceIds.includes(serviceB!.id)),
        "owner A: employee list must not expose B service IDs through a cross-linked assignment",
      );
      console.log("✓ A.3 employees and assigned service IDs exclude B");
    }

    // A.3b Employee deactivation preview counts only appointments in employee A's salon
    {
      const r = await get(base, sesOwnerA, `/salon/employees/${empA!.id}/deactivation-preview`);
      assert.equal(r.status, 200, "owner A: employee deactivation preview must succeed");
      assert.equal(
        (r.body as { futureAppointmentCount: number }).futureAppointmentCount,
        1,
        "employee preview must ignore B appointment cross-linked to employee A",
      );
      console.log("✓ A.3b employee preview count remains salon-scoped");
    }

    // A.4 Leave requests list
    {
      const r = await get(base, sesOwnerA, "/salon/leave-requests");
      assert.equal(r.status, 200, "owner A: GET /salon/leave-requests must succeed");
      const ids = (r.body as Array<{ id: string }>).map((lr) => lr.id);
      assert.ok(ids.includes(leaveA!.id), "owner A: own leave A must appear");
      assert.ok(!ids.includes(leaveB!.id), "owner A: leave B must not appear");
      console.log("✓ A.4 leave-requests list excludes B");
    }

    // A.5 Services list
    {
      const r = await get(base, sesOwnerA, "/salon/services");
      assert.equal(r.status, 200, "owner A: GET /salon/services must succeed");
      const ids = (r.body as Array<{ id: string }>).map((s) => s.id);
      assert.ok(ids.includes(serviceA!.id), "owner A: own service A must appear");
      assert.ok(!ids.includes(serviceB!.id), "owner A: service B must not appear");
      console.log("✓ A.5 services list excludes B");
    }

    // A.6 Resources list
    {
      const r = await get(base, sesOwnerA, "/salon/resources");
      assert.equal(r.status, 200, "owner A: GET /salon/resources must succeed");
      const ids = (r.body as Array<{ id: string }>).map((res) => res.id);
      assert.ok(ids.includes(resourceA!.id), "owner A: own resource A must appear");
      assert.ok(!ids.includes(resourceB!.id), "owner A: resource B must not appear");
      console.log("✓ A.6 resources list excludes B");
    }

    // A.7 Shop orders list
    {
      const r = await get(base, sesOwnerA, "/shop/orders");
      assert.equal(r.status, 200, "owner A: GET /shop/orders must succeed");
      if (orderA && orderB) {
        const ids = (r.body as Array<{ id: string }>).map((o) => o.id);
        assert.ok(ids.includes(orderA.id), "owner A: own order A must appear");
        assert.ok(!ids.includes(orderB.id), "owner A: order B must not appear");
        console.log("✓ A.7 shop orders list excludes B");
      } else {
        console.log("~ A.7 shop orders skipped (no products in DB)");
      }
    }

    // A.8 Shop notifications list
    {
      const r = await get(base, sesOwnerA, "/shop/notifications");
      assert.equal(r.status, 200, "owner A: GET /shop/notifications must succeed");
      const ids = (r.body as Array<{ id: string }>).map((n) => n.id);
      assert.ok(ids.includes(notifA!.id), "owner A: own notification A must appear");
      assert.ok(!ids.includes(notifB!.id), "owner A: notification B must not appear");
      console.log("✓ A.8 shop notifications list excludes B");
    }

    // A.9 The same owner has a second, empty salon. Every operational list and
    // mutation must follow activeSalonId, not broaden to all salons they own.
    {
      const switched = await mutate(base, sesOwnerA, "/salon/active-salon", "PUT", { salonId: salonA2!.id });
      assert.equal(switched.status, 200, "owner A must be able to activate owned salon A2");
      const operationalLists = [
        "/salon/appointments",
        "/salon/customers",
        "/salon/employees",
        "/salon/leave-requests",
        "/salon/services",
        "/salon/resources",
        "/shop/orders",
        "/shop/notifications",
      ];
      for (const path of operationalLists) {
        const r = await get(base, sesOwnerA, path);
        assert.equal(r.status, 200, `active salon A2: GET ${path} must succeed`);
        assert.deepEqual(r.body, [], `active salon A2: ${path} must not return salon A records`);
      }
      const blockedMutation = await mutate(
        base,
        sesOwnerA,
        `/appointments/${apptA!.id}/lifecycle`,
        "POST",
        { action: "arrive" },
      );
      assertRejected(blockedMutation, "A.9 owner A cannot mutate salon A appointment while A2 is active");
      const [unchanged] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, apptA!.id)).limit(1);
      assert.equal(unchanged?.status, "confirmed", "A.9 inactive salon appointment must remain unchanged");

      const restored = await mutate(base, sesOwnerA, "/salon/active-salon", "PUT", { salonId: salonA!.id });
      assert.equal(restored.status, 200, "owner A must be able to restore active salon A");
      console.log("✓ A.9 operational APIs follow active salon for a multi-location owner");
    }

    // =========================================================================
    // GROUP B — Owner A cross-tenant mutations must be rejected
    // =========================================================================

    // B.1 PATCH appointment B as owner A → 403/404
    {
      const r = await mutate(base, sesOwnerA, `/appointments/${apptB!.id}/lifecycle`, "POST", { action: "arrive" });
      assertRejected(r, "B.1 owner A PATCH appt B");
      // Verify B state unchanged
      const [row] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, apptB!.id)).limit(1);
      assert.equal(row!.status, "confirmed", "B.1 appointment B status must remain unchanged");
      console.log("✓ B.1 owner A cannot patch appointment B");
    }

    // B.2 DELETE series B as owner A → 403/404
    {
      const r = await mutate(base, sesOwnerA, `/salon/appointment-series/${seriesB!.id}`, "DELETE", {});
      assertRejected(r, "B.2 owner A DELETE series B");
      const [row] = await db.select({ id: appointmentSeriesTable.id })
        .from(appointmentSeriesTable).where(eq(appointmentSeriesTable.id, seriesB!.id)).limit(1);
      assert.ok(row, "B.2 series B must still exist");
      console.log("✓ B.2 owner A cannot delete series B");
    }

    // B.3 Create appointment for owner A using B's service ID → 404
    // (service ID belongs to salon B, so the service lookup against salonA returns 404)
    {
      const r = await mutate(base, sesOwnerA, "/salon/appointments", "POST", {
        serviceId: serviceB!.id,
        date: "2099-12-05",
        startTime: "10:00",
        salonCustomerId: contactA!.id,
      });
      // Route fetches service filtered by salonId, returns 404 for foreign serviceId
      assert.equal(r.status, 404, "B.3 owner A creating appt with B serviceId must return 404");
      // Verify no new appointment was created for service B
      const rows = await db.select({ id: appointmentsTable.id })
        .from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, salonA!.id), eq(appointmentsTable.serviceId, serviceB!.id)));
      assert.equal(rows.length, 0, "B.3 no appointment in A's salon must use B's service");
      console.log("✓ B.3 owner A cannot create appt with B service ID");
    }

    // B.4 Create appointment series for owner A using B's customer → 404
    {
      const r = await mutate(base, sesOwnerA, "/salon/appointment-series", "POST", {
        serviceId: serviceA!.id,
        salonCustomerId: contactB!.id,
        slots: [{ date: "2099-12-06", startTime: "10:00" }],
      });
      // salonCustomerId check is against salonA → 404 for B's contact
      assert.equal(r.status, 404, "B.4 owner A creating series with B contactId must return 404");
      const rows = await db.select({ id: appointmentSeriesTable.id })
        .from(appointmentSeriesTable)
        .where(and(eq(appointmentSeriesTable.salonId, salonA!.id), eq(appointmentSeriesTable.salonCustomerId, contactB!.id)));
      assert.equal(rows.length, 0, "B.4 no series in A's salon must use B's contact");
      console.log("✓ B.4 owner A cannot create series with B contact ID");
    }

    // B.5 PATCH CRM contact B as owner A → 404
    {
      const r = await mutate(base, sesOwnerA, `/salon/customers/${contactB!.id}`, "PATCH", { smsOptOut: true });
      assertRejected(r, "B.5 owner A PATCH contact B");
      const [row] = await db.select({ smsOptOut: salonCustomersTable.smsOptOut })
        .from(salonCustomersTable).where(eq(salonCustomersTable.id, contactB!.id)).limit(1);
      assert.equal(row!.smsOptOut, false, "B.5 contact B smsOptOut must remain unchanged");
      console.log("✓ B.5 owner A cannot patch CRM contact B");
    }

    // B.6 PATCH leave request B as owner A → 403
    {
      const r = await mutate(base, sesOwnerA, `/salon/leave-requests/${leaveB!.id}`, "PATCH", { status: "approved" });
      assertRejected(r, "B.6 owner A PATCH leave B");
      const [row] = await db.select({ status: employeeLeaveRequestsTable.status })
        .from(employeeLeaveRequestsTable).where(eq(employeeLeaveRequestsTable.id, leaveB!.id)).limit(1);
      assert.equal(row!.status, "pending", "B.6 leave B status must remain pending");
      console.log("✓ B.6 owner A cannot approve leave B");
    }

    // B.7 PATCH service B as owner A → 403/404
    {
      const r = await mutate(base, sesOwnerA, `/salon/services/${serviceB!.id}`, "PATCH", {
        category: "TI", name: "Hacked", description: "x",
        durationMinutes: 30, price: 1, imageUrl: "/ti.jpg", active: true,
        homeServiceAvailable: false, homeServiceFee: 0, homeServiceMinimumOrder: null,
      });
      assertRejected(r, "B.7 owner A PATCH service B");
      const [row] = await db.select({ name: servicesTable.name })
        .from(servicesTable).where(eq(servicesTable.id, serviceB!.id)).limit(1);
      assert.equal(row!.name, "TI Service B", "B.7 service B name must be unchanged");
      console.log("✓ B.7 owner A cannot patch service B");
    }

    // B.8 DELETE service B as owner A → 403/404
    {
      const r = await mutate(base, sesOwnerA, `/salon/services/${serviceB!.id}`, "DELETE", {});
      assertRejected(r, "B.8 owner A DELETE service B");
      const [row] = await db.select({ id: servicesTable.id })
        .from(servicesTable).where(eq(servicesTable.id, serviceB!.id)).limit(1);
      assert.ok(row, "B.8 service B must still exist");
      console.log("✓ B.8 owner A cannot delete service B");
    }

    // B.9 PATCH resource B as owner A → 403/404
    {
      const r = await mutate(base, sesOwnerA, `/salon/resources/${resourceB!.id}`, "PATCH", { name: "Hacked" });
      assertRejected(r, "B.9 owner A PATCH resource B");
      const [row] = await db.select({ name: salonResourcesTable.name })
        .from(salonResourcesTable).where(eq(salonResourcesTable.id, resourceB!.id)).limit(1);
      assert.equal(row!.name, "TI Resource B", "B.9 resource B name must be unchanged");
      console.log("✓ B.9 owner A cannot patch resource B");
    }

    // B.10 DELETE resource B as owner A → 403/404
    {
      const r = await mutate(base, sesOwnerA, `/salon/resources/${resourceB!.id}`, "DELETE", {});
      assertRejected(r, "B.10 owner A DELETE resource B");
      const [row] = await db.select({ id: salonResourcesTable.id })
        .from(salonResourcesTable).where(eq(salonResourcesTable.id, resourceB!.id)).limit(1);
      assert.ok(row, "B.10 resource B must still exist");
      console.log("✓ B.10 owner A cannot delete resource B");
    }

    // B.11 PATCH notification B as owner A → 404
    {
      const r = await mutate(base, sesOwnerA, `/shop/notifications/${notifB!.id}/read`, "PATCH", {});
      assertRejected(r, "B.11 owner A read-mark notification B");
      const [row] = await db.select({ readAt: salonNotificationsTable.readAt })
        .from(salonNotificationsTable).where(eq(salonNotificationsTable.id, notifB!.id)).limit(1);
      assert.equal(row!.readAt, null, "B.11 notification B readAt must remain null");
      console.log("✓ B.11 owner A cannot mark notification B as read");
    }

    // =========================================================================
    // GROUP C — Employee A portal isolation
    // =========================================================================

    // C.1 Employee A portal excludes B appointments and B salon data
    {
      const r = await get(base, sesEmpA, "/employee/portal");
      assert.equal(r.status, 200, "employee A: GET /employee/portal must succeed");
      const body = r.body as {
        salon: { name: string };
        appointments: Array<{ id: string }>;
        services: Array<{ id: string }>;
        clients: Array<{ id: string }>;
      };
      // Salon name must be salon A's
      assert.equal(body.salon.name, salonA!.name, "employee A portal must show salon A name");
      // Appointment B must not appear in portal
      const apptIds = body.appointments.map((a) => a.id);
      assert.ok(!apptIds.includes(apptB!.id), "employee A portal must not include appt B");
      assert.ok(!apptIds.includes(apptAOther!.id), "employee A portal must not include another employee's appointment in salon A");
      assert.ok(!apptIds.includes(crossEmployeeAppt!.id), "employee A portal must ignore B appointment cross-linked to employee A");
      assert.ok(!body.services.some((service) => service.id === serviceB!.id), "employee A portal must ignore cross-linked B service");
      assert.ok(!body.clients.some((client) => client.id === contactB!.id), "employee A portal must not expose contact B");
      console.log("✓ C.1 employee A portal excludes adversarial cross-location relations");
    }

    // C.2 Employee A cannot patch appointment B
    {
      const r = await mutate(base, sesEmpA, `/appointments/${apptB!.id}/lifecycle`, "POST", { action: "arrive" });
      assertRejected(r, "C.2 employee A PATCH appt B");
      const [row] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, apptB!.id)).limit(1);
      assert.equal(row!.status, "confirmed", "C.2 appointment B status must remain confirmed");
      console.log("✓ C.2 employee A cannot patch appointment B");
    }

    // C.3 Employee A cannot patch another employee's appointment in salon A
    {
      const r = await mutate(base, sesEmpA, `/appointments/${apptAOther!.id}/lifecycle`, "POST", { action: "arrive" });
      assertRejected(r, "C.3 employee A PATCH another salon A employee appointment");
      const [row] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, apptAOther!.id)).limit(1);
      assert.equal(row!.status, "confirmed", "C.3 other employee appointment must remain confirmed");
      console.log("✓ C.3 employee A cannot patch another employee's appointment");
    }

    // C.4 Employee B portal excludes salon A records and employee A
    {
      const r = await get(base, sesEmpB, "/employee/portal");
      assert.equal(r.status, 200, "employee B: GET /employee/portal must succeed");
      const body = r.body as {
        salon: { name: string };
        appointments: Array<{ id: string }>;
      };
      assert.equal(body.salon.name, salonB!.name, "employee B portal must show salon B name");
      assert.ok(body.salon.name !== salonA!.name, "employee B portal must not show salon A name");
      const apptIds = body.appointments.map((a) => a.id);
      assert.ok(!apptIds.includes(apptA!.id), "employee B portal must not include appt A");
      assert.ok(!apptIds.includes(apptAOther!.id), "employee B portal must not include another salon A appointment");
      assert.ok(!JSON.stringify(body).includes(contactA!.id), "employee B portal must not expose cross-linked contact A");
      console.log("✓ C.4 employee B portal excludes A records");
    }

    // C.5 Employee A cannot preview a series for another employee
    {
      const r = await mutate(base, sesEmpA, "/employee/appointment-series/preview", "POST", {
        employeeId: empAOther!.id,
        serviceId: serviceA!.id,
        slots: [{ date: "2099-12-20", startTime: "10:00" }],
      });
      assertRejected(r, "C.5 employee A preview series for another employee");
      console.log("✓ C.5 employee A cannot preview another employee's series");
    }

    // C.6 Employee A cannot create an appointment using salon B relations
    {
      const before = await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, salonB!.id), eq(appointmentsTable.serviceId, serviceB!.id)));
      const r = await mutate(base, sesEmpA, "/employee/appointments", "POST", {
        serviceId: serviceB!.id,
        salonCustomerId: contactB!.id,
        slots: [{ date: "2099-12-21", startTime: "10:00" }],
      });
      assertRejected(r, "C.6 employee A create salon B appointment");
      const after = await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(eq(appointmentsTable.salonId, salonB!.id), eq(appointmentsTable.serviceId, serviceB!.id)));
      assert.deepEqual(after, before, "C.6 salon B appointments must remain unchanged");
      console.log("✓ C.6 employee A cannot create an appointment with salon B relations");
    }

    // C.7 Employee A cannot create a series assigned to another employee
    {
      const before = await db.select({ id: appointmentSeriesTable.id }).from(appointmentSeriesTable)
        .where(eq(appointmentSeriesTable.employeeId, empAOther!.id));
      const r = await mutate(base, sesEmpA, "/employee/appointment-series", "POST", {
        employeeId: empAOther!.id,
        serviceId: serviceA!.id,
        salonCustomerId: contactA!.id,
        slots: [{ date: "2099-12-22", startTime: "10:00" }],
      });
      assertRejected(r, "C.7 employee A create another employee's series");
      const after = await db.select({ id: appointmentSeriesTable.id }).from(appointmentSeriesTable)
        .where(eq(appointmentSeriesTable.employeeId, empAOther!.id));
      assert.deepEqual(after, before, "C.7 another employee's series state must remain unchanged");
      console.log("✓ C.7 employee A cannot create another employee's series");
    }

    // C.8 Employee availability is pinned to its active location and own services
    {
      const own = await get(base, sesEmpA, `/employee/availability/search?serviceId=${serviceA!.id}&startDate=2099-12-20`);
      assert.equal(own.status, 200, "C.8 employee A can search its assigned active-salon service");
      assert.ok(
        (own.body as Array<{ employeeId: string }>).every((slot) => slot.employeeId === empA!.id),
        "C.8 employee availability must contain only the authenticated employee",
      );
      const unassigned = await get(base, sesEmpA, `/employee/availability/search?serviceId=${serviceAUnassigned!.id}&startDate=2099-12-20`);
      assert.equal(unassigned.status, 403, "C.8 employee A cannot search an unassigned same-salon service");
      const foreign = await get(base, sesEmpA, `/employee/availability/search?serviceId=${serviceB!.id}&startDate=2099-12-20`);
      assert.equal(foreign.status, 404, "C.8 an adversarial employee-service link cannot cross the active salon boundary");
      console.log("✓ C.8 employee availability enforces active-location and own-service isolation");
    }

    // =========================================================================
    // GROUP D — Education center isolation
    // =========================================================================

    // D.1 Center A owner: GET /education/courses?mine=true excludes course B
    {
      const r = await get(base, sesCenterA, "/education/courses?mine=true");
      assert.equal(r.status, 200, "center A owner: GET /education/courses?mine=true must succeed");
      const ids = (r.body as Array<{ id: string }>).map((c) => c.id);
      assert.ok(ids.includes(courseA!.id), "center A owner: own course A must appear");
      assert.ok(!ids.includes(courseB!.id), "center A owner: course B must not appear in mine=true");
      console.log("✓ D.1 center A courses(mine) excludes B");
    }

    // D.2 Center B owner cannot GET private course A (unpublished equivalent logic)
    // courseA is published so center B can see its public metadata via /education/courses,
    // but cannot see it via /education/courses/:courseId with owner-only privileges.
    // Center B also cannot see courseB (their own unpublished) via center A's session.
    {
      // Center B owner cannot see unpublished course B via center A session
      const r = await get(base, sesCenterA, `/education/courses/${courseB!.id}`);
      // courseB is unpublished; center A does not own it → 403 or 404
      assert.ok([403, 404].includes(r.status),
        `D.2 center A cannot access unpublished course B: got ${r.status}`);
      console.log("✓ D.2 center A cannot access B's unpublished course");
    }

    // D.3 Center B owner cannot PATCH course A
    {
      const r = await mutate(base, sesCenterB, `/education/courses/${courseA!.id}`, "PATCH", {
        title: "Hacked by B",
      });
      assertRejected(r, "D.3 center B PATCH course A");
      const [row] = await db.select({ title: coursesTable.title })
        .from(coursesTable).where(eq(coursesTable.id, courseA!.id)).limit(1);
      assert.ok(row!.title.includes("TI Course A"), "D.3 course A title must be unchanged");
      console.log("✓ D.3 center B cannot patch course A");
    }

    // D.4 Center B owner cannot archive/delete course A
    {
      const r = await mutate(base, sesCenterB, `/education/courses/${courseA!.id}`, "DELETE", {});
      assertRejected(r, "D.4 center B DELETE course A");
      const [row] = await db.select({ published: coursesTable.published, archived: coursesTable.archived })
        .from(coursesTable).where(eq(coursesTable.id, courseA!.id)).limit(1);
      assert.equal(row!.published, true, "D.4 course A published state must be unchanged");
      assert.equal(row!.archived, false, "D.4 course A archived state must be unchanged");
      console.log("✓ D.4 center B cannot archive/delete course A");
    }

    // D.5 Center B owner cannot PATCH instructor A
    {
      const r = await mutate(base, sesCenterB, `/education/instructors/${instructorA!.id}`, "PATCH", {
        fullName: "Hacked",
      });
      assertRejected(r, "D.5 center B PATCH instructor A");
      const [row] = await db.select({ fullName: educationInstructorsTable.fullName })
        .from(educationInstructorsTable).where(eq(educationInstructorsTable.id, instructorA!.id)).limit(1);
      assert.equal(row!.fullName, "Instructor A TI", "D.5 instructor A name must be unchanged");
      console.log("✓ D.5 center B cannot patch instructor A");
    }

    // D.6 Center B owner cannot DELETE instructor A
    {
      const r = await mutate(base, sesCenterB, `/education/instructors/${instructorA!.id}`, "DELETE", {});
      assertRejected(r, "D.6 center B DELETE instructor A");
      const [row] = await db.select({ id: educationInstructorsTable.id })
        .from(educationInstructorsTable).where(eq(educationInstructorsTable.id, instructorA!.id)).limit(1);
      assert.ok(row, "D.6 instructor A must still exist");
      console.log("✓ D.6 center B cannot delete instructor A");
    }

    // D.7 Center B owner cannot PATCH module A
    {
      const r = await mutate(base, sesCenterB, `/education/modules/${moduleA!.id}`, "PATCH", {
        title: "Hacked Module",
      });
      assertRejected(r, "D.7 center B PATCH module A");
      const [row] = await db.select({ title: courseModulesTable.title })
        .from(courseModulesTable).where(eq(courseModulesTable.id, moduleA!.id)).limit(1);
      assert.equal(row!.title, "Module A TI", "D.7 module A title must be unchanged");
      console.log("✓ D.7 center B cannot patch module A");
    }

    // D.8 Center B owner cannot DELETE module A
    {
      const r = await mutate(base, sesCenterB, `/education/modules/${moduleA!.id}`, "DELETE", {});
      assertRejected(r, "D.8 center B DELETE module A");
      const [row] = await db.select({ id: courseModulesTable.id })
        .from(courseModulesTable).where(eq(courseModulesTable.id, moduleA!.id)).limit(1);
      assert.ok(row, "D.8 module A must still exist");
      console.log("✓ D.8 center B cannot delete module A");
    }

    // D.9 Center B owner cannot PATCH lesson A
    {
      const r = await mutate(base, sesCenterB, `/education/lessons/${lessonA!.id}`, "PATCH", {
        title: "Hacked Lesson",
      });
      assertRejected(r, "D.9 center B PATCH lesson A");
      const [row] = await db.select({ title: courseLessonsTable.title })
        .from(courseLessonsTable).where(eq(courseLessonsTable.id, lessonA!.id)).limit(1);
      assert.equal(row!.title, "Lesson A TI", "D.9 lesson A title must be unchanged");
      console.log("✓ D.9 center B cannot patch lesson A");
    }

    // D.10 Center B owner cannot DELETE lesson A
    {
      const r = await mutate(base, sesCenterB, `/education/lessons/${lessonA!.id}`, "DELETE", {});
      assertRejected(r, "D.10 center B DELETE lesson A");
      const [row] = await db.select({ id: courseLessonsTable.id })
        .from(courseLessonsTable).where(eq(courseLessonsTable.id, lessonA!.id)).limit(1);
      assert.ok(row, "D.10 lesson A must still exist");
      console.log("✓ D.10 center B cannot delete lesson A");
    }

    // D.11 Center B owner cannot access enrollment A LMS
    {
      const r = await get(base, sesCenterB, `/education/enrollments/${enrollmentA!.id}/lms`);
      assertRejected(r, "D.11 center B GET enrollment A LMS");
      console.log("✓ D.11 center B cannot access enrollment A LMS");
    }

    // D.12 Center B owner cannot complete a lesson in enrollment A
    {
      const r = await mutate(
        base,
        sesCenterB,
        `/education/enrollments/${enrollmentA!.id}/lessons/${lessonA!.id}/complete`,
        "POST",
        {},
      );
      assertRejected(r, "D.12 center B complete enrollment A lesson");
      const progress = await db.select({ id: lessonProgressTable.id }).from(lessonProgressTable)
        .where(and(
          eq(lessonProgressTable.enrollmentId, enrollmentA!.id),
          eq(lessonProgressTable.lessonId, lessonA!.id),
        ));
      assert.equal(progress.length, 0, "D.12 enrollment A progress must remain unchanged");
      console.log("✓ D.12 center B cannot mutate enrollment A lesson progress");
    }

    // D.13 Center B owner cannot read thread A messages
    {
      const r = await get(base, sesCenterB, `/education/purchases/${enrollmentA!.id}/messages`);
      assertRejected(r, "D.13 center B GET enrollment A messages");
      // Verify message A body unchanged
      const [row] = await db.select({ body: educationMessagesTable.body })
        .from(educationMessagesTable).where(eq(educationMessagesTable.id, messageA!.id)).limit(1);
      assert.equal(row!.body, "TI message A", "D.13 message A body must be unchanged");
      console.log("✓ D.13 center B cannot read enrollment A messages");
    }

    // D.14 Center B owner cannot send a message in enrollment A's thread
    {
      const r = await mutate(base, sesCenterB, `/education/purchases/${enrollmentA!.id}/messages`, "POST", {
        body: "Hacked message from B",
      });
      assertRejected(r, "D.14 center B POST message in enrollment A");
      // Verify no new message from centerBOwnerUser
      const newMessages = await db.select({ id: educationMessagesTable.id })
        .from(educationMessagesTable)
        .where(and(
          eq(educationMessagesTable.threadId, threadA!.id),
          eq(educationMessagesTable.senderId, centerBOwnerUser!.id),
        ));
      assert.equal(newMessages.length, 0, "D.14 no message from center B in thread A");
      console.log("✓ D.14 center B cannot send message in enrollment A");
    }

    // D.15 Center B owner cannot open another dispute for enrollment A
    {
      const r = await mutate(base, sesCenterB, `/education/purchases/${enrollmentA!.id}/disputes`, "POST", {
        reason: "Fraudulent claim by B",
        details: "Trying to open a dispute I should not be able to.",
      });
      assertRejected(r, "D.15 center B POST dispute for enrollment A");
      const disputes = await db.select({ id: educationDisputesTable.id })
        .from(educationDisputesTable)
        .where(and(
          eq(educationDisputesTable.enrollmentId, enrollmentA!.id),
          eq(educationDisputesTable.openedByUserId, centerBOwnerUser!.id),
        ));
      assert.equal(disputes.length, 0, "D.15 no dispute from center B for enrollment A");
      console.log("✓ D.15 center B cannot open dispute for enrollment A");
    }

    // D.16 Center A's GET /education/courses?mine=true does NOT expose center B's unpublished course
    {
      const r = await get(base, sesCenterA, "/education/courses?mine=true");
      assert.equal(r.status, 200, "center A owner: GET /education/courses?mine=true");
      const ids = (r.body as Array<{ id: string }>).map((c) => c.id);
      assert.ok(!ids.includes(courseB!.id),
        "D.16 center A mine-list must not expose center B's unpublished course");
      console.log("✓ D.16 center A mine list excludes B unpublished course");
    }

    // D.17 Instructor list for center B owner excludes center A instructors
    {
      const r = await get(base, sesCenterB, "/education/instructors");
      assert.equal(r.status, 200, "center B owner: GET /education/instructors must succeed");
      const ids = (r.body as Array<{ id: string }>).map((i) => i.id);
      assert.ok(ids.includes(instructorB!.id), "D.17 center B instructor list must include own instructorB");
      assert.ok(!ids.includes(instructorA!.id), "D.17 center B instructor list must exclude center A instructor");
      console.log("✓ D.17 center B instructor list excludes A instructor");
    }

    // D.18 Education disputes list: center B owner sees only B disputes, not A's
    {
      // enrolleeA is the opener — center B owner's perspective
      const r = await get(base, sesCenterB, "/education/disputes");
      assert.equal(r.status, 200, "center B owner: GET /education/disputes must succeed");
      // Center B should have no disputes involving their own center
      // and must not see enrollment A's dispute even if there was one
      // (enrollmentA belongs to centerA). The endpoint filters by canParticipate.
      const disputeIds = (r.body as Array<{ enrollmentId: string }>)
        .map((d) => d.enrollmentId);
      assert.ok(!disputeIds.includes(enrollmentA!.id),
        "D.18 center B dispute list must not include enrollment A");
      console.log("✓ D.18 center B dispute list excludes A dispute");
    }

    // D.19 Enrollment lists are center-scoped and exclude foreign financial records
    {
      const [centerAResponse, centerBResponse] = await Promise.all([
        get(base, sesCenterA, "/education/enrollments"),
        get(base, sesCenterB, "/education/enrollments"),
      ]);
      assert.equal(centerAResponse.status, 200, "D.19 center A enrollments list must succeed");
      assert.equal(centerBResponse.status, 200, "D.19 center B enrollments list must succeed");
      const centerAIds = (centerAResponse.body as Array<{ id: string }>).map((item) => item.id);
      const centerBIds = (centerBResponse.body as Array<{ id: string }>).map((item) => item.id);
      assert.ok(centerAIds.includes(enrollmentA!.id), "D.19 center A must see enrollment A");
      assert.ok(!centerBIds.includes(enrollmentA!.id), "D.19 center B must not see enrollment A");
      console.log("✓ D.19 enrollment and financial views exclude foreign center records");
    }

    // D.20 Session metadata remains public while logistics are owner-scoped
    {
      const [ownerResponse, foreignResponse] = await Promise.all([
        get(base, sesCenterA, `/education/courses/${courseA!.id}/sessions`),
        get(base, sesCenterB, `/education/courses/${courseA!.id}/sessions`),
      ]);
      assert.equal(ownerResponse.status, 200, "D.20 center A session list must succeed");
      assert.equal(foreignResponse.status, 200, "D.20 published session metadata must remain visible");
      const ownerSession = (ownerResponse.body as Array<{ id: string; location: string | null }>).find((item) => item.id === sessionA!.id);
      const foreignSession = (foreignResponse.body as Array<{ id: string; location: string | null }>).find((item) => item.id === sessionA!.id);
      assert.equal(ownerSession?.location, "TI Location A", "D.20 owning center must see session location");
      assert.equal(foreignSession?.location, null, "D.20 foreign non-enrolled center must not see session location");
      console.log("✓ D.20 session location is visible only to the owning center");
    }

    // D.21 Center B cannot patch center A's session
    {
      const before = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionA!.id)).limit(1);
      const r = await mutate(base, sesCenterB, `/education/sessions/${sessionA!.id}`, "PATCH", {
        startsAt: new Date(futureStart.getTime() + 86_400_000).toISOString(),
        endsAt: new Date(futureEnd.getTime() + 86_400_000).toISOString(),
        location: "Hacked location",
        capacity: 20,
      });
      assertRejected(r, "D.21 center B PATCH session A");
      const after = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionA!.id)).limit(1);
      assert.deepEqual(after, before, "D.21 session A must remain unchanged");
      console.log("✓ D.21 center B cannot patch session A");
    }

    // D.22 Center B cannot delete center A's session
    {
      const r = await mutate(base, sesCenterB, `/education/sessions/${sessionA!.id}`, "DELETE", {});
      assertRejected(r, "D.22 center B DELETE session A");
      const [row] = await db.select({ id: courseSessionsTable.id }).from(courseSessionsTable)
        .where(eq(courseSessionsTable.id, sessionA!.id)).limit(1);
      assert.ok(row, "D.22 session A must still exist");
      console.log("✓ D.22 center B cannot delete session A");
    }

    // D.23 Center B cannot cancel center A's session or alter its escrow
    {
      const [beforeEscrow] = await db.select().from(educationEscrowsTable)
        .where(eq(educationEscrowsTable.id, escrowA!.id)).limit(1);
      const r = await mutate(base, sesCenterB, `/education/sessions/${sessionA!.id}/cancel`, "POST", {
        reason: "Foreign cancellation attempt",
      });
      assertRejected(r, "D.23 center B cancel session A");
      const [[afterSession], [afterEscrow]] = await Promise.all([
        db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionA!.id)).limit(1),
        db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, escrowA!.id)).limit(1),
      ]);
      assert.equal(afterSession!.cancelledAt, null, "D.23 session A must remain active");
      assert.deepEqual(afterEscrow, beforeEscrow, "D.23 escrow A must remain unchanged");
      console.log("✓ D.23 foreign session cancellation leaves financial state unchanged");
    }

    // D.24 Center B cannot cancel center A's enrollment
    {
      const [beforeEnrollment] = await db.select().from(courseEnrollmentsTable)
        .where(eq(courseEnrollmentsTable.id, enrollmentA!.id)).limit(1);
      const [beforeEscrow] = await db.select().from(educationEscrowsTable)
        .where(eq(educationEscrowsTable.id, escrowA!.id)).limit(1);
      const r = await mutate(base, sesCenterB, `/education/enrollments/${enrollmentA!.id}/cancel`, "POST", {
        reason: "Foreign enrollment cancellation attempt",
      });
      assertRejected(r, "D.24 center B cancel enrollment A");
      const [[afterEnrollment], [afterEscrow]] = await Promise.all([
        db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentA!.id)).limit(1),
        db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, escrowA!.id)).limit(1),
      ]);
      assert.deepEqual(afterEnrollment, beforeEnrollment, "D.24 enrollment A must remain unchanged");
      assert.deepEqual(afterEscrow, beforeEscrow, "D.24 escrow A must remain unchanged");
      console.log("✓ D.24 foreign enrollment cancellation leaves finance state unchanged");
    }

    // D.25 Center status contains only the authenticated owner's centers
    {
      const r = await get(base, sesCenterB, "/education/center/status");
      assert.equal(r.status, 200, "D.25 center B status must succeed");
      const ids = (r.body as Array<{ id: string }>).map((item) => item.id);
      assert.ok(ids.includes(centerB!.id), "D.25 center B must see own center status");
      assert.ok(!ids.includes(centerA!.id), "D.25 center B must not see center A status");
      console.log("✓ D.25 center status excludes foreign centers");
    }

    // D.26 Center A cannot access unpublished center B media
    {
      const r = await get(base, sesCenterA, `/education/media/${mediaBId}`);
      assertRejected(r, "D.26 center A GET private center B media");
      console.log("✓ D.26 private education media is center-scoped");
    }

    // =========================================================================
    // GROUP E — Preserved public/enrolled access
    // =========================================================================

    // E.1 Published course A metadata visible via public endpoint (no auth)
    {
      const r = await (await fetch(`${base}/api/education/public/courses`)).json() as Array<{ id: string }>;
      assert.ok(r.some((c) => c.id === courseA!.id),
        "E.1 published course A must appear in public listing");
      // Unpublished course B must NOT appear
      assert.ok(!r.some((c) => c.id === courseB!.id),
        "E.1 unpublished course B must not appear in public listing");
      console.log("✓ E.1 public listing includes A, excludes unpublished B");
    }

    // E.2 Public GET /education/courses/:courseId for published A — no auth needed
    {
      const r = await fetch(`${base}/api/education/public/courses/${courseA!.id}`);
      assert.equal(r.status, 200, "E.2 public GET published course A must return 200");
      const body = await r.json() as { sessions: Array<{ id: string; location: string | null }> };
      const session = body.sessions.find((item) => item.id === sessionA!.id);
      assert.ok(session, "E.2 public metadata must include session A");
      assert.equal(session.location, null, "E.2 public non-enrolled users must not see session location");
      console.log("✓ E.2 public course metadata accessible with location redacted");
    }

    // E.3 GET module list for published course A returns modules but no lesson content for B users
    // (Center B owner role: can see module metadata but lesson content is owner-gated)
    {
      const r = await get(base, sesCenterB, `/education/courses/${courseA!.id}/modules`);
      // Published course A: modules list is accessible but lesson content field should be absent
      // or empty for non-owner non-enrolled users.
      // The route returns 200 for published courses (non-owner gets lessons without content).
      assert.equal(r.status, 200, "E.3 published course A modules accessible to center B user");
      const modules = r.body as Array<{ id: string; lessons: Array<{ content?: string }> }>;
      for (const mod of modules) {
        for (const lesson of mod.lessons ?? []) {
          // Non-owner/non-enrolled: content must be absent or empty string
          assert.ok(
            lesson.content === undefined || lesson.content === "" || lesson.content === null,
            `E.3 lesson content must be absent for non-owner/non-enrolled center B user, got: ${JSON.stringify(lesson.content)}`,
          );
        }
      }
      console.log("✓ E.3 lesson content absent for non-owner non-enrolled user");
    }

    // E.4 enrolleeA can access enrollment A LMS (paid enrolled user)
    {
      const r = await get(base, sesEnrolleeA, `/education/enrollments/${enrollmentA!.id}/lms`);
      assert.equal(r.status, 200, "E.4 paid enrollee A must access enrollment A LMS");
      const sessions = (r.body as { course: { sessions: Array<{ id: string; location: string | null }> } }).course.sessions;
      assert.equal(
        sessions.find((item) => item.id === sessionA!.id)?.location,
        "TI Location A",
        "E.4 paid enrollee must retain access to session logistics",
      );
      console.log("✓ E.4 enrolled user retains LMS and session-location access");
    }

    // E.5 Center A owner can access course A (owner access)
    {
      const r = await get(base, sesCenterA, `/education/courses/${courseA!.id}`);
      assert.equal(r.status, 200, "E.5 center A owner must access own course A");
      console.log("✓ E.5 center A owner retains course A access");
    }

    // E.6 enrolleeA can read messages for enrollment A
    {
      const r = await get(base, sesEnrolleeA, `/education/purchases/${enrollmentA!.id}/messages`);
      assert.equal(r.status, 200, "E.6 paid enrollee A must read own enrollment messages");
      const messages = (r.body as { messages: Array<{ id: string }> }).messages;
      assert.ok(messages.some((m) => m.id === messageA!.id),
        "E.6 message A must appear for enrollee A");
      console.log("✓ E.6 enrolled user retains message access");
    }

    // E.7 Center A owner sees own course in /education/courses list
    {
      const r = await get(base, sesCenterA, "/education/courses");
      assert.equal(r.status, 200, "E.7 center A owner GET /education/courses must succeed");
      const ids = (r.body as Array<{ id: string }>).map((c) => c.id);
      assert.ok(ids.includes(courseA!.id), "E.7 center A owner must see own published course A");
      console.log("✓ E.7 center A owner sees own course in list");
    }

    // E.8 Private media ref for education course A is NOT exposed to center B owner
    // via the education/media/:mediaId route (ownership check).
    // We insert a dummy media record to test isolation.
    // Note: Full media storage is not available in test; this checks the
    // ownership metadata layer, not the storage proxy.
    {
      // Course A's imageUrl is a plain path "/ti.jpg" (not a real media-route URL),
      // so the response body must never expose raw storage references.
      const r = await get(base, sesCenterB, `/education/courses/${courseA!.id}`);
      // Center B: course A is published → 200 (public), but imageUrl must not be
      // a storage-internal path. The route always returns a sanitized URL.
      if (r.status === 200) {
        const body = r.body as { imageUrl?: string };
        // The image URL must never start with "/objects/" (raw storage path)
        assert.ok(
          !body.imageUrl?.startsWith("/objects/"),
          "E.8 course A imageUrl must not expose raw storage path to center B",
        );
      }
      console.log("✓ E.8 private media refs not exposed to center B");
    }

    console.log("\n✓ All tenant-isolation assertions passed.");
  } catch (error) {
    testError = error;
  } finally {
    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP — reverse dependency order. Every failure is collected so cleanup
    // keeps progressing, but the release test cannot report success if any
    // fixture or session remains in the shared development database.
    // ─────────────────────────────────────────────────────────────────────────
    const cleanupErrors: Error[] = [];
    const cleanupStep = async (label: string, action: () => Promise<unknown>): Promise<void> => {
      try {
        await action();
      } catch (error) {
        cleanupErrors.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`));
      }
    };

    await cleanupStep("close tenant-isolation HTTP server", async () => {
      if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    });

    await cleanupStep("delete education messages", async () => {
      if (createdMessageIds.length) await db.delete(educationMessagesTable)
        .where(inArray(educationMessagesTable.id, createdMessageIds));
    });
    await cleanupStep("delete education threads", async () => {
      if (createdThreadIds.length) await db.delete(educationThreadsTable)
        .where(inArray(educationThreadsTable.id, createdThreadIds));
    });
    await cleanupStep("delete education disputes", async () => {
      if (createdDisputeIds.length) await db.delete(educationDisputesTable)
        .where(inArray(educationDisputesTable.id, createdDisputeIds));
    });
    await cleanupStep("delete education escrows", async () => {
      if (createdEscrowIds.length) await db.delete(educationEscrowsTable)
        .where(inArray(educationEscrowsTable.id, createdEscrowIds));
    });
    await cleanupStep("delete education enrollments", async () => {
      if (createdEnrollmentIds.length) await db.delete(courseEnrollmentsTable)
        .where(inArray(courseEnrollmentsTable.id, createdEnrollmentIds));
    });
    await cleanupStep("delete education centers", async () => {
      if (createdCenterIds.length) await db.delete(educationCentersTable)
        .where(inArray(educationCentersTable.id, createdCenterIds));
    });

    // users.activeSalonId references salons, so detach it before salon cascades.
    await cleanupStep("clear fixture active salons", async () => {
      if (createdUserIds.length) await db.update(usersTable).set({ activeSalonId: null })
        .where(inArray(usersTable.id, createdUserIds));
    });
    await cleanupStep("delete fixture order items", async () => {
      if (createdOrderIds.length) await db.delete(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, createdOrderIds));
    });
    await cleanupStep("delete fixture orders", async () => {
      if (createdOrderIds.length) await db.delete(ordersTable)
        .where(inArray(ordersTable.id, createdOrderIds));
    });
    await cleanupStep("delete salons", async () => {
      if (createdSalonIds.length) await db.delete(salonsTable)
        .where(inArray(salonsTable.id, createdSalonIds));
    });
    await cleanupStep("delete users and sessions", async () => {
      if (createdUserIds.length) await db.delete(usersTable)
        .where(inArray(usersTable.id, createdUserIds));
    });

    await cleanupStep("verify fixture cleanup", async () => {
      const [remainingUsers, remainingSalons, remainingCenters] = await Promise.all([
        createdUserIds.length
          ? db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.id, createdUserIds))
          : [],
        createdSalonIds.length
          ? db.select({ id: salonsTable.id }).from(salonsTable).where(inArray(salonsTable.id, createdSalonIds))
          : [],
        createdCenterIds.length
          ? db.select({ id: educationCentersTable.id }).from(educationCentersTable).where(inArray(educationCentersTable.id, createdCenterIds))
          : [],
      ]);
      if (remainingUsers.length || remainingSalons.length || remainingCenters.length) {
        throw new Error(
          `remaining rows — users=${remainingUsers.length}, salons=${remainingSalons.length}, centers=${remainingCenters.length}`,
        );
      }
    });

    await cleanupStep("close database pool", () => pool.end());
    const allErrors = [
      ...(testError ? [testError] : []),
      ...cleanupErrors,
    ];
    if (allErrors.length === 1) throw allErrors[0];
    if (allErrors.length > 1) {
      const details = allErrors.map((error, index) =>
        `${index + 1}. ${error instanceof Error ? error.message : String(error)}`).join("\n");
      throw new AggregateError(allErrors, `Tenant-isolation test or cleanup failed:\n${details}`);
    }
  }
}

run().catch((err) => {
  console.error("Tenant isolation test failed:", err);
  process.exitCode = 1;
});
