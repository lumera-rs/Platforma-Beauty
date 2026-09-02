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

- Verdicts are relative to the admin's browsing origin. From a development/preview address (dev-domain env match, `.replit.dev`, localhost) a healthy PRODUCTION registration looks like "wrong domain" — soften: treat a current-secret registration at another origin as the likely production one (still check its event subscription), qualify every failure as relative to the browsing address, and never emit an instruction containing the dev URL (use a published-domain placeholder). Copy-URL helpers built from the request origin need the same warning. In production, accept every public domain of the deployment (deployment-domains env var), not just the request origin.
- Repair writes must update the best-matching existing provider registration rather than create duplicates — prefer same-origin (stale-secret case), then matching-secret (stale-domain case), then any app-format leftover — always re-subscribe the full consumed event set, and the reported verdict must come from a fresh provider listing taken after the write: a successful write with a failed re-check is an error, not success.

**Testing:** to exercise origin-dependent verdicts, spoof the Host header per request — fetch() forbids setting Host (forbidden header), so use node:http directly. The app intentionally ignores forwarded headers outside deployments, so an isolated test that simulates the Replit edge must explicitly enable one trusted proxy hop before sending `X-Forwarded-Proto`; otherwise HTTPS expectations silently become HTTP. Live provider APIs can't run in tests. Provider calls route through the Replit connector proxy unless an apiKey resolves — set the env apiKey fallback so the direct-fetch path is taken, then stub `globalThis.fetch` for the provider host (pass everything else through) to simulate listings, both response shapes, 404-empty, and error statuses end-to-end through the real route. Exercising the "integration disabled" branch needs the shared enabled flag briefly toggled — snapshot the settings rows first and restore the exact prior state in `finally`.

**Why:** a stale secret or wrong-domain registration at the provider is silent — sends succeed, delivery reports simply never arrive.

**How to apply:** any admin-facing check that compares locally saved credentials against provider-side registrations.
