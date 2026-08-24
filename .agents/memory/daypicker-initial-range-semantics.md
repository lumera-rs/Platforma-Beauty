---
name: DayPicker initial range semantics
description: How DayPicker range mode represents the first date click and how picker flows should preserve two-date selection.
---

DayPicker range mode can report the first clicked day as both the start and end of a range. When the product’s calendar is intended to collect a start and a distinct end date in one open picker, treat that initial same-day value as an in-progress start rather than a completed range.

**Why:** Closing or serializing immediately makes a normal two-date selection behave like a one-day window and forces an unexpected reopen between the two clicks.

**How to apply:** Normalize the same-day initial event only when there was no prior range; let a second click on that same date complete a deliberately one-day range, and let a different second click complete the multi-day range.