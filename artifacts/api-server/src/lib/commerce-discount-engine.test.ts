import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCE_DISCOUNT_POLICIES,
  commerceDiscountsForPricedLine,
  quoteCommerceReferralBase,
} from "./commerce-discount-engine";

test("referral base includes only clean full-price lines in a mixed cart", () => {
  const quote = quoteCommerceReferralBase([
    { id: "clean", amountRsd: 1_000, discounts: commerceDiscountsForPricedLine({ priceSource: "FULL_PRICE" }) },
    { id: "sale", amountRsd: 800, discounts: commerceDiscountsForPricedLine({ priceSource: "SALE", lineDiscountRsd: 200 }) },
    { id: "tier", amountRsd: 700, discounts: commerceDiscountsForPricedLine({ priceSource: "TIER", lineDiscountRsd: 300 }) },
    { id: "bundle", amountRsd: 600, discounts: commerceDiscountsForPricedLine({ priceSource: "BUNDLE" }) },
  ]);
  assert.equal(quote.referralBaseRsd, 1_000);
  assert.deepEqual(quote.lines.map((line) => line.referralEligible), [true, false, false, false]);
});

test("any positive coupon allocation blocks the entire otherwise clean line", () => {
  const quote = quoteCommerceReferralBase([
    { id: "coupon", amountRsd: 1_000, discounts: commerceDiscountsForPricedLine({
      priceSource: "FULL_PRICE", couponAllocationRsd: 1,
    }) },
    { id: "zero", amountRsd: 500, discounts: commerceDiscountsForPricedLine({
      priceSource: "FULL_PRICE", couponAllocationRsd: 0,
    }) },
  ]);
  assert.equal(quote.referralBaseRsd, 500);
});

test("loyalty and unknown positive discounts fail closed while non-positive facts do not block", () => {
  const quote = quoteCommerceReferralBase([
    { id: "loyalty", amountRsd: 100, discounts: [{ kind: "LOYALTY", amountRsd: 1 }] },
    { id: "future", amountRsd: 100, discounts: [{ kind: "FUTURE_PROMO", amountRsd: 1 }] },
    { id: "zero", amountRsd: 100, discounts: [{ kind: "FUTURE_PROMO", amountRsd: 0 }] },
  ]);
  assert.equal(quote.referralBaseRsd, 100);
});

test("discount policy source is immutable and future families fail closed", () => {
  assert.equal(Object.isFrozen(COMMERCE_DISCOUNT_POLICIES), true);
  assert.deepEqual(Object.keys(COMMERCE_DISCOUNT_POLICIES), ["SALE", "TIER", "BUNDLE", "COUPON", "LOYALTY"]);
  assert.equal(quoteCommerceReferralBase([
    { id: "line", amountRsd: 100, discounts: [{ kind: "INFORMATIONAL", amountRsd: 10 }] },
  ]).referralBaseRsd, 0);
});