---
name: Education recurrence semantics
description: How recurring Education sessions must interpret availability grids and preserve educator exclusivity.
---

Availability grid start times are alternative booking starts, not a list of sessions to insert. A recurrence window must select a deterministic sequence of fixed, non-overlapping occurrences, and every committed occurrence must recheck educator overlap while holding the shared schedule locks.

Weekly availability, absences, and educator active/role changes are calendar facts in the same serialization domain. Their writes must take the shared schedule lock, and recurrence must recompute all facts through its locked transaction.

**Why:** Treating every grid point as an occurrence creates overlapping sessions whenever course duration exceeds grid granularity. Reading calendar facts outside the locked transaction also lets a concurrent absence commit while recurrence still schedules that educator.

**How to apply:** Advance recurrence starts by at least the course duration, aligned to the configured grid. Serialize every calendar-fact mutation with recurrence, recompute through the transaction after lock acquisition, and reject overlap immediately before insert; keep absence-race, concurrent-commit, and non-divisible-duration coverage.