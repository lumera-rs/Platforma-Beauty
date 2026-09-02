---
name: Index-first exact searches
description: How to keep exact child-record lookups index-driven when a shared search box also supports broad parent-record text matching.
---

**Rule:** Route canonical exact terms through a separate query that begins at the indexed relation. Do not hide the exact lookup inside an `OR` with unindexed contains predicates over a growing parent table.

**Why:** An index can appear in an `EXPLAIN` subplan while PostgreSQL still scans the full parent relation to evaluate the surrounding `OR`. Disabling sequential scans in a regression can mask that scalability failure.

**How to apply:** Preserve broad contains semantics in a separate branch. Validate exact-search plans with normal planner settings and realistic relation cardinality, asserting both use of the intended index and absence of sequential scans on growing relations. Build new production indexes concurrently when writes must remain available.