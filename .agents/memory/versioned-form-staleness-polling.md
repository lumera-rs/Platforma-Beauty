---
name: Versioned form staleness polling
description: How to add a "page went stale" poll to a form protected by optimistic concurrency without breaking edits or the 409 guarantee.
---

# Versioned form staleness polling

When a settings form guarded by optimistic concurrency (expectedVersion → 409) gains a background staleness check (refetchInterval / refetchOnWindowFocus on the same GET query), two silent regressions are easy to introduce:

1. **Form resets on every refetch.** If the form is (re)initialized from an effect on the query data, a background poll that returns a newer version silently wipes the admin's in-progress edits. The form must be pinned to a "base version" and only reloaded on first fetch, on an explicit "load newer values" action, or during the save-time conflict flow.
2. **expectedVersion silently advances.** If the save sends the *live* query's version, the poll updates it to the newer version before the admin ever sees the newer values — the save then succeeds and overwrites the other admin's change without any 409. The save must send the version the form was *loaded from* (the base version), keeping the 409 as the hard guarantee; the banner is only an early warning.

**Why:** Both failure modes defeat the point of the concurrency check while looking correct in a single-admin demo. Verified with a two-session e2e test (browser admin + separate API session bumping versions).

**How to apply:** Any page that combines react-query polling/focus refetch with version-checked writes: track `formBaseVersion` state, load the form only through an explicit helper that sets it, derive the staleness banner from `liveVersion !== formBaseVersion`, and send `formBaseVersion` as `expectedVersion`. Rebase the form on the response version after a successful save so the follow-up refetch doesn't re-trigger the banner.
