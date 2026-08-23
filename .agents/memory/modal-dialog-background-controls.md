---
name: Modal dialog background controls
description: How to browser-test state changes from controls a modal Radix dialog blocks, and what that blocking implies.
---

The app's Radix dialogs are modal: the overlay intercepts all real pointer input, so page controls behind an open dialog (e.g. the campaign overview period selector) cannot be clicked by users or by Playwright's normal `click()` (hit-test fails on the overlay; `force: true` does not help because the real event still lands on the overlay).

**Why:** A spec that must exercise a state combination "shared page state changes while a dialog stays open" (reset effects keyed on that state) cannot reach it through real pointer input, and closing/reopening the dialog masks the very dependency under test because dialog-identity resets fire anyway.

**How to apply:** Use Playwright `locator.dispatchEvent("click")` on the background control — React's onClick fires from the bubbling synthetic event, while Radix dismisses only on real pointerdown outside, so the dialog stays open. Assert the dialog remains visible afterward. Validate such synthetic-path guards with a quick mutation run (temporarily drop the dependency and confirm the spec fails). Also note the product implication: any state the user is supposed to change "while viewing" a modal dialog needs a control inside the dialog.
