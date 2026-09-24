# PR 42 FIX verification

This report quotes retained output from actual runs. It does not substitute
expected output for execution evidence. No development or production database
was selected. Disposable tests used runner-owned PostgreSQL 16 clusters. The
only hosted target used was the specifically authorized
`LUMERA_NEON_TEST_BRANCH2_URL` rehearsal.

## PostgreSQL binary resolution

The final CI database and Phase 5 jobs ran through the restricted wrapper. The
wrapper removed every PATH directory containing PostgreSQL server programs and
preserved required non-PostgreSQL tools such as `pdfinfo`. Both final job logs
begin:

```text
BINARY_PROOF command -v initdb: not found
BINARY_PROOF LUMERA_POSTGRES_16_BIN=/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin
```

`owned-pair.ts` and the affected test harnesses resolve PostgreSQL programs from
the explicit installation directory. The four commands exposed by the first
restricted whole-job attempt were rerun together on a runner-owned cluster.
Their actual focused output includes:

```text
✔ actual application pool selects only the runtime-authorized URL (2303.479572ms)
✔ actual application import refuses invalid deployment overrides with zero network attempts (2506.216858ms)
✔ the application pool preserves defaults and transaction-local timeout restores (795.070234ms)
✔ broken state: rollout already current, cleanup-reports table missing -> repaired without throwing (10683.73865ms)
✔ fresh database: no rollout row, no cleanup-reports table -> normal full rollout creates both (12728.804542ms)
✔ already healthy database: rollout current, table already exists -> repeat call is idempotent (12543.254483ms)
✔ concurrent callers against the same broken-state database both succeed, table exists exactly once (9733.067741ms)
✔ business guide PDF has complete, correctly numbered TOC and footers (498.557071ms)
```

The same focused run completed the API regressions successfully. Evidence:
`.local/data-transfer-fix/binary-focused-four.log`.

## Trigger policy and dependency order

The closed list and one-line reason for each of the 24 canonical triggers lives
in [`trigger-policy.md`](./trigger-policy.md) and
`scripts/src/data-transfer/trigger-policy.ts`.

- Twenty-one validating triggers remain enabled and reject invalid rows.
- Only three mutating/side-effecting triggers are disabled by their exact names
  inside the target transaction: the two payment-reference assigners and the
  restock-waitlist outbox trigger.
- The payment-reference presence invariant is checked explicitly after loading.
  The historical stock transition represented by the outbox trigger has no
  snapshot invariant; replaying its notifications is intentionally forbidden.
- Every disabled trigger is re-enabled before final policy and fingerprint
  verification. An unknown trigger, a disabled validator, or an unexpected
  trigger mode refuses the transfer.

Foreign keys remain enabled. A pending-row scheduler loads rows only after
non-null FK parents are present. It permits PostgreSQL-satisfiable self
references while enabled validating triggers still enforce business rules.
Nullable edges break cycles. Missing parents and unresolved non-null cycles
produce `FOREIGN_KEY_DEPENDENCY_BLOCKED`; the tool never disables FKs or
silently repairs a row. Explicit post-load constraint verification still runs.

## Final transfer test runs

The final unit log proves the restricted PATH and records:

```text
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2213.405673
```

The final disposable integration log contains these actual pass lines:

```text
✔ transfer refuses a target session already configured in replica mode (4357.619348ms)
✔ canonical ownership trigger rejects self-parent category during the real transfer (22480.2784ms)
✔ transfer refuses a source-only column without changing the target (7076.601533ms)
✔ transfer refuses a target-only NOT NULL column without a default (3942.058985ms)
✔ transfer reports foreign-key violation counts and rolls back every loaded row (5371.597822ms)
✔ transfer refuses a non-empty target even when its schema is canonical (20699.017805ms)
✔ shared load transaction refuses a non-empty synthetic target (5428.696241ms)
✔ transfer refuses a wrong declared target identity before any write (20552.31257ms)
✔ positive sequence transfer advances beyond every transferred value (4652.087731ms)
✔ positive no-primary-key transfer preserves duplicate multiplicity (4865.134281ms)
✔ validating trigger rejects a category that is its own parent (5210.80674ms)
✔ every disabled trigger is restored before commit and fingerprint verification (5251.484214ms)
✔ rehearsal verifies a complete transfer then rolls back rows and sequences (3806.449599ms)
✔ transfer never reads the source ledger or writes the target ledger (4511.003923ms)
✔ shared load transaction suppresses synthetic INSERT trigger side effects and preserves source values (5224.22354ms)
✔ transfer explicitly verifies standalone unique indexes and exclusion constraints (5408.605111ms)
✔ standalone unique constraint rejection reports the observed row and rolls back (5309.961807ms)
✔ shared generated-column mismatch rolls back instead of silently recomputing data (4359.396214ms)
✔ target-only sequence default is blocked without advancing its sequence (4548.664434ms)
ℹ tests 19
ℹ pass 19
ℹ fail 0
ℹ skipped 0
```

Evidence: `.local/data-transfer-fix/final-safety-unit.log` and
`.local/data-transfer-fix/final-safety-integration.log`, each with an exit file
containing `0`.

The engine sets a 30-minute statement timeout on both sessions. Safe SQL
failures expose the step and SQLSTATE but no row data or connection details.
Source rollback is attempted independently even if target rollback fails.
Refused, failed, and rehearsal reports contain `vacuumRecommended: true`;
VACUUM is an operator action and is not run automatically.

## Five actual mutants

Each final scratch mutant process exited one with one failed selected test. The
actual killing messages were:

```text
AssertionError [ERR_ASSERTION]: wrong declared identity must fail with the exact identity error
AssertionError [ERR_ASSERTION]: sequence must restart above the highest transferred value
AssertionError [ERR_ASSERTION]: duplicate rows must not be discarded during transfer
AssertionError [ERR_ASSERTION]: Missing expected rejection: the canonical validating ownership trigger must reject a self-parent category
AssertionError [ERR_ASSERTION]: disabled trigger must be re-enabled before final policy and fingerprint verification
```

Each mutant summary was:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Tracked engine source was not mutated. Evidence and exact diagnostics are in
[`fix-testing.md`](./fix-testing.md) and
`.local/data-transfer-fix/mutant-safety-*.log`.

## Authorized Neon rehearsal

The ledger was bound once with the prior pinned full BRANCH2 declaration. That
record is historical backend evidence, not independent control-plane proof. The
final-core repeat used `--already-bound`, so it performed no further binding.
Its actual output was:

```text
BINARY_PROOF command -v initdb: not found
NEON_DECLARATION verified=1 prior_record=1 control_plane_proof=0
NEON_BIND already_bound_ready=true binding_skipped=true
NEON_REHEARSAL status=rehearsed tables=256 blockers=0 vacuum_recommended=true
NEON_AFTER readiness=true data_unchanged=true ledger_unchanged=true triggers_unchanged=true structural_unchanged=true physical_unchanged=true
OWNED_SOURCE_REMOVED
```

Thus no rehearsal row remained, every trigger was re-enabled, the target
ledger remained unchanged after the authorized binding, readiness passed, and
both fingerprints were unchanged. Full details:
[`neon-rehearsal.md`](./neon-rehearsal.md).

## Restricted Phase 5 job

`.local/data-transfer-fix/phase5-job.exit` contains `0`. The database-free unit
run honestly contains one skip:

```text
﹣ disposable equivalence characterization requires an explicit child-database admin target (0.109656ms) # Pass --admin-url=postgresql://127.0.0.1:<non-5432-port>/<admin-db> to run disposable characterization.
ℹ tests 95
ℹ pass 94
ℹ fail 0
ℹ skipped 1
```

The complete disposable manifest reports 12 results totaling:

```text
tests: 105
passed: 105
skipped: 0
status: passed
ownedClusterRemoved: true
```

The additional transfer units passed 19/19; canonical transfer output was:

```text
TRANSFER_RESULT mode=canonical-success status=committed tables=256 blockers=0
VERIFICATION readiness=true structural_unchanged=true physical_unchanged=true target_data_unchanged=false
OWNED_CLUSTER_REMOVED
```

Release-chain output was:

```text
ℹ tests 30
ℹ pass 30
ℹ fail 0
ℹ skipped 0
```

The scripts TypeScript check also exited zero.

## Final whole CI database job

`.local/data-transfer-fix/ci-database-complete.exit` contains `0`. Actual final
status:

```text
[2026-09-24T14:08:40Z] END phase-4-migration-integration (exit 0)
Final status: passed (exit 0)
```

The manifest at run `20260924T134340Z-78042` records start
`2026-09-24T13:43:40Z`, finish `2026-09-24T14:08:40Z`, all 67 steps with exit
zero, and:

```text
"runtimeLock": "removed",
"temporaryStepEnvironment": "released",
"ownedPostgres16Cluster": "stopped-and-removed"
```

Backend standards printed:

```text
All 13 checks passed.
```

Every row below quotes the actual END-message substring and manifest duration:

| # | Actual output | Seconds |
|---:|---|---:|
| 1 | `END prepare-isolated-test-schema (exit 0)` | 9 |
| 2 | `END reconcile-retail-cart-index (exit 0)` | 1 |
| 3 | `END verify-retail-cart-index-preparation (exit 0)` | 4 |
| 4 | `END advisory-lock-session-cleanup (exit 0)` | 5 |
| 5 | `END authenticate-reviewed-history (exit 0)` | 3 |
| 6 | `END database-test-monitoring (exit 0)` | 2 |
| 7 | `END database-test-backend-standards-static (exit 0)` | 10 |
| 8 | `END release-2-01-test-pool-runtime (exit 0)` | 2 |
| 9 | `END release-2-02-test-external-database-integration (exit 0)` | 16 |
| 10 | `END release-2-03-test-beauty-jobs (exit 0)` | 20 |
| 11 | `END release-2-04-test-backend-standards-database (exit 0)` | 2 |
| 12 | `END release-2-05-test-booking-development-schema (exit 0)` | 2 |
| 13 | `END release-2-06-test-retail-cart-index-development-schema (exit 0)` | 2 |
| 14 | `END release-2-07-test-business-growth-schema (exit 0)` | 34 |
| 15 | `END release-2-08-test-business-growth-schema-cleanup-reports (exit 0)` | 48 |
| 16 | `END release-2-09-test-business-growth-schema-boot-regression (exit 0)` | 10 |
| 17 | `END release-2-10-test-anthropic-integration-lazy-init (exit 0)` | 11 |
| 18 | `END release-2-11-test-referral-lifecycle (exit 0)` | 9 |
| 19 | `END release-2-12-test-attributed-appointments-returning (exit 0)` | 3 |
| 20 | `END release-2-13-test-business-guide-pdf (exit 0)` | 1 |
| 21 | `END release-2-14-test-business-guide-links (exit 0)` | 1 |
| 22 | `END release-2-15-test-automation-provider-events (exit 0)` | 15 |
| 23 | `END release-2-16-test-scheduler-resilience (exit 0)` | 1 |
| 24 | `END release-2-17-test-scheduler-affected-jobs (exit 0)` | 2 |
| 25 | `END release-2-18-test-sms-webhook-registration (exit 0)` | 3 |
| 26 | `END release-2-19-test-webhook-secret-reconfirmation (exit 0)` | 3 |
| 27 | `END release-2-20-test-attributed-appointments-pagination (exit 0)` | 3 |
| 28 | `END release-2-21-test-campaign-attributed-appointments-window (exit 0)` | 3 |
| 29 | `END release-2-22-test-stats-compare-window-boundaries (exit 0)` | 3 |
| 30 | `END release-2-23-test-social-oauth-domain-change (exit 0)` | 12 |
| 31 | `END release-2-24-test-social-oauth-return-to (exit 0)` | 13 |
| 32 | `END release-2-25-test-social-oauth-referral-context (exit 0)` | 14 |
| 33 | `END release-2-26-test-social-oauth-facebook-account-linking-safety (exit 0)` | 13 |
| 34 | `END release-2-27-test-social-oauth-google-account-linking-safety (exit 0)` | 14 |
| 35 | `END release-2-28-test-internal-job-secret-timing-safety (exit 0)` | 13 |
| 36 | `END release-2-29-test-safe-external-url (exit 0)` | 13 |
| 37 | `END release-2-30-test-http-security-hardening (exit 0)` | 15 |
| 38 | `END release-2-31-test-production-demo-seed (exit 0)` | 15 |
| 39 | `END release-3-01-test-date-serialization (exit 0)` | 1 |
| 40 | `END release-3-02-test-tenant-isolation (exit 0)` | 7 |
| 41 | `END release-3-03-test-employee-location-deactivation-scoping (exit 0)` | 5 |
| 42 | `END release-3-04-test-appointment-regressions (exit 0)` | 22 |
| 43 | `END release-3-05-test-query-counts (exit 0)` | 5 |
| 44 | `END release-3-06-test-query-budgets (exit 0)` | 3 |
| 45 | `END release-3-07-test-phone-contact-sql-bounds (exit 0)` | 14 |
| 46 | `END release-3-08-test-catalog-cache (exit 0)` | 3 |
| 47 | `END release-3-09-test-communication-archive (exit 0)` | 5 |
| 48 | `END release-3-10-test-admin-validation (exit 0)` | 13 |
| 49 | `END release-3-11-test-customer-password-setup (exit 0)` | 16 |
| 50 | `END release-3-12-test-login-rate-limit (exit 0)` | 22 |
| 51 | `END release-3-13-test-change-password-session-revocation (exit 0)` | 14 |
| 52 | `END release-3-14-test-owner-reset-password-session-revocation (exit 0)` | 16 |
| 53 | `END release-3-15-test-education-b2b-checkout-idempotency (exit 0)` | 14 |
| 54 | `END release-3-16-test-education-b2b-integration (exit 0)` | 14 |
| 55 | `END release-3-17-test-education-popular-featured-ranking (exit 0)` | 5 |
| 56 | `END release-3-18-test-education-featured-eligibility-consistency (exit 0)` | 5 |
| 57 | `END release-3-19-test-education-course-featured-authorization (exit 0)` | 5 |
| 58 | `END release-3-20-test-custom-fetch (exit 0)` | 1 |
| 59 | `END release-3-21-test-idempotency-key-lifecycle (exit 0)` | 1 |
| 60 | `END release-3-22-test-admin-order-search (exit 0)` | 13 |
| 61 | `END release-3-23-test-admin-list-pagination (exit 0)` | 14 |
| 62 | `END release-3-24-test-admin-summary (exit 0)` | 16 |
| 63 | `END release-3-25-test-loyalty-status (exit 0)` | 5 |
| 64 | `END release-3-26-test-api-preflight (exit 0)` | 1 |
| 65 | `END release-3-27-test-api-regressions (exit 0)` | 46 |
| 66 | `END release-3-28-test-api-regressions-lifecycle (exit 0)` | 662 |
| 67 | `END phase-4-migration-integration (exit 0)` | 199 |

## Earlier restricted attempts

The reports retain, and do not count as passes, the preceding failures:

1. the first restricted run found unregistered
   `scripts/src/data-transfer/trigger-policy.test.ts`;
2. after guard coverage was fixed, another run exposed bare `initdb`,
   `createdb`, `psql`, and missing `pdfinfo` in four legacy command paths;
3. the focused four-command run passed after those paths used the explicit
   PostgreSQL installation and retained non-PostgreSQL PDF tooling; and
4. the final uninterrupted run above passed all 67 steps.

No failed or interrupted run was relabeled as successful.