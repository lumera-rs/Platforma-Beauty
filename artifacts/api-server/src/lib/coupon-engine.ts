/**
 * Pure, integer-RSD coupon quoting.  Database locking and redemption are kept
 * at the checkout boundary; this module deliberately has no database imports
 * so preview and locked checkout use exactly the same commercial arithmetic.
 */
export type CouponReason =
  | "INVALID" | "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "SPEND_BOUND"
  | "APPLICABILITY" | "TOTAL_LIMIT" | "CUSTOMER_LIMIT";

export type CouponPolicy = {
  code: string; active: boolean; audience: "B2B" | "B2C" | null;
  discountType: "PERCENTAGE" | "FIXED_RSD"; discountValue: number;
  startsAt: Date | null; endsAt: Date | null; minimumSpendRsd: number;
  maximumSpendRsd: number | null; freeShipping: boolean;
  includeProductIds: string[]; excludeProductIds: string[];
  includeCategoryIds: string[]; excludeCategoryIds: string[];
  includeBundleIds: string[]; excludeBundleIds: string[];
  usageLimit: number | null; usageCount: number; perCustomerUsageLimit: number | null;
};

export type CouponLine = {
  id: string; productId: string | null; bundleId: string | null;
  categoryIds: string[]; amountRsd: number;
};

export type CouponQuote = {
  valid: true; code: string; discountRsd: number; freeShipping: boolean;
  allocations: Record<string, number>; eligibleSubtotalRsd: number;
} | { valid: false; reason: CouponReason };

const includes = (values: string[], value: string | null) => Boolean(value && values.includes(value));
const categoryIncludes = (values: string[], categories: string[]) => categories.some((id) => values.includes(id));

/** Exclusions win. Bundles require an explicit bundle inclusion. */
function eligible(policy: CouponPolicy, line: CouponLine): boolean {
  if (includes(policy.excludeProductIds, line.productId) || includes(policy.excludeBundleIds, line.bundleId)
    || categoryIncludes(policy.excludeCategoryIds, line.categoryIds)) return false;
  if (line.bundleId) return policy.includeBundleIds.includes(line.bundleId);
  const hasIncludes = policy.includeProductIds.length || policy.includeCategoryIds.length;
  return !hasIncludes || includes(policy.includeProductIds, line.productId) || categoryIncludes(policy.includeCategoryIds, line.categoryIds);
}

/** Largest remainder allocation is deterministic by stable line id. */
function allocateFixed(lines: CouponLine[], discount: number): Record<string, number> {
  const total = lines.reduce((sum, line) => sum + line.amountRsd, 0);
  const capped = Math.min(discount, total);
  const allocations: Record<string, number> = {};
  let assigned = 0;
  const remainders = lines.map((line) => {
    const numerator = capped * line.amountRsd;
    const floor = Math.floor(numerator / total);
    allocations[line.id] = floor; assigned += floor;
    return { id: line.id, remainder: numerator % total };
  }).sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let index = 0; index < capped - assigned; index++) allocations[remainders[index]!.id]++;
  return allocations;
}

export function quoteCoupon(input: {
  coupon: CouponPolicy | null; audience: "B2B" | "B2C"; lines: CouponLine[];
  now: Date; customerUsageCount: number;
}): CouponQuote {
  const { coupon, audience, lines, now, customerUsageCount } = input;
  if (!coupon) return { valid: false, reason: "INVALID" };
  if (!coupon.active || (coupon.audience && coupon.audience !== audience)) return { valid: false, reason: "INACTIVE" };
  if (coupon.startsAt && now < coupon.startsAt) return { valid: false, reason: "NOT_STARTED" };
  if (coupon.endsAt && now >= coupon.endsAt) return { valid: false, reason: "EXPIRED" };
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) return { valid: false, reason: "TOTAL_LIMIT" };
  if (coupon.perCustomerUsageLimit !== null && customerUsageCount >= coupon.perCustomerUsageLimit) return { valid: false, reason: "CUSTOMER_LIMIT" };
  const subtotal = lines.reduce((sum, line) => sum + line.amountRsd, 0);
  if (subtotal < coupon.minimumSpendRsd || (coupon.maximumSpendRsd !== null && subtotal > coupon.maximumSpendRsd)) return { valid: false, reason: "SPEND_BOUND" };
  const eligibleLines = lines.filter((line) => eligible(coupon, line));
  if (!eligibleLines.length) return { valid: false, reason: "APPLICABILITY" };
  const eligibleSubtotalRsd = eligibleLines.reduce((sum, line) => sum + line.amountRsd, 0);
  // Calculate the percentage on the eligible aggregate then use the same
  // largest-remainder allocator as fixed RSD discounts. This prevents
  // per-line flooring from leaking or creating a rounding drift.
  const allocations = eligibleSubtotalRsd === 0 ? {} : coupon.discountType === "PERCENTAGE"
    ? allocateFixed(eligibleLines, Math.floor(eligibleSubtotalRsd * coupon.discountValue / 100))
    : allocateFixed(eligibleLines, coupon.discountValue);
  const discountRsd = Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
  return { valid: true, code: coupon.code, discountRsd, freeShipping: coupon.freeShipping, allocations, eligibleSubtotalRsd };
}