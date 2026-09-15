---
name: Shallow Git ancestry evidence
description: Local shallow fetch success does not establish portability to Actions runners.
---

Do not treat a locally passing shallow ancestry fixture as proof that fetching only an older base repairs the checkout's history.

**Why:** A reported Actions run failed ancestry after bounded base-only fetches while local Git 2.50.1 passed the same fixture. Locally, incidental shallow-boundary negotiation masked the incorrect traversal anchor. The exact runner/version difference was not established.

**How to apply:** Distinguish object availability from ancestry proof. Regressions should assert initially missing ancestry and inspect actual Git fetch anchors, with deterministic commit dates. Report runner-specific reproduction limits honestly rather than claiming an unobserved version-specific cause.