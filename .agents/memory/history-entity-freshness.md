---
name: URL-selected entity freshness
description: Mutable records selected by a shared URL need fresh validation on both initial deep links and browser-history restores.
---

When a URL selects a mutable record, an ID found in a client cache is not enough
to reopen its detail view during an initial deep link or Back/Forward.
Revalidate cached matches against a fresh server list first; IDs already absent
from the cache can retain the immediate safe fallback.

**Why:** A record can be deleted in another tab while its old ID remains in a
mounted page's cache. Reopening it produces a stale or failing detail dialog,
while indiscriminate asynchronous validation can race native history traversal.

**How to apply:** Treat every URL-selected record as provisional, cancel or
disregard outdated validation results when the selected ID changes, and only
reopen after the fresh result still contains that ID. Clean the stale selection
without discarding unrelated query state. Track validation by selection version
rather than a global in-flight flag, so an aborted or superseded request cannot
block a later URL selection from validating.