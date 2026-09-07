---
name: Request-scoped SQL observation
description: Why parallel test query captures need an explicit bridge across in-process HTTP requests.
---

AsyncLocalStorage safely separates concurrent SQL observers inside one async call chain, but it does not reliably carry the caller's context through a loopback HTTP connection into the server request handler.

**Why:** Undici connection reuse and the server's independently created async resources can either lose or inherit stale caller context. An interval-wide global observer also captures unrelated background work.

**How to apply:** Give each capture a random ID registered only in the current process, send it in a test request header, and bind the matching observer at the first server middleware. Ignore unknown IDs and remove registrations when the controlled operation finishes.