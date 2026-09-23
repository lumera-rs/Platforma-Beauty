# SEO content completion — part 2

## Scope and evidence

Server/shared and frontend implementation on `daily/2026-09-22`; no deployment, production
connection, database write, schema, migration, baseline, booking or authentication
change is part of this work. The parent agent verifies branch ancestry, protected
manifest/provenance and the complete delivery census separately.

The parent supplied a read-only development SQL distinct-value census over all
six schema city columns: salon city/company city, course city,
education-center city, beauty-job city and order billing city:
Beograd, Kragujevac, Niš, Novi Sad, Pančevo, Subotica and Čačak. All seven have
explicit locatives in `seo-text.mjs`; unmapped development cities: **0**.
Unknown future cities retain neutral wording, never an algorithmically guessed
declension. Production was not checked.

The repeated sentence “Mesto za mirnu, stručnu negu i rituale koji vraćaju
energiju.” is **seed data**, not the SEO renderer's template fallback.
`artifacts/api-server/src/lib/seed.ts` assigns it to `shortDescription` in the
salon seed loop (line 617 at inspection). The same seed loop assigns a different,
name-specific long `description`. The parent's development count of zero matches
among ten long descriptions therefore does not establish its absence from short
descriptions. No replacement copy or seed edits were made; current development
short-description counts and production data were not checked by this worker.

## Server/shared files

- `artifacts/beauty-marketplace/seo-text.mjs` and `.d.mts`: explicit city
  locatives; contextual image descriptions preserving authored detail; service
  category projection; existing category/query links.
- `artifacts/beauty-marketplace/structured-data.mjs` and `.d.mts`: one
  browser-safe entity schema builder, finite nonnegative numeric price gate,
  date gate, shared recent-five review ordering, breadcrumb helper.
- `artifacts/beauty-marketplace/seo-server.mjs`: public service durations,
  reviews/dates, stored card-payment/home-service flags, course public content,
  job date and other public fields, related links, footer, pagination and
  deterministic current-page JSON-LD marker.
- `artifacts/beauty-marketplace/seo-policy.mjs` and `.d.mts`: shared page parsing and
  pagination canonical normalization. Existing staging noindex remains intact;
  filter-only URLs retain the existing base canonical.
- `artifacts/beauty-marketplace/seo-server.test.mjs`: staging SSR regression
  expectations, price/date/schema gates, eight actual fixture related links,
  pagination, duration and card-payment content.
- `scripts/src/seo-standards.test.ts`: locatives, numeric Offer/currency
  invariants, required JobPosting fields, image alts, related and pagination
  anchors, and reproducible initial-HTML fixture evidence.
- `docs/seo-content-part2.md`: implementation, evidence and final verification report.

## Frontend, tests and CI file census

The following completes the changed/new-file census from the current working
tree. Paths in the first groups are relative to
`artifacts/beauty-marketplace/`; new declarations are included above.

- `src/components/client-seo-metadata.tsx`: shared current-page schemas,
  pagination canonicals, query-cache reuse and request ownership; cleanup on
  private/missing routes, generated API 404 errors, aborted and stale responses,
  and lazy observer transitions.
- `src/components/client-seo-metadata.test.ts`: 18 client regressions for metadata,
  schemas, contextual images, navigation cleanup, cache and request ownership.
- `src/components/footer.tsx`: existing public city/category destinations.
- `src/components/home-salon-card.tsx`, `src/components/salon-gallery.tsx`:
  contextual public image alts preserving authored descriptions.
- `src/pages/salon-profile.tsx`: locatives, shared latest-five reviews and
  structured-data-aligned public content and links.
- `src/pages/beauty-jobs-detail.tsx`, `src/pages/beauty-jobs.tsx`: contextual
  job images and public detail/list SEO integration.
- `src/pages/education-marketplace.tsx`, `src/pages/home.tsx`,
  `src/pages/marketplace-guides.tsx`, `src/pages/public-products.tsx`,
  `src/pages/salons.tsx`: shared page/list schema integration and contextual
  public images as applicable to each route.
- New `scripts/browser/client-seo-navigation.spec.ts`: actual Chromium SPA
  navigation, schema lifecycle, public images, pagination and request-count regression.
- New `scripts/playwright.seo.config.ts`: isolated, non-indexable public-fixture
  browser configuration without database credentials or guard overrides.
- `package.json`, `scripts/package.json`: root browser command and additive
  final release-phase registration.
- `scripts/src/release-chain.test.ts`: registration/non-indexable/no-database
  configuration and timing-budget contract checks.
- `scripts/ci-build-timings.json`: provisional 30-second browser budget allowance.

The current tracked diff and untracked-file census contains no API-server,
database schema, migration, baseline, authentication or booking file changes.
Existing release commands mentioning those checks were retained, not edits to
their implementation. This documentation update changes only this report;
protected manifest/provenance verification and hash updates remain separately
owned by the parent.

## Public data and links

No API serializer change was necessary. Salon public data exposes
`acceptsCards`, `homeService`, `services[].durationMinutes`,
`services[].category`, reviews with public `authorName` and `date`, and the
existing PR37 address. There is no stored generic amenities/payment-options
array in the inspected salon schema; no amenities, cash acceptance, telephone
permission or coordinates were invented. Service categories come from services,
not an imaginary `salon.categories` field.
Authored managed-gallery descriptions use the existing anonymous
`POST /api/media/descriptions` **read-only lookup** without forwarding cookies;
this endpoint was inspected and only selects data. It is not an upload or
description update. Lookup failures fail the SSR response closed rather than
silently replacing a stored semantic description.

City links use the existing `/saloni?city=…` filter. There is no new city-slug
route. All service categories link to their existing dedicated catalog page
when present; other stored categories use the existing `/saloni?category=…`
filter. Dedicated category pages exist for Frizerski saloni, Nokti, Masaža and
Lice. No unsupported dedicated category/city route was invented. Thus no known
city/category link needs to be omitted: dedicated-slug gaps use real filter
URLs instead.

Related salons are fetched from the public city-filtered active listing,
exclude the current slug, are checked for the same city, and cap at eight.
If fewer than six public neighbors exist, only real neighbors are shown; the
renderer never pads the section with invented salons. Pagination uses six
salons, 24 courses and ten job listings, retains filters, and renders previous/
next anchors based on available pages. Page-query URLs are self-canonical.
Next-page existence uses `totalPages`/`pageCount` or `total`/`totalCount` when
the public DTO has them. Array-only DTOs receive at most one same-page-size
lookahead request, preserving every filter and offset semantics. A completely
full final page therefore never fabricates a next link. This is covered for
salons, salon categories, education lists/taxonomy, jobs and supplier catalogs.

Course initial HTML includes its public descriptive details, learning outcomes,
FAQ, public modules, daily program, included items, requirements, instructor
summary, public review ratings/comments, city, language, theory/practical hours,
refund policy, stored payment terms and gallery. No private lesson content,
paid-access address or purchaser identity is included. Job `createdAt` is the
existing public DTO timestamp also used by the listing's public posted-date
filters; there is no separate stored publication timestamp in the inspected
public serializer. It is displayed and used consistently, rather than
substituting a build/current/moderation date.

## Structured-data policy

The shared API is
`buildPageStructuredData(type, data, { origin, canonical, description, breadcrumbs })`.
Entity types: `salon`, `course`, `job`, `product`, `bundle`, `center`,
`instructor`. Optional breadcrumbs are `{ name, pathname }[]`; the helper adds
the home crumb only when absent. `publicReviews(salon)` sorts descending by
valid public date and caps five; both rendering layers must use it.
Public non-entity types are shared as well: `home` takes `{ description }` and
returns Organization/WebSite; `list` takes `{ name, items: [{ name, pathname? }] }`
and returns ItemList, optionally with breadcrumbs; `static` takes `{ name }`
and returns the canonical page's breadcrumb graph. Server homepage, public
lists, supplier/taxonomy lists and static breadcrumb fallback use these helpers.

- Salon: HealthAndBeautyBusiness only with a public street/locality address;
  priced Service Offers, opening hours, finite public aggregate rating and valid
  public reviews. Telephone/geo remain absent. No Offer for an invalid or absent
  price; zero is valid.
- Course: Course only with name, description and provider; displayed real image
  only. Centers use EducationalOrganization; instructors use Person.
- Offering job: JobPosting only with valid public date, title, description,
  hiring organization and public job locality/country. Missing required input
  omits the entity, not just the property. Non-employment advertisements use
  WebPage rather than JobPosting.
- Retail product: Product only with actual displayed image, name and a valid
  priced Offer. Numeric strings, empty values, negatives and nonfinite prices
  are rejected. Currency never appears without price.
- Education bundle: Product deliberately omitted because its existing public
  page displays no bundle image; its ordinary content and BreadcrumbList remain.
- Existing public lists retain ItemList; homepage retains Organization/WebSite.
  Public pages retain breadcrumb markup. Private/missing responses have no
  entity JSON-LD.

SSR emits one `data-lumera-structured-data="current-page"` script. Frontend
navigation owns replacing/removing it on every transition, including private,
missing/error routes and stale asynchronous responses, and consumes these
shared builders rather than maintaining another entity-schema implementation.

## Checks and initial-HTML artifacts

The targeted server run:
`node --test artifacts/beauty-marketplace/seo-server.test.mjs`
passed **42/42** after the audit batch, including the isolated direct-entry
listener test. No application workflow was started or restarted.
New named cases are “part 2 shared schema gates reject invalid Google inputs
without inventing data” and “part 2 initial HTML contains real pagination,
same-city related anchors, and public duration”.
The managed-gallery regression additionally verifies anonymous read-only lookup
and preservation of authored image details.

The parent's final combined source run in `/tmp/seo-part2-final-tests.log`
passed:

| Command/check | Final result |
| --- | --- |
| Marketplace `test:seo` | Build lifecycle check 1/1, full SSR/policy 42/42 (including direct entry), client metadata 18/18 |
| Root `pnpm test:seo-standards` | Public address 5/5, address input 4/4, 32 public React routes and 16 schema contracts |
| Scripts `test:release-chain` | 25/25 |
| Root `pnpm build:release` | Release typecheck and recursive builds passed |
| Root `pnpm test:client-seo-browser` | 1 real Chromium test passed; 6.6 seconds total (test body 4.8 seconds) |

The final browser evidence is `/tmp/seo-part2-browser.log`. It exercises salon
A → salon B → course, list page-2 pagination, Back/Forward, homepage,
private and 404 routes, and delayed/aborted-response cleanup. It verifies
exactly one request per entity, not merely that navigation eventually succeeds.
Client unit coverage also checks generated `ApiError` 404 cache handling and
lazy observer ownership.

The existing SEO standards script remains in the `seo-standards`
release/publish phase via `test:seo-standards`; SSR/client cases remain in
the marketplace's existing `test:seo`. The actual new root command is
`pnpm test:client-seo-browser`, forwarding to the scripts workspace's
`playwright test --config playwright.seo.config.ts`. It is added to
`validate:release:5-final`, not substituted for an existing check.
`browser:release:5-final` increases from 75 to 105 seconds and
`validate:ci:browser:total` from 750 to 780 seconds. This **+30-second allowance
is provisional, not a measured full-phase baseline**; the measured standalone
browser result above does not establish a combined CI phase duration.

With `SEO_FIXTURE_EVIDENCE_DIR=../recovery-backups/seo-part2`, the standards
script saves `salon.fixture.html`, `course.fixture.html` and `job.fixture.html`
under the ignored `recovery-backups/seo-part2/` directory. These are raw
`createSeoResponse` HTML from explicitly labeled **test public DTOs**, not a
claim of live or production content. No browser JavaScript is needed to see
their content. The run also retains the prior PR37 address fixtures.

The full standalone SEO standards script passed all assertions
(**32 public React routes, 16 schema contracts**) after the client test-origin
fix. Contextual image expectations verify the complete composed alt and
independently require preservation of authored detail. All generated public
image tags are checked for meaningful nonblank alts, with image-bearing
collection/detail fixtures explicitly required to render images so this cannot
pass through empty mocks. The final combined source and standalone real-browser
results are recorded above; these are not a claim that every unrelated
database-backed release phase or a remote CI run was executed.
No manifest/provenance hashes were amended by this worker.