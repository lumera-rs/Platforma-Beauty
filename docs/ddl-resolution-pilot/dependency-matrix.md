# DDL pilot dependency matrix

## Purpose and evidence boundary

This is the dependency companion to the eleven mappings named by
`docs/ddl-resolution-pilot/README.md`.  It is a documentation-only,
non-authoritative comparison of **what the immutable source and the
source-evidence JSON require** with **what the three pilot reports currently
say**.  It does not change a mapping or additional-operation status.  All
1,435 DDL mappings and all 110 additional operations remain `UNRESOLVED`.

The expected side was derived independently from:

* the executable owner source files, including source order and branch text;
* `docs/additional-operations-evidence/complete-evidence.json`, read as JSON
  text, including each additional operation's `sourcePath`,
  `sourceEvidence`, and execution narrative; and
* the already-audited static crosswalk boundary only as a source-shape
  reference.  Its imports are `node:crypto`, `node:fs`, `node:path`,
  `node:url`, `typescript`, and the inventory **type** (`scripts/src/
  startup-migration-crosswalk.ts:1-10`); no database or application import is
  part of this derivation.

The expected side is deliberately not copied from `business-growth.md`,
`other-owners.md`, or `booking-push-bundle.md`.  Those reports are the
documented side being checked.  The JSON and checker below retain the
independent source anchors so a reviewer can detect a stale report, a missing
ID, an unknown ID, a duplicate, or a missing edge.

## Bounded dependency convention

An edge is included only when it is a meaningful **semantic or operational**
relationship:

* **Direct additional operation:** the operation mutates a field/table that
  the mapping defines, validates, removes, or binds; replaces the function
  used by the mapping; or is the exact source-derived backfill immediately
  required by the mapping's own postcondition.
* **Indirect additional operation:** the operation gates the branch, records
  the completion state, supplies the same owner's transaction, advisory lock,
  session, timeout, or cleanup lifecycle, **or changes the later state that
  the owner transaction is required to leave valid**.  The last case is
  important for `education-bundle/learner-id-backfill`: it runs after the
  payment trigger is bound, but the same owner transaction rolls the trigger
  work back if that later learner/target-state sequence fails.  A
  postcondition edge (for example, a marker write after the DDL loop) is
  labelled as such; it is not misrepresented as a prerequisite.
* **Cross-owner edge:** a shared lock/lifecycle or a same-object
  function/trigger/data reconciliation between the first Business Growth
  owner and the eighth Education Bundle owner.  Owner order by itself is not
  enough; the shared lock or shared object/function/trigger must also be
  demonstrated.
* **DDL/function/trigger prerequisite:** a source-derived object, column,
  type, function, constraint state, data invariant, lock mode, or recovery
  condition needed for the operation's stated semantics.  These labels are
  not claims that the condition holds in production.

The following are **not** dependencies in this matrix: an unrelated earlier
statement that could fail and prevent a later statement from running; a
matching object name in `000001`; a report's assertion that an operation is
nearby; or a test/fake-client result.  Such facts can be documented as
execution context, but they do not create a semantic edge.

## Owner order, branch facts, and the cross-owner correction

The startup entrypoint awaits the owners in this order:

`ensureBusinessGrowthSchema` (first, `index.ts:84`) →
`ensureMediaSchema` (`:85`) →
`ensureShippingConfigSchema` (`:86`) →
`ensureMarketplacePerformanceIndexes` (`:87`) →
`ensureReferralSchema` (`:88`) →
`ensureWebPushSchema` (`:89`) →
`ensureBookingCommandSchema` (`:90`) →
`ensureEducationBundlePurchaseSchema` (eighth, `:91`).

The relevant source is `artifacts/api-server/src/index.ts:81-91`.
Business Growth takes `BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY` at
`business-growth-schema.ts:5002-5006`; Education Bundle imports that same
constant at `education-bundle-purchase-schema.ts:1` and takes it at
`:6-8`.  This is the operational `BG first → EducationBundle eighth` edge.
It is not a claim that every DDL statement in the first owner is a data
prerequisite for every statement in the eighth owner.

There are two demonstrated semantic cross-owner edges, plus a separate
trigger/function edge.  On a current-version
Business Growth fast path, the `to_regclass` guard and target-check validation
are at `business-growth-schema.ts:5035-5043,5087-5098`; the payment-reference
updates, replacement function, and replacement trigger are at
`:5099-5123`.  On the eighth-owner path, the corresponding payment updates,
function/trigger replacement, and learner update are at
`education-bundle-purchase-schema.ts:22-63`.  Business Growth's full rollout
has separate payment literals at `business-growth-schema.ts:4921-4951`,
while its selected static target-check mapping is `:4955-4965`.

Consequently:

1. The core Business Growth target condition and Education Bundle's later
   target-state overwrite are a real semantic cross-owner edge:
   Business Growth validates the existing target condition first, then owner
   eight drops old target checks (`:52-53`), performs the learner overwrite
   (`:54-58`), and adds/validates replacement checks (`:59-63`).  This is
   `edge:bg-target-condition-to-education-target-reconciliation`, not a
   target-condition→payment-trigger shortcut.
2. The related payment trigger/function replacement is a separate real edge:
   Business Growth's function/trigger replacement (`:4939-4951` and
   `:5112-5123`) overlaps Education Bundle's function/trigger replacement
   (`:39-51`).  This is
   `edge:bg-payment-trigger-function-to-education-trigger`, not part of the
   target-condition edge.
3. `education_bundle_purchases_target_check` validation and
   `education_bundle_purchases_payment_reference_immutable` trigger creation
   are therefore **not** collapsed into one mapping or treated as a
   target-check→trigger prerequisite.  The trigger mapping's direct local
   dependencies remain its payment backfill, function replacement, and
   transaction/lock; its later learner reconciliation is an indirect
   same-transaction dependency.
4. The Business Growth bundle fast-path record is a source-derived
   current-marker path.  It must not be silently presented as the same
   execution occurrence as the full-rollout payment literals.
5. `education-bundle/learner-id-backfill` is included below as an indirect
   same-owner transaction dependency.  It runs after the trigger
   (`education-bundle-purchase-schema.ts:49-51` then `:54-58`) and is relevant
   to later target-check validity; it is not claimed to supply the trigger
   function body or binding.

## Current documentation versus corrected expectation

The “documented” columns below are the dependency IDs explicitly claimed in
the current pilot reports.  The expected columns add the source-derived
cross-owner edges and make exclusions explicit; they do not turn any ID into
an approval.

This matrix is an authorized documentation supplement for the pilot package.
The prose matrix below and the corrected machine-readable `documentedRows`
are the delivered documentation coverage; they intentionally normalize the
source-backed relationships that the individual reports describe in prose.
`historicalRows` preserves the pre-supplement report snapshot so the
before/after distinction remains auditable.  `expectedRows` remains
independently source/evidence-derived and is not generated by copying either
documented list.  The inline checker requires the corrected `documentedRows`
baseline to be clean; it reports differences only when a separate historical
snapshot is inspected.

R1 historical provenance: read-only `git show` of original Task #938 delivery
`f1ca85a8f7795c92453ee6bc52ba32d11a26515d`, file
`docs/ddl-resolution-pilot/booking-push-bundle.md:632-664`, lists only
payment-reference-backfill, payment-reference-function and
transaction-and-advisory-lock. Accordingly, the historical trigger row omits
`education-bundle/learner-id-backfill`; the corrected documented/expected rows
retain it. This before/after fact comes from the committed report, not the
current matrix.

| Mapping ID (owner, source operation) | Current documented additional IDs | Corrected expected additional IDs (relation) | Expected cross-owner edge IDs | Key expected prerequisites | Source anchors |
|---|---|---|---|---|---|
| `5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec` (BG `alter-type`, `business-growth-schema.ts:1612`) | `ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d`; BG advisory lock; marker read/write | Same four: source-discovered (direct conditional `users.role` rewrite/enum rename); BG lock (indirect lifecycle); marker read (branch gate); marker write (full-path postcondition) | `edge:bg-first-to-education-eighth-shared-lock` | dynamic schema and `user_role`; `users.role`; old/new enum labels; compatible dependent writers | `business-growth-schema.ts:1594-1612,5002-5009,5035-5043,5134-5148`; `index.ts:84,91` |
| `b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913` (BG `create-extension`, `:255`) | BG advisory lock; marker read/write | Same three: lock, marker read, marker write | `edge:bg-first-to-education-eighth-shared-lock` | `pg_trgm` availability/version/privileges; target schema/search path; dependent operator/index behavior | `business-growth-schema.ts:255,5002-5009,5035-5043,5134-5148`; `index.ts:84,91` |
| `2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5` (BG `drop-index`, `:258`) | BG advisory lock; marker read/write | Same three: lock, marker read, marker write | `edge:bg-first-to-education-eighth-shared-lock` | dynamic schema; `salon_customers` table/index; approved replacement and query-usage decision; drop lock/rebuild recovery | `business-growth-schema.ts:258,5002-5009,5035-5043,5134-5148`; `index.ts:84,91` |
| `71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a` (BG `validate-constraint`, `:4962`) | BG bundle-payment-backfill; BG advisory lock; marker read/write | Full path: source-discovered-4923 and source-discovered-4928 payment literals (direct same-table reconciliation); lock; marker read; marker write. The fast-path bundle ID is explicitly excluded from this full-path set. | `edge:bg-first-to-education-eighth-shared-lock`; `edge:bg-target-condition-to-education-target-reconciliation` | dynamic bundle table; `target_check` present and `NOT VALID`; every existing row satisfies predicate; validation lock/timeout window | `business-growth-schema.ts:4921-4965,5035-5043,5087-5108,5134-5148`; `index.ts:84,91` |
| `7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d` (Media `create-table`, `media-schema.ts:17`) | Media transaction/advisory-lock | Same one: owner transaction/timeout/lock/release lifecycle (indirect) | none | `image_asset_status` type; `users` FK; `gen_random_uuid()`; target schema/search path; inline constraints | `media-schema.ts:11-38,105-109`; `index.ts:85` |
| `c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48` (Shipping `create-index`, `shipping-config.ts:63`) | Shipping duplicate-row-cleanup | Same one: cleanup is a direct precondition/data effect of the selected index | none | `shipping_rules` table; table lock; approved lowest-ID survivor; dynamic schema; index validity and committed-delete recovery | `shipping-config.ts:24-36,47-66`; `index.ts:86` |
| `aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4` (Marketplace `create-index`, `marketplace-performance-schema.ts:22`) | Marketplace advisory-lock-and-session-state | Same one: nontransactional concurrent-index lifecycle (indirect) | none | `appointments` and three key columns; no open transaction; timeout restoration; invalid-index inspection/recovery | `marketplace-performance-schema.ts:18-23,39-47`; `index.ts:87` |
| `a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1` (Referral `alter-table`, `referral-schema.ts:20`) | Referral tracking-start-backfill; Referral transaction/advisory-lock | Same two: timestamp backfill (direct data companion); transaction/lock (indirect) | none | dynamic qualification table/column; attribution FK/data; audit or `updated_at` fallback policy; eligible channels/status | `referral-schema.ts:16-23,27-41,49-55`; `index.ts:88` |
| `129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b` (Booking `create-index`, `booking-command-schema.ts:27`) | Booking transaction/advisory-lock | Same one: transaction/timeout/lock/release lifecycle (indirect) | none | receipt table and ordered four-key columns; dynamic schema; `salons` FK/table; duplicate-key state | `booking-command-schema.ts:9-34`; `index.ts:90` |
| `73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20` (Web Push `alter-table`, `web-push-schema.ts:80`) | Web Push source-discovered-82-dd7107a5f655438a; Web Push transaction/advisory-lock | Same two: expiry backfill (direct data companion); transaction/lock (indirect) | none | delivery table/column; `created_at`; null candidate rows; 24-hour policy; `SET NOT NULL` readiness | `web-push-schema.ts:10-24,58-84`; `index.ts:89` |
| `be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3` (Education Bundle `create-trigger`, `education-bundle-purchase-schema.ts:49`) | Education payment-reference-backfill; payment-reference-function; Education transaction/advisory-lock; learner-id-backfill | All four: payment backfill (direct); function replacement (direct); transaction/shared lock (indirect); learner-ID backfill (indirect later same-transaction state dependency) | `edge:bg-first-to-education-eighth-shared-lock`; `edge:bg-target-condition-to-education-target-reconciliation`; `edge:bg-payment-trigger-function-to-education-trigger` | bundle table and payment columns; payment-reference function; payment snapshot consistency; trigger drop/recreate; learner/target-state reconciliation; valid dynamic schema | `education-bundle-purchase-schema.ts:6-8,22-63,85`; BG `:4939-4951,5087-5123`; `index.ts:84,91` |

### What is missing from the current reports

The corrected matrix covers the eleven mappings and retains the report claims
as `historicalRows`.  It replaces the fast-path ID on the selected full-path
validation with the two exact full-rollout payment literals, while retaining
the full-rollout function record on the separate trigger/function edge.  The
completeness defect in the current reports is at the **edge and coverage**
level:

* The current reports explain the shared lock and owner order in prose, and
  the updated booking/Push/Bundle report lists all four Education Bundle IDs,
  but they do not express the normalized cross-owner edge IDs used here.
* The prior report was stale about
  `education-bundle/learner-id-backfill`.  The current report correctly
  includes it as an **indirect later target-state dependency**; the corrected
  matrix and documented row now include it too.
* The target-condition reconciliation and payment trigger/function
  replacement are separate normalized edges.  Neither should be replaced by
  a generic target-check→trigger edge.
* The full-rollout payment records
  `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668`,
  `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf`, and
  `ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb` are
  kept distinct from `business-growth/bundle-payment-backfill`.  The first
  two are included on the selected full-path validation; `4939` is included
  only on the separate trigger/function edge and is related-but-excluded from
  the target-check row.  The curated bundle record remains fast-path-only and
  is explicitly excluded from that full-path row.

Those cases are different from “a preceding statement could fail.”  They are
respectively a shared lock, target-state overwrite semantics, trigger/function
replacement, and an additional operation whose placement changes target-check
readiness while remaining inside the same transaction.

## Education Bundle operation coverage

All four Education Bundle additional-operation IDs are required in the
dependency review universe:

| ID | Source/evidence lines | Corrected relationship to the selected trigger mapping | Why it is included or excluded |
|---|---|---|---|
| `education-bundle/payment-reference-backfill` | owner `education-bundle-purchase-schema.ts:24-31`; evidence `complete-evidence.json:14563-14638` | **Included, direct** | It writes `payment_reference` and the JSON snapshot before function/trigger creation (`:22-31,39-51`). |
| `education-bundle/payment-reference-function` | owner `:39-47`; evidence `complete-evidence.json:14640-14716` | **Included, direct** | The trigger executes this function (`:49-51`); body replacement is a function prerequisite, not mere adjacency. |
| `education-bundle/transaction-and-advisory-lock` | owner `:6-8,85`; evidence `complete-evidence.json:14717-14798` | **Included, indirect** | It brackets the trigger and shares the Business Growth advisory lock. |
| `education-bundle/learner-id-backfill` | owner `:54-58`; evidence `complete-evidence.json:14486-14562` | **Included, indirect later same-transaction dependency** | It changes learner identity after trigger creation (`:49-51` → `:54-58`) and before replacement target-check work (`:59-63`). A later failure rolls the owner transaction back, so it is an owner/transaction dependency even though no trigger predicate reads `employee.user_id`. |

For the selected Business Growth target-check mapping, the learner update is
not placed in its local `additionalOperations` list as an earlier execution
prerequisite: the first-owner validation is at
`business-growth-schema.ts:4955-4965` (and fast-path equivalent
`:5087-5098`), while the learner update is in the eighth owner.  It is instead
represented by the real cross-owner
`edge:bg-target-condition-to-education-target-reconciliation`, whose
destination includes the later overwrite/replacement sequence.  This preserves
both the source order and the semantic dependency without claiming that a
later repair ran before the earlier validation.

## Fast path versus full rollout

The source has two materially different Business Growth paths:

* The marker read at `business-growth-schema.ts:5035-5043` can select the
  current-version fast path, which returns at `:5125`.  Its guarded bundle
  sequence is `:5087-5123`.  The curated
  `business-growth/bundle-payment-backfill` record is anchored to this
  source-discovered branch (`complete-evidence.json:3-126`), and its evidence
  explicitly says that full rollout has separate literals.
* When the marker is absent or behind, the full `statements` array is built at
  `:5128-5137`.  The payment updates are separate source literals at
  `:4923-4930` (source-discovered IDs
  `ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668` and
  `ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf` in
  `complete-evidence.json:6259-6490`).  The full path writes the rollout
  marker only after the loop at `:5139-5148`.

The selected static `validate-constraint` occurrence at `:4962` belongs to the
full `statements` path.  Its corrected dependency set therefore uses the two
full-rollout source-discovered payment literals (`4923` and `4928`), not
`business-growth/bundle-payment-backfill`.  The latter is retained only for
the current-marker fast path and the separate cross-owner trigger/function
edge.  It is never substituted for either full-path ID.  The full IDs are not
added to the three unrelated Business Growth mappings; this keeps the graph
bounded rather than turning all 98 Business Growth additional operations into
“dependencies” of one selected DDL statement.

## Machine-readable matrix and independently-derived checker input

The `expectedRows` arrays below are the reviewed presentation of the source
derivation.  The checker does **not** trust them as its expected dependency
sets: it reads the owner source and `complete-evidence.json`, selects evidence
records by source-line anchors, verifies the source snippets, derives the
cross-owner edges from owner order/shared lock/shared object text, and then
compares its result with these rows.  Thus changing an ID in both a hand list
and a report cannot make the checker pass.

```json
{
  "schemaVersion": 1,
  "status": "NON_AUTHORITATIVE",
  "authoritativeStatuses": {
    "ddlMappings": "UNRESOLVED",
    "additionalOperations": "UNRESOLVED"
  },
  "canonical": {
    "migration": "lib/db/migrations/000001_canonical_schema/migration.sql",
    "sha256": "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60"
  },
  "sourceInputs": [
    "artifacts/api-server/src/index.ts",
    "artifacts/api-server/src/lib/business-growth-schema.ts",
    "artifacts/api-server/src/lib/media-schema.ts",
    "artifacts/api-server/src/lib/shipping-config.ts",
    "artifacts/api-server/src/lib/marketplace-performance-schema.ts",
    "artifacts/api-server/src/lib/referral-schema.ts",
    "artifacts/api-server/src/lib/web-push-schema.ts",
    "artifacts/api-server/src/lib/booking-command-schema.ts",
    "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts",
    "docs/additional-operations-evidence/complete-evidence.json"
  ],
  "edgeIds": [
    "edge:bg-first-to-education-eighth-shared-lock",
    "edge:bg-target-condition-to-education-target-reconciliation",
    "edge:bg-payment-trigger-function-to-education-trigger"
  ],
  "expectedAdditionalOperationUniverse": [
    "ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d",
    "business-growth/advisory-lock-and-session-state",
    "business-growth/rollout-marker-read",
    "business-growth/rollout-marker-write",
    "business-growth/bundle-payment-backfill",
    "media/transaction-and-advisory-lock",
    "shipping/duplicate-row-cleanup",
    "marketplace/advisory-lock-and-session-state",
    "referral/tracking-start-backfill",
    "referral/transaction-and-advisory-lock",
    "ensureWebPushSchema/source-discovered-82-dd7107a5f655438a",
    "web-push/transaction-and-advisory-lock",
    "booking-command/transaction-and-advisory-lock",
    "education-bundle/payment-reference-backfill",
    "education-bundle/payment-reference-function",
    "education-bundle/transaction-and-advisory-lock",
    "education-bundle/learner-id-backfill",
    "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668",
    "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf",
    "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb"
  ],
  "expectedRows": [
    {
      "mapping": "5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec",
      "owner": "ensureBusinessGrowthSchema",
      "operation": "alter-type",
      "sourceLines": ["artifacts/api-server/src/lib/business-growth-schema.ts:1594-1612", "artifacts/api-server/src/index.ts:84"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:1275-1289"],
      "additionalOperations": [
        "ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d",
        "business-growth/advisory-lock-and-session-state",
        "business-growth/rollout-marker-read",
        "business-growth/rollout-marker-write"
      ],
      "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock"],
      "prerequisites": ["schema:<dynamic>", "type:<dynamic>.user_role", "table:<dynamic>.users", "column:<dynamic>.users.role", "old/new enum-label policy", "compatible role writers"],
      "inclusionReasons": ["The source-discovered DO block can update users.role or rename the enum.", "The shared runner lock and marker read/write govern reachability and completion."],
      "exclusionReasons": ["No payment, learner, trigger, or unrelated preceding-owner operation is a prerequisite of the enum transition."]
    },
    {
      "mapping": "b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913",
      "owner": "ensureBusinessGrowthSchema",
      "operation": "create-extension",
      "sourceLines": ["artifacts/api-server/src/lib/business-growth-schema.ts:255", "artifacts/api-server/src/index.ts:84"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:41-52"],
      "additionalOperations": ["business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"],
      "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock"],
      "prerequisites": ["schema:pg_catalog", "extension:pg_trgm availability/version/privileges", "runtime target schema/search_path", "dependent operator/index compatibility"],
      "inclusionReasons": ["Only the BG lifecycle and branch marker operations govern this DDL; no direct extension additional-operation record exists."],
      "exclusionReasons": ["A name match in canonical SQL and unrelated BG data backfills do not establish an extension dependency."]
    },
    {
      "mapping": "2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5",
      "owner": "ensureBusinessGrowthSchema",
      "operation": "drop-index",
      "sourceLines": ["artifacts/api-server/src/lib/business-growth-schema.ts:258", "artifacts/api-server/src/index.ts:84"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:14173-14183"],
      "additionalOperations": ["business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"],
      "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock"],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.salon_customers", "index:<dynamic>.salon_customers_phone_lookup_normalized_idx", "approved replacement/query-usage decision", "drop/rebuild recovery boundary"],
      "inclusionReasons": ["The lock/marker operations govern the selected autocommitted BG statement and its branch."],
      "exclusionReasons": ["No additional operation records index usage, so no unrelated BG backfill is promoted to a dependency; the workload/rebuild conditions remain labels, not invented IDs."]
    },
    {
      "mapping": "71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a",
      "owner": "ensureBusinessGrowthSchema",
      "operation": "validate-constraint",
      "sourceLines": ["artifacts/api-server/src/lib/business-growth-schema.ts:4923-4930,4955-4965", "artifacts/api-server/src/index.ts:84"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:3445-3448"],
      "additionalOperations": ["ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668", "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf", "business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"],
      "relatedButExcludedAdditionalOperations": ["business-growth/bundle-payment-backfill", "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb"],
      "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock", "edge:bg-target-condition-to-education-target-reconciliation"],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.education_bundle_purchases", "constraint:education_bundle_purchases_target_check", "constraint state=NOT VALID", "all rows satisfy target predicate", "validation lock/timeout window"],
      "inclusionReasons": ["The selected validation is in the full statements array after the two full-rollout payment-reference literals; those source-discovered IDs are the exact full-path records.", "BG lifecycle IDs gate/finish the selected full rollout."],
      "exclusionReasons": ["business-growth/bundle-payment-backfill is current-marker fast-path evidence only and must not substitute for full-path records 4923 and 4928.", "Full-rollout function record 4939 touches the payment function rather than target-check fields.", "Education learner backfill is a later cross-owner target-state dependency, not an earlier local prerequisite; it is represented by the target-reconciliation edge.", "Education payment-reference function/trigger records touch different fields."]
    },
    {
      "mapping": "7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d",
      "owner": "ensureMediaSchema",
      "operation": "create-table",
      "sourceLines": ["artifacts/api-server/src/lib/media-schema.ts:11-38,105-109", "artifacts/api-server/src/index.ts:85"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:4662-4683,8253-8265,17696-17700"],
      "additionalOperations": ["media/transaction-and-advisory-lock"],
      "crossOwnerEdges": [],
      "prerequisites": ["schema:public", "type:public.image_asset_status", "table:public.users", "function:gen_random_uuid()", "target search_path and FK visibility"],
      "inclusionReasons": ["The media operation is in the transaction/timeout/advisory-lock ordered array."],
      "exclusionReasons": ["No media data-backfill additional ID is evidenced; unrelated earlier media literals are DDL order, not additional-operation dependencies."]
    },
    {
      "mapping": "c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48",
      "owner": "ensureShippingConfigSchema",
      "operation": "create-index",
      "sourceLines": ["artifacts/api-server/src/lib/shipping-config.ts:24-36,47-66", "artifacts/api-server/src/index.ts:86"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:6536-6548,14558-14561"],
      "additionalOperations": ["shipping/duplicate-row-cleanup"],
      "crossOwnerEdges": [],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.shipping_rules", "table lock", "approved lowest-ID survivor", "unique-index validity and restore boundary"],
      "inclusionReasons": ["The exact same helper locks shipping_rules, deletes all but the lowest UUID, then creates this index."],
      "exclusionReasons": ["The wrapper lifecycle is recorded inside the cleanup evidence; no fabricated separate shipping lock ID is added.", "Failure of an unrelated preceding owner is not a dependency."]
    },
    {
      "mapping": "aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4",
      "owner": "ensureMarketplacePerformanceIndexes",
      "operation": "create-index-concurrently",
      "sourceLines": ["artifacts/api-server/src/lib/marketplace-performance-schema.ts:18-23,39-47", "artifacts/api-server/src/index.ts:87"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:2037-2065,9755-9758"],
      "additionalOperations": ["marketplace/advisory-lock-and-session-state"],
      "crossOwnerEdges": [],
      "prerequisites": ["schema:public", "table:public.appointments", "columns:employee_id,appointment_date,status", "nontransactional execution", "invalid-index inspection/recovery"],
      "inclusionReasons": ["The selected statement is the first operation inside the no-transaction concurrent-index lifecycle."],
      "exclusionReasons": ["The other three marketplace concurrent indexes are not prerequisites of this selected index; they share a loop but have no semantic edge to its key."]
    },
    {
      "mapping": "a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1",
      "owner": "ensureReferralSchema",
      "operation": "alter-table",
      "sourceLines": ["artifacts/api-server/src/lib/referral-schema.ts:16-23,27-41,49-55", "artifacts/api-server/src/index.ts:88"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:5645-5663,18560-18564"],
      "additionalOperations": ["referral/tracking-start-backfill", "referral/transaction-and-advisory-lock"],
      "crossOwnerEdges": [],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.referral_qualifications", "column:tracking_started_at", "referral_attributions linkage", "audit/updated_at fallback policy", "eligible channel/status rows"],
      "inclusionReasons": ["The backfill immediately consumes the new column in the same transaction; the owner lifecycle encloses both."],
      "exclusionReasons": ["Other referral column additions and enum repair are not semantic prerequisites of this nullable column plus timestamp policy."]
    },
    {
      "mapping": "129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b",
      "owner": "ensureBookingCommandSchema",
      "operation": "create-index",
      "sourceLines": ["artifacts/api-server/src/lib/booking-command-schema.ts:9-34", "artifacts/api-server/src/index.ts:90"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:2600-2614,10349-10353"],
      "additionalOperations": ["booking-command/transaction-and-advisory-lock"],
      "crossOwnerEdges": [],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.booking_command_receipts", "columns:salon_id,actor_type,actor_id,idempotency_key", "table:<dynamic>.salons", "duplicate-key state"],
      "inclusionReasons": ["The selected index is statement two inside the owner transaction/timeout/advisory-lock wrapper."],
      "exclusionReasons": ["The preceding receipt-table CREATE is DDL in the same owner, not an additional operation; there is no booking data-backfill ID."]
    },
    {
      "mapping": "73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20",
      "owner": "ensureWebPushSchema",
      "operation": "alter-table",
      "sourceLines": ["artifacts/api-server/src/lib/web-push-schema.ts:10-24,58-84", "artifacts/api-server/src/index.ts:89"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:6711-6734,14670-14701"],
      "additionalOperations": ["ensureWebPushSchema/source-discovered-82-dd7107a5f655438a", "web-push/transaction-and-advisory-lock"],
      "crossOwnerEdges": [],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.system_push_deliveries", "column:created_at", "null expiry rows", "approved 24-hour policy", "SET NOT NULL readiness"],
      "inclusionReasons": ["The source-discovered record contains the line-82 UPDATE between the add-column and SET NOT NULL statements; the owner lifecycle encloses it."],
      "exclusionReasons": ["Acknowledged_at and later indexes are DDL sequence context, not additional-operation dependencies for the expiry column."]
    },
    {
      "mapping": "be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3",
      "owner": "ensureEducationBundlePurchaseSchema",
      "operation": "create-trigger",
      "sourceLines": ["artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:6-8,22-58,85", "artifacts/api-server/src/index.ts:84,91"],
      "canonicalLines": ["lib/db/migrations/000001_canonical_schema/migration.sql:1693-1706,14775-14778"],
      "additionalOperations": ["education-bundle/payment-reference-backfill", "education-bundle/payment-reference-function", "education-bundle/transaction-and-advisory-lock", "education-bundle/learner-id-backfill"],
      "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock", "edge:bg-target-condition-to-education-target-reconciliation", "edge:bg-payment-trigger-function-to-education-trigger"],
      "prerequisites": ["schema:<dynamic>", "table:<dynamic>.education_bundle_purchases", "columns:payment_reference,payment_instructions", "function:<dynamic>.reject_bundle_payment_reference_change()", "payment snapshot consistency", "drop/recreate trigger boundary", "learner/target-state reconciliation"],
      "inclusionReasons": ["The backfill precedes the function and trigger in owner eight; the trigger executes the replaced function; the shared transaction/lock encloses all four operations; learner reconciliation occurs later in the same transaction and failure rolls the trigger work back."],
      "exclusionReasons": ["BG target-condition validation is a separate cross-owner semantic edge, not a trigger prerequisite; BG payment trigger/function replacement is represented by its separate cross-owner edge."]
    }
  ],
  "historicalRows": [
    {"mapping": "5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec", "additionalOperations": ["ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d", "business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>"]},
    {"mapping": "b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913", "additionalOperations": ["business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": [], "prerequisites": ["schema:pg_catalog"]},
    {"mapping": "2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5", "additionalOperations": ["business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.salon_customers"]},
    {"mapping": "71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a", "additionalOperations": ["business-growth/bundle-payment-backfill", "business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.education_bundle_purchases"]},
    {"mapping": "7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d", "additionalOperations": ["media/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:public"]},
    {"mapping": "c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48", "additionalOperations": ["shipping/duplicate-row-cleanup"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.shipping_rules"]},
    {"mapping": "aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4", "additionalOperations": ["marketplace/advisory-lock-and-session-state"], "crossOwnerEdges": [], "prerequisites": ["schema:public", "table:public.appointments"]},
    {"mapping": "a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1", "additionalOperations": ["referral/tracking-start-backfill", "referral/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>"]},
    {"mapping": "129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b", "additionalOperations": ["booking-command/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.booking_command_receipts"]},
    {"mapping": "73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20", "additionalOperations": ["ensureWebPushSchema/source-discovered-82-dd7107a5f655438a", "web-push/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>"]},
    {"mapping": "be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3", "additionalOperations": ["education-bundle/payment-reference-backfill", "education-bundle/payment-reference-function", "education-bundle/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.education_bundle_purchases"]}
  ],
  "documentedRows": [
    {"mapping": "5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec", "additionalOperations": ["ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d", "business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock"], "prerequisites": ["schema:<dynamic>", "type:<dynamic>.user_role", "table:<dynamic>.users", "column:<dynamic>.users.role", "old/new enum-label policy", "compatible role writers"]},
    {"mapping": "b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913", "additionalOperations": ["business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock"], "prerequisites": ["schema:pg_catalog", "extension:pg_trgm availability/version/privileges", "runtime target schema/search_path", "dependent operator/index compatibility"]},
    {"mapping": "2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5", "additionalOperations": ["business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock"], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.salon_customers", "index:<dynamic>.salon_customers_phone_lookup_normalized_idx", "approved replacement/query-usage decision", "drop/rebuild recovery boundary"]},
    {"mapping": "71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a", "additionalOperations": ["ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668", "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf", "business-growth/advisory-lock-and-session-state", "business-growth/rollout-marker-read", "business-growth/rollout-marker-write"], "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock", "edge:bg-target-condition-to-education-target-reconciliation"], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.education_bundle_purchases", "constraint:education_bundle_purchases_target_check", "constraint state=NOT VALID", "all rows satisfy target predicate", "validation lock/timeout window"]},
    {"mapping": "7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d", "additionalOperations": ["media/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:public", "type:public.image_asset_status", "table:public.users", "function:gen_random_uuid()", "target search_path and FK visibility"]},
    {"mapping": "c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48", "additionalOperations": ["shipping/duplicate-row-cleanup"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.shipping_rules", "table lock", "approved lowest-ID survivor", "unique-index validity and restore boundary"]},
    {"mapping": "aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4", "additionalOperations": ["marketplace/advisory-lock-and-session-state"], "crossOwnerEdges": [], "prerequisites": ["schema:public", "table:public.appointments", "columns:employee_id,appointment_date,status", "nontransactional execution", "invalid-index inspection/recovery"]},
    {"mapping": "a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1", "additionalOperations": ["referral/tracking-start-backfill", "referral/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.referral_qualifications", "column:tracking_started_at", "referral_attributions linkage", "audit/updated_at fallback policy", "eligible channel/status rows"]},
    {"mapping": "129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b", "additionalOperations": ["booking-command/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.booking_command_receipts", "columns:salon_id,actor_type,actor_id,idempotency_key", "table:<dynamic>.salons", "duplicate-key state"]},
    {"mapping": "73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20", "additionalOperations": ["ensureWebPushSchema/source-discovered-82-dd7107a5f655438a", "web-push/transaction-and-advisory-lock"], "crossOwnerEdges": [], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.system_push_deliveries", "column:created_at", "null expiry rows", "approved 24-hour policy", "SET NOT NULL readiness"]},
    {"mapping": "be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3", "additionalOperations": ["education-bundle/payment-reference-backfill", "education-bundle/payment-reference-function", "education-bundle/transaction-and-advisory-lock", "education-bundle/learner-id-backfill"], "crossOwnerEdges": ["edge:bg-first-to-education-eighth-shared-lock", "edge:bg-target-condition-to-education-target-reconciliation", "edge:bg-payment-trigger-function-to-education-trigger"], "prerequisites": ["schema:<dynamic>", "table:<dynamic>.education_bundle_purchases", "columns:payment_reference,payment_instructions", "function:<dynamic>.reject_bundle_payment_reference_change()", "payment snapshot consistency", "drop/recreate trigger boundary", "learner/target-state reconciliation"]}
  ],
  "coverageRequiredIds": [
    "education-bundle/payment-reference-backfill",
    "education-bundle/payment-reference-function",
    "education-bundle/transaction-and-advisory-lock",
    "education-bundle/learner-id-backfill",
    "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668",
    "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf",
    "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb"
  ],
  "coverageLedger": {
    "education-bundle/payment-reference-backfill": {"state": "included", "rows": ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"]},
    "education-bundle/payment-reference-function": {"state": "included", "rows": ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"]},
    "education-bundle/transaction-and-advisory-lock": {"state": "included", "rows": ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"]},
    "education-bundle/learner-id-backfill": {"state": "included-indirect", "rows": ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"], "crossOwnerRows": ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a"], "reason": "Later same-owner transaction update; failure rolls back trigger work, and it supplies the later target-state reconciliation."},
    "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668": {"state": "included-direct", "rows": ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a"], "reason": "Full-rollout payment_reference backfill literal at business-growth-schema.ts:4923, in the same statements path before the selected validation."},
    "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf": {"state": "included-direct", "rows": ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a"], "reason": "Full-rollout payment_instructions reconciliation literal at business-growth-schema.ts:4928, in the same statements path before the selected validation."},
    "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb": {"state": "included-cross-owner", "rows": [], "crossOwnerRows": ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"], "relatedButExcludedRows": ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a"], "reason": "Full-rollout payment-reference function replacement at business-growth-schema.ts:4939; included for the separate trigger/function cross-owner edge, not as a target-check predicate prerequisite."}
  },
  "expectedCrossOwnerEdges": {
    "edge:bg-first-to-education-eighth-shared-lock": {
      "kind": "shared-advisory-lock-and-owner-order",
      "fromOwner": "ensureBusinessGrowthSchema",
      "toOwner": "ensureEducationBundlePurchaseSchema",
      "fromOwnerOrder": 1,
      "toOwnerOrder": 8,
      "additionalOperationIds": ["business-growth/advisory-lock-and-session-state", "education-bundle/transaction-and-advisory-lock"],
      "sourceLines": ["artifacts/api-server/src/index.ts:84-91", "artifacts/api-server/src/lib/business-growth-schema.ts:5002-5006", "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:1,6-8,85"],
      "notADataPrerequisite": true
    },
    "edge:bg-target-condition-to-education-target-reconciliation": {
      "kind": "target-condition-to-later-target-state-overwrite",
      "fromOwner": "ensureBusinessGrowthSchema",
      "toOwner": "ensureEducationBundlePurchaseSchema",
      "mappingIds": ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a", "be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"],
      "additionalOperationIds": ["education-bundle/learner-id-backfill"],
      "sourceLines": ["artifacts/api-server/src/lib/business-growth-schema.ts:4921-4965", "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:52-63"],
      "notADataPrerequisite": false,
      "orderingCaveat": "The later learner overwrite cannot repair the earlier BG validation; this edge records the shared target-state obligation and later replacement, not reverse execution order."
    },
    "edge:bg-payment-trigger-function-to-education-trigger": {
      "kind": "separate-payment-function-trigger-replacement-overlap",
      "fromOwner": "ensureBusinessGrowthSchema",
      "toOwner": "ensureEducationBundlePurchaseSchema",
      "mappingIds": ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"],
      "additionalOperationIds": ["ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb", "business-growth/bundle-payment-backfill", "education-bundle/payment-reference-function"],
      "sourceLines": ["artifacts/api-server/src/lib/business-growth-schema.ts:4939-4951,5112-5123", "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:39-51"],
      "notADataPrerequisite": true
    }
  },
  "comparisonRules": {
    "perMapping": ["missing = source-derived expected additionalOperations, crossOwnerEdges, or prerequisites absent from corrected documentedRows", "unknown = documented IDs/edges/prerequisites absent from source-derived universes", "unexpected-valid = a known evidence ID or edge attached to the wrong mapping", "duplicates = repeated mapping, additional-operation, edge, or prerequisite IDs", "prerequisites are compared as exact sets in both directions, not by subset or regex-only presence"],
    "global": ["all 11 mapping IDs occur once in expectedRows and documentedRows", "expectedRows and expectedAdditionalOperationUniverse contain no duplicate IDs", "all expected additional-operation IDs occur in complete-evidence.json exactly once", "all four Education Bundle IDs occur in coverageLedger", "every edge ID has a source-backed definition", "no status is inferred or changed"]
  },
  "negativeCases": [
    {"name": "omit-learner", "inMemoryMutation": "remove education-bundle/learner-id-backfill from the documented trigger row", "mustReport": ["missing additional-operation ID"], "reason": "The later learner overwrite is an indirect same-transaction dependency and must be retained."},
    {"name": "omit-cross-owner-edge", "inMemoryMutation": "remove edge:bg-target-condition-to-education-target-reconciliation from the documented target row", "mustReport": ["missing cross-owner edge"], "reason": "BG target validation and Education target-state overwrite are independently source-backed."},
    {"name": "omit-prerequisite", "inMemoryMutation": "remove learner/target-state reconciliation from the documented trigger row prerequisites", "mustReport": ["missing prerequisite edge"], "reason": "The checker must report missing semantic prerequisites, not only missing IDs."},
    {"name": "unknown-additional-id", "inMemoryMutation": "append 'education-bundle/not-in-evidence' to a documented row", "mustReport": ["unknown-additional-operation"], "reason": "Every ID must resolve in complete-evidence.json."},
    {"name": "duplicate-additional-id", "inMemoryMutation": "append the same payment-reference-function ID twice to the trigger row", "mustReport": ["duplicate-additional-operation"], "reason": "Duplicate counting is not dependency completeness."},
    {"name": "valid-id-wrong-mapping", "inMemoryMutation": "append shipping/duplicate-row-cleanup to the media row", "mustReport": ["unexpected-valid-additional-operation"], "reason": "A known evidence ID is still wrong when attached to the wrong mapping."},
    {"name": "valid-edge-wrong-mapping", "inMemoryMutation": "append edge:bg-target-condition-to-education-target-reconciliation to the media row", "mustReport": ["unexpected-valid-cross-owner-edge"], "reason": "A known edge must be attached only to its source-derived mappings."},
    {"name": "duplicate-mapping-row", "inMemoryMutation": "append a copy of the media documented row", "mustReport": ["duplicate-mapping"], "reason": "The eleven mapping fingerprints are one-row identities."},
    {"name": "drop-fast-full-distinction", "inMemoryMutation": "replace ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668 with business-growth/bundle-payment-backfill on the documented target row", "mustReport": ["unexpected-additional-operation-or-branch-mismatch"], "reason": "The curated fast path and full-rollout source-discovered literal have distinct source lines and execution branches."},
    {"name": "preceding-failure-as-edge", "inMemoryMutation": "add media/transaction-and-advisory-lock to the marketplace row", "mustReport": ["unexpected-additional-operation"], "reason": "An unrelated earlier owner failure is not a semantic or operational dependency."}
  ]
}
```

## Reproducible in-memory checker (not an authoritative validator)

Run the following **from the repository root** once, after saving this
document.  It uses only `node:fs`, `node:path`, JSON parsing, and string/line
inspection.  It never imports an owner module, the database package, the
crosswalk builder, or a test runner; it never opens a database.  The expected
dependency IDs are derived by matching source-line anchors against
`complete-evidence.json`; the JSON block above is checked as the document
under review, not used as the source of truth.

```js
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const doc = "docs/ddl-resolution-pilot/dependency-matrix.md";
const text = fs.readFileSync(path.join(root, doc), "utf8");
const jsonText = text.match(/```json\n([\s\S]*?)\n```/u)?.[1];
if (!jsonText) throw new Error("machine-readable JSON block not found");
const matrix = JSON.parse(jsonText);
const evidence = JSON.parse(fs.readFileSync(path.join(root, "docs/additional-operations-evidence/complete-evidence.json"), "utf8"));
const evidenceIds = new Set(evidence.map((item) => item.id));
const errors = [];

function recordSpans(locator) {
  const result = [];
  let file;
  for (const part of locator.split(",")) {
    const value = part.trim();
    const withFile = value.match(/^(.+?):(\d+)(?:-\d+)?(?::\d+)?$/u);
    const continuation = value.match(/^(\d+)(?:-(\d+))?(?::\d+)?$/u);
    if (withFile) {
      file = withFile[1];
      const match = value.match(/^(.+?):(\d+)(?:-(\d+))?(?::\d+)?$/u);
      result.push({ file, start: Number(match[2]), end: Number(match[3] ?? match[2]) });
    } else if (continuation && file) {
      result.push({ file, start: Number(continuation[1]), end: Number(continuation[2] ?? continuation[1]) });
    } else {
      throw new Error(`cannot parse source span ${locator}`);
    }
  }
  return result;
}

function overlaps(record, file, start, end) {
  return recordSpans(record.sourcePath).some((span) =>
    span.file === file && span.start <= end && start <= span.end);
}

function evidenceOverlaps(record, file, start, end) {
  return (Array.isArray(record.sourceEvidence) ? record.sourceEvidence : []).some((item) =>
    item && item.path === file && Number(item.startLine) <= end && start <= Number(item.endLine));
}

function idsAt(anchors) {
  const ids = [];
  for (const anchor of anchors) {
    const bySourcePath = evidence.filter((record) =>
      overlaps(record, anchor.file, anchor.start, anchor.end));
    const found = bySourcePath.length ? bySourcePath : evidence.filter((record) =>
      evidenceOverlaps(record, anchor.file, anchor.start, anchor.end));
    if (found.length === 0) errors.push(`no evidence record at ${anchor.file}:${anchor.start}-${anchor.end}`);
    ids.push(...found.map((record) => record.id));
  }
  return ids;
}

function source(file, start, end) {
  return fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/u).slice(start - 1, end).join("\n");
}

const bg = "artifacts/api-server/src/lib/business-growth-schema.ts";
const edu = "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts";
const media = "artifacts/api-server/src/lib/media-schema.ts";
const shipping = "artifacts/api-server/src/lib/shipping-config.ts";
const marketplace = "artifacts/api-server/src/lib/marketplace-performance-schema.ts";
const referral = "artifacts/api-server/src/lib/referral-schema.ts";
const booking = "artifacts/api-server/src/lib/booking-command-schema.ts";
const webPush = "artifacts/api-server/src/lib/web-push-schema.ts";
const index = source("artifacts/api-server/src/index.ts", 81, 91);
const ownerText = new Map([
  [bg, fs.readFileSync(path.join(root, bg), "utf8")],
  [edu, fs.readFileSync(path.join(root, edu), "utf8")],
  [media, fs.readFileSync(path.join(root, media), "utf8")],
  [shipping, fs.readFileSync(path.join(root, shipping), "utf8")],
  [marketplace, fs.readFileSync(path.join(root, marketplace), "utf8")],
  [referral, fs.readFileSync(path.join(root, referral), "utf8")],
  [booking, fs.readFileSync(path.join(root, booking), "utf8")],
  [webPush, fs.readFileSync(path.join(root, webPush), "utf8")]
]);
const selected = [
  ["5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec", bg, 1594, 1612],
  ["b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913", bg, 255, 255],
  ["2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5", bg, 258, 258],
  ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a", bg, 4955, 4965],
  ["7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d", "artifacts/api-server/src/lib/media-schema.ts", 17, 34],
  ["c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48", "artifacts/api-server/src/lib/shipping-config.ts", 47, 66],
  ["aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4", "artifacts/api-server/src/lib/marketplace-performance-schema.ts", 18, 23],
  ["a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1", "artifacts/api-server/src/lib/referral-schema.ts", 20, 20],
  ["129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b", "artifacts/api-server/src/lib/booking-command-schema.ts", 26, 29],
  ["73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20", "artifacts/api-server/src/lib/web-push-schema.ts", 80, 80],
  ["be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3", edu, 49, 51]
];
const depAnchors = [
  [[bg, 1594, 1612], [bg, 5002, 5010], [bg, 5036, 5043], [bg, 5145, 5148]],
  [[bg, 5002, 5010], [bg, 5036, 5043], [bg, 5145, 5148]],
  [[bg, 5002, 5010], [bg, 5036, 5043], [bg, 5145, 5148]],
  [[bg, 4923, 4923], [bg, 4928, 4928], [bg, 5002, 5010], [bg, 5036, 5043], [bg, 5145, 5148]],
  [["artifacts/api-server/src/lib/media-schema.ts", 105, 109]],
  [["artifacts/api-server/src/lib/shipping-config.ts", 24, 66]],
  [["artifacts/api-server/src/lib/marketplace-performance-schema.ts", 18, 20]],
  [["artifacts/api-server/src/lib/referral-schema.ts", 27, 41], ["artifacts/api-server/src/lib/referral-schema.ts", 16, 18]],
  [["artifacts/api-server/src/lib/booking-command-schema.ts", 9, 38]],
  [["artifacts/api-server/src/lib/web-push-schema.ts", 82, 82], ["artifacts/api-server/src/lib/web-push-schema.ts", 10, 25]],
  [[edu, 24, 31], [edu, 39, 47], [edu, 6, 12], [edu, 54, 58]]
].map((row) => row.map(([file, start, end]) => ({ file, start, end })));

for (const [mapping, file, start, end] of selected) {
  const snippet = source(file, start, end);
  if (!snippet.trim()) errors.push(`empty selected source ${mapping}`);
  const row = matrix.expectedRows.find((item) => item.mapping === mapping);
  if (!row) errors.push(`missing expected mapping row ${mapping}`);
  if (!row || !row.sourceLines.some((line) => line.includes(file))) {
    errors.push(`missing selected source locator in row ${mapping}`);
  }
}

const derivedRows = selected.map(([mapping], index) => ({
  mapping,
  additionalOperations: idsAt(depAnchors[index]),
  crossOwnerEdges: []
}));
const sharedLockEdge = index.includes("await ensureBusinessGrowthSchema();")
  && index.includes("await ensureEducationBundlePurchaseSchema();")
  && ownerText.get(bg).includes("BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY")
  && ownerText.get(edu).includes("BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY");
const targetReconciliationEdge = sharedLockEdge
  && ownerText.get(bg).includes("education_bundle_purchases_target_check")
  && ownerText.get(edu).includes("learner_user_id = employee.user_id")
  && ownerText.get(edu).includes("ADD CONSTRAINT");
const triggerFunctionEdge = ownerText.get(bg).includes("reject_bundle_payment_reference_change")
  && ownerText.get(edu).includes("reject_bundle_payment_reference_change")
  && ownerText.get(bg).includes("CREATE TRIGGER education_bundle_purchases_payment_reference_immutable");
const bgMappings = new Set([
  "5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec",
  "b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913",
  "2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5",
  "71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a"
]);
const targetMapping = "71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a";
const triggerMapping = "be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3";
for (const row of derivedRows) {
  const expected = matrix.expectedRows.find((item) => item.mapping === row.mapping);
  if (sharedLockEdge && (bgMappings.has(row.mapping) || row.mapping === triggerMapping)) {
    row.crossOwnerEdges.push("edge:bg-first-to-education-eighth-shared-lock");
  }
  if (targetReconciliationEdge && (row.mapping === targetMapping || row.mapping === triggerMapping)) {
    row.crossOwnerEdges.push("edge:bg-target-condition-to-education-target-reconciliation");
  }
  if (triggerFunctionEdge && row.mapping === triggerMapping) {
    row.crossOwnerEdges.push("edge:bg-payment-trigger-function-to-education-trigger");
  }
  if (!expected) continue;
  const expectedIds = [...expected.additionalOperations].sort();
  const actualIds = [...new Set(row.additionalOperations)].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) errors.push(`source-derived dependency mismatch for ${row.mapping}: expected ${expectedIds} derived ${actualIds}`);
  if (new Set(row.additionalOperations).size !== row.additionalOperations.length) errors.push(`duplicate derived dependency ID for ${row.mapping}`);
  if (JSON.stringify([...expected.crossOwnerEdges].sort()) !== JSON.stringify([...row.crossOwnerEdges].sort())) errors.push(`source-derived cross-owner edge mismatch for ${row.mapping}`);
}

const universeDuplicates = evidence.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
if (universeDuplicates.length) errors.push(`duplicate IDs in complete-evidence.json: ${universeDuplicates}`);
const expectedUniverse = new Set(matrix.expectedAdditionalOperationUniverse);
for (const id of expectedUniverse) if (!evidenceIds.has(id)) errors.push(`expected ID absent from complete-evidence.json: ${id}`);
for (const record of evidence) if (!Array.isArray(record.sourceEvidence)) errors.push(`sourceEvidence is not an object array for ${record.id}`);
for (const id of matrix.coverageRequiredIds) if (!matrix.coverageLedger[id]) errors.push(`missing coverage ledger entry: ${id}`);

const prerequisiteRules = new Map([
  ["5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec", [["schema:<dynamic>", /\$\{s\}/u], ["type:<dynamic>.user_role", /user_role/u], ["table:<dynamic>.users", /\busers\b/u], ["column:<dynamic>.users.role", /SET role|role =/u], ["old/new enum-label policy", /EDUCATION_CENTER_OWNER|EDUKATIVNI_CENTAR/u], ["compatible role writers", /users SET role|role =/u]]],
  ["b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913", [["schema:pg_catalog", /CREATE EXTENSION|pg_trgm/u], ["extension:pg_trgm availability/version/privileges", /pg_trgm/u], ["runtime target schema/search_path", /search_path/u], ["dependent operator/index compatibility", /pg_trgm|gin_trgm_ops/u]]],
  ["2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5", [["schema:<dynamic>", /\$\{s\}/u], ["table:<dynamic>.salon_customers", /salon_customers/u], ["index:<dynamic>.salon_customers_phone_lookup_normalized_idx", /salon_customers_phone_lookup_normalized_idx/u], ["approved replacement/query-usage decision", /DROP INDEX|CREATE INDEX|salon_customers/u], ["drop/rebuild recovery boundary", /rollback|unlock|cleanup/u]]],
  ["71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a", [["schema:<dynamic>", /\$\{s\}/u], ["table:<dynamic>.education_bundle_purchases", /education_bundle_purchases/u], ["constraint:education_bundle_purchases_target_check", /education_bundle_purchases_target_check/u], ["constraint state=NOT VALID", /NOT VALID|notconvalidated/u], ["all rows satisfy target predicate", /VALIDATE CONSTRAINT|target_type/u], ["validation lock/timeout window", /pg_advisory_lock|statement_timeout/u]]],
  ["7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d", [["schema:public", /image_assets/u], ["type:public.image_asset_status", /image_asset_status/u], ["table:public.users", /\busers\b/u], ["function:gen_random_uuid()", /gen_random_uuid/u], ["target search_path and FK visibility", /REFERENCES users|search_path|FOREIGN KEY/u]]],
  ["c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48", [["schema:<dynamic>", /\$\{schema\}/u], ["table:<dynamic>.shipping_rules", /shipping_rules/u], ["table lock", /LOCK TABLE|advisory_lock/u], ["approved lowest-ID survivor", /lowest|ORDER BY id|UUID/u], ["unique-index validity and restore boundary", /CREATE UNIQUE INDEX|rollback|restore/u]]],
  ["aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4", [["schema:public", /appointments/u], ["table:public.appointments", /appointments/u], ["columns:employee_id,appointment_date,status", /employee_id.*appointment_date.*status/u], ["nontransactional execution", /CONCURRENTLY|no transaction|transaction/u], ["invalid-index inspection/recovery", /invalid|restore|rollback/u]]],
  ["a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1", [["schema:<dynamic>", /\$\{schema\}/u], ["table:<dynamic>.referral_qualifications", /referral_qualifications/u], ["column:tracking_started_at", /tracking_started_at/u], ["referral_attributions linkage", /referral_attributions/u], ["audit/updated_at fallback policy", /coalesce|updated_at|business_verification_audits/u], ["eligible channel/status rows", /channel|pending_verification|status/u]]],
  ["129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b", [["schema:<dynamic>", /\$\{schema\}/u], ["table:<dynamic>.booking_command_receipts", /booking_command_receipts/u], ["columns:salon_id,actor_type,actor_id,idempotency_key", /salon_id.*actor_type.*actor_id.*idempotency_key/u], ["table:<dynamic>.salons", /salons/u], ["duplicate-key state", /UNIQUE|duplicate|idempotency_key/u]]],
  ["73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20", [["schema:<dynamic>", /\$\{schema\}/u], ["table:<dynamic>.system_push_deliveries", /system_push_deliveries/u], ["column:created_at", /created_at/u], ["null expiry rows", /IS NULL|expires_at/u], ["approved 24-hour policy", /24 hours|24-hour|interval/u], ["SET NOT NULL readiness", /SET NOT NULL/u]]],
  [triggerMapping, [["schema:<dynamic>", /\$\{schema\}/u], ["table:<dynamic>.education_bundle_purchases", /education_bundle_purchases/u], ["columns:payment_reference,payment_instructions", /payment_reference.*payment_instructions/u], ["function:<dynamic>.reject_bundle_payment_reference_change()", /reject_bundle_payment_reference_change/u], ["payment snapshot consistency", /payment_instructions|IS DISTINCT FROM/u], ["drop/recreate trigger boundary", /DROP TRIGGER|CREATE TRIGGER/u], ["learner/target-state reconciliation", /learner_user_id = employee\.user_id|target check/u]]]
]);
for (const [mapping, rules] of prerequisiteRules) {
  const selectedRow = selected.find(([id]) => id === mapping);
  const context = selectedRow ? ownerText.get(selectedRow[1]) : "";
  const expected = matrix.expectedRows.find((item) => item.mapping === mapping);
  const derived = rules.filter(([, pattern]) => pattern.test(context)).map(([label]) => label).sort();
  const presented = [...(expected?.prerequisites ?? [])].sort();
  if (JSON.stringify(derived) !== JSON.stringify(presented)) errors.push(`source-derived prerequisite mismatch for ${mapping}: expected ${presented} derived ${derived}`);
}

function duplicateIds(ids) {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

for (const mapping of duplicateIds(matrix.expectedRows.map((row) => row.mapping))) errors.push(`duplicate expected mapping ID: ${mapping}`);
for (const id of duplicateIds(matrix.expectedAdditionalOperationUniverse)) errors.push(`duplicate expected/universe operation ID: ${id}`);
for (const row of matrix.expectedRows) {
  for (const id of duplicateIds(row.additionalOperations)) errors.push(`duplicate expected additional-operation ID ${id} on ${row.mapping}`);
  for (const edge of duplicateIds(row.crossOwnerEdges)) errors.push(`duplicate expected cross-owner edge ${edge} on ${row.mapping}`);
  for (const label of duplicateIds(row.prerequisites)) errors.push(`duplicate expected prerequisite edge ${label} on ${row.mapping}`);
}
if (!Array.isArray(matrix.historicalRows) || matrix.historicalRows.length !== matrix.expectedRows.length) errors.push("historicalRows snapshot is missing or incomplete");

function diagnoseDocumented(rows) {
  const findings = [];
  const expectedByMapping = new Map(matrix.expectedRows.map((row) => [row.mapping, row]));
  const seenMappings = rows.map((row) => row.mapping);
  for (const mapping of duplicateIds(seenMappings)) findings.push(`duplicate mapping: ${mapping}`);
  for (const row of rows) {
    const expected = expectedByMapping.get(row.mapping);
    if (!expected) {
      findings.push(`unknown mapping: ${row.mapping}`);
      continue;
    }
    const documentedIds = row.additionalOperations ?? [];
    const expectedIds = new Set(expected.additionalOperations);
    for (const id of duplicateIds(documentedIds)) findings.push(`duplicate additional-operation ID ${id} on ${row.mapping}`);
    for (const id of documentedIds) {
      if (!expectedUniverse.has(id) || !evidenceIds.has(id)) findings.push(`unknown additional-operation ID ${id} on ${row.mapping}`);
      else if (!expectedIds.has(id)) findings.push(`unexpected valid additional-operation ID ${id} on ${row.mapping}`);
    }
    for (const id of expectedIds) if (!documentedIds.includes(id)) findings.push(`missing additional-operation ID ${id} on ${row.mapping}`);
    const documentedEdges = row.crossOwnerEdges ?? [];
    for (const edge of duplicateIds(documentedEdges)) findings.push(`duplicate cross-owner edge ${edge} on ${row.mapping}`);
    for (const edge of documentedEdges) {
      if (!matrix.edgeIds.includes(edge)) findings.push(`unknown cross-owner edge ${edge} on ${row.mapping}`);
      else if (!expected.crossOwnerEdges.includes(edge)) findings.push(`unexpected valid cross-owner edge ${edge} on ${row.mapping}`);
    }
    for (const edge of expected.crossOwnerEdges) if (!documentedEdges.includes(edge)) findings.push(`missing cross-owner edge ${edge} on ${row.mapping}`);
    const documentedPrereqs = row.prerequisites ?? [];
    for (const label of duplicateIds(documentedPrereqs)) findings.push(`duplicate prerequisite edge ${label} on ${row.mapping}`);
    const selectedOwner = selected.find(([id]) => id === row.mapping)?.[1];
    const sourcePrerequisites = (prerequisiteRules.get(row.mapping) ?? [])
      .filter(([, pattern]) => pattern.test(ownerText.get(selectedOwner) ?? ""))
      .map(([label]) => label);
    for (const label of sourcePrerequisites) if (!documentedPrereqs.includes(label)) findings.push(`missing prerequisite edge ${label} on ${row.mapping}`);
    for (const label of documentedPrereqs) if (!sourcePrerequisites.includes(label)) {
      findings.push(`unexpected prerequisite edge ${label} on ${row.mapping}`);
    }
  }
  for (const mapping of expectedByMapping.keys()) if (!seenMappings.includes(mapping)) findings.push(`missing mapping row: ${mapping}`);
  return findings;
}

const documentedFindings = diagnoseDocumented(matrix.documentedRows);
if (documentedFindings.length) errors.push(`corrected documentedRows baseline is not clean: ${documentedFindings.join("; ")}`);

function copyDocumentedRows() {
  return matrix.documentedRows.map((row) => ({
    mapping: row.mapping,
    additionalOperations: [...row.additionalOperations],
    crossOwnerEdges: [...row.crossOwnerEdges],
    prerequisites: [...row.prerequisites]
  }));
}
function assertNegative(name, rows, expectedText) {
  const findings = diagnoseDocumented(rows);
  if (!findings.some((finding) => finding.includes(expectedText))) errors.push(`negative case ${name} was not detected`);
}
const omitLearner = copyDocumentedRows();
omitLearner.find((row) => row.mapping === triggerMapping).additionalOperations = omitLearner.find((row) => row.mapping === triggerMapping).additionalOperations.filter((id) => id !== "education-bundle/learner-id-backfill");
assertNegative("omit-learner", omitLearner, "missing additional-operation ID education-bundle/learner-id-backfill");
const omitEdge = copyDocumentedRows();
omitEdge.find((row) => row.mapping === targetMapping).crossOwnerEdges = omitEdge.find((row) => row.mapping === targetMapping).crossOwnerEdges.filter((edge) => edge !== "edge:bg-target-condition-to-education-target-reconciliation");
assertNegative("omit-cross-owner", omitEdge, "missing cross-owner edge edge:bg-target-condition-to-education-target-reconciliation");
const omitPrerequisite = copyDocumentedRows();
omitPrerequisite.find((row) => row.mapping === triggerMapping).prerequisites = omitPrerequisite.find((row) => row.mapping === triggerMapping).prerequisites.filter((label) => label !== "learner/target-state reconciliation");
assertNegative("omit-prerequisite", omitPrerequisite, "missing prerequisite edge learner/target-state reconciliation");
const unknownDuplicate = copyDocumentedRows();
unknownDuplicate.find((row) => row.mapping === triggerMapping).additionalOperations.push("education-bundle/not-in-evidence");
unknownDuplicate.find((row) => row.mapping === triggerMapping).additionalOperations.push("education-bundle/payment-reference-function");
assertNegative("unknown-additional", unknownDuplicate, "unknown additional-operation ID education-bundle/not-in-evidence");
assertNegative("duplicate-additional", unknownDuplicate, "duplicate additional-operation ID education-bundle/payment-reference-function");
const validIdWrongMapping = copyDocumentedRows();
validIdWrongMapping.find((row) => row.mapping === "7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d").additionalOperations.push("shipping/duplicate-row-cleanup");
assertNegative("valid-id-wrong-mapping", validIdWrongMapping, "unexpected valid additional-operation ID shipping/duplicate-row-cleanup");
const validEdgeWrongMapping = copyDocumentedRows();
validEdgeWrongMapping.find((row) => row.mapping === "7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d").crossOwnerEdges.push("edge:bg-target-condition-to-education-target-reconciliation");
assertNegative("valid-edge-wrong-mapping", validEdgeWrongMapping, "unexpected valid cross-owner edge edge:bg-target-condition-to-education-target-reconciliation");
const fastInsteadFull = copyDocumentedRows();
const fastPathTarget = fastInsteadFull.find((row) => row.mapping === targetMapping);
fastPathTarget.additionalOperations = fastPathTarget.additionalOperations.map((id) => id === "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668" ? "business-growth/bundle-payment-backfill" : id);
assertNegative("fast-instead-full", fastInsteadFull, "unexpected valid additional-operation ID business-growth/bundle-payment-backfill");
const duplicateMapping = copyDocumentedRows();
duplicateMapping.push({ ...duplicateMapping.find((row) => row.mapping === "7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d") });
assertNegative("duplicate-mapping", duplicateMapping, "duplicate mapping");

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS source derivation and negative tests: ${selected.length} mappings; ${expectedUniverse.size} evidence IDs`);
  if (documentedFindings.length) {
    console.log(`DOCUMENTED REPORT DIFFERENCES (${documentedFindings.length})`);
    console.log(`DOCUMENTED CHECK COUNTS missing=${documentedFindings.filter((finding) => finding.includes("missing additional-operation ID") || finding.includes("missing mapping row")).length} unknown=${documentedFindings.filter((finding) => finding.includes("unknown ")).length} duplicate=${documentedFindings.filter((finding) => finding.includes("duplicate ")).length} missingEdges=${documentedFindings.filter((finding) => finding.includes("missing cross-owner edge")).length} missingPrerequisites=${documentedFindings.filter((finding) => finding.includes("missing prerequisite edge")).length}`);
    for (const finding of documentedFindings) console.log(`REPORT ${finding}`);
  } else {
    console.log("DOCUMENTED REPORT DIFFERENCES: none (missing=0 unknown=0 duplicate=0 missingEdges=0 missingPrerequisites=0)");
  }
}
```

The final condition in the checker intentionally uses only in-memory
objects.  The negative cases in the JSON block are expected to fail when
applied to a copied object, not when applied to the repository or to a
database.  No authoritative validator is created by this document.