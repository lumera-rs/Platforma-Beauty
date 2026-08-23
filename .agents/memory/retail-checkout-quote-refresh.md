---
name: Retail checkout quote refresh
description: The contract for safely refreshing a stale retail checkout quote after a confirmation conflict.
---

Checkout preview and confirmation conflicts caused by a changed price, delivery amount, or availability must use the same stable machine-readable code.

**Why:** A message-only 409 makes the shopper client guess which failure is safe to recover from. Refreshing only a price mismatch leaves shoppers manually reloading after a stock or delivery change, while treating unrelated conflicts as refreshable can hide a real error.

**How to apply:** When changing retail checkout validation, keep the shared conflict code on both the preview and confirmation paths for quote-derived conflicts. The client must clear the old preview, fetch the current cart and destination-specific preview, and keep confirmation disabled until the new preview is available. Browser regressions should deliberately hold the refreshed preview request before asserting the disabled state.