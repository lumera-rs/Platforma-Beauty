---
name: Web Push trust boundaries
description: Reliability and security boundaries required for browser push delivery outside the open application.
---

**Rule:** Web Push registration accepts only known provider endpoints, verifies that the VAPID public and private keys form one cryptographic pair, and resolves notification links inside the application scope. Reminder deliveries expire at their appointment start and must revalidate the original appointment schedule before provider submission. Provider acceptance and device display acknowledgement are distinct operational states and must never share one “delivered” label.

**Why:** An arbitrary HTTPS endpoint turns authenticated subscription registration into server-side request forgery; individually well-formed but mismatched VAPID keys make an integration look active while every send fails; root-relative links escape path-mounted apps; durable retries can otherwise deliver stale reminders after cancellation or rescheduling; and a successful provider response proves acceptance, not that a browser displayed the notification.

**How to apply:** Use these checks for every browser or mobile push provider path, including admin configuration validation, subscription APIs, retry workers, service workers, delivery dashboards, and tests. Receipt telemetry must be capability-protected, replay-safe, and recorded independently of the worker’s provider status.