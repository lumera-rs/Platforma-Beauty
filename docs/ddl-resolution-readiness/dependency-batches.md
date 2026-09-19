# Dependency graph and future co-review batches

## Status, boundary, and coverage contract

This is a **documentation-only, non-authoritative** graph derived from the
startup owner source, `docs/additional-operations-evidence/complete-evidence.json`,
the corrected pilot dependency matrix, and the pilot reports.  It does not
execute a batch, open a database, assign a mapping status, or infer that a
source path has run.  Every DDL mapping and every additional operation remains
`UNRESOLVED`.

The source inventory contains 1,435 mapping IDs, 1,459 occurrences, and 110
additional-operation IDs.  The resolution-review record universe is therefore
1,545 identities:

```text
M = inventory.mappingIds                         # |M| = 1435
O = inventory.additionalOperationIds             # |O| = 110
R = M union O                                    # |R| = 1545
Q = inventory.occurrences                        # |Q| = 1459; not runtime executions
```

`inventory` above means the exhaustive `inventory.json` deliverable, not a
database.  The delivered schema is version `1`, with root aliases
`mappingIds`, `additionalOperationIds`, `occurrences`, and `objectGroups`.
Its canonical compact records are `records.mappings` and
`records.additionalOperations`; a record's array position is the join to its
root ID.  The completed record slots used here are:

| Delivered path | Actual slot interpretation |
|---|---|
| `records.mappings[i]` | `[ownerIndexes, operationKind, objectGroupIndexes, existingDataEffect, occurrenceIndexesWithinMapping, staticCrosswalkMappingIndex, operationalRiskProfileIds]`; identity is `mappingIds[i]`. |
| `records.additionalOperations[i]` | `[ownerIndex, category, objectGroupIndexes, existingDataEffect, completeEvidenceAndCrosswalkIndex, operationalRiskProfileIds]`; identity is `additionalOperationIds[i]`. |
| `occurrences[i]` | `[mappingIndex, occurrenceIndexWithinMapping, ownerIndex, [literalLine, literalColumn, operationLine, operationColumn], executionOrder, phase, callSite, fullSqlSha256]`. |
| `objectGroups[i]` | `[objectGroupId, membershipBasis, exactStructuredIdentity]`; each record references this actual group through its `objectGroupIndexes`. |

`recordEncoding` is authoritative for the tuple positions above.  The stable
record IDs are `mapping:<mappingIds[i]>` and
`additional-operation:<additionalOperationIds[i]>`; occurrence IDs are
`occurrence:<mappingIds[mappingIndex]>:<occurrenceIndex + 1>`.  This
documentation now uses the delivered indexes, not a hypothetical
`mappingById`, `recordById`, or embedded member-ID object-group schema.

`R` is the **exhaustive mechanical coverage set**.  Semantic edges remain
source-demonstrated only, but every member of `R` has a deterministic primary
object-research assignment below.  Assignment is containment for review, not
a claim that an unproven semantic dependency exists or that a record is
independent.

The canonical comparison point remains
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
Canonical end-state text is not evidence that a historical source transition,
its data effect, or any production fact occurred.

## Source execution and branch ledger

The startup index awaits owners in this order:

1. `ensureBusinessGrowthSchema` (`index.ts:84`);
2. `ensureMediaSchema` (`:85`);
3. `ensureShippingConfigSchema` (`:86`);
4. `ensureMarketplacePerformanceIndexes` (`:87`);
5. `ensureReferralSchema` (`:88`);
6. `ensureWebPushSchema` (`:89`);
7. `ensureBookingCommandSchema` (`:90`);
8. `ensureEducationBundlePurchaseSchema` (`:91`).

This order is reachability context, **not** eight edges from every earlier
owner to every later owner.  A preceding failure that prevents a later call is
not, by itself, a semantic dependency.

Business Growth requires four distinctly labelled source paths:

| Label | Source path and state | Review meaning |
|---|---|---|
| `intermediate-repair` | `business-growth-schema.ts:5024-5033`, before marker choice; creates/repairs the cleanup-report table and cover-image columns | Must be reviewed separately from both marker branches; it is not proof that either branch's historical DDL ran. |
| `fast-current-marker` | marker read `:5035-5043`; current version follows `:5044-5125` and returns | Includes guarded bundle work. `business-growth/bundle-payment-backfill` is evidence for this path only. |
| `full-rollout` | absent/behind marker builds and runs `tableStatements` at `:5128-5138`; marker write follows at `:5139-5148` | The static target-check validation at `:4955-4965` belongs here. Its actual companion IDs are source-discovered `4923` and `4928`, never the curated fast-path ID. |
| `final-eighth-owner` | Education Bundle transaction at `education-bundle-purchase-schema.ts:6-85`, after all seven preceding owners | Its committed source-level final sequence may replace payment function/trigger and target check. It is not proof of a production final state. |

The relevant IDs are intentionally not interchangeable:

```json
{
  "fullRolloutPaymentCompanions": [
    "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668",
    "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf"
  ],
  "fullRolloutFunction": "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb",
  "fastPathPaymentCompanion": "business-growth/bundle-payment-backfill",
  "fastPathFunction": "business-growth/bundle-payment-immutability-function",
  "educationLocalOperations": [
    "education-bundle/payment-reference-backfill",
    "education-bundle/payment-reference-function",
    "education-bundle/transaction-and-advisory-lock",
    "education-bundle/learner-id-backfill"
  ]
}
```

In particular, a fast-path ID must not stand in for a full-rollout literal.
The later learner update is an indirect same-transaction and target-state
dependency for the Education trigger review; it is not a trigger-function
prerequisite and cannot repair an earlier Business Growth validation.

## Source-demonstrated edge registry

**Direction convention:** `from -> to` means “the source relationship must be
reviewed before or together with the destination claim.”  `prerequisite` is an
earlier condition for the destination.  `postcondition/later-state` preserves
execution direction without pretending that a later action was a prerequisite.
All edges are source facts at their cited scope only; none asserts production
truth.

| Edge ID | From -> to | Type / direction | Scope and reason | Evidence | Explicit exclusions |
|---|---|---|---|---|---|
| `DEP-001` | full `4923` payment-reference update -> BG target-check validation `71356fcc…` | direct, same-branch data-reconciliation review prerequisite | Same full `tableStatements` path and `education_bundle_purchases`; update precedes validation. Review together to establish the actual state transition, not because the target predicate reads payment reference. | `business-growth-schema.ts:4921-4965`; corrected matrix rows for `71356fcc…` | Excludes `business-growth/bundle-payment-backfill`: it is fast-current-marker evidence. |
| `DEP-002` | full `4928` payment-instructions update -> BG target-check validation `71356fcc…` | direct, same-branch data-reconciliation review prerequisite | Same relation and ordered full path; snapshot rewrite precedes the selected validation. | `business-growth-schema.ts:4923-4965`; pilot matrix `coverageLedger` | Excludes full function `4939`; that is a separate trigger/function edge. |
| `DEP-003` | full function `4939` -> Education payment trigger `be6bde8…` | cross-owner shared-object function/trigger co-review; not a prerequisite | Both owners replace/bind `reject_bundle_payment_reference_change` and the same named trigger on the same table, but in distinct owner paths. | BG `:4939-4951`; Education `:39-51`; `index.ts:84,91` | Excludes target-check validation as a trigger-function prerequisite; it is a different semantic question. |
| `DEP-004` | Education payment-reference backfill -> Education payment trigger `be6bde8…` | direct, local data-before-financial-policy | The two payment/snapshot updates occur before NOT NULL, unique/check, function, and trigger work in one transaction. | `education-bundle-purchase-schema.ts:22-51`; evidence ID `education-bundle/payment-reference-backfill` | Does not attribute row mutation to the trigger mapping or establish generated-reference uniqueness. |
| `DEP-005` | Education payment-reference function -> Education payment trigger `be6bde8…` | direct, function-before-trigger prerequisite | The trigger executes the immediately preceding replacement function. | `education-bundle-purchase-schema.ts:39-51`; evidence ID `education-bundle/payment-reference-function` | Excludes same-name matching elsewhere as proof of equal function bodies or bindings. |
| `DEP-006` | Education learner-ID backfill -> Education replacement target-check sequence | indirect, later same-transaction data prerequisite | After old checks are dropped, the update supplies learner IDs before replacement check add/validate. Failure rolls back this owner transaction, so it is also indirect context for the earlier trigger work. | Education `:52-63`; evidence ID `education-bundle/learner-id-backfill` | Not a direct input to the trigger body/binding; not an earlier prerequisite of BG validation. |
| `DEP-007` | BG target-check validation `71356fcc…` -> Education later target-state replacement | cross-owner, later-state/postcondition relationship | Both concern `education_bundle_purchases_target_check`; Education later drops, backfills, adds and validates a replacement. | BG `:4955-4965`; Education `:52-63`; corrected edge `edge:bg-target-condition-to-education-target-reconciliation` | Does not reverse source order or say Education repairs the already-run BG validation. |
| `DEP-008` | BG advisory lifecycle -> Education transaction/lock lifecycle | indirect, shared-lock serialization | Owners one and eight use `BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY`; index order makes Education later. | `index.ts:84-91`; BG `:5002-5006`; Education import/`:6-8,85` | Not a data prerequisite from every BG DDL to every Education DDL. |
| `DEP-009` | Web Push `expires_at` add -> line-82 expiry backfill | direct, column-before-data prerequisite | Backfill reads/writes `expires_at` after the add. | `web-push-schema.ts:80-83`; ID `ensureWebPushSchema/source-discovered-82-dd7107a5f655438a` | Excludes `acknowledged_at` and later indexes as inputs to the 24-hour calculation. |
| `DEP-010` | Web Push expiry backfill -> `expires_at SET NOT NULL` | direct, data-before-constraint prerequisite | Null rows must be reconciled before the following not-null change can succeed. | `web-push-schema.ts:82-83` | Does not prove every existing row has a valid `created_at` or that 24 hours is approved policy. |
| `DEP-011` | Shipping duplicate cleanup -> singleton unique index `c916566…` | direct, destructive data-before-unique-index prerequisite | Helper locks `shipping_rules`, deletes all but lowest UUID, then creates `((true))` unique index in the same transaction. | `shipping-config.ts:54-65`; ID `shipping/duplicate-row-cleanup` | The wrapper lock is contained in the same evidence record; no invented second shipping lock ID. |
| `DEP-012` | Referral `tracking_started_at` add `a570f…` -> referral tracking backfill | direct, column-before-data prerequisite | The update immediately writes the newly added column, based on attribution/audit or `updated_at`. | `referral-schema.ts:20,27-41`; ID `referral/tracking-start-backfill` | Excludes unrelated referral columns and enum addition. |
| `DEP-013` | Booking receipts table -> scoped unique index `129cb…` | direct, table-before-index prerequisite | The owner creates the parent table at source order 1 and the four-key index at order 2. | `booking-command-schema.ts:12-29` | No claim that another owner's earlier success is a booking dependency. |
| `DEP-014` | `image_asset_status`, `users` -> `image_assets` table `7cfee…` | direct, type/FK prerequisites | Table declares the status type and a foreign key to users. | `media-schema.ts:12-34` | Unqualified names/search path are unresolved; relation-name equality is not production evidence. |
| `DEP-015` | Marketplace session/lock lifecycle -> each concurrent-index object | indirect, shared nontransactional recovery boundary | All four `CREATE INDEX CONCURRENTLY` statements share saved/applied/restored session timeout and advisory-lock lifecycle, but no index is a prerequisite of another. | `marketplace-performance-schema.ts:18-46`; ID `marketplace/advisory-lock-and-session-state` | Excludes arbitrary index-to-index edges merely because they are in one owner. |

The transactional/lock evidence for Media, Shipping, Referral, Web Push,
Booking, and Education is a source-demonstrated operational co-review
condition for each member executed in that wrapper.  It is not a blanket claim
that the wrapper resolves each contained DDL.  The owner-specific evidence IDs
are respectively `media/transaction-and-advisory-lock`,
`shipping/duplicate-row-cleanup` (which includes the wrapper),
`referral/transaction-and-advisory-lock`,
`web-push/transaction-and-advisory-lock`,
`booking-command/transaction-and-advisory-lock`, and
`education-bundle/transaction-and-advisory-lock`.

No source-proven semantic cycle is currently asserted.  The shared-lock edge
serializes owner paths; it does not create a data-dependency cycle.  Discovery
of a cycle in the complete object index is a blocker requiring one combined
review group and a documented recovery/order decision.

## Exhaustive primary object-research assignment

This is the concrete, evaluable assignment registry for the delivered
`inventory.json` schema.  It is a static JSON projection only; it does not
load an owner module, connect to a database, or execute a batch.  It uses each
record's actual `objectGroupIndexes`, and assigns every stable record ID to
exactly one primary batch.  The named source-demonstrated batches in the next
section are **overlays**: they add mandatory co-review context without
removing a record from its primary assignment.

At the pinned inventory snapshot, the registry has **1,545 records**, **1,044
referenced actual object groups**, **1,656 record-to-group memberships**, and
**960 primary components** (801 singleton components; largest component 40
records).  Every record has at least one actual object group.  The five
advisory-lock lifecycle records below are deliberately assigned by exact ID to
their source-backed lifecycle/operation investigation batches, rather than
being folded into a generic object component:

```text
additional-operation:booking-command/transaction-and-advisory-lock -> B-08-booking-idempotency-scope/source-lifecycle
additional-operation:education-bundle/transaction-and-advisory-lock -> B-02-bundle-payment-and-target-state/source-lifecycle
additional-operation:marketplace/advisory-lock-and-session-state -> B-05-marketplace-concurrent-index-recovery/source-lifecycle
additional-operation:referral/transaction-and-advisory-lock -> B-06-referral-tracking-invariant/source-lifecycle
additional-operation:web-push/transaction-and-advisory-lock -> B-07-web-push-expiry-transition/source-lifecycle
```

```js
// Static evaluator for inventory.json schemaVersion 1.
// Its `assignment` map is the exact exhaustive primary batch registry.
const inv = require("./docs/ddl-resolution-readiness/inventory.json");
const mappings = inv.records.mappings.map((row, i) => ({
  recordId: `mapping:${inv.mappingIds[i]}`,
  id: inv.mappingIds[i],
  family: "mapping",
  ownerIndexes: row[0],
  operationKind: row[1],
  objectGroupIndexes: row[2],
  existingDataEffect: row[3],
  occurrenceIndexes: row[4],
  staticCrosswalkIndex: row[5],
  operationalRiskProfileIds: row[6],
}));
const additionalOperations = inv.records.additionalOperations.map((row, i) => ({
  recordId: `additional-operation:${inv.additionalOperationIds[i]}`,
  id: inv.additionalOperationIds[i],
  family: "additional-operation",
  ownerIndex: row[0],
  category: row[1],
  objectGroupIndexes: row[2],
  existingDataEffect: row[3],
  completeEvidenceAndCrosswalkIndex: row[4],
  operationalRiskProfileIds: row[5],
}));
const records = [...mappings, ...additionalOperations];
const objectGroup = i => ({
  index: i,
  objectGroupId: inv.objectGroups[i][0],
  membershipBasis: inv.objectGroups[i][1],
  identity: inv.objectGroups[i][2],
});
const owner = i => inv.owners[i][0];
const groupsOf = r => r.objectGroupIndexes.map(objectGroup);
const hasObject = (r, predicate) => groupsOf(r).some(g => predicate(g.identity, g.objectGroupId));
const exactId = id => records.filter(r => r.id === id);
const byOwner = name => records.filter(r =>
  (r.ownerIndexes || [r.ownerIndex]).some(i => owner(i) === name));
const byKind = kind => mappings.filter(r => r.operationKind === kind);
const byCategory = category => additionalOperations.filter(r => r.category === category);

// Connected components over actual record--objectGroup memberships.
const parent = records.map((_, i) => i);
const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
const firstRecordAtGroup = new Map();
records.forEach((r, ri) => r.objectGroupIndexes.forEach(gi => {
  if (firstRecordAtGroup.has(gi)) join(ri, firstRecordAtGroup.get(gi));
  else firstRecordAtGroup.set(gi, ri);
}));
const components = new Map();
records.forEach((r, ri) => {
  const root = find(ri);
  if (!components.has(root)) components.set(root, []);
  components.get(root).push(r);
});
const sourceLifecycleBatch = new Map([
  ["additional-operation:booking-command/transaction-and-advisory-lock",
   "B-08-booking-idempotency-scope/source-lifecycle"],
  ["additional-operation:education-bundle/transaction-and-advisory-lock",
   "B-02-bundle-payment-and-target-state/source-lifecycle"],
  ["additional-operation:marketplace/advisory-lock-and-session-state",
   "B-05-marketplace-concurrent-index-recovery/source-lifecycle"],
  ["additional-operation:referral/transaction-and-advisory-lock",
   "B-06-referral-tracking-invariant/source-lifecycle"],
  ["additional-operation:web-push/transaction-and-advisory-lock",
   "B-07-web-push-expiry-transition/source-lifecycle"],
]);
const assignment = Object.fromEntries([...components.values()].flatMap(component => {
  const memberRecordIds = component.map(r => r.recordId).sort();
  const batchId = sourceLifecycleBatch.get(memberRecordIds[0]) ||
    "B-09-object-component/" + memberRecordIds[0]; // stable component leader
  return memberRecordIds.map(recordId => [recordId, batchId]);
}));
const union = (...sets) => [...new Map(sets.flat().map(r => [r.recordId, r])).values()];
const namedObject = (...names) => records.filter(r => hasObject(r, (identity, groupId) =>
  names.some(name => groupId.includes(name) ||
    [identity?.name, identity?.parent].includes(name))));
const overlays = {
  "B-01-bg-branch-lifecycle": union(
    exactId("business-growth/advisory-lock-and-session-state"),
    exactId("business-growth/cleanup-report-read"),
    exactId("business-growth/rollout-marker-read"),
    exactId("business-growth/rollout-marker-write"),
    namedObject("business_growth_schema_rollout", "education_salon_cleanup_reports")),
  "B-02-bundle-payment-and-target-state": union(
    exactId("71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a"),
    exactId("be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"),
    exactId("ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668"),
    exactId("ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf"),
    exactId("ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb"),
    exactId("business-growth/bundle-payment-backfill"),
    exactId("business-growth/bundle-payment-immutability-function"),
    exactId("education-bundle/payment-reference-backfill"),
    exactId("education-bundle/payment-reference-function"),
    exactId("education-bundle/learner-id-backfill"),
    exactId("education-bundle/transaction-and-advisory-lock"),
    namedObject("education_bundle_purchases", "reject_bundle_payment_reference_change")),
  "B-03-media-asset-relations": union(
    exactId("media/transaction-and-advisory-lock"),
    namedObject("image_asset_status", "image_assets", "media_assets", "media_variants", "media_upload_tickets")),
  "B-04-shipping-singleton-transition": union(
    exactId("c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48"),
    exactId("shipping/duplicate-row-cleanup"),
    namedObject("shipping_rules", "shipping_rules_singleton_unique")),
  "B-05-marketplace-concurrent-index-recovery": byOwner("ensureMarketplacePerformanceIndexes"),
  "B-06-referral-tracking-invariant": union(
    exactId("a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1"),
    exactId("referral/tracking-start-backfill"),
    exactId("referral/transaction-and-advisory-lock"),
    namedObject("referral_qualifications", "referral_attributions", "business_verification_audits")),
  "B-07-web-push-expiry-transition": union(
    exactId("73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20"),
    exactId("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a"),
    exactId("web-push/transaction-and-advisory-lock"),
    namedObject("system_push_deliveries")),
  "B-08-booking-idempotency-scope": union(
    exactId("129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b"),
    exactId("booking-command/transaction-and-advisory-lock"),
    namedObject("booking_command_receipts", "salons")),
};

if (records.length !== 1545 || new Set(records.map(r => r.recordId)).size !== 1545 ||
    Object.keys(assignment).length !== 1545 ||
    new Set(Object.values(assignment)).size !== 960 ||
    [...sourceLifecycleBatch.keys()].some(id => !(id in assignment)) ||
    Object.entries(assignment).some(([id, batch]) =>
      sourceLifecycleBatch.has(id)
        ? batch !== sourceLifecycleBatch.get(id)
        : !batch.startsWith("B-09-object-component/"))) {
  throw new Error("inventory/primary-batch reconciliation failed");
}
```

The reference evaluator is also the precise definition of membership for
`B-09-object-component/<leader>` and the five named source-lifecycle
assignments.  The lifecycle records' new advisory-lock identity is source
context, not proof of lock behavior or a production fact.

## Proposed future co-review batches — not executed

These are review containers based on demonstrated common objects, a
function/trigger binding, an invariant transition, or a shared operational
recovery boundary.  They are **not** execution batches, migrations, or
arbitrary owner-sized partitions.  Every row's `overlays[...]` selector is
defined against the delivered tuples immediately above; its result is exact
stable record IDs.  Named IDs are source anchors and the actual-object
selector expands the co-review set.

| Batch | Exact membership rule | Common object / reason | Evidence objective and outputs | Blockers and independent-review gate |
|---|---|---|---|---|
| `B-00-inventory-join` | `records` and `assignment` from the evaluator; `Q` uses `occurrences[*][0]` as `mappingIndex`; all 1,044 `objectGroups` | Mechanical identity integrity, not a semantic cluster | Prove every 1,545 record and 1,459 occurrence has one stable identity and one primary assignment; report the 960 component IDs. | Missing/duplicate ID, occurrence, tuple index, or object-group reference blocks all downstream coverage claims. Reviewer checks counts and set equality only. |
| `B-01-bg-branch-lifecycle` | `overlays["B-01-bg-branch-lifecycle"]` | Intermediate repair, marker read/write, autocommit/recovery, session/search-path lifecycle are one branch-control system | Separate intermediate, fast, full, and post-run report-read paths; output branch table, reachability conditions, marker/ledger questions, and recovery boundaries. | Marker state, partial autocommit work, timeout/search-path restoration, and report-table provenance are UNKNOWN. Independent reviewer must reject any fast/full substitution. |
| `B-02-bundle-payment-and-target-state` | `overlays["B-02-bundle-payment-and-target-state"]` | Cross-owner payment function/trigger and target-state transition | Produce separate full/fast/intermediate/final edge table, exact function/binding comparison, data-invariant list, and boundary between target and payment subgraphs. | Financial/identity authorization, row invariants, constraint/index/function/trigger state, lock behavior, and recovery are UNKNOWN. Independent reviewer verifies no target-check→trigger shortcut and preserves learner indirectness. |
| `B-03-media-asset-relations` | `overlays["B-03-media-asset-relations"]` | Explicit enum/FK/table/index relation chain under one transaction | Output parent-before-child and FK/index object graph; identify qualified-name/search-path and lifecycle evidence gaps. | Actual type/FK/index definitions, privileges, and transaction recovery are UNKNOWN. Review may split only at a closed FK boundary. |
| `B-04-shipping-singleton-transition` | `overlays["B-04-shipping-singleton-transition"]` | Destructive survivor selection directly enables the singleton index | Output candidate/survivor invariant, table-lock and transaction boundary, and restore/compensation requirements. | Business approval of lowest UUID, backup/restore, row population, and lock impact are UNKNOWN. No split between delete and unique index. |
| `B-05-marketplace-concurrent-index-recovery` | `overlays["B-05-marketplace-concurrent-index-recovery"]` | Same nontransactional concurrent-index lifecycle and interrupted-index recovery model | Output one recovery model plus a per-index definition/validity checklist. | Existing invalid indexes, workload/writers, session timeout restoration, and lock behavior are UNKNOWN. Individual indexes may be reviewed separately only after shared recovery model passes independent review. |
| `B-06-referral-tracking-invariant` | `overlays["B-06-referral-tracking-invariant"]` | New column and audit/fallback transformation express one timestamp-policy transition | Output row selection, fallback, authorization, restore, and dependent-release questions. | Audit linkage, channels/statuses, fallback approval, rows, and compensation are UNKNOWN. No split between column and backfill. |
| `B-07-web-push-expiry-transition` | `overlays["B-07-web-push-expiry-transition"]` | Add -> 24-hour data backfill -> NOT NULL is a single existing-data transition | Output pre/post-null invariant, policy decision, transaction/lock path, and delivery/retention compatibility analysis. | 24-hour policy authorization, candidate rows, retention effects, and recovery are UNKNOWN. No split before the NOT NULL gate. |
| `B-08-booking-idempotency-scope` | `overlays["B-08-booking-idempotency-scope"]` | Parent table/FK and idempotency uniqueness are one write-contract boundary | Output key-duplicate invariant, dynamic schema scope, lock/timeout model, and dependent caller compatibility questions. | Existing duplicates, index definition/validity, intended idempotency policy, and lock behavior are UNKNOWN. |
| `B-09-object-component-partition` | Every `assignment` value beginning `B-09-object-component/`; exact membership is its inverse image in `assignment` | Exhaustive actual-object-group connected components not covered by a special source overlay | Each component receives object-identity, source-locator, gap, and production-evidence review. `NO_SOURCE_EDGE_YET` is a semantic finding within an assigned component, never an unassigned residual. | An unknown/dynamic identity or unclassified branch blocks semantic conclusions, but not assignment. No component may be replaced with an owner bucket. |

### Batch admission, split, and stop rules

1. Expand each rule from exact inventory IDs before review.  A record may appear
   in a shared co-review group and retain its own `UNRESOLVED` identity; it must
   not be deduplicated because SQL text or object names resemble another record.
2. A batch may be split only along a demonstrated closed boundary: no remaining
   direct data prerequisite, FK/type/function/trigger/constraint/index
   reference, shared transition invariant, marker dependency, or nontransactional
   recovery dependency crosses it.  Batch size is never a split criterion.
3. A direct prerequisite must be considered first.  A later-state or
   postcondition edge must be reviewed with its predecessor but must not reverse
   execution order.  A shared lock requires lifecycle co-review, not a claim of
   universal data dependence.
4. Each completed future review must produce exact reviewed IDs and occurrences,
   source/canonical locators, branch label, evidence gaps, production evidence
   references, unresolved edges, and an independent-review disposition.  It
   cannot alter authoritative mapping or operation status.
5. Stop at the independent-review gate for each batch.  No batch described here
   has been started, approved, or executed.

## Known non-edges and pending discovery

The following exclusions are deliberate safeguards:

* canonical object-name matches, checksums, `IF EXISTS`/`IF NOT EXISTS`, and a
  test/fake-client result do not create a dependency or demonstrate production
  state;
* owner index order alone does not create cross-owner semantic edges;
* repeated SQL, repeated terminal function names, or the same target table does
  not demonstrate equal body, binding, data effect, or recovery behavior;
* the fast-current-marker bundle record does not cover full-rollout literals
  `4923`/`4928`; the full function `4939` is not a target-check predicate
  prerequisite;
* the Education learner update is indirect/later for the trigger review and
  cannot be represented as an earlier trigger input; and
* a transaction wrapper can be an operational dependency without making every
  statement in its owner a dependency of every other statement.

Everything not in the source-demonstrated registry remains pending semantic
discovery **within its assigned `B-09` object component** (or one of the five
named source-lifecycle assignments).  That limitation is intentional and
fail-closed: exhaustive assignment proves review containment, while only
source evidence can justify a semantic edge or co-review conclusion.