---
name: Supplier catalog write serialization
description: Concurrency rule for supplier scope, product sales channels, category availability, and checkout.
---

Supplier scope changes and product channel writes must serialize on the supplier row at the database boundary; route-level validation alone is not sufficient. Product merchandising links must also serialize against the linked products and the edited product's previously read supplier/relationship state. Supplier moves and hard deletes must protect inbound links instead of silently leaving cross-supplier or dangling IDs. Checkout must lock products, then suppliers in deterministic order, then the relevant category state before revalidating eligibility.

**Why:** A product write can validate against old supplier or relationship state while a concurrent move/edit commits, allowing invalid links or lost merchandising configuration. Deleting or moving a referenced product can otherwise make recommendations silently disappear. Checkout has the equivalent stale-eligibility risk when supplier or ancestor-category status changes concurrently.

**How to apply:** Supplier scope/status mutations take an exclusive supplier-row lock. Every product insert or channel/supplier update takes a conflicting supplier-row lock before checking scope. Relationship writes lock referenced targets and reject stale edited state; supplier moves and hard deletes lock and reject inbound owners. Checkout locks product rows, sorted supplier rows, and category state before its final active/scope/channel validation.