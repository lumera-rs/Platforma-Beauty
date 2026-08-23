---
name: Compare-window attribution parity
description: compare=previous aggregates must reuse the exact current-window attribution join or trends lie.
---

**Rule:** every surface that aggregates campaign attribution — current window, compare/previous window, and drill-down lists — must share one definition of the attribution semantics (excluded appointment statuses, aggregated fields). Never re-inline a per-endpoint or per-window copy.

**Why:** a previous-window join once drifted to excluding only cancelled appointments while the current window also excluded no-shows — trend arrows then compared unlike quantities and could point the wrong way.

**How to apply:** when touching attribution semantics or adding a trended metric, change the shared definition and search for any remaining inline status lists across sibling endpoints before shipping.
