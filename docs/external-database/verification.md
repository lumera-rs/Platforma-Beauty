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

## Final full-suite and contract verification

The final normal Phase 5 disposable-PostgreSQL runner completed with **101 tests
passed**, zero failures and zero skips, across 11 suites and 12 files. Its
manifest is
`/tmp/pr40-fix-phase5-final/phase5-integration-manifest.json` and reports
`status: passed`, `tests: 101`, `passed: 101`, `skipped: 0`,
`ownedClusterRemoved: true`, `error: null`, and `cleanupErrors: []`.

An earlier post-correction attempt exposed scanner handling of `.js` versus
extensionless imports. That scanner issue was corrected before the final run.
It was not the older fixture-mode/Anthropic incident, which is not asserted as a
current failure.

Release Phase 2 is now wired to run the pool-runtime units and external-database
integration before the remaining backend checks. Its recorded CI timing budgets
are 375 seconds for `database:release:2-backend` and 705 seconds for
`validate:ci:database:total`. Those budgets are provisional configuration
pending final CI calibration, not execution evidence.

Current final evidence:

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

The final contract-correction hash batch required exactly three current-tier
amendments: CLI in both manifests, then the nested diagnostic-manifest cascade.
The earlier Task 4 hash batch remains separately recorded. All 158 current
entries match; both historical tiers remain raw-byte-identical to `origin/main`.
Complete hashes are recorded in
`../production-evidence-execution-plan/provenance.md`.

No development or production database was contacted. The API workflow was
stopped to prevent watcher-triggered development-database connections and was
not restarted. No secret values were changed, no application schema or migration
was added, and no deployment or publication was performed. The production move
remains Phase 8.