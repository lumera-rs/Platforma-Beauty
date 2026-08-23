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

import { desc, eq, inArray, sql } from "drizzle-orm";
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

/** Returns the active (highest-version) settings, or defaults as version 0. */
export async function getActiveRetentionSettings(): Promise<ActiveRetentionSettings> {
  const [row] = await db
    .select()
    .from(platformRetentionSettingsTable)
    .orderBy(desc(platformRetentionSettingsTable.version))
    .limit(1);

  if (!row) {
    return {
      version: 0,
      thresholds: { ...DEFAULT_RETENTION_THRESHOLDS },
      changedByUserId: null,
      changedAt: null,
      changeSource: "manual",
      restoredFromVersion: null,
    };
  }
  return {
    version: row.version,
    thresholds: rowToThresholds(row),
    changedByUserId: row.changedByUserId,
    changedAt: row.createdAt,
    changeSource: (row.changeSource as RetentionChangeSource) ?? "manual",
    restoredFromVersion: row.restoredFromVersion,
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
    return { kind: "inserted", row } as const;
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

/**
 * Dry-run: classify every salon customer platform-wide under BOTH the active
 * thresholds and a candidate, and report the per-status counts plus how many
 * customers would move. Read-only — never records a settings version.
 *
 * Uses the exact same inputs per salon as the owner CRM list endpoint
 * (full appointment history + salon-wide median of completed prices), so the
 * preview agrees with what owners would actually see after a save.
 */
export async function previewRetentionThresholds(
  candidate: RetentionThresholds,
): Promise<RetentionPreviewResult> {
  const problems = validateRetentionThresholds(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid retention thresholds: ${problems.join(" ")}`);
  }

  const active = await getActiveRetentionSettings();

  const customers = await db
    .select({ id: salonCustomersTable.id, salonId: salonCustomersTable.salonId })
    .from(salonCustomersTable);

  const appts = await db
    .select({
      salonId: appointmentsTable.salonId,
      salonCustomerId: appointmentsTable.salonCustomerId,
      date: appointmentsTable.date,
      status: appointmentsTable.status,
      price: appointmentsTable.price,
    })
    .from(appointmentsTable);

  // Salon-wide median of completed prices — same basis as the CRM endpoints
  // (all completed appointments of the salon, linked to a customer or not).
  const completedPricesBySalon = new Map<string, number[]>();
  const apptsByCustomer = new Map<string, AppointmentRecord[]>();
  for (const a of appts) {
    if (a.status === "completed") {
      const prices = completedPricesBySalon.get(a.salonId) ?? [];
      prices.push(a.price);
      completedPricesBySalon.set(a.salonId, prices);
    }
    if (a.salonCustomerId) {
      const records = apptsByCustomer.get(a.salonCustomerId) ?? [];
      records.push({
        date: a.date,
        status: a.status as AppointmentRecord["status"],
        price: a.price,
      });
      apptsByCustomer.set(a.salonCustomerId, records);
    }
  }
  const medianBySalon = new Map<string, number | undefined>();
  for (const [salonId, prices] of completedPricesBySalon) {
    medianBySalon.set(salonId, computeSalonMedianSpend(prices));
  }

  // One fixed "today" so both passes see the same clock.
  const today = new Date();

  const currentCounts = emptyStatusCounts();
  const candidateCounts = emptyStatusCounts();
  const shiftCounts = new Map<string, number>();
  const reclassifiedBySalon = new Map<string, number>();
  let reclassifiedCount = 0;

  for (const customer of customers) {
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

  // Top-N most-affected salons. Ties break on salonId so the cut is
  // deterministic; names are fetched only for the salons that made the cut
  // (read-only lookup — the preview still never writes anything).
  const topAffected = [...reclassifiedBySalon.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PREVIEW_TOP_AFFECTED_SALONS_LIMIT);

  let topAffectedSalons: RetentionPreviewAffectedSalon[] = [];
  if (topAffected.length > 0) {
    const salonRows = await db
      .select({ id: salonsTable.id, name: salonsTable.name })
      .from(salonsTable)
      .where(inArray(salonsTable.id, topAffected.map(([salonId]) => salonId)));
    const nameById = new Map(salonRows.map((row) => [row.id, row.name]));
    topAffectedSalons = topAffected.map(([salonId, count]) => ({
      salonId,
      salonName: nameById.get(salonId) ?? "Nepoznat salon",
      reclassifiedCount: count,
    }));
  }

  return {
    currentVersion: active.version,
    totalCustomers: customers.length,
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
      changedByName:
        row.changedByFirstName || row.changedByLastName
          ? `${row.changedByFirstName ?? ""} ${row.changedByLastName ?? ""}`.trim()
          : null,
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
