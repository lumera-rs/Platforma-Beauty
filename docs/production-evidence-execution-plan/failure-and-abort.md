# Failure and abort procedures

## Fail-closed rule

Any failure, unknown, stale result, cap breach, privacy concern, or
provenance mismatch stops the current capture. It does not repair production,
retry automatically, broaden scope, change a role, restart a worker, deploy,
advance a stage, or change an authoritative status. The affected evidence is
quarantined and the affected source records remain `UNRESOLVED`; the future
evidence state is `BLOCKED`, `PARTIAL`, or `UNKNOWN` as appropriate.

## Abort sequence

1. Stop issuing observations and prevent any subsequent statement or phase.
2. Cancel the current read-only observation if cancellation is available.
3. Close the transaction/session and verify cleanup; do not use cleanup as a
   reason to execute a repair.
4. Preserve the opaque capture ID, phase/evidence ID, target/environment alias,
   timestamp, input hashes, measured limits, and exact trigger.
5. Quarantine incomplete or suspect output; hash the quarantine record without
   including its own hash.
6. Notify the named incident/operations owner and independent reviewer.
7. Reconcile any continuity event and invalidate dependent evidence.
8. Record a manual re-entry decision. A retry, if approved, receives a new
   capture ID and fresh scope/threshold review.

Never claim that an absent error proves a successful operation. No failure
path authorizes production repair or migration.

## Failure classes

The following are the required eleven classes. Each has a trigger, action,
evidence to retain, and manual re-entry rule.

### 1. Database unavailable

**Trigger:** the approved target cannot be reached, target identity cannot be
verified, or the connection ends before the bounded result.

**Action:** do not fail over, switch to development, retry automatically, or
change topology. Abort and quarantine any empty/partial envelope.

**Evidence:** connection-attempt status without credentials, target/environment
alias, time, capture/evidence ID, approved timeout outcome, and incident
reference. Do not record a secret-bearing connection string.

**Re-entry:** operations owner confirms target reachability and fresh identity;
all four approvals and a new capture ID are required. Prior absence is
`UNKNOWN`, not PASS.

### 2. Insufficient privileges

**Trigger:** an allow-listed read is denied, role/grant differs from the
approved least-privilege manifest, or access would require escalation.

**Action:** stop; never grant a privilege, switch role, use an owner role, or
broaden the manifest.

**Evidence:** denied operation class, role classification, manifest digest,
target alias, and audit reference without secrets.

**Re-entry:** security/system owner supplies a separately reviewed least-
privilege role and approval. A new capture and fresh grant verification are
required; escalation is never a valid re-entry.

### 3. Timeout

**Trigger:** statement exceeds 15 seconds, lock acquisition exceeds 1 second,
idle-in-transaction exceeds 10 seconds, or an owner-approved monitor threshold
is exceeded.

**Action:** cancel the current observation, close the read-only session, and
quarantine incomplete output. Do not increase a timeout or continue from a
partial cursor.

**Evidence:** timeout kind, elapsed measurement, monitor freshness/threshold
reference, capture ID, phase, and cancellation outcome.

**Re-entry:** owner reviews scope, plan, and thresholds; a new capture ID and
new approval are mandatory. No same-ID retry.

### 4. Lock contention

**Trigger:** lock wait reaches one second, blocked sessions or lock graph is
unknown, or the monitor cannot establish the approved lock boundary.

**Action:** abort and do not cancel another owner's session, acquire a stronger
lock, pause writers, or retry automatically.

**Evidence:** bounded lock-wait result, timing, target alias, monitor
threshold, and incident reference; no payload or PII.

**Re-entry:** operations owner confirms a quiet, approved window and fresh
monitor. Independent review and a new capture ID are required.

### 5. Unexpectedly large result

**Trigger:** returned rows exceed 1,000, serialized bytes exceed 2 MiB,
P-05 exceeds one returned row, D-08 exceeds 500 returned rows, D-07 exceeds
its 201-session sample, or an attestation exceeds its owner-bounded cap.
D-06/D-10 must never return any database row or byte.

**Action:** stop before storing over-cap output; quarantine the bounded
prefix/metadata if safe. Do not increase the limit or rely on SQL `LIMIT` as a
scan-cost control.

**Evidence:** measured rows/bytes, cap type, truncation flag, phase, and
monitor reading. A truncated result is not silently labeled complete.

**Re-entry:** data owner and system owner approve a revised, explicitly
bounded scope; new manifest/digest, approvals, and capture ID are required.

### 6. Schema or identifier mismatch

**Trigger:** target relation/function/namespace is absent, unexpected, invalid,
has a changed definition, uses an unapproved search path, or does not match
the fixed quoted manifest binding.

**Action:** stop; never discover a similarly named object, broaden a catalog
search, mutate schema, or substitute a development definition.

**Evidence:** typed `object_found`/metadata result, expected manifest
binding, target/revision digest, and mismatch reason without unsafe excerpts.

**Re-entry:** schema/release owner performs a new static review and explicit
approval. Existing evidence remains blocked; a new target manifest and capture
are required.

### 7. State changed between checks

**Trigger:** DDL, write, ledger/marker/release change, role/extension change,
deployment, failover, or topology change occurs between target, PREFLIGHT,
SCAN, or dependent observations.

**Action:** invalidate all dependent evidence and both P-05 phases. Do not
continue because the change appears harmless or repeat an observation under
the old parent attempt.

**Evidence:** old/new non-secret digests, event time, invalidated evidence IDs,
owner notification, and continuity blocker.

**Re-entry:** repeat G0/G2 and the relevant manual approvals. P-05 requires a
new parent attempt ID, fresh PREFLIGHT, and a separate SCAN approval.

### 8. Connection interruption

**Trigger:** session reset, network interruption, collector crash, unknown
transaction cleanup, or inability to verify read-only/timeout state after
reconnect.

**Action:** abort the capture and quarantine output. Do not reconnect into the
same capture ID, assume rollback, or submit a partial result as observed.

**Evidence:** interruption time, phase, last validated envelope component,
cleanup verification outcome, and incident reference without network details.

**Re-entry:** operations owner verifies cleanup and target identity; fresh
approvals and a new capture ID are required.

### 9. Partially collected evidence

**Trigger:** only some chunks/records/fields/phases were captured, a monitor
stopped the run, a collector ended early, or the manifest cannot prove
completeness.

**Action:** mark the evidence `PARTIAL` or `UNKNOWN` with missing exact IDs;
never fill gaps with fixtures, source literals, owner/name approximation, or
historical claims.

**Evidence:** completed chunk IDs, missing IDs, per-object hashes, stop reason,
freshness, and completeness calculation.

**Re-entry:** reviewer decides whether the exact missing scope may be
separately approved. Any continuation uses a new capture ID and preserves the
original partial object; it cannot be relabeled complete.

### 10. Hash or provenance mismatch

**Trigger:** canonical hash validation fails, input manifest changes, evidence
contains its own hash, keys/encoding differ from the canonical algorithm, or
collector/source provenance is missing.

**Action:** reject and quarantine the object. Do not recompute over a changed
payload, overwrite the hash, or accept a stale digest.

**Evidence:** supplied digest, independently calculated digest, algorithm/
canonicalization version, input-manifest hashes, and validation error.

**Re-entry:** owner restores the exact reviewed input or conducts a new review.
New evidence ID/capture ID and fresh four-role approval are required.

### 11. P-05 PREFLIGHT failure

**Trigger:** PREFLIGHT is false, zero-row, duplicate, null, mismatched target/
environment/record/chunk, stale, hash-invalid, capped, or otherwise
ambiguous; or no successful same-attempt result exists.

**Action:** classify `BLOCKED_PRECONDITION` and do not prepare, authorize,
execute, or retry SCAN. Invalidate any tentative phase transition.

**Evidence:** the exact PREFLIGHT output/absence, count of results,
`target_exists`, target/environment binding, hash validation, manual approval
state, and blocker.

**Re-entry:** owner corrects the precondition outside production execution,
then obtains a new parent attempt ID, new PREFLIGHT capture ID/evidence ID,
fresh continuity and target checks, and a separate manual SCAN approval. No
same-ID or automatic transition is allowed.

## Evidence status after abort

An aborted capture may be:

* `BLOCKED` when a mandatory safety precondition prevented collection;
* `PARTIAL` when exact bounded output exists for a subset and missing scope is
  enumerated; or
* `UNKNOWN` when the fact cannot be trusted, including connection,
  provenance, continuity, or cleanup uncertainty.

`OBSERVED` is not allowed for a result whose read-only mode, target binding,
canonical hash, freshness, or completeness is unknown. None of these evidence
statuses changes the authoritative `UNRESOLVED` status.

## Re-entry checklist

Before any manually approved re-entry, verify the trigger is closed, incident
owner has signed, target/environment and release are fresh, affected
continuity events are reconciled, role and read-only mode are revalidated,
monitor thresholds and cancel path are current, privacy bounds are intact,
and the exact manifest/chunks are digest-verified. Obtain all required
role approvals again. Use a new capture ID; for P-05 use a new parent attempt
ID and separate phase evidence IDs. If any item is unknown, remain blocked.