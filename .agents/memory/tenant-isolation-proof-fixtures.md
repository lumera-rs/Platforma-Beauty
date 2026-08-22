---
name: Tenant isolation proof fixtures
description: How release tests must prove tenant boundaries instead of only exercising internally consistent data.
---

Tenant-isolation release gates must include column-valid cross-tenant references, not only clean A-versus-B fixtures. They must also distinguish same-owner locations when operational APIs use an active location.

**Why:** Consistent fixtures can pass even when aggregate or relation-resolution queries omit a tenant predicate. Cleanup failures can also leave shared development data behind while a test appears successful.

**How to apply:** Seed adversarial foreign customer, employee, service, or series references for the exact reads being defended; assert aggregate values and nested IDs, switch a multi-location owner’s active location, and fail the test if fixture cleanup leaves parent rows.