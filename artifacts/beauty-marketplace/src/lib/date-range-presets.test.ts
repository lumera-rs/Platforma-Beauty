import assert from "node:assert/strict";
import test from "node:test";
import type { DateRange } from "react-day-picker";
import { rangePresets, toDateParam } from "./date-range-presets";

function preset(key: string) {
  const found = rangePresets.find((p) => p.key === key);
  assert.ok(found, `preset "${key}" is registered`);
  return found;
}

/** Serialize a preset range the same way the page does before hitting the API. */
function serialized(range: DateRange): { from: string; to: string } {
  assert.ok(range.from, "preset range has a `from` date");
  assert.ok(range.to, "preset range has a `to` date");
  return { from: toDateParam(range.from), to: toDateParam(range.to) };
}

test("toDateParam keeps the local calendar day and zero-pads month/day", () => {
  assert.equal(toDateParam(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toDateParam(new Date(2026, 11, 31)), "2026-12-31");
  // Late-evening local time must not shift the day (no UTC conversion).
  assert.equal(toDateParam(new Date(2026, 8, 9, 23, 59, 59)), "2026-09-09");
});

test("last month from January 1 crosses the year boundary into December", () => {
  const range = preset("last-month").getRange(new Date(2026, 0, 1));
  assert.deepEqual(serialized(range), { from: "2025-12-01", to: "2025-12-31" });
});

test("last month from March 1 after a leap February ends on the 29th", () => {
  const range = preset("last-month").getRange(new Date(2024, 2, 1));
  assert.deepEqual(serialized(range), { from: "2024-02-01", to: "2024-02-29" });
});

test("last month from March in a non-leap year ends on February 28", () => {
  const range = preset("last-month").getRange(new Date(2026, 2, 15));
  assert.deepEqual(serialized(range), { from: "2026-02-01", to: "2026-02-28" });
});

test("last month from December 31 covers all of 30-day November", () => {
  const range = preset("last-month").getRange(new Date(2026, 11, 31));
  assert.deepEqual(serialized(range), { from: "2026-11-01", to: "2026-11-30" });
});

test("last month from the 31st does not roll over into the current month", () => {
  // July 31 → June has only 30 days; naive setMonth-style math would land on July 1.
  const range = preset("last-month").getRange(new Date(2026, 6, 31));
  assert.deepEqual(serialized(range), { from: "2026-06-01", to: "2026-06-30" });
});

test("this month on January 1 is the single first day of the year", () => {
  const range = preset("this-month").getRange(new Date(2026, 0, 1));
  assert.deepEqual(serialized(range), { from: "2026-01-01", to: "2026-01-01" });
});

test("this month on leap-day February 29 spans the whole leap February", () => {
  const range = preset("this-month").getRange(new Date(2024, 1, 29));
  assert.deepEqual(serialized(range), { from: "2024-02-01", to: "2024-02-29" });
});

test("this month on December 31 spans the whole final month of the year", () => {
  const range = preset("this-month").getRange(new Date(2026, 11, 31));
  assert.deepEqual(serialized(range), { from: "2026-12-01", to: "2026-12-31" });
});

test("last 14 days from January 5 reaches back across the year boundary", () => {
  const range = preset("last-14d").getRange(new Date(2026, 0, 5));
  // Dec 23 → Jan 5 is exactly 14 inclusive calendar days.
  assert.deepEqual(serialized(range), { from: "2025-12-23", to: "2026-01-05" });
});

test("last 14 days across a leap February counts the 29th", () => {
  const range = preset("last-14d").getRange(new Date(2024, 2, 10));
  // Feb 26–29 (4 days) + Mar 1–10 (10 days) = 14 inclusive days.
  assert.deepEqual(serialized(range), { from: "2024-02-26", to: "2024-03-10" });
});

test("last 14 days across a non-leap February starts one day later", () => {
  const range = preset("last-14d").getRange(new Date(2026, 2, 10));
  // Feb 25–28 (4 days) + Mar 1–10 (10 days) = 14 inclusive days.
  assert.deepEqual(serialized(range), { from: "2026-02-25", to: "2026-03-10" });
});

test("every preset yields an inclusive range that never ends before it starts", () => {
  const pinnedNows = [
    new Date(2026, 0, 1),
    new Date(2024, 2, 1),
    new Date(2026, 11, 31),
  ];
  for (const now of pinnedNows) {
    for (const p of rangePresets) {
      const range = p.getRange(now);
      const { from, to } = serialized(range);
      assert.ok(
        from <= to,
        `${p.key} at ${toDateParam(now)}: from (${from}) must not exceed to (${to})`,
      );
      assert.ok(
        to <= toDateParam(now),
        `${p.key} at ${toDateParam(now)}: to (${to}) must not be in the future`,
      );
    }
  }
});
