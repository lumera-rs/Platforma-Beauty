# Monitoring and operational safety checklist

Required future evidence covers:

- active monitors and functional test alerts;
- approved CPU, I/O, replication-lag, lock/blocked-session and result thresholds;
- approved maximum end-to-end diagnostic duration;
- incident owner and abort-capable operator for the exact window;
- exercised cancel path, rollback responsibility and recovery escalation.

Each threshold needs units, evaluation window, target, approver and abort action.
No numeric threshold is invented by this package. The 15-second per-statement
timeout is not an end-to-end duration or CPU/I/O safety threshold.

Missing monitor, failed alert, absent operator, undefined threshold or stale
test is `BLOCKED` and ends the window without automatic retry.