---
name: Orval and Zod compatibility
description: Compatibility constraints when regenerating the shared OpenAPI client in this workspace.
---

The workspace uses Zod v3 while the installed Orval release can emit Zod v4-only helpers for OpenAPI `integer`, `email` format, and unspecified object shapes. Keep shared schemas expressed with `number` and explicit object properties when regenerating, or update the dependency set together rather than only the spec.

**Why:** Generated Zod output otherwise fails the shared typecheck before the frontend or API can build.

**How to apply:** After every OpenAPI regeneration, run the library typecheck. The generated API Zod barrel must export runtime validation schemas without duplicate parameter-type exports; preserve that arrangement if Orval rewrites the barrel.