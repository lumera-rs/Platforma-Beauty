---
name: Independent target declarations
description: Operator usability is part of wrong-target identity safety.
---

Prefer target identifiers operators can approve from an independently authenticated control plane. A same-connection observation is suitable for regression fixtures, not for approving the expected identity.

**Why:** A discriminator can distinguish two live databases perfectly yet defeat the operational safeguard if its expected value is obtainable only by querying the candidate database. Restore stability also matters: storage identity and operator-visible resource identity need not have the same lifecycle.

**How to apply:** When choosing or changing target identity evidence, verify its independent acquisition path and restore semantics alongside mismatch tests. Do not promote successful self-observation tests into proof of independent operator approval.