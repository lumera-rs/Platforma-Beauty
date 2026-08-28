import assert from "node:assert/strict";
import test from "node:test";
import { activeCampaignSaleUnitPrice, effectiveLoyaltyTier, loyaltyTierUnitPrice } from "./deo-g2-rules";
import { deoG2ProductPriceFacts, type DeoG2RuleSnapshot } from "./deo-g2-rule-loader";

const now = new Date("2026-01-01T00:00:00.000Z");

test("active campaign chooses the lowest customer sale and expires without rewrites", () => {
  const campaigns = [
    { id: "z-fixed", market: "B2C" as const, status: "ACTIVE" as const, discountType: "FIXED_RSD" as const, discountValue: 100, startsAt: new Date("2025-01-01"), endsAt: null, productIds: ["p"], categoryIds: [] },
    { id: "a-percent", market: "BOTH" as const, status: "ACTIVE" as const, discountType: "PERCENT" as const, discountValue: 20, startsAt: new Date("2025-01-01"), endsAt: new Date("2026-02-01"), productIds: [], categoryIds: ["c"] },
  ];
  assert.equal(activeCampaignSaleUnitPrice({ regularUnitPriceRsd: 1_000, productId: "p", categoryId: "c", market: "B2C", now, campaigns }), 800);
  assert.equal(activeCampaignSaleUnitPrice({ regularUnitPriceRsd: 1_000, productId: "p", categoryId: "c", market: "B2C", now: new Date("2026-03-01"), campaigns }), 900);
});

test("loyalty tier uses strongest attained market tier and excluded product remains regular", () => {
  const tiers = [
    { id: "a", market: "BOTH" as const, active: true, spendThresholdRsd: 1_000 },
    { id: "b", market: "B2C" as const, active: true, spendThresholdRsd: 5_000 },
  ];
  assert.equal(effectiveLoyaltyTier("B2C", 5_000, tiers)?.id, "b");
  assert.equal(effectiveLoyaltyTier("B2C", 999, tiers), null);
  assert.equal(loyaltyTierUnitPrice(1_000, 10, false), 900);
  assert.equal(loyaltyTierUnitPrice(1_000, 10, true), null);
});

test("product-level loyalty exclusion overrides the attained tier price", () => {
  const snapshot: DeoG2RuleSnapshot = {
    now,
    market: "B2B",
    campaigns: [],
    automaticPromotions: [],
    thresholdRewards: [],
    loyaltyTier: { id: "tier", name: "Pro", version: 1, discountPercent: 10, spendThresholdRsd: 1_000 },
    loyaltyExcludedProductIds: new Set(),
    netSettledSpendRsd: 5_000,
  };
  assert.equal(deoG2ProductPriceFacts({
    snapshot,
    productId: "included",
    categoryId: null,
    regularUnitPriceRsd: 1_000,
    productLoyaltyExcluded: false,
  }).loyaltyTierUnitPriceRsd, 900);
  assert.equal(deoG2ProductPriceFacts({
    snapshot,
    productId: "excluded",
    categoryId: null,
    regularUnitPriceRsd: 1_000,
    productLoyaltyExcluded: true,
  }).loyaltyTierUnitPriceRsd, null);
});