# Task #943 — reusable collection procedure catalog

These are authorization-gated future procedures, not execution instructions.
They collect no data now and cannot change a mapping or operation status.

| ID | Procedure | Evidence requirement | Required output |
|---|---|---|---|
| P-01 | Target/release attestation | PE-01 | Signed target, release, collector, time, digest |
| P-02 | Ledger/marker/branch attestation | PE-02 | Atomic marker/ledger observation and branch label |
| P-03 | Catalog definition capture | PE-03 | Definitions, digests, owner, namespace, validity |
| P-04 | Constraint/index health check | PE-04 | Per-object health and bounded workload classification |
| P-05 | Invariant/backfill assessment | PE-05 | Aggregate counts and redacted exception classes |
| P-06 | Business policy authorization | PE-06 | Decision reference, scope, and compensation boundary |
| P-07 | Runtime lock/recovery observation | PE-07 | Bounded runtime and failure/recovery classification |
| P-08 | Privilege/release compatibility review | PE-08 | Least-detail capability and compatibility matrix |
| P-09 | Restore/observability attestation | PE-09 | Restore/compensation, monitoring, and rollback record |
| P-10 | Independent disposition review | PE-10 | Independent disposition, exceptions, and re-review trigger |

The JSON catalog contains inputs, outputs, privacy boundary, and freshness
rules for each procedure. References are bidirectional: each `P-*` lists its
`PE-*`, and each matrix requirement lists the corresponding `P-*`. All remain
**UNRESOLVED** until separately authorized, collected, and independently
reviewed.

Production database access is required only for P-02, P-03, P-04, P-05, P-07,
and P-08. P-01 target/release attestation, P-06 business authorization, P-09
restore/observability attestation, and P-10 independent review use controlled
governance or operational evidence and do not themselves require a production
database connection.

Every procedure is required to expose an exact expanded record-ID selector,
facts to establish, input and output format, interpretation of PASS/FAIL/UNKNOWN,
prerequisites, risk classification, production-access flag, business-decision
flag (or an explicit not-applicable reason), approval gate, and stop conditions.
Every one of these fields is physically stored on each machine-readable
procedure. The shared expansion metadata documents the common policy but is
not used to inject missing catalog fields. Approximate owner/name selectors
are forbidden.

`exactFactsToEstablish` is a procedure-specific array of concrete facts. Each
array enumerates the identities, states, counts, boundaries, provenance, or
review decisions that a future evidence envelope must establish. It is not a
copy or restatement of `purpose`; an empty array, generic purpose duplicate, or
non-enumerated value fails static validation.