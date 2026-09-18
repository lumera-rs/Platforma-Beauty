# Production evidence execution runbook

## Status and authority

This is a **planning-only, fail-closed runbook**. It authorizes no connection,
query, deployment, migration, worker action, repair, or status change. A future
operator may use it only after the approvals and gates in
`pre-execution-safety-gates.md` have been independently satisfied. The
runbook does not authorize or describe changes to the authoritative packages;
their records remain `UNRESOLVED` for this plan and unobserved production facts
remain `UNKNOWN`.

The runbook refers to the approved diagnostic catalog, SQL-section manifest,
record-to-target manifest, evidence matrix, and collection-procedures package.
It does not reproduce or modify their SQL. The canonical comparison input is
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.

## Fixed scope

The future review package must reconcile, by stable IDs and not by owner/name
approximation:

| Population | Required count |
|---|---:|
| DDL mappings | 1,435 |
| DDL occurrences | 1,459 |
| Additional operations | 110 |
| Startup owners | 8 |
| Authoritative identities | 1,545 |
| Object groups | 1,044 |

`mappingIds[i]` joins only to `records.mappings[i]`,
`additionalOperationIds[i]` only to `records.additionalOperations[i]`, and
object groups only through their recorded `objectGroupIndexes`. The union of
mapping occurrence references must equal 1,459. A `NO_SOURCE_EDGE_YET` finding
is retained as a finding; it is not resolved by a similar owner or object
name.

## Common operating envelope

Every database diagnostic, if separately authorized, uses a dedicated
least-privilege role and a read-only transaction. The executor must fail closed
if read-only mode cannot be verified. These are hard limits, not suggestions:

* `statement_timeout`: **15 seconds**.
* `lock_timeout`: **1 second**.
* `idle_in_transaction_session_timeout`: **10 seconds**.
* concurrent diagnostic connections: **1**.
* normal result limit: **1,000 rows** and **2 MiB** of serialized result bytes.
* D-05 PREFLIGHT: **at most 1 row** and **2 MiB**.
* D-05 SCAN: **at most 1 row** and **2 MiB**.
* D-08: **at most 500 rows** and **2 MiB**.
* D-06 and D-10: **zero database rows, zero database bytes**.
* each deterministic input chunk: at most **100 IDs**.
* `captureId`: opaque, required, and no longer than **128 characters** in the
  future envelope; SQL output rows retain `capture_id`.

The 2 MiB limit bounds returned SQL results, not work performed by a scan.
Every row and byte value above is a maximum bound, not a guarantee that a
successful capture returns a row. The sole promotion exception is P-05:
successful PREFLIGHT promotion through machine G-05 requires exactly one
matching successful row. No other row-count cap implies a one-row result.
`LIMIT` is not a scan-cost or lock-safety bound. The owner-approved monitor
must also have numeric elapsed, CPU, I/O, bytes, lock/blocked-session,
replica-lag, and load/error thresholds with an identified monitor and
freshness window. No universal “safe” CPU, I/O, lag, or load number is
invented here. An unknown threshold, monitor, or freshness value blocks the
diagnostic.

Identifiers are fixed, quoted, and taken from the digest-verified target
manifest. They are never assembled from user input, searched broadly, or
expanded dynamically. Namespace, relation, function, and search-path
allow-lists are required where the catalog specifies them. No diagnostic may
emit payloads, secrets, credentials, tokens, URLs, or personal data.

## Procedure map

| Procedure | Purpose | Diagnostic(s) | Future access branch | Stage | Static scope and cap |
|---|---|---|---|---:|---|
| P-01 | Target and release attestation | D-01 | Governance/operations; D-01 SQL leg needs separate authorization | 1 | 1,545 records, 16 chunks |
| P-02 | Ledger, marker, and branch reachability | D-02 | Database, read-only | 2 | 3 exact records, 1 chunk |
| P-03 | Catalog object definitions | D-03 | Database, read-only | 2 | 13 exact records, 1 chunk |
| P-04 | Constraint/index health | D-04 | Database, index-only read-only | 2 | 19 exact records, 1 chunk |
| P-05 | Invariant/backfill assessment | D-05 | Database, two manually gated phases | 4 then 5 | 1 exact diagnostic record; at most one result row per phase |
| P-06 | Business policy authorization | D-06 | Governance/business; no database | 0 and 6 review input | 0 database records/rows/bytes |
| P-07 | Runtime lock and recovery | D-07 | Database plus operations attestation | 3 | 1,545 records, 16 chunks; aggregate sample capped at 201 sessions |
| P-08 | Privilege and release compatibility | D-08 | Database, read-only catalog/function leg | 3 | 3 exact records, 1 chunk |
| P-09 | Restore and observability | D-09 | Governance/operations; D-09 SQL leg needs separate authorization | 1 | 118 records, 2 chunks |
| P-10 | Independent disposition | D-10 | Governance/reviewer; no database | 0 and 6 | 0 database records/rows/bytes |

The table is an execution map, not evidence that any procedure passed.
Supporting observations D-01, D-02, D-03, D-04, D-07, D-08, and D-09 cannot
alone resolve a production-evidence composite. D-05's bounded count cannot
prove the invariant/backfill assessment. D-06 is an authorization record, not
a database fact, and D-10 is a reviewer disposition, not a database fact.

### Static diagnostic ledger

These are manifest counts, not production results. `Blocked` is the static
number of records that have no permitted future database observation under the
diagnostic contract; it is not a failed production query.

| Diagnostic | Procedure | Exact applicable | Static blocked | Chunks | Database result cap |
|---|---|---:|---:|---:|---:|
| D-01 | P-01 | 1,545 | 0 | 16 | normal |
| D-02 | P-02 | 3 | 4 | 1 | normal |
| D-03 | P-03 | 13 | 1,459 | 1 | normal |
| D-04 | P-04 | 19 | 651 | 1 | normal |
| D-05 | P-05 | 1 | 1,216 | 1 | at most 1 row per phase |
| D-06 | P-06 | 0 | 111 | 0 | 0 rows / 0 bytes |
| D-07 | P-07 | 1,545 | 0 | 16 | aggregate session sample ≤201 |
| D-08 | P-08 | 3 | 71 | 1 | at most 500 rows |
| D-09 | P-09 | 118 | 0 | 2 | normal |
| D-10 | P-10 | 0 | 1,545 | 0 | 0 rows / 0 bytes |

The safe partial-observation total is D-01 1,545 + D-02 3 + D-03 13 +
D-04 19 + D-05 1 + D-07 1,545 + D-08 3 + D-09 118. This total describes
permitted static observations only. All such future outcomes are
`PARTIAL_OBSERVATION_WITH_BLOCKERS` until every applicable non-database
requirement is separately reviewed. D-06 and D-10 remain
`BLOCKED_NON_DATABASE_ATTESTATION`.

## Required approvals and phase discipline

Every capture package has four distinct sign-offs: named **system owner**,
**data owner**, **business/policy owner**, and **independent reviewer**. A
reviewer must be independent of the preparer and collector. Approval
references are nonidentifying references to a controlled approval record; no
email addresses, tokens, or secrets are committed.

At Stage 0, obtain manual approvals for the complete scope and for the initial
scope review of **P-06, P-07 operations, P-09 operations, and P-10**. Later
stages are separately released by manual sign-off. There are no automatic
stage, phase, retry, or disposition transitions. A failed gate leaves
affected records `UNRESOLVED`.

P-05 is a strict two-phase contract:

1. PREFLIGHT is captured and reviewed.
2. Only a human with a new phase approval may authorize SCAN.
3. SCAN uses the same approved target binding and a fresh phase evidence ID.

PREFLIGHT has a one-row cap, not a guaranteed row. It must have exactly one
successful result **for promotion through machine G-05**, using the same
`capture_id`, `chunk_id`, `record_id`, target, and environment, with
`target_exists=true` and a verified current input hash. False, zero, duplicate,
null, mismatched, stale, or otherwise ambiguous results are
`BLOCKED_PRECONDITION`; SCAN must not be prepared, much less executed. A
continuity change (DDL, write, marker/release change, role/extension change,
deployment, failover, or topology change) invalidates both phases and requires
a new attempt. `captureId` is shared by the two phases within the one attempt/
chunk; each phase has its own unique `evidenceId` and stable shared
`parentAttemptId`.

## Per-procedure operating instructions

### P-01 — Target/release attestation

#### 1. Purpose

Establish the intended target alias, environment, database identity, schema
scope, deployed revision(s), supported mixed-release/rollback window,
collector, capture time, retention, and immutable manifest digests. This is
attestation, not proof that development and production are identical.

#### 2. Prerequisites

Stage-0 identity and inventory reconciliation must pass. The target must be
identified through a fresh, non-secret attestation from the approved
environment; a development alias must never be substituted for production.
The exact 1,545 record IDs and 16 sorted chunks must match the pinned manifest.

#### 3. Approvals

The four role sign-offs, Stage-0 scope approval, and a named operator
attestation are required. If the optional D-01 metadata observation is
requested, it needs a separate explicit authorization for that SQL supporting
leg; P-01 itself remains a governance/operations procedure.

#### 4. Exact order

Verify approval freshness, then target/environment identity, revision and
release window, schema scope, collector identity, time/retention, and input
digests. Bind the capture to the exact chunk and record IDs. If approved
separately, collect D-01 metadata under the common envelope; validate its
read-only state before and after the observation.

#### 5. Related diagnostics

D-01, 1,545 exact records in 16 chunks. D-01 parameters are `capture_id`,
`record_ids` (text array), and `chunk_id`.

#### 6. Expected evidence format

The observation schema is: non-null `capture_id` text, `chunk_id` text,
`record_id` text, `database_name` name, `server_version_num` text, and
`transaction_read_only` text. The attestation additionally carries target
alias, environment alias, revision, release window, collector, capture time,
retention, and input hashes without secrets.

#### 7. Safety boundaries

Do not emit connection strings, hostnames that reveal secrets, URLs, tokens,
payloads, or PII. D-01 is metadata only. No instance restart, worker action,
deployment, migration, or status update is permitted. A running session list
is not deployment or worker attestation.

#### 8. Stop criteria

Stop on any identity/count/digest mismatch, stale revision, unknown target,
unknown environment, missing approval, read-only verification failure,
timeout, cap, or unapproved relation. `transaction_read_only` that is not
explicitly verified is a blocker.

#### 9. Result documentation

Store the signed attestation and, if authorized, the D-01 observation as
separate typed evidence. Record scope, freshness, hashes, monitor values,
exceptions, and the blocker reason. A PASS states only that this attestation
was observed in its stated scope; it does not resolve any record.

### P-02 — Ledger/marker/branch reachability

#### 1. Purpose

Establish the exact migration/adoption ledger, Business Growth marker
provenance, and supported branch reachability for three approved records.

#### 2. Prerequisites

P-01 target/release approval, exact D-02 manifest bindings, fixed namespace
and relation allow-lists, and current ledger/marker authorization are required.
Do not infer that a marker proves historical completion or retirement.

#### 3. Approvals

All four role sign-offs plus Stage-2 manual release are required. The
business/policy owner must approve the branch interpretation; technical access
does not supply that approval.

#### 4. Exact order

Validate the target and read-only envelope, then inspect only the exact
allow-listed ledger/marker objects and exact record set. Preserve distinctions
between intermediate, fast, full, and final-eighth-owner paths. Validate
capture/chunk/record bindings and close the read-only transaction.

#### 5. Related diagnostics

D-02, three records, one chunk. Parameters: `capture_id`,
`approved_schema_names`, `approved_relation_names`, `chunk_id`, and
`target_bindings`.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, and `record_id`; `object_found` boolean;
nullable `marker_relation` name; nullable `estimated_rows` bigint. The
evidence must also carry the branch interpretation as reviewer inference,
never as an observed catalog value.

#### 7. Safety boundaries

Allow-listed fixed identifiers only; no broad search path, dynamic identifier,
or inferred relation. A row estimate is not proof of execution, completion, or
business safety. Result limits and scan-cost monitoring remain mandatory.

#### 8. Stop criteria

Stop on unknown marker provenance, unknown ledger branch, release overlap,
unexpected object, invalid binding, lock wait, timeout, read-only failure,
result cap, or any mismatch between manifest and target.

#### 9. Result documentation

Record each exact fact, inference, source scope, freshness, and unresolved
branch. Preserve `UNKNOWN` for historical execution or retirement not directly
observed; do not translate a marker into a resolution.

### P-03 — Catalog definitions

#### 1. Purpose

Collect minimized catalog definitions for 13 exact approved records, including
qualified relation/type/column/default/constraint/index/function/trigger
identity, owner, namespace, binding, validity, extension/version, and
privilege classification where applicable.

#### 2. Prerequisites

P-01 and P-02 target/ledger review, exact 13-record manifest, fixed schema and
relation allow-lists, reviewed definition excerpt bounds, and a Stage-2
release are required.

#### 3. Approvals

The four role sign-offs and manual Stage-2 release are required. Data-owner
approval covers the definition excerpt boundary; system-owner approval covers
the catalog role.

#### 4. Exact order

Verify read-only mode and allow-lists, inspect only the exact objects, capture
bounded safe definition excerpts and lengths, validate output bytes/rows, and
close the transaction. Do not perform a data scan merely to establish shape.

#### 5. Related diagnostics

D-03, 13 exact records, one chunk. Parameters are
`capture_id`, `approved_schema_names`, `approved_relation_names`, `chunk_id`,
and `target_bindings`.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, `record_id`, and `object_found`; nullable
`nspname` name, `relname` name, `relkind` char, `owner_name` name,
`definition_excerpt` text, and `definition_length` integer. Excerpts are
bounded and pre-approved safe minimization, not a license to capture then
redact sensitive text.

#### 7. Safety boundaries

No payloads, secrets, URLs, tokens, or PII. Fixed quoted identifiers and
manifest bindings prevent broadening. Definition length does not prove
compatibility or validity, and a `LIMIT` does not bound catalog work.

#### 8. Stop criteria

Stop on unknown or invalid object state, dynamic binding/search path,
unexpected owner/extension, unsafe excerpt, lock/timeout/cap, or any read-only
failure.

#### 9. Result documentation

Store the typed catalog result, target/revision, excerpt policy, byte/row
measurements, digest, and reviewer interpretation separately. Keep absent,
invalid, and unknown objects as blockers.

### P-04 — Constraint/index health

#### 1. Purpose

Inspect the health of 19 exact approved indexes and their validated parent
relations. This diagnostic is index-only and does not treat constraints as
index evidence.

#### 2. Prerequisites

P-03 must establish qualified parent/index identity. The exact 19-record
manifest, index-only scope, allow-lists, monitor thresholds, and Stage-2
approval must be current.

#### 3. Approvals

Four role sign-offs plus system-owner and data-owner approval of the index-only
observation are required. Business/policy approval is still required for any
later decision based on the observation.

#### 4. Exact order

Validate the parent relation and index binding, then inspect only the approved
index metadata. Capture validity/readiness/uniqueness, enforce caps, verify no
mutation occurred, and close the transaction.

#### 5. Related diagnostics

D-04, 19 exact records, one chunk. Parameters are
`capture_id`, `approved_schema_names`, `approved_relation_names`, `chunk_id`,
and `target_bindings`.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, `record_id`, and `object_found`; nullable
`relname` name, `index_name` name, `indisvalid` boolean, `indisready` boolean,
and `indisunique` boolean. Constraint status is not substituted for these
fields.

#### 7. Safety boundaries

No index creation, repair, validation, lock release, or cleanup. A valid index
does not establish data invariants or successful historical rollout.

#### 8. Stop criteria

Stop on missing/unknown parent, unexpected index, invalid binding, unknown
validity/readiness, lock wait, timeout, cap, or attempted dynamic broadening.

#### 9. Result documentation

Record the exact index observation, parent binding, freshness, digest, monitor
measurements, and unresolved business implications. Do not convert a valid
catalog flag into a resolved migration record.

### P-05 — Invariant/backfill assessment

#### 1. Purpose

Obtain a strictly bounded, approved observation for the target
`public.shipping_rules` and assess whether it can inform the invariant/
backfill review. It is not itself proof of the PE-05 composite.

#### 2. Prerequisites

P-01 through P-04 applicable gates, exact target binding, current manifest
hash, business/data policy approval, owner-approved monitor thresholds, and a
new P-05 attempt ID are required. The target must be proven fresh; no
development-to-production assumption is permitted.

#### 3. Approvals

PREFLIGHT requires all four role sign-offs and a manual phase approval.
SCAN requires a separate manual sign-off after reviewing the one successful
PREFLIGHT result. The same person may not silently advance both phases.

#### 4. Exact order

Capture PREFLIGHT first. The one-row cap is not a row guarantee; require
exactly one result only when promoting PREFLIGHT through G-05, for the same
SQL-row `capture_id`, `chunk_id`, `record_id`, target, and environment, with
`target_exists=true` and a verified current hash. A human reviews and signs
the result. Only then may the executor prepare the fixed SCAN; it must not
execute until separately released. Capture SCAN as its own phase evidence,
then invalidate the attempt if continuity changed.

#### 5. Related diagnostics

D-05 has exactly one record and at most one output row per phase, with
PREFLIGHT and SCAN represented as separate phase evidence objects. Parameters are
`capture_id`, `chunk_id`, and `target_bindings`. The fixed scan target is
`public.shipping_rules`; the reviewed design allows an inner sample of at
most two rows and an outer aggregate result capped at one row. It must not
emit row values.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, `record_id`, and `phase`; nullable
`target_exists` boolean and nullable `observed_rows_capped_at_two` bigint.
Each phase's result is independently typed and hashed.

#### 7. Safety boundaries

D-05 is limited to one returned row and 2 MiB per phase, but this does not
bound scan cost. The target, namespace, and relation are fixed; no dynamic
identifier or broader relation is allowed. Data excerpts/values are never
captured. Any false, zero, duplicate, null, mismatched, stale, or ambiguous
PREFLIGHT is `BLOCKED_PRECONDITION`, and SCAN is never prepared.

#### 8. Stop criteria

Stop on every precondition failure, any continuity change, timeout, lock wait,
read-only failure, cap, stale hash, target mismatch, unexpected relation, or
attempted automatic phase transition. A failed SCAN does not authorize retry.

#### 9. Result documentation

Document phase, attempt parent ID, unique phase evidence ID, exact target/
environment binding, hash validation, approvals, monitor readings, and
blocker. A bounded count is only an observation; PE-05 remains blocked unless
all independent policy, invariant, concurrency, and recovery evidence exists.

### P-06 — Business policy authorization

#### 1. Purpose

Record explicit business/data-policy authorization for payment snapshots,
learner mapping, expiry timing, referral fallback, singleton survivor
selection, compensation, and concurrency assumptions.

#### 2. Prerequisites

The exact affected record set, occurrence/object-group expansion, static
dependency review, safe minimization plan, and a named policy owner must be
available. No database result substitutes for an authorization.

#### 3. Approvals

Business/policy owner signs the policy; data owner and system owner confirm
scope; an independent reviewer verifies conflicts and completeness. Stage-0
P-06 scope review is mandatory.

#### 4. Exact order

Review exact record IDs and dependencies, review the proposed policy and
compensation boundary, record explicit approvals or exceptions, and route
unknowns to a blocker. Do not request a database connection for D-06.

#### 5. Related diagnostics

D-06, zero applicable database records, zero chunks, and zero output columns.
The PE-06 evidence requirement and procedure package remain the source of its
record-specific authorization fields.

#### 6. Expected evidence format

Typed approval/exception evidence only: approved scope, policy version,
decision, owner role, expiry, nonidentifying approval reference, and
independent-review result. There is no D-06 SQL output.

#### 7. Safety boundaries

No customer rows, payment references, learner identities, payloads, audit
contents, secrets, URLs, or tokens. Authorization cannot authorize mutation,
repair, migration, or an unreviewed diagnostic.

#### 8. Stop criteria

Stop on missing owner, conflict, expired approval, unknown policy, unknown
compensation/concurrency boundary, unsafe data request, or scope mismatch.

#### 9. Result documentation

Store the signed decision, exact scope, expiry/re-review trigger, exceptions,
and unresolved questions. Label it governance evidence and keep authoritative
records `UNRESOLVED`.

### P-07 — Runtime lock/recovery

#### 1. Purpose

Obtain bounded runtime and recovery observations and the separate operational
attestation needed to assess lock/session, transaction, GUC cleanup,
autocommit/concurrent-index, partial-failure, retry, and worker overlap.

#### 2. Prerequisites

P-01 target/release attestation, Stage-0 P-07 operations scope approval,
exact 1,545 IDs in 16 chunks, runtime monitor freshness, and external
instance/worker/deployment attestation are required.

#### 3. Approvals

Four role sign-offs plus system-owner operations approval and independent
review of the attestation are required. A database session listing is not a
replacement for an operator's attestation.

#### 4. Exact order

Review the external attestation first, then collect only the bounded
read-only runtime sample under one connection. Record aggregate output,
truncation, monitor measurements, and cleanup verification. Do not stop or
restart workers, instances, or transactions.

#### 5. Related diagnostics

D-07, 1,545 exact records, 16 chunks. Its output is an aggregate runtime
sample capped at 201 sessions, not a list of sessions. Parameters are
`capture_id`, `record_ids`, and `chunk_id`.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, and `record_id`; non-null
`observed_sessions_capped_at_201` bigint and `sample_truncated` boolean.
External attestation is a separately typed, owner-bounded record.

#### 7. Safety boundaries

Never infer external instances, workers, deployment overlap, or recovery from
`pg_stat_activity` or another database view. The attestation has a separate
owner-bounded byte limit; it is not the SQL zero-byte cap used by D-06/D-10.
No payloads or PII.

#### 8. Stop criteria

Stop on unknown worker/writer overlap, stale attestation, lock wait, timeout,
read-only failure, cap, unapproved instance, missing monitor, or any request
to perform recovery or cleanup.

#### 9. Result documentation

Join runtime observation and external attestation by non-secret evidence IDs.
Record freshness, monitor readings, truncation, exceptions, and the remaining
recovery unknowns. No runtime observation resolves a startup record.

### P-08 — Privilege/release compatibility

#### 1. Purpose

Verify exact catalog function/object existence, approved schema and function
bindings, least-privilege classification, and dependent release/extension
compatibility for three records.

#### 2. Prerequisites

P-01 release attestation, exact schema/function allow-lists, target bindings,
role grant review, fixed 3-record chunk, owner-approved threshold monitor, and
Stage-3 release are required.

#### 3. Approvals

Four role sign-offs plus system-owner approval of access scope, data-owner
approval of excerpts, and independent reviewer assignment are required.

#### 4. Exact order

Verify role and read-only mode, inspect only approved schema/function names
with exact bindings, capture bounded argument excerpts, compare dependent
release/extension versions, and close the transaction. No role escalation is
allowed to make this diagnostic pass.

#### 5. Related diagnostics

D-08, three records, one chunk. Parameters:
`capture_id`, `approved_schema_names`, `approved_function_names`, `chunk_id`,
and `target_bindings`.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, `record_id`, and `object_found` boolean;
nullable `nspname` name, `proname` name, and `argument_excerpt` text. These
are the exact D-08 output fields.

#### 7. Safety boundaries

No privilege grant, role switch, discretionary/application function
invocation, deployment, or dynamic search path. Some source designs use exact
allow-listed catalog built-ins; their execution privileges require a separate
security review. If that review cannot be satisfied without escalation, stop
instead of granting privileges or using a superuser. The bounded argument
excerpt is safe minimization, not a redaction step. Compatibility remains an
inference requiring review.

#### 8. Stop criteria

Stop on missing privilege, attempted escalation, unknown function binding,
unexpected namespace, stale release, unsafe excerpt, lock/timeout, the
500-row/2 MiB D-08 cap, or read-only failure.

#### 9. Result documentation

Store typed output, role classification, release/extension observations,
manifest/hash, monitor values, and independent interpretation. Keep any
compatibility unknown as a blocker.

### P-09 — Restore/observability

#### 1. Purpose

Establish operational evidence for a successfully rehearsed restore,
observability, incident ownership, retention, recovery objectives, and
dependent-release readiness.

#### 2. Prerequisites

Stage-0 P-09 operations scope approval, exact 118 records in two chunks,
fresh target/release identity, successful restore rehearsal evidence, and an
owner-bounded external attestation are required. “Backup enabled” alone never
satisfies this prerequisite.

#### 3. Approvals

Four role sign-offs plus system-owner operations approval, data-owner
retention approval, business/policy recovery approval, and independent review
are required. The optional D-09 SQL supporting leg needs separate explicit
authorization; P-09 itself is governance/operations.

#### 4. Exact order

Review restore rehearsal result and recovery objectives, verify observability
and incident ownership, verify dependent release/extension/privilege
compatibility, then—only if separately authorized—collect D-09 bounded
supporting observations. Bind all 118 records to two sorted chunks.

#### 5. Related diagnostics

D-09, 118 exact records, two chunks. Parameters are
`capture_id`, `record_ids`, and `chunk_id`; D-09 SQL is a supporting
observation, not a restore proof.

#### 6. Expected evidence format

Non-null `capture_id`, `chunk_id`, `record_id`, `result_kind` text,
`result_value` text, `bounded` boolean, and `truncation_applied` boolean.
This is the exact D-09 output schema. The restore rehearsal is separately
typed with target, restore point, rehearsal time, measured result, and owner
attestation.

#### 7. Safety boundaries

Do not restore production, alter topology, stop workers, or invoke failover.
Do not expose backup URLs, credentials, tokens, or payloads. A database
observation cannot attest to an external backup/restore operation.

#### 8. Stop criteria

Stop on missing or failed restore rehearsal, stale observability, unknown
incident owner/objective, unknown external instance, release overlap, timeout,
cap, or missing independent review.

#### 9. Result documentation

Record rehearsal evidence, owner-bounded attestation, optional D-09 output,
freshness, retention, monitor values, and blockers as separate evidence
objects. A successful backup job without a successful restore rehearsal is
documented as insufficient.

### P-10 — Independent disposition

#### 1. Purpose

Provide an independent, record-specific disposition over exact scope,
dependencies, evidence digests, blockers, exceptions, and re-review triggers.

#### 2. Prerequisites

All applicable stage evidence, exact inventory joins, four-role approvals,
conflict-of-interest declaration, evidence digests, freshness review, privacy
review, and full unknown/blocker list are required.

#### 3. Approvals

The reviewer must be independent of preparer and collector. System, data, and
business/policy owners approve the scope; the independent reviewer signs the
disposition. Stage-0 P-10 scope review and Stage-6 final manual review are
both required.

#### 4. Exact order

Reconcile scope and digests, inspect observed facts separately from inference,
check dependencies and blockers, record disposition and re-review trigger,
and sign. Do not alter a source status or infer a missing production fact.

#### 5. Related diagnostics

D-10 has zero applicable database records, zero chunks, and zero output
columns. PE-10 is a governance review requirement, not a SQL diagnostic.

#### 6. Expected evidence format

Typed disposition, exceptions, rationale, exact reviewed record set,
reviewer independence, approval references, remediation owner/deadline, and
re-review trigger. No D-10 SQL output exists.

#### 7. Safety boundaries

No URLs, tokens, secrets, PII, raw sensitive evidence, or executable content.
No disposition may change authoritative status, authorize deployment, or
authorize mutation.

#### 8. Stop criteria

Stop on scope/release mismatch, missing approval, privacy breach, unknown
invariant/recovery/policy fact, digest failure, stale evidence, or conflict of
interest.

#### 9. Result documentation

Store the signed disposition and all exceptions with nonidentifying approval
references. The only allowed future evidence states are `OBSERVED`, `PARTIAL`,
`BLOCKED`, and `UNKNOWN`; none changes authoritative `UNRESOLVED`.

## Completion rule

The package is usable for review only when every required gate and manual
transition is evidenced. “PARTIAL_OBSERVATION_WITH_BLOCKERS” is the expected
shape for runnable diagnostics with blocked records. D-06 and D-10 are
`BLOCKED_NON_DATABASE_ATTESTATION` as database diagnostics, and all PE
composites remain blocked until their non-database requirements are separately
proven.