# Backup and restore checklist

- **EV-BKP-01:** provider/owner evidence binds active backup configuration to
  the exact target.
- **EV-BKP-02:** retention and PITR windows are explicit and active.
- **EV-BKP-03:** latest successful backup includes target, timestamp and
  integrity outcome.
- **EV-BKP-04:** actual isolated restore rehearsal report includes restore
  point, execution time, integrity checks, outcome and operator/reviewer.
- **EV-BKP-05:** approved RPO/RTO objectives are compared with measured results.

The recovery operator signs through an approved identity system; no signature
is fabricated or copied into this repository. `backup enabled`, a documentation
URL, a timestamp alone, or a development restore cannot satisfy restore
readiness. EV-BKP-04 remains missing and readiness remains `BLOCKED` until a
real, independently reviewed execution report exists.

This checklist does not start backup/restore or access backup storage.