---
name: Employee schedule weekdays
description: Records the non-obvious weekday numbering required by employee location schedules and availability fixtures.
---

Employee location schedules use ISO weekday numbers from 1 (Monday) through 7 (Sunday), not JavaScript's zero-based 0–6 convention.

**Why:** A zero-based fixture can appear partly valid but leave Sunday unmatched, causing canonical availability to fall back to salon hours and making two intentionally different location schedules look identical.

**How to apply:** When seeding or importing employee location schedules, map weekdays to 1–7 and include day 7 explicitly when a seven-day availability window must be deterministic.