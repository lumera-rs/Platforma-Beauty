---
name: Hosted pool timeout evidence
description: Avoid false-positive timeout proofs when hosted PostgreSQL ignores startup parameters.
---

Treat accepted connection startup options as unproven until server state and actual cancellation are observed. Client initialization must be awaited before checkout, not merely launched from an asynchronous connection event.

**Why:** Neon accepted the statement-timeout startup option without applying it. Disposable PostgreSQL did apply it, which could hide a missing explicit initializer in local tests.

**How to apply:** Verify several simultaneously held fresh clients through the actual application pool. Do not retain a startup fallback that masks a removed initializer; mutate the actual pool callback wiring and require the disposable proof to fail. Validate URL host precedence against the installed driver, including duplicate query keys, rather than assuming URL.searchParams.get matches it.