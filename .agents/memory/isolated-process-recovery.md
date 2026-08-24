---
name: Isolated process recovery
description: Safe cleanup of detached child processes left by a force-stopped isolated test run.
---

Persist one opaque, per-run environment marker with the run’s durable recovery record and apply it only to child commands. After confirming the original owner PID identity is stale, enumerate marker-carrying processes and stop their complete process groups.

**Why:** The owner can be killed while detached API or shell descendants survive. A database or filename alone cannot distinguish those descendants from unrelated local services, and some foreign `/proc` entries are intentionally unreadable.

**How to apply:** Keep the owner-identity guard before any process scan, match an exact null-delimited environment entry, terminate only the discovered groups, and treat `ENOENT`, `EACCES`, and `EPERM` while scanning foreign `/proc` entries as non-matches rather than cleanup failures.