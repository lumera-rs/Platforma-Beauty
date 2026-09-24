# Phase 7 external-database CI timing calibration

## Contract adjustment

The pool runtime and external-database integration checks remain the first two
commands in the protected `database:release:2-backend` timed phase. This
calibration changes only that phase baseline and the database total which
contains it:

| Baseline | Before Phase 7 | Measured addition | Calibrated value |
| --- | ---: | ---: | ---: |
| `database:release:2-backend` | 355s | 13s | 368s |
| `validate:ci:database:total` | 685s | 13s | 698s |

The established additive convention is used: for each new command, take the
maximum successful measurement across the existing runs, round that maximum
upward to a whole second, and add the independently rounded command budgets to
the last baseline that did not contain those commands. The two pool-runtime
measurements were 0.97 and 1.46 seconds, so its contribution is
`ceil(max(0.97, 1.46)) = 2` seconds. The two
owned-disposable-PostgreSQL integration measurements were 9.77 and 10.55
seconds, so its contribution is `ceil(max(9.77, 10.55)) = 11` seconds. The
measured addition is therefore `2 + 11 = 13` seconds: `355 + 13 = 368` for the
phase and `685 + 13 = 698` for the database total.
The earlier provisional 20-second addition (375s and 705s) is replaced rather
than compounded.

The warning formula remains
`ceil(max(baseline * 1.5, baseline + 30))`. The resulting warning thresholds
are 552 seconds for the phase and 1,047 seconds for the database total.

## PR 40 runner evidence

The two run variants for PR 40 at head `9abb2f55` provide the actual hosted
runner evidence:

- Pull-request run
  [35920735732](https://github.com/lumera-rs/Platforma-Beauty/actions/runs/35920735732),
  database timing artifact
  [10777491647](https://github.com/lumera-rs/Platforma-Beauty/actions/runs/35920735732/artifacts/10777491647):
  `database:release:2-backend` reached 251 seconds and the recorded database
  total reached 262 seconds.
- Push run
  [35920728240](https://github.com/lumera-rs/Platforma-Beauty/actions/runs/35920728240),
  database timing artifact
  [10777461649](https://github.com/lumera-rs/Platforma-Beauty/actions/runs/35920728240/artifacts/10777461649):
  `database:release:2-backend` reached 225 seconds and the recorded database
  total reached 242 seconds.

Both reports have status `failed` because a later check in release phase 2
failed. Their aggregate phase values are therefore corroborating run evidence,
not successful-phase baseline samples. The two successful measurements for each
new command (0.97 and 1.46 seconds; 9.77 and 10.55 seconds) are the calibration
inputs; this does not relabel the failed aggregate reports as successful. The
calibration remains additive and does not infer either command's cost by
subtracting noisy whole-phase results.

No browser or build timing budget, warning formula, schema baseline,
startup-DDL baseline, evidence baseline, or migration source is changed.