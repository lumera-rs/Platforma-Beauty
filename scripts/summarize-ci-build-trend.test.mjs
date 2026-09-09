import assert from "node:assert/strict";
import test from "node:test";

import { buildTrend, median } from "./summarize-ci-build-trend.mjs";

const report = (startedAt, slow, duration = 100) => ({
  status: "passed",
  startedAt,
  phases: ["scripts:typecheck", "build:release", "validate:ci:build:total"].map((name) => ({
    name,
    durationSeconds: duration,
    significantSlowdown: slow,
  })),
});

test("median supports even and odd histories", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("requires the configured number of consecutive slow successful reports", () => {
  const trend = buildTrend(
    report("2026-09-09T12:00:00Z", true),
    [
      report("2026-09-08T12:00:00Z", true),
      report("2026-09-07T12:00:00Z", false),
      report("2026-09-06T12:00:00Z", true),
    ],
    3,
  );
  assert.equal(trend[0].sustainedSlowdown, false);
  assert.equal(trend[0].consecutiveSlowdowns, 2);
});

test("marks a slowdown only after enough consecutive confirmations", () => {
  const trend = buildTrend(
    report("2026-09-09T12:00:00Z", true, 130),
    [
      report("2026-09-08T12:00:00Z", true, 110),
      report("2026-09-07T12:00:00Z", true, 120),
    ],
    3,
  );
  assert.equal(trend[0].sustainedSlowdown, true);
  assert.equal(trend[0].medianSeconds, 120);
});