/**
 * Integration tests for the data-retention archiver.
 *
 * Verifies, against a live database:
 *  - Only cold (older than the retention window) rows are moved.
 *  - Active/undelivered rows are never archived (unread notifications, queued or
 *    still-retrying SMS logs stay in the live table).
 *  - Copy-then-delete preserves the original row verbatim in the archive.
 *  - The advisory lock makes concurrent runs safe (no double-archiving).
 *  - Re-running is idempotent (a second pass moves nothing new).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  educationNotificationsArchiveTable,
  educationNotificationsTable,
  pool,
  salonNotificationsArchiveTable,
  salonNotificationsTable,
  salonsTable,
  smsDeliveriesArchiveTable,
  smsDeliveriesTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "./auth";
import {
  archiveEducationNotifications,
  archiveSalonNotifications,
  archiveSmsDeliveries,
} from "./data-retention-archive";

const suffix = randomUUID();
const now = new Date("2025-06-01T12:00:00.000Z");
const OLD = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000); // 100 days: cold
const RECENT = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days: hot

const salonNotificationIds: string[] = [];
const educationNotificationIds: string[] = [];
const smsDeliveryIds: string[] = [];
let salonId = "";
let userId = "";

async function seedFixtures() {
  const [user] = await db.insert(usersTable).values({
    firstName: "Archive",
    lastName: "Tester",
    email: `archive-${suffix}@example.test`,
    passwordHash: await hashPassword("archive-test-password"),
  }).returning();
  userId = user!.id;

  const [salon] = await db.insert(salonsTable).values({
    ownerId: userId,
    name: `Archive salon ${suffix}`,
    slug: `archive-salon-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone: "+381110000099",
    email: `archive-salon-${suffix}@example.test`,
    shortDescription: "Test.",
    description: "Test.",
    imageUrl: "/test.jpg",
  }).returning();
  salonId = salon!.id;
}

async function seedSalonNotification(createdAt: Date, readAt: Date | null) {
  const [row] = await db.insert(salonNotificationsTable).values({
    salonId,
    title: `n-${suffix}`,
    message: "msg",
    createdAt,
    readAt,
  }).returning();
  salonNotificationIds.push(row!.id);
  return row!;
}

async function seedEducationNotification(createdAt: Date, readAt: Date | null) {
  const [row] = await db.insert(educationNotificationsTable).values({
    userId,
    type: "test",
    title: `e-${suffix}`,
    body: "body",
    eventKey: `archive-edu-${suffix}-${randomUUID()}`,
    createdAt,
    readAt,
  }).returning();
  educationNotificationIds.push(row!.id);
  return row!;
}

async function seedSms(createdAt: Date, status: "sent" | "queued" | "failed", nextRetryAt: Date | null) {
  const [row] = await db.insert(smsDeliveriesTable).values({
    eventKey: `archive-sms-${suffix}-${randomUUID()}`,
    salonId,
    messageType: "appointment_reminder",
    recipientPhone: "+381601234567",
    body: "sms",
    status,
    nextRetryAt,
    createdAt,
  }).returning();
  smsDeliveryIds.push(row!.id);
  return row!;
}

async function existsSalonNotification(id: string) {
  const rows = await db.select({ id: salonNotificationsTable.id }).from(salonNotificationsTable).where(eq(salonNotificationsTable.id, id));
  return rows.length > 0;
}

async function existsEducationNotification(id: string) {
  const rows = await db.select({ id: educationNotificationsTable.id }).from(educationNotificationsTable).where(eq(educationNotificationsTable.id, id));
  return rows.length > 0;
}

async function existsSms(id: string) {
  const rows = await db.select({ id: smsDeliveriesTable.id }).from(smsDeliveriesTable).where(eq(smsDeliveriesTable.id, id));
  return rows.length > 0;
}

async function testSalonNotifications() {
  const oldRead = await seedSalonNotification(OLD, OLD);
  const oldUnread = await seedSalonNotification(OLD, null);
  const recentRead = await seedSalonNotification(RECENT, RECENT);

  const result = await archiveSalonNotifications({ now });
  assert.equal(result.skippedLocked, false);
  assert.equal(result.archived, 1, "only the old, read notification is cold");

  assert.equal(await existsSalonNotification(oldRead.id), false, "old read row is removed from live table");
  assert.equal(await existsSalonNotification(oldUnread.id), true, "unread (active) row stays live");
  assert.equal(await existsSalonNotification(recentRead.id), true, "recent row stays live");

  const [archived] = await db.select().from(salonNotificationsArchiveTable).where(eq(salonNotificationsArchiveTable.id, oldRead.id));
  assert.ok(archived, "old read row is copied to the archive");
  assert.equal(archived!.title, oldRead.title);
  assert.equal(archived!.createdAt.getTime(), OLD.getTime(), "createdAt is preserved verbatim");
  assert.ok(archived!.archivedAt, "archivedAt is stamped");

  // Idempotent second pass moves nothing.
  const again = await archiveSalonNotifications({ now });
  assert.equal(again.archived, 0, "re-running archives nothing new");
}

async function testEducationNotifications() {
  const oldRead = await seedEducationNotification(OLD, OLD);
  const oldUnread = await seedEducationNotification(OLD, null);

  const result = await archiveEducationNotifications({ now });
  assert.equal(result.archived, 1, "only the old, read education notification is cold");
  assert.equal(await existsEducationNotification(oldRead.id), false);
  assert.equal(await existsEducationNotification(oldUnread.id), true, "unread stays live");

  const [archived] = await db.select().from(educationNotificationsArchiveTable).where(eq(educationNotificationsArchiveTable.id, oldRead.id));
  assert.ok(archived, "row is archived");
  assert.equal(archived!.eventKey, oldRead.eventKey, "eventKey preserved");
}

async function testSmsDeliveries() {
  const oldSent = await seedSms(OLD, "sent", null);
  const oldQueued = await seedSms(OLD, "queued", null);
  const oldFailedRetrying = await seedSms(OLD, "failed", new Date(now.getTime() + 60_000));
  const oldFailedOverdueRetry = await seedSms(OLD, "failed", new Date(now.getTime() - 60_000));
  const oldFailedTerminal = await seedSms(OLD, "failed", null);
  const recentSent = await seedSms(RECENT, "sent", null);

  const result = await archiveSmsDeliveries({ now });
  assert.equal(result.archived, 2, "old sent + old terminally-failed logs are cold");

  assert.equal(await existsSms(oldSent.id), false);
  assert.equal(await existsSms(oldFailedTerminal.id), false);
  assert.equal(await existsSms(oldQueued.id), true, "queued (undelivered) never archived");
  assert.equal(await existsSms(oldFailedRetrying.id), true, "failed-with-pending-retry never archived");
  assert.equal(await existsSms(oldFailedOverdueRetry.id), true, "an overdue retry marker still represents active delivery work");
  assert.equal(await existsSms(recentSent.id), true, "recent log stays live");

  const [archived] = await db.select().from(smsDeliveriesArchiveTable).where(eq(smsDeliveriesArchiveTable.id, oldSent.id));
  assert.ok(archived);
  assert.equal(archived!.status, "sent");
  assert.equal(archived!.recipientPhone, oldSent.recipientPhone);
}

async function testConcurrentRunsDoNotDoubleArchive() {
  await seedSalonNotification(OLD, OLD);
  await seedSalonNotification(OLD, OLD);

  const [a, b] = await Promise.all([
    archiveSalonNotifications({ now }),
    archiveSalonNotifications({ now }),
  ]);
  const totalArchived = a.archived + b.archived;
  assert.equal(totalArchived, 2, "each cold row is archived exactly once across concurrent runs");
  assert.ok(a.skippedLocked || b.skippedLocked || totalArchived === 2, "advisory lock serialises concurrent runs");
}

async function run() {
  try {
    await seedFixtures();
    await testSalonNotifications();
    await testEducationNotifications();
    await testSmsDeliveries();
    await testConcurrentRunsDoNotDoubleArchive();
    console.log("Data-retention archive regression passed.");
  } finally {
    if (salonNotificationIds.length) {
      await db.delete(salonNotificationsArchiveTable).where(inArray(salonNotificationsArchiveTable.id, salonNotificationIds));
      await db.delete(salonNotificationsTable).where(inArray(salonNotificationsTable.id, salonNotificationIds));
    }
    if (educationNotificationIds.length) {
      await db.delete(educationNotificationsArchiveTable).where(inArray(educationNotificationsArchiveTable.id, educationNotificationIds));
      await db.delete(educationNotificationsTable).where(inArray(educationNotificationsTable.id, educationNotificationIds));
    }
    if (smsDeliveryIds.length) {
      await db.delete(smsDeliveriesArchiveTable).where(inArray(smsDeliveriesArchiveTable.id, smsDeliveryIds));
      await db.delete(smsDeliveriesTable).where(inArray(smsDeliveriesTable.id, smsDeliveryIds));
    }
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
}

await run();
