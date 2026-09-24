# External database pool verification

## Scope and safety

The corrected runtime contract is now covered by post-correction unit,
disposable-integration, and mutation evidence: `LUMERA_DATABASE_URL` is
deployment-only, while a workspace runtime ignores it and uses `DATABASE_URL`.
The authorized Neon proofs later in this document predate that correction and
were not repeated.

The earlier authorized Neon proof used only `LUMERA_NEON_TEST_URL` and
`LUMERA_NEON_TEST_POOLER_URL` secrets. It did not read or print the ambient
`DATABASE_URL`, did not select development or production, and did not use the
second branch. No schema or persistent data changes were made on Neon. Every
live direct-endpoint transaction was read only and rolled back.

The proof imported `@workspace/db`, whose package export is
`lib/db/src/index.ts`. It therefore exercised the application's singleton pool,
not a proof-owned `pg.Pool`.

## Results

| Proof | Result | Evidence |
|---|---|---|
| Corrected runtime-selection units | **PASS** | 8 passed, 0 failed |
| Disposable PostgreSQL 16 application-pool integration | **PASS** | Minimal `env -i` environment retaining only `CI=true`, `HOME`, and `PATH`; PostgreSQL `160010`; migrations `000001`–`000004` applied to the owned cluster; 3 tests passed, 0 failed |
| Durable root integration entrypoint | **PASS** | `pnpm run test:external-database:integration` invoked the owned disposable runner and all three focused application-pool tests; 3 passed, 0 failed |
| Actual-pool workspace/deployment selection | **PASS** | Two actual fake PostgreSQL ports proved workspace used only `DATABASE_URL` (1 attempt versus 0) and deployment used only `LUMERA_DATABASE_URL` (1 attempt versus 0) |
| Actual-import pre-connection refusal | **PASS** | Zero socket attempts for an encoded pooler authority, a hostless URL with a listening `PGHOST` fallback, and a hostless `?host=` URL |
| Missing-initializer mutation | **PASS (mutant rejected)** | A scratch copy with only `onConnect` removed failed the real application-pool test because fresh clients reported `0` instead of configured `30s`; test process exit 1 |
| Four simultaneously held fresh application clients | **PASS** | 4 held clients and 4 distinct backend PIDs |
| No startup `statement_timeout` parameter | **PASS** | The pool's startup options had no `statement_timeout`; all four clients nevertheless reported the configured `30s` value after the new-client initializer |
| Transaction-local timeout lifecycle | **PASS** | `SET LOCAL statement_timeout = '100ms'`; `pg_sleep(1)` cancelled with SQLSTATE `57014`; rollback restored `30s`; a subsequent `SELECT 1` succeeded |
| Authorized direct Neon endpoint (pre-correction; not repeated) | **PASS (historical)** | 4 held clients, 4 distinct backends, every observation in a read-only transaction, every client reported `30s`, SQLSTATE `57014`, rollback restoration, normal follow-up query, and pool close all passed |
| Authorized Neon pooler endpoint (pre-correction; not repeated) | **PASS (historical)** | The application refused the actual authorized pooler URL before connection; instrumented network connection attempts: `0` |
| Owned-cluster backend standards database checks | **PASS** | All 13 database checks passed after migrations `000001`–`000004` were applied to a separate disposable PostgreSQL 16 cluster |

The earlier direct proof completed with `safeError: null`. The exact
credential-free
error exposed if initialization of a newly established direct client fails is:

```text
DB_STMT_TIMEOUT_MS could not be applied to a newly established database client.
```

The earlier live pooler refusal returned this exact credential-free error:

```text
LUMERA_DATABASE_URL must use a direct Neon endpoint; LISTEN does not work through a -pooler endpoint.
```

No URL, hostname, username, password, or raw driver error was emitted by either
proof harness.

## Post-correction disposable proof details

The existing destructive runner created and removed each owned cluster. For the
application-pool test it reported PostgreSQL `160010`, applied migrations
`000001`, `000002`, `000003`, and `000004` with no skips, and the focused Node
tests reported 3 passes and 0 failures under `env -i` with only `CI=true`,
`HOME`, and `PATH` retained. One test
exercised four real disposable
PostgreSQL clients and timeout restoration. The other used two actual local fake
PostgreSQL ports and the real application pool: workspace mode made one attempt
only to `DATABASE_URL`, while deployment mode made one attempt only to
`LUMERA_DATABASE_URL`; each forbidden target received zero attempts.

The third test imported the actual application module and instrumented socket
connections. It observed zero connection attempts while rejecting each of:

- an encoded authority host that decodes to a Neon `-pooler` host;
- a hostless authority while `PGHOST` pointed to a listening fake target;
- a hostless authority with an empty `?host=` parameter while `PGHOST` pointed
  to that fake target.

The fake `PGHOST` listener also observed zero attempts in both hostless cases.

The separate database-only backend standards run used another owned PostgreSQL
`160010` cluster and the same four baseline migrations. It passed:

- validation of all public CHECK and foreign-key constraints;
- validity of all public indexes;
- leading-column indexes for all foreign keys;
- all 39 critical named indexes;
- retail-cart NULL-safe standalone uniqueness;
- eight expected query-plan/index checks.

The backend standards summary was 13 passed and 0 failed.

## Durable entrypoint and mutation sensitivity

The root package now exposes:

```text
pnpm run test:external-database:integration
```

The entrypoint invokes the existing owned disposable runner, applies migrations
`000001`–`000004`, and runs only
`scripts/src/external-database-pool.integration.test.ts`. Its final clean
post-correction wiring proof used PostgreSQL `160010` and reported 3 passes and
0 failures.

The same durable entrypoint was then run with a module override pointing to a
scratch copy outside the workspace. The scratch mutation removed only:

```text
onConnect: createNewClientInitializer(statementTimeoutMs),
```

No application source file was edited. The disposable runner again applied all
four migrations. The real application-pool integration test rejected the
mutant with exit code 1 at the fresh-client assertion:

```text
actual: '0'
expected: '30s'
```

The scratch directory was removed after the run. This proves the test cannot
pass merely because of a startup parameter: the startup
`statement_timeout` option is absent, and deleting the new-client initializer
causes the expected observable failure.

## Earlier live direct proof details (not repeated)

The final structured result was:

```json
{
  "result": "pass",
  "route": "authorized-direct",
  "heldFreshClients": 4,
  "distinctBackends": 4,
  "transactionReadOnly": true,
  "configuredTimeoutPreserved": true,
  "cancellationSqlstate": "57014",
  "rollbackRestoredDefault": true,
  "normalQueryAfterRollback": true,
  "safeError": null,
  "poolClosed": true
}
```

The live direct route was read only: each fresh-client observation used
`BEGIN TRANSACTION READ ONLY` and `ROLLBACK`. The timeout cancellation probe
also used a read-only transaction and rolled back the aborted transaction
before verifying restoration and normal operation.

## Earlier live pooler refusal details (not repeated)

The final structured result was:

```json
{
  "result": "pass",
  "route": "authorized-pooler",
  "refusedBeforeConnection": true,
  "connectionAttempts": 0,
  "safeError": "LUMERA_DATABASE_URL must use a direct Neon endpoint; LISTEN does not work through a -pooler endpoint.",
  "poolClosed": true
}
```

The earlier proof installed a connection-attempt counter before importing the
application database module. Import rejected the actual authorized pooler URL
and the counter remained zero, establishing refusal before any database
connection.

The manual harness now explicitly sets `REPLIT_DEPLOYMENT=1` before assigning
the authorized value to `LUMERA_DATABASE_URL`, so any future owner-authorized
run exercises the deployment-only contract. This harness change is not a claim
that either authorized Neon proof was repeated.

## Commands

Focused disposable integration through its durable root entrypoint:

```text
pnpm run test:external-database:integration
```

Database-only backend standards on an owned disposable cluster:

```text
pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- pnpm --filter @workspace/scripts exec tsx src/test-backend-standards.ts --database-only
```

Live direct and pre-connection pooler proofs:

```text
pnpm --filter @workspace/scripts exec tsx src/external-database-pool.proof.ts direct
pnpm --filter @workspace/scripts exec tsx src/external-database-pool.proof.ts pooler-refusal
```

## Historical first-correction full-suite and contract verification

The first contract-correction verification cycle completed with **101 tests
passed**, zero failures and zero skips, across 11 suites and 12 files. Its
manifest is
`/tmp/pr40-fix-phase5-final/phase5-integration-manifest.json` and reports
`status: passed`, `tests: 101`, `passed: 101`, `skipped: 0`,
`ownedClusterRemoved: true`, `error: null`, and `cleanupErrors: []`.
These results are retained as historical evidence for that source snapshot; they
are not final evidence for the subsequent second correction.

An earlier attempt in that cycle failed because `lib/db/src/pool-runtime.ts`
imported `./destructive-test-runtime.js`. The only correction for that failure
was changing this new import to the extensionless
`./destructive-test-runtime`. The startup-DDL scanner itself was unchanged and
already resolved extensionless local imports as implemented. This was not a
scanner correction. It was also not the older fixture-mode/Anthropic incident,
which is not asserted as a current failure.

At that snapshot, Release Phase 2 was wired to run the pool-runtime units and
external-database integration before the remaining backend checks. Its
provisional CI timing budgets were 375 seconds for
`database:release:2-backend` and 705 seconds for
`validate:ci:database:total`. Those historical values were configuration, not
execution evidence, and were replaced by the later calibration below.

Historical first-correction evidence:

| Check | Result |
|---|---|
| Pool runtime units | 8 passed |
| External database integration | 3 passed in a minimal environment |
| Full Phase 5 integration | 101 passed, 0 failed, 0 skipped; owned cluster removed cleanly |
| Release-chain contract | 30 passed |
| Library TypeScript | Root forced library build passed all four libraries: db, api-client-react, api-zod, and anthropic |
| Application/tooling TypeScript | api-server, beauty-marketplace, mockup-sandbox, and scripts passed |
| API spec TypeScript | N/A: api-spec has no typecheck script or `tsconfig` and is not part of the root library build |
| Generated/browser/frontend wrappers | Generated frontend and backend checks, browser-spec wrapper, and frontend package wrappers passed |
| HTTP security fixture | Passed on disposable PostgreSQL after removing the cross-root helper import that caused TS6059; the fixture retained the child port from stdout and ignored stderr |
| Backend database standards | 13 passed |
| Migration credential/capability contract | 60 passed |
| Backend static standards | Full static 13 passed; production boundary 10/10; startup inventory 5/5; startup-DDL safety 28/28 across 151 scanned modules |
| Selector-target guard | Redundant raw `DATABASE_URL` check removed; only the selector-target guard remains; 2 focused checks passed |
| Documentation validation | 13 tests, 114 diagnostic negative cases, and 65 execution negative fixtures passed |

All four focused scratch mutants were rejected again after the correction. The
actual-pool `onConnect` removal mutant and an actual `index.ts` mutant that
wrongly fell back to `DATABASE_URL` in deployment were also rejected by the
disposable integration tests. See `mutations.md` and the wiring evidence above.

The first contract-correction hash batch required exactly three current-tier
amendments: CLI in both manifests, then the nested diagnostic-manifest cascade.
The earlier Task 4 hash batch remains separately recorded. All 158 current
entries matched that snapshot; both historical tiers remained
raw-byte-identical to `origin/main`. Complete hashes for that historical batch
are recorded in `../production-evidence-execution-plan/provenance.md`.

## Third-correction historical verification and registry correction

The shared destructive-target guard correction and CLI/source state postdate the
historical results above. The earlier text called the registry work complete,
but the preserved scratch stdout/stderr for that two-mutant claim is
unavailable. That broad completion claim is retracted. The clean-CI and Phase 5
manifests remain historical evidence for their recorded source snapshots, not
evidence that every later registered harness had an actual guard call.

A current, database-free reproduction against the exact current HTTP-security
and external-pool sources removed only each guard call and then applied the
original main-branch predicate, `/assertDestructiveTestRuntimeAllowed/`. The
imports remained, so the old predicate accepted both mutants. Its direct
diagnostics were:

> `current reproduction: original predicate accepted import-only external database pool integration mutation`
>
> `current reproduction: original predicate accepted import-only HTTP security hardening mutation`

This is a current reproduction of the old predicate, not a recovered historical
run. Its stdout, stderr, and exit code are preserved under
`.local/ledger-identity/registry/current-old-contract-reproduction.*`.

| Check | Result |
|---|---|
| Generic unknown expected-argument CLI coverage | 13 passed; unrecognised `--expected-*` spellings report the exact implementation text `Unrecognised --expected- argument at position N` |
| Shared destructive-target guard | The focused shared-guard file passed 9 tests. The reported 11-test combined evidence consists of those 9 shared-guard tests plus the 2 destructive-runner tests; it is not an 11-test count for the shared guard alone. |
| HTTP security fixture | Passed with `CI=true`, `NODE_ENV=test`, owned database name `lumera_ci_database`, and the private fixture marker unset |
| HTTP target-boundary regressions | The normal owned disposable target passed; a non-disposable target was refused before application import/connection |
| Full Phase 5 integration | Final current-source rerun passed all 101 tests across 11 suites and 12 files, with 0 failures and 0 skips; PostgreSQL 16 used loopback on a non-default port, the owned cluster was removed, `error` is `null`, and `cleanupErrors` is empty. The manifest is `.local/pr40-third-phase5-final/phase5-integration-manifest.json`. |
| Earlier destructive-harness registry mutations | The prior document named two rejected mutations, but its actual stdout/stderr was not preserved and is unavailable. The claim that those two mutations established registry completion is retracted. The current reproduction quoted above demonstrates that the actual old predicate accepts both import-only mutants. |
| Current destructive-harness registry contract | The contract now parses TypeScript with the compiler AST, ties calls to static or dynamic imports of the shared guard, and separately requires an actual shell guard invocation; an import, sourced helper, unrelated same-name call, comment, string, or guard name alone is insufficient. The focused database-free run passed 40 tests: final-source coverage, negative coverage, and scratch remove-only-call mutations for all 38 registrations (36 distinct source files). The same focused file is wired into the existing `test:api-regressions-lifecycle` script, so CI executes it before the expensive lifecycle file. Actual stdout, stderr, and exit code are preserved at `.local/ledger-identity/registry/focused-registry.stdout`, `.local/ledger-identity/registry/focused-registry.stderr`, and `.local/ledger-identity/registry/focused-registry.exit-code`; all mutation messages are quoted in `../ledger-identity/registry-evidence.md`. |
| Clean CI database preparation and Phases 2–3 | All 66 manifest steps passed with exit code 0. The lifecycle step passed 37 tests in approximately 675 seconds (677-second enclosing step). The manifest environment and every step command, exit code, and duration are recorded in [CI database job verification](ci-database-job-verification.md). |
| Shared redacted child-output helper | Implemented at `lib/db/src/safe-child-process-output.ts`, exported as the real `@workspace/db/safe-child-process-output` package subpath, and re-exported for existing scripts callers; API and scripts TypeScript checks passed |
| Backend static standards | 13 passed, including prerequisites |
| Backend database standards | 13 passed on the owned disposable target |
| Release-chain contract | 30 passed |
| Migration credential/capability contract | 60 passed |
| Protected current-source census | All 158 current entries match after exactly three current-tier amendments: CLI in both current tiers and the dependent diagnostic-manifest cascade |
| Historical protected tiers | Both 73-entry objects remain raw-byte-identical to `origin/main`; all 146 pinned values match `b8f30561` |
| Documentation validation | 13 passed; 114 diagnostic negative cases and 65 execution negative fixtures passed after the final current-only amendments and cascade |

The calibrated budgets are now 368 seconds for
`database:release:2-backend` and 698 seconds for
`validate:ci:database:total`. The two successful pool-runtime measurements were
0.97 and 1.46 seconds, and the two successful integration measurements were
9.77 and 10.55 seconds. Per-command ceiling of each maximum gives a 13-second
addition. Hosted runner runs
`35920735732` and `35920728240` provide corroborating aggregate timing evidence,
not successful-phase samples: both reports ultimately failed at a later Phase 2
check. The derivation, artifact links, observed aggregate times, and unchanged
warning formula are recorded in
`../phase7-external-database-ci-timing.md`.

The initial second-correction full Phase 5 run was interrupted when the
workspace restarted and is not counted as a pass. The replacement
`.local/pr40-third-phase5-final` run is the final current-source result: its
manifest was generated at `2026-09-23T23:10:47.982Z` and records `status:
passed`, 101 tests passed, no skips, successful owned-cluster removal, no
runner error, and no cleanup errors. The historical 101-test result above
remains evidence only for the earlier source snapshot.

This documentation and protected-hash work contacted no development or
production database and changed no secret value. It added no application schema
or migration and performed no deployment or publication. The production move
remains Phase 8.