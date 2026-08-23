---
name: Shipping rule row order
description: Retail shipping config is read via an unordered first-row query; extra rows make checkout behavior and its browser fixtures order-dependent.
---

The API server loads the retail shipping configuration with an unordered single-row select (`select().from(shippingRulesTable).limit(1)`), creating a default row only when the table is empty. With more than one row present, which rule wins depends on physical heap order and changes as rows are inserted/deleted.

**Why:** The retail-checkout browser suite inserts its own shipping rule in `beforeAll` and assumes the server will use it. Once a real admin-configured rule exists in the dev database (observed: personal delivery disabled), the suite passes or fails nondeterministically — personal-delivery tests 503 when the seeded rule happens to be first. A crashed run that leaks its fixture rule compounds the ambiguity.

**How to apply:** When retail checkout browser tests fail on `checkout-preview` (especially `personal_belgrade`), inspect `shipping_rules` for multiple rows before suspecting the change under test; delete leaked fixture rows (they match the spec's exact values: threshold 10000, single 390 tier, "Lična dostava u Beogradu"). The durable fix is deterministic rule selection / a singleton constraint server-side — until then, treat multi-row `shipping_rules` as an invalid state for both prod behavior and tests.
