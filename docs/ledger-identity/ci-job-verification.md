# Database CI job verification

## Observed final status

No test or source command was started for this report. The already-running job
was observed by checking `.local/ledger-identity/ci-job.exit` every 30 seconds.
The file eventually appeared with exact content:

> `0`

`.local/ci-database-release-harness/latest-run` points to
`20260924T063404Z-22409`. Its manifest records:

- job: `ci-database-release-2-and-3`
- status: `passed`
- exit code: `0`
- started: `2026-09-24T06:34:04Z`
- finished: `2026-09-24T07:02:34Z`
- 67 steps, each status `passed` and exit code `0`
- cleanup: runtime lock `removed`, temporary step environment `released`, and
  owned PostgreSQL 16 cluster `stopped-and-removed`

The separate `final-status` file contains the exact observed final status:

> `passed`

## Step record

Commands, manifest durations and exits, and the exact final `END` line from
each corresponding log follow. Step 67 is the additional Phase 4 integration
step after the original 66-step release sequence.

| # | Command | Duration | Exit | Exact actual `END` log line |
| ---: | --- | ---: | ---: | --- |
| 1 | `pnpm --filter @workspace/db run push-force` | 14s | 0 | `[2026-09-24T06:34:24Z] END prepare-isolated-test-schema (exit 0)` |
| 2 | `pnpm --filter @workspace/scripts run ensure:retail-cart-index:ci` | 2s | 0 | `[2026-09-24T06:34:26Z] END reconcile-retail-cart-index (exit 0)` |
| 3 | `pnpm --filter @workspace/scripts run test:retail-cart-ci-preparation` | 5s | 0 | `[2026-09-24T06:34:31Z] END verify-retail-cart-index-preparation (exit 0)` |
| 4 | `env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm run test:advisory-lock-session-cleanup` | 7s | 0 | `[2026-09-24T06:34:38Z] END advisory-lock-session-cleanup (exit 0)` |
| 5 | `env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL pnpm --filter @workspace/scripts run validate:ci:reviewed-history` | 3s | 0 | `[2026-09-24T06:34:41Z] END authenticate-reviewed-history (exit 0)` |
| 6 | `pnpm run test:monitoring` | 7s | 0 | `[2026-09-24T06:34:48Z] END database-test-monitoring (exit 0)` |
| 7 | `pnpm run test:backend-standards:static` | 15s | 0 | `[2026-09-24T06:35:03Z] END database-test-backend-standards-static (exit 0)` |
| 8 | `pnpm run test:pool-runtime` | 1s | 0 | `[2026-09-24T06:35:04Z] END release-2-01-test-pool-runtime (exit 0)` |
| 9 | `pnpm run test:external-database:integration` | 20s | 0 | `[2026-09-24T06:35:24Z] END release-2-02-test-external-database-integration (exit 0)` |
| 10 | `pnpm run test:beauty-jobs` | 25s | 0 | `[2026-09-24T06:35:49Z] END release-2-03-test-beauty-jobs (exit 0)` |
| 11 | `pnpm run test:backend-standards:database` | 2s | 0 | `[2026-09-24T06:35:51Z] END release-2-04-test-backend-standards-database (exit 0)` |
| 12 | `pnpm run test:booking-development-schema` | 2s | 0 | `[2026-09-24T06:35:53Z] END release-2-05-test-booking-development-schema (exit 0)` |
| 13 | `pnpm run test:retail-cart-index-development-schema` | 1s | 0 | `[2026-09-24T06:35:55Z] END release-2-06-test-retail-cart-index-development-schema (exit 0)` |
| 14 | `pnpm run test:business-growth-schema` | 52s | 0 | `[2026-09-24T06:36:47Z] END release-2-07-test-business-growth-schema (exit 0)` |
| 15 | `pnpm run test:business-growth-schema-cleanup-reports` | 71s | 0 | `[2026-09-24T06:37:58Z] END release-2-08-test-business-growth-schema-cleanup-reports (exit 0)` |
| 16 | `pnpm run test:business-growth-schema-boot-regression` | 15s | 0 | `[2026-09-24T06:38:13Z] END release-2-09-test-business-growth-schema-boot-regression (exit 0)` |
| 17 | `pnpm run test:anthropic-integration-lazy-init` | 7s | 0 | `[2026-09-24T06:38:20Z] END release-2-10-test-anthropic-integration-lazy-init (exit 0)` |
| 18 | `pnpm run test:referral-lifecycle` | 12s | 0 | `[2026-09-24T06:38:32Z] END release-2-11-test-referral-lifecycle (exit 0)` |
| 19 | `pnpm run test:attributed-appointments-returning` | 3s | 0 | `[2026-09-24T06:38:35Z] END release-2-12-test-attributed-appointments-returning (exit 0)` |
| 20 | `pnpm run test:business-guide-pdf` | 2s | 0 | `[2026-09-24T06:38:37Z] END release-2-13-test-business-guide-pdf (exit 0)` |
| 21 | `pnpm run test:business-guide-links` | 1s | 0 | `[2026-09-24T06:38:38Z] END release-2-14-test-business-guide-links (exit 0)` |
| 22 | `pnpm run test:automation-provider-events` | 14s | 0 | `[2026-09-24T06:38:52Z] END release-2-15-test-automation-provider-events (exit 0)` |
| 23 | `pnpm run test:scheduler-resilience` | 2s | 0 | `[2026-09-24T06:38:54Z] END release-2-16-test-scheduler-resilience (exit 0)` |
| 24 | `pnpm run test:scheduler-affected-jobs` | 3s | 0 | `[2026-09-24T06:38:57Z] END release-2-17-test-scheduler-affected-jobs (exit 0)` |
| 25 | `pnpm run test:sms-webhook-registration` | 3s | 0 | `[2026-09-24T06:39:00Z] END release-2-18-test-sms-webhook-registration (exit 0)` |
| 26 | `pnpm run test:webhook-secret-reconfirmation` | 4s | 0 | `[2026-09-24T06:39:04Z] END release-2-19-test-webhook-secret-reconfirmation (exit 0)` |
| 27 | `pnpm run test:attributed-appointments-pagination` | 5s | 0 | `[2026-09-24T06:39:09Z] END release-2-20-test-attributed-appointments-pagination (exit 0)` |
| 28 | `pnpm run test:campaign-attributed-appointments-window` | 3s | 0 | `[2026-09-24T06:39:12Z] END release-2-21-test-campaign-attributed-appointments-window (exit 0)` |
| 29 | `pnpm run test:stats-compare-window-boundaries` | 4s | 0 | `[2026-09-24T06:39:16Z] END release-2-22-test-stats-compare-window-boundaries (exit 0)` |
| 30 | `pnpm run test:social-oauth-domain-change` | 14s | 0 | `[2026-09-24T06:39:30Z] END release-2-23-test-social-oauth-domain-change (exit 0)` |
| 31 | `pnpm run test:social-oauth-return-to` | 16s | 0 | `[2026-09-24T06:39:46Z] END release-2-24-test-social-oauth-return-to (exit 0)` |
| 32 | `pnpm run test:social-oauth-referral-context` | 14s | 0 | `[2026-09-24T06:40:00Z] END release-2-25-test-social-oauth-referral-context (exit 0)` |
| 33 | `pnpm run test:social-oauth-facebook-account-linking-safety` | 15s | 0 | `[2026-09-24T06:40:15Z] END release-2-26-test-social-oauth-facebook-account-linking-safety (exit 0)` |
| 34 | `pnpm run test:social-oauth-google-account-linking-safety` | 14s | 0 | `[2026-09-24T06:40:29Z] END release-2-27-test-social-oauth-google-account-linking-safety (exit 0)` |
| 35 | `pnpm run test:internal-job-secret-timing-safety` | 13s | 0 | `[2026-09-24T06:40:42Z] END release-2-28-test-internal-job-secret-timing-safety (exit 0)` |
| 36 | `pnpm run test:safe-external-url` | 25s | 0 | `[2026-09-24T06:41:07Z] END release-2-29-test-safe-external-url (exit 0)` |
| 37 | `pnpm run test:http-security-hardening` | 17s | 0 | `[2026-09-24T06:41:24Z] END release-2-30-test-http-security-hardening (exit 0)` |
| 38 | `pnpm run test:production-demo-seed` | 16s | 0 | `[2026-09-24T06:41:40Z] END release-2-31-test-production-demo-seed (exit 0)` |
| 39 | `pnpm run test:date-serialization` | 1s | 0 | `[2026-09-24T06:41:41Z] END release-3-01-test-date-serialization (exit 0)` |
| 40 | `pnpm run test:tenant-isolation` | 8s | 0 | `[2026-09-24T06:41:49Z] END release-3-02-test-tenant-isolation (exit 0)` |
| 41 | `pnpm run test:employee-location-deactivation-scoping` | 7s | 0 | `[2026-09-24T06:41:56Z] END release-3-03-test-employee-location-deactivation-scoping (exit 0)` |
| 42 | `pnpm run test:appointment-regressions` | 24s | 0 | `[2026-09-24T06:42:20Z] END release-3-04-test-appointment-regressions (exit 0)` |
| 43 | `pnpm run test:query-counts` | 6s | 0 | `[2026-09-24T06:42:26Z] END release-3-05-test-query-counts (exit 0)` |
| 44 | `pnpm run test:query-budgets` | 5s | 0 | `[2026-09-24T06:42:31Z] END release-3-06-test-query-budgets (exit 0)` |
| 45 | `pnpm run test:phone-contact-sql-bounds` | 14s | 0 | `[2026-09-24T06:42:45Z] END release-3-07-test-phone-contact-sql-bounds (exit 0)` |
| 46 | `pnpm run test:catalog-cache` | 4s | 0 | `[2026-09-24T06:42:49Z] END release-3-08-test-catalog-cache (exit 0)` |
| 47 | `pnpm run test:communication-archive` | 5s | 0 | `[2026-09-24T06:42:54Z] END release-3-09-test-communication-archive (exit 0)` |
| 48 | `pnpm run test:admin-validation` | 14s | 0 | `[2026-09-24T06:43:08Z] END release-3-10-test-admin-validation (exit 0)` |
| 49 | `pnpm run test:customer-password-setup` | 16s | 0 | `[2026-09-24T06:43:24Z] END release-3-11-test-customer-password-setup (exit 0)` |
| 50 | `pnpm run test:login-rate-limit` | 23s | 0 | `[2026-09-24T06:43:47Z] END release-3-12-test-login-rate-limit (exit 0)` |
| 51 | `pnpm run test:change-password-session-revocation` | 16s | 0 | `[2026-09-24T06:44:03Z] END release-3-13-test-change-password-session-revocation (exit 0)` |
| 52 | `pnpm run test:owner-reset-password-session-revocation` | 17s | 0 | `[2026-09-24T06:44:20Z] END release-3-14-test-owner-reset-password-session-revocation (exit 0)` |
| 53 | `pnpm run test:education-b2b-checkout-idempotency` | 16s | 0 | `[2026-09-24T06:44:36Z] END release-3-15-test-education-b2b-checkout-idempotency (exit 0)` |
| 54 | `pnpm run test:education-b2b-integration` | 14s | 0 | `[2026-09-24T06:44:50Z] END release-3-16-test-education-b2b-integration (exit 0)` |
| 55 | `pnpm run test:education-popular-featured-ranking` | 6s | 0 | `[2026-09-24T06:44:56Z] END release-3-17-test-education-popular-featured-ranking (exit 0)` |
| 56 | `pnpm run test:education-featured-eligibility-consistency` | 7s | 0 | `[2026-09-24T06:45:03Z] END release-3-18-test-education-featured-eligibility-consistency (exit 0)` |
| 57 | `pnpm run test:education-course-featured-authorization` | 7s | 0 | `[2026-09-24T06:45:10Z] END release-3-19-test-education-course-featured-authorization (exit 0)` |
| 58 | `pnpm run test:custom-fetch` | 1s | 0 | `[2026-09-24T06:45:11Z] END release-3-20-test-custom-fetch (exit 0)` |
| 59 | `pnpm run test:idempotency-key-lifecycle` | 1s | 0 | `[2026-09-24T06:45:12Z] END release-3-21-test-idempotency-key-lifecycle (exit 0)` |
| 60 | `pnpm run test:admin-order-search` | 13s | 0 | `[2026-09-24T06:45:25Z] END release-3-22-test-admin-order-search (exit 0)` |
| 61 | `pnpm run test:admin-list-pagination` | 14s | 0 | `[2026-09-24T06:45:40Z] END release-3-23-test-admin-list-pagination (exit 0)` |
| 62 | `pnpm run test:admin-summary` | 18s | 0 | `[2026-09-24T06:45:58Z] END release-3-24-test-admin-summary (exit 0)` |
| 63 | `pnpm run test:loyalty-status` | 6s | 0 | `[2026-09-24T06:46:04Z] END release-3-25-test-loyalty-status (exit 0)` |
| 64 | `pnpm run test:api-preflight` | 1s | 0 | `[2026-09-24T06:46:05Z] END release-3-26-test-api-preflight (exit 0)` |
| 65 | `pnpm run test:api-regressions` | 57s | 0 | `[2026-09-24T06:47:02Z] END release-3-27-test-api-regressions (exit 0)` |
| 66 | `pnpm run test:api-regressions-lifecycle` | 736s | 0 | `[2026-09-24T06:59:18Z] END release-3-28-test-api-regressions-lifecycle (exit 0)` |
| 67 | `LUMERA_PHASE4_DISPOSABLE_DATABASE_URL='postgres://lumera_ci:lumera_ci@127.0.0.1:55432/lumera_ci_database' LUMERA_PHASE4_DISPOSABLE_DB=1 pnpm run test:migrations:integration` | 196s | 0 | `[2026-09-24T07:02:34Z] END phase-4-migration-integration (exit 0)` |

## Exact test summaries present in step logs

The following Node test-runner summaries were present. Repeated groups in a
single step are preserved in emitted order.

| Step | Exact summary lines |
| ---: | --- |
| 3 | `ℹ tests 2`; `ℹ pass 2`; `ℹ fail 0`; `ℹ skipped 0` |
| 4 | `ℹ tests 1`; `ℹ pass 1`; `ℹ fail 0`; `ℹ skipped 0` |
| 7 | `ℹ tests 10`; `ℹ pass 10`; `ℹ fail 0`; `ℹ skipped 0`<br>`ℹ tests 5`; `ℹ pass 5`; `ℹ fail 0`; `ℹ skipped 0`<br>`ℹ tests 28`; `ℹ pass 28`; `ℹ fail 0`; `ℹ skipped 0` |
| 8 | `ℹ tests 8`; `ℹ pass 8`; `ℹ fail 0`; `ℹ skipped 0` |
| 9 | `ℹ tests 3`; `ℹ pass 3`; `ℹ fail 0`; `ℹ skipped 0` |
| 15 | `ℹ tests 4`; `ℹ pass 4`; `ℹ fail 0`; `ℹ skipped 0` |
| 16 | `ℹ tests 1`; `ℹ pass 1`; `ℹ fail 0`; `ℹ skipped 0` |
| 17 | `ℹ tests 7`; `ℹ pass 7`; `ℹ fail 0`; `ℹ skipped 0` |
| 20 | `ℹ tests 1`; `ℹ pass 1`; `ℹ fail 0`; `ℹ skipped 0` |
| 21 | `ℹ tests 1`; `ℹ pass 1`; `ℹ fail 0`; `ℹ skipped 0` |
| 38 | `ℹ tests 11`; `ℹ pass 11`; `ℹ fail 0`; `ℹ skipped 0` |
| 42 | `ℹ tests 3`; `ℹ pass 3`; `ℹ fail 0`; `ℹ skipped 0`<br>`ℹ tests 3`; `ℹ pass 3`; `ℹ fail 0`; `ℹ skipped 0`<br>`ℹ tests 23`; `ℹ pass 23`; `ℹ fail 0`; `ℹ skipped 0` |
| 44 | `ℹ tests 7`; `ℹ pass 7`; `ℹ fail 0`; `ℹ skipped 0` |
| 45 | `ℹ tests 1`; `ℹ pass 1`; `ℹ fail 0`; `ℹ skipped 0` |
| 50 | `ℹ tests 9`; `ℹ pass 9`; `ℹ fail 0`; `ℹ skipped 0` |
| 51 | `ℹ tests 5`; `ℹ pass 5`; `ℹ fail 0`; `ℹ skipped 0` |
| 52 | `ℹ tests 1`; `ℹ pass 1`; `ℹ fail 0`; `ℹ skipped 0` |
| 53 | `ℹ tests 9`; `ℹ pass 9`; `ℹ fail 0`; `ℹ skipped 0` |
| 58 | `ℹ tests 11`; `ℹ pass 11`; `ℹ fail 0`; `ℹ skipped 0` |
| 59 | `ℹ tests 7`; `ℹ pass 7`; `ℹ fail 0`; `ℹ skipped 0` |
| 66 | `ℹ tests 77`; `ℹ pass 77`; `ℹ fail 0`; `ℹ skipped 0` |
| 67 | `ℹ tests 38`; `ℹ pass 38`; `ℹ fail 0`; `ℹ skipped 0` |

Step 11 uses the backend-standards reporter rather than the Node summary. Its
actual terminal-visible result line (two leading spaces, with the log's ANSI
green/reset framing omitted here rather than misrepresented as text) is:

```text
  All 13 checks passed.
```

The Phase 4 extra step includes the ledger-identity case and its exact summary:

> `✔ ledger identity is bound, immutable, upgradeable, and deployment-enforced (13274.225465ms)`
>
> `ℹ tests 38`
>
> `ℹ pass 38`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`
>
> `[2026-09-24T07:02:34Z] END phase-4-migration-integration (exit 0)`

## Protected-input context

The protected-input evidence remains the separately recorded 19 current-tier
hash amendments: 18 entries for nine changed migration-tooling files plus the
dependent execution-manifest entry for the finalized diagnostic manifest. The
final census is 158/158 current hashes and 146/146 historical hashes matched;
no additional hash amendment was made for this CI report.