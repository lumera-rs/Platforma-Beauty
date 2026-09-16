# Additional startup operations — comprehensive evidence report

## Status: PASS — final evidence-artifact parity

This **read-only report assembly** is for declared baseline HEAD `6e7ac9411eb454b4aeddccd46444df1aa7e120bc` and canonical `lib/db/migrations/000001_canonical_schema/migration.sql` SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`. PASS means the final report evidence reconciles to the supplied crosswalk and validates against current source slices. It is not approval to execute, replay, move, retire, or compensate any operation; it validates report evidence, not production state.

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
| Exact slice / contained slice / verbatim executable literal | 24 / 91 / 7 |

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

## Artifacts and integrity

- [complete-report.md](complete-report.md) concatenates the final three source markdown reports and full normalized SQL/code evidence.
- [complete-evidence.json](complete-evidence.json) is the 110-record normalized array, retaining every rich source record verbatim.
- [verification.json](verification.json) contains PASS reconciliation, independent evidence/census counts, supplied command results, limitations, and SHA-256 hashes.

The following results were supplied by the main agent and **not rerun** for this assembly:

```sh
pnpm --filter @workspace/scripts run typecheck
pnpm --filter @workspace/scripts exec tsx --test ./src/startup-migration-crosswalk.test.ts ./src/production-startup-ddl-inventory.test.ts ../artifacts/api-server/src/lib/startup-ddl-safety.test.ts ./src/migrations/migrations.test.ts ./src/migrations/preflight.test.ts ./src/migration-contract/migration-contract.test.ts ./src/migration-contract/ci-migration-contract.test.ts
```

Supplied outcomes: typecheck **PASS**; test command **PASS 110/110**. These results are not production-state evidence. No application code or migration source was changed, and no Git-history modification was performed; only these report artifacts were assembled.
