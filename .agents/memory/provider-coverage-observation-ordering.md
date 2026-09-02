---
name: Provider coverage observation ordering
description: Rules for safely persisting provider-side registration coverage findings from concurrent background checks.
---

Provider-side registration checks must order their state updates by the time the provider observation began, not merely by when a request completes. An older incomplete listing that returns after a newer healthy listing must not recreate a resolved incident or suppress a later real recurrence.

**Why:** Independent scheduler processes and slow provider responses can finish out of order. Without a durable observation timestamp and shared lock, stale findings overwrite recovery state and make alert deduplication lie.

**How to apply:** Record the newest successful observation under the same transactional/advisory lock as the warning marker. Reject older writes; preserve alert episode identity only while the same unresolved finding remains. Provider failures or malformed responses must not advance the marker.