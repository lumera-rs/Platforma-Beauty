/**
 * Platform retention settings service.
 *
 * The platform_retention_settings table is append-only and versioned: the row
 * with the highest version is the active configuration; older rows form the
 * complete audit history (who changed what, when, and what the previous
 * values were — the previous values are simply the prior version row).
 *
 * When no rows exist, the platform defaults (version 0) apply, so behaviour
 * is identical to the original hardcoded thresholds until an admin tunes them.
 *
 * Concurrency: updates take a transaction-scoped advisory lock before reading
 * the current max version, so two concurrent admins can never both insert the
 * same version (the unique index on version is the final backstop).
 */

import { desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  platformRetentionSettingsTable,
  salonCustomersTable,
  salonsTable,
  usersTable,
} from "@workspace/db";
import {
  classifyRetention,
  computeSalonMedianSpend,
  DEFAULT_RETENTION_THRESHOLDS,
  type AppointmentRecord,
  type RetentionStatus,
  type RetentionThresholds,
} from "./retention-classification";

/** Stable advisory-lock key for serializing settings updates. */
const RETENTION_SETTINGS_LOCK_KEY = "platform_retention_settings";

/** How a settings version came to be — audit provenance for the history log. */
export type RetentionChangeSource = "manual" | "restore_version" | "restore_defaults";
export interface ActiveRetentionSettings {
  /** 0 when platform defaults apply (no admin change recorded yet). */
  version: number;
  thresholds: RetentionThresholds;
  changedByUserId: string | null;
  /** Resolved display name of the admin who made the change; null when unknown. */
  changedByName: string | null;
  changedAt: Date | null;
  /** How the active version came to be — manual edit or a labelled restore. */
  changeSource: RetentionChangeSource;
  /** Source version when changeSource is "restore_version"; null otherwise. */
  restoredFromVersion: number | null;
}

/** Field-level bounds — single source of truth for validation and tests. */
export const RETENTION_THRESHOLD_BOUNDS: Record<
  keyof RetentionThresholds,
  { min: number; max: number }
> = {
  newCustomerWindowDays: { min: 1, max: 365 },
  defaultIntervalDays: { min: 1, max: 365 },
  atRiskIntervalPercent: { min: 100, max: 1000 },
  lostIntervalPercent: { min: 100, max: 2000 },
  lostMinimumDays: { min: 1, max: 1095 },
  vipMinCompletedVisits: { min: 1, max: 100 },
  vipSpendPercentOfMedian: { min: 100, max: 1000 },
};

/**
 * Validate a candidate thresholds object. Returns a list of human-readable
 * problems; empty list means the candidate is valid.
 */
export function validateRetentionThresholds(candidate: RetentionThresholds): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(RETENTION_THRESHOLD_BOUNDS) as (keyof RetentionThresholds)[]) {
    const value = candidate[key];
    const bounds = RETENTION_THRESHOLD_BOUNDS[key];
    if (!Number.isInteger(value)) {
      problems.push(`${key} must be a whole number.`);
    } else if (value < bounds.min || value > bounds.max) {
      problems.push(`${key} must be between ${bounds.min} and ${bounds.max}.`);
    }
  }
  // Cross-field invariants — keep classification bands well-ordered.
  if (
    Number.isInteger(candidate.atRiskIntervalPercent) &&
    Number.isInteger(candidate.lostIntervalPercent) &&
    candidate.lostIntervalPercent <= candidate.atRiskIntervalPercent
  ) {
    problems.push("lostIntervalPercent must be greater than atRiskIntervalPercent.");
  }
  return problems;
}

function rowToThresholds(
  row: typeof platformRetentionSettingsTable.$inferSelect,
): RetentionThresholds {
  return {
    newCustomerWindowDays: row.newCustomerWindowDays,
    defaultIntervalDays: row.defaultIntervalDays,
    atRiskIntervalPercent: row.atRiskIntervalPercent,
    lostIntervalPercent: row.lostIntervalPercent,
    lostMinimumDays: row.lostMinimumDays,
    vipMinCompletedVisits: row.vipMinCompletedVisits,
    vipSpendPercentOfMedian: row.vipSpendPercentOfMedian,
  };
}

/** "First Last" from nullable name parts, or null when both are missing. */
function formatChangedByName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  return firstName || lastName ? `${firstName ?? ""} ${lastName ?? ""}`.trim() : null;
}

/** Returns the active (highest-version) settings, or defaults as version 0. */
/** Any drizzle executor — the shared pool or an open transaction. */
type RetentionDbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function getActiveRetentionSettings(
  executor: RetentionDbExecutor = db,
): Promise<ActiveRetentionSettings> {
  const [row] = await executor
    .select({
      settings: platformRetentionSettingsTable,
      changedByFirstName: usersTable.firstName,
      changedByLastName: usersTable.lastName,
    })
    .from(platformRetentionSettingsTable)
    .leftJoin(usersTable, eq(platformRetentionSettingsTable.changedByUserId, usersTable.id))
    .orderBy(desc(platformRetentionSettingsTable.version))
    .limit(1);

  if (!row) {
    return {
      version: 0,
      thresholds: { ...DEFAULT_RETENTION_THRESHOLDS },
      changedByUserId: null,
      changedByName: null,
      changedAt: null,
      changeSource: "manual",
      restoredFromVersion: null,
    };
  }
  return {
    version: row.settings.version,
    thresholds: rowToThresholds(row.settings),
    changedByUserId: row.settings.changedByUserId,
    changedByName: formatChangedByName(row.changedByFirstName, row.changedByLastName),
    changedAt: row.settings.createdAt,
    changeSource: (row.settings.changeSource as RetentionChangeSource) ?? "manual",
    restoredFromVersion: row.settings.restoredFromVersion,
  };
}

export type UpdateRetentionSettingsResult =
  | { ok: true; settings: ActiveRetentionSettings }
  | { ok: false; conflict: { expectedVersion: number; activeVersion: number } };
/**
 * Record a new settings version. Caller must have validated the candidate
 * (this function re-validates defensively and throws on invalid input).
 *
 * Optimistic concurrency: `expectedVersion` is the active version the caller
 * based its edit on. The precondition is checked under the same advisory lock
 * that serializes writers, so two admins editing from the same version can
 * never both succeed — the second save observes the first one's version and
 * gets a conflict instead of silently overwriting it.
 *
 * `origin` carries restore provenance for the audit history (manual edit,
 * restore of a prior version, or restore of the platform defaults).
 *
 * Returns the newly active settings, or the conflicting versions.
 */
export async function updateRetentionSettings(
  changedByUserId: string,
  candidate: RetentionThresholds,
  expectedVersion: number,
  origin: RetentionChangeOrigin = { changeSource: "manual" },
): Promise<UpdateRetentionSettingsResult> {
  const problems = validateRetentionThresholds(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid retention thresholds: ${problems.join(" ")}`);
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error("expectedVersion must be a non-negative integer.");
  }

  // Restore labels must be truthful — the audit log is only useful if a
  // "restored" entry provably carries the values it claims to restore.
  if (origin.changeSource === "restore_version") {
    if (!Number.isInteger(origin.restoredFromVersion) || (origin.restoredFromVersion ?? 0) < 1) {
      throw new RetentionRestoreError("restoredFromVersion is required when restoring a version.");
    }
  } else if (origin.restoredFromVersion !== undefined) {
    throw new RetentionRestoreError(
      "restoredFromVersion is only allowed when changeSource is restore_version.",
    );
  }
  if (origin.changeSource === "restore_defaults") {
    for (const key of Object.keys(DEFAULT_RETENTION_THRESHOLDS) as (keyof RetentionThresholds)[]) {
      if (candidate[key] !== DEFAULT_RETENTION_THRESHOLDS[key]) {
        throw new RetentionRestoreError(
          "restore_defaults requires thresholds identical to the platform defaults.",
        );
      }
    }
  }

  const outcome = await db.transaction(async (tx) => {
    // Serialize concurrent updates so version numbers are strictly sequential
    // and the expected-version precondition cannot race another writer.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${RETENTION_SETTINGS_LOCK_KEY}))`);
    if (origin.changeSource === "restore_version") {
      const [sourceRow] = await tx
        .select()
        .from(platformRetentionSettingsTable)
        .where(eq(platformRetentionSettingsTable.version, origin.restoredFromVersion!))
        .limit(1);
      if (!sourceRow) {
        throw new RetentionRestoreError(
          `Version ${origin.restoredFromVersion} does not exist, so it cannot be restored.`,
        );
      }
      const sourceThresholds = rowToThresholds(sourceRow);
      for (const key of Object.keys(sourceThresholds) as (keyof RetentionThresholds)[]) {
        if (candidate[key] !== sourceThresholds[key]) {
          throw new RetentionRestoreError(
            `Submitted thresholds do not match version ${origin.restoredFromVersion}.`,
          );
        }
      }
    }
    const [current] = await tx
      .select()
      .from(platformRetentionSettingsTable)
      .orderBy(desc(platformRetentionSettingsTable.version))
      .limit(1);
    const activeVersion = current?.version ?? 0;
    if (activeVersion !== expectedVersion) {
      return { kind: "conflict", expectedVersion, activeVersion } as const;
    }
    // A restore whose values equal the currently active thresholds would only
    // add audit noise ("no values changed" history entries), so it is blocked
    // here — inside the advisory lock, where "currently active" cannot race
    // with a concurrent update. The version precondition is checked first: a
    // stale page gets a conflict (409) before a no-op verdict that might be
    // based on values the admin has not seen yet.
    if (origin.changeSource !== "manual") {
      const activeThresholds = current
        ? rowToThresholds(current)
        : { ...DEFAULT_RETENTION_THRESHOLDS };
      const identical = (
        Object.keys(activeThresholds) as (keyof RetentionThresholds)[]
      ).every((key) => candidate[key] === activeThresholds[key]);
      if (identical) {
        throw new RetentionNoOpRestoreError(
          "The values to restore are identical to the currently active thresholds, so no new version was recorded.",
        );
      }
    }
    const nextVersion = activeVersion + 1;
    const [row] = await tx
      .insert(platformRetentionSettingsTable)
      .values({
        version: nextVersion,
        newCustomerWindowDays: candidate.newCustomerWindowDays,
        defaultIntervalDays: candidate.defaultIntervalDays,
        atRiskIntervalPercent: candidate.atRiskIntervalPercent,
        lostIntervalPercent: candidate.lostIntervalPercent,
        lostMinimumDays: candidate.lostMinimumDays,
        vipMinCompletedVisits: candidate.vipMinCompletedVisits,
        vipSpendPercentOfMedian: candidate.vipSpendPercentOfMedian,
        changedByUserId,
        changeSource: origin.changeSource,
        restoredFromVersion:
          origin.changeSource === "restore_version" ? origin.restoredFromVersion! : null,
      })
      .returning();
    if (!row) throw new Error("Failed to insert retention settings version.");
    // Resolve the changer's display name so the returned settings carry the
    // same fields as getActiveRetentionSettings (the active-card view).
    const [changer] = await tx
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, changedByUserId))
      .limit(1);
    return {
      kind: "inserted",
      row,
      changedByName: formatChangedByName(changer?.firstName, changer?.lastName),
    } as const;
  });

  if (outcome.kind === "conflict") {
    return {
      ok: false,
      conflict: { expectedVersion: outcome.expectedVersion, activeVersion: outcome.activeVersion },
    };
  }
  const inserted = outcome.row;
  return {
    ok: true,
    settings: {
      version: inserted.version,
      thresholds: rowToThresholds(inserted),
      changedByUserId: inserted.changedByUserId,
      changedByName: outcome.changedByName,
      changedAt: inserted.createdAt,
      changeSource: (inserted.changeSource as RetentionChangeSource) ?? "manual",
      restoredFromVersion: inserted.restoredFromVersion,
    },
  };
}

export type RetentionStatusCounts = Record<RetentionStatus, number>;

export interface RetentionPreviewShift {
  fromStatus: RetentionStatus;
  toStatus: RetentionStatus;
  count: number;
}

export interface RetentionPreviewAffectedSalon {
  salonId: string;
  salonName: string;
  /** Customers of this salon whose status would change. */
  reclassifiedCount: number;
  /** Total customers this salon has — puts the reclassified count in proportion. */
  totalCustomers: number;
}

export interface RetentionPreviewResult {
  /** Version whose thresholds produced the "current" counts (0 = defaults). */
  currentVersion: number;
  totalCustomers: number;
  reclassifiedCount: number;
  currentCounts: RetentionStatusCounts;
  candidateCounts: RetentionStatusCounts;
  /** Status moves under the candidate thresholds, largest first. */
  shifts: RetentionPreviewShift[];
  /** Salons with the most reclassified customers, largest first (top N). */
  topAffectedSalons: RetentionPreviewAffectedSalon[];
}

/** How many most-affected salons the preview reports. */
export const PREVIEW_TOP_AFFECTED_SALONS_LIMIT = 10;

const RETENTION_STATUSES: RetentionStatus[] = ["NEW", "ACTIVE", "VIP", "AT_RISK", "LOST"];

function emptyStatusCounts(): RetentionStatusCounts {
  return { NEW: 0, ACTIVE: 0, VIP: 0, AT_RISK: 0, LOST: 0 };
}

// ── Preview guards ───────────────────────────────────────────────────────────
// The preview runs on the admin page's request path, so it must never stall
// the UI on very large datasets. Three independent guards protect it:
//   1. A customer-count cap checked BEFORE any data is loaded.
//   2. A wall-clock deadline checked before AND after every query and batch.
//   3. A database-side statement_timeout set to the remaining budget, so even
//      a single slow query is cancelled by PostgreSQL instead of holding the
//      request past the budget.
// Cap and budget are env-tunable so operators can raise them without a deploy
// and tests can exercise the guard paths without seeding millions of rows.

/** Hard cap on salon customers the preview will classify (row-count guard). */
export const RETENTION_PREVIEW_DEFAULT_MAX_CUSTOMERS = 250_000;
/**
 * Dry-run: classify every salon customer platform-wide under BOTH the active
 * thresholds and a candidate, and report the per-status counts plus how many
 * customers would move. Read-only — never records a settings version.
 *
 * Uses the exact same inputs per salon as the owner CRM list endpoint
 * (full appointment history + salon-wide median of completed prices), so the
 * preview agrees with what owners would actually see after a save.
 *
 * Scalability: salon medians are aggregated database-side in one query
 * (percentile_cont matches computeSalonMedianSpend exactly), and customers
 * are classified in keyset-paginated batches with their appointment history
 * fetched per batch — peak memory is bounded by one batch of customers plus
 * their appointments, never the whole platform. Guards: a customer-count cap
 * (checked before loading anything), a wall-clock deadline (checked before
 * and after every query and batch), and a database statement_timeout set to
 * the remaining budget all abort with RetentionPreviewOverloadError instead
 * of stalling the admin page.
 */
export async function previewRetentionThresholds(
  candidate: RetentionThresholds,
): Promise<RetentionPreviewResult> {
  const problems = validateRetentionThresholds(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid retention thresholds: ${problems.join(" ")}`);
  }

  const { maxCustomers, timeBudgetMs, appointmentRowBudget } = retentionPreviewGuardLimits();
  const deadlineAt = Date.now() + timeBudgetMs;
  const remainingMs = () => deadlineAt - Date.now();
  const assertWithinBudget = () => {
    if (remainingMs() < 0) {
      throw new RetentionPreviewOverloadError("PREVIEW_TIMEOUT", PREVIEW_TIMEOUT_MESSAGE);
    }
  };
  const batchDelayMs = testOnlyBatchDelayMs();

  // Even the setup queries run under the statement timeout: a blocked
  // settings or count read must be cancelled, never stall the admin page.
  const active = await withPreviewStatementTimeout(
    remainingMs(),
    (tx) => getActiveRetentionSettings(tx),
    "active-settings",
  );
  assertWithinBudget();

  // Row-count guard — refuse before loading a single customer row.
  const [countRow] = await withPreviewStatementTimeout(remainingMs(), (tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(salonCustomersTable),
    "customer-count",
  );
  const customerCount = countRow?.count ?? 0;
  if (customerCount > maxCustomers) {
    throw new RetentionPreviewOverloadError(
      "PREVIEW_TOO_LARGE",
      `Pregled uticaja je privremeno nedostupan: platforma trenutno ima ${customerCount.toLocaleString("sr-Latn-RS")} klijenata, ` +
        `a pregled podržava do ${maxCustomers.toLocaleString("sr-Latn-RS")}. Pragovi se i dalje mogu sačuvati bez pregleda.`,
    );
  }
  assertWithinBudget();

  // Salon-wide median of completed prices, aggregated database-side — same
  // basis as the CRM endpoints (all completed appointments of the salon,
  // linked to a customer or not). For sorted prices, percentile_cont(0.5)
  // returns the middle value (odd count) or the average of the two middle
  // values (even count) — exactly computeSalonMedianSpend's definition.
  const medianRows = await withPreviewStatementTimeout(remainingMs(), (tx) =>
    tx
      .select({
        salonId: appointmentsTable.salonId,
        median: sql<number | string | null>`percentile_cont(0.5) within group (order by ${appointmentsTable.price})`,
      })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.status, "completed"))
      .groupBy(appointmentsTable.salonId),
    "salon-medians",
  );
  const medianBySalon = new Map<string, number | undefined>();
  for (const row of medianRows) {
    medianBySalon.set(row.salonId, row.median == null ? undefined : Number(row.median));
  }
  assertWithinBudget();

  // One fixed "today" so every batch and both passes see the same clock.
  const today = new Date();

  const currentCounts = emptyStatusCounts();
  const candidateCounts = emptyStatusCounts();
  const shiftCounts = new Map<string, number>();
  const reclassifiedBySalon = new Map<string, number>();
  let reclassifiedCount = 0;
  let totalCustomers = 0;
  // Total customers per salon (accumulated across batches) — puts each
  // affected salon's reclassified count in proportion (swing vs base).
  const totalCustomersBySalon = new Map<string, number>();

  // Keyset pagination over customers — batches are bounded by actual rows,
  // not by salon count, so one giant salon cannot blow up a single batch.
  let cursor: string | null = null;
  for (;;) {
    assertWithinBudget();

    const customers: { id: string; salonId: string }[] = await withPreviewStatementTimeout(
      remainingMs(),
      (tx) =>
        tx
          .select({ id: salonCustomersTable.id, salonId: salonCustomersTable.salonId })
          .from(salonCustomersTable)
          .where(cursor === null ? undefined : gt(salonCustomersTable.id, cursor))
          .orderBy(salonCustomersTable.id)
          .limit(RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE),
      "customers",
    );
    if (customers.length === 0) break;
    assertWithinBudget();

    // Deep histories must not blow up a single fetch: count each customer's
    // appointment rows database-side first, then split the page into
    // sub-chunks whose summed counts respect the row budget. Memory is thus
    // bounded by appointment ROWS, not by customer count.
    const apptCountRows = await withPreviewStatementTimeout(remainingMs(), (tx) =>
      tx
        .select({
          salonCustomerId: appointmentsTable.salonCustomerId,
          rowCount: sql<number>`count(*)::int`,
        })
        .from(appointmentsTable)
        .where(inArray(appointmentsTable.salonCustomerId, customers.map((c) => c.id)))
        .groupBy(appointmentsTable.salonCustomerId),
      "appointment-counts",
    );
    assertWithinBudget();
    const apptCountByCustomer = new Map(
      apptCountRows
        .filter((r) => r.salonCustomerId !== null)
        .map((r) => [r.salonCustomerId as string, r.rowCount]),
    );

    // Greedy partition preserving keyset order. One customer's full history
    // is the irreducible unit for exact parity with the CRM classification
    // endpoints, so a single customer whose history alone exceeds the row
    // budget cannot be processed within the memory bound — refuse under the
    // same friendly overload contract instead of silently blowing the budget.
    const subChunks: { id: string; salonId: string }[][] = [];
    let currentChunk: { id: string; salonId: string }[] = [];
    let currentRows = 0;
    for (const customer of customers) {
      const rows = apptCountByCustomer.get(customer.id) ?? 0;
      if (rows > appointmentRowBudget) {
        throw new RetentionPreviewOverloadError(
          "PREVIEW_TOO_LARGE",
          `Pregled uticaja je privremeno nedostupan: jedan klijent ima ${rows.toLocaleString("sr-Latn-RS")} termina, ` +
            `a pregled obrađuje najviše ${appointmentRowBudget.toLocaleString("sr-Latn-RS")} termina odjednom. ` +
            `Pragovi se i dalje mogu sačuvati bez pregleda.`,
        );
      }
      if (currentChunk.length > 0 && currentRows + rows > appointmentRowBudget) {
        subChunks.push(currentChunk);
        currentChunk = [];
        currentRows = 0;
      }
      currentChunk.push(customer);
      currentRows += rows;
    }
    if (currentChunk.length > 0) subChunks.push(currentChunk);

    for (const chunk of subChunks) {
      assertWithinBudget();

      // Appointment history for exactly this sub-chunk's customers (indexed
      // by salon_customer_id) — each appointment row is transferred at most
      // once across the whole preview because chunks never overlap.
      const appts = await withPreviewStatementTimeout(remainingMs(), (tx) =>
        tx
          .select({
            salonCustomerId: appointmentsTable.salonCustomerId,
            date: appointmentsTable.date,
            status: appointmentsTable.status,
            price: appointmentsTable.price,
          })
          .from(appointmentsTable)
          .where(inArray(appointmentsTable.salonCustomerId, chunk.map((c) => c.id))),
        "appointments",
      );
      assertWithinBudget();

      const apptsByCustomer = new Map<string, AppointmentRecord[]>();
      for (const a of appts) {
        if (!a.salonCustomerId) continue;
        const records = apptsByCustomer.get(a.salonCustomerId) ?? [];
        records.push({
          date: a.date,
          status: a.status as AppointmentRecord["status"],
          price: a.price,
        });
        apptsByCustomer.set(a.salonCustomerId, records);
      }

      let classifiedSinceCheck = 0;
      for (const customer of chunk) {
        // Deadline holds DURING CPU-side classification too, not only after
        // the chunk — an overdue preview aborts mid-loop instead of grinding.
        if (++classifiedSinceCheck >= RETENTION_PREVIEW_CLASSIFY_CHECK_EVERY) {
          classifiedSinceCheck = 0;
          assertWithinBudget();
        }
        totalCustomersBySalon.set(
          customer.salonId,
          (totalCustomersBySalon.get(customer.salonId) ?? 0) + 1,
        );
        const appointments = apptsByCustomer.get(customer.id) ?? [];
        const salonMedianSpend = medianBySalon.get(customer.salonId);
        const currentStatus = classifyRetention({
          appointments, today, salonMedianSpend, thresholds: active.thresholds,
        }).status;
        const candidateStatus = classifyRetention({
          appointments, today, salonMedianSpend, thresholds: candidate,
        }).status;

        currentCounts[currentStatus] += 1;
        candidateCounts[candidateStatus] += 1;
        if (currentStatus !== candidateStatus) {
          reclassifiedCount += 1;
          const key = `${currentStatus}\u0000${candidateStatus}`;
          shiftCounts.set(key, (shiftCounts.get(key) ?? 0) + 1);
          reclassifiedBySalon.set(
            customer.salonId,
            (reclassifiedBySalon.get(customer.salonId) ?? 0) + 1,
          );
        }
      }
      totalCustomers += chunk.length;

      // Yield the event loop between sub-chunks so a long preview cannot
      // starve other requests on this server.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    if (batchDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
    // Deadline also covers the batch just classified — including the final
    // one — so a slow single-batch platform still gets a friendly refusal.
    assertWithinBudget();

    const lastCustomer = customers[customers.length - 1];
    if (!lastCustomer || customers.length < RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE) break;
    cursor = lastCustomer.id;
  }

  const shifts: RetentionPreviewShift[] = [...shiftCounts.entries()]
    .map(([key, count]) => {
      const [fromStatus, toStatus] = key.split("\u0000") as [RetentionStatus, RetentionStatus];
      return { fromStatus, toStatus, count };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        RETENTION_STATUSES.indexOf(a.fromStatus) - RETENTION_STATUSES.indexOf(b.fromStatus) ||
        RETENTION_STATUSES.indexOf(a.toStatus) - RETENTION_STATUSES.indexOf(b.toStatus),
    );

  // Top-N most-affected salons, accumulated across all batches. Ties break on
  // salonId so the cut is deterministic; names are fetched only for the salons
  // that made the cut (read-only lookup — the preview still never writes).
  const topAffected = [...reclassifiedBySalon.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PREVIEW_TOP_AFFECTED_SALONS_LIMIT);

  let topAffectedSalons: RetentionPreviewAffectedSalon[] = [];
  if (topAffected.length > 0) {
    assertWithinBudget();
    const namedRows = await withPreviewStatementTimeout(remainingMs(), (tx) =>
      tx
        .select({ id: salonsTable.id, name: salonsTable.name })
        .from(salonsTable)
        .where(inArray(salonsTable.id, topAffected.map(([salonId]) => salonId))),
      "salon-names",
    );
    const nameById = new Map(namedRows.map((row) => [row.id, row.name]));
    topAffectedSalons = topAffected.map(([salonId, count]) => ({
      salonId,
      salonName: nameById.get(salonId) ?? "Nepoznat salon",
      reclassifiedCount: count,
      totalCustomers: totalCustomersBySalon.get(salonId) ?? 0,
    }));
  }
  // Never return an overdue "success" — the budget covers the whole preview,
  // including the final lookup.
  assertWithinBudget();

  return {
    currentVersion: active.version,
    totalCustomers,
    reclassifiedCount,
    currentCounts,
    candidateCounts,
    shifts,
    topAffectedSalons,
  };
}

export interface RetentionSettingsHistoryEntry {
  version: number;
  thresholds: RetentionThresholds;
  /** Values that were active before this change (defaults for version 1). */
  previousThresholds: RetentionThresholds;
  changedByUserId: string | null;
  changedByName: string | null;
  changedAt: Date;
  /** How the version came to be — manual edit or a labelled restore. */
  changeSource: RetentionChangeSource;
  /** Source version when changeSource is "restore_version"; null otherwise. */
  restoredFromVersion: number | null;
}

/** Full change history, newest first, with previous values per entry. */
export async function getRetentionSettingsHistory(): Promise<RetentionSettingsHistoryEntry[]> {
  const rows = await db
    .select({
      settings: platformRetentionSettingsTable,
      changedByFirstName: usersTable.firstName,
      changedByLastName: usersTable.lastName,
    })
    .from(platformRetentionSettingsTable)
    .leftJoin(usersTable, eq(platformRetentionSettingsTable.changedByUserId, usersTable.id))
    .orderBy(desc(platformRetentionSettingsTable.version));

  return rows.map((row, idx) => {
    const prior = rows[idx + 1];
    return {
      version: row.settings.version,
      thresholds: rowToThresholds(row.settings),
      previousThresholds: prior
        ? rowToThresholds(prior.settings)
        : { ...DEFAULT_RETENTION_THRESHOLDS },
      changedByUserId: row.settings.changedByUserId,
      changedByName: formatChangedByName(row.changedByFirstName, row.changedByLastName),
      changedAt: row.settings.createdAt,
      changeSource: (row.settings.changeSource as RetentionChangeSource) ?? "manual",
      restoredFromVersion: row.settings.restoredFromVersion,
    };
  });
}

/**
 * Restore metadata for an update. `restoredFromVersion` is required exactly
 * when `changeSource` is "restore_version".
 */
export interface RetentionChangeOrigin {
  changeSource: RetentionChangeSource;
  restoredFromVersion?: number;
}

/** Invalid restore metadata — mapped to HTTP 400 by the route layer. */
export class RetentionRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionRestoreError";
  }
}

export type RetentionPreviewOverloadCode = "PREVIEW_TOO_LARGE" | "PREVIEW_TIMEOUT";
/**
 * Restore that would not change any value — rejected so the append-only
 * history never fills with "no values changed" entries. Mapped to HTTP 400
 * (code NO_OP_RESTORE) by the route layer.
 */
export class RetentionNoOpRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionNoOpRestoreError";
  }
}

/** Thrown when a guard trips; carries a user-friendly message for the admin UI. */
export class RetentionPreviewOverloadError extends Error {
  readonly code: RetentionPreviewOverloadCode;
  constructor(code: RetentionPreviewOverloadCode, message: string) {
    super(message);
    this.name = "RetentionPreviewOverloadError";
    this.code = code;
  }
}

const PREVIEW_TIMEOUT_MESSAGE =
  "Pregled uticaja je prekinut jer je obračun trajao predugo. " +
  "Pokušajte ponovo kasnije — pragovi se i dalje mogu sačuvati bez pregleda.";

/** Wall-clock budget for the whole preview computation. */
export const RETENTION_PREVIEW_DEFAULT_TIME_BUDGET_MS = 10_000;

/** Customers classified per round-trip — bounds peak memory by actual rows. */
const RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE = 1_000;

/**
 * Hard bound on appointment rows held in memory at once. A customer page is
 * split into sub-chunks whose summed appointment counts stay under this
 * budget, so deep histories cannot blow up a single fetch. One customer's
 * full history is the irreducible unit (classification parity with the CRM
 * endpoints requires it), so a single customer exceeding the whole budget is
 * refused with the friendly overload error rather than breaking the bound.
 */
export const RETENTION_PREVIEW_DEFAULT_APPOINTMENT_ROW_BUDGET = 20_000;


function readPositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Active guard limits (env overrides read per call so tests/ops can tune). */
export function retentionPreviewGuardLimits(): {
  maxCustomers: number;
  timeBudgetMs: number;
  appointmentRowBudget: number;
} {
  return {
    maxCustomers:
      readPositiveIntEnv("RETENTION_PREVIEW_MAX_CUSTOMERS") ??
      RETENTION_PREVIEW_DEFAULT_MAX_CUSTOMERS,
    timeBudgetMs:
      readPositiveIntEnv("RETENTION_PREVIEW_TIME_BUDGET_MS") ??
      RETENTION_PREVIEW_DEFAULT_TIME_BUDGET_MS,
    appointmentRowBudget:
      readPositiveIntEnv("RETENTION_PREVIEW_APPOINTMENT_ROW_BUDGET") ??
      RETENTION_PREVIEW_DEFAULT_APPOINTMENT_ROW_BUDGET,
  };
}

/** PostgreSQL SQLSTATE for "canceling statement due to statement timeout". */
const STATEMENT_TIMEOUT_SQLSTATE = "57014";

/**
 * Run preview queries inside a transaction whose statement_timeout is the
 * remaining time budget, converting a database-side cancellation into
 * RetentionPreviewOverloadError. Exported for the guard test suite.
 */
export async function withPreviewStatementTimeout<T>(
  remainingMs: number,
  run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  label?: string,
): Promise<T> {
  const timeoutMs = Math.max(1, Math.floor(remainingMs));
  try {
    return await db.transaction(async (tx) => {
      // statement_timeout does not accept bind parameters; timeoutMs is a
      // validated integer, never user input.
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${timeoutMs}`));
      const sleepSeconds = testOnlySqlSleepSeconds(label);
      if (sleepSeconds > 0) {
        // Test-only: a real slow statement at this exact step, so tests can
        // prove the database cancels it instead of the request stalling.
        await tx.execute(sql`select pg_sleep(${sleepSeconds})`);
      }
      return await run(tx);
    });
  } catch (err) {
    if (isStatementTimeout(err)) {
      throw new RetentionPreviewOverloadError("PREVIEW_TIMEOUT", PREVIEW_TIMEOUT_MESSAGE);
    }
    throw err;
  }
}

/**
 * Test-only fault injection: makes the labelled preview step run a pg_sleep
 * inside its statement-timeout transaction, deterministically exercising the
 * database-side cancellation on the real request path. NODE_ENV=test only.
 */
function testOnlySqlSleepSeconds(label?: string): number {
  if (process.env.NODE_ENV !== "test" || !label) return 0;
  if (process.env.LUMERA_TEST_RETENTION_PREVIEW_SLEEP_AT !== label) return 0;
  const ms = readPositiveIntEnv("LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS") ?? 0;
  return ms / 1000;
}

function isStatementTimeout(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === STATEMENT_TIMEOUT_SQLSTATE) return true;
  const causeCode = (err as { cause?: { code?: unknown } })?.cause?.code;
  return causeCode === STATEMENT_TIMEOUT_SQLSTATE;
}

/**
 * Test-only fault injection: delays the end of every classification batch so
 * the deadline checks that run DURING/AFTER batches can be exercised
 * deterministically. Honored only under NODE_ENV=test.
 */
function testOnlyBatchDelayMs(): number {
  if (process.env.NODE_ENV !== "test") return 0;
  return readPositiveIntEnv("LUMERA_TEST_RETENTION_PREVIEW_BATCH_DELAY_MS") ?? 0;
}

/** Deadline is re-checked every N customers during CPU-side classification. */
const RETENTION_PREVIEW_CLASSIFY_CHECK_EVERY = 100;
