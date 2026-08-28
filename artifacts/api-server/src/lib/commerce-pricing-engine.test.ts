import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCE_PRICING_POLICY,
  finalizeCommerceQuote,
  prepareCommerceQuote,
  quoteCommerce,
  quoteResolvedCommerce,
  resolveProductUnitPrice,
} from "./commerce-pricing-engine";
import { quoteCommerceReferralBase } from "./commerce-discount-engine";
import type { CouponPolicy } from "./coupon-engine";

const now = new Date("2026-01-01T00:00:00.000Z");

function policy(overrides: Partial<CouponPolicy> = {}): CouponPolicy {
  return {
    code: "GOLDEN", active: true, audience: null, discountType: "FIXED_RSD", discountValue: 0,
    startsAt: null, endsAt: null, minimumSpendRsd: 0, maximumSpendRsd: null, freeShipping: false,
    includeProductIds: [], excludeProductIds: [], includeCategoryIds: [], excludeCategoryIds: [],
    includeBundleIds: [], excludeBundleIds: [], usageLimit: null, usageCount: 0, perCustomerUsageLimit: null,
    ...overrides,
  };
}

function product(regularUnitPriceRsd: number, overrides: Partial<{
  activeSaleUnitPriceRsd: number | null; tierUnitPriceRsd: number | null;
  explicitVariantUnitPriceRsd: number | null; variantPriceAdjustRsd: number;
}> = {}) {
  return {
    regularUnitPriceRsd, activeSaleUnitPriceRsd: null, tierUnitPriceRsd: null,
    explicitVariantUnitPriceRsd: null, variantPriceAdjustRsd: 0, ...overrides,
  };
}

function line(id: string, priced: ReturnType<typeof product>, quantity = 1) {
  return { id, quantity, productId: id, bundleId: null, categoryIds: [], product: priced };
}

test("literal product-price golden matrix preserves precedence, boundaries and explanation order", () => {
  const fixtures = [
    [product(1_000), { unitPriceRsd: 1_000, baseUnitPriceRsd: 1_000, priceSource: "FULL_PRICE", adjustments: [] }],
    [product(1_000, { activeSaleUnitPriceRsd: 800 }), { unitPriceRsd: 800, baseUnitPriceRsd: 1_000, priceSource: "SALE", adjustments: [{ kind: "SALE", amountRsd: 200 }] }],
    // An expired sale is resolved by the DB boundary to null before this evaluator.
    [product(1_000, { activeSaleUnitPriceRsd: null }), { unitPriceRsd: 1_000, baseUnitPriceRsd: 1_000, priceSource: "FULL_PRICE", adjustments: [] }],
    [product(1_000, { tierUnitPriceRsd: 700 }), { unitPriceRsd: 700, baseUnitPriceRsd: 1_000, priceSource: "TIER", adjustments: [{ kind: "TIER", amountRsd: 300 }] }],
    [product(1_000, { activeSaleUnitPriceRsd: 800, tierUnitPriceRsd: 700 }), { unitPriceRsd: 800, baseUnitPriceRsd: 1_000, priceSource: "SALE", adjustments: [{ kind: "SALE", amountRsd: 200 }] }],
    [product(1_000, { activeSaleUnitPriceRsd: 800, explicitVariantUnitPriceRsd: 650, variantPriceAdjustRsd: 25 }), { unitPriceRsd: 650, baseUnitPriceRsd: 650, priceSource: "EXPLICIT_VARIANT_PRICE", adjustments: [] }],
    [product(1_000, { variantPriceAdjustRsd: 25 }), { unitPriceRsd: 1_025, baseUnitPriceRsd: 1_025, priceSource: "FULL_PRICE", adjustments: [{ kind: "VARIANT_PRICE_ADJUST", amountRsd: 25 }] }],
    [product(1_000, { variantPriceAdjustRsd: -25 }), { unitPriceRsd: 975, baseUnitPriceRsd: 975, priceSource: "FULL_PRICE", adjustments: [{ kind: "VARIANT_PRICE_ADJUST", amountRsd: -25 }] }],
    [product(0), { unitPriceRsd: 0, baseUnitPriceRsd: 0, priceSource: "FULL_PRICE", adjustments: [] }],
    [product(1, { variantPriceAdjustRsd: -1 }), { unitPriceRsd: 0, baseUnitPriceRsd: 0, priceSource: "FULL_PRICE", adjustments: [{ kind: "VARIANT_PRICE_ADJUST", amountRsd: -1 }] }],
  ] as const;

  for (const [input, expected] of fixtures) {
    const actual = resolveProductUnitPrice(input);
    assert.deepEqual(actual, expected);
    // The auditable explanation always exposes base, ordered adjustments, and final.
    assert.equal(typeof actual.baseUnitPriceRsd, "number");
    assert.ok(Array.isArray(actual.adjustments));
    assert.equal(typeof actual.unitPriceRsd, "number");
  }
  assert.deepEqual(
    resolveProductUnitPrice(product(1_000, { activeSaleUnitPriceRsd: 800, variantPriceAdjustRsd: 25 })).adjustments,
    [{ kind: "SALE", amountRsd: 200 }, { kind: "VARIANT_PRICE_ADJUST", amountRsd: 25 }],
  );
});

test("approved pricing policy and loyalty fallback precedence are literal", () => {
  assert.deepEqual(COMMERCE_PRICING_POLICY, [
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
  ]);
  assert.deepEqual(resolveProductUnitPrice({
    ...product(1_000),
    loyaltyTierUnitPriceRsd: 900,
    variantPriceAdjustRsd: 10,
  }), {
    unitPriceRsd: 910,
    baseUnitPriceRsd: 1_010,
    priceSource: "LOYALTY_TIER_PRICE",
    adjustments: [
      { kind: "LOYALTY", amountRsd: 100 },
      { kind: "VARIANT_PRICE_ADJUST", amountRsd: 10 },
    ],
  });
  assert.equal(resolveProductUnitPrice({
    ...product(1_000),
    tierUnitPriceRsd: 850,
    loyaltyTierUnitPriceRsd: 900,
  }).unitPriceRsd, 850);
  assert.equal(resolveProductUnitPrice({
    ...product(1_000),
    activeSaleUnitPriceRsd: 800,
    tierUnitPriceRsd: 850,
    loyaltyTierUnitPriceRsd: 900,
  }).unitPriceRsd, 800);
});

test("X+Y, coupon and cumulative threshold rewards use literal stage bases", () => {
  const quote = quoteCommerce({
    market: "B2C",
    lines: [
      line("buy", product(100), 2),
      line("reward", product(50), 2),
    ],
    automaticPromotions: [{
      id: "xy",
      market: "BOTH",
      active: true,
      startsAt: null,
      endsAt: null,
      buyQuantity: 2,
      rewardQuantity: 1,
      rewardPercent: 100,
      buyProductIds: ["buy"],
      rewardProductIds: ["reward"],
    }],
    coupon: policy({ discountValue: 10, includeProductIds: ["buy", "reward"] }),
    thresholdRewards: [
      { id: "percent-5", market: "BOTH", active: true, thresholdRsd: 100, kind: "PERCENT_DISCOUNT", percent: 5 },
      { id: "percent-10", market: "B2C", active: true, thresholdRsd: 200, kind: "PERCENT_DISCOUNT", percent: 10 },
      { id: "shipping", market: "BOTH", active: true, thresholdRsd: 200, kind: "FREE_SHIPPING" },
      { id: "gift", market: "B2C", active: true, thresholdRsd: 250, kind: "GIFT_PRODUCT", giftProductId: "gift-product", giftQuantity: 2 },
    ],
    now,
    customerUsageCount: 0,
    requestedReferralCreditRsd: 999,
    availableReferralCreditRsd: 999,
    shippingRsd: 390,
  });
  assert.deepEqual(quote.lines.map((value) => ({
    id: value.id,
    xy: value.automaticPromotionAllocationRsd,
    coupon: value.couponAllocationRsd,
    threshold: value.thresholdRewardAllocationRsd,
    total: value.lineTotalRsd,
    referralEligible: value.referralEligible,
  })), [
    { id: "buy", xy: 0, coupon: 8, threshold: 19, total: 173, referralEligible: false },
    { id: "reward", xy: 50, coupon: 2, threshold: 5, total: 43, referralEligible: false },
  ]);
  assert.deepEqual({
    subtotal: quote.subtotalRsd,
    qualification: quote.thresholdQualificationSubtotalRsd,
    xy: quote.automaticPromotionDiscountRsd,
    coupon: quote.couponDiscountRsd,
    threshold: quote.thresholdRewardDiscountRsd,
    referralBase: quote.referralBaseRsd,
    shipping: quote.shippingRsd,
    payable: quote.payableTotalRsd,
    gifts: quote.rewardGifts,
  }, {
    subtotal: 300,
    qualification: 250,
    xy: 50,
    coupon: 10,
    threshold: 24,
    referralBase: 0,
    shipping: 0,
    payable: 216,
    gifts: [{ rewardId: "gift", productId: "gift-product", quantity: 2 }],
  });
  assert.deepEqual(quote.automaticPromotionSnapshots, [{
    promotionId: "xy",
    allocations: { reward: 50 },
    rewardUnits: 1,
  }]);
});

test("both-market fixed bundles and coupons have literal deterministic allocations", () => {
  const sharedLines = [
    line("z-full", product(100)),
    line("a-sale", product(100, { activeSaleUnitPriceRsd: 80 })),
    { id: "m-bundle", quantity: 2, productId: null, bundleId: "bundle", categoryIds: [], fixedBundleUnitPriceRsd: 30 },
  ];
  const fixed = policy({ discountValue: 5, includeProductIds: ["z-full", "a-sale"], includeBundleIds: ["bundle"] });
  const percent = policy({ discountType: "PERCENTAGE", discountValue: 10, includeProductIds: ["z-full", "a-sale"], includeBundleIds: ["bundle"] });
  for (const market of ["B2C", "B2B"] as const) {
    const fixedQuote = quoteCommerce({ market, lines: sharedLines, coupon: fixed, now, customerUsageCount: 0, requestedReferralCreditRsd: 999, availableReferralCreditRsd: 999, shippingRsd: 50 });
    assert.deepEqual(fixedQuote.lines.map((value) => [value.id, value.unitPriceRsd, value.lineSubtotalRsd, value.couponAllocationRsd, value.lineTotalRsd, value.priceSource, value.referralEligible]), [
      ["a-sale", 80, 80, 2, 78, "SALE", false],
      ["m-bundle", 30, 60, 1, 59, "BUNDLE", false],
      ["z-full", 100, 100, 2, 98, "FULL_PRICE", false],
    ]);
    assert.deepEqual(
      { subtotal: fixedQuote.subtotalRsd, coupon: fixedQuote.couponDiscountRsd, referralBase: fixedQuote.referralBaseRsd, referral: fixedQuote.referralAppliedRsd, shipping: fixedQuote.shippingRsd, payable: fixedQuote.payableTotalRsd },
      { subtotal: 240, coupon: 5, referralBase: 0, referral: 0, shipping: 50, payable: 285 },
    );
    const percentageQuote = quoteCommerce({ market, lines: sharedLines, coupon: percent, now, customerUsageCount: 0, requestedReferralCreditRsd: 0, availableReferralCreditRsd: 0, shippingRsd: 50 });
    assert.deepEqual(percentageQuote.lines.map((value) => [value.id, value.couponAllocationRsd]), [["a-sale", 8], ["m-bundle", 6], ["z-full", 10]]);
    assert.equal(percentageQuote.couponDiscountRsd, 24);
    assert.equal(percentageQuote.couponDiscountRsd, percentageQuote.lines.reduce((sum, value) => sum + value.couponAllocationRsd, 0));
  }
});

test("referral eligibility blocks every positive discount family and fails closed", () => {
  const facts = quoteCommerceReferralBase([
    { id: "clean", amountRsd: 10, discounts: [] },
    ...["SALE", "TIER", "BUNDLE", "COUPON", "LOYALTY", "UNRECOGNIZED_PROMOTION"].map((kind) => ({
      id: kind, amountRsd: 10, discounts: [{ kind, amountRsd: 1 }],
    })),
    { id: "zero-sale", amountRsd: 10, discounts: [{ kind: "SALE", amountRsd: 0 }] },
  ]);
  assert.deepEqual(facts.lines.map((value) => [value.id, value.referralEligible, value.referralBaseRsd]), [
    ["clean", true, 10], ["SALE", false, 0], ["TIER", false, 0], ["BUNDLE", false, 0],
    ["COUPON", false, 0], ["LOYALTY", false, 0], ["UNRECOGNIZED_PROMOTION", false, 0], ["zero-sale", true, 10],
  ]);
  assert.equal(facts.referralBaseRsd, 20);
});

test("mixed product, variant and bundle cart keeps only undiscounted variants referral-clean", () => {
  const quote = quoteCommerce({
    market: "B2B",
    lines: [
      line("product", product(100), 2),
      line("explicit-variant", product(100, { explicitVariantUnitPriceRsd: 75, variantPriceAdjustRsd: 99 })),
      line("adjusted-variant", product(100, { variantPriceAdjustRsd: 10 })),
      { id: "bundle", quantity: 1, productId: null, bundleId: "bundle", categoryIds: [], fixedBundleUnitPriceRsd: 40 },
    ],
    coupon: null, now, customerUsageCount: 0, requestedReferralCreditRsd: 999, availableReferralCreditRsd: 999, shippingRsd: 0,
  });
  assert.deepEqual(quote.lines.map((value) => [value.id, value.unitPriceRsd, value.lineSubtotalRsd, value.priceSource, value.referralEligible, value.adjustments]), [
    ["adjusted-variant", 110, 110, "FULL_PRICE", true, [{ kind: "VARIANT_PRICE_ADJUST", amountRsd: 10 }]],
    ["bundle", 40, 40, "BUNDLE", false, [{ kind: "BUNDLE", amountRsd: 0 }]],
    ["explicit-variant", 75, 75, "EXPLICIT_VARIANT_PRICE", true, []],
    ["product", 100, 200, "FULL_PRICE", true, []],
  ]);
  assert.deepEqual(
    { subtotal: quote.subtotalRsd, referralBase: quote.referralBaseRsd, referral: quote.referralAppliedRsd, payable: quote.payableTotalRsd },
    { subtotal: 425, referralBase: 385, referral: 385, payable: 40 },
  );
});

test("shipping is a rule: coupon and loyalty waive it without becoming merchandise adjustments", () => {
  const freeShippingCoupon = policy({ freeShipping: true, discountValue: 0, includeProductIds: ["p"] });
  const couponQuote = quoteCommerce({
    market: "B2C", lines: [line("p", product(10))], coupon: freeShippingCoupon, now, customerUsageCount: 0,
    requestedReferralCreditRsd: 0, availableReferralCreditRsd: 0, shippingRsd: 50,
  });
  assert.deepEqual(
    { subtotal: couponQuote.subtotalRsd, coupon: couponQuote.couponDiscountRsd, shipping: couponQuote.shippingRsd, payable: couponQuote.payableTotalRsd, adjustments: couponQuote.lines[0]!.adjustments },
    { subtotal: 10, coupon: 0, shipping: 0, payable: 10, adjustments: [] },
  );
  assert.deepEqual(quoteResolvedCommerce({
    lines: [{ id: "p", productId: "p", bundleId: null, quantity: 1, unitPriceRsd: 10, lineSubtotalRsd: 10, priceSource: "FULL_PRICE", lineDiscountRsd: 0 }],
    coupon: null, requestedReferralCreditRsd: 0, availableReferralCreditRsd: 0, shippingRsd: 50, loyaltyFreeShipping: true,
  }), { subtotalRsd: 10, couponDiscountRsd: 0, referralBaseRsd: 10, referralAppliedRsd: 0, shippingRsd: 0, payableTotalRsd: 10 });
});

test("invalid coupon and invalid price inputs fail closed at zero and integer boundaries", () => {
  const expired = quoteCommerce({
    market: "B2C", lines: [line("p", product(1))], coupon: policy({ endsAt: now, discountValue: 1, includeProductIds: ["p"] }),
    now, customerUsageCount: 0, requestedReferralCreditRsd: 0, availableReferralCreditRsd: 0, shippingRsd: 0,
  });
  assert.deepEqual(expired.coupon, { valid: false, reason: "EXPIRED" });
  assert.throws(() => resolveProductUnitPrice(product(-1)), /Regular unit price cannot be negative/);
  assert.throws(() => resolveProductUnitPrice(product(1, { variantPriceAdjustRsd: -2 })), /Resolved unit price cannot be negative/);
  assert.throws(() => resolveProductUnitPrice(product(1.5)), /integer RSD amount/);
  assert.throws(() => quoteResolvedCommerce({
    lines: [{ id: "p", productId: "p", bundleId: null, quantity: 2, unitPriceRsd: 10, lineSubtotalRsd: 19, priceSource: "FULL_PRICE", lineDiscountRsd: 0 }],
    coupon: null, requestedReferralCreditRsd: 0, availableReferralCreditRsd: 0, shippingRsd: 0,
  }), /Line subtotal must equal unit price times quantity/);
  assert.throws(() => quoteResolvedCommerce({
    lines: [{ id: "p", productId: "p", bundleId: null, quantity: 1, unitPriceRsd: 10, lineSubtotalRsd: 10, priceSource: "FULL_PRICE", lineDiscountRsd: 0 }],
    coupon: { valid: true, code: "X", discountRsd: 1, freeShipping: false, allocations: { missing: 1 }, eligibleSubtotalRsd: 10 },
    requestedReferralCreditRsd: 0, availableReferralCreditRsd: 0, shippingRsd: 0,
  }), /Coupon allocation references an unknown commerce line/);
});

test("prepared quotes lock post-X+Y coupon inputs and finalization preserves stage conservation", () => {
  const prepared = prepareCommerceQuote({
    market: "B2C",
    lines: [line("same-pool", product(100), 3)],
    now,
    automaticPromotions: [{
      id: "same", market: "BOTH", active: true, startsAt: null, endsAt: null,
      buyQuantity: 2, rewardQuantity: 1, rewardPercent: 100, buyProductIds: ["same-pool"], rewardProductIds: ["same-pool"],
    }],
  });
  assert.deepEqual({
    couponLines: prepared.couponLines,
    automatic: prepared.automaticPromotionDiscountRsd,
    snapshots: prepared.automaticPromotionSnapshots,
    qualification: prepared.thresholdQualificationSubtotalRsd,
  }, {
    couponLines: [{ id: "same-pool", productId: "same-pool", bundleId: null, categoryIds: [], amountRsd: 200 }],
    automatic: 100,
    snapshots: [{ promotionId: "same", allocations: { "same-pool": 100 }, rewardUnits: 1 }],
    qualification: 200,
  });
  const final = finalizeCommerceQuote({
    prepared,
    lockedCouponQuote: {
      valid: true, code: "LOCKED", discountRsd: 20, freeShipping: false,
      allocations: { "same-pool": 20 }, eligibleSubtotalRsd: 200,
    },
    thresholdRewards: [
      { id: "five", market: "BOTH", active: true, thresholdRsd: 1, kind: "PERCENT_DISCOUNT", percent: 5 },
      { id: "ten", market: "BOTH", active: true, thresholdRsd: 1, kind: "PERCENT_DISCOUNT", percent: 10 },
    ],
    requestedReferralCreditRsd: 10, availableReferralCreditRsd: 10, shippingRsd: 0,
  });
  assert.deepEqual(
    { xy: final.automaticPromotionDiscountRsd, coupon: final.couponDiscountRsd, threshold: final.thresholdRewardDiscountRsd, total: final.payableTotalRsd, referral: final.referralAppliedRsd },
    { xy: 100, coupon: 20, threshold: 18, total: 162, referral: 0 },
  );
});