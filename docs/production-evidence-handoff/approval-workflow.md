# Approval workflow

Each activity requires its own record; one class never implies another.

| Class | Activity | Current state |
|---|---|---|
| A | Documentation preparation | AUTHORIZED |
| B | Production configuration read | NOT_AUTHORIZED |
| C | Production database connection | NOT_AUTHORIZED |
| D | One exact diagnostic or control verification | NOT_AUTHORIZED |
| E | P-05 PREFLIGHT | NOT_AUTHORIZED |
| F | P-05 SCAN | NOT_AUTHORIZED |
| G | Retry | NOT_AUTHORIZED |
| H | Migration or production change | NOT_AUTHORIZED |

A future approval must identify the authorized approver, exact target, exact
scope, start/end time, prerequisites, allowed and forbidden operations, abort
conditions, and independent-review record. It must be authenticated in the
approved external system. Do not place signatures, credentials, tokens or
personal data here.

An empty template, conversation statement, uploaded file, earlier approval,
successful prerequisite, or technical capability is not approval. Expiry,
target/revision change, failed prerequisite or abort condition returns the
activity to `NOT_AUTHORIZED`.
