---
name: Admin aggregate scan budgets
description: How dashboard aggregate optimizations must protect database work as well as query round trips.
---

**Rule:** Reduce dashboard aggregate round trips only when every growing source relation is still aggregated in one scan; measure both statement count and per-relation plan scans.

**Why:** A single statement made from independent scalar subqueries can issue fewer client/server commands while forcing PostgreSQL to rescan the same large table for every metric, making the dashboard slower as data grows.

**How to apply:** Group same-table conditional counts, sums, minima, and booleans in one CTE or derived aggregate. For performance regressions, combine a realistic fixture and latency budget with `EXPLAIN (FORMAT JSON)` coverage that verifies each aggregate relation appears once.