---
name: Job publication legacy boundary
description: Conservative handling of listings whose first public visibility predates reliable recording.
---

Listings created before the publication migration's successful ledger completion retain the creation-time approximation when their first-publication field is empty, including after later approval or renewal. Post-migration listings record their first actual public transition; renewal cannot change a recorded date.

**Why:** Moderation history lacks historical expiry/status, so it cannot distinguish a formerly public legacy listing from one never published. Stamping an old empty record at renewal would invent a later original publication date. Even an old pending listing is conservatively treated as legacy rather than claiming recoverable history.

**How to apply:** Keep the authoritative ledger boundary and documented approximation consistent across API, rendered dates, and structured data. Do not infer first visibility by comparing old audit entries to current expiry. Missing publication data and invalid non-null timestamps are distinct; only missing values use the approximation.

Resolve optional publication evidence outside business transactions and cache only successful immutable evidence. Unavailable evidence must preserve existing dates and allow moderation with a warning.

**Why:** Missing ledger tables or revoked SELECT privileges abort PostgreSQL transactions, not merely the date calculation. Production role separation must not make approval or renewal depend on metadata privileges.

**How to apply:** Bind the previously resolved cutoff into updates. Test real missing-table and non-superuser privilege failures with a cold cache; a missing-row test alone cannot prove transaction safety.