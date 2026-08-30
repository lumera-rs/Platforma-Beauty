# Final Booking QA

Generated: 2026-08-30T10:43:33.856Z

**Production readiness: NOT READY** — Conservative gate blocked by 4 failure(s), 2 critical failed/not-tested scenario(s), and 3 unresolved blocker(s).

**TELEMETRY UNAVAILABLE:** Managed PostgreSQL activity-state telemetry was unavailable in the selected load evidence. Pool, lock, latency, throughput and HTTP result measurements remain present.

## Global totals

| PASS | FAIL | NOT TESTED | NOT APPLICABLE | Critical | High | Medium | Low |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 4 | 1 | 1 | 2 | 2 | 0 | 0 |

## Area totals

| Area | PASS | FAIL | NOT TESTED | NOT APPLICABLE |
| --- | ---: | ---: | ---: | ---: |
| 1. Concurrency and idempotency | 1 | 1 | 0 | 0 |
| 2. Calendar and timezone | 2 | 0 | 0 | 0 |
| 3. Permissions, multi-tenant, and API ID tampering | 2 | 0 | 0 | 0 |
| 4. Failure recovery and deterministic outcome | 1 | 1 | 0 | 0 |
| 5. Notifications retry and deduplication | 0 | 2 | 0 | 0 |
| 6. Data integrity, status, and history | 2 | 0 | 0 | 0 |
| 7. Input validation and responsive UX | 2 | 0 | 0 | 0 |
| 8. Admin search, filter, sort, and pagination | 1 | 0 | 0 | 1 |
| 9. Observability with TELEMETRY UNAVAILABLE | 1 | 0 | 1 | 0 |
| 10. Load and capacity (disposable staging) | 4 | 0 | 0 | 0 |

## Scenario matrix

| Area | Scenario | Critical | Result | Evidence |
| --- | --- | :---: | --- | --- |
| 1. Concurrency and idempotency | Concurrent requests cannot double-book one slot or leave a partial group | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:33.795Z. |
| 1. Concurrency and idempotency | Idempotency-Key replays the original successful booking outcome | yes | **FAIL** | Established code-review finding: Code review established that booking endpoints ignore Idempotency-Key; duplicate prevention relies on slot-conflict handling, producing 201 then 409 rather than idempotent replay. |
| 2. Calendar and timezone | Calendar availability enforces hours, services, employees and locations | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:17.805Z. |
| 2. Calendar and timezone | Timezone, DST and date-boundary booking behavior | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:19.847Z. |
| 3. Permissions, multi-tenant, and API ID tampering | Foreign appointment data and mutations are rejected | yes | **PASS** | Command exited 0 at 2026-08-30T10:39:28.648Z. |
| 3. Permissions, multi-tenant, and API ID tampering | Mixed valid salon/service/employee/customer IDs are re-derived and rejected | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:33.795Z. |
| 4. Failure recovery and deterministic outcome | Database failure rolls back grouped booking atomically | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:33.795Z. |
| 4. Failure recovery and deterministic outcome | Lost response/process restart can reconcile a booking command to its durable outcome | yes | **FAIL** | Established code-review finding: Code review established there is no durable command/outcome record or reconciliation endpoint for booking requests after a lost response or process restart. |
| 5. Notifications retry and deduplication | Rescheduled confirmations retry durably without duplicate sends | no | **FAIL** | Command exited 1 at 2026-08-30T10:40:41.788Z. |
| 5. Notifications retry and deduplication | Owner alerts are tenant-isolated and recover across API processes | no | **FAIL** | Command exited 1 at 2026-08-30T10:40:41.788Z. |
| 6. Data integrity, status, and history | Lifecycle races preserve one terminal status and status history | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:33.795Z. |
| 6. Data integrity, status, and history | Existing bookings retain historical price, duration and lifecycle after configuration changes | yes | **PASS** | Command exited 0 at 2026-08-30T10:43:33.795Z. |
| 7. Input validation and responsive UX | Booking API validates malformed/unauthorized input | yes | **PASS** | Command exited 0 at 2026-08-30T10:39:25.362Z. |
| 7. Input validation and responsive UX | Responsive customer booking and appointment-status UX | no | **PASS** | Command exited 0 at 2026-08-30T10:42:42.869Z. |
| 8. Admin search, filter, sort, and pagination | Administrative list search, filters, sort and pagination remain stable | no | **PASS** | Command exited 0 at 2026-08-30T10:41:17.808Z. |
| 8. Admin search, filter, sort, and pagination | Centralized admin booking-list filter, sort and pagination | no | **NOT APPLICABLE** | No centralized admin booking-list feature exists; booking lists are intentionally managed in the tenant-owned salon portal. |
| 9. Observability with TELEMETRY UNAVAILABLE | Slow requests, generic errors and fatal shutdown produce safe observability signals | no | **PASS** | Command exited 0 at 2026-08-30T10:41:20.054Z. |
| 9. Observability with TELEMETRY UNAVAILABLE | Managed PostgreSQL activity-state telemetry | no | **NOT TESTED** | TELEMETRY UNAVAILABLE: managed PostgreSQL activity-state tracking was disabled in the load evidence. |
| 10. Load and capacity (disposable staging) | 200-request same-slot collision objective | yes | **PASS** | same-slot: p95=2213.261782ms, p99=2253.571741ms, unexpectedErrors=0; customer and operational objectives passed. |
| 10. Load and capacity (disposable staging) | 1,000 simultaneous distinct booking objective | yes | **PASS** | 1000-distinct: p95=7956.720670999999ms, p99=8218.142856999999ms, unexpectedErrors=0; customer and operational objectives passed. |
| 10. Load and capacity (disposable staging) | 250 grouped-booking objective | yes | **PASS** | 250-groups: p95=3130.9580160000023ms, p99=3136.1639399999985ms, unexpectedErrors=0; customer and operational objectives passed. |
| 10. Load and capacity (disposable staging) | 1,000 mixed booking-operation objective | yes | **PASS** | mixed-1000: p95=6881.100279999999ms, p99=7066.476122ms, unexpectedErrors=0; customer and operational objectives passed. |

## Failures

### concurrency.idempotency-key-replay — CRITICAL

- Problem: Duplicate-safe 201+409 conflict handling is not an idempotent replay contract.
- Reproduction: `Send the same POST /api/appointments or POST /api/booking-groups request twice with the same Idempotency-Key after the first 201 response.`
- Affected system: Public booking API (/api/appointments, /api/booking-groups)
- Risk: Clients retrying after a transport failure receive 409 instead of a stable replayable result and cannot safely distinguish a completed booking from a conflict.
- Cause: Code review established that booking endpoints ignore Idempotency-Key; duplicate prevention relies on slot-conflict handling, producing 201 then 409 rather than idempotent replay.
- Proposed safe solution: Add the idempotency record inside the booking transaction, retain it through the retry window, and add isolated replay/concurrency tests before enabling it.
- Resolution guidance: Add a tenant- and customer-scoped durable idempotency record keyed by endpoint, Idempotency-Key and canonical request hash; atomically store and replay the original completed response, rejecting key reuse with a different payload.
- Applied status: NOT APPLIED

### recovery.lost-response-reconciliation — CRITICAL

- Problem: A booking command has no durable client-reconcilable terminal outcome after response loss or process restart.
- Reproduction: `Submit a booking, drop the client response or restart the API after commit, then retry or query using the original command identifier.`
- Affected system: Public booking API command handling and durable booking storage
- Risk: A client cannot deterministically recover whether an accepted booking committed; retries can surface a conflict without the original appointment outcome.
- Cause: Code review established there is no durable command/outcome record or reconciliation endpoint for booking requests after a lost response or process restart.
- Proposed safe solution: Implement an append-only booking-command/outcome table with a unique tenant/customer/command constraint and test post-commit response loss plus restart recovery.
- Resolution guidance: Persist a command ID, canonical request hash and terminal appointment/group outcome in the same transaction; expose authenticated reconciliation and replay by command ID.
- Applied status: NOT APPLIED

### notifications.retry-dedup — HIGH

- Problem: The required test command did not complete successfully.
- Reproduction: `pnpm run test:rescheduled-confirmations && pnpm run test:salon-notifications:release`
- Affected system: 5. Notifications retry and deduplication
- Risk: Customers may miss changed appointment details or receive duplicate notifications.
- Cause: The command failed; inspect commandOutcomes.outputTail for the first actionable error. Root cause is not inferred.
- Proposed safe solution: Preserve the existing production safeguards; apply only the smallest fix proven by the failing isolated test.
- Resolution guidance: Fix the first failing assertion or environment dependency, rerun this exact command, then regenerate the final report.
- Applied status: NOT APPLIED

### notifications.cross-process — HIGH

- Problem: The required test command did not complete successfully.
- Reproduction: `pnpm run test:rescheduled-confirmations && pnpm run test:salon-notifications:release`
- Affected system: 5. Notifications retry and deduplication
- Risk: An owner may miss alerts or receive another salon's alert.
- Cause: The command failed; inspect commandOutcomes.outputTail for the first actionable error. Root cause is not inferred.
- Proposed safe solution: Preserve the existing production safeguards; apply only the smallest fix proven by the failing isolated test.
- Resolution guidance: Fix the first failing assertion or environment dependency, rerun this exact command, then regenerate the final report.
- Applied status: NOT APPLIED

## Unresolved blockers

- concurrency.idempotency-key-replay: FAIL
- recovery.lost-response-reconciliation: FAIL
- observability.database-state: TELEMETRY UNAVAILABLE

