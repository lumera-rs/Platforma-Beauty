---
name: Compare-window attribution parity
description: compare=previous aggregates must reuse the exact current-window attribution join or trends lie.
---

The campaign stats endpoints (overview and per-rule) compute a `previous` block for compare=previous with their own duplicate aggregation queries.

**Rule:** any change to the current-window attribution semantics (e.g. which appointment statuses are excluded from the join, or which fields are aggregated) must be applied to all previous-window queries in both endpoints in the same change.

**Why:** the previous-window join once drifted to excluding only cancelled appointments while the current window excluded cancelled *and* no-show — trend arrows then compared unlike quantities and could point the wrong way.

**How to apply:** when touching the attribution join or adding a trended metric in the growth stats routes, grep for every previous-window aggregation (both endpoints) and mirror the change; extend the compare=previous section of the provider-events test to pin the parity.
