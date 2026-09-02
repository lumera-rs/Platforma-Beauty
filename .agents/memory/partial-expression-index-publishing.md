---
name: Partial expression index publishing
description: Avoid publish-time migration failures for partial unique indexes that normalize nullable values.
---

For a partial unique constraint over a nullable participant identifier, normalize the nullable value in a PostgreSQL generated column and index that column rather than placing `coalesce(...)` directly in the partial unique index expression.

**Why:** The development database accepts expression indexes, but the publish-time schema diff can emit a statement PostgreSQL rejects for the combined expression and partial-predicate form.

**How to apply:** Keep the partial `WHERE` predicate on an index of ordinary columns, and make the generated column carry the deterministic nullable-value normalization. Validate with a development `drizzle-kit push` before republishing.