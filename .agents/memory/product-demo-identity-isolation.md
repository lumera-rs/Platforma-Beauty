---
name: Product demo identity isolation
description: Protect live-test demo identities from temporary authorization-fixture mutations.
---

Product-facing demo accounts are invariants, not reusable test fixtures. Authorization regressions must create a unique marker-owned identity, fail safely on marker collision, and delete only the exact user ID they created.

**Why:** A failed or interrupted authorization run can otherwise leave a live-test account with the wrong role, while email-only cleanup can delete another concurrent run's identity.

**How to apply:** Any regression needing a temporary privileged user should insert its own identity, trap ordinary interruption signals, verify exact-ID cleanup, and separately assert that canonical demo identities retain their role, active state, and ownership links.