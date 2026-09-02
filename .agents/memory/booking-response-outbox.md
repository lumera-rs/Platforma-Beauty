---
name: Booking response outbox
description: Preserving notification durability while keeping provider delivery off booking response paths.
---

Required booking communication records belong in the same database transaction as the booking. Provider delivery and retry may run asynchronously after commit, but creating the outbox record must not happen in a post-commit response window.

**Why:** Synchronous delivery bookkeeping can dominate peak booking throughput, while post-commit enqueueing creates a crash window that permanently loses notifications and can return an error after the booking already committed.

**How to apply:** Insert customer notifications and email/SMS outbox rows through the active booking transaction. Roll back the booking if those durable records cannot be created. Keep provider calls in leased, retryable workers outside the request path.