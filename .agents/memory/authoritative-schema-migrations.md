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

Application-trigger evidence must use trigger-aware deparsing for conditional
expressions and conservatively treat trigger names as structural semantics.
PostgreSQL enum discovery must retain empty enum types and empty-string labels.

**Why:** Generic expression deparsing lacks the OLD/NEW relation context used by
trigger WHEN clauses. PostgreSQL orders same-kind triggers alphabetically and
exposes `TG_NAME`, so a rename can change behavior. Empty enums and empty labels
are valid catalog states and must not disappear from exact identity evidence.

**How to apply:** Derive conditional-trigger semantics from the complete trigger
definition with quote-aware parsing, hash trigger and function definitions under
the pinned deparser contract, and enumerate enum types independently of labels.

Baseline adoption is classification-only until a separately reviewed P.2
architecture restores any write capability. Repository eligibility authority may
remain intentionally empty; an operator-supplied manifest never establishes
legacy truth.

**Why:** The removed adoption path trusted self-authored manifests, lacked
database/environment identity proof, changed its own fingerprint by creating
metadata, and used broad catalog/table locks. Its integration path could commit
against an insufficiently guarded database.

**How to apply:** Keep eligibility transactions read-only and fixed to
repository-owned authority. Do not restore adoption writes until P.2 defines
verified database identity, least-privilege roles, immutable ledger semantics,
backup evidence, migration frontier/convergence, and a bounded serialization
strategy.

Startup-to-migration coverage must be checked against independently reviewed
source expectations, not against the discovery algorithm's own output. Curated
annotations need exact source evidence; counts and prose alone are insufficient.
Resolved classifications require repository-controlled proof, never document-
supplied assertions of equivalence.

**Why:** Independent review found omitted aliased UPDATE statements despite
passing self-referential coverage tests, and forged resolution evidence passed
the original validator. A matching object name cannot prove transition semantics.

**How to apply:** Keep unknown classifications unresolved, pin separately reviewed
SQL coverage and curated source evidence, and adversarially test count-preserving
source drift, nested SQL, and fabricated evidence before trusting a crosswalk.