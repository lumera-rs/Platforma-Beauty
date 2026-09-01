---
name: Education financial serialization
description: Rules for keeping education escrow, payouts, disputes, voucher refunds, and capacity mutually consistent.
---

All financial mutations for one education center must acquire the same transaction-scoped advisory lock before reading or updating escrow records. Lock the affected escrow row too, and condition every status update on its prior state and unpaid fields.

**Why:** A payout and a dispute operating from stale reads can otherwise both succeed: payout ledger entries can duplicate, or an already-paid escrow can later be overwritten as refunded or frozen.

**How to apply:** Put center-level serialization around payout creation, dispute opening, and dispute resolution. Treat an escrow that has paid fields as ineligible for a refund transition; an explicit admin rejection can only record the decision and reconcile a legacy frozen status, never reverse a payment silently. Enrollment also needs a database-enforced participant identity and purchaser-scoped idempotency key so retries or concurrent requests cannot create a second escrow liability.

Center verification and subscription changes must take that same center lock before committing eligibility changes.

**Why:** A settlement that read the earlier eligible state could otherwise create access and financial records just as an administrator revokes the center.

**How to apply:** Serialize eligibility updates with settlement before its final locked eligibility check, so the transaction that acquires the lock first defines whether settlement can continue.

Release and refund ledger writes, plus release audit writes, should also have database uniqueness backstops per escrow; active disputes need one partial unique key per enrollment.

**Why:** Transaction guards protect the intended code path, but database constraints prevent a future retry or alternate writer from duplicating a financial transition.

**How to apply:** Give each automatic release a stable ledger idempotency key and keep partial unique indexes for release/refund ledger rows, release events, and active disputes.

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

Per-center billing overrides and global billing defaults must share a second advisory-lock domain: effective-value readers take the global lock in shared mode before the center lock, while global-default updates take it exclusively and validate every resolved center combination.

**Why:** A globally valid commission/reserve pair can still make a center invalid when combined with one nullable override, and resolving settings outside the financial write transaction can snapshot stale fees or deadlines.

**How to apply:** Use the shared billing resolver and global-shared → center lock order for settlement, featured charges, demo seed escrows, and any future financial snapshot. Global updates must reject if any center would resolve above 100%; explicit zero remains custom, while only null inherits.

Redeemed voucher refunds must stay inside the pre-payout escrow boundary and atomically couple finance with enrollment capacity.

**Why:** Refunding after payout creates an unreconciled double loss, while committing voucher/escrow changes before seat release can strand capacity and waitlisted learners if the second step fails.

**How to apply:** Reject any refund when payout timestamps are set or escrow is outside a pre-payout state. In one transaction, lock the center, voucher, enrollment, escrow, and session; write the refund ledger/event, cancel access, release or re-hold the seat, offer the waiter, and finalize the voucher. Regression tests should compare complete persisted state on rejection and injected rollback.

Subscription renewal and upgrade obligations must be mutually exclusive per center subscription, and every plan transition must preserve the terms of any period already paid in advance.

**Why:** Overlapping renewal and upgrade obligations let settlement of one grant the entitlement attached to the other. Repricing a paid future period after a downgrade either overcharges the center or removes benefits it already purchased.

**How to apply:** Serialize obligation issuance on the subscription row and back it with partial unique indexes across pending renewal/upgrade kinds and each non-cancelled renewal service-period start. Snapshot the purchased plan, cycle, amount, and dates on the obligation. An unpaid renewal issued after expiry starts no earlier than its issuance time, so worker delay never shortens the purchased period. Quote deferred changes using the plan effective at the next boundary. If a current or future period is paid, defer later downgrade, cycle, or custom-contract terms until it ends (or reject that change); activate obligation snapshots at their boundary, never at settlement time.