import assert from "node:assert/strict";
import test from "node:test";
import { classifySamplingFailure, hasRealActivityStateEvidence, summarizeActivity } from "./booking-load-telemetry";

test("requires a real PostgreSQL activity state rather than disabled or restricted rows", () => {
  const unavailable = summarizeActivity([
    { states: [{ state: "disabled", count: 10 }, { state: "null", count: 1 }], locks: [{ mode: "AccessShareLock", count: 1 }], apiPools: [] },
  ], [], 0);
  assert.equal(unavailable.pg.activityStateEvidence.available, false);
  assert.match(unavailable.pg.activityStateTelemetry, /^unavailable:/);
  assert.equal(hasRealActivityStateEvidence({ dbActivity: unavailable }), false);

  const available = summarizeActivity([
    { states: [{ state: "active", count: 2 }], locks: [{ mode: "AccessShareLock", count: 3 }], apiPools: [] },
  ], [], 0);
  assert.equal(available.pg.activityStateEvidence.available, true);
  assert.equal(available.pg.lockEvidence.available, true);
  assert.equal(hasRealActivityStateEvidence({ dbActivity: available }), true);
});

test("classifies PostgreSQL permission errors separately from general unavailability", () => {
  assert.deepEqual(classifySamplingFailure({ code: "42501", message: "permission denied for view pg_stat_activity" }), {
    kind: "permission-denied",
    code: "42501",
    message: "permission denied for view pg_stat_activity",
  });
  assert.equal(classifySamplingFailure(new Error("connection closed")).kind, "unavailable");
});

test("accepts legacy reports only when they contain a genuine activity state", () => {
  assert.equal(hasRealActivityStateEvidence({ dbActivity: { pg: { activityStateTelemetry: "available", statePeaks: { null: 1, disabled: 20 } } } }), false);
  assert.equal(hasRealActivityStateEvidence({ dbActivity: { pg: { activityStateTelemetry: "available", statePeaks: { active: 1 } } } }), true);
});