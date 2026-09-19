# Database-free verification

The local validator reads only:

- `evidence-request-register.json`;
- the approved collection evidence register;
- the approved readiness matrix.

It has no database, network, SQL, filesystem-write, child-process, application
or environment/secret capability. It verifies exact 32→32 identity and
condition linkage, fixed approval classes, all `NOT_COLLECTED`, A-only
authorization, blocked readiness, protected request rules and absence of
submitted results or secret-shaped values.

An independently pinned policy digest protects every request's IDs, responsible
role, required evidence, approval, acceptance criteria, freshness and status
even if a candidate and an approved source are weakened together.

Run:

```text
node docs/production-evidence-handoff/validate.mjs
node docs/production-evidence-handoff/tests/validation.test.mjs
```

## Observed local results

```text
validate.mjs: baseline valid; 32 handoff requests remain NOT_COLLECTED; 23 exact-error negative fixtures rejected.
validation.test.mjs: baseline valid; 32 handoff requests remain NOT_COLLECTED; 23 exact-error negative fixtures rejected.
```

Approved local regression validators also passed with 17, 30 and 59 negative
fixtures respectively. Independent reconciliation confirms 32 readiness
conditions, 32 evidence definitions, 32 handoff requests, exact ID/condition
equality, no duplicates or orphans, unchanged approvals, A authorized, B–H not
authorized, and global/restore/maintenance readiness `BLOCKED`.

Passing static validation is not production evidence, approval or readiness.
