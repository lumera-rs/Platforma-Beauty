---
name: Multi-location owner billing
description: Rules for aggregating legacy per-salon loyalty and subscription records into one owner-facing account.
---

Owner-facing loyalty is account-wide: aggregate the existing location loyalty rows without moving or deleting them.

For a multi-location owner with legacy subscription rows, one explicit account rule selects the best live status; equal statuses use the highest recorded due amount and UUID only as an exact final tie-breaker. It never uses the mutable current plan price or a billing-period date.

**Why:** Historical subscriptions are location-linked for administration and audit. Selecting from changing billing-period dates or plan prices would silently change an owner’s displayed charge; keeping the highest recorded legacy due avoids undercharging.

**How to apply:** Keep operational carts, orders, stock, and schedules salon-scoped. When changing owner-facing billing, preserve all original location records and keep the stated ranking deterministic.