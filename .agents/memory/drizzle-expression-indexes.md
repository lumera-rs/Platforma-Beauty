---
name: Drizzle expression indexes
description: Prevent invalid PostgreSQL DDL when Drizzle emits an expression index during schema provisioning.
---

For a PostgreSQL expression index declared with Drizzle raw SQL, include the expression's parentheses in the raw fragment (for example, `sql`(true)``), so the generated DDL contains the required double parentheses.

**Why:** A bare raw boolean expression was emitted as invalid PostgreSQL index DDL. The affected Drizzle command reported the SQL error but still exited successfully, allowing an isolated-database harness to continue with an incomplete schema.

**How to apply:** Validate schema changes against a newly provisioned database. Any harness that prepares a disposable database must treat reported schema-push errors as failures, rather than trusting the subprocess exit code alone.