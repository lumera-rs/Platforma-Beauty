# Supported deployment paths and startup DDL removal

This records the original implementation and evidence. Subsequent independent
review findings, corrections, current commands and review status are in
[Phase 5 review remediation](phase5-review-fixes.md). The branch/working-tree
observations and temporary command paths below describe that original run,
not the current review branch.

## Decision and limits

All eight startup ensure imports/calls were removed from the development
branch. The API now performs a read-only ledger and canonical-catalog check
before reconciliation, listeners, HTTP serving or workers. It never repairs
the database at startup.

This is a **supported-path decision**, not a claim that every historical
database is migratable. No production connection, production configuration,
production secret, published database query, publish, workflow restart,
merge or push was performed.

Branch: `remove-startup-ddl-preparation`.
Observed HEAD: `77a3a9ae639c4ace13aa44ea539d7e2b8d49b4bc`.
Changes remain in the working tree; the supplied request attachment remains
untracked. The exact final file/status inventory is in
`evidence/supported-paths/working-tree.txt`.

## Exact supported paths

The canonical evidence was captured on PostgreSQL **16.10** with its pinned
deparser environment. The corrected compatibility policy admits reviewed
PostgreSQL **16 patch releases only when the exact canonical catalog and all
other readiness checks still match**; the original manifest remains immutable.
Only the `public` application namespace is supported; additional user
namespaces are refused rather than silently ignored.

| Path | Required state | Action |
| --- | --- | --- |
| A | Empty application catalog, no ledger or unknown objects | Atomically apply `000001` and `000002`, then boot |
| B1 | Exact canonical or the one pinned known-fast catalog; valid `000001` receipt; compatible global configuration; no tenant/business history | Apply `000002`, converge to canonical, then boot |
| Explicit B1 adoption | Exact canonical catalog and the same supported initial data; no prior receipt | Explicitly acknowledge `000001` under locks, then actually execute `000002`; never adopt the data step |
| B2 | Complete valid `000001`/`000002` frontier and exact canonical catalog, followed by ordinary runtime-created data | Skip completed migrations; validate catalog/receipts and boot without replaying bootstrap predicates |
| C | Missing/invalid/incomplete receipts, catalog drift, extra user namespaces, ambiguous initial data, unsupported history or receipt timestamps | Refuse before ledger/data mutation and before API serving |

B1 accepts the precise configuration compatibility rules in
`supported-state-coverage.md`: eight reference groups, unreferenced salon
plans, exact unreferenced education fallback plans and truthful zero-candidate
cleanup evidence. Conflicting categories, ambiguous singleton settings,
supplier identity collisions, referenced subscriptions, obligations and
historical tenant data are not admitted into that initial transition.

Completed-frontier evidence is trusted migration history, not a means to
launder legacy data by manually fabricating receipts. Out-of-band historical
imports and arbitrary older schema versions are not claimed supported.
These fixtures say nothing about the actual published database.

## Complete operation-level assessment

The original 1,569-record crosswalk was reused, not rediscovered. The complete
67-record historical operation matrix is:

- `historical-operation-matrix.md` — interpretation and generation command.
- `evidence/historical-operation-matrix.json` — every operation ID, exact SQL
  template or complete curated source range, source pin, affected tables,
  dependencies, reconstruction limits, safe-migration decision and A/B1/B2/C
  applicability; plus three separately documented rollout/cleanup reads/writes.

The eight owner-file pins and immutable baseline checksum are checked.
The matrix contains 61 exact SQL templates and six complete curated excerpts.

| Scope | Remaining mandatory historical transitions |
| --- | --- |
| A / B1 | None beyond the ten already-covered reference/fallback/empty-cleanup records in `000002`; the other 57 require no historical data transformation under enforced admission |
| B2 | None of the 67 operations is replayed after the completed frontier |
| C | All 67 remain refused for unknown historical inputs; 49 require separately reviewed historical migrations, eight concern refused legacy subscription relationships, and ten cover only the already-proven bounded initialization subset |

The complete unknown-history list includes payment-instruction snapshots;
supplier, catalog and cart relationships; duplicate cleanup; order-line and
package entitlements; learner identity/access/payment snapshots; subscription
plan cloning, relinking and frozen terms; referral history; shipping-row
deduplication; and provenance-dependent salon detachment/retirement/deletion.
The JSON, rather than this grouped summary, is the exhaustive operation list.

No populated historical transition was called equivalent merely because an
empty fixture passes. Schema/control operations outside those 67 records use
the existing canonical-schema evidence: the first full original startup and
canonical migration have identical structural/physical fingerprints, 5,060
normalized objects, 103 enums, 24 triggers and 21 functions. The known repeat
function variant converges through `000002`; no normalization was relaxed.

Legacy rollout completion is obsolete startup bookkeeping on these paths.
No `business_growth_schema_rollout` completion row is synthesized. A numbered
receipt represents only its actual committed work; the empty cleanup audit
represents an actually empty candidate set.

## Implemented changes

No new SQL migration was necessary for the admitted paths. Both existing
numbered migrations remain byte-for-byte unchanged:

| Migration | SHA-256 |
| --- | --- |
| `000001_canonical_schema` | `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60` |
| `000002_supported_startup_state` | `a8c910eb9bd60281aa80e343b4b1d6e02a45222293b123ab198fab4315d48e62` |

Implementation:

- `scripts/src/migrations/deployment-eligibility.ts` and CLI: executable
  `FRESH_EMPTY` / `SUPPORTED_EXISTING` / `UNSUPPORTED` classification with
  explicit development targeting; production eligibility is `NOT_ASSESSED`.
- `scripts/src/migrations/runner.ts`: full receipt validation before mutation;
  no empty-bootstrap recheck after completion; guarded atomic supported
  adoption; no automatic adoption or ADOPTED data receipts.
- `lib/db/src/migration-runtime/`: existing catalog/model/fingerprint code
  factored into a shared read-only module, exact compatibility metadata,
  namespace boundary and strict readiness assertion. The API leases one
  connection; direct-client inspection does not connect or release it.
- Existing `scripts/src/schema-drift/` paths remain compatibility reexports.
  Source-audit tests traverse the real shared implementations, not merely
  allow the new package name.
- `artifacts/api-server/src/index.ts`: all eight ensures removed, readiness
  required before any startup data mutation.
- `scripts/src/migrations/prepare-development.ts`,
  `scripts/src/ensure-development-schema.ts`, `scripts/post-merge.sh`:
  migration-only development preparation, eligibility before writes, no
  automatic schema push/adoption or legacy schema-helper calls.
- `scripts/src/startup-ddl-removal-gate.ts`, package scripts and the existing
  GitHub CI migration job: strict live zero-startup-DDL guard. Historical
  inventory fixture tests remain separate from the new live assertion.
- `business-growth-schema-boot-regression.test.ts`: missing schema now proves
  refusal and state preservation, not implicit startup repair.

The eight removed symbols are `ensureBusinessGrowthSchema`,
`ensureMediaSchema`, `ensureShippingConfigSchema`,
`ensureMarketplacePerformanceIndexes`, `ensureReferralSchema`,
`ensureWebPushSchema`, `ensureBookingCommandSchema` and
`ensureEducationBundlePurchaseSchema`. Their historical implementations remain
available as evidence/test support, not startup calls.

## Verification and evidence

Only newly owned child databases in a temporary loopback PostgreSQL cluster
were used. The temporary URL is not a development or production project URL.
No browser or full unrelated release/UI suite was run.

| Verification | Actual result / evidence |
| --- | --- |
| Proposed entrypoint before removal | 4/4 PASS; proof retained in actual proof's candidate-history fields |
| Actual checked-in entrypoint | 4/4 PASS covering A, configured B1, ADOPTED known-fast B1, B2 and four C cases; `evidence/supported-paths-actual-proof.json` |
| Supported application boot | HTTP health, unchanged catalog, zero startup DDL for each supported boot |
| Unsupported application boot | No health, no startup DDL, unchanged data/receipts for missing ledger, unknown catalog, ambiguous history and FAILED receipt |
| Explicit adoption / receipt boundary | 1/1 integration test, with four boundary checks; `evidence/supported-paths/adoption-boundary.txt` |
| Migration/readiness/CI unit batch | 99/99 PASS; `evidence/supported-paths/unit-tests.txt` |
| Fingerprint/schema/eligibility batch | 121/121 PASS; `evidence/supported-paths/fingerprint-tests.txt` |
| Final combined source/fingerprint/migration batch | 156/156 PASS after adding the reviewed namespace module to the exact read-only dependency graph |
| Public-only namespace boundary | 1/1 disposable integration test; positive canonical state and rejection before fresh writes / runtime boot readiness |
| Existing boot regression | 1/1 PASS; refusal replaces repair |
| Tenant isolation | Exit 0, 65 assertion markers and final success message; `evidence/supported-runtime-regressions/tenant-isolation.txt` |
| Booking development schema | Exit 0; replay-safety and production guards pass |
| Appointment regressions | Exit 0; lifecycle, P1, concurrency, capacity/CRUD, HTTP and widget rate limits pass |
| Live startup CI gate | PASS, 148 modules scanned |
| Backend static aggregate | PASS: inventory fixtures 5/5, historical crosswalk 16/16, safety 12/12, static standards 13/13 |
| Migration contract tests | 60/60 PASS; local migration validator and workflow lint also pass |

The final command transcript, namespace-boundary result, complete TypeScript
result, immutable hashes and cleanup evidence are in
`evidence/supported-paths/final-verification.txt`.
Version-controlled boot output is retained as
`evidence/supported-paths/actual-boot.txt`,
`actual-boot-command.txt` and `legacy-boot-refusal.txt`.
The complete entrypoint suite preceded the final stricter namespace check;
that additional check was subsequently verified separately against the
canonical positive state and unknown-schema negative states.

Important commands (run with `NODE_ENV=test` and ambient project database/
deployment variables removed for disposable suites):

```sh
pnpm --filter @workspace/scripts exec tsx \
  src/migrations/supported-path-boot.integration.test.ts \
  --admin-url=postgres://path_proof_owner@127.0.0.1:39523/postgres \
  --sql-log=/tmp/replit-shell-output-logs/EXTXZ3EMNKP1HIJ7W8R07/log

pnpm --filter @workspace/scripts exec tsx \
  src/migrations/adoption-boundary.integration.test.ts \
  --admin-url=postgres://path_proof_owner@127.0.0.1:39523/postgres

pnpm run test:tenant-isolation
pnpm run test:booking-development-schema
pnpm run test:appointment-regressions
pnpm run validate:ci:startup-ddl-removal-gate
pnpm --filter @workspace/scripts run test:backend-standards:static
pnpm run typecheck
git diff --check
```

Final source/fingerprint/migration unit command:

```sh
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
  src/migrations/migrations.test.ts src/migrations/preflight.test.ts \
  src/migrations/deployment-eligibility.test.ts src/migrations/prepare-development.test.ts \
  src/migrations/historical-operation-matrix.test.ts src/migrations/migration-runtime-parity.test.ts \
  ../lib/db/src/migration-runtime/contract.test.ts ../lib/db/src/migration-runtime/namespaces.test.ts \
  src/schema-drift/fingerprint.test.ts src/schema-drift/schema-drift.test.ts \
  src/schema-drift/eligibility.test.ts src/schema-drift/eligibility-cli.test.ts
```

The final owned-cluster census found **zero** child databases. The temporary
PostgreSQL process was then stopped, and its stopped state was checked.

For the existing database-backed regression commands above, the subprocess
received only the newly owned child database URL, never ambient DATABASE_URL.
See the preserved regression logs for exact child identity and cleanup.
Do not copy the temporary URL after the test cluster has been stopped.

The first boot attempts exposed a nonthrowing readiness assertion; it was
corrected and the complete actual-entrypoint proof passed afterward.
Read-only source-audit tests were updated after factoring the shared module,
without removing mutation checks. One additional fixture attempt had a
parameterized interval syntax error after its first three assertions; the
corrected checked-in adoption test subsequently passed in full.

## Separate readiness verdicts

- **Development merge:** supported-path implementation and local verification
  are ready for review/merge on the stated A/B contract. This is not a claim
  that the current workspace database is eligible: that target was not
  inspected or migrated, and startup/preparation intentionally refuse C.
- **Live deployment:** **NOT READY / NOT AUTHORIZED**. Published schema/data,
  target identity, backups, roles, migration execution, rollout ordering and
  rollback/recovery remain unverified. Development-only migration execution
  guards were not removed. No production readiness can be inferred from these
  fixtures, and no actual GitHub Actions run is claimed.

Managed application workflows were not restarted. Their preview state is not
the disposable application-boot result. The existing API workflow was reported
failed by the platform; it was not restarted or used as proof of a successful
current-workspace boot.