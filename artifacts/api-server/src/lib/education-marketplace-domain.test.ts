import assert from "node:assert/strict";
import {
  addEducationBelgradeCalendarDays,
  educationBelgradeDateKey,
  educationPaymentModeError,
  normalizedEducationTaxonomyName,
} from "./education-marketplace-domain";

assert.equal(educationPaymentModeError({
  format: "online", paymentMode: "online_full", depositAmount: null, price: 10_000,
}), null);
assert.match(educationPaymentModeError({
  format: "online", paymentMode: "live_deposit", depositAmount: 1_000, price: 10_000,
}) ?? "", /Online/);
assert.equal(educationPaymentModeError({
  format: "in-person", paymentMode: "live_deposit", depositAmount: 1_000, price: 10_000,
}), null);
assert.match(educationPaymentModeError({
  format: "hybrid", paymentMode: "live_deposit", depositAmount: 11_000, price: 10_000,
}) ?? "", /Depozit/);
assert.equal(educationPaymentModeError({
  format: "in-person", paymentMode: "live_off_platform", depositAmount: null, price: 10_000,
}), null);

assert.equal(normalizedEducationTaxonomyName("  Master   KLASA  "), "master klasa");
assert.equal(
  normalizedEducationTaxonomyName("Ｍａｓｔｅｒ KLASA"),
  normalizedEducationTaxonomyName("Master   klasa"),
);

assert.equal(
  educationBelgradeDateKey(new Date("2026-08-30T22:30:00.000Z")),
  "2026-08-31",
  "rotation switches at Belgrade midnight rather than UTC midnight",
);
assert.equal(
  addEducationBelgradeCalendarDays(new Date("2026-03-28T11:00:00.000Z"), 1).toISOString(),
  "2026-03-29T10:00:00.000Z",
  "a Belgrade calendar day across spring-forward is 23 elapsed hours",
);
assert.equal(
  addEducationBelgradeCalendarDays(new Date("2026-10-24T10:00:00.000Z"), 1).toISOString(),
  "2026-10-25T11:00:00.000Z",
  "a Belgrade calendar day across fall-back is 25 elapsed hours",
);