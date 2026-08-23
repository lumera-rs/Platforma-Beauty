---
name: Platform-wide preview guards
description: Admin dry-runs over all tenants must bound work by rows and enforce their time budget on every step, database-side included.
---

# Platform-wide preview guards

Rule: an admin endpoint that dry-runs a computation across every tenant must (1) bound memory by actual rows — keyset-paginate the classified rows and push shared aggregates into SQL — and (2) enforce its wall-clock budget on *every* database step, setup and finalize included: a row cap checked before loading data, deadline assertions immediately before and after each query and batch (including the last one, before returning), and a database-side statement timeout set to the remaining budget so even one blocked query is cancelled by the server. Guard trips surface as a typed error mapped to a friendly 503, never a stall or a partial answer.

**Why:** a deadline checked only "between batches" is a false guard — the sole or final batch, the setup count, or a finalize lookup can each stall past the budget with no check; and batching by tenant count does not bound memory when per-tenant history is deep. JS-side checks alone cannot interrupt a blocked query — only a server-side timeout can.

**How to apply:** any new platform-wide admin computation must make its overload behavior deterministically testable (fault-injection points that slow an exact step under test env only), keep guard limits env-tunable so tests trip them without seeding huge data, and include a seeded volume benchmark with deep per-row history asserting a response-time bound.
