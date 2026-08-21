---
name: Browser test runtime
description: Requirements for running the repository's Playwright browser checks in this Nix-based workspace.
---

Repository Playwright checks need Chromium's Nix runtime libraries and must launch Replit's managed Chromium through the `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` environment variable.

**Why:** The Playwright package's expected downloaded browser can be absent or at a different revision, causing launch to fail before opening a page even when the application is healthy. Replit provides a compatible browser path and its runtime libraries through the Nix environment.

**How to apply:** Keep the Chromium-compatible Nix package set available, configure Playwright to use the managed executable when the environment variable is set, and run the project’s named browser-test command against the active artifact services. Treat a launch failure as an environment dependency check before investigating UI behavior.