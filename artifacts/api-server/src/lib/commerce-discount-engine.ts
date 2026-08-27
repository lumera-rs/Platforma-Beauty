/**
 * Pure, market-agnostic discount stacking policy. Callers provide the final
 * line amount and every discount fact which contributed to that amount.
 */
export type CommerceDiscountKind = "SALE" | "TIER" | "BUNDLE" | "COUPON" | "LOYALTY" | (string & {});

export type CommerceDiscount = {
  kind: CommerceDiscountKind;
  amountRsd: number;
};

export type CommerceDiscountLineInput = {
  id: string;
  amountRsd: number;
  discounts?: readonly CommerceDiscount[];
};

export type CommerceDiscountPolicy = {
  blocksReferral(discount: Readonly<CommerceDiscount>): boolean;
};

const positiveDiscountBlocksReferral: CommerceDiscountPolicy = {
  blocksReferral: (discount) => discount.amountRsd > 0,
};

/** Public registry so another discount family can install a stricter policy. */
export const commerceDiscountPolicyRegistry = new Map<string, CommerceDiscountPolicy>([
  ["SALE", positiveDiscountBlocksReferral],
  ["TIER", positiveDiscountBlocksReferral],
  ["BUNDLE", positiveDiscountBlocksReferral],
  ["COUPON", positiveDiscountBlocksReferral],
  ["LOYALTY", positiveDiscountBlocksReferral],
]);

export function registerCommerceDiscountPolicy(kind: string, policy: CommerceDiscountPolicy): () => void {
  const normalizedKind = normalizeKind(kind);
  const previous = commerceDiscountPolicyRegistry.get(normalizedKind);
  commerceDiscountPolicyRegistry.set(normalizedKind, policy);
  return () => {
    if (previous) commerceDiscountPolicyRegistry.set(normalizedKind, previous);
    else commerceDiscountPolicyRegistry.delete(normalizedKind);
  };
}

function normalizeKind(kind: string) {
  const normalized = kind.trim().toUpperCase();
  if (!normalized) throw new Error("Discount kind is required.");
  return normalized;
}

function safeRsd(value: number, field: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be an integer RSD amount.`);
  return value;
}

export function normalizeCommerceDiscountLine(input: CommerceDiscountLineInput) {
  const amountRsd = safeRsd(input.amountRsd, "Line amount");
  if (amountRsd < 0) throw new Error("Line amount cannot be negative.");
  if (!input.id) throw new Error("Line id is required.");
  return {
    id: input.id,
    amountRsd,
    discounts: (input.discounts ?? []).map((discount) => ({
      kind: normalizeKind(discount.kind),
      amountRsd: safeRsd(discount.amountRsd, "Discount amount"),
    })),
  };
}

export function quoteCommerceReferralBase(lines: readonly CommerceDiscountLineInput[]) {
  const normalizedLines = lines.map(normalizeCommerceDiscountLine);
  const decisions = normalizedLines.map((line) => {
    const blockingDiscounts = line.discounts.filter((discount) => {
      // Unknown positive discounts fail closed. This makes adding a new
      // promotion safe before its explicit stacking policy is registered.
      const policy = commerceDiscountPolicyRegistry.get(discount.kind) ?? positiveDiscountBlocksReferral;
      return policy.blocksReferral(discount);
    });
    const referralEligible = blockingDiscounts.length === 0;
    return {
      id: line.id,
      amountRsd: line.amountRsd,
      referralEligible,
      referralBaseRsd: referralEligible ? line.amountRsd : 0,
      blockingDiscounts,
    };
  });
  return {
    lines: decisions,
    referralBaseRsd: decisions.reduce((sum, line) => sum + line.referralBaseRsd, 0),
  };
}

export function commerceDiscountsForPricedLine(input: {
  priceSource: string;
  lineDiscountRsd?: number;
  couponAllocationRsd?: number;
  loyaltyDiscountRsd?: number;
  additionalDiscounts?: readonly CommerceDiscount[];
}): CommerceDiscount[] {
  const discounts: CommerceDiscount[] = [...(input.additionalDiscounts ?? [])];
  const source = normalizeKind(input.priceSource);
  if (source !== "FULL_PRICE") {
    // Bundle prices do not necessarily expose a list-price delta, but the
    // bundle promotion itself is still a positive discount family.
    const sourceAmount = source === "BUNDLE"
      ? Math.max(1, input.lineDiscountRsd ?? 0)
      : input.lineDiscountRsd ?? 0;
    discounts.push({ kind: source, amountRsd: sourceAmount });
  }
  if ((input.couponAllocationRsd ?? 0) !== 0) {
    discounts.push({ kind: "COUPON", amountRsd: input.couponAllocationRsd! });
  }
  if ((input.loyaltyDiscountRsd ?? 0) !== 0) {
    discounts.push({ kind: "LOYALTY", amountRsd: input.loyaltyDiscountRsd! });
  }
  return discounts;
}