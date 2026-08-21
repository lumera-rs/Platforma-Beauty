---
name: Booking calendar mobile sizing
description: Responsive sizing rules for the client booking calendar inside its mobile sheet.
---

When customizing DayPicker class names for the booking sheet, replacement values must include the complete layout primitives for months, weeks, weekdays, days, navigation, and caption—not only incremental utility classes. Size booking day cells from the narrowest viewport upward, then increase only at breakpoints that have been browser-verified.

**Why:** DayPicker treats supplied class names as replacements; a partial override can remove the width and flex rules that distribute seven days, collapsing date targets even when the outer calendar appears contained.

**How to apply:** Validate actual button dimensions alongside overflow and stacking at 320px, 375px, and 414px whenever booking-calendar layout classes change.