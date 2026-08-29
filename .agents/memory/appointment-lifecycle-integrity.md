---
name: Appointment lifecycle integrity
description: Durable rules for canonical appointment status transitions, audit, and side effects.
---

Every appointment status change must pass through one canonical transition layer. Single, customer, group, series, owner, and employee routes must not write terminal statuses independently.

**Why:** Independent status writers can bypass arrival/start ordering, cancel an already-started treatment, omit audit fields, or lose inventory, aftercare, referral, package, review, and notification effects.

**How to apply:** Validate and re-read under lock, then persist status, actor/time audit, history action, reversals, durable notifications, and completion effects in the same transaction. Aggregate changes preflight every member and commit all-or-nothing.

Operational lifecycle timestamps use server time. A caller-provided timestamp may support only a narrow clock correction and must never bypass lateness policy.

**Why:** Arbitrary backdating can make a late treatment appear to have enough useful time remaining.

**How to apply:** Reject lifecycle timestamps outside the explicit correction window; reserve historical corrections for a separate privileged workflow.

Customer cancellation deadlines must use the salon calendar timezone and apply through every customer cancellation surface, including partial or complete booking-group cancellation.

**Why:** Treating local appointment time as UTC shifts the deadline across standard/DST time, while an uncovered group endpoint lets the same customer bypass the configured policy.

**How to apply:** Convert date-only plus local start time to the canonical salon instant before comparing the deadline; reuse the same policy helper and truthful messaging in individual and grouped customer flows.