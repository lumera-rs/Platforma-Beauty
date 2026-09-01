---
name: Payment account environments
description: Safety boundary between real recipient bank accounts and non-production payment instructions.
---

Every recipient account must be explicitly classified as `production` or `test`; never infer that classification from the runtime where an administrator entered it.

**Why:** Treating the current development runtime as proof that a configured account is a test account can expose a real production account through development, test, or staging payment instructions.

**How to apply:** Permit a production-marked account only when independent deployment and environment signals confirm a published production runtime. Default ambiguous or legacy accounts to production-safe blocking outside production. Payment documents and QR payloads must keep the snapshot captured when the obligation was issued.