---
name: Automation delivery crash recovery
description: Reliability rule for idempotent email and SMS automation delivery across process crashes.
---

Only confirmed sent deliveries and intentional policy skips are terminal. Queued, failed, and stale processing claims must remain recoverable. For event-driven notifications, create the uniquely keyed outbox row in the same database transaction as the domain event; scheduling provider delivery after commit is safe only because a crash leaves that row for the worker. A local lease is not enough for unknown provider outcomes: persist a stable provider key before submission, then deduplicate or query the provider by that key before any resend.

**Why:** A process can stop between committing the domain event and creating its outbox row, after claiming a delivery, or after the provider accepts it but before local status is saved. Non-atomic enqueue loses the message; treating the claim as terminal also loses it; reclaiming locally and sending again without provider reconciliation can duplicate it.

**How to apply:** Insert domain state, user-visible notification, and outbox row atomically. Claim committed deliveries with an expiring lease, let only one worker own a live claim, record when submission starts, and reuse one durable provider key. On unknown outcomes, reconcile provider status first; if lookup is unavailable, wait rather than resend blindly.