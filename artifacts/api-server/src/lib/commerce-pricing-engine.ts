import {
  commerceDiscountsForPricedLine,
  quoteCommerceReferralBase,
  type CommerceDiscount,
} from "./commerce-discount-engine";
import { quoteCoupon, type CouponLine, type CouponPolicy, type CouponQuote } from "./coupon-engine";

/**
 * The checkout pricing policy is deliberately data, rather than route-local
 * conditionals.  Keep this tuple ordered: it is also the order used in the
 * internal explanation returned by `quoteCommerce`.
 */
export const COMMERCE_PRICING_POLICY = Object.freeze([
  "EXPLICIT_VARIANT_PRICE",
  "ACTIVE_SALE",
  "QUANTITY_TIER",
  "LOYALTY_TIER_PRICE",
  "REGULAR_PRICE",
  "VARIANT_PRICE_ADJUST",
  "FIXED_BUNDLE_PRICE",
  "AUTOMATIC_XY_PROMOTION",
  "COUPON",
  "CART_THRESHOLD_REWARD",
  "REFERRAL_CREDIT",
  "SHIPPING",
  "POST_CHECKOUT_LOYALTY",
] as const);

export type KnownAdjustmentKind =
  | "EXPLICIT_VARIANT_PRICE" | "SALE" | "TIER" | "VARIANT_PRICE_ADJUST"
  | "BUNDLE" | "COUPON" | "REFERRAL_CREDIT" | "LOYALTY"
  | "AUTOMATIC_XY_PROMOTION" | "CART_THRESHOLD_REWARD";
export type PriceSource = "FULL_PRICE" | "SALE" | "TIER" | "LOYALTY_TIER_PRICE" | "EXPLICIT_VARIANT_PRICE" | "BUNDLE";
export type CommerceMarket = "B2B" | "B2C";

export type ResolvedProductPriceInput = Readonly<{
  regularUnitPriceRsd: number;
  activeSaleUnitPriceRsd: number | null;
  tierUnitPriceRsd: number | null;
  /** Market/customer resolved loyalty fallback. Product exclusions are resolved by the caller to null. */
  loyaltyTierUnitPriceRsd?: number | null;
  explicitVariantUnitPriceRsd: number | null;
  variantPriceAdjustRsd: number;
}>;

export type CanonicalPrice = Readonly<{
  unitPriceRsd: number;
  baseUnitPriceRsd: number;
  priceSource: PriceSource;
  adjustments: readonly Readonly<{ kind: KnownAdjustmentKind; amountRsd: number }>[];
}>;

export type CanonicalLineInput = Readonly<{
  id: string;
  quantity: number;
  productId: string | null;
  bundleId: string | null;
  categoryIds: readonly string[];
  /** A bundle is supplied at its channel-specific fixed price. */
  fixedBundleUnitPriceRsd?: number;
  product?: ResolvedProductPriceInput;
}>;

export type CanonicalQuotedLine = Readonly<{
  id: string;
  quantity: number;
  productId: string | null;
  bundleId: string | null;
  unitPriceRsd: number;
  lineSubtotalRsd: number;
  couponAllocationRsd: number;
  automaticPromotionAllocationRsd: number;
  thresholdRewardAllocationRsd: number;
  lineTotalRsd: number;
  priceSource: PriceSource;
  adjustments: readonly Readonly<{ kind: KnownAdjustmentKind; amountRsd: number }>[];
  referralEligible: boolean;
}>;

export type CanonicalQuote = Readonly<{
  lines: readonly CanonicalQuotedLine[];
  subtotalRsd: number;
  couponDiscountRsd: number;
  automaticPromotionDiscountRsd: number;
  thresholdRewardDiscountRsd: number;
  thresholdQualificationSubtotalRsd: number;
  rewardGifts: readonly Readonly<{ rewardId: string; productId: string; quantity: number }>[];
  automaticPromotionSnapshots: readonly Readonly<{
    promotionId: string;
    allocations: Readonly<Record<string, number>>;
    rewardUnits: number;
  }>[];
  referralBaseRsd: number;
  referralAppliedRsd: number;
  shippingRsd: number;
  payableTotalRsd: number;
  coupon: CouponQuote | null;
  loyalty: Readonly<{ postCheckout: true; awardBaseRsd: number }>;
}>;

export type AutomaticXyPromotion = Readonly<{
  id: string;
  market: CommerceMarket | "BOTH";
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  buyQuantity: number;
  rewardQuantity: number;
  rewardPercent: number;
  perOrderRewardUnitCap?: number | null;
  buyProductIds?: readonly string[];
  buyCategoryIds?: readonly string[];
  rewardProductIds?: readonly string[];
  rewardCategoryIds?: readonly string[];
}>;

export type CartThresholdReward = Readonly<{
  id: string;
  market: CommerceMarket | "BOTH";
  active: boolean;
  thresholdRsd: number;
  kind: "FREE_SHIPPING" | "GIFT_PRODUCT" | "PERCENT_DISCOUNT";
  percent?: number;
  giftProductId?: string;
  giftQuantity?: number;
}>;

export type PreparedCommerceLine = Readonly<{
  id: string;
  quantity: number;
  productId: string | null;
  bundleId: string | null;
  categoryIds: readonly string[];
  unitPriceRsd: number;
  lineSubtotalRsd: number;
  automaticPromotionAllocationRsd: number;
  priceSource: PriceSource;
  baseUnitPriceRsd: number;
  adjustments: readonly Readonly<{ kind: KnownAdjustmentKind; amountRsd: number }>[];
}>;

/** The immutable boundary between product/X+Y evaluation and a locked coupon. */
export type PreparedCommerceQuote = Readonly<{
  market: CommerceMarket;
  lines: readonly PreparedCommerceLine[];
  /** Coupon-engine inputs after automatic X+Y discounts. */
  couponLines: readonly Readonly<{
    id: string;
    productId: string | null;
    bundleId: string | null;
    categoryIds: readonly string[];
    amountRsd: number;
  }>[];
  subtotalRsd: number;
  automaticPromotionDiscountRsd: number;
  automaticPromotionSnapshots: readonly Readonly<{
    promotionId: string;
    allocations: Readonly<Record<string, number>>;
    rewardUnits: number;
  }>[];
  thresholdQualificationSubtotalRsd: number;
}>;

/** Locked/DB-backed paths use this after coupon validation.  It intentionally
 * accepts the coupon-engine result, so the policy arithmetic remains in that
 * engine while every route shares total/referral arithmetic. */
export function quoteResolvedCommerce(input: Readonly<{
  lines: readonly Readonly<{
    id: string; productId: string | null; bundleId: string | null; quantity: number;
    unitPriceRsd: number; lineSubtotalRsd: number; priceSource: PriceSource;
    lineDiscountRsd: number;
    automaticPromotionAllocationRsd?: number;
    thresholdRewardAllocationRsd?: number;
  }>[];
  coupon: CouponQuote | null;
  requestedReferralCreditRsd: number;
  availableReferralCreditRsd: number;
  shippingRsd: number;
  loyaltyFreeShipping?: boolean;
  thresholdFreeShipping?: boolean;
}>): Pick<CanonicalQuote, "subtotalRsd" | "couponDiscountRsd" | "referralBaseRsd" | "referralAppliedRsd" | "shippingRsd" | "payableTotalRsd"> {
  const coupon = input.coupon;
  const allocations = coupon?.valid ? coupon.allocations : {};
  const lineIds = new Set<string>();
  const referral = quoteCommerceReferralBase(input.lines.map((line) => {
    if (lineIds.has(line.id)) throw new Error("Commerce line ids must be unique.");
    lineIds.add(line.id);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Line quantity must be a positive integer.");
    nonNegative(line.unitPriceRsd, "Unit price");
    nonNegative(line.lineSubtotalRsd, "Line subtotal");
    if (line.lineSubtotalRsd !== line.unitPriceRsd * line.quantity) {
      throw new Error("Line subtotal must equal unit price times quantity.");
    }
    nonNegative(allocations[line.id] ?? 0, "Coupon allocation");
    if ((allocations[line.id] ?? 0) > line.lineSubtotalRsd) throw new Error("Coupon allocation exceeds line subtotal.");
    const automaticAllocation = nonNegative(line.automaticPromotionAllocationRsd ?? 0, "Automatic promotion allocation");
    const thresholdAllocation = nonNegative(line.thresholdRewardAllocationRsd ?? 0, "Threshold reward allocation");
    if ((allocations[line.id] ?? 0) + automaticAllocation + thresholdAllocation > line.lineSubtotalRsd) {
      throw new Error("Combined commerce allocations exceed line subtotal.");
    }
    const finalAmount = line.lineSubtotalRsd - (allocations[line.id] ?? 0) - automaticAllocation - thresholdAllocation;
    nonNegative(finalAmount, "Final line amount");
    return {
      id: line.id, amountRsd: finalAmount,
      discounts: commerceDiscountsForPricedLine({
        priceSource: line.priceSource === "EXPLICIT_VARIANT_PRICE" ? "FULL_PRICE" : line.priceSource,
        lineDiscountRsd: line.lineDiscountRsd, couponAllocationRsd: allocations[line.id] ?? 0,
        additionalDiscounts: [
          { kind: "AUTOMATIC_XY_PROMOTION", amountRsd: automaticAllocation },
          { kind: "CART_THRESHOLD_REWARD", amountRsd: thresholdAllocation },
        ],
      }),
    };
  }));
  for (const allocationId of Object.keys(allocations)) {
    if (!lineIds.has(allocationId)) throw new Error("Coupon allocation references an unknown commerce line.");
  }
  const subtotalRsd = input.lines.reduce((sum, line) => sum + line.lineSubtotalRsd, 0);
  const couponDiscountRsd = coupon?.valid ? coupon.discountRsd : 0;
  if (couponDiscountRsd !== Object.values(allocations).reduce((sum, value) => sum + value, 0)) throw new Error("Coupon allocation conservation failed.");
  const cartPromotionDiscountRsd = input.lines.reduce((sum, line) => (
    sum + (line.automaticPromotionAllocationRsd ?? 0) + (line.thresholdRewardAllocationRsd ?? 0)
  ), 0);
  const shippingRsd = input.loyaltyFreeShipping || input.thresholdFreeShipping || (coupon?.valid && coupon.freeShipping)
    ? 0 : nonNegative(input.shippingRsd, "Shipping");
  const referralAppliedRsd = Math.min(
    nonNegative(input.requestedReferralCreditRsd, "Requested referral credit"),
    nonNegative(input.availableReferralCreditRsd, "Available referral credit"),
    referral.referralBaseRsd,
  );
  const payableTotalRsd = subtotalRsd - couponDiscountRsd - cartPromotionDiscountRsd - referralAppliedRsd + shippingRsd;
  nonNegative(payableTotalRsd, "Payable total");
  return Object.freeze({ subtotalRsd, couponDiscountRsd, referralBaseRsd: referral.referralBaseRsd, referralAppliedRsd, shippingRsd, payableTotalRsd });
}

function integer(value: number, field: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be an integer RSD amount.`);
  return value;
}

function nonNegative(value: number, field: string) {
  integer(value, field);
  if (value < 0) throw new Error(`${field} cannot be negative.`);
  return value;
}

/** Canonical product precedence: explicit variant > sale > quantity tier > loyalty tier > regular, then adjust. */
export function resolveProductUnitPrice(input: ResolvedProductPriceInput): CanonicalPrice {
  const regular = nonNegative(input.regularUnitPriceRsd, "Regular unit price");
  const adjust = integer(input.variantPriceAdjustRsd, "Variant price adjustment");
  const explicit = input.explicitVariantUnitPriceRsd;
  if (explicit != null) {
    nonNegative(explicit, "Explicit variant unit price");
    return Object.freeze({ unitPriceRsd: explicit, baseUnitPriceRsd: explicit, priceSource: "EXPLICIT_VARIANT_PRICE",
      adjustments: Object.freeze([]) });
  }
  const selected = input.activeSaleUnitPriceRsd != null
    ? { price: nonNegative(input.activeSaleUnitPriceRsd, "Sale unit price"), source: "SALE" as const }
    : input.tierUnitPriceRsd != null
      ? { price: nonNegative(input.tierUnitPriceRsd, "Tier unit price"), source: "TIER" as const }
      : input.loyaltyTierUnitPriceRsd != null
        ? { price: nonNegative(input.loyaltyTierUnitPriceRsd, "Loyalty tier unit price"), source: "LOYALTY_TIER_PRICE" as const }
      : { price: regular, source: "FULL_PRICE" as const };
  const unitPriceRsd = selected.price + adjust;
  nonNegative(unitPriceRsd, "Resolved unit price");
  const adjustments: Array<{ kind: KnownAdjustmentKind; amountRsd: number }> = [];
  if (selected.source !== "FULL_PRICE") adjustments.push({
    kind: selected.source === "LOYALTY_TIER_PRICE" ? "LOYALTY" : selected.source,
    amountRsd: (regular - selected.price),
  });
  if (adjust !== 0) adjustments.push({ kind: "VARIANT_PRICE_ADJUST", amountRsd: adjust });
  return Object.freeze({
    unitPriceRsd, baseUnitPriceRsd: regular + adjust, priceSource: selected.source,
    adjustments: Object.freeze(adjustments),
  });
}

function linePrice(line: CanonicalLineInput): CanonicalPrice {
  if (line.fixedBundleUnitPriceRsd != null) {
    if (line.product) throw new Error("A fixed bundle line cannot also have product pricing.");
    const price = nonNegative(line.fixedBundleUnitPriceRsd, "Fixed bundle unit price");
    return Object.freeze({ unitPriceRsd: price, baseUnitPriceRsd: price, priceSource: "BUNDLE",
      adjustments: Object.freeze([{ kind: "BUNDLE" as const, amountRsd: 0 }]) });
  }
  if (!line.product) throw new Error("A product line requires resolved product pricing.");
  return resolveProductUnitPrice(line.product);
}

function targetMatches(
  line: CanonicalLineInput,
  productIds: readonly string[] | undefined,
  categoryIds: readonly string[] | undefined,
) {
  if (!line.productId) return false;
  const hasTargets = Boolean(productIds?.length || categoryIds?.length);
  if (!hasTargets) return true;
  return Boolean(productIds?.includes(line.productId)
    || categoryIds?.some((categoryId) => line.categoryIds.includes(categoryId)));
}

/** Allocate an integer discount proportionally, with stable largest-remainder ties. */
function proportionalAllocation(
  amounts: readonly Readonly<{ id: string; amountRsd: number }>[],
  requestedRsd: number,
) {
  const total = amounts.reduce((sum, line) => sum + line.amountRsd, 0);
  const discount = Math.min(nonNegative(requestedRsd, "Allocated discount"), total);
  if (!discount || !total) return Object.fromEntries(amounts.map((line) => [line.id, 0]));
  const shares = amounts.map((line) => {
    const numerator = discount * line.amountRsd;
    return { id: line.id, amount: Math.floor(numerator / total), remainder: numerator % total };
  });
  let remainder = discount - shares.reduce((sum, share) => sum + share.amount, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let index = 0; index < shares.length && remainder > 0; index += 1, remainder -= 1) {
    shares[index]!.amount += 1;
  }
  return Object.fromEntries(shares.map((share) => [share.id, share.amount]));
}

function quoteAutomaticPromotions(
  market: CommerceMarket,
  now: Date,
  priced: readonly Readonly<{ line: CanonicalLineInput; pricing: CanonicalPrice; lineSubtotalRsd: number }>[],
  promotions: readonly AutomaticXyPromotion[],
) {
  const allocations: Record<string, number> = Object.fromEntries(priced.map(({ line }) => [line.id, 0]));
  const snapshots: Array<Readonly<{ promotionId: string; allocations: Readonly<Record<string, number>>; rewardUnits: number }>> = [];
  for (const promotion of [...promotions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!promotion.id || !promotion.active || (promotion.market !== "BOTH" && promotion.market !== market)
      || (promotion.startsAt && now < promotion.startsAt) || (promotion.endsAt && now >= promotion.endsAt)) continue;
    if (!Number.isSafeInteger(promotion.buyQuantity) || promotion.buyQuantity <= 0
      || !Number.isSafeInteger(promotion.rewardQuantity) || promotion.rewardQuantity <= 0
      || !Number.isSafeInteger(promotion.rewardPercent) || promotion.rewardPercent <= 0 || promotion.rewardPercent > 100) {
      throw new Error("Automatic promotion quantities and percentage are invalid.");
    }
    const buyLines = priced.filter(({ line }) => targetMatches(line, promotion.buyProductIds, promotion.buyCategoryIds));
    const rewardLines = priced.filter(({ line }) => targetMatches(line, promotion.rewardProductIds, promotion.rewardCategoryIds));
    const buyIds = new Set(buyLines.map(({ line }) => line.id));
    const rewardIds = new Set(rewardLines.map(({ line }) => line.id));
    const buyOnlyUnits = buyLines.filter(({ line }) => !rewardIds.has(line.id)).reduce((sum, value) => sum + value.line.quantity, 0);
    const rewardOnlyUnits = rewardLines.filter(({ line }) => !buyIds.has(line.id)).reduce((sum, value) => sum + value.line.quantity, 0);
    const sharedUnits = priced.filter(({ line }) => buyIds.has(line.id) && rewardIds.has(line.id))
      .reduce((sum, value) => sum + value.line.quantity, 0);
    // A unit in the shared pool can be either a buy or a reward, never both.
    // These three constraints are the exact feasible-group bounds for the
    // buy-only, reward-only and shared pools.
    const completeGroups = Math.min(
      Math.floor((buyOnlyUnits + sharedUnits) / promotion.buyQuantity),
      Math.floor((rewardOnlyUnits + sharedUnits) / promotion.rewardQuantity),
      Math.floor((buyOnlyUnits + rewardOnlyUnits + sharedUnits) / (promotion.buyQuantity + promotion.rewardQuantity)),
    );
    const cap = promotion.perOrderRewardUnitCap == null
      ? Number.MAX_SAFE_INTEGER
      : nonNegative(promotion.perOrderRewardUnitCap, "Promotion reward-unit cap");
    const requestedRewardUnits = Math.min(completeGroups * promotion.rewardQuantity, cap);
    let remainingUnits = requestedRewardUnits;
    // Selecting a shared reward unit leaves one fewer unit to satisfy buys.
    const sharedRewardCap = Math.max(0, buyOnlyUnits + sharedUnits - completeGroups * promotion.buyQuantity);
    let sharedRewards = 0;
    const promotionAllocations: Record<string, number> = {};
    const candidates = rewardLines
      .flatMap(({ line, pricing }) => Array.from({ length: line.quantity }, (_, unitIndex) => ({
        id: line.id, unitIndex, unitPriceRsd: pricing.unitPriceRsd,
      })))
      .sort((a, b) => a.unitPriceRsd - b.unitPriceRsd || a.id.localeCompare(b.id) || a.unitIndex - b.unitIndex);
    for (const unit of candidates) {
      if (remainingUnits <= 0) break;
      if (buyIds.has(unit.id) && sharedRewards >= sharedRewardCap) continue;
      const amount = Math.floor(unit.unitPriceRsd * promotion.rewardPercent / 100);
      if (amount > 0) {
        const remainingLineAmount = priced.find(({ line }) => line.id === unit.id)!.lineSubtotalRsd - allocations[unit.id]!;
        const applied = Math.min(amount, remainingLineAmount);
        if (applied > 0) {
          allocations[unit.id] = allocations[unit.id]! + applied;
          promotionAllocations[unit.id] = (promotionAllocations[unit.id] ?? 0) + applied;
          if (buyIds.has(unit.id)) sharedRewards += 1;
          remainingUnits -= 1;
        }
      }
    }
    const rewardUnits = requestedRewardUnits - remainingUnits;
    if (rewardUnits > 0) snapshots.push(Object.freeze({
      promotionId: promotion.id,
      allocations: Object.freeze(promotionAllocations),
      rewardUnits,
    }));
  }
  return {
    allocations,
    snapshots: Object.freeze(snapshots),
    discountRsd: Object.values(allocations).reduce((sum, amount) => sum + amount, 0),
  };
}

/**
 * Pure canonical order evaluator. Database code supplies a locked coupon
 * policy and referral allocation; this module owns deterministic arithmetic,
 * allocation inputs and all conservation checks.
 */
function quoteCommerceLegacy(input: Readonly<{
  market: CommerceMarket;
  lines: readonly CanonicalLineInput[];
  coupon: CouponPolicy | null;
  now: Date;
  customerUsageCount: number;
  requestedReferralCreditRsd: number;
  availableReferralCreditRsd: number;
  shippingRsd: number;
  couponFreeShipping?: boolean;
  automaticPromotions?: readonly AutomaticXyPromotion[];
  thresholdRewards?: readonly CartThresholdReward[];
}>): CanonicalQuote {
  const shippingRsd = nonNegative(input.shippingRsd, "Shipping");
  const requestedReferral = nonNegative(input.requestedReferralCreditRsd, "Requested referral credit");
  const availableReferral = nonNegative(input.availableReferralCreditRsd, "Available referral credit");
  const priced = input.lines.map((line) => {
    if (!line.id) throw new Error("Line id is required.");
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Line quantity must be a positive integer.");
    const pricing = linePrice(line);
    const lineSubtotalRsd = pricing.unitPriceRsd * line.quantity;
    integer(lineSubtotalRsd, "Line subtotal");
    return { line, pricing, lineSubtotalRsd };
  }).sort((a, b) => a.line.id.localeCompare(b.line.id));
  if (new Set(priced.map(({ line }) => line.id)).size !== priced.length) throw new Error("Line ids must be unique.");
  const automatic = quoteAutomaticPromotions(input.market, input.now, priced, input.automaticPromotions ?? []);
  const couponLines: CouponLine[] = priced.map(({ line, lineSubtotalRsd }) => ({
    id: line.id, productId: line.productId, bundleId: line.bundleId,
    categoryIds: [...line.categoryIds], amountRsd: lineSubtotalRsd - automatic.allocations[line.id]!,
  }));
  const thresholdQualificationSubtotalRsd = couponLines.reduce((sum, line) => sum + line.amountRsd, 0);
  const coupon = quoteCoupon({
    coupon: input.coupon, audience: input.market, lines: couponLines,
    now: input.now, customerUsageCount: input.customerUsageCount,
  });
  // Invalid is intentionally a result, never silently interpreted as a zero
  // discount by callers that need to preserve existing coupon error mapping.
  const allocations = coupon.valid ? coupon.allocations : {};
  const couponDiscountRsd = coupon.valid ? coupon.discountRsd : 0;
  const crossedRewards = [...(input.thresholdRewards ?? [])]
    .filter((reward) => reward.active && (reward.market === "BOTH" || reward.market === input.market)
      && nonNegative(reward.thresholdRsd, "Reward threshold") <= thresholdQualificationSubtotalRsd)
    .sort((a, b) => a.thresholdRsd - b.thresholdRsd || a.id.localeCompare(b.id));
  const strongestPercent = crossedRewards
    .filter((reward) => reward.kind === "PERCENT_DISCOUNT")
    .reduce((maximum, reward) => {
      if (!Number.isSafeInteger(reward.percent) || reward.percent! <= 0 || reward.percent! > 100) {
        throw new Error("Threshold reward percentage must be between 1 and 100.");
      }
      return Math.max(maximum, reward.percent!);
    }, 0);
  const postCouponAmounts = couponLines.map((line) => ({
    id: line.id,
    amountRsd: line.amountRsd - (allocations[line.id] ?? 0),
  }));
  const postCouponSubtotal = postCouponAmounts.reduce((sum, line) => sum + line.amountRsd, 0);
  const thresholdRewardDiscountRsd = Math.floor(postCouponSubtotal * strongestPercent / 100);
  const thresholdAllocations = proportionalAllocation(postCouponAmounts, thresholdRewardDiscountRsd);
  const rewardGifts = crossedRewards
    .filter((reward) => reward.kind === "GIFT_PRODUCT")
    .map((reward) => {
      if (!reward.giftProductId || !Number.isSafeInteger(reward.giftQuantity) || reward.giftQuantity! <= 0) {
        throw new Error("Gift threshold reward requires a product and positive quantity.");
      }
      return Object.freeze({ rewardId: reward.id, productId: reward.giftProductId, quantity: reward.giftQuantity! });
    });
  const thresholdFreeShipping = crossedRewards.some((reward) => reward.kind === "FREE_SHIPPING");
  const referralFacts = quoteCommerceReferralBase(priced.map(({ line, pricing, lineSubtotalRsd }) => ({
    id: line.id,
    amountRsd: lineSubtotalRsd - automatic.allocations[line.id]! - (allocations[line.id] ?? 0) - thresholdAllocations[line.id]!,
    discounts: commerceDiscountsForPricedLine({
      priceSource: pricing.priceSource === "EXPLICIT_VARIANT_PRICE" ? "FULL_PRICE" : pricing.priceSource,
      lineDiscountRsd: (pricing.baseUnitPriceRsd - pricing.unitPriceRsd) * line.quantity,
      couponAllocationRsd: allocations[line.id] ?? 0,
      additionalDiscounts: [
        { kind: "AUTOMATIC_XY_PROMOTION", amountRsd: automatic.allocations[line.id]! },
        { kind: "CART_THRESHOLD_REWARD", amountRsd: thresholdAllocations[line.id]! },
      ],
    }),
  })));
  const referralAppliedRsd = Math.min(requestedReferral, availableReferral, referralFacts.referralBaseRsd);
  const lines = priced.map(({ line, pricing, lineSubtotalRsd }) => {
    const couponAllocationRsd = allocations[line.id] ?? 0;
    const automaticPromotionAllocationRsd = automatic.allocations[line.id]!;
    const thresholdRewardAllocationRsd = thresholdAllocations[line.id]!;
    nonNegative(couponAllocationRsd, "Coupon allocation");
    if (couponAllocationRsd > lineSubtotalRsd) throw new Error("Coupon allocation exceeds line subtotal.");
    const decision = referralFacts.lines.find((fact) => fact.id === line.id)!;
    return Object.freeze({
      id: line.id, quantity: line.quantity, productId: line.productId, bundleId: line.bundleId,
      unitPriceRsd: pricing.unitPriceRsd, lineSubtotalRsd, couponAllocationRsd,
      automaticPromotionAllocationRsd, thresholdRewardAllocationRsd,
      lineTotalRsd: lineSubtotalRsd - automaticPromotionAllocationRsd - couponAllocationRsd - thresholdRewardAllocationRsd,
      priceSource: pricing.priceSource,
      adjustments: Object.freeze([
        ...pricing.adjustments,
        ...(automaticPromotionAllocationRsd ? [{ kind: "AUTOMATIC_XY_PROMOTION" as const, amountRsd: automaticPromotionAllocationRsd }] : []),
        ...(couponAllocationRsd ? [{ kind: "COUPON" as const, amountRsd: couponAllocationRsd }] : []),
        ...(thresholdRewardAllocationRsd ? [{ kind: "CART_THRESHOLD_REWARD" as const, amountRsd: thresholdRewardAllocationRsd }] : []),
      ]),
      referralEligible: decision.referralEligible,
    });
  });
  const subtotalRsd = lines.reduce((sum, line) => sum + line.lineSubtotalRsd, 0);
  if (couponDiscountRsd !== lines.reduce((sum, line) => sum + line.couponAllocationRsd, 0)) throw new Error("Coupon allocation conservation failed.");
  // Coupon free shipping is a shipping rule, not a merchandise adjustment.
  // A caller can explicitly disable it only when quoting a method unavailable
  // to that coupon; normal checkout uses the historical default.
  const effectiveShipping = thresholdFreeShipping || (input.couponFreeShipping !== false && coupon.valid && coupon.freeShipping) ? 0 : shippingRsd;
  const payableTotalRsd = subtotalRsd - automatic.discountRsd - couponDiscountRsd
    - thresholdRewardDiscountRsd - referralAppliedRsd + effectiveShipping;
  nonNegative(payableTotalRsd, "Payable total");
  return Object.freeze({
    lines: Object.freeze(lines), subtotalRsd, couponDiscountRsd,
    automaticPromotionDiscountRsd: automatic.discountRsd, thresholdRewardDiscountRsd,
    thresholdQualificationSubtotalRsd, rewardGifts: Object.freeze(rewardGifts),
    automaticPromotionSnapshots: automatic.snapshots,
    referralBaseRsd: referralFacts.referralBaseRsd,
    referralAppliedRsd, shippingRsd: effectiveShipping, payableTotalRsd, coupon,
    loyalty: Object.freeze({ postCheckout: true, awardBaseRsd: payableTotalRsd }),
  });
}

/** Resolve canonical line prices and automatic promotions before coupon locking. */
export function prepareCommerceQuote(input: Readonly<{
  market: CommerceMarket;
  lines: readonly CanonicalLineInput[];
  automaticPromotions?: readonly AutomaticXyPromotion[];
  now: Date;
}>): PreparedCommerceQuote {
  const priced = input.lines.map((line) => {
    if (!line.id) throw new Error("Line id is required.");
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Line quantity must be a positive integer.");
    const pricing = linePrice(line);
    const lineSubtotalRsd = pricing.unitPriceRsd * line.quantity;
    integer(lineSubtotalRsd, "Line subtotal");
    return { line, pricing, lineSubtotalRsd };
  }).sort((a, b) => a.line.id.localeCompare(b.line.id));
  if (new Set(priced.map(({ line }) => line.id)).size !== priced.length) throw new Error("Line ids must be unique.");
  const automatic = quoteAutomaticPromotions(input.market, input.now, priced, input.automaticPromotions ?? []);
  const lines = priced.map(({ line, pricing, lineSubtotalRsd }) => Object.freeze({
    id: line.id, quantity: line.quantity, productId: line.productId, bundleId: line.bundleId,
    categoryIds: Object.freeze([...line.categoryIds]), unitPriceRsd: pricing.unitPriceRsd, lineSubtotalRsd,
    automaticPromotionAllocationRsd: automatic.allocations[line.id]!, priceSource: pricing.priceSource,
    baseUnitPriceRsd: pricing.baseUnitPriceRsd, adjustments: pricing.adjustments,
  }));
  const couponLines = lines.map((line) => Object.freeze({
    id: line.id, productId: line.productId, bundleId: line.bundleId,
    categoryIds: Object.freeze([...line.categoryIds]), amountRsd: line.lineSubtotalRsd - line.automaticPromotionAllocationRsd,
  }));
  const subtotalRsd = lines.reduce((sum, line) => sum + line.lineSubtotalRsd, 0);
  const thresholdQualificationSubtotalRsd = couponLines.reduce((sum, line) => sum + line.amountRsd, 0);
  return Object.freeze({
    market: input.market, lines: Object.freeze(lines), couponLines: Object.freeze(couponLines), subtotalRsd,
    automaticPromotionDiscountRsd: automatic.discountRsd, automaticPromotionSnapshots: automatic.snapshots,
    thresholdQualificationSubtotalRsd,
  });
}

/** Apply a locked coupon and cart-level rules to an immutable prepared quote. */
export function finalizeCommerceQuote(input: Readonly<{
  prepared: PreparedCommerceQuote;
  lockedCouponQuote: CouponQuote;
  thresholdRewards?: readonly CartThresholdReward[];
  requestedReferralCreditRsd: number;
  availableReferralCreditRsd: number;
  shippingRsd: number;
  couponFreeShipping?: boolean;
  loyaltyFreeShipping?: boolean;
}>): CanonicalQuote {
  const shippingRsd = nonNegative(input.shippingRsd, "Shipping");
  const requestedReferral = nonNegative(input.requestedReferralCreditRsd, "Requested referral credit");
  const availableReferral = nonNegative(input.availableReferralCreditRsd, "Available referral credit");
  const coupon = input.lockedCouponQuote;
  const allocations = coupon.valid ? coupon.allocations : {};
  const couponLineById = new Map(input.prepared.couponLines.map((line) => [line.id, line]));
  for (const [id, allocation] of Object.entries(allocations)) {
    const line = couponLineById.get(id);
    if (!line) throw new Error("Coupon allocation references an unknown commerce line.");
    nonNegative(allocation, "Coupon allocation");
    if (allocation > line.amountRsd) throw new Error("Coupon allocation exceeds post-promotion line amount.");
  }
  const couponDiscountRsd = coupon.valid ? coupon.discountRsd : 0;
  if (couponDiscountRsd !== Object.values(allocations).reduce((sum, value) => sum + value, 0)) {
    throw new Error("Coupon allocation conservation failed.");
  }
  const crossedRewards = [...(input.thresholdRewards ?? [])]
    .filter((reward) => reward.active && (reward.market === "BOTH" || reward.market === input.prepared.market)
      && nonNegative(reward.thresholdRsd, "Reward threshold") <= input.prepared.thresholdQualificationSubtotalRsd)
    .sort((a, b) => a.thresholdRsd - b.thresholdRsd || a.id.localeCompare(b.id));
  const strongestPercent = crossedRewards.filter((reward) => reward.kind === "PERCENT_DISCOUNT")
    .reduce((maximum, reward) => {
      if (!Number.isSafeInteger(reward.percent) || reward.percent! <= 0 || reward.percent! > 100) {
        throw new Error("Threshold reward percentage must be between 1 and 100.");
      }
      return Math.max(maximum, reward.percent!);
    }, 0);
  const postCouponAmounts = input.prepared.couponLines.map((line) => ({
    id: line.id, amountRsd: line.amountRsd - (allocations[line.id] ?? 0),
  }));
  const postCouponSubtotal = postCouponAmounts.reduce((sum, line) => sum + line.amountRsd, 0);
  const thresholdRewardDiscountRsd = Math.floor(postCouponSubtotal * strongestPercent / 100);
  const thresholdAllocations = proportionalAllocation(postCouponAmounts, thresholdRewardDiscountRsd);
  const rewardGifts = crossedRewards.filter((reward) => reward.kind === "GIFT_PRODUCT").map((reward) => {
    if (!reward.giftProductId || !Number.isSafeInteger(reward.giftQuantity) || reward.giftQuantity! <= 0) {
      throw new Error("Gift threshold reward requires a product and positive quantity.");
    }
    return Object.freeze({ rewardId: reward.id, productId: reward.giftProductId, quantity: reward.giftQuantity! });
  });
  const thresholdFreeShipping = crossedRewards.some((reward) => reward.kind === "FREE_SHIPPING");
  const referralFacts = quoteCommerceReferralBase(input.prepared.lines.map((line) => ({
    id: line.id,
    amountRsd: line.lineSubtotalRsd - line.automaticPromotionAllocationRsd - (allocations[line.id] ?? 0) - thresholdAllocations[line.id]!,
    discounts: commerceDiscountsForPricedLine({
      priceSource: line.priceSource === "EXPLICIT_VARIANT_PRICE" ? "FULL_PRICE" : line.priceSource,
      lineDiscountRsd: (line.baseUnitPriceRsd - line.unitPriceRsd) * line.quantity,
      couponAllocationRsd: allocations[line.id] ?? 0,
      additionalDiscounts: [
        { kind: "AUTOMATIC_XY_PROMOTION", amountRsd: line.automaticPromotionAllocationRsd },
        { kind: "CART_THRESHOLD_REWARD", amountRsd: thresholdAllocations[line.id]! },
      ],
    }),
  })));
  const referralAppliedRsd = Math.min(requestedReferral, availableReferral, referralFacts.referralBaseRsd);
  const lines = input.prepared.lines.map((line) => {
    const couponAllocationRsd = allocations[line.id] ?? 0;
    const thresholdRewardAllocationRsd = thresholdAllocations[line.id]!;
    const lineTotalRsd = line.lineSubtotalRsd - line.automaticPromotionAllocationRsd - couponAllocationRsd - thresholdRewardAllocationRsd;
    nonNegative(lineTotalRsd, "Final line amount");
    const decision = referralFacts.lines.find((fact) => fact.id === line.id)!;
    return Object.freeze({
      id: line.id, quantity: line.quantity, productId: line.productId, bundleId: line.bundleId,
      unitPriceRsd: line.unitPriceRsd, lineSubtotalRsd: line.lineSubtotalRsd, couponAllocationRsd,
      automaticPromotionAllocationRsd: line.automaticPromotionAllocationRsd, thresholdRewardAllocationRsd, lineTotalRsd,
      priceSource: line.priceSource,
      adjustments: Object.freeze([...line.adjustments,
        ...(line.automaticPromotionAllocationRsd ? [{ kind: "AUTOMATIC_XY_PROMOTION" as const, amountRsd: line.automaticPromotionAllocationRsd }] : []),
        ...(couponAllocationRsd ? [{ kind: "COUPON" as const, amountRsd: couponAllocationRsd }] : []),
        ...(thresholdRewardAllocationRsd ? [{ kind: "CART_THRESHOLD_REWARD" as const, amountRsd: thresholdRewardAllocationRsd }] : []),
      ]),
      referralEligible: decision.referralEligible,
    });
  });
  const effectiveShipping = input.loyaltyFreeShipping || thresholdFreeShipping
    || (input.couponFreeShipping !== false && coupon.valid && coupon.freeShipping) ? 0 : shippingRsd;
  const payableTotalRsd = input.prepared.subtotalRsd - input.prepared.automaticPromotionDiscountRsd
    - couponDiscountRsd - thresholdRewardDiscountRsd - referralAppliedRsd + effectiveShipping;
  nonNegative(payableTotalRsd, "Payable total");
  return Object.freeze({
    lines: Object.freeze(lines), subtotalRsd: input.prepared.subtotalRsd, couponDiscountRsd,
    automaticPromotionDiscountRsd: input.prepared.automaticPromotionDiscountRsd, thresholdRewardDiscountRsd,
    thresholdQualificationSubtotalRsd: input.prepared.thresholdQualificationSubtotalRsd,
    rewardGifts: Object.freeze(rewardGifts), automaticPromotionSnapshots: input.prepared.automaticPromotionSnapshots,
    referralBaseRsd: referralFacts.referralBaseRsd, referralAppliedRsd, shippingRsd: effectiveShipping,
    payableTotalRsd, coupon, loyalty: Object.freeze({ postCheckout: true, awardBaseRsd: payableTotalRsd }),
  });
}

/** Backwards-compatible preview wrapper around the staged locked-quote flow. */
export function quoteCommerce(input: Readonly<{
  market: CommerceMarket;
  lines: readonly CanonicalLineInput[];
  coupon: CouponPolicy | null;
  now: Date;
  customerUsageCount: number;
  requestedReferralCreditRsd: number;
  availableReferralCreditRsd: number;
  shippingRsd: number;
  couponFreeShipping?: boolean;
  automaticPromotions?: readonly AutomaticXyPromotion[];
  thresholdRewards?: readonly CartThresholdReward[];
}>): CanonicalQuote {
  const prepared = prepareCommerceQuote(input);
  const lockedCouponQuote = quoteCoupon({
    coupon: input.coupon, audience: input.market, lines: prepared.couponLines.map((line) => ({
      id: line.id, productId: line.productId, bundleId: line.bundleId, categoryIds: [...line.categoryIds], amountRsd: line.amountRsd,
    })),
    now: input.now, customerUsageCount: input.customerUsageCount,
  });
  return finalizeCommerceQuote({
    prepared, lockedCouponQuote, thresholdRewards: input.thresholdRewards,
    requestedReferralCreditRsd: input.requestedReferralCreditRsd,
    availableReferralCreditRsd: input.availableReferralCreditRsd, shippingRsd: input.shippingRsd,
    couponFreeShipping: input.couponFreeShipping,
  });
}