# Production evidence handoff

Documentation-only plan for assigning and sequencing the future collection of
the 32 production-readiness evidence items. It is not evidence, authorization,
or permission to access production.

## Fixed boundary

- Activity A (documentation preparation) is `AUTHORIZED`.
- Activities B–H are `NOT_AUTHORIZED`.
- Every request is `NOT_COLLECTED`.
- Global, restore, and maintenance readiness remain `BLOCKED`.
- A submitted file is only a review candidate, never accepted evidence by
  attachment alone.

Use `operator-action-plan.md` and `collection-sequence.md` to coordinate future
work only after the separately required approval. Use `handoff-template.md`
without adding secrets or personal data to this repository.

## Local verification

```text
node docs/production-evidence-handoff/validate.mjs
node docs/production-evidence-handoff/tests/validation.test.mjs
```
