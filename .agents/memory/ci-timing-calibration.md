---
name: CI timing calibration
description: How to calibrate CI phase baselines when Actions history predates timing artifacts
---

Use successful main-branch timing reports for phase baselines. Older successful Actions runs may expose only job-level durations because they predate timing-artifact uploads; those totals are useful as a provisional signal, not as phase observations.

**Why:** GitHub Actions can retain successful runs while having no downloadable timing artifact, and job logs may be unavailable through the connected API.

**How to apply:** Keep the calibration conservative, document the warning formula and confirmation count in the generated summary, and revisit phase baselines after several new timing artifacts exist.

New CI checks must enter the timed-phase contract, not run as unprotected sibling workflow steps.

**Why:** The user explicitly rejected bypassing the pinned sequence: a sibling step could later disappear without the release-contract tests detecting its removal. CI timing budgets are distinct from protected schema, startup-DDL, and evidence baselines.

**How to apply:** Add the phase, its expected command, and its budget together without weakening existing assertions. When no runner samples exist, label measured local calibration as provisional rather than claiming historical CI evidence.

Related: [CI history ordering](ci-history-ordering.md) explains why history must be sorted before applying the report limit.