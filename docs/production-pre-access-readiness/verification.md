# Database-free verification

## Boundary

The validator reads local JSON/text and file metadata only. It has no database
client, network API, SQL executor, filesystem write, child process, application
import or environment/secret access. Approved executable sources are treated as
text/path evidence and are never imported.

Run:

```text
node docs/production-pre-access-readiness/validate.mjs
node docs/production-pre-access-readiness/tests/validation.test.mjs
```

## Validated contract

- exact top-level status and authorization partition;
- unique, exact required condition IDs and allowed fields;
- exact required approval for every condition, pinned independently of the candidate;
- valid source paths;
- status vocabulary and no automatic `DOCUMENTED_ONLY` promotion;
- strict unconditional `globalStatus = BLOCKED`, rejecting any other value with
  `E_GLOBAL_STATUS_INVALID`; the redundant unreachable promotion branch is removed;
- restoration and maintenance fencing remain blocked;
- only activity A is authorized;
- 1,545 records remain `UNRESOLVED` and production facts `UNKNOWN`;
- approved phase-5 execution package still validates;
- exact negative-test rejection reasons;
- no secret-looking values in the readiness JSON.

Static validation proves package consistency only. It does not verify production
identity, access, privileges, topology, backup, restore, monitoring, ownership
or authorization.

## Observed result

The completed local runs reported:

```text
validate.mjs: baseline valid; 17 exact-error negative fixtures rejected.
validation.test.mjs: baseline valid; 17 exact-error negative fixtures rejected.
validate.mjs: baseline valid; 59 negative fixtures rejected with exact errors; every mutation observed.
```

The positive fixture explicitly checks all 32 original approval assignments and
validates the approved matrix. The five new negative fixtures each prove input
mutation and exact rejection:

| Mutation | Exact rejection |
|---|---|
| AUTH-03 approval C to A | `E_REQUIRED_APPROVAL_DRIFT:AUTH-03` |
| AUTH-04 approval E to A | `E_REQUIRED_APPROVAL_DRIFT:AUTH-04` |
| All 32 approval fields assigned A | `E_REQUIRED_APPROVAL_DRIFT:ENV-01` (first mismatch) |
| AUTH-03 unknown class I | `E_REQUIRED_APPROVAL_INVALID:AUTH-03` |
| AUTH-03 requiredApproval removed | `E_CONDITION_FIELD_INVALID:AUTH-03` |

The A–H allowlist and exact-field checks remain in place before the new drift
check. A required approval class does not grant authorization: only A remains
authorized, and B–H remain not authorized. Repository verification labels in
the environment inventory are presentation-only; machine statuses are unchanged.

The third output line is the unchanged approved execution-package validator. An
independent local assertion also confirmed:

- 1,545 records remain `UNRESOLVED`;
- production facts remain `UNKNOWN`;
- all 8,304 requirement links remain present;
- all 85 protected input hashes match;
- the reviewed P-05 phase-contract digest is unchanged.

The import graph was inspected before execution. Imports are limited to Node
assertions, filesystem reads/existence checks, path/URL conversion and the two
local validation modules. No production evidence is recorded here.