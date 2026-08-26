---
name: Supplier catalog write serialization
description: Concurrency rule for supplier scope, product sales channels, category availability, and checkout.
---

Supplier scope changes and product channel writes must serialize on the supplier row at the database boundary; route-level validation alone is not sufficient. Checkout must lock products, then suppliers in deterministic order, then the relevant category state before revalidating eligibility.

**Why:** A product write can validate against the old supplier scope while a concurrent supplier update sees no incompatible product, allowing both transactions to commit an invalid catalog. Checkout has the equivalent stale-eligibility risk when supplier or ancestor-category status changes concurrently.

**How to apply:** Supplier scope/status mutations take an exclusive supplier-row lock. Every product insert or channel/supplier update takes a conflicting supplier-row lock before checking scope. Checkout locks product rows, sorted supplier rows, and category state before its final active/scope/channel validation.