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
  "REGULAR_PRICE",
  "VARIANT_PRICE_ADJUST",
  "FIXED_BUNDLE_PRICE",
  "COUPON",
  "REFERRAL_CREDIT",
  "SHIPPING",
  "POST_CHECKOUT_LOYALTY",
] as const);

export type KnownAdjustmentKind =
  | "EXPLICIT_VARIANT_PRICE" | "SALE" | "TIER" | "VARIANT_PRICE_ADJUST"
  | "BUNDLE" | "COUPON" | "REFERRAL_CREDIT" | "LOYALTY";
export type PriceSource = "FULL_PRICE" | "SALE" | "TIER" | "EXPLICIT_VARIANT_PRICE" | "BUNDLE";
export type CommerceMarket = "B2B" | "B2C";

export type ResolvedProductPriceInput = Readonly<{
  regularUnitPriceRsd: number;
  activeSaleUnitPriceRsd: number | null;
  tierUnitPriceRsd: number | null;
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
  lineTotalRsd: number;
  priceSource: PriceSource;
  adjustments: readonly Readonly<{ kind: KnownAdjustmentKind; amountRsd: number }>[];
  referralEligible: boolean;
}>;

export type CanonicalQuote = Readonly<{
  lines: readonly CanonicalQuotedLine[];
  subtotalRsd: number;
  couponDiscountRsd: number;
  referralBaseRsd: number;
  referralAppliedRsd: number;
  shippingRsd: number;
  payableTotalRsd: number;
  coupon: CouponQuote | null;
  loyalty: Readonly<{ postCheckout: true; awardBaseRsd: number }>;
}>;

/** Locked/DB-backed paths use this after coupon validation.  It intentionally
 * accepts the coupon-engine result, so the policy arithmetic remains in that
 * engine while every route shares total/referral arithmetic. */
export function quoteResolvedCommerce(input: Readonly<{
  lines: readonly Readonly<{
    id: string; productId: string | null; bundleId: string | null; quantity: number;
    unitPriceRsd: number; lineSubtotalRsd: number; priceSource: PriceSource;
    lineDiscountRsd: number;
  }>[];
  coupon: CouponQuote | null;
  requestedReferralCreditRsd: number;
  availableReferralCreditRsd: number;
  shippingRsd: number;
  loyaltyFreeShipping?: boolean;
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
    return {
      id: line.id, amountRsd: line.lineSubtotalRsd,
      discounts: commerceDiscountsForPricedLine({
        priceSource: line.priceSource === "EXPLICIT_VARIANT_PRICE" ? "FULL_PRICE" : line.priceSource,
        lineDiscountRsd: line.lineDiscountRsd, couponAllocationRsd: allocations[line.id] ?? 0,
      }),
    };
  }));
  for (const allocationId of Object.keys(allocations)) {
    if (!lineIds.has(allocationId)) throw new Error("Coupon allocation references an unknown commerce line.");
  }
  const subtotalRsd = input.lines.reduce((sum, line) => sum + line.lineSubtotalRsd, 0);
  const couponDiscountRsd = coupon?.valid ? coupon.discountRsd : 0;
  if (couponDiscountRsd !== Object.values(allocations).reduce((sum, value) => sum + value, 0)) throw new Error("Coupon allocation conservation failed.");
  const shippingRsd = input.loyaltyFreeShipping || (coupon?.valid && coupon.freeShipping)
    ? 0 : nonNegative(input.shippingRsd, "Shipping");
  const referralAppliedRsd = Math.min(
    nonNegative(input.requestedReferralCreditRsd, "Requested referral credit"),
    nonNegative(input.availableReferralCreditRsd, "Available referral credit"),
    referral.referralBaseRsd,
  );
  const payableTotalRsd = subtotalRsd - couponDiscountRsd - referralAppliedRsd + shippingRsd;
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

/** Exact historical product precedence: explicit variant > sale > tier > regular, then adjust. */
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
      : { price: regular, source: "FULL_PRICE" as const };
  const unitPriceRsd = selected.price + adjust;
  nonNegative(unitPriceRsd, "Resolved unit price");
  const adjustments: Array<{ kind: KnownAdjustmentKind; amountRsd: number }> = [];
  if (selected.source !== "FULL_PRICE") adjustments.push({ kind: selected.source, amountRsd: (regular - selected.price) });
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

/**
 * Pure canonical order evaluator. Database code supplies a locked coupon
 * policy and referral allocation; this module owns deterministic arithmetic,
 * allocation inputs and all conservation checks.
 */
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
  const couponLines: CouponLine[] = priced.map(({ line, lineSubtotalRsd }) => ({
    id: line.id, productId: line.productId, bundleId: line.bundleId,
    categoryIds: [...line.categoryIds], amountRsd: lineSubtotalRsd,
  }));
  const coupon = quoteCoupon({
    coupon: input.coupon, audience: input.market, lines: couponLines,
    now: input.now, customerUsageCount: input.customerUsageCount,
  });
  // Invalid is intentionally a result, never silently interpreted as a zero
  // discount by callers that need to preserve existing coupon error mapping.
  const allocations = coupon.valid ? coupon.allocations : {};
  const couponDiscountRsd = coupon.valid ? coupon.discountRsd : 0;
  const referralFacts = quoteCommerceReferralBase(priced.map(({ line, pricing, lineSubtotalRsd }) => ({
    id: line.id, amountRsd: lineSubtotalRsd,
    discounts: commerceDiscountsForPricedLine({
      priceSource: pricing.priceSource === "EXPLICIT_VARIANT_PRICE" ? "FULL_PRICE" : pricing.priceSource,
      lineDiscountRsd: (pricing.baseUnitPriceRsd - pricing.unitPriceRsd) * line.quantity,
      couponAllocationRsd: allocations[line.id] ?? 0,
    }),
  })));
  const referralAppliedRsd = Math.min(requestedReferral, availableReferral, referralFacts.referralBaseRsd);
  const lines = priced.map(({ line, pricing, lineSubtotalRsd }) => {
    const couponAllocationRsd = allocations[line.id] ?? 0;
    nonNegative(couponAllocationRsd, "Coupon allocation");
    if (couponAllocationRsd > lineSubtotalRsd) throw new Error("Coupon allocation exceeds line subtotal.");
    const decision = referralFacts.lines.find((fact) => fact.id === line.id)!;
    return Object.freeze({
      id: line.id, quantity: line.quantity, productId: line.productId, bundleId: line.bundleId,
      unitPriceRsd: pricing.unitPriceRsd, lineSubtotalRsd, couponAllocationRsd,
      lineTotalRsd: lineSubtotalRsd - couponAllocationRsd, priceSource: pricing.priceSource,
      adjustments: Object.freeze([...pricing.adjustments, ...(couponAllocationRsd ? [{ kind: "COUPON" as const, amountRsd: couponAllocationRsd }] : [])]),
      referralEligible: decision.referralEligible,
    });
  });
  const subtotalRsd = lines.reduce((sum, line) => sum + line.lineSubtotalRsd, 0);
  if (couponDiscountRsd !== lines.reduce((sum, line) => sum + line.couponAllocationRsd, 0)) throw new Error("Coupon allocation conservation failed.");
  // Coupon free shipping is a shipping rule, not a merchandise adjustment.
  // A caller can explicitly disable it only when quoting a method unavailable
  // to that coupon; normal checkout uses the historical default.
  const effectiveShipping = input.couponFreeShipping !== false && coupon.valid && coupon.freeShipping ? 0 : shippingRsd;
  const payableTotalRsd = subtotalRsd - couponDiscountRsd - referralAppliedRsd + effectiveShipping;
  nonNegative(payableTotalRsd, "Payable total");
  return Object.freeze({
    lines: Object.freeze(lines), subtotalRsd, couponDiscountRsd, referralBaseRsd: referralFacts.referralBaseRsd,
    referralAppliedRsd, shippingRsd: effectiveShipping, payableTotalRsd, coupon,
    loyalty: Object.freeze({ postCheckout: true, awardBaseRsd: payableTotalRsd }),
  });
}