---
name: Radix tooltip browser assertions
description: Browser assertions for Radix tooltips that combine pointer hover and keyboard focus.
---

When Playwright hovers a Radix tooltip trigger, the one open tooltip can remain visible while the pointer-triggered state is transitioning to keyboard focus. Assert the trigger is focused and that exactly one tooltip contains the expected content, rather than requiring the hover tooltip to close between modality checks.

**Why:** In the proxied Chromium test environment, moving the mouse away did not reliably close the delayed-open tooltip even though the UI remained correct; forcing an intermediate hidden state made a valid accessibility check flaky.

**How to apply:** For a hover/focus regression, verify the tooltip after hover, focus the same trigger, verify `toBeFocused()`, and verify the page still has exactly one matching tooltip.