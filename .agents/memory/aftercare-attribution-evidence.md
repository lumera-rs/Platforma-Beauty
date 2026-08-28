---
name: Aftercare attribution evidence
description: Rules for attaching and converting post-treatment recommendations through B2C checkout.
---

Aftercare conversion, replenishment, supersession, and reversal must rely on the immutable recommendation reference stored on the purchased order item. A matching customer and catalog item are not sufficient evidence. Premade bundles remain valid attribution-only recommendations when their extra discount is disabled; their canonical fixed price is unchanged, but the eligible order item still records the recommendation.

**Why:** Catalog-match attribution incorrectly converts unrelated purchases, while rejecting zero-discount premade offers loses legitimate conversion evidence and breaks the customer journey.

**How to apply:** Validate owner, lifecycle, expiry, cart coverage, and quantity caps before checkout. Persist recommendation evidence only on eligible B2C quantities, then require that exact evidence in every conversion, replenishment, supersession, and reversal query.