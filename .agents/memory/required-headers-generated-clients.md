---
name: Required headers in generated clients
description: Why OpenAPI-required headers need explicit typed wrappers when generated calls use the shared custom transport.
---

An OpenAPI header marked `required: true` produces documentation and validation schemas, but the current Orval custom-transport client exposes headers only through optional request options. For command endpoints, provide a typed wrapper whose input requires the header value and injects it into the request.

**Why:** A generated mutation can otherwise compile and run without the required header even though the server correctly rejects it. Transport-level automatic insertion is useful defense in depth but does not make the client contract explicit.

**How to apply:** Whenever adding a required command header to OpenAPI, verify the generated function signature. If the header remains hidden in optional request options, expose and use a typed wrapper, then test both header transmission and retry-key reuse.