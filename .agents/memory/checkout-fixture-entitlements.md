---
name: Checkout fixture entitlements
description: Why deterministic checkout regressions must isolate seeded discounts, shipping benefits, and required seller state.
---

Checkout regression fixtures that assert base totals or weight-based shipping must snapshot and neutralize seeded entitlement state, then restore it during teardown. They must also initialize required singleton seller settings when disposable databases do not contain them.

**Why:** Seed data evolves independently of focused commerce tests. A salon can later receive free shipping or another benefit, making a correct checkout return a different total; disposable databases can also omit optional singleton rows that checkout now requires.

**How to apply:** Before asserting unmodified prices or shipping, isolate the test buyer's loyalty/coupon/referral state and required seller configuration. Restore existing rows exactly, and delete rows that the test created.