# Public salon address — Stage A

## Scope and inventory

Base: `c760ce098a632263d51160841b7defee85241d6b` (PR 36 merged), branch
`feature/public-salon-address`. Stage B has not begun. No schema, migration,
coordinate data, authentication, middleware, production connection or startup
changes are authorized by this work.

The `salons` table (`lib/db/src/schema/core.ts`) stores `address` (street and
number in a single required text field), nullable `postalCode`, required `city`
and `municipality`. Separate company address fields are billing data, not the
salon's public location. There are **no** entrance directions, intercom, floor
or apartment fields. There is **no** hide-address setting, public-phone flag or
independent published flag. `active` is the existing marketplace publication
eligibility boundary; `isVerified` is an additional widget eligibility
requirement, not a marketplace requirement. Do not invent either permission.
Phone remains private, even if present in an over-broad DTO.

Owner address entry currently happens during business registration
(`src/pages/business-auth.tsx`, address minimum 3 characters, postal code
minimum 4) and additional-location creation (`components/owner-location-wizard.tsx`,
`POST /salon/locations`; address max 250, postal code max 30).
`src/pages/owner/profile.tsx` edits profile/media, not these address fields.
The admin salon detail displays address/contact. There is no dedicated
owner address-edit form in the current profile settings.

The marketplace detail route `GET /salons/:slug` already requires `active=true`.
Its `GetSalonResponse` serializer previously omitted address and postal code
for **all** callers, not merely anonymous callers. The client location section
was a city-only placeholder promising exact details after booking. The
authenticated appointment contact endpoint separately supplies exact contact
and coordinates; that permission and response are unchanged. The booking
widget already exposes street for active, verified salons and is unchanged.
List cards intentionally stay city-level; this change is the detail view only.

## Maps and coordinates

The only map implementation found was the unused `SimpleMap` component in
`src/components/simple-map.tsx`. It had no remaining importers/pages and loaded
OpenStreetMap raster images from `a.tile.openstreetmap.org`. It used no API key,
external script or external stylesheet; normal tile requests exposed network
metadata, and this work makes no claim about the tile provider's cookie policy.
The dormant component is removed. No referenced map-key/configuration names
were found; no secrets or configuration values were read or removed.
Unrelated education video and booking widget iframes remain.

Salon coordinates support nearest-salon sorting (the Haversine query in
`marketplace.ts`, visitor geolocation in `pages/salons.tsx`) and authenticated
appointment contact. Existing data, queries and non-map behavior are untouched.
No coordinates are added to the public profile schema.

## Public rendering and contract

The OpenAPI SalonProfile adds optional existing `address` and `postalCode`;
optional properties retain compatibility with the authenticated additional
location creation response that shares this schema. The eligible marketplace
detail serializer supplies both. Orval regenerated the React and Zod outputs.
No owner input schema changed.

`public-salon-address.mjs` is shared by React, SSR and JSON-LD. It preserves
entered street/locality text, omits empty separators, and constructs a plain
Google Maps search link with `api=1`. React renders text nodes; SSR escapes
text and href; the existing JSON-LD safe serializer remains in force.
Structured data includes only street, postal code, city and country `RS`, never
coordinates, phone, billing address or hypothetical entrance fields.
Defensive false active/published and true hideAddress DTO guards are tested;
these are not new database settings or authorization rules.

Example (illustrative test input, not a live salon):
`Tošin bunar 181, 11000 Beograd`

`https://www.google.com/maps/search/?api=1&query=To%C5%A1in%20bunar%20181%2C%2011000%20Beograd%2C%20Serbia`

The anchor uses `target="_blank" rel="noopener noreferrer"` in initial HTML and
React. Nothing from Google loads until navigation. Apartment-format evidence
is deferred to Stage B because those fields do not exist. Existing street text
cannot safely be parsed into invented apartment/street subfields.

## Tests and release integration

New `scripts/src/public-salon-address.test.ts`: formatting, Maps allowlist,
PostalAddress, defensive hidden/inactive/unpublished DTOs, phone/coordinate/
entrance-field exclusion, public route boundary and client text-link contract.
It runs through the existing `test:seo-standards` release-chain command and an
additive `public-salon-address` timed CI phase (5-second timing warning budget).
No jobs were changed or optimized.

The existing `seo-standards.test.ts` privacy guard is narrowed, not removed:
public street is positive, phone/geo remain negative; markup, hidden/inactive/
unpublished DTOs and staging `noindex, nofollow` remain covered.
No existing browser journey expecting a map was found by source search, so no
such journey was changed. The initial SEO fixture now explicitly supplies
street and postal code and asserts their public presence.

Verified locally without database access: codegen (including generated API
checks, clean marketplace typecheck and library typecheck), the four new
address tests (including generated runtime parsing and private-field stripping),
SEO standards (32 public routes / 16 schema contracts), release chain (24 tests),
API-server and scripts typechecks, and startup DDL removal gate (148 modules
scanned). Preview `/saloni` was visually checked without restarting any server;
this verifies basic application health, not the new API response on the
already-running process.

Parent review must complete protected-source hash census/cascade/provenance,
historical-tier identity verification and the Stage A commit before any Stage B
edits. No commit/push/deployment or database operation was performed here.