# Browser phases 4/5: environment-isolation proof

Date: 2026-09-23. Branch: `daily/2026-09-22`.

## Scope and change

The working tree was clean at `3846fbc498b6a730109d16e0e5de9dbbad794202` before this work.
The full first-party runtime census is in
[ci-browser-runtime-environment.md](ci-browser-runtime-environment.md): 111
named inputs, each with CI configuration, workspace presence, harness provisioning,
source references, and conditional missing-value behavior. It also maps all 30
phase commands and documents the limits of vendor-internal environment discovery.

The shared isolated browser harness now supplies `PUBLIC_SITE_URL` **only to the
API child**, overriding any ambient workspace domain. The value is a real
ephemeral loopback HTTPS endpoint forwarding to that child's HTTP server.
Certificates are generated in an owned temporary directory; the proxy, sockets,
and directory are closed/removed after the API child. HTTPS validation remains
unchanged, and no process-wide certificate-verification bypass is used.

Only test infrastructure, its focused tests, audit documentation, and agent
memory were changed. No production upload/email implementation, workflow,
application requirement, assertion, schema declaration, or migration source
was changed. No production environment/tool/logs or development database was
accessed. Existing schema preparation ran only inside owned disposable
PostgreSQL clusters.

## Reproducible environment boundary

Stripped command:

```sh
node scripts/run-phase45-environments.mjs --mode=ci --full-chain \
  --chromium=/repl/tools/bin/chromium
```

This executes the actual phase commands, not substituted tests. It enumerates
the root commands from `package.json`, records each suite's progression/exit,
and runs unstarted suites separately if a chain fails so a failure cannot hide
the remainder. `--phase=4` or `--phase=5` permits a single complete phase.

The stripped child environment is constructed from an allowlist, not by deleting
only known application variables. It supplies the browser CI job's `CI=true`,
`NODE_ENV=test`, and deterministic test-only `SESSION_SECRET`; database targets
are replaced by owned disposable socket-cluster URLs. No workspace public URL,
storage root, API/provider credential, database URL, preload/proxy configuration,
or Replit identity is inherited. Vite/dotenv files are refused, HOME/npm
configuration is isolated, and deployment guards run before stripping.

Explicit host-tool accommodations are PATH shims, locale/timezone/temp/home
settings, npm configuration isolation, and the installed Chromium executable.
OpenSSL is a test-tool prerequisite. This proves application-environment parity,
not a byte-identical GitHub VM: local Node is v24.13.0 and PostgreSQL is 16.10;
the workflow selects Node 22. The workflow's timing-report directory belongs
to its outer reporting wrapper, not an application dependency of these direct
phase commands.

Normal runs preserve ambient workspace application settings and storage, while
the existing owned disposable runner removes inherited database targets:

```sh
env -u DATABASE_URL -u LUMERA_MIGRATION_DATABASE_URL \
  pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- \
  pnpm run validate:release:4-isolated
# Same owned wrapper for validate:release:5-final.
```

No additional variable needs to be added to the workflow for these 30 suites.
`SESSION_SECRET` must be provisioned by CI (it already is); a harness must not
invent a production encryption key. CI also already supplies its disposable
database target and test mode. Actual AI/provider/storage integration exercises
would need their own approved credentials/services; their absence is not
evidence that those external integrations were tested.

## Final per-suite results

`PASS` means the named command was observed in a successful actual `&&` phase
chain, not inferred from a partial/interrupted run.

| Phase | Suite | Stripped | Normal |
|---|---|---|---|
| 4 | `test:retail-checkout-api` | PASS | PASS |
| 4 | `test:supplier-catalog-api` | PASS | PASS |
| 4 | `test:education-placement-lifecycle` | PASS | PASS |
| 4 | `test:education-extras` | PASS | PASS |
| 4 | `test:education-gift-refunds` | PASS | PASS |
| 4 | `test:final-booking-qa` | PASS | PASS |
| 4 | `test:booking-journey-browser` | PASS | PASS |
| 4 | `test:admin-form-resilience` | PASS | PASS |
| 4 | `test:employee-location-deactivation-browser` | PASS | PASS |
| 4 | `test:salon-notifications:release` | PASS | PASS |
| 4 | `test:beauty-jobs-browser` | PASS | PASS |
| 4 | `test:education-group-online-consent-browser` | PASS | PASS |
| 4 | `test:education-dispute-browser` | PASS | PASS |
| 4 | `test:safe-external-url-rendering-browser` | PASS | PASS |
| 4 | `test:education-public-center-hook-order-browser` | PASS | PASS |
| 4 | `test:logout-login-cache-residue-browser` | PASS | PASS |
| 4 | `test:infobip-registration-browser` | PASS | PASS |
| 4 | `test:retention-preview` | PASS | PASS |
| 4 | `test:education-bundle-purchases` | PASS | PASS |
| 4 | `test:admin-navigation-regression` | PASS | PASS |
| 4 | `test:admin-bounded-pagination` | PASS | PASS |
| 4 | `test:admin-access-configuration` | PASS | PASS |
| 5 | `test:retention-settings` | PASS | PASS |
| 5 | `test:webhook-repair-selection` | PASS | PASS |
| 5 | `test:sms-fallback-phone-notice` | PASS | PASS |
| 5 | `test:booking-settings` | PASS | PASS |
| 5 | `test:seo` | PASS | PASS |
| 5 | `test:owner-widget-url` | PASS | PASS |
| 5 | `test:client-seo-browser` | PASS | PASS |
| 5 | `test:cover-image-description-browser` | PASS | PASS |

Stripped phase 4 exited 0 (22/22 commands, 1932.869 seconds); stripped phase 5
exited 0 (8/8 commands, 256.254 seconds). The cover suite passed 4/4 in 51.1
seconds with the local storage stub. Normal phase 5 exited 0; its cover suite
passed 4/4 in 48.6 seconds. The final sequential normal phase 4 also exited 0
with all 22 commands observed and the phase completion marker present.

The two DB-free HTTPS helper tests passed: actual TLS POST forwarding with
certificate verification enabled and cleanup after certificate-generation
failure. Scripts typecheck passed.

## Failed and interrupted attempts, without hiding setup failures

| Attempt | Observation | Correction / classification |
|---|---|---|
| Initial normal phase 4 | `test:booking-journey-browser` could not start Vite: the first shared `PUBLIC_SITE_URL=http://...` failed its HTTPS-origin guard. | Scope the public-origin override to the API child, not the shared/frontend environment. No application guard changed. |
| Initial normal phase 5 | Cover suite: 3 passed, Beauty Jobs approval returned 500 because the API-only HTTP origin still failed email HTTPS validation. | Supply an actual harness-only HTTPS reverse proxy. No email path, assertion, or HTTPS requirement changed. |
| Stripped tool preflight | PostgreSQL `initdb` could not locate its installation data through the first symlink-farm PATH. No suite executed. | Execute installed PostgreSQL tools through absolute-path shims, preserving their installation prefix. |
| Short-lived background launch attempts | The helper executor terminated its background descendants; no full suite result existed. | Launch foreground commands through the main persistent background-task facility. Not counted as verification. |
| First executing stripped attempt | Coreutils applet paths had been resolved to the multicall binary; `dirname`/`readlink` failed and pnpm's `tsx` launcher attempted `/tsx/dist/cli.mjs`. | Preserve executable basenames while constructing the named-tool PATH. These were launcher failures before the suites exercised application behavior. Exact affected commands are listed below. |
| Concurrent final-source normal/stripped phase 4 | Normal Beauty Jobs failed closing browser contexts with trace ZIP/byte-stream errors. Stripped Beauty Jobs failed the unchanged `<2000ms` feedback assertion at 7483ms. | Stop parallel execution of the same browser suites and rerun complete chains sequentially. Shared output files and resource contention were introduced by the verification scheduling; no test timeout, retry, assertion, or application behavior was relaxed. |
| Cancelled diagnostic attempts | A normal phase-4 attempt was stopped during admin-form checks when the HTTPS correction required a coherent rerun. The stripped coreutils attempt was stopped during retention preview; the concurrent stripped attempt was stopped during education-dispute checks. | These are interrupted runs, not passes or additional application failures. |

The coreutils launcher failure affected: `test:retail-checkout-api`,
`test:supplier-catalog-api`, `test:education-placement-lifecycle`,
`test:education-extras`, `test:education-gift-refunds`, `test:final-booking-qa`,
`test:booking-journey-browser`, `test:admin-form-resilience`,
`test:employee-location-deactivation-browser`, `test:salon-notifications:release`,
`test:beauty-jobs-browser`, `test:education-group-online-consent-browser`,
`test:education-dispute-browser`, `test:safe-external-url-rendering-browser`,
`test:education-public-center-hook-order-browser`,
`test:logout-login-cache-residue-browser`, and `test:infobip-registration-browser`.
`test:retention-preview` ended with the requested termination (143); later
commands were not run in that attempt. All 30 were subsequently exercised in
the successful stripped chains.

## Evidence locations and hash policy

Local raw output is retained privately, not committed (it can contain ephemeral
test IDs and signed upload URLs):

- Stripped final summary and phase logs: `/tmp/lumera-phase45-SHTed5/`.
- Normal phase 5: `/tmp/browser-env-normal-final.log` (phase 4 in this earlier
  log failed; only the explicit `NORMAL_PHASE5_EXIT=0` validates phase 5).
- Normal final phase 4: `/tmp/browser-env-normal-sequential-phase4.log`.
- Failed setup/coreutils/concurrency evidence: `/tmp/lumera-phase45-wbNlHv/`,
  `/tmp/lumera-phase45-WtGjTZ/`, and the earlier normal attempt logs.

Both protected-document validators passed. The complete current-source hash
census found zero drift across diagnostic `currentInputs` (73 entries) and
execution-plan `files` (85 entries). The historical diagnostic `inputs` block
and execution-plan `originalProtectedFiles` block are each raw-byte-identical
to `origin/main`. No protected hash or provenance amendment was necessary.