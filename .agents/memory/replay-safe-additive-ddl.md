---
name: Replay-safe additive DDL
description: Historical startup rollout steps must remain compatible with later data, and every post-apply DDL change needs a new version.
---

Startup DDL that replays the full additive rollout must evaluate historical constraints against the final schema’s valid row shapes, not only the shape that existed when the step was introduced.

**Why:** A later discriminator can make an older required field legitimately nullable. If an earlier guard or `SET NOT NULL` is replayed unchanged, the next restart can fail only after valid new rows exist.

**How to apply:** When adding nullable alternatives or discriminated records, audit every earlier replayed backfill guard and nullability change for the affected columns. Keep legacy enforcement conditional while allowing the final valid alternatives.

Any DDL added after a rollout version has already been applied must bump the rollout version, even when the statement is idempotent.

**Why:** Existing databases may skip the already-recorded version entirely, so adding `CREATE ... IF NOT EXISTS` under that same version repairs fresh databases but silently leaves upgraded databases incomplete.

**How to apply:** Treat indexes, constraints, columns, and tables as versioned changes. Bump the rollout version, update the exact-version test, and rerun the real post-merge schema gate against an already-upgraded development database.