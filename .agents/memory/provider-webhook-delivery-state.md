---
name: Provider webhook delivery state
description: Security and idempotency model for ingesting Brevo/Infobip delivery events into automation deliveries.
---

# Provider webhook delivery state

**Rule:** Delivery-status webhooks authenticate with a capability-URL secret token (timing-safe compare; unconfigured secret ⇒ reject all with 503), apply only monotonic first-write-wins updates to dedicated timestamp columns (deliveredAt / openedAt / failedAt; opened backfills delivered, delivery confirmation clears failure), and must never write the worker-owned `status` column.

**Why:** Brevo transactional webhooks and Infobip delivery reports carry no native payload signature, so the URL token is the only authentication. Replayed or out-of-order provider events are routine; guarded UPDATEs make them no-ops without any event log. Flipping `automation_deliveries.status` from a webhook would re-open the worker's claim CAS and cause a resend of an already-accepted message — provider failure lives in a separate `failedAt` column instead.

**How to apply:** Any new provider event ingestion (email, SMS, push): match events only via the globally-unique provider message reference persisted at send time (tenant isolation falls out for free), classify each event as updated/duplicate/unmatched/ignored, return 200 with counts so providers don't retry-storm, and validate any provider-supplied id shape (e.g. UUID) before using it in a typed SQL comparison.

**Freshness monitoring:** Webhook-silence warnings must key off a per-provider "last accepted verified event" receipt compared against grace-aged recent sends — never off per-message delivery state, which replays and out-of-order events make unreliable. Receipt tracking is monitoring metadata: keep it non-fatal so it can never alter webhook response semantics.
