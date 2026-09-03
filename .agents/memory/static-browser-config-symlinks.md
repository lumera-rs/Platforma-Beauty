---
name: Static browser config symlinks
description: Trust-boundary and relative-path rules for symlinked package exports consumed by browser config checks.
---

Package export targets used by the static browser-config resolver must be validated against the package's canonical filesystem root and consumed through the validated canonical target. Imported `testDir` values still follow the resolver's runner-config-relative semantics rather than the physical target file's directory.

**Why:** Canonical validation closes package escapes through symlinks, while tests that assume physical-file-relative `testDir` semantics give misleading compatibility failures.

**How to apply:** When changing package-entry or symlink handling, cover both an escaping target and a safe in-package target, and keep the safe fixture's `testDir` relative to the top-level runner config.