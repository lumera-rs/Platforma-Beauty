---
name: Education trial identity claims
description: Durable identity and compatibility rules for preventing repeat Education trials.
---

Education trial evidence is append-only: normalized email, phone, PIB, company registration number, and bank account are represented only by hashes in the durable claim registry, and deleting a user or center must not delete the claim.

**Why:** A deleted or newly registered account must not reset trial eligibility, while established registration compatibility allows the business account to be created without granting a second trial.

**How to apply:** Every path that can issue an Education trial must attempt the identity claim atomically with subscription creation under unique database constraints. A collision may continue as a non-trial, payment-due subscription, but must never grant trial access.