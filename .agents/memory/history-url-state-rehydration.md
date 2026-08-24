---
name: History URL state rehydration
description: Query-backed page state must fully rehydrate when browser history changes without remounting the page.
---

When a page mirrors query parameters into local React state, its search-string
change handler must restore every query-backed field before the URL mirror
effect runs. The mirror should skip the incoming history render, then serialize
the restored state without overwriting the URL with stale local values.

**Why:** Browser Back/Forward changes the URL while the page stays mounted.
Restoring only some fields can leave the visible view and its dependent
requests on a different window than the URL describes.

**How to apply:** Subscribe with the router's query-string hook, parse the
complete incoming selection in one effect, update all dependent state fields,
and coordinate a one-render mirror skip. Add history coverage for each state
shape and assert unrelated query parameters survive.