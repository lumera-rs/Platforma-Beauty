---
name: pg-pool acquisition deadlines
description: How pg-pool connection timeouts behave under saturated application traffic.
---

Treat `connectionTimeoutMillis` as a deadline for acquiring any pooled client, including an already-open client that is still busy.

**Why:** Under bursty booking traffic, a saturated fixed-size pool returned acquisition-timeout errors even though requests could complete when allowed to remain queued. The name suggests connection establishment only, which hides this failure mode.

**How to apply:** Measure peak waiting and end-to-end latency under the real process topology. Keep acquisition time below the outer request deadline but above the proven healthy queue duration. Do not raise pool size without a database connection budget; use admission control or query reduction when queue growth itself violates the latency SLO.