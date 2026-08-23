---
name: SPA unsaved-navigation guard
description: Why leave-page guards cannot live inside the routed page component and must hook history traversal ahead of the router.
---

# SPA unsaved-navigation guard

**Rule:** an unsaved-changes guard must cover all three exits — page unload, in-app link clicks, and browser Back/Forward — and the history-traversal part cannot be a page-local listener. It must be registered before the router subscribes to history events (e.g. a module imported by the app entry), with the page merely arming/disarming it.

**Why:** the router's location store re-renders synchronously during the popstate dispatch (useSyncExternalStore). When the route changes, the page unmounts and React's effect cleanup removes the page's own popstate listener *mid-dispatch* — the browser never reaches it, so a component-level Back guard silently does nothing. Discovered when a Back press bypassed a confirmed-working link-click guard and discarded an unsaved generated secret.

**How to apply:** a guard listener that runs ahead of the router can block on confirm and, on cancel, restore the guarded URL in the same task — the router then sees an unchanged location, nothing unmounts, and unsaved form state survives. Dirty state must include every save-to-apply control (toggles mutating loaded data too), compared against a baseline captured at load and re-baselined per section only after its save succeeds. Verify Back/Forward cancel paths in a real browser; link-click tests alone give false confidence.
