---
name: Browser storage stub isolation
description: CI-like browser media checks in Replit can require a separate stub port and browser-compatible signed URLs.
---

Removing storage configuration from a test process does not stop Replit's local App Storage sidecar from listening. In that situation, a CI-like run must route only disposable test servers to a separate in-memory stub; otherwise it can accidentally contact real storage or fail to sign uploads. Direct browser PUTs to a stub-issued signed URL require cross-origin preflight support, unlike Node-only API checks.

**Why:** A storage-free browser run in this workspace still found the real sidecar port occupied. Its first stub-backed run signed a local upload but Chromium never sent the PUT because the stub did not answer preflight requests.

**How to apply:** When validating upload fixtures without storage configuration, prove the signing and upload URL point to the stub's own port, keep the production sidecar untouched, and exercise the visible browser upload through finalize. A normal configured run should not start the stub.