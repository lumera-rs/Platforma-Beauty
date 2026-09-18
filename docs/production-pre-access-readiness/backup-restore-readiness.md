# Backup and restore readiness

## Result

**Restore readiness: `BLOCKED`.**

Repository documentation requires recovery evidence but contains no acceptable
proof of a production restore rehearsal. Backup enabled is not restore tested.

| Required fact | Status | Missing evidence |
|---|---|---|
| Backup configuration | UNKNOWN | Owner/control-plane evidence for exact target |
| Retention period | UNKNOWN | Approved policy and active configuration |
| PITR capability/window | UNKNOWN | Provider evidence tied to target |
| Latest successful backup | UNKNOWN | Timestamp, target, integrity result and operator |
| Latest successful restore test | BLOCKED | Owner-signed rehearsal with measured outcome |
| RPO requirement/result | UNKNOWN | Approved objective and measured compliance |
| RTO requirement/result | UNKNOWN | Approved objective and measured compliance |
| Responsible recovery operator | UNKNOWN | Named role/on-call assignment and acceptance |

## Evidence required before access

The recovery owner must provide a fresh, non-secret attestation containing:

- exact environment and target alias;
- restore point and backup identity without credentials or signed URLs;
- isolated restore-test scope and date;
- measured integrity checks and outcome;
- measured RPO and RTO against approved objectives;
- retention and PITR window;
- operator and independent reviewer disposition;
- evidence digest, freshness and invalidation conditions.

A recent backup timestamp, enabled toggle, documentation URL, development
restore, or untested backup is insufficient.

No backup/storage endpoint was accessed and no backup or restore was started.