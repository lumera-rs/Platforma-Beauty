---
name: SSR API response shape parity
description: Prevents server-rendered pages from silently emptying when hand-written fetch code and fixtures assume the wrong API envelope.
---

Server-rendered fetch code must consume the exact published API response shape, and its tests must mock that same shape rather than a convenient local wrapper.

**Why:** Typechecks do not protect untyped SSR fetches. A renderer expecting `{ items }` can silently produce empty pages when the real endpoint returns a bare array, while a matching but incorrect test fixture hides the production failure.

**How to apply:** Derive SSR fixtures from the OpenAPI/generated contract, guard the expected runtime shape, and assert that a returned record appears in rendered HTML—not only that metadata and request filters are correct.