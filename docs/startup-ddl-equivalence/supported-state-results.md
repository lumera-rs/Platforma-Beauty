# Numbered supported-state migration — implementation and verification

Historical implementation record. The current supported paths, startup
removal decision and verification are in
[supported-path-results.md](supported-path-results.md).

## Historical status before startup removal (superseded)

| Requested outcome | Status |
| --- | --- |
| A. Migration equivalence | **BLOCKED** — the supported subset passes; populated historical transitions remain unsupported. |
| B. Startup DDL removal | **THEN NOT STARTED** — all eight imports/calls were unchanged at this checkpoint; they have since been removed for the proven supported paths. |
| C. Live test deployment | **BLOCKED** — no production access or authorization is inferred. |

Branch: `remove-startup-ddl-preparation`.
Starting/observed HEAD: `f725ed721554b6af0bb4d0f9a43396a305fa3cfb`.
Implementation is in the working tree, not manually committed, merged, pushed
or published. This is not a deployment candidate.

## Numbered migration and eligibility

New schema-manifest migration:
`lib/db/migrations/000002_supported_startup_state/migration.sql`.

SHA-256: `a8c910eb9bd60281aa80e343b4b1d6e02a45222293b123ab198fab4315d48e62`.

Immutable `000001` is unchanged:
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
The earlier separate data-namespace steps are unchanged too.

The machine-checkable admission contract accepts:

1. An empty application catalog, followed by atomic `000001` + `000002`.
2. The exact canonical catalog with a valid baseline ledger, or the one recorded
   fast-path catalog variant whose only known difference is function formatting.
3. Empty or compatible partial reference configuration, as specified in
   [supported-state-coverage.md](supported-state-coverage.md). Existing custom
   configuration is retained where the original source explicitly leaves it alone.
4. Unreferenced salon plans and exact unreferenced Education Start/Growth/Academy
   fallback payloads. IDs and existing timestamps are not replaced.
5. No users, salons, centers, subscriptions, payment obligations or other business
   activity. All non-allowlisted public business tables must be empty.
6. An absent cleanup report, or version 99 with four zero counters. Empty owner,
   salon and center tables prove the cleanup candidate set empty; no historical
   salon is deleted, detached or retired by this migration.

It rejects unsupported schemas/functions, absent baseline evidence on existing
schemas, invalid ledger history, category conflicts, ambiguous singletons,
supplier identity collisions, custom education plans, historical relationships
and snapshots, nonzero/unsupported cleanup evidence, and existing rollout markers.

Even **complete** subscription snapshots do not admit a populated historical
tenant in this version. Supporting those transitions requires further work.

## Transaction, audit and compatibility behavior

- The migration lock, actual BusinessGrowth lock and stable table locks protect
  admission and execution. Rejection happens before ledger/data writes.
- Data, schema changes and migration receipts share one transaction. A terminated
  connection leaves the prior ledger and data intact; retry replays the pending
  work rather than inventing completion.
- Explicit baseline adoption acknowledges only `000001`. It never acknowledges
  `000002` based on schema equality. Automatic adoption is not introduced.
- Baseline preflight explicitly says `SCHEMA_BASELINE_ONLY` and
  `dataMigrationEligibility=NOT_ASSESSED`; execution performs separate admission.
- `000002` inserts the eight reference-data groups, missing exact fallback plans
  and a genuine empty-candidate cleanup audit, then restores the canonical voucher
  immutability function body.
- No `business_growth_schema_rollout` completion row is written. The `000002`
  receipt represents only its own scoped operations, not the complete rollout.
- Known function formatting is resolved by accepting exactly two pinned complete
  catalog fingerprint pairs and converging to the canonical definition. Arbitrary
  function changes are rejected. No broad whitespace/body normalization is added.
- Matching categories preserve their existing update timestamps; conflicting
  standard category payloads reject rather than overwrite. This intentionally
  differs from the original category upsert.
- New admission-contract execution rejects deployment runtime flags. No
  production capability is enabled by these development proofs.

## Actual verification

Only newly generated, owned child databases in a new PostgreSQL 16.10 cluster
were used. The passwordless loopback URL below identifies that temporary test
cluster, not an existing development or published database.

```sh
# 15/15 PASS, zero failures/skips.
env -u DATABASE_URL -u REPLIT_DEPLOYMENT -u REPLIT_DEPLOYMENT_ID \
  -u REPLIT_ENVIRONMENT NODE_ENV=test \
  pnpm --filter @workspace/scripts exec tsx \
  src/migrations/supported-state.integration.test.ts \
  --admin-url=postgres://supported_migration_owner@127.0.0.1:40247/postgres

# 4/4 PASS, zero failures/skips.
env -u DATABASE_URL -u REPLIT_DEPLOYMENT -u REPLIT_DEPLOYMENT_ID \
  -u REPLIT_ENVIRONMENT NODE_ENV=test \
  pnpm --filter @workspace/scripts exec tsx \
  src/migrations/supported-convergence.integration.test.ts \
  --admin-url=postgres://supported_migration_owner@127.0.0.1:40247/postgres

# 76/76 PASS, zero failures/skips.
env -u DATABASE_URL NODE_ENV=test \
  pnpm --filter @workspace/scripts exec tsx --test \
  src/migrations/migrations.test.ts src/migrations/preflight.test.ts \
  src/migration-contract/migration-contract.test.ts \
  src/migration-contract/ci-migration-contract.test.ts

# PASS, no diagnostics.
pnpm --filter @workspace/scripts exec tsc -p tsconfig.json --noEmit

# PASS.
git diff --check
```

The main suite executes AST-extracted, source-pinned **original startup SQL** for
eight reference inserts, the bounded original plan operations and the original
version-99 cleanup block. It compares those results to the new migration.
It does not substitute the earlier replacement data steps for the original.

Proofs include fresh/repeated apply, supported partial configuration, retained
IDs/timestamps, null and populated subscription snapshot refusal, category and
plan conflicts, explicit adoption of baseline only, rejection of ADOPTED data
receipts, concurrent apply, actual backend termination before commit/recovery,
and the actual FK-backed voucher trigger rejecting immutable-field changes.
The additional suite proves fast-path convergence, genuine-function and extra-
object rejection, cleanup audit consistency and deployment-flag refusal before
any client query.

Initial runs exposed fresh-state and fingerprint-session handling bugs, which
were corrected. Subsequent fixture failures involved invalid fixture enum values
and comparing independently generated timestamps; final passing logs are retained.
The original manifest test was updated to assert both immutable entries and
the new entry's admission contract, rather than incorrectly expecting one entry.

Final logs:

- `evidence/supported-state-tests.txt`
- `evidence/supported-convergence-tests.txt`
- `evidence/supported-unit-tests.txt`

Final cleanup queried the temporary cluster and found **zero** non-template
child databases. The temporary server was stopped; a subsequent `pg_ctl status`
independently returned `no server running`.

No complete release/CI suite, application HTTP boot, or successful migration of
populated tenants is claimed. Application workflows were not restarted.
An independent read-only code review was performed; it is not represented as
Claude Code review or authorization to run against a published database.

## Remaining operation-level work

The existing 1,569-record crosswalk was reused, not rediscovered.
`evidence/supported-operation-scope.json` annotates its 110 additional records,
including all 67 historical-backfill records. It retains their source identities
and explicitly avoids global equivalence claims.

Required populated transitions still include, among others:

- Plan cloning/relinking, tier and missing-term reconstruction, pending links
  and financial history.
- Salon cleanup with actual candidates and verifiable ownership/provenance.
- Supplier/catalog and issued order-line backfills, package entitlement quotas,
  payment instruction/reference snapshots, learner identity/access snapshots,
  referral history and deduplication.
- The complete rollout completion frontier and its receipt semantics.

Empty or refused inputs are not evidence that these populated transitions are
equivalent. This initially blocked startup removal. The later supported-path
decision removed startup DDL only for admitted states and kept unknown history
refused; it did not claim global equivalence.

## Exact changed files

Executable migration and implementation:

- `lib/db/migrations/000002_supported_startup_state/migration.sql`
- `scripts/src/migrations/manifest.ts`
- `scripts/src/migrations/types.ts`
- `scripts/src/migrations/runner.ts`
- `scripts/src/migrations/preflight.ts`
- `scripts/src/migrations/supported-state.ts`
- `scripts/src/migrations/supported-state-contract.ts`
- `scripts/src/migrations/supported-coverage.ts`

Tests:

- `scripts/src/migrations/migrations.test.ts`
- `scripts/src/migrations/supported-state.integration.test.ts`
- `scripts/src/migrations/supported-convergence.integration.test.ts`

Reports/evidence:

- `docs/startup-ddl-equivalence/README.md`
- `docs/startup-ddl-equivalence/phase-gate-status.md`
- `docs/startup-ddl-equivalence/supported-state-coverage.md`
- `docs/startup-ddl-equivalence/supported-state-results.md`
- `docs/startup-ddl-equivalence/evidence/supported-operation-scope.json`
- The three final test logs listed above.
- `.agents/memory/authoritative-schema-migrations.md` — durable admission and
  fingerprint-session lessons, not production metadata.

The supplied request attachment remains untracked. No startup owner, API entry
point, development post-merge script, deployment configuration or secret changed.

Next permitted action: extend Phase A with evidence-backed populated historical
states and their own immutable migrations. Continue rejecting ambiguous states.
Do not propose startup removal until the complete equivalence gate passes.