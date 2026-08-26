import assert from "node:assert/strict";
import test from "node:test";
import { deriveReferralCreditBalance } from "./referral-service";

const now = new Date("2026-03-01T12:00:00.000Z");
const fact = (type: "available" | "held" | "redeemed" | "reversed" | "negative_offset" | "restored", amountRsd: number, expiresAt: Date | null = null) => ({
  type, amountRsd, expiresAt, effectiveAt: now,
});

test("append-only referral balance excludes held and expired grants while retaining signed compensations", () => {
  assert.equal(deriveReferralCreditBalance([
    fact("available", 500),
    fact("held", 100),
    fact("redeemed", -200),
    fact("reversed", -500),
    fact("restored", 200),
    fact("available", 100, new Date("2026-02-28T00:00:00.000Z")),
  ], now), 0);
});

test("derived wallet preserves negative clawback debt for future credits", () => {
  assert.equal(deriveReferralCreditBalance([fact("available", 100), fact("negative_offset", -250)], now), -150);
});