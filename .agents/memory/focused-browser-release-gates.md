---
name: Focused browser release gates
description: Why narrow UI shell regressions should use dedicated browser specs and release commands.
---

Keep narrow, release-blocking browser regressions in a dedicated spec and command rather than adding an unrelated broad browser suite to the release chain.

**Why:** A broad suite can contain older page-level fixtures and authorization scenarios outside the regression’s scope. Enrolling it turns unrelated drift into a release blocker and obscures whether the targeted invariant actually passed.

**How to apply:** Reuse the isolated browser harness, but give each release-critical shell or navigation invariant a focused spec. Add its command to the release-chain assertion and run the complete focused spec after final edits.