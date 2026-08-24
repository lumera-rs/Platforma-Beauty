---
name: Cross-tab cart burst tests
description: Reliable browser coverage for coalescing rapid storage-based cart notifications.
---

Test a cross-tab cart event burst with separate browser tasks spaced below the application debounce window, rather than several `localStorage.setItem` calls in one synchronous callback.

**Why:** Browsers can coalesce or otherwise defer same-task storage writes for another tab, making a fixture observe only part of the intended sequence. Separate short tasks mirror real cart edits, whose notifications are emitted after independent asynchronous mutations.

**How to apply:** When testing cross-tab announcement coalescing, retain a delay shorter than the coalescing window between storage writes and assert the receiving page observed only the final live-region message.