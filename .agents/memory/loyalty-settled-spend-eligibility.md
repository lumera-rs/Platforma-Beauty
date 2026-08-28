---
name: Loyalty settled-spend eligibility
description: Defines which completed commerce orders may qualify a customer or salon owner for loyalty pricing.
---

Loyalty pricing spend includes delivered paid orders plus delivered cash-on-delivery orders that remain marked unpaid. Pending, failed, refunded, and unpaid non-COD orders never qualify. B2B spend rolls up across all salons owned by the same user.

**Why:** Delivery status can remain set after a refund, and legacy or admin transitions can leave card or bank-transfer orders delivered but unpaid. Treating either as settled grants discounts against money that was never retained. Account progress and checkout pricing must also use the same scope.

**How to apply:** Reuse one settled-spend definition for customer progress, preview, and final checkout. Any new loyalty surface or order-payment transition must preserve these payment-method and owner-scope rules.