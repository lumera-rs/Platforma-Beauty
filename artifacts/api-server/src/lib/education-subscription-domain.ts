import { createHash } from "node:crypto";
import { addEducationBelgradeCalendarMonths } from "./education-belgrade-calendar";

export type EducationBillingCycle = "monthly" | "yearly";

export function addEducationBillingPeriod(start: Date, cycle: EducationBillingCycle) {
  return addEducationBelgradeCalendarMonths(start, cycle === "yearly" ? 12 : 1);
}

export function educationCycleAmount(monthlyPrice: number, cycle: EducationBillingCycle) {
  return monthlyPrice * (cycle === "yearly" ? 12 : 1);
}

export function educationUpgradeProration(input: {
  currentMonthlyPrice: number;
  nextMonthlyPrice: number;
  billingCycle: EducationBillingCycle;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}) {
  return educationUpgradeProrationQuote(input).payableWholeRsd;
}

/**
 * Existing payable columns store whole RSD. Proration is therefore computed
 * deterministically to two decimal RSD (half-up for non-negative amounts), then
 * rounded half-up to whole RSD exactly once at the immutable obligation boundary.
 * A positive prorated difference has a 1 RSD minimum because IPS payment
 * instructions cannot represent a zero-value charge.
 */
export function educationUpgradeProrationQuote(input: {
  currentMonthlyPrice: number;
  nextMonthlyPrice: number;
  billingCycle: EducationBillingCycle;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}) {
  const full = Math.max(1, input.periodEnd.getTime() - input.periodStart.getTime());
  const remaining = Math.max(0, input.periodEnd.getTime() - input.now.getTime());
  const difference = Math.max(0, educationCycleAmount(input.nextMonthlyPrice - input.currentMonthlyPrice, input.billingCycle));
  const exactTwoDecimalRsd = Math.round((difference * Math.min(1, remaining / full) + Number.EPSILON) * 100) / 100;
  return {
    exactTwoDecimalRsd,
    payableWholeRsd: difference > 0 && remaining > 0 ? Math.max(1, Math.round(exactTwoDecimalRsd)) : 0,
    policy: "Proration is rounded half-up to 2 decimal RSD; the immutable payable amount is then rounded half-up to whole RSD with a 1 RSD minimum for a positive difference.",
  } as const;
}

export function normalizeTrialEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeTrialPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

export function normalizeTrialPib(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return normalized || null;
}

export function normalizeTrialRegistrationNumber(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

export function normalizeTrialBankAccount(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

export function hashTrialIdentifier(value: string | null) {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

export function educationPaymentReference(prefix: string, id: string) {
  return `${prefix}${createHash("sha256").update(id).digest("hex").replace(/\D/g, "").padStart(18, "0").slice(0, 18)}`;
}