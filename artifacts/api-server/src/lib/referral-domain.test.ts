import assert from "node:assert/strict";
import test from "node:test";
import {
  canEarnUnderCap, creditExpiry, duplicatePreflight, firstTouchLockUntil,
  milestoneBenefitKind, milestoneCrossed, REFERRAL_POLICY, referralCreditAvailable,
  qualificationWindow, referralIdempotencyKey, requiresBusinessScopedCode, normalizePib,
} from "./referral-domain";
import { referralLink, stableReferralCode } from "./referral-service";

test("referral domain creates stable keys and immutable first-touch window", () => {
  assert.equal(referralIdempotencyKey("qualification", "a", "b"), referralIdempotencyKey("qualification", "a", "b"));
  assert.notEqual(referralIdempotencyKey("qualification", "a", "b"), referralIdempotencyKey("credit", "a", "b"));
  assert.equal(firstTouchLockUntil(new Date("2026-01-01T00:00:00Z")).toISOString(), "2026-01-31T00:00:00.000Z");
});

test("server-issued referral codes and channel links are source scoped", () => {
  assert.equal(stableReferralCode("A", "salon-1"), stableReferralCode("A", "salon-1"));
  assert.notEqual(stableReferralCode("A", "salon-1"), stableReferralCode("A", "salon-2"));
  assert.notEqual(stableReferralCode("A", "business-1"), stableReferralCode("C", "business-1"));
  assert.notEqual(stableReferralCode("A", "salon:same-id"), stableReferralCode("A", "education_center:same-id"));
  assert.equal(new URL(referralLink("https://tenant.example", "A-ABC", "A")).pathname, "/poslovna-registracija");
  assert.equal(new URL(referralLink("https://tenant.example", "C-ABC", "C")).pathname, "/student/prijava");
  assert.equal(new URL(referralLink("https://tenant.example", "D-ABC", "D")).searchParams.get("ref"), "D-ABC");
});

test("PIB normalization and legal-entity duplicate preflight are deterministic", () => {
  assert.equal(normalizePib(" 109-876-543 "), "109876543");
  assert.deepEqual(duplicatePreflight({
    referrerUserId: "owner-a", referredUserId: "owner-b",
    referrerLegalEntityId: "entity-1", referredLegalEntityId: "entity-1",
  }), { decision: "review", reasons: ["legal_entity_overlap"] });
});

test("caps, isolated milestones, offsets, and duplicate preflight follow policy", () => {
  assert.equal(REFERRAL_POLICY.A.rewardAmountRsd, 500, "referral reward amounts are integer RSD like commerce price/total");
  assert.equal(REFERRAL_POLICY.B2.rewardAmountRsd, 100, "no minor-unit conversion is applied to referral credit");
  assert.equal(canEarnUnderCap("B2", 19), true);
  assert.equal(canEarnUnderCap("B2", 20), false);
  assert.equal(milestoneCrossed("A", 9, 10), 10);
  assert.equal(milestoneCrossed("C", 0, 9), null);
  assert.equal(milestoneCrossed("B1", 9, 10), null);
  assert.equal(requiresBusinessScopedCode("A"), true);
  assert.equal(requiresBusinessScopedCode("B1"), false);
  assert.equal(milestoneBenefitKind("A", "salon"), "salon_subscription_reduction");
  assert.equal(milestoneBenefitKind("A", "education_center"), "education_commission_reduction");
  assert.equal(referralCreditAvailable(500, 150, 400), 350);
  assert.deepEqual(duplicatePreflight({ referrerUserId: "same", referredUserId: "same" }), { decision: "reject", reasons: ["self_referral"] });
  assert.equal(creditExpiry(new Date("2026-08-31T00:00:00Z")).toISOString(), "2027-02-28T00:00:00.000Z");
});

test("qualification windows are fixed, calendar-safe half-open intervals", () => {
  const capturedAt = new Date("2026-01-31T12:34:56.789Z");
  assert.deepEqual(qualificationWindow("B2", capturedAt), {
    start: capturedAt,
    deadline: new Date("2026-04-01T12:34:56.789Z"),
  });
  assert.deepEqual(qualificationWindow("C", capturedAt), {
    start: capturedAt,
    deadline: new Date("2026-04-30T12:34:56.789Z"),
  });
  const approval = new Date("2028-08-31T01:02:03.004Z");
  assert.deepEqual(qualificationWindow("A", capturedAt, approval), {
    start: approval,
    deadline: new Date("2028-11-30T01:02:03.004Z"),
  });
  assert.throws(() => qualificationWindow("B1", capturedAt), /not been unlocked/);
});