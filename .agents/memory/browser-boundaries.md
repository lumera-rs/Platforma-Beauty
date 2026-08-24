---
name: Browser test portal boundaries
description: Keep browser tests reliable when UI overlays render outside their triggers
---

**Rule:** Browser test locators must follow the DOM boundary where users can actually interact with portalled overlays, not an assumed trigger subtree.

**Why:** UI libraries can render an open popover outside its trigger’s DOM subtree, making a narrowly scoped locator time out even while the interaction works.

**How to apply:** Scope triggers to their owning control, but locate open overlay content from a page-level boundary.