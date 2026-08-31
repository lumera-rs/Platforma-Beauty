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