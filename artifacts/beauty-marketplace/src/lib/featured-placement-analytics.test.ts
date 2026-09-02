import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ownerProfile = readFileSync(new URL("../pages/owner/profile.tsx", import.meta.url), "utf8");
const educationBusiness = readFileSync(new URL("../pages/business-education.tsx", import.meta.url), "utf8");
const educationAdmin = readFileSync(new URL("../pages/admin/education-marketplace.tsx", import.meta.url), "utf8");

const eventPayload = (source: string, eventName: string) => {
  const match = source.match(new RegExp(`trackEvent\\("${eventName}", \\{([\\s\\S]*?)\\n\\s*\\}\\);`));
  assert.ok(match, `${eventName} must be tracked`);
  return match[1];
};

test("tracks successful placement requests with only kind and scope", () => {
  for (const source of [ownerProfile, educationBusiness]) {
    const payload = eventPayload(source, "featured_placement_requested");
    assert.match(payload, /placement_kind:/);
    assert.match(payload, /placement_scope:/);
    assert.doesNotMatch(payload, /payment|reference|ips|salon|center|course|user|target|[_\s]id:/i);
  }
});

test("tracks rendered QR instructions once per placement mount without exposing the QR", () => {
  for (const source of [ownerProfile, educationBusiness]) {
    assert.match(source, /trackedQrPlacementIds\.current\.has\(placement\.id\)/);
    assert.match(source, /trackedQrPlacementIds\.current\.add\(placement\.id\)/);
    const payload = eventPayload(source, "featured_placement_qr_viewed");
    assert.match(payload, /placement_kind:/);
    assert.match(payload, /placement_scope:/);
    assert.doesNotMatch(payload, /payment|reference|ips|salon|center|course|user|target|[_\s]id:/i);
  }
});

test("tracks payment only after the confirmation endpoint succeeds", () => {
  assert.match(
    educationAdmin,
    /settlePlacementMut\.mutate\([\s\S]*?onSuccess: \(confirmedPlacement\) => \{[\s\S]*?trackFeaturedPlacementPaid\(confirmedPlacement\)/,
  );
});

test("idempotent confirmation retries cannot emit a second paid event", () => {
  const apiRoute = readFileSync(new URL("../../../api-server/src/routes/marketplace.ts", import.meta.url), "utf8");
  assert.match(apiRoute, /if \(row\.status === "active"\) return \{ placement: row, activated: false \}/);
  assert.match(apiRoute, /return \{ placement: updated, activated: true \}/);
  assert.match(apiRoute, /activated: settlement\.activated/);
  assert.match(educationAdmin, /trackFeaturedPlacementPaid\(confirmedPlacement\)/);
});