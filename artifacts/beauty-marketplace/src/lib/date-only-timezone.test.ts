import assert from "node:assert/strict";
import test from "node:test";
import { formatDateOnly, formatLocalDateOnly, parseLocalDateOnly } from "./date-only";

const dateOnlyCases = [
  "2024-02-29",
  "2024-03-01",
  "2024-09-29",
  "2025-04-06",
  "2024-12-31",
  "2025-01-01",
];

test("date-only helpers preserve local positive-offset DST and midnight calendar days", () => {
  for (const source of dateOnlyCases) {
    const local = parseLocalDateOnly(source);
    assert.ok(local, `${source} should be a valid local calendar date`);
    assert.equal(formatLocalDateOnly(local), source);
  }

  for (const impossible of ["2025-02-29", "2025-02-30", "2024-04-31", "2024-13-01", "2024-00-01"]) {
    assert.equal(parseLocalDateOnly(impossible), null, `${impossible} must not normalize locally`);
  }

  const serialized = formatLocalDateOnly(parseLocalDateOnly("2024-09-29")!);
  assert.equal(serialized, "2024-09-29");
  assert.equal(formatDateOnly(new Date("2024-09-29T00:00:00.000Z"), "yyyy-MM-dd"), "2024-09-29");
});