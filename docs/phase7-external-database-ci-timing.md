# Phase 7 external-database CI timing calibration

## Contract adjustment

The pool runtime and external-database integration checks remain the first two
commands in the protected `database:release:2-backend` timed phase. This
calibration changes only that phase baseline and the database total which
contains it:

| Baseline | Before Phase 7 | Measured addition | Calibrated value |
| --- | ---: | ---: | ---: |
| `database:release:2-backend` | 355s | 11s | 366s |
| `validate:ci:database:total` | 685s | 11s | 696s |

The established additive convention is used: take the successful new-command
measurements, round each upward to a whole second, and add them to the last
baseline that did not contain those commands. The pool runtime check measured
approximately 1 second and the owned-disposable-PostgreSQL integration check
approximately 10 seconds, so the measured addition is `1 + 10 = 11` seconds.
The earlier provisional 20-second addition (375s and 705s) is replaced rather
than compounded.

The warning formula remains
`ceil(max(baseline * 1.5, baseline + 30))`. The resulting warning thresholds
are 549 seconds for the phase and 1,044 seconds for the database total.

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
not successful-phase baseline samples. The 1-second and 10-second successful
new-command measurements are the calibration inputs; this does not relabel the
failed aggregate reports as successful. The calibration remains additive and
does not infer either command's cost by subtracting noisy whole-phase results.

No browser or build timing budget, warning formula, schema baseline,
startup-DDL baseline, evidence baseline, or migration source is changed.