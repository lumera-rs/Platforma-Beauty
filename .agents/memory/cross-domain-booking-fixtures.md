---
name: Cross-domain booking fixtures
description: Covers hidden prerequisites when a broad regression suite exercises booking routes outside its main domain.
---

Booking side-scenarios in broad HTTP regression suites must send an idempotency key and seed an active employee-location assignment plus an ISO-weekday location schedule. A legacy employee schedule alone does not prove canonical availability.

**Why:** A route fixture can pass request validation yet return a misleading unavailable-slot conflict when the canonical location context is absent; adding only a legacy schedule does not repair that boundary.

**How to apply:** Whenever a non-booking regression suite creates appointments, make its booking setup self-contained: use a deterministic reachable date, canonical location assignment/schedule, and a unique idempotency key per command.