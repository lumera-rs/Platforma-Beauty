---
name: Isolated process recovery
description: Safe cleanup of detached processes and durable records left by a force-stopped isolated test run.
---

Persist one opaque, per-run environment marker with the run’s durable recovery record and apply it only to child commands. After confirming the original owner PID identity is stale, enumerate marker-carrying processes and stop their complete process groups.

**Why:** The owner can be killed while detached API or shell descendants survive. A database or filename alone cannot distinguish those descendants from unrelated local services, and some foreign `/proc` entries are intentionally unreadable.

**How to apply:** Keep the owner-identity guard before any process scan, match an exact null-delimited environment entry, terminate only the discovered groups, and treat `ENOENT`, `EACCES`, and `EPERM` while scanning foreign `/proc` entries as non-matches rather than cleanup failures.

Graceful harness cancellation must capture the first interrupt signal, stop the active command and every owned service group, then wait for those stops before removing the disposable database and its manifest.

**Why:** Installing a signal listener disables Node's default immediate termination; cleanup must therefore preserve process-group ownership while releasing resources before reporting the conventional interrupted exit status.

**How to apply:** Register the listener before creating disposable resources, make it idempotent, make readiness waits interruptible, and remove the listener only after final cleanup.

Malformed durable recovery records must fail the recovery command visibly, but only after every valid sibling record has had a cleanup attempt; preserve malformed files for diagnosis.

**Why:** Treating a corrupt record as absent silently strands its disposable database, while failing before valid siblings are processed creates additional leaks.

**How to apply:** Collect invalid manifest filenames during discovery, process valid manifests normally, then return a non-zero error that identifies the recovery suite and each malformed filename without deleting those files.