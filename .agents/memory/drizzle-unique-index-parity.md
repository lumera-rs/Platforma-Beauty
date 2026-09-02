---
name: Drizzle unique index parity
description: Prevent destructive development pushes when a named unique index and an ORM unique constraint describe the same live invariant.
---

When an additive rollout creates a named PostgreSQL unique index, model that same invariant as a named `uniqueIndex` in Drizzle rather than a column-level unique constraint.

**Why:** Drizzle distinguishes a unique index from a unique constraint. Treating the existing index as a new constraint can make a development push propose truncating a populated table, which non-interactive post-merge setup cannot safely approve.

**How to apply:** Keep the index kind and name aligned between the rollout and ORM schema. Never accept a forced truncation merely to reconcile equivalent uniqueness declarations; align the declarations first, then rerun the development push.

In this workspace's Drizzle 0.31.x toolchain, a non-TTY `push --force` can print an interactive-prompt failure yet still exit with status 0. Post-merge automation must use the versioned idempotent rollout and verify the resulting schema with explicit standards checks instead of trusting that exit code.