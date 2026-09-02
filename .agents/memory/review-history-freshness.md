---
name: Review history freshness
description: Preventing stale deleted-review UI after browser history or BFCache restoration.
---

Salon pages that show mutable public reviews and a customer's own review eligibility must revalidate both data sources whenever the route mounts and when a browser restores the page from its back-forward cache.

**Why:** Browser history can restore an earlier document and client cache without a normal reload, which can otherwise make a withdrawn review, its rating, or an edit action appear again.

**How to apply:** When changing review-related views, preserve a freshness path for the public salon profile and customer review context, and cover delete → leave → Back/Forward navigation with isolated fixture data that is always cleaned up.