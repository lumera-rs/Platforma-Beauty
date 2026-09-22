# Public salon address — Stages A and B

## Scope and inventory

Base: `c760ce098a632263d51160841b7defee85241d6b` (PR 36 merged), branch
`feature/public-salon-address`. Stage A was committed as `c2ecfd2f` before
Stage B began. The inventory below records the pre-Stage-A state; Stage B
additions and verification are recorded separately below. Authentication,
middleware, coordinate behavior and production access remain unchanged.

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
was deferred in Stage A because those fields did not exist; Stage B evidence
is recorded below. Existing street text
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

The Stage A protected-source review/commit is owned by the parent delivery
agent. No production operation or deployment is authorized.

## Stage B — public entrance details

Four nullable text fields are added to the salon contract and ORM by Stage B:

| API field | Database column | Maximum characters |
| --- | --- | --- |
| `entranceDirections` | `entrance_directions` | 500 |
| `intercom` | `intercom` | 80 |
| `floor` | `floor` | 80 |
| `apartment` | `apartment` | 40 |

Existing owners can enter, edit or clear them in the existing public-profile
settings form; the additional-location creation wizard also includes them.
Labels are **Uputstvo za ulaz**, **Interfon**, **Sprat**, **Stan**. Placeholders:
`npr. ulaz sa bočne strane`, `npr. 22 enter`,
`npr. IV sprat ili prizemlje`, `npr. 22`.
All are explicitly optional. Floor is free text, with no Roman numeral or
other normalization.

The server trims before generated schema validation; empty/whitespace text
becomes `null`. Missing fields leave existing values unchanged, while explicit
null clears them. Length limits and rejection of angle-bracket markup apply
to both creation and editing. Non-string/non-null values are rejected.
The existing `requireSalonOwner` authorization path is reused unchanged.
React submits explicit nulls for cleared inputs, reloads from the returned
profile, and invalidates the public profile query after a successful update.

OpenAPI was regenerated, including public and managed response DTOs and the
create/update input contracts. The active-only public detail serializer now
includes the four fields. The shared formatter automatically updates both
React text nodes and initial server HTML. Maps uses only base street,
postal code/city and Serbia; JSON-LD uses only base PostalAddress with RS.
Phone, billing fields and coordinates remain excluded. No new hide-address,
publication or phone-public setting is invented.

### Anonymous raw HTML evidence

Generated by the existing `createSeoResponse` route through
`scripts/src/seo-standards.test.ts`, using **mocked public DTO test fixtures,
not live salon records**, without browser JavaScript execution or database
access. Output is ignored under `recovery-backups/public-salon-address/`:

- `apartment.fixture.html`
- `main-road.fixture.html`

Both initial responses retain staging `noindex, nofollow`. Apartment anchor:

> Tošin bunar 181, (ulaz sa bočne strane odmah pored dečijeg tobogana), interfon 22 enter, IV sprat, stan 22, 11000 Beograd

Main-road anchor:

> Tošin bunar 181, 11000 Beograd

Both use the same link:
`https://www.google.com/maps/search/?api=1&query=To%C5%A1in%20bunar%20181%2C%2011000%20Beograd%2C%20Serbia`

Both carry this address object within the existing salon JSON-LD:
`{"@type":"PostalAddress","streetAddress":"Tošin bunar 181","postalCode":"11000","addressLocality":"Beograd","addressCountry":"RS"}`.
Entrance/intercom/floor/apartment, telephone and geo do not enter it.
An additional malicious entrance fixture verifies escaped visible HTML.

Reproduce (fixture output only, not an environment guard override):
`SEO_FIXTURE_EVIDENCE_DIR="$PWD/recovery-backups/public-salon-address" pnpm run test:seo-standards`

### Stage B test integration and local results

- `public-salon-address.test.ts`: **5 passing tests**, including all 16 optional
  combinations, main-road/full apartment formatting, exact free-text floor,
  generated public DTO preservation, Maps/JSON-LD exclusion and private data.
  Existing `test:seo-standards` and `public-salon-address` CI phase, 5-second
  warning baseline, remain in place.
- New scripts command `test:salon-address-input`: **4 passing tests**, one per
  field, covering omitted/null/blank/trimmed/max/over-limit/markup/type cases
  and create-contract parity. Called additively by `test:seo-standards` and
  timed CI phase `salon-address-input`, baseline 5 seconds; release-chain
  expectations updated without workflow scheduling changes.
- SEO standards: **32 public routes / 16 schema contracts pass**, including
  initial anonymous apartment/main-road HTML and malicious entrance escaping.
- Existing `pnpm run test:seo`: **all pass** (1 catalog test, 35 SEO policy
  tests and 10 client metadata tests). Staging noindex assertions remain.
- Release-chain: **24 passing tests**.
- Codegen, generated frontend/library typechecks, `build:release`
  (including API and frontend release typechecks), scripts typecheck: **pass**.
  The build emits its existing large-chunk advisory, not a build failure.
- Startup DDL removal gate: **pass, 149 modules scanned**; no runtime DDL added.

The existing `appointment-routes.test.ts` HTTP integration journey now covers
non-manager rejection, owner save/trim, owner reload, anonymous DTO visibility,
each field's invalid inputs, omitted-value preservation, free-text floor,
and clear-to-null propagation to reload and anonymous responses.
The earlier HTTP assertion that street address was private was explicitly
narrowed to preserve its phone/email/coordinate negatives and assert street
and postal code positively under the new public policy. The journey remains
in the existing `test:appointment-concurrency` / `test:appointment-regressions`
release API phase and its timing budget; no extra HTTP command is introduced.
**The full appointment-regression suite passed on an owned disposable
database, including the new HTTP journey.** The calibration helper uses the
existing PostgreSQL fixture bootstrap and appointment-concurrency suite.
Backend standards also passed: **15 tests and 26 checks**. These destructive
tests did not run against the development database. No browser journey was
executed for Stage B.

### Stage B migration, pins and development verification

Migration `000003_public_salon_entrance_details` adds only the four nullable
TEXT columns listed above. It is purely additive, transactional PostgreSQL 16
SQL with precondition, postcondition and rollback recovery, and has no
admission contract. SQL SHA-256:
`9bc21ec9bb74182314b498a91c606445d6564d7b070da4f04a22a43b195395c5`.
The ORM and manifest agree with the migration. The Phase 5B runbook now
includes 000003 in the required frontier, which production will need after
adoption; this does **not** authorize production access or application.

The baseline remains the catalog after 000001, separate from the required
chain head after all three migrations:

| Pin | Catalog rows | Structural SHA-256 | Physical SHA-256 |
| --- | ---: | --- | --- |
| Baseline, unchanged | 5060 | `938c62183adabae9fdab00c5d968c39feb3f216e521b9031d1642575f5875cad` | `673f3810d49a4be6899482d44281607dac06d3e1012cd001e8348a45fdf5ea1f` |
| Required head | 5064 | `4c65ef9a278fb7a41c2830e3c2c51f2d8f7abee08dadcc076fd4c17ddf255b98` | `39821cf3d682003a804326fa279eed957720f3a4b1458622bf91678abe1d824a` |

Baseline consumers remain `supported-state.ts`, `supported-state-contract.ts`
and convergence baseline fixtures. Readiness, the migration runner and
deployment eligibility use the required-head meaning. The readiness negative
tests for a non-baseline migration missing an APPLIED receipt pass **5/5**.

The head values were computed, not invented:
`scripts/src/migrations/calibrate-salon-address-head.ts` started an owned
disposable PostgreSQL **16.10** instance and applied the chain through the
project migration runner. It computed the project fingerprint inside the
postcondition; the unfixed-pin attempt rolled back. The helper then ran the
complete chain with the computed pins and independently checked readiness.
The disposable directory was removed after verification.

The authorized development target was explicitly
`heliumdb` / cluster system identifier `7675816360536354836` / unencrypted
transport. Through the migration runner, 000003 was **APPLIED** and existing
000001/000002 were skipped. Final read-only verification found all three
ledger entries **APPLIED**, readiness **true**, and both development
fingerprints exactly equal to the computed head above. Evidence:

- `.local/salon-stageb-evidence/development-application.log`
- `.local/salon-stageb-evidence/development-readiness-final.log`

No Drizzle push, runtime DDL or production connection was used.

### Stage B migration verification results

All migration integration suites passed on declared disposable targets:

| Suite | Passing tests |
| --- | ---: |
| Phase 4 | 37 |
| Equivalence | 4 |
| Target identity | 6 |
| Supported state | 15 |
| Supported convergence | 4 |
| Adoption | 1 |
| Namespace | 1 |
| Actual supported boot | 5 |
| Legacy boot | 1 |
| Historical suites | 13 + 13 |
| Interrupted recovery | 1 |

These integration runs have **zero skips** and `cleanupErrors: []`.
Successful evidence manifests are `integration-frontier`,
`integration-supported`, `integration-boot-pass` and `integration-historical`.
Earlier interrupted-run logs were retained and their cleanup was verified.
Migration contract tests pass **60/60**. Phase 5 unit tests pass **83**, with
one existing database-dependent skip whose actual execution is covered by
the integration runs.

The migration checks use already registered release-chain commands and
timing budgets; no new migration test command was necessary. The only new
test command for this UI/API batch is `test:salon-address-input`, registered
above. Production remains unauthorized. The parent delivery agent owns the
final protected-hash census/cascade/provenance and historical-tier identity
review.