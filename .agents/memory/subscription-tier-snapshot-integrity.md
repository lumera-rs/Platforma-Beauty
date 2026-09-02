---
name: Subscription tier snapshot integrity
description: Rules for immutable plan-change pricing and safely separating shared legacy subscription plans.
---

All decisions about whether a plan change is an upgrade or downgrade, and every prorated amount derived from that decision, must use the subscriber's frozen current-period price and limits. A payment obligation's total is not a replacement for the plan's recurring unit-price snapshot because it may represent a prorated delta or a multi-month cycle.

**Why:** Mutable catalog edits can otherwise reverse upgrade/downgrade classification or silently change an in-progress customer's charge. Reusing a delta or annual total as the next current-period snapshot compounds the error after settlement.

**How to apply:** Freeze recurring plan price, billing cycle, and entitlement limits at activation; copy the target snapshots onto obligations; activate those target snapshots only after settlement.

When introducing audience or product-family scope on a shared plan table, clone and repoint legacy records that are referenced by more than one audience before relabeling.

**Why:** In-place audience relabeling can remove an existing product from its original listing and admin surfaces.

**How to apply:** Detect shared references during additive rollout, create an audience-specific copy, repoint only that audience's subscriptions, then classify records that are no longer shared.