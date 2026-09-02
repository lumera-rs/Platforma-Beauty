---
name: Education waitlist payment promotion
description: Defines how payment and learner access interact when an Education seat is settled before waitlist promotion.
---

Installment settlement must allocate money and payment state to waitlisted named participants without granting learner access. Promotion then derives the immutable installment state and grants active enrollment access exactly once when the canonical payment rule is satisfied.

**Why:** Marking a shared installment settled while skipping waitlisted participant allocation loses the financial trail; promoting only the seat afterward can leave a fully paid learner permanently locked out.

**How to apply:** Serialize settlement and promotion with the existing Education finance/session locks, keep pending waitlisted enrollments access-free, derive payment state during promotion, and make replay/concurrent release idempotent.