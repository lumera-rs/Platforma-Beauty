# Disposable transfer proof

All database work used owned PostgreSQL 16 clusters with isolated child environments. No development, production, or Neon target or secret was selected. Target databases were built by executing migrations 000001–000004 through `applyMigrations`; no application schema or numbered migration was changed.

## Snapshot proof — refused atomically

The preserved demo dump was restored into the owned source. The tool ran with default policy: no column drops, no table exclusions, no casts, and no implicit seed reconciliation. Actual final output:
```text
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.aftercare_settings","count":3}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.b2c_display_settings","count":1}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.beauty_job_categories","count":17}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.beauty_job_platform_settings","count":1}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.education_b2b_discount_settings","count":1}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.education_placement_settings","count":4}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.education_salon_cleanup_reports","count":1}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.shop_settings","count":1}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.subscription_plans","count":7}
BLOCKER {"code":"SEED_RECONCILIATION_REQUIRED","table":"public.suppliers","count":38}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.beauty_job_listings","constraint":"beauty_job_listings_category_id_beauty_job_categories_id_fk","count":124}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.education_center_subscriptions","constraint":"education_center_subscriptions_plan_id_subscription_plans_id_fk","count":11}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.education_payment_obligations","constraint":"education_payment_obligations_plan_id_snapshot_subscription_pla","count":3}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.price_inquiries","constraint":"price_inquiries_supplier_id_suppliers_id_fk","count":2}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.product_bundles","constraint":"product_bundles_supplier_id_suppliers_id_fk","count":7}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.product_categories","constraint":"product_categories_supplier_id_fkey","count":36}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.products","constraint":"products_supplier_id_fkey","count":51}
BLOCKER {"code":"CONSTRAINT_VIOLATION","table":"public.subscriptions","constraint":"subscriptions_plan_id_subscription_plans_id_fk","count":10}
TRANSFER_RESULT mode=snapshot status=blocked tables=256 blockers=18
VERIFICATION readiness=true structural_unchanged=true physical_unchanged=true target_data_unchanged=true
OWNED_CLUSTER_REMOVED
```

The ten seed-reconciliation blockers are owner decisions, not permission to overwrite seeds or renumber identifiers. The eight FK counts describe the attempted target contents with its own seeds retained; they are **not** evidence that the original source rows themselves violate those FKs. Copying source business references while retaining target seed identifiers produces these prospective-target failures. The transaction rolled back all staged rows.

Every one of the 256 table outcomes—including source count, before/after target counts, before/after content hashes, per-table blockers, and engine source/target shared-column hashes—is in [snapshot-proof.json](./snapshot-proof.json). All target data hashes and counts equal their pre-transfer values. Structural and physical fingerprints are also recorded unchanged. No row contents are included.

## Drift encountered and handling

- Seven target-only nullable columns take their target default, which is NULL: `beauty_job_listings.first_published_at`, `education_b2b_orders.idempotency_key`, `education_b2b_orders.idempotency_fingerprint`, and `salons.entrance_directions`, `salons.intercom`, `salons.floor`, `salons.apartment`.
- `retail_product_reviews.comment` has a source empty-text default and no target default. Shared stored values copy unchanged; no row value is replaced with a new default.
- No source-only columns or type/nullability differences were found between the restored source and the migration-built target. Full raw definitions are in [inventory.json](./inventory.json).
- `education_salon_cleanup_reports` exists on both sides and has one row on each. Its differing receipt content is a seed-reconciliation blocker, not a silently dropped source table.
- Ordinary target triggers are suppressed transaction-locally. Source functions/triggers—including the unattached fault-injection function—are never copied.
- Eight canonical tables have no primary key. Their shared row payloads use deterministic C-collated full-row ordering with duplicate multiplicity preserved; tables with primary keys use primary-key ordering. This is an explicit accommodation for canonical tables lacking a PK, not a schema alteration.
- Stored generated shared columns are omitted from INSERT and recomputed by PostgreSQL, but remain included in source/target verification hashes. Divergent recomputation is a content mismatch and rolls back.

## Canonical positive proof

A separate owned source was also built by the migration runner. Its seed rows were explicitly aligned byte-for-byte with the fresh target seeds solely to create a synthetic success fixture, then one synthetic `service_categories` business row was added. This is not an automatic reconciliation performed by the tool or authorization to modify the preserved snapshot. The real application `transferData` admission, pinned seed contract, ledger identity check, and all constraints ran.

Actual output:
```text
TRANSFER_RESULT mode=canonical-success status=committed tables=256 blockers=0
VERIFICATION readiness=true structural_unchanged=true physical_unchanged=true target_data_unchanged=false
OWNED_CLUSTER_REMOVED
```

Every transferred table's source count/hash equals its target count/hash. [canonical-success-proof.json](./canonical-success-proof.json) retains all 256 actual outcomes and fingerprints. `target_data_unchanged=false` is correct for this success fixture: the business row committed. The snapshot proof, separately, retained unchanged target data.

## Seed calibration

The committed seed contract was calibrated only from a fresh migration-built owned target. It covers every application table, including empty tables. The only omitted comparison columns on seeded tables are the explicitly listed generated UUID/time fields below. The fixed supplier identifier is included. Omission is for pristine-target seed admission only: transfer content verification still compares shared identifiers and timestamps, so independently generated seeds require an owner decision.

Actual calibration output:
```text
SEED public.aftercare_settings count=1 hash=084b7f5fddbe9c0b34ad8b3c136cc8ecb2aa37d6113c558b0a2abc1cb2821611 omitted=id,created_at
SEED public.b2c_display_settings count=1 hash=fe80449f1531212827a96c31d140d9e4d2e8e198f138d2dff69dfa1594db2d7c omitted=id,created_at,updated_at
SEED public.beauty_job_categories count=17 hash=1918f3d91c34e0a89f5b994bf23b1660a5924bca84d0b427752cdac1cd1f5cfe omitted=id,created_at,updated_at
SEED public.beauty_job_platform_settings count=1 hash=02ce205a3ed533d03c2ec1cb17c784a652e5cee1722e745c6a2f01f1cab9db35 omitted=id,updated_at
SEED public.education_b2b_discount_settings count=1 hash=43fafe8e4d7dd7118b60ac6de2205d7bc1b32b79fa60d9c65cdb8fcc684a762f omitted=updated_at
SEED public.education_placement_settings count=1 hash=f17ff850690765fefd723622d313a7501bfe6bb380e272c385986fec1607549c omitted=id,created_at,updated_at
SEED public.education_salon_cleanup_reports count=1 hash=c9ce76a1a207c92740bdc3cd16673886b05afe354772609e56fdc98d8cf7e327 omitted=completed_at
SEED public.shop_settings count=1 hash=15d04b2bbe882de06769a259e28e331f74dc333aa6101e037e00036e7ff9873c omitted=id,updated_at
SEED public.subscription_plans count=3 hash=a0f6657a69cadbfe2e89d5ddbc38f8cfcf39bcdbfa1d88f7e02fbb370477965d omitted=id
SEED public.suppliers count=1 hash=c20e6ce67b5542bbbdfa80f8cffca105ea340917a8fd7677d3d18137338d396d omitted=created_at,updated_at
SEED_CONTRACT tables=256 rows=28
OWNED_CLUSTER_REMOVED
```

## Reproduction

From a clean isolated shell with PostgreSQL 16 tools on PATH, run the following commands. They accept no ambient database URL and create their own clusters:

```sh
env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test pnpm --filter @workspace/scripts exec tsx src/data-transfer-proof/inventory.ts
env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test pnpm --filter @workspace/scripts exec tsx src/data-transfer-proof/run-proof.ts
env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test pnpm --filter @workspace/scripts exec tsx src/data-transfer-proof/run-proof.ts --success
```

Inventory/snapshot reproduction additionally needs the preserved dump and provisional inventory outside Git. The synthetic success fixture does not. The calibration command is a reviewed repository-maintenance action, not an operator option for accepting a dirty target.
