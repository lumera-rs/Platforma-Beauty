---
name: Calendar date validation
description: Why YYYY-MM-DD query params need a round-trip check, not just Date parsing
---

**Rule:** When validating a `YYYY-MM-DD` string server-side, regex + `new Date(...)` + `isNaN` is not enough. V8 silently rolls over impossible calendar dates in ISO strings (e.g. `2026-02-30T00:00:00.000Z` parses to March 2, not Invalid Date). Round-trip the parsed date back to `YYYY-MM-DD` (`date.toISOString().slice(0, 10) === raw`) and reject on mismatch.

**Why:** A stats date-range feature promised explicit 400s for invalid input; the naive `isNaN` check let `2026-02-30` through as a silently shifted date, which a regression test caught.

**How to apply:** Any endpoint accepting date-only strings (from/to filters, birth dates, scheduling) should use a round-trip comparison. Also treat inclusive `to` dates as exclusive `to + 1 day` when comparing against timestamps.
