import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  automaticXyPromotionTargetsTable,
  automaticXyPromotionsTable,
  bulkSaleCampaignTargetsTable,
  bulkSaleCampaignsTable,
  cartThresholdRewardsTable,
  loyaltyPricingTierProductExclusionsTable,
  loyaltyPricingTiersTable,
  ordersTable,
  retailOrdersTable,
  salonsTable,
} from "@workspace/db";
import type { AutomaticXyPromotion, CartThresholdReward, CommerceMarket } from "./commerce-pricing-engine";
import {
  activeCampaignSaleUnitPrice,
  effectiveLoyaltyTier,
  loyaltyTierUnitPrice,
  type SaleCampaignFact,
} from "./deo-g2-rules";

type DbReader = Pick<typeof import("@workspace/db").db, "select">;
export type DeoMarket = Exclude<CommerceMarket, never>;

export type LoadedSaleCampaign = SaleCampaignFact & Readonly<{ version: number }>;
export type LoadedAutomaticPromotion = AutomaticXyPromotion & Readonly<{ version: number; name: string }>;
export type LoadedThresholdReward = CartThresholdReward & Readonly<{ version: number; name: string }>;
export type LoadedLoyaltyTier = Readonly<{
  id: string; name: string; version: number; discountPercent: number; spendThresholdRsd: number;
}>;

export type DeoG2RuleSnapshot = Readonly<{
  now: Date;
  market: DeoMarket;
  campaigns: readonly LoadedSaleCampaign[];
  automaticPromotions: readonly LoadedAutomaticPromotion[];
  thresholdRewards: readonly LoadedThresholdReward[];
  loyaltyTier: LoadedLoyaltyTier | null;
  loyaltyExcludedProductIds: ReadonlySet<string>;
  netSettledSpendRsd: number;
}>;

/**
 * Load the mutable Deo G2 facts once per cart quote.  This intentionally uses
 * a bounded query per rule family (and never per cart line); callers can pass
 * the transaction object used by final checkout to obtain the locked snapshot.
 */
export async function loadDeoG2RuleSnapshot(
  client: DbReader,
  input: Readonly<{
    market: DeoMarket;
    now: Date;
    productIds: readonly string[];
    userId?: string | null;
    salonId?: string | null;
  }>,
): Promise<DeoG2RuleSnapshot> {
  const productIds = [...new Set(input.productIds)];
  const marketCondition = or(
    eq(bulkSaleCampaignsTable.market, input.market),
    eq(bulkSaleCampaignsTable.market, "BOTH"),
  );
  const promotionMarketCondition = or(
    eq(automaticXyPromotionsTable.market, input.market),
    eq(automaticXyPromotionsTable.market, "BOTH"),
  );
  const rewardMarketCondition = or(
    eq(cartThresholdRewardsTable.market, input.market),
    eq(cartThresholdRewardsTable.market, "BOTH"),
  );
  const tierMarketCondition = or(
    eq(loyaltyPricingTiersTable.market, input.market),
    eq(loyaltyPricingTiersTable.market, "BOTH"),
  );
  const [campaigns, promotions, rewards, tiers, spend] = await Promise.all([
    client.select().from(bulkSaleCampaignsTable).where(and(
      eq(bulkSaleCampaignsTable.status, "ACTIVE"), marketCondition,
      lte(bulkSaleCampaignsTable.startsAt, input.now),
      or(isNull(bulkSaleCampaignsTable.endsAt), gt(bulkSaleCampaignsTable.endsAt, input.now)),
    )),
    client.select().from(automaticXyPromotionsTable).where(and(
      eq(automaticXyPromotionsTable.status, "ACTIVE"), promotionMarketCondition,
      or(isNull(automaticXyPromotionsTable.startsAt), lte(automaticXyPromotionsTable.startsAt, input.now)),
      or(isNull(automaticXyPromotionsTable.endsAt), gt(automaticXyPromotionsTable.endsAt, input.now)),
    )),
    client.select().from(cartThresholdRewardsTable).where(and(
      eq(cartThresholdRewardsTable.active, true), rewardMarketCondition,
    )),
    input.userId || input.salonId
      ? client.select().from(loyaltyPricingTiersTable).where(and(eq(loyaltyPricingTiersTable.active, true), tierMarketCondition))
      : Promise.resolve([]),
    settledCommerceSpend(client, input),
  ]);
  const [campaignTargets, promotionTargets] = await Promise.all([
    campaigns.length
      ? client.select().from(bulkSaleCampaignTargetsTable)
        .where(inArray(bulkSaleCampaignTargetsTable.campaignId, campaigns.map((row) => row.id)))
      : Promise.resolve([]),
    promotions.length
      ? client.select().from(automaticXyPromotionTargetsTable)
        .where(inArray(automaticXyPromotionTargetsTable.promotionId, promotions.map((row) => row.id)))
      : Promise.resolve([]),
  ]);
  const campaignTargetMap = new Map<string, { productIds: string[]; categoryIds: string[] }>();
  for (const target of campaignTargets) {
    const group = campaignTargetMap.get(target.campaignId) ?? { productIds: [], categoryIds: [] };
    if (target.productId) group.productIds.push(target.productId);
    if (target.categoryId) group.categoryIds.push(target.categoryId);
    campaignTargetMap.set(target.campaignId, group);
  }
  const promotionTargetMap = new Map<string, Record<"BUY" | "REWARD", { productIds: string[]; categoryIds: string[] }>>();
  for (const target of promotionTargets) {
    const group = promotionTargetMap.get(target.promotionId) ?? {
      BUY: { productIds: [], categoryIds: [] }, REWARD: { productIds: [], categoryIds: [] },
    };
    const role = target.targetRole as "BUY" | "REWARD";
    if (target.productId) group[role].productIds.push(target.productId);
    if (target.categoryId) group[role].categoryIds.push(target.categoryId);
    promotionTargetMap.set(target.promotionId, group);
  }
  const tier = effectiveLoyaltyTier(input.market, spend, tiers as Array<typeof loyaltyPricingTiersTable.$inferSelect & { market: DeoMarket }>);
  const exclusions = tier && productIds.length
    ? await client.select({ productId: loyaltyPricingTierProductExclusionsTable.productId })
      .from(loyaltyPricingTierProductExclusionsTable)
      .where(and(eq(loyaltyPricingTierProductExclusionsTable.tierId, tier.id), inArray(loyaltyPricingTierProductExclusionsTable.productId, productIds)))
    : [];
  return Object.freeze({
    now: input.now, market: input.market, netSettledSpendRsd: spend,
    campaigns: Object.freeze(campaigns.map((row) => {
      const targets = campaignTargetMap.get(row.id) ?? { productIds: [], categoryIds: [] };
      return Object.freeze({ id: row.id, market: row.market as SaleCampaignFact["market"], status: row.status as SaleCampaignFact["status"],
        discountType: row.discountType as SaleCampaignFact["discountType"], discountValue: row.discountValue,
        startsAt: row.startsAt, endsAt: row.endsAt, version: row.version, ...targets });
    })),
    automaticPromotions: Object.freeze(promotions.map((row) => {
      const targets = promotionTargetMap.get(row.id) ?? { BUY: { productIds: [], categoryIds: [] }, REWARD: { productIds: [], categoryIds: [] } };
      return Object.freeze({ id: row.id, name: row.name, version: row.version, market: row.market as AutomaticXyPromotion["market"],
        active: true, startsAt: row.startsAt, endsAt: row.endsAt, buyQuantity: row.buyQuantity, rewardQuantity: row.rewardQuantity,
        rewardPercent: row.rewardPercent, perOrderRewardUnitCap: row.perOrderRewardUnitCap,
        buyProductIds: targets.BUY.productIds, buyCategoryIds: targets.BUY.categoryIds,
        rewardProductIds: targets.REWARD.productIds, rewardCategoryIds: targets.REWARD.categoryIds });
    })),
    thresholdRewards: Object.freeze(rewards.map((row) => Object.freeze({
      id: row.id, name: row.name, version: row.version, market: row.market as CartThresholdReward["market"], active: row.active,
      thresholdRsd: row.spendThresholdRsd, kind: row.rewardKind as CartThresholdReward["kind"],
      percent: row.discountPercent ?? undefined, giftProductId: row.giftProductId ?? undefined, giftQuantity: row.giftQuantity ?? undefined,
    }))),
    loyaltyTier: tier ? Object.freeze({ id: tier.id, name: tier.name, version: tier.version, discountPercent: tier.discountPercent, spendThresholdRsd: tier.spendThresholdRsd }) : null,
    loyaltyExcludedProductIds: new Set(exclusions.map((row) => row.productId)),
  });
}

export async function settledCommerceSpend(
  client: DbReader,
  input: Readonly<{
    market: DeoMarket;
    userId?: string | null;
    salonId?: string | null;
    ownerUserId?: string | null;
  }>,
) {
  if (input.market === "B2C") {
    if (!input.userId) return 0;
    const [row] = await client.select({ total: sql<number>`coalesce(sum(${retailOrdersTable.total}), 0)` })
      .from(retailOrdersTable).where(and(
        eq(retailOrdersTable.userId, input.userId),
        eq(retailOrdersTable.status, "delivered"),
        or(
          eq(retailOrdersTable.paymentStatus, "paid"),
          and(
            eq(retailOrdersTable.paymentStatus, "unpaid"),
            eq(retailOrdersTable.paymentMethod, "CASH_ON_DELIVERY"),
          ),
        ),
      ));
    return Number(row?.total ?? 0);
  }
  if (!input.ownerUserId && !input.salonId) return 0;
  const ownerCondition = input.ownerUserId
    ? eq(salonsTable.ownerId, input.ownerUserId)
    : sql`${salonsTable.ownerId} = (select owner_id from salons where id = ${input.salonId!})`;
  const [row] = await client.select({ total: sql<number>`coalesce(sum(${ordersTable.total}), 0)` })
    .from(ordersTable).innerJoin(salonsTable, eq(ordersTable.salonId, salonsTable.id))
    .where(and(
      ownerCondition,
      eq(ordersTable.status, "delivered"),
      or(
        eq(ordersTable.paymentStatus, "paid"),
        and(
          eq(ordersTable.paymentStatus, "unpaid"),
          eq(ordersTable.paymentMethod, "CASH_ON_DELIVERY"),
        ),
      ),
    ));
  return Number(row?.total ?? 0);
}

/** Caller-facing product inputs stay small and make campaign/tier precedence explicit. */
export function deoG2ProductPriceFacts(input: Readonly<{
  snapshot: DeoG2RuleSnapshot; productId: string; categoryId: string | null; regularUnitPriceRsd: number;
  /** Existing product-level/manual sale, if its own schedule is active. */
  manualSaleUnitPriceRsd?: number | null;
  /** Global product switch; tier-scoped exclusions remain part of the snapshot. */
  productLoyaltyExcluded?: boolean;
}>) {
  const campaignSaleUnitPriceRsd = activeCampaignSaleUnitPrice({
    regularUnitPriceRsd: input.regularUnitPriceRsd, productId: input.productId, categoryId: input.categoryId,
    market: input.snapshot.market, now: input.snapshot.now, campaigns: input.snapshot.campaigns,
  });
  return Object.freeze({
    // A campaign competes with, rather than stacks on, the legacy manual sale.
    // resolveProductUnitPrice then keeps the global precedence invariant.
    activeSaleUnitPriceRsd: [input.manualSaleUnitPriceRsd, campaignSaleUnitPriceRsd]
      .filter((price): price is number => price != null)
      .sort((left, right) => left - right)[0] ?? null,
    campaignSaleUnitPriceRsd,
    loyaltyTierUnitPriceRsd: input.snapshot.loyaltyTier
      ? loyaltyTierUnitPrice(
        input.regularUnitPriceRsd,
        input.snapshot.loyaltyTier.discountPercent,
        Boolean(input.productLoyaltyExcluded) || input.snapshot.loyaltyExcludedProductIds.has(input.productId),
      )
      : null,
  });
}