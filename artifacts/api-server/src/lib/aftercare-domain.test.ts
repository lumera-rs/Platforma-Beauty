import assert from "node:assert/strict";
import test from "node:test";
import {
  hashAftercareEntitlement,
  normalizeTreatmentTaxonomyKey,
} from "./aftercare-domain";
import { AFTERCARE_REPLENISHMENT_APPROACH_DAYS } from "./aftercare-worker";

test("aftercare taxonomy normalization is stable, Serbian-safe and deduplicable", () => {
  assert.equal(normalizeTreatmentTaxonomyKey("Nega lica", "Dubinsko čišćenje"), "nega-lica-dubinsko-ciscenje");
  assert.equal(normalizeTreatmentTaxonomyKey("  NEGA   LICA ", "Dubinsko—čišćenje!"), "nega-lica-dubinsko-ciscenje");
  assert.equal(normalizeTreatmentTaxonomyKey("Masaža", "Đumbir & ulje"), "masaza-djumbir-ulje");
  assert.throws(() => normalizeTreatmentTaxonomyKey(" --- ", " "), /requires a category or name/i);
});

test("aftercare entitlement persistence uses deterministic one-way SHA-256 identity", () => {
  const first = hashAftercareEntitlement("opaque-customer-token");
  assert.equal(first, hashAftercareEntitlement("opaque-customer-token"));
  assert.notEqual(first, hashAftercareEntitlement("other-token"));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes("opaque-customer-token"), false);
});

test("replenishment approach threshold is deterministic", () => {
  assert.equal(AFTERCARE_REPLENISHMENT_APPROACH_DAYS, 3);
});