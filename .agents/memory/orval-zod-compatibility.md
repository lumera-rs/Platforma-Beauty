---
name: Orval and Zod compatibility
description: Compatibility constraints when regenerating the shared OpenAPI client in this workspace.
---

The workspace uses Zod v3 while the installed Orval release can emit Zod v4-only helpers for OpenAPI `integer`, `email`, `uri`, and `uuid` formats, plus unspecified object shapes. Keep shared schemas expressed with `number`, explicit object properties, and UUID `pattern` expressions when regenerating, or update the dependency set together rather than only the spec.

**Why:** Generated Zod output otherwise fails the shared typecheck before the frontend or API can build.

**How to apply:** After every OpenAPI regeneration, run the library typecheck. The generated API Zod barrel must export runtime validation schemas without duplicate parameter-type exports; preserve that arrangement if Orval rewrites the barrel. Concretely: never add `format: uuid` to the spec (it emits `zod.uuid()`, a Zod v4-only call) — the spec convention is plain `type: string` ids and `type: ["string","null"]` for nullable fields instead of `nullable: true`; also keep the generator compatibility rewrite for URI formats (`zod.url()` → `zod.string().url()`), and quote flow-style descriptions containing commas.

OpenAPI `format: date` schemas currently generate `zod.coerce.date()`. Using a parsed response object directly in `res.json()` therefore serializes date-only values as ISO timestamps, despite the contract declaring a `YYYY-MM-DD` date.

**Why:** Date-only appointment payloads are consumed alongside availability and booking draft values. Timestamp serialization can create inconsistent comparisons and client display behavior.

**How to apply:** Keep Zod response parsing as validation, but return the normalized date-only view object rather than the parser's coerced output. Add an HTTP assertion for the wire-format date when touching an affected response.