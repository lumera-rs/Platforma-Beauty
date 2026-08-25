import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationDisputesTable,
  educationEscrowsTable,
  educationFinancialEventsTable,
  educationLedgerEntriesTable,
  educationPayoutsTable,
  educationPlatformSettingsTable,
  educationThreadsTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const password = "education-finance-test-password";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
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
  const response = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, `Fixture user ${email} must be able to sign in.`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${sessionCookieName}=`), `Login for ${email} must establish a session.`);
  if (!cookie) throw new Error(`Login for ${email} did not return a session cookie.`);
  return cookie;
}

async function withQuarterEnd<T>(operation: () => Promise<T>): Promise<T> {
  const originalDate = globalThis.Date;
  const frozenTime = originalDate.parse("2026-09-30T12:00:00.000Z");

  class QuarterEndDate extends originalDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? frozenTime : value instanceof originalDate ? value.getTime() : value);
    }

    static now(): number {
      return frozenTime;
    }
  }

  globalThis.Date = QuarterEndDate as unknown as DateConstructor;
  try {
    return await operation();
  } finally {
    globalThis.Date = originalDate;
  }
}

async function waitForAdvisoryLockWaiters(lockKey: string, expectedWaiters: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select count(*)::int as waiters
      from pg_locks
      where locktype = 'advisory'
        and objid = hashtext(${lockKey})
        and not granted
    `);
    const waiters = Number((result.rows[0] as { waiters?: number | string } | undefined)?.waiters ?? 0);
    if (waiters >= expectedWaiters) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${expectedWaiters} requests to contend for the education financial lock.`);
}

async function run(): Promise<void> {
  await ensureDemoData();

  let server: ReturnType<typeof app.listen> | undefined;
  let centerId: string | undefined;
  const raceCenterIds: string[] = [];
  const courseIds: string[] = [];
  const enrollmentIds: string[] = [];
  const createdUserIds: string[] = [];
  let releaseRaceLock: (() => void) | undefined;
  let raceLockHolder: Promise<void> | undefined;

  try {
    const fixturePasswordHash = await hashPassword(password);
    const fixtureUsers = await db.insert(usersTable).values([
      {
        firstName: "Test",
        lastName: "Administrator",
        email: `education-admin-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "SUPER_ADMIN",
      },
      {
        firstName: "Centar",
        lastName: "Vlasnik",
        email: `education-center-owner-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "EDUKATIVNI_CENTAR",
      },
      {
        firstName: "Kupac",
        lastName: "Edukacije",
        email: `education-buyer-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
      {
        firstName: "Drugi",
        lastName: "Kupac",
        email: `education-outsider-${suffix}@example.test`,
        passwordHash: fixturePasswordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
    ]).returning();
    createdUserIds.push(...fixtureUsers.map((user) => user.id));
    const admin = fixtureUsers[0]!;
    const centerOwner = fixtureUsers[1]!;
    const buyer = fixtureUsers[2]!;
    const outsider = fixtureUsers[3]!;

    const [plan] = await db.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.active, true))
      .limit(1);
    assert.ok(plan, "Education finance coverage requires an active subscription plan.");

    const [center] = await db.insert(educationCentersTable).values({
      ownerId: centerOwner.id,
      name: `Finance coverage center ${suffix}`,
      city: "Beograd",
      description: "Izolovani centar za proveru edukativnih finansija.",
      imageUrl: "/test-education-finance.jpg",
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

    const [payoutRaceCenter] = await db.insert(educationCentersTable).values([
      {
        ownerId: centerOwner.id,
        name: `Payout race center ${suffix}`,
        city: "Beograd",
        description: "Izolovani centar za proveru konkurentne isplate.",
        imageUrl: "/test-education-finance.jpg",
        verificationStatus: "verified",
        verifiedAt: new Date(),
        verifiedByUserId: admin.id,
      },
    ]).returning();
    assert.ok(payoutRaceCenter);
    raceCenterIds.push(payoutRaceCenter.id);
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: payoutRaceCenter.id,
      planId: plan.id,
      status: "active",
      dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const [unverifiedCenter] = await db.insert(educationCentersTable).values({
      ownerId: centerOwner.id,
      name: `Unverified education center ${suffix}`,
      city: "Beograd",
      description: "Centar za proveru zaštite javne prodaje.",
      imageUrl: "/test-education-finance.jpg",
      verificationStatus: "pending",
    }).returning();
    assert.ok(unverifiedCenter);
    raceCenterIds.push(unverifiedCenter.id);
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: unverifiedCenter.id,
      planId: plan.id,
      status: "active",
      dueAmount: plan.price,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const [unverifiedCourse] = await db.insert(coursesTable).values({
      centerId: unverifiedCenter.id,
      title: `Unverified public course ${suffix}`,
      description: "Objavljen kurs koji ne sme biti dostupan za javnu kupovinu.",
      category: "Zaštita javne prodaje",
      format: "online",
      city: "Beograd",
      price: 11000,
      duration: "2 nedelje",
      certification: true,
      imageUrl: "/test-education-finance.jpg",
      published: true,
    }).returning();
    assert.ok(unverifiedCourse);
    courseIds.push(unverifiedCourse.id);

    const [onlineCourse, liveCourse, refundCourse, rejectCourse, revokedCourse] = await db.insert(coursesTable).values([
      {
        centerId: center.id,
        title: `Online financial course ${suffix}`,
        description: "Online kurs za proveru refund roka.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 10000,
        duration: "4 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: center.id,
        title: `Live financial course ${suffix}`,
        description: "Kurs uživo za proveru roka žalbe.",
        category: "Finansijska pokrivenost",
        format: "in-person",
        city: "Beograd",
        price: 12000,
        duration: "2 dana",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: center.id,
        title: `Refund financial course ${suffix}`,
        description: "Kurs za proveru odluke o refundiranju.",
        category: "Finansijska pokrivenost",
        format: "in-person",
        city: "Beograd",
        price: 13000,
        duration: "3 nedelje",
        rating: 50,
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: center.id,
        title: `Reject financial course ${suffix}`,
        description: "Kurs za proveru odbijanja spora.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 14000,
        duration: "3 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: center.id,
        title: `Revoked center course ${suffix}`,
        description: "Kurs za proveru opoziva verifikacije centra.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 14500,
        duration: "3 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
    ]).returning();
    for (const course of [onlineCourse, liveCourse, refundCourse, rejectCourse, revokedCourse]) {
      assert.ok(course);
      courseIds.push(course.id);
    }
    const [payoutRaceCourse, disputeRaceCourse, maturityRaceCourse, duplicateDisputeCourse] = await db.insert(coursesTable).values([
      {
        centerId: payoutRaceCenter.id,
        title: `Payout race course ${suffix}`,
        description: "Kurs za proveru konkurentne isplate i spora.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 15000,
        duration: "2 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: payoutRaceCenter.id,
        title: `Dispute race course ${suffix}`,
        description: "Kurs za proveru konkurentnog spora i isplate.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 16000,
        duration: "2 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: payoutRaceCenter.id,
        title: `Maturity race course ${suffix}`,
        description: "Kurs za proveru dospeća i konkurentnog spora.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 17000,
        duration: "2 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
      {
        centerId: payoutRaceCenter.id,
        title: `Duplicate dispute course ${suffix}`,
        description: "Kurs za proveru ponovljenog spora pri isteku roka.",
        category: "Finansijska pokrivenost",
        format: "online",
        city: "Beograd",
        price: 18000,
        duration: "2 nedelje",
        certification: true,
        imageUrl: "/test-education-finance.jpg",
        published: true,
      },
    ]).returning();
    assert.ok(payoutRaceCourse);
    assert.ok(disputeRaceCourse);
    assert.ok(maturityRaceCourse);
    assert.ok(duplicateDisputeCourse);
    courseIds.push(payoutRaceCourse.id, disputeRaceCourse.id, maturityRaceCourse.id, duplicateDisputeCourse.id);

    const now = Date.now();
    const pastSessionEnd = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const futureSessionStart = new Date(now + 4 * 24 * 60 * 60 * 1000);
    const futureSessionEnd = new Date(now + 5 * 24 * 60 * 60 * 1000);
    const [pastSession, futureSession, refundSession] = await db.insert(courseSessionsTable).values([
      {
        courseId: liveCourse!.id,
        startsAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
        endsAt: pastSessionEnd,
        location: "Beograd",
        capacity: 10,
      },
      {
        courseId: liveCourse!.id,
        startsAt: futureSessionStart,
        endsAt: futureSessionEnd,
        location: "Beograd",
        capacity: 10,
      },
      {
        courseId: refundCourse!.id,
        startsAt: futureSessionStart,
        endsAt: futureSessionEnd,
        location: "Beograd",
        capacity: 3,
      },
    ]).returning();
    assert.ok(pastSession);
    assert.ok(futureSession);
    assert.ok(refundSession);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const adminCookie = await login(baseUrl, admin.email);
    const centerOwnerCookie = await login(baseUrl, centerOwner.email);
    const buyerCookie = await login(baseUrl, buyer.email);
    const outsiderCookie = await login(baseUrl, outsider.email);

    const [settings] = await db.select().from(educationPlatformSettingsTable).limit(1);
    assert.ok(settings);

    const publicCoursesResponse = await request(baseUrl, "/education/public/courses");
    assert.equal(publicCoursesResponse.status, 200);
    const publicCourses = await json<Array<{ id: string }>>(publicCoursesResponse);
    assert.equal(
      publicCourses.some((course) => course.id === unverifiedCourse.id),
      false,
      "A published course from an unverified center must stay out of the public marketplace.",
    );

    const blockedEnrollmentResponse = await request(baseUrl, `/education/courses/${unverifiedCourse.id}/enrollments`, {
      method: "POST",
      cookie: buyerCookie,
      headers: { "idempotency-key": `unverified-${suffix}` },
      body: {},
    });
    assert.equal(blockedEnrollmentResponse.status, 404, "Unverified center courses must reject public enrollment.");
    const blockedEnrollments = await db.select().from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.courseId, unverifiedCourse.id));
    assert.equal(blockedEnrollments.length, 0, "A rejected public enrollment must not create an enrollment record.");

    async function enrollAndSettle(courseId: string, key: string) {
      const enrollmentResponse = await request(baseUrl, `/education/courses/${courseId}/enrollments`, {
        method: "POST",
        cookie: buyerCookie,
        headers: { "idempotency-key": key },
        body: {},
      });
      assert.equal(enrollmentResponse.status, 201, "Buyer enrollment must be recorded as pending.");
      const pending = await json<{ id: string; status: string; paymentStatus: string }>(enrollmentResponse);
      assert.equal(pending.status, "pending");
      assert.equal(pending.paymentStatus, "pending");
      enrollmentIds.push(pending.id);

      const settlementResponse = await request(baseUrl, `/admin/education/enrollments/${pending.id}/settle`, {
        method: "POST",
        cookie: adminCookie,
      });
      assert.equal(settlementResponse.status, 200, "Admin settlement must activate the enrollment.");
      const settled = await json<{ status: string; paymentStatus: string }>(settlementResponse);
      assert.equal(settled.status, "active");
      assert.equal(settled.paymentStatus, "paid");
      return pending.id;
    }

    const onlineEnrollmentId = await enrollAndSettle(onlineCourse!.id, `online-${suffix}`);
    const liveEnrollmentId = await enrollAndSettle(liveCourse!.id, `live-${suffix}`);
    const refundEnrollmentId = await enrollAndSettle(refundCourse!.id, `refund-${suffix}`);
    const rejectEnrollmentId = await enrollAndSettle(rejectCourse!.id, `reject-${suffix}`);

    const revokedEnrollmentResponse = await request(baseUrl, `/education/courses/${revokedCourse!.id}/enrollments`, {
      method: "POST",
      cookie: buyerCookie,
      headers: { "idempotency-key": `revoked-${suffix}` },
      body: {},
    });
    assert.equal(revokedEnrollmentResponse.status, 201, "A verified center must accept a pending marketplace enrollment.");
    const revokedEnrollment = await json<{ id: string; status: string; paymentStatus: string }>(revokedEnrollmentResponse);
    assert.equal(revokedEnrollment.status, "pending");
    assert.equal(revokedEnrollment.paymentStatus, "pending");
    enrollmentIds.push(revokedEnrollment.id);

    const revokeCenterResponse = await request(baseUrl, `/admin/education/centers/${center.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { verificationStatus: "pending", verificationNote: "Verification revoked during settlement test." },
    });
    assert.equal(revokeCenterResponse.status, 200, "The center must be moved back to pending before settlement.");

    const blockedRevokedSettlement = await request(baseUrl, `/admin/education/enrollments/${revokedEnrollment.id}/settle`, {
      method: "POST",
      cookie: adminCookie,
    });
    assert.equal(blockedRevokedSettlement.status, 409, "Settlement must reject a pending enrollment after center verification is revoked.");

    const [revokedEnrollmentRow] = await db.select().from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.id, revokedEnrollment.id));
    assert.equal(revokedEnrollmentRow?.status, "pending", "Rejected settlement must not grant course access.");
    assert.equal(revokedEnrollmentRow?.paymentStatus, "pending", "Rejected settlement must not mark the purchase paid.");
    assert.equal(revokedEnrollmentRow?.accessGrantedAt, null, "Rejected settlement must not set an access grant.");
    assert.equal(
      (await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, revokedEnrollment.id))).length,
      0,
      "Rejected settlement must not create escrow.",
    );
    assert.equal(
      (await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, revokedEnrollment.id))).length,
      0,
      "Rejected settlement must not create ledger entries.",
    );
    assert.equal(
      (await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.enrollmentId, revokedEnrollment.id))).length,
      0,
      "Rejected settlement must not create financial events.",
    );
    assert.equal(
      (await db.select().from(educationThreadsTable).where(eq(educationThreadsTable.enrollmentId, revokedEnrollment.id))).length,
      0,
      "Rejected settlement must not create an education thread.",
    );

    const restoreCenterResponse = await request(baseUrl, `/admin/education/centers/${center.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { verificationStatus: "verified" },
    });
    assert.equal(restoreCenterResponse.status, 200, "The center must be restored for the remaining finance coverage.");

    const enrollmentRaceLockKey = `education-center:${center.id}`;
    let enrollmentRaceLockAcquired!: () => void;
    const enrollmentRaceLockAcquiredPromise = new Promise<void>((resolve) => { enrollmentRaceLockAcquired = resolve; });
    const enrollmentRaceLockReleasedPromise = new Promise<void>((resolve) => { releaseRaceLock = resolve; });
    raceLockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${enrollmentRaceLockKey}))`);
      enrollmentRaceLockAcquired();
      await enrollmentRaceLockReleasedPromise;
    });
    await enrollmentRaceLockAcquiredPromise;

    const queuedRevocationRequest = request(baseUrl, `/admin/education/centers/${center.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { verificationStatus: "pending", verificationNote: "Queued revocation must block marketplace enrollment." },
    });
    await waitForAdvisoryLockWaiters(enrollmentRaceLockKey, 1);
    const queuedEnrollmentRequest = request(baseUrl, `/education/courses/${onlineCourse!.id}/enrollments`, {
      method: "POST",
      cookie: outsiderCookie,
      headers: { "idempotency-key": `enrollment-revocation-race-${suffix}` },
      body: {},
    });
    await waitForAdvisoryLockWaiters(enrollmentRaceLockKey, 2);
    const releaseEnrollmentRaceLock = releaseRaceLock as (() => void) | undefined;
    if (!releaseEnrollmentRaceLock) throw new Error("The enrollment race lock must be releasable after both requests are queued.");
    releaseEnrollmentRaceLock();
    await raceLockHolder;
    raceLockHolder = undefined;
    releaseRaceLock = undefined;

    const [queuedRevocationResponse, queuedEnrollmentResponse] = await Promise.all([
      queuedRevocationRequest,
      queuedEnrollmentRequest,
    ]);
    assert.equal(queuedRevocationResponse.status, 200, "The queued center revocation must commit before enrollment.");
    assert.equal(queuedEnrollmentResponse.status, 404, "Enrollment must reject after the queued center revocation commits.");
    assert.equal(
      (await db.select().from(courseEnrollmentsTable).where(and(
        eq(courseEnrollmentsTable.courseId, onlineCourse!.id),
        eq(courseEnrollmentsTable.purchaserId, outsider.id),
      ))).length,
      0,
      "A rejected enrollment after revocation must not create a pending enrollment record.",
    );

    const restoreAfterEnrollmentRevocation = await request(baseUrl, `/admin/education/centers/${center.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { verificationStatus: "verified" },
    });
    assert.equal(restoreAfterEnrollmentRevocation.status, 200, "The center must be restored after the enrollment concurrency coverage.");

    const concurrentRevocationEnrollmentResponse = await request(baseUrl, `/education/courses/${revokedCourse!.id}/enrollments`, {
      method: "POST",
      cookie: outsiderCookie,
      headers: { "idempotency-key": `revoked-race-${suffix}` },
      body: {},
    });
    assert.equal(concurrentRevocationEnrollmentResponse.status, 201, "A verified center must accept the concurrent-race enrollment.");
    const concurrentRevocationEnrollment = await json<{ id: string; status: string; paymentStatus: string }>(concurrentRevocationEnrollmentResponse);
    assert.equal(concurrentRevocationEnrollment.status, "pending");
    assert.equal(concurrentRevocationEnrollment.paymentStatus, "pending");
    enrollmentIds.push(concurrentRevocationEnrollment.id);

    const revocationRaceLockKey = `education-center:${center.id}`;
    let revocationRaceLockAcquired!: () => void;
    const revocationRaceLockAcquiredPromise = new Promise<void>((resolve) => { revocationRaceLockAcquired = resolve; });
    const revocationRaceLockReleasedPromise = new Promise<void>((resolve) => { releaseRaceLock = resolve; });
    raceLockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${revocationRaceLockKey}))`);
      revocationRaceLockAcquired();
      await revocationRaceLockReleasedPromise;
    });
    await revocationRaceLockAcquiredPromise;

    const concurrentRevocationRequest = request(baseUrl, `/admin/education/centers/${center.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { verificationStatus: "pending", verificationNote: "Queued revocation must win settlement." },
    });
    await waitForAdvisoryLockWaiters(revocationRaceLockKey, 1);
    const concurrentSettlementRequest = request(baseUrl, `/admin/education/enrollments/${concurrentRevocationEnrollment.id}/settle`, {
      method: "POST",
      cookie: adminCookie,
    });
    await waitForAdvisoryLockWaiters(revocationRaceLockKey, 2);
    const releaseRevocationRaceLock = releaseRaceLock as (() => void) | undefined;
    if (!releaseRevocationRaceLock) throw new Error("The revocation race lock must be releasable after both requests are queued.");
    releaseRevocationRaceLock();
    await raceLockHolder;
    raceLockHolder = undefined;
    releaseRaceLock = undefined;

    const [concurrentRevocationResponse, concurrentSettlementResponse] = await Promise.all([
      concurrentRevocationRequest,
      concurrentSettlementRequest,
    ]);
    assert.equal(concurrentRevocationResponse.status, 200, "The queued center revocation must commit first.");
    assert.equal(concurrentSettlementResponse.status, 409, "Settlement must reject after the queued revocation commits.");
    const [concurrentRevocationEnrollmentRow] = await db.select().from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.id, concurrentRevocationEnrollment.id));
    assert.equal(concurrentRevocationEnrollmentRow?.status, "pending", "A losing settlement must leave the enrollment pending.");
    assert.equal(concurrentRevocationEnrollmentRow?.paymentStatus, "pending", "A losing settlement must not mark the purchase paid.");
    assert.equal(concurrentRevocationEnrollmentRow?.accessGrantedAt, null, "A losing settlement must not grant course access.");
    assert.equal(
      (await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, concurrentRevocationEnrollment.id))).length,
      0,
      "A losing settlement must not create escrow.",
    );
    assert.equal(
      (await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, concurrentRevocationEnrollment.id))).length,
      0,
      "A losing settlement must not create ledger entries.",
    );
    assert.equal(
      (await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.enrollmentId, concurrentRevocationEnrollment.id))).length,
      0,
      "A losing settlement must not create financial events.",
    );
    assert.equal(
      (await db.select().from(educationThreadsTable).where(eq(educationThreadsTable.enrollmentId, concurrentRevocationEnrollment.id))).length,
      0,
      "A losing settlement must not create an education thread.",
    );
    const restoreAfterConcurrentRevocation = await request(baseUrl, `/admin/education/centers/${center.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { verificationStatus: "verified" },
    });
    assert.equal(restoreAfterConcurrentRevocation.status, 200, "The center must be restored after the concurrency coverage.");

    const onlineEscrowBeforeDispute = (await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, onlineEnrollmentId)))[0];
    const liveEscrowBeforeDispute = (await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, liveEnrollmentId)))[0];
    assert.ok(onlineEscrowBeforeDispute);
    assert.ok(liveEscrowBeforeDispute);
    assert.ok(onlineEscrowBeforeDispute.releaseAt.getTime() > now);
    assert.ok(
      onlineEscrowBeforeDispute.releaseAt.getTime() <= now + (settings.onlineRefundDays + 1) * 24 * 60 * 60 * 1000,
      "Online escrow must use the configured refund window.",
    );
    assert.equal(
      liveEscrowBeforeDispute.releaseAt.getTime(),
      futureSessionEnd.getTime() + settings.liveAppealDays * 24 * 60 * 60 * 1000,
      "Live escrow must use the assigned future session end, not the course's earliest session.",
    );
    const [storedFutureSession] = await db.select().from(courseSessionsTable)
      .where(eq(courseSessionsTable.id, futureSession!.id));
    assert.equal(storedFutureSession?.reservedSeats, 1, "Settlement must reserve the selected future live-course seat.");
    const [storedPastSession] = await db.select().from(courseSessionsTable)
      .where(eq(courseSessionsTable.id, pastSession!.id));
    assert.equal(storedPastSession?.reservedSeats, 0, "Settlement must not reserve an already-ended live session.");

    const pendingResponse = await request(baseUrl, "/education/courses/" + rejectCourse!.id + "/enrollments", {
      method: "POST",
      cookie: outsiderCookie,
      headers: { "idempotency-key": `pending-outsider-${suffix}` },
      body: {},
    });
    assert.equal(pendingResponse.status, 201);
    const pendingEnrollment = await json<{ id: string }>(pendingResponse);
    enrollmentIds.push(pendingEnrollment.id);
    const pendingMessageResponse = await request(baseUrl, `/education/purchases/${pendingEnrollment.id}/messages`, {
      method: "POST",
      cookie: outsiderCookie,
      body: { body: "Poruka pre potvrde" },
    });
    assert.equal(pendingMessageResponse.status, 409, "Unsettled purchases must not open messaging access.");

    const buyerPurchases = await request(baseUrl, "/education/purchases", { cookie: buyerCookie });
    assert.equal(buyerPurchases.status, 200);
    const buyerPurchaseRows = await json<Array<{ id: string }>>(buyerPurchases);
    assert.ok(buyerPurchaseRows.some((purchase) => purchase.id === onlineEnrollmentId), "Buyer must see their own purchase.");

    const ownerPurchases = await request(baseUrl, "/education/purchases", { cookie: centerOwnerCookie });
    assert.equal(ownerPurchases.status, 200);
    assert.equal(
      (await json<Array<{ id: string }>>(ownerPurchases)).some((purchase) => purchase.id === onlineEnrollmentId),
      false,
      "Center owner must not see a buyer's purchase through the buyer-scoped endpoint.",
    );
    const outsiderPurchases = await request(baseUrl, "/education/purchases", { cookie: outsiderCookie });
    assert.equal(outsiderPurchases.status, 200);
    assert.equal(
      (await json<Array<{ id: string }>>(outsiderPurchases)).some((purchase) => purchase.id === onlineEnrollmentId),
      false,
      "Another buyer must not see someone else's purchase.",
    );
    const adminPurchases = await request(baseUrl, "/education/purchases", { cookie: adminCookie });
    assert.equal(adminPurchases.status, 200);
    assert.equal(
      (await json<Array<{ id: string }>>(adminPurchases)).some((purchase) => purchase.id === onlineEnrollmentId),
      false,
      "Admin access to finance must not turn the buyer-scoped purchases endpoint into a data dump.",
    );

    const buyerMessages = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, { cookie: buyerCookie });
    assert.equal(buyerMessages.status, 200, "Buyer must read their paid purchase thread.");
    const ownerMessages = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, { cookie: centerOwnerCookie });
    assert.equal(ownerMessages.status, 200, "Center owner must read the center's paid purchase thread.");
    const outsiderMessages = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, { cookie: outsiderCookie });
    assert.equal(outsiderMessages.status, 403, "Unrelated users must not read a purchase thread.");
    const adminMessages = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, { cookie: adminCookie });
    assert.equal(adminMessages.status, 200, "Admin must be able to inspect a purchase thread.");

    const buyerMessage = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, {
      method: "POST",
      cookie: buyerCookie,
      body: { body: "Kupac pita za termin." },
    });
    assert.equal(buyerMessage.status, 201);
    const ownerMessage = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, {
      method: "POST",
      cookie: centerOwnerCookie,
      body: { body: "Centar odgovara kupcu." },
    });
    assert.equal(ownerMessage.status, 201);
    const outsiderMessage = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, {
      method: "POST",
      cookie: outsiderCookie,
      body: { body: "Tuđa poruka." },
    });
    assert.equal(outsiderMessage.status, 403);
    const adminMessage = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/messages`, {
      method: "POST",
      cookie: adminCookie,
      body: { body: "Admin poruka." },
    });
    assert.equal(adminMessage.status, 403, "Admin inspection must not grant participant messaging rights.");

    const buyerDisputes = await request(baseUrl, "/education/disputes", { cookie: buyerCookie });
    assert.equal(buyerDisputes.status, 200);
    const ownerDisputes = await request(baseUrl, "/education/disputes", { cookie: centerOwnerCookie });
    assert.equal(ownerDisputes.status, 200);
    const adminDisputes = await request(baseUrl, "/education/disputes", { cookie: adminCookie });
    assert.equal(adminDisputes.status, 200);
    const outsiderDisputes = await request(baseUrl, "/education/disputes", { cookie: outsiderCookie });
    assert.equal(outsiderDisputes.status, 200);
    assert.equal((await json<unknown[]>(outsiderDisputes)).length, 0, "Unrelated users must not see disputes.");

    async function openDispute(enrollmentId: string): Promise<string> {
      const response = await request(baseUrl, `/education/purchases/${enrollmentId}/disputes`, {
        method: "POST",
        cookie: buyerCookie,
        body: { reason: "Test razlog", details: "Test detaljan opis problema." },
      });
      assert.equal(response.status, 201, "Buyer must be able to open a dispute during the protection window.");
      const dispute = await json<{ id: string; status: string }>(response);
      assert.equal(dispute.status, "open");
      return dispute.id;
    }

    const ownerDisputeAttempt = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/disputes`, {
      method: "POST",
      cookie: centerOwnerCookie,
      body: { reason: "Nedozvoljeno", details: "Vlasnik ne sme otvoriti spor." },
    });
    assert.equal(ownerDisputeAttempt.status, 403);
    const adminDisputeAttempt = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/disputes`, {
      method: "POST",
      cookie: adminCookie,
      body: { reason: "Nedozvoljeno", details: "Admin ne sme otvoriti spor u ime kupca." },
    });
    assert.equal(adminDisputeAttempt.status, 403);
    const outsiderDisputeAttempt = await request(baseUrl, `/education/purchases/${onlineEnrollmentId}/disputes`, {
      method: "POST",
      cookie: outsiderCookie,
      body: { reason: "Nedozvoljeno", details: "Drugi kupac ne sme otvoriti spor." },
    });
    assert.equal(outsiderDisputeAttempt.status, 403);

    const onlineDisputeId = await openDispute(onlineEnrollmentId);
    const [frozenOnlineEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, onlineEnrollmentId));
    assert.equal(frozenOnlineEscrow?.status, "frozen", "Opening a dispute must freeze escrow.");
    const openedEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.enrollmentId, onlineEnrollmentId),
      eq(educationFinancialEventsTable.eventType, "dispute_opened"),
    ));
    assert.equal(openedEvents.length, 1, "Opening a dispute must create one audit event.");
    for (const [label, cookie] of [
      ["buyer", buyerCookie],
      ["center owner", centerOwnerCookie],
      ["administrator", adminCookie],
    ] as const) {
      const response = await request(baseUrl, "/education/disputes", { cookie });
      assert.equal(response.status, 200);
      assert.equal(
        (await json<Array<{ id: string }>>(response)).some((dispute) => dispute.id === onlineDisputeId),
        true,
        `${label} must see the dispute they are allowed to participate in or inspect.`,
      );
    }
    const hiddenDisputeList = await request(baseUrl, "/education/disputes", { cookie: outsiderCookie });
    assert.equal(hiddenDisputeList.status, 200);
    assert.equal(
      (await json<Array<{ id: string }>>(hiddenDisputeList)).some((dispute) => dispute.id === onlineDisputeId),
      false,
      "Unrelated buyers must not see another buyer's dispute.",
    );

    const ledgerBeforeBlockedPayout = await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.centerId, center.id));
    const blockedPayout = await request(baseUrl, "/admin/education/payouts", {
      method: "POST",
      cookie: adminCookie,
      body: { centerId: center.id },
    });
    assert.equal(blockedPayout.status, 409, "An open dispute must block payout for the center.");
    const ledgerAfterBlockedPayout = await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.centerId, center.id));
    assert.equal(ledgerAfterBlockedPayout.length, ledgerBeforeBlockedPayout.length, "Blocked payout must not create ledger entries.");
    const ownerFinance = await request(baseUrl, `/admin/education/finance?centerId=${center.id}`, { cookie: centerOwnerCookie });
    assert.equal(ownerFinance.status, 403, "Center owners must not access admin finance.");
    const ownerPayout = await request(baseUrl, "/admin/education/payouts", {
      method: "POST",
      cookie: centerOwnerCookie,
      body: { centerId: center.id },
    });
    assert.equal(ownerPayout.status, 403, "Center owners must not create payouts.");

    const releaseDecision = await request(baseUrl, `/admin/education/disputes/${onlineDisputeId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { action: "release", resolutionNote: "Spor se rešava u korist centra." },
    });
    assert.equal(releaseDecision.status, 200);
    assert.equal((await json<{ status: string }>(releaseDecision)).status, "resolved_payout");
    const [releasedDisputeEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, onlineEnrollmentId));
    assert.equal(releasedDisputeEscrow?.status, "held", "A pre-deadline release decision must keep escrow held.");
    const releaseEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.enrollmentId, onlineEnrollmentId),
      eq(educationFinancialEventsTable.eventType, "dispute_release"),
    ));
    assert.equal(releaseEvents.length, 1, "Release decision must create one audit event.");
    const releaseLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.enrollmentId, onlineEnrollmentId),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    assert.equal(releaseLedger.length, 0, "A release decision must not pay before its deadline.");
    const ownerResolution = await request(baseUrl, `/admin/education/disputes/${onlineDisputeId}`, {
      method: "PATCH",
      cookie: centerOwnerCookie,
      body: { action: "reject", resolutionNote: "Vlasnik nije administrator." },
    });
    assert.equal(ownerResolution.status, 403);

    const refundDisputeId = await openDispute(refundEnrollmentId);
    const popularBeforeRefund = await request(baseUrl, "/education/public/popular?limit=12");
    assert.equal(popularBeforeRefund.status, 200);
    const refundCourseBefore = (await json<Array<{ id: string; availableSeats: number | null }>>(popularBeforeRefund))
      .find((course) => course.id === refundCourse!.id);
    assert.equal(refundCourseBefore?.availableSeats, 2, "The warmed public catalog must expose the reserved seat before refund.");
    const refundDecision = await request(baseUrl, `/admin/education/disputes/${refundDisputeId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { action: "refund", resolutionNote: "Refund odobren nakon provere." },
    });
    assert.equal(refundDecision.status, 200);
    assert.equal((await json<{ status: string }>(refundDecision)).status, "resolved_refund");
    const [refundedEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, refundEnrollmentId));
    const [refundedEnrollment] = await db.select().from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.id, refundEnrollmentId));
    assert.equal(refundedEscrow?.status, "refunded");
    assert.equal(refundedEnrollment?.status, "cancelled");
    assert.equal(refundedEnrollment?.paymentStatus, "refunded");
    const popularAfterRefund = await request(baseUrl, "/education/public/popular?limit=12");
    assert.equal(popularAfterRefund.status, 200);
    const refundCourseAfter = (await json<Array<{ id: string; availableSeats: number | null }>>(popularAfterRefund))
      .find((course) => course.id === refundCourse!.id);
    assert.equal(refundCourseAfter?.availableSeats, 3, "A refund must invalidate cached public capacity after releasing the seat.");
    const refundLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.enrollmentId, refundEnrollmentId),
      eq(educationLedgerEntriesTable.type, "refund"),
    ));
    assert.deepEqual(refundLedger.map((entry) => entry.amount), [-refundCourse!.price]);
    const refundEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.enrollmentId, refundEnrollmentId),
      eq(educationFinancialEventsTable.eventType, "dispute_refund"),
    ));
    assert.equal(refundEvents.length, 1, "Refund decision must create one audit event.");

    const rejectDisputeId = await openDispute(rejectEnrollmentId);
    const rejectDecision = await request(baseUrl, `/admin/education/disputes/${rejectDisputeId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { action: "reject", resolutionNote: "Spor je odbijen nakon provere." },
    });
    assert.equal(rejectDecision.status, 200);
    assert.equal((await json<{ status: string }>(rejectDecision)).status, "rejected");
    const [rejectedEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, rejectEnrollmentId));
    assert.equal(rejectedEscrow?.status, "held");
    const rejectEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.enrollmentId, rejectEnrollmentId),
      eq(educationFinancialEventsTable.eventType, "dispute_reject"),
    ));
    assert.equal(rejectEvents.length, 1, "Reject decision must create one audit event.");
    const rejectLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.enrollmentId, rejectEnrollmentId),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    assert.equal(rejectLedger.length, 0, "Reject decision must not create a payout.");

    const elapsedEscrowIds = [onlineEnrollmentId, liveEnrollmentId, rejectEnrollmentId];
    await db.update(educationEscrowsTable).set({
      releaseAt: new Date(Date.now() - 60 * 60 * 1000),
    }).where(inArray(educationEscrowsTable.enrollmentId, elapsedEscrowIds));
    const matureFinance = await request(baseUrl, `/admin/education/finance?centerId=${center.id}`, { cookie: adminCookie });
    assert.equal(matureFinance.status, 200);
    const matureFinanceBody = await json<{ escrows: Array<{ enrollmentId: string; status: string }> }>(matureFinance);
    for (const enrollmentId of elapsedEscrowIds) {
      assert.equal(
        matureFinanceBody.escrows.find((escrow) => escrow.enrollmentId === enrollmentId)?.status,
        "ready_for_payout",
        "Elapsed online/live protection windows must mature escrow into payout-ready status.",
      );
    }
    const releaseLedgerEntries = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, center.id),
      eq(educationLedgerEntriesTable.type, "release"),
    ));
    assert.equal(releaseLedgerEntries.length, 3, "Each elapsed escrow must receive exactly one release ledger entry.");
    const maturityEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.escrowId, releasedDisputeEscrow!.id),
      eq(educationFinancialEventsTable.eventType, "escrow_released"),
    ));
    assert.equal(maturityEvents.length, 1, "Maturing escrow must create one release audit event.");

    const netAmounts = await db.select({ netAmount: educationEscrowsTable.netAmount }).from(educationEscrowsTable)
      .where(inArray(educationEscrowsTable.enrollmentId, elapsedEscrowIds));
    const expectedNetPayout = netAmounts.reduce((total, row) => total + row.netAmount, 0);
    const firstPayout = await request(baseUrl, "/admin/education/payouts", {
      method: "POST",
      cookie: adminCookie,
      body: { centerId: center.id, reference: `net-${suffix}` },
    });
    assert.equal(firstPayout.status, 201, "Matured net escrow must be payable.");
    assert.equal((await json<{ amount: number }>(firstPayout)).amount, expectedNetPayout);
    const [afterNetPayoutEscrows] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, onlineEnrollmentId));
    assert.ok(afterNetPayoutEscrows?.netPaidAt);
    assert.equal(afterNetPayoutEscrows?.status, "ready_for_payout", "Net payout must leave reserve payable separately.");
    const netPayoutLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, center.id),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    assert.equal(netPayoutLedger.length, 3, "Normal payout must create one ledger entry per net escrow.");

    const netReplay = await request(baseUrl, "/admin/education/payouts", {
      method: "POST",
      cookie: adminCookie,
      body: { centerId: center.id, reference: `net-replay-${suffix}` },
    });
    assert.equal(netReplay.status, 409, "Replaying a completed net payout must be rejected.");
    const netReplayLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, center.id),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    assert.equal(netReplayLedger.length, netPayoutLedger.length, "Net payout replay must not duplicate ledger entries.");

    const reserveAmounts = await db.select({ reserveAmount: educationEscrowsTable.reserveAmount }).from(educationEscrowsTable)
      .where(inArray(educationEscrowsTable.enrollmentId, elapsedEscrowIds));
    const expectedReservePayout = reserveAmounts.reduce((total, row) => total + row.reserveAmount, 0);
    const reservePayout = await withQuarterEnd(async () => {
      const quarterAdminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
      return request(baseUrl, "/admin/education/payouts", {
        method: "POST",
        cookie: quarterAdminCookie,
        body: { centerId: center.id, includeReserve: true, reference: `reserve-${suffix}` },
      });
    });
    assert.equal(reservePayout.status, 201, "Quarter-end reserve payout must release each unpaid reserve.");
    assert.equal((await json<{ amount: number }>(reservePayout)).amount, expectedReservePayout);
    const paidOutEscrows = await db.select().from(educationEscrowsTable)
      .where(inArray(educationEscrowsTable.enrollmentId, elapsedEscrowIds));
    assert.ok(paidOutEscrows.every((escrow) => escrow.status === "paid_out" && escrow.reservePaidAt), "Quarterly reserve payout must close each escrow.");
    const allPayoutLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, center.id),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    assert.equal(allPayoutLedger.length, 6, "Net and reserve payouts must create exactly one entry for each component.");

    const reserveReplay = await withQuarterEnd(async () => {
      const quarterAdminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
      return request(baseUrl, "/admin/education/payouts", {
        method: "POST",
        cookie: quarterAdminCookie,
        body: { centerId: center.id, includeReserve: true, reference: `reserve-replay-${suffix}` },
      });
    });
    assert.equal(reserveReplay.status, 409, "Replaying a completed reserve payout must be rejected.");
    const replayPayouts = await db.select().from(educationPayoutsTable).where(eq(educationPayoutsTable.centerId, center.id));
    assert.equal(replayPayouts.length, 2, "Idempotent payout replays must not create a second payout record.");
    const replayLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, center.id),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    assert.equal(replayLedger.length, allPayoutLedger.length, "Reserve replay must not duplicate financial entries.");

    const maturityRaceEnrollmentId = await enrollAndSettle(maturityRaceCourse.id, `maturity-race-${suffix}`);
    const [maturityRaceEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, maturityRaceEnrollmentId));
    assert.ok(maturityRaceEscrow);
    await db.update(educationEscrowsTable).set({
      status: "held",
      releaseAt: sql`now() - interval '1 minute'`,
    }).where(eq(educationEscrowsTable.id, maturityRaceEscrow.id));

    const raceLockKey = `education-center:${payoutRaceCenter.id}`;
    let payoutRaceLockAcquired!: () => void;
    const payoutRaceLockAcquiredPromise = new Promise<void>((resolve) => { payoutRaceLockAcquired = resolve; });
    const raceLockReleasedPromise = new Promise<void>((resolve) => { releaseRaceLock = resolve; });
    raceLockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${raceLockKey}))`);
      payoutRaceLockAcquired();
      await raceLockReleasedPromise;
    });
    await payoutRaceLockAcquiredPromise;

    const maturityRefreshRequest = request(baseUrl, `/admin/education/finance?centerId=${payoutRaceCenter.id}`, {
      cookie: adminCookie,
    });
    await waitForAdvisoryLockWaiters(raceLockKey, 1);
    const maturityDisputeRequest = request(baseUrl, `/education/purchases/${maturityRaceEnrollmentId}/disputes`, {
      method: "POST",
      cookie: buyerCookie,
      body: { reason: "Dospeće i spor u isto vreme", details: "Provera zaštite granice roka." },
    });
    await waitForAdvisoryLockWaiters(raceLockKey, 2);
    const releaseMaturityRaceLock = releaseRaceLock as (() => void) | undefined;
    if (!releaseMaturityRaceLock) throw new Error("The maturity race lock must be releasable after both requests are queued.");
    releaseMaturityRaceLock();
    await raceLockHolder;
    raceLockHolder = undefined;
    releaseRaceLock = undefined;

    const [maturityRefreshResponse, maturityDisputeResponse] = await Promise.all([maturityRefreshRequest, maturityDisputeRequest]);
    assert.equal(maturityRefreshResponse.status, 200, "The queued maturity refresh must complete.");
    assert.equal(maturityDisputeResponse.status, 409, "A dispute queued behind maturity must fail after the protection deadline.");
    assert.match((await json<{ error: string }>(maturityDisputeResponse)).error, /istekao/, "The losing dispute must observe the matured escrow.");
    const [maturityResultEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.id, maturityRaceEscrow.id));
    assert.equal(maturityResultEscrow?.status, "ready_for_payout", "Maturity must leave the escrow payout-ready.");
    assert.equal(maturityResultEscrow?.netPaidAt, null);
    assert.equal(maturityResultEscrow?.reservePaidAt, null);
    const maturityReleaseLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.escrowId, maturityRaceEscrow.id),
      eq(educationLedgerEntriesTable.type, "release"),
    ));
    assert.equal(maturityReleaseLedger.length, 1, "Maturity must create exactly one release ledger entry.");
    const maturityRefundLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.escrowId, maturityRaceEscrow.id),
      eq(educationLedgerEntriesTable.type, "refund"),
    ));
    assert.equal(maturityRefundLedger.length, 0, "The losing dispute must not create a refund ledger entry.");
    const maturityDisputes = await db.select().from(educationDisputesTable)
      .where(eq(educationDisputesTable.enrollmentId, maturityRaceEnrollmentId));
    assert.equal(maturityDisputes.length, 0, "The losing dispute must not create a dispute record.");
    const maturityRaceEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.escrowId, maturityRaceEscrow.id),
      inArray(educationFinancialEventsTable.eventType, ["escrow_released", "dispute_opened"]),
    ));
    assert.equal(maturityRaceEvents.length, 1, "The race must create exactly one escrow transition audit event.");
    assert.equal(maturityRaceEvents[0]?.eventType, "escrow_released");
    assert.equal(maturityRaceEvents[0]?.previousStatus, "held");
    assert.equal(maturityRaceEvents[0]?.nextStatus, "ready_for_payout");

    const payoutRaceEnrollmentId = await enrollAndSettle(payoutRaceCourse.id, `payout-race-${suffix}`);
    const disputeRaceEnrollmentId = await enrollAndSettle(disputeRaceCourse.id, `dispute-race-${suffix}`);
    const [payoutRaceEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, payoutRaceEnrollmentId));
    const [disputeRaceEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, disputeRaceEnrollmentId));
    assert.ok(payoutRaceEscrow);
    assert.ok(disputeRaceEscrow);
    await db.update(educationEscrowsTable).set({
      status: "ready_for_payout",
      releaseAt: sql`now() - interval '1 minute'`,
    }).where(eq(educationEscrowsTable.id, payoutRaceEscrow.id));
    await db.update(educationEscrowsTable).set({
      status: "held",
      releaseAt: sql`now() + interval '1 day'`,
    }).where(eq(educationEscrowsTable.id, disputeRaceEscrow.id));

    let raceLockAcquired!: () => void;
    const raceLockAcquiredPromise = new Promise<void>((resolve) => { raceLockAcquired = resolve; });
    const payoutRaceLockReleasedPromise = new Promise<void>((resolve) => { releaseRaceLock = resolve; });
    raceLockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${raceLockKey}))`);
      raceLockAcquired();
      await payoutRaceLockReleasedPromise;
    });
    await raceLockAcquiredPromise;

    const disputeRaceRequest = request(baseUrl, `/education/purchases/${disputeRaceEnrollmentId}/disputes`, {
      method: "POST",
      cookie: buyerCookie,
      body: { reason: "Konkurentni payout i dispute", details: "Provera redosleda operacija na granici roka." },
    });
    await waitForAdvisoryLockWaiters(raceLockKey, 1);
    const payoutRaceRequest = request(baseUrl, "/admin/education/payouts", {
      method: "POST",
      cookie: adminCookie,
      body: { centerId: payoutRaceCenter.id, reference: `race-payout-${suffix}` },
    });
    await waitForAdvisoryLockWaiters(raceLockKey, 2);
    const releaseContendedLock = releaseRaceLock as (() => void) | undefined;
    if (!releaseContendedLock) throw new Error("The test lock must be releasable after both requests are queued.");
    releaseContendedLock();
    await raceLockHolder;
    raceLockHolder = undefined;
    releaseRaceLock = undefined;

    const [disputeRaceResponse, payoutRaceResponse] = await Promise.all([disputeRaceRequest, payoutRaceRequest]);
    assert.equal(disputeRaceResponse.status, 201, "The dispute queued first at the financial lock must win the concurrent request race.");
    assert.equal(payoutRaceResponse.status, 409, "The payout queued behind the dispute must fail after the center becomes disputed.");
    assert.match((await json<{ error: string }>(payoutRaceResponse)).error, /otvoren spor/, "The losing payout must observe the concurrent dispute state.");
    const [payoutResultEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.id, payoutRaceEscrow.id));
    const [disputeResultEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.id, disputeRaceEscrow.id));
    assert.equal(payoutResultEscrow?.status, "ready_for_payout", "The blocked payout must leave its escrow payable and unpaid.");
    assert.equal(payoutResultEscrow?.netPaidAt, null);
    assert.equal(payoutResultEscrow?.reservePaidAt, null);
    assert.equal(disputeResultEscrow?.status, "frozen", "The winning dispute must freeze only its own escrow.");
    assert.equal(disputeResultEscrow?.netPaidAt, null);
    assert.equal(disputeResultEscrow?.reservePaidAt, null);
    const racePayoutRows = await db.select().from(educationPayoutsTable)
      .where(eq(educationPayoutsTable.centerId, payoutRaceCenter.id));
    const racePayoutLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, payoutRaceCenter.id),
      eq(educationLedgerEntriesTable.type, "payout"),
    ));
    const raceRefundLedger = await db.select().from(educationLedgerEntriesTable).where(and(
      eq(educationLedgerEntriesTable.centerId, payoutRaceCenter.id),
      eq(educationLedgerEntriesTable.type, "refund"),
    ));
    const raceDisputes = await db.select().from(educationDisputesTable)
      .where(eq(educationDisputesTable.enrollmentId, disputeRaceEnrollmentId));
    const raceEvents = await db.select().from(educationFinancialEventsTable)
      .where(eq(educationFinancialEventsTable.escrowId, disputeRaceEscrow.id));
    assert.equal(racePayoutRows.length, 0, "The losing payout must not create a payout record.");
    assert.equal(racePayoutLedger.length, 0, "The losing payout must not create a payout ledger entry.");
    assert.equal(raceRefundLedger.length, 0, "The race must not create a refund ledger entry.");
    assert.equal(raceDisputes.length, 1, "The winning dispute must create exactly one dispute.");
    assert.equal(raceDisputes[0]?.status, "open");
    assert.equal(raceEvents.filter((event) => event.eventType === "dispute_opened").length, 1, "The winning dispute must create exactly one audit event.");
    assert.equal(raceEvents.find((event) => event.eventType === "dispute_opened")?.previousStatus, "held");
    assert.equal(raceEvents.find((event) => event.eventType === "dispute_opened")?.nextStatus, "frozen");

    const duplicateDisputeEnrollmentId = await enrollAndSettle(duplicateDisputeCourse.id, `duplicate-dispute-${suffix}`);
    const [duplicateDisputeEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.enrollmentId, duplicateDisputeEnrollmentId));
    assert.ok(duplicateDisputeEscrow);
    await db.update(educationEscrowsTable).set({
      status: "held",
      releaseAt: sql`now() + interval '1 minute'`,
    }).where(eq(educationEscrowsTable.id, duplicateDisputeEscrow.id));

    let duplicateDisputeLockAcquired!: () => void;
    const duplicateDisputeLockAcquiredPromise = new Promise<void>((resolve) => { duplicateDisputeLockAcquired = resolve; });
    const duplicateDisputeLockReleasedPromise = new Promise<void>((resolve) => { releaseRaceLock = resolve; });
    raceLockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${raceLockKey}))`);
      duplicateDisputeLockAcquired();
      await duplicateDisputeLockReleasedPromise;
    });
    await duplicateDisputeLockAcquiredPromise;

    const duplicateDisputeBody = {
      reason: "Ponovljen zahtev pri isteku roka",
      details: "Kupac je slučajno poslao zahtev dva puta.",
    };
    const firstDuplicateDisputeRequest = request(baseUrl, `/education/purchases/${duplicateDisputeEnrollmentId}/disputes`, {
      method: "POST",
      cookie: buyerCookie,
      body: duplicateDisputeBody,
    });
    await waitForAdvisoryLockWaiters(raceLockKey, 1);
    const secondDuplicateDisputeRequest = request(baseUrl, `/education/purchases/${duplicateDisputeEnrollmentId}/disputes`, {
      method: "POST",
      cookie: buyerCookie,
      body: duplicateDisputeBody,
    });
    await waitForAdvisoryLockWaiters(raceLockKey, 2);
    const releaseDuplicateDisputeLock = releaseRaceLock as (() => void) | undefined;
    if (!releaseDuplicateDisputeLock) throw new Error("The duplicate-dispute lock must be releasable after both requests are queued.");
    releaseDuplicateDisputeLock();
    await raceLockHolder;
    raceLockHolder = undefined;
    releaseRaceLock = undefined;

    const [firstDuplicateDisputeResponse, secondDuplicateDisputeResponse] = await Promise.all([
      firstDuplicateDisputeRequest,
      secondDuplicateDisputeRequest,
    ]);
    assert.equal(firstDuplicateDisputeResponse.status, 201, "The first concurrent dispute submission must succeed.");
    assert.equal(secondDuplicateDisputeResponse.status, 409, "The duplicate concurrent dispute submission must return a conflict.");
    const secondDuplicateDisputeError = await json<{
      error: string;
      dispute: { id: string; enrollmentId: string; reason: string; details: string; status: string; createdAt: string };
    }>(secondDuplicateDisputeResponse);
    assert.match(secondDuplicateDisputeError.error, /već postoji otvoren spor/, "The losing submission must explain that the dispute already exists.");
    const firstDuplicateDispute = await json<{ id: string; status: string }>(firstDuplicateDisputeResponse);
    assert.equal(firstDuplicateDispute.status, "open");
    assert.equal(secondDuplicateDisputeError.dispute.id, firstDuplicateDispute.id, "The duplicate response must identify the existing dispute.");
    assert.equal(secondDuplicateDisputeError.dispute.enrollmentId, duplicateDisputeEnrollmentId);
    assert.equal(secondDuplicateDisputeError.dispute.reason, duplicateDisputeBody.reason);
    assert.equal(secondDuplicateDisputeError.dispute.details, duplicateDisputeBody.details);
    assert.equal(secondDuplicateDisputeError.dispute.status, "open");
    assert.ok(secondDuplicateDisputeError.dispute.createdAt);

    const repeatedDuplicateDisputeResponse = await request(baseUrl, `/education/purchases/${duplicateDisputeEnrollmentId}/disputes`, {
      method: "POST",
      cookie: buyerCookie,
      body: duplicateDisputeBody,
    });
    assert.equal(repeatedDuplicateDisputeResponse.status, 409, "A later retry must remain a conflict.");
    const repeatedDuplicateDispute = await json<{ dispute: { id: string; status: string } }>(repeatedDuplicateDisputeResponse);
    assert.equal(repeatedDuplicateDispute.dispute.id, firstDuplicateDispute.id, "Every retry must return the same dispute.");
    assert.equal(repeatedDuplicateDispute.dispute.status, "open");

    const duplicatePurchaseView = await request(baseUrl, "/education/purchases", { cookie: buyerCookie });
    assert.equal(duplicatePurchaseView.status, 200);
    const duplicatePurchase = (await json<Array<{
      id: string;
      dispute: { id: string; reason: string; details: string; status: string } | null;
    }>>(duplicatePurchaseView)).find((purchase) => purchase.id === duplicateDisputeEnrollmentId);
    assert.equal(duplicatePurchase?.dispute?.id, firstDuplicateDispute.id, "The purchase view must expose the active dispute after refresh.");
    assert.equal(duplicatePurchase?.dispute?.reason, duplicateDisputeBody.reason);
    assert.equal(duplicatePurchase?.dispute?.details, duplicateDisputeBody.details);
    assert.equal(duplicatePurchase?.dispute?.status, "open");

    const duplicateDisputes = await db.select().from(educationDisputesTable)
      .where(eq(educationDisputesTable.enrollmentId, duplicateDisputeEnrollmentId));
    assert.equal(duplicateDisputes.length, 1, "Concurrent submissions must create exactly one dispute.");
    assert.equal(duplicateDisputes[0]?.id, firstDuplicateDispute.id);
    assert.equal(duplicateDisputes[0]?.status, "open");
    const [duplicateDisputeResultEscrow] = await db.select().from(educationEscrowsTable)
      .where(eq(educationEscrowsTable.id, duplicateDisputeEscrow.id));
    assert.equal(duplicateDisputeResultEscrow?.status, "frozen", "The winning dispute must freeze escrow.");
    assert.ok(duplicateDisputeResultEscrow?.frozenAt);
    assert.equal(duplicateDisputeResultEscrow?.netPaidAt, null);
    assert.equal(duplicateDisputeResultEscrow?.reservePaidAt, null);
    const duplicateDisputeEvents = await db.select().from(educationFinancialEventsTable).where(and(
      eq(educationFinancialEventsTable.escrowId, duplicateDisputeEscrow.id),
      eq(educationFinancialEventsTable.eventType, "dispute_opened"),
    ));
    assert.equal(duplicateDisputeEvents.length, 1, "Concurrent submissions must create exactly one dispute-opened audit event.");
    assert.equal(duplicateDisputeEvents[0]?.previousStatus, "held");
    assert.equal(duplicateDisputeEvents[0]?.nextStatus, "frozen");

    console.log("Education financial release, dispute, payout, and concurrent-race regression passed.");
  } finally {
    releaseRaceLock?.();
    await raceLockHolder?.catch(() => undefined);
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    if (centerId) {
      await db.delete(educationPayoutsTable).where(eq(educationPayoutsTable.centerId, centerId));
    }
    if (enrollmentIds.length) {
      await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, enrollmentIds));
    }
    if (courseIds.length) {
      await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    }
    if (centerId) {
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    }
    for (const raceCenterId of raceCenterIds) {
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, raceCenterId));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, raceCenterId));
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