import assert from "node:assert/strict";
import test from "node:test";
import { classifyLoadSamples, evaluateLoadTargets, latencySummary, roundRobinServerIndex } from "./booking-load-metrics";

test("classifies expected HTTP outcomes and summarizes percentile latency", () => {
  const samples = [{ status: 201, milliseconds: 1 }, { status: 409, code: "CONFLICT", milliseconds: 2 }, { milliseconds: 8, timeout: true }];
  assert.deepEqual(classifyLoadSamples(samples), { statuses: { "201": 1, "409": 1 }, codes: { CONFLICT: 1 }, timeouts: 1 });
  assert.deepEqual(latencySummary(samples), { average: 11 / 3, p50: 2, p95: 8, p99: 8, max: 8 });
});

test("evaluates latency and unexpected-error targets at inclusive boundaries", () => {
  const targets = { p95Ms: 1_000, p99Ms: 2_000, maxUnexpectedErrorRate: 0.01 };
  assert.deepEqual(
    evaluateLoadTargets({ count: 100, unexpectedErrors: 1, latency: { p95: 1_000, p99: 2_000 } }, targets),
    {
      targets,
      observed: { p95Ms: 1_000, p99Ms: 2_000, unexpectedErrorRate: 0.01 },
      checks: { p95: true, p99: true, unexpectedErrorRate: true },
      passed: true,
    },
  );
  assert.equal(
    evaluateLoadTargets({ count: 100, unexpectedErrors: 2, latency: { p95: 1_001, p99: 2_001 } }, targets).passed,
    false,
  );
});

test("routes load across every configured process", () => {
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => roundRobinServerIndex(index, 1)), [0, 0, 0, 0]);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => roundRobinServerIndex(index, 2)), [0, 1, 0, 1, 0, 1]);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => roundRobinServerIndex(index, 3)), [0, 1, 2, 0, 1, 2, 0, 1]);
  assert.throws(() => roundRobinServerIndex(0, 0), /positive integer/);
});