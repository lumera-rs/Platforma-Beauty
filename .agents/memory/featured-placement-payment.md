---
name: Featured placement payment
description: Durable lifecycle and compatibility rules for paid featured placements.
---

Paid featured placements use one shared lifecycle for salons, education centers,
and education special offers. Snapshot price, duration, and the complete
server-generated IPS instruction when the request is created. Pending requests
reserve a slot only for the payment window; public visibility begins only after
manual administrator confirmation and ends at the persisted deadline.

**Why:** The repository has Education-only operational IPS payments and
Education featured charges, but no prior salon payment contract to restore.
Mutable payment settings must never alter or break a previously issued charge,
and cached public discovery must not outlive a successful confirmation.

**How to apply:** Keep owner/admin APIs on the shared placement ledger, preserve
the operational Education installment QR contract as an isolated flow, derive
every public featured signal from active in-window placements rather than
legacy flags, and invalidate public discovery after a salon placement activates.