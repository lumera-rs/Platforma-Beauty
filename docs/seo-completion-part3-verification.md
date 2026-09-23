# SEO completion, part 3: verification and changed-file map

> **Historical verification — superseded for current architecture and results.**
> See [PR38 merge-blockers verification](pr38-merge-blockers-verification.md).
> The inactive-salon SSR database lookup described below has been removed:
> the public API now returns exactly `name`, `active: false` and `city`, and SSR
> obtains city only from that DTO. The frontend has no PostgreSQL dependency
> or direct database connection. Earlier test counts and workflow notes below
> describe the historical run, not the current verification.

## Scope and final SEO results

The preceding guard commit was already pushed as
`4e8543d374e9e6d9b7c9d134f6a2222b7cb4b4e1`; the starting working tree was clean.
No development or production database was accessed during this part. Database
test execution used the general owned-cluster runner only. Schema, migration,
workflow configuration, authentication and booking-engine files were not changed.
CI was not checked, publishing was not invoked, and indexing remained disabled.

| Check | Result |
| --- | --- |
| HTTP SEO standards | PASS: 32 public React route contracts and 16 schema contracts; real local HTTP without JavaScript, backed only by fixtures |
| Server and standalone policy tests | 62/62 PASS |
| Discovery, robots, city deduplication, pagination, cache and documentation parity | 10/10 PASS |
| Server-only inactive-city resolver and malformed entity identity regressions | 4/4 PASS |
| Generated inactive-salon response contract | 1/1 PASS |
| Unchanged public-salon-address suite through owned PostgreSQL 16 | 5/5 PASS |
| Generated libraries, API and frontend TypeScript checks | PASS |
| Documentation validators | 13/13 PASS |

Status coverage: found public entities return 200; confirmed missing entities
return 404 with or without query parameters; unavailable, malformed, timed-out
or failed lookups return 503 and noindex. Inactive salons return 200/noindex,
with only the name, unavailable-for-booking message and canonical city link in
the entity content. The public API response is exactly `{name, active: false}`.
City resolution is a lazy server-only parameterized SELECT with read-only
PostgreSQL settings, not an expansion of that API response. The web runtime
therefore needs its existing database configuration for inactive-page rendering;
unit tests inject the city resolver and refuse ambient database access.

No deletion tombstones or salon slug-history storage exist. Archived or
unpublished is not evidence of permanent deletion. Missing courses, jobs and
products remain 404; reliable 410 and changed-salon-slug permanent redirects need
schema support and were not invented.

Full robots responses, exact API crawl inventory, sitemap index/city examples,
timestamp availability and cache behavior are in
[seo-discovery-policy.md](seo-discovery-policy.md).

The legal public page also rendered at mobile 390×844 and desktop 1440×900.
This was a static-page smoke check, not verification of interactive API flows:
the API workflow remained deliberately stopped and its browser requests returned
502. Only the frontend workflow was restarted.

## Changed-file map and reasons

Paths grouped below are relative to the repository root.

- `artifacts/api-server/src/routes/marketplace.ts`: minimal inactive response,
  normalized city read predicate, genuine education update timestamps.
- `artifacts/api-server/src/lib/appointment-routes.test.ts`: four affirmative
  active-profile type guards required by the new response union; existing
  assertions and booking behavior unchanged.
- `artifacts/beauty-marketplace/seo-server.mjs`: entity outcome handling,
  query-independent missing status, existing not-found UI, private-route
  preservation, inactive SSR and discovery integration.
- `artifacts/beauty-marketplace/seo-policy.mjs`, `seo-policy.d.mts`,
  `seo-policy.test.mjs`: shared city and listing canonical normalization,
  declarations and regressions.
- `artifacts/beauty-marketplace/seo-server.test.mjs` and
  `scripts/src/seo-standards.test.ts`: fixture-only HTTP/content/status,
  canonical, public/private and sitemap regression coverage.
- `artifacts/beauty-marketplace/seo-discovery.mjs` and
  `seo-discovery.test.mjs`: robots policy, live-data sitemap index/children,
  pagination, cache isolation, timestamps, escaping and policy tests.
- `artifacts/beauty-marketplace/inactive-salon-city.mjs` and
  `inactive-salon-city.test.mjs`: server-only read-only city projection and
  refusal/injection/privacy tests.
- `artifacts/beauty-marketplace/src/components/client-seo-metadata.tsx` and
  `src/pages/salon-profile.tsx`: inactive noindex rendering and SSR/client
  canonical parity.
- `artifacts/beauty-marketplace/src/pages/owner/profile.tsx`,
  `src/lib/owner-widget-url.ts`, `src/lib/owner-widget-url.test.ts`: prefixed
  widget preview/embed URL construction and non-root regressions.
- `lib/api-spec/openapi.yaml`: inactive response union and education timestamp
  contracts. Regenerated counterparts: `lib/api-client-react/src/generated/`
  `api.schemas.ts`, `api.ts`; `lib/api-zod/src/generated/api.ts`; and its
  `types/course.ts`, `educationCenterPublic.ts`,
  `educationInstructorPublicProfile.ts`, `educationTaxonomyItem.ts`,
  `getSalon200.ts`, `index.ts`.
- `scripts/src/inactive-salon-contract.test.ts`: minimal DTO and route projection
  contract regression.
- `scripts/browser/cover-image-description-isolation.spec.ts`: current shared
  alt-helper expectations only.
- Root `package.json`, `artifacts/beauty-marketplace/package.json`,
  `pnpm-lock.yaml`: test commands/release wiring and server-only PostgreSQL
  dependency.
- `scripts/src/release-chain.test.ts`, `scripts/ci-build-timings.json`: release
  inclusion assertions and explicitly provisional timing budgets.
- `.gitignore`: keep local cover evidence out of the commit.
- `docs/seo-discovery-policy.md`, this document: exact policy samples and honest
  verification results, including unresolved failures.
- `.agents/memory/appointment-contact-privacy.md`: preserve the reason the
  inactive public API must not acquire city/contact fields just for SSR.

## Implemented

- Owner-profile widget preview and iframe URLs now retain the application's
  `BASE_URL`, canonical public origin, selected color, and encoded salon slug.
- Two database-free tests cover root/nonroot mounts and both profile consumers.
- Cover-image browser assertions use the current shared `publicImageAlt` helper;
  the helper and booking/auth code were not changed.
- SEO release phase 5 includes the widget regression and cover suite. The root
  cover alias invokes the existing isolated browser harness, like other browser
  release aliases. Its existing database safety guards remain unchanged.
- The existing frontend SEO command includes `seo-discovery.test.mjs` and
  `inactive-salon-city.test.mjs`; the root SEO command also runs the database-free
  `scripts/src/inactive-salon-contract.test.ts`.
- Browser phase-5/total warning baselines are provisionally increased by 155
  seconds to 290/935 seconds (150 for cover/widget and 5 for the new SEO unit
  regressions), not presented as successful-run calibration.

## Executed evidence

- Widget unit regression: **2 passed, 0 failed**.
- Focused widget/cover and existing SEO release contracts: **2 passed, 0 failed**.
- Final focused contracts after inactive-city and inactive-response wiring:
  **3 passed, 0 failed**. The full suite was not repeated for its unchanged,
  unrelated first-publication pattern mismatch.
- Full database-free release contract after discovery wiring: **28 passed,
  1 failed** (29 tests). The unrelated job first-publication runner assertion
  expects shorthand `expectedTargetIdentity`, while the runner passes
  `expectedTargetIdentity: identity`. This is a source-pattern mismatch; that
  database runner was not executed or changed.
- Desktop cover suite: **4 executed; 1 passed, 3 failed**, 1.9 minutes reported by
  Playwright. The salon save/reload/clear/social-alt journey passed.
- Mobile was not rerun; there is no new responsive verification claim.
- The browser command stripped inherited database URLs and ran through the owned
  disposable runner. No indexability override was supplied. No deployment or CI
  checks were executed.

Local logs, screenshots, error contexts, and traces remain in
`reports/seo-cover/`, excluded from Git. They are not deliverable binaries.

## Remaining failures, classified from this run

All three failures precede the changed social-alt assertions:

1. **Product:** the initial save never produced the expected PATCH. The fixture
   enables retail without a public description; the product form rejects a
   public product without that description. This is a concrete fixture/form
   incompatibility candidate, not a demonstrated baseline comparison.
2. **Education:** the initial save never produced the expected PATCH. The
   captured form explicitly reports “Broj dana pristupa je obavezan za online
   edukacije.” The fixture creates an online course without access days.
3. **Beauty Jobs:** the initial PATCH returned HTTP 400 with `VALIDATION_ERROR`.
   Its captured body includes `photos: ["/test.jpg"]`; the update route requires
   managed photo URLs through `validPhotos`. This is outside the alt expectation
   change.

No parent-branch/browser-baseline run was performed. These results therefore do
not establish that the failures predate this branch. They identify earlier,
non-SEO save/validation blockers; unrelated product, education, and job behavior
was intentionally left unchanged.

## Local invocation versus CI wiring

Local verification explicitly used this outer owned-cluster wrapper:

```sh
env -u DATABASE_URL -u LUMERA_DISPOSABLE_DATABASE -u LUMERA_TEST_DATABASE_URL \
  pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- \
  pnpm --filter @workspace/scripts run test:cover-image-description-browser
```

Keep that wrapper for local destructive/browser runs. Do not run the root alias
against an ambient development or production database. The CI alias instead
uses the existing guarded isolated suite against its recognized
`lumera_ci_browser` PostgreSQL 16 service source, without requiring host
`initdb`/`pg_ctl`. No workflow was modified or executed.