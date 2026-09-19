# Business Growth DDL resolution pilot

This is a read-only, documentation-only pilot.  It selects **exactly four
distinct DDL fingerprint mappings** owned by `ensureBusinessGrowthSchema`:

1. the `user_role` enum-label rename;
2. the `pg_trgm` extension creation;
3. the destructive `salon_customers` index drop; and
4. the bundle target-check validation.

The selection gives the pilot one enum transition, one extension, one
destructive catalog change, and one data-dependent validation.  It does not
collapse fingerprints that happen to have the same object/name.  In
particular, the fast-path bundle validation is a different fingerprint from
the `tableStatements` validation selected below.  Every occurrence of each
selected fingerprint is listed below; each selected fingerprint has one
occurrence in the immutable inventory.  No other DDL mapping is selected in
this document.

All four mapping statuses remain **`UNRESOLVED`**.  The recommendations below
are one non-authoritative candidate recommendation per mapping, not a status
change, authorization, migration plan, or retirement decision.

## Evidence boundary and method

The immutable inputs inspected read-only were:

- `scripts/src/production-startup-ddl-baseline.json` (the source inventory and
  fingerprints);
- `artifacts/api-server/src/lib/business-growth-schema.ts` (the executable
  literals, branch conditions, runner, and source order);
- `lib/db/migrations/000001_canonical_schema/migration.sql`, migration
  `000001`, SHA-256
  `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`;
- `docs/additional-operations-evidence/complete-evidence.json`; and
- `docs/additional-operations-evidence/DDL-RESOLUTION-METHODOLOGY.md`.

The canonical comparison below uses exact line slices and raw SQL, then
compares transition semantics.  It does not treat a name, object kind,
generated `semanticsVerified` value, `IF EXISTS`, `IF NOT EXISTS`, a checksum,
or a test as equivalence. There was no production connection, production
catalog/data inspection, migration execution, or application run. This analysis
did not execute tests to establish semantic equivalence; the package-level
static/mock checks are reported separately in [verification.md](verification.md).
No committed integration-test result was found by the read-only inspection;
an integration-test source file would not prove disposable execution.

The gate result vocabulary is:

- **`PASSED`**: the evidence dimension is established for this review;
- **`FAILED`**: the inspected evidence is counterevidence to the gate; and
- **`UNKNOWN — NOT SATISFIED`**: evidence is unavailable, so the gate is not
  satisfied.  This is used explicitly for every unavailable production gate.

The gates retain the methodology meanings:

- **CB1–CB7**: exact source/occurrence; actual canonical comparison;
  semantic equivalence; fresh and existing transition equivalence; transaction,
  precondition, failure and ordering safety; production representation/data
  evidence; and independent review.
- **FM1–FM7**: statement-level delta; complete future manifest/SQL plan;
  fresh/existing transition plan; read-only production preconditions;
  destructive-change owner/business/backup decision; dependency and manifest
  order/recovery; and independent approval.
- **RH1–RH6**: unreachable historical path; equivalent replacement;
  deployed production replacement; no remaining obligation; removal owner,
  release, observability and rollback; and independent review.

## Shared Business Growth execution facts

The selected literals are reached through:

`artifacts/api-server/src/index.ts` → `ensureBusinessGrowthSchema` →
`runBusinessGrowthSchemaDdl`, with the owner call site
`artifacts/api-server/src/index.ts:84:7` and phase `pre-listen`.

The source runner:

- takes one pooled client and a blocking
  `pg_advisory_lock(BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY)` at
  `business-growth-schema.ts:5002-5006`;
- sets the target `search_path` at `5008-5009`, captures/restores the prior
  search path and session timeout settings in the outer wrapper, and runs the
  rollout in autocommit;
- reads the rollout relation/version at `5035-5043`.  A current marker returns
  at `5125`, so source reachability is branch-dependent;
- builds and executes `statements` sequentially at `5128-5137` when the
  marker is absent or behind; and
- attempts `ROLLBACK`, turns off the session backfill GUC, unlocks, restores
  timeouts/search path, and releases the client at `5150-5197`.  Those cleanup
  attempts do not undo already committed autocommitted DDL.  Failure
  propagates before the rollout marker write at `5139-5148`, and a later
  startup may retry the branch.

These are source facts, not proof that the lock, timeout, marker, cleanup, or
target production state is correct.  The exact additional-operation IDs used
below are IDs present in `complete-evidence.json`, not names reconstructed from
the DDL:

For all four selected mappings, the outer wrapper at source lines 5172-5175
reads previous timeouts and applies session `lock_timeout = '30s'` and
`statement_timeout = '30s'` before calling the runner. These values and restoration
through `set_config(..., false)` are defined in
`artifacts/api-server/src/lib/startup-ddl-safety.ts:3-40`. They are not `SET LOCAL`
in this autocommit owner. Canonical lines 1-25 instead declare transactional
mode and set both timeouts to zero; runner execution is described in the
package README. The difference is demonstrated; equivalence or stronger safety
is not. Previous-value restoration is attempted after either path and preserves
the primary error, but is not production-tested here.

| Selected mapping | Exact additional-operation dependency IDs evidenced in `complete-evidence.json` |
| --- | --- |
| `user_role` rename | `ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d`; `business-growth/advisory-lock-and-session-state`; `business-growth/rollout-marker-read`; `business-growth/rollout-marker-write` |
| `pg_trgm` creation | `business-growth/advisory-lock-and-session-state`; `business-growth/rollout-marker-read`; `business-growth/rollout-marker-write` |
| index drop | `business-growth/advisory-lock-and-session-state`; `business-growth/rollout-marker-read`; `business-growth/rollout-marker-write` |
| bundle target-check validation | `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668`; `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf`; `business-growth/advisory-lock-and-session-state`; `business-growth/rollout-marker-read`; `business-growth/rollout-marker-write` |

The enum source-discovered record is classified as a data-backfill because the
same executable block can update existing `users.role` rows.  For the selected
full-rollout bundle validation, the two exact source-discovered records
`ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668` and
`ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf` cover the
full update literals at source lines `4923-4930`; they are not silently
substituted with the curated fast-path record.  The
`business-growth/bundle-payment-backfill` record covers only the separate
current-version fast-path guard and validation/backfill sequence at source
lines `5087-5108`.  The full-rollout function record
`ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb` covers
source lines `4939-4951` on the separate payment trigger/function edge; the
fast-path function record remains
`business-growth/bundle-payment-immutability-function` at `5112-5120`.
For the extension and index-drop mappings, complete evidence contains no
direct additional-operation record for the individual DDL literal; only the
exact runner/marker IDs above are claimed.  No dependency is inferred merely
from a matching object name.  The full-path dependency supplement is
[maintained in the dependency matrix](dependency-matrix.md#fast-path-versus-full-rollout).

The Business Growth rollout-marker fast path is not retirement evidence.  A
current marker can skip the historical branch on one database, but it does not
prove that older-marker, missing-marker, partial-rollout, upgrade, or recovery
paths are unreachable or that every data transition completed.

## Builder-checked occurrence metadata

The following values were checked with the pure `loadRepositoryCrosswalk()`
builder against the four fingerprint IDs below.  No owner function, database,
or application runtime was invoked.  `sourcePath` is the builder's matched
operation locator; literal and operation coordinates are retained separately.

| Fingerprint | Kind | Source path | Literal | Operation | Order | Source SQL SHA-256 | Existing-data effect | Dependencies | Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec` | `alter-type` | `artifacts/api-server/src/lib/business-growth-schema.ts:1612:10` | `1594:5` | `1612:10` | 355 | `e573adfb340b71070a2ef451b593a626b39afe0a0fd2791da096072d87cecbff` | `existing-schema-reconciliation` | `schema:<dynamic>` | `UNRESOLVED` |
| `b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913` | `create-extension` | `artifacts/api-server/src/lib/business-growth-schema.ts:255:6` | `255:5` | `255:6` | 3 | `fc12c63e2a252eb5752fad2823324b076344ba3ef3f2bb2110e339b742938524` | `existing-schema-reconciliation` | `schema:pg_catalog` | `UNRESOLVED` |
| `2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5` | `drop-index` | `artifacts/api-server/src/lib/business-growth-schema.ts:258:6` | `258:5` | `258:6` | 5 | `8bf13f95e9633a5d78270395aa0a254101421e44aff98b71d4627670e866e9ae` | `existing-schema-reconciliation` | `schema:<dynamic>`, `table:<dynamic>.salon_customers` | `UNRESOLVED` |
| `71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a` | `validate-constraint` | `artifacts/api-server/src/lib/business-growth-schema.ts:4962:10` | `4955:5` | `4962:10` | 1348 | `9b3a0add2337cd818cb904516957ef202841958450e0357a52ea71ac00af9304` | `existing-schema-reconciliation` | `schema:<dynamic>`, `table:<dynamic>.education_bundle_purchases` | `UNRESOLVED` |

The builder also reports the exact shared preconditions for all four:
`All referenced parent objects and existing rows satisfy the reviewed
operation semantics.` and `The operation has been compared with the immutable
canonical migration or an approved future migration.`  Its exact common
postcondition is that the reviewed identity has the approved definition and
existing production data is preserved or changed only by an explicitly
reviewed backfill.  The exact common rollback consideration is that
application rollback must remain compatible with the resulting catalog and
data state; the drop additionally has the explicit drop-specific warning
recorded in its mapping below.

Builder canonical-evidence metadata is also preserved: the dynamic
`user_role` and index identities have `no-candidate-name-match` with no
generated line reference; `pg_trgm` has candidate lines `42`, `45`, `49`, and
`52`; and the bundle constraint has candidate line `3447`.  The exact
canonical slices below intentionally inspect the dynamic/no-candidate cases
and the surrounding extension/constraint definitions rather than treating
those generated candidate references as semantic proof.

### Supplementary same-literal crosswalk alias (not a fifth selection)

The immutable crosswalk contains a second fingerprint for the **same
Business Growth source literal and target constraint**.  It is supplementary
metadata only, not a fifth selected mapping and not a new gate row:

| Fingerprint | Operation kind | Summary | Object identity | Owner | Source path | Literal position | Operation position | Source SQL SHA-256 | Execution order | Call site | Phase | Execution path | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `07e226d17976f0897da49e2a34fa14dd6a0534297bbb2b3d09187eecdaebbcc9` | `alter-table` | `ALTER TABLE ${s}.education_bundle_purchases VALIDATE CONSTRAINT education_bundle_purchases_target_check` | `kind=constraint`, `schema=<dynamic>`, `name=education_bundle_purchases_target_check`, `parent=education_bundle_purchases` | `ensureBusinessGrowthSchema` | `artifacts/api-server/src/lib/business-growth-schema.ts:4962:10` | `literalLine=4955`, `literalColumn=5` | `operationLine=4962`, `operationColumn=10` | `9b3a0add2337cd818cb904516957ef202841958450e0357a52ea71ac00af9304` | 1347 | `artifacts/api-server/src/index.ts:84:7` | `pre-listen` | `artifacts/api-server/src/index.ts` → `artifacts/api-server/src/lib/business-growth-schema.ts::ensureBusinessGrowthSchema` → `artifacts/api-server/src/lib/business-growth-schema.ts::runBusinessGrowthSchemaDdl` → `artifacts/api-server/src/lib/business-growth-schema.ts:5137:13` | `UNRESOLVED` |

Its complete `sourceSql` is byte-identical to the selected
`71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a` literal
shown in Mapping 4 below:

```sql
DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = '${s}.education_bundle_purchases'::regclass
           AND conname = 'education_bundle_purchases_target_check'
           AND NOT convalidated
       ) THEN
         ALTER TABLE ${s}.education_bundle_purchases
           VALIDATE CONSTRAINT education_bundle_purchases_target_check;
       END IF;
     END $$
```

The two fingerprints therefore share the target identity and source SQL
checksum, while their immutable inventory `operationKind` values are
`validate-constraint` (selected `71356...`) and `alter-table` (supplementary
`07e226...`).  They are not two executions: the crosswalk preserves one source
occurrence under each inventory classification.  Both remain `UNRESOLVED`.

## Mapping 1 — `user_role` enum-label rename

### Identity, fingerprint, occurrence, and source

- Owner: `ensureBusinessGrowthSchema`
- Kind: `alter-type`
- Inventory summary: `ALTER TYPE ${s}.user_role`
- Fingerprint: `5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec`
- Object identity: kind `type`, schema `<dynamic>`, name `user_role`,
  dynamic expression `${s}.user_role`
- Existing-data effect:
  `existing-schema-reconciliation`
- Selected fingerprint occurrence count: **1 of 1**
- Literal locator: `artifacts/api-server/src/lib/business-growth-schema.ts:1594:5`
  (literal line 1594, literal column 5)
- Matched operation locator:
  `artifacts/api-server/src/lib/business-growth-schema.ts:1612:10`
  (operation line 1612, operation column 10)
- Source execution order: **355**
- Call site: `artifacts/api-server/src/index.ts:84:7`
- Phase: `pre-listen`
- Execution path:
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/business-growth-schema.ts::ensureBusinessGrowthSchema`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts::runBusinessGrowthSchemaDdl`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts:5137:13`
- Source SQL SHA-256:
  `e573adfb340b71070a2ef451b593a626b39afe0a0fd2791da096072d87cecbff`

The complete original executable SQL literal is:

```sql
DO $$
     DECLARE has_old boolean; has_new boolean;
     BEGIN
       SELECT EXISTS (
         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'user_role' AND n.nspname = current_schema()
           AND e.enumlabel = 'EDUCATION_CENTER_OWNER'
       ), EXISTS (
         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'user_role' AND n.nspname = current_schema()
           AND e.enumlabel = 'EDUKATIVNI_CENTAR'
       ) INTO has_old, has_new;
       IF has_old AND has_new THEN
         UPDATE ${s}.users SET role = 'EDUKATIVNI_CENTAR'
         WHERE role = 'EDUCATION_CENTER_OWNER';
       ELSIF has_old THEN
         ALTER TYPE ${s}.user_role RENAME VALUE 'EDUCATION_CENTER_OWNER' TO 'EDUKATIVNI_CENTAR';
       END IF;
     END $$
```

The dynamic schema is selected by `schemaName`, is validated by
`quoteSchema`, and is also used in the `current_schema()` catalog predicate.
The operation is conditional: both labels cause an existing-row update; only
the old label causes `ALTER TYPE ... RENAME VALUE`; neither label causes no
transition.  Thus the source SQL is not just the short inventory summary.

### Cross-owner target-check replacement boundary

`ensureBusinessGrowthSchema` is the first startup owner
(`artifacts/api-server/src/index.ts:84:7`).  The selected
`71356...` occurrence in its non-fast-path statement array only probes for an
already-present, unvalidated `education_bundle_purchases_target_check` and,
when that exact catalog state exists, validates it.  It does **not** drop,
replace, or add the constraint definition.  Its separate current-version
fast-path branch also has distinct target-check and payment-trigger
fingerprints at source lines `5088-5123`; the fast-path function replacement at
`5112-5120` has the same payment-reference predicates, exception text, and
`RETURN NEW` body as the eighth-owner function at `39-47`, but is not part of
the selected `71356...` literal.

The eighth owner,
`ensureEducationBundlePurchaseSchema`
(`artifacts/api-server/src/index.ts:91:7`), later performs a separate
replacement sequence: it drops the old target checks at source lines `52-53`,
backfills `learner_user_id` at `54-58`, adds a new `NOT VALID`
`education_bundle_purchases_target_check` at `59-61`, and validates that
replacement at `62-63`.  Thus, on a reached run, the eighth-owner sequence
determines the later target-check catalog state; the selected first-owner
validation is not evidence that the later replacement exists, has the reviewed
definition, or validates successfully.  The branch/marker state, current rows,
and production result were not inspected.  The related downstream evidence IDs
`education-bundle/payment-reference-backfill`,
`education-bundle/payment-reference-function`,
`education-bundle/learner-id-backfill`, and
`education-bundle/transaction-and-advisory-lock` remain
`UNRESOLVED`; they are cross-owner context, not additional selected Business
Growth mappings.

### Canonical exact slice and semantic comparison

Canonical `000001`, lines **1275-1289**, is:

```sql
--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'SUPER_ADMIN',
    'ADMIN',
    'SALON_OWNER',
    'SALON_EMPLOYEE',
    'EDUCATION_CENTER_OWNER',
    'INSTRUCTOR',
    'CUSTOMER',
    'STUDENT',
    'JOBSEEKER',
    'EDUKATIVNI_CENTAR'
);
```

This is an actual comparison, not a generated-name claim.  Canonical contains
the corresponding type definition (**CB2 PASSED**), but it does not contain
the conditional catalog inspection, the existing-row rewrite, or the
`RENAME VALUE` transition.  It also preserves both
`EDUCATION_CENTER_OWNER` and `EDUKATIVNI_CENTAR`, whereas the rename branch
removes the old label from the enum and the dual-label branch updates rows
instead.  The transition semantics are therefore not equivalent (**CB3
FAILED**).

For a fresh database, a canonical database already containing both labels
would take the `has_old AND has_new` branch (with no users to update), not the
rename branch.  For an existing database, the result depends on the current
enum labels, `users.role` values, dependent application comparisons, and
concurrent writes.  No production rows/catalog were inspected.  The
existing-data outcome is consequently not established even though the source
describes preservation of enum OIDs.

### Preconditions, postconditions, recovery, and decisions

- Crosswalk mapping dependency is exactly `schema:<dynamic>`.  The SQL block
  also reads the dynamic `users` table as a semantic prerequisite; that table
  reference is not an additional crosswalk dependency ID.  The exact
  additional-operation IDs are the enum source-discovered record and the
  three runner/marker IDs listed above.
- Preconditions are: referenced objects and existing rows satisfy reviewed
  semantics, and the operation has been compared with canonical `000001` or
  an approved future migration.
- The intended postcondition is a reviewed `user_role` definition and
  preserved or explicitly reviewed role data.  A successful `ALTER TYPE` does
  not establish application compatibility or complete role conversion.
- The statement runs in the autocommitted sequential array under the
  advisory lock.  `ALTER TYPE`/enum ordering and any pending transaction,
  timeout, search path, or session-GUC cleanup must be proven for the target
  deployment; no production lock or timeout observation exists.
- Failure after earlier statements leaves earlier commits in place; retry is
  not rollback.  Recovery needs a reviewed compatibility and data-compensation
  boundary, not a second rename.
- Business decision required: choose one canonical role-label policy and
  decide whether existing users are renamed, rewritten, or left compatible;
  obtain an owner, release boundary, backup/restore or compensating plan, and
  independent approval.
- Unknowns include target identity and release overlap, marker/ledger state,
  actual enum labels and row counts, dependent code paths, concurrent writers,
  permissions, restore evidence, and whether the cleanup path succeeds after
  a partial rollout.

### Resolution gates

| Gate | Result and finding |
| --- | --- |
| CB1 | **PASSED** — the complete executable literal, `${s}` interpolation, conditional branches, owner, call path, source position, order, and the one occurrence are recorded above. |
| CB2 | **PASSED** — the canonical `user_role` definition was compared directly at lines 1275-1289; this is not based on `semanticsVerified=false` or on independent-review absence. |
| CB3 | **FAILED** — canonical final labels do not encode this conditional rename-or-row-update transition and retain both labels. |
| CB4 | **UNKNOWN — NOT SATISFIED** — fresh behavior can be reasoned about for the canonical labels, but existing enum/row state and dependent behavior are uninspected. |
| CB5 | **UNKNOWN — NOT SATISFIED** — source autocommit/lock/cleanup facts are known, but canonical runner transaction mode, lock strength, timeout behavior, and partial-failure equivalence are not evidenced. |
| CB6 | **UNKNOWN — NOT SATISFIED** — no production catalog, role distribution, data invariant, target identity, or dependent application evidence was collected. |
| CB7 | **UNKNOWN — NOT SATISFIED** — no independent reviewer disposition exists. |
| FM1 | **PASSED** — the unresolved delta is specified: conditional enum-label detection, possible `users.role` update, or `RENAME VALUE`. |
| FM2 | **UNKNOWN — NOT SATISFIED** — no unique future manifest, immutable SQL/checksum, transaction mode, dependencies, or recovery plan is approved. |
| FM3 | **UNKNOWN — NOT SATISFIED** — no separate fresh/existing plan covers rows, concurrent writers, retries, partial completion, and compatibility. |
| FM4 | **UNKNOWN — NOT SATISFIED** — the required read-only production preconditions were not inspected. |
| FM5 | **UNKNOWN — NOT SATISFIED** — role-data business authorization, owner, backup/restore or compensation, and rollback boundary are open. |
| FM6 | **UNKNOWN — NOT SATISFIED** — complete dependency/manifest order and independent recovery of every committed statement are not proven. |
| FM7 | **UNKNOWN — NOT SATISFIED** — no independent plan approval exists. |
| RH1 | **FAILED** — the literal remains reachable from the unconditional pre-listen owner; a current marker can skip it but cannot prove retirement. |
| RH2 | **FAILED** — the canonical type definition is not a transition-equivalent replacement for this conditional rename/data update. |
| RH3 | **UNKNOWN — NOT SATISFIED** — production deployment of a replacement and its data/dependent state are unverified. |
| RH4 | **UNKNOWN — NOT SATISFIED** — pending role backfill, compatibility, cleanup, and recovery obligations are unknown. |
| RH5 | **UNKNOWN — NOT SATISFIED** — removal owner, release boundary, observability, and rollback plan are absent. |
| RH6 | **UNKNOWN — NOT SATISFIED** — no independent reachability/production/retirement review exists. |

**Status:** `UNRESOLVED`
**Non-authoritative recommendation:** Candidate for FUTURE_MIGRATION_REQUIRED review.

## Mapping 2 — `pg_trgm` extension creation

### Identity, fingerprint, occurrence, and source

- Owner: `ensureBusinessGrowthSchema`
- Kind: `create-extension`
- Inventory summary: `CREATE EXTENSION IF NOT EXISTS pg_trgm`
- Fingerprint: `b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913`
- Object identity: kind `extension`, schema `pg_catalog`, name `pg_trgm`
- Existing-data effect:
  `existing-schema-reconciliation`
- Selected fingerprint occurrence count: **1 of 1**
- Source path: `artifacts/api-server/src/lib/business-growth-schema.ts:255:6`
  (operation line 255, operation column 6)
- Literal locator:
  `artifacts/api-server/src/lib/business-growth-schema.ts:255:5`
  (literal line 255, literal column 5)
- Source execution order: **3**
- Call site: `artifacts/api-server/src/index.ts:84:7`
- Phase: `pre-listen`
- Execution path:
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/business-growth-schema.ts::ensureBusinessGrowthSchema`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts::runBusinessGrowthSchemaDdl`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts:5137:13`
- Source SQL SHA-256:
  `fc12c63e2a252eb5752fad2823324b076344ba3ef3f2bb2110e339b742938524`

Complete original executable SQL:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm
```

The literal has no explicit `WITH SCHEMA` clause.  The runtime target is a
dynamic, quoted schema through the runner's `search_path`; the extension
catalog's existing schema/version/owner is not known.

### Canonical exact slice and semantic comparison

Canonical `000001`, lines **41-52**, is:

```sql
--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';
```

Canonical contains the corresponding extension and explicit candidate name
(**CB2 PASSED**).  Raw/normalized comparison shows that the startup literal
does not specify `WITH SCHEMA public` and does not apply the canonical comment.
Installed extension version, schema placement, ownership, privileges, and
dependent operator classes are transition semantics, not cosmetic text.
Equivalence is therefore not established (**CB3 FAILED**).

On a fresh canonical database, the extension is created in `public` and the
comment is applied by migration `000001`; the startup literal may be a no-op
or may resolve its default differently depending on the target search path.
On an existing database, `IF NOT EXISTS` does not prove the installed version,
schema, owner, privileges, or extension objects match.  No catalog inspection
was performed, so neither existing-state reconciliation nor dependent index
behavior is proven.

### Preconditions, postconditions, recovery, and decisions

- Mapping dependency is `schema:pg_catalog` as represented by the crosswalk;
  the target schema/search path and extension availability are additional
  runtime prerequisites.  Exact additional-operation IDs are the runner and
  marker IDs listed in the shared table; no direct extension additional
  operation is claimed by complete evidence.
- Preconditions are the extension being available to the server, the intended
  schema/owner/privilege policy being approved, and dependent objects being
  compatible.
- The intended postcondition is the approved `pg_trgm` extension definition,
  version, schema, privileges, and dependent operator behavior.  `IF NOT
  EXISTS` alone is not this proof.
- The operation is one sequential autocommitted query under the blocking
  advisory lock, with outer timeout/search-path restoration.  Canonical
  migration transaction behavior, extension-install lock duration, server
  version availability, and concurrent DDL behavior remain unverified.
- If creation fails, startup fails; if it succeeds, extension installation
  cannot be undone by retry.  Recovery requires an approved extension
  version/schema/privilege rollback or restore boundary.
- Business decision required: approve the extension version and schema/owner
  policy, confirm licensing/availability and all dependent index/operator
  behavior, and decide whether a future migration should include the canonical
  comment and explicit schema.
- Unknowns include target identity, server extension availability/version,
  existing schema and owner, privileges, dependent indexes, lock waits,
  timeout behavior, marker state, and restore evidence.

### Resolution gates

| Gate | Result and finding |
| --- | --- |
| CB1 | **PASSED** — exact literal, object identity, owner, dynamic execution context, source location, order, and sole occurrence are recorded. |
| CB2 | **PASSED** — canonical extension lines 41-52 were compared directly, including `WITH SCHEMA public` and the comment. |
| CB3 | **FAILED** — the startup statement does not carry the canonical schema/comment and existing extension version/privilege semantics are not equivalent by name. |
| CB4 | **UNKNOWN — NOT SATISFIED** — fresh target-schema behavior and existing extension state/version/privileges are not jointly proven. |
| CB5 | **UNKNOWN — NOT SATISFIED** — startup autocommit/lock/cleanup is known, but canonical transaction/lock/timeout/failure equivalence is not. |
| CB6 | **UNKNOWN — NOT SATISFIED** — no production extension catalog, dependent object, or application behavior evidence exists. |
| CB7 | **UNKNOWN — NOT SATISFIED** — no independent reviewer disposition exists. |
| FM1 | **PASSED** — delta is exact: extension creation only versus canonical schema-qualified creation plus comment, with version/privilege state unresolved. |
| FM2 | **UNKNOWN — NOT SATISFIED** — no approved manifest, immutable SQL/checksum, extension policy, or recovery procedure exists. |
| FM3 | **UNKNOWN — NOT SATISFIED** — no fresh/existing transition plan proves concurrent DDL and application compatibility. |
| FM4 | **UNKNOWN — NOT SATISFIED** — required read-only production catalog evidence is unavailable. |
| FM5 | **UNKNOWN — NOT SATISFIED** — owner, business approval, extension availability, backup/restore, and rollback boundary are open. |
| FM6 | **UNKNOWN — NOT SATISFIED** — dependent extension objects, manifest ordering, and nontransactional recovery are not complete. |
| FM7 | **UNKNOWN — NOT SATISFIED** — no independent approval exists. |
| RH1 | **FAILED** — the literal remains reachable on the non-fast-path owner branch; a marker skip is not retirement proof. |
| RH2 | **FAILED** — canonical extension SQL has materially different schema/comment semantics and is not a reviewed transition-equivalent replacement. |
| RH3 | **UNKNOWN — NOT SATISFIED** — production extension version/schema/privileges and dependent objects are unverified. |
| RH4 | **UNKNOWN — NOT SATISFIED** — extension compatibility, operator-class, and cleanup obligations are unknown. |
| RH5 | **UNKNOWN — NOT SATISFIED** — removal owner, release boundary, observability, and rollback are absent. |
| RH6 | **UNKNOWN — NOT SATISFIED** — no independent retirement review exists. |

**Status:** `UNRESOLVED`
**Non-authoritative recommendation:** Candidate for FUTURE_MIGRATION_REQUIRED review.

## Mapping 3 — destructive `salon_customers` index drop

### Identity, fingerprint, occurrence, and source

- Owner: `ensureBusinessGrowthSchema`
- Kind: `drop-index`
- Inventory summary:
  `DROP INDEX IF EXISTS ${s}.salon_customers_phone_lookup_normalized_idx`
- Fingerprint: `2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5`
- Object identity: kind `index`, schema `<dynamic>`, name
  `salon_customers_phone_lookup_normalized_idx`, dynamic expression
  `${s}.salon_customers_phone_lookup_normalized_idx`
- Existing-data effect:
  `existing-schema-reconciliation`
- Selected fingerprint occurrence count: **1 of 1**
- Source path: `artifacts/api-server/src/lib/business-growth-schema.ts:258:6`
  (operation line 258, operation column 6)
- Literal locator:
  `artifacts/api-server/src/lib/business-growth-schema.ts:258:5`
  (literal line 258, literal column 5)
- Source execution order: **5**
- Call site: `artifacts/api-server/src/index.ts:84:7`
- Phase: `pre-listen`
- Execution path:
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/business-growth-schema.ts::ensureBusinessGrowthSchema`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts::runBusinessGrowthSchemaDdl`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts:5137:13`
- Source SQL SHA-256:
  `8bf13f95e9633a5d78270395aa0a254101421e44aff98b71d4627670e866e9ae`

Complete original executable SQL:

```sql
DROP INDEX IF EXISTS ${s}.salon_customers_phone_lookup_normalized_idx
```

The schema identifier is dynamically interpolated and validated by
`quoteSchema`.  `IF EXISTS` makes the operation a conditional destructive
catalog change: it drops the named index when present and silently does
nothing when absent.  It does not prove that the index is unused, redundant,
or safely replaceable.

### Canonical exact slice and semantic comparison

The canonical migration contains no `DROP INDEX` for
`salon_customers_phone_lookup_normalized_idx`.  Its nearby exact index slice,
lines **14173-14183**, is:

```sql
--
-- Name: salon_customers_phone_normalized_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_customers_phone_normalized_idx ON public.salon_customers USING btree (phone_normalized) WHERE (phone_normalized IS NOT NULL);


--
-- Name: salon_customers_salon_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_customers_salon_id_idx ON public.salon_customers USING btree (salon_id, id);
```

This is actual negative/nearby evidence: the old lookup-index drop is not a
canonical transition, and the canonical slice defines different indexes.
There is no canonical corresponding drop or proof that either replacement has
the same expression, predicate, access path, statistics, or workload role
(**CB2 FAILED** and **CB3 FAILED**).  A name-only assertion that the old index
was superseded would be insufficient.

On a fresh canonical database the old index is absent, so the startup drop is
a no-op while the two shown indexes are created.  On an existing database the
drop can remove a live access path, block or wait behind concurrent queries,
and alter query latency without changing table rows.  No production index
definition, usage, dependency, query plan, lock wait, or concurrent-writer
evidence was inspected.

### Preconditions, postconditions, recovery, and decisions

- Mapping dependencies are `schema:<dynamic>` and
  `table:<dynamic>.salon_customers`; exact additional-operation IDs are the
  runner and marker IDs listed in the shared table.  Complete evidence does
  not contain a direct additional-operation record for this index drop.
- Preconditions are the target table and named index being the reviewed
  objects, no required dependency relying on the index, an approved
  replacement/performance plan, and acceptable lock/concurrency behavior.
- The intended postcondition is an approved catalog without this index and
  with verified query performance and dependent objects.  `IF EXISTS` is not a
  postcondition.
- The drop runs as one autocommitted statement in the sequential array under
  the advisory lock.  The lock serializes this rollout family, not every
  query or every deployment; canonical transaction mode and lock-duration
  equivalence remain unverified.
- Recovery is not a retry: rebuilding an index needs its own approved SQL,
  lock/time budget, possible concurrent-index mode, and monitoring.  Any
  already committed drop remains in effect after a later statement fails.
- Business decision required: explicitly approve removal, replacement and
  performance impact, identify owner/release boundary, decide whether a
  backup/restore or rebuild is the recovery boundary, and obtain independent
  authorization.
- Unknowns include target schema, index definition/ownership/size/use,
  dependent constraints or plans, concurrent sessions, lock timeout,
  application release overlap, marker state, and restore/rebuild evidence.

### Resolution gates

| Gate | Result and finding |
| --- | --- |
| CB1 | **PASSED** — exact dynamic literal, identifier, owner/path, location, order, and sole occurrence are recorded. |
| CB2 | **FAILED** — canonical lines 14173-14183 show different indexes and no corresponding drop transition for the selected index. |
| CB3 | **FAILED** — no semantic equivalence exists between removing a possibly live expression/index and creating the shown different indexes. |
| CB4 | **UNKNOWN — NOT SATISFIED** — fresh no-op behavior is distinguishable, but existing index/data/workload state is uninspected. |
| CB5 | **UNKNOWN — NOT SATISFIED** — autocommit and advisory-lock facts are known; canonical/drop lock, timeout, failure, and rebuild safety are not. |
| CB6 | **UNKNOWN — NOT SATISFIED** — no production catalog, usage, plan, dependent application, or target-identity evidence exists. |
| CB7 | **UNKNOWN — NOT SATISFIED** — no independent reviewer disposition exists. |
| FM1 | **PASSED** — delta is exact: remove the dynamically named old index, with no canonical replacement transition proven. |
| FM2 | **UNKNOWN — NOT SATISFIED** — no future manifest, immutable replacement/drop SQL, checksum, or recovery procedure is approved. |
| FM3 | **UNKNOWN — NOT SATISFIED** — no fresh/existing plan covers concurrent queries, lock waits, retries, partial completion, and performance compatibility. |
| FM4 | **UNKNOWN — NOT SATISFIED** — required read-only production index and workload evidence is unavailable. |
| FM5 | **UNKNOWN — NOT SATISFIED** — destructive-change owner, business authorization, backup/restore or rebuild decision, and rollback boundary are open. |
| FM6 | **UNKNOWN — NOT SATISFIED** — dependency order and independent recovery after an autocommitted drop are not complete. |
| FM7 | **UNKNOWN — NOT SATISFIED** — no independent approval exists. |
| RH1 | **FAILED** — the drop literal remains reachable on the non-fast-path branch; the marker cannot prove historical retirement. |
| RH2 | **FAILED** — the canonical nearby indexes are not a reviewed equivalent replacement for the selected index's removal. |
| RH3 | **UNKNOWN — NOT SATISFIED** — production replacement, query plans, dependencies, and release state are unverified. |
| RH4 | **UNKNOWN — NOT SATISFIED** — pending rebuild, performance, compatibility, and recovery obligations are unknown. |
| RH5 | **UNKNOWN — NOT SATISFIED** — removal owner, release boundary, observability, and rollback/rebuild plan are absent. |
| RH6 | **UNKNOWN — NOT SATISFIED** — no independent retirement review exists. |

**Status:** `UNRESOLVED`
**Non-authoritative recommendation:** Candidate for FUTURE_MIGRATION_REQUIRED review.

## Mapping 4 — bundle target-check validation

### Identity, fingerprint, occurrence, and source

- Owner: `ensureBusinessGrowthSchema`
- Kind: `validate-constraint`
- Inventory summary:
  `ALTER TABLE ${s}.education_bundle_purchases VALIDATE CONSTRAINT education_bundle_purchases_target_check`
- Fingerprint: `71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a`
- Object identity: kind `constraint`, schema `<dynamic>`, name
  `education_bundle_purchases_target_check`, parent
  `education_bundle_purchases`
- Existing-data effect:
  `existing-schema-reconciliation`
- Selected fingerprint occurrence count: **1 of 1**
- Literal locator: `artifacts/api-server/src/lib/business-growth-schema.ts:4955:5`
  (literal line 4955, literal column 5)
- Source path: `artifacts/api-server/src/lib/business-growth-schema.ts:4962:10`
  (operation line 4962, operation column 10)
- Matched operation locator:
  `artifacts/api-server/src/lib/business-growth-schema.ts:4962:10`
  (operation line 4962, operation column 10)
- Source execution order: **1348**
- Call site: `artifacts/api-server/src/index.ts:84:7`
- Phase: `pre-listen`
- Execution path:
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/business-growth-schema.ts::ensureBusinessGrowthSchema`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts::runBusinessGrowthSchemaDdl`
  →
  `artifacts/api-server/src/lib/business-growth-schema.ts:5137:13`
- Source SQL SHA-256:
  `9b3a0add2337cd818cb904516957ef202841958450e0357a52ea71ac00af9304`

Complete original executable SQL:

```sql
DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = '${s}.education_bundle_purchases'::regclass
           AND conname = 'education_bundle_purchases_target_check'
           AND NOT convalidated
       ) THEN
         ALTER TABLE ${s}.education_bundle_purchases
           VALIDATE CONSTRAINT education_bundle_purchases_target_check;
       END IF;
     END $$
```

The dynamic schema is interpolated both in the `regclass` lookup and the
`ALTER TABLE`.  The catalog predicate requires the table/constraint to exist
and the constraint to be `NOT VALID`; a missing table, missing constraint, or
already validated constraint is a no-op.  The selected static literal is
inside the marker-controlled sequential array.  Separately, the
current-version fast path has an outer `to_regclass` guard and a distinct
fingerprint at source lines `5088-5098`; that distinct mapping is not silently
merged into this one.

### Canonical exact slice and semantic comparison

Canonical `000001`, lines **3445-3448**, defines the target table and
constraint as:

```sql
    CONSTRAINT education_bundle_purchases_amount_check CHECK ((amount >= 0)),
    CONSTRAINT education_bundle_purchases_payment_reference_snapshot_check CHECK ((((payment_instructions ->> 'reference'::text) IS NOT NULL) AND ((payment_instructions ->> 'reference'::text) = payment_reference))),
    CONSTRAINT education_bundle_purchases_target_check CHECK ((((target_type = 'individual'::public.education_bundle_purchase_target) AND (learner_user_id IS NOT NULL) AND (salon_id IS NULL) AND (employee_id IS NULL)) OR ((target_type = 'salon_employee'::public.education_bundle_purchase_target) AND (learner_user_id IS NOT NULL) AND (salon_id IS NOT NULL) AND (employee_id IS NOT NULL))))
);
```

Canonical contains the corresponding target constraint definition
(**CB2 PASSED**), but its fresh `CREATE TABLE` does not represent the
existing-database conditional `pg_constraint` probe or the
`VALIDATE CONSTRAINT` transition.  The source validates only an already
present, unvalidated constraint; canonical creation validates a fresh
constraint as part of table creation.  Existing violations, `convalidated`,
lock duration, and failure behavior are therefore not equivalent
(**CB3 FAILED**).

For a fresh database created by `000001`, the target check is present and
already valid, so this source block does not validate it.  For an existing
database, validation reads all relevant rows and can fail if any target-type
and nullable-column combination violates the check; it also changes catalog
validation state and can hold an `ALTER TABLE` lock.  The selected source
  literal itself does not perform the payment-reference updates.  The exact
  full-rollout update records are
  `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668` and
  `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf`; the
  separate `business-growth/bundle-payment-backfill` record documents only the
  current-version fast-path sequence where target-check validation precedes
  payment backfill and trigger/data reconciliation.  No production rows,
  constraint state, or either branch's execution result was inspected.

### Preconditions, postconditions, recovery, and decisions

- Mapping dependencies are `schema:<dynamic>` and
  `table:<dynamic>.education_bundle_purchases`; the exact full-rollout
  additional-operation IDs are
  `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668` and
  `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf`, plus
  `business-growth/advisory-lock-and-session-state`,
  `business-growth/rollout-marker-read`, and
  `business-growth/rollout-marker-write`.  The full-path dependency supplement
  is [in the dependency matrix](dependency-matrix.md#fast-path-versus-full-rollout).
  These IDs are source-derived dependencies, not proof that the selected static
  occurrence executed.
- The separate current-version fast path has additional
  `business-growth/bundle-payment-immutability-function` evidence at source
  lines `5112-5120`, in addition to its trigger and payment backfill
  operations.  That function-replacement ID belongs to the distinct fast-path
  branch; it is cross-owner/branch context, not an additional dependency or
  selection for the static `71356...` occurrence.
- The full-rollout function record
  `ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb` covers
  source lines `4939-4951` on the separate payment trigger/function edge.  It
  is related branch evidence, not a dependency of the selected target-check
  row; the fast-path function record above remains branch-labelled separately.
- Preconditions are the target table/constraint existing, the constraint being
  `NOT VALID`, all existing rows satisfying the exact predicate, compatible
  writers, and an approved lock/timeout window.
- The occurrence-specific postcondition is conditional: if the named
  pre-existing constraint is found `NOT VALID` and validation succeeds, this
  occurrence leaves that same constraint with `convalidated = true`.  It does
  not create, replace, or prove the definition; it does not prove that all
  later eighth-owner target-check work completed; and it does not support a
  blanket “no unreviewed data mutation” claim for the surrounding owner
  branches.  The selected literal itself performs no payment-reference or
  learner-ID update.
- The statement runs in the autocommitted sequential array under the
  advisory lock.  Validation lock strength, timeout, transaction equivalence
  to canonical migration, and behavior after a partial failure remain
  unverified.  The separate fast-path evidence says its guard occurs at
  `5087` and validation at `5088-5098`; that branch can be selected by marker
  state.
- If validation fails, preceding autocommitted DDL remains committed and the
  marker is not written; retry is not recovery.  Recovery needs a reviewed
  data-cleanup/compensation decision and a safe revalidation boundary.  The
  `IF EXISTS` catalog checks are not rollback.
- Business decision required: approve the exact target-type invariant, owner
  for resolving violating rows, whether validation may block writers, and how
  it coordinates with the two full-rollout payment updates and trigger/data
  changes.  The curated `bundle-payment-backfill` record remains a
  fast-path-only cross-reference.
- Unknowns include target database/schema, table and constraint existence and
  validation state, violating-row count/content, concurrent writers, lock and
  timeout behavior, marker/ledger correctness, full-rollout and separate
  fast-path payment-backfill effects, backup/restore evidence, and dependent
  release compatibility.

### Resolution gates

| Gate | Result and finding |
| --- | --- |
| CB1 | **PASSED** — complete conditional SQL, dynamic identifiers, owner/path, source position, order, and the selected occurrence are recorded; the fast-path fingerprint and the supplementary same-literal inventory alias are not collapsed into this selection. |
| CB2 | **PASSED** — canonical constraint definition lines 3445-3448 was compared directly as a definition slice; this does not claim that the first-owner validation replaces the later eighth-owner constraint, and it is not a generated semantics flag or CB7 inference. |
| CB3 | **FAILED** — fresh constraint creation and existing `NOT VALID` validation are different transitions, with different data/lock/failure semantics. |
| CB4 | **UNKNOWN — NOT SATISFIED** — fresh no-op behavior is identifiable, but existing constraint state, violating rows, and concurrent writers are uninspected. |
| CB5 | **UNKNOWN — NOT SATISFIED** — source autocommit/lock/cleanup is known; canonical and validation lock/timeout/partial-failure equivalence is not. |
| CB6 | **UNKNOWN — NOT SATISFIED** — no production catalog, row-invariant, target-identity, or dependent application evidence exists. |
| CB7 | **UNKNOWN — NOT SATISFIED** — no independent reviewer disposition exists. |
| FM1 | **PASSED** — delta is exact: conditionally validate an existing unvalidated bundle target check, distinct from fresh canonical creation. |
| FM2 | **UNKNOWN — NOT SATISFIED** — no approved future manifest, immutable SQL/checksum, transaction mode, dependencies, or recovery procedure exists. |
| FM3 | **UNKNOWN — NOT SATISFIED** — no plan proves fresh/existing behavior, violating-row handling, concurrent writers, retries, partial completion, or the later eighth-owner drop/backfill/add/validate replacement sequence. |
| FM4 | **UNKNOWN — NOT SATISFIED** — required read-only production constraint/data evidence is unavailable. |
| FM5 | **UNKNOWN — NOT SATISFIED** — invariant owner, violating-row business decision, backup/restore or compensation, and rollback boundary are open. |
| FM6 | **UNKNOWN — NOT SATISFIED** — the full-path supplement is the exact pair `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668` and `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf`, plus the runner/marker IDs; the curated `business-growth/bundle-payment-backfill` is fast-path-only, while full function `ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb` belongs to the separate trigger edge and fast function `business-growth/bundle-payment-immutability-function` remains a fast-path cross-reference. Complete ordering, the eighth-owner target-check/learner reconciliation, and independent recovery are not proven. See the [dependency-matrix supplement](dependency-matrix.md#fast-path-versus-full-rollout). |
| FM7 | **UNKNOWN — NOT SATISFIED** — no independent approval exists. |
| RH1 | **FAILED** — the static validation literal remains reachable on the non-fast-path owner branch; a current marker cannot prove retirement. |
| RH2 | **FAILED** — canonical fresh constraint creation is not a transition-equivalent replacement for existing `NOT VALID` validation or for the later eighth-owner drop/backfill/add/validate replacement. |
| RH3 | **UNKNOWN — NOT SATISFIED** — production constraint/data state and any replacement deployment are unverified. |
| RH4 | **UNKNOWN — NOT SATISFIED** — violating-row cleanup, payment-backfill/trigger coordination, learner-ID reconciliation, later target-check replacement, lock, and recovery obligations are unknown. |
| RH5 | **UNKNOWN — NOT SATISFIED** — removal owner, release boundary, observability, and rollback/revalidation plan are absent. |
| RH6 | **UNKNOWN — NOT SATISFIED** — no independent retirement review exists. |

**Status:** `UNRESOLVED`
**Non-authoritative recommendation:** Candidate for FUTURE_MIGRATION_REQUIRED review.

## Practical methodology issues and conclusion

This pilot exposes several review hazards that a name-based crosswalk would
miss:

1. The inventory summary can be shorter than the executable literal.  The
   enum summary hides a conditional row update and a catalog rename; the
   bundle summary hides a catalog probe and `NOT VALID` condition.
2. Dynamic identifiers (`${s}` and related quoted-schema expressions) make a
   static canonical name match insufficient.  The selected source locators,
   full SQL, checksums, execution paths, and source order are therefore
   retained.
3. A canonical fresh schema can show a final object while saying nothing about
   an existing-database rename, drop, validation, backfill, lock, or partial
   failure.  The extension's schema/version/privilege state and the index's
   workload role are similarly absent from a fresh fingerprint.
4. Autocommit changes the recovery boundary.  A later marker write or a
   retry cannot roll back an earlier committed enum change, extension install,
   index drop, or validation-side catalog transition.
5. The marker fast path is operational scaffolding, not retirement evidence.
   It cannot prove historical reachability is gone, that old/missing/partial
   markers are safe, or that the bundle data transition completed.
6. The bundle validation is adjacent to additional operations with their own
    unresolved statuses.  Its full-path payment companions are
    `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668` and
    `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf`;
    `business-growth/bundle-payment-backfill` is only the branch-labelled
    fast-path record, while the full function record belongs to the separate
    trigger edge.  DDL classification cannot resolve any of these records,
    marker behavior, trigger replacement, or other additional operations.

Accordingly, the four exact mapping IDs documented here are:

- `5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec`
- `b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913`
- `2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5`
- `71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a`

All four remain **`UNRESOLVED`**.  No canonical, future-migration-ready, or
retired conclusion is authorized by this pilot.