# Database-free verification

The validator may read only local documentation/JSON and check file existence.
Its import graph must contain no database client, network, SQL executor,
filesystem write, child process, application import or environment/secret read.

It validates:

- exactly 32 unique evidence IDs and 32 unique linked condition IDs;
- exact one-to-one condition coverage;
- independently pinned condition→evidence and condition→approval mappings;
- source references and required fields;
- global `BLOCKED`, `UNRESOLVED`, `UNKNOWN`, A authorized and B–H not authorized;
- no submitted/accepted/verified production result;
- no automatic promotion;
- exact-error negative fixtures.

Run:

```text
node docs/production-evidence-collection-checklist/validate.mjs
node docs/production-evidence-collection-checklist/tests/validation.test.mjs
```

## Observed local results

```text
validate.mjs: baseline valid; 32 evidence definitions cover 32 conditions; 30 exact-error negative fixtures rejected.
validation.test.mjs: baseline valid; 32 evidence definitions cover 32 conditions; 30 exact-error negative fixtures rejected.
validate.mjs: baseline valid; 17 exact-error negative fixtures rejected.
validate.mjs: baseline valid; 59 negative fixtures rejected with exact errors; every mutation observed.
```

The last two lines are the unchanged pre-access-readiness and execution-plan
validators. Independent reconciliation confirmed unique 32→32 coverage,
unchanged approval classes, A authorized, B–H not authorized, global `BLOCKED`,
1,545 `UNRESOLVED` records, `UNKNOWN` production facts, 8,304 requirement
links, 85 matching protected hashes and the unchanged P-05 phase digest.

Static success is not production evidence or authorization.

## Correction findings

- Readiness matrix: parsed and structurally checked; its IDs and approvals are
  compared both with independent fixed expectations and with the register.
- Evidence criteria: all 32 triples of `acceptanceCriteria`,
  `acquisitionMethod` and `freshnessRule` are protected by an independently
  pinned digest; ten critical definitions additionally have exact field-level
  pins and dedicated drift errors.
- Secret detection: recursively scans every textual register value for guarded
  credential and private-key forms without returning the detected value.

The adversarial suite injects matrix ID and approval drift, simultaneous matrix
and register weakening, ten requested criteria weakenings, an unlisted-record
criteria weakening, and three synthetic secret forms. It does not modify the
approved readiness matrix on disk.