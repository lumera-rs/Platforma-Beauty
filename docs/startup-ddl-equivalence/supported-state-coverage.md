# Supported startup-state migration coverage

This documents the immutable initial `000002` transition, not the completed
runtime frontier. Current readiness and startup removal are documented in
[supported-path-results.md](supported-path-results.md).

`000002_supported_startup_state` is intentionally a narrow, fail-closed
transition. It covers:

- canonical schema `000001`, or the one recorded fast-path function-fingerprint
  variant, with no other catalog differences;
- fresh or partially populated values for the eight startup reference tables,
  preserving existing rows and rejecting category, supplier-identity and
  ambiguous-singleton conflicts;
- unreferenced salon plans and exact education fallback rows only;
- an absent or existing version-99 salon-cleanup report whose four counters are
  all zero, with existing timestamps preserved;
- deterministic replacement of the known gift-voucher immutability function
  body, converging the accepted fast-path state to the canonical fingerprint.

All other public business tables must be empty. Current or pending subscription
links, obligations, users, salons, education centers, non-zero cleanup
provenance, rollout markers, empty historical snapshots and custom education
plans are rejected before migration ledger or data writes. The migration does
not write `business_growth_schema_rollout`, does not claim the 1,569 startup
operations equivalent, and does not reconcile historical tenants.

This is supported-state coverage only. The eight startup ensure calls remain
until the separate full-equivalence gate passes.

## Exact reference-data compatibility

The guard does **not** require previously configured settings to equal factory
defaults. The original source intentionally leaves these values untouched:

- Additional suppliers with neither the reserved slug nor reserved ID, and
  customized fields on the exact reserved supplier identity.
- Nonstandard category slugs. Every existing standard slug must match its
  source-defined name, subtype JSON, enabled flag and feature flag.
- Zero or one job-platform/shop/B2C settings row, with existing configured
  values retained. More than one row is rejected as ambiguous.
- Existing aftercare versions (including history), placement prices and scopes,
  and the existing education B2B configuration version.

Canonical constraints still apply to all these rows. Referencing business
tables, users, salons and centers must be empty; arbitrary tenant activity is
not admitted merely because its configuration table is on this list.

For matching categories, the replacement preserves `updated_at` instead of
refreshing it as the original upsert would. Conflicting standard categories
abort the entire migration rather than being overwritten. These are deliberate
compatibility differences, not strict full-row equivalence.

## Receipt and preflight boundaries

The `000002` migration ledger row records only this explicitly scoped
transition. It is committed atomically with its data/function changes.
Interruption rolls both back; it does not leave a fabricated completion or
failure receipt. The eight startup calls remain because no replacement for
the full historical rollout is claimed.

Baseline adoption may acknowledge `000001` only. It cannot acknowledge `000002`
from catalog equality. The baseline preflight explicitly returns
`scope=SCHEMA_BASELINE_ONLY` and `dataMigrationEligibility=NOT_ASSESSED`.
The migration executor performs the separate, lock-held data admission checks.

The original crosswalk remains unresolved globally. Its existing archived
records are annotated in `evidence/supported-operation-scope.json`; this does
not repeat inventory discovery or promote untested historical operations.