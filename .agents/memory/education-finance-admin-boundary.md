---
name: Education finance admin boundary
description: Authorization rule for administrative Education money mutations.
---

Administrative Education mutations that settle, refund, pay out, resolve disputes, or change financial terms are restricted to `SUPER_ADMIN`. The role check must happen before request-body validation or entity lookup.

**Why:** Financial audit completeness is not a substitute for authorization; allowing a regular admin to reach these operations would expose the platform money boundary and could also leak entity state through validation differences.

**How to apply:** When adding or changing an Education administrative money mutation, keep it behind the super-admin guard, write its central audit row in the business transaction, and include it in the regular-admin denial regression.