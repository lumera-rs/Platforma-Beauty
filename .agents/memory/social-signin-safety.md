---
name: Social sign-in safety
 description: Rules for safely removing and adding OAuth sign-in methods.
---

Treat local-password availability as explicit account state, not as the presence of a password hash.

**Why:** OAuth-created accounts receive an unguessable internal hash to satisfy the existing credential field. Treating that hash as a recovery method could let someone disconnect their only real sign-in and lose access.

**How to apply:** A provider can be removed only when an explicitly configured password or another connected provider remains. For pre-existing accounts where local-password availability cannot be established safely, prefer the conservative no-removal result.

Provider-linking callbacks must be bound to the account that initiated the authorization and must never turn into an ordinary sign-in.

**Why:** A browser state token alone does not prove which signed-in account authorized a backup method. Reusing normal OAuth login behavior can switch the session or attach an identity to the wrong account.

**How to apply:** Persist the initiating account in the short-lived, one-time OAuth state and verify the active callback session still belongs to that account. Reject identities owned by another account and do not reassign them.