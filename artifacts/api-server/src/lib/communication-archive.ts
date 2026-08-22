import { inArray, sql } from "drizzle-orm";
import {
  db,
  educationNotificationArchivesTable,
  educationNotificationsTable,
  pool,
  salonNotificationArchivesTable,
  salonNotificationsTable,
  smsDeliveriesTable,
  smsDeliveryArchivesTable,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * PostgreSQL advisory lock key for the communication archive batch.
 * Only one process may run the archive batch at a time.
 */
const ARCHIVE_LOCK_KEY = "lumera:communication-archive";

/**
 * Number of days after which records become eligible for archiving.
 */
const DEFAULT_CUTOFF_DAYS = 90;

/**
 * Maximum rows processed per source table per run (configurable).
 */
const DEFAULT_BATCH_SIZE = 500;

export type CommunicationArchiveOptions = {
  /**
   * Maximum rows to archive per source table. Defaults to 500.
   */
  batchSize?: number;
  /**
   * Records older than this many days are eligible. Defaults to 90.
   */
  cutoffDays?: number;
  /**
   * Stable clock boundary for deterministic jobs/tests. Defaults to now.
   */
  referenceTime?: Date;
};

export type CommunicationArchiveSourceSummary = {
  /** Number of rows confirmed in the archive table. */
  archived: number;
  /** Number of rows deleted from the source table. */
  deleted: number;
};

export type CommunicationArchiveSummary = {
  salonNotifications: CommunicationArchiveSourceSummary;
  educationNotifications: CommunicationArchiveSourceSummary;
  smsDeliveries: CommunicationArchiveSourceSummary;
  /** Whether the advisory lock was held by another process and the batch was skipped. */
  skipped: boolean;
};

// ---------------------------------------------------------------------------
// Per-source archive implementations
// ---------------------------------------------------------------------------

/**
 * Archives eligible salon_notifications rows within one transaction.
 *
 * Archive table: salon_notification_archives
 *   source_id          TEXT UNIQUE → salon_notifications.id (stored as text)
 *   payload            JSONB       → row_to_json snapshot of the source row
 *   original_created_at            → source created_at
 *
 * Eligibility: read_at IS NOT NULL AND created_at < cutoffAt.
 *
 * Steps (all inside one transaction):
 *   1. SELECT … FOR UPDATE SKIP LOCKED (bounded by batchSize).
 *   2. INSERT INTO archive … ON CONFLICT (source_id) DO NOTHING — idempotent.
 *   3. Verify every selected source_id exists in the archive table.
 *   4. DELETE only verified IDs from the source table.
 */
async function archiveSalonNotificationsBatch(
  batchSize: number,
  cutoffAt: Date,
): Promise<CommunicationArchiveSourceSummary> {
  return db.transaction(async (tx) => {
    // 1. Select eligible rows with a row lock (SKIP LOCKED makes concurrent workers safe).
    const selected = await tx.execute<{ id: string; created_at: Date }>(sql`
      SELECT id, created_at
      FROM salon_notifications
      WHERE read_at IS NOT NULL
        AND created_at < ${cutoffAt}
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);

    if (selected.rows.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    const rows = selected.rows;
    const ids = rows.map((r) => r.id);

    // 2. Copy as JSONB snapshot, idempotent via ON CONFLICT (source_id) DO NOTHING.
    //    Keep the selected IDs parameterized rather than constructing SQL text.
    await tx.execute(sql`
      INSERT INTO salon_notification_archives (source_id, payload, original_created_at)
      SELECT
        sn.id::text,
        row_to_json(sn)::jsonb,
        sn.created_at
      FROM salon_notifications sn
      WHERE sn.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      ON CONFLICT (source_id) DO NOTHING
    `);

    // 3. Verify every selected id now exists in the archive.
    const verified = await tx.select({ sourceId: salonNotificationArchivesTable.sourceId })
      .from(salonNotificationArchivesTable)
      .where(inArray(salonNotificationArchivesTable.sourceId, ids));
    const verifiedSet = new Set(verified.map((r) => r.sourceId));
    const safeToDelete = ids.filter((id) => verifiedSet.has(id));

    if (safeToDelete.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    // 4. Delete only verified rows.
    const deleted = await tx.delete(salonNotificationsTable)
      .where(inArray(salonNotificationsTable.id, safeToDelete))
      .returning({ id: salonNotificationsTable.id });

    return {
      archived: verifiedSet.size,
      deleted: deleted.length,
    };
  });
}

/**
 * Archives eligible education_notifications rows within one transaction.
 *
 * Archive table: education_notification_archives
 *   source_id          TEXT UNIQUE → education_notifications.event_key
 *   payload            JSONB       → row_to_json snapshot
 *   original_created_at            → source created_at
 *
 * Eligibility: read_at IS NOT NULL AND created_at < cutoffAt.
 */
async function archiveEducationNotificationsBatch(
  batchSize: number,
  cutoffAt: Date,
): Promise<CommunicationArchiveSourceSummary> {
  return db.transaction(async (tx) => {
    const selected = await tx.execute<{ id: string; event_key: string; created_at: Date }>(sql`
      SELECT id, event_key, created_at
      FROM education_notifications
      WHERE read_at IS NOT NULL
        AND created_at < ${cutoffAt}
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);

    if (selected.rows.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    const rows = selected.rows;
    const ids = rows.map((r) => r.id);
    const eventKeys = rows.map((r) => r.event_key);

    await tx.execute(sql`
      INSERT INTO education_notification_archives (source_id, payload, original_created_at)
      SELECT
        en.event_key,
        row_to_json(en)::jsonb,
        en.created_at
      FROM education_notifications en
      WHERE en.event_key IN (${sql.join(eventKeys.map((key) => sql`${key}`), sql`, `)})
      ON CONFLICT (source_id) DO NOTHING
    `);

    const verified = await tx.select({ sourceId: educationNotificationArchivesTable.sourceId })
      .from(educationNotificationArchivesTable)
      .where(inArray(educationNotificationArchivesTable.sourceId, eventKeys));
    const verifiedSet = new Set(verified.map((r) => r.sourceId));
    const safeToDelete = rows
      .filter((r) => verifiedSet.has(r.event_key))
      .map((r) => r.id);

    if (safeToDelete.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    const deleted = await tx.delete(educationNotificationsTable)
      .where(inArray(educationNotificationsTable.id, safeToDelete))
      .returning({ id: educationNotificationsTable.id });

    return {
      archived: verifiedSet.size,
      deleted: deleted.length,
    };
  });
}

/**
 * Archives eligible sms_deliveries rows within one transaction.
 *
 * Archive table: sms_delivery_archives
 *   source_id          TEXT UNIQUE → sms_deliveries.event_key
 *   payload            JSONB       → row_to_json snapshot
 *   original_created_at            → source created_at
 *
 * Eligibility: status IN ('sent', 'skipped') AND created_at < cutoffAt.
 * Rows with status 'queued', 'failed' are never archived.
 */
async function archiveSmsDeliveriesBatch(
  batchSize: number,
  cutoffAt: Date,
): Promise<CommunicationArchiveSourceSummary> {
  return db.transaction(async (tx) => {
    const selected = await tx.execute<{ id: string; event_key: string; created_at: Date }>(sql`
      SELECT id, event_key, created_at
      FROM sms_deliveries
      WHERE status IN ('sent', 'skipped')
        AND created_at < ${cutoffAt}
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);

    if (selected.rows.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    const rows = selected.rows;
    const ids = rows.map((r) => r.id);
    const eventKeys = rows.map((r) => r.event_key);

    await tx.execute(sql`
      INSERT INTO sms_delivery_archives (source_id, payload, original_created_at)
      SELECT
        sd.event_key,
        row_to_json(sd)::jsonb,
        sd.created_at
      FROM sms_deliveries sd
      WHERE sd.event_key IN (${sql.join(eventKeys.map((key) => sql`${key}`), sql`, `)})
      ON CONFLICT (source_id) DO NOTHING
    `);

    const verified = await tx.select({ sourceId: smsDeliveryArchivesTable.sourceId })
      .from(smsDeliveryArchivesTable)
      .where(inArray(smsDeliveryArchivesTable.sourceId, eventKeys));
    const verifiedSet = new Set(verified.map((r) => r.sourceId));
    const safeToDelete = rows
      .filter((r) => verifiedSet.has(r.event_key))
      .map((r) => r.id);

    if (safeToDelete.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    const deleted = await tx.delete(smsDeliveriesTable)
      .where(inArray(smsDeliveriesTable.id, safeToDelete))
      .returning({ id: smsDeliveriesTable.id });

    return {
      archived: verifiedSet.size,
      deleted: deleted.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs one archive batch across all three communication sources:
 *   - salon_notifications     → salon_notification_archives
 *     (eligible when read_at IS NOT NULL)
 *   - education_notifications → education_notification_archives
 *     (eligible when read_at IS NOT NULL)
 *   - sms_deliveries          → sms_delivery_archives
 *     (eligible when status IN ('sent', 'skipped'))
 *
 * All sources must have created_at older than `cutoffDays` (default 90).
 *
 * Protected by a PostgreSQL session-level advisory lock so concurrent
 * workers are harmless — a second caller skips and returns skipped: true.
 *
 * For each source, within a single transaction:
 *   1. SELECT … FOR UPDATE SKIP LOCKED (bounded by batchSize)
 *   2. INSERT INTO archive … ON CONFLICT (source_id) DO NOTHING
 *   3. Verify every selected source_id exists in the archive
 *   4. DELETE only verified IDs from the source table
 *
 * No runtime DDL is performed.
 */
export async function runCommunicationArchiveBatch(
  options: CommunicationArchiveOptions = {},
): Promise<CommunicationArchiveSummary> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoffDays = options.cutoffDays ?? DEFAULT_CUTOFF_DAYS;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5_000) {
    throw new RangeError("Communication archive batchSize must be an integer from 1 to 5000.");
  }
  if (!Number.isInteger(cutoffDays) || cutoffDays < 1 || cutoffDays > 3_650) {
    throw new RangeError("Communication archive cutoffDays must be an integer from 1 to 3650.");
  }
  const referenceTime = options.referenceTime ?? new Date();
  if (!Number.isFinite(referenceTime.getTime())) {
    throw new RangeError("Communication archive referenceTime must be a valid date.");
  }
  const cutoffAt = new Date(referenceTime.getTime() - cutoffDays * 24 * 60 * 60 * 1000);

  const empty: CommunicationArchiveSourceSummary = { archived: 0, deleted: 0 };

  // Acquire a session-level advisory lock (non-blocking try).
  // pg_try_advisory_lock returns true immediately if the lock is available;
  // false if another session holds it.
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [ARCHIVE_LOCK_KEY],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;

    if (!lockAcquired) {
      logger.info(
        { lockKey: ARCHIVE_LOCK_KEY },
        "Communication archive batch skipped — another worker holds the advisory lock",
      );
      return {
        salonNotifications: empty,
        educationNotifications: empty,
        smsDeliveries: empty,
        skipped: true,
      };
    }

    logger.info(
      { batchSize, cutoffDays, cutoffAt },
      "Communication archive batch started",
    );

    // Each source runs in its own transaction to keep batch sizes bounded
    // and to allow partial progress when the batch is large.
    const [salonNotifications, educationNotifications, smsDeliveries] = await Promise.all([
      archiveSalonNotificationsBatch(batchSize, cutoffAt),
      archiveEducationNotificationsBatch(batchSize, cutoffAt),
      archiveSmsDeliveriesBatch(batchSize, cutoffAt),
    ]);

    const summary: CommunicationArchiveSummary = {
      salonNotifications,
      educationNotifications,
      smsDeliveries,
      skipped: false,
    };

    logger.info(summary, "Communication archive batch finished");
    return summary;
  } finally {
    if (lockAcquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1))",
          [ARCHIVE_LOCK_KEY],
        );
      } catch (unlockError) {
        logger.warn(
          { err: unlockError, lockKey: ARCHIVE_LOCK_KEY },
          "Communication archive advisory lock could not be released cleanly",
        );
      }
    }
    client.release();
  }
}
