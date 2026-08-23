---
name: Integration settings marker rows
description: Metadata timestamp rows stored in integration_settings must never count as configuration.
---

Rule: state markers persisted alongside integration settings (e.g. webhook "secret changed at" / "re-confirmed at" timestamps) live in the same encrypted `integration_settings` key/value table, but they are metadata, not configuration. `integrationSettings()` must filter them out of `values` and out of the `configuredInDatabase` determination.

**Why:** `configuredInDatabase: true` flips an integration from env-fallback to database-driven display/enabled semantics. A marker written for an env-configured integration (e.g. after a webhook self-check) would otherwise silently change how the integration is resolved and displayed, and marker keys would leak into generic value consumers.

**How to apply:** when adding a new marker key, add it to the marker-key set in the integrations lib so it stays excluded; never accept marker keys through the admin PUT (they are not in the integration definitions' `keys`). Reminder semantics: pending = changedAt exists and verifiedAt is absent or older; a tie (same ms) counts as confirmed.
