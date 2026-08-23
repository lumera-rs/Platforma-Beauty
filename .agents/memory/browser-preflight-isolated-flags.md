---
name: Browser preflight isolated flags
description: The shared Playwright preflight must skip every isolated suite env flag; new isolated suites must be added to its skip list.
---

The shared Playwright config runs a globalSetup preflight that probes the live dev servers (web at localhost:80, API via /api/healthz through the proxy) and fails fast with a clear "start the workflows" message.

**Why:** Stopped dev workflows otherwise surface as opaque 502/net::ERR failures inside every spec, which look like app or test bugs and waste full runs.

**How to apply:** The preflight skips itself when any LUMERA_ISOLATED_* env flag is "1" because those suites provision their own harness servers. When adding a new isolated suite (new LUMERA_ISOLATED_* flag in playwright.config.ts), also add the flag to the preflight's skip list — otherwise the new suite will wrongly probe localhost:80.
