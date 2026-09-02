---
name: Grouped CAMT transaction identity
description: Safe identity and amount rules when a CAMT bank entry contains multiple transaction details.
---

When one CAMT entry contains multiple transaction details, resolve the stable identifier and amount independently inside each detail. Never inherit an entry-level service reference or aggregate amount across all details. If an individual detail lacks either value, reject it rather than guessing.

**Why:** A shared batch identifier collapses distinct payments at the idempotency boundary, while copying an aggregate amount can settle the wrong obligation.

**How to apply:** This rule applies to CAMT parsers, bank API adapters, fixtures, and any future import format that groups multiple payments under one statement entry.