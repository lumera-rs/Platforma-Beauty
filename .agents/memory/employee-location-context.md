---
name: Employee location context
description: Defines the canonical location source for multi-location employee operations.
---

All employee-facing operational and B2B commerce flows must resolve the employee’s location from the same active assignment: prefer the active default assignment, then a deterministic active fallback, and deny access when none exists. Never authorize or scope current work through the legacy employee profile salon.

**Why:** Splitting portal/approval context from cart and checkout context can make one employee act in two different locations during the same workflow, exposing or mutating the wrong location’s data.

**How to apply:** Reuse one assignment resolver for employee portal, widget, cart, checkout, approval, clock, and shift flows. Browser fixtures for owner employee actions must create an active default assignment and set the owner’s active salon; a legacy `employees.salonId` row alone is insufficient. When adding an employee-scoped endpoint, test default-location changes and the no-active-assignment denial path.