export const EDUCATION_TIME_ZONE = "Europe/Belgrade";

function parts(value: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EDUCATION_TIME_ZONE, ...options }).formatToParts(value);
}

export function educationBelgradeDateKey(value: Date): string {
  const p = parts(value, { year: "numeric", month: "2-digit", day: "2-digit" });
  const get = (type: Intl.DateTimeFormatPartTypes) => p.find((item) => item.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function educationBelgradeTime(value: Date): string {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: EDUCATION_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(value);
}

export function educationBelgradeDateLabel(value: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: EDUCATION_TIME_ZONE, ...options }).format(value);
}

export function educationBookingCtaVisible(input: {
  hasFutureSession: boolean; hasNextAvailable: boolean; isAdmin: boolean; isPublisher: boolean;
}) {
  return (input.hasFutureSession || input.hasNextAvailable) && !input.isAdmin && !input.isPublisher;
}

export function educationCancellationReasonValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= 3 && length <= 1000;
}