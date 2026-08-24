---
name: Cart browser API assertions
description: Retail cart browser tests should verify mutation responses instead of relying on repeated GET polling.
---

When a browser test verifies a cart mutation, assert the mutation request’s exact cart-line ID and inspect its response rather than using a follow-up GET as the primary proof.

**Why:** Browser and API GET requests can be answered through conditional caching, making a stale cart representation look like a control-targeting bug even when the PATCH or DELETE reached the correct line.

**How to apply:** Use `page.waitForResponse` predicates for the expected PATCH or DELETE URL and assert the returned line identities and quantities; reserve GET polling for eventual consistency that cannot be observed in the mutation response.