# Structured data, part 1

## Scope and identity override

Initial HTML includes JSON-LD, including when staging remains `noindex, nofollow`.
Organization uses the existing visible platform name and configured public URL.
**Organization.logo and favicon/icon work are pending the original approved brand
asset and final name.** No logo, favicon, OG asset or head icon link was created or
changed. The existing `/og-lumera.png` social fallback is unchanged and is not used
as a structured-data entity image.

All output is assembled from existing public DTOs, not private records.
`sameAs`, nulls, empty strings/collections and empty typed nodes are omitted.
Public deep pages receive visible breadcrumbs and matching BreadcrumbList; private
and missing pages do not acquire entity data. Closed salon days remain visible
as “Ne radi”, rather than fabricating midnight opening times.

Salon priceRange is the displayed min–max of the same (up to 24) service prices
shown in SSR, including promo prices and zero-priced services, in RSD. Ratings
use public response values with the existing UI's presentation precision, never
a recomputed aggregate. Salon averages match `salon-profile.tsx`'s `toFixed(1)`;
the fractional test input 4.876 is displayed/emitted as 4.9. Salon Review values
are repeated in visible SSR. Product aggregate ratings are omitted even when
public reviewSummary supplies an average: `public-products.tsx` displays only
coarsely rounded star icons and a count, not an exact numeric average. Neither
the hidden precision nor an invented perfect average derived from filled stars
is emitted. Product and Offer remain, with no SSR-only numeric rating section.
No rating is inferred from zero counts. Rental, freelance and seeking listings
are WebPage, not JobPosting. Only `job` + `offering` is JobPosting.

The generated `GetSalonResponse` public contract in
`lib/api-zod/src/generated/api.ts` defines `gallery` as `string[]` (not media
objects), each service `price` as a required number, and `promoPrice` as a
nullable/optional number. The serializer in `marketplace.ts` matches those shapes.
SSR service price visibility nevertheless uses the same `promoPrice ?? price`
selection as JSON-LD, including zero, rather than gating on base price alone.

## Inspected data and omissions

This is an inventory of useful schema.org properties, not a claim that every
property is required for rich-result eligibility. Sources inspected:
`lib/db/src/schema/core.ts`, `education.ts`, `beauty-jobs.ts`, `commerce.ts`,
`b2c-product-reviews.ts`; public serializers/routes in
`artifacts/api-server/src/routes/marketplace.ts` and `beauty-jobs.ts`; visible
salon page in `artifacts/beauty-marketplace/src/pages/salon-profile.tsx`.

| Page/entity | Not held as dedicated properties in the inspected entity tables | Held but omitted / visibility or semantics limit |
| --- | --- | --- |
| Home Organization / WebSite | No platform site-identity entity table supplying foundingDate, legalName, contactPoint or approved schema logo. Authored site name/URL are configuration/content, not inferred DB facts. | Logo intentionally pending user override. No external profile links. |
| Salon HealthAndBeautyBusiness | No salon public-phone permission flag; no authored priceRange column (derived from displayed services). | Street address, phone, latitude/longitude exist in salons but are absent from the public detail serializer and deliberately hidden until booking in the UI. No streetAddress, geo, telephone or invented public flag. Company postal code is not assumed to be the salon visitor address. Hours exist in salonHours; services/prices and reviews exist, are public, and are emitted. Generic HealthAndBeautyBusiness avoids inventing a category subtype. |
| Course | No dedicated courseCode identifier separate from internal ID or occupationalCredentialAwarded entity. | Language, requirements, learning outcomes, level, certificateName/accreditation, duration, instructor links, price, rating and session dates DO exist. This scope emits the visible title/description/image/provider; does not infer a CourseInstance schedule or credentials from booleans. Course review rows exist; no review author/count/rating is invented from the course rating column. |
| Instructor Person | No dedicated birthDate, honorificPrefix or jobTitle fields in educationInstructors. | Full name, biography, photo, specialization, qualifications, experience and user/center links exist. SSR emits visible name/bio/photo/URL, not private user contacts or a guessed employer/title. |
| Center EducationalOrganization | No dedicated foundingDate or structured openingHours/geo fields in educationCenters. | Contact address/email/phone, city, legal identifiers, website and Instagram are stored. This SSR page displays identity, description, image and course cards; those contacts/legal fields are not added to JSON-LD. External profile fields are never emitted. |
| Education bundle Product | No bundle GTIN/MPN or brand identity. | Name, description, price and included courses exist; only visible course names are emitted in hasPart, not invisible descriptions. No invented InStock assertion. |
| JobPosting | No employmentType, dedicated salary/pay-period contract, occupational category code, educationRequirements or applicantLocationRequirements in beautyJobListings. | createdAt/expiresAt and generic priceAmount/pricePeriod are stored. Dates are not in this SSR body, so omitted; generic price is NOT asserted as baseSalary. Location city/region and displayed advertiser identity are emitted when present. No invented country, salary unit, advertiser fallback or employer website. This minimal schema is not a promise of Google Jobs eligibility. |
| Shop Product / Offer | No dedicated GTIN or MPN in products. | SKU, stock, catalogReference, brand, prices, sale expiry and product review aggregates/rows exist. SKU/stock/internal prices are not in publicProductDto and never emitted. Public RSD prices are used; currency is not described as missing DB information. Missing/request-only price is omitted, not converted to zero or `"null"`. No unconditional InStock. ReviewSummary contains a real average, but the hydrated UI displays only star icons/count, not that numeric average; AggregateRating is therefore omitted. Separate review text is not fetched. |
| Supplier/category/taxonomy/listing/guide/legal pages | BreadcrumbList and ItemList need no additional DB properties. Legal and static pages are authored content rather than missing entity records. | Only displayed list names/URLs and visible breadcrumb labels are emitted. No fictitious items when collections are empty. |

## Validation and raw HTML evidence

The existing `scripts/src/seo-standards.test.ts` was extended, not replaced by a
parallel test. It retains its staging-indexability exercise, parses initial HTML
JSON-LD for home, salon, course, instructor, center, bundle, real job, shop product,
shop category, education taxonomy, salon category and static pages; recursively
checks prohibited/empty/placeholder values; and checks private/not-found and
non-job boundaries. Fixtures are mocked public DTOs, not database inserts.

Raw HTML can be regenerated without a server or database:

```sh
SEO_FIXTURE_EVIDENCE_DIR="$PWD/recovery-backups/seo-part1-fixtures" \
  pnpm --filter @workspace/scripts test:seo-standards
```

This produces explicitly labelled `home.fixture.html`, `salon.fixture.html` and
`course.fixture.html` in the ignored recovery directory. These are **not live
database evidence**. In particular, existing public course GET calls record a
view in `educationCourseMetricEventsTable`; a live course GET is not read-only.
Do not use it for evidence under the no-DB-writes constraint.

No API route, schema, migration, baseline, booking, authentication/authorization,
manifest/provenance, asset or admin implementation changes are part of this work.
Implementation and validation require no production connection or deployment.
Commit/push and release decisions belong to the parent delivery task.

Validation executed successfully:

- `pnpm --filter @workspace/scripts test:seo-standards` (32 public React routes,
  16 existing source contracts plus parsed JSON-LD fixture coverage).
- `node --test artifacts/beauty-marketplace/seo-server.test.mjs artifacts/beauty-marketplace/seo-policy.test.mjs`
  (39 passing tests; the existing entrypoint test starts only its isolated frontend server).
- `node --check` for `seo-server.mjs` and `structured-data.mjs`.
- `pnpm --filter @workspace/scripts exec tsc --noEmit`.
- `pnpm --filter @workspace/beauty-marketplace exec tsc -p tsconfig.json --noEmit`.
- `pnpm --filter @workspace/beauty-marketplace build` (success; existing large-chunk warning).

Protected-input audit: all 158 current-source entries match their file bytes.
No hash amendment or cascade was needed. Both entire manifests, including their
historical tiers, remain byte-identical to main at
`6b8c880c38e0b65123e4b8ebab4a401575db0324`; all 146 historical pins were also
verified against their recorded historical commit. Both documentation validators
passed (114 and 65 negative cases), together with 13 regression tests.