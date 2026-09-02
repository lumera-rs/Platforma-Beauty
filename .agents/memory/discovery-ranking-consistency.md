---
name: Discovery ranking consistency
description: Keep public marketplace shelves and their corresponding directory results semantically identical.
---

Public discovery shelves must use the same underlying filter, date window, and sort definition as their “see all” destination. A shelf ranked by recent bookings cannot lead to a lifetime-popularity sort, and an explicitly featured shelf cannot lead to a different designation.

**Why:** A visually plausible directory can still silently contradict the collection a customer selected, eroding trust in marketplace discovery.

**How to apply:** When adding or changing a public shelf, expose a matching, validated directory query and ensure URL hydration forwards that query to the API. Rank booking-based shelves with a bounded recent window, exclude cancelled appointments, and keep the discovery response data volume bounded and cacheable.