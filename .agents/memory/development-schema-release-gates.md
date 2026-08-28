---
name: Development schema release gates
description: Why schema-source changes must be reconciled to the live development database before running release validation.
---

Release validation that combines static schema checks with live database audits requires the development database to match the checked-in schema. A declaration in the ORM source does not make a live index, table, or query plan available to those checks.

**Why:** A release gate reported missing indexes and archive tables even though the definitions were already present in source. The approved development schema application step had stopped before applying them, so static type/build checks passed while live database checks failed.

**How to apply:** After schema-affecting work or a merge, confirm the approved development schema reconciliation completed before diagnosing release-test failures as code defects. Keep production schema application in Replit Publish; never compensate with startup-time or deployment-time DDL.

Constraints on tables that do not yet exist in production must be validated in the development database before publishing.

**Why:** An unvalidated development check constraint can make publish diff introspection serialize a new table as `CREATE TABLE (...) NOT VALID`, which PostgreSQL rejects because `NOT VALID` is legal for individual constraints, not the table statement.

**How to apply:** Before publishing a new schema, query `pg_constraint` for `convalidated = false`, verify the existing development rows satisfy each rule, validate the constraints through the approved development reconciliation, and recompute the production diff.

Version-gated additive rollouts do not reconcile a deliberate schema relaxation once the development database already records the current rollout version.

**Why:** A temporary nullable bridge existed in ORM source, but the normal reconciliation correctly skipped the already-applied rollout, leaving the live development columns strict and the Publish diff destructive.

**How to apply:** After an intentional relaxation, inspect the live development nullability and recompute the Publish diff. Apply only the exact safe development-side alteration when the versioned rollout cannot represent it; never target production.

Runtime-created tables inside the published schema must also have matching ORM declarations, and bare boolean checks should use explicit comparisons.

**Why:** Publish introspection reconstructed a valid runtime-created `CHECK (singleton)` as invalid nested SQL, `CHECK (CHECK (singleton))`, even though ordinary validation and schema-diff warnings were clean.

**How to apply:** Mirror runtime-managed public tables in the ORM, define boolean checks as expression-only comparisons such as `singleton = true`, normalize the live development constraint, and inspect the exact generated migration statement.