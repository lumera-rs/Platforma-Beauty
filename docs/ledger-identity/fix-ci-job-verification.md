# Ledger identity fix: full CI job verification

The CI database release harness completed successfully. The authoritative run
was selected by `.local/ci-database-release-harness/latest-run`:

```text
/home/runner/workspace/.local/ci-database-release-harness/runs/20260924T080735Z-59288
```

Its manifest records:

```text
"job": "ci-database-release-2-and-3",
"status": "passed",
"exitCode": 0,
"startedAt": "2026-09-24T08:07:35Z",
"finishedAt": "2026-09-24T08:40:22Z"
```

The job log ends with:

```text
Final status: passed (exit 0)
```

## All 67 steps

Commands and durations are the actual values in the run manifest. Every
quoted `END` value is an exact substring of `.local/ledger-fix/ci-job.log`.

| # | Step | Exact command | Duration | Exit | Exact END-log substring |
|---:|---|---|---:|---:|---|
| 1 | prepare-isolated-test-schema | `pnpm --filter @workspace/db run push-force` | 11s | `0` | `END prepare-isolated-test-schema (exit 0)` |
| 2 | reconcile-retail-cart-index | `pnpm --filter @workspace/scripts run ensure:retail-cart-index:ci` | 1s | `0` | `END reconcile-retail-cart-index (exit 0)` |
| 3 | verify-retail-cart-index-preparation | `pnpm --filter @workspace/scripts run test:retail-cart-ci-preparation` | 7s | `0` | `END verify-retail-cart-index-preparation (exit 0)` |
| 4 | advisory-lock-session-cleanup | `env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm run test:advisory-lock-session-cleanup` | 6s | `0` | `END advisory-lock-session-cleanup (exit 0)` |
| 5 | authenticate-reviewed-history | `env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm --filter @workspace/scripts run validate:ci:reviewed-history` | 2s | `0` | `END authenticate-reviewed-history (exit 0)` |
| 6 | database-test-monitoring | `pnpm run test:monitoring` | 5s | `0` | `END database-test-monitoring (exit 0)` |
| 7 | database-test-backend-standards-static | `pnpm run test:backend-standards:static` | 14s | `0` | `END database-test-backend-standards-static (exit 0)` |
| 8 | release-2-01-test-pool-runtime | `pnpm run test:pool-runtime` | 1s | `0` | `END release-2-01-test-pool-runtime (exit 0)` |
| 9 | release-2-02-test-external-database-integration | `pnpm run test:external-database:integration` | 27s | `0` | `END release-2-02-test-external-database-integration (exit 0)` |
| 10 | release-2-03-test-beauty-jobs | `pnpm run test:beauty-jobs` | 40s | `0` | `END release-2-03-test-beauty-jobs (exit 0)` |
| 11 | release-2-04-test-backend-standards-database | `pnpm run test:backend-standards:database` | 3s | `0` | `END release-2-04-test-backend-standards-database (exit 0)` |
| 12 | release-2-05-test-booking-development-schema | `pnpm run test:booking-development-schema` | 2s | `0` | `END release-2-05-test-booking-development-schema (exit 0)` |
| 13 | release-2-06-test-retail-cart-index-development-schema | `pnpm run test:retail-cart-index-development-schema` | 2s | `0` | `END release-2-06-test-retail-cart-index-development-schema (exit 0)` |
| 14 | release-2-07-test-business-growth-schema | `pnpm run test:business-growth-schema` | 127s | `0` | `END release-2-07-test-business-growth-schema (exit 0)` |
| 15 | release-2-08-test-business-growth-schema-cleanup-reports | `pnpm run test:business-growth-schema-cleanup-reports` | 133s | `0` | `END release-2-08-test-business-growth-schema-cleanup-reports (exit 0)` |
| 16 | release-2-09-test-business-growth-schema-boot-regression | `pnpm run test:business-growth-schema-boot-regression` | 14s | `0` | `END release-2-09-test-business-growth-schema-boot-regression (exit 0)` |
| 17 | release-2-10-test-anthropic-integration-lazy-init | `pnpm run test:anthropic-integration-lazy-init` | 7s | `0` | `END release-2-10-test-anthropic-integration-lazy-init (exit 0)` |
| 18 | release-2-11-test-referral-lifecycle | `pnpm run test:referral-lifecycle` | 12s | `0` | `END release-2-11-test-referral-lifecycle (exit 0)` |
| 19 | release-2-12-test-attributed-appointments-returning | `pnpm run test:attributed-appointments-returning` | 3s | `0` | `END release-2-12-test-attributed-appointments-returning (exit 0)` |
| 20 | release-2-13-test-business-guide-pdf | `pnpm run test:business-guide-pdf` | 2s | `0` | `END release-2-13-test-business-guide-pdf (exit 0)` |
| 21 | release-2-14-test-business-guide-links | `pnpm run test:business-guide-links` | 1s | `0` | `END release-2-14-test-business-guide-links (exit 0)` |
| 22 | release-2-15-test-automation-provider-events | `pnpm run test:automation-provider-events` | 17s | `0` | `END release-2-15-test-automation-provider-events (exit 0)` |
| 23 | release-2-16-test-scheduler-resilience | `pnpm run test:scheduler-resilience` | 2s | `0` | `END release-2-16-test-scheduler-resilience (exit 0)` |
| 24 | release-2-17-test-scheduler-affected-jobs | `pnpm run test:scheduler-affected-jobs` | 3s | `0` | `END release-2-17-test-scheduler-affected-jobs (exit 0)` |
| 25 | release-2-18-test-sms-webhook-registration | `pnpm run test:sms-webhook-registration` | 3s | `0` | `END release-2-18-test-sms-webhook-registration (exit 0)` |
| 26 | release-2-19-test-webhook-secret-reconfirmation | `pnpm run test:webhook-secret-reconfirmation` | 4s | `0` | `END release-2-19-test-webhook-secret-reconfirmation (exit 0)` |
| 27 | release-2-20-test-attributed-appointments-pagination | `pnpm run test:attributed-appointments-pagination` | 4s | `0` | `END release-2-20-test-attributed-appointments-pagination (exit 0)` |
| 28 | release-2-21-test-campaign-attributed-appointments-window | `pnpm run test:campaign-attributed-appointments-window` | 3s | `0` | `END release-2-21-test-campaign-attributed-appointments-window (exit 0)` |
| 29 | release-2-22-test-stats-compare-window-boundaries | `pnpm run test:stats-compare-window-boundaries` | 4s | `0` | `END release-2-22-test-stats-compare-window-boundaries (exit 0)` |
| 30 | release-2-23-test-social-oauth-domain-change | `pnpm run test:social-oauth-domain-change` | 14s | `0` | `END release-2-23-test-social-oauth-domain-change (exit 0)` |
| 31 | release-2-24-test-social-oauth-return-to | `pnpm run test:social-oauth-return-to` | 14s | `0` | `END release-2-24-test-social-oauth-return-to (exit 0)` |
| 32 | release-2-25-test-social-oauth-referral-context | `pnpm run test:social-oauth-referral-context` | 15s | `0` | `END release-2-25-test-social-oauth-referral-context (exit 0)` |
| 33 | release-2-26-test-social-oauth-facebook-account-linking-safety | `pnpm run test:social-oauth-facebook-account-linking-safety` | 15s | `0` | `END release-2-26-test-social-oauth-facebook-account-linking-safety (exit 0)` |
| 34 | release-2-27-test-social-oauth-google-account-linking-safety | `pnpm run test:social-oauth-google-account-linking-safety` | 15s | `0` | `END release-2-27-test-social-oauth-google-account-linking-safety (exit 0)` |
| 35 | release-2-28-test-internal-job-secret-timing-safety | `pnpm run test:internal-job-secret-timing-safety` | 21s | `0` | `END release-2-28-test-internal-job-secret-timing-safety (exit 0)` |
| 36 | release-2-29-test-safe-external-url | `pnpm run test:safe-external-url` | 15s | `0` | `END release-2-29-test-safe-external-url (exit 0)` |
| 37 | release-2-30-test-http-security-hardening | `pnpm run test:http-security-hardening` | 16s | `0` | `END release-2-30-test-http-security-hardening (exit 0)` |
| 38 | release-2-31-test-production-demo-seed | `pnpm run test:production-demo-seed` | 17s | `0` | `END release-2-31-test-production-demo-seed (exit 0)` |
| 39 | release-3-01-test-date-serialization | `pnpm run test:date-serialization` | 1s | `0` | `END release-3-01-test-date-serialization (exit 0)` |
| 40 | release-3-02-test-tenant-isolation | `pnpm run test:tenant-isolation` | 8s | `0` | `END release-3-02-test-tenant-isolation (exit 0)` |
| 41 | release-3-03-test-employee-location-deactivation-scoping | `pnpm run test:employee-location-deactivation-scoping` | 6s | `0` | `END release-3-03-test-employee-location-deactivation-scoping (exit 0)` |
| 42 | release-3-04-test-appointment-regressions | `pnpm run test:appointment-regressions` | 26s | `0` | `END release-3-04-test-appointment-regressions (exit 0)` |
| 43 | release-3-05-test-query-counts | `pnpm run test:query-counts` | 7s | `0` | `END release-3-05-test-query-counts (exit 0)` |
| 44 | release-3-06-test-query-budgets | `pnpm run test:query-budgets` | 3s | `0` | `END release-3-06-test-query-budgets (exit 0)` |
| 45 | release-3-07-test-phone-contact-sql-bounds | `pnpm run test:phone-contact-sql-bounds` | 14s | `0` | `END release-3-07-test-phone-contact-sql-bounds (exit 0)` |
| 46 | release-3-08-test-catalog-cache | `pnpm run test:catalog-cache` | 4s | `0` | `END release-3-08-test-catalog-cache (exit 0)` |
| 47 | release-3-09-test-communication-archive | `pnpm run test:communication-archive` | 6s | `0` | `END release-3-09-test-communication-archive (exit 0)` |
| 48 | release-3-10-test-admin-validation | `pnpm run test:admin-validation` | 13s | `0` | `END release-3-10-test-admin-validation (exit 0)` |
| 49 | release-3-11-test-customer-password-setup | `pnpm run test:customer-password-setup` | 16s | `0` | `END release-3-11-test-customer-password-setup (exit 0)` |
| 50 | release-3-12-test-login-rate-limit | `pnpm run test:login-rate-limit` | 26s | `0` | `END release-3-12-test-login-rate-limit (exit 0)` |
| 51 | release-3-13-test-change-password-session-revocation | `pnpm run test:change-password-session-revocation` | 16s | `0` | `END release-3-13-test-change-password-session-revocation (exit 0)` |
| 52 | release-3-14-test-owner-reset-password-session-revocation | `pnpm run test:owner-reset-password-session-revocation` | 16s | `0` | `END release-3-14-test-owner-reset-password-session-revocation (exit 0)` |
| 53 | release-3-15-test-education-b2b-checkout-idempotency | `pnpm run test:education-b2b-checkout-idempotency` | 15s | `0` | `END release-3-15-test-education-b2b-checkout-idempotency (exit 0)` |
| 54 | release-3-16-test-education-b2b-integration | `pnpm run test:education-b2b-integration` | 14s | `0` | `END release-3-16-test-education-b2b-integration (exit 0)` |
| 55 | release-3-17-test-education-popular-featured-ranking | `pnpm run test:education-popular-featured-ranking` | 7s | `0` | `END release-3-17-test-education-popular-featured-ranking (exit 0)` |
| 56 | release-3-18-test-education-featured-eligibility-consistency | `pnpm run test:education-featured-eligibility-consistency` | 6s | `0` | `END release-3-18-test-education-featured-eligibility-consistency (exit 0)` |
| 57 | release-3-19-test-education-course-featured-authorization | `pnpm run test:education-course-featured-authorization` | 6s | `0` | `END release-3-19-test-education-course-featured-authorization (exit 0)` |
| 58 | release-3-20-test-custom-fetch | `pnpm run test:custom-fetch` | 1s | `0` | `END release-3-20-test-custom-fetch (exit 0)` |
| 59 | release-3-21-test-idempotency-key-lifecycle | `pnpm run test:idempotency-key-lifecycle` | 1s | `0` | `END release-3-21-test-idempotency-key-lifecycle (exit 0)` |
| 60 | release-3-22-test-admin-order-search | `pnpm run test:admin-order-search` | 14s | `0` | `END release-3-22-test-admin-order-search (exit 0)` |
| 61 | release-3-23-test-admin-list-pagination | `pnpm run test:admin-list-pagination` | 13s | `0` | `END release-3-23-test-admin-list-pagination (exit 0)` |
| 62 | release-3-24-test-admin-summary | `pnpm run test:admin-summary` | 18s | `0` | `END release-3-24-test-admin-summary (exit 0)` |
| 63 | release-3-25-test-loyalty-status | `pnpm run test:loyalty-status` | 7s | `0` | `END release-3-25-test-loyalty-status (exit 0)` |
| 64 | release-3-26-test-api-preflight | `pnpm run test:api-preflight` | 1s | `0` | `END release-3-26-test-api-preflight (exit 0)` |
| 65 | release-3-27-test-api-regressions | `pnpm run test:api-regressions` | 60s | `0` | `END release-3-27-test-api-regressions (exit 0)` |
| 66 | release-3-28-test-api-regressions-lifecycle | `pnpm run test:api-regressions-lifecycle` | 790s | `0` | `END release-3-28-test-api-regressions-lifecycle (exit 0)` |
| 67 | phase-4-migration-integration | `LUMERA_PHASE4_DISPOSABLE_DATABASE_URL='postgres://lumera_ci:lumera_ci@127.0.0.1:55432/lumera_ci_database' LUMERA_PHASE4_DISPOSABLE_DB=1 pnpm run test:migrations:integration` | 241s | `0` | `END phase-4-migration-integration (exit 0)` |

The 67 manifest durations sum to 1,958 seconds. All 67 manifest exit codes are
zero and all 67 exact `END` substrings report exit zero.

## Available-count summary

The backend-standards static phase and the database phase each report the
actual available count, 13:

```text
All 13 checks passed.
```

No unavailable checks were added to that count.

## Cleanup

The run manifest's cleanup result is:

```text
"runtimeLock": "removed",
"temporaryStepEnvironment": "released",
"ownedPostgres16Cluster": "stopped-and-removed"
```