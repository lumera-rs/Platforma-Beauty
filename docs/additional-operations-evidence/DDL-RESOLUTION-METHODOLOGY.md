# DDL resolution methodology

## Purpose and decision boundary

This document defines how the 1,435 unique historical DDL mappings in the
startup crosswalk may be reviewed. It is a review method, not an authorization
to execute, adopt, replay, retire, or move any startup operation. The current
crosswalk state is **UNRESOLVED for all 1,435 mappings**. This document does not
change that state.

The immutable comparison point is migration `000001`, from
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`. The
crosswalk's source inventory, executable source locations, canonical candidate
evidence, dependencies, preconditions, postconditions, and rollback
considerations are inputs to review; a matching name, SQL text, checksum,
`IF [NOT] EXISTS`, or a passing test is not by itself a resolution.

## Resolution states and exact evidence gates

Every mapping must be assigned exactly one status only after all gates for that
status pass. Evidence must be recorded per fingerprint and occurrence, with
source and canonical line references, reviewer identity, review date, and
independent-review disposition.

### `CANONICAL_BASELINE`

Assign this status only when all of the following are evidenced:

1. The exact executable source statement is identified, including interpolated
   identifiers, statement order, execution branch, owner, and every occurrence.
2. The canonical migration contains the corresponding object definition or
   transition, and a reviewer compares normalized and raw SQL where relevant.
3. Semantics are equivalent, not merely names or object kinds: column types and
   defaults, constraints, indexes and predicates, trigger bindings, function
   bodies and volatility/security/search-path behavior, enum labels and order,
   extensions, privileges, and dependency order all agree.
4. The transition is equivalent for a fresh database **and** the reviewed
   existing-database state. Additive creation is not equivalent to a destructive
   alter, rewrite, backfill, replacement, rename, validation, or lock-sensitive
   transition merely because the final catalog can look alike.
5. The canonical migration's transaction mode, preconditions, postconditions,
   failure behavior, and ordering provide the same or stronger safety. Any
   autocommit, concurrent-index, session-GUC, advisory-lock, or partial-failure
   difference is explicitly resolved.
6. Production-state evidence proves the operation is already represented at the
   intended scope, including data invariants and dependent application behavior;
   a fresh canonical database or catalog fingerprint alone is insufficient.
7. An independent reviewer, who did not prepare the mapping, confirms all
   preceding evidence and records no open dependency, authorization, rollback,
   or transition-semantic question.

Without every gate, the mapping is not `CANONICAL_BASELINE`.

### `FUTURE_MIGRATION_REQUIRED`

Assign this status only when all of the following are evidenced:

1. The operation is not part of `000001`, or exact semantic equivalence to
   `000001` cannot be established, and the unresolved delta is specified
   statement-by-statement.
2. A proposed future migration has a unique next manifest ID and descriptive
   directory, immutable SQL plan, declared transactional or nontransactional
   mode, checksum, dependencies, preconditions, postconditions, recovery
   procedure, and explicit production-data effect.
3. The plan proves fresh-database behavior and existing-production transition
   behavior separately, including locks, concurrent writers, retries, partial
   completion, and application compatibility.
4. Read-only production evidence identifies the actual object/data state and
   proves the plan's preconditions. No migration is applied to discover state.
5. Destructive changes, data mutations, function/trigger replacements, marker
   changes, and cleanup/report reads have an approved owner, business
   decision, backup/restore or compensating strategy, and rollback boundary.
6. Dependency and manifest ordering are complete, including cross-owner and
   canonical dependencies; nontransactional recovery is safe after each
   independently committed statement.
7. Independent review approves the migration plan and evidence before any
   migration file is created or run.

`FUTURE_MIGRATION_REQUIRED` means a future migration is required; it does not
authorize creating or applying one in this documentation task.

### `RETIRED_HISTORICAL`

Assign this status only when all of the following are evidenced:

1. The operation is proven historical and no longer reachable on any supported
   startup path, branch, marker path, deployment revision, or recovery path.
2. A replacement or canonical equivalent is identified, with semantic and
   transition equivalence reviewed for both fresh and existing databases.
3. Production evidence proves the replacement is deployed and its required
   schema, data, functions, triggers, markers, and dependencies are present;
   absence from the current source is not proof of retirement.
4. No pending data backfill, cleanup, report, lock/session lifecycle, or
   compatibility obligation remains. Any committed historical mutation has a
   preserved audit trail and approved compensation/restore decision.
5. The removal has an explicit owner, release boundary, observability and
   rollback plan, and does not rely on replaying an unsafe historical action.
6. An independent reviewer confirms reachability, production state, dependent
   releases, and retirement safety.

Otherwise the operation remains `UNRESOLVED`, even if it appears obsolete.

## Forcing conditions: remain `UNRESOLVED`

Any one of these conditions forces `UNRESOLVED` and blocks all three statuses:

- only a candidate object name, object kind, text match, generated SQL match, or
  hash match is available;
- canonical presence proves final shape but not a startup backfill, delete,
  report read, marker write, function replacement, trigger binding, lock, or
  session lifecycle;
- fresh-DB equivalence is shown but existing production rows, duplicates,
  nulls, divergent snapshots, permissions, or concurrent writers are unknown;
- source interpolation, dynamic identifiers, branch reachability, execution
  order, duplicate occurrence, or owner call path is not resolved;
- a function, trigger, policy, enum transition, constraint validation, rename,
  drop, index-concurrently operation, or data mutation lacks semantic and
  transition evidence;
- production target identity, release/revision overlap, ledger state, backup
  restore test, or current catalog/data state is unknown;
- dependencies, cross-owner ordering, advisory-lock scope, transaction mode,
  timeout/search-path/GUC restoration, or nontransactional recovery is unknown;
- the operation's rollback is described only as retry, `IF EXISTS`, or
  `IF NOT EXISTS`, or cleanup errors are suppressed;
- evidence relies on typecheck, tests, census parity, source text, or names as
  proof of production safety, idempotence, business correctness, or completed
  execution;
- reviewers have a conflict of interest, evidence is stale or non-reproducible,
  or independent review is absent.

## Evidence dimensions

### Source and canonical evidence

Review the immutable inventory against the exact executable literal and its
source position. Preserve complete SQL, interpolation context, call-site and
branch path, source checksum, and execution ordinal. Compare against the pinned
canonical migration checksum and exact line slices, then inspect semantics
rather than treating candidate-name matches as equivalence. The canonical
baseline is a fresh-schema definition; it is not a record of what historic
startup code did in production.

### Fresh database versus existing production

Record two separate verdicts. For a fresh database, establish object creation,
definition, ordering, and migration-runner transaction behavior. For an
existing database, inspect actual catalog, rows, constraints, indexes,
functions, triggers, privileges, markers, and dependent application versions.
Prove duplicate/null/data-shape invariants before any mutation. A final
fingerprint can establish shape only within its ownership and version
contract; it cannot establish historical events or data correctness.

### Transition semantics and production state

Document locks, isolation, autocommit versus transaction boundaries, concurrent
index behavior, retries, timeout and search-path restoration, partial failure,
and application compatibility. Read-only production inspection must identify
the intended database and release, ledger/migration state, current schema and
data facts, and a verified restore point. No production connection or mutation
is implied by this methodology.

### Dependencies and order

Dependencies include schema and parent table existence, columns and types,
functions before triggers, extensions before dependent objects, data
preparation before constraints, and cross-owner shared locks or markers.
Compare source execution order with migration manifest order. A dependency list
that omits data or operational prerequisites is incomplete.

### Independent review

The preparer supplies evidence, open questions, and a proposed status. A
separate reviewer re-runs the source/canonical comparison, challenges fresh
versus existing claims, checks production evidence and order, and records
approval or a precise blocker. Review approval is evidence of review, not
permission to deploy or mutate production.

## Prioritized review sequence for all 1,435 mappings

This is a risk-prioritized review queue, not a resolution. Every item starts
and remains `UNRESOLVED` until its applicable gates pass.

1. **Data-changing and destructive transitions:** drops, alters, validations,
   duplicate cleanup, deletes, backfills, enum transitions, and operations
   affecting payment, voucher, enrollment, learner, or reference data. Establish
   invariants, compensation, concurrency, and restore boundaries first.
2. **Functions, triggers, policies, and privileges:** exact body, binding,
   owner, security mode, search path, volatility, dependent columns, and
   invoker authority. Same names and successful creation do not suffice.
3. **Constraints and indexes:** unique/exclusion/check/foreign-key semantics,
   existing violations, lock duration, predicate/column order, and
   `CREATE INDEX CONCURRENTLY` statement-by-statement recovery.
4. **Types, extensions, and schema/table definitions:** enum ordering and
   transition semantics, extension/version availability, defaults, generated
   expressions, ownership, and dependency order.
5. **Operational scaffolding and rollout controls:** advisory locks, session
   settings, markers, timeout/error cleanup, report reads, and startup
   reachability. These can change behavior without changing the final catalog.
6. **Remaining additive or apparently idempotent DDL:** verify actual
   definitions, privileges, dependencies, existing data, and release
   compatibility; syntax alone never closes the review.

Within each tier, review shared-lock and shared-table dependencies before
dependent owners, then source execution order, then canonical/migration
manifest order. Record every mapping and occurrence, including repeated
fingerprints; do not collapse a high-risk occurrence into a low-risk summary.

## Current conclusion

The supplied census, crosswalk parity, canonical checksum, source checksums,
type definitions, and runner documentation establish an auditable starting
inventory. They do not satisfy the evidence gates above. Consequently all
1,435 DDL mappings remain **UNRESOLVED**, and no mapping is claimed to be
canonical, future-migration-ready, or retired. No claim of equivalence,
idempotence, production safety, execution completion, or test sufficiency is
made.