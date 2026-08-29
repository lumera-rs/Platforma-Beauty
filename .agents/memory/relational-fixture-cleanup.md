---
name: Relational fixture cleanup
description: Cleanup ordering for integration fixtures that remain visible to a live application during a test.
---

Marker-owned parent rows exposed to a running application must be treated as mutable fixture roots: cleanup removes any dependents that reference the marker-owned parents before deleting those parents.

**Why:** Demo-data initialization, background activity, or requests made during the test can legitimately create dependent rows after fixture setup. Deleting only the originally inserted rows can then fail on foreign keys and leak the fixture.

**How to apply:** Give fixture roots a run-unique marker, identify dependents through their foreign keys to those marked roots, and delete in dependency order. Never broaden cleanup to unrelated rows merely because they were created during the same time window.