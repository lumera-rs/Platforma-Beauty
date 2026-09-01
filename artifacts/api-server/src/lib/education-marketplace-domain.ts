export type EducationPaymentModeInput = {
  format: "online" | "in-person" | "hybrid";
  paymentMode: "online_full" | "live_deposit" | "live_off_platform";
  depositAmount: number | null;
  price: number;
};

export const EDUCATION_MARKETPLACE_TIME_ZONE = "Europe/Belgrade";

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedDateTimeParts(instant: Date): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EDUCATION_MARKETPLACE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function wallClockToBelgradeInstant(parts: ZonedDateTimeParts, millisecond: number): Date {
  const targetWallClock = Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, millisecond,
  );
  let candidate = targetWallClock;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedDateTimeParts(new Date(candidate));
    const observedWallClock = Date.UTC(
      observed.year, observed.month - 1, observed.day,
      observed.hour, observed.minute, observed.second, millisecond,
    );
    const correction = targetWallClock - observedWallClock;
    if (correction === 0) break;
    candidate += correction;
  }
  return new Date(candidate);
}

export function educationBelgradeDateKey(instant: Date): string {
  const parts = zonedDateTimeParts(instant);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addEducationBelgradeCalendarDays(instant: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) throw new Error("Broj dana plasmana nije ispravan.");
  const current = zonedDateTimeParts(instant);
  const targetDate = new Date(Date.UTC(current.year, current.month - 1, current.day + days, 12));
  return wallClockToBelgradeInstant({
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour: current.hour,
    minute: current.minute,
    second: current.second,
  }, instant.getUTCMilliseconds());
}

export function educationPaymentModeError(input: EducationPaymentModeInput): string | null {
  if (input.format === "online" && input.paymentMode !== "online_full") {
    return "Online edukacija mora koristiti punu online uplatu.";
  }
  if (input.paymentMode === "live_deposit") {
    if (input.format === "online") return "Depozit je dostupan samo za edukacije uživo.";
    if (!Number.isInteger(input.depositAmount) || input.depositAmount === null || input.depositAmount <= 0 || input.depositAmount > input.price) {
      return "Depozit mora biti pozitivan ceo iznos koji nije veći od cene kursa.";
    }
  } else if (input.depositAmount !== null) {
    return "Iznos depozita se šalje samo uz način plaćanja live_deposit.";
  }
  return null;
}

export type EducationOperationalPricePolicy = {
  price: number;
  earlyBirdPrice: number | null;
  earlyBirdCutoff: Date | null;
  groupDiscountMinimum: number | null;
  groupDiscountPercent: number | null;
  paymentMode: EducationPaymentModeInput["paymentMode"];
  depositAmount: number | null;
  installmentCount: number;
};

/**
 * Commercial terms are calculated once, at the command instant, and copied to
 * the immutable booking snapshot.  The cutoff is an instant (not a date), so
 * the strict comparison remains correct on both Belgrade DST transition days.
 */
export function educationOperationalPriceQuote(
  policy: EducationOperationalPricePolicy,
  participantCount: number,
  now: Date,
) {
  if (!Number.isInteger(participantCount) || participantCount < 1) throw new Error("Broj polaznika nije ispravan.");
  if (!Number.isInteger(policy.installmentCount) || ![1, 2, 3].includes(policy.installmentCount)) throw new Error("Broj rata mora biti 1, 2 ili 3.");
  if (policy.earlyBirdPrice !== null && (!policy.earlyBirdCutoff || policy.earlyBirdPrice < 0 || policy.earlyBirdPrice >= policy.price)) {
    throw new Error("Early-bird cena mora biti manja od pune cene i imati važeći rok.");
  }
  const earlyBirdApplied = policy.earlyBirdPrice !== null
    && policy.earlyBirdCutoff !== null
    && now.getTime() < policy.earlyBirdCutoff.getTime();
  const unitBase = earlyBirdApplied ? policy.earlyBirdPrice! : policy.price;
  const groupDiscountApplied = policy.groupDiscountMinimum !== null
    && policy.groupDiscountPercent !== null
    && participantCount >= policy.groupDiscountMinimum
    && policy.groupDiscountPercent > 0;
  if (policy.groupDiscountPercent !== null && (!Number.isInteger(policy.groupDiscountPercent) || policy.groupDiscountPercent < 0 || policy.groupDiscountPercent > 100)) {
    throw new Error("Grupni popust nije ispravan.");
  }
  // Discount is computed over the group subtotal once, avoiding per-seat
  // rounding drift and making a snapshot independently auditable.
  const discountedGross = groupDiscountApplied
    ? unitBase * participantCount - Math.floor(unitBase * participantCount * policy.groupDiscountPercent! / 100)
    : unitBase * participantCount;
  const grossAmount = policy.paymentMode === "live_off_platform"
    ? 0
    : policy.paymentMode === "live_deposit"
      ? policy.depositAmount! * participantCount
      : discountedGross;
  if (!Number.isInteger(grossAmount) || grossAmount < 0) throw new Error("Iznos uplate nije ispravan.");
  if (grossAmount === 0 && policy.installmentCount !== 1) throw new Error("Nulta platformska obaveza ne može imati rate.");
  const installments = grossAmount === 0 ? [] : splitEducationInstallments(grossAmount, policy.installmentCount);
  return {
    grossAmount,
    earlyBirdApplied,
    earlyBirdCutoffSnapshot: policy.earlyBirdCutoff,
    discountReason: earlyBirdApplied ? (groupDiscountApplied ? "early_bird_and_group" : "early_bird") : (groupDiscountApplied ? "group" : "none"),
    installments,
  };
}

/** Deterministic front-loaded remainder allocation, always summing to gross. */
export function splitEducationInstallments(grossAmount: number, installmentCount: number): number[] {
  if (!Number.isInteger(grossAmount) || grossAmount <= 0) throw new Error("Iznos rate mora biti pozitivan ceo broj.");
  if (!Number.isInteger(installmentCount) || ![1, 2, 3].includes(installmentCount) || grossAmount < installmentCount) {
    throw new Error("Plan rata nije ispravan.");
  }
  const base = Math.floor(grossAmount / installmentCount);
  const remainder = grossAmount % installmentCount;
  return Array.from({ length: installmentCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export type EducationIpsPaymentInstructions = {
  recipientName: string | null;
  recipientAccount: string | null;
  purpose: string | null;
};

export type EducationIpsRecipientType =
  | "platform"
  | "education_center_individual"
  | "education_center_legal";

export type EducationIpsTransactionType =
  | "subscription"
  | "course_enrollment"
  | "course_extension"
  | "operational_installment"
  | "bundle_purchase"
  | "placement";

export type EducationIpsAccountEnvironment = "production" | "test";

export function educationIpsPaymentCode(recipientType: EducationIpsRecipientType) {
  return recipientType === "education_center_individual" ? "289" : "221";
}

/** NODE_ENV is deliberately reduced to the two payment account classifications. */
export function educationIpsRuntimeEnvironment(): EducationIpsAccountEnvironment {
  const deploymentValue = process.env.REPLIT_DEPLOYMENT ?? process.env.REPL_DEPLOYMENT;
  const publishedDeployment = deploymentValue !== undefined && ["1", "true", "yes", "production"].includes(deploymentValue.trim().toLowerCase());
  const optionalMarkerAllowsProduction = process.env.REPLIT_ENVIRONMENT === undefined || process.env.REPLIT_ENVIRONMENT === "production";
  return process.env.NODE_ENV === "production" && publishedDeployment && optionalMarkerAllowsProduction
    ? "production"
    : "test";
}

/**
 * NBS IPS "S" payload. This is deliberately only a deterministic rendering of
 * an already due obligation: it performs no provider call and has no payment
 * or entitlement side effects.
 */
export function educationIpsQrPayload(input: EducationIpsPaymentInstructions & {
  amount: number;
  reference: string;
  recipientType: EducationIpsRecipientType;
  transactionType: EducationIpsTransactionType;
  /** Classification of the configured recipient account, not the request. */
  accountEnvironment: EducationIpsAccountEnvironment;
  /** Explicit deployment classification keeps payment safety testable. */
  runtimeEnvironment: EducationIpsAccountEnvironment;
}) {
  const recipient = input.recipientName?.trim();
  const account = input.recipientAccount?.replace(/[\s-]/g, "");
  const purpose = input.purpose?.trim();
  if (!recipient || !account || !purpose) throw new Error("IPS_PAYMENT_ACCOUNT_NOT_CONFIGURED");
  if (!/^\d{18}$/.test(account)) throw new Error("IPS_PAYMENT_ACCOUNT_INVALID");
  if (input.accountEnvironment === "production" && input.runtimeEnvironment !== "production") {
    throw new Error("IPS_PAYMENT_PRODUCTION_ACCOUNT_BLOCKED");
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("IPS_PAYMENT_AMOUNT_INVALID");
  if (!input.reference.trim() || input.reference.length > 35) throw new Error("IPS_PAYMENT_REFERENCE_INVALID");
  const paymentCode = educationIpsPaymentCode(input.recipientType);
  const fields = [
    "K:PR", "V:01", "C:1", `R:${account}`, `N:${recipient}`,
    `I:RSD${input.amount.toFixed(2)}`, `P:${purpose}`, `SF:${paymentCode}`, `S:${input.reference.trim()}`,
  ];
  return {
    payload: fields.join("|"),
    recipientName: recipient,
    recipientAccount: account,
    purpose,
    amount: input.amount,
    currency: "RSD" as const,
    reference: input.reference.trim(),
    paymentCode,
  };
}

export function normalizedEducationTaxonomyName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("sr-Latn");
}

export const EDUCATION_MOST_REQUESTED_MIN_EVENTS = 10;
export const EDUCATION_TOP_RATED_MIN_REVIEWS = 5;

export function qualifiesAsMostRequestedEducationCenter(eventCount: number) {
  return Number.isInteger(eventCount) && eventCount >= EDUCATION_MOST_REQUESTED_MIN_EVENTS;
}

export function qualifiesAsTopRatedEducationCenter(reviewCount: number) {
  return Number.isInteger(reviewCount) && reviewCount >= EDUCATION_TOP_RATED_MIN_REVIEWS;
}

export function educationRelatedCourseTier(
  source: { subcategoryId: string | null; tags: string[] },
  candidate: { subcategoryId: string | null; tags: string[] },
) {
  if (source.subcategoryId && candidate.subcategoryId === source.subcategoryId) return 0;
  const sourceTags = new Set(source.tags.map(normalizedEducationTaxonomyName));
  return candidate.tags.some((tag) => sourceTags.has(normalizedEducationTaxonomyName(tag))) ? 1 : null;
}

export function educationGiftVoucherRecipientMatches(
  voucher: { recipientUserId: string | null; recipientEmail: string | null },
  user: { id: string; email: string },
) {
  if (voucher.recipientUserId && voucher.recipientUserId !== user.id) return false;
  if (voucher.recipientEmail && voucher.recipientEmail.toLocaleLowerCase("en-US") !== user.email.toLocaleLowerCase("en-US")) return false;
  return Boolean(voucher.recipientUserId || voucher.recipientEmail);
}