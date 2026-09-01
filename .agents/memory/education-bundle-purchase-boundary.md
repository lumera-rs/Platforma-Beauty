---
name: Education bundle purchase boundary
description: Financial and identity invariants for purchasing a package of Education courses.
---

An Education bundle purchase is one immutable parent obligation and entitlement. It snapshots the offered courses, terms, price, and participant identity; settlement creates one parent escrow/ledger boundary. Child course enrollments project access only and never receive separate charges, escrows, or ledgers.

**Why:** Treating bundled courses as independent purchases can double-charge, split settlement state, or grant access to a different employee if account linkage changes between purchase and settlement.

**How to apply:** Keep commercial terms immutable after publication or purchase, require all bundled courses to be valid for the same center, snapshot the linked learner identity at purchase, re-verify it at settlement, and make retries idempotent at the parent boundary.