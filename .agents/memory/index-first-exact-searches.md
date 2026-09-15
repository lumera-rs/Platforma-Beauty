---
name: Index-first exact searches
description: How to keep exact and legacy-compatible lookups index-driven and deterministic.
---

**Rule:** Every branch of an exact-match `OR` must be independently index-backed. If canonical and legacy-normalized rows may both match, select the canonical row deterministically before deduplication.

**Why:** Moving a filter from memory into SQL does not bound database work when one `OR` branch still evaluates an expression across the table. PostgreSQL also sorts nulls first by default for `DESC`, which can make a legacy null row beat a canonical match unless null ordering is explicit.

**How to apply:** Materialize expensive legacy normalization into an indexed generated column where needed, index canonical lookup keys globally when lookup scope is global, and use explicit `NULLS LAST` for descending canonical-preference expressions. Validate every lookup branch with plan assertions and realistic cardinality.