---
name: OAuth domain regression fixtures
description: Test setup for OAuth domain-change flows when persisted integration settings can override environment fallbacks.
---

OAuth domain-change regression tests must temporarily control persisted Google and Facebook integration rows, because a disabled database row suppresses environment fallback credentials.

**Why:** Environment-only fixtures can unexpectedly take the “provider not configured” branch when shared development data contains disabled OAuth settings.

**How to apply:** Snapshot and restore the exact integration rows, use unique temporary values, and intercept provider token/profile requests so the test never changes or contacts production credentials.