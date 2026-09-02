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

The shared flow is implemented by the placement product/settings and placement
ledger used by all three placement kinds. Price and duration are copied to the
ledger row when the owner creates a request and cannot change with later
settings edits. Placement prices are positive whole dinar amounts (at least 1
RSD); a legacy zero-price history row is deliberately nonpayable and is never
automatically activated. The API returns a server-generated NBS IPS payload based on the
platform payment account; recipient, account, purpose, currency, and the final
payload are snapshotted on the charge. Later platform-setting changes therefore
cannot alter payment history. Rows created before instruction snapshots remain
readable with `paymentInstructionsAvailable: false`; instructions are never
silently reconstructed from current settings. The browser only renders the
returned payload.

Owners can review pending and historical requests. Administrators use the
paginated pending queue and confirmation is idempotent: a retry returns the
original confirmed row and never moves its start/end dates. Public salon and
education placement reads require `active`, `starts_at <= now`, and
`ends_at > now`; pending or expired rows never activate public placement.

The legacy salon `featured` column may remain for backwards-compatible
administrative records, but it is not authoritative for public paid placement.

The former education-only purchase/list/settlement API operations have been
retired from the published contract and owner/admin clients. Existing server
routes remain only as backwards-compatible adapters while clients move to the
shared placement endpoints; they issue the same QR-safe `FP-…` references and
apply the same expiry and settlement rules.

## Compatibility boundary

The Education operational IPS QR endpoint remains independent. Changes to
featured-placement payments must not change its purchaser/center
authorization, pending-installment requirement, RSD payload, or response
fields.