---
name: Deterministic foreign-key default seeds
description: Fixed foreign-key defaults require a recoverable parent row, not only a rollout-time insert.
---

Any schema that gives child rows a fixed parent UUID as their database or ORM default must ensure that exact parent relationship remains recoverable during runtime seed and test cleanup.

**Why:** A rollout-time `INSERT ... ON CONFLICT (slug) DO NOTHING` can leave the fixed UUID absent when the slug already belongs to another row, and later fixture cleanup can remove the parent after the rollout version is already marked complete. Child inserts that rely on the default then fail their foreign key.

**How to apply:** Resolve the canonical parent by stable public key before inserting children, explicitly pass its actual ID into every tenant-scoped child, and recreate it idempotently if absent. Scope category/tree reads by that parent so another tenant's matching slug cannot be selected.