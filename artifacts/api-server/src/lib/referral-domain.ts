import { createHash } from "node:crypto";

export const REFERRAL_CHANNELS = ["A", "B1", "B2", "C", "D"] as const;
export type ReferralChannel = (typeof REFERRAL_CHANNELS)[number];
export type ReferralSourceBusiness = "salon" | "education_center";
export const SALON_TYPE_A_SUBSCRIPTION_DISCOUNT_PERCENT = 20;

export const REFERRAL_POLICY: Record<ReferralChannel, {
  wallet: "B2B" | "B2C";
  /** Integer Serbian dinars, the same unit as commerce price/subtotal/total. */
  rewardAmountRsd: number;
  requiredEvidence: number;
  windowDays?: number;
  windowMonths?: number;
  holdDays: number;
  cap?: { amount: number; period: "calendar_month" | "calendar_week" };
  salonSubscriptionDiscountPercent?: number;
}> = {
  A: {
    wallet: "B2B", rewardAmountRsd: 500, requiredEvidence: 4, windowMonths: 3, holdDays: 14,
    salonSubscriptionDiscountPercent: SALON_TYPE_A_SUBSCRIPTION_DISCOUNT_PERCENT,
  },
  B1: { wallet: "B2C", rewardAmountRsd: 500, requiredEvidence: 4, windowMonths: 3, holdDays: 0 },
  B2: { wallet: "B2C", rewardAmountRsd: 100, requiredEvidence: 3, windowDays: 60, holdDays: 14, cap: { amount: 20, period: "calendar_month" } },
  C: { wallet: "B2B", rewardAmountRsd: 500, requiredEvidence: 4, windowMonths: 3, holdDays: 14 },
  D: { wallet: "B2B", rewardAmountRsd: 100, requiredEvidence: 1, windowDays: 60, holdDays: 30, cap: { amount: 15, period: "calendar_week" } },
};

export function normalizePib(value: string): string {
  const normalized = value.replace(/\D/g, "");
  if (normalized.length < 8 || normalized.length > 14) throw new Error("PIB must contain 8–14 digits.");
  return normalized;
}

/** Stable keys make retrying an authoritative transition safe. */
export function referralIdempotencyKey(operation: string, ...parts: readonly string[]): string {
  if (!operation || parts.some((part) => !part)) throw new Error("Referral idempotency key requires non-empty parts.");
  const digest = createHash("sha256").update([operation, ...parts].join("\u001f")).digest("hex");
  return `referral:${operation}:${digest}`;
}

export function firstTouchLockUntil(capturedAt: Date): Date {
  return new Date(capturedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
}

export function isFirstTouchOpen(existingAttribution: { lockedUntil: Date } | undefined, now: Date): boolean {
  return !existingAttribution || existingAttribution.lockedUntil.getTime() <= now.getTime();
}

export function qualificationHoldUntil(channel: ReferralChannel, qualifiedAt: Date): Date | null {
  const days = REFERRAL_POLICY[channel].holdDays;
  return days ? new Date(qualifiedAt.getTime() + days * 24 * 60 * 60 * 1000) : null;
}

/** Calendar-month-safe addition: Jan 31 + 3 months is Apr 30, not May 1. */
export function addUtcCalendarMonths(start: Date, months: number): Date {
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const targetMonth = result.getUTCMonth();
  result.setUTCMonth(targetMonth + 1, 0);
  result.setUTCDate(Math.min(day, result.getUTCDate()));
  return result;
}

/**
 * Qualification windows are fixed half-open intervals [start, deadline).
 * A/B1 start at persisted admin approval; all other channels start at capture.
 */
export function qualificationWindow(
  channel: ReferralChannel,
  capturedAt: Date,
  trackingStartedAt?: Date | null,
): { start: Date; deadline: Date } {
  const policy = REFERRAL_POLICY[channel];
  const start = channel === "A" || channel === "B1"
    ? trackingStartedAt ? new Date(trackingStartedAt) : null
    : new Date(capturedAt);
  if (!start) {
    throw new Error(`Referral ${channel} tracking has not been unlocked by admin approval.`);
  }
  const deadline = policy.windowMonths
    ? addUtcCalendarMonths(start, policy.windowMonths)
    : new Date(start.getTime() + (policy.windowDays ?? 0) * 24 * 60 * 60 * 1000);
  return { start, deadline };
}

export function creditExpiry(availableAt: Date): Date {
  const expiresAt = new Date(availableAt);
  const day = expiresAt.getUTCDate();
  // setDate(1) prevents JS's month overflow (Aug 31 + 6 months must be Feb
  // 28/29, not March). Restore only up to the target month's final day.
  expiresAt.setUTCDate(1);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 6);
  const targetMonth = expiresAt.getUTCMonth();
  expiresAt.setUTCMonth(targetMonth + 1, 0);
  expiresAt.setUTCDate(Math.min(day, expiresAt.getUTCDate()));
  return expiresAt;
}

export function qualificationSatisfied(channel: ReferralChannel, validEvidenceCount: number): boolean {
  return validEvidenceCount >= REFERRAL_POLICY[channel].requiredEvidence;
}

export function canEarnUnderCap(channel: ReferralChannel, earnedInPeriod: number): boolean {
  const cap = REFERRAL_POLICY[channel].cap;
  return !cap || earnedInPeriod < cap.amount;
}

/** A and C remain deliberately independent counters. */
export function milestoneCrossed(channel: ReferralChannel, priorQualifiedCount: number, nextQualifiedCount: number): number | null {
  if (channel !== "A" && channel !== "C") return null;
  const nextMultiple = Math.floor(nextQualifiedCount / 10) * 10;
  return nextMultiple > priorQualifiedCount && nextMultiple > 0 ? nextMultiple : null;
}

/** A/C counters must be queried per source business, never per owner account. */
export function requiresBusinessScopedCode(channel: ReferralChannel): boolean {
  return channel === "A" || channel === "C" || channel === "D";
}

export function milestoneBenefitKind(
  channel: ReferralChannel,
  sourceBusiness: ReferralSourceBusiness,
): "salon_subscription_reduction" | "education_commission_reduction" | null {
  if (channel !== "A" && channel !== "C") return null;
  if (channel === "C" && sourceBusiness !== "education_center") throw new Error("Channel C milestones require an education center.");
  return sourceBusiness === "salon" ? "salon_subscription_reduction" : "education_commission_reduction";
}

export function referralCreditAvailable(availableCredits: number, negativeOffset: number, merchandiseSubtotal: number): number {
  if (![availableCredits, negativeOffset, merchandiseSubtotal].every(Number.isInteger)) throw new Error("Credit amounts must be integer RSD, matching commerce totals.");
  return Math.max(0, Math.min(merchandiseSubtotal, availableCredits - Math.max(0, negativeOffset)));
}

export type DuplicatePreflightInput = {
  referrerUserId: string;
  referredUserId: string;
  referrerPhoneNormalized?: string | null;
  referredPhoneNormalized?: string | null;
  referrerLegalEntityId?: string | null;
  referredLegalEntityId?: string | null;
};

export function duplicatePreflight(input: DuplicatePreflightInput): { decision: "allow" | "review" | "reject"; reasons: string[] } {
  const reasons: string[] = [];
  if (input.referrerUserId === input.referredUserId) reasons.push("self_referral");
  if (input.referrerPhoneNormalized && input.referrerPhoneNormalized === input.referredPhoneNormalized) reasons.push("normalized_phone_overlap");
  if (input.referrerLegalEntityId && input.referrerLegalEntityId === input.referredLegalEntityId) reasons.push("legal_entity_overlap");
  return { decision: reasons.includes("self_referral") ? "reject" : reasons.length ? "review" : "allow", reasons };
}