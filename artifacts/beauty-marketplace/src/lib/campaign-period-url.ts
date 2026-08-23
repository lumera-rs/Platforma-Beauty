import type { DateRange } from "react-day-picker";
import { toDateParam } from "./date-range-presets";

/** Campaign stats window: bounded presets, all time, or an exact custom range. */
export type StatsPeriod = "7d" | "30d" | "90d" | "all" | "custom";

export type PeriodSelection =
  | { period: Exclude<StatsPeriod, "custom">; range?: undefined }
  | { period: "custom"; range: DateRange };

/**
 * Restore the campaign period from the URL query string so the picked window
 * is bookmarkable/shareable. A complete valid from/to pair wins over ?period=;
 * anything invalid or malformed falls back to the default ("all time").
 */
export function parsePeriodSelection(search: string): PeriodSelection {
  const params = new URLSearchParams(search);
  const from = parseDateParam(params.get("from"));
  const to = parseDateParam(params.get("to"));
  if (from && to && from.getTime() <= to.getTime()) {
    return { period: "custom", range: { from, to } };
  }
  const period = params.get("period");
  if (period === "7d" || period === "30d" || period === "90d" || period === "all") {
    return { period };
  }
  return { period: "all" };
}

/**
 * Parse a YYYY-MM-DD query value into a local Date. Rejects anything that is
 * not strictly YYYY-MM-DD, plus impossible calendar dates that V8 would
 * silently roll over (e.g. 2026-02-30 → March 2) via a round-trip check.
 */
export function parseDateParam(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return toDateParam(date) === raw ? date : null;
}

/**
 * Mirror the selection back into a query string (the URL-sync counterpart of
 * `parsePeriodSelection`). Existing unrelated params in `searchString` are
 * preserved; period/from/to are rewritten from the selection. Returns `null`
 * while a custom range is incomplete (nothing valid to restore yet — the URL
 * must not change). The default "all time" writes none of the three params,
 * which both keeps a clean URL and strips invalid params that fell back to
 * the default.
 */
export function serializePeriodSelection(
  searchString: string,
  period: StatsPeriod,
  customRange: DateRange | undefined,
): string | null {
  const params = new URLSearchParams(searchString);
  params.delete("period");
  params.delete("from");
  params.delete("to");
  if (period === "custom") {
    if (!customRange?.from || !customRange?.to) return null;
    params.set("from", toDateParam(customRange.from));
    params.set("to", toDateParam(customRange.to));
  } else if (period !== "all") {
    params.set("period", period);
  }
  return params.toString();
}
