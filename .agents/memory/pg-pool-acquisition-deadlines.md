---
name: pg-pool acquisition deadlines
description: How pg-pool acquisition deadlines and application-side checkout queues behave under load and shutdown.
---

Treat `connectionTimeoutMillis` as a deadline for acquiring any pooled client, including an already-open client that is still busy.

**Why:** Under bursty booking traffic, a saturated fixed-size pool returned acquisition-timeout errors even though requests could complete when allowed to remain queued. The name suggests connection establishment only, which hides this failure mode.

**How to apply:** Measure peak waiting and end-to-end latency under the real process topology. Keep acquisition time below the outer request deadline but above the proven healthy queue duration. Do not raise pool size without a database connection budget; use admission control or query reduction when queue growth itself violates the latency SLO.

If application code places its own permit queue in front of `Pool.connect()`, that queue must enter a closing state and reject every pending waiter before `Pool.end()` runs.

**Why:** `pg-pool` cannot drain or reject acquisitions it has never received. Without explicit local cancellation, shutdown can leave scheduler work pending until the process is force-killed.

**How to apply:** Make both promise and callback checkout paths observe the same close signal, release permits idempotently, and test shutdown while local waiters are queued and physical clients are still checked out.