---
name: Employee booking integrity
description: Durable rules for employee-service assignment and load-balanced appointment allocation.
---

Employee-service assignments are authoritative owner configuration. Demo initialization may create a first-time baseline only when the assignment table is completely empty; it must never refill individual missing pairs after an owner removes them.

**Why:** Rebuilding missing links on each initialization silently undoes service eligibility choices, so unavailable employees reappear in public availability and booking.

**How to apply:** Treat `employee_services` as an explicit many-to-many permission list. Any appointment allocation must use the list and must serialize selection and creation for the same salon and calendar day, so a second request sees the first booking before choosing the least-loaded employee.