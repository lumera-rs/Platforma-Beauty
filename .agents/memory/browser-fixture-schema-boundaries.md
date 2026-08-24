---
name: Browser fixture schema boundaries
description: Keep shared browser fixture builders schema-validated without violating the scripts package TypeScript source boundary.
---

Shared browser-fixture helpers in the scripts package should accept the generated response schema from their consuming spec instead of importing generated source directly.

**Why:** The scripts package compiles only its own source directory, so a direct import of generated API source fails the package typecheck even though browser specs can consume that schema.

**How to apply:** Keep the shared payload and endpoint-specific validation in the helper, and pass the generated schema from each browser spec when building the fixture.