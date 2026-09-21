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
  pnpm run test:advisory-lock-session-cleanup
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

## Initial delivery validation and protected-evidence restrictions

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

A static check should enforce that every migration-lock caller owns a
single-connection pool and ends it, rather than relying on the comment alone.
That check is recorded only, not implemented.

## Build-unblocking follow-up

### Protected segment proof and authorized pin update

The failing reconciliation pin is `STARTUP_SOURCE_SHA256` in
`scripts/src/subscription-reconciliation/source.ts`: SHA-256 of the **entire**
Business Growth source file, not a startup-DDL inventory SQL fingerprint.

Compared the pre-fix source at `64078c978e12a4b62d90e03d99dd72e856661280`
with the final source after the sibling cleanup fixes. Extraction uses the same
inclusive start and exclusive end as the reconciliation module:

- Start: `// A legacy plan can be used by both products.`
- End: the template literal beginning
  `` `ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS subscription_suspended ``.

| Evidence | Before | After |
| --- | --- | --- |
| Segment byte length | 4045 | 4045 |
| Segment SHA-256 | `7e8b60a40fd9fa15e27e49387193883ef2b9ca22c33882db9dc96d6a5dae9c48` | `7e8b60a40fd9fa15e27e49387193883ef2b9ca22c33882db9dc96d6a5dae9c48` |
| Start / end anchor occurrences | 1 / 1 | 1 / 1 |
| Matching INSERT / UPDATE / WITH template literals | 9 | 9 |
| Operation-name entries | 9 | 9 |

The extracted buffers compare byte-for-byte equal. Only after this proof,
the separately authorized whole-file pin was updated from
`91c061a8e2e6c16ee01584d5692ad0d3ff29dc29e6b5aa10725ea29f04f84fe8` to
`981434746172a7985ce9f63cff2e03e972e6b6c1a2d1f533f3a5194298058597`.
Protected evidence manifests, baselines, and startup-DDL inventories remain
untouched.

### Test placement, CI, and cleanup changes

- The real regression now lives at
  `artifacts/api-server/src/lib/advisory-lock-session-cleanup.test.ts`,
  with a local media-owner import. The intercepted data event is narrowed using
  `Buffer.isBuffer` and converted using `Buffer.from` when necessary, not cast.
- Both root and API-package scripts expose `test:advisory-lock-session-cleanup`.
  The isolated `database` job in `.github/workflows/ci.yml` invokes it explicitly
  with ambient database URLs removed. That job installs PostgreSQL 16 host tools
  and adds their binary directory to PATH; the test owns its own cluster.
- Marketplace session-timeout restoration failure now logs at error level and
  destroys the client, including when startup already failed.
- Business Growth session-timeout and search-path restoration failures now log
  at error level and mark the existing unsafe-session registry so outer release
  destroys the client. Primary startup errors still take precedence.
- Communication archive unlock failure now logs at error level.
- Booking development schema uses the scripts-package Pino logger with the
  project's structured logging/redaction conventions, without importing across
  the scripts/API package boundary.
- Ten additional startup-safety cases cover sibling restore failure destruction
  and primary-error preservation. Existing assertions were not changed.

### Evidence limits

The real pooled-connection regression exercises **one of the thirteen advisory
unlock cleanup paths** (media schema). The other twelve advisory-unlock paths
are verified by source review, not by this real transport-fault test. The added
sibling-restoration tests use fake clients and are not a substitute for
real-pool evidence on those twelve paths.

### Final validation result

The relocated real-pool regression passes (1/1): zero locks, third session
acquires, destroyed backend, owned cluster removed. Scripts and API typechecks
pass. Workflow validation passes.

The Phase 5 runner's `historical-data-regressions` suite passes: subscription
reconciliation **13/13**, paired startup-data apply **13/13**, zero skips.
Its manifest confirms owned-cluster removal without cleanup errors.
The source inventory suites pass **8/8** and **10/10**.

Ran the complete `pnpm run validate:publish` invocation with `CI=true`,
`NODE_ENV` unset, ambient database/libpq targets scrubbed, and only a fresh
owned PostgreSQL 16 cluster as database/admin target. Schema and retail-index
preparation succeeded. The invocation exited **1**, not zero.

| Publish command, in order | Final result |
| --- | --- |
| `test:release-chain` | PASS, 24/24 |
| `validate:ci:startup-ddl-removal-gate` | PASS, 148 modules |
| `build:release` | PASS, builds and release typechecks |
| scripts `typecheck` | PASS |
| `test:beauty-marketplace-typecheck` | PASS |
| `test:frontend-generated-typecheck` | PASS, contract tests 4/4 |
| `test:api-server-typecheck` | PASS |
| `test:browser-specs-typecheck` | PASS |
| `test:browser-fixtures` | PASS, 4/4 |
| `test:bundle-budget` | PASS, entry 113.17 kB gzip / 490.42 kB raw |
| `test:frontend-standards` | PASS |
| `test:seo-standards` | PASS |
| `test:frontend-interactions` | PASS |
| `test:monitoring` | PASS |
| `test:backend-standards:static` | PASS, including startup safety 28/28 |
| `test:backend-standards:database` | PASS against the live owned cluster |
| `test:internal-request-controls` | FAIL, 9/10; first final-chain blocker |
| `test:internal-request-control-outputs` | PASS, 35/35, run independently after stop |
| `test:rmas` | PASS, 3/3, run independently after stop |

The blocker is the discovery of `x-lumera-db-observation` in
`artifacts/api-server/src/lib/production-demo-seed-isolated-harness.ts`, absent
from the expected registered request-header list. The harness, registration
module, and assertion file are byte-unchanged from the pre-fix main commit
`64078c978e12a4b62d90e03d99dd72e856661280`. No unrelated security control or
assertion was changed to suppress this failure. The publish chain is therefore
**not fully green**, despite removal of the scripts-typecheck blocker.

Earlier attempts exposed a missing return in a new test callback and overly
broad search-path failure injection; both fixtures were corrected before the
final run, without changing existing assertions. A preliminary build inherited
`NODE_ENV=test` and failed bundle budgets; that result is superseded by the
production-equivalent build above.

Final evidence was recorded under `/tmp/lumera-final-correct-env.zIEmB0` and
`/tmp/lumera-phase5-subscription-proof.NnTtrA` (temporary local logs).
All owned clusters were stopped and their data directories removed; no owned
PostgreSQL processes remain. No production/shared database or app workflow was
used. The previously reported documentation protected-hash check was not
modified or represented as repaired by the reconciliation pin update.