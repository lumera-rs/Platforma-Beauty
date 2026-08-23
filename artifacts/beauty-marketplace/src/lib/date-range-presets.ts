import type { DateRange } from "react-day-picker";

/** Local calendar date → YYYY-MM-DD (no UTC conversion, so the picked day is kept). */
export function toDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One-click shortcuts for the most common custom windows. Each returns an
 * inclusive local-calendar range (same semantics as manual picking, which
 * `toDateParam` then serializes without UTC conversion). "This month" and
 * "last 14 days" end today because future days are not selectable anyway.
 *
 * `getRange` accepts an explicit "now" so month arithmetic (year boundaries,
 * leap February, 28/29/30/31-day lengths) can be unit-tested on pinned dates;
 * callers omit it to get the current local date.
 */
export const rangePresets: {
  key: string;
  label: string;
  getRange: (now?: Date) => DateRange;
}[] = [
  {
    key: "last-month",
    label: "Prošli mesec",
    getRange: (now = new Date()) => {
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 0),
      };
    },
  },
  {
    key: "this-month",
    label: "Ovaj mesec",
    getRange: (now = new Date()) => {
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    },
  },
  {
    key: "last-14d",
    label: "Poslednjih 14 dana",
    getRange: (now = new Date()) => {
      return {
        from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13),
        to: now,
      };
    },
  },
];
