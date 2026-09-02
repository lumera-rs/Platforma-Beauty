---
name: Calendar date validation
description: Why YYYY-MM-DD query params need a round-trip check, not just Date parsing
---

**Rule:** Validate the original raw `YYYY-MM-DD` string before any schema coercion. Regex + `new Date(...)` + `isNaN` is not enough: V8 silently rolls impossible dates forward, and date coercion destroys the evidence needed to reject them. Round-trip the parsed date back to `YYYY-MM-DD` (`date.toISOString().slice(0, 10) === raw`) and reject on mismatch.

**Why:** A stats date-range feature promised explicit 400s for invalid input; the naive `isNaN` check let `2026-02-30` through as a silently shifted date, which a regression test caught.

**How to apply:** Every sibling endpoint accepting date-only strings (from/to filters, birth dates, scheduling, grouped items, reschedules, and widget/manual variants) must inspect the raw request value before using a coerced result. Add route-level tests for every duplicated write/read surface. Also treat inclusive `to` dates as exclusive `to + 1 day` when comparing against timestamps.
