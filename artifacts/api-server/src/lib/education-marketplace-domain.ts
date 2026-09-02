import {
  EDUCATION_BELGRADE_TIME_ZONE,
  addEducationBelgradeCalendarDays as addCalendarDays,
  educationBelgradeDateKey as belgradeDateKey,
} from "./education-belgrade-calendar";

export type EducationPaymentModeInput = {
  format: "online" | "in-person" | "hybrid";
  paymentMode: "online_full" | "live_deposit" | "live_off_platform";
  depositAmount: number | null;
  price: number;
};

export const EDUCATION_MARKETPLACE_TIME_ZONE = EDUCATION_BELGRADE_TIME_ZONE;
export const educationBelgradeDateKey = belgradeDateKey;
/** Backwards-compatible marketplace entry point. */
export function addEducationBelgradeCalendarDays(instant: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) throw new Error("Broj dana plasmana nije ispravan.");
  return addCalendarDays(instant, days);
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

export const EDUCATION_ENROLLMENT_SETTLEMENT_NOTICE =
  "Uplata i pristup kursu biće evidentirani tek nakon ručne potvrde LUMERA administracije.";

export function publicEducationEnrollmentPaymentInstructions(
  enrollmentId: string,
  snapshot: Record<string, unknown>,
) {
  return {
    enrollmentId,
    ...snapshot,
    paymentStatus: "pending" as const,
    settlementNotice: EDUCATION_ENROLLMENT_SETTLEMENT_NOTICE,
  };
}

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

export function educationEnrollmentPaymentReference(enrollmentId: string): string {
  const normalizedId = enrollmentId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(normalizedId)) throw new Error("IPS_PAYMENT_REFERENCE_INVALID");
  return `EDU${normalizedId}`;
}

/** NBS IPS amount field: currency prefix, no grouping, and a decimal comma. */
export function formatEducationIpsAmount(amount: number): string {
  const minorUnits = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(minorUnits)
    || Math.abs(amount * 100 - minorUnits) > 1e-7) {
    throw new Error("IPS_PAYMENT_AMOUNT_INVALID");
  }
  return `RSD${(minorUnits / 100).toFixed(2).replace(".", ",")}`;
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

export const EDUCATION_PAYMENT_UNAVAILABLE_ERROR = {
  code: "EDUCATION_PAYMENT_UNAVAILABLE",
  error: "Uplata za Education prijavu trenutno nije dostupna. Pokušajte ponovo kasnije ili kontaktirajte podršku.",
} as const;

export function isEducationPaymentConfigurationError(error: unknown): boolean {
  return error instanceof Error && [
    "IPS_PAYMENT_ACCOUNT_NOT_CONFIGURED",
    "IPS_PAYMENT_ACCOUNT_INVALID",
    "IPS_PAYMENT_PRODUCTION_ACCOUNT_BLOCKED",
  ].includes(error.message);
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
  const formattedAmount = formatEducationIpsAmount(input.amount);
  if (!input.reference.trim() || input.reference.length > 35) throw new Error("IPS_PAYMENT_REFERENCE_INVALID");
  const paymentCode = educationIpsPaymentCode(input.recipientType);
  const fields = [
    "K:PR", "V:01", "C:1", `R:${account}`, `N:${recipient}`,
    `I:${formattedAmount}`, `P:${purpose}`, `SF:${paymentCode}`, `S:${input.reference.trim()}`,
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