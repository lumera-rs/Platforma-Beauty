---
name: Booking calendar mobile sizing
description: Responsive sizing rules for the client booking calendar inside its mobile sheet.
---

When customizing DayPicker class names for the booking sheet, replacement values must include the complete layout primitives for months, weeks, weekdays, days, navigation, and caption—not only incremental utility classes. Size booking day cells from the narrowest viewport upward, then increase only at breakpoints that have been browser-verified. The card and its scrollable body must both opt into `min-height: 0` so the booking content scrolls above its action footer instead of extending behind it.

**Why:** DayPicker treats supplied class names as replacements; a partial override can remove the width and flex rules that distribute seven days, collapsing date targets even when the outer calendar appears contained. Flex children default to an intrinsic minimum height, which can let the date-and-slots section paint under a sibling footer on short mobile sheets.

**How to apply:** Validate actual button dimensions alongside overflow and stacking at 320px, 375px, and 414px whenever booking-calendar layout classes change. Also test short viewports and verify the date-step body scrolls independently until all slots are visible above the footer.