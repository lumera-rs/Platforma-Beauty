import assert from "node:assert/strict";
import test from "node:test";

import { buildTrend, median } from "./summarize-ci-build-trend.mjs";

const report = (startedAt, slow, duration = 100, job = "build") => ({
  job,
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

test("uses the database and browser phase sets without mixing job histories", () => {
  const database = {
    job: "database",
    status: "passed",
    startedAt: "2026-09-09T12:00:00Z",
    phases: [
      { name: "database:test:monitoring", durationSeconds: 130, significantSlowdown: true },
      { name: "database:release:2-backend", durationSeconds: 130, significantSlowdown: true },
      { name: "validate:ci:database:total", durationSeconds: 130, significantSlowdown: true },
    ],
  };
  const build = report("2026-09-08T12:00:00Z", true);
  const trend = buildTrend(database, [build], 2);

  assert.deepEqual(trend.map((phase) => phase.name), [
    "database:test:monitoring",
    "database:test:backend-standards:static",
    "database:release:2-backend",
    "database:release:3-api",
    "validate:ci:database:total",
  ]);
  assert.equal(trend[0].observations, 1);
  assert.equal(trend[0].sustainedSlowdown, false);
});

test("a missing phase observation cannot confirm a sustained slowdown", () => {
  const current = report("2026-09-09T12:00:00Z", true);
  const missing = {
    ...report("2026-09-08T12:00:00Z", true),
    phases: [],
  };
  const older = report("2026-09-07T12:00:00Z", true);
  const trend = buildTrend(current, [missing, older], 3);

  assert.equal(trend[0].observations, 2);
  assert.equal(trend[0].consecutiveSlowdowns, 1);
  assert.equal(trend[0].sustainedSlowdown, false);
});