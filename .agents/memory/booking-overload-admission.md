---
name: Booking overload admission
description: How booking response-time objectives interact with shared admission limits and route coverage.
---

Treat every externally reachable booking allocation or reallocation route as one process-wide workload. When the fixed database budget cannot keep all arrivals below the response-time objective, measure the admission level required across the complete arrival set, but do not enable rejection by default without an approved rejection budget and client retry policy.

**Why:** Query reductions alone may not overcome a saturated database pool, and a guard on only one route is bypassable by other appointment, group, package, series, or widget creators.

**How to apply:** New booking creators, reschedules, and moves must use the shared admission boundary. Keep it disabled by default unless product/SLO approval defines acceptable rejection and retry behavior. Re-run the disposable multi-process profile when topology or transaction shape changes.