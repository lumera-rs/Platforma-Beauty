# Database-free verification

## Verification boundary

The static validator may read local text/JSON, compute SHA-256 hashes, compare
contracts and run in-memory negative fixtures. It must have no database
client, network operation, SQL execution, file write operation, child process
execution, application/startup import or environment-secret access.
Existing input validators and executable source files are read as text, never
imported or executed.

Before running, inspect the complete new validator and each locally imported
helper. Audit imports and called functions, not only filenames. Run only:

```text
node docs/production-evidence-execution-plan/validate.mjs
```

This command does not run a production diagnostic. SQL remains external text.
No application server, browser, workflow, dependency installation or database
is needed for this preparation.

## Assertions

Validation must independently reconcile exact identities and links against
the external evidence matrix, procedures, inventory, diagnostic catalog and
section/target manifests. Count-only equality is not sufficient. Required
totals are 1,435 mappings, 1,459 occurrences, 110 additional operations,
8 startup owners and 1,545 unique authoritative records.

Every required PE-to-record assignment must have its P/D mapping or explicit
blocker, prerequisites and planned evidence. No missing, duplicate or orphan
ID may be hidden by a correct total. Dynamic, malformed or unsupported
targets cannot become eligible through this plan.

The preparation remains disabled, approvals and production facts remain
UNKNOWN, and all authoritative records remain UNRESOLVED. Future evidence
statuses are not authoritative statuses. The empty capture template is not
observed evidence.

Check exact per-statement limits, no-SQL zero caps, mandatory safety gates,
all required failure cases and manual P-05 transitions. A missing or unknown
gate blocks access. All negative fixtures must change their input and reject
with their exact expected reason, not any exception.

## Limitations of a pass

- Static source integrity is not verification of production identity or state.
- No SQL was planned by PostgreSQL or executed; runtime cost, privilege,
  locks, data sensitivity, schema compatibility and result completeness are
  not established.
- A row LIMIT is not a byte limit or a universal bound on internal work.
  Byte and resource budgets require a separately approved collector.
- Hash equality detects changes; it does not establish truth, operator
  authority, confidentiality, authenticity or successful recovery.
- No backup, restore rehearsal, active-instance inventory, monitoring,
  production privilege or approval was obtained.
- The capture contract specifies future handling. This package does not
  implement storage, signing, a collector, an approval service or a live
  evidence ingest pipeline.

The final report records observed test results and Git state, including the
external untracked attachment. Independent Claude Code review is still required.

## Observed preparation verification

The delivered validator and both test modules were inspected before execution.
Imports are limited to local validation helpers and Node filesystem reads,
directory enumeration, path handling, SHA-256 and assertions. No file-writing
generator is delivered or imported. There is no database/network/SQL/child
process capability on the validation path.

The final completed run printed:

```text
validate.mjs: baseline valid; 59 negative fixtures rejected with exact errors; every mutation observed.
```

Each rejection is printed with its fixture name and exact error. The original
positive candidate is independently loaded from disk, then each negative
candidate is cloned in memory and required to differ before rejection.

| Regression class | Expected rejection |
|---|---|
| Missing/duplicate procedure or diagnostic | `E_PROCEDURE_DUPLICATE_OR_UNKNOWN` / `E_DIAGNOSTIC_DUPLICATE_OR_UNKNOWN` |
| Wrong, duplicate, orphan record; owner/occurrence mismatch | Specific `E_RECORD_*`, `E_OWNER_MISMATCH:*`, `E_OCCURRENCE_MISMATCH:*` |
| Execution without approval | `E_EXECUTION_NOT_APPROVED` |
| Diagnostic-level execution without approval | `E_DIAGNOSTIC_EXECUTION_NOT_APPROVED:D-05` |
| Missing approval / weakened procedure approval | `E_APPROVAL_STATUS_INVALID` / `E_PROCEDURE_SOURCE_DRIFT:P-01:approvalGate` |
| Missing/hollow gate or skipped restore before metadata | `E_GATE_CONTRACT_INVALID*` / `E_STAGE_ORDER_INVALID:stage-1` |
| P-05 automatic transition / missing phase approval | `E_P05_PREFLIGHT_CONTRACT_INVALID` / `E_P05_PREFLIGHT_APPROVAL_REQUIRED` |
| P-05 target or inner-cap weakening | `E_P05_FIXED_PHASE_CONTRACT_INVALID` |
| False production claim, forged capture or procedure result | `E_PRODUCTION_CLAIM_NOT_ALLOWED`, `E_TEMPLATE_CONTRACT_INVALID`, `E_PROCEDURE_FIELD_INVALID:P-01` |
| Invalid/missing evidence status, timestamp, parameter or hash contract | `E_TEMPLATE_CONTRACT_INVALID` / `E_TEMPLATE_FIELD_POLICY_INVALID` |
| Changed authoritative-status rule or PASS/FAIL/UNKNOWN interpretation | `E_AUTHORITATIVE_STATUS_RULE_INVALID` / `E_INTERPRETATION_INVALID:*` |
| Missing abort policy or any one of its eleven failure causes | `E_ABORT_PROCEDURE_MISSING` |
| Contradictory automatic repair instruction | `E_ABORT_ACTION_INVALID` |
| Timeout/read-only cap weakening, D-06 or D-08 cap drift | `E_ENVELOPE_LIMITS_INVALID` / `E_DIAGNOSTIC_CAP_INVALID:*` |
| Retry-policy removal | `E_ENVELOPE_SAFETY_POLICY_INVALID` |
| Pin drift / removing a path from both candidate pin lists | `E_PROTECTED_HASH_DRIFT:*` / `E_PROTECTED_PATH_INVENTORY_MISMATCH` |
| Stage, dependency or diagnostic mapping corruption | Specific `E_STAGE_*`, `E_DEPENDENCY_LINKS_INVALID`, `E_PROCEDURE_MAPPING_INVALID` |
| Authoritative resolution claim | `E_RECORD_STATUS_INVALID:*` |
| Coverage-level authoritative resolution claim | `E_COVERAGE_STATUS_INVALID` |

Independent filesystem hashing confirmed **85 protected input files**, including
the **original 73**, unchanged. Coverage confirmed **1,435 mappings**, **1,459
occurrences**, **110 additional operations**, **8 owners**, **1,545 unique
UNRESOLVED records** and **8,304 requirement links**. Production facts remain
UNKNOWN. No evidence object was collected.

The integration check initially caught a distinction between this package's
`object-group:N` inventory-row references and the target manifest's structured
group identities. The validator now resolves the references through the pinned
inventory and asserts the actual identities before checking coverage; the
completed run above includes that correction.

Policy pins for the new envelope/template/phase contract are deliberately
fail-closed preparation checks, not an independent approval or a general
natural-language safety verifier. This is not a live capture-ingestion validator.
Any future collector and evidence store still require their own review.