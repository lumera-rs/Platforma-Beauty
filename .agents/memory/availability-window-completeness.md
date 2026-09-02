---
name: Availability window completeness
description: When a calendar may safely interpret an absent slot as an unavailable day.
---

A staff calendar may mark a day unavailable from an absent slot only when the server returns the complete bounded availability window. A global slot cap can exhaust on earlier dates and make later dates look closed even though they were never evaluated.

**Why:** List APIs commonly cap chronological results for speed, but calendar UIs assign meaning to omissions. Reusing a globally truncated list silently turns pagination behavior into false availability.

**How to apply:** For bounded calendar searches, return the complete window, cap per day with explicit truncation metadata, or expose day summaries separately. Never let the client treat an omitted date as unavailable when an earlier global limit may have stopped evaluation.