---
name: Interrupted media test cleanup
description: Safety rules for recovering storage objects after a force-stopped media regression.
---

Test upload cleanup must use a marker that ordinary traffic cannot acquire, and every promoted object path must be persisted before its storage write begins.

**Why:** A process can stop after a storage PUT but before asset or variant rows commit. A filename-based marker can target user media, while a process-wide test switch can accidentally label unrelated uploads handled during the check.

**How to apply:** Gate marking with an ephemeral in-process token carried only by regression requests, propagate the marker from ticket to asset, append cleanup paths before PUT, and serialize recovery so it cannot overlap an active regression. Verify both manifest-only orphan deletion and preservation of an ordinary unmarked upload.