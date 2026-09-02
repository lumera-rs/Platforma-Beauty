---
name: Idempotent outcome analytics
description: Prevent duplicate business outcome events when successful mutation retries return an already-completed resource.
---

For idempotent mutations, client analytics must record a completed business outcome only when the response explicitly confirms that this request performed the state transition. HTTP success or a terminal resource state alone is insufficient.

**Why:** A retry after a lost response, duplicate submission, or concurrent administrator can receive a successful response for an already-completed resource and otherwise overcount the funnel outcome.

**How to apply:** Include a transition flag in the server response, keep it false for idempotent replays, and gate the outcome event on that flag. Add a test that invokes the analytics path with first-transition and replay responses and expects exactly one event.