---
name: Compare-window attribution parity
description: compare=previous aggregates must reuse the exact current-window attribution join or trends lie.
---

**Rule:** every campaign-stats surface that aggregates a comparison window (current vs. previous, overview vs. per-rule, drill-down lists) must share ONE definition of attribution semantics — which appointment statuses count and which fields are aggregated. Never re-inline a per-endpoint or per-window copy of that logic.

**Why:** a previous-window aggregation once drifted to excluding only cancelled appointments while the current window excluded cancelled *and* no-show — trend arrows then compared unlike quantities and could point the wrong way.

**How to apply:** when touching attribution semantics or adding a trended metric, change the shared aggregation logic and grep for any remaining inline status lists across sibling endpoints; keep tests that pin current-vs-previous parity.
