---
name: Wouter query-string reactivity
description: Query-driven UI (tabs, filters) must subscribe via useSearch(); useLocation() only tracks the pathname.
---

Wouter v3's `useLocation()` returns and subscribes to the **pathname only**. Navigating with `setLocation("/same-path?x=y")` while already on that path does not re-render components that only use `useLocation()`, because the snapshot (pathname) is unchanged. Reading `window.location.search` during render then silently returns stale/never-refreshed values — clicks appear to do nothing until some unrelated re-render happens.

**Why:** Customer-dashboard tabs driven by `?tab=` looked completely dead: the URL changed but the component never re-rendered. An earlier "fix" (scroll-into-view on tab change) could not fire either, since `activeTab` never changed.

**How to apply:** Any component whose UI state is driven by the query string must call `const search = useSearch()` from wouter and parse that. Effects reacting to query params should depend on that search string, not on `useLocation()`'s value. Wouter's `useSearch()` value has no leading `?`; when rebuilding a URL, use `window.location.search` or add the separator explicitly. Native `history.replaceState` also bypasses wouter — use `setLocation(url, { replace: true })` instead. For a persistent query-backed filter, also subscribe to native `popstate` and use a small version state in query parsing: browser Back can update the address without republishing Wouter's search snapshot in this setup. One-shot reads of `window.location.search` on initial mount (OAuth redirects landing on a fresh page) are fine.
