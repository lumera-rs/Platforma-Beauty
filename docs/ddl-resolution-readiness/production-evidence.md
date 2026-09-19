# Production evidence register — authorization-required future requests

## Boundary and current fact state

This register specifies evidence that a later, separately authorized review
would need.  It neither requests credentials nor opens a connection, proposes
queries, reads production data, or authorizes a change.  It is not evidence
that a fact has been collected.

**All production facts in this register are `UNKNOWN`.**  In particular,
source code, a canonical migration, source checksums, marker names, tests, and
development/fresh-schema shape do not prove production target identity,
catalog state, data invariants, prior execution, permissions, release overlap,
or recovery safety.  All 1,435 DDL mappings and 110 additional operations
remain `UNRESOLVED`.

The immutable canonical reference is
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
It is a comparison baseline, not production execution or safety evidence.

## Exact-ID set expressions and inventory integration

The completed exhaustive inventory is the source of actual record IDs and
object membership.  It is schema version `1`: mapping tuple `i` is joined to
`mappingIds[i]`, additional-operation tuple `i` to
`additionalOperationIds[i]`, and each tuple's third slot is its actual
`objectGroupIndexes`.  `objectGroups[index]` is
`[objectGroupId, membershipBasis, structuredIdentity]`; it does not embed
member IDs.  The following static projection is the exact evaluable selector
registry used by every `PE-*` row below.  It reads the delivered JSON only.

```js
const inv = require("./docs/ddl-resolution-readiness/inventory.json");
const mappings = inv.records.mappings.map((row, i) => ({
  recordId: `mapping:${inv.mappingIds[i]}`, id: inv.mappingIds[i],
  family: "mapping", ownerIndexes: row[0], operationKind: row[1],
  objectGroupIndexes: row[2], existingDataEffect: row[3],
}));
const additional = inv.records.additionalOperations.map((row, i) => ({
  recordId: `additional-operation:${inv.additionalOperationIds[i]}`,
  id: inv.additionalOperationIds[i], family: "additional-operation",
  ownerIndex: row[0], category: row[1], objectGroupIndexes: row[2],
  existingDataEffect: row[3],
}));
const R = [...mappings, ...additional];                 // 1,545 stable record IDs
const Q = inv.occurrences;                               // 1,459 source occurrences
const group = index => inv.objectGroups[index];
const groupOf = r => r.objectGroupIndexes.map(group);
const exact = id => R.filter(r => r.id === id);
const kind = operationKind => mappings.filter(r => r.operationKind === operationKind);
const category = value => additional.filter(r => r.category === value);
const union = (...sets) => [...new Map(sets.flat().map(r => [r.recordId, r])).values()];
const namedObject = (...names) => R.filter(r => groupOf(r).some(([groupId,, identity]) =>
  names.some(name => groupId.includes(name) ||
    [identity?.name, identity?.parent].includes(name))));
const owner = name => R.filter(r =>
  (r.ownerIndexes || [r.ownerIndex]).some(i => inv.owners[i][0] === name));
const dataOps = union(category("data-backfill"), category("cleanup-reporting"));
const operationalOps = category("operational-scaffolding");
const functionOps = category("function-replacement");
const markerOps = category("rollout-marker");
const productionSelectors = {
  "PE-01-target-and-release": R,
  "PE-02-ledger-marker-reachability": union(markerOps,
    exact("business-growth/advisory-lock-and-session-state"),
    exact("business-growth/cleanup-report-read"),
    exact("business-growth/rollout-marker-read"),
    exact("business-growth/rollout-marker-write"),
    namedObject("business_growth_schema_rollout", "education_salon_cleanup_reports")),
  "PE-03-catalog-definition-and-binding": union(mappings, functionOps,
    namedObject("education_bundle_purchases", "reject_bundle_payment_reference_change")),
  "PE-04-index-and-constraint-validity": union(
    kind("create-index"), kind("validate-constraint"),
    exact("shipping/duplicate-row-cleanup"),
    exact("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a")),
  "PE-05-data-invariants-and-backfills": union(dataOps,
    exact("business-growth/bundle-payment-backfill"),
    exact("education-bundle/payment-reference-backfill"),
    exact("education-bundle/learner-id-backfill"),
    exact("shipping/duplicate-row-cleanup"),
    exact("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a"),
    exact("referral/tracking-start-backfill")),
  "PE-06-business-authorization-and-compensation": union(dataOps,
    kind("drop-index"), functionOps,
    exact("education-bundle/payment-reference-backfill"),
    exact("education-bundle/learner-id-backfill")),
  "PE-07-transaction-lock-session-recovery": union(operationalOps,
    exact("business-growth/advisory-lock-and-session-state"),
    owner("ensureMarketplacePerformanceIndexes")),
  "PE-08-privileges-and-dependent-release-compatibility": union(
    functionOps, kind("create-trigger"), kind("drop-index"), kind("create-extension")),
  "PE-09-restore-and-observability": union(dataOps, kind("drop-index"),
    functionOps, markerOps, owner("ensureMarketplacePerformanceIndexes")),
  "PE-10-independent-review-disposition": R,
};
const selectorIds = Object.fromEntries(Object.entries(productionSelectors)
  .map(([key, records]) => [key, records.map(r => r.recordId).sort()]));

if (inv.mappingIds.length !== 1435 || inv.additionalOperationIds.length !== 110 ||
    Q.length !== 1459 || R.length !== 1545 ||
    new Set(R.map(r => r.recordId)).size !== 1545 ||
    new Set(inv.objectGroups.map(x => x[0])).size !== 1044 ||
    Object.values(productionSelectors).some(records => records.length === 0)) {
  throw new Error("production-evidence selector reconciliation failed");
}
```

Thus `selectorIds["PE-nn"]` is an exact, duplicate-free array of stable
mapping/additional-operation record IDs for a production-evidence request.
The separate primary assignment map in `dependency-batches.md` assigns every
one of those IDs to a concrete object component or a source-backed lifecycle
batch.  This selector registry does not assert any production fact.

The static pilot anchors below are exact IDs already supported by the source
and corrected pilot evidence.  They do not limit the actual-object expansion
performed by `namedObject(...)` in the completed selector registry:

```json
{
  "bundleTargetAndPaymentAnchors": {
    "mappingIds": [
      "71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a",
      "be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3"
    ],
    "additionalOperationIds": [
      "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668",
      "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf",
      "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb",
      "business-growth/bundle-payment-backfill",
      "business-growth/bundle-payment-immutability-function",
      "education-bundle/payment-reference-backfill",
      "education-bundle/payment-reference-function",
      "education-bundle/transaction-and-advisory-lock",
      "education-bundle/learner-id-backfill"
    ]
  },
  "otherPilotAnchors": {
    "shipping": ["c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48", "shipping/duplicate-row-cleanup"],
    "webPush": ["73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20", "ensureWebPushSchema/source-discovered-82-dd7107a5f655438a", "web-push/transaction-and-advisory-lock"],
    "referral": ["a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1", "referral/tracking-start-backfill", "referral/transaction-and-advisory-lock"],
    "marketplace": ["aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4", "marketplace/advisory-lock-and-session-state"],
    "media": ["7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d", "media/transaction-and-advisory-lock"],
    "booking": ["129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b", "booking-command/transaction-and-advisory-lock"]
  }
}
```

For the Business Growth bundle path, the source scope must always be carried
with the ID:

```text
full = {
  ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668,
  ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf,
  ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb
}
fast = {
  business-growth/bundle-payment-backfill,
  business-growth/bundle-payment-immutability-function
}
intermediate = branch label and source scope
  artifacts/api-server/src/lib/business-growth-schema.ts:5024-5033;
  its production selector is selectorIds["PE-02-ledger-marker-reachability"]
final = later eighth-owner source scope
  artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:22-63;
  its exact operational anchors are
  education-bundle/payment-reference-backfill,
  education-bundle/payment-reference-function,
  education-bundle/transaction-and-advisory-lock, and
  education-bundle/learner-id-backfill
```

`fast` cannot be offered as evidence for a `full` literal.  `final` describes
the later eighth-owner source sequence only; it is not evidence that the
earlier full validation executed or that production has the final state.

## Future evidence requirements registry

Each row is a separate evidence need.  `Authorization`, `privacy`, and
`freshness/provenance` are intentionally distinct: a technically useful
snapshot without permission, minimization, or a trustworthy time/release scope
does not satisfy the requirement.

| Requirement ID | Relevant exact-ID expression | Necessary production fact (currently UNKNOWN) | Why it is needed | Authorization required before collection | Privacy/minimization boundary | Freshness and provenance requirement |
|---|---|---|---|---|---|---|
| `PE-01-target-and-release` | `selectorIds["PE-01-target-and-release"]` (all 1,545) | Intended production target identity, environment, database/schema scope, deployed application revision(s), supported upgrade/rollback overlap, and capture time | Prevents applying a catalog or data observation from a wrong target/release to any record. | Named production data/system owner and scoped read-only authorization. | Collect environment/release identifiers only; do not include connection strings, credentials, customer rows, or raw secrets. | Signed/attributed capture time, collector, target alias, revision identifiers, and immutable evidence digest; stale after release/topology change. |
| `PE-02-ledger-marker-reachability` | `selectorIds["PE-02-ledger-marker-reachability"]` | Migration ledger/adoption state, Business Growth rollout table/row/version, marker provenance, and supported branch reachability | Marker selection changes the full/fast path; a marker is not completion evidence without its provenance and surrounding state. | Separate approval from release/database owner; no authorization is implied by `PE-01`. | Minimize to marker/ledger metadata and state classifications; omit unrelated operational logs. | Capture atomically enough to relate ledger, marker, revision, and snapshot time; invalidate on marker/ledger change. |
| `PE-03-catalog-definition-and-binding` | `selectorIds["PE-03-catalog-definition-and-binding"]` | Actual relation/type/column/default/constraint/index/function/trigger definitions, object owner, namespace/search-path-relevant binding, and validity state | Names and canonical definitions cannot show installed definition, function body, trigger binding, ownership, or privilege parity. | Database owner approval limited to catalog metadata; independent reviewer identifies the required objects first. | Metadata only where possible; do not extract table contents or function secrets/configuration values. | Record server/version context, object identifiers, normalized and raw definition digest, capture time, and release scope; recapture after DDL/redeploy. |
| `PE-04-index-and-constraint-validity` | `selectorIds["PE-04-index-and-constraint-validity"]` | Existence, definition, uniqueness/check/FK validity, invalid concurrent-index state, and relevant lock/writer conditions | `IF NOT EXISTS`, a same name, or canonical final shape cannot prove validity or safe retry; data-changing predecessors may be required. | Database owner plus operational change/reliability owner approval for lock/workload metadata. | Aggregate health/count classification preferred; no key values, payloads, or user identifiers. | Tie catalog state and invariant result to one capture window and revision; invalidate after writes, index build, constraint change, or failover. |
| `PE-05-data-invariants-and-backfills` | `selectorIds["PE-05-data-invariants-and-backfills"]` | Counts and invariant classifications for candidate, changed, unmatched, null, duplicate, invalid, and compensable rows; approved relation between source and target fields | Existing-data transitions cannot be established from a final schema. This includes payment snapshots, learner mappings, expiry policy, referral fallback, and singleton survivor policy. | Explicit business-data owner and privacy/security approval in addition to database read authorization; destructive or financial cases require a named business approver. | Aggregates and redacted exception classes first. No raw payment references, JSON payloads, learner identities, audit contents, or user data unless separately justified and protected. | Define snapshot isolation/consistency method, capture interval, predicate version, target/release, and data-retention period. Recapture if data changes before decision. |
| `PE-06-business-authorization-and-compensation` | `selectorIds["PE-06-business-authorization-and-compensation"]` | Named accountable owner and documented approval for business policy, destructive selection, financial immutability, retention, learner identity mapping, and restore/compensation boundary | A technically valid statement can still make an unauthorized deletion, rewrite, denial of update, or retention decision. | Product/business owner, data controller where applicable, and change authority approval; independent of technical read access. | Store approval references and decision summaries, not personal data or financial records. | Approval must state effective release/data scope, decision date, expiry/review date, and compensating owner; stale on policy or product-flow change. |
| `PE-07-transaction-lock-session-recovery` | `selectorIds["PE-07-transaction-lock-session-recovery"]` | Actual transaction mode, lock namespace/contention behavior, timeout/search-path/GUC state, connection cleanup behavior, partial-failure record, and recovery/restore capability | Source scaffolding differs across autocommit, local transaction, and nontransactional concurrent-index paths; source cleanup attempts do not prove recovery. | Operations/SRE owner approval for production diagnostics and, separately, for any observation that could expose session metadata. | Capture configuration classifications and bounded operational metrics; exclude SQL parameters, client identities, IPs, and secrets. | Time-bound observation with deployment/revision correlation and explicit load window. Do not reuse a quiet-period observation for a peak window. |
| `PE-08-privileges-and-dependent-release-compatibility` | `selectorIds["PE-08-privileges-and-dependent-release-compatibility"]` | Object ownership/privileges, extension availability/version, dependent application releases, writer compatibility, and rollback consumers | A correct definition can fail or change behavior under the actual role, extension, client, or mixed release. | Security/DB owner and application release owner approval. | Principle-of-least-detail role capability matrix; do not reveal role membership, tokens, or tenant/customer access paths. | Capture against the same target/revision window as `PE-01`; revalidate on role, extension, or deployment change. |
| `PE-09-restore-and-observability` | `selectorIds["PE-09-restore-and-observability"]` | Verified restore point or approved compensating action, observability signals, incident owner, and rollback boundary for each irreversible or partial-commit transition | Retry, `ON CONFLICT`, `IF EXISTS`, or a source rollback attempt is not a restore plan, especially for BG autocommit and concurrent indexes. | Change/recovery authority and data owner authorization; this is not granted by read-only inspection approval. | Record backup/restore attestations and test metadata; never copy backups or customer data into the evidence package. | State backup snapshot identity/time, retention, recovery objective, verification date, and tested release compatibility; invalidate when retention expires. |
| `PE-10-independent-review-disposition` | `selectorIds["PE-10-independent-review-disposition"]`, joined to `assignment[recordId]` in `dependency-batches.md` | A reviewer independent of the preparer has checked evidence scope, unknowns, branch distinctions, dependencies, authorizations, and recovery claims | Methodology requires independent review; production artifacts do not self-approve a resolution path. | Review assignment and conflict-of-interest declaration; no DB access is implied. | Store reviewer identity/role under governance rules and references to redacted evidence, not sensitive evidence copies. | Date, reviewed evidence digests, target/release scope, unresolved exceptions, and expiry/re-review trigger must be recorded. |

## Object-cluster evidence scope

The completed `namedObject(...)` selector expands the following
source-demonstrated co-review clusters from actual object-group indexes.  They
are not broad owner buckets:

| Cluster expression | Relevant fact classes |
|---|---|
| `namedObject("education_bundle_purchases", "reject_bundle_payment_reference_change")` plus the exact full/fast/final anchors | `PE-03`, `PE-04`, `PE-05`, `PE-06`, `PE-07`, `PE-08`, `PE-09`; preserve full/fast/intermediate/final labels. |
| `namedObject("system_push_deliveries")` plus `ensureWebPushSchema/source-discovered-82-dd7107a5f655438a` and `web-push/transaction-and-advisory-lock` | Column definition, null/data invariant, 24-hour authorization, transaction/lock, delivery-retention compatibility. |
| `namedObject("shipping_rules", "shipping_rules_singleton_unique")` plus `shipping/duplicate-row-cleanup` | Row count/survivor authorization, unique-index validity, lock impact, restore. |
| `namedObject("referral_qualifications", "referral_attributions", "business_verification_audits")` plus referral lifecycle/backfill IDs | Tracking timestamp data policy, audit linkage/fallback, authorization, compensation. |
| `owner("ensureMarketplacePerformanceIndexes")` (the four inventory mappings plus its lifecycle operation) | Per-index definition/validity plus one shared nontransactional recovery/lifecycle evidence set. |
| `namedObject("booking_command_receipts", "salons")` plus `booking-command/transaction-and-advisory-lock` | Parent/FK definition, four-key duplicate invariant, idempotency policy, transaction/lock compatibility. |
| `namedObject("image_asset_status", "image_assets", "media_assets", "media_variants", "media_upload_tickets")` plus `media/transaction-and-advisory-lock` | Type/FK/index definitions, namespace/privileges, transaction recovery; partition only at a closed FK boundary. |

Dynamic names are matched against the delivered `objectGroupId` and structured
identity in `namedObject(...)`; no alias map or future schema conversion is
assumed.  The marketplace owner selector is limited to that four-index
lifecycle, not a precedent for owner-wide grouping elsewhere.

## Evidence package acceptance criteria

A future evidence package is usable for a particular exact ID only when it:

1. identifies the target, release scope, collector, capture time, and immutable
   artifact digest (`PE-01`);
2. maps the artifact to exact mapping/additional-operation IDs and occurrences,
   branch labels where applicable, and object groups without duplicates;
3. records the observed fact and its allowed inference separately from the
   decision it might inform;
4. carries an explicit authorization reference, data-minimization/privacy
   classification, retention/access rule, and freshness/re-capture trigger;
5. records `UNKNOWN` rather than filling missing rows from canonical/source
   assumptions; and
6. is independently reviewed before it is used for any authoritative decision.

No row above authorizes evidence collection, migration creation, startup-DDL
execution, adoption, deletion, deployment, or a status change.  Missing
authorization, privacy controls, provenance, or freshness leaves the relevant
production fact `UNKNOWN`.