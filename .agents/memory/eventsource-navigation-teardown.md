---
name: EventSource navigation teardown
description: How browser regressions should distinguish deliberate stream shutdown from failed navigation.
---

Browser tests that collect failed network requests must ignore a deliberately
closed EventSource reported by Chromium as `net::ERR_ABORTED` during navigation,
while still failing on all other request, console, page, and document-navigation
errors.

**Why:** Route changes tear down page-owned streams normally. Treating that
cleanup as a network failure makes navigation regressions noisy and masks the
errors the test is meant to catch.

**How to apply:** When a tested page owns an EventSource and the scenario
navigates away, narrowly exempt only the aborted EventSource teardown; do not
globally suppress aborted requests or other resource failures.