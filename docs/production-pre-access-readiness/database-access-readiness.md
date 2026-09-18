# Database access readiness

## Documented future access contract

The approved safety package requires a dedicated, time-bounded,
least-privilege read-only identity. It must have no DDL/DML capability, owner
privilege, write fallback, privilege escalation, `SET ROLE` path, unapproved
function execution, or unapproved GUC changes.

Before each future statement, an approved operator must establish a read-only
transaction/session and verify the approved target and role. The fixed
diagnostic envelope is:

| Control | Required bound |
|---|---:|
| Connections | 1 |
| `statement_timeout` | 15,000 ms |
| `lock_timeout` | 1,000 ms |
| `idle_in_transaction_session_timeout` | 10,000 ms |
| Record IDs per chunk | 100 |
| Normal result rows per statement | 1,000 |
| Result bytes per SQL statement | 2 MiB |

Diagnostic-specific stricter caps still apply, including D-05 one-row phases,
D-08 500 rows, and zero SQL rows/bytes for no-SQL D-06 and D-10.

## Repository evidence

`lib/db/src/index.ts` documents bounded application pool, connection, query,
statement and idle timeout behavior and a shutdown path that closes scheduler
queues before the pool. These are application safeguards, not proof of the
future diagnostic role or live server settings.

## Readiness classification

| Requirement | Status | Reason |
|---|---|---|
| Dedicated diagnostic account exists | UNKNOWN | No independent production evidence |
| Read-only grants are minimal | UNKNOWN | Repository cannot prove live grants |
| DDL/DML prohibited | DOCUMENTED_ONLY | Required by contract, not observed |
| `SET ROLE` escalation prohibited | DOCUMENTED_ONLY | Required by contract, not observed |
| Connection cap and GUC limits active | DOCUMENTED_ONLY | Fixed envelope only |
| Safe cancel/rollback/session close | DOCUMENTED_ONLY | Procedure exists; production exercise absent |
| Audit attribution and retention | UNKNOWN | No approved production evidence |

Any failed or absent check is `BLOCKED`; it cannot be resolved by attempting a
connection. No session may be opened until the system owner, data owner,
business/policy owner and independent reviewer provide the applicable,
time-bounded approvals.

## Safe close requirement

On completion or abort: cancel work, close or roll back the read-only
transaction, reset approved session state, release the connection, quarantine
partial output, record the abort reason, and do not retry automatically.
Successful cleanup is future evidence, not a repository fact.