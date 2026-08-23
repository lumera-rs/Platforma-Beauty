---
name: Conflict cancellation freshness
description: How optimistic-concurrency dialogs must discard pending form values without reopening a stale-cache race.
---

When an administrator discards a conflicted edit, keep the dialog open until a fresh, confirmed active version has been loaded and used to rebase the form. Abort or cancel any older refresh before applying the cancellation read, so an in-flight stale response cannot refill the cache afterwards.

**Why:** A 409 handler commonly opens the dialog before its background refetch completes. Closing immediately can leave abandoned values visible; independent refreshes can also race and replace the confirmed cancellation result with an older cache entry.

**How to apply:** Treat cancellation as an asynchronous rebase, not merely dialog-state cleanup. Use an abortable refresh or monotonic cache writes, cancel active query fetches before the authoritative read, and browser-test both the already-refreshed and explicitly held-refresh paths.