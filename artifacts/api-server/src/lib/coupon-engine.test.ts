import assert from "node:assert/strict";
import { quoteCoupon, type CouponPolicy } from "./coupon-engine";

const coupon: CouponPolicy = {
  code: "SAVE", active: true, audience: null, discountType: "FIXED_RSD", discountValue: 5,
  startsAt: null, endsAt: null, minimumSpendRsd: 0, maximumSpendRsd: null, freeShipping: false,
  includeProductIds: [], excludeProductIds: ["blocked"], includeCategoryIds: [], excludeCategoryIds: [],
  includeBundleIds: [], excludeBundleIds: [], usageLimit: null, usageCount: 0, perCustomerUsageLimit: null,
};
const quote = quoteCoupon({ coupon, audience: "B2B", now: new Date(), customerUsageCount: 0, lines: [
  { id: "b", productId: "ok", bundleId: null, categoryIds: [], amountRsd: 4 },
  { id: "a", productId: "ok2", bundleId: null, categoryIds: [], amountRsd: 3 },
  { id: "x", productId: "blocked", bundleId: null, categoryIds: [], amountRsd: 100 },
] });
assert.equal(quote.valid, true);
if (quote.valid) {
  assert.equal(quote.discountRsd, 5);
  assert.deepEqual(quote.allocations, { b: 3, a: 2 });
}
const notStarted = quoteCoupon({ coupon: { ...coupon, startsAt: new Date(Date.now() + 1) }, audience: "B2C", now: new Date(), customerUsageCount: 0, lines: [] });
assert.equal(notStarted.valid, false);
if (!notStarted.valid) assert.equal(notStarted.reason, "NOT_STARTED");

for (const [audience, restrictedCoupon] of [
  ["B2B", { ...coupon, freeShipping: true, includeProductIds: ["included-elsewhere"], excludeProductIds: [] }],
  ["B2C", { ...coupon, freeShipping: true, includeProductIds: [], excludeProductIds: ["blocked"] }],
] satisfies Array<["B2B" | "B2C", CouponPolicy]>) {
  const restricted = quoteCoupon({
    coupon: restrictedCoupon,
    audience,
    now: new Date(),
    customerUsageCount: 0,
    lines: [{ id: "restricted", productId: "blocked", bundleId: null, categoryIds: [], amountRsd: 1_000 }],
  });
  assert.equal(restricted.valid, false);
  if (!restricted.valid) assert.equal(restricted.reason, "APPLICABILITY");
}