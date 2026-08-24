---
name: History entity freshness
description: Mutable records selected by a shared URL need fresh validation when a mounted page restores browser history.
---

When a URL selects a mutable record, an ID found in a client cache is not enough
to reopen its detail view during Back/Forward. Revalidate cached matches against
a fresh server list first; IDs already absent from the cache can retain the
immediate safe fallback.

**Why:** A record can be deleted in another tab while its old ID remains in a
mounted page's cache. Reopening it produces a stale or failing detail dialog,
while indiscriminate asynchronous validation can race native history traversal.

**How to apply:** Treat the restored URL as provisional, cancel or disregard
outdated validation results when the selected ID changes, and only reopen after
the fresh result still contains that ID. Clean the stale selection without
discarding unrelated query state.