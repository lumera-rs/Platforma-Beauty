---
name: Webhook registration verification
description: Provider-side webhook registration checks — comparison rules and error surfacing.
---

The loopback webhook self-check proves the app's own endpoint accepts the saved secret; only a provider-side listing (Brevo GET /v3/webhooks?type=transactional) can prove the webhook is actually registered — right domain, current secret, not deleted at the provider.

**Rules:**
- Secret comparison happens server-side and timing-safe; tokens found at the provider are never echoed — report only masked URLs (`<origin>/api/webhooks/<provider>/…`).
- Classify mismatches separately (secret matches but wrong origin, origin matches but stale secret, neither, none registered) so the admin instruction says exactly what to re-register.
- Brevo answers 404 when no transactional webhook exists — treat as an empty list, not a provider failure.
- Distinguish local configuration errors (integration disabled, missing secret) from provider failures with a typed error, or the user sees a local instruction wrapped inside a misleading "provider API failed" message. String-prefix checks are fragile — the local Serbian message also started with "Brevo".

- One-click repair (Brevo POST/PUT /v3/webhooks) must update the best-matching existing registration in place instead of creating duplicates — prefer same-origin (stale-secret case), then matching-secret (stale-domain case), then any app-format leftover — and always re-subscribe the full consumed event set.
- After a repair write, re-run the verdict against a FRESH provider listing so the reported outcome reflects what the provider actually stored, not what was requested; a successful write with a failed re-check is reported as an error, not success.

**Why:** a stale secret or wrong-domain registration at the provider is silent — sends succeed, delivery reports simply never arrive.

**How to apply:** any admin-facing check that compares locally saved credentials against provider-side registrations.
