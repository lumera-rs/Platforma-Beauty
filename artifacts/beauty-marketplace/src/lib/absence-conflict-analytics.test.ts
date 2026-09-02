import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../components/education/center-operations.tsx", import.meta.url),
  "utf8",
);

test("absence conflict analytics records comparable views and successful resolutions", () => {
  assert.match(source, /trackEvent\("absence_conflicts_viewed",\s*\{\s*conflict_count:\s*preview\.conflicts\.length,\s*location:\s*"absence_dialog"/s);
  assert.match(source, /trackEvent\("absence_conflict_resolved",\s*\{\s*action:\s*"educator_substituted",\s*location:\s*"absence_dialog"/s);
  assert.match(source, /trackEvent\("absence_conflict_resolved",\s*\{\s*action:\s*"session_cancelled",\s*location:\s*"absence_dialog"/s);
});

test("absence conflict analytics excludes identifiers and free-form reasons", () => {
  const analyticsCalls = [...source.matchAll(/trackEvent\("absence_conflict[^;]+;/gs)].map(
    ([call]) => call,
  );

  assert.equal(analyticsCalls.length, 3);
  for (const call of analyticsCalls) {
    assert.doesNotMatch(call, /centerId|sessionId|staffId|educatorStaffId|reason|courseTitle/);
  }
});

test("automatic conflict refreshes do not inflate conflict-view counts", () => {
  assert.equal(
    source.match(/previewAbsence\(activeStaffId,\s*false\)/g)?.length,
    2,
  );
});