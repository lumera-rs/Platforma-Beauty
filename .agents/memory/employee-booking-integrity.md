---
name: Employee and resource booking integrity
description: Durable rules for employee-service assignment, load balancing, and capacity-constrained resources.
---

Employee-service assignments are authoritative owner configuration. Demo initialization may create a first-time baseline only when the assignment table is completely empty; it must never refill individual missing pairs after an owner removes them.

**Why:** Rebuilding missing links on each initialization silently undoes service eligibility choices, so unavailable employees reappear in public availability and booking.

**How to apply:** Treat `employee_services` as an explicit many-to-many permission list. Any appointment allocation must use the list and must serialize selection and creation for the same salon and calendar day, so a second request sees the first booking before choosing the least-loaded employee.

Resource capacity extends the same transaction protocol; it is not a separate scheduler. Acquire locks in the deterministic order salon, calendar day, employee/day, then resource/day. Resource configuration and service requirements must share the salon lock so capacity cannot be lowered or reconfigured around an in-flight booking.

**Why:** Preview availability is advisory. Only a locked write can prove that every required resource still has capacity, and configuration writes can violate that invariant if they bypass the booking lock.

**How to apply:** Revalidate and allocate every configured requirement inside the appointment transaction. Roll back on any conflict. Cancelled appointments keep their allocation rows for display/audit but do not consume capacity; reactivation must revalidate those rows. Block deletion when allocation history exists and use deactivation instead.

When a helper accepts either the shared database or a transaction session, do not run its queries with `Promise.all`; transaction sessions are backed by one pg client and each query must be awaited before the next begins.

**Why:** pg 9 will remove the permissive busy-client query queue behavior, turning currently hidden transaction read races into release-blocking failures.

**How to apply:** Keep parallel reads only on independently acquired pool clients. Treat any `store`/`tx` abstraction as single-connection unless its contract explicitly guarantees otherwise.