# Advisory-lock cleanup verification

## Scope

The branch starts from main commit
`64078c978e12a4b62d90e03d99dd72e856661280`.
The standalone regression-only commit is `c419172e`; its production code is
unchanged from that base. No production or shared database is used.

## Real PostgreSQL regression

Run with PostgreSQL 16 binaries on PATH:

```sh
env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL NODE_ENV=test \
  pnpm --filter @workspace/scripts exec tsx --test \
  src/advisory-lock-session-cleanup.test.ts
```

The test owns a temporary cluster and calls the real media schema owner through
a real `pg.Pool`, with idle reaping and maximum session lifetime disabled.
A TCP proxy blackholes the actual unlock protocol message; the driver's query
read timeout fails the unlock. No query or release methods are mocked. A
separate observer reads `pg_locks`; a third session attempts acquisition.

| Observation | Unmodified production code | Fixed code |
| --- | --- | --- |
| Granted locks for owner/key after cleanup | 1 | 0 |
| Third session acquires key | false | true |
| Pool total / idle | 1 / 1 | 0 / 0 |
| Release carries destruction signal | false | true |
| Test | FAIL | PASS |

The baseline failure was obtained before production edits. Both runs verified
backend/lock cleanup, stopped their owned cluster and removed its directory.
The test commits its schema only inside that disposable cluster.

## Changed cleanup paths

All lock/unlock SQL remains inline, with unchanged SQL text and order.

1. Business Growth inner unlock and outer release, using the existing unsafe
   snapshot-session registry rather than a second channel.
2. Shipping configuration.
3. Education bundle purchase.
4. Web Push schema.
5. Marketplace performance indexes.
6. Booking command schema.
7. Media schema.
8. Referral schema.
9. Communication archive worker.
10. Education IPS fixture: newly created settings restore.
11. Education IPS fixture: existing settings restore.
12. Education IPS fixture: setup failure.
13. Booking development schema.

Each failed unlock is logged and causes connection destruction rather than a
normal return to the pool. Existing primary operation failures remain primary.
The migration lock module receives a comment only: its safety depends on the
CLI's single-connection pool being ended; a shared-pool caller cannot assume the
module disposes of a session after an unlock failure.

## Validation and protected-evidence restrictions

- Existing startup DDL safety tests: 18/18 pass, assertions unchanged.
- Reconstruction/source tests: 52/52 pass, including historical inventory,
  fixed-baseline inventory and source crosswalk checks.
- Startup DDL removal tests: 7/7 pass; entrypoint gate scans 148 modules.
- Migration contract tests: 60/60 pass; contract validation passes with
  database environment variables removed.
- Migration unit tests: 17/17 pass.
- Migration database integration tests: 37/37 pass.
- Phase 5 unit tests: 77 pass, one skip.
- Database validation: all 28 backend and 28 API command suites pass, including
  the communication archive and all 26 process-lifecycle tests. The initial
  `validate:ci:database` wrapper stopped because the disposable-admin variable
  was absent. After supplying the owned-cluster admin URL, precisely the 51
  failed/not-reached commands were executed and passed. This is completed
  resumed coverage, not a claim that the original wrapper exited successfully.
  Monitoring (11 checks), static validation (33 tests plus 13 checks), the
  database audit (13 checks), and cart preparation (2 tests) also pass.
- The complete Phase 5 integration runner fails in subscription reconciliation:
  5/13 pass, eight fail with
  `Startup source changed; review historical operation evidence before replay`.
  The unreached interrupted-recovery suite was then run independently with the
  same dedicated runner and passed 1/1. Total integration coverage is 46 pass,
  eight fail, zero skip; no suite remains unexecuted.
- The reconstruction command's chained documentation validator also fails:
  `protected hash drift: artifacts/api-server/src/lib/business-growth-schema.ts`.

The two last failures are whole-source protected-evidence checks, not the
lock-boundary inventory gates. The required cleanup edit changes the pinned
file. No assertion, protected manifest, baseline, migration definition, schema
definition or ledger was updated to suppress either failure. This is not an
all-green full-suite result and requires separately authorized evidence review.

Shipping source positions are preserved because an existing adversarial
crosswalk fixture validates exact occurrences before its checksum assertion.
All owned disposable clusters and their data directories were removed, including
early interrupted setup attempts. The integration manifests report successful
owned-cluster removal without cleanup errors.

## Deferred work

Move owners whose entire protected operation already uses one transaction to
transaction-scoped advisory locks, with a review of serialization boundaries
and corresponding source-text inventory gate changes. Do not apply that change
to nontransactional/concurrent-index owners by assumption. This is recorded as
follow-up work, not implemented here.