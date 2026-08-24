import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRetailCartSummaryQueryKey } from "@workspace/api-client-react";
import {
  RETAIL_CART_CHANGED_EVENT,
  RETAIL_CART_CROSS_TAB_ANNOUNCEMENT_DELAY_MS,
  RETAIL_CART_SYNC_STORAGE_KEY,
  coalesceRetailCartChanges,
  type RetailCartChangedDetail,
} from "@/lib/retail-cart-events";

function cartQuantityAnnouncement(itemCount: number) {
  return itemCount === 0
    ? "Korpa je prazna."
    : `Korpa sada ima ${itemCount} ${itemCount === 1 ? "stavku" : "stavki"}.`;
}

function cartItemAnnouncement(changedItem: NonNullable<RetailCartChangedDetail["changedItem"]>) {
  return changedItem.quantity === null
    ? `Proizvod ${changedItem.name} je uklonjen iz korpe.`
    : `Proizvod ${changedItem.name} sada ima količinu ${changedItem.quantity}.`;
}

function parseCartChange(value: string | null): RetailCartChangedDetail | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      itemCount?: unknown;
      changedItem?: { productId?: unknown; name?: unknown; quantity?: unknown } | null;
    };
    if (!Number.isInteger(parsed.itemCount) || (parsed.itemCount as number) < 0) return null;
    const changedItem = parsed.changedItem;
    if (changedItem == null) return { itemCount: parsed.itemCount as number };
    if (
      typeof changedItem.name !== "string"
      || !changedItem.name
      || (changedItem.quantity !== null
        && (!Number.isInteger(changedItem.quantity) || (changedItem.quantity as number) < 0))
    ) {
      return null;
    }
    return {
      itemCount: parsed.itemCount as number,
      changedItem: {
        ...(typeof changedItem.productId === "string" && changedItem.productId
          ? { productId: changedItem.productId }
          : {}),
        name: changedItem.name,
        quantity: changedItem.quantity as number | null,
      },
    };
  } catch {
    return null;
  }
}

export function RetailCartStatus() {
  const queryClient = useQueryClient();
  const [cartAnnouncement, setCartAnnouncement] = useState("");
  const [cartItemAnnouncementText, setCartItemAnnouncementText] = useState("");
  const pendingCrossTabChangesRef = useRef<RetailCartChangedDetail[]>([]);
  const crossTabAnnouncementTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const refreshCartSummary = () => {
      void queryClient.invalidateQueries({
        queryKey: getGetRetailCartSummaryQueryKey(),
        refetchType: "active",
      });
    };
    const announceCartChange = (detail: RetailCartChangedDetail) => {
      if (!Number.isInteger(detail?.itemCount) || detail.itemCount < 0) return false;
      const queryKey = getGetRetailCartSummaryQueryKey();
      void queryClient.cancelQueries({ queryKey }).then(() => {
        queryClient.setQueryData(queryKey, (current: { itemCount?: number } | undefined) => ({
          ...current,
          itemCount: detail.itemCount,
        }));
        setCartAnnouncement(cartQuantityAnnouncement(detail.itemCount));
        setCartItemAnnouncementText(detail.changedItem ? cartItemAnnouncement(detail.changedItem) : "");
      });
      return true;
    };
    const cancelPendingCrossTabAnnouncement = () => {
      if (crossTabAnnouncementTimerRef.current !== null) {
        window.clearTimeout(crossTabAnnouncementTimerRef.current);
        crossTabAnnouncementTimerRef.current = null;
      }
      pendingCrossTabChangesRef.current = [];
    };
    const flushPendingCrossTabAnnouncement = () => {
      crossTabAnnouncementTimerRef.current = null;
      const changes = pendingCrossTabChangesRef.current;
      pendingCrossTabChangesRef.current = [];
      const coalesced = coalesceRetailCartChanges(changes);
      if (coalesced) announceCartChange(coalesced);
    };
    const queueCrossTabAnnouncement = (detail: RetailCartChangedDetail) => {
      pendingCrossTabChangesRef.current.push(detail);
      if (crossTabAnnouncementTimerRef.current !== null) {
        window.clearTimeout(crossTabAnnouncementTimerRef.current);
      }
      crossTabAnnouncementTimerRef.current = window.setTimeout(
        flushPendingCrossTabAnnouncement,
        RETAIL_CART_CROSS_TAB_ANNOUNCEMENT_DELAY_MS,
      );
    };
    const onCartChanged = (event: Event) => {
      const detail = (event as CustomEvent<RetailCartChangedDetail>).detail;
      // A local mutation is the freshest signal for this tab and supersedes
      // any cross-tab burst that has not been spoken yet.
      cancelPendingCrossTabAnnouncement();
      if (!announceCartChange(detail)) refreshCartSummary();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCartSummary();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== RETAIL_CART_SYNC_STORAGE_KEY) return;
      const detail = parseCartChange(event.newValue);
      if (!detail) {
        cancelPendingCrossTabAnnouncement();
        refreshCartSummary();
        return;
      }
      queueCrossTabAnnouncement(detail);
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
      cancelPendingCrossTabAnnouncement();
    };
  }, [queryClient]);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-cart-announcement">
        {cartAnnouncement}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-cart-item-announcement">
        {cartItemAnnouncementText}
      </div>
    </>
  );
}