---
name: Disposable browser origins
description: Preserve production origin validation while removing ambient workspace dependencies from browser proofs.
---

Disposable browser servers must own their public URL instead of inheriting a workspace domain. Preserve the application's HTTPS-origin requirements with an actual test-local HTTPS endpoint, and scope API-only configuration to the API child.

**Why:** Replacing an ambient public URL with plain HTTP caused two distinct failures: Vite rejected it at startup when inherited by the frontend, and Beauty Poslovi email creation rejected it even after the setting was limited to the API. Merely supplying a nonempty URL did not satisfy the application contract.

**How to apply:** Validate generated test configuration against all consumers, keep TLS trust local to tests, and prove complete release chains with application environment settings absent as well as present. When making a stripped tool PATH on Nix, preserve executable basenames for multicall utilities and installation prefixes for PostgreSQL; broken tool shims are setup failures, not application regressions.