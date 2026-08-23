---
name: Global settings test baselining
description: How to test platform-global, append-only versioned settings tables deterministically on a shared dev database
---

# Global settings test baselining

Tests that exercise platform-global configuration (append-only versioned settings tables where the highest version wins) must not assume the shared development database is in its default state.

**Rule:** capture the current max version as a watermark at test start, explicitly PUT/insert a known baseline version before any classification/behaviour assertions, assert versions relative to the watermark, and clean up by deleting only rows with version > watermark.

**Why:** the dev database is shared — an admin (or a prior interrupted test) may have left tuned settings rows. Assertions like "defaults are active" or absolute version numbers then fail or, worse, pass for the wrong reason. Deleting all rows in cleanup would destroy real tuning; the watermark delete restores exactly the pre-test state.

**How to apply:** any test against a global versioned config table (e.g. platform retention thresholds): (1) watermark = max(version) at start, (2) first valid write is an explicit baseline of defaults, (3) all classification assertions run after that baseline, (4) `finally` deletes `version > watermark` only. Also ensure fixture data actually reaches the code branch under test — e.g. customers must not be overdue before a VIP-branch assertion, and salon-median-derived thresholds need anchor fixtures so the target customer sits on the intended side of the boundary.
