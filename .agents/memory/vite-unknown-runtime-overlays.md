---
name: Vite unknown runtime overlays
description: Diagnosing Replit Vite overlays that report only an unknown runtime error.
---

The Replit Vite runtime-error plugin can convert a browser `error` event whose `error` property is absent into an `(unknown runtime error)` overlay. Treat that message as evidence of an error event, not by itself as evidence of an application exception.

**Why:** During real browser coverage, the overlay recurred without a JavaScript exception, failed request, resource element, broken application state, or reproducible application trigger. Feature behavior still passed after direct state and API verification.

**How to apply:** Before editing application code, capture `window` error-event target/source fields, unhandled rejections, browser page errors, and failed network requests. Fix the app only when those signals identify a concrete source or the overlay changes observable behavior.