# PR38 merge-blocker verification

## Starting state and boundaries

Started from clean `daily/2026-09-22` at `5704e143`. The unrelated `4f8a88ce`
was not an ancestor. No development/production database connections, live CI
checks, deployment, schema changes or migration SQL changes were performed.
The salon city predicate/index and the three cover-image failures were not
investigated or changed.

## All-package TypeScript checks (BLOCKING1)

The public-address fixture now asserts `"address" in dto` before reading the
active-profile fields. Original address/postal/privacy assertions are unchanged;
the response union was neither widened nor cast away.

Each final check ran without an inherited `DATABASE_URL`:

| Workspace package | Check | Result |
| --- | --- | --- |
| `api-client-react` | `tsc --build --force lib/api-client-react` | PASS |
| `api-zod` | `tsc --build --force lib/api-zod` | PASS |
| `db` | `tsc --build --force lib/db` | PASS |
| `integrations-anthropic-ai` | `tsc --build --force lib/integrations-anthropic-ai` | PASS |
| `api-spec` | Strict standalone TypeScript check of `orval.config.ts` | PASS |
| `api-server` | Package `typecheck` | PASS |
| `beauty-marketplace` | Package `typecheck`, including declaration rebuild | PASS |
| `scripts` | Package `typecheck`; repeated after final migration-fixture edit | PASS |
| `mockup-sandbox` | Package `typecheck` | PASS |

Additional checks: root `typecheck:libs`, frontend `typecheck:rmas`, and scripts
`typecheck:browser` all PASS.

The API-spec package has no package typecheck script. Its separate check found
and fixed a real typing problem: const-generic inference made the Orval coercion
array readonly. `satisfies GeneratorConfig`, contextualized with Orval's
`Options`/`OutputOptions`, preserves mutable option types and the existing
formatting flag without changing generator values, using `any`, or suppressing
errors. The exact passing command was:

```sh
env -u DATABASE_URL pnpm exec tsc --noEmit --incremental false \
  --module esnext --moduleResolution bundler --target es2022 --lib es2022 \
  --types node --typeRoots ./scripts/node_modules/@types \
  --esModuleInterop --skipLibCheck --strict lib/api-spec/orval.config.ts
```

## Release contract (BLOCKING2)

`scripts/src/release-chain.test.ts` now parses the runner's TypeScript AST and
requires exactly one manifest application using
`expectedTargetIdentity: identity`. It verifies the explicit identity object
contains `databaseName: "postgres"`, the `systemIdentifier` variable, and
`transport: "unencrypted" as const`, and retains the assertion that the
identifier comes from `pg_catalog.pg_control_system()`. PG16, staging noindex,
manifest and ambient-URL protections remain asserted.

Full database-free release contract: **29/29 PASS** via
`env -u DATABASE_URL pnpm run test:release-chain`.

## Inactive profiles, sitemap and small corrections (FIX4–6)

- The inactive public API response is exactly `{name, active: false, city}`.
  The query projects only name/city; no street, entrance, phone or coordinates
  are returned. OpenAPI and generated clients/Zod agree.
- SSR reads the public DTO city. Its separate PostgreSQL resolver was deleted,
  along with the frontend `pg` dependency and lockfile importer entry. Backend
  database dependencies remain untouched.
- The client fallback link is `/saloni`, never the inactive profile itself.
- The actual sitemap fetch helper carries HTTP status on errors. Integration
  tests call that helper using HTTP response fixtures: missing/removed
  centers/instructors (404/410) are omitted while other entries and the index
  remain available. 401/403/429/500/503 still fail closed.
- The indexing-enabled policy case is restored with a pure injected policy
  environment. Process-level staging indexing remains disabled.

## Other completed verification

| Check | Result |
| --- | --- |
| Frontend-only Vite build | PASS; only large-chunk warning |
| SEO server | 53/53 PASS, zero skips; includes direct-entrypoint HTTP/shutdown and 11 imported policy cases |
| SEO policy standalone | 11/11 PASS, zero skips |
| SEO discovery | 11/11 PASS, zero skips |
| API-only inactive-city regression | 3/3 PASS, zero skips |
| SEO standards | PASS: 32 public React routes and 16 schema contracts |
| Inactive API contract | 1/1 PASS |
| Public salon address | 5/5 PASS |
| Public salon address input | 4/4 PASS |
| Generated internal-controls guard | PASS |
| Documentation validators | 13/13 PASS |

The four final SEO suites represent 67 distinct cases, or 78 executions when
the separately repeated policy tests are counted. Initial verification skipped
the direct-entrypoint case because the build output was absent; the final
frontend build and complete rerun supersede that result. Final build/SEO commands
used a clean environment with fixture public origin, `SITE_INDEXABLE=false`,
and API origins pinned to closed loopback port 1. No API workflow was started.

Protected-hash census: all 158 current-source entries valid, zero drift or
amendments; all 146 historical hashes reproduced. Both historical blocks are
byte-identical to authoritative remote main
`a94abeeea316710c000629d4d78b8ce3c86bb5e8`. No manifest cascade/provenance edits
were required. Local `main` is stale and was not used as the authority.

## Migration integration (BLOCKING3)

Local evidence only; no CI queries, deployment, development/production database
connections, credentials inspection, or SQL/schema changes. All database commands
went through the owned disposable runner with `SITE_INDEXABLE=false`.

### Root cause and correction

The workflow's `phase5-migration-integration` job invokes
`test:migrations:phase5:integration`. Its failing four-test suite was
`equivalence-characterization`, not `supported-convergence`: reproduced **3 passed,
1 failed** in `scripts/src/startup-equivalence/fixtures.test.ts`.

The characterization harness created and verified an owned child database, then
set `DATABASE_URL` for delayed `@workspace/db` imports without setting the matching
`LUMERA_DISPOSABLE_DATABASE` marker. The direct ORM destructive-runtime guard
correctly rejected that unmarked target. This was harness integration, not migration
SQL drift.

`scripts/src/startup-equivalence/fixtures.ts` now scopes the ownership marker to
that verified child before imports and restores the previous marker in `finally`.
The existing regression additionally verifies that the child URL is removed and
the previous marker restored. Its final dedicated run passed **4/4**, without
loosening guard or characterization assertions.

### Commands and completed results

Every command below used this exact prefix:

```sh
SITE_INDEXABLE=false pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts --
```

Integration commands after that prefix used:

```sh
pnpm run test:migrations:phase5:integration -- --output-dir=/tmp/blocking3-<run> [--suite=<selection>]
```

| Run | Suite selection | Result |
| --- | --- | --- |
| `convergence-before` | `supported-convergence` | 4/4 passed |
| `full-before` | All (selection omitted) | Phase4 completed 37/37; equivalence failed 3/4; overall failed |
| `core` | `equivalence-characterization,supported-state,supported-convergence,adoption-boundary,namespace-boundary` | 25/25 passed; completed manifest |
| `remaining` | `actual-entrypoint-boot,legacy-boot-refusal,historical-data-regressions,interrupted-recovery` | 33/33 passed; completed manifest |
| `identity` | `target-identity` | 6/6 passed; completed manifest |
| `equivalence` | `equivalence-characterization` | Final strengthened regression 4/4; completed manifest |

The database-free command, also run through the same owned runner, was:

```sh
env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm run test:migrations:phase5:unit
```

Result: **84 tests, 83 passed, 1 expected explicit-admin-target skip, 0 failed**.

### Exact integration coverage union

These are executed test counts, including dynamic subtests, rather than the
inventory's static top-level declaration counts. Repeated runs are counted once.

| Inventory suite | Test file (under `scripts/src/` unless noted) | Passed/total | Evidence run |
| --- | --- | --- | --- |
| `phase4-migrations` | `migrations/migrations.integration.test.ts` | 37/37 | `full-after`, also `frontier` |
| `equivalence-characterization` | `startup-equivalence/fixtures.test.ts` | 4/4 | `equivalence` |
| `target-identity` | `migrations/target-identity.integration.test.ts` | 6/6 | `identity` |
| `supported-state` | `migrations/supported-state.integration.test.ts` | 15/15 | `core` |
| `supported-convergence` | `migrations/supported-convergence.integration.test.ts` | 4/4 | `core` |
| `adoption-boundary` | `migrations/adoption-boundary.integration.test.ts` | 1/1 | `core` |
| `namespace-boundary` | `migrations/namespace-boundary.integration.test.ts` | 1/1 | `core` |
| `actual-entrypoint-boot` | `migrations/supported-path-boot.integration.test.ts` | 5/5 | `remaining` |
| `legacy-boot-refusal` | `artifacts/api-server/src/lib/business-growth-schema-boot-regression.test.ts` (repository-relative) | 1/1 | `remaining` |
| `historical-data-regressions` | `startup-data/apply.test.ts` | 13/13 | `remaining` |
| `historical-data-regressions` | `subscription-reconciliation/reconciliation.test.ts` | 13/13 | `remaining` |
| `interrupted-recovery` | `startup-equivalence/recovery.test.ts` | 1/1 | `remaining` |
| **Union: 11 suites / 12 files** | | **101/101** | **No integration skips** |

### Interrupted commands are not complete proofs

`full-after` (all suites) and `frontier`
(`phase4-migrations,equivalence-characterization,target-identity`) hit the shell
tool's 300-second timeout. Both contain a **complete phase4 test-file summary:
37 tests, 37 passed, 0 failed/cancelled/skipped**, followed by a complete 4/4
equivalence summary. The former was interrupted during supported-state, the
latter during target-identity. Neither overall command or cleanup manifest is
claimed complete. Phase4's completed file result is the phase4 contribution to
the coverage union, not a successful full-run claim.

A further `phase4` command selecting only `phase4-migrations` was interrupted
without a final test summary and contributes **no additional completed evidence**.
An attempted background verification launch produced no verification log and
contributes no evidence.

Completed split manifests (`core`, `remaining`, `identity`, `equivalence`) report
`ownedClusterRemoved=true` with no cleanup errors. Logs and manifests are in the
corresponding `/tmp/blocking3-*` directories; top-level command logs are
`/tmp/blocking3-<run>.log`. The test slot was released with no owned runner or
PostgreSQL processes remaining. `git diff --check` passed.

No new memory entry: the existing deployment-runtime-detection lesson already
requires propagation of the disposable marker only to newly created, owned child
targets; this correction applies that rule.