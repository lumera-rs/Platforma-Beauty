---
name: Compare-window attribution parity
description: compare=previous aggregates must reuse the exact current-window attribution join or trends lie.
---

The campaign stats endpoints (overview and per-rule) compute a `previous` block for compare=previous. These aggregations were once four near-identical copies; they now flow through shared run/delivery aggregation helpers parameterized by scope (all rules vs one rule) and window, with the previous window expressed as a plain `{start, end}` window.

**Rule:** attribution semantics (which appointment statuses are excluded, which fields are aggregated) must live in the shared aggregation helpers — never re-inline a per-endpoint or per-window copy. Note the drill-down attributed-appointments list still carries its own copy of the excluded-status list; changes to realized-status semantics must touch it too.

**Why:** the previous-window join once drifted to excluding only cancelled appointments while the current window excluded cancelled *and* no-show — trend arrows then compared unlike quantities and could point the wrong way.

**How to apply:** when touching the attribution join or adding a trended metric in the growth stats routes, change the shared helpers and grep for any remaining inline status lists (e.g. the drill-down list endpoint); the compare=previous sections of the provider-events test pin the parity.
