---
name: Availability branch preloading
description: How to keep combinatorial availability previews canonical without creating database queries per candidate branch.
---

Combinatorial availability previews must preload invariant salon, employee, schedule, appointment, and resource facts once for the requested window, then rerun the same canonical pure availability engine for each branch with branch-local tentative reservations.

**Why:** Calling the database-backed availability adapter recursively makes query count scale with candidate branches and days. Reimplementing conflict filtering in the route is faster but risks drifting from booking-time employee, buffer, and resource rules.

**How to apply:** For any grouped, package, or multi-resource availability search, keep database reads request-scoped, pass an immutable preload context into the canonical engine, and enforce a query-budget regression over the maximum supported date window.