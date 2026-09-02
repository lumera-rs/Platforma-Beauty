---
name: Variant inventory model
description: Consistent inventory rules for B2B products that offer variants.
---

Products with variants use exactly one inventory model: either one shared product-level stock value (all variant stock values omitted), or per-variant stock (every variant has a non-negative whole-number stock and their sum equals product stock). Variant values are unique after trimming. A checkout must require a variant for a variant product and cannot accept one for a non-variant product.

**Why:** Mixing partial per-variant and product-wide stock permits overselling and makes the admin inventory display misleading.

**How to apply:** Enforce the invariant on every product create/update path and preserve it when adjusting stock during checkout or imports.