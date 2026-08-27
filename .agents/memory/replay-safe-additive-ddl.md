---
name: Replay-safe additive DDL
description: Historical startup rollout steps must remain compatible with data valid under later schema versions.
---

Startup DDL that replays the full additive rollout must evaluate historical constraints against the final schema’s valid row shapes, not only the shape that existed when the step was introduced.

**Why:** A later discriminator can make an older required field legitimately nullable. If an earlier guard or `SET NOT NULL` is replayed unchanged, the next restart can fail only after valid new rows exist.

**How to apply:** When adding nullable alternatives or discriminated records, audit every earlier replayed backfill guard and nullability change for the affected columns. Keep legacy enforcement conditional while allowing the final valid alternatives.