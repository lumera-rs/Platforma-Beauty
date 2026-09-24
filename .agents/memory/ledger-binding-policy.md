---
name: Ledger binding policy
description: Operator-approved boundary between legacy binding and copied-branch recovery.
---

Binding legacy unbound migration rows must never become a way to rebind rows
copied from a different database or Neon branch. Recovery for already-bound
copies is a separately authorized future procedure.

**Why:** The owner explicitly chose strict no-rebind when the requested copied-
branch recovery behavior conflicted with refusing all mismatched bindings.
An operator's binding of legacy history is an attestation, not evidence that
the migrations executed on that database.

**How to apply:** Keep the legacy bind command fail-closed on foreign or partial
bindings. Do not add reset/rebind flags as an incidental convenience. Document
that retaining a Neon branch ID across a restore differs from creating a new
branch, whose copied binding remains foreign.