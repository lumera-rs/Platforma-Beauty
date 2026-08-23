---
name: Automation delivery crash recovery
description: Reliability rule for idempotent email and SMS automation delivery across process crashes.
---

Only confirmed sent deliveries and intentional policy skips are terminal. Queued, failed, and stale processing claims must remain recoverable. A local lease is not enough for unknown provider outcomes: persist a stable provider key before submission, then deduplicate or query the provider by that key before any resend.

**Why:** A process can stop after claiming a delivery or after the provider accepts it but before local status is saved. Treating the claim as terminal loses the message; reclaiming locally and sending again without provider reconciliation can duplicate it.

**How to apply:** Claim deliveries with an expiring lease, let only one worker own a live claim, record when submission starts, and reuse one durable provider key. On unknown outcomes, reconcile provider status first; if lookup is unavailable, wait rather than resend blindly.