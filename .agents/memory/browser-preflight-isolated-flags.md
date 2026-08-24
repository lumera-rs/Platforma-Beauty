---
name: Browser preflight isolated flags
description: The shared Playwright preflight must skip every isolated suite env flag; new isolated suites must be added to its skip list.
---

The shared Playwright config runs a globalSetup preflight that probes the live dev servers (web at localhost:80, API via /api/healthz through the proxy) and fails fast with a clear "start the workflows" message.

**Why:** Stopped dev workflows otherwise surface as opaque 502/net::ERR failures inside every spec, which look like app or test bugs and waste full runs.

**How to apply:** An isolated suite must register both its preflight bypass and the identity of its disposable resources with the shared harness. Otherwise the suite can be rejected before its own locally provisioned services start.
