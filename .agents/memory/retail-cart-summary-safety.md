---
name: Retail cart summary safety
description: Header cart indicators must use a read-only summary route that never creates carts for passive visitors.
---

Public cart indicators must use a read-only cart-summary endpoint that returns zero without a valid cart cookie; only an explicit cart mutation may create a persistent retail cart.

**Why:** A header-mounted request to the stateful cart route turns ordinary browsing into unbounded empty-cart creation and recurrent database load.

**How to apply:** Keep passive navigation, focus refreshes, and cross-tab badge synchronization on the non-creating summary route. Use browser-local mutation events plus storage events for immediate cross-tab updates rather than frequent global polling. Cover the route with a regression test that asserts no `Set-Cookie` response and no new cart row for an anonymous request.