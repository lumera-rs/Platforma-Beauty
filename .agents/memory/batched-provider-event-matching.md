---
name: Batched provider event matching
description: How webhook batch processing keeps one matching query per batch without changing per-event semantics.
---

Webhook batches (email/SMS delivery reports) resolve message references with ONE `= ANY(...)` lookup per batch, then apply each delivery-state transition as its own guarded, monotonic UPDATE.

**Why:** Large provider batches previously cost N sequential round-trips inside the webhook request. Batching only the matching lookup keeps response times flat while preserving replay/out-of-order semantics (duplicate detection, first-write-wins timestamps) that depend on per-event guarded updates.

**How to apply:** When optimizing batch webhook paths, classify every event first (ignored before unmatched, exactly mirroring the single-event order), batch only the reference→key matching, and keep state application per event. Synthetic self-check references and non-UUID SMS references must be filtered before the query so they stay unmatched. Also: new fixtures added to the shared provider-events suite must use an isolated salon/rule, or later aggregate owner-stats assertions break.
