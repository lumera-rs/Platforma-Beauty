---
name: Production demo content isolation
description: Rules for safely creating managed marketplace demo data in production.
---

Production marketplace demo content must remain fully isolated from real accounts and businesses.

**Why:** Publishing synchronizes schema but not development rows. A production demo seed that attaches fabricated courses or instructors to arbitrary existing centers can make test content look user-authored and corrupt the public marketplace's trust model. Autoscaled application starts also require cross-instance coordination to avoid duplicate seed rows.

**How to apply:** Create only marker-owned demo records under dedicated demo identities/centers, mark public listings and courses as test data, and seed the entire managed set in one transaction protected by an advisory lock. Keep each support identity’s asserted role aligned with role migrations that apply to its owned records; otherwise a safe migration can make the next production startup reject its own canonical account. If marker counts show a partial managed set, stop and report it rather than guessing which rows are safe to modify.