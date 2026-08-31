---
name: Education fixed-session compatibility
description: Preserves booking access for fixed sessions created before educator assignment became mandatory for new operations.
---

Published fixed-group sessions may be offered with no educator assignment when the center has no active educator-role staff. Owner/manager or inactive staff do not trigger assignment requirements. Their public availability uses the real session and a nullable educator reference; recurring individual availability still requires an assigned educator.

Cancelling one of these sessions must reconcile both legacy and operational enrollments in the same transaction. Refund only pre-payout escrow; any paid-out, partially refunded, net-paid, or reserve-paid legacy escrow aborts the entire cancellation with the canonical payout conflict.

All session-cancellation entry points—operational center, retained owner/admin, and scheduled minimum-enrollment cancellation—must delegate to one financial implementation. Public/assigned/booked operational sessions cannot be edited through the retained legacy PATCH route.

**Why:** Existing fixed sessions predate operational educator assignments. Requiring an inner-joined assignment removes their only booking path and can hide both operational and legacy checkout.

**How to apply:** Keep public fixed-session reads tolerant of a missing assignment, require one only when active educator-role staff exist, preserve a legacy CTA fallback when no operational slot exists, and enforce overlap rules when an assignment is present or added. Route every cancellation caller through the canonical Education finance boundary; reject retained PATCH mutations for operational sessions.