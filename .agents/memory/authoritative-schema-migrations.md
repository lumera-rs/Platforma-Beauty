---
name: Authoritative schema migrations
description: Approved long-term production schema ownership and adoption strategy.
---

Repository-owned, versioned SQL migration directories are the authoritative production schema mechanism. Drizzle declarations remain schema inputs, but Drizzle generation metadata does not own history or ordering. Existing databases must be adopted through a reviewed baseline/ledger and must never blindly replay historical migrations. Custom startup bootstrap remains temporary during the transition and must not receive new one-off schema repairs.

**Why:** Independent Drizzle declarations and startup bootstrap coverage allowed an existing database to be marked current while application-required objects were absent.

**How to apply:** Reconcile catalog drift through reviewed forward migrations, run migrations once before application rollout, and retire startup DDL only after baseline adoption and parity checks are proven.

Catalog fingerprints used for adoption evidence must be fail-closed, come from one repeatable-read snapshot with a pinned deparser environment, and use conservative semantic normalization. Include PostgreSQL-specific invariants such as exclusion constraints, NULLS NOT DISTINCT, deferrability, validation state, index INCLUDE/key details, and physical names in an explicit physical hash.

**Why:** Broad SQL text normalization created collisions between different literals, arithmetic grouping, casts, and function schemas; session search paths changed deparser output; per-column index deparsing omitted option, collation, and opclass details; omitted exclusion and advanced constraint semantics hid active Lumera invariants.

**How to apply:** Pin the PostgreSQL deparser GUCs, read index semantic vectors explicitly, normalize only proven equivalences, preserve literal and resolved object identity, expose structural and physical payloads for review, and make unknown catalog object types fail instead of disappearing.