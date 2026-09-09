---
name: Authoritative schema migrations
description: Approved long-term production schema ownership and adoption strategy.
---

Drizzle-generated, versioned migrations are the authoritative production schema mechanism. Existing databases must be adopted through a reviewed baseline/ledger and must never blindly replay historical migrations. Custom startup bootstrap remains temporary during the transition and must not receive new one-off schema repairs.

**Why:** Independent Drizzle declarations and startup bootstrap coverage allowed an existing database to be marked current while application-required objects were absent.

**How to apply:** Reconcile catalog drift through reviewed forward migrations, run migrations once before application rollout, and retire startup DDL only after baseline adoption and parity checks are proven.