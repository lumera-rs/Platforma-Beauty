---
name: Canonical availability ordering
description: Consistency rule for availability-derived marketplace ranking and pagination.
---

When a marketplace list sorts by live availability, the global database ordering key and the availability value serialized on each returned card must come from the same canonical calculation. Never sort only the fetched page or recompute card availability with a shorter horizon or weaker staffing rules.

**Why:** Two individually plausible availability algorithms can silently disagree, causing a salon to rank ahead of another while advertising a later slot or no slot. Page-local sorting also breaks stable pagination.

**How to apply:** Derive the availability key before `LIMIT/OFFSET`, use a deterministic ID tie-breaker, and serialize that same derived key on the card. Keep live availability uncached after the request; coalescing concurrent reads is safe.