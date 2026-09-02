---
name: Terminal detail query deduplication
description: Prevent duplicate public-detail calls after final client errors when metadata and page queries overlap.
---

When a global metadata loader and an auth-gated detail view consume the same public resource, they must share the query key and honor terminal non-retryable errors already stored in the cache. The detail view must not transition from disabled to enabled and refetch a known final 4xx result.

**Why:** A metadata request can finish before the user-dependent detail observer is enabled. React Query treats error results as stale, so that later enabled transition otherwise starts another request even when retry policy correctly rejects 404 retries.

**How to apply:** Use one client cache/query key for metadata and visible detail data; return cached data or a terminal error before issuing metadata fetches. Gate the detail query on a cached non-retryable error while preserving bounded retries for network failures, 5xx, and explicitly transient HTTP statuses.