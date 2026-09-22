---
name: Terminal detail query deduplication
description: Prevent duplicate public-detail calls after final client errors when metadata and page queries overlap.
---

When a global metadata loader and an auth-gated detail view consume the same public resource, they must share the query key and honor terminal non-retryable errors already stored in the cache. The detail view must not transition from disabled to enabled and refetch a known final 4xx result.

**Why:** A metadata request can finish before the user-dependent detail observer is enabled. React Query treats error results as stale, so that later enabled transition otherwise starts another request even when retry policy correctly rejects 404 retries.

**How to apply:** Use one client cache/query key for metadata and visible detail data; return cached data or a terminal error before issuing metadata fetches. Gate the detail query on a cached non-retryable error while preserving bounded retries for network failures, 5xx, and explicitly transient HTTP statuses.

For separately lazy-loaded metadata and page components, let the visible detail observer own the request instead of metadata prefetching before that observer mounts. Preserve the generated client's error contract when sharing its cache.

**Why:** Sharing a key alone does not prevent duplicates when the later visible observer intentionally refetches on mount. A metadata-created plain Error can also turn a cached terminal 404 into the page's transient-error presentation. Once the visible observer owns the request, navigating away may abort it legitimately.

**How to apply:** Resolve metadata from the active current observer's settled DTO/error, excluding placeholder and obsolete query results. Navigation tests must observe obsolete request completion or cancellation rather than require an HTTP response after an abort; retain a separate delayed-result assertion that obsolete work cannot restore old structured data.