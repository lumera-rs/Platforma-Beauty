---
name: Integration configuration security
description: Security rules for database-managed provider settings.
---

Database-backed integration credentials must be encrypted with a required deployment-held secret; never add a source-visible fallback encryption key.

**Why:** A deterministic fallback turns database access into direct credential recovery.

**How to apply:** Fail closed when the encryption secret is absent, and ensure every process that reads these settings receives the same secret.

Provider endpoint configuration that carries credentials must be limited to approved HTTPS origins and must not follow redirects.

**Why:** An arbitrary configurable endpoint can be used to exfiltrate an API credential or reach internal services.

**How to apply:** Validate configured provider URLs at save time and immediately before use; allow only the provider's documented domains.