import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import {
  courseEnrollmentsTable, courseLessonsTable, courseModulesTable, courseSessionsTable, coursesTable, db,
  educationAttendanceTable,
  educationBookingGroupsTable, educationBookingParticipantsTable,
  educationCenterStaffTable, educationCentersTable, educationEducatorAbsencesTable, educationEducatorWeeklyAvailabilityTable, educationInstallmentsTable,
  educationEscrowsTable, educationFinancialEventsTable, educationLedgerEntriesTable, educationNotificationsTable, educationOutboxTable, educationPlatformSettingsTable, educationPriceSnapshotsTable, educationSessionEducatorsTable,
  referralQualificationEvidenceTable,
  sessionsTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { enqueueEducationReminderSweep, processEducationOutbox } from "./education-outbox";
import { releaseSeatAndPromoteWaiter } from "./education-sessions";

const suffix = randomUUID();
const ids: string[] = [];
const cookie = async (id: string) => `${sessionCookieName}=${await createSession(id)}`;
const get = (base: string, path: string, auth: string) => fetch(`${base}/api${path}`, { headers: { cookie: auth } });

async function cleanupFixtureUsers(userIds: string[]) {
  if (!userIds.length) return;
  const centers = await db.select({ id: educationCentersTable.id }).from(educationCentersTable).where(inArray(educationCentersTable.ownerId, userIds));
  const centerIds = centers.map((row) => row.id);
  if (centerIds.length) {
    const courses = await db.select({ id: coursesTable.id }).from(coursesTable).where(inArray(coursesTable.centerId, centerIds));
    const courseIds = courses.map((row) => row.id);
    if (courseIds.length) {
      const snapshots = await db.select({ id: educationPriceSnapshotsTable.id }).from(educationPriceSnapshotsTable).where(inArray(educationPriceSnapshotsTable.courseId, courseIds));
      const snapshotIds = snapshots.map((row) => row.id);
      if (snapshotIds.length) {
        await db.delete(educationInstallmentsTable).where(inArray(educationInstallmentsTable.priceSnapshotId, snapshotIds));
        await db.delete(educationPriceSnapshotsTable).where(inArray(educationPriceSnapshotsTable.id, snapshotIds));
      }
    }
    const staff = await db.select({ id: educationCenterStaffTable.id }).from(educationCenterStaffTable).where(inArray(educationCenterStaffTable.centerId, centerIds));
    if (staff.length) await db.delete(educationSessionEducatorsTable).where(inArray(educationSessionEducatorsTable.staffId, staff.map((row) => row.id)));
    await db.delete(educationOutboxTable).where(inArray(educationOutboxTable.centerId, centerIds));
    await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, centerIds));
  }
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
}

async function run() {
  await ensureBusinessGrowthSchema();
  const stale = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, "operational-%@example.test"));
  await cleanupFixtureUsers(stale.map((row) => row.id));
  let server: ReturnType<typeof app.listen> | undefined;
  let ipsSettingsRestore: {
    id: string;
    ipsRecipientName: string | null;
    ipsRecipientAccount: string | null;
    ipsPurpose: string | null;
    createdForTest: boolean;
  } | undefined;
  try {
    const roles = ["EDUKATIVNI_CENTAR", "SALON_EMPLOYEE", "SALON_EMPLOYEE", "JOBSEEKER", "JOBSEEKER", "JOBSEEKER", "JOBSEEKER", "SUPER_ADMIN"] as const;
    const users = await db.insert(usersTable).values(roles.map((role, index) => ({
      firstName: `Privacy${index}`, lastName: suffix.slice(0, 6), email: `operational-${index}-${suffix}@example.test`,
      passwordHash: "fixture", passwordSetAt: new Date(), role,
      phoneNormalized: index === 4 ? "38160111222" : null,
    }))).returning();
    ids.push(...users.map((u) => u.id));
    const [owner, manager, educator, purchaser, participantA, participantB, unrelated, admin] = users;
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner!.id, name: `Privacy center ${suffix}`, city: "Beograd", description: "test", imageUrl: "https://example.test/a.jpg",
    }).returning();
    const [otherCenter] = await db.insert(educationCentersTable).values({
      ownerId: unrelated!.id, name: `Other center ${suffix}`, city: "Novi Sad", description: "test", imageUrl: "https://example.test/b.jpg",
    }).returning();
    const staff = await db.insert(educationCenterStaffTable).values([
      { centerId: center!.id, userId: owner!.id, role: "owner_admin" },
      { centerId: center!.id, userId: manager!.id, role: "manager_reception" },
      { centerId: center!.id, userId: educator!.id, role: "educator" },
    ]).returning();
    const [course] = await db.insert(coursesTable).values({
      centerId: center!.id, title: `Privacy course ${suffix}`, category: "Test", format: "in-person",
      price: 10_000, duration: "2h", imageUrl: "https://example.test/course.jpg", installmentCount: 2, certification: true,
    }).returning();
    const startsAt = new Date(Date.now() + 2 * 3_600_000);
    const [session] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity: 10, reservedSeats: 2,
    }).returning();
    await db.insert(educationSessionEducatorsTable).values({ sessionId: session!.id, staffId: staff[2]!.id, assignedByUserId: owner!.id });
    const [group] = await db.insert(educationBookingGroupsTable).values({
      centerId: center!.id, courseId: course!.id, sessionId: session!.id, purchaserId: purchaser!.id,
      createdByUserId: owner!.id, idempotencyKey: `fixture-${suffix}`, requestFingerprint: "f".repeat(64), status: "pending",
    }).returning();
    const participants = await db.insert(educationBookingParticipantsTable).values([
      { bookingGroupId: group!.id, userId: participantA!.id, fullName: "Participant Alpha Secret", email: `alpha-${suffix}@secret.test`, phone: "38160111222" },
      { bookingGroupId: group!.id, userId: participantB!.id, fullName: "Participant Beta Secret", email: `beta-${suffix}@secret.test`, phone: "38160333444" },
    ]).returning();
    const [snapshot] = await db.insert(educationPriceSnapshotsTable).values({
      bookingGroupId: group!.id, courseId: course!.id, grossAmount: 10_000, platformFee: 1_500,
      reserveAmount: 1_000, netAmount: 7_500, installmentCount: 2, depositDisposition: "refund",
    }).returning();
    const installments = await db.insert(educationInstallmentsTable).values([
      { priceSnapshotId: snapshot!.id, installmentNumber: 1, amount: 5_000, paymentReference: `OPA-${suffix.slice(0, 30)}` },
      { priceSnapshotId: snapshot!.id, installmentNumber: 2, amount: 5_000, paymentReference: `OPB-${suffix.slice(0, 30)}` },
    ]).returning();
    await db.insert(courseEnrollmentsTable).values(participants.map((p) => ({
      courseId: course!.id, userId: p.userId, purchaserId: purchaser!.id, sessionId: session!.id,
      bookingGroupId: group!.id, participantId: p.id, status: "pending" as const, paymentStatus: "pending" as const, chargedAmount: 5_000,
    })));

    server = app.listen(0);
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookies = await Promise.all(users.map((u) => cookie(u.id)));

    // Payment instructions belong to the purchaser and center staff, not to a
    // named learner. Preserve the singleton's prior IPS values for isolation.
    const [priorIpsSettings] = await db.select().from(educationPlatformSettingsTable)
      .orderBy(educationPlatformSettingsTable.createdAt).limit(1);
    const [ipsSettings] = priorIpsSettings
      ? await db.update(educationPlatformSettingsTable).set({
        ipsRecipientName: "Education Platform Test",
        ipsRecipientAccount: "840000000000000000",
        ipsPurpose: "Course installment",
      }).where(eq(educationPlatformSettingsTable.id, priorIpsSettings.id)).returning()
      : await db.insert(educationPlatformSettingsTable).values({
        ipsRecipientName: "Education Platform Test",
        ipsRecipientAccount: "840000000000000000",
        ipsPurpose: "Course installment",
      }).returning();
    ipsSettingsRestore = {
      id: ipsSettings!.id,
      ipsRecipientName: priorIpsSettings?.ipsRecipientName ?? null,
      ipsRecipientAccount: priorIpsSettings?.ipsRecipientAccount ?? null,
      ipsPurpose: priorIpsSettings?.ipsPurpose ?? null,
      createdForTest: !priorIpsSettings,
    };
    const paymentPlanPath = `/education/operations/bookings/${group!.id}/payment-plan`;
    const ipsQrPath = `/education/operations/bookings/${group!.id}/installments/1/ips-qr`;
    const purchaserPlanResponse = await get(base, paymentPlanPath, cookies[3]!);
    assert.equal(purchaserPlanResponse.status, 200);
    const purchaserPlan = await purchaserPlanResponse.json() as {
      bookingGroupId: string;
      installments: Array<{ installmentNumber: number; paymentReference: string }>;
    };
    assert.equal(purchaserPlan.bookingGroupId, group!.id);
    assert.deepEqual(purchaserPlan.installments.map((row) => row.installmentNumber), [1, 2]);
    assert.equal(purchaserPlan.installments[0]!.paymentReference, installments[0]!.paymentReference);
    assert.equal((await get(base, ipsQrPath, cookies[3]!)).status, 200);

    const assertPrivatePaymentDenial = async (auth: string) => {
      for (const path of [paymentPlanPath, ipsQrPath]) {
        const response = await get(base, path, auth);
        assert.equal(response.status, 404);
        const denial = await response.json() as Record<string, unknown>;
        assert.deepEqual(Object.keys(denial), ["error"], "Private payment denial must not expose payment fields.");
        const serialized = JSON.stringify(denial);
        assert.ok(!serialized.includes(installments[0]!.paymentReference));
        assert.ok(!serialized.includes(participants[0]!.email!));
      }
    };
    // participantA is a named learner in this group, but is not its purchaser.
    await assertPrivatePaymentDenial(cookies[4]!);
    await assertPrivatePaymentDenial(cookies[6]!);
    // Educators retain teaching and attendance permissions, but operational
    // payment instructions are restricted to financial-management roles.
    await assertPrivatePaymentDenial(cookies[2]!);

    // Owner/admin, manager/reception, and SUPER_ADMIN (mapped to owner_admin)
    // retain access to operational financial views.
    for (const staffOrAdminCookie of [cookies[0]!, cookies[1]!, cookies[7]!]) {
      const staffPlan = await get(base, paymentPlanPath, staffOrAdminCookie);
      assert.equal(staffPlan.status, 200);
      assert.equal((await staffPlan.json() as { bookingGroupId: string }).bookingGroupId, group!.id);
      assert.equal((await get(base, ipsQrPath, staffOrAdminCookie)).status, 200);
    }

    // Recurrence uses grid starts as alternatives and packs only fixed,
    // non-overlapping occurrences. These dates are ordinary winter weekdays
    // in Europe/Belgrade, safely away from either DST transition.
    const [recurrenceCourse] = await db.insert(coursesTable).values({
      centerId: center!.id,
      title: `Recurrence course ${suffix}`,
      category: "Test",
      format: "in-person",
      price: 12_000,
      duration: "1h",
      imageUrl: "https://example.test/recurrence.jpg",
      schedulingMode: "individual_calendar",
      published: true,
      archived: false,
    }).returning();
    await db.insert(educationEducatorWeeklyAvailabilityTable).values(
      [1, 2, 3, 4, 5].map((weekday) => ({
        staffId: staff[2]!.id, weekday, startTime: "09:00", endTime: "12:00",
      })),
    );
    type RecurrencePreview = {
      candidates: Array<{ date: string; startTime: string; endTime: string }>;
      skippedAbsenceCount: number;
      skippedConflictCount: number;
    };
    type RecurrenceCommit = { sessionIds: string[]; replayed: boolean };
    const recurrenceRequest = async (
      action: "preview" | "commit",
      body: Record<string, unknown>,
      key?: string,
    ) => fetch(`${base}/api/education/operations/courses/${recurrenceCourse!.id}/recurrence/${action}`, {
      method: "POST",
      headers: {
        cookie: cookies[0]!,
        "content-type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
    });
    const baseRecurrence = (date: string, weekday: number, durationMinutes: number) => ({
      educatorStaffId: staff[2]!.id,
      weekdays: [weekday],
      startTime: "09:00",
      endTime: "12:00",
      durationMinutes,
      startDate: date,
      endDate: date,
      capacity: 4,
    });
    const loadAssigned = async (sessionIds: string[]) => {
      if (!sessionIds.length) return [];
      return db.select({
        id: courseSessionsTable.id,
        startsAt: courseSessionsTable.startsAt,
        endsAt: courseSessionsTable.endsAt,
      }).from(courseSessionsTable)
        .innerJoin(educationSessionEducatorsTable, eq(educationSessionEducatorsTable.sessionId, courseSessionsTable.id))
        .where(inArray(courseSessionsTable.id, sessionIds));
    };
    const assertNoOverlaps = (rows: Array<{ startsAt: Date; endsAt: Date }>) => {
      const ordered = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      for (let index = 1; index < ordered.length; index++) {
        assert.ok(ordered[index - 1]!.endsAt <= ordered[index]!.startsAt, "Assigned recurrence sessions must not overlap.");
      }
    };
    const pendingAdvisoryLocks = async () => {
      const rows = (await db.execute(sql`
        select count(*)::int as count
        from pg_locks
        where locktype = 'advisory' and granted = false
      `)).rows as Array<{ count: number }>;
      return Number(rows[0]?.count ?? 0);
    };
    const waitForAdvisoryWaiters = async (minimum: number) => {
      for (let attempt = 0; attempt < 250; attempt++) {
        if (await pendingAdvisoryLocks() >= minimum) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`Expected at least ${minimum} waiting advisory locks.`);
    };
    const underCenterScheduleBarrier = async (startRequest: () => Promise<Response>) => {
      const baseline = await pendingAdvisoryLocks();
      let release!: () => void;
      let ready!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      const acquired = new Promise<void>((resolve) => { ready = resolve; });
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education:schedule:center:${center!.id}`}))`);
        ready();
        await released;
      });
      await acquired;
      const response = startRequest();
      try {
        await waitForAdvisoryWaiters(baseline + 1);
      } finally {
        release();
        await holder;
      }
      return response;
    };
    const availabilityPath = `/education/operations/centers/${center!.id}/educators/${staff[2]!.id}/weekly-availability`;
    const createdAvailabilityResponse = await underCenterScheduleBarrier(() => fetch(`${base}/api${availabilityPath}`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ weekday: 6, startTime: "13:00", endTime: "15:00" }),
    }));
    assert.equal(createdAvailabilityResponse.status, 201);
    const createdAvailability = await createdAvailabilityResponse.json() as { id: string; startTime: string; endTime: string };
    assert.equal(createdAvailability.startTime, "13:00");
    const patchedAvailabilityResponse = await underCenterScheduleBarrier(() => fetch(`${base}/api${availabilityPath}/${createdAvailability.id}`, {
      method: "PATCH", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ weekday: 6, startTime: "14:00", endTime: "16:00" }),
    }));
    assert.equal(patchedAvailabilityResponse.status, 200);
    assert.equal((await patchedAvailabilityResponse.json() as { startTime: string }).startTime, "14:00");
    assert.equal((await underCenterScheduleBarrier(() => fetch(`${base}/api${availabilityPath}/${createdAvailability.id}`, {
      method: "DELETE", headers: { cookie: cookies[0]! },
    }))).status, 204);

    const absencePath = `/education/operations/centers/${center!.id}/educators/${staff[2]!.id}/absences`;
    const createdAbsenceResponse = await underCenterScheduleBarrier(() => fetch(`${base}/api${absencePath}`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2027-03-01", endDate: "2027-03-01", startTime: "13:00", endTime: "15:00", reason: "Test" }),
    }));
    assert.equal(createdAbsenceResponse.status, 201);
    const createdAbsence = await createdAbsenceResponse.json() as { id: string; startTime: string | null };
    const patchedAbsenceResponse = await underCenterScheduleBarrier(() => fetch(`${base}/api${absencePath}/${createdAbsence.id}`, {
      method: "PATCH", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2027-03-01", endDate: "2027-03-01", startTime: "14:00", endTime: "16:00", reason: "Updated" }),
    }));
    assert.equal(patchedAbsenceResponse.status, 200);
    assert.equal((await patchedAbsenceResponse.json() as { startTime: string | null }).startTime, "14:00");
    assert.equal((await underCenterScheduleBarrier(() => fetch(`${base}/api${absencePath}/${createdAbsence.id}`, {
      method: "DELETE", headers: { cookie: cookies[0]! },
    }))).status, 204);

    // Queue absence first behind the shared center lock, then recurrence. Once
    // released, PostgreSQL waiter ordering makes the absence visible before the
    // commit performs its canonical reads inside the locked transaction.
    const raceBaseline = await pendingAdvisoryLocks();
    let releaseRaceLock!: () => void;
    let raceLockReady!: () => void;
    const raceRelease = new Promise<void>((resolve) => { releaseRaceLock = resolve; });
    const raceReady = new Promise<void>((resolve) => { raceLockReady = resolve; });
    const raceHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education:schedule:center:${center!.id}`}))`);
      raceLockReady();
      await raceRelease;
    });
    await raceReady;
    const raceDate = "2027-02-08";
    const raceAbsencePromise = fetch(`${base}/api${absencePath}`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ startDate: raceDate, endDate: raceDate, startTime: "09:00", endTime: "12:00", reason: "Concurrent absence" }),
    });
    let raceRecurrencePromise!: Promise<Response>;
    try {
      await waitForAdvisoryWaiters(raceBaseline + 1);
      raceRecurrencePromise = recurrenceRequest("commit", baseRecurrence(raceDate, 1, 60), `recurrence-absence-race-${suffix}`);
      await waitForAdvisoryWaiters(raceBaseline + 2);
    } finally {
      releaseRaceLock();
      await raceHolder;
    }
    const [raceAbsenceResponse, raceRecurrenceResponse] = await Promise.all([raceAbsencePromise, raceRecurrencePromise]);
    assert.equal(raceAbsenceResponse.status, 201);
    const raceAbsence = await raceAbsenceResponse.json() as { id: string };
    assert.equal(raceRecurrenceResponse.status, 201);
    const raceRecurrence = await raceRecurrenceResponse.json() as RecurrenceCommit;
    assert.deepEqual(raceRecurrence.sessionIds, []);
    const persistedRaceAbsence = (await db.select().from(educationEducatorAbsencesTable)
      .where(eq(educationEducatorAbsencesTable.id, raceAbsence.id)))[0]!;
    assert.equal(persistedRaceAbsence.startDate, raceDate);
    assert.equal((await loadAssigned(raceRecurrence.sessionIds)).length, 0);

    const hourlyBody = baseRecurrence("2027-02-01", 1, 60);
    const hourlyPreviewResponse = await recurrenceRequest("preview", hourlyBody);
    assert.equal(hourlyPreviewResponse.status, 200);
    const hourlyPreview = await hourlyPreviewResponse.json() as RecurrencePreview;
    assert.deepEqual(hourlyPreview.candidates.map((row) => row.startTime), ["09:00", "10:00", "11:00"]);
    const hourlyCommitResponse = await recurrenceRequest("commit", hourlyBody, `recurrence-hourly-${suffix}`);
    assert.equal(hourlyCommitResponse.status, 201);
    const hourlyCommit = await hourlyCommitResponse.json() as RecurrenceCommit;
    assert.equal(hourlyCommit.sessionIds.length, 3);
    assertNoOverlaps(await loadAssigned(hourlyCommit.sessionIds));

    const fiftyMinuteBody = baseRecurrence("2027-02-02", 2, 50);
    const fiftyPreviewResponse = await recurrenceRequest("preview", fiftyMinuteBody);
    assert.equal(fiftyPreviewResponse.status, 200);
    const fiftyPreview = await fiftyPreviewResponse.json() as RecurrencePreview;
    assert.deepEqual(fiftyPreview.candidates.map((row) => row.startTime), ["09:00", "10:00", "11:00"]);
    assert.deepEqual(fiftyPreview.candidates.map((row) => row.endTime), ["09:50", "10:50", "11:50"]);
    const fiftyCommitResponse = await recurrenceRequest("commit", fiftyMinuteBody, `recurrence-fifty-${suffix}`);
    assert.equal(fiftyCommitResponse.status, 201);
    const fiftyCommit = await fiftyCommitResponse.json() as RecurrenceCommit;
    assert.equal(fiftyCommit.sessionIds.length, 3);
    assertNoOverlaps(await loadAssigned(fiftyCommit.sessionIds));

    const conflictStartsAt = new Date("2027-02-03T09:00:00.000Z"); // 10:00 Europe/Belgrade
    const [existingConflict] = await db.insert(courseSessionsTable).values({
      courseId: recurrenceCourse!.id,
      startsAt: conflictStartsAt,
      endsAt: new Date("2027-02-03T10:00:00.000Z"),
      capacity: 1,
    }).returning();
    await db.insert(educationSessionEducatorsTable).values({
      sessionId: existingConflict!.id,
      staffId: staff[2]!.id,
      assignedByUserId: owner!.id,
    });
    const conflictBody = baseRecurrence("2027-02-03", 3, 60);
    const conflictPreviewResponse = await recurrenceRequest("preview", conflictBody);
    assert.equal(conflictPreviewResponse.status, 200);
    const conflictPreview = await conflictPreviewResponse.json() as RecurrencePreview;
    assert.deepEqual(conflictPreview.candidates.map((row) => row.startTime), ["09:00", "11:00"]);
    assert.equal(conflictPreview.skippedConflictCount, 1);
    const conflictCommitResponse = await recurrenceRequest("commit", conflictBody, `recurrence-conflict-${suffix}`);
    assert.equal(conflictCommitResponse.status, 201);
    const conflictCommit = await conflictCommitResponse.json() as RecurrenceCommit;
    assert.equal(conflictCommit.sessionIds.length, 2);
    assertNoOverlaps(await loadAssigned([existingConflict!.id, ...conflictCommit.sessionIds]));

    const concurrentBody = baseRecurrence("2027-02-04", 4, 60);
    const concurrentResponses = await Promise.all([
      recurrenceRequest("commit", concurrentBody, `recurrence-concurrent-a-${suffix}`),
      recurrenceRequest("commit", concurrentBody, `recurrence-concurrent-b-${suffix}`),
    ]);
    assert.ok(concurrentResponses.every((response) => response.status === 201 || response.status === 409));
    const concurrentIds: string[] = [];
    for (const response of concurrentResponses) {
      if (response.status === 201) concurrentIds.push(...((await response.json() as RecurrenceCommit).sessionIds));
    }
    const concurrentRows = await loadAssigned(concurrentIds);
    assertNoOverlaps(concurrentRows);
    assert.equal(new Set(concurrentRows.map((row) => `${row.startsAt.toISOString()}/${row.endsAt.toISOString()}`)).size, concurrentRows.length);

    const replayBody = baseRecurrence("2027-02-05", 5, 60);
    const replayKey = `recurrence-replay-${suffix}`;
    const firstReplayResponse = await recurrenceRequest("commit", replayBody, replayKey);
    assert.equal(firstReplayResponse.status, 201);
    const firstReplay = await firstReplayResponse.json() as RecurrenceCommit;
    const secondReplayResponse = await recurrenceRequest("commit", replayBody, replayKey);
    assert.equal(secondReplayResponse.status, 201);
    const secondReplay = await secondReplayResponse.json() as RecurrenceCommit;
    assert.equal(secondReplay.replayed, true);
    assert.deepEqual(secondReplay.sessionIds, firstReplay.sessionIds);
    const mismatchResponse = await recurrenceRequest("commit", { ...replayBody, capacity: 5 }, replayKey);
    assert.equal(mismatchResponse.status, 409);

    // The booking command, rather than public availability, is authoritative.
    // Derive both boundary timestamps from PostgreSQL's clock to avoid a JS/DB
    // clock race; each rejected request must leave every commercial table clean.
    const clockRows = (await db.execute(sql`select now() as now`)).rows as Array<{ now: Date }>;
    const dbNow = new Date(clockRows[0]!.now);
    const [pastSession, exactSession, futureControlSession] = await db.insert(courseSessionsTable).values([
      { courseId: course!.id, startsAt: new Date(dbNow.getTime() - 60_000), endsAt: new Date(dbNow.getTime() + 3_540_000), capacity: 3 },
      { courseId: course!.id, startsAt: dbNow, endsAt: new Date(dbNow.getTime() + 3_600_000), capacity: 3 },
      { courseId: course!.id, startsAt: new Date(dbNow.getTime() + 86_400_000), endsAt: new Date(dbNow.getTime() + 90_000_000), capacity: 3 },
    ]).returning();
    const commercialCounts = async () => Promise.all([
      db.select().from(educationBookingGroupsTable), db.select().from(educationBookingParticipantsTable),
      db.select().from(educationPriceSnapshotsTable), db.select().from(educationInstallmentsTable),
      db.select().from(courseEnrollmentsTable), db.select().from(educationEscrowsTable),
      db.select().from(educationLedgerEntriesTable), db.select().from(educationOutboxTable),
    ]).then((tables) => tables.map((rows) => rows.length));
    for (const [index, rejected] of [pastSession!, exactSession!].entries()) {
      const before = await commercialCounts();
      const rejectedBooking = await fetch(`${base}/api/education/operations/bookings`, {
        method: "POST", headers: { cookie: index ? cookies[0]! : cookies[3]!, "content-type": "application/json", "Idempotency-Key": `started-${index}-${suffix}` },
        body: JSON.stringify({ courseId: course!.id, sessionId: rejected.id, participants: [{ fullName: "Boundary learner", email: purchaser!.email }] }),
      });
      assert.equal(rejectedBooking.status, 409);
      assert.deepEqual(await commercialCounts(), before);
    }
    const futureBooking = await fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `future-control-${suffix}` },
      body: JSON.stringify({ courseId: course!.id, sessionId: futureControlSession!.id, participants: [{ fullName: "Future learner", email: purchaser!.email }] }),
    });
    assert.equal(futureBooking.status, 201);
    const attendanceStart = new Date(dbNow.getTime() - 7_200_000);
    const [settlementCompletionSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: attendanceStart, endsAt: new Date(dbNow.getTime() - 3_600_000), capacity: 1, reservedSeats: 1,
    }).returning();
    const [settlementCompletionGroup] = await db.insert(educationBookingGroupsTable).values({
      centerId: center!.id, courseId: course!.id, sessionId: settlementCompletionSession!.id, purchaserId: purchaser!.id,
      createdByUserId: purchaser!.id, idempotencyKey: `settlement-completion-${suffix}`, requestFingerprint: "c".repeat(64), status: "active",
    }).returning();
    const [settlementCompletionParticipant] = await db.insert(educationBookingParticipantsTable).values({
      bookingGroupId: settlementCompletionGroup!.id, userId: participantB!.id, fullName: "Settlement Completion Learner", status: "reserved",
    }).returning();
    const [settlementCompletionEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: participantB!.id, purchaserId: purchaser!.id, sessionId: settlementCompletionSession!.id,
      bookingGroupId: settlementCompletionGroup!.id, participantId: settlementCompletionParticipant!.id,
      status: "active", paymentStatus: "pending", chargedAmount: 10_000, accessGrantedAt: new Date(),
    }).returning();
    const [settlementCompletionSnapshot] = await db.insert(educationPriceSnapshotsTable).values({
      bookingGroupId: settlementCompletionGroup!.id, courseId: course!.id, grossAmount: 10_000,
      platformFee: 1_500, reserveAmount: 1_000, netAmount: 7_500, installmentCount: 2, depositDisposition: "refund",
    }).returning();
    const settlementCompletionInstallments = await db.insert(educationInstallmentsTable).values([
      {
        priceSnapshotId: settlementCompletionSnapshot!.id, installmentNumber: 1, amount: 5_000,
        paymentReference: `CMP1-${suffix.slice(0, 29)}`, status: "settled", settledAt: new Date(), settledByUserId: admin!.id,
      },
      {
        priceSnapshotId: settlementCompletionSnapshot!.id, installmentNumber: 2, amount: 5_000,
        paymentReference: `CMP2-${suffix.slice(0, 29)}`, status: "pending",
      },
    ]).returning();
    const completionAttendance = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${settlementCompletionSession!.id}/attendance/${settlementCompletionParticipant!.id}`, {
      method: "PUT", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ status: "present", occurredAt: new Date(attendanceStart.getTime() + 1_800_000).toISOString() }),
    });
    assert.equal(completionAttendance.status, 200);
    let settlementCompletionState = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, settlementCompletionEnrollment!.id)))[0]!;
    assert.notEqual(settlementCompletionState.status, "completed", "Attendance alone must not complete an unpaid enrollment.");
    assert.equal(settlementCompletionState.completedAt, null);
    const finalSettlementKey = `completion-final-${suffix}`;
    const settleFinal = () => fetch(`${base}/api/admin/education/installments/${settlementCompletionInstallments[1]!.id}/settle`, {
      method: "POST", headers: { cookie: cookies[7]!, "Idempotency-Key": finalSettlementKey },
    });
    const finalSettlement = await settleFinal();
    assert.equal(finalSettlement.status, 200);
    assert.equal((await finalSettlement.json() as { replayed: boolean }).replayed, false);
    settlementCompletionState = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, settlementCompletionEnrollment!.id)))[0]!;
    assert.equal(settlementCompletionState.status, "completed");
    assert.equal(settlementCompletionState.paymentStatus, "paid");
    assert.ok(settlementCompletionState.completedAt);
    assert.equal((await get(base, `/education/enrollments/${settlementCompletionEnrollment!.id}/certificate`, cookies[5]!)).status, 200);
    const completionTimestamp = settlementCompletionState.completedAt!.getTime();
    const finalEscrows = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, settlementCompletionEnrollment!.id));
    const finalLedgerCount = (await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, settlementCompletionEnrollment!.id))).length;
    const finalEventCount = (await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.enrollmentId, settlementCompletionEnrollment!.id))).length;
    const finalSettlementReplay = await settleFinal();
    assert.equal(finalSettlementReplay.status, 200);
    assert.equal((await finalSettlementReplay.json() as { replayed: boolean }).replayed, true);
    settlementCompletionState = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, settlementCompletionEnrollment!.id)))[0]!;
    assert.equal(settlementCompletionState.completedAt!.getTime(), completionTimestamp);
    assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, settlementCompletionEnrollment!.id))).length, finalEscrows.length);
    assert.equal((await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, settlementCompletionEnrollment!.id))).length, finalLedgerCount);
    assert.equal((await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.enrollmentId, settlementCompletionEnrollment!.id))).length, finalEventCount);

    const [attendanceSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: attendanceStart, endsAt: new Date(dbNow.getTime() - 3_600_000), capacity: 1, reservedSeats: 1,
    }).returning();
    const [attendanceGroup] = await db.insert(educationBookingGroupsTable).values({
      centerId: center!.id, courseId: course!.id, sessionId: attendanceSession!.id, purchaserId: purchaser!.id,
      createdByUserId: purchaser!.id, idempotencyKey: `attendance-${suffix}`, requestFingerprint: "a".repeat(64), status: "active",
    }).returning();
    const [attendanceParticipant] = await db.insert(educationBookingParticipantsTable).values({
      bookingGroupId: attendanceGroup!.id, userId: participantA!.id, fullName: "Attendance Learner", status: "reserved",
    }).returning();
    const [attendanceEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: participantA!.id, purchaserId: purchaser!.id, sessionId: attendanceSession!.id,
      bookingGroupId: attendanceGroup!.id, participantId: attendanceParticipant!.id,
      status: "active", paymentStatus: "paid", chargedAmount: 10_000, accessGrantedAt: new Date(),
    }).returning();
    const putAttendance = (status: "present" | "absent") => fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${attendanceSession!.id}/attendance/${attendanceParticipant!.id}`, {
      method: "PUT", headers: { cookie: cookies[0]!, "content-type": "application/json" },
      body: JSON.stringify({ status, occurredAt: new Date(attendanceStart.getTime() + 1_800_000).toISOString() }),
    });
    assert.equal((await putAttendance("present")).status, 200);
    let attendanceState = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, attendanceEnrollment!.id)))[0]!;
    assert.equal(attendanceState.status, "completed"); assert.ok(attendanceState.completedAt);
    assert.equal((await get(base, `/education/enrollments/${attendanceEnrollment!.id}/certificate`, cookies[4]!)).status, 200);
    assert.equal((await get(base, `/education/enrollments/${attendanceEnrollment!.id}/certificate`, cookies[3]!)).status, 403);
    assert.equal((await putAttendance("absent")).status, 200);
    attendanceState = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, attendanceEnrollment!.id)))[0]!;
    assert.equal(attendanceState.status, "active"); assert.equal(attendanceState.completedAt, null);
    assert.equal((await get(base, `/education/enrollments/${attendanceEnrollment!.id}/certificate`, cookies[4]!)).status, 409);
    assert.equal((await putAttendance("present")).status, 200);
    attendanceState = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, attendanceEnrollment!.id)))[0]!;
    assert.equal(attendanceState.status, "completed"); assert.ok(attendanceState.completedAt);
    const [hybridCourse] = await db.insert(coursesTable).values({
      centerId: center!.id, title: `Hybrid ordering ${suffix}`, category: "Test", format: "hybrid",
      price: 10_000, duration: "2h", imageUrl: "https://example.test/hybrid.jpg", certification: true,
    }).returning();
    const [hybridModule] = await db.insert(courseModulesTable).values({ courseId: hybridCourse!.id, title: "Module", sortOrder: 1 }).returning();
    const [hybridLesson] = await db.insert(courseLessonsTable).values({ moduleId: hybridModule!.id, title: "Lesson", sortOrder: 1 }).returning();
    const makeHybrid = async (learnerId: string, key: string) => {
      const [hybridSession] = await db.insert(courseSessionsTable).values({ courseId: hybridCourse!.id, startsAt: attendanceStart, endsAt: new Date(dbNow.getTime() - 3_600_000), capacity: 1, reservedSeats: 1 }).returning();
      const [hybridGroup] = await db.insert(educationBookingGroupsTable).values({ centerId: center!.id, courseId: hybridCourse!.id, sessionId: hybridSession!.id, purchaserId: purchaser!.id, createdByUserId: purchaser!.id, idempotencyKey: `${key}-${suffix}`, requestFingerprint: key.padEnd(64, "x"), status: "active" }).returning();
      const [hybridParticipant] = await db.insert(educationBookingParticipantsTable).values({ bookingGroupId: hybridGroup!.id, userId: learnerId, fullName: key, status: "reserved" }).returning();
      const [hybridEnrollment] = await db.insert(courseEnrollmentsTable).values({ courseId: hybridCourse!.id, userId: learnerId, purchaserId: purchaser!.id, sessionId: hybridSession!.id, bookingGroupId: hybridGroup!.id, participantId: hybridParticipant!.id, status: "active", paymentStatus: "paid", chargedAmount: 10_000, accessGrantedAt: new Date() }).returning();
      return { session: hybridSession!, participant: hybridParticipant!, enrollment: hybridEnrollment! };
    };
    const hybridLessonsFirst = await makeHybrid(participantA!.id, "hybrid-lessons-first");
    assert.equal((await fetch(`${base}/api/education/enrollments/${hybridLessonsFirst.enrollment.id}/lessons/${hybridLesson!.id}/complete`, { method: "POST", headers: { cookie: cookies[4]! } })).status, 200);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, hybridLessonsFirst.enrollment.id)))[0]!.status, "active");
    assert.equal((await get(base, `/education/enrollments/${hybridLessonsFirst.enrollment.id}/certificate`, cookies[4]!)).status, 409);
    assert.equal((await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${hybridLessonsFirst.session.id}/attendance/${hybridLessonsFirst.participant.id}`, { method: "PUT", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ status: "present", occurredAt: new Date(attendanceStart.getTime() + 1_800_000).toISOString() }) })).status, 200);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, hybridLessonsFirst.enrollment.id)))[0]!.status, "completed");
    assert.equal((await get(base, `/education/enrollments/${hybridLessonsFirst.enrollment.id}/certificate`, cookies[4]!)).status, 200);
    assert.equal((await get(base, `/education/enrollments/${hybridLessonsFirst.enrollment.id}/certificate`, cookies[3]!)).status, 403);
    const hybridAttendanceFirst = await makeHybrid(participantB!.id, "hybrid-attendance-first");
    assert.equal((await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${hybridAttendanceFirst.session.id}/attendance/${hybridAttendanceFirst.participant.id}`, { method: "PUT", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ status: "present", occurredAt: new Date(attendanceStart.getTime() + 1_800_000).toISOString() }) })).status, 200);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, hybridAttendanceFirst.enrollment.id)))[0]!.status, "active");
    assert.equal((await fetch(`${base}/api/education/enrollments/${hybridAttendanceFirst.enrollment.id}/lessons/${hybridLesson!.id}/complete`, { method: "POST", headers: { cookie: cookies[5]! } })).status, 200);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, hybridAttendanceFirst.enrollment.id)))[0]!.status, "completed");
    const [unassignedSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(startsAt.getTime() + 172_800_000), endsAt: new Date(startsAt.getTime() + 176_400_000), capacity: 4,
    }).returning();
    const unassignedAvailability = await get(base, `/education/courses/${course!.id}/availability`, cookies[3]!);
    assert.equal(unassignedAvailability.status, 200);
    assert.ok(((await unassignedAvailability.json() as any).slots as any[]).some((slot) => slot.sessionId === unassignedSession!.id && slot.educatorStaffId === null));
    for (const state of [{ published: false, archived: false }, { published: true, archived: true }]) {
      const [hiddenCourse] = await db.insert(coursesTable).values({
        centerId: center!.id, title: `Hidden ${suffix}`, category: "Test", format: "in-person", price: 1_000,
        duration: "1h", imageUrl: "https://example.test/hidden.jpg", ...state,
      }).returning();
      const [hiddenSession] = await db.insert(courseSessionsTable).values({
        courseId: hiddenCourse!.id, startsAt: new Date(startsAt.getTime() + 300_000_000), endsAt: new Date(startsAt.getTime() + 303_600_000), capacity: 2,
      }).returning();
      for (const suffixPath of ["", "?date=2030-01-01"]) {
        const response = await get(base, `/education/courses/${hiddenCourse!.id}/availability${suffixPath}`, cookies[3]!);
        assert.equal(response.status, 404);
        assert.doesNotMatch(await response.text(), new RegExp(hiddenSession!.id));
      }
    }

    const [targetSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(startsAt.getTime() + 86_400_000), endsAt: new Date(startsAt.getTime() + 90_000_000), capacity: 10, reservedSeats: 0,
    }).returning();
    await db.insert(educationSessionEducatorsTable).values({ sessionId: targetSession!.id, staffId: staff[2]!.id, assignedByUserId: owner!.id });
    const groupsBeforeImpersonation = (await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.sessionId, targetSession!.id))).length;
    const impersonation = await fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `foreign-${suffix}` },
      body: JSON.stringify({ courseId: course!.id, sessionId: targetSession!.id, participants: [{ fullName: "Foreign", userId: unrelated!.id }] }),
    });
    assert.equal(impersonation.status, 403);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.sessionId, targetSession!.id))).length, groupsBeforeImpersonation);
    const duplicateSelf = await fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `duplicate-self-${suffix}` },
      body: JSON.stringify({ courseId: course!.id, sessionId: targetSession!.id, participants: [
        { fullName: "Self one", userId: purchaser!.id }, { fullName: "Self two", userId: purchaser!.id },
      ] }),
    });
    assert.equal(duplicateSelf.status, 403);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.sessionId, targetSession!.id))).length, groupsBeforeImpersonation);

    const onlineKey = `online-self-${suffix}`;
    const onlineInput = {
      courseId: course!.id, sessionId: targetSession!.id, installmentCount: 2,
      participants: [
        { fullName: "Purchaser Self", email: purchaser!.email },
        { fullName: "Named Guest", email: `named-guest-${suffix}@example.test`, phone: "38160999888" },
      ],
    };
    const createOnline = () => fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": onlineKey },
      body: JSON.stringify(onlineInput),
    });
    const onlineCreated = await createOnline();
    assert.equal(onlineCreated.status, 201);
    const onlineBooking = await onlineCreated.json() as any;
    const onlineReplay = await createOnline();
    assert.equal(onlineReplay.status, 201);
    assert.equal((await onlineReplay.json() as any).id, onlineBooking.id);
    const onlineParticipants = await db.select().from(educationBookingParticipantsTable)
      .where(eq(educationBookingParticipantsTable.bookingGroupId, onlineBooking.id)).orderBy(educationBookingParticipantsTable.createdAt);
    assert.equal(onlineParticipants.length, 2);
    const selfSeat = onlineParticipants.find((row) => row.fullName === "Purchaser Self")!;
    const guestSeat = onlineParticipants.find((row) => row.fullName === "Named Guest")!;
    assert.equal(selfSeat.userId, purchaser!.id);
    assert.equal(guestSeat.userId, null);
    const onlineEnrollments = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bookingGroupId, onlineBooking.id));
    assert.equal(onlineEnrollments.find((row) => row.participantId === selfSeat.id)!.userId, purchaser!.id);
    assert.equal(onlineEnrollments.find((row) => row.participantId === guestSeat.id)!.userId, null);
    const onlineOutbox = await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, targetSession!.id));
    assert.equal(onlineOutbox.filter((row) => row.eventType === "booking_confirmation" && row.participantId).length, 2);
    assert.equal(onlineOutbox.filter((row) => row.eventType === "booking_confirmation_educator" && typeof row.payload.educatorStaffId === "string").length, 1);
    assert.equal(onlineOutbox.filter((row) => row.eventType.startsWith("booking_") && !row.participantId && typeof row.payload.educatorStaffId !== "string").length, 0);
    const emails: string[] = []; const phones: string[] = [];
    await processEducationOutbox(20, {
      sendEmail: async (input: any) => { emails.push(input.to.email); return { messageId: `email-${emails.length}` } as any; },
      sendSms: async (input: any) => { phones.push(input.phone); return { sent: true }; },
    });
    assert.ok(emails.includes(purchaser!.email));
    assert.ok(emails.includes(`named-guest-${suffix}@example.test`));
    assert.ok(emails.includes(educator!.email));
    assert.ok(phones.includes("38160999888"));
    assert.ok((await db.select().from(educationNotificationsTable).where(eq(educationNotificationsTable.userId, purchaser!.id))).some((row) => row.type === "booking_confirmation"));
    const [fullSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(startsAt.getTime() + 259_200_000), endsAt: new Date(startsAt.getTime() + 262_800_000), capacity: 1, reservedSeats: 1,
    }).returning();
    await db.insert(educationSessionEducatorsTable).values({ sessionId: fullSession!.id, staffId: staff[2]!.id, assignedByUserId: owner!.id });
    const waitlistedResponse = await fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `waitlisted-${suffix}` },
      body: JSON.stringify({ courseId: course!.id, sessionId: fullSession!.id, participants: onlineInput.participants }),
    });
    assert.equal(waitlistedResponse.status, 201);
    const waitlistedBooking = await waitlistedResponse.json() as any;
    assert.equal(waitlistedBooking.status, "waitlisted");
    const waitlistOutbox = await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, fullSession!.id));
    assert.equal(waitlistOutbox.filter((row) => row.eventType === "booking_waitlisted" && row.participantId).length, 2);
    assert.equal(waitlistOutbox.filter((row) => row.eventType === "booking_waitlisted_educator" && typeof row.payload.educatorStaffId === "string").length, 1);
    const waitlistedReplay = await fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `waitlisted-${suffix}` },
      body: JSON.stringify({ courseId: course!.id, sessionId: fullSession!.id, participants: onlineInput.participants }),
    });
    assert.equal(waitlistedReplay.status, 201);
    assert.equal((await waitlistedReplay.json() as any).id, waitlistedBooking.id);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, fullSession!.id))).length, waitlistOutbox.length);
    const [onlineSnapshot] = await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.bookingGroupId, onlineBooking.id));
    const onlineInstallments = await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, onlineSnapshot!.id));
    for (const row of onlineInstallments) {
      const settledResponse = await fetch(`${base}/api/admin/education/installments/${row.id}/settle`, {
        method: "POST", headers: { cookie: cookies[7]!, "Idempotency-Key": `online-settle-${row.id}` },
      });
      assert.equal(settledResponse.status, 200);
    }
    const selfEnrollment = onlineEnrollments.find((row) => row.participantId === selfSeat.id)!;
    const guestEnrollmentFromBooking = onlineEnrollments.find((row) => row.participantId === guestSeat.id)!;
    assert.equal((await get(base, `/education/enrollments/${selfEnrollment.id}/lms`, cookies[3]!)).status, 200);
    assert.equal((await get(base, `/education/enrollments/${selfEnrollment.id}/session.ics`, cookies[3]!)).status, 200);
    assert.equal((await get(base, `/education/enrollments/${guestEnrollmentFromBooking.id}/lms`, cookies[3]!)).status, 403);
    assert.equal((await get(base, `/education/enrollments/${guestEnrollmentFromBooking.id}/session.ics`, cookies[3]!)).status, 403);
    const adminInstallmentsResponse = await get(base, `/admin/education/installments?reference=${encodeURIComponent(onlineInstallments[0]!.paymentReference)}`, cookies[7]!);
    assert.equal(adminInstallmentsResponse.status, 200);
    const [adminInstallment] = await adminInstallmentsResponse.json() as any[];
    assert.ok(adminInstallment.courseTitle.trim());
    assert.ok(adminInstallment.customerName.trim());
    assert.ok(adminInstallment.dueAt === null || !Number.isNaN(Date.parse(adminInstallment.dueAt)));
    const manualResponse = await fetch(`${base}/api/education/operations/bookings`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json", "Idempotency-Key": `manual-guest-${suffix}` },
      body: JSON.stringify({ courseId: course!.id, sessionId: unassignedSession!.id, participants: [{ fullName: "Manual Guest", email: `manual-${suffix}@example.test`, userId: unrelated!.id }] }),
    });
    assert.equal(manualResponse.status, 201);
    const manualBooking = await manualResponse.json() as any;
    assert.equal((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, manualBooking.id)))[0]!.userId, null);
    const invariantBefore = {
      group: (await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0],
      participants: await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group!.id)),
      snapshot: (await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot!.id)))[0],
      installments: await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id)),
      escrows: await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.centerId, center!.id)),
    };
    const partialMove = await fetch(`${base}/api/education/operations/bookings/${group!.id}/reschedule`, {
      method: "PATCH", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `partial-${suffix}` },
      body: JSON.stringify({ targetSessionId: targetSession!.id, participantIds: [participants[0]!.id] }),
    });
    assert.equal(partialMove.status, 409);
    assert.equal((await partialMove.json() as any).code, "PARTIAL_RESCHEDULE_UNSUPPORTED");
    assert.deepEqual((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0], invariantBefore.group);
    assert.deepEqual(await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group!.id)), invariantBefore.participants);
    assert.deepEqual((await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot!.id)))[0], invariantBefore.snapshot);
    assert.deepEqual(await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id)), invariantBefore.installments);
    assert.deepEqual(await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.centerId, center!.id)), invariantBefore.escrows);
    const wholeMove = await fetch(`${base}/api/education/operations/bookings/${group!.id}/reschedule`, {
      method: "PATCH", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `whole-${suffix}` },
      body: JSON.stringify({ targetSessionId: targetSession!.id, participantIds: participants.map((row) => row.id) }),
    });
    assert.equal(wholeMove.status, 200);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0]!.sessionId, targetSession!.id);
    assert.deepEqual((await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot!.id)))[0], invariantBefore.snapshot);
    assert.deepEqual(await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id)), invariantBefore.installments);
    const moveBack = await fetch(`${base}/api/education/operations/bookings/${group!.id}/reschedule`, {
      method: "PATCH", headers: { cookie: cookies[3]!, "content-type": "application/json", "Idempotency-Key": `whole-back-${suffix}` },
      body: JSON.stringify({ targetSessionId: session!.id }),
    });
    assert.equal(moveBack.status, 200);
    const [queueSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(startsAt.getTime() + 172_800_000), endsAt: new Date(startsAt.getTime() + 176_400_000), capacity: 1, reservedSeats: 1,
    }).returning();
    const queueBooking = async (auth: string, key: string, participant: Record<string, unknown>) => {
      const response = await fetch(`${base}/api/education/operations/bookings`, {
        method: "POST", headers: { cookie: auth, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ courseId: course!.id, sessionId: queueSession!.id, installmentCount: 1, participants: [participant] }),
      });
      assert.equal(response.status, 201);
      const result = await response.json() as any;
      assert.equal(result.status, "waitlisted");
      return result.id as string;
    };
    const onlineQueueId = await queueBooking(cookies[3]!, `online-queue-${suffix}`, { fullName: "Online queued", email: purchaser!.email });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const manualQueueId = await queueBooking(cookies[0]!, `manual-queue-${suffix}`, { userId: unrelated!.id, fullName: "Manual queued", email: unrelated!.email });
    const queuedGroups = await db.select().from(educationBookingGroupsTable).where(inArray(educationBookingGroupsTable.id, [onlineQueueId, manualQueueId]));
    const queuedParticipants = await db.select().from(educationBookingParticipantsTable)
      .where(inArray(educationBookingParticipantsTable.bookingGroupId, [onlineQueueId, manualQueueId]))
      .orderBy(educationBookingParticipantsTable.createdAt, educationBookingParticipantsTable.id);
    assert.equal(queuedGroups.every((row) => row.status === "waitlisted"), true);
    await db.transaction(async (tx) => releaseSeatAndPromoteWaiter(tx, queueSession!.id, course!));
    assert.equal((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, queuedParticipants[0]!.id)))[0]!.status, "reserved");
    assert.equal((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, queuedParticipants[1]!.id)))[0]!.status, "waitlisted");
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, queueSession!.id)))[0]!.reservedSeats, 1);
    await db.transaction(async (tx) => releaseSeatAndPromoteWaiter(tx, queueSession!.id, course!));
    assert.equal((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, queuedParticipants[1]!.id)))[0]!.status, "reserved");
    assert.ok((await db.select().from(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.participantId, queuedParticipants.map((row) => row.id)))).every((row) => row.status === "pending"));
    const offers = (await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, queueSession!.id))).filter((row) => row.eventType === "waitlist_offer");
    assert.equal(offers.length, 2);
    assert.equal(new Set(offers.map((row) => row.participantId)).size, 2);
    assert.ok((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, queueSession!.id)))[0]!.reservedSeats <= queueSession!.capacity);
    const [concurrentSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(startsAt.getTime() + 259_200_000), endsAt: new Date(startsAt.getTime() + 262_800_000), capacity: 2, reservedSeats: 2,
    }).returning();
    const concurrentGroupIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      concurrentGroupIds.push(await queueBooking(cookies[0]!, `concurrent-queue-${index}-${suffix}`, {
        fullName: `Concurrent queued ${index}`, email: `concurrent-${index}-${suffix}@example.test`,
      }).then(async (id) => {
        await db.update(educationBookingGroupsTable).set({ sessionId: concurrentSession!.id }).where(eq(educationBookingGroupsTable.id, id));
        await db.update(courseEnrollmentsTable).set({ sessionId: concurrentSession!.id }).where(eq(courseEnrollmentsTable.bookingGroupId, id));
        return id;
      }));
    }
    // The booking helper above targets the first full session; atomically move
    // the still-waitlisted fixtures to this isolated full session.
    await Promise.all([
      db.transaction(async (tx) => releaseSeatAndPromoteWaiter(tx, concurrentSession!.id, course!)),
      db.transaction(async (tx) => releaseSeatAndPromoteWaiter(tx, concurrentSession!.id, course!)),
    ]);
    const concurrentlyQueued = await db.select().from(educationBookingParticipantsTable)
      .where(inArray(educationBookingParticipantsTable.bookingGroupId, concurrentGroupIds));
    assert.equal(concurrentlyQueued.filter((row) => row.status === "reserved").length, 2);
    assert.equal(concurrentlyQueued.filter((row) => row.status === "waitlisted").length, 1);
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, concurrentSession!.id)))[0]!.reservedSeats, 2);
    const detail = async (index: number) => {
      const response = await get(base, `/education/operations/bookings/${group!.id}`, cookies[index]!);
      return { response, body: await response.json() as any };
    };
    for (const index of [0, 1, 2, 3]) {
      const value = await detail(index);
      assert.equal(value.response.status, 200);
      assert.deepEqual(value.body.participants.map((p: any) => p.fullName), ["Participant Alpha Secret", "Participant Beta Secret"]);
    }
    const a = await detail(4);
    assert.equal(a.response.status, 200);
    assert.equal(a.body.participants[0].email, `alpha-${suffix}@secret.test`);
    assert.equal(a.body.participants[1].fullName, "Rezervisano mesto");
    assert.equal(a.body.participants[1].email, null); assert.equal(a.body.participants[1].phone, null); assert.equal(a.body.participants[1].userId, null);
    const b = await detail(5);
    assert.equal(b.body.participants[0].fullName, "Rezervisano mesto");
    assert.equal(b.body.participants[1].email, `beta-${suffix}@secret.test`);
    assert.equal((await detail(6)).response.status, 404);
    // A staff member of another center has no cross-center visibility.
    await db.insert(educationCenterStaffTable).values({ centerId: otherCenter!.id, userId: unrelated!.id, role: "manager_reception" });
    assert.equal((await detail(6)).response.status, 404);

    const icsA = await (await get(base, `/education/operations/bookings/${group!.id}/calendar.ics`, cookies[4]!)).text();
    assert.match(icsA, /Participant Alpha Secret/); assert.doesNotMatch(icsA, /Participant Beta Secret/);
    for (const index of [0, 1, 2, 3]) {
      const text = await (await get(base, `/education/operations/bookings/${group!.id}/calendar.ics`, cookies[index]!)).text();
      assert.match(text, /Participant Alpha Secret/); assert.match(text, /Participant Beta Secret/);
    }

    const settled = await fetch(`${base}/api/admin/education/installments/${installments[0]!.id}/settle`, {
      method: "POST", headers: { cookie: cookies[7]!, "Idempotency-Key": `settle-${suffix}` },
    });
    assert.equal(settled.status, 200);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0]!.status, "active");
    assert.ok((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bookingGroupId, group!.id))).every((e) => e.status === "pending"),
      "A partial installment must not leave enrollments active before full payment.");
    const cancellationInvariant = {
      group: (await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0],
      participants: await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group!.id)),
      snapshot: (await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot!.id)))[0],
      installments: await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id)),
      enrollments: await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bookingGroupId, group!.id)),
      escrows: await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.centerId, center!.id)),
      session: (await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session!.id)))[0],
      outboxCount: (await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.centerId, center!.id))).length,
    };
    const whitespaceCancellation = await fetch(`${base}/api/education/operations/bookings/${group!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    });
    assert.equal(whitespaceCancellation.status, 400);
    assert.deepEqual((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0], cancellationInvariant.group);
    assert.deepEqual(await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id)), cancellationInvariant.installments);
    const partialCancellation = await fetch(`${base}/api/education/operations/bookings/${group!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json" },
      body: JSON.stringify({ participantIds: [participants[0]!.id], reason: "must not mutate" }),
    });
    assert.equal(partialCancellation.status, 409);
    assert.equal((await partialCancellation.json() as any).code, "PARTIAL_CANCELLATION_UNSUPPORTED");
    assert.deepEqual((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0], cancellationInvariant.group);
    assert.deepEqual(await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group!.id)), cancellationInvariant.participants);
    assert.deepEqual((await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot!.id)))[0], cancellationInvariant.snapshot);
    assert.deepEqual(await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id)), cancellationInvariant.installments);
    assert.deepEqual(await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bookingGroupId, group!.id)), cancellationInvariant.enrollments);
    assert.deepEqual(await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.centerId, center!.id)), cancellationInvariant.escrows);
    assert.deepEqual((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session!.id)))[0], cancellationInvariant.session);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.centerId, center!.id))).length, cancellationInvariant.outboxCount);
    await enqueueEducationReminderSweep(new Date(startsAt.getTime() - 2 * 3_600_000));
    await enqueueEducationReminderSweep(new Date(startsAt.getTime() - 2 * 3_600_000));
    const reminders = await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, session!.id));
    const reminderEvents = reminders.filter((row) => row.eventType.includes("reminder"));
    assert.equal(reminderEvents.length, 3);
    assert.equal(reminderEvents.filter((row) => row.eventType === "session_reminder_2h" && row.participantId).length, 2);
    assert.equal(reminderEvents.filter((row) => row.eventType === "session_reminder_2h" && !row.participantId).length, 1);
    assert.equal(reminderEvents.filter((row) => row.eventType === "session_reminder_24h").length, 0);
    assert.equal(new Set(reminders.map((r) => r.dedupeKey)).size, reminders.length);

    const createReminderFixture = async (label: string, reminderStartsAt: Date) => {
      const [reminderSession] = await db.insert(courseSessionsTable).values({
        courseId: course!.id,
        startsAt: reminderStartsAt,
        endsAt: new Date(reminderStartsAt.getTime() + 3_600_000),
        capacity: 2,
        reservedSeats: 2,
      }).returning();
      await db.insert(educationSessionEducatorsTable).values({
        sessionId: reminderSession!.id,
        staffId: staff[2]!.id,
        assignedByUserId: owner!.id,
      });
      const [reminderGroup] = await db.insert(educationBookingGroupsTable).values({
        centerId: center!.id,
        courseId: course!.id,
        sessionId: reminderSession!.id,
        purchaserId: purchaser!.id,
        createdByUserId: purchaser!.id,
        idempotencyKey: `reminder-${label}-${suffix}`,
        requestFingerprint: label.padEnd(64, "x").slice(0, 64),
        status: "active",
      }).returning();
      await db.insert(educationBookingParticipantsTable).values([
        { bookingGroupId: reminderGroup!.id, userId: participantA!.id, fullName: `${label} A`, status: "reserved" },
        { bookingGroupId: reminderGroup!.id, userId: participantB!.id, fullName: `${label} B`, status: "reserved" },
      ]);
      return reminderSession!;
    };
    const reminder24Session = await createReminderFixture("24h", new Date(startsAt.getTime() + 20 * 86_400_000));
    const reminder24Now = new Date(reminder24Session.startsAt.getTime() - 24 * 3_600_000);
    await enqueueEducationReminderSweep(reminder24Now);
    await enqueueEducationReminderSweep(reminder24Now);
    const reminder24Rows = (await db.select().from(educationOutboxTable)
      .where(eq(educationOutboxTable.sessionId, reminder24Session.id))).filter((row) => row.eventType.includes("reminder"));
    assert.equal(reminder24Rows.length, 3);
    assert.equal(reminder24Rows.filter((row) => row.eventType === "session_reminder_24h" && row.participantId).length, 2);
    assert.equal(reminder24Rows.filter((row) => row.eventType === "session_reminder_24h" && !row.participantId).length, 1);
    assert.equal(reminder24Rows.filter((row) => row.eventType === "session_reminder_2h").length, 0);
    const reminder10Session = await createReminderFixture("10h", new Date(startsAt.getTime() + 30 * 86_400_000));
    await enqueueEducationReminderSweep(new Date(reminder10Session.startsAt.getTime() - 10 * 3_600_000));
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, reminder10Session.id)))
      .filter((row) => row.eventType.includes("reminder")).length, 0);
    const reminder30mSession = await createReminderFixture("30m", new Date(startsAt.getTime() + 40 * 86_400_000));
    await enqueueEducationReminderSweep(new Date(reminder30mSession.startsAt.getTime() - 30 * 60_000));
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, reminder30mSession.id)))
      .filter((row) => row.eventType.includes("reminder")).length, 0);

    const smsRow = reminders.find((r) => r.participantId === participants[0]!.id && r.eventType === "session_reminder_2h")!;
    let smsAttempts = 0;
    const emailAttempts = new Map<string, number>();
    const first = await processEducationOutbox(100, {
      sendSms: async () => { smsAttempts++; return { failed: true }; },
      sendEmail: async (input) => { emailAttempts.set(input.eventKey, (emailAttempts.get(input.eventKey) ?? 0) + 1); return { messageId: "fake" } as any; },
    });
    assert.ok(first.deferred >= 1);
    const failed = (await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.id, smsRow.id)))[0]!;
    assert.equal(failed.status, "failed"); assert.equal(failed.attempts, 1);
    assert.deepEqual((failed.payload as any).channelOutcomes, { inApp: "sent", email: "sent", sms: "failed" });
    const educatorReminder = reminders.find((r) => !r.participantId && r.eventType === "session_reminder_2h")!;
    const noPhone = (await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.id, educatorReminder.id)))[0]!;
    assert.equal((noPhone.payload as any).channelOutcomes.sms, "skipped");
    await db.update(educationOutboxTable).set({ availableAt: new Date(0) }).where(eq(educationOutboxTable.id, smsRow.id));
    await processEducationOutbox(100, {
      sendSms: async () => { smsAttempts++; return { sent: true }; },
      sendEmail: async (input) => { emailAttempts.set(input.eventKey, (emailAttempts.get(input.eventKey) ?? 0) + 1); return { messageId: "fake" } as any; },
    });
    const sent = (await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.id, smsRow.id)))[0]!;
    assert.equal(sent.status, "sent"); assert.equal(sent.attempts, 2);
    assert.equal(smsAttempts >= 2, true);
    // The tested row's successful email is persisted and therefore not retried.
    assert.equal((sent.payload as any).channelOutcomes.email, "sent");
    assert.equal(emailAttempts.get(`${smsRow.dedupeKey}:email`), 1);

    // Operational enrollment learning assets belong exclusively to the named
    // participant account. Booking purchasers, all center roles, unrelated
    // users, and admins retain group-management access but cannot impersonate
    // this learner through legacy enrollment endpoints.
    const secondSettlement = await fetch(`${base}/api/admin/education/installments/${installments[1]!.id}/settle`, {
      method: "POST", headers: { cookie: cookies[7]!, "Idempotency-Key": `settle-second-${suffix}` },
    });
    assert.equal(secondSettlement.status, 200);
    const [module] = await db.insert(courseModulesTable).values({
      courseId: course!.id, title: "Operational learner module", description: "", sortOrder: 1,
    }).returning();
    const [lesson] = await db.insert(courseLessonsTable).values({
      moduleId: module!.id, title: "Operational learner lesson", description: "", content: "Lesson", durationMinutes: 30, sortOrder: 1,
    }).returning();
    await db.insert(educationAttendanceTable).values({
      participantId: participants[0]!.id, sessionId: session!.id, status: "present", recordedByUserId: educator!.id,
    });
    const learnerEnrollment = (await db.select().from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.participantId, participants[0]!.id)))[0]!;
    assert.equal(learnerEnrollment.status, "active");
    assert.equal(learnerEnrollment.paymentStatus, "paid");
    const learnerLms = await get(base, `/education/enrollments/${learnerEnrollment.id}/lms`, cookies[4]!);
    assert.equal(learnerLms.status, 200);
    const learnerCompletion = await fetch(`${base}/api/education/enrollments/${learnerEnrollment.id}/lessons/${lesson!.id}/complete`, {
      method: "POST", headers: { cookie: cookies[4]! },
    });
    assert.equal(learnerCompletion.status, 200);
    const learnerCertificate = await get(base, `/education/enrollments/${learnerEnrollment.id}/certificate`, cookies[4]!);
    assert.equal(learnerCertificate.status, 200);
    const learnerCertificatePdf = Buffer.from(await learnerCertificate.arrayBuffer()).toString("latin1");
    assert.match(learnerCertificatePdf, /Participant Alpha Secret/);
    assert.doesNotMatch(learnerCertificatePdf, new RegExp(`${purchaser!.firstName} ${purchaser!.lastName}`));
    assert.equal((await get(base, `/education/enrollments/${learnerEnrollment.id}/session.ics`, cookies[4]!)).status, 200);
    await db.insert(educationAttendanceTable).values({
      participantId: selfSeat.id, sessionId: targetSession!.id, status: "present", recordedByUserId: educator!.id,
    });
    const selfCompletion = await fetch(`${base}/api/education/enrollments/${selfEnrollment.id}/lessons/${lesson!.id}/complete`, {
      method: "POST", headers: { cookie: cookies[3]! },
    });
    assert.equal(selfCompletion.status, 200);
    assert.equal((await get(base, `/education/enrollments/${selfEnrollment.id}/certificate`, cookies[3]!)).status, 200);
    assert.equal((await get(base, `/education/enrollments/${guestEnrollmentFromBooking.id}/certificate`, cookies[3]!)).status, 403);
    const forbiddenEnrollmentCallers = [0, 1, 2, 3, 5, 6, 7];
    for (const index of forbiddenEnrollmentCallers) {
      assert.equal((await get(base, `/education/enrollments/${learnerEnrollment.id}/lms`, cookies[index]!)).status, 403);
      assert.equal((await fetch(`${base}/api/education/enrollments/${learnerEnrollment.id}/lessons/${lesson!.id}/complete`, {
        method: "POST", headers: { cookie: cookies[index]! },
      })).status, 403);
      assert.equal((await get(base, `/education/enrollments/${learnerEnrollment.id}/certificate`, cookies[index]!)).status, 403);
      assert.equal((await get(base, `/education/enrollments/${learnerEnrollment.id}/session.ics`, cookies[index]!)).status, 403);
    }

    const [guestParticipant] = await db.insert(educationBookingParticipantsTable).values({
      bookingGroupId: group!.id, userId: null, fullName: "Operational guest", email: `guest-${suffix}@example.test`, status: "reserved",
    }).returning();
    const [guestEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: null, purchaserId: purchaser!.id, sessionId: session!.id,
      bookingGroupId: group!.id, participantId: guestParticipant!.id, status: "active", paymentStatus: "paid", chargedAmount: 0,
    }).returning();
    for (let index = 0; index < cookies.length; index++) {
      assert.equal((await get(base, `/education/enrollments/${guestEnrollment!.id}/lms`, cookies[index]!)).status, 403);
      assert.equal((await fetch(`${base}/api/education/enrollments/${guestEnrollment!.id}/lessons/${lesson!.id}/complete`, {
        method: "POST", headers: { cookie: cookies[index]! },
      })).status, 403);
      assert.equal((await get(base, `/education/enrollments/${guestEnrollment!.id}/certificate`, cookies[index]!)).status, 403);
      assert.equal((await get(base, `/education/enrollments/${guestEnrollment!.id}/session.ics`, cookies[index]!)).status, 403);
    }
    const createFinancialFixture = async (label: string, targetSessionId: string, disposition: "refund" | "forfeit" | "transfer", captured: boolean, payout = false) => {
      const [financialGroup] = await db.insert(educationBookingGroupsTable).values({
        centerId: center!.id, courseId: course!.id, sessionId: targetSessionId, purchaserId: purchaser!.id,
        createdByUserId: owner!.id, idempotencyKey: `${label}-${suffix}`, requestFingerprint: label.padEnd(64, "x").slice(0, 64), status: captured ? "active" : "pending",
      }).returning();
      const [financialParticipant] = await db.insert(educationBookingParticipantsTable).values({
        bookingGroupId: financialGroup!.id, userId: purchaser!.id, fullName: `Financial ${label}`, email: purchaser!.email, status: "reserved",
      }).returning();
      const [financialSnapshot] = await db.insert(educationPriceSnapshotsTable).values({
        bookingGroupId: financialGroup!.id, courseId: course!.id, grossAmount: 10_000, platformFee: 1_500,
        reserveAmount: 1_000, netAmount: 7_500, installmentCount: 2, depositDisposition: disposition,
      }).returning();
      const financialInstallments = await db.insert(educationInstallmentsTable).values([
        { priceSnapshotId: financialSnapshot!.id, installmentNumber: 1, amount: 5_000, paymentReference: `${label}-A-${suffix}`, status: captured ? "settled" as const : "pending" as const, settledByUserId: captured ? admin!.id : null, settledAt: captured ? new Date() : null },
        { priceSnapshotId: financialSnapshot!.id, installmentNumber: 2, amount: 5_000, paymentReference: `${label}-B-${suffix}` },
      ]).returning();
      const [financialEnrollment] = await db.insert(courseEnrollmentsTable).values({
        courseId: course!.id, userId: purchaser!.id, purchaserId: purchaser!.id, sessionId: targetSessionId,
        bookingGroupId: financialGroup!.id, participantId: financialParticipant!.id,
        status: captured ? "active" : "pending", paymentStatus: "pending", chargedAmount: 10_000,
      }).returning();
      const [financialEscrow] = captured ? await db.insert(educationEscrowsTable).values({
        enrollmentId: financialEnrollment!.id, centerId: center!.id, grossAmount: 5_000, platformFee: 750,
        reserveAmount: 500, netAmount: 3_750, releaseAt: new Date(Date.now() + 86_400_000),
        status: "held", paymentReference: financialInstallments[0]!.paymentReference,
        netPaidAt: payout ? new Date() : null,
      }).returning() : [];
      return { group: financialGroup!, participant: financialParticipant!, snapshot: financialSnapshot!, installments: financialInstallments, enrollment: financialEnrollment!, escrow: financialEscrow };
    };

    const [paidOutMixedSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(Date.now() + 450_000_000), endsAt: new Date(Date.now() + 453_600_000), capacity: 2, reservedSeats: 2,
    }).returning();
    const mixedOperational = await createFinancialFixture("paidout-mixed", paidOutMixedSession!.id, "refund", true);
    const [paidOutLegacy] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: participantB!.id, purchaserId: participantB!.id, sessionId: paidOutMixedSession!.id,
      status: "active", paymentStatus: "paid", chargedAmount: 3_000, accessGrantedAt: new Date(),
    }).returning();
    const [paidOutLegacyEscrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: paidOutLegacy!.id, centerId: center!.id, grossAmount: 3_000, platformFee: 450, reserveAmount: 300, netAmount: 2_250,
      releaseAt: new Date(Date.now() - 86_400_000), status: "paid_out", paymentReference: `PAIDOUT-${suffix}`, netPaidAt: new Date(),
    }).returning();
    const mixedBefore = {
      session: (await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, paidOutMixedSession!.id)))[0]!,
      group: (await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, mixedOperational.group.id)))[0]!,
      participant: (await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, mixedOperational.participant.id)))[0]!,
      operationalEnrollment: (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, mixedOperational.enrollment.id)))[0]!,
      legacyEnrollment: (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, paidOutLegacy!.id)))[0]!,
      operationalEscrow: (await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, mixedOperational.escrow!.id)))[0]!,
      legacyEscrow: (await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, paidOutLegacyEscrow!.id)))[0]!,
      ledgerCount: (await db.select().from(educationLedgerEntriesTable)).length,
      eventCount: (await db.select().from(educationFinancialEventsTable)).length,
      notificationCount: (await db.select().from(educationNotificationsTable)).length,
      referralEvidenceCount: (await db.select().from(referralQualificationEvidenceTable)).length,
      outboxCount: (await db.select().from(educationOutboxTable)).length,
    };
    const paidOutConflict = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${paidOutMixedSession!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "must rollback" }),
    });
    assert.equal(paidOutConflict.status, 409);
    assert.deepEqual((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, paidOutMixedSession!.id)))[0], mixedBefore.session);
    assert.deepEqual((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, mixedOperational.group.id)))[0], mixedBefore.group);
    assert.deepEqual((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, mixedOperational.participant.id)))[0], mixedBefore.participant);
    assert.deepEqual((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, mixedOperational.enrollment.id)))[0], mixedBefore.operationalEnrollment);
    assert.deepEqual((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, paidOutLegacy!.id)))[0], mixedBefore.legacyEnrollment);
    assert.deepEqual((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, mixedOperational.escrow!.id)))[0], mixedBefore.operationalEscrow);
    assert.deepEqual((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, paidOutLegacyEscrow!.id)))[0], mixedBefore.legacyEscrow);
    assert.equal((await db.select().from(educationLedgerEntriesTable)).length, mixedBefore.ledgerCount);
    assert.equal((await db.select().from(educationFinancialEventsTable)).length, mixedBefore.eventCount);
    assert.equal((await db.select().from(educationNotificationsTable)).length, mixedBefore.notificationCount);
    assert.equal((await db.select().from(referralQualificationEvidenceTable)).length, mixedBefore.referralEvidenceCount);
    assert.equal((await db.select().from(educationOutboxTable)).length, mixedBefore.outboxCount);

    for (const disposition of ["refund", "forfeit", "transfer"] as const) {
      const [financialSession] = await db.insert(courseSessionsTable).values({
        courseId: course!.id, startsAt: new Date(Date.now() + 400_000_000), endsAt: new Date(Date.now() + 403_600_000), capacity: 1, reservedSeats: 1,
      }).returning();
      const fixture = await createFinancialFixture(`customer-${disposition}`, financialSession!.id, disposition, true);
      const response = await fetch(`${base}/api/education/operations/bookings/${fixture.group.id}/cancel`, {
        method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json" }, body: JSON.stringify({ reason: disposition }),
      });
      assert.equal(response.status, 200);
      const rows = await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, fixture.snapshot.id));
      assert.equal(rows.find((row) => row.installmentNumber === 1)!.status, "settled");
      assert.equal(rows.find((row) => row.installmentNumber === 2)!.status, "cancelled");
      assert.equal(rows.find((row) => row.installmentNumber === 1)!.refundedAmount, disposition === "refund" ? 5_000 : 0);
      assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, fixture.escrow!.id)))[0]!.status, disposition === "refund" ? "refunded" : "held");
      const cancelledEnrollment = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, fixture.enrollment.id)))[0]!;
      assert.equal(cancelledEnrollment.status, "cancelled");
      assert.equal(cancelledEnrollment.paymentStatus, disposition === "refund" ? "refunded" : "pending");
      const plan = await (await get(base, `/education/operations/bookings/${fixture.group.id}/payment-plan`, cookies[3]!)).json() as any;
      assert.equal(plan.refundedAmount, disposition === "refund" ? 5_000 : 0);
      assert.equal(plan.netPaidAmount, disposition === "refund" ? 0 : 5_000);
      assert.ok(plan.outstandingAmount >= 0);
    }

    const [centerCancellationSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(Date.now() + 500_000_000), endsAt: new Date(Date.now() + 503_600_000), capacity: 2, reservedSeats: 2,
    }).returning();
    const centerPending = await createFinancialFixture("center-pending", centerCancellationSession!.id, "forfeit", false);
    const centerCaptured = await createFinancialFixture("center-captured", centerCancellationSession!.id, "transfer", true);
    const [legacyEnrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: unrelated!.id, purchaserId: unrelated!.id, sessionId: centerCancellationSession!.id,
      status: "active", paymentStatus: "paid", chargedAmount: 2_000, accessGrantedAt: new Date(),
    }).returning();
    const [legacyEscrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: legacyEnrollment!.id, centerId: center!.id, grossAmount: 2_000, platformFee: 300, reserveAmount: 200, netAmount: 1_500,
      releaseAt: new Date(Date.now() + 86_400_000), status: "held", paymentReference: `LEGACY-${suffix}`,
    }).returning();
    const centerCancellation = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${centerCancellationSession!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "center cancellation" }),
    });
    assert.equal(centerCancellation.status, 200);
    assert.equal((await centerCancellation.json() as any).refundAmount, 7_000);
    for (const fixture of [centerPending, centerCaptured]) {
      assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, fixture.group.id)))[0]!.status, "cancelled");
      assert.equal((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, fixture.participant.id)))[0]!.status, "cancelled");
      assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, fixture.enrollment.id)))[0]!.status, "cancelled");
      const plan = await (await get(base, `/education/operations/bookings/${fixture.group.id}/payment-plan`, cookies[3]!)).json() as any;
      assert.ok(plan.netPaidAmount >= 0 && plan.outstandingAmount >= 0 && plan.refundedAmount >= 0);
      if (fixture.group.id === centerPending.group.id) {
        assert.equal(plan.refundedAmount, 0);
        assert.equal(plan.netPaidAmount, 0);
      } else {
        assert.equal(plan.refundedAmount, 5_000);
        assert.equal(plan.netPaidAmount, 0);
      }
    }
    assert.ok((await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, centerPending.snapshot.id))).every((row) => row.status === "cancelled"));
    const centerCapturedInstallments = await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, centerCaptured.snapshot.id));
    assert.equal(centerCapturedInstallments.find((row) => row.status === "settled")!.refundedAmount, 5_000);
    assert.equal(centerCapturedInstallments.find((row) => row.installmentNumber === 2)!.status, "cancelled");
    assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, centerCaptured.escrow!.id)))[0]!.status, "refunded");
    const cancelledLegacy = (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, legacyEnrollment!.id)))[0]!;
    assert.equal(cancelledLegacy.status, "cancelled");
    assert.equal(cancelledLegacy.paymentStatus, "refunded");
    assert.equal(cancelledLegacy.accessGrantedAt, null);
    assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, legacyEscrow!.id)))[0]!.status, "refunded");
    const legacyLedger = await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.escrowId, legacyEscrow!.id));
    const legacyEvents = await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.escrowId, legacyEscrow!.id));
    assert.equal(legacyLedger.length, 1); assert.equal(legacyLedger[0]!.amount, -2_000);
    assert.equal(legacyEvents.length, 1); assert.equal(legacyEvents[0]!.amount, -2_000);
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, centerPending.enrollment.id)))[0]!.paymentStatus, "pending");
    assert.equal((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, centerCaptured.enrollment.id)))[0]!.paymentStatus, "refunded");
    assert.equal((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, centerCancellationSession!.id)))[0]!.reservedSeats, 0);
    const centerOutbox = await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, centerCancellationSession!.id));
    assert.equal(new Set(centerOutbox.map((row) => row.dedupeKey)).size, centerOutbox.length);
    const legacyCancellationOutbox = centerOutbox.find((row) => row.dedupeKey.endsWith(`legacy-enrollment:${legacyEnrollment!.id}`));
    assert.ok(legacyCancellationOutbox);
    assert.equal((legacyCancellationOutbox!.payload as any).legacyRecipient.userId, unrelated!.id);
    const centerCancellationReplay = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${centerCancellationSession!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "center cancellation" }),
    });
    assert.equal(centerCancellationReplay.status, 200);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, centerCancellationSession!.id))).length, centerOutbox.length);
    assert.equal((await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.escrowId, legacyEscrow!.id))).length, 1);

    const [historicSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(Date.now() + 550_000_000), endsAt: new Date(Date.now() + 553_600_000), capacity: 2, reservedSeats: 2,
    }).returning();
    const historicCancelled = await createFinancialFixture("historic-cancelled", historicSession!.id, "refund", true);
    const historicLive = await createFinancialFixture("historic-live", historicSession!.id, "refund", true);
    const customerHistoricCancellation = await fetch(`${base}/api/education/operations/bookings/${historicCancelled.group.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "customer refund first" }),
    });
    assert.equal(customerHistoricCancellation.status, 200);
    const historicBeforeCenter = {
      group: (await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, historicCancelled.group.id)))[0],
      snapshot: (await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, historicCancelled.snapshot.id)))[0],
      installments: await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, historicCancelled.snapshot.id)),
      enrollment: (await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, historicCancelled.enrollment.id)))[0],
      escrow: (await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, historicCancelled.escrow!.id)))[0],
      ledger: await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.escrowId, historicCancelled.escrow!.id)),
      events: await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.escrowId, historicCancelled.escrow!.id)),
    };
    const historicCenterCancellation = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${historicSession!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "center cancels remaining live group" }),
    });
    assert.equal(historicCenterCancellation.status, 200);
    assert.equal((await historicCenterCancellation.json() as any).refundAmount, 5_000);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, historicLive.group.id)))[0]!.status, "cancelled");
    assert.equal((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, historicLive.escrow!.id)))[0]!.status, "refunded");
    assert.equal((await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.id, historicLive.installments[0]!.id)))[0]!.refundedAmount, 5_000);
    assert.deepEqual((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, historicCancelled.group.id)))[0], historicBeforeCenter.group);
    assert.deepEqual((await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, historicCancelled.snapshot.id)))[0], historicBeforeCenter.snapshot);
    assert.deepEqual(await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, historicCancelled.snapshot.id)), historicBeforeCenter.installments);
    assert.deepEqual((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, historicCancelled.enrollment.id)))[0], historicBeforeCenter.enrollment);
    assert.deepEqual((await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, historicCancelled.escrow!.id)))[0], historicBeforeCenter.escrow);
    assert.deepEqual(await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.escrowId, historicCancelled.escrow!.id)), historicBeforeCenter.ledger);
    assert.deepEqual(await db.select().from(educationFinancialEventsTable).where(eq(educationFinancialEventsTable.escrowId, historicCancelled.escrow!.id)), historicBeforeCenter.events);
    const historicOutboxCount = (await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, historicSession!.id))).length;
    const historicReplay = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${historicSession!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "center cancels remaining live group" }),
    });
    assert.equal(historicReplay.status, 200);
    assert.equal((await db.select().from(educationOutboxTable).where(eq(educationOutboxTable.sessionId, historicSession!.id))).length, historicOutboxCount);

    const [payoutSession] = await db.insert(courseSessionsTable).values({
      courseId: course!.id, startsAt: new Date(Date.now() + 600_000_000), endsAt: new Date(Date.now() + 603_600_000), capacity: 2, reservedSeats: 2,
    }).returning();
    const payoutSafe = await createFinancialFixture("payout-safe", payoutSession!.id, "refund", false);
    const payoutBlocked = await createFinancialFixture("payout-blocked", payoutSession!.id, "refund", true, true);
    const payoutBefore = {
      session: (await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, payoutSession!.id)))[0],
      groups: await db.select().from(educationBookingGroupsTable).where(inArray(educationBookingGroupsTable.id, [payoutSafe.group.id, payoutBlocked.group.id])),
      installments: await db.select().from(educationInstallmentsTable).where(inArray(educationInstallmentsTable.priceSnapshotId, [payoutSafe.snapshot.id, payoutBlocked.snapshot.id])),
    };
    const payoutCancellation = await fetch(`${base}/api/education/operations/centers/${center!.id}/sessions/${payoutSession!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[0]!, "content-type": "application/json" }, body: JSON.stringify({ reason: "must rollback" }),
    });
    assert.equal(payoutCancellation.status, 409);
    assert.deepEqual((await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, payoutSession!.id)))[0], payoutBefore.session);
    assert.deepEqual(await db.select().from(educationBookingGroupsTable).where(inArray(educationBookingGroupsTable.id, [payoutSafe.group.id, payoutBlocked.group.id])), payoutBefore.groups);
    assert.deepEqual(await db.select().from(educationInstallmentsTable).where(inArray(educationInstallmentsTable.priceSnapshotId, [payoutSafe.snapshot.id, payoutBlocked.snapshot.id])), payoutBefore.installments);

    const fullRefundCancellation = await fetch(`${base}/api/education/operations/bookings/${group!.id}/cancel`, {
      method: "POST", headers: { cookie: cookies[3]!, "content-type": "application/json" },
      body: JSON.stringify({ reason: "full refundable cancellation" }),
    });
    assert.equal(fullRefundCancellation.status, 200);
    const fullRefundBody = await fullRefundCancellation.json() as any;
    assert.equal(fullRefundBody.status, "cancelled");
    assert.equal(fullRefundBody.refundAmount, 10_000);
    assert.equal((await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, group!.id)))[0]!.status, "cancelled");
    assert.ok((await db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group!.id))).every((row) => row.status === "cancelled"));
    assert.ok((await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.bookingGroupId, group!.id))).every((row) => row.status === "cancelled"));
    assert.ok((await db.select().from(educationEscrowsTable).where(inArray(educationEscrowsTable.enrollmentId, cancellationInvariant.enrollments.map((row) => row.id)))).every((row) => row.status === "refunded"));
    assert.ok((await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot!.id))).every((row) => row.status !== "settled" || row.refundedAmount === row.amount));
    const refundedPlanResponse = await get(base, `/education/operations/bookings/${group!.id}/payment-plan`, cookies[3]!);
    assert.equal(refundedPlanResponse.status, 200);
    const refundedPlan = await refundedPlanResponse.json() as any;
    assert.equal(refundedPlan.refundedAmount, 10_000);
    assert.equal(refundedPlan.netPaidAmount, 0);
    assert.ok(refundedPlan.outstandingAmount >= 0);
    console.log("Operational privacy, settlement/reminder, and outbox retry integration tests passed.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((e) => e ? reject(e) : resolve()));
    if (ipsSettingsRestore) {
      if (ipsSettingsRestore.createdForTest) {
        await db.delete(educationPlatformSettingsTable).where(eq(educationPlatformSettingsTable.id, ipsSettingsRestore.id));
      } else {
        await db.update(educationPlatformSettingsTable).set({
          ipsRecipientName: ipsSettingsRestore.ipsRecipientName,
          ipsRecipientAccount: ipsSettingsRestore.ipsRecipientAccount,
          ipsPurpose: ipsSettingsRestore.ipsPurpose,
        }).where(eq(educationPlatformSettingsTable.id, ipsSettingsRestore.id));
      }
    }
    if (ids.length) {
      await cleanupFixtureUsers(ids);
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });