# CI wiring and local verification

The transfer commands were added only after the standalone unit and disposable
integration suites had been run with a cleared environment but the Replit-provided
PATH. This was not a complete CI-matching binary-resolution proof: Replit put
PostgreSQL binaries on PATH, whereas GitHub supplies LUMERA_POSTGRES_16_BIN.
The previous description of these runs as clean CI-matching proof was incorrect.
The existing migration CI job now runs the unit suite, synthetic disposable
integration suite, and canonical-success smoke after installing PostgreSQL 16.
The canonical smoke requires no snapshot or other untracked input. Its JSON
proof is uploaded separately from the existing Phase 5 proof artifact.

Each local command below ran with only `HOME`, `PATH`, `CI=true` and
`NODE_ENV=test` supplied through `env -i`. Database tests provision their own
PostgreSQL 16 clusters, never an ambient database. These historical runs did not
prove operation with initdb absent from PATH. Their recorded outputs remain real
local results, not evidence that the original binary lookup worked in GitHub CI.

## Superseding restricted-PATH proof

The FIX reran both required jobs with every PATH directory containing
`initdb`, `postgres`, or `pg_ctl` removed. PostgreSQL was supplied only through
`LUMERA_POSTGRES_16_BIN`. Both logs begin with the actual output:

```text
BINARY_PROOF command -v initdb: not found
BINARY_PROOF LUMERA_POSTGRES_16_BIN=/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin
```

The final whole database job recorded:

```text
[2026-09-24T14:08:40Z] END phase-4-migration-integration (exit 0)
Final status: passed (exit 0)
```

Its manifest contains 67 steps, all with exit zero, and reports the owned
cluster as `stopped-and-removed`. The separate Phase 5 job exited zero; its
disposable manifest contains 105 tests, 105 passes, zero skips, and
`ownedClusterRemoved: true`. The complete final evidence, all 67 step
durations, the honest unit skip, intervening failed runs, transfer regressions,
mutations, and Neon rehearsal are recorded in
[`fix-verification.md`](./fix-verification.md).

Required non-PostgreSQL tooling remained on the restricted PATH. In particular,
the final wrapper retained the PDF inspection programs; it did not make
PostgreSQL discoverable through PATH.

## Historical initial-PR commands and exact observed results

`pnpm run test:data-transfer:unit` exited 0:

```text
ℹ tests 16
ℹ pass 16
ℹ fail 0
ℹ skipped 0
```

`pnpm run test:data-transfer:integration` exited 0:

```text
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 99407.693191
```

`pnpm run test:data-transfer:canonical` exited 0:

```text
TRANSFER_RESULT mode=canonical-success status=committed tables=256 blockers=0
VERIFICATION readiness=true structural_unchanged=true physical_unchanged=true target_data_unchanged=false
OWNED_CLUSTER_REMOVED
```

`pnpm run test:release-chain` exited 0:

```text
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5885.548616
```

`pnpm --filter @workspace/scripts run typecheck` exited 0.
These final runs include the disposable-runtime guard fix. Retained outputs
and exit files are under `.local/data-transfer/ci-final-*`.

## Historical initial-PR whole database job

This earlier owned-PostgreSQL job finished successfully, but it used the
Replit-provided PostgreSQL PATH and is not the restricted binary-resolution
proof:

```text
[2026-09-24T11:55:23Z] END phase-4-migration-integration (exit 0)
Final status: passed (exit 0)
```

Evidence: `.local/data-transfer/ci-job-complete.log`, its exit file containing
`0`, and `.local/ci-database-release-harness/runs/20260924T112802Z-1657/manifest.json`.
The manifest records `startedAt` as `2026-09-24T11:28:02Z`, `finishedAt` as
`2026-09-24T11:55:23Z`, and all 67 steps with exit 0. Its cleanup values are:

```text
"runtimeLock": "removed",
"temporaryStepEnvironment": "released",
"ownedPostgres16Cluster": "stopped-and-removed"
```

The backend checks each recorded:

```text
  All 13 checks passed.
```

Every completed step is below. The output column quotes the actual END-message
substring from the completed log; duration is the corresponding manifest value
in seconds. The local harness ran the same database-job commands with CI/test
settings, isolated fixture credentials, and no ambient database selected.

| # | Actual output | Seconds |
|---:|---|---:|
| 1 | `END prepare-isolated-test-schema (exit 0)` | 16 |
| 2 | `END reconcile-retail-cart-index (exit 0)` | 1 |
| 3 | `END verify-retail-cart-index-preparation (exit 0)` | 4 |
| 4 | `END advisory-lock-session-cleanup (exit 0)` | 6 |
| 5 | `END authenticate-reviewed-history (exit 0)` | 2 |
| 6 | `END database-test-monitoring (exit 0)` | 6 |
| 7 | `END database-test-backend-standards-static (exit 0)` | 13 |
| 8 | `END release-2-01-test-pool-runtime (exit 0)` | 1 |
| 9 | `END release-2-02-test-external-database-integration (exit 0)` | 17 |
| 10 | `END release-2-03-test-beauty-jobs (exit 0)` | 21 |
| 11 | `END release-2-04-test-backend-standards-database (exit 0)` | 3 |
| 12 | `END release-2-05-test-booking-development-schema (exit 0)` | 2 |
| 13 | `END release-2-06-test-retail-cart-index-development-schema (exit 0)` | 2 |
| 14 | `END release-2-07-test-business-growth-schema (exit 0)` | 41 |
| 15 | `END release-2-08-test-business-growth-schema-cleanup-reports (exit 0)` | 62 |
| 16 | `END release-2-09-test-business-growth-schema-boot-regression (exit 0)` | 10 |
| 17 | `END release-2-10-test-anthropic-integration-lazy-init (exit 0)` | 6 |
| 18 | `END release-2-11-test-referral-lifecycle (exit 0)` | 10 |
| 19 | `END release-2-12-test-attributed-appointments-returning (exit 0)` | 3 |
| 20 | `END release-2-13-test-business-guide-pdf (exit 0)` | 2 |
| 21 | `END release-2-14-test-business-guide-links (exit 0)` | 1 |
| 22 | `END release-2-15-test-automation-provider-events (exit 0)` | 14 |
| 23 | `END release-2-16-test-scheduler-resilience (exit 0)` | 1 |
| 24 | `END release-2-17-test-scheduler-affected-jobs (exit 0)` | 3 |
| 25 | `END release-2-18-test-sms-webhook-registration (exit 0)` | 3 |
| 26 | `END release-2-19-test-webhook-secret-reconfirmation (exit 0)` | 3 |
| 27 | `END release-2-20-test-attributed-appointments-pagination (exit 0)` | 5 |
| 28 | `END release-2-21-test-campaign-attributed-appointments-window (exit 0)` | 3 |
| 29 | `END release-2-22-test-stats-compare-window-boundaries (exit 0)` | 3 |
| 30 | `END release-2-23-test-social-oauth-domain-change (exit 0)` | 13 |
| 31 | `END release-2-24-test-social-oauth-return-to (exit 0)` | 12 |
| 32 | `END release-2-25-test-social-oauth-referral-context (exit 0)` | 14 |
| 33 | `END release-2-26-test-social-oauth-facebook-account-linking-safety (exit 0)` | 14 |
| 34 | `END release-2-27-test-social-oauth-google-account-linking-safety (exit 0)` | 14 |
| 35 | `END release-2-28-test-internal-job-secret-timing-safety (exit 0)` | 13 |
| 36 | `END release-2-29-test-safe-external-url (exit 0)` | 14 |
| 37 | `END release-2-30-test-http-security-hardening (exit 0)` | 16 |
| 38 | `END release-2-31-test-production-demo-seed (exit 0)` | 15 |
| 39 | `END release-3-01-test-date-serialization (exit 0)` | 1 |
| 40 | `END release-3-02-test-tenant-isolation (exit 0)` | 9 |
| 41 | `END release-3-03-test-employee-location-deactivation-scoping (exit 0)` | 6 |
| 42 | `END release-3-04-test-appointment-regressions (exit 0)` | 21 |
| 43 | `END release-3-05-test-query-counts (exit 0)` | 6 |
| 44 | `END release-3-06-test-query-budgets (exit 0)` | 4 |
| 45 | `END release-3-07-test-phone-contact-sql-bounds (exit 0)` | 14 |
| 46 | `END release-3-08-test-catalog-cache (exit 0)` | 4 |
| 47 | `END release-3-09-test-communication-archive (exit 0)` | 5 |
| 48 | `END release-3-10-test-admin-validation (exit 0)` | 13 |
| 49 | `END release-3-11-test-customer-password-setup (exit 0)` | 15 |
| 50 | `END release-3-12-test-login-rate-limit (exit 0)` | 22 |
| 51 | `END release-3-13-test-change-password-session-revocation (exit 0)` | 21 |
| 52 | `END release-3-14-test-owner-reset-password-session-revocation (exit 0)` | 25 |
| 53 | `END release-3-15-test-education-b2b-checkout-idempotency (exit 0)` | 15 |
| 54 | `END release-3-16-test-education-b2b-integration (exit 0)` | 15 |
| 55 | `END release-3-17-test-education-popular-featured-ranking (exit 0)` | 5 |
| 56 | `END release-3-18-test-education-featured-eligibility-consistency (exit 0)` | 5 |
| 57 | `END release-3-19-test-education-course-featured-authorization (exit 0)` | 6 |
| 58 | `END release-3-20-test-custom-fetch (exit 0)` | 1 |
| 59 | `END release-3-21-test-idempotency-key-lifecycle (exit 0)` | 1 |
| 60 | `END release-3-22-test-admin-order-search (exit 0)` | 12 |
| 61 | `END release-3-23-test-admin-list-pagination (exit 0)` | 14 |
| 62 | `END release-3-24-test-admin-summary (exit 0)` | 17 |
| 63 | `END release-3-25-test-loyalty-status (exit 0)` | 6 |
| 64 | `END release-3-26-test-api-preflight (exit 0)` | 0 |
| 65 | `END release-3-27-test-api-regressions (exit 0)` | 47 |
| 66 | `END release-3-28-test-api-regressions-lifecycle (exit 0)` | 715 |
| 67 | `END phase-4-migration-integration (exit 0)` | 221 |

## Earlier attempts, not counted as passes

Two detached launches were terminated by the shell-tool process lifecycle before
any CI step completed. The verified stopped, runner-owned interrupted temporary
cluster was removed.

The first completed run (`ci-job.log`) correctly failed before the new harness
had been registered with the destructive-runtime guard:

```text
AssertionError [ERR_ASSERTION]: Every sink-discovered harness must use the mandatory database-test boundary or be registered for guard execution.
[2026-09-24T11:02:24Z] END release-3-28-test-api-regressions-lifecycle (exit 1)
Final status: failed (exit 1)
```

The guard registration and sentinel regression were added, and all three new
commands were rerun as recorded above. A subsequent whole-job attempt
(`ci-job-final.log`) was interrupted by a workspace restart and supplied no
completed exit result; it is not a test failure or a passing run. The canonical
command also had an interrupted attempt during that restart and was rerun to
the successful result above. The final uninterrupted complete job is
`ci-job-complete.log`, not either earlier file.