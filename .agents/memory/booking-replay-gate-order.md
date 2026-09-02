---
name: Booking replay gate order
description: Ordering durable idempotency replay ahead of volatile request gates.
---

A completed booking command receipt must be checked and replayed before admission controls, rate limits, date checks, availability checks, or mutable salon/service policy validation. The fast path must retain the route's current role and tenant-authorization checks plus the same actor, tenant, command type, and canonical payload fingerprint checks as the transactional path.

**Why:** A response can be lost and retried after the appointment date, availability, policy, or process load has changed. Running those current-state gates first can return 400, 409, or 429 instead of the original successful response.

**How to apply:** Run the route's canonical current authorization resolver first and derive the tenant from that result, never from an unverified active-tenant field. Then return an exact matching terminal response immediately, reject a fingerprint or command mismatch, and let requests without a receipt continue through normal admission and business validation.