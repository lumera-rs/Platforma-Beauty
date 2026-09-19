# Task #943 collection and review sequence

This is a dependency-aware **future review sequence**, not an execution
sequence. Every stage is review-gated. A stage may collect only the
read-only, minimized evidence explicitly authorized for that stage; it may
not “discover” safety by applying a change.

## Gate 0 — identity, inventory, and authorization

Confirm Task #943 identity, target alias, environment, database/schema scope,
deployed revision(s), supported mixed-release/rollback window, collector,
capture time, retention, and immutable evidence digest. Expand the delivered
inventory schema by array position: `mappingIds[i]` joins
`records.mappings[i]`, `additionalOperationIds[i]` joins
`records.additionalOperations[i]`, and object groups are the referenced
`objectGroupIndexes`. Reconcile 1,435 mappings, 110 additional operations,
1,459 occurrences, 1,044 groups, and 1,545 identities.

**Stop:** any identity/count/duplicate/index mismatch, missing authorization,
wrong target, stale revision, or missing independent reviewer. No downstream
production fact may be claimed.

## Gate 1 — static source and dependency review

Review the readiness dependency batches, production-evidence register, pilot
dependency matrix, methodology, and the pinned source/test text. Preserve
source execution order without treating it as universal dependence. Record all
source-demonstrated edges:

* `DEP-001`/`DEP-002`: full BG payment literals `4923`/`4928` before the
  selected target-check validation;
* `DEP-003`: BG full function `4939` and Education payment trigger/function
  co-review, not a target-check prerequisite;
* `DEP-004`/`DEP-005`: Education payment backfill/function before its trigger;
* `DEP-006`/`DEP-007`: later learner/target-state reconciliation and its
  postcondition relationship;
* `DEP-008`: shared BG/Education advisory-lock lifecycle;
* `DEP-009`/`DEP-010`: web-push expiry add, backfill, then `NOT NULL`;
* `DEP-011`: shipping cleanup before singleton unique index;
* `DEP-012`: referral column before tracking backfill;
* `DEP-013`: booking table before scoped unique index;
* `DEP-014`: media type/users before image-assets relation; and
* `DEP-015`: marketplace shared concurrent-index recovery boundary.

**Stop:** a fast-path ID substituted for a full literal, a later-state edge
reversed into a prerequisite, an owner-order-only edge, or an invented
dependency. Keep each identity `UNRESOLVED`.

## Gate 2 — target and ledger reachability

Under separate authorization, collect only minimized target/release metadata,
migration/adoption ledger state, Business Growth marker provenance and
supported branch reachability. Distinguish intermediate, fast, full, and
final-eighth-owner paths. A current marker does not prove historical
completion or retirement.

Before any future inspection in this or later gates, independently review its
query text and expected plan and approve explicit statement/lock timeouts,
scan/result/concurrency budgets, monitored numeric abort thresholds, and a
smaller pilot scope. A `SELECT` is not presumed safe.

**Stop:** target, ledger, marker provenance, branch, or release overlap is
`UNKNOWN`; do not infer a skipped branch ran.

## Gate 3 — catalog and operational state

For exact assigned IDs, collect catalog metadata: qualified relation/type/
column/default/constraint/index/function/trigger definitions, owner,
namespace/search-path-relevant binding, validity, extension/version, and
privilege classification. Separately capture bounded transaction, lock,
timeout/GUC restoration, autocommit/concurrent-index, cleanup, and partial
failure/recovery observations. For every record, attach the exact startup-owner
lifecycle evidence covering transaction boundaries, retry/idempotency,
application revision overlap, background workers/schedulers, partial
execution, and recovery. Do not collect rows merely to establish shape, and do
not restart an application or worker, deploy, or invoke startup code.

Review primary components in this order: B-01; B-02; B-03; B-04; B-05; B-06;
B-07; B-08; then B-09 components in stable leader order. B-00 remains a
coverage gate for every stage. Within each component, direct prerequisites
come first, then shared lifecycle, then later-state/postcondition review.

**Stop:** missing object qualification, invalid/unknown index or constraint
state, unknown function/trigger binding, unresolved lock/session recovery, or
an unapproved dynamic schema/search path.

## Gate 4 — data invariants and business authorization

For data-changing components only, collect aggregate and redacted exception
classes: candidate, changed, unmatched, null, duplicate, invalid, and
compensable counts. Validate the approved policy for payment snapshots,
learner mapping, expiry timing, referral fallback, and singleton survivor
selection. Obtain named business/data-owner approval separately from
technical read access. No raw payment references, learner identities,
payloads, audit contents, or customer rows belong in the default package.

**Stop:** unknown row invariants, policy, authorization, compensation, or
concurrency. Never treat a source `UPDATE`, cleanup helper, retry, or
`IF [NOT] EXISTS` as evidence that it ran safely.

## Gate 5 — restore, dependent release, and independent review

Confirm a verified restore point or approved compensating action, observability,
incident owner, rollback boundary, dependent writer/client compatibility,
extension/privilege compatibility, retention, and recovery objectives. The
preparer submits exact reviewed IDs and evidence digests; an independent
reviewer checks branch distinctions, dependencies, unknowns, privacy,
freshness, authorization, and recovery. Record approval or a precise blocker.

No review disposition authorizes deployment or mutation. If any gate fails,
the affected records remain `UNRESOLVED` and the package is not usable for a
resolution decision.

## Static preflight boundary

The reviewed `scripts/src/api-preflight.sh` resolves a configured API URL and
checks `/healthz` with bounded curl timeouts; it is guarded by
`assert_destructive_test_runtime_allowed`. Its shell test uses a fake curl to
cover unreachable, 503, and 200 responses. These tests establish only script
control flow and a health response contract. They are not production catalog,
data, execution-history, authorization, restore, or evidence of any startup
operation. No preflight is run by Task #943.
