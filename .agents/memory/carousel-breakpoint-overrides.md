---
name: Carousel breakpoint overrides
description: How shared carousel slide-width defaults interact with page-specific responsive layouts.
---

When a page needs a shared discovery rail to remain scrollable at a large viewport, its slide-width override must cover every breakpoint that the shared component defines, including `xl`. Otherwise the shared `xl` basis can silently make all available slides fit and disable navigation.

**Why:** A page-specific medium-width rule can look correct on mobile yet be superseded by a shared large-screen utility, leaving desktop arrows disabled even though the page intends a carousel.

**How to apply:** Inspect the shared rail's default breakpoint classes before selecting a page-specific `itemClassName`; explicitly override each larger breakpoint only where horizontal overflow is a deliberate design requirement.