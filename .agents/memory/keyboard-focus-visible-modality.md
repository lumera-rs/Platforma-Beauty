---
name: Keyboard focus-visible modality
description: Browser-test guidance for focus indicators after pointer interactions.
---

After a pointer action opens a disclosure, establish keyboard modality with a keyboard event before programmatically focusing a control whose `:focus-visible` styles are being asserted.

**Why:** Chromium can keep pointer modality after a click, so `locator.focus()` may focus the element without activating `:focus-visible`; the application’s keyboard focus ring is then incorrectly reported as missing.

**How to apply:** In browser tests, press `Tab` (or open the disclosure through keyboard activation) after the pointer-only setup and before checking computed outline or box-shadow geometry.