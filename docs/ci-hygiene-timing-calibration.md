# CI hygiene: new timed-phase calibration

## Contract

Internal request controls and RMAS are build-job timed phases, not separate
workflow steps. Both are inserted additively into the release-chain test's
exact command sequence and its ordered phase inventory. Existing assertions
and timing budgets remain unchanged.

## Derivation

The existing timing configuration was introduced with provisional calibration
values and subsequently adjusted. Its history does not retain raw observations
or a reproducible formula for each original phase value. Successful main-branch
phase timing artifacts are the preferred calibration evidence; job totals are
not substitutes for phase measurements.

These two phases have no historical CI phase observations because they did not
previously run in CI. Their initial budgets are therefore explicitly
**provisional local measurements**, not measured Ubuntu runner performance.
On 2026-09-21, each exact command was run three times with CI=true,
NODE_ENV unset and DATABASE_URL unset, using Python's monotonic elapsed clock
around the complete pnpm command, including launcher overhead:

| Phase | Exact command | Successful durations (seconds) | Initial baseline |
| --- | --- | --- | --- |
| internal-request-controls | `pnpm run test:internal-request-controls` | 3.520, 3.305, 2.998 | 4 seconds |
| rmas | `pnpm run test:rmas` | 5.617, 3.141, 3.569 | 6 seconds |

For each new phase, the baseline is the maximum of the three successful
observations, rounded upward to whole seconds. This supplies conservative,
measured provisional values instead of copying a neighboring budget or
claiming nonexistent historical samples. RMAS includes both its typecheck and
its three React server-rendering tests; it requires no database or API server.
Internal request controls passed all ten tests without a database.

The existing warning formula is unchanged:
`ceil(max(baseline * 1.5, baseline + 30))`.
The corresponding warning thresholds are 34 and 36 seconds. Recalibrate from
successful main-branch phase artifacts once enough runner observations exist;
these local samples cannot establish GitHub runner performance.

No existing baseline, total budget, schema baseline, startup-DDL baseline,
evidence baseline, or manifest was changed.

## Verification

- `env -u NODE_ENV -u DATABASE_URL pnpm run test:release-chain`: 24/24 passed.
- `env -u NODE_ENV pnpm run validate:publish`: completed end to end, exit 0.
- Both new commands also passed each of the three database-free calibration runs.
- Every individual publish-chain check is now included in CI, directly or through
  nested release commands. CI still splits these checks across jobs rather than
  invoking the exact publish sequence as one command.

The header fix and Ubuntu pins were retained unchanged. The runner evidence is
the Build and static checks job at
https://github.com/lumera-rs/Platforma-Beauty/actions/runs/35568623224/job/106235889746:
Ubuntu 24.04.5 LTS, image ubuntu-24.04, image version 20260907.300.1.