import { format, isValid } from "date-fns";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses an API/HTML date-only value without applying a UTC offset.
 * Returns null for partial and impossible dates such as 2025-02-30.
 */
export function parseLocalDateOnly(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);

  if (
    !isValid(date)
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatLocalDateOnly(date: Date): string | null {
  return isValid(date) ? format(date, "yyyy-MM-dd") : null;
}

export function formatDateOnly(value: string | Date, pattern: string): string | null {
  const normalized = value instanceof Date
    ? isValid(value)
      ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`
      : null
    : value.slice(0, 10);
  const date = normalized ? parseLocalDateOnly(normalized) : null;
  return date ? format(date, pattern) : null;
}