# Pre-execution safety gates

## Non-negotiable status

This document is a prospective control contract. It is not production
authorization and contains no executable SQL. Every unknown, absent, stale,
contradictory, or unverified condition is **BLOCKED**. A blocked gate leaves
all affected authoritative records `UNRESOLVED`; no retry, repair, migration,
deployment, worker restart, or status transition follows automatically.

## Gate ledger

The labels **G0–G9** below are inherited review layers from the approved
planning package. They are not the machine transition IDs. The future
executor's atomic machine gates are **G-01–G-10**. A procedure does not
require all ten machine gates to report a P-05 success, and P-05 success is
never an entry prerequisite for P-05 PREFLIGHT. The mapping is:

| Inherited review layer | Machine-gate responsibility |
|---|---|
| G0 identity/inventory/authorization | G-01 identity, inventory, and authorization |
| G1 static dependency/source review | G-02 static dependency and manifest integrity |
| G2 target/ledger/release reachability | G-03 target, ledger, and release reachability |
| G3 catalog/operational state | G-04 catalog, privilege, and operational state |
| G4 invariant/business authorization | G-07 bounded business/policy authorization |
| G5 restore/release/independent review | G-09 restore/release/observability and G-10 disposition |
| G4 (hard timeout/result controls) | G-04 read-only execution envelope |
| G5 (monitored resource budget) | G-04 monitoring boundary and G-08 runtime readiness |
| G6 privacy/minimization | G-01 authorization scope and G-04 capture boundary |
| G7 external operations attestations | G-08 runtime/lock/recovery and G-09 restore/operations |
| G8 P-05 precondition | G-05 PREFLIGHT promotion/exit and G-06 SCAN approval |
| G9 final review/abort | G-09 recovery and G-10 independent disposition |

The machine gate names are exact: G-01 identity/inventory/authorization,
G-02 static dependency review, G-03 target-ledger reachability, G-04
catalog-operational state, G-05 P-05 PREFLIGHT, G-06 independent P-05 SCAN
approval, G-07 business-policy authorization, G-08 runtime lock/recovery
readiness, G-09 restore-release-observability, and G-10 independent
disposition.

This is a responsibility map, not permission to skip a machine check. All
pre-access requirements must be proven before the first SQL statement:
identity, approvals, static scope, target/release binding, role and
read-only setup, fixed identifiers, timeout/result limits, privacy boundary,
and current monitor/cancel thresholds. A non-SQL **PRECHECK** may satisfy
fresh external identity, operations, and restore attestations where the
machine contract allows it; PRECHECK is not a substitute for SQL evidence and
does not satisfy P-05. Successful P-05 PREFLIGHT is the **exit condition of
G-05**, not the entry condition of G-05 or of its own PREFLIGHT. P-10's
initial scope sign-off is a G0/G-01 authorization; its final independent
disposition is G9/G-10. They are separate events.

| Gate | Required decision | Minimum proof | If not proven |
|---|---|---|---|
| G0 identity, inventory, authorization | exact target and complete scope | fresh non-secret target attestation, four approvals, digest-verified joins | BLOCKED |
| G1 static dependency review | exact source/dependency interpretation | pinned inventories, 15 dependency edges, no invented edge | BLOCKED |
| G2 target and ledger reachability | approved target/ledger branch | separate authorization and bounded observations | BLOCKED |
| G3 catalog and operational state | qualified objects and operational boundaries | allow-listed metadata plus owner attestations | BLOCKED |
| G4 invariant and business authorization | safe bounded assessment | P-05 preconditions plus policy approval | BLOCKED |
| G5 restore, release, independent review | recoverable and reviewable package | successful restore rehearsal, observability, sign-off | BLOCKED |

No gate is satisfied by an application assumption, a development database,
an enabled backup, a session view, or a historical source literal.

## G0 — identity, inventory, and authorization

Before any future approach to production, create a fresh, non-secret target
attestation containing target alias, environment alias, database and schema
scope, deployed revision(s), supported mixed-release/rollback window,
collector, capture time, retention, and immutable input digests. Verify the
target from an approved control plane or owner attestation; never assume
development equals production. Do not commit hostnames, URLs, credentials, or
tokens.

Reconcile exactly:

* 1,435 `mappingIds` to `records.mappings`;
* 110 `additionalOperationIds` to `records.additionalOperations`;
* 1,459 occurrence references;
* 1,044 object groups;
* 1,545 identities; and
* eight startup owners.

The union of mapping occurrence references must equal 1,459. Reject missing,
extra, duplicate, reordered, or owner/name-approximated joins. Confirm
`NO_SOURCE_EDGE_YET` is retained rather than silently resolved. Confirm the
canonical migration input digest is
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.

Four separate, time-bounded approvals are mandatory: system owner, data
owner, business/policy owner, and independent reviewer. Approval references
are nonidentifying and resolve only in the controlled approval system. Stage-0
must include manual initial-scope review for P-06, P-07 operations, P-09
operations, and P-10.

## G1 — static dependency and source review

Review the pinned readiness, pilot, additional-operation, crosswalk, and
diagnostic manifests without changing them. Preserve all required edges:

* DEP-001/002: full Business Growth payment literals 4923/4928 precede the
  selected target-check validation;
* DEP-003: Business Growth full function 4939 and Education payment
  trigger/function require co-review;
* DEP-004/005: Education payment backfill/function precede its trigger;
* DEP-006/007: learner/target reconciliation and postconditions are later
  state;
* DEP-008: shared Business Growth/Education advisory-lock lifecycle;
* DEP-009/010: web-push expiry add, backfill, then `NOT NULL`;
* DEP-011: shipping cleanup precedes singleton unique index;
* DEP-012: referral column precedes tracking backfill;
* DEP-013: booking table precedes scoped unique index;
* DEP-014: media type/users precede image-assets relation; and
* DEP-015: marketplace concurrent-index recovery boundary.

Owner order is not semantic dependency. A fast-path ID cannot replace a full
literal, and a later postcondition cannot be made a prerequisite by
assumption. Any unknown branch, dynamic identifier, or source mismatch blocks
the gate.

## G2 — target, ledger, and release identity

Verify the target and release again immediately before any database leg.
Capture only the approved target/release metadata, migration/adoption ledger
state, Business Growth marker provenance, and supported branch reachability.
Intermediate, fast, full, and final-eighth-owner paths remain distinct. A
current marker does not establish historical completion or retirement.

The target/release attestation must be fresh under the owner-approved
freshness window. A DDL, write, marker/release update, role/extension change,
deployment, failover, or topology change invalidates the attestation and all
dependent evidence.

## G3 — privilege, read-only mode, and fixed identifiers

The collector must use a dedicated least-privilege role. Verify grants against
the approved manifest before connection. Any role escalation, `SET ROLE`,
write-capable fallback, broad owner privilege, or implicit search-path
resolution is a hard block. The collector may not grant privileges, create
objects, invoke discretionary/application functions, or change GUCs beyond the
explicitly approved read-only envelope. Some approved catalog designs use
built-in functions. Their exact, allow-listed catalog execution privileges are
not discretionary `EXECUTE` or escalation: they require a separate security
review and explicit approval. If that exact review is unavailable, stop; do
not grant a privilege or use a superuser to make the observation possible.

Read-only mode is a fail-closed precondition for every statement. Verify it
before observation and verify transaction/session cleanup afterward. Failure
to verify means no result is accepted.

Identifiers must be fixed, quoted, and digest-verified. Approved schema,
relation, function, and target bindings are exact; no dynamic SQL, broad
catalog search, arbitrary search path, user-supplied identifier, or fallback
namespace is permitted. A `LIMIT` bounds returned rows only; it does not bound
scan cost, I/O, lock duration, or CPU.

## G4 — hard timeout and result controls

The future executor must reject any capture whose machine envelope does not
assert:

| Control | Required value |
|---|---:|
| Statement timeout | 15 seconds |
| Lock timeout | 1 second |
| Idle-in-transaction timeout | 10 seconds |
| Connection cap | 1 |
| Per-input chunk | 100 IDs maximum |
| Normal returned rows | 1,000 maximum |
| Normal serialized bytes | 2 MiB maximum |
| D-05 PREFLIGHT rows | 1 maximum |
| D-05 SCAN rows | 1 maximum |
| D-08 rows | 500 maximum |
| D-06 database rows/bytes | 0 / 0 |
| D-10 database rows/bytes | 0 / 0 |

The D-05 inner sample is at most two rows, but its externally returned
aggregate is capped at one row and must not contain row values; a cap does not
guarantee a row. Exactly one successful PREFLIGHT row is required only for
G-05 promotion. D-07 is an aggregate sample capped at 201 sessions. The
owner-bounded bytes for an external
instance/worker/restore attestation are a separate limit and must not be
confused with the D-06/D-10 SQL zero-byte limit.

## G5 — monitored resource budget

Before start, the system owner must approve numeric thresholds for elapsed
time, CPU, I/O, returned bytes, lock waits, blocked sessions, replica lag,
load, and errors; identify the monitor, sampling interval, and freshness
window; and identify who can cancel the capture. This plan deliberately does
not invent universal safe CPU, I/O, lag, or load thresholds. Any unknown
threshold, stale monitor, or unavailable cancel path is BLOCKED.

A threshold breach cancels the current observation, quarantines incomplete
evidence, and preserves affected records as unknown. Retrying requires a new
capture ID, a new review of scope/thresholds, and explicit approval; it is
never an automatic continuation.

## G6 — privacy and minimization

The default evidence contains identifiers, hashes, counts, bounded lengths,
safe definition/argument excerpts, and aggregate states only. Approved
excerpts are minimized at source and are not an invitation to collect raw text
and redact it afterward. If an excerpt may contain a secret, token, URL,
credential, payload, or personal data, do not capture it; mark the fact
unknown and block.

Typed evidence is written only to the reviewed restricted evidence store. No
URL, token, secret, PII, raw payload, or unreviewed approval identity may be
committed. Retention, access, deletion, and freshness are part of the
evidence envelope.

## G7 — external operations attestations

Database observations cannot prove external instance, worker, scheduler,
deployment, release-overlap, backup, restore, or failover facts. Obtain a
fresh, owner-signed attestation from the responsible operations control plane,
with target/environment alias, observed time, scope, result, bounded manifest,
and non-secret evidence reference. `pg_stat_activity` or a similar database
view is not an instance/worker/deployment attestation.

P-07 requires an external worker/writer/instance attestation. P-09 requires
proof of a **successful restore rehearsal**, including restore target/scope,
restore point, measured outcome, and owner attestation. “Backups enabled,” a
recent backup timestamp, or an untested backup URL is not restore proof.
Attestation bytes have a separate owner-approved cap.

## G8 — P-05 precondition gate

P-05 PREFLIGHT and SCAN are separate phases with separate manual approvals.
PREFLIGHT may be attempted only after all pre-access machine gates are
proven. It must produce exactly one successful result **for promotion** in the
same attempt for the same target, environment, SQL-row `capture_id`,
`chunk_id`, and `record_id`; it must say `target_exists=true` and validate the
current target-manifest hash. The one-row cap is not a promise that an
unpromoted attempt returns a row.

False, zero, duplicate, null, mismatched, stale, ambiguous, or hash-invalid
PREFLIGHT is `BLOCKED_PRECONDITION`. It forbids even preparing SCAN. A
continuity change invalidates both phases. No automatic phase transition is
permitted.

## G9 — restore and independent review

Before final review, verify successful restore rehearsal, observability,
incident owner, recovery objectives, retention, compensating action boundary,
dependent release/client compatibility, extension/privilege compatibility,
and an incident abort path. Obtain all four role sign-offs and independent
review. A missing or failed rehearsal keeps PE-09 and all dependent composites
blocked.

## Abort at any gate

The first failed condition wins. Cancel the observation if cancellation is
safe, close/clean the read-only transaction, quarantine partial output, record
the evidence hash and blocker, notify the incident owner, and preserve
affected authoritative records as `UNRESOLVED`. Do not repair production,
retry with the same capture ID, change a role, broaden identifiers, restart a
worker, or advance a phase.