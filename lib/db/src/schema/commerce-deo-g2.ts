import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { productsTable, productCategoriesTable } from "./commerce";

/** Ordered alternatives shown to a shopper. They are merchandising only. */
export const productUpsellLinksTable = pgTable("product_upsell_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  alternativeProductId: uuid("alternative_product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("product_upsell_links_product_alternative_unique").on(t.productId, t.alternativeProductId),
  uniqueIndex("product_upsell_links_product_sort_unique").on(t.productId, t.sortOrder),
  index("product_upsell_links_alternative_idx").on(t.alternativeProductId),
  check("product_upsell_links_not_self_check", sql`${t.productId} <> ${t.alternativeProductId}`),
  check("product_upsell_links_sort_check", sql`${t.sortOrder} BETWEEN 1 AND 3`),
]);

export const loyaltyPricingTiersTable = pgTable("loyalty_pricing_tiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  spendThresholdRsd: integer("spend_threshold_rsd").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("loyalty_pricing_tiers_market_name_unique").on(t.market, t.name),
  index("loyalty_pricing_tiers_market_active_threshold_idx").on(t.market, t.active, t.spendThresholdRsd),
  check("loyalty_pricing_tiers_market_check", sql`${t.market} IN ('B2B', 'B2C', 'BOTH')`),
  check("loyalty_pricing_tiers_threshold_check", sql`${t.spendThresholdRsd} >= 0`),
  check("loyalty_pricing_tiers_percent_check", sql`${t.discountPercent} BETWEEN 1 AND 100`),
  check("loyalty_pricing_tiers_version_check", sql`${t.version} >= 1`),
]);

export const loyaltyPricingTierProductExclusionsTable = pgTable("loyalty_pricing_tier_product_exclusions", {
  tierId: uuid("tier_id").notNull().references(() => loyaltyPricingTiersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
}, (t) => [
  uniqueIndex("loyalty_pricing_tier_product_exclusions_unique").on(t.tierId, t.productId),
  index("loyalty_pricing_tier_product_exclusions_product_idx").on(t.productId),
]);

export const bulkSaleCampaignsTable = pgTable("bulk_sale_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  discountType: text("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: text("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bulk_sale_campaigns_market_status_schedule_idx").on(t.market, t.status, t.startsAt, t.endsAt),
  check("bulk_sale_campaigns_market_check", sql`${t.market} IN ('B2B', 'B2C', 'BOTH')`),
  check("bulk_sale_campaigns_type_check", sql`${t.discountType} IN ('PERCENT', 'FIXED_RSD')`),
  check("bulk_sale_campaigns_value_check", sql`${t.discountValue} > 0`),
  check("bulk_sale_campaigns_status_check", sql`${t.status} IN ('DRAFT', 'ACTIVE')`),
  check("bulk_sale_campaigns_schedule_check", sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
  check("bulk_sale_campaigns_version_check", sql`${t.version} >= 1`),
]);

export const bulkSaleCampaignTargetsTable = pgTable("bulk_sale_campaign_targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => bulkSaleCampaignsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => productsTable.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => productCategoriesTable.id, { onDelete: "cascade" }),
}, (t) => [
  uniqueIndex("bulk_sale_campaign_targets_product_unique").on(t.campaignId, t.productId).where(sql`${t.productId} IS NOT NULL`),
  uniqueIndex("bulk_sale_campaign_targets_category_unique").on(t.campaignId, t.categoryId).where(sql`${t.categoryId} IS NOT NULL`),
  index("bulk_sale_campaign_targets_product_idx").on(t.productId),
  index("bulk_sale_campaign_targets_category_idx").on(t.categoryId),
  check("bulk_sale_campaign_targets_one_target_check", sql`num_nonnulls(${t.productId}, ${t.categoryId}) = 1`),
]);

export const cartThresholdRewardsTable = pgTable("cart_threshold_rewards", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  spendThresholdRsd: integer("spend_threshold_rsd").notNull(),
  rewardKind: text("reward_kind").notNull(),
  discountPercent: integer("discount_percent"),
  giftProductId: uuid("gift_product_id").references(() => productsTable.id, { onDelete: "restrict" }),
  giftQuantity: integer("gift_quantity"),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cart_threshold_rewards_market_active_threshold_idx").on(t.market, t.active, t.spendThresholdRsd),
  index("cart_threshold_rewards_gift_product_idx").on(t.giftProductId),
  check("cart_threshold_rewards_market_check", sql`${t.market} IN ('B2B', 'B2C', 'BOTH')`),
  check("cart_threshold_rewards_threshold_check", sql`${t.spendThresholdRsd} >= 0`),
  check("cart_threshold_rewards_kind_check", sql`${t.rewardKind} IN ('FREE_SHIPPING', 'GIFT_PRODUCT', 'PERCENT_DISCOUNT')`),
  check("cart_threshold_rewards_shape_check", sql`(${t.rewardKind} = 'FREE_SHIPPING' AND ${t.discountPercent} IS NULL AND ${t.giftProductId} IS NULL AND ${t.giftQuantity} IS NULL) OR (${t.rewardKind} = 'PERCENT_DISCOUNT' AND ${t.discountPercent} BETWEEN 1 AND 100 AND ${t.giftProductId} IS NULL AND ${t.giftQuantity} IS NULL) OR (${t.rewardKind} = 'GIFT_PRODUCT' AND ${t.giftProductId} IS NOT NULL AND ${t.giftQuantity} > 0 AND ${t.discountPercent} IS NULL)`),
  check("cart_threshold_rewards_version_check", sql`${t.version} >= 1`),
]);

export const automaticXyPromotionsTable = pgTable("automatic_xy_promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  buyQuantity: integer("buy_quantity").notNull(),
  rewardQuantity: integer("reward_quantity").notNull(),
  rewardPercent: integer("reward_percent").notNull(),
  perOrderRewardUnitCap: integer("per_order_reward_unit_cap"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: text("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("automatic_xy_promotions_market_status_schedule_idx").on(t.market, t.status, t.startsAt, t.endsAt),
  check("automatic_xy_promotions_market_check", sql`${t.market} IN ('B2B', 'B2C', 'BOTH')`),
  check("automatic_xy_promotions_quantities_check", sql`${t.buyQuantity} > 0 AND ${t.rewardQuantity} > 0 AND ${t.rewardPercent} BETWEEN 1 AND 100 AND (${t.perOrderRewardUnitCap} IS NULL OR ${t.perOrderRewardUnitCap} > 0)`),
  check("automatic_xy_promotions_status_check", sql`${t.status} IN ('DRAFT', 'ACTIVE')`),
  check("automatic_xy_promotions_schedule_check", sql`${t.endsAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
  check("automatic_xy_promotions_version_check", sql`${t.version} >= 1`),
]);

export const automaticXyPromotionTargetsTable = pgTable("automatic_xy_promotion_targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  promotionId: uuid("promotion_id").notNull().references(() => automaticXyPromotionsTable.id, { onDelete: "cascade" }),
  targetRole: text("target_role").notNull(),
  productId: uuid("product_id").references(() => productsTable.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => productCategoriesTable.id, { onDelete: "cascade" }),
}, (t) => [
  uniqueIndex("automatic_xy_targets_role_product_unique").on(t.promotionId, t.targetRole, t.productId).where(sql`${t.productId} IS NOT NULL`),
  uniqueIndex("automatic_xy_targets_role_category_unique").on(t.promotionId, t.targetRole, t.categoryId).where(sql`${t.categoryId} IS NOT NULL`),
  index("automatic_xy_targets_product_idx").on(t.productId),
  index("automatic_xy_targets_category_idx").on(t.categoryId),
  check("automatic_xy_targets_role_check", sql`${t.targetRole} IN ('BUY', 'REWARD')`),
  check("automatic_xy_targets_one_target_check", sql`num_nonnulls(${t.productId}, ${t.categoryId}) = 1`),
]);