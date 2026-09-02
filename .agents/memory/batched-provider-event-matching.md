---
name: Batched provider event matching
description: Preserve per-delivery event ordering when batching provider webhooks.
---

Set-based provider webhook processing must preserve the input order of state-changing events for each individual delivery. It can batch only events that belong to independent deliveries.

**Why:** A global event-kind order can silently change the winning timestamp or terminal state for a delivery when a mixed batch interleaves events for several deliveries.

**How to apply:** Before optimizing a webhook batch, identify the state transitions that depend on prior events for the same delivery. Retain that local order and batch only transitions that cannot influence one another. Test an interleaved mixed-key sequence where a global grouping would reverse one delivery’s local order.
