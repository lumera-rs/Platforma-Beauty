---
name: Background scheduler recovery
description: How LUMERA recovers periodic background jobs after temporary PostgreSQL failures.
---

Periodic database-backed jobs use one bounded, per-process recovery policy for
transient connection failures. The local scheduler state is deliberately exposed
through health and the administrator dashboard, rather than being persisted as a
new database dependency during a database outage.

**Why:** A PostgreSQL timeout must not fan out retries or silently lose a near-term
cycle, but creating a second durable scheduler-state dependency would be least
reliable precisely when the database is unavailable. Existing job-specific
transactions, advisory locks, claims, leases, and idempotency keys remain the
authoritative protection against duplicate business effects across restarts or
multiple processes.

**How to apply:** New periodic DB jobs should use the shared recovery policy,
classify only connection/transient database failures as retryable, and retain
their own durable concurrency and idempotency protections. A later normal interval
may begin a fresh bounded retry window after an outage exhausts the prior one.

**Rule:** Scheduler-owned work must leave two shared-pool connections available
for interactive requests, and queued background work must retain FIFO order.

**Why:** Several independent timers can start together during boot or recovery.
Without a shared concurrency bound, those jobs can occupy every database
connection and make the administrator dashboard wait behind maintenance work.

**How to apply:** Route every new resilient scheduled job through the shared
scheduler database-activity gate. Contention regressions should use the same
gate with checked-out, read-only database clients rather than altering global
scheduler health or production timers.