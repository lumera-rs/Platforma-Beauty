---
name: Database-clock test boundaries
description: Keep deadline-sensitive SQL tests on the PostgreSQL clock when test code temporarily overrides JavaScript time.
---

Deadline-sensitive fixtures must use PostgreSQL time expressions when the route predicate also uses `now()`.

**Why:** JavaScript date overrides used to exercise calendar behavior can diverge from PostgreSQL's clock, making a test fixture appear due in application code but not in the payout query.

**How to apply:** For controlled time boundaries, set the isolated fixture relative to PostgreSQL `now()` before and after the synchronized preflight; do not calculate the fixture deadline from JavaScript `Date.now()`.