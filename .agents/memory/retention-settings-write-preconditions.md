---
name: Retention settings write preconditions
description: Ordering of checks in the advisory-locked retention-settings update and why stale pages get 409 before a no-op verdict
---

The platform retention-settings update runs several guards inside one advisory-locked transaction. Their order is deliberate:

1. Restore-metadata truthfulness (source version exists, values match) → 400
2. Optimistic-concurrency precondition (`expectedVersion` must equal the active version, exact match — future versions are also conflicts) → 409 VERSION_CONFLICT
3. No-op-restore guard (restore values identical to active thresholds) → 400 NO_OP_RESTORE
4. Insert new version

**Why:** A stale page must learn "someone else saved first" (409 → refetch + re-confirm dialog) before getting a no-op verdict that may be based on values the admin has not seen yet. The no-op guard only applies to restores; identical manual saves still record an audited version.

**How to apply:** Any new guard added to this write path must slot in relative to the version precondition with this rationale in mind, and the client's single write path (save / restore / conflict re-confirm all go through one function sending `expectedVersion`) should stay unified so every entry point gets conflict handling for free.
