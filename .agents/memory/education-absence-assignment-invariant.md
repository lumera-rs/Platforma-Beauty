---
name: Education absence assignment invariant
description: Business and locking policy for educator absences that overlap assigned education sessions.
---

An educator absence and an active session assignment are mutually exclusive. An absence is rejected until every conflicting session is reassigned or cancelled, and later session creation or substitution must also reject an educator whose absence overlaps.

**Why:** Checking only absence creation leaves an inverse gap where a valid absence can later receive a session. Replacement and cancellation also compete on the same records, so inconsistent lock ordering can deadlock instead of producing a controlled business result.

**How to apply:** Preview conflicts for the user, but always revalidate current facts inside the write transaction. Acquire shared education schedule locks before row locks, then re-read mutable session, assignment, educator, and absence state.