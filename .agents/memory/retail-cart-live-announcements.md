---
name: Retail cart live announcements
description: Keeping the cart badge and screen-reader status synchronized through mutations and SPA navigation.
---

Cart mutations must publish the server-confirmed item count and, when exactly one line changed, the server-confirmed line diff to a single app-shell live announcer. Before that count is written into the cart-summary cache, cancel any in-flight summary query; route-local announcers are not sufficient for checkout because navigation can unmount them before the announcement is delivered.

**Why:** An older summary response can overwrite a just-confirmed mutation count, and a checkout success route replaces the page-level layout holding the header. Count-only mutation events also clear the item-specific live region even though the visible cart line changed successfully.

**How to apply:** Diff the pre-mutation lines against the returned cart before publishing same-tab cart-change events. Include `itemCount` always and item name/quantity only for one unambiguous changed line. Normalize product and bundle identities, keep the polite live region above route boundaries, and reserve summary refetches for focus, visibility, and cross-tab changes.