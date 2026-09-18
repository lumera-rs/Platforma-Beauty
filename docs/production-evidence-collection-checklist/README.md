# Production evidence collection checklist

Preparation only. This package defines how future operators may submit evidence
for the 32 conditions in `docs/production-pre-access-readiness/readiness-matrix.json`.
It collects nothing, grants nothing, and does not access production.

Global readiness remains `BLOCKED`; 1,545 authoritative records remain
`UNRESOLVED`; production facts remain `UNKNOWN`. Only activity A (documentation
preparation) is `AUTHORIZED`; B–H remain `NOT_AUTHORIZED`.

Files:

- `evidence-checklist.md` and `evidence-register.json` — complete 32-condition map.
- `operator-instructions.md` — controlled acquisition/submission workflow.
- category checklists for backup/restore, maintenance, access security,
  monitoring and approvals.
- `evidence-submission-template.md` — empty future submission form.
- `validate.mjs`, `tests/validation.test.mjs`, `verification.md` — local,
  database-free contract checks.

An attached file is untrusted input until source, scope, freshness, integrity,
redaction and independent review all pass. Empty templates, repository
configuration, credentials, screenshots without provenance, and self-assertions
are not evidence.