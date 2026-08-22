---
name: Education financial serialization
description: Rules for keeping education escrow payouts and disputes mutually consistent under concurrent requests.
---

All financial mutations for one education center must acquire the same transaction-scoped advisory lock before reading or updating escrow records. Lock the affected escrow row too, and condition every status update on its prior state and unpaid fields.

**Why:** A payout and a dispute operating from stale reads can otherwise both succeed: payout ledger entries can duplicate, or an already-paid escrow can later be overwritten as refunded or frozen.

**How to apply:** Put center-level serialization around payout creation, dispute opening, and dispute resolution. Treat an escrow that has paid fields as ineligible for a refund transition; an explicit admin rejection can only record the decision and reconcile a legacy frozen status, never reverse a payment silently. Enrollment also needs a database-enforced participant identity and purchaser-scoped idempotency key so retries or concurrent requests cannot create a second escrow liability.

Buyer requests are not settlements. A marketplace enrollment must remain pending, with no access, escrow, ledger liability, messages, or disputes, until an administrator records a trusted manual settlement inside one transaction.

**Why:** In a marketplace without a payment-provider confirmation, treating the buyer's HTTP request as paid lets anyone mint course access and payout liabilities.

**How to apply:** Give paid customers LMS access only after the admin settlement transition creates the enrollment access, escrow, ledger, and thread atomically. Keep salon-internal courses out of the protected public marketplace unless they meet the same verified-center rules.

Course-detail and module-list responses must never disclose lesson content merely because the requester is a purchaser; content is released only by the enrollment-specific LMS route after its full entitlement checks.

**Why:** Reusing purchase eligibility in ordinary course views bypasses the LMS authorization boundary and exposes protected lessons through a broader endpoint.

**How to apply:** Keep normal course views redacted for learners, and pass explicit lesson-content disclosure only from the LMS handler after checking active/completed, paid enrollment ownership.

For live and hybrid courses, calculate an escrow appeal deadline from the exact future session reserved during settlement, never from a course-wide “earliest” session.

**Why:** A full or historical earlier session can make a course-level deadline arrive before the learner’s assigned session ends, enabling a premature payout.

**How to apply:** Select an available session whose end time is still future while holding the settlement transaction locks, store its ID with the enrollment, and derive release from that session’s end plus the appeal window.

Dispute resolution cannot make escrow payable before its release deadline; payout must independently require that deadline as a final guard.

**Why:** Status-only payout eligibility can let an otherwise legitimate resolution transition bypass the learner’s appeal period.

**How to apply:** Restore a pre-deadline frozen escrow to held after a non-refund resolution, and filter payout candidates by both payout-ready status and a due release timestamp.

Buyers may only open disputes while the protected purchase deadline remains active.

**Why:** Letting an expired escrow be frozen after the appeal period lets a buyer block an otherwise valid payout.

**How to apply:** Check the locked escrow release time before creating a dispute and in the guarded freeze update; hide the customer dispute control after that same deadline, but treat the server transaction as authoritative.