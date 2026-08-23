---
name: Retail cart live announcements
description: Keeping the cart badge and screen-reader status synchronized through mutations and SPA navigation.
---

Cart mutations must publish the server-confirmed item count to a single app-shell live announcer. Before that count is written into the cart-summary cache, cancel any in-flight summary query; route-local announcers are not sufficient for checkout because navigation can unmount them before the announcement is delivered.

**Why:** An older summary response can overwrite a just-confirmed mutation count, and a checkout success route replaces the page-level layout holding the header. Either case makes the audible status disagree with—or disappear before—the visual badge.

**How to apply:** Include the returned `itemCount` in same-tab cart-change events. Keep the polite live region and cache synchronization above route boundaries, use the same cache value for header badges, and reserve summary refetches for focus, visibility, and cross-tab changes.