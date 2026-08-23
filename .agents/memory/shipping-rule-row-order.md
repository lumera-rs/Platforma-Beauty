---
name: Shipping rule row order
description: Legacy duplicate shipping settings must not change the configuration shown to admins or applied at checkout.
---

Shipping settings are a legacy singleton. When legacy duplicates exist, their canonical identity must be immutable so normal configuration edits cannot change which rule checkout applies.

**Why:** Physical row order is not stable, and `updated_at` changes during ordinary configuration edits. Either can cause a legacy duplicate to unexpectedly become the rule that customers receive.

**How to apply:** Use one shared selector for every shipping read, ordered only by a stable, immutable identity. Never use physical storage order or a mutable timestamp to decide which legacy row is canonical.
