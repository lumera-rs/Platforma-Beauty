---
name: Shared end-to-end spec validation
description: How to validate shared browser specs safely when parallel task merges can change the file during implementation.
---

When a browser spec is edited while other tasks may merge changes to the same area, validate the final file with direct test discovery and the complete affected suite after the latest merge.

**Why:** Context-matched edits and concurrent merges can leave executable statements outside a test or alter an unrelated fixture while TypeScript still passes. A delegated focused-test report may also reflect an earlier file state.

**How to apply:** Inspect the final diff against the latest baseline, run the test runner’s discovery/list mode, then execute the full affected spec before completion.