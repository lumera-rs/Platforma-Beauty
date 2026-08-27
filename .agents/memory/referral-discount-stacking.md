---
name: Referral discount stacking
description: Confirmed policy for combining referral credit with commerce discounts across B2B and B2C checkout.
---

Referral credit applies only to the complete value of clean `FULL_PRICE` lines. Any positive SALE, TIER, BUNDLE, COUPON, LOYALTY, or future unrecognized discount excludes the whole line from the referral base; a coupon allocation never leaves a referral-eligible remainder.

**Why:** Combining referral value with another discount on the same line creates inconsistent preview/final totals and lets partial coupon allocations bypass the intended stacking restriction. Unknown future discount families must fail closed until explicitly approved.

**How to apply:** Route cart display, checkout preview, and locked final checkout through one shared policy engine. Persist final applied amounts on orders, and render confirmations from those immutable values rather than recalculating.