# SEO discovery policy

Implementation: `artifacts/beauty-marketplace/seo-discovery.mjs`. All examples below use the **placeholder**, not a real production origin, `https://public.example`. The on example is produced by a pure formatter; generating or testing it does not enable indexing or change `SITE_INDEXABLE`. The server must retain its host/environment indexing gate and staging noindex policy.

## Exact robots off

The complete response is these two lines followed by a newline. There is no sitemap directive:

```text
User-agent: *
Disallow: /
```

## Exact robots on

Complete formatter output, including its final newline:

```text
User-agent: *
Allow: /
Disallow: /admin$
Disallow: /admin?
Disallow: /admin/
Disallow: /vlasnik$
Disallow: /vlasnik?
Disallow: /vlasnik/
Disallow: /zaposleni$
Disallow: /zaposleni?
Disallow: /zaposleni/
Disallow: /moj-nalog$
Disallow: /moj-nalog?
Disallow: /moj-nalog/
Disallow: /biznis$
Disallow: /biznis?
Disallow: /biznis/
Disallow: /student$
Disallow: /student?
Disallow: /student/
Disallow: /poslovi/nalog$
Disallow: /poslovi/nalog?
Disallow: /poslovi/nalog/
Disallow: /korpa$
Disallow: /korpa?
Disallow: /korpa/
Disallow: /porudzbina/pracenje$
Disallow: /porudzbina/pracenje?
Disallow: /porudzbina/pracenje/
Disallow: /widget$
Disallow: /widget?
Disallow: /widget/
Disallow: /prijava$
Disallow: /prijava?
Disallow: /prijava/
Disallow: /poslovna-prijava$
Disallow: /poslovna-prijava?
Disallow: /poslovna-prijava/
Disallow: /poslovna-registracija$
Disallow: /poslovna-registracija?
Disallow: /poslovna-registracija/
Disallow: /postavi-lozinku$
Disallow: /postavi-lozinku?
Disallow: /postavi-lozinku/
Disallow: /pridruzi-se-edukativni-centar$
Disallow: /pridruzi-se-edukativni-centar?
Disallow: /pridruzi-se-edukativni-centar/
Disallow: /moji-oglasi$
Disallow: /moji-oglasi?
Disallow: /moji-oglasi/
Disallow: /beauty-poslovi/novi$
Disallow: /beauty-poslovi/novi?
Disallow: /beauty-poslovi/novi/
Disallow: /beauty-poslovi/moji-oglasi$
Disallow: /beauty-poslovi/moji-oglasi?
Disallow: /beauty-poslovi/moji-oglasi/
Disallow: /beauty-poslovi/prijave$
Disallow: /beauty-poslovi/prijave?
Disallow: /beauty-poslovi/prijave/
Disallow: /edukacije/lista-zelja$
Disallow: /edukacije/lista-zelja?
Disallow: /edukacije/lista-zelja/
Disallow: /edukacije/vauceri$
Disallow: /edukacije/vauceri?
Disallow: /edukacije/vauceri/
Disallow: /edukacije/moji-paketi$
Disallow: /edukacije/moji-paketi?
Disallow: /edukacije/moji-paketi/
Disallow: /saloni?*search=
Disallow: /saloni?*q=
Disallow: /saloni/kategorija/*?*search=
Disallow: /saloni/kategorija/*?*q=
Disallow: /edukacije?*search=
Disallow: /edukacije?*q=
Disallow: /edukacije/sekcije/*?*search=
Disallow: /edukacije/sekcije/*?*q=
Disallow: /poslovi?*search=
Disallow: /poslovi?*q=
Disallow: /proizvodi?*search=
Disallow: /proizvodi?*q=
Disallow: /shop/*?*search=
Disallow: /shop/*?*q=
Disallow: /poslovi?*query=
Disallow: /api/auth$
Disallow: /api/auth?
Disallow: /api/auth/
Disallow: /api/admin$
Disallow: /api/admin?
Disallow: /api/admin/
Disallow: /api/internal$
Disallow: /api/internal?
Disallow: /api/internal/
Disallow: /api/customer$
Disallow: /api/customer?
Disallow: /api/customer/
Disallow: /api/salon$
Disallow: /api/salon?
Disallow: /api/salon/
Disallow: /api/employee$
Disallow: /api/employee?
Disallow: /api/employee/
Disallow: /api/business$
Disallow: /api/business?
Disallow: /api/business/
Disallow: /api/jobseeker$
Disallow: /api/jobseeker?
Disallow: /api/jobseeker/
Disallow: /api/appointments$
Disallow: /api/appointments?
Disallow: /api/appointments/
Disallow: /api/booking-commands$
Disallow: /api/booking-commands?
Disallow: /api/booking-commands/
Disallow: /api/booking-groups$
Disallow: /api/booking-groups?
Disallow: /api/booking-groups/
Disallow: /api/orders$
Disallow: /api/orders?
Disallow: /api/orders/
Disallow: /api/shop/quotes$
Disallow: /api/shop/quotes?
Disallow: /api/shop/quotes/
Disallow: /api/growth$
Disallow: /api/growth?
Disallow: /api/growth/
Disallow: /api/retail/cart$
Disallow: /api/retail/cart?
Disallow: /api/retail/cart/
Disallow: /api/retail/cart-summary$
Disallow: /api/retail/cart-summary?
Disallow: /api/retail/cart-summary/
Disallow: /api/retail/checkout-preview$
Disallow: /api/retail/checkout-preview?
Disallow: /api/retail/checkout-preview/
Disallow: /api/retail/orders$
Disallow: /api/retail/orders?
Disallow: /api/retail/orders/
Disallow: /api/retail/wishlist$
Disallow: /api/retail/wishlist?
Disallow: /api/retail/wishlist/
Disallow: /api/referrals/dashboard$
Disallow: /api/referrals/dashboard?
Disallow: /api/referrals/dashboard/
Disallow: /api/loyalty/status$
Disallow: /api/loyalty/status?
Disallow: /api/loyalty/status/
Disallow: /api/featured-placements/mine$
Disallow: /api/featured-placements/mine?
Disallow: /api/featured-placements/mine/
Disallow: /api/education/courses$
Disallow: /api/education/courses?
Disallow: /api/education/courses/
Disallow: /api/education/centers$
Disallow: /api/education/centers?
Disallow: /api/education/centers/
Disallow: /api/education/center$
Disallow: /api/education/center?
Disallow: /api/education/center/
Disallow: /api/education/enrollments$
Disallow: /api/education/enrollments?
Disallow: /api/education/enrollments/
Disallow: /api/education/notifications$
Disallow: /api/education/notifications?
Disallow: /api/education/notifications/
Disallow: /api/education/placements/mine$
Disallow: /api/education/placements/mine?
Disallow: /api/education/placements/mine/
Disallow: /api/education/wishlist$
Disallow: /api/education/wishlist?
Disallow: /api/education/wishlist/
Disallow: /api/education/gift-vouchers$
Disallow: /api/education/gift-vouchers?
Disallow: /api/education/gift-vouchers/
Disallow: /api/education/purchases$
Disallow: /api/education/purchases?
Disallow: /api/education/purchases/
Disallow: /api/education/disputes$
Disallow: /api/education/disputes?
Disallow: /api/education/disputes/
Disallow: /api/education/subscription/status$
Disallow: /api/education/subscription/status?
Disallow: /api/education/subscription/status/
Disallow: /api/education/operations$
Disallow: /api/education/operations?
Disallow: /api/education/operations/
Disallow: /api/education/b2b$
Disallow: /api/education/b2b?
Disallow: /api/education/b2b/
Disallow: /api/education/bundle-purchases$
Disallow: /api/education/bundle-purchases?
Disallow: /api/education/bundle-purchases/
Disallow: /api/education/payment-slips$
Disallow: /api/education/payment-slips?
Disallow: /api/education/payment-slips/
Disallow: /api/beauty-jobs/mine$
Disallow: /api/beauty-jobs/mine?
Disallow: /api/beauty-jobs/mine/
Disallow: /api/beauty-jobs/saved$
Disallow: /api/beauty-jobs/saved?
Disallow: /api/beauty-jobs/saved/
Disallow: /api/beauty-jobs/inbox$
Disallow: /api/beauty-jobs/inbox?
Disallow: /api/beauty-jobs/inbox/
Disallow: /api/beauty-jobs/notifications$
Disallow: /api/beauty-jobs/notifications?
Disallow: /api/beauty-jobs/notifications/
Disallow: /api/beauty-jobs/rental-requests$
Disallow: /api/beauty-jobs/rental-requests?
Disallow: /api/beauty-jobs/rental-requests/
Disallow: /api/education/instructors$
Disallow: /api/education/instructors?
Disallow: /api/education/instructors/
Disallow: /api/beauty-jobs/*/applicants
Disallow: /api/beauty-jobs/*/messages
Disallow: /api/education/bundles/*/purchases
Allow: /assets/
Allow: /api/salons
Allow: /api/suppliers
Allow: /api/beauty-jobs
Allow: /api/education/public/
Allow: /api/education/bundles
Allow: /api/education/subscription/plans
Allow: /api/education/instructors/*/public
Allow: /api/media/
Allow: /api/education/courses/*/availability
Allow: /api/growth/packages/public
Allow: /api/inspiracija
Allow: /api/recnik
Allow: /api/brendovi
Allow: /api/cities
Allow: /api/category-images
Allow: /api/discovery/
Allow: /api/b2c/
Sitemap: https://public.example/sitemap.xml
```

## Inventory rationale and matching boundaries

The full exact path inventory is above; `robotsInventory` also exports the paths and reasons for programmatic audits. Private roots emit three rules: exact root (`$`), root with query (`?`), and descendants (`/`). Thus `/api/salon` does not accidentally match public `/api/salons`. Public documents and rendering resources are allowed by default. No global `/api`, asset, image, public-detail-family or query-string block is used.

| Inventory group | Why |
| --- | --- |
| UI admin, owner, employee, customer, business, student, jobs account | Account/workspace operations rather than public documents |
| UI checkout, tracking, widget, authentication, registration, password setup, saved education and legacy account actions | Private/user-specific workflows |
| UI listing `search`/`q`, plus jobs `query` | Internal-search URLs only under actual listing route families; there is no dedicated search route in the inspected App router |
| API auth/admin/internal | Authentication, administration and internal operations |
| API customer/salon/employee/business/jobseeker | Role-scoped account data; singular salon is deliberately distinct from public salons |
| API appointments/booking-commands/booking-groups/orders/shop quotes | User-specific transactions and operational state |
| API growth | Business retention, automation, packages and performance; public package listing is a longer Allow exception |
| API retail cart/cart-summary/checkout-preview/orders/wishlist | Cart, purchase and saved-item state; public retail product reviews remain allowed by default |
| API referrals dashboard, loyalty status, featured placements mine | User-specific referral, loyalty and promotion data; public sibling lookups remain allowed |
| API education courses/centers/center/instructors | Management endpoints, NOT public course/center URLs; public instructor profiles and course availability have longer explicit Allows |
| API education enrollments/notifications/placements mine/wishlist/gift vouchers/purchases/disputes/subscription status/operations/B2B/bundle purchases/payment slips | Learner, staff, commercial and account operations |
| API beauty jobs mine/saved/inbox/notifications/rental requests and listing applicants/messages | Private listing management and communications; public listing collection/detail stays allowed |
| API bundle purchases beneath a public bundle | Private purchase action under the public bundle namespace |
| Explicit public Allows | Anonymous discovery, details, media and rendering resources; never a guarantee that a particular entity is available |

Inspected route sources: `artifacts/beauty-marketplace/src/App.tsx`, public listing pages, and API `marketplace.ts`, `beauty-jobs.ts`, `education-operations.ts`, `education-center-operations.ts`, `education-bundle-purchases.ts`, `education-subscription-billing.ts`, `education-b2b-discounts.ts`, `growth.ts`, `phase3.ts`, `commerce-ef.ts`, and `referrals.ts`. Robots cannot distinguish methods: public GET paths shared with POST remain crawlable. Authentication/authorization still protects mutations; no authorization change is involved. Longer private job/bundle subpaths override broad public Allows. Longer public instructor/availability/package exceptions override private management prefixes.

The listing-only search rules leave `/assets/main.js?search=x`, `/assets/image.webp?q=large`, `/hero-bg.jpg?search=x&q=y`, `/api/media/image?search=x`, `/api/salons?search=x`, and `/api/education/public/courses?q=x` crawlable. They block UI searches such as `/edukacije?q=hair`, `/shop/beauty?search=cream`, and `/poslovi?query=hair`.

## Sitemap samples (mock fixtures, not live data)

These samples use the mocked data in `seo-discovery.test.mjs`, with only the origin replaced by the documentation placeholder. Formatting whitespace is added for readability.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://public.example/sitemaps/salons.xml</loc></sitemap>
  <sitemap><loc>https://public.example/sitemaps/cities.xml</loc></sitemap>
  <sitemap><loc>https://public.example/sitemaps/education.xml</loc></sitemap>
  <sitemap><loc>https://public.example/sitemaps/jobs.xml</loc></sitemap>
  <sitemap><loc>https://public.example/sitemaps/products.xml</loc></sitemap>
  <sitemap><loc>https://public.example/sitemaps/content.xml</loc></sitemap>
</sitemapindex>
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://public.example/saloni?city=A%26b</loc></url>
  <url><loc>https://public.example/saloni?city=Novi+Sad</loc></url>
</urlset>
```

City eligibility comes only from anonymous active public salon results, never a static city list. Shared `normalizeCity` and `listingCanonical` determine NFC, case, whitespace normalization and exact city-only URLs. Case/spacing/composed Unicode duplicates collapse; no category/page/filter URL is generated. URL parameter encoding happens before XML escaping; an actual URL `&` separator is serialized as `&amp;`.

## Data, timestamps and failure policy

- Discovery reads existing anonymous API endpoints backed by entity tables, never its own HTML pages. The module has no database connection or database import. Strict injected `fetchJson(path, apiOrigin)` must reject non-success responses and carry numeric `status` for 404/410.
- Listings use the same public API eligibility authority as SSR. Supplier entries additionally require active B2C/BOTH scope. Related center/instructor IDs require successful public detail responses with matching ID, nonblank name and a courses array. Explicit 404/410 omissions are reported; malformed data and operational failures reject generation.
- Only actual valid entity `updatedAt`/`modifiedAt` values become `lastmod`. Neither current time nor creation/publication time is a modification fallback. Missing values are surfaced by pathname in `diagnostics.missingLastmod`.
- **Actual schema absence:** `salonsTable` in `lib/db/src/schema/core.ts` has createdAt but no updatedAt; `productsTable` in `lib/db/src/schema/commerce.ts` has createdAt but no updatedAt; `productCategoriesTable` in that file has neither createdAt nor updatedAt. Their sitemap modification values are legitimately omitted. No new schema fields or migration were introduced.
- Courses, education centers/instructors, sections, course categories and subcategories **do have updatedAt columns**. Their existing values are now exposed in `educationCourseView`, `centerPublicView`, the instructor public response and taxonomy projections; the corresponding API contracts were updated. Suppliers/jobs already expose modification timestamps; bundles expose table fields. Discovery consumes those timestamps without a separate database read. A future missing public projection is a DTO/serializer gap, not schema absence.
- Static/aggregate city pages have no fabricated aggregate modification time. A child entity creation or update is not automatically proof of the whole collection's last modification.
- No tombstone/deletedAt field was found in the inspected relevant schemas; products also have a hard-delete route. Absence from a public list does not prove permanent deletion. Discovery does not invent 410s or deleted dates.

## Bounds, cache and integration

Each child holds at most **50,000 URLs**; overflow becomes `salons-2.xml`, `salons-3.xml`, etc., with every part included in the index. The index itself rejects more than 50,000 child maps. Pagination has no former 100-page truncation cap; malformed envelopes, repeated IDs, ignored page size and incomplete declared totals are explicit failures.

Default cache TTL is **5 minutes (300,000 ms)**, measured from successful generation. Cache keys include both configured public origin and API origin; concurrent generation is coalesced. Expired inventories regenerate atomically, and errors are not cached or replaced with silent empty/static-only/stale results. Removed URLs may remain until TTL expiry; `clear()` supports explicit invalidation. All emitted loc URLs use the configured HTTPS public origin.

Instantiate `createSitemapDiscovery` once per server, pass strict anonymous API reads, and route the index/child paths through `get({origin, apiOrigin, pathname})`. Results are `{xml, diagnostics}`, with `null` for an unknown child; surface upstream errors as explicit service-unavailable responses. Keep staging noindex/off gating in the server. This module does not enable indexing or decide whether a missing entity warrants a lifecycle 404 versus 410.