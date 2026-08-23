---
name: Stale provider webhook cleanup
description: Safety rules for deleting leftover webhook registrations at an email/SMS provider (Brevo-style) from an admin action.
---

# Stale provider webhook cleanup

Rule: a destructive cleanup of provider-side webhook registrations must never trust client-submitted ids. Re-list the provider's webhooks fresh at deletion time and delete only ids that the fresh listing still classifies as stale app-format registrations. Ids pointing at the current healthy registration, non-app-format webhooks, or unknown ids are silently skipped (and reported as skipped), never deleted.

Additionally, both the stale-duplicate listing and the deletion must be suppressed/refused from a development/preview browsing origin.

For a read-only stale-list refresh, apply the development-origin guard before resolving local credentials or contacting the provider, and return an empty list immediately.

**Why:** the development environment's saved webhook secret can differ from production's, so from a dev origin a perfectly healthy PRODUCTION registration reads as "secret doesn't match" and would be classified stale — offering it for deletion would break production delivery reports. Preview environments may also have no local provider credentials at all; resolving them before the guard turns a safe empty refresh into a misleading configuration error. Client-supplied ids can also go stale between the repair that listed them and the deletion click (another admin may have re-registered), so only a fresh server-side classification is authoritative.

**How to apply:** any admin "remove leftover registrations" action against a provider API (Brevo transactional webhooks, similar delivery-report webhooks): derive the deletable set server-side per request, intersect with the requested ids, treat provider 404 on DELETE as success (idempotent retries), report partial failures with masked URLs only, and gate the whole action on a non-development browsing origin. Note app-format-only filtering is still not tenant-proof: a second deployment of the same app (staging) also uses the app's URL format with a different domain/secret and would classify as stale — prefer per-item admin confirmation over delete-all.
