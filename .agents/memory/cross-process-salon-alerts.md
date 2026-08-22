---
name: Cross-process salon alerts
description: Durable delivery rules for realtime salon-owner notification invalidation across API instances.
---

Treat PostgreSQL notification broadcasts as non-durable wakeups, never as the source of notification data.

**Why:** Realtime invalidations must cross API instances, but listeners can disconnect and PostgreSQL does not retain missed notifications. The persisted salon notification list is authoritative.

**How to apply:** Publish compact salon-scoped invalidations only after commit, keep listener reconnects isolated from HTTP startup, refetch through authenticated salon endpoints, and retain browser reconnect rehydration plus polling.