---
name: Education group mutation invariant
description: Explains why multi-seat operational bookings currently reschedule and cancel only as a complete group.
---

Reschedule or cancel all non-cancelled seats in a multi-participant Education booking together. Reject partial mutations before any state change unless the implementation also atomically apportions snapshots, installments, escrow, refunds, and certificate payment gates per affected seat.

**Why:** Copying a group price snapshot without moving its financial rows leaves the moved seats apparently paid while the original group retains obligations for seats it no longer contains.

**How to apply:** Preserve the whole-group rule in API and UI. A future partial-reschedule or partial-cancellation feature must define and transactionally test proportional settled and unsettled amounts, refund history, escrow, idempotency, and rollback behavior before relaxing it.