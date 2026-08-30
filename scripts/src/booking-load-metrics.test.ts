import assert from "node:assert/strict";
import test from "node:test";
import { classifyLoadSamples, latencySummary } from "./booking-load-metrics";

test("classifies expected HTTP outcomes and summarizes percentile latency", () => {
  const samples = [{ status: 201, milliseconds: 1 }, { status: 409, code: "CONFLICT", milliseconds: 2 }, { milliseconds: 8, timeout: true }];
  assert.deepEqual(classifyLoadSamples(samples), { statuses: { "201": 1, "409": 1 }, codes: { CONFLICT: 1 }, timeouts: 1 });
  assert.deepEqual(latencySummary(samples), { average: 11 / 3, p50: 2, p95: 8, p99: 8, max: 8 });
});