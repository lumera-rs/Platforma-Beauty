---
name: Campaign period portal tests
description: Browser-test locator rule for the campaign period picker rendered through Radix
---

**Rule:** Locate campaign period picker content from its page-level test id, not from the period-selector container, because Radix renders the popover in a portal outside that subtree.

**Why:** A selector-scoped locator can find the trigger but cannot reach the open calendar presets, causing an otherwise valid interaction to time out.

**How to apply:** For campaign period browser coverage, scope the trigger to the selector and scope open range presets to the page-level `stats-period-selector-range-presets` or `overview-period-selector-range-presets` test id. When a test opens the overview picker alongside its table, use a tall desktop viewport so the portal control can receive a normal click; compact-height clickability belongs in its dedicated regression.