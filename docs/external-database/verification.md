# External database pool verification

## Scope and safety

The final proof used only the owner-authorized `LUMERA_NEON_TEST_URL` and
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
| Disposable PostgreSQL 16 application-pool integration | **PASS** | PostgreSQL `160010`; migrations `000001`–`000004` applied to the owned cluster; 1 test passed, 0 failed |
| Durable root integration entrypoint | **PASS** | `pnpm run test:external-database:integration` invoked the owned disposable runner and the focused application-pool test; 1 passed, 0 failed |
| Missing-initializer mutation | **PASS (mutant rejected)** | A scratch copy with only `onConnect` removed failed the real application-pool test because fresh clients reported `0` instead of configured `30s`; test process exit 1 |
| Four simultaneously held fresh application clients | **PASS** | 4 held clients and 4 distinct backend PIDs |
| No startup `statement_timeout` parameter | **PASS** | The pool's startup options had no `statement_timeout`; all four clients nevertheless reported the configured `30s` value after the new-client initializer |
| Transaction-local timeout lifecycle | **PASS** | `SET LOCAL statement_timeout = '100ms'`; `pg_sleep(1)` cancelled with SQLSTATE `57014`; rollback restored `30s`; a subsequent `SELECT 1` succeeded |
| Authorized direct Neon endpoint | **PASS** | 4 held clients, 4 distinct backends, every observation in a read-only transaction, every client reported `30s`, SQLSTATE `57014`, rollback restoration, normal follow-up query, and pool close all passed |
| Authorized Neon pooler endpoint | **PASS** | The application refused the actual authorized pooler URL before connection; instrumented network connection attempts: `0` |
| Owned-cluster backend standards database checks | **PASS** | All 13 database checks passed after migrations `000001`–`000004` were applied to a separate disposable PostgreSQL 16 cluster |

The direct proof completed with `safeError: null`. The exact credential-free
error exposed if initialization of a newly established direct client fails is:

```text
DB_STMT_TIMEOUT_MS could not be applied to a newly established database client.
```

The final live pooler refusal returned this exact credential-free error:

```text
LUMERA_DATABASE_URL must use a direct Neon endpoint; LISTEN does not work through a -pooler endpoint.
```

No URL, hostname, username, password, or raw driver error was emitted by either
proof harness.

## Disposable proof details

The existing destructive runner created and removed each owned cluster. For the
application-pool test it reported PostgreSQL `160010`, applied migrations
`000001`, `000002`, `000003`, and `000004` with no skips, and the focused Node
test reported 1 pass, 0 failures, 0 skips.

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
`scripts/src/external-database-pool.integration.test.ts`. Its final wiring proof
used PostgreSQL `160010` and reported 1 pass, 0 failures, and 0 skips.

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

## Live direct proof details

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

## Live pooler refusal details

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

The proof installed a connection-attempt counter before importing the
application database module. Import rejected the actual authorized pooler URL
and the counter remained zero, establishing refusal before any database
connection.

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

The full normal Phase 5 disposable-PostgreSQL runner completed with **101 tests
passed**, zero failures or skips, across 11 suites and 12 files. Its final
manifest reports `status: passed`, `ownedClusterRemoved: true`, `error: null`,
and `cleanupErrors: []`.

An earlier run stopped at the actual-entrypoint fixture because changing its
original test mode to production introduced an unrelated Anthropic configuration
requirement. The fixture's original test mode was restored while retaining both
explicit owned database URLs. The full runner was then rerun successfully; the
failed attempt is not counted as validation.

Other completed checks:

| Check | Result |
|---|---|
| Pool runtime units | 7 passed |
| Identity plus inventory tests | 15 passed |
| Full Phase 5 units | 88 passed; one intentional integration-only skip, covered by the full runner |
| Release-chain contract | 29 passed |
| Migration contract, including credential-exposure/capability guards | 60 passed |
| Backend static standards | 13 checks passed, plus boundary 10/10, inventory 5/5 and startup-safety 28/28 |
| Backend database standards on owned PostgreSQL | 13 checks passed |
| Documentation validation | 13 tests, 114 diagnostic negative cases, 65 execution negative fixtures passed |
| TypeScript | lib/db and scripts checks passed |

All four requested scratch mutants were rejected by their tests; the additional
actual-pool `onConnect` removal mutant was also rejected by the disposable
integration test. See `mutations.md` and the wiring evidence above.

Five protected current-tier amendments were necessary: runbook and CLI in both
manifests, then the nested diagnostic-manifest cascade. All 158 current entries
match; both historical tiers remain raw-byte-identical to main. Complete hashes
are recorded in `../production-evidence-execution-plan/provenance.md`.

No development or production database was contacted. The API workflow was
stopped to prevent watcher-triggered development-database connections and was
not restarted. No secret values were changed, no application schema or migration
was added, and no deployment or publication was performed. The production move
remains Phase 8.