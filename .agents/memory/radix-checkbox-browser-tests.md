---
name: Radix checkbox browser tests
description: How Playwright should interact with Radix checkbox controls in this project.
---

Treat Radix checkbox controls as accessible buttons: click them as a user would, then assert their checked state. Do not use Playwright's native-input `check()` helper.

**Why:** Radix renders `role="checkbox"` on a button. Playwright can resolve it through its label, but `check()` expects native checkbox semantics and reports that the click did not change state even when the application handler is the intended interaction path.

**How to apply:** In browser regressions for shared checkbox components, locate by checkbox role and accessible name, call `click()`, and verify with `toBeChecked()`.