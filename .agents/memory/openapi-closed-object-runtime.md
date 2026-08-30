---
name: OpenAPI closed-object runtime enforcement
description: Closed OpenAPI request objects need raw-input enforcement when generated runtime validators strip unknown keys.
---

For security-sensitive write endpoints, do not assume `additionalProperties: false` is enforced merely because the generated runtime schema accepts the request. If the generated parser strips unknown keys, validate the original request object for exact top-level and nested keys before using normalized data.

**Why:** A normalized parse can silently discard contract-forbidden fields, making an endpoint accept a request that the published OpenAPI contract says must be rejected.

**How to apply:** Keep generated validation for types and constraints, then enforce closed shapes against untouched input and add regression cases for unknown keys at every protected object boundary.