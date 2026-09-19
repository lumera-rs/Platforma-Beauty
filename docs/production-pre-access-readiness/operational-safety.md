# Operational safety

## Controls present in approved documentation

- named system/database, operations, incident, data/privacy/security,
  business/policy and recovery responsibilities;
- an abort procedure that cancels work, cleans the session, quarantines partial
  output, records the trigger and forbids automatic repair/retry;
- a rollback/recovery evidence requirement;
- monitoring before access with an abort-capable operator;
- fixed per-statement limits and diagnostic-specific row/byte caps;
- explicit handling for unavailable DB, insufficient privilege, timeout, lock
  contention, result cap, schema mismatch, state change, connection loss,
  partial capture, hash mismatch and P-05 preflight failure.

These controls are `DOCUMENTED_ONLY`, except that their local text and validator
enforcement are repository-verifiable.

## Production facts not established

| Fact | Status |
|---|---|
| Incident owner/on-call acceptance | UNKNOWN |
| Responsible database operator | UNKNOWN |
| Live monitoring and alert delivery | UNKNOWN |
| CPU threshold | UNKNOWN |
| I/O threshold | UNKNOWN |
| Replication-lag threshold | UNKNOWN |
| Lock/blocked-session threshold | UNKNOWN |
| Maximum end-to-end diagnostic duration | UNKNOWN |
| Abort/cancel path exercised against exact topology | UNKNOWN |
| Rollback or restore successfully rehearsed | BLOCKED |

No universal CPU, I/O, lag or overall-duration threshold is invented here.
Each must be supplied and approved for the exact target and collection window.
The documented 15-second statement timeout is not an end-to-end duration or a
resource-safety proof.

## Mandatory abort behavior

Any mandatory unknown, threshold crossing, stale evidence, target mismatch,
revision change, privilege mismatch, unexpected result, lock wait, timeout,
monitor failure or loss of the abort-capable operator immediately yields
`BLOCKED`. Do not repair, retry, advance stages or change production.