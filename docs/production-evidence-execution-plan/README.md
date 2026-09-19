# Phase 5 — controlled production evidence collection preparation

**PREPARATION ONLY — EXECUTION NOT AUTHORIZED.**

This package turns the existing diagnostic design into a future, manually
gated collection plan. It contains neither a production executor nor production
evidence. It does not connect to any database, execute SQL, create migrations,
repair production, or change authoritative classifications.

All 1,545 authoritative records remain **UNRESOLVED**. All production facts,
target identity, operating conditions and approvals remain **UNKNOWN**.
Unproven mandatory prerequisites mean **BLOCKED**, not permission to proceed.
Design approval is not access approval or approval to execute a diagnostic.

## Package map

| File | Purpose |
|---|---|
| `execution-runbook.md` | Procedure-by-procedure instructions for P-01 through P-10 |
| `pre-execution-safety-gates.md` | Mandatory authorization, identity, privilege, resource, privacy, operational and recovery gates |
| `execution-order.md` | Manual stage ordering, including separate P-05 PREFLIGHT and SCAN approval |
| `evidence-capture-contract.md` | Future evidence identity, attribution, parameters, statuses, integrity and storage contract |
| `failure-and-abort.md` | Fail-closed handling, quarantine, incident notification and separately approved re-entry |
| `execution-plan.json` | Machine-readable preparation policy, procedure mapping and limits |
| `coverage-matrix.json` | Exact record-to-requirement-to-procedure/diagnostic-or-blocker traceability |
| `evidence-capture-template.json` | Empty future capture template; never an observed result |
| `protected-input-manifest.json` | Read-only integrity boundary around existing inputs |
| `validate.mjs` | Database-free static validation and exact-reason negative tests |
| `tests/validation-fixtures.mjs` | Independent source loading and in-memory negative mutations |
| `tests/validation.test.mjs` | Alternative entry point for the same validation suite |
| `verification.md` | Reproduction, limitations and final verification record |
| `provenance.md` | Initial HEAD, attachment history and implementation boundary |

The JSON and prose form one contract. A contradiction or missing requirement
blocks use; prose cannot override a machine restriction, and a validator pass
cannot grant execution authority.

The capture template validates preparation policy, not submitted live captures.
Its `evidenceStatus` and `validationStatus` are separate: an observation is not
automatically a validated object. Reviewed field-policy pins deliberately reject
unreviewed template changes. No build generator or file-writing utility is
delivered in this package.

## External authoritative inputs

Read and preserve the complete packages:

- `docs/production-evidence-plan/`, especially
  `docs/production-evidence-plan/collection-procedures.json` and `evidence-matrix.json`;
- `docs/production-diagnostic-design/`, including the SQL text, catalog,
  section manifest, target manifest and existing 73-file integrity boundary;
- `docs/ddl-resolution-readiness/`;
- `docs/ddl-resolution-pilot/`;
- `docs/additional-operations-evidence/`.

Crosswalk and startup inventory sources remain external:
`scripts/src/startup-migration-crosswalk.ts`,
`scripts/src/production-startup-ddl-inventory.ts` and
`scripts/src/production-startup-ddl-baseline.json`.
They are read as source text/data only, never imported or executed here.
The existing canonical migration is a comparison input, not an instruction to
apply it. Development state is not evidence about production state.

## Coverage is not execution or resolution

The plan traces **1,435 mappings**, **1,459 occurrences**, **110 additional
operations**, **8 startup owners** and **1,545 authoritative records**.
Records may require several procedures, so sums of procedure memberships
must not be mistaken for the unique-record total.

Within this package, `objectGroupIds` values of the form `object-group:N`
are references to row N of the hash-pinned readiness inventory's objectGroups
array, not newly assigned authoritative group identities. The validator resolves
each index to that row's actual group identity and compares it with the approved
record-to-target manifest. Record, mapping and occurrence IDs remain the exact
authoritative IDs throughout.

D-06 and D-10 are non-database attestations with no SQL output. The other
diagnostics supply only narrowly scoped supporting observations. A record
outside a diagnostic's approved static scope remains explicitly blocked;
coverage never broadens that scope. No PE composite requirement is discharged
by an SQL observation alone.

P-01 and P-09 retain their original non-database governance/operational
procedures. The later diagnostic package additionally contains D-01 and D-09
supporting SQL designs. This plan separates those optional SQL branches and
requires explicit new access authorization; it does not reinterpret the
original procedures as permission to query production.

## Review boundary

Before any future production access, obtain separate owner and independent
reviewer approvals for the exact target, frozen input hashes, stage, scope,
role, time window, monitoring budgets, evidence handling and abort procedure.
Require the data owner and business/policy owner sign-offs too. P-05 SCAN
requires an additional explicit phase decision after a fresh, unambiguous,
matching PREFLIGHT result; no automatic transition is permitted.

This delivery stops for independent Claude Code review. Access, execution,
retries, remediation, migration, adoption, publication and authoritative
status changes are not authorized by this package.