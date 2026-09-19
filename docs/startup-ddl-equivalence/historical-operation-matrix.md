# Historical operation matrix

This is the operation-level decision record for the **exact 67**
`historical-backfill` records in the archived 1,569-operation crosswalk. It
does not use the obsolete failed characterization output and does not rerun
startup inventory discovery.

Generate the evidence JSON from the repository-pinned archive:

```sh
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/migrations/historical-operation-matrix.ts \
  --archive=/tmp/lumera-ddl-equivalence-report/operation-crosswalk.json \
  --scope=docs/startup-ddl-equivalence/evidence/supported-operation-scope.json \
  --output=docs/startup-ddl-equivalence/evidence/historical-operation-matrix.json
```

The generator refuses to proceed unless the archive has exactly 1,569
operations, eight owner pins and exactly 67 historical-backfill records. It
checks all eight complete owner-file SHA-256 pins and the canonical `000001`
migration hash. Every record contains either the complete archived SQL template
or the complete source excerpt for a curated range, plus affected tables,
dependencies, source-data requirements, path decisions and a concrete
disposition. The generated JSON also contains a separate `runtimeOperations`
array with exactly three records: rollout-marker read, rollout-marker write and
cleanup-report read. Each includes the complete source range, affected table,
consumer proof and per-path necessity.

## Decision vocabulary

| Field | Meaning |
| --- | --- |
| `sourceSemanticsReconstructable` | Whether repository source is complete enough to describe the operation. |
| `dataStateReconstructableWithoutProductionEvidence` | Whether the historical before-values/ownership needed for populated rows are established. |
| `A_fresh_canonical_empty` | Fresh `000001` schema before supported startup data. A predicate can be `NOOP` here only when its empty result is explicitly vacuous. |
| `B1_canonical_global_refs_no_tenants` | Canonical existing schema with baseline evidence, global configuration only, and no tenant/business activity. |
| `B2_post_002_ordinary_runtime` | A legitimately migrated database after `000002` has been applied and ordinary runtime rows exist. It is not permission to replay bootstrap backfills. |
| `C_unknown_old_historical` | An unknown or pre-canonical history. It is always refused by this matrix; no production facts are inferred. |

## Supported and refused work

`000002_supported_startup_state` covers the eight guarded global/reference
operations, the exact unreferenced education fallback subset, and the
proven-empty cleanup audit. It also converges the known function identity
variant, although that catalog operation is not one of the 67 historical rows.
The matrix marks those records `IMPLEMENTED_IN_000002`.

For a fresh empty catalog, many other `UPDATE`, `DELETE`, and guarded `DO`
blocks are `NOOP`: their predicates have no rows. This is a deterministic
fresh-path conclusion, not evidence that their populated transformation is
safe. On B1 they are `CONDITIONAL` unless their source predicates and global
dependencies are explicitly proven empty or already canonical.

On B2, a committed `000002` receipt is the boundary and **all 67 historical
records are `NOOP` for deployment eligibility**: legacy backfills are not
automatically replayed against ordinary runtime data. This includes the eight
plan-relationship records; an ordinary runtime subscription is valid after the
receipt and is not refused merely because an old bootstrap repair exists.
If an operator ever elects to admit a legacy relationship or other populated
repair, that is a separate migration requiring an independently reviewed
receipt/manifest, exact before-values, ownership and tenant rules, retry
semantics, and operation-specific tests. Current plan relinking, missing
subscriber snapshots, issued payment obligations, and audit history remain
`REFUSE` only for C (unknown/legacy history), not for A, B1 or B2.

For B1, all 57 non-000002 records target tables outside the admitted global
reference allowlist and are therefore `NOOP` under `assertEmptyBusinessTables`;
the ten records covered by 000002 are `YES`. This is a table-state conclusion,
not a keyword heuristic: the matrix extracts target tables, removes only
source CTE/system names, and applies the same canonical supported-state
allowlist. No `DO` block is called vacuous merely because it contains `DO`.

The exact source SQL includes supplier/catalog, cart-reference and duplicate
cleanup, payment/reference and snapshot backfills, education enrollment/access,
referral, web-push expiry, shipping duplicate cleanup and other transformations.
These operations may be semantically readable from source, but they are not
globally equivalent merely because a fresh fixture has no matching rows.

## Rollout and historical boundaries

Rollout bookkeeping is separate from business transformations. A marker write
must never claim completion for unresolved operations. The supported migration
does not write `business_growth_schema_rollout`; its own ledger receipt covers
only its own operation subset.

The marker read is a fast-path/repair branch condition, not data-migration
evidence. The marker write is not needed on A or B1 and is intentionally not
replayed on B2 after a committed `000002` receipt. The cleanup-report read is
an informational post-startup consumer; it cannot establish legacy candidate
provenance. After startup ensure removal, all three have no API consumer and
are `NONE_OBSOLETE_BOOKKEEPING`; no legacy completion is fabricated. They are
recorded separately from the 67 historical backfills and do not create a
fresh/B1/B2 migration blocker.

## Effective blockers for the chosen paths

- **A, fresh empty:** No one of the 67 historical operations is mandatory.
  `000001` and the admitted `000002` data/function transition, followed by a
  real no-startup-DDL boot proof, are the required path.
- **B1, canonical baseline plus global references and no tenant data:** No
  historical operation is mandatory beyond the ten already covered by
  `000002`; the other 57 are proven empty by the exact target-table
  eligibility boundary.
- **B2, valid `000001` + `000002` ledger followed by ordinary runtime data:**
  No historical backfill is replayed or required. The runner trusts the
  contiguous committed receipt and skips bootstrap admission on repeat.
- **C, unknown/legacy history:** The 67 records are not silently accepted.
  The eight relationship operations and the 49 populated repair families
  require a separate reviewed migration only if this path is ever admitted.

Therefore the historical matrix supplies **no mandatory blocker for A, B1 or
B2**. Remaining deployment blockers are the independent boot/no-DDL proof and
coverage of the eight ensure owners' schema contracts; those are outside this
operation-evidence tool.

No record in this matrix authorizes startup DDL removal. The eight production
ensure paths remain until an independent boot/no-DDL proof and complete
operation coverage pass. No fixture is treated as the published database, and
no production configuration, secret or database was accessed.