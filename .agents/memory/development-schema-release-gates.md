---
name: Development schema release gates
description: Why schema-source changes must be reconciled to the live development database before running release validation.
---

Release validation that combines static schema checks with live database audits requires the development database to match the checked-in schema. A declaration in the ORM source does not make a live index, table, or query plan available to those checks.

**Why:** A release gate reported missing indexes and archive tables even though the definitions were already present in source. The approved development schema application step had stopped before applying them, so static type/build checks passed while live database checks failed.

**How to apply:** After schema-affecting work or a merge, confirm the approved development schema reconciliation completed before diagnosing release-test failures as code defects. Keep production schema application in Replit Publish; never compensate with startup-time or deployment-time DDL.