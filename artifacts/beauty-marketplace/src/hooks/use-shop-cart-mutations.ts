import { useQueryClient } from "@tanstack/react-query";
import {
  getGetShopCartQueryKey,
  getGetShopCheckoutPreviewQueryKey,
  getGetShopSummaryQueryKey,
  useAddShopCartItem,
  useRemoveShopCartItem,
  useUpdateShopCartItem,
} from "@workspace/api-client-react";
import type { Product, ShopCart, ShopCartItemInput, ShopSummary } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Recomputes the derived cart totals from its items so an optimistic patch keeps
 * the summary numbers consistent with the item list until the server reconciles.
 */
function recomputeCart(cart: ShopCart): ShopCart {
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return { ...cart, itemCount, subtotal };
}

type CartMutationContext = {
  previousCart?: ShopCart;
  previousSummary?: ShopSummary;
};

type AddCartMutationVariables = {
  data: ShopCartItemInput;
  optimisticProduct?: Product;
};

/**
 * Centralizes the B2B cart mutations (add / update quantity / remove) with
 * TanStack Query optimistic updates, rollback on failure, and final
 * reconciliation against the server-returned cart. The cart badge (cart query)
 * and loyalty summary (summary query) are patched together so the header count
 * reflects the change immediately. Checkout/financial mutations are intentionally
 * excluded — those must never be optimistic.
 */
export function useShopCartMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cartKey = getGetShopCartQueryKey();
  const summaryKey = getGetShopSummaryQueryKey();
  const previewKey = getGetShopCheckoutPreviewQueryKey();

  const snapshot = async (): Promise<CartMutationContext> => {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: cartKey }),
      queryClient.cancelQueries({ queryKey: summaryKey }),
    ]);
    return {
      previousCart: queryClient.getQueryData<ShopCart>(cartKey),
      previousSummary: queryClient.getQueryData<ShopSummary>(summaryKey),
    };
  };

  const rollback = (context?: CartMutationContext) => {
    if (context?.previousCart !== undefined) queryClient.setQueryData(cartKey, context.previousCart);
    if (context?.previousSummary !== undefined) queryClient.setQueryData(summaryKey, context.previousSummary);
  };

  const patchSummaryCartCount = (delta: number) => {
    queryClient.setQueryData<ShopSummary>(summaryKey, (current) =>
      current ? { ...current, cartCount: Math.max(0, current.cartCount + delta) } : current,
    );
  };

  const reconcile = (cart?: ShopCart) => {
    if (cart) {
      queryClient.setQueryData(cartKey, cart);
      queryClient.setQueryData<ShopSummary>(summaryKey, (current) =>
        current ? { ...current, cartCount: cart.itemCount } : current,
      );
    }
    queryClient.invalidateQueries({ queryKey: cartKey });
    queryClient.invalidateQueries({ queryKey: summaryKey });
    queryClient.invalidateQueries({ queryKey: previewKey });
  };

  const addItemMutation = useAddShopCartItem({
    mutation: {
      onMutate: async (variables) => {
        const context = await snapshot();
        const { data, optimisticProduct } = variables as AddCartMutationVariables;
        const quantity = data.quantity ?? 1;

        if (optimisticProduct) {
          queryClient.setQueryData<ShopCart>(cartKey, (current) => {
            if (!current) return current;

            const variant = optimisticProduct.variants?.find((item) => item.value === data.variantValue);
            const existing = current.items.find(
              (item) =>
                item.productId === data.productId &&
                (item.variantValue ?? null) === (data.variantValue ?? null),
            );

            if (existing) {
              const items = current.items.map((item) =>
                item.id === existing.id
                  ? {
                      ...item,
                      quantity: item.quantity + quantity,
                      lineTotal: item.unitPrice * (item.quantity + quantity),
                    }
                  : item,
              );
              return recomputeCart({ ...current, items });
            }

            const basePrice = optimisticProduct.discountPrice ?? optimisticProduct.price;
            const unitPrice = variant?.price ?? (basePrice + (variant?.priceAdjust ?? 0));
            const items = [
              ...current.items,
              {
                id: `optimistic:${optimisticProduct.id}:${data.variantValue ?? "default"}`,
                productId: optimisticProduct.id,
                productName: optimisticProduct.name,
                productImageUrl: optimisticProduct.images[0] || optimisticProduct.imageUrl,
                variantValue: data.variantValue ?? null,
                variantLabel: variant?.label ?? null,
                productSku: variant?.sku ?? optimisticProduct.sku,
                unitPrice,
                quantity,
                lineTotal: unitPrice * quantity,
                availableStock: variant?.stock ?? optimisticProduct.stock,
              },
            ];
            return recomputeCart({ ...current, items });
          });
        }

        patchSummaryCartCount(quantity);
        return context;
      },
      onError: (_error, _variables, context) => {
        rollback(context);
        toast.error("Dodavanje u korpu nije uspelo.", {
          description: "Korpa je vraćena na prethodno stanje. Pokušajte ponovo.",
        });
      },
      onSuccess: () => toast.success("Dodato u korpu"),
      onSettled: (cart) => reconcile(cart),
    },
  });

  const addItem = {
    ...addItemMutation,
    mutate: (
      variables: AddCartMutationVariables,
      options?: Parameters<typeof addItemMutation.mutate>[1],
    ) => addItemMutation.mutate(variables, options),
    mutateAsync: (
      variables: AddCartMutationVariables,
      options?: Parameters<typeof addItemMutation.mutateAsync>[1],
    ) => addItemMutation.mutateAsync(variables, options),
  };

  const updateItem = useUpdateShopCartItem({
    mutation: {
      onMutate: async ({ cartItemId, data }) => {
        const context = await snapshot();
        queryClient.setQueryData<ShopCart>(cartKey, (current) => {
          if (!current) return current;
          const items = current.items.map((item) =>
            item.id === cartItemId
              ? { ...item, quantity: data.quantity, lineTotal: item.unitPrice * data.quantity }
              : item,
          );
          return recomputeCart({ ...current, items });
        });
        const updated = queryClient.getQueryData<ShopCart>(cartKey);
        if (updated) patchSummaryCartCount(updated.itemCount - (context.previousCart?.itemCount ?? updated.itemCount));
        return context;
      },
      onError: (_error, _variables, context) => {
        rollback(context);
        toast.error("Nije uspelo ažuriranje količine.");
      },
      onSettled: (cart) => reconcile(cart),
    },
  });

  const removeItem = useRemoveShopCartItem({
    mutation: {
      onMutate: async ({ cartItemId }) => {
        const context = await snapshot();
        queryClient.setQueryData<ShopCart>(cartKey, (current) => {
          if (!current) return current;
          return recomputeCart({ ...current, items: current.items.filter((item) => item.id !== cartItemId) });
        });
        const removed = context.previousCart?.items.find((item) => item.id === cartItemId);
        if (removed) patchSummaryCartCount(-removed.quantity);
        return context;
      },
      onError: (_error, _variables, context) => {
        rollback(context);
        toast.error("Nije uspelo uklanjanje stavke.");
      },
      onSettled: (cart) => reconcile(cart),
    },
  });

  return { addItem, updateItem, removeItem };
}
