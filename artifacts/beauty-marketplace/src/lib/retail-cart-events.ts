export const RETAIL_CART_CHANGED_EVENT = "lumera:retail-cart-changed";
export const RETAIL_CART_SYNC_STORAGE_KEY = "lumera:retail-cart-sync";
export const RETAIL_CART_CROSS_TAB_ANNOUNCEMENT_DELAY_MS = 250;

export type RetailCartChangedDetail = {
  itemCount: number;
  changedItem?: {
    productId?: string;
    name: string;
    quantity: number | null;
  };
};

export type RetailCartLineForChange = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
};

export function changedRetailCartItem(
  previousItems: readonly RetailCartLineForChange[],
  latestItems: readonly RetailCartLineForChange[],
): RetailCartChangedDetail["changedItem"] | undefined {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const latestById = new Map(latestItems.map((item) => [item.id, item]));
  const changedIds = [...new Set([...previousById.keys(), ...latestById.keys()])].filter((id) => {
    const previous = previousById.get(id);
    const latest = latestById.get(id);
    return !previous || !latest
      || previous.productId !== latest.productId
      || previous.quantity !== latest.quantity;
  });
  if (changedIds.length !== 1) return undefined;

  const id = changedIds[0]!;
  const previous = previousById.get(id);
  const latest = latestById.get(id);
  return {
    name: latest?.name ?? previous!.name,
    productId: latest?.productId ?? previous!.productId,
    quantity: latest?.quantity ?? null,
  };
}

function changedItemKey(changedItem: NonNullable<RetailCartChangedDetail["changedItem"]>) {
  return changedItem.productId ?? `name:${changedItem.name}`;
}

export function coalesceRetailCartChanges(
  changes: readonly RetailCartChangedDetail[],
): RetailCartChangedDetail | undefined {
  const latest = changes.at(-1);
  if (!latest) return undefined;

  const firstChangedItem = changes[0]?.changedItem;
  const canKeepItemAnnouncement = firstChangedItem
    && changes.every((change) => change.changedItem
      && changedItemKey(change.changedItem) === changedItemKey(firstChangedItem));

  return {
    itemCount: latest.itemCount,
    ...(canKeepItemAnnouncement && latest.changedItem
      ? { changedItem: latest.changedItem }
      : {}),
  };
}

export function notifyRetailCartChanged(
  itemCount: number,
  changedItem?: RetailCartChangedDetail["changedItem"],
) {
  const detail: RetailCartChangedDetail = {
    itemCount,
    ...(changedItem ? { changedItem } : {}),
  };
  window.dispatchEvent(new CustomEvent<RetailCartChangedDetail>(RETAIL_CART_CHANGED_EVENT, { detail }));
  try {
    // Keep the changed line with the cross-tab signal so another tab can
    // announce more than just the refreshed total.
    window.localStorage.setItem(RETAIL_CART_SYNC_STORAGE_KEY, JSON.stringify({
      ...detail,
      nonce: `${Date.now()}-${Math.random()}`,
    }));
  } catch {
    // Private browsing can disable storage; same-tab updates still use the custom event.
  }
}