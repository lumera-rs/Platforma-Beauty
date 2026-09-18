# Operator instructions

## Before acquisition

1. Stop unless the exact activity class is separately authorized. Only A is
   currently authorized.
2. Select one evidence definition from the register; do not broaden its scope.
3. Record target alias, environment, revision, window, operator role, approval
   reference, acquisition method, retention and redaction plan without secrets.
4. Confirm the source owner and independent reviewer.
5. Confirm abort criteria and secure out-of-repository submission channel.

## Acquisition

- Use the authoritative owner/control-plane/provider source named by the
  definition.
- Do not copy passwords, tokens, connection strings, private keys, personal
  data or unnecessary internal identifiers.
- Do not access production under this package. Future acquisition begins only
  after its separate approval.
- Do not run SQL, stop services, alter deployment, run backup/restore, retry,
  migrate or repair automatically.
- Preserve source timestamp and generate a digest only after approved redaction.

## Comparison

Environment, database identity, region, PostgreSQL version, active schema and
deployment revision must agree across independent target, control-plane and DB
identity evidence. Any mismatch blocks the entire collection window.

Maintenance evidence must show the mechanism was active and tested for the
exact window, with all instances, workers, schedulers, startup DDL and write
paths covered. Mechanism documentation alone fails.

## Submission and review

Submit the completed form through an approved secure channel. An attachment is
not validated merely by arrival. The reviewer verifies source, scope,
freshness, redaction, integrity, cross-evidence consistency and authorization.
Rejected/partial evidence remains quarantined and cannot advance readiness.