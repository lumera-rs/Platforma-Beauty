---
name: Durable booking command replay
description: Transaction and test semantics for safe booking idempotency and lost-response recovery.
---

**Rule:** A booking command receipt, its booking mutations, and every required notification/email/SMS outbox row must commit in one transaction. The receipt stores an actor/tenant-scoped key, canonical payload fingerprint, and original response; matching retries replay it, while changed payloads are rejected.

**Why:** A receipt committed before required communication creates a replayable “success” that can never produce its confirmation after a crash. Conversely, treating independent identical load arrivals as one idempotent command hides real slot contention and produces false capacity evidence.

**How to apply:** Keep provider delivery outside the transaction but enqueue durable communication inside it. Clients retain one key only for retries of the same intent. Load and concurrency fixtures generate a unique key per independent arrival and deliberately share a key only in explicit replay scenarios.