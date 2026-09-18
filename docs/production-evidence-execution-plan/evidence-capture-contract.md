# Evidence capture contract

## Contract status

This is the schema for a future restricted evidence store. It is not an
execution authorization and contains no executable SQL. Captures must be
created only by the approved diagnostic design and this runbook. Evidence
states in this contract do not alter the authoritative package: every
authoritative record starts and remains `UNRESOLVED`, and all unobserved
production facts remain `UNKNOWN`.

## Evidence envelope

The **future machine envelope uses camelCase exactly as shown below**. This
naming convention is deliberately separate from the approved SQL output rows:
SQL output columns retain the catalog's exact snake_case names (`capture_id`,
`record_id`, and so on) and are not renamed in storage or documentation.
`captureId` is the value copied into an SQL row's `capture_id`; the two names
are not two identifiers.

Every evidence object has these typed envelope fields:

| Field | Type and rule |
|---|---|
| `captureId` | opaque non-secret text, required, max 128 characters; unique for the attempt and shared by P-05 phases in that attempt/chunk |
| `diagnosticId` | one of D-01 through D-10 |
| `procedureId` | matching P-01 through P-10 |
| `authoritativeRecordIds` | exact stable IDs from the manifest, never array-position substitutes |
| `capturedAt` | timestamp with timezone from the approved collector |
| `environmentId` | non-secret controlled target/environment/revision identity; never a connection string, URL, or secret |
| `parameters` | typed bounded manifest values, excluding secrets and payloads |
| `parameterBounds` | explicit time, row, byte, chunk, identifier, and monitor bounds |
| `evidenceStatus` | only `OBSERVED`, `PARTIAL`, `BLOCKED`, or `UNKNOWN` |
| `validationStatus` | `VALID`, `INVALID`, or `NOT_VALIDATED`; invalid cannot be used |
| `evidenceId` | opaque unique identifier for this evidence object and phase |
| `parentAttemptId` | stable opaque attempt identifier for related P-05 phases; null outside a phased attempt |
| `chunkId` | deterministic manifest chunk identifier; null only for non-chunked governance evidence |
| `phase` | `PREFLIGHT` or `SCAN` for P-05; null when not phased |
| `approval` | four-role nonidentifying approval references, scope, and expiry |
| `result` | typed diagnostic output or typed governance/attestation result |
| `evidenceHash` | canonical hash of the envelope with this field excluded |
| `hashAlgorithm` | exact algorithm identifier and canonicalization version |
| `provenance` | input-manifest digests and collector version, no secrets |
| `freshness` | capture age, expiry, invalidating events, and monitor freshness |
| `retention` | approved retention/access policy reference |
| `blockerOrAbortReason` | structured blocker or abort trigger/time; null only for a complete non-aborted object |
| `observedFact` | typed fact boundary, distinct from interpretation |
| `inferenceBoundary` | explicit permitted inference and prohibited inference |
| `decisionBoundary` | explicit decision scope; never an authoritative status transition |
| `scopeDigest` | digest of the exact record/chunk/target scope |
| `independentReview` | nonidentifying independent-review reference, result, and freshness |

`result` is null for an uncollected result. Otherwise it is either
`{ kind: "SQL", rows: [...] }`, whose rows match the diagnostic's exact column
schema and per-statement caps, or
`{ kind: "ATTESTATION", attestationRef: "...", summary: "..." }` for a minimized,
owner-reviewed external attestation. The ellipses describe the future structure,
not example results. No actual evidence object is included here. Attestations
use a separately approved byte budget, not an SQL row/byte cap of zero.

`blockerOrAbortReason` is null only where no blocker or abort exists; otherwise
it contains `code`, `explanation`, and `occurredAt`. The `hashAlgorithm` literal
is `SHA-256`; the canonicalization procedure below is fixed by this contract
and its input digest, not an operator-selectable algorithm.

`captureId` is unique per attempt, not per P-05 phase. For one P-05
attempt/chunk, PREFLIGHT and SCAN carry the same `captureId` and stable
`parentAttemptId`, while each phase has a different unique `evidenceId`.
`phase` and `chunkId` make that relationship explicit. A new attempt, retry,
continuity event, or invalidated target requires a new `captureId` and
`parentAttemptId`; a phase may never silently reuse the old object.

`approval` is not a person-directory dump. References must be nonidentifying
outside the controlled approval system. A result is accepted only if its
target/environment, record set, chunk, phase, and input hashes match the
envelope. The envelope is the canonical future interface; the SQL row
schemas below remain unchanged reference schemas.

## Diagnostic output schemas

The following are exact field contracts from the diagnostic catalog. Field
order in storage is canonicalized for hashing, but names, types, and nullability
must not be changed.

### D-01 / P-01

| Field | PostgreSQL type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `database_name` | name | non-null |
| `server_version_num` | text | non-null |
| `transaction_read_only` | text | non-null |

Parameters: `capture_id`, `record_ids` text array, `chunk_id`.

### D-02 / P-02

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `object_found` | boolean | non-null |
| `marker_relation` | name | nullable |
| `estimated_rows` | bigint | nullable |

Parameters: `capture_id`, `approved_schema_names` text array,
`approved_relation_names` text array, `chunk_id`, `target_bindings` jsonb.

### D-03 / P-03

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `object_found` | boolean | non-null |
| `nspname` | name | nullable |
| `relname` | name | nullable |
| `relkind` | char | nullable |
| `owner_name` | name | nullable |
| `definition_excerpt` | text | nullable |
| `definition_length` | integer | nullable |

Parameters: `capture_id`, `approved_schema_names` text array,
`approved_relation_names` text array, `chunk_id`, `target_bindings` jsonb.

### D-04 / P-04

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `object_found` | boolean | non-null |
| `relname` | name | nullable |
| `index_name` | name | nullable |
| `indisvalid` | boolean | nullable |
| `indisready` | boolean | nullable |
| `indisunique` | boolean | nullable |

Parameters: `capture_id`, `approved_schema_names` text array,
`approved_relation_names` text array, `chunk_id`, `target_bindings` jsonb.

### D-05 / P-05

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `phase` | text | non-null |
| `target_exists` | boolean | nullable |
| `observed_rows_capped_at_two` | bigint | nullable |

Parameters: `capture_id`, `chunk_id`, `target_bindings`. There is one exact
record and at most one returned aggregate row per phase. A successful P-05
PREFLIGHT may be promoted only when exactly one successful row matches the
same attempt/chunk/record/target/environment and hash; the one-row limit is
otherwise only a bound, not a guarantee of a row. PREFLIGHT and SCAN must have
different envelope `evidenceId` values, a stable shared `parentAttemptId`, and
separate manual approvals. The fixed relation is `public.shipping_rules`; no
row values are part of the result.

### D-06 / P-06

There are no parameters, output columns, applicable database records, chunks,
or database bytes. P-06 is typed governance authorization only. Its separate
attestation byte limit is owner-bounded and does not loosen any SQL limit.

### D-07 / P-07

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `observed_sessions_capped_at_201` | bigint | non-null |
| `sample_truncated` | boolean | non-null |

Parameters: `capture_id`, `record_ids` text array, `chunk_id`. The result is
an aggregate sample capped at 201, not a session payload or external
instance/worker attestation.

### D-08 / P-08

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `object_found` | boolean | non-null |
| `nspname` | name | nullable |
| `proname` | name | nullable |
| `argument_excerpt` | text | nullable |

Parameters: `capture_id`, `approved_schema_names` text array,
`approved_function_names` text array, `chunk_id`, `target_bindings`. D-08 is
capped at 500 returned rows and 2 MiB. The excerpt is bounded safe
minimization at capture time; it is not a raw value that may be redacted
later.

### D-09 / P-09

| Field | Type | Nullability |
|---|---|---|
| `capture_id` | text | non-null |
| `chunk_id` | text | non-null |
| `record_id` | text | non-null |
| `result_kind` | text | non-null |
| `result_value` | text | non-null |
| `bounded` | boolean | non-null |
| `truncation_applied` | boolean | non-null |

Parameters: `capture_id`, `record_ids` text array, `chunk_id`. D-09 is a
supporting observation; it cannot stand in for a successful restore rehearsal.

### D-10 / P-10

There are no parameters, output columns, applicable database records, chunks,
or database bytes. P-10 is an independent governance disposition.

## Result semantics

`PASS` in a diagnostic package means only that the stated fact was observed in
the exact stated scope and freshness window. `FAIL` and `UNKNOWN` never
resolve an authoritative record. A database observation, attestation,
inference, and decision are stored as distinct `result_kind` values.

Evidence-store statuses have only these meanings:

* **OBSERVED** — the bounded stated observation validated successfully.
* **PARTIAL** — some approved evidence was captured, with explicit missing
  scope and blockers.
* **BLOCKED** — a mandatory precondition, gate, privacy boundary, or safety
  control prevented capture.
* **UNKNOWN** — the fact was not established, including after an abort,
  stale result, failed validation, or unavailable external attestation.

These are not authoritative statuses and must never be rewritten as
`RESOLVED`, `PASS`, or completion in the source packages.

## Canonical hashing

The hash covers the complete camelCase evidence envelope **except
`evidenceHash` itself** and any transport wrapper. Use the exact algorithm
declared in `hashAlgorithm` (the approved package currently requires SHA-256):

1. Construct the typed envelope with `evidenceHash` omitted.
2. Recursively sort every object/map key by Unicode code point; preserve array
   order because arrays such as record IDs and chunks are deterministic.
3. Serialize as canonical JSON with no insignificant whitespace, no
   implementation-specific formatting, and UTF-8 encoding.
4. Hash those UTF-8 bytes with SHA-256 and encode the lowercase hexadecimal
   digest.
5. Store the digest and independently validate it before accepting the object.

Do not hash a pretty-printed copy, mutable timestamp wrapper, secret-bearing
transport envelope, or object that includes its own hash. Any hash or
provenance mismatch is a blocker. Canonical input digests are recorded
alongside, not silently replaced by a new source.

## Manifest and chunk binding

The immutable record-to-target manifest is the input. Chunks are sorted,
digest-verified, and no larger than 100 IDs. Every SQL output row binds
`capture_id`, `record_id`, and `chunk_id`; a row without all three is invalid.
The enclosing machine object binds the same values as `captureId`,
`authoritativeRecordIds`, and `chunkId`. No array index, owner/name
approximation, or discovered object may expand a chunk.

P-05 uses a stable shared `parentAttemptId` and unique phase `evidenceId` for
PREFLIGHT and SCAN. Both phases also carry the exact target/environment binding
and current manifest hash. A continuity event invalidates both.

## Storage, privacy, and review

Store typed results only in the reviewed restricted evidence store. Commit no
URLs, tokens, credentials, secrets, PII, raw payloads, or unreviewed approval
identities. Keep safe minimized excerpts only where the catalog explicitly
allows them. Retention, reviewer access, freshness, and deletion are recorded
as metadata.

A manifest of observed facts must not contain fixtures pretending to be
production observations. Static examples, test values, historical claims, and
source literals are labeled as such and cannot be submitted as `OBSERVED`.

All PE composite facts remain blocked until their complete non-database
requirements are met. D-01/02/03/04/07/08/09 are supporting observations only;
D-05 is a bounded observation only; D-06 and D-10 are non-database
attestations.