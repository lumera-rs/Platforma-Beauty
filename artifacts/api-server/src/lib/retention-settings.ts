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

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
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
  | {
      ok: false;
      conflict: {
        expectedVersion: number;
        activeVersion: number;
        changedByName: string | null;
        changedAt: Date | null;
      };
    };
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
      const [changer] = current?.changedByUserId
        ? await tx
            .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
            .from(usersTable)
            .where(eq(usersTable.id, current.changedByUserId))
            .limit(1)
        : [];
      return {
        kind: "conflict",
        expectedVersion,
        activeVersion,
        changedByName: formatChangedByName(changer?.firstName, changer?.lastName),
        changedAt: current?.createdAt ?? null,
      } as const;
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
      conflict: {
        expectedVersion: outcome.expectedVersion,
        activeVersion: outcome.activeVersion,
        changedByName: outcome.changedByName,
        changedAt: outcome.changedAt,
      },
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
  /** Approximate 95% margin for an estimate; null for exact counts/censuses. */
  reclassifiedCountMarginOfError: number | null;
  /** Customers classified for this salon; null for exact counts. */
  sampleSize: number | null;
}

export interface RetentionPreviewResult {
  /** Version whose thresholds produced the "current" counts (0 = defaults). */
  currentVersion: number;

  totalCustomers: number;

  reclassifiedCount: number;
  /**
   * Approximate 95% margin of error for the estimated reclassified count;
   * null when the preview is exact.
   */
  reclassifiedCountMarginOfError: number | null;

  currentCounts: RetentionStatusCounts;
  /**
   * Approximate 95% margin of error for each current status count when the
   * preview is estimated; null when the preview is exact.
   */
  currentCountMarginsOfError: RetentionStatusCounts | null;

  candidateCounts: RetentionStatusCounts;
  /**
   * Approximate 95% margin of error for each candidate status count when the
   * preview is estimated; null when the preview is exact.
   */
  candidateCountMarginsOfError: RetentionStatusCounts | null;
  /** Status moves under the candidate thresholds, largest first. */

  shifts: RetentionPreviewShift[];
  /** Salons with the most reclassified customers, largest first (top N). */

  topAffectedSalons: RetentionPreviewAffectedSalon[];
  /**
   * Salons with the highest SHARE of reclassified customers, largest first
   * (top N). Only salons with at least shareRankingMinCustomers customers
   * qualify, so a 1-of-1 salon cannot dominate the ranking.
   */

  topShareAffectedSalons: RetentionPreviewAffectedSalon[];
  /** Minimum customers a salon needs to qualify for the share ranking. */

  shareRankingMinCustomers: number;
  /**
   * True when the platform exceeded the exact-preview cap and counts were
   * estimated. Estimates must be rendered as approximate ("~"), never as
   * exact numbers.
   */
  isEstimate: boolean;
  /** Customers actually classified when isEstimate; null in exact mode. */

  sampleSize: number | null;
  /**
   * True when estimate mode used the opt-in stratified per-salon design and
   * can safely return salon rankings. False means the uniform sample was used
   * or the configured design was not supportable.
   */
  salonRankingAvailable: boolean;
}

/** How many most-affected salons the preview reports. */
export const PREVIEW_TOP_AFFECTED_SALONS_LIMIT = 10;

/**
 * Minimum total customers a salon needs to appear in the share-based ranking.
 * Without a floor, a salon whose single customer flips would rank at 100% and
 * crowd out salons where the change genuinely hits a meaningful clientele.
 */
export const RETENTION_PREVIEW_DEFAULT_SHARE_RANKING_MIN_CUSTOMERS = 5;
/** @deprecated Use retentionPreviewGuardLimits().shareRankingMinCustomers for the active value. */
export const PREVIEW_SHARE_RANKING_MIN_CUSTOMERS =
  RETENTION_PREVIEW_DEFAULT_SHARE_RANKING_MIN_CUSTOMERS;

const RETENTION_STATUSES: RetentionStatus[] = ["NEW", "ACTIVE", "VIP", "AT_RISK", "LOST"];

function emptyStatusCounts(): RetentionStatusCounts {
  return { NEW: 0, ACTIVE: 0, VIP: 0, AT_RISK: 0, LOST: 0 };
}

interface StratifiedSalonStats {
  populationSize: number;
  sampleSize: number;
  currentCounts: RetentionStatusCounts;
  candidateCounts: RetentionStatusCounts;
  shiftCounts: Map<string, number>;
  reclassifiedCount: number;
}

/**
 * Return the approximate 95% margin of error for a sampled proportion
 * extrapolated to the full customer population.
 *
 * The Wilson interval avoids reporting a falsely precise ±0 when a small
 * sample happens to contain no changes (or only changes). The finite-
 * population correction matters when the sample is a meaningful fraction of
 * the platform. This is still an approximation: TABLESAMPLE SYSTEM has
 * page-level clustering, so the UI must keep the estimate marker and explain
 * that the result can be higher or lower.
 */
export function calculateEstimatedCountMarginOfError(
  sampledReclassifiedCount: number,
  sampleSize: number,
  totalCustomers: number,
): number {
  if (sampleSize <= 0 || totalCustomers <= 1 || sampleSize >= totalCustomers) return 0;

  const z = 1.96;
  const proportion = sampledReclassifiedCount / sampleSize;
  const zSquared = z * z;
  const denominator = 1 + zSquared / sampleSize;
  const center = (proportion + zSquared / (2 * sampleSize)) / denominator;
  const halfWidth =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / sampleSize +
        zSquared / (4 * sampleSize * sampleSize),
    );
  const finitePopulationCorrection = Math.sqrt(
    Math.max(0, (totalCustomers - sampleSize) / (totalCustomers - 1)),
  );
  const lower = Math.max(0, center - halfWidth);
  const upper = Math.min(1, center + halfWidth);
  return Math.round(
    Math.max(proportion - lower, upper - proportion) *
      totalCustomers *
      finitePopulationCorrection,
  );
}
/** Hard cap on salon customers the preview will classify exactly. Above it
 * the preview falls back to sampled-estimate mode instead of refusing. */
export const RETENTION_PREVIEW_DEFAULT_MAX_CUSTOMERS = 250_000;

/**
 * Customers drawn (uniformly at random, without replacement) for estimate
 * mode. Clamped to the exact-mode cap so an estimate is never more expensive
 * than the largest allowed exact preview. At 25,000 sampled customers the
 * worst-case standard error of an extrapolated proportion is ±0.3 percentage
 * points (95% CI) — comfortably precise for a "~" preview.
 */
export const RETENTION_PREVIEW_DEFAULT_SAMPLE_SIZE = 25_000;

/**
 * Opt-in per-salon sample size for estimate-mode rankings. A salon smaller
 * than this is fully censused; larger salons need at least the minimum sample
 * below to qualify for a statistically bounded ranking.
 */
export const RETENTION_PREVIEW_DEFAULT_SALON_MIN_SAMPLE_SIZE = 30;
export const RETENTION_PREVIEW_DEFAULT_SALON_MAX_STRATA = 500;
/**
 * Stratified sampling is optional, and gets only part of the preview deadline
 * so the established uniform fallback still has time to return a useful
 * aggregate estimate if a ranking cannot be obtained.
 */
const RETENTION_PREVIEW_STRATIFIED_ATTEMPT_BUDGET_FRACTION = 0.4;

/**
 * Estimate-mode page oversampling factor. TABLESAMPLE SYSTEM surfaces whole
 * table pages, so the row count it returns is approximate — requesting a few
 * times more rows than the target sample makes a single pass almost always
 * deliver at least the target. The percentage is never raised afterwards; an
 * under-delivering sample is simply used (and reported) at its smaller size.
 */
const RETENTION_PREVIEW_SAMPLE_OVERSAMPLE = 4;

/**
 * Constant floor for the estimate-mode source-row budget. Page-level
 * sampling is unreliable when the target percentage rounds to a handful of
 * pages (tiny tables), so tables at or below this size are simply read in
 * full — a fixed, trivially bounded amount of work independent of the
 * platform size that triggered estimate mode.
 */
const RETENTION_PREVIEW_SAMPLE_MIN_SOURCE_ROWS = 1_000;
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
 * their appointments, never the whole platform.
 *
 * Guards: above the customer-count cap (checked before loading anything) the
 * preview switches to sampled-estimate mode instead of refusing: a bounded
 * page-level random sample (TABLESAMPLE SYSTEM, uniformly thinned in memory)
 * is classified through the same pipeline and extrapolated to the platform
 * size, flagged via isEstimate/sampleSize. Operators can opt into a bounded
 * random sample within each salon to recover ranking estimates; it is refused
 * when the number of salons, total sample budget, or per-salon precision is
 * insufficient. Salon medians are then computed only for sampled salons. A
 * wall-clock deadline (checked before and after every query and batch) and a
 * database statement_timeout set to the remaining budget still abort with
 * RetentionPreviewOverloadError instead of stalling the admin page.
 */
export async function previewRetentionThresholds(
  candidate: RetentionThresholds,
): Promise<RetentionPreviewResult> {
  const problems = validateRetentionThresholds(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid retention thresholds: ${problems.join(" ")}`);
  }

  const {
    maxCustomers,
    timeBudgetMs,
    appointmentRowBudget,
    sampleSize,
    shareRankingMinCustomers,
    salonSampleSize,
    salonMinSampleSize,
    salonMaxStrata,
  } =
    retentionPreviewGuardLimits();
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

  // Row-count guard — decided before loading a single customer row. At or
  // below the cap every customer is classified (exact mode). Above the cap
  // the preview no longer refuses: it falls back to SAMPLED-ESTIMATE mode —
  // classify a uniform random sample of customers and extrapolate the counts
  // to the platform size, clearly flagged via isEstimate/sampleSize so the
  // UI can render them as approximations ("~"), never as exact numbers.
  const [countRow] = await withPreviewStatementTimeout(remainingMs(), (tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(salonCustomersTable),
    "customer-count",
  );
  const customerCount = countRow?.count ?? 0;
  const isEstimate = customerCount > maxCustomers;
  // The sample never exceeds the exact-mode cap, so estimate mode is always
  // at most as expensive as the largest allowed exact preview.
  const estimateSampleSize = isEstimate
    ? Math.min(sampleSize, maxCustomers, customerCount)
    : null;
  assertWithinBudget();

  // Salon-wide median of completed prices, aggregated database-side — same
  // basis as the CRM endpoints (all completed appointments of the salon,
  // linked to a customer or not). For sorted prices, percentile_cont(0.5)
  // returns the middle value (odd count) or the average of the two middle
  // values (even count) — exactly computeSalonMedianSpend's definition.
  //
  // Exact mode aggregates the whole platform in one pass. Estimate mode
  // skips this — at estimate-mode scale a platform-wide aggregate over ALL
  // appointments could alone exhaust the budget, so medians are computed
  // later, only for the salons that actually appear in the sample.
  const medianBySalon = new Map<string, number | undefined>();
  const loadMediansForSalons = async (salonIds: string[] | null) => {
    const medianRows = await withPreviewStatementTimeout(remainingMs(), (tx) =>
      tx
        .select({
          salonId: appointmentsTable.salonId,
          median: sql<number | string | null>`percentile_cont(0.5) within group (order by ${appointmentsTable.price})`,
        })
        .from(appointmentsTable)
        .where(
          salonIds === null
            ? eq(appointmentsTable.status, "completed")
            : and(eq(appointmentsTable.status, "completed"), inArray(appointmentsTable.salonId, salonIds)),
        )
        .groupBy(appointmentsTable.salonId),
      "salon-medians",
    );
    for (const row of medianRows) {
      medianBySalon.set(row.salonId, row.median == null ? undefined : Number(row.median));
    }
    assertWithinBudget();
  };
  if (!isEstimate) {
    await loadMediansForSalons(null);
  }

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
  /**
   * Populated only by the opt-in stratified estimate path. The ordinary
   * TABLESAMPLE fallback deliberately leaves this empty so it cannot
   * accidentally be treated as a trustworthy salon comparison.
   */
  const stratifiedSalonStats = new Map<string, StratifiedSalonStats>();
  let salonRankingAvailable = !isEstimate;

  // Classify one page of customers into the shared accumulators. Used by
  // both modes: exact mode feeds keyset-paginated pages of ALL customers,
  // estimate mode feeds bounded pages of the random sample.
  const processCustomerPage = async (customers: { id: string; salonId: string }[]) => {
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
        const stratifiedStats = stratifiedSalonStats.get(customer.salonId);
        if (!stratifiedStats) {
          totalCustomersBySalon.set(
            customer.salonId,
            (totalCustomersBySalon.get(customer.salonId) ?? 0) + 1,
          );
        }
        if (stratifiedStats) {
          stratifiedStats.sampleSize += 1;
          stratifiedStats.currentCounts[currentStatus] += 1;
          stratifiedStats.candidateCounts[candidateStatus] += 1;
        }
        if (currentStatus !== candidateStatus) {
          reclassifiedCount += 1;
          const key = `${currentStatus}\u0000${candidateStatus}`;
          shiftCounts.set(key, (shiftCounts.get(key) ?? 0) + 1);
          if (stratifiedStats) {
            stratifiedStats.reclassifiedCount += 1;
            stratifiedStats.shiftCounts.set(
              key,
              (stratifiedStats.shiftCounts.get(key) ?? 0) + 1,
            );
          }
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
  };

  if (isEstimate) {
    let sampled: { id: string; salonId: string }[] = [];

    // Operators can opt into a true stratified sample for salon comparisons.
    // Its sample is drawn independently within every salon, unlike the
    // bounded platform-wide TABLESAMPLE fallback below. A random UUID cursor
    // lets the (salon_id, id) index read a short circular range per salon,
    // avoiding a platform-wide ORDER BY random() sort. The work is intentionally
    // protected by the same statement/deadline guards; if the platform has too
    // many strata or the requested sample is underpowered we discard it and
    // keep the established empty-ranking fallback.
    if (salonSampleSize !== null) {
      // This optional query gets only a bounded slice of the deadline. A
      // timeout is not an error for the preview — it means rankings remain
      // unavailable and the proven uniform path runs.
      const stratifiedDeadlineAt =
        Date.now() + Math.max(1, Math.floor(remainingMs() * RETENTION_PREVIEW_STRATIFIED_ATTEMPT_BUDGET_FRACTION));
      const stratifiedRemainingMs = () =>
        Math.max(1, Math.min(remainingMs(), stratifiedDeadlineAt - Date.now()));
      const assertWithinStratifiedBudget = () => {
        if (remainingMs() <= 0 || Date.now() > stratifiedDeadlineAt) {
          throw new RetentionPreviewOverloadError("PREVIEW_TIMEOUT", PREVIEW_TIMEOUT_MESSAGE);
        }
      };
      try {
        const populations = await withPreviewStatementTimeout(stratifiedRemainingMs(), (tx) =>
          tx
            .select({
              salonId: salonCustomersTable.salonId,
              customerCount: sql<number>`count(*)::int`,
            })
            .from(salonCustomersTable)
            .groupBy(salonCustomersTable.salonId)
            .limit(salonMaxStrata + 1),
          "salon-strata",
        );
        assertWithinStratifiedBudget();
        const requiredStratifiedSampleSize = populations.reduce(
          (sum, row) => sum + Math.min(row.customerCount, salonSampleSize),
          0,
        );
        const stratifiedSampleBudget = estimateSampleSize!;
        const hasEnoughPerSalonPrecision = populations.every(
          (row) => row.customerCount <= salonSampleSize || salonSampleSize >= salonMinSampleSize,
        );
        if (
          populations.length <= salonMaxStrata &&
          hasEnoughPerSalonPrecision &&
          requiredStratifiedSampleSize <= stratifiedSampleBudget
        ) {
          // salon_customers.id uses random UUIDs. Start every salon at a fresh
          // random UUID and take the next ids in circular UUID order. The two
          // indexed ranges ensure every eligible salon supplies exactly its
          // requested sample (or its complete population), even when its start
          // cursor lands near the end of the UUID space. This is bounded by
          // strata × salonSampleSize rather than by every customer row.
          const sampleSeeds = sql.join(
            populations.map((row) => sql`(${row.salonId}::uuid, ${randomUUID()}::uuid)`),
            sql`, `,
          );
          const sampleRes = await withPreviewStatementTimeout(stratifiedRemainingMs(), (tx) =>
            tx.execute(sql`
              with sample_seeds(salon_id, start_id) as (
                values ${sampleSeeds}
              )
              select sampled.id, sampled.salon_id
              from sample_seeds
              cross join lateral (
                select id, salon_id
                from (
                  (
                    select customer.id, customer.salon_id
                    from ${salonCustomersTable} as customer
                    where customer.salon_id = sample_seeds.salon_id
                      and customer.id >= sample_seeds.start_id
                    order by customer.id
                    limit ${salonSampleSize}
                  )
                  union all
                  (
                    select customer.id, customer.salon_id
                    from ${salonCustomersTable} as customer
                    where customer.salon_id = sample_seeds.salon_id
                      and customer.id < sample_seeds.start_id
                    order by customer.id
                    limit ${salonSampleSize}
                  )
                ) as circular_sample
                limit ${salonSampleSize}
              ) as sampled
            `),
            "salon-stratified-sample",
          );
          assertWithinStratifiedBudget();
          const sampleRows = (sampleRes as unknown as { rows?: Record<string, unknown>[] }).rows
            ?? (sampleRes as unknown as Record<string, unknown>[]);
          sampled = sampleRows.map((row) => ({
            id: String(row.id),
            salonId: String(row.salon_id),
          }));
          const sampleCountBySalon = new Map<string, number>();
          for (const customer of sampled) {
            sampleCountBySalon.set(
              customer.salonId,
              (sampleCountBySalon.get(customer.salonId) ?? 0) + 1,
            );
          }
          const complete = populations.every(
            (row) =>
              (sampleCountBySalon.get(row.salonId) ?? 0) === Math.min(row.customerCount, salonSampleSize),
          );
          if (complete) {
            salonRankingAvailable = true;
            for (const row of populations) {
              totalCustomersBySalon.set(row.salonId, row.customerCount);
              stratifiedSalonStats.set(row.salonId, {
                populationSize: row.customerCount,
                sampleSize: 0,
                currentCounts: emptyStatusCounts(),
                candidateCounts: emptyStatusCounts(),
                shiftCounts: new Map(),
                reclassifiedCount: 0,
              });
            }
          } else {
            sampled = [];
          }
        }
      } catch (error) {
        if (!(error instanceof RetentionPreviewOverloadError)) throw error;
        sampled = [];
        totalCustomersBySalon.clear();
        stratifiedSalonStats.clear();
      }
    }

    if (!salonRankingAvailable) {
      // Bounded platform-wide fallback: TABLESAMPLE SYSTEM reads a random
      // subset of pages, then an in-memory shuffle thins it to the target.
      // It is safe for platform totals but deliberately not used for
      // per-salon rankings.
      const targetSample = estimateSampleSize!;
      const expectedSourceRows = Math.min(
        customerCount,
        Math.max(
          targetSample * RETENTION_PREVIEW_SAMPLE_OVERSAMPLE,
          RETENTION_PREVIEW_SAMPLE_MIN_SOURCE_ROWS,
        ),
      );
      const sourceRowLimit = expectedSourceRows * 2;
      const samplePct =
        testOnlySamplePctOverride() ??
        Math.min(100, Math.max(0.01, (expectedSourceRows / customerCount) * 100));
      assertWithinBudget();
      const sampleRes = await withPreviewStatementTimeout(remainingMs(), (tx) =>
        tx.execute(
          sql`select id, salon_id from ${salonCustomersTable} tablesample system (${sql.raw(samplePct.toFixed(4))}) limit ${sql.raw(String(sourceRowLimit))}`,
        ),
        "customer-sample",
      );
      const sampleRows = (sampleRes as unknown as { rows?: Record<string, unknown>[] }).rows
        ?? (sampleRes as unknown as Record<string, unknown>[]);
      sampled = sampleRows.map((row) => ({
        id: String(row.id),
        salonId: String(row.salon_id),
      }));
      if (sampled.length === 0) {
        throw new RetentionPreviewOverloadError(
          "PREVIEW_TOO_LARGE",
          "Pregled uticaja je privremeno nedostupan: nije bilo moguće izvući uzorak klijenata za procenu. " +
            "Pokušajte ponovo — pragovi se i dalje mogu sačuvati bez pregleda.",
        );
      }
      assertWithinBudget();
      for (let i = 0; i < Math.min(targetSample, sampled.length); i += 1) {
        const j = i + Math.floor(Math.random() * (sampled.length - i));
        const a = sampled[i]!;
        sampled[i] = sampled[j]!;
        sampled[j] = a;
      }
      if (sampled.length > targetSample) sampled.length = targetSample;
    }

    // Medians only for the salons the sample actually touches, in bounded
    // chunks — never a platform-wide aggregate in estimate mode.
    const sampledSalonIds = [...new Set(sampled.map((customer) => customer.salonId))];
    for (let i = 0; i < sampledSalonIds.length; i += RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE) {
      await loadMediansForSalons(sampledSalonIds.slice(i, i + RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE));
    }

    for (let i = 0; i < sampled.length; i += RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE) {
      await processCustomerPage(sampled.slice(i, i + RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE));
    }
  } else {
    // Exact mode: keyset pagination over ALL customers — batches are bounded
    // by actual rows, not by salon count, so one giant salon cannot blow up
    // a single batch.
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

      await processCustomerPage(customers);

      const lastCustomer = customers[customers.length - 1];
      if (!lastCustomer || customers.length < RETENTION_PREVIEW_CUSTOMER_BATCH_SIZE) break;
      cursor = lastCustomer.id;
    }
  }

  const toSortedShifts = (counts: Map<string, number>): RetentionPreviewShift[] =>
    [...counts.entries()]
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
  const shifts = toSortedShifts(shiftCounts);

  if (isEstimate) {
    // The stratified path has a random sample inside every salon. Weight each
    // stratum back to its known population before ranking; a uniform
    // TABLESAMPLE never reaches this branch and continues to omit rankings.
    if (salonRankingAvailable) {
      const estimatedCountsFromStrata = (
        pick: (stats: StratifiedSalonStats) => RetentionStatusCounts,
      ): RetentionStatusCounts => {
        const estimated = emptyStatusCounts();
        for (const stats of stratifiedSalonStats.values()) {
          const factor = stats.populationSize / stats.sampleSize;
          const counts = pick(stats);
          for (const status of RETENTION_STATUSES) {
            estimated[status] += Math.round(counts[status] * factor);
          }
        }
        return estimated;
      };
      const estimatedMarginsFromStrata = (
        pick: (stats: StratifiedSalonStats) => RetentionStatusCounts,
      ): RetentionStatusCounts => {
        const margins = emptyStatusCounts();
        for (const stats of stratifiedSalonStats.values()) {
          const counts = pick(stats);
          for (const status of RETENTION_STATUSES) {
            // A sum of stratum intervals is intentionally conservative: it
            // avoids claiming that independently estimated salons are more
            // precise than the evidence supports.
            margins[status] += calculateEstimatedCountMarginOfError(
              counts[status],
              stats.sampleSize,
              stats.populationSize,
            );
          }
        }
        return margins;
      };
      const estimatedShiftCounts = new Map<string, number>();
      let estimatedReclassifiedCount = 0;
      let reclassifiedMargin = 0;
      const estimatedReclassifiedBySalon = new Map<string, number>();
      for (const [salonId, stats] of stratifiedSalonStats) {
        const factor = stats.populationSize / stats.sampleSize;
        const estimatedSalonCount = Math.round(stats.reclassifiedCount * factor);
        estimatedReclassifiedBySalon.set(salonId, estimatedSalonCount);
        estimatedReclassifiedCount += estimatedSalonCount;
        reclassifiedMargin += calculateEstimatedCountMarginOfError(
          stats.reclassifiedCount,
          stats.sampleSize,
          stats.populationSize,
        );
        for (const [key, count] of stats.shiftCounts) {
          estimatedShiftCounts.set(
            key,
            (estimatedShiftCounts.get(key) ?? 0) + Math.round(count * factor),
          );
        }
      }
      const estimatedShifts = toSortedShifts(estimatedShiftCounts);
      // Derive the aggregate from the shifts so the API's familiar invariant
      // remains true even after each stratum was rounded independently.
      estimatedReclassifiedCount = estimatedShifts.reduce((sum, shift) => sum + shift.count, 0);
      reclassifiedBySalon.clear();
      for (const [salonId, count] of estimatedReclassifiedBySalon) {
        if (count > 0) reclassifiedBySalon.set(salonId, count);
      }
      const currentEstimatedCounts = estimatedCountsFromStrata((stats) => stats.currentCounts);
      const candidateEstimatedCounts = estimatedCountsFromStrata((stats) => stats.candidateCounts);

      const topAffected = [...reclassifiedBySalon.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, PREVIEW_TOP_AFFECTED_SALONS_LIMIT);
      const shareOf = (salonId: string, count: number) => {
        const total = totalCustomersBySalon.get(salonId) ?? 0;
        return total > 0 ? count / total : 0;
      };
      const topByShare = [...reclassifiedBySalon.entries()]
        .filter(([salonId]) => (totalCustomersBySalon.get(salonId) ?? 0) >= shareRankingMinCustomers)
        .sort(
          (a, b) =>
            shareOf(b[0], b[1]) - shareOf(a[0], a[1]) ||
            b[1] - a[1] ||
            (a[0] < b[0] ? -1 : 1),
        )
        .slice(0, PREVIEW_TOP_AFFECTED_SALONS_LIMIT);
      const namedIds = [...new Set([...topAffected, ...topByShare].map(([salonId]) => salonId))];
      const nameById = new Map<string, string>();
      if (namedIds.length > 0) {
        const namedRows = await withPreviewStatementTimeout(remainingMs(), (tx) =>
          tx
            .select({ id: salonsTable.id, name: salonsTable.name })
            .from(salonsTable)
            .where(inArray(salonsTable.id, namedIds)),
          "salon-names",
        );
        for (const row of namedRows) nameById.set(row.id, row.name);
      }
      const toEstimatedSalon = ([salonId, count]: [string, number]): RetentionPreviewAffectedSalon => {
        const stats = stratifiedSalonStats.get(salonId)!;
        const margin = calculateEstimatedCountMarginOfError(
          stats.reclassifiedCount,
          stats.sampleSize,
          stats.populationSize,
        );
        return {
          salonId,
          salonName: nameById.get(salonId) ?? "Nepoznat salon",
          reclassifiedCount: count,
          totalCustomers: stats.populationSize,
          reclassifiedCountMarginOfError: margin === 0 ? null : margin,
          sampleSize: stats.sampleSize,
        };
      };
      assertWithinBudget();
      return {
        currentVersion: active.version,
        totalCustomers: customerCount,
        reclassifiedCount: estimatedReclassifiedCount,
        reclassifiedCountMarginOfError: reclassifiedMargin,
        currentCounts: currentEstimatedCounts,
        currentCountMarginsOfError: estimatedMarginsFromStrata((stats) => stats.currentCounts),
        candidateCounts: candidateEstimatedCounts,
        candidateCountMarginsOfError: estimatedMarginsFromStrata((stats) => stats.candidateCounts),
        shifts: estimatedShifts,
        topAffectedSalons: topAffected.map(toEstimatedSalon),
        topShareAffectedSalons: topByShare.map(toEstimatedSalon),
        shareRankingMinCustomers,
        isEstimate: true,
        sampleSize: totalCustomers,
        salonRankingAvailable: true,
      };
    }

    // Uniform platform samples remain useful for aggregate counts, but their
    // individual-salon slices are too noisy to rank. Keep rankings empty.
    const sampledCount = totalCustomers;
    const factor = sampledCount > 0 ? customerCount / sampledCount : 0;
    const scale = (n: number) => Math.round(n * factor);
    const estimatedShifts = shifts.map((shift) => ({ ...shift, count: scale(shift.count) }));
    const estimatedCounts = (counts: RetentionStatusCounts): RetentionStatusCounts => {
      const scaled = emptyStatusCounts();
      for (const status of RETENTION_STATUSES) scaled[status] = scale(counts[status]);
      return scaled;
    };
    const estimatedCountMargins = (
      counts: RetentionStatusCounts,
    ): RetentionStatusCounts => {
      const margins = emptyStatusCounts();
      for (const status of RETENTION_STATUSES) {
        margins[status] = calculateEstimatedCountMarginOfError(
          counts[status],
          sampledCount,
          customerCount,
        );
      }
      return margins;
    };
    assertWithinBudget();
    return {
      currentVersion: active.version,
      totalCustomers: customerCount,
      reclassifiedCount: estimatedShifts.reduce((sum, shift) => sum + shift.count, 0),
      reclassifiedCountMarginOfError: calculateEstimatedCountMarginOfError(
        reclassifiedCount,
        sampledCount,
        customerCount,
      ),
      currentCounts: estimatedCounts(currentCounts),
      currentCountMarginsOfError: estimatedCountMargins(currentCounts),
      candidateCounts: estimatedCounts(candidateCounts),
      candidateCountMarginsOfError: estimatedCountMargins(candidateCounts),
      shifts: estimatedShifts,
      topAffectedSalons: [],
      topShareAffectedSalons: [],
      shareRankingMinCustomers,
      isEstimate: true,
      sampleSize: sampledCount,
      salonRankingAvailable: false,
    };
  }

  // Top-N most-affected salons, accumulated across all batches. Ties break on
  // salonId so the cut is deterministic; names are fetched only for the salons
  // that made the cut (read-only lookup — the preview still never writes).
  const topAffected = [...reclassifiedBySalon.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PREVIEW_TOP_AFFECTED_SALONS_LIMIT);

  // Share-based ranking: salons where the HIGHEST FRACTION of customers flips
  // feel the change hardest, even when their absolute counts are small. A
  // minimum-customer floor keeps 1-of-1 salons from dominating at "100%".
  // Ties break on absolute count (bigger swing first), then salonId, so the
  // cut is deterministic.
  const shareOf = (salonId: string, count: number) => {
    const total = totalCustomersBySalon.get(salonId) ?? 0;
    return total > 0 ? count / total : 0;
  };
  const topByShare = [...reclassifiedBySalon.entries()]
    .filter(
      ([salonId]) =>
        (totalCustomersBySalon.get(salonId) ?? 0) >= shareRankingMinCustomers,
    )
    .sort(
      (a, b) =>
        shareOf(b[0], b[1]) - shareOf(a[0], a[1]) ||
        b[1] - a[1] ||
        (a[0] < b[0] ? -1 : 1),
    )
    .slice(0, PREVIEW_TOP_AFFECTED_SALONS_LIMIT);

  // Names are fetched once for the union of both rankings (read-only lookup —
  // the preview still never writes).
  let topAffectedSalons: RetentionPreviewAffectedSalon[] = [];
  let topShareAffectedSalons: RetentionPreviewAffectedSalon[] = [];
  if (topAffected.length > 0 || topByShare.length > 0) {
    assertWithinBudget();
    const namedIds = [
      ...new Set([...topAffected, ...topByShare].map(([salonId]) => salonId)),
    ];
    const namedRows = await withPreviewStatementTimeout(remainingMs(), (tx) =>
      tx
        .select({ id: salonsTable.id, name: salonsTable.name })
        .from(salonsTable)
        .where(inArray(salonsTable.id, namedIds)),
      "salon-names",
    );
    const nameById = new Map(namedRows.map((row) => [row.id, row.name]));
    const toAffectedSalon = ([salonId, count]: [string, number]): RetentionPreviewAffectedSalon => ({
      salonId,
      salonName: nameById.get(salonId) ?? "Nepoznat salon",
      reclassifiedCount: count,
      totalCustomers: totalCustomersBySalon.get(salonId) ?? 0,
      reclassifiedCountMarginOfError: null,
      sampleSize: null,
    });
    topAffectedSalons = topAffected.map(toAffectedSalon);
    topShareAffectedSalons = topByShare.map(toAffectedSalon);
  }
  // Never return an overdue "success" — the budget covers the whole preview,
  // including the final lookup.
  assertWithinBudget();

  return {
    currentVersion: active.version,
    totalCustomers,
    reclassifiedCount,
    reclassifiedCountMarginOfError: null,
    currentCounts,
    currentCountMarginsOfError: null,
    candidateCounts,
    candidateCountMarginsOfError: null,
    shifts,
    topAffectedSalons,
    topShareAffectedSalons,
    shareRankingMinCustomers,
    isEstimate: false,
    sampleSize: null,
    salonRankingAvailable: true,
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
  sampleSize: number;
  shareRankingMinCustomers: number;
  salonSampleSize: number | null;
  salonMinSampleSize: number;
  salonMaxStrata: number;
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
    sampleSize:
      readPositiveIntEnv("RETENTION_PREVIEW_SAMPLE_SIZE") ??
      RETENTION_PREVIEW_DEFAULT_SAMPLE_SIZE,
    shareRankingMinCustomers:
      readPositiveIntEnv("RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS") ??
      RETENTION_PREVIEW_DEFAULT_SHARE_RANKING_MIN_CUSTOMERS,
    salonSampleSize: readPositiveIntEnv("RETENTION_PREVIEW_SALON_SAMPLE_SIZE") ?? null,
    salonMinSampleSize:
      Math.max(
        RETENTION_PREVIEW_DEFAULT_SALON_MIN_SAMPLE_SIZE,
        readPositiveIntEnv("RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE") ??
          RETENTION_PREVIEW_DEFAULT_SALON_MIN_SAMPLE_SIZE,
      ),
    salonMaxStrata:
      readPositiveIntEnv("RETENTION_PREVIEW_SALON_MAX_STRATA") ??
      RETENTION_PREVIEW_DEFAULT_SALON_MAX_STRATA,
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

/**
 * Test-only override for the estimate-mode TABLESAMPLE percentage, so tests
 * can force an under-delivering (or empty) page sample deterministically and
 * prove the preview never widens the scan in response. Honored only under
 * NODE_ENV=test; accepts 0 (guaranteed empty sample) through 100.
 */
function testOnlySamplePctOverride(): number | null {
  if (process.env.NODE_ENV !== "test") return null;
  const raw = process.env.LUMERA_TEST_RETENTION_PREVIEW_SAMPLE_PCT;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}
/** Deadline is re-checked every N customers during CPU-side classification. */
const RETENTION_PREVIEW_CLASSIFY_CHECK_EVERY = 100;
