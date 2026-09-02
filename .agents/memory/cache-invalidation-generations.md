---
name: Cache invalidation generations
description: Preventing stale in-flight cache loads from undoing a later invalidation.
---

Cache invalidation must advance a namespace generation and detach matching pending loads. A loader may populate the cache only if its captured generation and pending-load identity are still current.

**Why:** Evicting completed entries alone leaves a race: a load started before invalidation can finish afterward, repopulate stale data for the full TTL, and be reused by callers that arrived after the invalidation.

**How to apply:** For every cache with request coalescing, treat invalidation as both entry eviction and pending-load cancellation by identity. Add a deterministic test that pauses an old loader, invalidates, completes a fresh load, then proves the old result cannot overwrite it.