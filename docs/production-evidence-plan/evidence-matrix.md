# Task #943 — production evidence matrix

This is a machine-readable, fail-closed plan. It asserts no production fact and
does not authorize a connection, query, migration, deployment, or status change.
Every mapping, occurrence, and additional operation expands from the pinned
readiness inventory and remains **UNRESOLVED**.

## Coverage

| Population | Exact count | Identity source | Profile |
|---|---:|---|---|
| DDL mappings | 1,435 | `inventory.mappingIds[i]` joined to `records.mappings[i]` | `mapping-default` |
| Source occurrences | 1,459 | `inventory.occurrences[i]` | `occurrence-default` |
| Additional operations | 110 | `inventory.additionalOperationIds[i]` joined to `records.additionalOperations[i]` | `operation-default` |
| Owners | 8 | `inventory.owners[*][0]` | owner index in each tuple |

The JSON matrix physically stores 1,545 records in `records` (not a sample):
1,435 mapping records plus 110 additional-operation records. Every stored record has an
authoritative ID, operation type, startup owner, source locations and
fingerprint, occurrence references, status, evidence/gap
references, dependencies, business-decision disposition, procedure IDs,
artifact, validation, risk, prerequisite, approval, phase, and blockers.
The validator also requires the union of mapping occurrence references to be
exactly 1,459.

P-05/PE-05 applicability is record-specific. It is added to mappings whose
exact operation kind is index creation, constraint addition/validation, or
type/table alteration. These classes require evidence about relevant null,
duplicate, referential-integrity, coercion, index-build distribution, or
transition state. Unrelated purely structural DDL does not inherit P-05.

Primary components are deterministic connected components over each record's
actual `objectGroupIndexes`; the five source-lifecycle exceptions and the
`B-09-object-component/<leader>` rule are the assignment defined in
`dependency-batches.md`. No owner bucket or name approximation substitutes for
that assignment.

Collection procedure applicability is physically stored as
`exactApplicableRecordIds` on every procedure and must equal the reverse
selection over all 1,545 persisted records' `proposedCollectionProcedureIds`.
It is never an owner, operation-name, or approximate object selector.

## Evidence requirements

`PE-01` target/release; `PE-02` ledger and marker reachability; `PE-03`
catalog definition and binding; `PE-04` index/constraint validity; `PE-05`
data invariants and backfills; `PE-06` business authorization and compensation;
`PE-07` transaction/lock/session/recovery; `PE-08` privileges and dependent
release compatibility; `PE-09` restore and observability; `PE-10` independent
review disposition. Each requirement states the necessary fact, its current
unknown state, and a bidirectional procedure reference in the JSON files.

## Acceptance gate

Evidence is usable only when it identifies target and release, exact IDs and
occurrences, object groups, observed fact versus inference, authorization,
minimization, retention/freshness, immutable digest, and independent review.
Missing any of these leaves the relevant record **UNRESOLVED**.

See [`collection-procedures.md`](collection-procedures.md) for the reusable
catalog and [`evidence-matrix.json`](evidence-matrix.json) for exact profiles,
requirements, and cross-references.