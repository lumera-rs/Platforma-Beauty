---
name: Browser test runtime
description: Requirements for running the repository's Playwright browser checks in this Nix-based workspace.
---

Repository Playwright checks need Chromium's Nix runtime libraries and must launch Replit's managed Chromium through the `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` environment variable.

**Why:** The Playwright package's expected downloaded browser can be absent or at a different revision, causing launch to fail before opening a page even when the application is healthy. Replit provides a compatible browser path and its runtime libraries through the Nix environment.

**How to apply:** Keep the Chromium-compatible Nix package set available, configure Playwright to use the managed executable when the environment variable is set, and run the project’s named browser-test command against the active artifact services. Treat a launch failure as an environment dependency check before investigating UI behavior. If a newly added Playwright script fails before startup with a non-executable shim, invoke the installed `@playwright/test` CLI through Node in that script.

## Live-service dependency

The shared (non-isolated) browser specs run against the live artifact workflows at the default base URL; a stopped workflow surfaces as HTTP 502 / `ERR_HTTP_RESPONSE_CODE_FAILURE` on the first navigation or login request.

**Why:** The Playwright config only spins up a harness frontend for the isolated suites; every other spec assumes the web and API dev workflows are already serving.

**How to apply:** Before running or debugging a shared browser spec, confirm the web and API workflows respond (a quick HTTP check), and restart them rather than reading a 502-driven failure as a test or application bug.

## Forced-interruption probes

Do not assume the PID returned when launching a package binary such as `tsx` is the application process’s own PID.

**Why:** Package shims and TypeScript launchers can introduce shell or Node wrapper processes, so killing the launcher may miss the process that owns a disposable resource.

**How to apply:** Discover the owner from the resource’s durable run marker or inspect the process tree, then isolate and terminate the complete test process group before checking recovery.