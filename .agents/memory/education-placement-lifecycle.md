---
name: Education placement lifecycle
description: Invariants for reserving, settling, rotating, and expiring paid Education marketplace positions.
---

Paid Education placements must reserve inventory only for a bounded payment window. Purchase snapshots every commercial term needed for later settlement, including price, duration, scope, and slot; settlement must not depend on the current admin price list. Scoped course offers must match the course's canonical category or subcategory both when reserved and when settled, and slot occupancy/expiry must remain isolated to that exact taxonomy namespace.

**Why:** Abandoned payment requests can otherwise exhaust a scope forever, while a mismatched or later-reclassified course can reserve or settle promotional inventory belonging to another taxonomy namespace. Later price, slot-count, or duration edits can also make an already-paid placement impossible to activate. UTC day boundaries produce the wrong rotation day and duration around Belgrade midnight and DST.

**How to apply:** Serialize purchase and settlement by the canonical placement resource, include the exact category/subcategory identifier in its lock and occupancy predicates, validate target membership at purchase and settlement, expire only matching stale rows, activate from the immutable snapshot, and calculate daily rotation and duration in `Europe/Belgrade` calendar semantics.