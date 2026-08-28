---
name: Production bootstrap schema parity
description: Keeping the api-server production schema bootstrap in lockstep with the drizzle schema, especially after concurrent task merges.
---

Production does NOT run drizzle push — the api-server's versioned bootstrap DDL is the only migration path. Its CREATE TABLE statements and idempotent ALTERs must mirror the drizzle schema exactly, including columns added by *other* concurrently merged tasks.

**Why:** A release was rejected because a rebase brought in a new drizzle column (`automation_deliveries.failed_at`) that runtime code already used, while the bootstrap's CREATE/ALTER statements never created it — new and legacy production databases would both fail at runtime. The rollout test only checked the tables the current task added, so it missed the drift.

**How to apply:**
- Whenever bumping the bootstrap schema version, diff every drizzle table it covers against the bootstrap DDL — not just the tables your task touches. New columns need both a CREATE TABLE entry and an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for legacy databases.
- Assert each newly adopted column in the legacy-upgrade rollout test so the gap is caught mechanically.
- In isolated legacy-upgrade tests, seed minimal stubs for referenced tables owned by other bootstraps; this rollout must not create them, but its FK DDL still requires them to exist.
- After a rebase merges someone else's schema change, re-run drizzle push against the shared development database before trusting integration tests — the dev DB may lack the merged columns even though main has them.
- When strengthening an existing index's semantics, `CREATE ... IF NOT EXISTS` is not a migration: detect the legacy definition, preserve or explicitly reconcile incompatible rows, replace it, and prove the upgrade from the old index in the rollout test.

Schema-rollout serialization must use one advisory-lock identity that stays unchanged across bootstrap versions. Every process must wait for that lock and verify/apply its own current rollout; a failed try-lock must never be treated as readiness. Mark a version complete only after all DDL and backfills succeed.

**Why:** During a rolling upgrade, deriving the lock key from the bootstrap version let old and new processes mutate the same PostgreSQL trigger catalogs concurrently. A non-blocking try-lock avoided the catalog race but allowed a process to serve requests before its required schema was ready.

**How to apply:** Keep the lock key stable across releases, acquire it on the same held connection that runs the rollout, serialize direct test runners through the same boundary, and regression-test that a newer runner cannot return while an older-version owner holds the lock.
