# Public SEO contract

`App.tsx`, `seo-server.mjs`, and the sitemap are one route contract. Add an
indexable route to all applicable columns in the same change. Authenticated,
transactional, redirect, and query-only URLs are `noindex` and never belong in
the sitemap.

| React route family | Server rendering and metadata | JSON-LD | Sitemap |
| --- | --- | --- | --- |
| `/`, `/za-biznise/**`, legal pages | Unique title, description, canonical, crawlable HTML | `Organization` and `WebSite`/`SearchAction` on home | Static URL plus authentic `lastmod` |
| `/saloni`, `/saloni/kategorija/:categorySlug` | Public salon/category listing | `ItemList` | Static/category URL plus `lastmod` |
| `/saloni/:slug` | Public salon detail | `BeautySalon` | Active salon URL plus source `lastmod` |
| `/proizvodi`, `/shop/:supplierSlug`, `/shop/:supplierSlug/*` | Public supplier/category listing | `ItemList` and breadcrumbs | Active public URL plus source `lastmod` |
| `/shop/:supplierSlug/proizvod/:productId` | Public product detail | `Product`, `Offer`, breadcrumbs | Active public product URL plus source `lastmod` |
| `/poslovi`, `/poslovi/:slug/:listingId` | Public job listing/detail | `ItemList`; `JobPosting` or `Offer` | Active canonical URL plus source `lastmod` |
| `/edukacije`, `/edukacije/sekcije/**` | Public course/taxonomy listing | `ItemList` and breadcrumbs | Public URL plus source `lastmod` |
| `/edukacije/:courseId`, `/edukacije/paketi/:bundleId`, `/edukacije/centri/:centerId`, `/edukacije/instruktori/:instructorId` | Public entity detail | `Course`, `Product`, `EducationalOrganization`, or `Person` | Public URL plus source `lastmod` when available |
| `/inspiracija`, `/recnik`, `/brendovi` | Public guide listing | `ItemList` | Static URL plus authentic `lastmod` |

All indexable responses must include useful HTML before React mounts. Canonical
and schema origins come only from the validated public origin. Keep browser
zoom enabled, load fonts locally, and run `pnpm run test:seo-standards` whenever
routes, metadata, schema, sitemap generation, the document head, or fonts change.