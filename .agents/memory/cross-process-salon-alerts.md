---
name: Cross-process salon alerts
description: Durable delivery rules for realtime salon-owner notification invalidation across API instances.
---

Treat PostgreSQL notification broadcasts as non-durable wakeups, never as the source of notification data.

**Why:** Realtime invalidations must cross API instances, but listeners can disconnect and PostgreSQL does not retain missed notifications. The persisted salon notification list is authoritative.

For browser fault tests, avoid rewriting a streaming EventSource to another origin through Playwright routing; Chromium can block the continued request before it reaches the disposable API.

**Why:** A blocked test route looks like a listener outage and can hide whether cross-process delivery or fallback polling actually worked.

**How to apply:** Publish compact salon-scoped invalidations only after commit, keep listener reconnects isolated from HTTP startup, refetch through authenticated salon endpoints, and retain browser reconnect rehydration plus polling. Inject real listener failures by terminating its PostgreSQL backend, observe shared events with a direct authenticated SSE client, and validate polling with finite routed responses plus request timestamps.