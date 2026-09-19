# Evidence checklist

The machine register is authoritative for IDs and links. There is exactly one
required evidence definition for every readiness condition:

| Evidence range | Conditions | Subject |
|---|---|---|
| EV-ENV-01–04 | ENV-01–04 | hosting, target, environment separation, services |
| EV-DB-01–08 | DB-01–08 | identity, grants, escalation, caps, GUCs, close |
| EV-TOP-01–05 | TOP-01–05 | autoscale, revisions, workers, startup DDL, fence |
| EV-BKP-01–05 | BKP-01–05 | backup, retention/PITR, latest backup, restore, RPO/RTO |
| EV-OPS-01–05 | OPS-01–05 | owners, abort, monitoring, thresholds, duration |
| EV-AUTH-01–04 | AUTH-01–04 | A, B, C/D, and E/F/G authorization boundaries |
| EV-STATUS-01 | STATUS-01 | unchanged statuses and production-fact boundary |

Every definition records purpose, responsible role, source, acquisition method,
acceptable form, acceptance criteria, creation time requirement, expiry or
recollection trigger, independent review, missing-evidence consequence and the
required approval class. No field contains a production result.

## Common acceptance gates

1. Approval for acquisition exists before acquisition.
2. Exact target, environment, revision, scope and time window agree across all
   submitted evidence.
3. Source is authoritative and independently attributable.
4. Secret and personal data redaction is verified.
5. Timestamp and freshness policy are satisfied.
6. Digest/integrity is verified after redaction.
7. Independent reviewer records a disposition.
8. Any mismatch, missing field or stale item is `BLOCKED`; never infer success.

`DOCUMENTED_ONLY`, `UNKNOWN` and `BLOCKED` never become `VERIFIED`
automatically. Evidence review is separate from authoritative status decisions.