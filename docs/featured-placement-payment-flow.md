# Payment flow for featured placements

## Decision

Repository history was checked before introducing a salon-specific payment
endpoint. No previous IPS QR flow for a featured salon exists in any reachable
git history or checkpoint. The only existing IPS QR implementation is the
Education operational installment flow and it remains unchanged.

The agreed target flow for paid featured placements is:

1. The salon or education-center owner starts a featured placement request.
2. The platform snapshots a fixed price and placement duration (for example,
   30 days) and creates a pending charge.
3. The owner receives an IPS QR payload for that charge and can pay it by bank
   transfer.
4. The placement stays pending and is not publicly activated until a platform
   administrator confirms that the payment arrived.
5. Administrators have one queue for pending confirmations and can manually
   confirm the payment.
6. The same mechanism is used for featured salons, featured education centers,
   and education special offers; these are not separate payment flows.

The fixed price, duration, settlement fields, owner entry point, and
administrator queue are implementation inputs for the follow-up feature. Until
that feature is implemented, the existing admin-only featured-salon switch is
the source of truth for salon designation, and it must not be presented as an
IPS payment or automatic payment confirmation.

## Compatibility boundary

The Education operational IPS QR endpoint remains independent. Changes to
featured-placement payments must not change its purchaser/center
authorization, pending-installment requirement, RSD payload, or response
fields.