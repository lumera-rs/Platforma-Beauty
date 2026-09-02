# GitHub merge queue validation

Validated on 2026-09-03 for the public organization-owned repository
[`lumera-rs/Platforma-Beauty`](https://github.com/lumera-rs/Platforma-Beauty).

## Configuration

- Ruleset: [`Protect default branch CI`](https://github.com/lumera-rs/Platforma-Beauty/rules/22142708)
- Target: `~DEFAULT_BRANCH`
- Enforcement: active
- Merge queue: active, squash merge
- Required status context: `GitHub Actions syntax and expressions`
- Workflow trigger: `merge_group` in `.github/workflows/workflow-lint.yml`

The scheduled `Repository ruleset audit` verifies the organization/public eligibility,
the active merge queue rule, the unchanged required status context, and the existence
of a successful `Workflow syntax` run on a `gh-readonly-queue/` ref.

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