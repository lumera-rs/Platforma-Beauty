---
name: Alert fallback channels
description: How secondary alert channels (e.g. admin SMS fallback) inherit rate limiting and dedup from the primary channel's outbox.
---

# Alert fallback channels

Rule: a fallback alert channel must fire only on ticks where the primary
channel actually ATTEMPTED sends and every attempted send failed or was
intentionally skipped. Outcomes like `deduplicated`/`inProgress` are NOT
failures — a racing instance owns that delivery and evaluates its own
fallback.

Dedup/rate limiting: do not build a second cooldown store for the fallback.
The primary channel's rolling cooldown already gates when attempts happen
(cooldown-suppressed ticks attempt nothing, so the fallback is never
evaluated). For idempotency across racing instances, embed the primary
alert's per-window SEQUENCE number in the fallback's durable outbox eventKey
so duplicates collapse on the unique key.

**Why:** a separate time-based cooldown for the fallback would need its own
clock anchor (row `createdAt` diverges from injected test times) and could
double-alert across windows; reusing the primary sequence keeps both
channels in lockstep and spam-proof by construction.

**How to apply:** any new emergency/fallback notification path (SMS, push,
etc.) layered over an outbox-based alert. Platform-level (salon-less) SMS
uses the `admin_alert` message type with a NULL salonId — enum changes must
also land in the production bootstrap (version bump + label list + rollout
test) and be pushed to the development schema.
