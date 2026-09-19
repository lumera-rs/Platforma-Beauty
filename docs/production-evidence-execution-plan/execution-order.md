# Evidence execution order

## Order is a manual review sequence

This is a dependency-aware future sequence, not permission to execute. Every
stage has a manual entry approval and a manual exit decision. There are no
automatic stage transitions, automatic retries, or automatic P-05 phase
transitions. If any condition is unknown, the stage is `BLOCKED`, and affected
authoritative records remain `UNRESOLVED`.

All future database work uses the common envelope: one least-privilege
connection, verified read-only transaction, 15-second statement timeout,
1-second lock timeout, 10-second idle-in-transaction timeout, 100-ID chunks,
and 1,000-row/2 MiB normal result limits (D-08 is capped at 500 rows). These
row and byte values are
maximum bounds, not a guarantee that a successful capture returns a row. D-05
has a one-row cap per phase; exactly one successful PREFLIGHT row is required
only when promoting PREFLIGHT through machine Gate G-05. D-06 and D-10 are
zero-row/zero-byte database procedures.

The inherited review labels G0–G9 in the safety document are not machine
states. The executor maps them to machine Gates G-01–G-10 as documented in
`pre-execution-safety-gates.md`. All pre-access requirements are proven before
the first SQL statement; a non-SQL PRECHECK may satisfy approved external
identity/operations/restore attestations. No procedure is made to wait for
P-05 success, and G-05 is the P-05 PREFLIGHT promotion/exit gate. P-10's
Stage-0 initial scope sign-off is separate from its Stage-6 final disposition.

## Stage 0 — identity, authorization, and initial scope review

**Manual entry:** system owner confirms the task identity, target alias and
environment, schema scope, revision/release window, collector, retention,
freshness, monitor/cancel path, and all required manifests. Data owner,
business/policy owner, and independent reviewer sign the same bounded scope.

Reconcile 1,435 mappings, 1,459 occurrences, 110 additional operations,
1,044 object groups, 1,545 identities, and eight startup owners. Verify all
stable-ID joins and the canonical migration hash. Review the static source
and dependency package, including DEP-001 through DEP-015. Keep every
authoritative record `UNRESOLVED`.

The initial scope review must explicitly include **P-06, P-07 operations,
P-09 operations, and P-10**. Confirm these governance/operations branches
before considering any database diagnostic. P-01/P-09 remain governance/ops
procedures even though D-01/D-09 may later have separately authorized SQL
supporting-observation legs.

**Exit:** a named reviewer records PASS only for the stated identity and scope.
Any count, join, authorization, target, freshness, privacy, or dependency
unknown blocks Stage 1.

## Stage 1 — metadata supporting observations

**Manual entry:** a fresh target/release attestation and explicit approval for
each SQL supporting leg. P-01 target/release governance and P-09
restore/observability governance are reviewed separately from D-01/D-09.

Collect, only if explicitly authorized:

* **D-01** target metadata for 1,545 exact records in 16 sorted chunks.
* **D-09** bounded restore/observability supporting metadata for 118 exact
  records in two sorted chunks.

D-01's expected fields are `capture_id`, `chunk_id`, `record_id`,
`database_name`, `server_version_num`, and `transaction_read_only`.
D-09's expected fields are `capture_id`, `chunk_id`, `record_id`,
`result_kind`, `result_value`, `bounded`, and `truncation_applied`.

Do not infer an external deployment, worker, instance, backup, or restore
fact from these observations. D-09 cannot replace the successful restore
rehearsal and owner attestation required by P-09.

**Exit:** independently validate capture hashes, freshness, read-only state,
target/release binding, and caps. A failed supporting leg blocks its dependent
review; it does not authorize a retry.

## Stage 2 — ledger and catalog shape

**Manual entry:** Stage-2 system/data/business approval and independent
review of the exact target bindings.

Run in this order:

1. **D-02/P-02:** three exact ledger/marker/branch records, one chunk.
2. **D-03/P-03:** 13 exact catalog definition records, one chunk.
3. **D-04/P-04:** 19 exact index-only records, one chunk.

Use fixed quoted identifiers and both required allow-lists. D-04 requires a
validated parent relation and index; constraint status is not index evidence.
Do not collect rows merely to establish schema shape.

**Exit:** capture outputs are typed, bounded, fresh, and digest-valid. Unknown
marker provenance, branch, object binding, object validity, search path,
constraint/index state, lock state, or release overlap blocks Stage 3.

## Stage 3 — function compatibility and runtime operations

**Manual entry:** Stage-3 release after Stage 2 and operations attestations
are reviewed.

Run the independent branches in this order:

1. **D-08/P-08:** three exact privilege/function compatibility records in one
   chunk, with exact approved schema/function names and bounded safe argument
   excerpts.
2. **D-07/P-07:** 1,545 exact runtime records in 16 chunks, with an aggregate
   session sample capped at 201 and a separate external instance/worker/
   deployment attestation.

The D-07 database result cannot attest to external workers or deployments.
The external attestation has its own owner-bounded byte cap, separate from
the D-06/D-10 SQL zero-byte cap. No worker is stopped, restarted, or
deployed.

**Exit:** independent reviewer confirms least privilege, no escalation,
release/extension compatibility, monitor freshness, worker/writer attestation,
lock/recovery unknowns, and evidence hashes. Otherwise Stage 4 is blocked.

## Stage 4 — D-05 PREFLIGHT only

**Manual entry:** separate Stage-4/PREFLIGHT approval. The attempt receives a
stable parent attempt ID and a unique PREFLIGHT evidence ID.

PREFLIGHT uses exactly one approved record and one chunk. It verifies the
fixed target `public.shipping_rules` with the exact target binding and current
manifest hash. Accept only one successful result from the same
`capture_id`, `chunk_id`, `record_id`, target, and environment, with
`target_exists=true`.

The expected D-05 result has non-null `capture_id`, `chunk_id`, `record_id`,
and `phase`, with nullable `target_exists` and
`observed_rows_capped_at_two`. The output is at most one row and contains no
row values. Exactly one successful row is required only for promotion through
G-05; a cap is not a row guarantee.

**Exit:** human review signs the exact result and verifies hash/freshness.
False, zero, duplicate, null, mismatch, stale, ambiguous, capped, or
otherwise unknown output is `BLOCKED_PRECONDITION`; SCAN is not prepared.

## Stage 5 — separately signed D-05 SCAN

**Manual entry:** a new manual sign-off after reviewing the successful
PREFLIGHT. The sign-off must identify the same stable parent attempt, current
target/environment, and a unique SCAN evidence ID. It cannot be inferred from
the PREFLIGHT result.

Prepare and, only after approval, collect the fixed D-05 SCAN. It returns at
most one aggregate row, with the inner sample bounded at two and no row
values. It remains subject to the 15/1/10-second envelope, one connection,
one-result-row cap, 2 MiB result cap, and owner-approved resource thresholds.

Any DDL, write, marker/release, role/extension, deploy, failover, or topology
change since PREFLIGHT invalidates both phases. Do not scan, retry, or repair
after invalidation. A successful bounded count is only supporting evidence and
does not prove PE-05.

**Exit:** manual reviewer records the result, hash, continuity check, and
remaining invariant/policy/concurrency/recovery blockers. No automatic
transition to Stage 6 occurs.

## Stage 6 — independent disposition

**Manual entry:** P-10 reviewer confirms all evidence IDs, digests, freshness,
exact scope, dependencies, privacy constraints, and the conflict-of-interest
declaration.

P-10/D-10 has no database records, rows, or bytes. The reviewer separates
observed facts, inference, decision, and exceptions; checks the four-role
approvals; records required remediation owner/deadline and re-review trigger;
and signs a disposition. D-06 and D-10 are governance evidence and cannot be
represented as database observations.

**Exit:** final package state is one of `OBSERVED`, `PARTIAL`, `BLOCKED`, or
`UNKNOWN` for the future evidence store only. It never changes authoritative
`UNRESOLVED`, authorizes a migration/deployment, or claims production
resolution. Missing restore rehearsal, business authorization, runtime
attestation, invariant proof, or independent review keeps all relevant PE
composites blocked.

## Dependency preservation

The stage order does not rewrite source order or promote owner order to a
semantic dependency. Preserve the documented lifecycle edges: full BG
payment literals before target checks; Education backfill/function before its
trigger; shared BG/Education lock lifecycle; web-push add/backfill/`NOT NULL`;
shipping cleanup before unique index; referral column before backfill; booking
table before scoped index; media type/users before image assets; and the
marketplace concurrent-index recovery boundary. Later postconditions remain
later observations.