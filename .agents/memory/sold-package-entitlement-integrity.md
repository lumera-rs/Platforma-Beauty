---
name: Sold package entitlement integrity
description: Domain rules for immutable treatment-package coverage and atomic session accounting.
---

Services covered by a purchased treatment package are fixed at purchase time. Booking with a package must create the appointment and consume one session in one transaction; cancellation must reverse both in one transaction. Employee commission uses the treatment's original service value when package payment makes the appointment price zero.

**Why:** Reading the current package definition retroactively changes what customers already bought. Splitting booking, redemption, or cancellation across transactions can leave a payable appointment, lose a session, or restore it twice.

**How to apply:** Snapshot covered services with each purchase, authorize redemption against that snapshot, preserve the original appointment price on redemption, and make every cancellation path perform an idempotent reversal.