---
name: Education completion gate ordering
description: Keeps operational enrollment completion and certificate access independent of whether lessons or attendance are recorded first.
---

Lesson completion, attendance, and installment settlement must invoke one transaction-scoped reconciliation of live format, payment, access, progress, and attendance gates. Any update can complete an eligible enrollment or revoke completion when a gate is corrected.

**Why:** If only one gate transitions enrollment status, valid results depend on event order: in-person/hybrid courses or attendance recorded before final payment can remain active even after every live requirement is satisfied.

**How to apply:** Reconcile after every lesson, attendance, or reserved-seat payment mutation; preserve waitlisted/cancelled/refunded states, clear completedAt when a correction removes eligibility, and keep certificate authorization tied to live eligibility plus completed status.