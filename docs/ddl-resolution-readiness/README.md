# Read-only DDL resolution readiness audit

## Purpose and authorization boundary

Prepared on 2026-09-16 for independent review. This is a **non-authoritative,
documentation-only readiness audit**, not resolution of startup migrations.
Its universe is **8 startup owners, 1,435 mapping identities, 1,459 DDL source
occurrences, and 110 additional-operation identities**: 1,545 review records.
Occurrences are source observations, not counts of runtime executions.

All 1,435 mappings and 110 additional operations remain **UNRESOLVED**.
No database was accessed, and no migration, adoption, startup change, future
batch, workflow restart, browser test, installation, Git history mutation,
push, merge, Publish, or Deploy was performed for this audit. Writes are
limited to the eight new documents in this directory. Existing pilot documents,
authoritative evidence, source, configuration, memory, and metadata are outside
the write boundary.

The user reports that the corrected pilot was independently approved. The full
independent review was not supplied; this report does not claim to have read it.
This new package itself still requires independent review.

## Provenance

- Initial HEAD: `e03e2acf8f300dee738d3dd5cb8aafcc0da4d6ab`; clean worktree.
- Corrected pilot reference: `334711049ebe23e62745f290f40abd280c9f8cbe`.
  The current dependency matrix has no diff against that commit.
- Historical pilot reference: `f1ca85a8f7795c92453ee6bc52ba32d11a26515d`.
  The historical Education trigger row contains three additional operations;
  the corrected row contains four, including the indirect learner backfill.
  Historical evidence and corrected evidence must not be merged into one claim.
- Immutable canonical migration:
  `lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
  `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
- Initial input hashes are recorded in `inventory.json.inputPins`; final
  preservation checks and executed commands are recorded in `verification.md`.

## Read the package in this order

1. **This document:** scope, interpretation, and review boundary.
2. [Inventory](inventory.md) and [machine-readable inventory](inventory.json):
   exhaustive identities and occurrences, owner coverage, object grouping,
   full-source references and checksums, operation/data effects and risk links.
   Compact tuple encodings are explicitly documented; array indexes are joins,
   not substitutes for stable fingerprint/operation identities.
3. [Evidence gaps](evidence-gaps.md) and [machine-readable gaps](evidence-gaps.json):
   per-record gaps, checklist evidence, readiness labels, and open decisions.
4. [Dependency batches](dependency-batches.md): source-supported directed
   relationships, co-review groups, exclusions, branch distinctions, and
   independently gated future investigation. None is executed.
5. [Production evidence](production-evidence.md): exact relevant record sets,
   facts still UNKNOWN, separate access approvals, provenance, privacy and
   freshness requirements. This is not an access request or a query run.
6. [Verification](verification.md): reproducible DB-free consistency checker,
   actual results, in-memory negative cases, final Git scope and preservation.

## What source completeness means

`SOURCE EVIDENCE COMPLETE` requires all applicable source checklist dimensions
to have explicit reproducible evidence: exact identity/literal and every
occurrence; dynamic identifiers and control flow; fresh versus existing-data
transition semantics; canonical comparison beyond a candidate name; prerequisite
and later effects; intermediate and final postconditions; lock, timeout,
transaction, failure and recovery boundaries. A non-applicable dimension
requires a reason. A missing, unreviewed or merely presumed proof cannot pass.

`SOURCE EVIDENCE INCOMPLETE` means at least one of those dimensions remains
unproved. It does not mean the record is absent from the inventory. In this
package **all 1,545 records are SOURCE EVIDENCE INCOMPLETE; none is SOURCE
EVIDENCE COMPLETE**. This conservative result distinguishes exhaustive
mechanical coverage from exhaustive semantic investigation.

The following independent labels can coexist with either source label:

| Label | Measurable reason for assigning it |
|---|---|
| `PRODUCTION EVIDENCE REQUIRED` | At least one applicable catalog, row invariant, execution/release, permission, or recovery fact lacks authorized production evidence; the associated request identifies its record set. All records require such evidence here. |
| `BUSINESS DECISION REQUIRED` | The record has the `business-decision` gap because its existing effect is destructive/data-changing or replacement and therefore requires an approved business decision and owner. This mirrors `evidence-gaps.json.gapCatalog["business-decision"]`; it is an open requirement, not approval. |
| `BLOCKED BY DEPENDENCY` | Prerequisite or later-effect closure remains unproved and is linked to the dependency investigation. This includes unresolved dependency discovery, not only proven executable graph edges. |

The two source labels are mutually exclusive. No readiness label changes an
authoritative status, proves production safety, or states that the candidate as
a whole is ready for resolution. Production facts are **UNKNOWN**, never
inferred from canonical definitions, marker names, local source or fake tests.

## Lessons carried forward from the pilot

- Canonical definition equality can describe an end state. It does not prove
  historical execution, existing-row correctness, equivalent transitions, or
  safe removal.
- Repeated SQL with different operation kinds retains distinct fingerprints.
  Multiple DDL occurrences inside a literal remain individually represented.
- Source order alone does not establish semantic dependency. Graph edges need
  a reason and source anchors. Shared objects identify co-review needs, not
  automatically prerequisites or executable migration order.
- Business Growth's intermediate repair, current-marker fast path, full rollout,
  and later Education reconciliation remain separate. Full-rollout payment
  literals at 4923/4928 cannot borrow the curated fast-path evidence ID.
- The Education learner-ID update is an indirect, later same-transaction state
  dependency: it is not a field read by the trigger predicate. A transaction's
  final postcondition differs from a trigger's intermediate postcondition.
- Additional operations have independent evidence and authorization gates.
  DDL comparisons cannot implicitly resolve data changes, cleanup/report reads,
  function replacements, markers, locks, or session state.
- `IF [NOT] EXISTS`, retry, suppressed errors and a rollout marker are not
  rollback or execution-completion evidence. Concurrent indexes, committed
  mutations, GUC cleanup and cross-owner replacement require explicit recovery
  analysis.
- The pilot's bounded source-anchor checker was not exhaustive SQL semantics.
  The new mechanical checks similarly verify documentation consistency, not
  correctness of every SQL transition or production safety.

## Review workload and stopping condition

The initial estimate is **14–36 reviewer hours** for grouped independent review:
methodology 2–4 hours, eight owner reviews at 1–3 hours each, cross-owner/batch
checks 2–4 hours, and final consistency review 2–4 hours. This is neither agent
runtime nor exhaustive semantic resolution of 1,545 records. Object-connected
groups, dynamic identities, newly discovered dependencies and separately
authorized production/business investigation may substantially increase it;
see the graph-based refinement in `dependency-batches.md`.

Reviewers should rerun the fenced checks, challenge the semantics and group
boundaries, confirm the historical/corrected distinction, and record approval
or precise blockers. This package stops at delivery for that review. It does
not create follow-up tasks, execute proposed batches, request credentials, or
authorize any later database access or change.