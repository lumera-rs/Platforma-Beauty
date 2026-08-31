---
name: Education placement lifecycle
description: Invariants for reserving, settling, rotating, and expiring paid Education marketplace positions.
---

Paid Education placements must reserve inventory only for a bounded payment window. Purchase snapshots every commercial term needed for later settlement, including price, duration, scope, and slot; settlement must not depend on the current admin price list.

**Why:** Abandoned payment requests can otherwise exhaust a scope forever, while later price, slot-count, or duration edits can make an already-paid placement impossible to activate. UTC day boundaries also produce the wrong rotation day and duration around Belgrade midnight and DST.

**How to apply:** Serialize purchase and settlement by the canonical placement resource, expire stale pending rows before allocation and during late settlement, activate from the immutable snapshot, and calculate daily rotation and duration in `Europe/Belgrade` calendar semantics.