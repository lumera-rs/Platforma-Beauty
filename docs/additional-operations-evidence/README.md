# Additional startup operations — comprehensive evidence report

## Status: PASS — final evidence-artifact parity

This **read-only report assembly** is for declared baseline HEAD `6e7ac9411eb454b4aeddccd46444df1aa7e120bc` and canonical `lib/db/migrations/000001_canonical_schema/migration.sql` SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`. PASS means the final report evidence reconciles to the supplied crosswalk and validates against current source slices. It is not approval to execute, replay, move, retire, or compensate any operation; it validates report evidence, not production state.

The independent review examined HEAD `91b6b162b6b491a5dc76f90cb55de9894c199de6`, distinct from the pinned evidence-source commit above. Its original 6/6 validator result did not detect narrative rewrites or truncated SQL and is superseded by the repair validation recorded in `verification.json`. Uploaded instruction files are not evidence of Git cleanliness: final HEAD and working-tree status are reported separately at delivery.

The canonical normalized 110-record set is `complete-evidence.json`. The component JSON files (`bg-data.json`, `bg-functions.json`, and `other-owners.json`) are source workbooks used to assemble and inspect evidence; they are not alternate canonical record sets. The literal census is reproduced and checked by `pnpm --filter @workspace/scripts run test:additional-operations-evidence`.

## Completeness and reconciliation

| Measure | Result |
| --- | ---: |
| Crosswalk additional-operation IDs / rich report records / distinct IDs | 110 / 110 / 110 |
| Exact `id + owner + sourcePath` parity | 110 / 110 |
| Missing IDs / extra IDs / duplicate IDs / owner mismatches / sourcePath mismatches | 0 / 0 / 0 / 0 / 0 |
| Crosswalk categories | 67 data-backfill; 33 function-replacement; 7 operational-scaffolding; 2 rollout-marker; 1 cleanup-reporting |
| Independent AST census | 103 literals: 70 data mutation + 33 function replacement |
| Census-represented IDs / non-census scaffolding-read-report IDs | 101 / 9 |
| Two-literal grouped IDs | 2: `business-growth/bundle-payment-backfill`; `education-bundle/payment-reference-backfill` |
| Independently validated rich `sourceEvidence` items | 122 / 122 |
| Exact slice / full reviewed claim contained in slice / reverse containment | 31 / 91 / 0 |

Owner counts: Business Growth 98; Education Bundle 4; Referral 2; Web Push 2; Booking Command, Marketplace, Media, and Shipping 1 each. `sourcePath` now uses the crosswalk-authoritative locator exactly; expanded contextual spans remain separately preserved as `evidenceSourcePath` where applicable, without discarding any `sourceEvidence`.

## Cautious semantic reading

The report proves current static text, literal locations, final source-slice/crosswalk parity, and stated canonical comparisons. It does not prove a production operation ran, completed, is safe to replay, or may be removed. Each top-level owner call is awaited before listen on startup, while individual nested work—especially Business Growth—is branch-, marker-, catalog-, or data-state-dependent.

Canonical `000001` is a fresh schema baseline, not proof that historic backfills, markers, cleanup/report reads, locks, session behavior, trigger bindings, or function replacements occurred in an existing environment. The final evidence distinguishes subscription-plus-kind earliest-row behavior from subscription newest/upgrade behavior and identifies the autocommit index-transition context; neither observation resolves safety or business correctness. All crosswalk operations remain `UNRESOLVED`.

## Prioritized unresolved questions

1. **Role/authorization:** validate historic role conversion, owner assignment, enum-label, grant, and trigger-invoker authority.
2. **Payments:** establish that reference generation/reconciliation, snapshots, and immutability policies are unique, lawful, and compatible with financial records/workflows.
3. **Data:** characterize nulls, duplicates, divergent snapshots, cleanup candidates, report inputs, and approved compensation in a permitted read-only environment.
4. **Functions/triggers:** inspect deployed bodies, bindings, dependent columns/constraints, search paths, and privileges; same names do not prove equivalent semantics.
5. **Locks/lifecycle:** establish lock coordination and error/pool/timeout/search-path/GUC/rollback behavior under partial autocommit and concurrent starts.
6. **Production unknowns:** establish actual marker/ledger versions, schema/data state, deployment path, and operational ownership.

## Reproducible provenance

The authoritative crosswalk is regenerated from repository sources in a
temporary archive of the pinned commit (the working tree is never used for
execution) with:

```sh
set -eu
archive="$(mktemp -d)"
git archive --format=tar 6e7ac9411eb454b4aeddccd46444df1aa7e120bc |
  tar -xf - -C "$archive"
(
  cd "$archive"
  corepack pnpm install --frozen-lockfile
  corepack pnpm --filter @workspace/scripts exec tsx \
    ./src/startup-migration-crosswalk.ts --json
)
rm -rf "$archive"
```

The pinned source commit is `6e7ac9411eb454b4aeddccd46444df1aa7e120bc`.
The normalized record contract is checked by
`scripts/src/additional-operations-evidence.test.ts`.

### Lossless narrative normalization and review authority

All 110 persisted records use the same nested narrative structure:
`summary` plus `details: [{path, statement}]` for canonical comparison,
execution, effects and repeat safety. Assessment additionally requires
`status: "UNRESOLVED"`; state dependence additionally requires
`dependsOnCurrentProductionState: true`. Every original scalar value is
retained in `details` under its original field path. The summary duplicates
an existing statement rather than replacing it. All uncertainties, SQL,
source evidence and identity fields remain unchanged.

The reviewed narrative authority is commit
`91b6b162b6b491a5dc76f90cb55de9894c199de6`, evidence SHA-256
`866fb8e2516bbbd5696264d1e43a0ca10be2e80255df5366f9b8354553e606da`.
The validator normalizes that immutable input only, never the submitted
records, and requires complete equality. Updating a document checksum alone
therefore cannot authorize changed narrative or a shortened SQL claim.
The user authorized deterministic regeneration of `complete-evidence.json`
only. Per-record before/after checks preserved 2,364 original narrative
scalar values and all 122 source-evidence items, with no content loss.

## Artifacts and integrity

- [complete-report.md](complete-report.md) concatenates the final three source markdown reports and full normalized SQL/code evidence.
- [complete-evidence.json](complete-evidence.json) is the complete 110-record normalized array, retaining every rich source record verbatim and carrying the required top-level contract fields.
- [verification.json](verification.json) contains PASS reconciliation, independent evidence/census counts, supplied command results, limitations, and SHA-256 hashes.
- [DDL-RESOLUTION-METHODOLOGY.md](DDL-RESOLUTION-METHODOLOGY.md) defines review gates for the 1,435 DDL mappings only and is included in integrity verification. The 110 additional operations require separately reviewed resolution gates before any removal.

The repair runs documentation validation, TypeScript typecheck and the focused
startup crosswalk/inventory/safety regression suite:

```sh
pnpm --filter @workspace/scripts run test:additional-operations-evidence
pnpm --filter @workspace/scripts run typecheck
pnpm --filter @workspace/scripts exec tsx --test ./src/startup-migration-crosswalk.test.ts ./src/production-startup-ddl-inventory.test.ts ../artifacts/api-server/src/lib/startup-ddl-safety.test.ts
```

Exact results appear in `verification.json`; the older broader 110-test result
is historical, not a claim that the broader suite was rerun for this repair.
The validator checks every integrity entry against actual bytes and recomputes
source-evidence statistics. Counts alone cannot establish narrative integrity:
the normalized evidence must also match the separately pinned reviewed evidence.
These checks are not production-state evidence and authorize no removal.
