---
name: CI timing calibration
description: How to calibrate CI phase baselines when Actions history predates timing artifacts
---

Use successful main-branch timing reports for phase baselines. Older successful Actions runs may expose only job-level durations because they predate timing-artifact uploads; those totals are useful as a provisional signal, not as phase observations.

**Why:** GitHub Actions can retain successful runs while having no downloadable timing artifact, and job logs may be unavailable through the connected API.

**How to apply:** Keep the calibration conservative, document the warning formula and confirmation count in the generated summary, and revisit phase baselines after several new timing artifacts exist.