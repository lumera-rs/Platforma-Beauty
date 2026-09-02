---
name: Business relation mutation locks
description: Lock ordering for concurrent account, ownership, employment, and education-relation changes.
---

Mutations that create, transfer, deactivate, retain, or unlink business relations must share one global lock order: business resources first, then every participating account in deterministic order, then legal-entity closure, then row locks. Read-only planning endpoints should use a coherent snapshot without competing row locks.

**Why:** Account setup, role conversion, and ownership transfer can otherwise lock the same owner and salon or education center in opposite order, causing deadlocks. Partial transfers can also split one legal entity across account owners unless its full binding closure is locked and validated.

**How to apply:** Any new write path involving salons, education centers, employees, instructors, ownership, or legal-entity bindings must join the shared protocol. Validate the resulting owner of every affected legal-entity binding as one atomic transaction.