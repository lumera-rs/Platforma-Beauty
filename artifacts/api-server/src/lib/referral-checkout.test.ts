import assert from "node:assert/strict";
import test from "node:test";
import { deriveReferralCreditBalance, deriveReferralSourceCapacity } from "./referral-service";

const now = new Date("2026-03-01T12:00:00.000Z");
const fact = (type: "available" | "held" | "redeemed" | "expired" | "reversed" | "negative_offset" | "restored", amountRsd: number, expiresAt: Date | null = null) => ({
  type, amountRsd, expiresAt, effectiveAt: now,
});

const sourceFact = (
  type: "redeemed" | "restored" | "expired" | "reversed",
  amountRsd: number,
) => ({ type, amountRsd, effectiveAt: now });

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

test("source-linked restoration is reusable once and cannot exceed its original grant", () => {
  const source = { ...fact("available", 100), id: "source-1" };
  const redeemed = { ...fact("redeemed", -100), metadata: { sourceLedgerEntryId: source.id } };
  const restored = { ...fact("restored", 100), metadata: { sourceLedgerEntryId: source.id, redemptionId: "redemption-1" } };
  assert.equal(deriveReferralCreditBalance([source, redeemed, restored], now), 100);
  assert.equal(deriveReferralCreditBalance([source, redeemed, restored, {
    ...restored, metadata: { sourceLedgerEntryId: source.id, redemptionId: "duplicate" },
  }], now), 100, "even malformed duplicate restoration cannot exceed the source grant");
  assert.equal(deriveReferralCreditBalance([
    { ...source, expiresAt: new Date("2026-02-28T23:59:59.999Z") },
    redeemed,
    restored,
  ], now), 0, "restoration does not revive an expired source");
});

test("source capacity uses redemption identities without double-counting redeemed ledger facts", () => {
  const source = { amountRsd: 100, expiresAt: null, effectiveAt: now };
  assert.equal(deriveReferralSourceCapacity(
    source,
    [sourceFact("redeemed", -40)],
    [40],
    now,
  ).reusableCapacityRsd, 60);
  assert.equal(deriveReferralSourceCapacity(
    source,
    [sourceFact("redeemed", -40), sourceFact("restored", 40)],
    [40],
    now,
  ).reusableCapacityRsd, 100);
});

test("source reversal and expiry are terminal even after restoration", () => {
  const source = { amountRsd: 100, expiresAt: null, effectiveAt: now };
  assert.equal(deriveReferralSourceCapacity(
    source,
    [sourceFact("reversed", -60)],
    [40],
    now,
  ).reusableCapacityRsd, 0);
  assert.equal(deriveReferralSourceCapacity(
    source,
    [sourceFact("reversed", -100), sourceFact("restored", 40)],
    [40],
    now,
  ).reusableCapacityRsd, 0, "refund cannot revive an invalidated source");
  assert.equal(deriveReferralSourceCapacity(
    source,
    [sourceFact("expired", -60)],
    [40],
    now,
  ).reusableCapacityRsd, 0);
  const ledgerSource = { ...fact("available", 100), id: "terminal-source" };
  assert.equal(deriveReferralCreditBalance([
    ledgerSource,
    { ...fact("redeemed", -40), metadata: { sourceLedgerEntryId: ledgerSource.id } },
    { ...fact("expired", -60), metadata: { sourceLedgerEntryId: ledgerSource.id } },
    { ...fact("restored", 40), metadata: { sourceLedgerEntryId: ledgerSource.id } },
  ], now), 0, "display balance also excludes restoration onto a terminal source");
});