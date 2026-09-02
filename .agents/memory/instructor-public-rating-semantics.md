---
name: Instructor public rating semantics
description: Defines the durable source and aggregation rule for ratings shown on public instructor profiles.
---

Public instructor ratings come from published reviews attached to that instructor's currently eligible public courses. Calculate one weighted average across the underlying reviews and expose the total published review count; do not average per-course averages.

**Why:** A simple mean of course averages gives a course with one review the same influence as a course with many reviews, and stored course rating fields can include stale or non-public semantics.

**How to apply:** Any instructor card, profile, structured data, or ranking that shows an instructor rating must use this published-public-course review set and state that source clearly to users.