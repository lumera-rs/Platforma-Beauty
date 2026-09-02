---
name: Overlapping optimistic mutations
description: Safe concurrency rules for reversible mutations that update the same client cache.
---

Independent per-mutation snapshots do not make overlapping optimistic operations safe. Serialize operations at the user-action boundary, or maintain an operation log that can rebase later updates after any earlier success or rollback.

**Why:** An earlier request can finish or fail after a later optimistic change, allowing its server response or snapshot rollback to overwrite newer state. A mutation library's individual lifecycle callbacks do not prevent this race.

**How to apply:** Acquire a shared queue before taking cache snapshots, expose the queue's pending state directly to every related control, restore exact snapshots on failure, and release only after server reconciliation finishes. Release immediately if optimistic setup fails. Use a rebaseable operation log instead only when the UX must permit concurrent edits.