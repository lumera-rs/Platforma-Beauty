export const RETAIL_CART_CHANGED_EVENT = "lumera:retail-cart-changed";
export const RETAIL_CART_SYNC_STORAGE_KEY = "lumera:retail-cart-sync";

export type RetailCartChangedDetail = {
  itemCount: number;
  changedItem?: {
    name: string;
    quantity: number | null;
  };
};

export function notifyRetailCartChanged(
  itemCount: number,
  changedItem?: RetailCartChangedDetail["changedItem"],
) {
  window.dispatchEvent(new CustomEvent<RetailCartChangedDetail>(RETAIL_CART_CHANGED_EVENT, {
    detail: { itemCount, ...(changedItem ? { changedItem } : {}) },
  }));
  try {
    window.localStorage.setItem(RETAIL_CART_SYNC_STORAGE_KEY, `${Date.now()}-${Math.random()}`);
  } catch {
    // Private browsing can disable storage; same-tab updates still use the custom event.
  }
}