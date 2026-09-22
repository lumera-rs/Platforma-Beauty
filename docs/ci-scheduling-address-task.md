# CI scheduling after public salon address

This change follows the separate Stage A and Stage B address commits. It changes
when existing jobs start and which push events run Branch CI, not test content.

## Browser/database independence

In `.github/workflows/ci.yml`, Browser user journeys has its own PostgreSQL 16
service and browser database, checkout, dependency installation, and Playwright
installation. It consumes no artifact, output, cache, or database state produced
by Database checks. The database job uploads its own timing report; the browser
job's timing-history download is for prior browser runs, not the current database
job. Thus browser `needs` changes from `[release-chain, build, database]` to
`[release-chain, build]`. All other dependencies, job names, steps, tests,
timeouts, failure behavior, and required checks remain unchanged.

## Merge queue events

Branch CI push events exclude only branches matching `gh-readonly-queue/**`.
The explicit `tags: ['**']` preserves all tag pushes: a branch-only filter
without a tag filter would otherwise stop tag-triggered runs. Ordinary branch
pushes, pull requests, `merge_group` with `checks_requested`, and manual dispatch
remain enabled. Merge-queue Branch CI therefore runs through `merge_group`,
not a duplicate push on the temporary queue branch.

The independent Workflow syntax workflow is unchanged.

## Ruleset audit

No expected merge-method pin exists in `scripts/verify-github-ruleset.sh`.
The audit accepts `MERGE`, `SQUASH`, or `REBASE`. The `SQUASH` value in the
offline release-chain fixture is sample input, not required live policy.
Consequently neither that fixture nor the audit, live ruleset, or merge method
was changed. The owner's future switch to merge commits is already accepted.

## Contract and measurements

Only the two Branch CI push-trigger assertions and the browser dependency
assertion in `scripts/src/release-chain.test.ts` change to match. All additive
address test phases and their budgets from Stages A/B remain in force.

Per-job UTC start/end times, elapsed durations, status, and workflow event for
the final PR commit must be reported from GitHub. Scheduling removes the forced
serial wait; measured wall-clock savings must not be claimed until the jobs
actually run and comparable results are available.