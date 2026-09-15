---
name: Drizzle unique index parity
description: Prevent destructive development pushes when a named unique index and an ORM unique constraint describe the same live invariant.
---

When an additive rollout creates a named PostgreSQL unique index, model that same invariant as a named `uniqueIndex` in Drizzle rather than a column-level unique constraint.

**Why:** Drizzle distinguishes a unique index from a unique constraint. Treating the existing index as a new constraint can make a development push propose truncating a populated table, which non-interactive post-merge setup cannot safely approve.

**How to apply:** Keep the index kind and name aligned between the rollout and ORM schema. Never accept a forced truncation merely to reconcile equivalent uniqueness declarations; align the declarations first, then rerun the development push.

Drizzle's index builder in the current toolchain cannot express PostgreSQL `NULLS NOT DISTINCT`. Do not switch a native standalone index to a unique constraint merely to gain the ORM method.

**Why:** The Publish diff can replace the standalone native index with an ordinary UNIQUE constraint, omitting the NULL-equality flag even when development has it. A diff without structural data loss can still weaken uniqueness.

**How to apply:** Preserve the native index's kind, ordered columns, and NULL-equality behavior through the development-only reconciliation path. Audit `pg_index.indnullsnotdistinct` and the absence of a constraint owner; inspect actual diff statements, not just destructive flags. Never introduce production startup DDL to compensate.

In this workspace's Drizzle 0.31.x toolchain, a non-TTY `push --force` can print an interactive-prompt failure yet still exit with status 0. Post-merge automation must use the versioned idempotent rollout and verify the resulting schema with explicit standards checks instead of trusting that exit code.