---
name: Referral compensation accounting
description: Durable accounting rules for referral rejection, restoration, expiry, and qualification windows.
---

Fraud rejection must remove any still-live entitlement and leave debt only for value that was actually consumed and not restored. Expired, unused, or fully restored value must never become negative debt. Compute compensation from source-linked facts rather than a fixed nominal reward.

**Why:** Append-only ledgers can contain grants, redemptions, restorations, expiry, and prior compensation simultaneously. Reversing the headline reward again can double-count an expired remainder or ignore a restoration.

**How to apply:** Serialize the wallet/source, derive the source’s current contribution, append only the delta needed for the rejected state, and cover unspent expiry, partial redemption, partial/full restoration, replay, and concurrent decisions.

Qualification periods are fixed half-open windows from their authoritative start, never rolling windows derived from the newest evidence.

**Why:** A rolling lookback allows referrals to qualify long after the promised registration or approval deadline.

**How to apply:** Consumer and student channels start at attribution capture; business channels start when admin approval unlocks tracking. Ignore evidence before start and at or after the fixed deadline.