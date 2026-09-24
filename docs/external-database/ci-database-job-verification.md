# CI database job verification

This records the final clean local reproduction of the CI database preparation,
Release Phase 2, and Release Phase 3 chain. The source manifest is
`.local/ci-database-release-harness/runs/20260923T223623Z-125/manifest.json`.
That ignored artifact is supporting evidence; this document is the tracked
record.

## Run and environment

- Job: `ci-database-release-2-and-3`
- Result: **passed**, exit code `0`
- Started: `2026-09-23T22:36:23Z`
- Finished: `2026-09-23T22:59:15Z`
- Wall time: 1,372 seconds (22 minutes 52 seconds)
- Cleanup: `stopped-and-removed`
- Workspace: `/home/runner/workspace`
- `CI=true`
- `NODE_ENV=test`
- `DATABASE_URL=postgres://lumera_ci:***@127.0.0.1:55432/lumera_ci_database`
- `SESSION_SECRET=[CI fixture value]`
- `LUMERA_DISPOSABLE_ADMIN_URL=postgres://lumera_ci@127.0.0.1:55432/lumera_ci_database`
- `LUMERA_DISPOSABLE_DATABASE=null`
- Ambient variables retained: `HOME`, `PATH`

All 66 manifest steps passed with exit code 0. The durations below are the
manifest's integer-second durations.

## Preparation

| # | Step | Command | Duration | Exit |
|---:|---|---|---:|---:|
| 1 | prepare-isolated-test-schema | `pnpm --filter @workspace/db run push-force` | 12s | 0 |
| 2 | reconcile-retail-cart-index | `pnpm --filter @workspace/scripts run ensure:retail-cart-index:ci` | 2s | 0 |
| 3 | verify-retail-cart-index-preparation | `pnpm --filter @workspace/scripts run test:retail-cart-ci-preparation` | 5s | 0 |
| 4 | advisory-lock-session-cleanup | `env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm run test:advisory-lock-session-cleanup` | 5s | 0 |
| 5 | authenticate-reviewed-history | `env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm --filter @workspace/scripts run validate:ci:reviewed-history` | 3s | 0 |
| 6 | database-test-monitoring | `pnpm run test:monitoring` | 8s | 0 |
| 7 | database-test-backend-standards-static | `pnpm run test:backend-standards:static` | 15s | 0 |

## Release Phase 2

| # | Step | Command | Duration | Exit |
|---:|---|---|---:|---:|
| 8 | release-2-01-test-pool-runtime | `pnpm run test:pool-runtime` | 2s | 0 |
| 9 | release-2-02-test-external-database-integration | `pnpm run test:external-database:integration` | 17s | 0 |
| 10 | release-2-03-test-beauty-jobs | `pnpm run test:beauty-jobs` | 23s | 0 |
| 11 | release-2-04-test-backend-standards-database | `pnpm run test:backend-standards:database` | 3s | 0 |
| 12 | release-2-05-test-booking-development-schema | `pnpm run test:booking-development-schema` | 2s | 0 |
| 13 | release-2-06-test-retail-cart-index-development-schema | `pnpm run test:retail-cart-index-development-schema` | 2s | 0 |
| 14 | release-2-07-test-business-growth-schema | `pnpm run test:business-growth-schema` | 36s | 0 |
| 15 | release-2-08-test-business-growth-schema-cleanup-reports | `pnpm run test:business-growth-schema-cleanup-reports` | 55s | 0 |
| 16 | release-2-09-test-business-growth-schema-boot-regression | `pnpm run test:business-growth-schema-boot-regression` | 11s | 0 |
| 17 | release-2-10-test-anthropic-integration-lazy-init | `pnpm run test:anthropic-integration-lazy-init` | 7s | 0 |
| 18 | release-2-11-test-referral-lifecycle | `pnpm run test:referral-lifecycle` | 9s | 0 |
| 19 | release-2-12-test-attributed-appointments-returning | `pnpm run test:attributed-appointments-returning` | 3s | 0 |
| 20 | release-2-13-test-business-guide-pdf | `pnpm run test:business-guide-pdf` | 1s | 0 |
| 21 | release-2-14-test-business-guide-links | `pnpm run test:business-guide-links` | 2s | 0 |
| 22 | release-2-15-test-automation-provider-events | `pnpm run test:automation-provider-events` | 15s | 0 |
| 23 | release-2-16-test-scheduler-resilience | `pnpm run test:scheduler-resilience` | 2s | 0 |
| 24 | release-2-17-test-scheduler-affected-jobs | `pnpm run test:scheduler-affected-jobs` | 2s | 0 |
| 25 | release-2-18-test-sms-webhook-registration | `pnpm run test:sms-webhook-registration` | 4s | 0 |
| 26 | release-2-19-test-webhook-secret-reconfirmation | `pnpm run test:webhook-secret-reconfirmation` | 3s | 0 |
| 27 | release-2-20-test-attributed-appointments-pagination | `pnpm run test:attributed-appointments-pagination` | 4s | 0 |
| 28 | release-2-21-test-campaign-attributed-appointments-window | `pnpm run test:campaign-attributed-appointments-window` | 3s | 0 |
| 29 | release-2-22-test-stats-compare-window-boundaries | `pnpm run test:stats-compare-window-boundaries` | 3s | 0 |
| 30 | release-2-23-test-social-oauth-domain-change | `pnpm run test:social-oauth-domain-change` | 14s | 0 |
| 31 | release-2-24-test-social-oauth-return-to | `pnpm run test:social-oauth-return-to` | 13s | 0 |
| 32 | release-2-25-test-social-oauth-referral-context | `pnpm run test:social-oauth-referral-context` | 13s | 0 |
| 33 | release-2-26-test-social-oauth-facebook-account-linking-safety | `pnpm run test:social-oauth-facebook-account-linking-safety` | 14s | 0 |
| 34 | release-2-27-test-social-oauth-google-account-linking-safety | `pnpm run test:social-oauth-google-account-linking-safety` | 14s | 0 |
| 35 | release-2-28-test-internal-job-secret-timing-safety | `pnpm run test:internal-job-secret-timing-safety` | 13s | 0 |
| 36 | release-2-29-test-safe-external-url | `pnpm run test:safe-external-url` | 14s | 0 |
| 37 | release-2-30-test-http-security-hardening | `pnpm run test:http-security-hardening` | 15s | 0 |
| 38 | release-2-31-test-production-demo-seed | `pnpm run test:production-demo-seed` | 16s | 0 |

## Release Phase 3

| # | Step | Command | Duration | Exit |
|---:|---|---|---:|---:|
| 39 | release-3-01-test-date-serialization | `pnpm run test:date-serialization` | 1s | 0 |
| 40 | release-3-02-test-tenant-isolation | `pnpm run test:tenant-isolation` | 8s | 0 |
| 41 | release-3-03-test-employee-location-deactivation-scoping | `pnpm run test:employee-location-deactivation-scoping` | 5s | 0 |
| 42 | release-3-04-test-appointment-regressions | `pnpm run test:appointment-regressions` | 22s | 0 |
| 43 | release-3-05-test-query-counts | `pnpm run test:query-counts` | 6s | 0 |
| 44 | release-3-06-test-query-budgets | `pnpm run test:query-budgets` | 4s | 0 |
| 45 | release-3-07-test-phone-contact-sql-bounds | `pnpm run test:phone-contact-sql-bounds` | 13s | 0 |
| 46 | release-3-08-test-catalog-cache | `pnpm run test:catalog-cache` | 4s | 0 |
| 47 | release-3-09-test-communication-archive | `pnpm run test:communication-archive` | 4s | 0 |
| 48 | release-3-10-test-admin-validation | `pnpm run test:admin-validation` | 12s | 0 |
| 49 | release-3-11-test-customer-password-setup | `pnpm run test:customer-password-setup` | 16s | 0 |
| 50 | release-3-12-test-login-rate-limit | `pnpm run test:login-rate-limit` | 22s | 0 |
| 51 | release-3-13-test-change-password-session-revocation | `pnpm run test:change-password-session-revocation` | 14s | 0 |
| 52 | release-3-14-test-owner-reset-password-session-revocation | `pnpm run test:owner-reset-password-session-revocation` | 16s | 0 |
| 53 | release-3-15-test-education-b2b-checkout-idempotency | `pnpm run test:education-b2b-checkout-idempotency` | 16s | 0 |
| 54 | release-3-16-test-education-b2b-integration | `pnpm run test:education-b2b-integration` | 21s | 0 |
| 55 | release-3-17-test-education-popular-featured-ranking | `pnpm run test:education-popular-featured-ranking` | 6s | 0 |
| 56 | release-3-18-test-education-featured-eligibility-consistency | `pnpm run test:education-featured-eligibility-consistency` | 6s | 0 |
| 57 | release-3-19-test-education-course-featured-authorization | `pnpm run test:education-course-featured-authorization` | 5s | 0 |
| 58 | release-3-20-test-custom-fetch | `pnpm run test:custom-fetch` | 1s | 0 |
| 59 | release-3-21-test-idempotency-key-lifecycle | `pnpm run test:idempotency-key-lifecycle` | 2s | 0 |
| 60 | release-3-22-test-admin-order-search | `pnpm run test:admin-order-search` | 13s | 0 |
| 61 | release-3-23-test-admin-list-pagination | `pnpm run test:admin-list-pagination` | 13s | 0 |
| 62 | release-3-24-test-admin-summary | `pnpm run test:admin-summary` | 18s | 0 |
| 63 | release-3-25-test-loyalty-status | `pnpm run test:loyalty-status` | 6s | 0 |
| 64 | release-3-26-test-api-preflight | `pnpm run test:api-preflight` | 1s | 0 |
| 65 | release-3-27-test-api-regressions | `pnpm run test:api-regressions` | 49s | 0 |
| 66 | release-3-28-test-api-regressions-lifecycle | `pnpm run test:api-regressions-lifecycle` | 677s | 0 |

The lifecycle step passed all **37 tests**. Its TAP test duration was
approximately 675 seconds; the enclosing manifest step, including command
overhead, was 677 seconds.

## Guard mutation evidence

The final third-registry scratch report rejected both guard-removal
mutations:

- removing the shared guard call from the external database pool integration
  test failed with `external database pool integration must invoke the shared destructive-runtime guard`;
- removing the shared guard call from the HTTP security hardening test failed
  with `HTTP security hardening must invoke the shared destructive-runtime guard`.

Both registrations remained present during the checks. The final source retains
both registrations and both guard calls.