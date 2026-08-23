import assert from "node:assert/strict";
import test from "node:test";
import type { DateRange } from "react-day-picker";
import {
  parseDateParam,
  parsePeriodSelection,
  serializePeriodSelection,
  type PeriodSelection,
  type StatsPeriod,
} from "./campaign-period-url";

/**
 * Regression coverage for shared/bookmarked campaign-period links on the
 * owner automations page. The page restores the window from the query string
 * on load (`parsePeriodSelection`) and mirrors the live selection back into
 * the URL (`serializePeriodSelection`); invalid params must fall back to the
 * default "Sve vreme" and then serialize to a clean URL instead of crashing
 * or silently showing a different window than the link promised.
 */

const ALL_TIME: PeriodSelection = { period: "all" };

function assertRange(selection: PeriodSelection, from: Date, to: Date) {
  assert.equal(selection.period, "custom");
  assert.ok(selection.range, "custom selection carries a range");
  assert.equal(selection.range.from?.getTime(), from.getTime());
  assert.equal(selection.range.to?.getTime(), to.getTime());
}

/** Simulate the page's URL-sync effect after a restore: parse, then re-serialize. */
function roundTripSearch(search: string): string {
  const restored = parsePeriodSelection(search);
  const next = serializePeriodSelection(
    search.startsWith("?") ? search.slice(1) : search,
    restored.period,
    restored.range,
  );
  assert.notEqual(next, null, "a restored selection is always complete, so the sync never bails");
  return next as string;
}

// --- Preset restore (?period=) ---------------------------------------------

test("?period=30d restores the 30-day preset after reload", () => {
  assert.deepEqual(parsePeriodSelection("?period=30d"), { period: "30d" });
});

test("every valid preset value round-trips through the URL", () => {
  for (const period of ["7d", "30d", "90d", "all"] as const) {
    assert.deepEqual(parsePeriodSelection(`?period=${period}`), { period });
  }
});

test("unknown period values fall back to all time", () => {
  for (const bad of ["14d", "1y", "week", "30", "30D", "", "custom"]) {
    assert.deepEqual(parsePeriodSelection(`?period=${bad}`), ALL_TIME, `?period=${bad}`);
  }
});

// --- Custom range restore (?from&to) ----------------------------------------

test("a complete valid from/to pair restores the exact custom range", () => {
  const selection = parsePeriodSelection("?from=2026-01-05&to=2026-02-10");
  assertRange(selection, new Date(2026, 0, 5), new Date(2026, 1, 10));
});

test("a single-day range (from equals to) is valid", () => {
  const selection = parsePeriodSelection("?from=2026-03-15&to=2026-03-15");
  assertRange(selection, new Date(2026, 2, 15), new Date(2026, 2, 15));
});

test("a complete valid from/to pair wins over an also-present ?period=", () => {
  const selection = parsePeriodSelection("?period=30d&from=2026-01-01&to=2026-01-31");
  assertRange(selection, new Date(2026, 0, 1), new Date(2026, 0, 31));
});

test("an incomplete pair falls back to a still-valid ?period=", () => {
  assert.deepEqual(parsePeriodSelection("?from=2026-01-01&period=7d"), { period: "7d" });
});

// --- Invalid inputs must not crash and must fall back to all time -----------

test("impossible calendar dates like 2026-02-30 fall back to all time", () => {
  // V8 would silently roll 2026-02-30 over to March 2 — the round-trip check
  // in parseDateParam must reject it instead of restoring a shifted window.
  assert.deepEqual(parsePeriodSelection("?from=2026-02-30&to=2026-03-05"), ALL_TIME);
  assert.deepEqual(parsePeriodSelection("?from=2026-02-01&to=2026-02-30"), ALL_TIME);
  assert.deepEqual(parsePeriodSelection("?from=2026-13-01&to=2026-13-05"), ALL_TIME);
  assert.deepEqual(parsePeriodSelection("?from=2026-04-31&to=2026-05-01"), ALL_TIME);
});

test("from after to falls back to all time", () => {
  assert.deepEqual(parsePeriodSelection("?from=2026-05-10&to=2026-05-01"), ALL_TIME);
});

test("malformed date strings fall back to all time", () => {
  for (const search of [
    "?from=05.01.2026&to=10.01.2026", // local display format, not YYYY-MM-DD
    "?from=2026-1-5&to=2026-2-10", // missing zero padding
    "?from=2026-01-05T00:00:00&to=2026-02-10", // timestamp, not a plain date
    "?from=garbage&to=2026-02-10",
    "?from=2026-01-05&to=", // empty to
    "?from=2026-01-05", // missing to entirely
    "?to=2026-02-10", // missing from entirely
  ]) {
    assert.deepEqual(parsePeriodSelection(search), ALL_TIME, search);
  }
});

test("no relevant params at all defaults to all time without crashing", () => {
  assert.deepEqual(parsePeriodSelection(""), ALL_TIME);
  assert.deepEqual(parsePeriodSelection("?"), ALL_TIME);
  assert.deepEqual(parsePeriodSelection("?utm_source=newsletter"), ALL_TIME);
});

test("parseDateParam rejects rollover dates and accepts real ones", () => {
  assert.equal(parseDateParam("2026-02-30"), null);
  assert.equal(parseDateParam("2026-00-10"), null);
  assert.equal(parseDateParam(null), null);
  assert.equal(parseDateParam("2024-02-29")?.getTime(), new Date(2024, 1, 29).getTime());
  assert.equal(parseDateParam("2026-02-28")?.getTime(), new Date(2026, 1, 28).getTime());
});

// --- URL sync: cleaning and round-trips --------------------------------------

test("invalid params are cleaned from the URL after falling back to all time", () => {
  // The default "all time" writes none of the period params, so the sync
  // effect strips whatever invalid values the shared link carried.
  assert.equal(roundTripSearch("?from=2026-02-30&to=2026-03-05"), "");
  assert.equal(roundTripSearch("?period=eternity"), "");
  assert.equal(roundTripSearch("?from=2026-05-10&to=2026-05-01"), "");
});

test("cleaning invalid period params preserves unrelated query params", () => {
  assert.equal(
    roundTripSearch("?utm_source=newsletter&period=bogus"),
    "utm_source=newsletter",
  );
});

test("a restored valid selection serializes back to the same params (stable URL)", () => {
  assert.equal(roundTripSearch("?period=30d"), "period=30d");
  assert.equal(
    roundTripSearch("?from=2026-01-05&to=2026-02-10"),
    "from=2026-01-05&to=2026-02-10",
  );
  // A valid pair wins over ?period=, and the losing param is dropped.
  assert.equal(
    roundTripSearch("?period=30d&from=2026-01-01&to=2026-01-31"),
    "from=2026-01-01&to=2026-01-31",
  );
});

test("serializing the default all time yields a clean URL", () => {
  assert.equal(serializePeriodSelection("", "all", undefined), "");
});

test("bounded presets serialize as ?period=", () => {
  for (const period of ["7d", "30d", "90d"] as StatsPeriod[]) {
    assert.equal(serializePeriodSelection("", period, undefined), `period=${period}`);
  }
});

test("an incomplete custom range must not touch the URL", () => {
  const startOnly: DateRange = { from: new Date(2026, 0, 5), to: undefined };
  assert.equal(serializePeriodSelection("period=30d", "custom", startOnly), null);
  assert.equal(serializePeriodSelection("", "custom", undefined), null);
});

test("a complete custom range serializes both dates zero-padded", () => {
  const range: DateRange = { from: new Date(2026, 0, 5), to: new Date(2026, 1, 10) };
  assert.equal(
    serializePeriodSelection("", "custom", range),
    "from=2026-01-05&to=2026-02-10",
  );
});
