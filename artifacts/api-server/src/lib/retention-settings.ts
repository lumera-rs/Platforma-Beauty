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

import { desc, eq, sql } from "drizzle-orm";
import { db, platformRetentionSettingsTable, usersTable } from "@workspace/db";
import {
  DEFAULT_RETENTION_THRESHOLDS,
  type RetentionThresholds,
} from "./retention-classification";

/** Stable advisory-lock key for serializing settings updates. */
const RETENTION_SETTINGS_LOCK_KEY = "platform_retention_settings";

export interface ActiveRetentionSettings {
  /** 0 when platform defaults apply (no admin change recorded yet). */
  version: number;
  thresholds: RetentionThresholds;
  changedByUserId: string | null;
  changedAt: Date | null;
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
    };
  }
  return {
    version: row.version,
    thresholds: rowToThresholds(row),
    changedByUserId: row.changedByUserId,
    changedAt: row.createdAt,
  };
}

/**
 * Record a new settings version. Caller must have validated the candidate
 * (this function re-validates defensively and throws on invalid input).
 * Returns the newly active settings.
 */
export async function updateRetentionSettings(
  changedByUserId: string,
  candidate: RetentionThresholds,
): Promise<ActiveRetentionSettings> {
  const problems = validateRetentionThresholds(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid retention thresholds: ${problems.join(" ")}`);
  }

  const inserted = await db.transaction(async (tx) => {
    // Serialize concurrent updates so version numbers are strictly sequential.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${RETENTION_SETTINGS_LOCK_KEY}))`);
    const [current] = await tx
      .select({ version: platformRetentionSettingsTable.version })
      .from(platformRetentionSettingsTable)
      .orderBy(desc(platformRetentionSettingsTable.version))
      .limit(1);
    const nextVersion = (current?.version ?? 0) + 1;
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
      })
      .returning();
    if (!row) throw new Error("Failed to insert retention settings version.");
    return row;
  });

  return {
    version: inserted.version,
    thresholds: rowToThresholds(inserted),
    changedByUserId: inserted.changedByUserId,
    changedAt: inserted.createdAt,
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
    };
  });
}
