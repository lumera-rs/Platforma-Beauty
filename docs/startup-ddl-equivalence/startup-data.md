# Blocker 1 — startup-created data in eleven tables

This report covers only data replacement. The prior inventory and whole-startup
characterization are not rerun or reclassified here.

Working branch: `remove-startup-ddl-preparation`; starting HEAD:
`815465404f7ed530cdb79446bfcba68e5dc1821b`. This work does not merge, push or publish.

## Scope and delivery mechanism

Two checksum-pinned SQL steps live in **a separate data-migration namespace**:

- `lib/db/data-migrations/000001_startup_reference_data/data.sql`
- `lib/db/data-migrations/000002_education_fallback_plans/data.sql`

These are **not** schema migrations `000001`/`000002`. The canonical schema
manifest, its immutable `000001`, schema ledger, baseline adoption, startup calls
and post-merge entry point are unchanged. No rollout-completion marker is forged.

Why separate steps: current baseline adoption establishes catalog identity and
marks manifest entries adopted. Catalog identity cannot establish whether a data
step ran. Registering data-only steps in that adoption path without a separately
reviewed sequencing change could silently skip the data.

`scripts/src/startup-data/apply.ts` is an explicit, disposable-development
validation executor. It requires a passed client targeting a generated loopback
fixture database; it has no ambient pool or database URL fallback and no
production enablement. It checks immutable SQL/contract hashes, serializes with
the existing migration and BusinessGrowth locks, locks affected tables, checks
the reviewed table contract and runs each step in one transaction. All errors
roll back; the two steps are separately selectable so a blocked plan does not
prevent an independently authorized reference-data step.

The pinned table contract is reconstructed from canonical `000001` in an owned
disposable database, not production. Defaults, constraints, indexes, user
triggers, RLS flags and rewrite rules are checked; the step refuses unsupported
schema states rather than guessing defaults. This is not a universal existing-
schema adoption mechanism. The executor intentionally remains restricted to
disposable fixtures; enabling it on any real development/production database
requires a separate explicit target/authorization design.

## Per-table decision

All source references below are in
`artifacts/api-server/src/lib/business-growth-schema.ts`. The eight reference
INSERTs and plan reconciliation are returned by `tableStatements(s)` and
executed by `runBusinessGrowthSchemaDdl`; `ensureBusinessGrowthSchema` is the
startup wrapper.

| Table | Exact source operation | Classification / destination | Implemented scope |
| --- | --- | --- | --- |
| `suppliers` | lines 642–644; INSERT fixed ID, `ON CONFLICT (slug) DO NOTHING` | Reference parent; explicit data step 000001 | Insert missing legacy parent; preserve existing fields. Reject conflicting reserved slug/ID. |
| `beauty_job_platform_settings` | lines 2182–2183; INSERT SELECT only when table empty | Global settings seed; explicit data step 000001 | Add `(listing_expiry_days=30,hourly_posting_limit=5)` only when empty. Preserve a configured row; reject ambiguous multiple rows. |
| `beauty_job_categories` | lines 2359–2382; 17 VALUES rows, `ON CONFLICT (slug) DO UPDATE` | Reference taxonomy; guarded explicit data step 000001 | Add missing rows. Existing matching business values are untouched. Differing standard-slug values cause full rollback, not overwrite. |
| `shop_settings` | line 2422; DEFAULT VALUES, `ON CONFLICT DO NOTHING` | Global settings seed; explicit data step 000001 | Add only missing singleton, preserve customized values and identity. |
| `b2c_display_settings` | line 3132; DEFAULT VALUES, `ON CONFLICT DO NOTHING` | Global display seed; explicit data step 000001 | Add only missing singleton, preserve customized values and editor reference. |
| `aftercare_settings` | line 3331; INSERT version 1 only if entire table empty | Versioned global settings seed; explicit data step 000001 | Exactly the source's empty-table condition, not “no current version.” Existing historical/current rows are not reset. |
| `education_placement_settings` | lines 4045–4047; INSERT `(kind,scope)` with conflict no-op | Global placement-price reference; explicit data step 000001 | Add missing featured-salon home setting; never reset configured price/capacity or other scopes. |
| `education_b2b_discount_settings` | line 4440; INSERT `(true,1)` with conflict no-op | Global configuration-version seed; explicit data step 000001 | Add missing singleton. No discount-tier thresholds are invented. |
| `subscription_plans` | lines 4605–4639; clones, subscription repointing, audience/tier reconciliation, fallback INSERT and UPDATEs | Historical cross-product reconciliation; only fallback subset in explicit data step 000002 | Empty or exact partially populated unreferenced fallback set only. Legacy/custom/shared/referenced/duplicate-tier states abort unchanged. Full reconciliation remains blocked. |
| `education_salon_cleanup_reports` | DO block lines 4384–4431, especially report INSERTs 4402 and 4428 | Historical reconciliation plus audit result; future reviewed data migration, not a seed | **No replacement.** Must derive audit counts from actual reviewed reconciliation; do not insert a fabricated zero report. |
| `business_growth_schema_rollout` | lines 5145–5149; parameterized singleton UPSERT after all rollout operations | Startup lifecycle bookkeeping, not business/reference data | **Retained only with original rollout.** Data steps never claim schema version completion or modify this row. |

## Exact expected data and relationships

### Reference step

- Supplier: ID `9b5970ea-0a8c-5e60-9d32-2a09f0890560`, name
  `LUMERA Legacy Catalog`, slug `lumera-legacy`, scope `BOTH`, active `true`.
  This is the actual historical fixed parent for legacy catalog defaults.
  Existing supplier names, scope/active state and tenant-owned categories are
  preserved. A conflicting ID cannot be substituted just because its slug matches.
  The separate historical NULL-supplier child backfill is not performed here.
- Category slugs: `frizeri`, `barberi`, `kozmetika`, `kozmeticari`, `nokti`,
  `lash-brow`, `make-up`, `sminkeri`, `pmu`, `estetika-masaza`,
  `masaza-terapeuti`, `estetika-anti-aging`, `pomocno-osoblje`,
  `tattoo-piercing`, `iznajmljivanje-opreme`,
  `iznajmljivanje-prostora-stolice`, `freelance-angazmani`.
  Exact names, subtype JSON arrays and feature flags are copied into the SQL
  file and compared against extracted original source statements in tests.
  All are enabled; only tattoo/piercing has `beauty_jobs_tattoo_piercing`.
  Existing category IDs and all referencing records must survive.
- Shop: loyalty display `true`, points per 100 RSD `1`, low stock `5`,
  default delivery days `3`, version `1`.
- B2C display: recommended sort, exact six source sort options, page size `24`,
  show out-of-stock `true`, recently viewed `true`/maximum `12`, version `1`;
  no editor is invented.
- Aftercare: version `1`; all other values are the exact canonical/source
  column defaults captured in `scripts/src/startup-data/table-contract.json`.
  No user, salon or education-center relationship is invented.
- Placement: `kind='featured_salon'`, `scope='home'`, price `5000`,
  slot count `12`, duration `30` days.
- Education B2B: singleton ID `true`, version `1`, no editor or tier rows.
- UUIDs and creation times use original database generators, not invented fixed
  identities. Existing IDs, timestamps, configuration and nullable references
  are preserved byte-for-byte by the replacement.

### Restricted education fallback step

Exactly three inactive plans are defined: `Education Start` / 5 courses,
`Education Growth` / 15, `Education Academy` / 30. Each has price `0`,
trial days `30`, features `[]`, limits `{"courses":n}`, audience `education`,
VAT included `true`, price copy `Cena uključuje PDV.`, active `false`.

Only empty or exact subsets of that business payload are admitted. Duplicate
tiers, different/NULL fields, any non-fallback plan and any existing salon or
education subscription relationship reject the entire step. Existing accepted
rows keep their original IDs and timestamps. This is deliberately **not** a
repair tool for real shared plans.

## Equivalence versus preservation

For admitted fresh/partial states, the replacements target the same **business
data** as the original source statements. Generated UUIDs/timestamps naturally
differ across independently created databases.

There are deliberate, explicit limits:

1. Original category conflict handling overwrites business fields and refreshes
   `updated_at`. The replacement preserves existing timestamps for matching
   payloads and refuses differing payloads. Therefore unconditional full-row
   equivalence to that overwrite behavior is **not claimed**.
2. Original supplier slug conflict handling can silently retain a different ID,
   leaving the historical fixed-parent assumption unsatisfied. The replacement
   explicitly blocks that case.
3. Original plan reconciliation updates/repoints existing records and can resolve
   clones by a name without verifying source provenance. The canonical schema
   does enforce `UNIQUE(name)`; the earlier description of the name as non-unique
   was incorrect. A single unrelated row can still occupy that name.
   Repointing such a row is incompatible with this request's
   no-overwrite constraint and is not reproduced by the restricted fallback step.

A refused case is a reported blocker with no writes, not a silent no-op.
Passing supported-state tests must not be described as global migration
equivalence or authorization to remove startup calls.

An existing customized singleton, placement price or exact-ID legacy supplier
is **not** an unresolved payload conflict: the original source explicitly leaves
its values untouched. Requiring canonical seed values there would incorrectly
reject legitimate configured data. Category and fallback-plan conflicts are
different because their original paths can overwrite/reconcile those values;
the replacement blocks them explicitly.

## Remaining blockers and evidence

- **Subscription reconciliation:** needs an approved mapping for shared plans,
  collision handling for `Education legacy <id>`, deterministic tier decisions
  and permission to change subscription relations/snapshots. The present
  no-overwrite instruction prevents replaying those original updates. This
  does not require guessing production data; conflicting fixture cases remain
  explicitly unsupported.
- **Education salon cleanup/audit:** source matches legacy-generated descriptions,
  UUID-derived slug and owner/center role relations, clears users'
  `active_salon_id`, retires matched salons and records counts once. A safe real
  replacement requires reviewed legacy provenance/candidate ownership evidence
  and authorization for each affected user/salon relationship. No real evidence
  was accessed and no zero-count audit row was synthesized.
- **Rollout marker:** cannot migrate a “completed” row until all historical schema
  and data work represented by that version is proven complete. Existing startup
  remains its sole writer here.
- **Other original blockers:** full-versus-fast-path function fingerprint drift
  and broad historical/tenant equivalence are outside this scoped change and
  remain unresolved.

No production access, publication, application restart, automatic merge or push
is performed. All eight startup ensure calls remain. See the accompanying test
results report for actual commands and coverage, rather than interpreting this
design description as evidence that an unrun case passed.

## Verification performed

New cluster: PostgreSQL **16.10**, loopback port **33521**, initialized under
`/tmp/lumera-startup-data.7BfLmU`. Only generated, owned child databases were used.
Fixtures execute the immutable canonical migration body in a transaction; they
do not run whole-startup characterization or adopt any existing database.
Paired comparison fixtures execute extracted original SQL, not a hand-written
approximation or the full startup rollout.

```sh
# Targeted new suite: exit 0; 13 passed, 0 failed, 0 skipped.
# This synthetic passwordless URL refers to the temporary test cluster only.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/startup-data/apply.test.ts \
  --admin-url=postgres://startup_data_owner@127.0.0.1:33521/postgres

# Scripts TypeScript check: exit 0, no diagnostics.
pnpm --filter @workspace/scripts exec tsc -p tsconfig.json --noEmit
```

Successful suite output is preserved in
[`evidence/startup-data-tests.txt`](evidence/startup-data-tests.txt).

The 13 tests cover hashes/source selection; fresh reference values; paired
original/new comparison of all eight reference tables; full-row repeat
preservation; matching partial taxonomy; taxonomy conflict rollback;
two-user/two-salon fixtures with listing/category/supplier foreign keys;
supplier identity collision; empty/partial fallback plans; paired original
plan reconciliation on supported empty/partial fixtures; custom, nullable,
duplicate and related-plan rejection; table/default drift refusal; and concurrent
reference replays without duplicate rows or invented migration/rollout records.

All fields are compared in the paired snapshots except independently generated
UUID IDs and generated creation/update/completion times. The fixed supplier UUID
and boolean B2B ID are retained. Snapshots of existing rows before/after the new
step retain **all** fields, including IDs/timestamps.

An initial executor check rejected PostgreSQL's `inet` text representation
(`127.0.0.1/32`); it now uses `pg_catalog.host(inet_server_addr())` while retaining
the strict loopback allowlist. Early test fixture/path/order/type errors were
corrected before the final passing run; they are not counted as passing tests.
No SQL defaults were changed to accommodate test assumptions.

Final checksums:

- Reference step: `a2e39aff4ab228d478e286c552ce65ceb00a3d973588ae2dfdbd8a6324788bb8`
- Fallback step: `7219e3fa58d85f3fd952ed9365b98b696062dee0d0025e4e801a6ba000b79a04`
- Table contract: `7bc6dba2b443883d81bfcbc23f77b74324bac1e7c8ba4c9bd1a25128d517d23f`

Final cleanup verified **zero** generated child databases. The temporary server
was then shut down gracefully (`pg_ctl ... -m fast -w stop`, exit 0).

### Readiness

- **Scoped data work:** implemented and tested for the explicitly admitted
  fixture states; global blocker 1 is only **partially resolved**.
- **Development merge for startup-DDL removal:** **NOT READY**.
- **Production execution:** **NOT READY / NOT AUTHORIZED**. Target identity,
  real-state eligibility, data evidence, backup/restore and operator approval
  requirements have not been discharged by these tests.
- No full HTTP boot, complete historical backfill suite, full CI or production
  test was run. No claims are made about the application's live runtime health.
- The two data steps, executor, tests, contract and report remain unmerged and
  unpublished. The original schema manifest, startup and post-merge paths remain
  untouched.