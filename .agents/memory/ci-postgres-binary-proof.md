---
name: CI PostgreSQL binary proof
description: Distinguish clean environment tests from proof of GitHub PostgreSQL binary discovery.
---

A clean environment with CI=true is not sufficient evidence of GitHub-compatible PostgreSQL discovery. Verify that command lookup cannot find initdb on the test PATH and supply the installation only through LUMERA_POSTGRES_16_BIN.

**Why:** Replit's default PATH exposed PostgreSQL binaries and concealed a CI failure even when the local process had otherwise matching environment settings.

**How to apply:** Report the actual binary-absence probe alongside relevant results. Preserve intentional fake-command injection in lifecycle tests when switching subprocesses to explicit binary paths; bypassing those shims invalidates their recovery proofs.