# Task #943 — production evidence plan

**Identity:** Task #943, *Plan prikupljanja produkcionih dokaza* (Plan for
collecting production evidence). This is a narrative, documentation-only plan.
It is not a migration plan, a production change request, or an authorization
to collect evidence.

The uploaded source specification was labeled Task #942; the plan was
implemented and delivered as Task #943. Neither existing task was renamed.

## Scope and current conclusion

The plan covers the complete resolution-review universe:

* 1,435 historical DDL mapping IDs and 1,459 source occurrences;
* 110 additional-operation IDs (data backfills, cleanup, functions, markers,
  locks/session lifecycles, and other operational work); and
* 1,545 stable review identities (`M ∪ O`), assigned to 960 primary
  object/lifecycle components across 1,044 referenced object groups.

Every mapping and additional operation is currently **UNRESOLVED**. No
production fact is established. Source, canonical SQL, checksums, tests,
development/fresh-schema shape, or a preflight response cannot prove that a
production operation ran, is safe to rerun, is retired, or is represented by
the canonical migration.

The comparison baseline is
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
It is a comparison point only.

## Primary components in scope

The inventory assignment is exhaustive and must be expanded from exact IDs;
it must not be replaced with owner-sized or name-sized guesses.

1. **B-00 inventory join:** all 1,545 records, 1,459 occurrences, object-group
   references, and primary assignments.
2. **B-01 Business Growth branch lifecycle:** intermediate repair, marker
   read, fast-current-marker path, full rollout, marker write, cleanup report,
   advisory lock, autocommit and recovery boundaries.
3. **B-02 bundle payment and target state:** full literals `4923`,
   `4928`, and function `4939`; fast-path payment backfill/function;
   Education payment backfill/function/trigger; learner-ID backfill; target
   constraint replacement; shared lock. Full, fast, intermediate, and final
   labels remain distinct.
4. **B-03 media asset relations:** `image_asset_status`, `users`,
   `image_assets`, `media_assets`, `media_variants`, and
   `media_upload_tickets`, including FK/type/index and transaction lifecycle.
5. **B-04 shipping singleton transition:** duplicate cleanup, survivor
   decision, `shipping_rules`, singleton unique index, locking, and restore.
6. **B-05 marketplace concurrent-index recovery:** all four concurrent-index
   operations and their one shared nontransactional session/lock/recovery
   lifecycle.
7. **B-06 referral tracking invariant:** tracking column, attribution/audit
   linkage, fallback timestamp policy, backfill, and transaction lifecycle.
8. **B-07 web-push expiry transition:** `expires_at` add, 24-hour backfill,
   null invariant, `NOT NULL`, delivery/retention compatibility, and
   lifecycle.
9. **B-08 booking idempotency scope:** receipt table, `salons` relation,
   four-key uniqueness, duplicate state, and lifecycle.
10. **B-09 object components:** every remaining exact connected component under
    `B-09-object-component/<leader>`, including components with no source edge
    yet. `NO_SOURCE_EDGE_YET` is a finding, not permission to omit a record.

The eight startup owners are reviewed in source reachability order:
Business Growth, Media, Shipping, Marketplace Performance, Referral, Web
Push, Booking Command, and Education Bundle. Owner order alone is not a
semantic dependency.

## Review outputs and statuses

Each reviewed identity and occurrence must retain its exact ID, source locator,
branch, object group, canonical locator (if any), evidence references,
unknowns, dependencies, authorization classification, and independent-review
disposition. The permissible methodology outcomes are
`CANONICAL_BASELINE`, `FUTURE_MIGRATION_REQUIRED`, or
`RETIRED_HISTORICAL`; absent every applicable gate, the result remains
`UNRESOLVED`. A DDL result never resolves a related additional operation.

The future package must separate observed fact, allowed inference, and any
decision. It must include target/release identity, collector, capture time,
immutable digest, exact IDs/occurrences, privacy/retention rules, freshness
triggers, and reviewer disposition. See `collection-sequence.md` for the
ordered gates and `production-access-safety.md` for access controls.

## Explicit non-authorization

Task #943 authorizes none of the following: obtaining credentials, connecting
to production, reading a catalog or row, running preflight against production,
executing startup DDL, creating a migration, changing a marker/ledger,
backfilling, deleting, deploying, adopting, retiring, or changing a status.
Any later collection requires a separate written authorization and must stop
at its independent-review gate.
