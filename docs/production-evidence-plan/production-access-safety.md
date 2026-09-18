# Task #943 production access and safety

This document classifies prerequisites for a separately authorized future
evidence collection. It grants no access and contains no credentials,
connection strings, queries, or execution instruction.

## Preconditions before any collection

Obtain written, time-bounded approvals from the database/system owner and
operations owner for read-only diagnostics; add the data owner, privacy/
security owner, product/business owner, and change/recovery authority where
the evidence touches data policy, financial or learner information,
destructive cleanup, release compatibility, or restore claims. Name an
independent reviewer and record conflict-of-interest absence.

The authorization must specify target/environment, schema scope, exact
evidence selectors, allowed metadata, minimization, retention/deletion,
collector, observation window, load limits, emergency stop contact, and
whether any session/lock metadata is permitted. Read access does not grant
change, marker, ledger, backup, restore, deployment, or migration authority.

Before collection, verify a read-only role, least privilege, approved
network/session path, audit logging, redaction destination, evidence
integrity/digest process, and release/maintenance window. Credentials and
secrets must remain in the approved secret system and never enter the
evidence package.

Every proposed inspection must receive independent query-plan and query-text
review before execution, even when it is a `SELECT`. The approval must define
bounded `statement_timeout` and `lock_timeout` values, a maximum scanned-row or
byte budget, maximum result cardinality, concurrency ceiling, and a smaller
pilot scope before any wider scan. P-04, P-05, and P-07 require an operations
review of expected plans and lock behavior; an unreviewed sequential scan,
blocking lock, spill, replica-lag increase, or sensitive projection is a hard
stop.

Monitoring must start before the approved observation window and identify the
named operator who can abort it. The approval must state numeric abort
thresholds for elapsed time, CPU/I/O or scanned bytes, lock wait, blocked
sessions, replica lag, error rate, and unexpected row/result volume. Crossing
any threshold requires immediate cancellation and preserves the relevant fact
as `UNKNOWN`; retry or scope expansion requires a new review.

Before every collection group, inventory application revisions, startup
processes, background workers, schedulers, and other writers that can overlap
the observed owner lifecycle. Record retry and idempotency behavior, partial
execution boundaries, and the owner-specific transaction/advisory-lock
wrapper. Unknown overlap is a hard stop. Evidence collection must not restart
the application, restart a worker, deploy a revision, or invoke startup code.

## Classification matrix

| Class | Allowed content in a future package | Required approval | Default exclusion |
|---|---|---|---|
| A — identity/provenance | Target alias, environment, schema scope, revision, ledger/marker metadata, capture time, collector, digest | System/DB owner and release owner | URLs with secrets, tokens, connection strings, customer data |
| B — catalog definition | Qualified object definitions, owner/namespace class, validity, extension/version, normalized/raw definition digests | DB owner; security owner for privileges | Table rows, role membership detail, function secrets/config values |
| C — operational health | Bounded lock/workload/timeout/session/GUC classifications, transaction mode, partial-failure/recovery observations | Operations/SRE and DB owner | IPs, client identities, SQL parameters, credentials, unbounded logs |
| D — aggregate data invariant | Counts and redacted exception classes for null/duplicate/invalid/candidate/changed rows | Data owner plus privacy/security; business approver for financial/destructive policy | Raw payment references, learner/user identities, JSON/audit payloads |
| E — business decision/recovery | Approval references, survivor/expiry/fallback/immutability decision, restore attestation, compensation owner and boundary | Product/business, data controller where applicable, change/recovery authority | Copies of backups, customer records, unsupported rollback claims |
| F — independent disposition | Reviewer role, date, evidence digests, exact IDs, unresolved exceptions, expiry/re-review trigger | Independent reviewer and governance owner | Self-approval or a status change without all gates |

## Safety invariants and blockers

The following facts are currently **UNKNOWN** and must not be filled from
source, tests, canonical SQL, or a fresh database:

* production target identity, schema/search path, catalog definitions,
  privileges, extension versions, and actual object validity;
* deployed revision overlap, startup reachability, ledger/marker provenance,
  prior execution, partial completion, and branch selected;
* existing rows, nulls, duplicates, payment/reference snapshots, learner
  mappings, expiry candidates, referral audit linkage, and shipping survivors;
* transaction mode, advisory-lock namespace/contention, concurrent-index
  state, writer workload, timeout/GUC cleanup, and failure recovery;
* dependent application compatibility, business policy approval, data
  authorization, restore point, compensation, observability, and retention.

Any one of these is a blocker for the relevant claim. Specific hard stops
include: wrong or stale target; absent approval; raw-data exposure; inability
to prove least privilege; unresolved dynamic identifiers; missing direct
prerequisite; fast/full branch conflation; unknown data invariant; unverified
restore/compensation; stale evidence after deploy/write/failover; or no
independent review. A blocker leaves the identity `UNRESOLVED`; it does not
authorize a workaround.

## Recovery and freshness

Evidence must state its snapshot consistency method, capture interval,
target/revision, retention, and invalidation triggers. Recapture after DDL,
data writes, marker/ledger changes, role or extension changes, deployment,
failover, or topology change. A quiet-period lock observation cannot stand in
for a peak workload observation.

For destructive or partially committed transitions (including shipping
cleanup, drops, data backfills, Business Growth autocommit work, and
concurrent indexes), require a verified restore point or an explicitly
approved compensation boundary before any resolution decision. A retry,
`IF EXISTS`, cleanup suppression, or test/fake-client result is not recovery
evidence.

## Final safety boundary

Task #943 does not authorize credentials, production connections, catalog or
row reads, preflight calls against production, application or worker restart,
startup-DDL execution,
migrations, backfills, deletions, marker/ledger changes, deployment,
adoption, retirement, or status changes. The plan ends at independently
reviewed evidence and a documented disposition; any later action requires a
new, explicit authorization outside these documents.