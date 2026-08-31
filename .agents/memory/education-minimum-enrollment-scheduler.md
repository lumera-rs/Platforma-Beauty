---
name: Education minimum-enrollment scheduler
description: Prevents deadline automation from cancelling sessions that have started while waiting for locks.
---

Minimum-enrollment auto-cancellation applies only to future sessions. Candidate filtering is insufficient: scheduler-originated cancellation must recheck the locked session against PostgreSQL `now()` before any state, finance, access, notification, or outbox mutation.

**Why:** A future candidate can start while the worker processes earlier sessions or waits for schedule/financial locks; relying on selection time can refund and revoke an in-progress course.

**How to apply:** Mark scheduler cancellation intent explicitly, reject `startsAt <= now()` inside the canonical locked transaction, and keep a select-to-lock race test. Send deduplicated risk warnings only within the defined 24-hour pre-deadline window and only for future sessions.