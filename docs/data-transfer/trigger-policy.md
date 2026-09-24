# Transfer trigger policy

The canonical 24 triggers are closed-listed in `scripts/src/data-transfer/trigger-policy.ts`.
Unknown triggers or any unexpected enabled mode refuse the load. No replication-role
changes or constraint disabling occur.
The target session must already have `session_replication_role=origin`; a read-only
setting check refuses a session configured otherwise, rather than attempting a
privileged SET or trusting enabled triggers that would not execute.
Only the following three triggers are disabled, using named
`ALTER TABLE ... DISABLE TRIGGER` inside the transaction:

| Trigger | Reason and verification |
|---|---|
| `education_centers_immutable_payment_reference` | Assigns a reference on insert. Preserve source value; explicitly reject NULL references after loading. Subsequent-update immutability is enforced once re-enabled. |
| `salons_immutable_payment_reference` | Assigns a reference on insert. Preserve source value; explicitly reject NULL references after loading. Subsequent-update immutability is enforced once re-enabled. |
| `products_enqueue_restocked_waitlist` | Emits notification-outbox rows on stock updates. No historical-transition invariant applies to inserting transferred snapshots; replaying notification events is forbidden. |

The other 21 remain enabled:

| Trigger | Validation reason |
|---|---|
| `protect_aftercare_recommendation_line_evidence` | Rejects changes to immutable line evidence. |
| `protect_aftercare_recommendation_evidence` | Rejects changes to immutable recommendation evidence. |
| `b2c_banners_validate_destination` | Rejects incompatible banner destination. |
| `education_bundle_purchases_payment_reference_immutable` | Rejects changes to immutable payment evidence. |
| `education_gift_vouchers_snapshot_immutable` | Rejects changes to immutable voucher evidence. |
| `order_bundle_components_immutable` | Rejects changes to recorded bundle components. |
| `order_items_commercial_snapshot_immutable` | Rejects changes to commercial snapshot. |
| `order_items_coupon_snapshot_immutable` | Rejects changes to coupon snapshot. |
| `order_items_g2_snapshot_immutable` | Rejects changes to G2 evidence. |
| `orders_invoice_snapshot_immutable` | Rejects changes to invoice evidence. |
| `orders_promotion_snapshot_immutable` | Rejects changes to promotion evidence. |
| `product_bundle_components_validate` | Rejects incompatible bundle components. |
| `product_categories_supplier_ownership` | Rejects supplier mismatch, self-parent and ancestor cycles. |
| `products_supplier_ownership` | Rejects supplier/category/channel mismatch. |
| `referral_attributions_append_only` | Rejects changes to attribution identity. |
| `referral_credit_ledger_append_only` | Rejects updates/deletes to append-only records. |
| `referral_credit_redemptions_append_only` | Rejects updates/deletes to append-only records. |
| `retail_order_items_commercial_snapshot_immutable` | Rejects changes to commercial evidence. |
| `retail_order_items_coupon_snapshot_immutable` | Rejects changes to coupon evidence. |
| `retail_order_items_g2_snapshot_immutable` | Rejects changes to G2 evidence. |
| `retail_orders_promotion_snapshot_immutable` | Rejects changes to promotion evidence. |

## Dependency ordering and cycles

A pending-row scheduler loads a row only when its non-null FK parents are already
present. It therefore orders rows as well as tables; self-parent FKs that PostgreSQL
can satisfy within the same INSERT are permitted, but validating triggers still
reject prohibited self-parent categories. Nullable edges break cycles naturally.
If no row can progress, `FOREIGN_KEY_DEPENDENCY_BLOCKED` reports pending counts
per table. Non-null closed cycles and missing parents refuse atomically: the tool
does not disable FKs, alter deferrability, insert temporary NULLs, or repair data.
Explicit post-load constraint verification remains mandatory.

## Rehearsal and operations

`--rehearsal` executes loading and verification, re-enables all disabled triggers,
checks fingerprints, then rolls back rather than committing. Its report uses
`status: rehearsed`; counts and hashes describe the would-be target, not persisted
rows. Readiness and fingerprints are checked again after rollback.

Both sessions explicitly set a 30-minute statement timeout. SQL errors expose only
SQLSTATE and the failing step, never PostgreSQL row-bearing error detail.
Source rollback is attempted even if target rollback fails. Refused/rolled-back
reports advise `vacuumRecommended: true`: schedule VACUUM on the target before
retry/cutover to reclaim aborted-load tuples; VACUUM is not run automatically.