# GitHub merge queue validation

Validated on 2026-09-03 for the public organization-owned repository
[`lumera-rs/Platforma-Beauty`](https://github.com/lumera-rs/Platforma-Beauty).

## Live configuration verified on 2026-09-03

- Ruleset: [`Protect default branch CI`](https://github.com/lumera-rs/Platforma-Beauty/rules/22142708)
- Target: `~DEFAULT_BRANCH`
- Enforcement: active
- Merge queue: active, squash merge
- Required status context: `GitHub Actions syntax and expressions`
- Workflow trigger: `merge_group` in `.github/workflows/workflow-lint.yml`

The scheduled `Repository ruleset audit` verifies the organization/public eligibility,
the active merge queue rule, the unchanged required status context, and the existence
of a successful `Workflow syntax` run on a `gh-readonly-queue/` ref.

## Migration-contract rollout (expected, not yet live-verified)

The repository changes now declare `merge_group` in `.github/workflows/ci.yml`,
run the `Migration contract (database-free)` gate for pull requests, merge groups,
pushes, and manual dispatches, and expect the default-branch ruleset to require
both `GitHub Actions syntax and expressions` and `Migration contract (database-free)`.
These are source-level and structural-test expectations, not evidence of the live
GitHub settings.

As of the verification date above, the new migration-contract required context and
the new Branch CI merge-group trigger have **not** been verified in the live
ruleset or by a successful live queue run. The read-only audit source checks for
both contexts and will fail closed until the live ruleset is updated and verified;
the existing `Workflow syntax` probe below remains evidence only for the previously
verified workflow.

The migration-contract gate reads `pull_request.base.sha` or
`merge_group.base_sha` from the native GitHub event payload. It keeps that exact
GitHub-provided SHA as its comparison identity while performing bounded history
deepening in a shallow checkout. The queue base is therefore not supplied by a
PR author or replaced by a mutable branch tip. Pull-request and merge-group runs
compare protected history; push and manual-dispatch runs validate the current
migration set only and do not compare a committed parent.

The ruleset audit remains scheduled/manual and read-only. Its offline fixture
mode exists only for regression tests: it performs no API call and needs no
token. A fixture missing either required context fails closed.

## Controlled live probe

- Probe PR: [`#5 Test GitHub merge queue workflow`](https://github.com/lumera-rs/Platforma-Beauty/pull/5)
- Successful merge-group run:
  [`Workflow syntax #33692898152`](https://github.com/lumera-rs/Platforma-Beauty/actions/runs/33692898152)
- Cleanup PR: [`#6 Remove merge queue probe file`](https://github.com/lumera-rs/Platforma-Beauty/pull/6)
- Successful cleanup merge-group run:
  [`Workflow syntax #33693234649`](https://github.com/lumera-rs/Platforma-Beauty/actions/runs/33693234649)

Both PRs were enqueued at position 1, ran `Workflow syntax` with the `merge_group`
event on GitHub-generated queue refs, passed the required status, and merged
automatically. Both temporary branches were deleted, and the probe file was removed
from `main`. The merge queue remains enabled.