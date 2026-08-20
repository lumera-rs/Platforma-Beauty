---
name: Social sign-in safety
description: Rules for deciding whether an account can safely remove a connected OAuth provider.
---

Treat local-password availability as explicit account state, not as the presence of a password hash.

**Why:** OAuth-created accounts receive an unguessable internal hash to satisfy the existing credential field. Treating that hash as a recovery method could let someone disconnect their only real sign-in and lose access.

**How to apply:** A provider can be removed only when an explicitly configured password or another connected provider remains. For pre-existing accounts where local-password availability cannot be established safely, prefer the conservative no-removal result.