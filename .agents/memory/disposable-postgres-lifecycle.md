---
name: Disposable PostgreSQL lifecycle
description: Short owned Unix socket paths and graceful cleanup of pg-pool test databases.
---

Keep the complete PostgreSQL Unix socket filename within Linux's 107-byte limit; an owned socket directory can be shorter than the data/evidence directory.

**Why:** A long external-worktree path caused PostgreSQL to bind TCP and then fail startup because its Unix socket filename was too long.

**How to apply:** Bound the complete socket filename, not only the directory, while retaining an owned location rather than a shared default.

Do not assume `pg.Pool.end()` means every server-side connection has already disappeared. Ordinary database deletion after pool shutdown avoids forcibly terminating clients still disconnecting; cleanup failures must remain visible.

**Why:** The installed pool resolves its end callback after removing clients from its collection, before every asynchronous client-end callback. A forced drop then produced an unhandled administrator-termination error after all test assertions had passed.

**How to apply:** Distinguish migration assertion failures from fixture cleanup failures using the owned server log. Do not mask pool errors or weaken migration refusals to hide a cleanup race.