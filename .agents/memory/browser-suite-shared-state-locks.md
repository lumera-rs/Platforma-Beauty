---
name: Browser suite shared-state locks
description: Playwright spec files that write the same global table must serialize across files with a session-level advisory lock.
---

Spec files that write a shared global table (e.g. versioned platform settings) must take turns via a session-level PostgreSQL advisory lock held on a dedicated pool connection for the whole file — acquired before the version watermark is captured, released only after cleanup.

**Why:** `fullyParallel: false` only serializes tests *within* a file; Playwright still runs different spec files in parallel workers. Two files that watermark "max version at start" and delete rows above it on teardown will delete each other's mid-test rows and corrupt expected version sequences — observed as one spec seeing "Verzija 1" where it expected "Verzija 5".

**How to apply:** When adding another spec file that writes an already-covered global resource, reuse the existing lock helper for that resource (acquire in `beforeAll` before watermarking, release in `afterAll`'s `finally` after cleanup, and raise the hook timeout since a sibling may hold the lock for its full test). Transaction-scoped `pg_advisory_xact_lock` is unsuitable for file-lifetime holds; use `pg_advisory_lock`/`pg_advisory_unlock` on one dedicated client. Validate by running the affected spec files together with parallel workers, not just the new spec alone.
