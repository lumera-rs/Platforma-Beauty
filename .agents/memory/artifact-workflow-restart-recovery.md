---
name: Artifact workflow restart recovery
description: Explains how to recover a managed artifact workflow restart when a previous process still owns its port.
---

When a managed artifact workflow restart fails with an address-in-use error, confirm whether the existing artifact process still serves the expected route before retrying.

**Why:** A failed restart can leave the prior process alive; another restart then only reproduces the port collision and may leave newly built server code unloaded.

**How to apply:** Identify the process by its exact managed workflow command and injected `PORT`, terminate only that verified workflow process, then restart the same managed workflow once and confirm its logs and proxy response.