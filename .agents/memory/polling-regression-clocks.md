---
name: Polling regression clocks
description: Deterministic Playwright clock setup for browser tests that exercise React Query polling.
---

For timer-polling browser regressions, install Playwright clock control before navigation and advance the interval after the page has mounted. Installing it after the page is already open can leave the existing polling schedule outside the controlled clock.

**Why:** An already-mounted page can retain a timer created before clock control was installed, making a test appear to pass only after a fresh browser context or real-time waiting.

**How to apply:** Call `page.clock.install()` before `page.goto()` for the polling scenario, avoid visibility/focus events, and fast-forward the configured interval while awaiting the expected network response.