import { createHash } from "node:crypto";

export type EducationBillingCycle = "monthly" | "yearly";

const BELGRADE = "Europe/Belgrade";

function belgradeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGRADE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value),
  };
}

function belgradeWallClockToUtc(parts: ReturnType<typeof belgradeParts>) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = belgradeParts(new Date(candidate));
    const observedWallClock = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const correction = target - observedWallClock;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

export function addEducationBillingPeriod(start: Date, cycle: EducationBillingCycle) {
  const parts = belgradeParts(start);
  const months = cycle === "yearly" ? 12 : 1;
  const lastDay = new Date(Date.UTC(parts.year, parts.month - 1 + months + 1, 0, 12)).getUTCDate();
  const rawMonth = parts.month - 1 + months;
  return belgradeWallClockToUtc({
    ...parts,
    year: parts.year + Math.floor(rawMonth / 12),
    month: (rawMonth % 12) + 1,
    day: Math.min(parts.day, lastDay),
  });
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
  const full = Math.max(1, input.periodEnd.getTime() - input.periodStart.getTime());
  const remaining = Math.max(0, input.periodEnd.getTime() - input.now.getTime());
  const difference = Math.max(0, educationCycleAmount(input.nextMonthlyPrice - input.currentMonthlyPrice, input.billingCycle));
  return Math.ceil(difference * Math.min(1, remaining / full));
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

export function hashTrialIdentifier(value: string | null) {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

export function educationPaymentReference(prefix: string, id: string) {
  return `${prefix}${createHash("sha256").update(id).digest("hex").replace(/\D/g, "").padStart(18, "0").slice(0, 18)}`;
}