import {
  getGetShopCartQueryKey,
  getGetShopSummaryQueryKey,
  type Product,
  type ShopCart,
  type ShopCartItem,
  type ShopSummary,
} from "@workspace/api-client-react";
import type { QueryClient } from "@tanstack/react-query";
import {
  rollbackQueries,
  type QuerySnapshot,
  updateQueryOptimistically,
} from "./optimistic-query";

const EMPTY_CART: ShopCart = {
  id: null,
  items: [],
  savedItems: [],
  itemCount: 0,
  subtotal: 0,
  referralCreditMerchandiseSubtotalRsd: 0,
  totalWeightGrams: 0,
  crossSellProducts: [],
  freeShippingProgress: {
    threshold: 0,
    subtotal: 0,
    remaining: 0,
    qualifies: false,
    loyaltyFreeShipping: false,
  },
  estimatedDeliveryDate: "",
  showLoyaltyPoints: false,
  currentLoyaltyPoints: 0,
  projectedLoyaltyPoints: 0,
};

function withCartTotals(cart: ShopCart, items: ShopCartItem[]): ShopCart {
  return {
    ...cart,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    totalWeightGrams: items.reduce((sum, item) => sum + item.weightGrams * item.quantity, 0),
  };
}

export function addOptimisticCartItem(
  current: ShopCart | undefined,
  product: Product,
  variantValue?: string,
): ShopCart {
  const cart = current ?? EMPTY_CART;
  const existingIndex = cart.items.findIndex(
    (item) => item.kind === 'product' && item.productId === product.id && (item.variantValue ?? undefined) === variantValue,
  );
  const variant = product.variants?.find((item) => item.value === variantValue);
  const unitPrice = variant?.price ?? ((product.discountPrice ?? product.price) + (variant?.priceAdjust ?? 0));

  if (existingIndex >= 0) {
    const items = cart.items.map((item, index) => index === existingIndex
      ? { ...item, quantity: item.quantity + 1, lineTotal: item.lineTotal + item.unitPrice }
      : item);
    return withCartTotals(cart, items);
  }

  const item: ShopCartItem = {
    id: `optimistic:${product.id}:${variantValue ?? "base"}`,
    kind: 'product' as const,
    productId: product.id,
    productName: product.name,
    productImageUrl: product.images[0] ?? product.imageUrl,
    variantValue: variantValue ?? null,
    variantLabel: variant?.label ?? null,
    productSku: variant?.sku ?? product.sku,
    unitPrice,
    quantity: 1,
    lineTotal: unitPrice,
    availableStock: variant?.stock ?? product.stock,
    weightGrams: product.weightGrams ?? 0,
    lowStock: false,
  };
  return withCartTotals(cart, [...cart.items, item]);
}

export function updateOptimisticCartQuantity(
  current: ShopCart | undefined,
  cartItemId: string,
  quantity: number,
): ShopCart | undefined {
  if (!current) return current;
  return withCartTotals(current, current.items.map((item) => item.id === cartItemId
    ? { ...item, quantity, lineTotal: item.unitPrice * quantity }
    : item));
}

export function removeOptimisticCartItem(
  current: ShopCart | undefined,
  cartItemId: string,
): ShopCart | undefined {
  if (!current) return current;
  return withCartTotals(current, current.items.filter((item) => item.id !== cartItemId));
}

export async function updateCartAndSummaryOptimistically(
  queryClient: QueryClient,
  update: (current: ShopCart | undefined) => ShopCart | undefined,
): Promise<QuerySnapshot<unknown>[]> {
  const snapshots: QuerySnapshot<unknown>[] = [];
  try {
    snapshots.push(await updateQueryOptimistically<ShopCart>(
      queryClient,
      getGetShopCartQueryKey(),
      update,
    ));
    const optimisticCount = queryClient.getQueryData<ShopCart>(getGetShopCartQueryKey())?.itemCount;
    snapshots.push(await updateQueryOptimistically<ShopSummary>(
      queryClient,
      getGetShopSummaryQueryKey(),
      (current) => current && optimisticCount !== undefined
        ? { ...current, cartCount: optimisticCount }
        : current,
    ));
    return snapshots;
  } catch (error) {
    rollbackQueries(queryClient, snapshots);
    throw error;
  }
}