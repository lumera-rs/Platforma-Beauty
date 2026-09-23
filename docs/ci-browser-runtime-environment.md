# Phase 4/5 browser-job runtime environment audit

## Scope and method

This is a **source audit**, not a test result. It covers first-party runtime code in `artifacts/api-server`, `artifacts/beauty-marketplace` (including the standalone SEO server and Vite development server), and all packages under `lib`. Test-only and build-only reads are separated below. Generated output, `node_modules`, backups, and other artifacts are not application source. Third-party SDK implicit environment discovery is not claimed to be exhaustively inventoried.

“Phase 4/5” here means `validate:release:4-isolated` and `validate:release:5-final`, invoked by `validate:ci:browser` in `.github/workflows/ci.yml`'s **browser** job. The separately named Phase 4/Phase 5 **migration** integration jobs are not these suites.

Inspected direct dot and bracket reads, `import.meta.env`, `env`/`environment` parameters defaulting to `process.env`, `this.environment`, computed property reads, helper call sites, environment spreads, and destructuring/import aliases. No additional application runtime environment destructuring or imported `process` alias was found. Computed-name resolution is documented explicitly below.

Workspace presence was checked with `Object.hasOwn(process.env, name)` in a read-only Node subprocess: **present means existence only**, not nonempty, valid, usable, or available to another process. No environment values were printed or recorded. This is the auditing shell's snapshot, not an inspection of deployed process environments or a statement of remote CI execution status. CI columns describe source configuration only; no CI job URL or completed remote run is required for this census. No database connections, production tools, app execution, workflow execution, or logs were used.

### Reading the tables

* **CI** means explicitly supplied by the browser job YAML, not a value inherited incidentally from an Actions runner. That job sets `CI`, `NODE_ENV`, `DATABASE_URL`, and `SESSION_SECRET`; the execution step also supplies `CI_TIMING_REPORT_FALLBACK_DIR`.
* **WS**: `Y` = present; `N` = absent in the auditing shell.
* **Inherited only** is **not** “harness sets it.” The shared harness spreads `process.env`; a local workspace setting can therefore conceal a missing CI setting.
* **Hard failure** includes a feature/request failure, not necessarily a boot failure. **Silent fallback** means absence selects a default/alternative. **Nothing** means the optional capability/control is inactive. Database-saved integration settings can supersede environment fallbacks; this audit did not inspect any database settings.
* References use `A/` = `artifacts/api-server/src/`, `W/` = `artifacts/beauty-marketplace/`, `D/` = `lib/db/src/`, `S/` = `scripts/src/`. A reference to a file plus a function is intentional where several nearby reads form one configuration operation.
* **B harness** = `S/run-isolated-browser-suite.ts:runIsolatedBrowserSuite`; **A harness** = its `runIsolatedApiSuite`; **R harness** = its `runIsolatedApiRegressionSuite`. The per-suite map below names every phase 4/5 caller rather than assuming every command uses the shared harness.
* **B origin** means the harness-generated HTTPS public origin supplied **only to the disposable API-server child**. It is not supplied to the B frontend or shared test environment. The HTTP API transport URL used by Vite's proxy is a distinct setting.

## Conclusions: workspace-only dependencies

1. The workspace has `AI_INTEGRATIONS_ANTHROPIC_API_KEY` and `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`; CI and the phase 4/5 runners do not supply them. **They are not an unconditional browser-server import failure anymore**: the client is lazy. AI requests still require both, and the normal production entry point explicitly validates them at startup. The browser harness starts `test-server.ts`, not the production entry point.
2. The workspace has `PRIVATE_OBJECT_DIR`; CI does not. Only `run-cover-image-description-browser.ts` in these phases starts the object-storage stub and conditionally supplies the root and stub URL. Other suites inherit storage configuration without providing it. Missing storage fails on storage operations, not on every app import. Even with a root, the default Replit backend also needs a reachable signing sidecar; environment presence alone does not provide that service.
3. The workspace has `APP_BASE_URL`; CI and the shared phase 4/5 harness do not supply it. OAuth production-origin validation, webhook registration, education-outbox links, and Cloudflare domain fallback can differ. `PUBLIC_SITE_URL` is a separate variable: B now supplies a real ephemeral HTTPS reverse-proxy origin **only to the API-server child**, not to the frontend/shared environment. A-harness and direct API tests do not supply it. The workspace's `PUBLIC_SITE_URL` can therefore hide missing configuration in the frontend and direct API tests. Frontend processes inherit ambient public-origin settings, or no setting in a stripped run. An earlier shared HTTP-origin override conflicted with Vite's HTTPS-only guard; merely moving the HTTP override to the API child also conflicted with the email helper's HTTPS validation. The current scripts-only TLS proxy addresses both boundaries without changing production validators or test assertions.
4. The workspace has `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`, and `REPLIT_ENVIRONMENT`; CI and these runners do not supply them. They affect legacy hostname and payment classification fallbacks, not an unconditional boot requirement. `REPL_ID` is also present but is a Vite-plugin control, not an API credential.
5. The workspace has `SITE_INDEXABLE`; CI does not globally set it. Vite's development HTML policy forces indexing off; the dedicated SEO browser config and SEO tests explicitly set it. Absence in the standalone SEO server means no indexing.
6. `DATABASE_URL` and `SESSION_SECRET` are present locally **and explicitly set by CI**, so they are not workspace-only gaps. The isolated harness replaces the child database URL; direct API suites use the browser job database. Session-secret absence is a feature-path encryption/acknowledgement error, not a universal app import error.
7. `DEFAULT_OBJECT_STORAGE_BUCKET_ID` is present locally but is only read by the image-pipeline integration **test** in this source tree; it is not a production storage implementation dependency. That test is not in phase 4/5.
8. No evidence from environment presence alone establishes that any suite passes or fails. In particular, missing optional provider keys, empty disposable-database settings, request-level test mocks, and production-only guards change reachability. The tables distinguish these conditions.

Run outcomes belong in a separate final evidence report, not this environment census. Reviewer reconciliation found no additional missing variable names; that inventory-completeness check is not proof that every environment-dependent feature or suite passed.

## Application runtime inventory

### Core runtime, deployment, host policy, database

| Variable | Runtime references | CI | WS | Harness sets it? | Missing behavior |
|---|---|---|---|---|---|
| `DATABASE_URL` | `D/index.ts:47,73`; `D/destructive-test-runtime.ts:84` | Yes | Y | B/A/R replace with owned disposable target; direct suites inherit CI | **Hard failure** importing DB package when absent. Destructive guard alone permits absent URL, but this does not make DB initialization succeed. |
| `SESSION_SECRET` | `A/lib/integrations.ts:39`; `A/lib/web-push.ts:232` | Yes | Y | No phase runner assignment; inherits CI | **Hard failure** encrypting/decrypting integration secrets or generating/verifying push acknowledgement tokens. No fallback key. |
| `NODE_ENV` | `A/app.ts:52`; `A/index.ts:70`; `A/lib/logger.ts:3`; `A/lib/runtime-environment.ts:23`; `A/lib/seed.ts:150`; `A/lib/test-listing-reconciliation.ts:45`; `D/destructive-test-runtime.ts:30`; `D/index.ts:248`; `W/seo-server.mjs:55`; `A/routes/b2c-discovery.ts:510`; `A/routes/media.ts:170,181`; `A/routes/marketplace.ts:897,914,939,947,954,3062,4575,4858,5691,13821,15545,15597`; `A/lib/object-storage.ts:36`; `A/lib/retention-settings.ts:1512,1531,1542`; `A/lib/catalog-cache.ts:504`; `A/lib/job-publication-cutoff.ts:67`; `A/lib/salon-notification-events.ts:257`; `A/test-server.ts:24` | Yes, test | N | B/A/R set test; several direct package commands set test; SEO child sets test | **Silent branch changes**: nonproduction cookies/HSTS/logging, no production AI startup assertion; test-only controls stay disabled unless exactly test. Explicit fixture initializer **fails** unless development/test and not deployed. Not a harmless universal development default. |
| `PORT` | `A/index.ts:49`; `A/test-server.ts:14`; `W/seo-server.mjs:806`; `W/vite.config.ts:9` | No | N | B/R allocate API port; B allocates Vite port; `W/seo-server.test.mjs:286` supplies child port; SEO Playwright uses CLI port | **Hard failure** normal API entry point; test server defaults to ephemeral port; SEO defaults to 23561; Vite defaults to 3000. |
| `LOG_LEVEL` | `A/lib/logger.ts:6` | No | N | Inherited only | **Silent fallback** info. |
| `SLOW_API_THRESHOLD_MS` | `A/lib/logger.ts:28` | No | N | Inherited only | **Silent fallback** 1000 ms, also for invalid/nonpositive values. |
| `SLOW_REQUEST_THRESHOLD_MS` | `A/app.ts:88` | No | N | Inherited only | **Silent fallback** 1000 ms, also for invalid/nonpositive values. |
| `BOOKING_MAX_IN_FLIGHT_PER_PROCESS` | `A/lib/booking-admission.ts:4` | No | N | No phase 4/5 assignment | **Silent fallback** zero (admission cap disabled). |
| `DB_POOL_MAX` | `D/index.ts:53` via `parseEnvInt:35` | No | N | Inherited only | **Silent fallback** 10; invalid configured value emits warning and falls back. |
| `DB_POOL_MIN` | `D/index.ts:54` via `parseEnvInt:35` | No | N | Inherited only | **Silent fallback** 0; bounded by max; invalid configured value warns. |
| `DB_IDLE_TIMEOUT_MS` | `D/index.ts:76` via `parseEnvInt:35` | No | N | Inherited only | **Silent fallback** 10000 ms; invalid configured value warns. |
| `DB_CONN_TIMEOUT_MS` | `D/index.ts:80` via `parseEnvInt:35` | No | N | Inherited only | **Silent fallback** 15000 ms; invalid configured value warns. |
| `DB_QUERY_TIMEOUT_MS` | `D/index.ts:81` via `parseEnvInt:35` | No | N | Inherited only | **Silent fallback** 30000 ms; invalid configured value warns. |
| `DB_STMT_TIMEOUT_MS` | `D/index.ts:82` via `parseEnvInt:35` | No | N | Inherited only | **Silent fallback** 30000 ms; invalid configured value warns. |
| `DATABASE_QUERY_OBSERVATION_ENABLED` | `D/index.ts:249` | No | N | Inherited only | **Nothing** outside test; observation remains enabled under `NODE_ENV=test` independently. |
| `PAYMENT_RUNTIME_ENV` | `A/lib/runtime-environment.ts:13–14` | No | N | No phase runner assignment | **Silent fallback** to legacy deployment markers + production NODE_ENV. Present invalid/empty value instead forces test classification. |
| `REPLIT_DEPLOYMENT` | `A/lib/runtime-environment.ts:18,35`; `A/lib/seed.ts:151`; `D/destructive-test-runtime.ts:31` | No | N | Not supplied; inherited if present | **Silent fallback** to legacy marker for payments; trust proxy false unless explicit hops. Exact deployed marker blocks destructive tests/fixtures when present. |
| `REPL_DEPLOYMENT` | `A/lib/runtime-environment.ts:18`; `A/lib/seed.ts:152`; `D/destructive-test-runtime.ts:32` | No | N | Not supplied; inherited if present | **Silent fallback** no legacy published-deployment evidence. Exact deployed marker blocks destructive tests/fixtures. |
| `REPLIT_ENVIRONMENT` | `A/lib/runtime-environment.ts:21–22` | No | Y | No; `education-bundle-purchases.test.ts` temporarily varies/restores it in classification assertions | **Silent fallback** allows production classification if other production conditions hold; absence alone does not select production. |
| `TRUST_PROXY_HOPS` | `A/lib/runtime-environment.ts:30–35` | No | N | Inherited only | **Silent fallback** one hop if REPLIT_DEPLOYMENT truthy, otherwise false. Present invalid value disables trust rather than using legacy fallback. |
| `ALLOWED_PUBLIC_HOSTS` | `A/lib/runtime-environment.ts:55–77` | No | N | Inherited only | **Silent fallback** REPLIT_DOMAINS; empty legacy set permits existing origin behavior. Explicit empty new value instead denies all hosts. |
| `REPLIT_DOMAINS` | `A/lib/runtime-environment.ts:57`; `A/routes/marketplace.ts:5540` | No | Y | No phase runner assignment | **Silent fallback** empty legacy domain list; request/configured-origin rules still apply. Ignored by new allowlist where implemented. |
| `REPLIT_DEV_DOMAIN` | `A/lib/runtime-environment.ts:77`; `A/routes/marketplace.ts:5561` | No | Y | Inherited only | **Nothing** for exact legacy dev-host match; localhost and `.replit.dev` detection remain. |
| `SAFE_MODE_NO_EXTERNAL_CALLS` | `A/lib/runtime-environment.ts:85`, consumed by Brevo, SMS, provider events, aftercare and education payment domain | No | N | No blanket phase 4/5 safety assignment | **Silent fallback** external-call blocking is OFF. Missing credentials or test mocks may separately prevent calls; absence is not a guarantee of offline execution. |

### Public URLs, integrations and external providers

| Variable | Runtime references | CI | WS | Harness sets it? | Missing behavior |
|---|---|---|---|---|---|
| `PUBLIC_SITE_URL` | `A/lib/referral-service.ts:446`; `A/lib/beauty-jobs-email.ts:43`; `A/routes/commerce-ef.ts:69`; `W/seo-policy.mjs:69`; `W/vite.config.ts:20` | No | Y | B sets ephemeral HTTPS reverse-proxy origin from `S/isolated-public-origin.ts` **only on API-server spawn**; B frontend and shared test environment inherit ambient value or absence. A/direct API suites do not supply it. `scripts/playwright.seo.config.ts` and SEO tests supply their own origin | **Silent fallback** APP_BASE_URL for those API helpers, LUMERA_PUBLIC_URL for SEO/Vite. **Hard failure** canonical API link helpers and standalone SEO policy if neither usable origin exists. Vite can leave origin unconfigured; development browser helper then uses current origin. Strict consumers reject HTTP even when set. |
| `APP_BASE_URL` | `A/lib/referral-service.ts:447`; `A/lib/beauty-jobs-email.ts:44`; `A/routes/commerce-ef.ts:69`; `A/lib/education-outbox.ts:18`; `A/lib/provider-events.ts:73`; `A/lib/integrations.ts:92`; `A/routes/media.ts:131`; `A/routes/marketplace.ts:946,953,5676` | No | Y | No shared/phase runner assignment; unrelated OAuth unit tests set local values | **Conditional**: public-link helpers can use PUBLIC_SITE_URL; outbox uses PUBLIC_APP_URL then empty prefix; nonproduction OAuth can use request origin; production OAuth rejects missing/non-HTTPS origin; provider registration and production Cloudflare domain checks can fail without DB replacement. |
| `PUBLIC_APP_URL` | `A/lib/education-outbox.ts:18` | No | N | Inherited only | **Silent fallback** empty link prefix if APP_BASE_URL is absent too. Read at module initialization. |
| `LUMERA_PUBLIC_URL` | `W/seo-policy.mjs:69`; `W/vite.config.ts:20` | No | N | Inherited only | **Nothing** if PUBLIC_SITE_URL exists; otherwise missing-origin failure in SEO policy, or unconfigured frontend public-origin behavior. |
| `SITE_INDEXABLE` | `W/seo-policy.mjs:84` | No | Y | Vite development transform forces false; SEO Playwright config and `seo-policy.test.mjs`/`seo-server.test.mjs` set it | **Silent fallback** noindex; even true requires matching public host. |
| `LUMERA_SEO_API_ORIGIN` | `W/seo-server.mjs:53` | No | N | SEO server direct-entry test sets a child origin; dedicated client SEO suite uses Vite/public API fixtures instead | **Hard failure** SEO API-origin lookup in production; **silent fallback** loopback:8080 otherwise. Errors may be handled by individual SEO render paths. |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `lib/integrations-anthropic-ai/src/client.ts:34,55`; boot assertion in `A/index.ts:70` | No | Y | No phase runner assignment | **Hard failure** lazy client creation/AI request, or production entry-point assertion. Nothing on mere app import/test-server boot without AI use. |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | `lib/integrations-anthropic-ai/src/client.ts:37,54`; boot assertion in `A/index.ts:70` | No | Y | No phase runner assignment | **Hard failure** under the same conditions as Anthropic base URL; not an unconditional import requirement. |
| `SMS_PROVIDER_API_KEY` | `A/lib/integrations.ts:87`; `A/lib/sms.ts:150,236,252,398`; `A/lib/education-sessions.ts:88` | No | N | No phase runner assignment; relevant tests may save synthetic integration settings | **Conditional** DB fallback first; test-send explicitly fails without key, eligibility/send paths can return false or skip, education sends can fail. Not a global startup error. |
| `SMS_PROVIDER_BASE_URL` | `A/lib/integrations.ts:87`; `A/lib/sms.ts:151`; `A/lib/education-sessions.ts:91` | No | N | Inherited only | **Silent fallback** DB value, then approved Infobip default; invalid supplied domain fails validation. |
| `SMS_SENDER_NAME` | `A/lib/integrations.ts:87`; `A/lib/sms.ts:164`; `A/lib/education-sessions.ts:95` | No | N | Inherited only | **Silent fallback** DB value, then LUMERA. |
| `BREVO_API_KEY` | `A/lib/integrations.ts:88`; `A/lib/brevo.ts:114` | No | N | Phase 5 `A/lib/webhook-repair-selection.test.ts:178` sets a synthetic key if absent; not a runner-wide setting | **Silent fallback** Replit connector proxy when no DB/env key; connector operation can subsequently fail off-platform. Disabled integration/safe mode rejects before provider call. |
| `BREVO_SENDER_EMAIL` | `A/lib/integrations.ts:88`; `A/lib/brevo.ts:100` | No | N | No phase runner assignment | **Conditional** DB fallback; sender resolver returns null without either source, preventing configured sending on paths requiring sender. |
| `BREVO_SENDER_NAME` | `A/lib/integrations.ts:88`; `A/lib/brevo.ts:102` | No | N | Inherited only | **Silent fallback** DB value, then LUMERA when sender email exists. |
| `SMS_WEBHOOK_SECRET` | `A/lib/integrations.ts:160`; `A/lib/provider-events.ts:59` via `WEBHOOK_SECRET_ENV.sms` | No | N | No phase runner assignment; Infobip browser tests use saved integration configuration | **Conditional hard failure** registration/authentication when no DB secret; no startup failure. |
| `BREVO_WEBHOOK_SECRET` | `A/lib/integrations.ts:161`; `A/lib/provider-events.ts:59` via `WEBHOOK_SECRET_ENV.brevo` | No | N | Phase 5 `webhook-repair-selection.test.ts:179` sets synthetic secret if absent | **Conditional hard failure** registration/authentication without DB secret; no startup failure. |
| `GOOGLE_CLIENT_ID` | `A/lib/integrations.ts:89`; `A/routes/marketplace.ts:1330` | No | N | No phase runner assignment | **Conditional hard failure** Google OAuth setup/use if DB fallback also missing; local/password auth unaffected. |
| `GOOGLE_CLIENT_SECRET` | `A/lib/integrations.ts:89`; `A/routes/marketplace.ts:1331` | No | N | No phase runner assignment | **Conditional hard failure** Google OAuth if DB fallback also missing. |
| `FACEBOOK_APP_ID` | `A/lib/integrations.ts:90`; `A/routes/marketplace.ts:1334` | No | N | No phase runner assignment | **Conditional hard failure** Facebook OAuth if DB fallback also missing. |
| `FACEBOOK_APP_SECRET` | `A/lib/integrations.ts:90`; `A/routes/marketplace.ts:1335` | No | N | No phase runner assignment | **Conditional hard failure** Facebook OAuth if DB fallback also missing. |
| `VAPID_PUBLIC_KEY` | `A/lib/integrations.ts:91`; `A/lib/web-push.ts:66,80`; `A/routes/marketplace.ts:5280` | No | N | No phase runner assignment | **Nothing**: push configuration reports unconfigured if DB settings do not supply valid complete configuration; non-push requests unaffected. |
| `VAPID_PRIVATE_KEY` | `A/lib/integrations.ts:91`; `A/lib/web-push.ts:67,81`; `A/routes/marketplace.ts:5281` | No | N | No phase runner assignment | **Nothing**: push unconfigured without DB replacement; does not invent a private key. |
| `VAPID_SUBJECT` | `A/lib/integrations.ts:91`; `A/lib/web-push.ts:68,82`; `A/routes/marketplace.ts:5282` | No | N | No phase runner assignment | **Nothing**: push unconfigured without DB replacement; subject must be valid mailto/HTTPS. |
| `CLOUDFLARE_API_TOKEN` | `A/lib/integrations.ts:92`; `A/routes/media.ts:129` via constant | No | N | No phase 4/5 runner assignment | **Hard failure** required production cache-purge/deactivation path unless DB config supplies it; production-only guard bypasses purge requirement in ordinary test runtime. |
| `CLOUDFLARE_ZONE_ID` | `A/lib/integrations.ts:92`; `A/routes/media.ts:130` via constant | No | N | No phase 4/5 runner assignment | **Hard failure** same production path unless valid DB config supplies it. |
| `SMS_REMINDER_JOB_SECRET` | `A/routes/marketplace.ts:6054` | No | N | No phase 4/5 runner assignment | **Hard failure** 401 on internal reminder-job request; unrelated requests work. |
| `CONFIRMATION_RETRY_JOB_SECRET` | `A/routes/marketplace.ts:6064` | No | N | No phase 4/5 runner assignment | **Hard failure** 401 on internal confirmation-retry request. |
| `EDUCATION_GALLERY_CLEANUP_JOB_SECRET` | `A/routes/marketplace.ts:6072` | No | N | No phase 4/5 runner assignment | **Hard failure** 401 on internal gallery-cleanup request. |

### Object storage — every alias separately

`getObjectStorage()` selects Replit when the provider is absent. The S3 constructor validates required values on construction, not just on the first network response. A secondary `??` alias is used only if the primary is null/undefined, not if it is an empty string.

| Variable | Runtime references | CI | WS | Harness sets it? | Missing behavior |
|---|---|---|---|---|---|
| `OBJECT_STORAGE_PROVIDER` | `A/lib/object-storage.ts:213` | No | N | No phase runner assignment | **Silent fallback** Replit. Unknown nonempty provider fails; S3 settings alone do not select S3. |
| `PRIVATE_OBJECT_DIR` | `A/lib/object-storage.ts:18`; `A/lib/image-storage.ts:33,60`; `A/routes/marketplace.ts:3256,3262,3277,4352` | No | Y | Phase 5 `run-cover-image-description-browser.ts` → `object-storage-stub.ts:startObjectStorageStubIfAbsent` supplies only when absent and stub used; others inherit | **Hard failure** Replit path/signing/upload operations; optional path-recognition helpers may return null/false. Some legacy route helpers still use root independently of S3 selection. |
| `S3_ENDPOINT` | `A/lib/object-storage.ts:116` | No | N | Inherited only | **Silent fallback** AWS_ENDPOINT_URL_S3; **hard failure** S3 constructor if neither exists. |
| `AWS_ENDPOINT_URL_S3` | `A/lib/object-storage.ts:116` | No | N | Inherited only | **Nothing** when primary endpoint set; **hard failure** S3 construction if both absent. |
| `S3_BUCKET` | `A/lib/object-storage.ts:117` | No | N | Inherited only | **Silent fallback** OBJECT_STORAGE_S3_BUCKET; **hard failure** S3 constructor if both absent. |
| `OBJECT_STORAGE_S3_BUCKET` | `A/lib/object-storage.ts:117` | No | N | Inherited only | **Nothing** when primary bucket set; **hard failure** S3 constructor if both absent. |
| `S3_ACCESS_KEY_ID` | `A/lib/object-storage.ts:118` | No | N | Inherited only | **Silent fallback** AWS_ACCESS_KEY_ID; **hard failure** S3 constructor if both absent. |
| `AWS_ACCESS_KEY_ID` | `A/lib/object-storage.ts:118` | No | N | Inherited only | **Nothing** when primary key set; **hard failure** S3 constructor if both absent. |
| `S3_SECRET_ACCESS_KEY` | `A/lib/object-storage.ts:119` | No | N | Inherited only | **Silent fallback** AWS_SECRET_ACCESS_KEY; **hard failure** S3 constructor if both absent. |
| `AWS_SECRET_ACCESS_KEY` | `A/lib/object-storage.ts:119` | No | N | Inherited only | **Nothing** when primary secret set; **hard failure** S3 constructor if both absent. |
| `S3_REGION` | `A/lib/object-storage.ts:125` | No | N | Inherited only | **Silent fallback** AWS_REGION then us-east-1. |
| `AWS_REGION` | `A/lib/object-storage.ts:125` | No | N | Inherited only | **Silent fallback** us-east-1 if S3_REGION also absent. |
| `S3_SESSION_TOKEN` | `A/lib/object-storage.ts:128` | No | N | Inherited only | **Silent fallback** AWS_SESSION_TOKEN then unsigned-by-token requests; temporary credentials may fail remotely without token. |
| `AWS_SESSION_TOKEN` | `A/lib/object-storage.ts:128` | No | N | Inherited only | **Nothing** with primary token; otherwise optional token omitted (temporary credentials may fail remotely). |
| `S3_FORCE_PATH_STYLE` | `A/lib/object-storage.ts:129` | No | N | Inherited only | **Silent fallback** path-style enabled; only literal false disables. |

### Retention tuning

Every name below is resolved through `readPositiveIntEnv(name)` at `A/lib/retention-settings.ts:1425`; absent, empty, and invalid/nonpositive overrides use the listed fallback. These are real request-path tuning inputs, not exclusively test controls.

| Variable | Runtime references | CI | WS | Harness sets it? | Missing behavior |
|---|---|---|---|---|---|
| `RETENTION_PREVIEW_MAX_CUSTOMERS` | `retention-settings.ts:1444` | No | N | `S/run-retention-preview.ts`, all three variants; phase 5 retention-settings test varies it | **Silent fallback** 250000. |
| `RETENTION_PREVIEW_TIME_BUDGET_MS` | `retention-settings.ts:1447` | No | N | Phase 5 retention-settings test varies it; no browser runner assignment | **Silent fallback** 10000 ms. |
| `RETENTION_PREVIEW_APPOINTMENT_ROW_BUDGET` | `retention-settings.ts:1450` | No | N | Phase 5 retention-settings test varies it | **Silent fallback** 20000 rows. |
| `RETENTION_PREVIEW_SAMPLE_SIZE` | `retention-settings.ts:1453` | No | N | `run-retention-preview.ts` estimate/stratified variants; phase 5 retention-settings test | **Silent fallback** 25000. |
| `RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS` | `retention-settings.ts:1456` | No | N | `run-retention-preview.ts` exact variant; phase 5 retention-settings test | **Silent fallback** 5. |
| `RETENTION_PREVIEW_SALON_SAMPLE_SIZE` | `retention-settings.ts:1458` | No | N | `run-retention-preview.ts` stratified variant; phase 5 retention-settings test | **Silent fallback** null (no explicit per-salon override). |
| `RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE` | `retention-settings.ts:1462` | No | N | `run-retention-preview.ts` stratified variant; phase 5 retention-settings test | **Silent fallback** 30; explicit values are also clamped to at least the default. |
| `RETENTION_PREVIEW_SALON_MAX_STRATA` | `retention-settings.ts:1466` | No | N | `run-retention-preview.ts` stratified variant; phase 5 retention-settings test | **Silent fallback** 500. |

## Browser substitutions and build/development-server controls

`import.meta.env` values are Vite substitutions, **not Node process variables read in the end user's browser**. Their shell-presence column must not be interpreted as missing browser configuration. `lib/api-client-react` and `lib/api-zod` have no additional first-party runtime environment reads; API client URL configuration is not an extra implicit environment variable. `lib/api-spec` has the build-time override below.

| Variable | References / category | CI | WS | Harness sets it? | Missing behavior |
|---|---|---|---|---|---|
| `BASE_URL` (`import.meta.env`) | `W/src/App.tsx:553`; `W/src/main.tsx:32–33`; `W/src/pages/admin/retention-settings.tsx:905`; `W/src/pages/owner/profile.tsx:193`; browser substitution | No shell assignment | N | Vite derives from configured base; B sets BASE_PATH | **Silent fallback** Vite base `/` via config; routing, service worker scope and links use that value. Not an independent runtime secret. |
| `DEV` (`import.meta.env`) | `W/src/components/error-boundary.tsx:50`; `W/src/lib/public-site-url.ts:24`; browser substitution | No shell assignment | N | Vite supplies boolean by mode | **Nothing** to provision: development enables diagnostics/current-origin fallback; production does not. |
| `VITE_PUBLIC_SITE_URL` (`import.meta.env`) | `W/src/lib/public-site-url.ts:5`; explicitly defined in `W/vite.config.ts:26` | No | N | Vite definition derives PUBLIC_SITE_URL/LUMERA_PUBLIC_URL; B frontend inherits these rather than setting them; dedicated SEO config supplies its origin | **Silent fallback** SSR meta first, then browser origin in DEV; **hard failure** `publicSiteOrigin()` in production if no valid configuration. Setting a shell variable with this name alone does not bypass the explicit Vite definition. |
| `BASE_PATH` | `W/vite.config.ts:17`; build/dev only | No | N | B sets `/`; `scripts/playwright.seo.config.ts` sets `/` | **Silent fallback** `/`. |
| `LUMERA_API_BASE_URL` | `W/vite.config.ts:19`; dev proxy/build configuration | No | N | B sets allocated API origin for Vite; R sets API URL for regression scripts | **Nothing**: Vite proxy is undefined when absent; relative API traffic must be handled by an external proxy/server. Does not itself create/start an API. |
| `REPL_ID` | `W/vite.config.ts:54`; build/dev plugin control | No | Y | Inherited only | **Nothing**: no Replit-only development plugins when absent; production guard also disables them. |
| `API_CODEGEN_OUTPUT_ROOT` | `lib/api-spec/orval.config.ts:9–10`; `lib/api-spec/scripts/fix-zod-index.mjs:8–9`; code generation only | No | N | No phase 4/5 assignment | **Silent fallback** normal workspace generated-output paths. Not an app runtime dependency. |

`NODE_ENV`, `PORT`, `PUBLIC_SITE_URL`, `LUMERA_PUBLIC_URL`, and `SITE_INDEXABLE` also influence Vite configuration; their independent runtime uses are already listed above.

## Runtime test controls and test-only reads

These are kept separate rather than presented as missing production configuration. CI does not directly set any name in this table. “None in phases” does not mean a dedicated runner elsewhere in the repository never sets it.

| Variable | Runtime/test references | CI | WS | Harness sets it? | Missing behavior |
|---|---|---|---|---|---|
| `LUMERA_DISPOSABLE_DATABASE` | `D/destructive-test-runtime.ts:87`; `A/lib/object-storage.ts:36` | No | N | B/A/R set owned URL | **Conditional** destructive guard can still accept named CI/recognized disposable databases; otherwise rejects unsafe target. Alternate storage stub URL ignored without disposable marker and test NODE_ENV. |
| `LUMERA_TEST_OBJECT_STORAGE_STUB_URL` | `A/lib/object-storage.ts:37` | No | N | Phase 5 cover runner via `S/object-storage-stub.ts` when stub starts | **Silent fallback** Replit sidecar on loopback:1106; honored only for test + disposable marker. |
| `LUMERA_BOOKING_LOAD` | `A/routes/health.ts:10` | No | N | No phase 4/5 assignment; booking-load runner outside these phases | **Nothing**: extra load-test health telemetry disabled. |
| `LUMERA_TEST_SEED` | `A/test-server.ts:30` | No | N | R sets it; ordinary B path does not use this switch, browser fixtures seed independently | **Nothing**: test-server explicit seed step skipped. |
| `LUMERA_ISOLATED_API_REGRESSION_TEST` | `A/test-server.ts:25` | No | N | API regression runner outside phase 4/5 | **Nothing**: test-only cache-purge override disabled. |
| `LUMERA_TEST_DROP_SALON_NOTIFICATION_LISTENER_ON_STARTUP` | `A/test-server.ts:35` | No | N | No phase 4/5 caller assignment; lifecycle fault-injection tests elsewhere | **Nothing**: no forced listener drop. |
| `LUMERA_TEST_HEALTHZ_HOLD_FILE` | `A/test-server.ts:16` | No | N | Lifecycle tests outside phases | **Nothing**: health response not artificially held. |
| `LUMERA_TEST_HEALTHZ_REACHED_FILE` | `A/test-server.ts:17` | No | N | Lifecycle tests outside phases | **Nothing**: no health-reached marker file written. |
| `LUMERA_TEST_RETENTION_PREVIEW_SLEEP_AT` | `A/lib/retention-settings.ts:1513` | No | N | Phase 5 `retention-settings.test.ts` | **Nothing**: no labelled SQL sleep; gated by test NODE_ENV. |
| `LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS` | `A/lib/retention-settings.ts:1514` via helper | No | N | Phase 5 `retention-settings.test.ts` | **Silent fallback** zero sleep; requires matching label/test NODE_ENV. |
| `LUMERA_TEST_RETENTION_PREVIEW_BATCH_DELAY_MS` | `A/lib/retention-settings.ts:1532` via helper | No | N | Phase 5 `retention-settings.test.ts` | **Silent fallback** zero batch delay; only test NODE_ENV. |
| `LUMERA_TEST_RETENTION_PREVIEW_SAMPLE_PCT` | `A/lib/retention-settings.ts:1543` | No | N | Phase 5 `retention-settings.test.ts` | **Nothing**: no forced sample percentage; normal sampling remains. Only test NODE_ENV; valid range 0–100. |
| `LUMERA_TEST_DATABASE_URL` | `A/lib/seed.test.ts:31–34`; harness/spec database authorization, not production DB resolver | No | N | B/A/R set child URL | **Hard failure** explicit seed test assertions if absent; app itself uses DATABASE_URL. |
| `LUMERA_TEST_DATABASE_NAME` | `A/lib/beauty-jobs-routes.test.ts:14` | No | N | `S/run-destructive-test.ts` identity fields, outside the phase 4 beauty-jobs browser runner | **Conditional hard failure** identity validation in that API test; not an app boot requirement. |
| `LUMERA_TEST_DATABASE_SYSTEM_IDENTIFIER` | `A/lib/beauty-jobs-routes.test.ts:15` | No | N | `S/run-destructive-test.ts`, not phase 4 beauty-jobs browser runner | **Conditional hard failure** test identity validation; not runtime configuration. |
| `LUMERA_TEST_DATABASE_TRANSPORT` | `A/lib/beauty-jobs-routes.test.ts:16` | No | N | `S/run-destructive-test.ts`, not phase 4 beauty-jobs browser runner | **Conditional hard failure** test identity validation; not runtime configuration. |
| `LUMERA_TEST_SCHEMA_SCENARIO` | `A/lib/business-growth-schema-ensure-child.ts:20` | No | N | Schema regression parent tests, not phase 4/5 | **Nothing**: special broken-current-version setup skipped; normal child schema checks continue. No production use. |
| `LUMERA_INERT_DB_MODE` | `A/lib/production-demo-seed-isolated-harness.ts:277,830` | No | N | Production-demo isolated harness, not phase 4/5 | **Silent fallback** empty inert fixture state. Not a real DB connection setting. |
| `LUMERA_INERT_DB_VERIFICATION_HASH` | `A/lib/production-demo-seed-isolated-harness.ts:295` | No | N | Production-demo isolated harness tests, not phase 4/5 | **Nothing**: verification hash absent from inert fixture data; changes proof scenario, not app runtime. |
| `LUMERA_FIXTURE_ACTION` | `A/lib/production-demo-seed-isolated-harness.ts:722` | No | N | Same harness `runChild` at :811 | **Silent fallback** ensure fixture action. |
| `LUMERA_ALLOW_PRODUCTION_DEMO_SEED` | `A/lib/production-demo-seed-isolated-harness.ts:746–766`, computed allowlist forwarding only | No | N | Production-demo safety tests, outside phase 4/5 | **Nothing**: optional legacy flag not forwarded when absent; no first-party production consumer found. Included because the computed environment read resolves to this name. |
| `LUMERA_DEMO_PASSWORD` | `A/routes/marketplace-query-budget.test.ts:324` | No | N | No phase 4/5 assignment | **Silent fallback** test's fixed fixture password; no production read. |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | `A/lib/image-pipeline.test.ts:61` | No | Y | No phase 4/5 assignment; cover stub does not set it | **Hard failure** image-pipeline test precondition if absent; no application implementation read, and that test is outside these phases. |
| `TZ` | `W/src/lib/date-range-presets.test.ts:27,40`; `W/src/lib/campaign-period-url.test.ts:68` | No | N | Those tests temporarily set/restore timezone | **Silent fallback** host timezone outside temporary test overrides; these are test reads, not app configuration reads. |
| `PATH` | `A/lib/business-growth-schema-boot-regression.test.ts:75`; `A/lib/production-demo-seed-isolated-harness.ts:758` | No explicit YAML setting | Y | Inherited runner OS environment; schema test defaults empty | **Conditional hard failure** resolving child executables if not otherwise absolute; not application configuration. |
| `HOME` | `A/lib/business-growth-schema-boot-regression.test.ts:76`; `A/lib/production-demo-seed-isolated-harness.ts:759` | No explicit YAML setting | Y | Inherited; schema child defaults `/tmp` | **Silent fallback** schema test temp home; otherwise omitted from child environment. |
| `TMPDIR` | `A/lib/production-demo-seed-isolated-harness.ts:760` | No | N | Inherited only | **Silent fallback** OS/Node default temporary directory. |
| `LANG` | `A/lib/production-demo-seed-isolated-harness.ts:761` | No explicit YAML setting | Y | Inherited only | **Silent fallback** host/tool default locale. |
| `LC_ALL` | `A/lib/production-demo-seed-isolated-harness.ts:762` | No | N | Inherited only | **Silent fallback** other locale settings/tool defaults. |

Tests also save/restore already inventoried application variables (OAuth keys, deployment markers, NODE_ENV, origins, provider secrets and retention limits). Those mutations do not introduce new runtime variable names or provide configuration to separately launched server processes. For example, phase 5 webhook-repair-selection supplies its own synthetic Brevo key/secret, whereas the isolated Infobip browser test configures the disposable database, not the parent shell.

## Every phase 4/5 suite: runner and environment boundary

All paths in the runner column are under `scripts/src/` unless stated otherwise. All B/A paths inherit the parent shell before applying overrides. A direct API test is **not** covered by B's public-origin override or cover's storage stub.

| Phase | Root package command | Runner / execution boundary | Environment supplied beyond CI |
|---|---|---|---|
| 4 | `test:retail-checkout-api` | `run-retail-checkout-api.ts` → A | Disposable database URL/marker, test NODE_ENV, suite marker; no public URL/storage/provider provisioning. |
| 4 | `test:supplier-catalog-api` | `run-supplier-catalog-api.ts` → A | Same A boundary, supplier suite marker. |
| 4 | `test:education-placement-lifecycle` | `run-education-placement-lifecycle.ts` → A | Same A boundary, placement suite marker. |
| 4 | `test:education-extras` | Direct `A/lib/education-extras.test.ts` | Package command sets test NODE_ENV; uses CI database and inherited integration/origin settings. |
| 4 | `test:education-gift-refunds` | API package command runs `A/lib/education-sessions.test.ts` | Explicit test NODE_ENV; no B origin or storage stub. |
| 4 | `test:final-booking-qa` | `run-final-booking-qa.ts` → A | Same A boundary, final-booking marker. |
| 4 | `test:booking-journey-browser` | `run-booking-journey-browser.ts` → B | B origin/ports/base/database and release-browser marker. Source comment saying not wired into release is stale relative to root package command. |
| 4 | `test:admin-form-resilience` | `run-admin-form-resilience.ts` → B | B baseline + form-resilience/release markers. |
| 4 | `test:employee-location-deactivation-browser` | `run-employee-location-deactivation-browser.ts` → B | B baseline + suite/release markers; no production Cloudflare credentials. |
| 4 | `test:salon-notifications:release` | `run-salon-notification-release.ts` → B | B baseline + notification/release markers. |
| 4 | `test:beauty-jobs-browser` | `run-beauty-jobs-browser.ts` → B | B baseline + beauty-jobs/release markers. |
| 4 | `test:education-group-online-consent-browser` | `run-education-group-online-consent-browser.ts` → B | B baseline + consent/release markers. |
| 4 | `test:education-dispute-browser` | `run-education-dispute-browser.ts` → B | B baseline + dispute/release markers. |
| 4 | `test:safe-external-url-rendering-browser` | `run-safe-external-url-rendering-browser.ts` → B | B baseline + suite/release markers. |
| 4 | `test:education-public-center-hook-order-browser` | `run-education-public-center-hook-order-browser.ts` → B | B baseline + hook-order/release markers. |
| 4 | `test:logout-login-cache-residue-browser` | `run-logout-login-cache-residue-browser.ts` → B | B baseline + suite/release markers. |
| 4 | `test:infobip-registration-browser` | `run-infobip-registration-browser.ts` → B | B baseline + Infobip/release markers; no global SMS env credentials. |
| 4 | `test:retention-preview` | `run-retention-preview.ts` → B, three runs | B baseline + exact/estimate/stratified markers and specifically enumerated retention overrides above. |
| 4 | `test:education-bundle-purchases` | Direct `A/lib/education-bundle-purchases.test.ts` | Inherits CI test NODE_ENV; temporarily changes classification markers in assertions. |
| 4 | `test:admin-navigation-regression` | `run-admin-navigation-regression.ts` → B | B baseline + admin isolation marker. |
| 4 | `test:admin-bounded-pagination` | `run-admin-bounded-pagination.ts` → B | B baseline + admin isolation marker. |
| 4 | `test:admin-access-configuration` | `run-admin-access-configuration.ts` → B | B baseline + admin isolation marker. |
| 5 | `test:retention-settings` | Direct `A/lib/retention-settings.test.ts` | Package sets test NODE_ENV; test varies retention knobs/fault injection. No B origin/storage provisioning. |
| 5 | `test:webhook-repair-selection` | Direct `A/lib/webhook-repair-selection.test.ts` | Package sets test NODE_ENV; test supplies synthetic Brevo API key and webhook secret if absent. |
| 5 | `test:sms-fallback-phone-notice` | Direct `A/lib/sms-fallback-admin-phone-notice.test.ts` | Package sets test NODE_ENV; not an isolated browser runner despite command name. |
| 5 | `test:booking-settings` | `run-booking-settings-browser.ts` → B | B baseline + booking-settings/release markers. |
| 5 | `test:seo` | Web package SEO Node tests, then `S/inactive-salon-contract.test.ts` | SEO tests supply public origin/index policy; server child supplies port/API origin/test NODE_ENV. Contract test explicitly test NODE_ENV. |
| 5 | `test:owner-widget-url` | Direct `W/src/lib/owner-widget-url.test.ts` | Pure URL unit test inputs; no app/database/server environment provisioning. |
| 5 | `test:client-seo-browser` | `scripts/playwright.seo.config.ts` | Dedicated Vite process, BASE_PATH, PUBLIC_SITE_URL, SITE_INDEXABLE; CLI port; public API fixtures, no owned API server. |
| 5 | `test:cover-image-description-browser` | `run-cover-image-description-browser.ts` → B + storage stub helper | B baseline + cover/release markers; conditional PRIVATE_OBJECT_DIR and LUMERA_TEST_OBJECT_STORAGE_STUB_URL. Mobile mode adds test marker, but root phase command does not pass mobile flag. |

B's shared baseline is: child `DATABASE_URL`, `LUMERA_DISPOSABLE_DATABASE`, `LUMERA_TEST_DATABASE_URL`, `NODE_ENV`, `LUMERA_TEST_RUN_MARKER`, `LUMERA_BROWSER_SPEC_TYPES_CHECKED`; **API-server spawn only** adds allocated API `PORT` and HTTPS-proxy `PUBLIC_SITE_URL`; frontend adds `BASE_PATH`, HTTP-transport `LUMERA_API_BASE_URL`, `PORT` while retaining ambient public-origin configuration or absence; browser adds `LUMERA_WEB_BASE_URL`. References to “B baseline” or “B origin” in the suite map mean this process-specific boundary, not a shared public-origin override. A's baseline omits public-origin/frontend/browser variables. The suite selection markers and lifecycle bookkeeping are harness/spec inputs, not hidden additional application runtime reads.

The B runner calls `S/isolated-public-origin.ts:startIsolatedPublicOrigin(apiPort)`. This scripts-only helper generates a short-lived self-signed certificate with `openssl`, binds a real HTTPS listener to an ephemeral loopback port, and forwards requests to the disposable HTTP API. Cleanup closes the proxy and removes its unique temporary certificate directory. It does not set a process-wide TLS-trust override, invent a production hostname, or relax application HTTPS checks. Availability of `openssl` and a writable OS temporary directory are harness/tool prerequisites, not new application environment-variable reads. A client directly visiting this self-signed origin still needs appropriate test-local certificate handling; merely allocating the origin does not install a trusted certificate.

`scripts/playwright.config.ts` and the SEO config optionally read `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (workspace: present; CI: not explicitly set; phase runners: inherited only); absence uses Playwright's installed browser (CI installs Chromium). This is a test-tool executable selection, not a marketplace runtime requirement. `CI` controls Playwright safeguards/retries, and `CI_TIMING_REPORT_FALLBACK_DIR` controls reporting; neither is an extra application runtime credential. `LUMERA_BLOCK_EXTERNAL_NETWORK` is written by the production-demo isolated harness, not read from the environment by application source (workspace: absent; browser CI: not set); it is not an omitted runtime read.

## Computed names, forwarding and completeness limits

| Computed access / pattern | Resolution |
|---|---|
| `D/index.ts:35 process.env[key]` | All `parseEnvInt` calls resolved to the six separately listed `DB_*` variables. No unresolved application name at those call sites. |
| `A/lib/retention-settings.ts:1425 process.env[name]` | All `readPositiveIntEnv` calls resolved to eight listed RETENTION_PREVIEW variables plus `LUMERA_TEST_RETENTION_PREVIEW_SLEEP_MS` and `LUMERA_TEST_RETENTION_PREVIEW_BATCH_DELAY_MS`. |
| `A/lib/provider-events.ts:59 process.env[WEBHOOK_SECRET_ENV[provider]]` | Closed provider map: `SMS_WEBHOOK_SECRET`, `BREVO_WEBHOOK_SECRET`, each separately listed. |
| `A/routes/media.ts:129–130 process.env[CLOUDFLARE_*_ENV]` | Constants resolve to `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`. |
| `env`, `environment`, `this.environment` | Runtime aliases traced in runtime-environment, web-push, object-storage, seed, destructive-test-runtime, DB observation and SEO policy. All actual named property reads are in the tables. |
| `internal-job-secret-timing-safety.test.ts` `process.env[route.envVar]` | Test route list resolves to the three separately inventoried internal job secrets. Restore loop `process.env[key]` uses the same saved keys. |
| `education-bundle-purchases.test.ts`, `internal-request-controls.test.ts` restore loops | Closed saved environment objects: NODE_ENV, REPLIT_DEPLOYMENT, REPL_DEPLOYMENT; bundle tests also REPLIT_ENVIRONMENT. No additional name. |
| `production-demo-seed-isolated-harness.ts:766 environment[key]` | Closed `SAFE_CHILD_ENV_KEYS` allowlist: NODE_ENV, REPLIT_DEPLOYMENT, REPL_DEPLOYMENT, LUMERA_ALLOW_PRODUCTION_DEMO_SEED, LUMERA_INERT_DB_MODE, LUMERA_INERT_DB_VERIFICATION_HASH, LUMERA_FIXTURE_ACTION. All separately inventoried. `startIsolatedHttpServer` also spreads a supplied object, then removes keys outside this allowlist and the explicitly enumerated OS/session/network-block keys. |
| `...process.env`, `env: process.env` in harnesses/tests/Vite policy | **Open/unresolved inherited set**, not a finite list of named reads. This transmits any parent setting to children (and third-party tools), including unrelated settings not consulted by first-party application source. No claim that only inventoried variables are present in children. |
| Third-party `ReplitConnectors`, `pg`, Vite, Anthropic SDK, Pino and Node | Implicit vendor/OS environment reads are **not resolved by this first-party audit**. Brevo's connector fallback in particular can need platform authentication even though first-party code does not spell out its variable names. No connector/database call was made to investigate them. |

There are no unresolved computed **first-party production variable names** after resolving the closed call sites above. There remain explicitly unresolved open environment forwarding and vendor-discovery sets. This distinction avoids both a false “all dynamic names resolved” claim and treating every inherited OS variable as an application dependency.

Only this audit document is intended as an output; no app/workflow changes or commits are part of this audit. Source line references describe the inspected checkout and may move with concurrent development.