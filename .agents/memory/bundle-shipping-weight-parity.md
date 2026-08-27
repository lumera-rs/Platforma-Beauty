---
name: Bundle shipping weight parity
description: Keep shipping quotes consistent when bundle lines derive inventory and weight from component products.
---

Preview and final checkout must calculate each bundle unit's shipping weight as the sum of component quantity times component product weight.

**Why:** A cart DTO may historically expose a bundle line weight of zero while final checkout correctly reloads component weights under lock. Reusing the public DTO total for preview then creates a stale-quote conflict even when merchandise pricing is unchanged.

**How to apply:** Use the same component-derived weight semantics before both shipping calculations. If the public cart contract must stay stable, carry the accurate preview weight through an internal-only result and strip it before serialization; keep final component resolution and locking authoritative.