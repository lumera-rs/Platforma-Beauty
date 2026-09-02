/**
 * Communication archive integration tests.
 *
 * Covers:
 *   - Eligibility: unread notifications and non-terminal SMS are NOT archived.
 *   - Eligibility: read notifications older than cutoff ARE archived and deleted.
 *   - Eligibility: SMS with terminal status (sent/skipped) older than cutoff ARE archived.
 *   - Cutoff boundary: records exactly at the cutoff edge are NOT archived.
 *   - Idempotency: running the batch twice does not duplicate archive rows or error.
 *   - Concurrency: a second worker holding the advisory lock is safely skipped.
 *   - Payload snapshot: the archive row contains the expected JSONB fields.
 *
 * Each test manages its own fixture rows and cleans up in a finally block.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  educationNotificationArchivesTable,
  educationNotificationsTable,
  pool,
  salonNotificationArchivesTable,
  salonNotificationsTable,
  salonsTable,
  smsDeliveriesTable,
  smsDeliveryArchivesTable,
  usersTable,
} from "@workspace/db";
import { runCommunicationArchiveBatch } from "./communication-archive";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Returns a Date that is `days` calendar days in the past. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function createFixtureSalon(): Promise<string> {
  await ensureDemoData();
  const [owner] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (!owner) throw new Error("Archive test requires a seeded user.");
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Archive test salon ${randomUUID()}`,
    slug: `archive-test-${randomUUID()}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Archive Test 1",
    phone: "+381110000099",
    email: `archive-salon-${randomUUID()}@example.test`,
    shortDescription: "Salon za test arhiviranja.",
    description: "Izolovan salon za test arhiviranja komunikacije.",
    imageUrl: "/test.jpg",
  }).returning();
  if (!salon) throw new Error("Archive test could not create fixture salon.");
  return salon.id;
}

async function getFixtureUserId(): Promise<string> {
  await ensureDemoData();
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (!user) throw new Error("Archive test requires a seeded user.");
  return user.id;
}

// ---------------------------------------------------------------------------
// Test: salon notifications eligibility
// ---------------------------------------------------------------------------

async function testSalonNotificationEligibility(): Promise<void> {
  const salonId = await createFixtureSalon();
  const insertedIds: string[] = [];

  try {
    // Row 1: read + old → eligible
    const [readOld] = await db.insert(salonNotificationsTable).values({
      salonId,
      title: `Archive read old ${suffix}`,
      message: "Should be archived",
      readAt: daysAgo(95),
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(readOld);
    insertedIds.push(readOld.id);

    // Row 2: unread + old → NOT eligible (read_at IS NULL)
    const [unreadOld] = await db.insert(salonNotificationsTable).values({
      salonId,
      title: `Archive unread old ${suffix}`,
      message: "Should NOT be archived (unread)",
      readAt: null,
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(unreadOld);
    insertedIds.push(unreadOld.id);

    // Row 3: read + recent → NOT eligible (too recent)
    const [readRecent] = await db.insert(salonNotificationsTable).values({
      salonId,
      title: `Archive read recent ${suffix}`,
      message: "Should NOT be archived (recent)",
      readAt: daysAgo(1),
      createdAt: daysAgo(1),
    }).returning();
    assert.ok(readRecent);
    insertedIds.push(readRecent.id);

    const result = await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });
    assert.equal(result.skipped, false, "Archive batch must not be skipped in isolation.");

    // readOld: archived + deleted from source.
    const archivedReadOld = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, readOld.id));
    assert.equal(archivedReadOld.length, 1, "Read+old salon notification must be archived.");
    const stillExistsReadOld = await db.select().from(salonNotificationsTable)
      .where(eq(salonNotificationsTable.id, readOld.id));
    assert.equal(stillExistsReadOld.length, 0, "Archived salon notification must be deleted from source.");

    // unreadOld: must remain in source, no archive entry.
    const archivedUnreadOld = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, unreadOld.id));
    assert.equal(archivedUnreadOld.length, 0, "Unread salon notification must NOT be archived.");
    const stillExistsUnreadOld = await db.select().from(salonNotificationsTable)
      .where(eq(salonNotificationsTable.id, unreadOld.id));
    assert.equal(stillExistsUnreadOld.length, 1, "Unread salon notification must remain in source.");

    // readRecent: must remain in source, no archive entry.
    const archivedReadRecent = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, readRecent.id));
    assert.equal(archivedReadRecent.length, 0, "Recent salon notification must NOT be archived.");
    const stillExistsReadRecent = await db.select().from(salonNotificationsTable)
      .where(eq(salonNotificationsTable.id, readRecent.id));
    assert.equal(stillExistsReadRecent.length, 1, "Recent salon notification must remain in source.");

    assert.ok(
      result.salonNotifications.archived >= 1,
      "Summary must report at least 1 archived salon notification.",
    );
    assert.ok(
      result.salonNotifications.deleted >= 1,
      "Summary must report at least 1 deleted salon notification.",
    );
  } finally {
    if (insertedIds.length) {
      await db.delete(salonNotificationArchivesTable)
        .where(inArray(salonNotificationArchivesTable.sourceId, insertedIds));
      await db.delete(salonNotificationsTable)
        .where(inArray(salonNotificationsTable.id, insertedIds));
    }
    await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  }
}

// ---------------------------------------------------------------------------
// Test: education notifications eligibility
// ---------------------------------------------------------------------------

async function testEducationNotificationEligibility(): Promise<void> {
  const userId = await getFixtureUserId();
  const insertedIds: string[] = [];
  const insertedEventKeys: string[] = [];

  try {
    const readOldEventKey = `archive-edu-read-old-${suffix}`;
    const unreadOldEventKey = `archive-edu-unread-old-${suffix}`;

    // Row 1: read + old → eligible
    const [readOld] = await db.insert(educationNotificationsTable).values({
      userId,
      type: "archive_test",
      title: `Edu archive read old ${suffix}`,
      body: "Should be archived",
      eventKey: readOldEventKey,
      readAt: daysAgo(95),
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(readOld);
    insertedIds.push(readOld.id);
    insertedEventKeys.push(readOldEventKey);

    // Row 2: unread + old → NOT eligible
    const [unreadOld] = await db.insert(educationNotificationsTable).values({
      userId,
      type: "archive_test",
      title: `Edu archive unread old ${suffix}`,
      body: "Should NOT be archived (unread)",
      eventKey: unreadOldEventKey,
      readAt: null,
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(unreadOld);
    insertedIds.push(unreadOld.id);
    insertedEventKeys.push(unreadOldEventKey);

    const result = await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });
    assert.equal(result.skipped, false);

    const archivedReadOld = await db.select().from(educationNotificationArchivesTable)
      .where(eq(educationNotificationArchivesTable.sourceId, readOldEventKey));
    assert.equal(archivedReadOld.length, 1, "Read+old education notification must be archived.");
    const stillExistsReadOld = await db.select().from(educationNotificationsTable)
      .where(eq(educationNotificationsTable.id, readOld.id));
    assert.equal(stillExistsReadOld.length, 0, "Archived education notification must be deleted from source.");

    const archivedUnreadOld = await db.select().from(educationNotificationArchivesTable)
      .where(eq(educationNotificationArchivesTable.sourceId, unreadOldEventKey));
    assert.equal(archivedUnreadOld.length, 0, "Unread education notification must NOT be archived.");
    const stillExistsUnreadOld = await db.select().from(educationNotificationsTable)
      .where(eq(educationNotificationsTable.id, unreadOld.id));
    assert.equal(stillExistsUnreadOld.length, 1, "Unread education notification must remain in source.");
  } finally {
    if (insertedEventKeys.length) {
      await db.delete(educationNotificationArchivesTable)
        .where(inArray(educationNotificationArchivesTable.sourceId, insertedEventKeys));
    }
    if (insertedIds.length) {
      await db.delete(educationNotificationsTable)
        .where(inArray(educationNotificationsTable.id, insertedIds));
    }
  }
}

// ---------------------------------------------------------------------------
// Test: SMS deliveries eligibility
// ---------------------------------------------------------------------------

async function testSmsDeliveryEligibility(): Promise<void> {
  const salonId = await createFixtureSalon();
  const insertedIds: string[] = [];
  const insertedEventKeys: string[] = [];

  try {
    const sentOldKey = `archive-sms-sent-old-${suffix}`;
    const skippedOldKey = `archive-sms-skipped-old-${suffix}`;
    const queuedOldKey = `archive-sms-queued-old-${suffix}`;
    const failedOldKey = `archive-sms-failed-old-${suffix}`;
    const sentRecentKey = `archive-sms-sent-recent-${suffix}`;

    // Row 1: sent + old → eligible (terminal delivered)
    const [sentOld] = await db.insert(smsDeliveriesTable).values({
      eventKey: sentOldKey,
      salonId,
      messageType: "appointment_confirmation",
      recipientPhone: "+381600000001",
      body: "Sent old SMS",
      status: "sent",
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(sentOld);
    insertedIds.push(sentOld.id);
    insertedEventKeys.push(sentOldKey);

    // Row 2: skipped + old → eligible (terminal skipped)
    const [skippedOld] = await db.insert(smsDeliveriesTable).values({
      eventKey: skippedOldKey,
      salonId,
      messageType: "appointment_confirmation",
      recipientPhone: "+381600000002",
      body: "Skipped old SMS",
      status: "skipped",
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(skippedOld);
    insertedIds.push(skippedOld.id);
    insertedEventKeys.push(skippedOldKey);

    // Row 3: queued + old → NOT eligible (never archive queued)
    const [queuedOld] = await db.insert(smsDeliveriesTable).values({
      eventKey: queuedOldKey,
      salonId,
      messageType: "appointment_confirmation",
      recipientPhone: "+381600000003",
      body: "Queued old SMS",
      status: "queued",
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(queuedOld);
    insertedIds.push(queuedOld.id);
    insertedEventKeys.push(queuedOldKey);

    // Row 4: failed + old → NOT eligible (never archive failed)
    const [failedOld] = await db.insert(smsDeliveriesTable).values({
      eventKey: failedOldKey,
      salonId,
      messageType: "appointment_confirmation",
      recipientPhone: "+381600000004",
      body: "Failed old SMS",
      status: "failed",
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(failedOld);
    insertedIds.push(failedOld.id);
    insertedEventKeys.push(failedOldKey);

    // Row 5: sent + recent → NOT eligible (too recent)
    const [sentRecent] = await db.insert(smsDeliveriesTable).values({
      eventKey: sentRecentKey,
      salonId,
      messageType: "appointment_confirmation",
      recipientPhone: "+381600000005",
      body: "Sent recent SMS",
      status: "sent",
      createdAt: daysAgo(1),
    }).returning();
    assert.ok(sentRecent);
    insertedIds.push(sentRecent.id);
    insertedEventKeys.push(sentRecentKey);

    const result = await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });
    assert.equal(result.skipped, false);

    // sentOld: archived and deleted
    const archivedSent = await db.select().from(smsDeliveryArchivesTable)
      .where(eq(smsDeliveryArchivesTable.sourceId, sentOldKey));
    assert.equal(archivedSent.length, 1, "Sent+old SMS must be archived.");
    const stillExistsSent = await db.select().from(smsDeliveriesTable)
      .where(eq(smsDeliveriesTable.id, sentOld.id));
    assert.equal(stillExistsSent.length, 0, "Archived sent SMS must be deleted from source.");

    // skippedOld: archived and deleted
    const archivedSkipped = await db.select().from(smsDeliveryArchivesTable)
      .where(eq(smsDeliveryArchivesTable.sourceId, skippedOldKey));
    assert.equal(archivedSkipped.length, 1, "Skipped+old SMS must be archived.");
    const stillExistsSkipped = await db.select().from(smsDeliveriesTable)
      .where(eq(smsDeliveriesTable.id, skippedOld.id));
    assert.equal(stillExistsSkipped.length, 0, "Archived skipped SMS must be deleted from source.");

    // queued: never archived
    const archivedQueued = await db.select().from(smsDeliveryArchivesTable)
      .where(eq(smsDeliveryArchivesTable.sourceId, queuedOldKey));
    assert.equal(archivedQueued.length, 0, "Queued SMS must NOT be archived.");

    // failed: never archived
    const archivedFailed = await db.select().from(smsDeliveryArchivesTable)
      .where(eq(smsDeliveryArchivesTable.sourceId, failedOldKey));
    assert.equal(archivedFailed.length, 0, "Failed SMS must NOT be archived.");

    // recent: not eligible yet
    const archivedRecent = await db.select().from(smsDeliveryArchivesTable)
      .where(eq(smsDeliveryArchivesTable.sourceId, sentRecentKey));
    assert.equal(archivedRecent.length, 0, "Recent sent SMS must NOT be archived.");

    assert.ok(
      result.smsDeliveries.archived >= 2,
      "Summary must report at least 2 archived SMS (sent + skipped).",
    );
    assert.ok(
      result.smsDeliveries.deleted >= 2,
      "Summary must report at least 2 deleted SMS.",
    );
  } finally {
    if (insertedEventKeys.length) {
      await db.delete(smsDeliveryArchivesTable)
        .where(inArray(smsDeliveryArchivesTable.sourceId, insertedEventKeys));
    }
    if (insertedIds.length) {
      await db.delete(smsDeliveriesTable)
        .where(inArray(smsDeliveriesTable.id, insertedIds));
    }
    await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  }
}

// ---------------------------------------------------------------------------
// Test: idempotency — running the batch twice produces no duplicates
// ---------------------------------------------------------------------------

async function testIdempotency(): Promise<void> {
  const salonId = await createFixtureSalon();
  const insertedIds: string[] = [];

  try {
    const [row] = await db.insert(salonNotificationsTable).values({
      salonId,
      title: `Archive idempotency ${suffix}`,
      message: "Run twice test",
      readAt: daysAgo(95),
      createdAt: daysAgo(95),
    }).returning();
    assert.ok(row);
    insertedIds.push(row.id);

    // First run: should archive and delete.
    const first = await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });
    assert.equal(first.skipped, false);

    const afterFirst = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, row.id));
    assert.equal(afterFirst.length, 1, "First batch run must create exactly one archive entry.");

    const stillInSource = await db.select().from(salonNotificationsTable)
      .where(eq(salonNotificationsTable.id, row.id));
    assert.equal(stillInSource.length, 0, "Row must be deleted from source after first run.");

    // Second run: source row is gone; archive must stay at exactly 1 entry.
    const second = await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });
    assert.equal(second.skipped, false);

    const afterSecond = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, row.id));
    assert.equal(afterSecond.length, 1, "Second batch run must not duplicate the archive entry.");
  } finally {
    if (insertedIds.length) {
      await db.delete(salonNotificationArchivesTable)
        .where(inArray(salonNotificationArchivesTable.sourceId, insertedIds));
      await db.delete(salonNotificationsTable)
        .where(inArray(salonNotificationsTable.id, insertedIds));
    }
    await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  }
}

// ---------------------------------------------------------------------------
// Test: cutoff boundary — records exactly at the cutoff are NOT archived
// ---------------------------------------------------------------------------

async function testCutoffBoundary(): Promise<void> {
  const salonId = await createFixtureSalon();
  const insertedIds: string[] = [];

  try {
    // A record whose created_at equals exactly `now - 90 days` must NOT be
    // archived because the condition is `created_at < cutoffAt` (strict less-than).
    const borderDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [borderRow] = await db.insert(salonNotificationsTable).values({
      salonId,
      title: `Archive boundary ${suffix}`,
      message: "Boundary test",
      readAt: borderDate,
      createdAt: borderDate,
    }).returning();
    assert.ok(borderRow);
    insertedIds.push(borderRow.id);

    await runCommunicationArchiveBatch({
      batchSize: 500,
      cutoffDays: 90,
      referenceTime: new Date(borderDate.getTime() + 90 * 24 * 60 * 60 * 1000),
    });

    const archived = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, borderRow.id));
    assert.equal(archived.length, 0, "A row exactly at the 90-day cutoff must NOT be archived.");

    const stillInSource = await db.select().from(salonNotificationsTable)
      .where(eq(salonNotificationsTable.id, borderRow.id));
    assert.equal(stillInSource.length, 1, "A row exactly at the cutoff must remain in the source table.");
  } finally {
    if (insertedIds.length) {
      await db.delete(salonNotificationArchivesTable)
        .where(inArray(salonNotificationArchivesTable.sourceId, insertedIds));
      await db.delete(salonNotificationsTable)
        .where(inArray(salonNotificationsTable.id, insertedIds));
    }
    await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  }
}

// ---------------------------------------------------------------------------
// Test: concurrent workers — second worker skips without error
// ---------------------------------------------------------------------------

async function testConcurrentWorkers(): Promise<void> {
  const lockKey = "lumera:communication-archive";

  // Hold the session-level advisory lock on a separate pg client to simulate
  // another worker that is already running the batch.
  const lockClient = await pool.connect();
  let lockHeld = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    lockHeld = true;

    // The batch call must see the lock is taken and return skipped: true
    // rather than blocking or erroring.
    const result = await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });
    assert.equal(result.skipped, true, "Batch must be skipped when the advisory lock is held.");
    assert.equal(result.salonNotifications.archived, 0, "Skipped batch must report 0 archived salon notifications.");
    assert.equal(result.educationNotifications.archived, 0, "Skipped batch must report 0 archived education notifications.");
    assert.equal(result.smsDeliveries.archived, 0, "Skipped batch must report 0 archived SMS deliveries.");
  } finally {
    if (lockHeld) {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
    lockClient.release();
  }
}

// ---------------------------------------------------------------------------
// Test: payload snapshot contains expected fields
// ---------------------------------------------------------------------------

async function testPayloadSnapshot(): Promise<void> {
  const salonId = await createFixtureSalon();
  const insertedIds: string[] = [];

  try {
    const [row] = await db.insert(salonNotificationsTable).values({
      salonId,
      title: `Archive snapshot ${suffix}`,
      message: "Snapshot test message",
      href: "/test-href",
      readAt: daysAgo(91),
      createdAt: daysAgo(91),
    }).returning();
    assert.ok(row);
    insertedIds.push(row.id);

    await runCommunicationArchiveBatch({ batchSize: 500, cutoffDays: 90 });

    const [archiveRow] = await db.select().from(salonNotificationArchivesTable)
      .where(eq(salonNotificationArchivesTable.sourceId, row.id));
    assert.ok(archiveRow, "Archive row must exist after batch.");

    const payload = archiveRow.payload as Record<string, unknown>;
    assert.equal(payload.id, row.id, "Payload must include the original row id.");
    assert.equal(payload.salon_id, salonId, "Payload must include salon_id.");
    assert.equal(payload.title, `Archive snapshot ${suffix}`, "Payload must include title.");
    assert.equal(payload.message, "Snapshot test message", "Payload must include message.");
    assert.equal(payload.href, "/test-href", "Payload must include href.");
    assert.ok(payload.read_at, "Payload must include read_at.");
  } finally {
    if (insertedIds.length) {
      await db.delete(salonNotificationArchivesTable)
        .where(inArray(salonNotificationArchivesTable.sourceId, insertedIds));
      await db.delete(salonNotificationsTable)
        .where(inArray(salonNotificationsTable.id, insertedIds));
    }
    await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  try {
    await testSalonNotificationEligibility();
    console.log("✓ Salon notification eligibility");

    await testEducationNotificationEligibility();
    console.log("✓ Education notification eligibility");

    await testSmsDeliveryEligibility();
    console.log("✓ SMS delivery eligibility");

    await testIdempotency();
    console.log("✓ Idempotency (double-run)");

    await testCutoffBoundary();
    console.log("✓ Cutoff boundary");

    await testConcurrentWorkers();
    console.log("✓ Concurrent workers (advisory lock skip)");

    await testPayloadSnapshot();
    console.log("✓ Payload snapshot fields");

    console.log("Communication archive regression passed.");
  } finally {
    await pool.end();
  }
}

await run();
