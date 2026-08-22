import {
  educationNotificationsArchiveTable,
  educationNotificationsTable,
  pool,
  salonNotificationsArchiveTable,
  salonNotificationsTable,
  smsDeliveriesArchiveTable,
  smsDeliveriesTable,
} from "@workspace/db";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { and, asc, inArray, lt, isNull, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Data-retention archiver.
 *
 * Moves cold rows out of hot tables into their `*_archive` counterparts. It is
 * built to be safe to run on any schedule and in parallel with the live app:
 *
 * - A PostgreSQL advisory lock (session-scoped, try-lock) guarantees a single
 *   active run per archive job. A second caller returns immediately instead of
 *   blocking, so overlapping schedulers never pile up.
 * - Each batch runs in its own transaction and claims rows with
 *   `FOR UPDATE SKIP LOCKED`, so it never fights the request path for a row a
 *   user is currently reading/updating.
 * - Copy-then-delete happens inside that transaction: a crash rolls the whole
 *   batch back, leaving the source rows untouched. A committed batch removes
 *   the source ids, so re-running safely finds no duplicate work.
 * - Only genuinely cold, non-active, delivered rows are eligible — see each
 *   job's `eligible` predicate. Nothing awaiting delivery or retry is moved.
 *
 * There is no DDL here and nothing runs at startup: the archive tables ship in
 * the Drizzle schema and are created by the normal migration/push flow.
 */

export const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 1000;

// Stable 64-bit advisory-lock keys, one per archive job. Chosen once and never
// reused so distinct jobs can run concurrently while each is singleton.
const ADVISORY_LOCK_KEYS = {
  salonNotifications: 481_923_001n,
  educationNotifications: 481_923_002n,
  smsDeliveries: 481_923_003n,
} as const;

export type ArchiveJobName = keyof typeof ADVISORY_LOCK_KEYS;

export interface ArchiveOptions {
  /** Rows strictly older than this many days are eligible. */
  retentionDays?: number;
  /** Rows per transaction/batch. */
  batchSize?: number;
  /** Hard cap on batches per run (a safety valve, not a correctness bound). */
  maxBatches?: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface ArchiveJobResult {
  job: ArchiveJobName;
  archived: number;
  batches: number;
  /** True when the advisory lock was held by another run and this call was a no-op. */
  skippedLocked: boolean;
}

// Derive the pooled-connection type from the pool itself so no direct `pg`
// dependency is needed. `pool.connect()` (no callback) resolves to a client.
type PooledConnection = Awaited<ReturnType<typeof connectClient>>;
function connectClient() {
  return pool.connect();
}
function makeClient(connection: PooledConnection) {
  return drizzle(connection, { schema });
}
type DbClient = ReturnType<typeof makeClient>;
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

function cutoffFor(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Acquire a session-scoped advisory lock without blocking. Returns whether it
 * was acquired; the caller must release it in a `finally`. The lock lives on
 * the passed client's connection, so all batch work must run on that same
 * client for the lock to actually serialise it.
 */
async function tryAdvisoryLock(client: DbClient, key: bigint): Promise<boolean> {
  const result = await client.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${key}) as locked`,
  );
  return Boolean(result.rows[0]?.locked);
}

async function advisoryUnlock(client: DbClient, key: bigint): Promise<void> {
  await client.execute(sql`select pg_advisory_unlock(${key})`);
}

interface JobDefinition {
  name: ArchiveJobName;
  /** Copy the claimed ids into the archive and delete them from the source. */
  archiveBatch(tx: Tx, ids: string[]): Promise<void>;
  /** Claim up to `limit` eligible source ids, skipping rows locked elsewhere. */
  claimIds(tx: Tx, cutoff: Date, limit: number): Promise<string[]>;
}

/**
 * Run one archive job end-to-end under its advisory lock, batching until the
 * source is drained of eligible rows (or the batch cap is hit).
 */
async function runJob(job: JobDefinition, options: ArchiveOptions): Promise<ArchiveJobResult> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const now = options.now ?? new Date();
  const cutoff = cutoffFor(retentionDays, now);
  const lockKey = ADVISORY_LOCK_KEYS[job.name];

  // A dedicated connection so the session advisory lock and every batch
  // transaction share one backend. Returning it to the pool releases the lock
  // implicitly, but we unlock explicitly first so the pooled session is clean.
  const connection = await connectClient();
  const client = makeClient(connection);

  const locked = await tryAdvisoryLock(client, lockKey);
  if (!locked) {
    connection.release();
    return { job: job.name, archived: 0, batches: 0, skippedLocked: true };
  }

  let archived = 0;
  let batches = 0;
  try {
    while (batches < maxBatches) {
      const moved = await client.transaction(async (tx) => {
        const ids = await job.claimIds(tx, cutoff, batchSize);
        if (ids.length === 0) return 0;
        await job.archiveBatch(tx, ids);
        return ids.length;
      });
      if (moved === 0) break;
      archived += moved;
      batches += 1;
    }
  } finally {
    try {
      await advisoryUnlock(client, lockKey);
    } finally {
      connection.release();
    }
  }

  return { job: job.name, archived, batches, skippedLocked: false };
}

const salonNotificationsJob: JobDefinition = {
  name: "salonNotifications",
  async claimIds(tx, cutoff, limit) {
    // Only read notifications are archived: an unread notification is still
    // "active" from the salon's point of view even once it is old.
    const rows = await tx
      .select({ id: salonNotificationsTable.id })
      .from(salonNotificationsTable)
      .where(and(
        lt(salonNotificationsTable.createdAt, cutoff),
        isNotNull(salonNotificationsTable.readAt),
      ))
      .orderBy(asc(salonNotificationsTable.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows.map((row) => row.id);
  },
  async archiveBatch(tx, ids) {
    const source = await tx
      .select()
      .from(salonNotificationsTable)
      .where(inArray(salonNotificationsTable.id, ids));
    if (source.length === 0) return;
    await tx.insert(salonNotificationsArchiveTable).values(
      source.map((row) => ({
        id: row.id,
        salonId: row.salonId,
        title: row.title,
        message: row.message,
        href: row.href,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
    );
    await tx.delete(salonNotificationsTable).where(inArray(salonNotificationsTable.id, ids));
  },
};

const educationNotificationsJob: JobDefinition = {
  name: "educationNotifications",
  async claimIds(tx, cutoff, limit) {
    // Same rule: keep unread (active) notifications in the live table.
    const rows = await tx
      .select({ id: educationNotificationsTable.id })
      .from(educationNotificationsTable)
      .where(and(
        lt(educationNotificationsTable.createdAt, cutoff),
        isNotNull(educationNotificationsTable.readAt),
      ))
      .orderBy(asc(educationNotificationsTable.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows.map((row) => row.id);
  },
  async archiveBatch(tx, ids) {
    const source = await tx
      .select()
      .from(educationNotificationsTable)
      .where(inArray(educationNotificationsTable.id, ids));
    if (source.length === 0) return;
    await tx.insert(educationNotificationsArchiveTable).values(
      source.map((row) => ({
        id: row.id,
        userId: row.userId,
        enrollmentId: row.enrollmentId,
        waitlistId: row.waitlistId,
        type: row.type,
        title: row.title,
        body: row.body,
        actionUrl: row.actionUrl,
        eventKey: row.eventKey,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
    );
    await tx.delete(educationNotificationsTable).where(inArray(educationNotificationsTable.id, ids));
  },
};

const smsDeliveriesJob: JobDefinition = {
  name: "smsDeliveries",
  async claimIds(tx, cutoff, limit) {
    // Never archive undelivered work: a queued row has not been sent, and a
    // failed row is only cold once it has no retry marker. Terminal rows
    // (sent/skipped, or failed after retries were exhausted) are safe to move.
    const rows = await tx
      .select({ id: smsDeliveriesTable.id })
      .from(smsDeliveriesTable)
      .where(and(
        lt(smsDeliveriesTable.createdAt, cutoff),
        sql`${smsDeliveriesTable.status} <> 'queued'`,
        isNull(smsDeliveriesTable.nextRetryAt),
      ))
      .orderBy(asc(smsDeliveriesTable.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows.map((row) => row.id);
  },
  async archiveBatch(tx, ids) {
    const source = await tx
      .select()
      .from(smsDeliveriesTable)
      .where(inArray(smsDeliveriesTable.id, ids));
    if (source.length === 0) return;
    await tx.insert(smsDeliveriesArchiveTable).values(
      source.map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        salonId: row.salonId,
        appointmentId: row.appointmentId,
        messageType: row.messageType,
        recipientPhone: row.recipientPhone,
        body: row.body,
        status: row.status,
        providerMessageId: row.providerMessageId,
        errorMessage: row.errorMessage,
        sentAt: row.sentAt,
        retryCount: row.retryCount,
        nextRetryAt: row.nextRetryAt,
        createdAt: row.createdAt,
      })),
    );
    await tx.delete(smsDeliveriesTable).where(inArray(smsDeliveriesTable.id, ids));
  },
};

const JOBS: Record<ArchiveJobName, JobDefinition> = {
  salonNotifications: salonNotificationsJob,
  educationNotifications: educationNotificationsJob,
  smsDeliveries: smsDeliveriesJob,
};

export function archiveSalonNotifications(options: ArchiveOptions = {}): Promise<ArchiveJobResult> {
  return runJob(salonNotificationsJob, options);
}

export function archiveEducationNotifications(options: ArchiveOptions = {}): Promise<ArchiveJobResult> {
  return runJob(educationNotificationsJob, options);
}

export function archiveSmsDeliveries(options: ArchiveOptions = {}): Promise<ArchiveJobResult> {
  return runJob(smsDeliveriesJob, options);
}

/** Run every retention job. Safe to call from a scheduler; errors are logged. */
export async function runDataRetentionArchive(options: ArchiveOptions = {}): Promise<ArchiveJobResult[]> {
  const results: ArchiveJobResult[] = [];
  for (const name of Object.keys(JOBS) as ArchiveJobName[]) {
    try {
      const result = await runJob(JOBS[name], options);
      results.push(result);
      if (result.archived > 0) {
        logger.info(result, "Data-retention archive batch finished");
      }
    } catch (error) {
      logger.error({ err: error, job: name }, "Data-retention archive job failed");
    }
  }
  return results;
}
