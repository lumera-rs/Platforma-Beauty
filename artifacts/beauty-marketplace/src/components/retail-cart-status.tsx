import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRetailCartSummaryQueryKey } from "@workspace/api-client-react";
import {
  RETAIL_CART_CHANGED_EVENT,
  RETAIL_CART_SYNC_STORAGE_KEY,
  type RetailCartChangedDetail,
} from "@/lib/retail-cart-events";

function cartQuantityAnnouncement(itemCount: number) {
  return itemCount === 0
    ? "Korpa je prazna."
    : `Korpa sada ima ${itemCount} ${itemCount === 1 ? "stavku" : "stavki"}.`;
}

export function RetailCartStatus() {
  const queryClient = useQueryClient();
  const [cartAnnouncement, setCartAnnouncement] = useState("");

  useEffect(() => {
    const refreshCartSummary = () => {
      void queryClient.invalidateQueries({
        queryKey: getGetRetailCartSummaryQueryKey(),
        refetchType: "active",
      });
    };
    const onCartChanged = (event: Event) => {
      const detail = (event as CustomEvent<RetailCartChangedDetail>).detail;
      if (Number.isInteger(detail?.itemCount) && detail.itemCount >= 0) {
        const queryKey = getGetRetailCartSummaryQueryKey();
        void queryClient.cancelQueries({ queryKey }).then(() => {
          queryClient.setQueryData(queryKey, (current: { itemCount?: number } | undefined) => ({
            ...current,
            itemCount: detail.itemCount,
          }));
          setCartAnnouncement(cartQuantityAnnouncement(detail.itemCount));
        });
        return;
      }
      refreshCartSummary();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCartSummary();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === RETAIL_CART_SYNC_STORAGE_KEY) refreshCartSummary();
    };

    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(RETAIL_CART_CHANGED_EVENT, onCartChanged);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(RETAIL_CART_CHANGED_EVENT, onCartChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [queryClient]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-cart-announcement">
      {cartAnnouncement}
    </div>
  );
}