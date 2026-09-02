---
name: Per-table immutable triggers
description: PostgreSQL trigger-function boundaries and repair-version rules for immutable commercial snapshots.
---

Do not share an immutable-snapshot trigger function across tables with different column sets. Each table shape needs its own function and explicit trigger binding. If a faulty migration version may already be recorded, repair it in a new additive version rather than editing only the old version.

**Why:** PostgreSQL resolves row fields at trigger execution, so a shared function can fail with a missing-field error on the narrower table. An already-recorded migration will not rerun after its source is edited.

**How to apply:** Recreate both functions and both bindings unconditionally in a new repair rollout, and test an upgrade fixture starting from the already-recorded broken version as well as fresh replay.