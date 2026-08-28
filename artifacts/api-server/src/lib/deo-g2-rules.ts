/**
 * DB-independent Deo G2 rule resolution. The checkout lock boundary loads
 * rows, then passes immutable catalog facts here; no mutable campaign state is
 * copied into products.
 */
export type SaleCampaignFact = Readonly<{
  id: string; market: "B2B" | "B2C" | "BOTH"; status: "DRAFT" | "ACTIVE";
  discountType: "PERCENT" | "FIXED_RSD"; discountValue: number;
  startsAt: Date; endsAt: Date | null;
  productIds: readonly string[]; categoryIds: readonly string[];
}>;

export function activeCampaignSaleUnitPrice(input: Readonly<{
  regularUnitPriceRsd: number;
  productId: string;
  categoryId: string | null;
  market: "B2B" | "B2C";
  now: Date;
  campaigns: readonly SaleCampaignFact[];
}>): number | null {
  if (!Number.isSafeInteger(input.regularUnitPriceRsd) || input.regularUnitPriceRsd < 0) {
    throw new Error("Regular unit price must be a non-negative integer.");
  }
  const candidates = input.campaigns
    .filter((campaign) => campaign.status === "ACTIVE"
      && (campaign.market === "BOTH" || campaign.market === input.market)
      && campaign.startsAt <= input.now && (!campaign.endsAt || input.now < campaign.endsAt)
      && (campaign.productIds.includes(input.productId)
        || (input.categoryId !== null && campaign.categoryIds.includes(input.categoryId))))
    .map((campaign) => {
      if (!Number.isSafeInteger(campaign.discountValue) || campaign.discountValue <= 0) {
        throw new Error("Campaign discount value must be a positive integer.");
      }
      const price = campaign.discountType === "PERCENT"
        ? input.regularUnitPriceRsd - Math.floor(input.regularUnitPriceRsd * campaign.discountValue / 100)
        : input.regularUnitPriceRsd - campaign.discountValue;
      return { id: campaign.id, price: Math.max(0, price) };
    })
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  return candidates[0]?.price ?? null;
}

/** Net completed/settled spend only; cancelled and refunded rows never qualify. */
export function effectiveLoyaltyTier<T extends Readonly<{
  id: string; market: "B2B" | "B2C" | "BOTH"; active: boolean; spendThresholdRsd: number;
}>>(market: "B2B" | "B2C", netSettledSpendRsd: number, tiers: readonly T[]): T | null {
  if (!Number.isSafeInteger(netSettledSpendRsd) || netSettledSpendRsd < 0) {
    throw new Error("Net settled spend must be a non-negative integer.");
  }
  return [...tiers]
    .filter((tier) => tier.active && (tier.market === "BOTH" || tier.market === market)
      && Number.isSafeInteger(tier.spendThresholdRsd) && tier.spendThresholdRsd <= netSettledSpendRsd)
    .sort((a, b) => b.spendThresholdRsd - a.spendThresholdRsd || a.id.localeCompare(b.id))[0] ?? null;
}

export function loyaltyTierUnitPrice(regularUnitPriceRsd: number, discountPercent: number, excluded: boolean) {
  if (excluded) return null;
  if (!Number.isSafeInteger(regularUnitPriceRsd) || regularUnitPriceRsd < 0
    || !Number.isSafeInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    throw new Error("Invalid loyalty tier price input.");
  }
  return regularUnitPriceRsd - Math.floor(regularUnitPriceRsd * discountPercent / 100);
}