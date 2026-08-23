export const RETAIL_CART_CHANGED_EVENT = "lumera:retail-cart-changed";
export const RETAIL_CART_SYNC_STORAGE_KEY = "lumera:retail-cart-sync";

export function notifyRetailCartChanged() {
  window.dispatchEvent(new Event(RETAIL_CART_CHANGED_EVENT));
  try {
    window.localStorage.setItem(RETAIL_CART_SYNC_STORAGE_KEY, `${Date.now()}-${Math.random()}`);
  } catch {
    // Private browsing can disable storage; same-tab updates still use the custom event.
  }
}