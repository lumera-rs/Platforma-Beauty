---
name: Browser test runtime
description: Requirements for running the repository's Playwright browser checks in this Nix-based workspace.
---

Repository Playwright checks need Chromium's Nix runtime libraries to be declared in the project environment as well as the downloaded Playwright browser.

**Why:** The browser binary can download successfully yet fail before opening a page when shared libraries such as GLib, GBM, or XKB are absent. That creates a misleading test-runner failure even when the application is healthy.

**How to apply:** When adding or updating browser coverage, keep the Chromium-compatible Nix package set available and run the project’s named browser-test command against the active artifact services. Treat a launch failure as an environment dependency check before investigating UI behavior.