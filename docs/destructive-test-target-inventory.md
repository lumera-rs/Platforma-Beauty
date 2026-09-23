# Destructive test target guard inventory

This inventory describes the source tree as audited on 2026-09-22. The shared
guard is `assertDestructiveTestRuntimeAllowed` in
`lib/db/src/destructive-test-runtime.ts`. With
`DATABASE_URL=postgresql://…/heliumdb`, it refuses before the guarded work
unless the exact URL is explicitly marked by an owning disposable harness.

## Scope and counting

There are **132 test entry points** in the two source-backed categories below:

- **41 explicit guard callers**. These invoke the shared guard themselves,
  either at module initialization or immediately before their database
  operation.
- **91 additional direct database test entries**. These have a runtime import
  path to the root `@workspace/db` entry. That entry checks
  `process.argv[1]` and invokes the same shared guard when the entry filename
  ends in `.test.*` or `.spec.*`.

The categories are disjoint in the lists below. The audit resolved runtime
imports transitively and excluded type-only edges. A test which both calls the
guard explicitly and reaches `@workspace/db` is listed only in the explicit
section.

### Explicit shared-guard callers (41)

```text
artifacts/api-server/src/lib/admin-summary.test.ts
artifacts/api-server/src/lib/appointment-routes.test.ts
artifacts/api-server/src/lib/beauty-jobs-routes.test.ts
artifacts/api-server/src/lib/booking-p1-regressions.test.ts
artifacts/api-server/src/lib/business-growth-schema-boot-regression.test.ts
artifacts/api-server/src/lib/business-growth-schema-cleanup-reports.test.ts
artifacts/api-server/src/lib/business-growth-schema.test.ts
artifacts/api-server/src/lib/education-extras.test.ts
artifacts/api-server/src/lib/education-financial.test.ts
artifacts/api-server/src/lib/education-sessions.test.ts
artifacts/api-server/src/lib/final-booking-hardening.test.ts
artifacts/api-server/src/lib/query-count.test.ts
artifacts/api-server/src/lib/referral-lifecycle.test.ts
artifacts/api-server/src/lib/retail-checkout.test.ts
artifacts/api-server/src/lib/seed.test.ts
artifacts/api-server/src/lib/shipping-config.test.ts
artifacts/api-server/src/lib/social-oauth-referral-context.test.ts
artifacts/api-server/src/routes/marketplace-query-budget.test.ts
scripts/browser/education-gallery.spec.ts
scripts/src/backend-standards-database.test.ts
scripts/src/booking-development-schema.test.ts
scripts/src/migrations/adoption-boundary.integration.test.ts
scripts/src/migrations/migrations.integration.test.ts
scripts/src/migrations/namespace-boundary.integration.test.ts
scripts/src/migrations/supported-convergence.integration.test.ts
scripts/src/migrations/supported-path-boot.integration.test.ts
scripts/src/migrations/supported-state.integration.test.ts
scripts/src/migrations/target-identity.integration.test.ts
scripts/src/production-startup-ddl-inventory.test.ts
scripts/src/retail-cart-ci-preparation.test.ts
scripts/src/retail-cart-index-development-schema.test.ts
scripts/src/run-api-regressions-lifecycle.test.ts
scripts/src/schema-drift/fingerprint-golden-fixture.integration.test.ts
scripts/src/schema-drift/fingerprint.integration.test.ts
scripts/src/schema-drift/schema-drift.integration.test.ts
scripts/src/startup-data/apply.test.ts
scripts/src/startup-ddl-removal-gate.test.ts
scripts/src/startup-equivalence/crosswalk.test.ts
scripts/src/startup-equivalence/recovery.test.ts
scripts/src/startup-migration-crosswalk.test.ts
scripts/src/subscription-reconciliation/reconciliation.test.ts
```

`lib/db/src/destructive-test-runtime.test.ts` is intentionally not in this
list: it calls the guard only with synthetic environments to test the guard
itself, so an ambient `heliumdb` URL does not make that unit test a guarded
destructive entry.

### Additional direct `@workspace/db` test entries (91)

```text
artifacts/api-server/src/lib/active-product-sale.test.ts
artifacts/api-server/src/lib/admin-list-pagination.test.ts
artifacts/api-server/src/lib/admin-order-search.test.ts
artifacts/api-server/src/lib/admin-validation.test.ts
artifacts/api-server/src/lib/aftercare-api.test.ts
artifacts/api-server/src/lib/aftercare-domain.test.ts
artifacts/api-server/src/lib/aftercare-worker.integration.test.ts
artifacts/api-server/src/lib/appointment-customer-events.test.ts
artifacts/api-server/src/lib/appointment-locks.test.ts
artifacts/api-server/src/lib/attributed-appointments-pagination.test.ts
artifacts/api-server/src/lib/attributed-appointments-returning.test.ts
artifacts/api-server/src/lib/automation-provider-events.test.ts
artifacts/api-server/src/lib/b2b-order-import-parser.test.ts
artifacts/api-server/src/lib/b2c-product-reviews.test.ts
artifacts/api-server/src/lib/booking-audit-v2.test.ts
artifacts/api-server/src/lib/booking-audit.test.ts
artifacts/api-server/src/lib/brevo-registration-monitor.test.ts
artifacts/api-server/src/lib/brevo-stale-webhook-cleanup.test.ts
artifacts/api-server/src/lib/business-commerce-approvals.test.ts
artifacts/api-server/src/lib/business-growth.test.ts
artifacts/api-server/src/lib/business-role-transition.test.ts
artifacts/api-server/src/lib/calendar-timezone-boundaries.test.ts
artifacts/api-server/src/lib/campaign-attributed-appointments-window.test.ts
artifacts/api-server/src/lib/catalog-cache.test.ts
artifacts/api-server/src/lib/change-password-session-revocation.test.ts
artifacts/api-server/src/lib/commerce-ef.test.ts
artifacts/api-server/src/lib/communication-archive.test.ts
artifacts/api-server/src/lib/customer-password-setup.test.ts
artifacts/api-server/src/lib/deo-g2-rules.test.ts
artifacts/api-server/src/lib/education-b2b-checkout-idempotency.test.ts
artifacts/api-server/src/lib/education-b2b-discounts.test.ts
artifacts/api-server/src/lib/education-b2b-integration.test.ts
artifacts/api-server/src/lib/education-bundle-purchases.test.ts
artifacts/api-server/src/lib/education-camt053.test.ts
artifacts/api-server/src/lib/education-course-featured-authorization.test.ts
artifacts/api-server/src/lib/education-featured-eligibility-consistency.test.ts
artifacts/api-server/src/lib/education-financial-audit.test.ts
artifacts/api-server/src/lib/education-ips-production-safety.test.ts
artifacts/api-server/src/lib/education-online-access-transfer.test.ts
artifacts/api-server/src/lib/education-operational-policy.test.ts
artifacts/api-server/src/lib/education-operational-routes.test.ts
artifacts/api-server/src/lib/education-placement-lifecycle.test.ts
artifacts/api-server/src/lib/education-popular-featured-ranking.test.ts
artifacts/api-server/src/lib/education-subscription-billing.test.ts
artifacts/api-server/src/lib/education-subscription-contract.test.ts
artifacts/api-server/src/lib/employee-location-deactivation-scoping.test.ts
artifacts/api-server/src/lib/growth-salon-isolation.test.ts
artifacts/api-server/src/lib/http-security-hardening.test.ts
artifacts/api-server/src/lib/image-pipeline.test.ts
artifacts/api-server/src/lib/internal-job-secret-timing-safety.test.ts
artifacts/api-server/src/lib/login-rate-limit.test.ts
artifacts/api-server/src/lib/loyalty-status.test.ts
artifacts/api-server/src/lib/media-routes.test.ts
artifacts/api-server/src/lib/monitoring.test.ts
artifacts/api-server/src/lib/multi-location.test.ts
artifacts/api-server/src/lib/order-import-wishlist-api.test.ts
artifacts/api-server/src/lib/owner-reset-password-session-revocation.test.ts
artifacts/api-server/src/lib/phone-contact-sql-bounds.test.ts
artifacts/api-server/src/lib/referral-checkout.test.ts
artifacts/api-server/src/lib/referral-domain.test.ts
artifacts/api-server/src/lib/referral-sms.test.ts
artifacts/api-server/src/lib/rescheduled-confirmation-retries.test.ts
artifacts/api-server/src/lib/retail-cart-reminders.test.ts
artifacts/api-server/src/lib/retail-subscription.test.ts
artifacts/api-server/src/lib/retention-settings.test.ts
artifacts/api-server/src/lib/review-photo-privacy.test.ts
artifacts/api-server/src/lib/runtime-adversarial-authorization.test.ts
artifacts/api-server/src/lib/runtime-error-disclosure.test.ts
artifacts/api-server/src/lib/runtime-restart-durability.test.ts
artifacts/api-server/src/lib/safe-external-url.test.ts
artifacts/api-server/src/lib/safe-mode-external-calls.test.ts
artifacts/api-server/src/lib/scheduler-affected-jobs.test.ts
artifacts/api-server/src/lib/scheduler-resilience.test.ts
artifacts/api-server/src/lib/sms-fallback-admin-phone-notice.test.ts
artifacts/api-server/src/lib/sms-webhook-registration.test.ts
artifacts/api-server/src/lib/social-oauth-domain-change.test.ts
artifacts/api-server/src/lib/social-oauth-facebook-account-linking-safety.test.ts
artifacts/api-server/src/lib/social-oauth-google-account-linking-safety.test.ts
artifacts/api-server/src/lib/social-oauth-return-to.test.ts
artifacts/api-server/src/lib/stats-compare-window-boundaries.test.ts
artifacts/api-server/src/lib/supplier-catalog.test.ts
artifacts/api-server/src/lib/tenant-isolation.test.ts
artifacts/api-server/src/lib/test-listing-reconciliation.test.ts
artifacts/api-server/src/lib/transactional-email-outbox.test.ts
artifacts/api-server/src/lib/web-push.test.ts
artifacts/api-server/src/lib/webhook-registration-verification.test.ts
artifacts/api-server/src/lib/webhook-repair-selection.test.ts
artifacts/api-server/src/lib/webhook-secret-reconfirmation.test.ts
artifacts/api-server/src/lib/widget-appointment-contract.test.ts
artifacts/api-server/src/lib/widget-rate-limit.test.ts
artifacts/api-server/src/routes/location-schedule-validation.test.ts
```

## Browser coverage is configuration-level, not universal

It would be inaccurate to label every browser spec as a direct-entry
transitive. Playwright launches its CLI as `process.argv[1]`, not each spec, so
the root `@workspace/db` test-entry check does not classify ordinary
`scripts/browser/*.spec.ts` files. The exception is
`education-gallery.spec.ts`, which calls the shared guard explicitly.

The normal `scripts/playwright.config.ts` calls the guard while loading the
configuration, and `scripts/src/browser-preflight.ts` calls it again in global
setup. Thus specs run through that configuration refuse `heliumdb` before test
execution. This protection is invocation-dependent: a spec loaded outside
that configuration is not made safe merely by importing an API fixture.

`scripts/playwright.seo.config.ts` deliberately has no destructive guard. It
runs only `client-seo-navigation.spec.ts` against a dedicated Vite process with
public API fixtures and no database. This is a database-free exception, not a
globally guarded browser test.

## CI database-target audit

The workflow file was inspected but not changed. Its audited SHA-256 is
`6a16e763e46759dd6c1da58fc786d680fe8f43c8e5c112cdfc03bd21065f3936`.

| CI job | Effective `DATABASE_URL` policy | Guard-compatible target |
| --- | --- | --- |
| `migration-contract` | Job value is empty; database steps additionally unset it | Empty/unset |
| `release-chain` | Job value is empty; command unsets it | Empty/unset |
| `build` | Database-free command explicitly unsets it | Empty/unset |
| `database` | `postgres://lumera_ci:…/lumera_ci_database` | Allowlisted disposable CI name |
| `phase5-migration-integration` | Job value is empty; owned-cluster command unsets it | Empty/unset; separately owned PostgreSQL 16 cluster |
| `browser` | `postgres://lumera_ci:…/lumera_ci_browser` | Allowlisted disposable CI name |
| `failure-diagnostics-probe` | No database URL is configured | Unset |

The two shared-service database jobs therefore use only the recognized CI
database names. Every other job is empty or unset at the relevant command
boundary.

## Safe local execution

An ambient development URL, including `heliumdb`, is intentionally unsuitable
as the administration/source URL for the isolated browser runners. Run them
through the owned PostgreSQL wrapper instead:

```sh
pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- \
  pnpm run <test-script>
```

The wrapper starts its own PostgreSQL 16 cluster, marks that exact URL as
disposable for the child, and removes the cluster afterward. The nested
browser runner may then create and drop only its generated, pattern-checked
child database inside that owned cluster. The browser runner's own call to the
shared guard remains intact.

## Existing isolated-runner regression evidence

The requested existing commands were rerun one at a time through the owned
cluster wrapper (the wrapper currently uses a fixed local port, so concurrent
wrapper instances would not be independent). Full ignored logs are under
`recovery-backups/destructive-target-guard/`.

| Command | Result |
| --- | --- |
| `test:admin-form-resilience` | PASS, 12 tests |
| `test:salon-notifications:release` | PASS, 4 tests |
| `test:retention-preview` | PASS, three isolated variants; 3 passed and 3 intentionally skipped in total |
| `test:infobip-registration-browser` | PASS, 2 tests |
| `test:beauty-jobs-browser` | PASS, 2 tests |
| `test:education-group-online-consent-browser` | PASS, 9 tests |
| `test:booking-settings` | PASS, 1 test |
| `test:retail-checkout` | Guard regression fixed; the API phase proceeded, then the browser phase failed an existing subtotal assertion (`2.000 RSD` expected, `0 RSD` received; 1 passed, 1 failed, 19 not run) |
| `test:cover-image-description-browser` | The requested root alias is absent; the scripts-package command ran and failed four product assertions (metadata fallback mismatch, two save timeouts, and one non-success Beauty Jobs save) |
| `test:admin-access-configuration` | Inconclusive: two owned-cluster attempts exceeded the five-minute execution window before Playwright emitted a result; no guard refusal was observed |

The retail API guard regression was caused by its generated
`lumera_retail_api_*` child URL not carrying the exact disposable marker. The
common owning harness now sets `LUMERA_DISPOSABLE_DATABASE` to the generated
child URL in browser, API, and API-regression child environments. It does not
mark or bypass the ambient administration URL. The shared outer guard remains
the first check in `requireDevelopmentDatabaseUrl`.