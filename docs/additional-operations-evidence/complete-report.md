# Complete additional-operations evidence report

**Assembly status:** PASS for report record/source reconciliation. This document concatenates the final source markdown without editorial alteration and then preserves the complete normalized rich-record SQL/code evidence. See [README.md](README.md) for scope and limitations and [verification.json](verification.json) for machine-readable verification.

---

## Final source markdown: bg-data.md

# Business Growth data-backfill evidence audit

**Scope.** Assigned subset only: every current additionalOperations record with owner ensureBusinessGrowthSchema and category data-backfill. Read-only evidence report; authoritative crosswalk remains unchanged. Companion bg-data.json preserves verbatim relevant source/SQL for every record.

## Baseline and completeness

- Crosswalk selection: **62 records**, independently enumerated as **60 source-discovered literals + 2 curated/grouped records**. Each ID appears once in JSON.
- Current crosswalk metadata declares 8 owners, 1,459 DDL occurrences, 1,435 unique fingerprints, and 110 additional operations. The difference between the 67 `data-backfill` **operation IDs** and the census's 70 DML **literals** is reconciled, not unknown: 69 DML literal rows map to the 67 data-backfill IDs because `business-growth/bundle-payment-backfill` covers L093/L094 and `education-bundle/payment-reference-backfill` covers L100/L101; the remaining DML row, L096, is `business-growth/rollout-marker-write` and is categorized `rollout-marker`. This assigned owner still contributes 62 data-backfill IDs.
- Canonical SHA-256: 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60, matching crosswalk metadata. Static canonical scan found zero top-level data-mutation statements in the forms specified above.
- Every assessed ID remains **UNRESOLVED**. No production DB was inspected and no startup, migration, runtime, source, pin, or crosswalk change was made.

## Shared execution evidence

runBusinessGrowthSchemaDdl takes an advisory lock (5002-5006), sets target search_path (5008-5009), and reads rollout state (5035-5043). Lower/absent marker builds tableStatements and executes each statement sequentially in autocommit (5132-5138), then writes marker (5139-5148); error before marker permits revisiting prior completed literals. Current marker fast path returns at 5125. Curated fast-path behavior is stated individually.

## Individual records

### business-growth/bundle-payment-backfill
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:5070-5124. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** Fast-path direct queries 5101-5108, after target-check validation, payment_reference add, and trigger drop at 5088-5100. Only current-version fast path, only when to_regclass check at 5087 is true. Full rollout has separate literal records at 4923-4930, orders 89/90. Skipped on lower/absent marker (full branch) and when table check is false; reached on current marker branch.
- **Dependencies:** rollout marker version >=126; target table and payment_instructions; trigger is dropped before mutations.
- **Effects:** existing-data payment-reference and immutable-instruction backfill. First UPDATE derives BND- plus the first 30 UUID hex characters for NULL payment_reference rows and writes payment_instructions.reference. Second UPDATE makes each JSON reference equal current payment_reference when distinct; fast path drops then recreates the immutability trigger.
- **Repeat safety:** **Predicate-convergent only; UNKNOWN production safety** — NULL and IS DISTINCT FROM predicates can converge, but source does not prove truncated-reference uniqueness, correctness of overwriting divergent JSON, trigger/constraint timing, retries, or concurrent writers.
- **State dependence:** to_regclass gates execution; both UPDATE predicates read current education_bundle_purchases payment_reference/payment_instructions and derive values from current UUIDs. No production database was inspected; version, rows, constraint validity, triggers, and writers remain unverified.
- **Canonical comparison:** Canonical education_bundle_purchases definition at migration.sql:3421-3448 declares payment_reference NOT NULL and reference-equality check at 3446, but has no top-level data mutation. It does not generate historic BND references or repair JSON. **NOT REPRESENTED as this transformation; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### business-growth/education-snapshot-backfills
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:217-249. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** Helper declaration lines 217-249; course-enrollment literal 229-238 is first, installment literal 239-248 second. Full rollout expands helper in tableStatements at 4920; current-version fast path executes each helper literal at 5079 after IF EXISTS column repairs. On either branch, the helper is reached only after prior statements in that branch succeed; its UPDATE predicates plus valid platform-settings subquery then select rows.
- **Dependencies:** course_enrollments, education_installments, education_platform_settings and referenced columns; complete valid IPS settings row.
- **Effects:** existing-data payment-instruction snapshot backfill. Builds immutable QR/IPS JSON for qualifying pending course enrollments and installments using the newest complete valid platform IPS settings row.
- **Repeat safety:** **Predicate-convergent only; UNKNOWN production safety** — both literals select NULL snapshots, but the first-write payload derives from mutable current platform settings; source cannot prove historic correctness, unique setting selection, retries/concurrency, or that every NULL needs a snapshot.
- **State dependence:** Reads current enrollment/installment fields and selects newest valid education_platform_settings by updated_at DESC, id DESC LIMIT 1. No production database was inspected; settings, historic alignment, rows, and writers remain unverified.
- **Canonical comparison:** Canonical course_enrollments definition at migration.sql:2881-2921 has payment_instructions_snapshot at 2912; education_installments is defined at 3889-3903. No top-level canonical data mutation constructs historic QR/IPS JSON. **NOT REPRESENTED as this snapshot backfill; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1066-5602134427af494b
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1066-1078. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 18; source starts line 1066, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF NOT EXISTS ( SELECT 1 FROM pg_trigger WHERE tgrelid = '${s}.retail_order_items'::regclass AND tgname = 'retail_order_items_commercial_snapshot_immutable' AND NOT tgisinternal ) THEN UPDATE ${s}.retail_order_items AS item SET product_catalog_reference = product.catalog_reference FROM ${s}.products AS product WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL; END IF; END $$
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_order_items, products; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5743-5791. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1155-097a5b1129d827b2
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1155-1165. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 23; source starts line 1155, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.order_items AS item SET supplier_id = COALESCE(item.supplier_id, product.supplier_id), supplier_name = COALESCE(item.supplier_name, supplier.name), supplier_slug = COALESCE(item.supplier_slug, supplier.slug), product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference), product_sku_snapshot = COALESCE(item.product_sku_snapshot, item.product_sku, product.sku), unit_price = COALESCE(item.unit_price, item.price), line_subtotal = COALESCE(item.line_subtotal, item.price * item.quantity), line_total = COALESCE(item.line_total, item.price * item.quantity) FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id WHERE item.product_id = product.id
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (order_items, products, suppliers). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5015-5060. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1234-1d61851271544400
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1234-1235. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 25; source starts line 1234, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.order_items SET realized_revenue_rsd = line_total WHERE realized_revenue_rsd = 0 AND line_total > 0
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (order_items). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5015-5060. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1236-2d62e2481fe32512
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1236-1237. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 26; source starts line 1236, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.retail_order_items SET realized_revenue_rsd = line_total WHERE realized_revenue_rsd = 0 AND line_total > 0
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_order_items). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5743-5791. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1293-e4681f51bbe828b9
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1293-1305. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 27; source starts line 1293, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.retail_order_items AS item SET supplier_id = COALESCE(item.supplier_id, product.supplier_id), supplier_name = COALESCE(item.supplier_name, supplier.name), supplier_slug = COALESCE(item.supplier_slug, supplier.slug), product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference), product_sku_snapshot = COALESCE(item.product_sku_snapshot, product.sku), discount_snapshot = COALESCE(item.discount_snapshot, CASE WHEN product.public_price IS NOT NULL AND product.public_price > item.unit_price THEN product.public_price - item.unit_price ELSE NULL END), line_subtotal = COALESCE(item.line_subtotal, item.unit_price * item.quantity), line_total = COALESCE(item.line_total, item.unit_price * item.quantity) FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id WHERE item.product_id = product.id
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_order_items, products, suppliers). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5743-5791. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1594-1614. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 32; source starts line 1594, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** role data conversion or enum-label DDL. Live enum-label state selects either a users.role rewrite or ALTER TYPE RENAME VALUE; category data-backfill therefore masks a catalog effect.
- **Repeat safety:** **Branch-convergent only; UNKNOWN deployment safety** — A completed role rewrite can become a no-op, while enum rename changes catalog state. Source does not prove all historic values/consumers tolerate either branch.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (users, user_role; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical users definition at lib/db/migrations/000001_canonical_schema/migration.sql:6795-6813. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1888-578a52d56c8c901a
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1888-1891. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 33; source starts line 1888, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.package_service_links l SET quota = p.session_count FROM ${s}.treatment_packages p WHERE l.package_id = p.id AND l.quota IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (package_service_links, treatment_packages). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical package_service_links definition at lib/db/migrations/000001_canonical_schema/migration.sql:5173-5179. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1955-d8aebdcf413ec207
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1955-1959. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 34; source starts line 1955, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.package_purchase_service_links l SET total_quota = p.total_sessions, remaining_quota = p.remaining_sessions FROM ${s}.customer_package_purchases p WHERE l.purchase_id = p.id AND l.total_quota = 0 AND l.remaining_quota = 0
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (package_purchase_service_links, customer_package_purchases). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical package_purchase_service_links definition at lib/db/migrations/000001_canonical_schema/migration.sql:5138-5145. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-1993-78f264bf1242ad45
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:1993-2006. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 35; source starts line 1993, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF EXISTS ( SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'appointments' AND column_name = 'service_id' ) THEN UPDATE ${s}.package_redemptions r SET service_id = a.service_id FROM ${s}.appointments a WHERE r.appointment_id = a.id AND r.service_id IS NULL; END IF; END $$
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (package_redemptions, appointments; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical package_redemptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:5152-5166. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2182-1dcabc3abb504aa4
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2182-2183. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 36; source starts line 2182, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.beauty_job_platform_settings (listing_expiry_days, hourly_posting_limit) SELECT 30, 5 WHERE NOT EXISTS (SELECT 1 FROM ${s}.beauty_job_platform_settings)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (beauty_job_platform_settings). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical beauty_job_platform_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:2528-2536. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2359-05cc08a5872f1ce2
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2359-2382. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 37; source starts line 2359, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.beauty_job_categories (slug, name, subtype_labels, enabled, feature_flag) VALUES ('frizeri', 'Frizeri', '["Ženski frizer", "Muški frizer", "Kolorista"]'::jsonb, true, NULL), ('barberi', 'Barberi', '["Šišanje", "Brijanje", "Stilizovanje brade"]'::jsonb, true, NULL), ('kozmetika', 'Kozmetika', '[]'::jsonb, true, NULL), ('kozmeticari', 'Kozmetičari', '["Nega lica", "Depilacija", "Tretmani tela"]'::jsonb, true, NULL), ('nokti', 'Nokti (Manikir/Pedikir)', '["Manikir", "Pedikir", "Nail artist"]'::jsonb, true, NULL), ('lash-brow', 'Lash/Brow', '["Ekstenzije trepavica", "Laminacija trepavica", "Obrve"]'::jsonb, true, NULL), ('make-up', 'Make-up', '["Dnevna šminka", "Svečana šminka"]'::jsonb, true, NULL), ('sminkeri', 'Šminkeri', '["Dnevna šminka", "Svečana šminka", "Editorial"]'::jsonb, true, NULL), ('pmu', 'PMU', '["Obrve", "Usne", "Eyeliner"]'::jsonb, true, NULL), ('estetika-masaza', 'Estetika i masaža', '["Estetika", "Masaža", "Terapeut"]'::jsonb, true, NULL), ('masaza-terapeuti', 'Masaža/Terapeuti', '["Relaks masaža", "Sportska masaža", "Terapeut"]'::jsonb, true, NULL), ('estetika-anti-aging', 'Estetika/anti-aging', '["Anti-aging", "Mezoterapija", "Nega lica"]'::jsonb, true, NULL), ('pomocno-osoblje', 'Pomoćno osoblje', '["Recepcija", "Asistent u salonu", "Šampon"]'::jsonb, true, NULL), ('tattoo-piercing', 'Tattoo/Piercing', '["Tattoo", "Piercing"]'::jsonb, true, 'beauty_jobs_tattoo_piercing'), ('iznajmljivanje-opreme', 'Iznajmljivanje opreme', '[]'::jsonb, true, NULL), ('iznajmljivanje-prostora-stolice', 'Iznajmljivanje prostora/stolice', '["Stolica", "Kabina", "Prostor"]'::jsonb, true, NULL), ('freelance-angazmani', 'Freelance/angažmani', '[]'::jsonb, true, NULL) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, subtype_labels = EXCLUDED.subtype_labels, enabled = EXCLUDED.enabled, feature_flag = EXCLUDED.feature_flag, updated_at = now()
- **Repeat safety:** **Repeatable but not a no-op** — ON CONFLICT(slug) DO UPDATE rewrites every curated category and updated_at=now() every full-rollout execution.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (beauty_job_categories). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical beauty_job_categories definition at lib/db/migrations/000001_canonical_schema/migration.sql:2403-2412. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-239-3c7d7a0db051017c
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:239-248, plus helper scaffolding at 217-227 (validSettings and payload interpolation). Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 2; source starts line 239, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_installments installment SET payment_instructions_snapshot = jsonb_build_object( 'payload', ${payload("installment.amount", "installment.payment_reference")}, 'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account, 'purpose', settings.ips_purpose, 'amount', installment.amount, 'currency', 'RSD', 'reference', installment.payment_reference, 'paymentCode', '221') FROM ${validSettings} settings WHERE installment.payment_instructions_snapshot IS NULL AND installment.status = 'pending' AND installment.amount > 0 AND btrim(COALESCE(installment.payment_reference, '')) <> ''
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_installments). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_installments definition at lib/db/migrations/000001_canonical_schema/migration.sql:3889-3903. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2422-7a8726353abf6169
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2422-2422. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 38; source starts line 2422, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.shop_settings DEFAULT VALUES ON CONFLICT DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (shop_settings). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical shop_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:6555-6583. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2695-39cdb0336fc9d71c
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2695-2709. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 44; source starts line 2695, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF to_regclass('course_enrollments') IS NOT NULL THEN UPDATE ${s}.users u SET role = 'JOBSEEKER' WHERE u.role = 'CUSTOMER' AND (EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id) OR EXISTS ( SELECT 1 FROM ${s}.course_enrollments e WHERE e.user_id = u.id OR e.purchaser_id = u.id )); ELSE UPDATE ${s}.users u SET role = 'JOBSEEKER' WHERE u.role = 'CUSTOMER' AND EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id); END IF; END $$
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (users, beauty_job_listings, course_enrollments). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical users definition at lib/db/migrations/000001_canonical_schema/migration.sql:6795-6813. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2881-fac76aef0bba8911
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2881-2881. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 47; source starts line 2881, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.retail_product_subscriptions SET anchor_day = EXTRACT(DAY FROM next_due_at)::integer WHERE anchor_day IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_product_subscriptions). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_product_subscriptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:5946-5969. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2919-6b25b308a9585583
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2919-2933. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 48; source starts line 2919, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF EXISTS ( SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'retail_product_reviews' AND column_name = 'moderation_status' AND udt_name <> 'retail_review_moderation_status' ) THEN UPDATE ${s}.retail_product_reviews SET moderation_status = 'PUBLISHED' WHERE moderation_status IN ('APPROVED', 'PENDING'); UPDATE ${s}.retail_product_reviews SET moderation_status = 'REMOVED' WHERE moderation_status = 'REJECTED'; ALTER TABLE ${s}.retail_product_reviews ALTER COLUMN moderation_status TYPE ${s}.retail_review_moderation_status USING moderation_status::${s}.retail_review_moderation_status; END IF; END $$
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_product_reviews, retail_review_moderation_status; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_product_reviews definition at lib/db/migrations/000001_canonical_schema/migration.sql:5906-5919. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2936-d3851b0242da2b62
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2936-2941. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 49; source starts line 2936, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. WITH ranked AS ( SELECT id, row_number() OVER (PARTITION BY product_id, user_id ORDER BY updated_at DESC, id DESC) AS position FROM ${s}.retail_product_reviews WHERE moderation_status <> 'REMOVED' ) UPDATE ${s}.retail_product_reviews review SET moderation_status = 'REMOVED', removed_at = coalesce(removed_at, now()) FROM ranked WHERE review.id = ranked.id AND ranked.position > 1
- **Repeat safety:** **Current-state reconciliation, not proven repeat-safe** — It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_product_reviews). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_product_reviews definition at lib/db/migrations/000001_canonical_schema/migration.sql:5906-5919. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2968-494603558aae3266
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2968-2975. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 50; source starts line 2968, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.products product SET average_rating = COALESCE(aggregate.average_rating, 0), review_count = COALESCE(aggregate.review_count, 0) FROM ( SELECT product_id, round(avg(rating)::numeric)::integer AS average_rating, count(*)::integer AS review_count FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED' GROUP BY product_id ) aggregate WHERE product.id = aggregate.product_id
- **Repeat safety:** **Current-state reconciliation, not proven repeat-safe** — It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (products, retail_product_reviews). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-2976-412e8f0768e1bc53
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:2976-2977. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 51; source starts line 2976, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.products SET average_rating = 0, review_count = 0 WHERE id NOT IN (SELECT DISTINCT product_id FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED')
- **Repeat safety:** **Current-state reconciliation, not proven repeat-safe** — It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (products, retail_product_reviews). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3132-bf601a52b45412ad
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3132-3132. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 53; source starts line 3132, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.b2c_display_settings DEFAULT VALUES ON CONFLICT DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (b). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** no CREATE TABLE public.b block located by exact static search. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3331-f96678a064f57e85
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3331-3331. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 54; source starts line 3331, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.aftercare_settings (version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${s}.aftercare_settings)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (aftercare_settings). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical aftercare_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:1878-1895. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3572-250192559736fe3b
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3572-3575. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 59; source starts line 3572, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.employee_location_assignments (employee_id, salon_id, active, is_default) SELECT id, salon_id, true, true FROM ${s}.employees ON CONFLICT (employee_id, salon_id) DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (employee_location_assignments, employees). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical employee_location_assignments definition at lib/db/migrations/000001_canonical_schema/migration.sql:4531-4539. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3596-db0912b7323d3d0c
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3596-3605. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 60; source starts line 3596, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF to_regclass('${s}.employee_schedules') IS NOT NULL THEN INSERT INTO ${s}.employee_location_schedules (employee_id, salon_id, weekday, start_time, end_time, break_start, break_end) SELECT es.employee_id, e.salon_id, es.weekday, es.start_time, es.end_time, es.break_start, es.break_end FROM ${s}.employee_schedules es INNER JOIN ${s}.employees e ON e.id = es.employee_id ON CONFLICT (employee_id, salon_id, weekday, start_time, end_time) DO NOTHING; END IF; END $$
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (employee_schedules, employee_location_schedules, employees). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical employee_location_schedules definition at lib/db/migrations/000001_canonical_schema/migration.sql:4546-4557. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3654-b0ba64dd10e18464
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3654-3655. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 61; source starts line 3654, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.salon_booking_settings (salon_id) SELECT id FROM ${s}.salons ON CONFLICT (salon_id) DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (salon_booking_settings, salons). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical salon_booking_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:6088-6104. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3711-e115085ae3a4eea5
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3711-3717. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 62; source starts line 3711, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.appointments SET planned_date=COALESCE(planned_date, appointment_date), planned_start_time=COALESCE(planned_start_time, start_time), planned_end_time=COALESCE(planned_end_time, end_time) WHERE (planned_date IS NULL AND appointment_date IS NOT NULL) OR (planned_start_time IS NULL AND start_time IS NOT NULL) OR (planned_end_time IS NULL AND end_time IS NOT NULL)
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (appointments). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical appointments definition at lib/db/migrations/000001_canonical_schema/migration.sql:2040-2090. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3730-d7b68a70ac97f701
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3730-3732. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 63; source starts line 3730, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.appointment_status_history SET occurred_at = COALESCE(occurred_at, created_at) WHERE occurred_at IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (appointment_status_history). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical appointment_status_history definition at lib/db/migrations/000001_canonical_schema/migration.sql:1980-1988. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3755-614961c1b7f1f97a
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3755-3763. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 64; source starts line 3755, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.appointment_treatments (appointment_id, service_id, employee_id, position, duration_minutes, buffer_minutes, price, planned_start_time, planned_end_time) SELECT a.id, a.service_id, a.employee_id, 0, a.duration_minutes, COALESCE(svc.buffer_minutes, 0), a.price, a.start_time, a.end_time FROM ${s}.appointments a JOIN ${s}.services svc ON svc.id=a.service_id WHERE a.service_id IS NOT NULL AND a.duration_minutes IS NOT NULL AND a.duration_minutes > 0 AND a.price IS NOT NULL ON CONFLICT (appointment_id, position) DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (appointment_treatments, appointments, services). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical appointment_treatments definition at lib/db/migrations/000001_canonical_schema/migration.sql:1995-2012. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3986-3bf6cb92731753e4
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3986-3993. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 65; source starts line 3986, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. WITH ranked AS ( SELECT id, row_number() OVER ( PARTITION BY kind, scope, coalesce(scope_category_id::text, scope_subcategory_id::text, 'home'), slot_number ORDER BY starts_at DESC NULLS LAST, created_at DESC ) AS rn FROM ${s}.education_placements WHERE status = 'active' ) UPDATE ${s}.education_placements p SET status = 'expired', updated_at = now() FROM ranked r WHERE p.id = r.id AND r.rn > 1
- **Repeat safety:** **Current-state reconciliation, not proven repeat-safe** — It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placements). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_placements definition at lib/db/migrations/000001_canonical_schema/migration.sql:4167-4200. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-3997-5176a2b88baf0779
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:3997-4004. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 66; source starts line 3997, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_placements p SET duration_days_snapshot = coalesce(( SELECT ps.duration_days FROM ${s}.education_placement_settings ps WHERE ps.kind = p.kind AND ps.scope = p.scope LIMIT 1 ), 30) WHERE p.duration_days_snapshot IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placements, education_placement_settings). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_placements definition at lib/db/migrations/000001_canonical_schema/migration.sql:4167-4200. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4045-8ed7a084462e9112
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4045-4047. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 67; source starts line 4045, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.education_placement_settings (kind, scope, price, slot_count, duration_days) VALUES ('featured_salon', 'home', 5000, 12, 30) ON CONFLICT (kind, scope) DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placement_settings). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_placement_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:4147-4160. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4048-10e4a54f14166cb6
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4048-4050. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 68; source starts line 4048, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_placements SET payment_reference = 'FP-' || replace(id::text, '-', '') WHERE payment_reference IS NULL OR length(payment_reference) > 35
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placements). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_placements definition at lib/db/migrations/000001_canonical_schema/migration.sql:4167-4200. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4384-e015e2034c777257
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4384-4432. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 71; source starts line 4384, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** state-dependent cleanup/reconciliation plus report insertion. Finds narrowly patterned retired education-owner salons, nulls active_salon_id, retires salons, and inserts a v99 report; source comments explicitly say no historic tenant row is deleted.
- **Repeat safety:** **UNKNOWN — stateful historical cleanup** — Report INSERT uses ON CONFLICT DO NOTHING, but candidate selection and user/salon updates precede it on every low-version retry; source cannot prove the predicate identifies only intended legacy rows.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_salon_cleanup_reports, salons, users, education_centers; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_salon_cleanup_reports definition at lib/db/migrations/000001_canonical_schema/migration.sql:4294-4301. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4440-3b021060842ebb73
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4440-4440. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 72; source starts line 4440, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.education_b2b_discount_settings (id, version) VALUES (true, 1) ON CONFLICT (id) DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_b). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** no CREATE TABLE public.education_b block located by exact static search. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4549-fee2c22731f4db15
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4549-4549. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 73; source starts line 4549, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.salons SET payment_reference_number = 'SAL' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (salons). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical salons definition at lib/db/migrations/000001_canonical_schema/migration.sql:6298-6338. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4550-6ad13fc9e1caeb85
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4550-4550. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 74; source starts line 4550, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_centers SET payment_reference_number = 'EDU' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_centers). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_centers definition at lib/db/migrations/000001_canonical_schema/migration.sql:3550-3587. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4605-bca8bd2f500d308e
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4605-4611. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 76; source starts line 4605, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.subscription_plans (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active) SELECT 'Education legacy ' || p.id::text, p.price, 30, p.features, p.limits, 'education', COALESCE((p.limits->>'courses')::integer, 5), true, 'Cena uključuje PDV.', p.active FROM ${s}.subscription_plans p WHERE EXISTS (SELECT 1 FROM ${s}.education_center_subscriptions e WHERE e.plan_id = p.id) AND EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = p.id) AND NOT EXISTS (SELECT 1 FROM ${s}.subscription_plans clone WHERE clone.name = 'Education legacy ' || p.id::text)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans, education_center_subscriptions, subscriptions). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4612-65b1d33770d816b1
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4612-4616. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 77; source starts line 4612, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_center_subscriptions e SET plan_id = clone.id FROM ${s}.subscription_plans legacy JOIN ${s}.subscription_plans clone ON clone.name = 'Education legacy ' || legacy.id::text WHERE e.plan_id = legacy.id AND EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = legacy.id)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_center_subscriptions, subscription_plans, subscriptions). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_center_subscriptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:3509-3543. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4617-2b63853ba688a383
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4617-4619. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 78; source starts line 4617, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.subscription_plans p SET audience = 'education' WHERE EXISTS (SELECT 1 FROM ${s}.education_center_subscriptions e WHERE e.plan_id = p.id) AND NOT EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = p.id)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans, education_center_subscriptions, subscriptions). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4620-20518488727fd1ea
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4620-4627. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 79; source starts line 4620, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. WITH ranked AS ( SELECT p.id, row_number() over (ORDER BY p.price, p.id) AS tier FROM ${s}.subscription_plans p WHERE p.audience = 'education' ) UPDATE ${s}.subscription_plans p SET course_limit = CASE ranked.tier WHEN 1 THEN 5 WHEN 2 THEN 15 ELSE 30 END, trial_days = 30, vat_included = true, price_copy = COALESCE(p.price_copy, 'Cena uključuje PDV.') FROM ranked WHERE p.id = ranked.id AND ranked.tier <= 3 AND p.course_limit IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4628-9cb6b5d7843e9b57
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4628-4632. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 80; source starts line 4628, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.subscription_plans (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active) SELECT seed.name, 0, 30, '[]'::jsonb, jsonb_build_object('courses', seed.course_limit), 'education', seed.course_limit, true, 'Cena uključuje PDV.', false FROM (VALUES ('Education Start', 5), ('Education Growth', 15), ('Education Academy', 30)) seed(name, course_limit) WHERE NOT EXISTS (SELECT 1 FROM ${s}.subscription_plans p WHERE p.audience='education' AND p.course_limit=seed.course_limit)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4633-646139d3dc75e519
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4633-4636. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 81; source starts line 4633, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.subscription_plans SET active = CASE WHEN price > 0 THEN active ELSE false END, trial_days = 30, vat_included = true, price_copy = 'Cena uključuje PDV.' WHERE audience = 'education' AND name IN ('Education Start', 'Education Growth', 'Education Academy') AND course_limit IN (5,15,30)
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4637-02f9ac5d3b3e194f
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4637-4637. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 82; source starts line 4637, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.subscription_plans SET active = false WHERE audience = 'education' AND price <= 0
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4638-413cfe6b52f96aea
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4638-4639. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 83; source starts line 4638, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.subscription_plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{courses}', to_jsonb(course_limit)) WHERE audience='education' AND course_limit IS NOT NULL
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4644-20d1b40e2d83dc7f
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4644-4647. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 84; source starts line 4644, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_center_subscriptions e SET current_price_snapshot = COALESCE(e.current_price_snapshot, p.price), current_course_limit_snapshot = COALESCE(e.current_course_limit_snapshot, e.course_limit_override, p.course_limit) FROM ${s}.subscription_plans p WHERE p.id=e.plan_id AND e.status IN ('trial','active','free_via_loyalty')
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_center_subscriptions, subscription_plans). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_center_subscriptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:3509-3543. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4750-a8631b053767de30
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4750-4755. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 85; source starts line 4750, column 6. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_platform_settings SET bank_reconciliation_access_method=NULL, bank_reconciliation_access_confirmed_at=NULL, bank_reconciliation_access_confirmed_by_user_id=NULL WHERE bank_reconciliation_access_confirmed_at IS NULL OR bank_reconciliation_access_confirmed_by_user_id IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_platform_settings). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_platform_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:4207-4228. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4801-3cae2900c669c65a
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4801-4813. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 86; source starts line 4801, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.course_enrollments enrollment SET access_days_snapshot = COALESCE(enrollment.access_days_snapshot, course.online_access_days), course_price_snapshot = COALESCE(enrollment.course_price_snapshot, course.price), duration_snapshot = COALESCE(enrollment.duration_snapshot, course.duration), extension_prices_snapshot = COALESCE(enrollment.extension_prices_snapshot, jsonb_build_object('oneMonth', course.extension_price_1_month, 'threeMonths', course.extension_price_3_months, 'sixMonths', course.extension_price_6_months)), access_expires_at = CASE WHEN enrollment.access_expires_at IS NULL THEN COALESCE(enrollment.access_granted_at, enrollment.purchased_at, now()) + make_interval(days => course.online_access_days) ELSE enrollment.access_expires_at END FROM ${s}.courses course WHERE enrollment.course_id = course.id AND course.format = 'online' AND enrollment.status IN ('active','completed') AND enrollment.payment_status = 'paid' AND course.online_access_days > 0
- **Repeat safety:** **Conditionally convergent but time-sensitive** — COALESCE preserves snapshots, but null access_expires_at derives from now(); source does not prove historical course values or concurrent-writer behavior.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (course_enrollments, courses). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical course_enrollments definition at lib/db/migrations/000001_canonical_schema/migration.sql:2881-2921. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4881-71c900be3d31c484
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4881-4888. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 87; source 4881-4888 follows v104 columns (4873-4877) and v105 checks (4879-4880). It is immediately followed by `CREATE UNIQUE INDEX IF NOT EXISTS ... (subscription_id, kind)` with the same pending/kind predicate (4889-4891). Runner locks and only runs the full array on an absent/lower marker, but executes statements in autocommit. Thus interruption after this UPDATE but before that index, or after index creation but before its drop at 4893, leaves a real intermediate state. Current-version fast path returns at 5125; failure before marker write 5139-5148 permits revisiting.
- **Dependencies:** education_payment_obligations subscription_id, kind, issued_at, id, status, cancelled_at; preceding v104/v105 rollout work; and the immediately following per-kind unique index.
- **Effects:** payment-obligation reconciliation. For each `(subscription_id, kind)` partition of pending non-null-subscription renewal/upgrade obligations, preserves exactly rank 1 ordered `issued_at ASC, id ASC` (earliest issued time, then lowest ID) and cancels every later row, setting `cancelled_at = now()`. It does **not** choose between renewal and upgrade.
- **Repeat safety:** **Current-state convergence only** — Cancelled rows cease to be pending, so unchanged state can converge per subscription and kind. This is not a safe-retry proof: current/new pending rows, exact issued_at/id ordering, `now()`, and the autocommit interval around the following index remain state-dependent.
- **State dependence:** Reads current pending education_payment_obligations and ranks exactly by subscription_id, kind, issued_at ASC, id ASC; the following partial per-kind index changes future admissible state. No production DB was inspected. Winner correctness, NULL issued_at behavior, concurrent writers, index validity, and interrupted-state effects remain unverified.
- **Canonical comparison:** canonical education_payment_obligations definition at lib/db/migrations/000001_canonical_schema/migration.sql:4086-4121. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4894-2fb599a7e242329d
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4894-4904. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 88; source 4894-4904 follows the per-kind index creation at 4889-4891 and `DROP INDEX IF EXISTS` of that exact index at 4893. Its immediate successor is an **unguarded** `CREATE UNIQUE INDEX` on `subscription_id` alone with the same pending/kind predicate (4905-4907). Full-array execution is locked but autocommit: this UPDATE can run after the per-kind index is dropped and before the final per-subscription index exists; an interruption there leaves neither index enforcing one pending obligation. Current-version fast path returns at 5125; failure before marker write 5139-5148 permits revisiting.
- **Dependencies:** the immediately preceding per-kind create/drop, education_payment_obligations subscription_id, kind, issued_at, id, status, cancelled_at, and successful following per-subscription partial unique-index creation.
- **Effects:** payment-obligation reconciliation. For each subscription across pending renewal and upgrade obligations, preserves exactly **one** row: upgrade precedes renewal (`CASE` yields 0 versus 1); within the preferred kind it selects `issued_at DESC, id ASC` (newest issue time, then lowest ID). It cancels all other rows and sets `cancelled_at = now()`.
- **Repeat safety:** **Current-state convergence only** — Cancelled rows no longer match pending, so unchanged state can converge to one qualifying row per subscription. It is not a safe-retry proof: selection depends on current kinds/timestamps/IDs, writes `now()`, and interruption before the unguarded final index can leave a no-index state; replay after final-index creation has different failure conditions.
- **State dependence:** Reads current pending education_payment_obligations and ranks exactly by subscription, upgrade-before-renewal, issued_at DESC, id ASC; it also depends on preceding drop and later unguarded index creation. No production DB was inspected. Correct survivor, NULL issued_at behavior, writers in the no-index interval, retry index state/validity, and cancellation correctness remain unverified.
- **Canonical comparison:** canonical education_payment_obligations definition at lib/db/migrations/000001_canonical_schema/migration.sql:4086-4121. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4923-4927. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 89; source starts line 4923, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_bundle_purchases SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30), payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true) WHERE payment_reference IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_bundle_purchases). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_bundle_purchases definition at lib/db/migrations/000001_canonical_schema/migration.sql:3421-3448. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:4928-4930. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 90; source starts line 4928, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.education_bundle_purchases SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true) WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (education_bundle_purchases). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical education_bundle_purchases definition at lib/db/migrations/000001_canonical_schema/migration.sql:3421-3448. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-515-8dbd4712bbb5dcb2
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:515-532. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 3; source starts line 515, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data copy with trigger-state changes. Temporarily DISABLE TRIGGER USER on two referral financial tables, copies legacy amount into null amount_rsd fields if legacy columns exist, then ENABLEs in normal and exception paths.
- **Repeat safety:** **Conditionally convergent, not production-safe proof** — Only amount_rsd IS NULL rows update; trigger disable/enable is operational, legacy columns are catalog-conditional, and safe retry under all failures, permissions, and concurrency is not established. Exception path attempts re-enable then re-raises.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (referral_credit_ledger, referral_credit_redemptions; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical referral_credit_ledger definition at lib/db/migrations/000001_canonical_schema/migration.sql:5563-5580. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-642-75642b872948bafa
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:642-644. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 6; source starts line 642, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** data insertion / seed or derived-row backfill. INSERT INTO ${s}.suppliers (id, name, slug, scope, active) VALUES ('9b5970ea-0a8c-5e60-9d32-2a09f0890560', 'LUMERA Legacy Catalog', 'lumera-legacy', 'BOTH', true) ON CONFLICT (slug) DO NOTHING
- **Repeat safety:** **Conditionally repeatable, not production-safe proof** — Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (suppliers). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical suppliers definition at lib/db/migrations/000001_canonical_schema/migration.sql:6698-6707. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-646-85bc0eb2701b10cf
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:646-648. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 7; source starts line 646, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.product_categories SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560' WHERE supplier_id IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (product_categories). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical product_categories definition at lib/db/migrations/000001_canonical_schema/migration.sql:5309-5319. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-714-c3afd57975f260f8
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:714-716. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 8; source starts line 714, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.products SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560' WHERE supplier_id IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (products). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-795-ccea7319f2053e67
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:795-797. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 10; source starts line 795, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.products SET catalog_reference = 'LUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) WHERE catalog_reference IS NULL OR btrim(catalog_reference) = ''
- **Repeat safety:** **Conditionally convergent with randomness risk** — NULL/blank predicate blocks a second successful generation; gen_random_uuid makes first values nondeterministic and source does not prove collision/concurrency safety.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (products). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-834-3074db9313c774db
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:834-837. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 11; source starts line 834, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.retail_cart_items AS item SET product_catalog_reference = product.catalog_reference FROM ${s}.products AS product WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_cart_items, products). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_cart_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5703-5718. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-841-b832bbaa7343d506
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:841-910. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 12; source starts line 841, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data reconciliation plus conditional constraint/index replacement. When the named legacy unique index has NULLS DISTINCT semantics, sums duplicate NULL-variant cart quantities into the first row, deletes later duplicates, then drops the constraint/index; it can raise on integer overflow.
- **Repeat safety:** **UNKNOWN — not proven repeat-safe** — Outer pg_index predicate may become false only after it drops the named index/constraint, but it aggregates/deletes current rows. Correctness depends on exact duplicates, integer range, privileges, and later index recreation.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_cart_items; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_cart_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5703-5718. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-949-43751b9dc71e8688
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:949-960. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 13; source starts line 949, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'status') THEN UPDATE ${s}.orders SET fulfillment_status = CASE WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status ELSE 'RECEIVED'::${s}.fulfillment_status END WHERE fulfillment_status = 'RECEIVED'; END IF; END $$
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (orders, fulfillment_status; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical orders definition at lib/db/migrations/000001_canonical_schema/migration.sql:5084-5131. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-961-843af46de48ee47e
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:961-972. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 14; source starts line 961, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** catalog-guarded existing-data reconciliation. DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'retail_orders' AND column_name = 'status') THEN UPDATE ${s}.retail_orders SET fulfillment_status = CASE WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status ELSE 'RECEIVED'::${s}.fulfillment_status END WHERE fulfillment_status = 'RECEIVED'; END IF; END $$
- **Repeat safety:** **UNKNOWN** — No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_orders, fulfillment_status; catalog predicates). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_orders definition at lib/db/migrations/000001_canonical_schema/migration.sql:5815-5855. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

### ensureBusinessGrowthSchema/source-discovered-977-05799e55766b423f
- **Location / raw evidence:** artifacts/api-server/src/lib/business-growth-schema.ts:977-978. Full verbatim source/SQL: companion bg-data.json under this ID.
- **Order / guards:** tableStatements literal executionOrder 15; source starts line 977, column 5. Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138). Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.
- **Dependencies:** Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review.
- **Effects:** existing-data mutation. UPDATE ${s}.retail_orders SET tracking_token_expires_at = created_at + interval '180 days' WHERE tracking_token_expires_at IS NULL
- **Repeat safety:** **Predicate-convergent only** — The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data.
- **State dependence:** Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_orders). No production database was inspected. Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified.
- **Canonical comparison:** canonical retail_orders definition at lib/db/migrations/000001_canonical_schema/migration.sql:5815-5855. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001. **NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision.**
- **Provisional assessment:** **UNRESOLVED; NEVER resolved by this report.** Required before any decision: Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision.

## Questions for independent review

1. The census resolves literal/ID cardinality: 70 DML literals comprise 69 links to 67 data-backfill IDs (two two-literal grouped IDs) plus L096, the rollout-marker-write DML literal. This is a grouping/category distinction, not an outstanding completeness uncertainty.
2. Characterize, read-only and with approval, every live row selected by NULL/zero/status/catalog predicates and validate financial/payment, role, subscription, access-expiry, and cleanup correctness.
3. Separate one-time history from ongoing reconciliation: review aggregates, placement/payment-obligation ranking, cleanup, seed upserts, and now/random derivations independently.
4. Prove or reject safety around trigger disable/drop/recreate, enum rename, catalog DO branches, autocommit partial completion, concurrent writers, and rollback/compensation.
5. Decide the approved semantic migration or retained runtime behavior; canonical definition parity cannot replace data-effect evidence.

---

## Final source markdown: bg-functions.md

# Business Growth function-replacement evidence audit

**Scope:** only crosswalk `additionalOperations` owned by `ensureBusinessGrowthSchema` with category `function-replacement`. This is a read-only evidence audit. **Every record remains UNRESOLVED.** The companion `bg-functions.json` preserves verbatim source SQL/relevant source and full canonical function text.

## Scope and completeness

- Selected **32 records** and **21 distinct function names**. All 32 IDs are unique. The authoritative crosswalk was not changed; it reports 110 additional operations across eight owners. This focused report deliberately excludes other owners/categories.
- Immutable canonical baseline: `lib/db/migrations/000001_canonical_schema/migration.sql`; SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`, matching the crosswalk.
- Startup evidence: `artifacts/api-server/src/index.ts:81-92` awaits `ensureBusinessGrowthSchema()` before `listen()` and workers. The runner at `business-growth-schema.ts:4991-5161` acquires a session advisory lock (5002-5006), states it runs autocommit (4983-4986), and sequentially issues static array entries (5132-5137).
- No production DB/state was inspected. No code, runtime, source, migration, pin, DB/network, or git changes were made; only these two assigned report files are written.

## Execution and canonical boundary

- The owner is invoked every startup, but static function literals are **not** every-startup SQL: a missing/behind rollout tracker takes the static-array branch; a current tracker takes the fast path and returns (`business-growth-schema.ts:5035-5043,5125`).
- The curated voucher replacement is fast-path code at 5051-5066. The curated bundle-payment replacement is fast-path code at 5112-5120 and additionally guarded by `to_regclass` at 5087. Each can run on every qualifying current-version boot.
- A replacement directly changes a function catalog/runtime policy, not startup rows. The trigger can later reject DML, read/lock rows, or—only for `enqueue_restocked_product_waitlist`—insert/update rows when fired. Adjacent updates/reconciliation are dependencies and are not attributed to this function statement.
- Canonical 000001 creates a fresh `public` schema definition. A matched body is not proof that tracker-gated dynamic-schema `CREATE OR REPLACE`, trigger rebinding, rollback/retry behavior, or current-state reconciliation is unnecessary.
- **Semantic categories:** canonical evidence is a schema **definition**; the function replacement has **no historical-data transformation** and **no current-data reconciliation** by itself; its body has **runtime operational behavior** when invoked by triggers. Adjacent reconciliation is dependency-only and remains separately unverified.

## Inventory by function

| Function | Records | Source ranges | Canonical complete-body range | Provisional evidence |
|---|---:|---|---|---|
| `assign_immutable_business_payment_reference` | 1 | 4551:5 | 1296-1309 | UNRESOLVED |
| `enforce_supplier_catalog_ownership` | 1 | 747:5 | 1316-1352 | UNRESOLVED |
| `enqueue_restocked_product_waitlist` | 1 | 2625:5 | 1359-1377 | UNRESOLVED |
| `prevent_b2b_invoice_snapshot_update` | 1 | 2845:5 | 1384-1393 | UNRESOLVED |
| `prevent_coupon_order_snapshot_update` | 1 | 2832:5 | 1400-1407 | UNRESOLVED |
| `prevent_education_gift_voucher_snapshot_update` | 3 | 5051-5066, 4140:5, 4168:5 | 1414-1430 | UNRESOLVED — semantic difference recorded |
| `prevent_incomplete_commercial_snapshot_insert` | 1 | 1137:5 | 1437-1448 | UNRESOLVED |
| `prevent_order_bundle_component_update` | 1 | 2500:5 | 1455-1459 | UNRESOLVED |
| `prevent_order_g2_snapshot_update` | 1 | 1427:5 | 1466-1475 | UNRESOLVED |
| `prevent_order_item_commercial_snapshot_update` | 6 | 1101:5, 1110:5, 1203:5, 1342:5, 2646:5, 3453:5 | 1482-1523 | UNRESOLVED — semantic difference recorded |
| `prevent_order_promotion_snapshot_update` | 1 | 1013:5 | 1530-1538 | UNRESOLVED |
| `prevent_retail_g2_snapshot_update` | 1 | 1415:5 | 1545-1554 | UNRESOLVED |
| `prevent_retail_order_item_commercial_snapshot_update` | 4 | 1127:5, 1377:5, 2683:5, 3494:5 | 1561-1606 | UNRESOLVED — semantic difference recorded |
| `prevent_retail_order_promotion_snapshot_update` | 1 | 1024:5 | 1613-1621 | UNRESOLVED |
| `protect_aftercare_evidence` | 1 | 3428:5 | 1628-1637 | UNRESOLVED |
| `protect_aftercare_line_evidence` | 1 | 3438:5 | 1644-1654 | UNRESOLVED |
| `referral_prevent_mutation` | 1 | 550:5 | 1661-1663 | UNRESOLVED |
| `referral_protect_attribution_identity` | 1 | 552:5 | 1670-1689 | UNRESOLVED |
| `reject_bundle_payment_reference_change` | 2 | 5112-5120, 4939:5 | 1696-1706 | UNRESOLVED |
| `validate_b2c_banner_destination` | 1 | 3100:5 | 1713-1726 | UNRESOLVED |
| `validate_bundle_component` | 1 | 2606:5 | 1733-1749 | UNRESOLVED |

## Individual evidence records

### `business-growth/bundle-payment-immutability-function`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:5112-5120`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:5112-5120`; `artifacts/api-server/src/lib/business-growth-schema.ts:5087-5124`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects bundle payment_reference/payment_instructions changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** After table guard, validation/column/trigger-drop/data reconciliation/index 5088-5111; this function 5112-5120; trigger creation 5121-5123. Current-version fast path plus education_bundle_purchases to_regclass guard at 5087; may execute each qualifying boot.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path at 4995,5008-5009; guarded table existence 5087; preceding payment reconciliation 5101-5108 and trigger create 5121-5123. Depends on tracker, guarded table, preceding payment-row reconciliation, and trigger/catalog state. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1696-1706`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `business-growth/gift-voucher-immutability-function`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:5051-5066`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:5051-5066`; `artifacts/api-server/src/lib/business-growth-schema.ts:5035-5069`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects voucher purchase/presentation snapshot changes; revisions differ. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** After tracker test, columns 5046-5050; this function 5051-5066; trigger drop/create 5067-5069. Current-version fast path only: relation exists and singleton version >= BUSINESS_GROWTH_SCHEMA_VERSION (5035-5043); executes each qualifying boot.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path at 4995,5008-5009; voucher table plus fields; two presentation fields added 5049-5050; trigger recreation 5067-5069. Depends on tracker, voucher catalog/columns, and current trigger binding. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1414-1430`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1013-2873cfc7bde28e7c`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1013:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1013-1020`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects order promotion snapshot changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1013-1020; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1530-1538`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1024-b6bf3966fbd7c255`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1024:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1024-1031`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects retail-order promotion snapshot changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1024-1031; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1613-1621`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1101-d98ce7dad1bf3273`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1101:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1101-1106`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent B2B commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1101-1106; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1482-1523`. DIFF (complete control-flow comparison): source has no OLD/NEW field set. It returns NEW only when current_setting('lumera.snapshot_backfill', true) = 'on'; otherwise it unconditionally raises. Canonical lines 1485-1523 have no GUC bypass and reject only changes in this complete named set: product_id, product_name, product_sku, price, quantity, supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, line_subtotal, line_total, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Therefore source is both broader while GUC is off and wholly bypassed while it is on. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1110-a554a73f2cc12f0d`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1110:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1110-1126`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent B2B commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1110-1126; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1482-1523`. DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, is_reward_gift, and reward_snapshot; it has no additional field predicate or GUC branch. It permits changes to every omitted field that canonical rejects. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1127-82d60245f86ef653`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1127:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1127-1133`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent retail commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1127-1133; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1561-1606`. DIFF (complete field-set comparison): source rejects exactly personalized_treatment_bundle_discount_rsd, post_treatment_recommendation_discount_rsd, and aftercare_recommendation_id. Against canonical lines 1565-1602 it omits exactly product_id, product_name, product_image_url, product_catalog_reference, variant_value, variant_label, quantity, supplier_id, supplier_name, supplier_slug, product_sku_snapshot, market, currency, unit_price, discount_snapshot, line_subtotal, line_total, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. There is no additional predicate or GUC branch. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1137-78d662770c04a367`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1137:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1137-1147`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects incomplete snapshots except with session backfill GUC. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1137-1147; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1437-1448`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1203-314a9adb25ea1a7a`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1203:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1203-1232`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent B2B commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1203-1232; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1482-1523`. DIFF (complete control-flow and field-set comparison): source first returns NEW when lumera.snapshot_backfill is on. When off it rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date. Canonical has no GUC bypass; source permits every named change while bypass is on. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1342-41322590b0facfaf`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1342:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1342-1376`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent B2B commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1342-1376; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1482-1523`. DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd. There is no GUC bypass or additional field predicate. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1377-7a16f65e6e343d67`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1377:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1377-1406`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent retail commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1377-1406; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1561-1606`. DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, personalized_treatment_bundle_discount_rsd, post_treatment_recommendation_discount_rsd, aftercare_recommendation_id, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1565-1602 it omits exactly product_id, product_name, product_image_url, variant_value, variant_label, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date. That is the entire canonical bundle group at lines 1583-1590, plus the listed identity/G2 fields. There is no GUC bypass or additional predicate. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1415-e4229e6071e9a67a`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1415:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1415-1423`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects retail G2 allocation changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1415-1423; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1545-1554`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-1427-c335b6f63de49bb8`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:1427:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:1427-1435`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects B2B G2 allocation changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 1427-1435; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1466-1475`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2500-b465c4834db0bf01`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2500:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2500-2503`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Always raises for covered bundle-component updates. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2500-2503; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1455-1459`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2606-f73073563692a53c`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2606:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2606-2621`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Locks/validates product/bundle supplier and variants. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2606-2621; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1733-1749`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2625-8d5de63e198cd17a`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2625:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2625-2642`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; When fired on stock 0→positive, inserts deduplicated outbox rows and updates matching waitlist rows to NOTIFIED. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2625-2642; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1359-1377`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2646-f754b207b4953c65`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2646:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2646-2680`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent B2B commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2646-2680; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1482-1523`. DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd. There is no GUC bypass or additional field predicate. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2683-5485f544de16d7bb`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2683:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2683-2688`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent retail commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2683-2688; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1561-1606`. DIFF (complete control-flow comparison): source does not enumerate business fields. It raises when (to_jsonb(NEW) - ARRAY['id','order_id','created_at','updated_at']) is distinct from the corresponding OLD JSON; it therefore protects every present row column except exactly id, order_id, created_at, and updated_at. Canonical lines 1565-1602 instead protects exactly this named set: product_id, product_name, product_image_url, product_catalog_reference, variant_value, variant_label, quantity, supplier_id, supplier_name, supplier_slug, product_sku_snapshot, market, currency, unit_price, discount_snapshot, line_subtotal, line_total, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, personalized_treatment_bundle_discount_rsd, post_treatment_recommendation_discount_rsd, aftercare_recommendation_id, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Both predicates permit changes to id, order_id, created_at, and updated_at. The difference is only that the source's universal-minus-four predicate rejects changes to any current/future non-excluded column outside canonical's explicit list. No GUC branch exists. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2832-30aedb47b317e08d`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2832:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2832-2838`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects coupon allocation changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2832-2838; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1400-1407`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-2845-4ff564bcb8cbfe1b`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:2845:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:2845-2853`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; After invoice issue, rejects invoice/coupon evidence changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 2845-2853; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1384-1393`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-3100-5160af5bfa71def3`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:3100:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:3100-3112`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Locks/validates supplier-owned retail-enabled destinations. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 3100-3112; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1713-1726`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-3428-ea1abf46bda6e98c`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:3428:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:3428-3435`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects changes to aftercare recommendation evidence. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 3428-3435; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1628-1637`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-3438-1b685f86e49f086f`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:3438:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:3438-3446`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects changes to aftercare line evidence. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 3438-3446; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1644-1654`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-3453-5f85daadd826e97e`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:3453:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:3453-3493`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent B2B commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 3453-3493; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1482-1523`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-3494-e2e6198fa61aa689`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:3494:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:3494-3538`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Revision-dependent retail commercial evidence enforcement; final body is named-field protection. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 3494-3538; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1561-1606`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-4140-168dce238fe4d30f`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:4140:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:4140-4154`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects voucher purchase/presentation snapshot changes; revisions differ. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 4140-4154; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1414-1430`. DIFF (complete field-set comparison): source rejects exactly course_id, center_id, purchaser_id, recipient_user_id, recipient_email, course_title_snapshot, course_image_url_snapshot, amount_snapshot, currency_snapshot, code_hash, code_last4, payment_reference. Against canonical lines 1418-1426 it omits exactly recipient_name_snapshot and gift_message_snapshot. There is no additional predicate or GUC branch. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-4168-0ef0ddc715fef765`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:4168:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:4168-4183`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects voucher purchase/presentation snapshot changes; revisions differ. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 4168-4183; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1414-1430`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-4551-946da234d73bf7e2`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:4551:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:4551-4562`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Assigns missing INSERT reference and rejects later reference changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 4551-4562; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1296-1309`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:4939:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:4939-4947`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects bundle payment_reference/payment_instructions changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 4939-4947; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1696-1706`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-550-f22c72e35ddc73eb`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:550:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:550-551`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Always raises; its bound referral UPDATE/DELETE calls fail. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 550-551; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1661-1663`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-552-338d4a1040e1d84d`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:552:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:552-570`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Rejects DELETE and named attribution identity changes. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 552-570; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1670-1689`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

### `ensureBusinessGrowthSchema/source-discovered-747-eb2ed4eed4debb49`

- **Owner and exact source:** `ensureBusinessGrowthSchema`; crosswalk source `artifacts/api-server/src/lib/business-growth-schema.ts:747:5`. Verbatim raw source SQL/code ranges: `artifacts/api-server/src/lib/business-growth-schema.ts:747-782`. The raw evidence is retained under this exact ID in `bg-functions.json`.
- **Effect type:** function replacement; Reads/locks supplier/category rows and rejects ownership, cycle, or scope violations. None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.
- **Order and conditional:** Static tableStatements literal at 747-782; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body. Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.
- **Dependencies and current-state dependence:** quoteSchema and SET search_path 4995,5008-5009; tableStatements begins 252; sequential query 5132-5137; prior successful table/column/trigger DDL. Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown. No database connection or production-state inspection.
- **Repeat safety:** **UNKNOWN.** CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety. Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected.
- **Canonical semantic comparison:** complete canonical body `lib/db/migrations/000001_canonical_schema/migration.sql:1316-1352`. MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical. 000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.
- **Provisional assessment:** **UNRESOLVED.** Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED. Required checks: Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment. Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML. Review adjacent trigger DDL and reconciliation separately.
- **Uncertainties:** Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence. Crosswalk numeric executionOrder is absent for these records; source line/array order is reported. Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion.

## Questions requiring independent review

1. In an approved evidence environment, do `pg_get_functiondef` results and trigger bindings match final canonical bodies after completed and interrupted rollouts?
2. Can a same-name interim body be observable to application DML during rolling/retry deployment before its later replacement?
3. Does a supported non-public `schemaName` invocation need separately managed canonical behavior, because 000001 defines only `public`?
4. Are the startup role ownership/privileges adequate for replacement, trigger execution, and the functions that SELECT/lock rows?
5. Do fast-path tracker/table predicates prove historical work completed, rather than merely recording a current version?

---

## Final source markdown: other-owners.md

# Additional startup operations — other owners evidence audit

**Audit boundary.** This companion covers the 16 records assigned to this
report: every `additionalOperations` record whose owner is not
`ensureBusinessGrowthSchema` (12), plus that owner's four
`cleanup-reporting`, `operational-scaffolding`, and `rollout-marker` records.
It deliberately does not assess the other 94 Business Growth records. The
machine-readable, verbatim source evidence is in
[`other-owners.json`](./other-owners.json). No production database was
contacted or inspected, and no source, migration, pin, crosswalk, runtime, or
database state was changed.

## Baseline and scope reconciliation

| Check | Evidence | Result |
|---|---|---|
| Startup owners | Crosswalk `inventory.ownerCount`; baseline owner paths and `src/index.ts:84-91` | 8: Business Growth, Media, Shipping, Marketplace Performance, Referral, Web Push, Booking Command, Education Bundle Purchase |
| Historical DDL occurrences / unique mappings | Crosswalk `inventory.recordCount` / `uniqueFingerprintCount` | 1,459 / 1,435 |
| Additional operations | `additionalOperations.length` | 110 |
| Statuses | Crosswalk status grouping | all 110 additional operations and all 1,435 mappings are `UNRESOLVED`; this report's 16 are `UNRESOLVED` |
| Canonical baseline | Crosswalk `canonicalBaseline`; independently calculated SHA-256 of `lib/db/migrations/000001_canonical_schema/migration.sql` | migration `000001`, SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60` |
| Assigned-record reconciliation | IDs in JSON and crosswalk selection | 16 distinct IDs: Booking 1, Business Growth selected categories 4, Education Bundle 4, Marketplace 1, Media 1, Referral 2, Shipping 1, Web Push 2 |

The selected categories are: 8 operational-scaffolding, 4 data-backfill, 2
rollout-marker, 1 function-replacement, and 1 cleanup-reporting. The
crosswalk's global statement count (103 executable SQL literals: 70 mutations
and 33 function replacements) applies to all 110 records; this 16-record
slice contains three data-changing `UPDATE`s, one destructive `DELETE`, one
function replacement, and 11 runtime/session/report/marker operations. This
does not purport to reconcile the global 103-literal count; that requires the
complementary Business Growth report.

## Startup and migration context

`artifacts/api-server/src/index.ts:81-92` calls the eight owners
unconditionally and sequentially at module startup, before `listen()` and
workers. The order is: Business Growth (84), Media (85), Shipping (86),
Marketplace (87), Referral (88), Web Push (89), Booking Command (90), then
Education Bundle Purchase (91). Therefore an **owner invocation** is attempted
once per process start only if every preceding owner returns; an error
propagates through top-level `await` and prevents later owners and `listen()`
from being reached. This is not evidence that every operation within an
invoked owner runs: its SQL predicates, relation checks, and marker-controlled
branches still apply. In Business Growth, static roles (2695), payment work
(4881/4894), and interim functions are only in the missing/behind-marker
branch; the current-marker path performs its repairs then returns
(5039-5125). None of the eight owner calls has a `NODE_ENV` predicate.

This startup path does **not** invoke the migration runner. The runner is a
separate CLI/test-facing path (`scripts/src/migrations/runner.ts:218-259`;
`scripts/src/migrations/cli.ts:61`). `applyMigrations` first takes its own
migration advisory lock, ensures/reads a ledger, skips `APPLIED`/`ADOPTED`
rows, marks a pending migration `APPLYING`, then executes migrations in
manifest order. Transactional migration bodies are bracketed by `BEGIN` /
`COMMIT` (runner lines 79-92); nontransactional bodies are lexically split and
sent statement-by-statement (93-98, 101-215). In contrast, these startup
owners use their own locks and mixed transactional/autocommit behavior and
have no ledger check. The canonical schema is a definition baseline, not proof
that historical transformations or runtime actions ran.

## Owner/category summary

| Owner | IDs | Runtime order | Effects and state dependence |
|---|---|---|---|
| Booking Command | 1 | 7th | transaction-local timeout and session advisory lock; relies on a usable client and lock release |
| Business Growth selected | 4 | 1st | session lock/search path/GUC restore; reads a cleanup report; marker existence/version determines fast path; marker upsert changes current marker state |
| Education Bundle Purchase | 4 | 8th | two existing-data updates, payment-immutability function replacement, and one transaction/lock boundary |
| Marketplace Performance | 1 | 4th | session lock and session timeout save/restore around `CREATE INDEX CONCURRENTLY`; no transaction is opened |
| Media | 1 | 2nd | transaction, local timeouts, hash advisory lock around a curated statement array |
| Referral | 2 | 5th | one historical timestamp backfill plus transaction-local timeout and hash advisory lock |
| Shipping | 1 | 3rd | locks table, deletes all but lowest UUID, creates singleton index; data-dependent and destructive |
| Web Push | 2 | 6th | expiration backfill plus transaction-local timeout and hash advisory lock |

## Individual records

### `booking-command/transaction-and-advisory-lock`

**Source and order:** exact executable scaffolding is
`booking-command-schema.ts:9-12,34-38` (the crosswalk locator is
`9-12,35-38`). Its owner is invoked unconditionally in 7th position. It connects, begins a
transaction, calls the local-timeout helper, blocks on numeric advisory lock
`0x42434d44`, then runs its DDL statements before commit. On any failure it
attempts rollback; finally it attempts unlock only if acquired and releases the
client.

**Effects / repetition / state:** This is runtime operational scaffolding,
not a data mutation. Repeating a *successful* lifecycle acquires/releases the
same session lock again; the code proves the `locked` flag gates unlock and the
`finally` releases the client. It does **not** prove that the local timeout
helper has no residual effect beyond the transaction, nor that unlock/rollback
cleanup always succeeds (both cleanup queries intentionally swallow errors).
It depends on current connection, transaction, lock availability, and on the
later DDL's database state. **Repeat safety: UNKNOWN** for the complete
operation, notwithstanding idempotent-looking downstream DDL.

**Canonical comparison:** `000001` defines the receipts table
(`2600-2614`), primary key (`7193-7197`), and the two indexes
(`10343-10353`): schema definition only. It contains no advisory-lock,
transaction-lifecycle, or timeout action. **Assessment: UNRESOLVED.**
Required check: decide how a versioned migration or deployment orchestrator
serializes this schema change and what failure/retry policy replaces startup
cleanup.

### `business-growth/advisory-lock-and-session-state`

**Source and order:** `business-growth-schema.ts:5002-5010,5150-5160,
5171-5197,5201-5204`; 1st owner. `ensureBusinessGrowthSchema` captures the
pooled client's `search_path` and timeouts, applies session timeouts, calls the
inner runner, then restores them and releases the client. The inner runner
takes the shared lock, sets `search_path`, and in `finally` rolls back any
open transaction, turns the session-scoped `lumera.snapshot_backfill` GUC
off, and unlocks. It intentionally executes the main rollout in autocommit
(`4982-4989`, `5134-5138`).

**Effects / repetition / state:** Operational/session behavior, including
current-state-dependent pooled-client cleanup. Owner 1 is invoked on each
startup that reaches it, and this wrapper is entered; its protected rollout
work is not uniformly per-startup. Static roles (2695), payment work
(4881/4894), and interim functions are only in the missing/behind-marker
branch, while the current-marker branch applies its repairs and returns
(`5039-5125`). Lock acquisition serializes entries but is not an idempotency
proof; `SET search_path`, `set_config(..., false)`, timeout restoration, and
their failures depend on the acquired session's prior state. Cleanup errors
can be suppressed when a rollout error already exists. **Repeat safety:
UNKNOWN** as a full lifecycle.

**Canonical comparison:** canonical line 21 contains dump setup
`pg_catalog.set_config('search_path', '', false)` but it is not this runtime
session protocol; searches find no canonical `pg_advisory_lock`, no
`lumera.snapshot_backfill`, and no matching runtime restoration. This is
runtime operational behavior, not represented by canonical schema definition.
**Assessment: UNRESOLVED.** Required check: specify the owner/lifetime of the
lock and GUC when startup DDL disappears, and test pooled-session cleanup
under each failure point.

### `business-growth/cleanup-report-read`

**Source and order:** `business-growth-schema.ts:5175-5184`, after the inner
rollout returns but before the ready log. The owner is invoked on each reached
startup; if the inner runner returns successfully (after whichever
marker-controlled branch applies), this query executes. It executes `SELECT
candidates, detached_users, deleted_salons, retired_salons ... WHERE version =
99`, then logs only if a row exists.

**Effects / repetition / state:** Read-only observation and logging; no source
write. The read itself is repeatable in the narrow sense that it does not
change database rows, but whether it returns/logs is explicitly dependent on
the current report table and row 99. The query can fail if the table is absent;
the preceding inner runner tries to create its shape at `5024-5028`. No
production state was checked. **Repeat safety: conditionally read-only, not
proof of operational safety** (each failed read fails startup).

**Canonical comparison:** `000001` defines the report table and its primary
key (`4291-4301`, `8037-8041`), but has no `SELECT ... WHERE version = 99`,
logging behavior, or evidence of the historical cleanup that would write a
version-99 row. That is schema definition, not report/data provenance.
**Assessment: UNRESOLVED.** Required check: establish whether and where the
v99 cleanup/report write is a reviewed migration, and whether startup still
must require this observation.

### `business-growth/rollout-marker-read`

**Source and order:** `business-growth-schema.ts:5035-5043`; it occurs after
the report-table repair and cover-image repair, inside owner 1. It first asks
`to_regclass($1)` whether `${schemaName}.business_growth_schema_rollout`
exists. Only if present does it read the `singleton = true` version. A version
at least `BUSINESS_GROWTH_SCHEMA_VERSION` selects the fast-path repairs and
returns at `5125`; otherwise the full statement collection is executed.

**Effects / repetition / state:** Read-only marker observation with a control
flow effect. On each successful entry to this point of an invoked owner it
probes the relation, but the version query is itself conditional on relation
existence. The marker table's existence, row presence, and version are current
production database state that was not inspected. Missing row becomes version
0; a malformed/duplicate state is not ruled out by source. **Repeat safety:
UNKNOWN** as it selects materially different rollout work; read-only syntax
does not prove branch equivalence.

**Canonical comparison:** `000001` defines the marker table and primary key
(`2672-2680`, `7225-7229`). It has no `to_regclass` state probe, version
predicate, or fast-path selection. Thus it represents definition, not the
runtime reconciliation decision. **Assessment: UNRESOLVED.** Required check:
migration-ledger adoption state and marker state must be reconciled on an
isolated copy before any retirement decision.

### `business-growth/rollout-marker-write`

**Source and order:** `business-growth-schema.ts:5139-5149`, after the
full statement array loop (`5134-5138`) and only when the fast-path has not
returned. It creates the marker table if missing, then inserts singleton
version/current time or updates both version and `completed_at` on conflict.

**Effects / repetition / state:** Current-data reconciliation/operational
marker write, not historical backfill. It is conditional on the marker read
not selecting the current-version fast path; it runs in autocommit. `ON
CONFLICT` prevents a second singleton row only when the primary-key invariant
exists; it deliberately changes `completed_at` on every qualifying rerun and
can advance a marker after only the current branch's preceding statements.
**Repeat safety: not idempotent as row values; safety UNKNOWN.**

**Canonical comparison:** canonical defines the table/PK (`2672-2680`,
`7225-7229`) but contains no data `INSERT`, upsert, version constant, or
completion timestamp behavior. Schema definition does not represent this
current-state reconciliation. **Assessment: UNRESOLVED.** Required check:
prove the marker accurately records an atomically completed migration state
and replace it with reviewed ledger ownership before removal.

### `education-bundle/learner-id-backfill`

**Source and order:** `education-bundle-purchase-schema.ts:54-58`; this is
8th startup owner, after it has dropped the old target checks (52-53) and
before adding/validating the replacement check (59-63). It assigns
`purchase.learner_user_id = employee.user_id` only for `salon_employee`
purchases with a matching employee and null learner ID.

**Effects / repetition / state:** Existing-data mutation and identity
reconciliation. The `IS NULL` predicate makes already-populated target rows
untouched, so the same resulting data normally causes no matching update on a
second run. That is not proof of correctness or full repeat safety: the
selected employee/user mapping and the actual null rows are production state,
and the statement silently leaves unresolved nulls where no employee/user
match exists, causing subsequent constraint validation to fail. **Repeat
safety: conditional/no-op after successful fill for matching rows; overall
UNKNOWN.**

**Canonical comparison:** `000001` defines nullable `learner_user_id`, the
non-null-in-branch target check, and its user foreign key (`3421-3448`,
`16440-16444`). It contains no historical update from `employees.user_id`.
This is a historical transformation absent from canonical definition.
**Assessment: UNRESOLVED.** Required check: review every candidate and
non-candidate on a backup/isolated snapshot and obtain data-ownership approval
for employee-to-learner identity assignment.

### `education-bundle/payment-reference-backfill`

**Source and order:** `education-bundle-purchase-schema.ts:24-31`; it follows
column add/drop-trigger (22-23) and precedes `SET NOT NULL`, unique index,
check, function, and trigger (32-51). The first update generates
`BND-` plus the first 30 hyphen-free UUID characters and writes the same
reference into JSON; the second makes JSON `reference` match any existing
`payment_reference`.

**Effects / repetition / state:** Existing payment data mutation. The first
predicate is `payment_reference IS NULL`; the second uses `IS DISTINCT FROM`.
They provide concrete convergence predicates, but do not prove the generated
30-character references are unique across actual historical UUIDs, nor that
changing an existing JSON snapshot is legally/financially correct. The later
unique index/NOT NULL can fail based on current rows. **Repeat safety:
conditional convergence only; overall UNKNOWN.**

**Canonical comparison:** canonical defines `payment_reference NOT NULL`, the
JSON equality check (`3421-3448`), the unique index (`11162-11165`), the
immutability function (`1693-1706`), and trigger (`14775-14778`). None is a
data backfill. Therefore it represents final schema definition, not generated
payment-reference history. **Assessment: UNRESOLVED.** Required check:
collision analysis against real IDs, financial/audit approval for snapshot
rewrites, and a reviewed compensating/restore plan.

### `education-bundle/payment-reference-function`

**Source and order:** `education-bundle-purchase-schema.ts:39-47`; it is
executed after the two payment updates, not-null/index/check setup, and before
the trigger is recreated at 48-51. `CREATE OR REPLACE FUNCTION` changes the
body used by the trigger to reject either payment field changing on update.

**Effects / repetition / state:** Existing-schema reconciliation, not a data
write. PostgreSQL's replacement syntax makes a second identical definition
replace the body again, but source alone cannot prove equivalence to the
currently installed definition or compatibility with all trigger callers.
It depends on the function namespace and the trigger/table existing in the
current database. **Repeat safety: syntactically replaceable; semantic safety
UNKNOWN.**

**Canonical comparison:** `000001:1693-1706` contains materially the same
function body and `14775-14778` attaches the matching trigger. This is strong
definition evidence, but it does not prove the production function body,
trigger binding, or prior payment data was corrected. **Assessment:
UNRESOLVED.** Required check: compare installed function and trigger
definitions to canonical in a controlled catalog snapshot and decide whether a
versioned `CREATE OR REPLACE` is required.

### `education-bundle/transaction-and-advisory-lock`

**Source and order:** actual scaffolding is
`education-bundle-purchase-schema.ts:6-8,85`; the crosswalk's `9-12,81-84`
locator also includes ordinary DDL/index literals and omits the `BEGIN` line.
It is 8th in `index.ts`. The owner starts a transaction, sets local timeouts,
takes the *Business Growth* advisory lock, commits after all statements, rolls
back on error, then conditionally unlocks/releases.

**Effects / repetition / state:** Operational locking/transaction behavior;
not a data mutation itself. It serializes with Business Growth only while that
session lock is held, and is state-dependent on connection/lock availability.
The catch ignores rollback failure and the final unlock ignores errors. **Repeat
safety: UNKNOWN** for failure and transaction lifecycle; no claim follows from
the downstream `IF NOT EXISTS` syntax.

**Canonical comparison:** canonical contains final education-bundle objects
but no begin/commit/rollback, advisory-lock, timeout-helper, or pooled-client
protocol. It is not represented as canonical schema definition.
**Assessment: UNRESOLVED.** Required check: document lock-domain ownership and
transaction requirements for moving both data work and DDL out of startup.

### `marketplace/advisory-lock-and-session-state`

**Source and order:** `marketplace-performance-schema.ts:16-20,39-46`; 4th
owner. It saves session timeouts, applies session timeouts, locks, creates four
indexes `CONCURRENTLY` (21-37), then unlocks, restores saved timeouts, releases
the client, and may throw a cleanup error only absent a startup error.

**Effects / repetition / state:** Operational/session scaffolding. It is
deliberately **not** wrapped in a transaction, which is required by
`CREATE INDEX CONCURRENTLY`; timeout and lock state is tied to the particular
pooled connection. The code makes repeated successful attempts reacquire and
release, but restoration can fail and be suppressed. Index validity after
interruption and lock/timeout behavior require current catalog/session state.
**Repeat safety: UNKNOWN.**

**Canonical comparison:** the named indexes are canonical definitions
(`9755-9758`, `13143-13153`, `13374-13377`); canonical has no concurrent-build
execution, advisory lock, or timeout lifecycle. Definition equivalence does
not show a failed concurrent index build was repaired. **Assessment:
UNRESOLVED.** Required check: catalog validity/concurrent-index recovery plan
and a migration mode that preserves nontransactional execution semantics.

### `media/transaction-and-advisory-lock`

**Source and order:** `media-schema.ts:105-109`; 2nd owner. It starts a
transaction, sets local timeouts, locks `hashtext('lumera:media-schema:v1')`,
executes the `statements` array in order (`106`), commits, logs, rolls back on
error, then attempts unlock and releases the client. The grouped curated
literals being protected are exactly `media-schema.ts:11-103`.

**Effects / repetition / state:** Runtime transaction/session/lock
scaffolding. The owner invocation is per reached startup; when its wrapper
reaches the loop, each array member is attempted in source-array order, subject
to preceding success and that member's own database-state behavior.
Rollback/unlock error suppression means full retry safety is not demonstrated.
**Repeat safety: UNKNOWN.**

**Canonical comparison:** `000001` defines media tables/indexes (for example
`4663-4666`, `4857-4906`, `12534-12803`) but has no source-array loop,
transaction lifecycle, local timeout, or hash advisory lock. Those are runtime
operations, not canonical definition. **Assessment: UNRESOLVED.** Required
check: retain a complete ordered migration plan for the array and determine
which session serialization remains necessary.

### `referral/tracking-start-backfill`

**Source and order:** `referral-schema.ts:27-41`; 5th owner, after columns
are added (16-23) and before enum alteration/commit (42-49). It updates only
A/B1 attribution rows that are no longer pending verification and whose
tracking timestamp is null. It chooses the earliest matching verified audit
timestamp, otherwise the qualification's `updated_at`.

**Effects / repetition / state:** Historical data transformation. The null
predicate creates a no-op on later runs for successfully written rows; however
the fallback to `updated_at` is an irreversible policy choice, audit matching
uses JSON text and can have no matching record, and new/current source state
can change which rows qualify before fill. **Repeat safety: conditional
convergence only; overall UNKNOWN.**

**Canonical comparison:** canonical defines the nullable
`tracking_started_at` column (`5645-5663`) and relevant foreign key
(`18560-18564`), but contains no update, audit lookup, channel filter, or
fallback policy. It is schema definition, not historical transformation.
**Assessment: UNRESOLVED.** Required check: business/legal approval for the
fallback and a candidate/outlier review with preserved audit evidence.

### `referral/transaction-and-advisory-lock`

**Source and order:** actual lifecycle is
`referral-schema.ts:12-15,49-55` (crosswalk locator `16-18,48-53` points into
the body rather than the full lifecycle); 5th owner. It opens a transaction,
sets local timeouts, locks `hashtext('lumera:referral-schema')`, runs all
schema/backfill statements, commits; catch rolls back; finally conditionally
unlocks and releases.

**Effects / repetition / state:** Runtime operational scaffolding; lock and
transaction state depend on the selected client and server. Successful
reacquisition/release is evidenced by code, but swallowed rollback/unlock
errors prevent a proof that retries always start cleanly. **Repeat safety:
UNKNOWN.**

**Canonical comparison:** canonical defines referral end-state objects but has
no advisory lock, timeout, transaction, or report of this runtime sequence.
**Assessment: UNRESOLVED.** Required check: migration serialization and
failure-recovery policy for the paired referral backfill.

### `shipping/duplicate-row-cleanup`

**Source and order:** `shipping-config.ts:24-35,47-65`; 3rd owner. The
transaction/lock wrapper calls `runShippingConfigSchemaDdl`, which sets a
transaction-local search path, locks `shipping_rules` in `SHARE ROW EXCLUSIVE`
mode, deletes every row except the ascending-lowest UUID, then creates the
unique expression index. The crosswalk locator `24-35,54-65` omits the helper
call/signature but covers the executable SQL.

**Effects / repetition / state:** Destructive existing-data mutation plus
schema reconciliation. The survivor policy is data-dependent and assumes UUID
lexicographic order represents the approved row. A second run after a
successful cleanup matches no duplicates, but that does not restore deleted
configuration or establish that the initial survivor was correct. A run on an
empty table does not create a row; the unique index only supports later
request-path conflict handling. **Repeat safety: conditionally no-op after
successful deletion; destructive semantic safety UNKNOWN.**

**Canonical comparison:** canonical defines `shipping_rules` (`6536-6548`) and
the singleton index (`14558-14561`), but has no table lock or deletion/survivor
policy. This is a historical/current-data cleanup absent from canonical
definition. **Assessment: UNRESOLVED.** Required check: backup/candidate
inventory, explicit product-owner survivor criteria, restore procedure, and
lock impact review.

### `ensureWebPushSchema/source-discovered-82-dd7107a5f655438a`

**Source and order:** exact literal is `web-push-schema.ts:82`; its owner is
6th. It is ordered after adding `expires_at` if absent (80), before enforcing
not-null (83), and inside the outer transaction/lock established by
`10-24`. It fills a null expiry with `created_at + interval '24 hours'`.

**Effects / repetition / state:** Existing-data expiration backfill. The
null predicate means filled rows are not rewritten by a later run, but the
chosen 24-hour expiry could immediately expire historical deliveries and does
not prove `created_at` is non-null or semantically correct for every row.
Constraint enforcement and actual candidates depend on uninspected production
state. **Repeat safety: conditional convergence only; overall UNKNOWN.**

**Canonical comparison:** canonical defines `expires_at NOT NULL` in
`system_push_deliveries` (`6711-6734`) and its indexes (`14670-14701`), but
has no update/backfill. It is definition only, not historical data policy.
**Assessment: UNRESOLVED.** Required check: review all null candidates and
delivery-retention consequences, and define approved migration/recovery logic.

### `web-push/transaction-and-advisory-lock`

**Source and order:** `web-push-schema.ts:10-24`; 6th owner. It begins a
transaction, applies local timeouts, takes hash advisory lock
`lumera:web-push-schema:v1`, calls the ordered inner DDL routine, commits, or
rolls back on error; finally it conditionally unlocks and releases.

**Effects / repetition / state:** Runtime operational scaffolding. The owner
invocation is per reached startup; the wrapper reaches the inner routine only
when connection/timeout/lock steps succeed, and individual inner SQL remains
subject to its own state. It depends on connection and lock state; cleanup
calls can fail silently. The inner routine's query order is exactly lines
30-88, including the expiration update at 82. **Repeat safety: UNKNOWN.**

**Canonical comparison:** canonical has final push table/index/FK definitions
(`5499-5504`, `6711-6734`, `13437-13447`, `14670-14701`,
`19352-19364`) but no transaction/advisory-lock/timeout protocol. **Assessment:
UNRESOLVED.** Required check: establish versioned transaction boundaries that
pair column addition, backfill, and not-null enforcement.

## Authoritative locator versus expanded audit location

The authoritative crosswalk was not edited. In every JSON record,
`sourcePath` is copied **exactly** from its crosswalk record, including an
individual-literal column position where supplied. Where the audit needed
complete executable context beyond that curated locator, `evidenceSourcePath`
records the broader reviewed range and `sourceEvidence` retains the exact
verbatim source fragments. The differing location is audit evidence, not a
correction to authoritative crosswalk data.

| ID | Authoritative `sourcePath` from crosswalk | Expanded `evidenceSourcePath` |
|---|---|---|
| `booking-command/transaction-and-advisory-lock` | `booking-command-schema.ts:9-12,35-38` | `booking-command-schema.ts:9-12,34-38` |
| `business-growth/advisory-lock-and-session-state` | `business-growth-schema.ts:5002-5010,5153-5160,5190-5204` | `business-growth-schema.ts:5002-5010,5150-5160,5171-5197,5201-5204` |
| `business-growth/cleanup-report-read` | `business-growth-schema.ts:5175-5178` | `business-growth-schema.ts:5175-5184` |
| `business-growth/rollout-marker-read` | `business-growth-schema.ts:5036-5042` | `business-growth-schema.ts:5035-5043` |
| `business-growth/rollout-marker-write` | `business-growth-schema.ts:5145-5148` | `business-growth-schema.ts:5139-5149` |
| `education-bundle/transaction-and-advisory-lock` | `education-bundle-purchase-schema.ts:9-12,81-84` | `education-bundle-purchase-schema.ts:6-8,85` |
| `marketplace/advisory-lock-and-session-state` | `marketplace-performance-schema.ts:18-20,39-44` | `marketplace-performance-schema.ts:16-20,39-46` |
| `referral/transaction-and-advisory-lock` | `referral-schema.ts:16-18,48-53` | `referral-schema.ts:12-15,49-55` |
| `shipping/duplicate-row-cleanup` | `shipping-config.ts:24-35,54-65` | `shipping-config.ts:24-35,47-65` |
| `ensureWebPushSchema/source-discovered-82-dd7107a5f655438a` | `web-push-schema.ts:82:22` | `web-push-schema.ts:82` |
| `web-push/transaction-and-advisory-lock` | `web-push-schema.ts:11-15,18-24` | `web-push-schema.ts:10-24` |

The five remaining report records have no expanded locator because their
authoritative crosswalk `sourcePath` already identifies the audited literal or
function range; their complete current-source evidence remains in
`sourceEvidence`.

## Unresolved questions for independent review

1. Which migration/ledger state, if any, is authoritative for the Business
   Growth marker, and can marker/current schema divergence be safely detected?
2. Are the payment-reference, learner-identity, referral-timestamp, shipping
   survivor, and push-expiry policies approved for every historical row?
3. What backups, candidate counts, collisions, nulls, invalid indexes, and
   function/trigger definitions exist in production? They were intentionally
   not inspected here.
4. Which locks, GUC/search-path/timeout lifecycle, transaction boundaries, and
   `CREATE INDEX CONCURRENTLY` nontransactional behavior must be retained by a
   future migration/deployment mechanism?
5. Can cleanup failure suppression on rollback/unlock/restore cause an unsafe
   retry on a pooled client, and what test proves otherwise?
6. Does the v99 cleanup report have a reviewed writer and should absence of its
   row/table block API startup?

Every assessment remains **UNRESOLVED**. No report record is a resolution,
production-safety determination, or idempotency certification.

---

## Full normalized SQL/code evidence

The following is the exact 110-record normalized array written to [complete-evidence.json](complete-evidence.json). It retains every rich record and every `sourceEvidence.sqlOrCode` value from the final source slices.

```json
[
  {
    "id": "business-growth/bundle-payment-backfill",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5087-5108",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5070,
        "endLine": 5124,
        "sqlOrCode": "        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS payment_instructions_snapshot jsonb`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS charged_amount integer`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS duration_snapshot text`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS access_granted_at timestamptz`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS purchased_at timestamptz`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_text_snapshot text`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.course_enrollments ADD COLUMN IF NOT EXISTS digital_content_consent_version_snapshot text`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_installments ADD COLUMN IF NOT EXISTS payment_instructions_snapshot jsonb`);\n        for (const statement of paymentInstructionSnapshotBackfillStatements(quoted)) await client.query(statement);\n        // Sibling of the education_salon_cleanup_reports gap (Task #11A):\n        // `'...'::regclass` throws outright if education_bundle_purchases\n        // doesn't exist, unlike the guarded to_regclass() check already used\n        // just below for the same table. Both the constraint-validation\n        // block and the payment_reference backfill now share that one\n        // existence check, so neither runs against a database where this\n        // fast path is reached before that table exists.\n        if ((await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [`${schemaName}.education_bundle_purchases`])).rows[0]?.exists) {\n          await client.query(`DO $$ BEGIN\n            IF EXISTS (\n              SELECT 1 FROM pg_constraint\n              WHERE conrelid = '${quoted}.education_bundle_purchases'::regclass\n                AND conname = 'education_bundle_purchases_target_check'\n                AND NOT convalidated\n            ) THEN\n              ALTER TABLE ${quoted}.education_bundle_purchases\n                VALIDATE CONSTRAINT education_bundle_purchases_target_check;\n            END IF;\n          END $$`);\n          await client.query(`ALTER TABLE ${quoted}.education_bundle_purchases ADD COLUMN IF NOT EXISTS payment_reference text`);\n          await client.query(`DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${quoted}.education_bundle_purchases`);\n          await client.query(`UPDATE ${quoted}.education_bundle_purchases\n            SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),\n                payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',\n                  to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)\n            WHERE payment_reference IS NULL`);\n          await client.query(`UPDATE ${quoted}.education_bundle_purchases\n            SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)\n            WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference`);\n          await client.query(`ALTER TABLE ${quoted}.education_bundle_purchases ALTER COLUMN payment_reference SET NOT NULL`);\n          await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchases_payment_reference_unique\n            ON ${quoted}.education_bundle_purchases(payment_reference)`);\n          await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.reject_bundle_payment_reference_change() RETURNS trigger AS $$\n            BEGIN\n              IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n                OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n                RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n              END IF;\n              RETURN NEW;\n            END\n          $$ LANGUAGE plpgsql`);\n          await client.query(`CREATE TRIGGER education_bundle_purchases_payment_reference_immutable\n            BEFORE UPDATE OF payment_reference, payment_instructions ON ${quoted}.education_bundle_purchases\n            FOR EACH ROW EXECUTE FUNCTION ${quoted}.reject_bundle_payment_reference_change()`);\n        }"
      }
    ],
    "execution": {
      "sourceOrder": "Fast-path direct queries 5101-5108, after target-check validation, payment_reference add, and trigger drop at 5088-5100.",
      "runtimeConditionalOrder": "Only current-version fast path, only when to_regclass check at 5087 is true. Full rollout has separate literal records at 4923-4930, orders 89/90.",
      "startupPredicate": "Skipped on lower/absent marker (full branch) and when table check is false; reached on current marker branch.",
      "dependencies": "rollout marker version >=126; target table and payment_instructions; trigger is dropped before mutations."
    },
    "effects": {
      "type": "existing-data payment-reference and immutable-instruction backfill",
      "description": "First UPDATE derives BND- plus the first 30 UUID hex characters for rows whose payment_reference is NULL and writes payment_instructions.reference. Second UPDATE makes each JSON reference equal the current payment_reference when distinct; surrounding fast path drops then recreates the immutability trigger."
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only; UNKNOWN production safety",
      "evidence": "The first NULL predicate and second IS DISTINCT FROM predicate can converge after success, but source does not prove uniqueness of truncated references in existing data, correctness of overwriting a divergent JSON reference, trigger/constraint timing, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "The to_regclass catalog check gates execution; the two UPDATE predicates read current education_bundle_purchases.payment_reference/payment_instructions and derive values from existing UUIDs. No production database was inspected.",
      "unknowns": "Existence/version state, current divergent or null values, unique-index/constraint validity, trigger effects, concurrent writers, and affected rows are unverified."
    },
    "canonicalComparison": {
      "classification": "historical payment-data transformation, not schema-definition equivalence",
      "evidence": "Canonical definition at lib/db/migrations/000001_canonical_schema/migration.sql:3421-3448 declares payment_reference NOT NULL and payment_instructions with the reference-equality check at 3446. It contains no top-level data mutation; those definitions do not generate historic BND references or repair JSON.",
      "semanticConclusion": "NOT REPRESENTED as the historic/reference reconciliation in canonical 000001. This report makes no resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "business-growth/education-snapshot-backfills",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:229-238",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 217,
        "endLine": 249,
        "sqlOrCode": "function paymentInstructionSnapshotBackfillStatements(s: string): string[] {\n  const validSettings = `(SELECT ips_recipient_name, regexp_replace(ips_recipient_account, '[[:space:]-]', '', 'g') AS account, ips_purpose\n    FROM ${s}.education_platform_settings\n    WHERE btrim(COALESCE(ips_recipient_name, '')) <> ''\n      AND btrim(COALESCE(ips_purpose, '')) <> ''\n      AND regexp_replace(COALESCE(ips_recipient_account, ''), '[[:space:]-]', '', 'g') ~ '^[0-9]{18}$'\n    ORDER BY updated_at DESC, id DESC LIMIT 1)`;\n  const payload = (amount: string, reference: string) => `concat(\n    'K:PR|V:01|C:1|R:', settings.account, '|N:', settings.ips_recipient_name,\n    '|I:RSD', replace(to_char(${amount}::numeric, 'FM999999999999990.00'), '.', ','),\n    '|P:', settings.ips_purpose, '|SF:221|S:', ${reference})`;\n  return [\n    `UPDATE ${s}.course_enrollments enrollment\n       SET payment_instructions_snapshot = jsonb_build_object(\n         'payload', ${payload(\"enrollment.charged_amount\", \"'EDU' || replace(enrollment.id::text, '-', '')\")},\n         'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account,\n         'purpose', settings.ips_purpose, 'amount', enrollment.charged_amount, 'currency', 'RSD',\n         'reference', 'EDU' || replace(enrollment.id::text, '-', ''), 'paymentCode', '221')\n       FROM ${validSettings} settings\n       WHERE enrollment.payment_instructions_snapshot IS NULL\n         AND enrollment.status = 'pending' AND enrollment.payment_status = 'pending'\n         AND enrollment.charged_amount > 0`,\n    `UPDATE ${s}.education_installments installment\n       SET payment_instructions_snapshot = jsonb_build_object(\n         'payload', ${payload(\"installment.amount\", \"installment.payment_reference\")},\n         'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account,\n         'purpose', settings.ips_purpose, 'amount', installment.amount, 'currency', 'RSD',\n         'reference', installment.payment_reference, 'paymentCode', '221')\n       FROM ${validSettings} settings\n       WHERE installment.payment_instructions_snapshot IS NULL\n         AND installment.status = 'pending' AND installment.amount > 0\n         AND btrim(COALESCE(installment.payment_reference, '')) <> ''`,\n  ];"
      }
    ],
    "execution": {
      "sourceOrder": "Helper declaration lines 217-249; course-enrollment literal 229-238 is first, installment literal 239-248 second.",
      "runtimeConditionalOrder": "Full rollout expands helper in tableStatements at 4920; current-version fast path executes each helper literal at 5079 after IF EXISTS column repairs.",
      "startupPredicate": "On either full-rollout or current-version fast-path control flow, this helper is reached only after prior statements in that branch succeed; its UPDATE predicates plus valid platform-settings subquery then select rows.",
      "dependencies": "course_enrollments, education_installments, education_platform_settings and referenced columns; complete valid IPS settings row."
    },
    "effects": {
      "type": "existing-data payment-instruction snapshot backfill",
      "description": "Builds immutable QR/IPS JSON for pending pending-payment course enrollments with positive charged_amount, and pending positive education installments with a nonblank payment_reference, using the newest complete valid platform IPS settings row."
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only; UNKNOWN production safety",
      "evidence": "Both literals select only NULL snapshots, but their first-write payload is derived from mutable current platform settings. Source cannot prove correctness of selected settings for each historic obligation, uniqueness of setting selection, retry/concurrency behavior, or whether all NULL values genuinely need a snapshot."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Each UPDATE reads current enrollment/installment fields and selects the currently newest valid education_platform_settings row (ORDER BY updated_at DESC, id DESC LIMIT 1). No production database was inspected.",
      "unknowns": "Whether valid settings exist, whether they correspond to historic payment obligations, selected rows, application writers, and the intended snapshot source remain unverified."
    },
    "canonicalComparison": {
      "classification": "historical payment snapshot transformation, not schema-definition equivalence",
      "evidence": "Canonical course_enrollments definition at lib/db/migrations/000001_canonical_schema/migration.sql:2881-2921 includes payment_instructions_snapshot at 2912; education_installments is defined at 3889-3903. Static scan found no top-level data mutation. Definitions do not construct historic QR/IPS JSON from current settings.",
      "semanticConclusion": "NOT REPRESENTED as this snapshot backfill in canonical 000001. This report makes no resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1066-5602134427af494b",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1066:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1066,
        "endLine": 1078,
        "sqlOrCode": "DO $$ BEGIN\n       IF NOT EXISTS (\n         SELECT 1 FROM pg_trigger\n         WHERE tgrelid = '${s}.retail_order_items'::regclass\n           AND tgname = 'retail_order_items_commercial_snapshot_immutable'\n           AND NOT tgisinternal\n       ) THEN\n         UPDATE ${s}.retail_order_items AS item\n           SET product_catalog_reference = product.catalog_reference\n           FROM ${s}.products AS product\n           WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL;\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 18; source starts line 1066, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF NOT EXISTS ( SELECT 1 FROM pg_trigger WHERE tgrelid = '${s}.retail_order_items'::regclass AND tgname = 'retail_order_items_commercial_snapshot_immutable' AND NOT tgisinternal ) THEN UPDATE ${s}.retail_order_items AS item SET product_catalog_reference = product.catalog_reference FROM ${s}.products AS product WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL; END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_order_items, products; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5743-5791. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1155-097a5b1129d827b2",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1155:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1155,
        "endLine": 1165,
        "sqlOrCode": "UPDATE ${s}.order_items AS item SET\n       supplier_id = COALESCE(item.supplier_id, product.supplier_id),\n       supplier_name = COALESCE(item.supplier_name, supplier.name),\n       supplier_slug = COALESCE(item.supplier_slug, supplier.slug),\n       product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference),\n       product_sku_snapshot = COALESCE(item.product_sku_snapshot, item.product_sku, product.sku),\n       unit_price = COALESCE(item.unit_price, item.price),\n       line_subtotal = COALESCE(item.line_subtotal, item.price * item.quantity),\n       line_total = COALESCE(item.line_total, item.price * item.quantity)\n       FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id\n       WHERE item.product_id = product.id"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 23; source starts line 1155, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.order_items AS item SET supplier_id = COALESCE(item.supplier_id, product.supplier_id), supplier_name = COALESCE(item.supplier_name, supplier.name), supplier_slug = COALESCE(item.supplier_slug, supplier.slug), product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference), product_sku_snapshot = COALESCE(item.product_sku_snapshot, item.product_sku, product.sku), unit_price = COALESCE(item.unit_price, item.price), line_subtotal = COALESCE(item.line_subtotal, item.price * item.quantity), line_total = COALESCE(item.line_total, item.price * item.quantity) FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id WHERE item.product_id = product.id"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (order_items, products, suppliers). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5015-5060. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1234-1d61851271544400",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1234:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1234,
        "endLine": 1235,
        "sqlOrCode": "UPDATE ${s}.order_items SET realized_revenue_rsd = line_total\n       WHERE realized_revenue_rsd = 0 AND line_total > 0"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 25; source starts line 1234, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.order_items SET realized_revenue_rsd = line_total WHERE realized_revenue_rsd = 0 AND line_total > 0"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (order_items). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5015-5060. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1236-2d62e2481fe32512",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1236:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1236,
        "endLine": 1237,
        "sqlOrCode": "UPDATE ${s}.retail_order_items SET realized_revenue_rsd = line_total\n       WHERE realized_revenue_rsd = 0 AND line_total > 0"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 26; source starts line 1236, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.retail_order_items SET realized_revenue_rsd = line_total WHERE realized_revenue_rsd = 0 AND line_total > 0"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_order_items). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5743-5791. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1293-e4681f51bbe828b9",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1293:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1293,
        "endLine": 1305,
        "sqlOrCode": "UPDATE ${s}.retail_order_items AS item SET\n       supplier_id = COALESCE(item.supplier_id, product.supplier_id),\n       supplier_name = COALESCE(item.supplier_name, supplier.name),\n       supplier_slug = COALESCE(item.supplier_slug, supplier.slug),\n       product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference),\n       product_sku_snapshot = COALESCE(item.product_sku_snapshot, product.sku),\n       discount_snapshot = COALESCE(item.discount_snapshot,\n         CASE WHEN product.public_price IS NOT NULL AND product.public_price > item.unit_price\n           THEN product.public_price - item.unit_price ELSE NULL END),\n       line_subtotal = COALESCE(item.line_subtotal, item.unit_price * item.quantity),\n       line_total = COALESCE(item.line_total, item.unit_price * item.quantity)\n       FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id\n       WHERE item.product_id = product.id"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 27; source starts line 1293, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.retail_order_items AS item SET supplier_id = COALESCE(item.supplier_id, product.supplier_id), supplier_name = COALESCE(item.supplier_name, supplier.name), supplier_slug = COALESCE(item.supplier_slug, supplier.slug), product_catalog_reference = COALESCE(item.product_catalog_reference, product.catalog_reference), product_sku_snapshot = COALESCE(item.product_sku_snapshot, product.sku), discount_snapshot = COALESCE(item.discount_snapshot, CASE WHEN product.public_price IS NOT NULL AND product.public_price > item.unit_price THEN product.public_price - item.unit_price ELSE NULL END), line_subtotal = COALESCE(item.line_subtotal, item.unit_price * item.quantity), line_total = COALESCE(item.line_total, item.unit_price * item.quantity) FROM ${s}.products product JOIN ${s}.suppliers supplier ON supplier.id = product.supplier_id WHERE item.product_id = product.id"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_order_items, products, suppliers). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_order_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5743-5791. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1594-f6fc741bbccc403d",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1594:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1594,
        "endLine": 1614,
        "sqlOrCode": "DO $$\n     DECLARE has_old boolean; has_new boolean;\n     BEGIN\n       SELECT EXISTS (\n         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid\n         JOIN pg_namespace n ON n.oid = t.typnamespace\n         WHERE t.typname = 'user_role' AND n.nspname = current_schema()\n           AND e.enumlabel = 'EDUCATION_CENTER_OWNER'\n       ), EXISTS (\n         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid\n         JOIN pg_namespace n ON n.oid = t.typnamespace\n         WHERE t.typname = 'user_role' AND n.nspname = current_schema()\n           AND e.enumlabel = 'EDUKATIVNI_CENTAR'\n       ) INTO has_old, has_new;\n       IF has_old AND has_new THEN\n         UPDATE ${s}.users SET role = 'EDUKATIVNI_CENTAR'\n         WHERE role = 'EDUCATION_CENTER_OWNER';\n       ELSIF has_old THEN\n         ALTER TYPE ${s}.user_role RENAME VALUE 'EDUCATION_CENTER_OWNER' TO 'EDUKATIVNI_CENTAR';\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 32; source starts line 1594, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "role data conversion or enum-label DDL",
      "description": "Live enum-label state selects either a users.role rewrite or ALTER TYPE RENAME VALUE; category data-backfill therefore masks a catalog effect."
    },
    "repeatSafety": {
      "assessment": "Branch-convergent only; UNKNOWN deployment safety",
      "evidence": "A completed role rewrite can become a no-op, while enum rename changes catalog state. Source does not prove all historic values/consumers tolerate either branch."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (users, user_role; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical users definition at lib/db/migrations/000001_canonical_schema/migration.sql:6795-6813. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1888-578a52d56c8c901a",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1888:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1888,
        "endLine": 1891,
        "sqlOrCode": "UPDATE ${s}.package_service_links l\n       SET quota = p.session_count\n      FROM ${s}.treatment_packages p\n     WHERE l.package_id = p.id AND l.quota IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 33; source starts line 1888, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.package_service_links l SET quota = p.session_count FROM ${s}.treatment_packages p WHERE l.package_id = p.id AND l.quota IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (package_service_links, treatment_packages). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical package_service_links definition at lib/db/migrations/000001_canonical_schema/migration.sql:5173-5179. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1955-d8aebdcf413ec207",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1955:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1955,
        "endLine": 1959,
        "sqlOrCode": "UPDATE ${s}.package_purchase_service_links l\n       SET total_quota = p.total_sessions,\n           remaining_quota = p.remaining_sessions\n      FROM ${s}.customer_package_purchases p\n     WHERE l.purchase_id = p.id AND l.total_quota = 0 AND l.remaining_quota = 0"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 34; source starts line 1955, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.package_purchase_service_links l SET total_quota = p.total_sessions, remaining_quota = p.remaining_sessions FROM ${s}.customer_package_purchases p WHERE l.purchase_id = p.id AND l.total_quota = 0 AND l.remaining_quota = 0"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (package_purchase_service_links, customer_package_purchases). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical package_purchase_service_links definition at lib/db/migrations/000001_canonical_schema/migration.sql:5138-5145. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1993-78f264bf1242ad45",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1993:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1993,
        "endLine": 2006,
        "sqlOrCode": "DO $$ BEGIN\n       IF EXISTS (\n         SELECT 1\n           FROM information_schema.columns\n          WHERE table_schema = current_schema()\n            AND table_name = 'appointments'\n            AND column_name = 'service_id'\n       ) THEN\n         UPDATE ${s}.package_redemptions r\n            SET service_id = a.service_id\n           FROM ${s}.appointments a\n          WHERE r.appointment_id = a.id AND r.service_id IS NULL;\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 35; source starts line 1993, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF EXISTS ( SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'appointments' AND column_name = 'service_id' ) THEN UPDATE ${s}.package_redemptions r SET service_id = a.service_id FROM ${s}.appointments a WHERE r.appointment_id = a.id AND r.service_id IS NULL; END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (package_redemptions, appointments; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical package_redemptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:5152-5166. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2182-1dcabc3abb504aa4",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2182:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2182,
        "endLine": 2183,
        "sqlOrCode": "INSERT INTO ${s}.beauty_job_platform_settings (listing_expiry_days, hourly_posting_limit)\n       SELECT 30, 5 WHERE NOT EXISTS (SELECT 1 FROM ${s}.beauty_job_platform_settings)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 36; source starts line 2182, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.beauty_job_platform_settings (listing_expiry_days, hourly_posting_limit) SELECT 30, 5 WHERE NOT EXISTS (SELECT 1 FROM ${s}.beauty_job_platform_settings)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (beauty_job_platform_settings). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical beauty_job_platform_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:2528-2536. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2359-05cc08a5872f1ce2",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2359:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2359,
        "endLine": 2382,
        "sqlOrCode": "INSERT INTO ${s}.beauty_job_categories (slug, name, subtype_labels, enabled, feature_flag) VALUES\n      ('frizeri', 'Frizeri', '[\"Ženski frizer\", \"Muški frizer\", \"Kolorista\"]'::jsonb, true, NULL),\n      ('barberi', 'Barberi', '[\"Šišanje\", \"Brijanje\", \"Stilizovanje brade\"]'::jsonb, true, NULL),\n      ('kozmetika', 'Kozmetika', '[]'::jsonb, true, NULL),\n      ('kozmeticari', 'Kozmetičari', '[\"Nega lica\", \"Depilacija\", \"Tretmani tela\"]'::jsonb, true, NULL),\n      ('nokti', 'Nokti (Manikir/Pedikir)', '[\"Manikir\", \"Pedikir\", \"Nail artist\"]'::jsonb, true, NULL),\n      ('lash-brow', 'Lash/Brow', '[\"Ekstenzije trepavica\", \"Laminacija trepavica\", \"Obrve\"]'::jsonb, true, NULL),\n      ('make-up', 'Make-up', '[\"Dnevna šminka\", \"Svečana šminka\"]'::jsonb, true, NULL),\n      ('sminkeri', 'Šminkeri', '[\"Dnevna šminka\", \"Svečana šminka\", \"Editorial\"]'::jsonb, true, NULL),\n      ('pmu', 'PMU', '[\"Obrve\", \"Usne\", \"Eyeliner\"]'::jsonb, true, NULL),\n      ('estetika-masaza', 'Estetika i masaža', '[\"Estetika\", \"Masaža\", \"Terapeut\"]'::jsonb, true, NULL),\n      ('masaza-terapeuti', 'Masaža/Terapeuti', '[\"Relaks masaža\", \"Sportska masaža\", \"Terapeut\"]'::jsonb, true, NULL),\n      ('estetika-anti-aging', 'Estetika/anti-aging', '[\"Anti-aging\", \"Mezoterapija\", \"Nega lica\"]'::jsonb, true, NULL),\n      ('pomocno-osoblje', 'Pomoćno osoblje', '[\"Recepcija\", \"Asistent u salonu\", \"Šampon\"]'::jsonb, true, NULL),\n      ('tattoo-piercing', 'Tattoo/Piercing', '[\"Tattoo\", \"Piercing\"]'::jsonb, true, 'beauty_jobs_tattoo_piercing'),\n      ('iznajmljivanje-opreme', 'Iznajmljivanje opreme', '[]'::jsonb, true, NULL),\n      ('iznajmljivanje-prostora-stolice', 'Iznajmljivanje prostora/stolice', '[\"Stolica\", \"Kabina\", \"Prostor\"]'::jsonb, true, NULL),\n      ('freelance-angazmani', 'Freelance/angažmani', '[]'::jsonb, true, NULL)\n      ON CONFLICT (slug) DO UPDATE SET\n        name = EXCLUDED.name,\n        subtype_labels = EXCLUDED.subtype_labels,\n        enabled = EXCLUDED.enabled,\n        feature_flag = EXCLUDED.feature_flag,\n        updated_at = now()"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 37; source starts line 2359, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.beauty_job_categories (slug, name, subtype_labels, enabled, feature_flag) VALUES ('frizeri', 'Frizeri', '[\"Ženski frizer\", \"Muški frizer\", \"Kolorista\"]'::jsonb, true, NULL), ('barberi', 'Barberi', '[\"Šišanje\", \"Brijanje\", \"Stilizovanje brade\"]'::jsonb, true, NULL), ('kozmetika', 'Kozmetika', '[]'::jsonb, true, NULL), ('kozmeticari', 'Kozmetičari', '[\"Nega lica\", \"Depilacija\", \"Tretmani tela\"]'::jsonb, true, NULL), ('nokti', 'Nokti (Manikir/Pedikir)', '[\"Manikir\", \"Pedikir\", \"Nail artist\"]'::jsonb, true, NULL), ('lash-brow', 'Lash/Brow', '[\"Ekstenzije trepavica\", \"Laminacija trepavica\", \"Obrve\"]'::jsonb, true, NULL), ('make-up', 'Make-up', '[\"Dnevna šminka\", \"Svečana šminka\"]'::jsonb, true, NULL), ('sminkeri', 'Šminkeri', '[\"Dnevna šminka\", \"Svečana šminka\", \"Editorial\"]'::jsonb, true, NULL), ('pmu', 'PMU', '[\"Obrve\", \"Usne\", \"Eyeliner\"]'::jsonb, true, NULL), ('estetika-masaza', 'Estetika i masaža', '[\"Estetika\", \"Masaža\", \"Terapeut\"]'::jsonb, true, NULL), ('masaza-terapeuti', 'Masaža/Terapeuti', '[\"Relaks masaža\", \"Sportska masaža\", \"Terapeut\"]'::jsonb, true, NULL), ('estetika-anti-aging', 'Estetika/anti-aging', '[\"Anti-aging\", \"Mezoterapija\", \"Nega lica\"]'::jsonb, true, NULL), ('pomocno-osoblje', 'Pomoćno osoblje', '[\"Recepcija\", \"Asistent u salonu\", \"Šampon\"]'::jsonb, true, NULL), ('tattoo-piercing', 'Tattoo/Piercing', '[\"Tattoo\", \"Piercing\"]'::jsonb, true, 'beauty_jobs_tattoo_piercing'), ('iznajmljivanje-opreme', 'Iznajmljivanje opreme', '[]'::jsonb, true, NULL), ('iznajmljivanje-prostora-stolice', 'Iznajmljivanje prostora/stolice', '[\"Stolica\", \"Kabina\", \"Prostor\"]'::jsonb, true, NULL), ('freelance-angazmani', 'Freelance/angažmani', '[]'::jsonb, true, NULL) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, subtype_labels = EXCLUDED.subtype_labels, enabled = EXCLUDED.enabled, feature_flag = EXCLUDED.feature_flag, updated_at = now()"
    },
    "repeatSafety": {
      "assessment": "Repeatable but not a no-op",
      "evidence": "ON CONFLICT(slug) DO UPDATE rewrites every curated category and updated_at=now() every full-rollout execution."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (beauty_job_categories). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical beauty_job_categories definition at lib/db/migrations/000001_canonical_schema/migration.sql:2403-2412. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-239-3c7d7a0db051017c",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:239:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 239,
        "endLine": 248,
        "sqlOrCode": "UPDATE ${s}.education_installments installment\n       SET payment_instructions_snapshot = jsonb_build_object(\n         'payload', ${payload(\"installment.amount\", \"installment.payment_reference\")},\n         'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account,\n         'purpose', settings.ips_purpose, 'amount', installment.amount, 'currency', 'RSD',\n         'reference', installment.payment_reference, 'paymentCode', '221')\n       FROM ${validSettings} settings\n       WHERE installment.payment_instructions_snapshot IS NULL\n         AND installment.status = 'pending' AND installment.amount > 0\n         AND btrim(COALESCE(installment.payment_reference, '')) <> ''"
      },
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 217,
        "endLine": 227,
        "sqlOrCode": "function paymentInstructionSnapshotBackfillStatements(s: string): string[] {\n  const validSettings = `(SELECT ips_recipient_name, regexp_replace(ips_recipient_account, '[[:space:]-]', '', 'g') AS account, ips_purpose\n    FROM ${s}.education_platform_settings\n    WHERE btrim(COALESCE(ips_recipient_name, '')) <> ''\n      AND btrim(COALESCE(ips_purpose, '')) <> ''\n      AND regexp_replace(COALESCE(ips_recipient_account, ''), '[[:space:]-]', '', 'g') ~ '^[0-9]{18}$'\n    ORDER BY updated_at DESC, id DESC LIMIT 1)`;\n  const payload = (amount: string, reference: string) => `concat(\n    'K:PR|V:01|C:1|R:', settings.account, '|N:', settings.ips_recipient_name,\n    '|I:RSD', replace(to_char(${amount}::numeric, 'FM999999999999990.00'), '.', ','),\n    '|P:', settings.ips_purpose, '|SF:221|S:', ${reference})`;"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 2; source starts line 239, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_installments installment SET payment_instructions_snapshot = jsonb_build_object( 'payload', ${payload(\"installment.amount\", \"installment.payment_reference\")}, 'recipientName', settings.ips_recipient_name, 'recipientAccount', settings.account, 'purpose', settings.ips_purpose, 'amount', installment.amount, 'currency', 'RSD', 'reference', installment.payment_reference, 'paymentCode', '221') FROM ${validSettings} settings WHERE installment.payment_instructions_snapshot IS NULL AND installment.status = 'pending' AND installment.amount > 0 AND btrim(COALESCE(installment.payment_reference, '')) <> ''"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_installments). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_installments definition at lib/db/migrations/000001_canonical_schema/migration.sql:3889-3903. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2422-7a8726353abf6169",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2422:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2422,
        "endLine": 2423,
        "sqlOrCode": "INSERT INTO ${s}.shop_settings DEFAULT VALUES ON CONFLICT DO NOTHING`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 38; source starts line 2422, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.shop_settings DEFAULT VALUES ON CONFLICT DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (shop_settings). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical shop_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:6555-6583. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2695-39cdb0336fc9d71c",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2695:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2695,
        "endLine": 2709,
        "sqlOrCode": "DO $$ BEGIN\n       IF to_regclass('course_enrollments') IS NOT NULL THEN\n         UPDATE ${s}.users u SET role = 'JOBSEEKER'\n         WHERE u.role = 'CUSTOMER'\n           AND (EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id)\n             OR EXISTS (\n               SELECT 1 FROM ${s}.course_enrollments e\n               WHERE e.user_id = u.id OR e.purchaser_id = u.id\n             ));\n       ELSE\n         UPDATE ${s}.users u SET role = 'JOBSEEKER'\n         WHERE u.role = 'CUSTOMER'\n           AND EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id);\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 44; source starts line 2695, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF to_regclass('course_enrollments') IS NOT NULL THEN UPDATE ${s}.users u SET role = 'JOBSEEKER' WHERE u.role = 'CUSTOMER' AND (EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id) OR EXISTS ( SELECT 1 FROM ${s}.course_enrollments e WHERE e.user_id = u.id OR e.purchaser_id = u.id )); ELSE UPDATE ${s}.users u SET role = 'JOBSEEKER' WHERE u.role = 'CUSTOMER' AND EXISTS (SELECT 1 FROM ${s}.beauty_job_listings l WHERE l.user_id = u.id); END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (users, beauty_job_listings, course_enrollments). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical users definition at lib/db/migrations/000001_canonical_schema/migration.sql:6795-6813. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2881-fac76aef0bba8911",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2881:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2881,
        "endLine": 2882,
        "sqlOrCode": "UPDATE ${s}.retail_product_subscriptions SET anchor_day = EXTRACT(DAY FROM next_due_at)::integer WHERE anchor_day IS NULL`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 47; source starts line 2881, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.retail_product_subscriptions SET anchor_day = EXTRACT(DAY FROM next_due_at)::integer WHERE anchor_day IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_product_subscriptions). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_product_subscriptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:5946-5969. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2919-6b25b308a9585583",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2919:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2919,
        "endLine": 2933,
        "sqlOrCode": "DO $$ BEGIN\n       IF EXISTS (\n         SELECT 1 FROM information_schema.columns\n         WHERE table_schema = current_schema() AND table_name = 'retail_product_reviews'\n           AND column_name = 'moderation_status' AND udt_name <> 'retail_review_moderation_status'\n       ) THEN\n         UPDATE ${s}.retail_product_reviews SET moderation_status = 'PUBLISHED'\n           WHERE moderation_status IN ('APPROVED', 'PENDING');\n         UPDATE ${s}.retail_product_reviews SET moderation_status = 'REMOVED'\n           WHERE moderation_status = 'REJECTED';\n         ALTER TABLE ${s}.retail_product_reviews ALTER COLUMN moderation_status\n           TYPE ${s}.retail_review_moderation_status\n           USING moderation_status::${s}.retail_review_moderation_status;\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 48; source starts line 2919, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF EXISTS ( SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'retail_product_reviews' AND column_name = 'moderation_status' AND udt_name <> 'retail_review_moderation_status' ) THEN UPDATE ${s}.retail_product_reviews SET moderation_status = 'PUBLISHED' WHERE moderation_status IN ('APPROVED', 'PENDING'); UPDATE ${s}.retail_product_reviews SET moderation_status = 'REMOVED' WHERE moderation_status = 'REJECTED'; ALTER TABLE ${s}.retail_product_reviews ALTER COLUMN moderation_status TYPE ${s}.retail_review_moderation_status USING moderation_status::${s}.retail_review_moderation_status; END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_product_reviews, retail_review_moderation_status; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_product_reviews definition at lib/db/migrations/000001_canonical_schema/migration.sql:5906-5919. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2936-d3851b0242da2b62",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2936:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2936,
        "endLine": 2941,
        "sqlOrCode": "WITH ranked AS (\n       SELECT id, row_number() OVER (PARTITION BY product_id, user_id ORDER BY updated_at DESC, id DESC) AS position\n       FROM ${s}.retail_product_reviews WHERE moderation_status <> 'REMOVED'\n     )\n     UPDATE ${s}.retail_product_reviews review SET moderation_status = 'REMOVED', removed_at = coalesce(removed_at, now())\n     FROM ranked WHERE review.id = ranked.id AND ranked.position > 1"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 49; source starts line 2936, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "WITH ranked AS ( SELECT id, row_number() OVER (PARTITION BY product_id, user_id ORDER BY updated_at DESC, id DESC) AS position FROM ${s}.retail_product_reviews WHERE moderation_status <> 'REMOVED' ) UPDATE ${s}.retail_product_reviews review SET moderation_status = 'REMOVED', removed_at = coalesce(removed_at, now()) FROM ranked WHERE review.id = ranked.id AND ranked.position > 1"
    },
    "repeatSafety": {
      "assessment": "Current-state reconciliation, not proven repeat-safe",
      "evidence": "It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_product_reviews). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_product_reviews definition at lib/db/migrations/000001_canonical_schema/migration.sql:5906-5919. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2968-494603558aae3266",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2968:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2968,
        "endLine": 2975,
        "sqlOrCode": "UPDATE ${s}.products product SET\n       average_rating = COALESCE(aggregate.average_rating, 0),\n       review_count = COALESCE(aggregate.review_count, 0)\n     FROM (\n       SELECT product_id, round(avg(rating)::numeric)::integer AS average_rating, count(*)::integer AS review_count\n       FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED'\n       GROUP BY product_id\n     ) aggregate WHERE product.id = aggregate.product_id"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 50; source starts line 2968, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.products product SET average_rating = COALESCE(aggregate.average_rating, 0), review_count = COALESCE(aggregate.review_count, 0) FROM ( SELECT product_id, round(avg(rating)::numeric)::integer AS average_rating, count(*)::integer AS review_count FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED' GROUP BY product_id ) aggregate WHERE product.id = aggregate.product_id"
    },
    "repeatSafety": {
      "assessment": "Current-state reconciliation, not proven repeat-safe",
      "evidence": "It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (products, retail_product_reviews). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2976-412e8f0768e1bc53",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2976:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2976,
        "endLine": 2977,
        "sqlOrCode": "UPDATE ${s}.products SET average_rating = 0, review_count = 0\n     WHERE id NOT IN (SELECT DISTINCT product_id FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED')"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 51; source starts line 2976, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.products SET average_rating = 0, review_count = 0 WHERE id NOT IN (SELECT DISTINCT product_id FROM ${s}.retail_product_reviews WHERE moderation_status = 'PUBLISHED')"
    },
    "repeatSafety": {
      "assessment": "Current-state reconciliation, not proven repeat-safe",
      "evidence": "It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (products, retail_product_reviews). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3132-bf601a52b45412ad",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3132:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3132,
        "endLine": 3136,
        "sqlOrCode": "INSERT INTO ${s}.b2c_display_settings DEFAULT VALUES ON CONFLICT DO NOTHING`,\n\n    // v53 — Deo E/F commerce workflows. All evidence and one-time issuance\n    // fences are additive, preserving existing catalog, cart and stock models.\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 53; source starts line 3132, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.b2c_display_settings DEFAULT VALUES ON CONFLICT DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (b). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "no CREATE TABLE public.b block located by exact static search. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3331-f96678a064f57e85",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3331:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3331,
        "endLine": 3332,
        "sqlOrCode": "INSERT INTO ${s}.aftercare_settings (version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${s}.aftercare_settings)`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 54; source starts line 3331, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.aftercare_settings (version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${s}.aftercare_settings)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (aftercare_settings). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical aftercare_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:1878-1895. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3572-250192559736fe3b",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3572:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3572,
        "endLine": 3575,
        "sqlOrCode": "INSERT INTO ${s}.employee_location_assignments\n       (employee_id, salon_id, active, is_default)\n     SELECT id, salon_id, true, true FROM ${s}.employees\n     ON CONFLICT (employee_id, salon_id) DO NOTHING"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 59; source starts line 3572, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.employee_location_assignments (employee_id, salon_id, active, is_default) SELECT id, salon_id, true, true FROM ${s}.employees ON CONFLICT (employee_id, salon_id) DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (employee_location_assignments, employees). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical employee_location_assignments definition at lib/db/migrations/000001_canonical_schema/migration.sql:4531-4539. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3596-db0912b7323d3d0c",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3596:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3596,
        "endLine": 3605,
        "sqlOrCode": "DO $$ BEGIN\n       IF to_regclass('${s}.employee_schedules') IS NOT NULL THEN\n         INSERT INTO ${s}.employee_location_schedules\n           (employee_id, salon_id, weekday, start_time, end_time, break_start, break_end)\n         SELECT es.employee_id, e.salon_id, es.weekday, es.start_time, es.end_time, es.break_start, es.break_end\n         FROM ${s}.employee_schedules es\n         INNER JOIN ${s}.employees e ON e.id = es.employee_id\n         ON CONFLICT (employee_id, salon_id, weekday, start_time, end_time) DO NOTHING;\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 60; source starts line 3596, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF to_regclass('${s}.employee_schedules') IS NOT NULL THEN INSERT INTO ${s}.employee_location_schedules (employee_id, salon_id, weekday, start_time, end_time, break_start, break_end) SELECT es.employee_id, e.salon_id, es.weekday, es.start_time, es.end_time, es.break_start, es.break_end FROM ${s}.employee_schedules es INNER JOIN ${s}.employees e ON e.id = es.employee_id ON CONFLICT (employee_id, salon_id, weekday, start_time, end_time) DO NOTHING; END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (employee_schedules, employee_location_schedules, employees). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical employee_location_schedules definition at lib/db/migrations/000001_canonical_schema/migration.sql:4546-4557. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3654-b0ba64dd10e18464",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3654:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3654,
        "endLine": 3655,
        "sqlOrCode": "INSERT INTO ${s}.salon_booking_settings (salon_id)\n       SELECT id FROM ${s}.salons ON CONFLICT (salon_id) DO NOTHING"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 61; source starts line 3654, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.salon_booking_settings (salon_id) SELECT id FROM ${s}.salons ON CONFLICT (salon_id) DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (salon_booking_settings, salons). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical salon_booking_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:6088-6104. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3711-e115085ae3a4eea5",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3711:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3711,
        "endLine": 3717,
        "sqlOrCode": "UPDATE ${s}.appointments SET\n       planned_date=COALESCE(planned_date, appointment_date),\n       planned_start_time=COALESCE(planned_start_time, start_time),\n       planned_end_time=COALESCE(planned_end_time, end_time)\n     WHERE (planned_date IS NULL AND appointment_date IS NOT NULL)\n        OR (planned_start_time IS NULL AND start_time IS NOT NULL)\n        OR (planned_end_time IS NULL AND end_time IS NOT NULL)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 62; source starts line 3711, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.appointments SET planned_date=COALESCE(planned_date, appointment_date), planned_start_time=COALESCE(planned_start_time, start_time), planned_end_time=COALESCE(planned_end_time, end_time) WHERE (planned_date IS NULL AND appointment_date IS NOT NULL) OR (planned_start_time IS NULL AND start_time IS NOT NULL) OR (planned_end_time IS NULL AND end_time IS NOT NULL)"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (appointments). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical appointments definition at lib/db/migrations/000001_canonical_schema/migration.sql:2040-2090. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3730-d7b68a70ac97f701",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3730:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3730,
        "endLine": 3732,
        "sqlOrCode": "UPDATE ${s}.appointment_status_history\n       SET occurred_at = COALESCE(occurred_at, created_at)\n       WHERE occurred_at IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 63; source starts line 3730, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.appointment_status_history SET occurred_at = COALESCE(occurred_at, created_at) WHERE occurred_at IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (appointment_status_history). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical appointment_status_history definition at lib/db/migrations/000001_canonical_schema/migration.sql:1980-1988. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3755-614961c1b7f1f97a",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3755:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3755,
        "endLine": 3763,
        "sqlOrCode": "INSERT INTO ${s}.appointment_treatments\n       (appointment_id, service_id, employee_id, position, duration_minutes, buffer_minutes,\n        price, planned_start_time, planned_end_time)\n     SELECT a.id, a.service_id, a.employee_id, 0, a.duration_minutes,\n       COALESCE(svc.buffer_minutes, 0), a.price, a.start_time, a.end_time\n     FROM ${s}.appointments a JOIN ${s}.services svc ON svc.id=a.service_id\n     WHERE a.service_id IS NOT NULL AND a.duration_minutes IS NOT NULL AND a.duration_minutes > 0\n       AND a.price IS NOT NULL\n     ON CONFLICT (appointment_id, position) DO NOTHING"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 64; source starts line 3755, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.appointment_treatments (appointment_id, service_id, employee_id, position, duration_minutes, buffer_minutes, price, planned_start_time, planned_end_time) SELECT a.id, a.service_id, a.employee_id, 0, a.duration_minutes, COALESCE(svc.buffer_minutes, 0), a.price, a.start_time, a.end_time FROM ${s}.appointments a JOIN ${s}.services svc ON svc.id=a.service_id WHERE a.service_id IS NOT NULL AND a.duration_minutes IS NOT NULL AND a.duration_minutes > 0 AND a.price IS NOT NULL ON CONFLICT (appointment_id, position) DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (appointment_treatments, appointments, services). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical appointment_treatments definition at lib/db/migrations/000001_canonical_schema/migration.sql:1995-2012. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3986-3bf6cb92731753e4",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3986:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3986,
        "endLine": 3993,
        "sqlOrCode": "WITH ranked AS (\n       SELECT id, row_number() OVER (\n         PARTITION BY kind, scope, coalesce(scope_category_id::text, scope_subcategory_id::text, 'home'), slot_number\n         ORDER BY starts_at DESC NULLS LAST, created_at DESC\n       ) AS rn\n       FROM ${s}.education_placements WHERE status = 'active'\n     ) UPDATE ${s}.education_placements p SET status = 'expired', updated_at = now()\n       FROM ranked r WHERE p.id = r.id AND r.rn > 1"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 65; source starts line 3986, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "WITH ranked AS ( SELECT id, row_number() OVER ( PARTITION BY kind, scope, coalesce(scope_category_id::text, scope_subcategory_id::text, 'home'), slot_number ORDER BY starts_at DESC NULLS LAST, created_at DESC ) AS rn FROM ${s}.education_placements WHERE status = 'active' ) UPDATE ${s}.education_placements p SET status = 'expired', updated_at = now() FROM ranked r WHERE p.id = r.id AND r.rn > 1"
    },
    "repeatSafety": {
      "assessment": "Current-state reconciliation, not proven repeat-safe",
      "evidence": "It recomputes/changes rows from current review or placement state; unchanged state may converge, but source gives no concurrency or production proof."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placements). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_placements definition at lib/db/migrations/000001_canonical_schema/migration.sql:4167-4200. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3997-5176a2b88baf0779",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3997:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3997,
        "endLine": 4004,
        "sqlOrCode": "UPDATE ${s}.education_placements p\n        SET duration_days_snapshot = coalesce((\n          SELECT ps.duration_days\n          FROM ${s}.education_placement_settings ps\n          WHERE ps.kind = p.kind AND ps.scope = p.scope\n          LIMIT 1\n        ), 30)\n      WHERE p.duration_days_snapshot IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 66; source starts line 3997, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_placements p SET duration_days_snapshot = coalesce(( SELECT ps.duration_days FROM ${s}.education_placement_settings ps WHERE ps.kind = p.kind AND ps.scope = p.scope LIMIT 1 ), 30) WHERE p.duration_days_snapshot IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placements, education_placement_settings). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_placements definition at lib/db/migrations/000001_canonical_schema/migration.sql:4167-4200. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4045-8ed7a084462e9112",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4045:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4045,
        "endLine": 4047,
        "sqlOrCode": "INSERT INTO ${s}.education_placement_settings (kind, scope, price, slot_count, duration_days)\n       VALUES ('featured_salon', 'home', 5000, 12, 30)\n       ON CONFLICT (kind, scope) DO NOTHING"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 67; source starts line 4045, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.education_placement_settings (kind, scope, price, slot_count, duration_days) VALUES ('featured_salon', 'home', 5000, 12, 30) ON CONFLICT (kind, scope) DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placement_settings). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_placement_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:4147-4160. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4048-10e4a54f14166cb6",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4048:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4048,
        "endLine": 4050,
        "sqlOrCode": "UPDATE ${s}.education_placements\n       SET payment_reference = 'FP-' || replace(id::text, '-', '')\n       WHERE payment_reference IS NULL OR length(payment_reference) > 35"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 68; source starts line 4048, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_placements SET payment_reference = 'FP-' || replace(id::text, '-', '') WHERE payment_reference IS NULL OR length(payment_reference) > 35"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_placements). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_placements definition at lib/db/migrations/000001_canonical_schema/migration.sql:4167-4200. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4384-e015e2034c777257",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4384:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4384,
        "endLine": 4432,
        "sqlOrCode": "DO $cleanup$\n     DECLARE candidate record; dependency record; has_dependency boolean;\n       salon_owner_column text; cleanup_supported boolean;\n       candidate_count integer := 0; detached_count integer := 0;\n       deleted_count integer := 0; retired_count integer := 0; affected integer;\n     BEGIN\n       SELECT column_name INTO salon_owner_column FROM information_schema.columns\n         WHERE table_schema = current_schema() AND table_name = 'salons'\n           AND column_name IN ('user_id', 'owner_id')\n         ORDER BY CASE column_name WHEN 'user_id' THEN 0 ELSE 1 END LIMIT 1;\n       SELECT salon_owner_column IS NOT NULL\n         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='active')\n         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='slug')\n         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='short_description')\n         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='salons' AND column_name='description')\n         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='active_salon_id')\n         INTO cleanup_supported;\n       IF NOT cleanup_supported THEN\n         INSERT INTO ${s}.education_salon_cleanup_reports (version,candidates,detached_users,deleted_salons,retired_salons)\n         VALUES (99,0,0,0,0) ON CONFLICT (version) DO NOTHING;\n         RETURN;\n       END IF;\n       FOR candidate IN EXECUTE format(\n          'SELECT s.id FROM ${s}.salons s JOIN ${s}.users u ON u.id = s.%I\n           WHERE u.role::text = ''EDUKATIVNI_CENTAR''\n             AND EXISTS (SELECT 1 FROM ${s}.education_centers ec WHERE ec.owner_id = u.id)\n             AND s.active = false AND s.slug LIKE ''%%-'' || left(u.id::text, 8)\n             AND s.short_description = s.name || '' je novi LUMERA partner.''\n             AND s.description = ''Poslovni profil za '' || s.name || ''. Dopunite ponudu, tim i radno vreme iz poslovnog portala.''\n             AND s.provisioning_source IS NULL', salon_owner_column)\n       LOOP\n         candidate_count := candidate_count + 1;\n         UPDATE ${s}.users SET active_salon_id = NULL\n           WHERE active_salon_id = candidate.id;\n         GET DIAGNOSTICS affected = ROW_COUNT;\n         detached_count := detached_count + affected;\n          -- Never delete a historic tenant row: it may be referenced by\n          -- records unknown to this rollout or retained for audit purposes.\n          -- The row is merely retired after detaching any active selection.\n          UPDATE ${s}.salons SET active = false,\n            provisioning_source = 'legacy_education_registration_retired'\n            WHERE id = candidate.id;\n          retired_count := retired_count + 1;\n       END LOOP;\n       INSERT INTO ${s}.education_salon_cleanup_reports\n         (version, candidates, detached_users, deleted_salons, retired_salons, completed_at)\n       VALUES (99, candidate_count, detached_count, deleted_count, retired_count, now())\n       ON CONFLICT (version) DO NOTHING;\n     END $cleanup$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 71; source starts line 4384, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "state-dependent cleanup/reconciliation plus report insertion",
      "description": "Finds narrowly patterned retired education-owner salons, nulls active_salon_id, retires salons, and inserts a v99 report; source comments explicitly say no historic tenant row is deleted."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — stateful historical cleanup",
      "evidence": "Report INSERT uses ON CONFLICT DO NOTHING, but candidate selection and user/salon updates precede it on every low-version retry; source cannot prove the predicate identifies only intended legacy rows."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_salon_cleanup_reports, salons, users, education_centers; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_salon_cleanup_reports definition at lib/db/migrations/000001_canonical_schema/migration.sql:4294-4301. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4440-3b021060842ebb73",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4440:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4440,
        "endLine": 4441,
        "sqlOrCode": "INSERT INTO ${s}.education_b2b_discount_settings (id, version) VALUES (true, 1) ON CONFLICT (id) DO NOTHING`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 72; source starts line 4440, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.education_b2b_discount_settings (id, version) VALUES (true, 1) ON CONFLICT (id) DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_b). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "no CREATE TABLE public.education_b block located by exact static search. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4549-fee2c22731f4db15",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4549:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4549,
        "endLine": 4550,
        "sqlOrCode": "UPDATE ${s}.salons SET payment_reference_number = 'SAL' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 73; source starts line 4549, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.salons SET payment_reference_number = 'SAL' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (salons). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical salons definition at lib/db/migrations/000001_canonical_schema/migration.sql:6298-6338. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4550-6ad13fc9e1caeb85",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4550:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4550,
        "endLine": 4551,
        "sqlOrCode": "UPDATE ${s}.education_centers SET payment_reference_number = 'EDU' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 74; source starts line 4550, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_centers SET payment_reference_number = 'EDU' || replace(id::text, '-', '') WHERE payment_reference_number IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_centers). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_centers definition at lib/db/migrations/000001_canonical_schema/migration.sql:3550-3587. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4605-bca8bd2f500d308e",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4605:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4605,
        "endLine": 4611,
        "sqlOrCode": "INSERT INTO ${s}.subscription_plans (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active)\n       SELECT 'Education legacy ' || p.id::text, p.price, 30, p.features, p.limits,\n              'education', COALESCE((p.limits->>'courses')::integer, 5), true, 'Cena uključuje PDV.', p.active\n       FROM ${s}.subscription_plans p\n       WHERE EXISTS (SELECT 1 FROM ${s}.education_center_subscriptions e WHERE e.plan_id = p.id)\n         AND EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = p.id)\n         AND NOT EXISTS (SELECT 1 FROM ${s}.subscription_plans clone WHERE clone.name = 'Education legacy ' || p.id::text)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 76; source starts line 4605, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.subscription_plans (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active) SELECT 'Education legacy ' || p.id::text, p.price, 30, p.features, p.limits, 'education', COALESCE((p.limits->>'courses')::integer, 5), true, 'Cena uključuje PDV.', p.active FROM ${s}.subscription_plans p WHERE EXISTS (SELECT 1 FROM ${s}.education_center_subscriptions e WHERE e.plan_id = p.id) AND EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = p.id) AND NOT EXISTS (SELECT 1 FROM ${s}.subscription_plans clone WHERE clone.name = 'Education legacy ' || p.id::text)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans, education_center_subscriptions, subscriptions). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4612-65b1d33770d816b1",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4612:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4612,
        "endLine": 4616,
        "sqlOrCode": "UPDATE ${s}.education_center_subscriptions e SET plan_id = clone.id\n       FROM ${s}.subscription_plans legacy\n       JOIN ${s}.subscription_plans clone ON clone.name = 'Education legacy ' || legacy.id::text\n       WHERE e.plan_id = legacy.id\n         AND EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = legacy.id)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 77; source starts line 4612, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_center_subscriptions e SET plan_id = clone.id FROM ${s}.subscription_plans legacy JOIN ${s}.subscription_plans clone ON clone.name = 'Education legacy ' || legacy.id::text WHERE e.plan_id = legacy.id AND EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = legacy.id)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_center_subscriptions, subscription_plans, subscriptions). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_center_subscriptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:3509-3543. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4617-2b63853ba688a383",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4617:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4617,
        "endLine": 4619,
        "sqlOrCode": "UPDATE ${s}.subscription_plans p SET audience = 'education'\n       WHERE EXISTS (SELECT 1 FROM ${s}.education_center_subscriptions e WHERE e.plan_id = p.id)\n         AND NOT EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = p.id)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 78; source starts line 4617, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.subscription_plans p SET audience = 'education' WHERE EXISTS (SELECT 1 FROM ${s}.education_center_subscriptions e WHERE e.plan_id = p.id) AND NOT EXISTS (SELECT 1 FROM ${s}.subscriptions salon_subscription WHERE salon_subscription.plan_id = p.id)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans, education_center_subscriptions, subscriptions). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4620-20518488727fd1ea",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4620:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4620,
        "endLine": 4627,
        "sqlOrCode": "WITH ranked AS (\n       SELECT p.id, row_number() over (ORDER BY p.price, p.id) AS tier\n       FROM ${s}.subscription_plans p WHERE p.audience = 'education'\n     ) UPDATE ${s}.subscription_plans p SET\n       course_limit = CASE ranked.tier WHEN 1 THEN 5 WHEN 2 THEN 15 ELSE 30 END,\n       trial_days = 30, vat_included = true,\n       price_copy = COALESCE(p.price_copy, 'Cena uključuje PDV.')\n       FROM ranked WHERE p.id = ranked.id AND ranked.tier <= 3 AND p.course_limit IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 79; source starts line 4620, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "WITH ranked AS ( SELECT p.id, row_number() over (ORDER BY p.price, p.id) AS tier FROM ${s}.subscription_plans p WHERE p.audience = 'education' ) UPDATE ${s}.subscription_plans p SET course_limit = CASE ranked.tier WHEN 1 THEN 5 WHEN 2 THEN 15 ELSE 30 END, trial_days = 30, vat_included = true, price_copy = COALESCE(p.price_copy, 'Cena uključuje PDV.') FROM ranked WHERE p.id = ranked.id AND ranked.tier <= 3 AND p.course_limit IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4628-9cb6b5d7843e9b57",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4628:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4628,
        "endLine": 4632,
        "sqlOrCode": "INSERT INTO ${s}.subscription_plans (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active)\n       SELECT seed.name, 0, 30, '[]'::jsonb, jsonb_build_object('courses', seed.course_limit),\n               'education', seed.course_limit, true, 'Cena uključuje PDV.', false\n       FROM (VALUES ('Education Start', 5), ('Education Growth', 15), ('Education Academy', 30)) seed(name, course_limit)\n       WHERE NOT EXISTS (SELECT 1 FROM ${s}.subscription_plans p WHERE p.audience='education' AND p.course_limit=seed.course_limit)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 80; source starts line 4628, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.subscription_plans (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active) SELECT seed.name, 0, 30, '[]'::jsonb, jsonb_build_object('courses', seed.course_limit), 'education', seed.course_limit, true, 'Cena uključuje PDV.', false FROM (VALUES ('Education Start', 5), ('Education Growth', 15), ('Education Academy', 30)) seed(name, course_limit) WHERE NOT EXISTS (SELECT 1 FROM ${s}.subscription_plans p WHERE p.audience='education' AND p.course_limit=seed.course_limit)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4633-646139d3dc75e519",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4633:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4633,
        "endLine": 4636,
        "sqlOrCode": "UPDATE ${s}.subscription_plans SET active = CASE WHEN price > 0 THEN active ELSE false END, trial_days = 30, vat_included = true,\n       price_copy = 'Cena uključuje PDV.'\n       WHERE audience = 'education' AND name IN ('Education Start', 'Education Growth', 'Education Academy')\n         AND course_limit IN (5,15,30)"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 81; source starts line 4633, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.subscription_plans SET active = CASE WHEN price > 0 THEN active ELSE false END, trial_days = 30, vat_included = true, price_copy = 'Cena uključuje PDV.' WHERE audience = 'education' AND name IN ('Education Start', 'Education Growth', 'Education Academy') AND course_limit IN (5,15,30)"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4637-02f9ac5d3b3e194f",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4637:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4637,
        "endLine": 4638,
        "sqlOrCode": "UPDATE ${s}.subscription_plans SET active = false WHERE audience = 'education' AND price <= 0`,\n    "
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 82; source starts line 4637, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.subscription_plans SET active = false WHERE audience = 'education' AND price <= 0"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4638-413cfe6b52f96aea",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4638:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4638,
        "endLine": 4639,
        "sqlOrCode": "UPDATE ${s}.subscription_plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{courses}', to_jsonb(course_limit))\n       WHERE audience='education' AND course_limit IS NOT NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 83; source starts line 4638, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.subscription_plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{courses}', to_jsonb(course_limit)) WHERE audience='education' AND course_limit IS NOT NULL"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (subscription_plans). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical subscription_plans definition at lib/db/migrations/000001_canonical_schema/migration.sql:6662-6676. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4644-20d1b40e2d83dc7f",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4644:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4644,
        "endLine": 4647,
        "sqlOrCode": "UPDATE ${s}.education_center_subscriptions e SET\n       current_price_snapshot = COALESCE(e.current_price_snapshot, p.price),\n       current_course_limit_snapshot = COALESCE(e.current_course_limit_snapshot, e.course_limit_override, p.course_limit)\n       FROM ${s}.subscription_plans p WHERE p.id=e.plan_id AND e.status IN ('trial','active','free_via_loyalty')"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 84; source starts line 4644, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_center_subscriptions e SET current_price_snapshot = COALESCE(e.current_price_snapshot, p.price), current_course_limit_snapshot = COALESCE(e.current_course_limit_snapshot, e.course_limit_override, p.course_limit) FROM ${s}.subscription_plans p WHERE p.id=e.plan_id AND e.status IN ('trial','active','free_via_loyalty')"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_center_subscriptions, subscription_plans). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_center_subscriptions definition at lib/db/migrations/000001_canonical_schema/migration.sql:3509-3543. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4750-a8631b053767de30",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4750:6",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4750,
        "endLine": 4755,
        "sqlOrCode": "UPDATE ${s}.education_platform_settings\n        SET bank_reconciliation_access_method=NULL,\n            bank_reconciliation_access_confirmed_at=NULL,\n            bank_reconciliation_access_confirmed_by_user_id=NULL\n      WHERE bank_reconciliation_access_confirmed_at IS NULL\n         OR bank_reconciliation_access_confirmed_by_user_id IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 85; source starts line 4750, column 6.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_platform_settings SET bank_reconciliation_access_method=NULL, bank_reconciliation_access_confirmed_at=NULL, bank_reconciliation_access_confirmed_by_user_id=NULL WHERE bank_reconciliation_access_confirmed_at IS NULL OR bank_reconciliation_access_confirmed_by_user_id IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_platform_settings). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_platform_settings definition at lib/db/migrations/000001_canonical_schema/migration.sql:4207-4228. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4801-3cae2900c669c65a",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4801:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4801,
        "endLine": 4813,
        "sqlOrCode": "UPDATE ${s}.course_enrollments enrollment SET\n       access_days_snapshot = COALESCE(enrollment.access_days_snapshot, course.online_access_days),\n       course_price_snapshot = COALESCE(enrollment.course_price_snapshot, course.price),\n       duration_snapshot = COALESCE(enrollment.duration_snapshot, course.duration),\n       extension_prices_snapshot = COALESCE(enrollment.extension_prices_snapshot,\n         jsonb_build_object('oneMonth', course.extension_price_1_month, 'threeMonths', course.extension_price_3_months, 'sixMonths', course.extension_price_6_months)),\n       access_expires_at = CASE WHEN enrollment.access_expires_at IS NULL\n         THEN COALESCE(enrollment.access_granted_at, enrollment.purchased_at, now()) + make_interval(days => course.online_access_days)\n         ELSE enrollment.access_expires_at END\n     FROM ${s}.courses course\n     WHERE enrollment.course_id = course.id AND course.format = 'online'\n       AND enrollment.status IN ('active','completed') AND enrollment.payment_status = 'paid'\n       AND course.online_access_days > 0"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 86; source starts line 4801, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.course_enrollments enrollment SET access_days_snapshot = COALESCE(enrollment.access_days_snapshot, course.online_access_days), course_price_snapshot = COALESCE(enrollment.course_price_snapshot, course.price), duration_snapshot = COALESCE(enrollment.duration_snapshot, course.duration), extension_prices_snapshot = COALESCE(enrollment.extension_prices_snapshot, jsonb_build_object('oneMonth', course.extension_price_1_month, 'threeMonths', course.extension_price_3_months, 'sixMonths', course.extension_price_6_months)), access_expires_at = CASE WHEN enrollment.access_expires_at IS NULL THEN COALESCE(enrollment.access_granted_at, enrollment.purchased_at, now()) + make_interval(days => course.online_access_days) ELSE enrollment.access_expires_at END FROM ${s}.courses course WHERE enrollment.course_id = course.id AND course.format = 'online' AND enrollment.status IN ('active','completed') AND enrollment.payment_status = 'paid' AND course.online_access_days > 0"
    },
    "repeatSafety": {
      "assessment": "Conditionally convergent but time-sensitive",
      "evidence": "COALESCE preserves snapshots, but null access_expires_at derives from now(); source does not prove historical course values or concurrent-writer behavior."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (course_enrollments, courses). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical course_enrollments definition at lib/db/migrations/000001_canonical_schema/migration.sql:2881-2921. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4881-71c900be3d31c484",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4881:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4881,
        "endLine": 4888,
        "sqlOrCode": "WITH ranked AS (\n       SELECT id, row_number() OVER (PARTITION BY subscription_id, kind ORDER BY issued_at, id) AS position\n       FROM ${s}.education_payment_obligations\n       WHERE status = 'pending' AND subscription_id IS NOT NULL AND kind IN ('subscription_renewal','subscription_upgrade')\n     )\n     UPDATE ${s}.education_payment_obligations target\n     SET status = 'cancelled', cancelled_at = now()\n     FROM ranked WHERE target.id = ranked.id AND ranked.position > 1"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 87, source lines 4881-4888. It follows v104 columns (4873-4877) and v105 checks (4879-4880). Its immediate successor is CREATE UNIQUE INDEX IF NOT EXISTS education_payment_obligations_pending_subscription_kind_uniq on (subscription_id, kind), with the same pending/kind predicate (4889-4891).",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes each statement in autocommit (5002-5009, 5039-5043, 5128-5138). Thus an interruption after this UPDATE but before the per-kind index, or after that index and before its DROP at 4893, leaves a real intermediate database state despite serialization.",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals; education_payment_obligations fields subscription_id, kind, issued_at, id, status, cancelled_at; and the v105 per-kind unique-index creation immediately following this reconciliation."
    },
    "effects": {
      "type": "payment-obligation reconciliation",
      "description": "For each (subscription_id, kind) partition of pending non-null-subscription renewal/upgrade obligations, preserves exactly row_number 1 ordered by issued_at ASC, then id ASC; cancels every later row and sets cancelled_at=now(). It does not choose across kinds."
    },
    "repeatSafety": {
      "assessment": "Current-state convergence only",
      "evidence": "Rows cancelled by this pass cease to match status='pending', so an unchanged successful result can converge per subscription and kind. This is not proof of safe retry: new/current pending rows, issued_at/id ordering, now(), and the autocommit interval before/after the following per-kind index remain state-dependent."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection reads current pending education_payment_obligations and rank order is exactly (subscription_id, kind, issued_at ASC, id ASC). The following partial per-kind index changes what future pending states are admissible. No production database was inspected.",
      "unknowns": "Which obligations share a subscription/kind, NULL issued_at behavior, expected historic winner, concurrent writers, index existence/validity, and effects of an interrupted autocommit sequence are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_payment_obligations definition at lib/db/migrations/000001_canonical_schema/migration.sql:4086-4121. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4894-2fb599a7e242329d",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4894:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4894,
        "endLine": 4904,
        "sqlOrCode": "WITH ranked AS (\n       SELECT id, row_number() OVER (\n         PARTITION BY subscription_id\n         ORDER BY CASE WHEN kind = 'subscription_upgrade' THEN 0 ELSE 1 END, issued_at DESC, id\n       ) AS position\n       FROM ${s}.education_payment_obligations\n       WHERE status = 'pending' AND subscription_id IS NOT NULL AND kind IN ('subscription_renewal','subscription_upgrade')\n     )\n     UPDATE ${s}.education_payment_obligations target\n     SET status = 'cancelled', cancelled_at = now()\n     FROM ranked WHERE target.id = ranked.id AND ranked.position > 1"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 88, source lines 4894-4904. It follows creation of the v105 partial unique index on (subscription_id, kind) at 4889-4891, then DROP INDEX IF EXISTS of that exact index at 4893. Its immediate successor is an unguarded CREATE UNIQUE INDEX on subscription_id alone with the same pending/kind predicate (4905-4907).",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes each statement in autocommit (5002-5009, 5039-5043, 5128-5138). Thus this UPDATE can run after the per-kind index has been dropped but before the final per-subscription index is created; interruption in that window leaves no one-pending-obligation enforcement from either index.",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "The immediately preceding per-kind index creation/drop sequence, education_payment_obligations fields subscription_id, kind, issued_at, id, status, cancelled_at, and successful creation of the following per-subscription partial unique index."
    },
    "effects": {
      "type": "payment-obligation reconciliation",
      "description": "For each subscription_id across pending renewal and upgrade obligations, preserves exactly one row: an upgrade is preferred over a renewal (CASE upgrade=0, else 1); within that preferred kind it selects newest issued_at DESC, then smallest id ASC. It cancels all other rows and sets cancelled_at=now()."
    },
    "repeatSafety": {
      "assessment": "Current-state convergence only",
      "evidence": "Cancelled rows cease to match status='pending', so an unchanged successful result can converge to one qualifying row per subscription. It is not a safe-retry proof: selection depends on current kinds/timestamps/IDs, writes now(), and an interruption before the unguarded final index creation can leave the interim no-index state; a later replay may encounter that index if it was already created."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection reads current pending education_payment_obligations and rank order is exactly subscription_id, upgrade-before-renewal, issued_at DESC, id ASC. It also depends on the preceding DROP INDEX IF EXISTS and later unguarded CREATE UNIQUE INDEX. No production database was inspected.",
      "unknowns": "Which current renewal/upgrade should survive, NULL issued_at behavior, concurrent writers in the no-index interval, whether final index creation has already occurred on retry, index validity, and business correctness of cancellation are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_payment_obligations definition at lib/db/migrations/000001_canonical_schema/migration.sql:4086-4121. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4923-c22773f2337b6668",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4923:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4923,
        "endLine": 4927,
        "sqlOrCode": "UPDATE ${s}.education_bundle_purchases\n       SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),\n           payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',\n             to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)\n       WHERE payment_reference IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 89; source starts line 4923, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_bundle_purchases SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30), payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true) WHERE payment_reference IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_bundle_purchases). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_bundle_purchases definition at lib/db/migrations/000001_canonical_schema/migration.sql:3421-3448. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4928-501a649d7423c9cf",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4928:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4928,
        "endLine": 4930,
        "sqlOrCode": "UPDATE ${s}.education_bundle_purchases\n       SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)\n       WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 90; source starts line 4928, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.education_bundle_purchases SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true) WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (education_bundle_purchases). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical education_bundle_purchases definition at lib/db/migrations/000001_canonical_schema/migration.sql:3421-3448. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-515-8dbd4712bbb5dcb2",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:515:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 515,
        "endLine": 532,
        "sqlOrCode": "DO $$ BEGIN\n       ALTER TABLE ${s}.referral_credit_ledger DISABLE TRIGGER USER;\n       ALTER TABLE ${s}.referral_credit_redemptions DISABLE TRIGGER USER;\n       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()\n                  AND table_name = 'referral_credit_ledger' AND column_name = 'amount') THEN\n         UPDATE ${s}.referral_credit_ledger SET amount_rsd = amount WHERE amount_rsd IS NULL;\n       END IF;\n       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()\n                  AND table_name = 'referral_credit_redemptions' AND column_name = 'amount') THEN\n         UPDATE ${s}.referral_credit_redemptions SET amount_rsd = amount WHERE amount_rsd IS NULL;\n       END IF;\n       ALTER TABLE ${s}.referral_credit_ledger ENABLE TRIGGER USER;\n       ALTER TABLE ${s}.referral_credit_redemptions ENABLE TRIGGER USER;\n     EXCEPTION WHEN OTHERS THEN\n       ALTER TABLE ${s}.referral_credit_ledger ENABLE TRIGGER USER;\n       ALTER TABLE ${s}.referral_credit_redemptions ENABLE TRIGGER USER;\n       RAISE;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 3; source starts line 515, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data copy with trigger-state changes",
      "description": "Temporarily DISABLE TRIGGER USER on two referral financial tables, copies legacy amount into null amount_rsd fields if legacy columns exist, then ENABLEs in normal and exception paths."
    },
    "repeatSafety": {
      "assessment": "Conditionally convergent, not production-safe proof",
      "evidence": "Only amount_rsd IS NULL rows update; trigger disable/enable is operational, legacy columns are catalog-conditional, and safe retry under all failures, permissions, and concurrency is not established. Exception path attempts re-enable then re-raises."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (referral_credit_ledger, referral_credit_redemptions; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical referral_credit_ledger definition at lib/db/migrations/000001_canonical_schema/migration.sql:5563-5580. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-642-75642b872948bafa",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:642:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 642,
        "endLine": 644,
        "sqlOrCode": "INSERT INTO ${s}.suppliers (id, name, slug, scope, active)\n      VALUES ('9b5970ea-0a8c-5e60-9d32-2a09f0890560', 'LUMERA Legacy Catalog', 'lumera-legacy', 'BOTH', true)\n      ON CONFLICT (slug) DO NOTHING"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 6; source starts line 642, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "data insertion / seed or derived-row backfill",
      "description": "INSERT INTO ${s}.suppliers (id, name, slug, scope, active) VALUES ('9b5970ea-0a8c-5e60-9d32-2a09f0890560', 'LUMERA Legacy Catalog', 'lumera-legacy', 'BOTH', true) ON CONFLICT (slug) DO NOTHING"
    },
    "repeatSafety": {
      "assessment": "Conditionally repeatable, not production-safe proof",
      "evidence": "Conflict handling can skip matching rows, but correctness depends on live uniqueness constraints and data; ON CONFLICT is not proof of intended insertion."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (suppliers). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical suppliers definition at lib/db/migrations/000001_canonical_schema/migration.sql:6698-6707. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-646-85bc0eb2701b10cf",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:646:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 646,
        "endLine": 648,
        "sqlOrCode": "UPDATE ${s}.product_categories\n       SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560'\n       WHERE supplier_id IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 7; source starts line 646, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.product_categories SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560' WHERE supplier_id IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (product_categories). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical product_categories definition at lib/db/migrations/000001_canonical_schema/migration.sql:5309-5319. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-714-c3afd57975f260f8",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:714:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 714,
        "endLine": 716,
        "sqlOrCode": "UPDATE ${s}.products\n       SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560'\n       WHERE supplier_id IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 8; source starts line 714, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.products SET supplier_id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560' WHERE supplier_id IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (products). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-795-ccea7319f2053e67",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:795:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 795,
        "endLine": 797,
        "sqlOrCode": "UPDATE ${s}.products\n       SET catalog_reference = 'LUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))\n       WHERE catalog_reference IS NULL OR btrim(catalog_reference) = ''"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 10; source starts line 795, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.products SET catalog_reference = 'LUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) WHERE catalog_reference IS NULL OR btrim(catalog_reference) = ''"
    },
    "repeatSafety": {
      "assessment": "Conditionally convergent with randomness risk",
      "evidence": "NULL/blank predicate blocks a second successful generation; gen_random_uuid makes first values nondeterministic and source does not prove collision/concurrency safety."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (products). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical products definition at lib/db/migrations/000001_canonical_schema/migration.sql:5428-5483. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-834-3074db9313c774db",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:834:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 834,
        "endLine": 837,
        "sqlOrCode": "UPDATE ${s}.retail_cart_items AS item\n       SET product_catalog_reference = product.catalog_reference\n       FROM ${s}.products AS product\n       WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 11; source starts line 834, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.retail_cart_items AS item SET product_catalog_reference = product.catalog_reference FROM ${s}.products AS product WHERE product.id = item.product_id AND item.product_catalog_reference IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_cart_items, products). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_cart_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5703-5718. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-841-b832bbaa7343d506",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:841:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 841,
        "endLine": 910,
        "sqlOrCode": "DO $$\n     BEGIN\n       IF EXISTS (\n         SELECT 1\n         FROM pg_index index_definition\n         JOIN pg_class index_relation ON index_relation.oid = index_definition.indexrelid\n         JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace\n         WHERE index_schema.nspname = current_schema()\n           AND index_relation.relname = 'retail_cart_items_cart_product_variant_unique'\n           AND NOT index_definition.indnullsnotdistinct\n       ) THEN\n         IF EXISTS (\n           SELECT 1\n           FROM ${s}.retail_cart_items\n           WHERE variant_value IS NULL\n           GROUP BY cart_id, product_id\n           HAVING sum(quantity)::bigint > 2147483647\n         ) THEN\n           RAISE EXCEPTION 'Cannot consolidate duplicate retail cart items: aggregate quantity exceeds integer range';\n         END IF;\n\n         WITH ranked_items AS (\n           SELECT\n             id,\n             sum(quantity) OVER (PARTITION BY cart_id, product_id) AS aggregate_quantity,\n             row_number() OVER (PARTITION BY cart_id, product_id ORDER BY created_at, id) AS row_number\n           FROM ${s}.retail_cart_items\n           WHERE variant_value IS NULL\n         )\n         UPDATE ${s}.retail_cart_items AS item\n         SET quantity = ranked_items.aggregate_quantity::integer,\n             updated_at = now()\n         FROM ranked_items\n         WHERE item.id = ranked_items.id\n           AND ranked_items.row_number = 1;\n\n         WITH ranked_items AS (\n           SELECT\n             id,\n             row_number() OVER (PARTITION BY cart_id, product_id ORDER BY created_at, id) AS row_number\n           FROM ${s}.retail_cart_items\n           WHERE variant_value IS NULL\n         )\n         DELETE FROM ${s}.retail_cart_items AS item\n         USING ranked_items\n         WHERE item.id = ranked_items.id\n           AND ranked_items.row_number > 1;\n\n         IF EXISTS (\n           SELECT 1\n           FROM pg_constraint constraint_definition\n           JOIN pg_namespace constraint_schema ON constraint_schema.oid = constraint_definition.connamespace\n           WHERE constraint_schema.nspname = current_schema()\n             AND constraint_definition.conname = 'retail_cart_items_cart_product_variant_unique'\n         ) THEN\n           EXECUTE format(\n             'ALTER TABLE %I.%I DROP CONSTRAINT %I',\n             current_schema(),\n             'retail_cart_items',\n             'retail_cart_items_cart_product_variant_unique'\n           );\n         ELSE\n           EXECUTE format(\n             'DROP INDEX %I.%I',\n             current_schema(),\n             'retail_cart_items_cart_product_variant_unique'\n           );\n         END IF;\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 12; source starts line 841, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data reconciliation plus conditional constraint/index replacement",
      "description": "When the named legacy unique index has NULLS DISTINCT semantics, sums duplicate NULL-variant cart quantities into the first row, deletes later duplicates, then drops the constraint/index; it can raise on integer overflow."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not proven repeat-safe",
      "evidence": "Outer pg_index predicate may become false only after it drops the named index/constraint, but it aggregates/deletes current rows. Correctness depends on exact duplicates, integer range, privileges, and later index recreation."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_cart_items; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_cart_items definition at lib/db/migrations/000001_canonical_schema/migration.sql:5703-5718. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-949-43751b9dc71e8688",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:949:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 949,
        "endLine": 960,
        "sqlOrCode": "DO $$ BEGIN\n       IF EXISTS (SELECT 1 FROM information_schema.columns\n          WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'status') THEN\n         UPDATE ${s}.orders SET fulfillment_status = CASE\n           WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status\n           WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status\n           WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status\n           WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status\n           ELSE 'RECEIVED'::${s}.fulfillment_status END\n           WHERE fulfillment_status = 'RECEIVED';\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 13; source starts line 949, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'status') THEN UPDATE ${s}.orders SET fulfillment_status = CASE WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status ELSE 'RECEIVED'::${s}.fulfillment_status END WHERE fulfillment_status = 'RECEIVED'; END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (orders, fulfillment_status; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical orders definition at lib/db/migrations/000001_canonical_schema/migration.sql:5084-5131. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-961-843af46de48ee47e",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:961:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 961,
        "endLine": 972,
        "sqlOrCode": "DO $$ BEGIN\n       IF EXISTS (SELECT 1 FROM information_schema.columns\n          WHERE table_schema = current_schema() AND table_name = 'retail_orders' AND column_name = 'status') THEN\n         UPDATE ${s}.retail_orders SET fulfillment_status = CASE\n           WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status\n           WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status\n           WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status\n           WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status\n           ELSE 'RECEIVED'::${s}.fulfillment_status END\n           WHERE fulfillment_status = 'RECEIVED';\n       END IF;\n     END $$"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 14; source starts line 961, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "catalog-guarded existing-data reconciliation",
      "description": "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'retail_orders' AND column_name = 'status') THEN UPDATE ${s}.retail_orders SET fulfillment_status = CASE WHEN status = 'cancelled' THEN 'CANCELLED'::${s}.fulfillment_status WHEN status = 'delivered' THEN 'COMPLETED'::${s}.fulfillment_status WHEN status = 'shipped' THEN 'SHIPPED'::${s}.fulfillment_status WHEN status = 'processing' THEN 'PREPARING'::${s}.fulfillment_status ELSE 'RECEIVED'::${s}.fulfillment_status END WHERE fulfillment_status = 'RECEIVED'; END IF; END $$"
    },
    "repeatSafety": {
      "assessment": "UNKNOWN",
      "evidence": "No static source evidence proves safe repetition under production data, errors, retries, or concurrent writers."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_orders, fulfillment_status; catalog predicates). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_orders definition at lib/db/migrations/000001_canonical_schema/migration.sql:5815-5855. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-977-05799e55766b423f",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:977:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 977,
        "endLine": 978,
        "sqlOrCode": "UPDATE ${s}.retail_orders SET tracking_token_expires_at = created_at + interval '180 days'\n       WHERE tracking_token_expires_at IS NULL"
      }
    ],
    "execution": {
      "sourceOrder": "tableStatements literal executionOrder 15; source starts line 977, column 5.",
      "runtimeConditionalOrder": "Runner locks, sets search_path, and only absent/lower rollout marker builds tableStatements and executes sequentially in autocommit (5002-5009, 5039-5043, 5128-5138).",
      "startupPredicate": "Not every startup: current-version fast path returns at 5125. Failure before marker write 5139-5148 causes later startup to revisit it.",
      "dependencies": "Earlier enum/table/column literals plus live rows/catalog referenced by the statement. Exact source query dependencies require semantic review."
    },
    "effects": {
      "type": "existing-data mutation",
      "description": "UPDATE ${s}.retail_orders SET tracking_token_expires_at = created_at + interval '180 days' WHERE tracking_token_expires_at IS NULL"
    },
    "repeatSafety": {
      "assessment": "Predicate-convergent only",
      "evidence": "The predicate can exclude rows after success, but does not prove derived values are correct or that null/zero means missing data."
    },
    "stateDependence": {
      "dependsOnCurrentProductionState": true,
      "evidence": "Selection/value derivation reads current rows and/or PostgreSQL catalog (retail_orders). No production database was inspected.",
      "unknowns": "Row counts, value distributions, constraints, triggers, permissions, concurrent writers, and whether legacy predicates identify only intended records are unverified."
    },
    "canonicalComparison": {
      "classification": "historical data transformation / current-data reconciliation, not schema-definition equivalence",
      "evidence": "canonical retail_orders definition at lib/db/migrations/000001_canonical_schema/migration.sql:5815-5855. Static scan found zero top-level UPDATE, INSERT INTO, DO $$, or WITH ranked data statements in immutable migration 000001.",
      "semanticConclusion": "NOT REPRESENTED as this data transformation in canonical 000001. Definition presence cannot show existing rows were backfilled/reconciled; not a resolution decision."
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "NEVER resolved by this report",
      "basis": "Crosswalk status remains UNRESOLVED; this is static source/canonical evidence only.",
      "requiredBeforeResolution": "Approved read-only production characterization; review ordering, constraints/triggers/privileges, concurrent writers, rollback/compensation; then an approved semantic migration or retention decision."
    },
    "uncertainties": [
      "No production DB, production data, migration, runtime, or test was inspected/executed.",
      "Serial advisory-lock execution does not prove safety against all writers, manual state, failed rollouts, or pool/session conditions.",
      "Independent reviewer must decide forward migration, guarded reconciliation, or retained runtime behavior for each semantic effect."
    ]
  },
  {
    "id": "business-growth/bundle-payment-immutability-function",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5112-5120",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5112,
        "endLine": 5120,
        "sqlOrCode": "          await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.reject_bundle_payment_reference_change() RETURNS trigger AS $$\n            BEGIN\n              IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n                OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n                RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n              END IF;\n              RETURN NEW;\n            END\n          $$ LANGUAGE plpgsql`);"
      },
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5087,
        "endLine": 5124,
        "sqlOrCode": "        if ((await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [`${schemaName}.education_bundle_purchases`])).rows[0]?.exists) {\n          await client.query(`DO $$ BEGIN\n            IF EXISTS (\n              SELECT 1 FROM pg_constraint\n              WHERE conrelid = '${quoted}.education_bundle_purchases'::regclass\n                AND conname = 'education_bundle_purchases_target_check'\n                AND NOT convalidated\n            ) THEN\n              ALTER TABLE ${quoted}.education_bundle_purchases\n                VALIDATE CONSTRAINT education_bundle_purchases_target_check;\n            END IF;\n          END $$`);\n          await client.query(`ALTER TABLE ${quoted}.education_bundle_purchases ADD COLUMN IF NOT EXISTS payment_reference text`);\n          await client.query(`DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable ON ${quoted}.education_bundle_purchases`);\n          await client.query(`UPDATE ${quoted}.education_bundle_purchases\n            SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),\n                payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',\n                  to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)\n            WHERE payment_reference IS NULL`);\n          await client.query(`UPDATE ${quoted}.education_bundle_purchases\n            SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)\n            WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference`);\n          await client.query(`ALTER TABLE ${quoted}.education_bundle_purchases ALTER COLUMN payment_reference SET NOT NULL`);\n          await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS education_bundle_purchases_payment_reference_unique\n            ON ${quoted}.education_bundle_purchases(payment_reference)`);\n          await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.reject_bundle_payment_reference_change() RETURNS trigger AS $$\n            BEGIN\n              IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n                OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n                RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n              END IF;\n              RETURN NEW;\n            END\n          $$ LANGUAGE plpgsql`);\n          await client.query(`CREATE TRIGGER education_bundle_purchases_payment_reference_immutable\n            BEFORE UPDATE OF payment_reference, payment_instructions ON ${quoted}.education_bundle_purchases\n            FOR EACH ROW EXECUTE FUNCTION ${quoted}.reject_bundle_payment_reference_change()`);\n        }"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "After table guard, validation/column/trigger-drop/data reconciliation/index 5088-5111; this function 5112-5120; trigger creation 5121-5123.",
      "conditional": "Current-version fast path plus education_bundle_purchases to_regclass guard at 5087; may execute each qualifying boot.",
      "dependencies": [
        "quoteSchema and SET search_path at 4995,5008-5009",
        "guarded table existence 5087",
        "preceding payment reconciliation 5101-5108 and trigger create 5121-5123"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects bundle payment_reference/payment_instructions changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, guarded table, preceding payment-row reconciliation, and trigger/catalog state.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1696,
        "endLine": 1706,
        "sqlOrCode": "CREATE FUNCTION public.reject_bundle_payment_reference_change() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n        END IF;\n        RETURN NEW;\n      END\n    $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "business-growth/gift-voucher-immutability-function",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5051-5066",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5051,
        "endLine": 5066,
        "sqlOrCode": "        await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.prevent_education_gift_voucher_snapshot_update()\n          RETURNS trigger LANGUAGE plpgsql AS $$\n          BEGIN\n            IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n              OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n              OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot\n              OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot\n              OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n              OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n              OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n              OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n              OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n              RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n            END IF;\n            RETURN NEW;\n          END $$`);"
      },
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5035,
        "endLine": 5069,
        "sqlOrCode": "    const rolloutTable = `${schemaName}.business_growth_schema_rollout`;\n    const existingRollout = await client.query<{ relation: string | null }>(\n      \"SELECT to_regclass($1)::text AS relation\", [rolloutTable],\n    );\n    if (existingRollout.rows[0]?.relation) {\n      const state = await client.query<{ version: number }>(\n        `SELECT version FROM ${quoted}.business_growth_schema_rollout WHERE singleton = true`,\n      );\n      if ((state.rows[0]?.version ?? 0) >= BUSINESS_GROWTH_SCHEMA_VERSION) {\n        // Keep additive contract repairs replayable even for installations that\n        // recorded the current version before an interrupted/manual rollout.\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_instructors ADD COLUMN IF NOT EXISTS portfolio_media jsonb NOT NULL DEFAULT '[]'::jsonb`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_center_reviews ADD COLUMN IF NOT EXISTS admin_note text`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_center_reviews ADD COLUMN IF NOT EXISTS moderated_at timestamptz`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_gift_vouchers ADD COLUMN IF NOT EXISTS recipient_name_snapshot text`);\n        await client.query(`ALTER TABLE IF EXISTS ${quoted}.education_gift_vouchers ADD COLUMN IF NOT EXISTS gift_message_snapshot text`);\n        await client.query(`CREATE OR REPLACE FUNCTION ${quoted}.prevent_education_gift_voucher_snapshot_update()\n          RETURNS trigger LANGUAGE plpgsql AS $$\n          BEGIN\n            IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n              OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n              OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot\n              OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot\n              OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n              OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n              OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n              OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n              OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n              RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n            END IF;\n            RETURN NEW;\n          END $$`);\n        await client.query(`DROP TRIGGER IF EXISTS education_gift_vouchers_snapshot_immutable ON ${quoted}.education_gift_vouchers`);\n        await client.query(`CREATE TRIGGER education_gift_vouchers_snapshot_immutable BEFORE UPDATE ON ${quoted}.education_gift_vouchers\n          FOR EACH ROW EXECUTE FUNCTION ${quoted}.prevent_education_gift_voucher_snapshot_update()`);"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "After tracker test, columns 5046-5050; this function 5051-5066; trigger drop/create 5067-5069.",
      "conditional": "Current-version fast path only: relation exists and singleton version >= BUSINESS_GROWTH_SCHEMA_VERSION (5035-5043); executes each qualifying boot.",
      "dependencies": [
        "quoteSchema and SET search_path at 4995,5008-5009",
        "voucher table plus fields; two presentation fields added 5049-5050",
        "trigger recreation 5067-5069"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects voucher purchase/presentation snapshot changes; revisions differ.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, voucher catalog/columns, and current trigger binding.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1414,
        "endLine": 1430,
        "sqlOrCode": "CREATE FUNCTION public.prevent_education_gift_voucher_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot\n           OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot\n           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1013-2873cfc7bde28e7c",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1013:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1013,
        "endLine": 1020,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_promotion_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN\n          RAISE EXCEPTION 'Order promotion snapshot is immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1013-1020; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects order promotion snapshot changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1530,
        "endLine": 1538,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_promotion_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN\n          RAISE EXCEPTION 'Order promotion snapshot is immutable';\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1024-b6bf3966fbd7c255",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1024:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1024,
        "endLine": 1031,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_promotion_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN\n          RAISE EXCEPTION 'Retail order promotion snapshot is immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1024-1031; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects retail-order promotion snapshot changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1613,
        "endLine": 1621,
        "sqlOrCode": "CREATE FUNCTION public.prevent_retail_order_promotion_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN\n          RAISE EXCEPTION 'Retail order promotion snapshot is immutable';\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1101-d98ce7dad1bf3273",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1101:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1101,
        "endLine": 1106,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN RETURN NEW; END IF;\n         RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1101-1106; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent B2B commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1482,
        "endLine": 1523,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete control-flow comparison): source has no OLD/NEW field set. It returns NEW only when current_setting('lumera.snapshot_backfill', true) = 'on'; otherwise it unconditionally raises. Canonical lines 1485-1523 have no GUC bypass and reject only changes in this complete named set: product_id, product_name, product_sku, price, quantity, supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, line_subtotal, line_total, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Therefore source is both broader while GUC is off and wholly bypassed while it is on.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1110-a554a73f2cc12f0d",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1110:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1110,
        "endLine": 1126,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n       IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n         OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n         OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot OR NEW.market IS DISTINCT FROM OLD.market\n         OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n         OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot OR NEW.quantity IS DISTINCT FROM OLD.quantity\n         OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal OR NEW.line_total IS DISTINCT FROM OLD.line_total\n         OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n         OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price OR NEW.price_source IS DISTINCT FROM OLD.price_source\n         OR NEW.line_discount IS DISTINCT FROM OLD.line_discount OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n         OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n         OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n         OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n         OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n         OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot THEN RAISE EXCEPTION 'Order item commercial snapshot is immutable'; END IF;\n       RETURN NEW; END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1110-1126; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent B2B commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1482,
        "endLine": 1523,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, is_reward_gift, and reward_snapshot; it has no additional field predicate or GUC branch. It permits changes to every omitted field that canonical rejects.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1127-82d60245f86ef653",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1127:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1127,
        "endLine": 1133,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n       IF NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n         OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n         OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id THEN\n         RAISE EXCEPTION 'Order item commercial snapshot is immutable'; END IF;\n       RETURN NEW; END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1127-1133; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent retail commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1561,
        "endLine": 1606,
        "sqlOrCode": "CREATE FUNCTION public.prevent_retail_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value\n           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete field-set comparison): source rejects exactly personalized_treatment_bundle_discount_rsd, post_treatment_recommendation_discount_rsd, and aftercare_recommendation_id. Against canonical lines 1565-1602 it omits exactly product_id, product_name, product_image_url, product_catalog_reference, variant_value, variant_label, quantity, supplier_id, supplier_name, supplier_slug, product_sku_snapshot, market, currency, unit_price, discount_snapshot, line_subtotal, line_total, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. There is no additional predicate or GUC branch.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1137-78d662770c04a367",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1137:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1137,
        "endLine": 1147,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_incomplete_commercial_snapshot_insert()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN RETURN NEW; END IF;\n         IF NEW.supplier_id IS NULL OR NEW.supplier_name IS NULL OR NEW.supplier_slug IS NULL\n           OR (NEW.product_id IS NOT NULL AND NEW.product_catalog_reference IS NULL)\n           OR NEW.unit_price IS NULL OR NEW.line_subtotal IS NULL OR NEW.line_total IS NULL THEN\n           RAISE EXCEPTION 'Commercial order-item snapshot is required during migration';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1137-1147; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects incomplete snapshots except with session backfill GUC.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1437,
        "endLine": 1448,
        "sqlOrCode": "CREATE FUNCTION public.prevent_incomplete_commercial_snapshot_insert() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN RETURN NEW; END IF;\n         IF NEW.supplier_id IS NULL OR NEW.supplier_name IS NULL OR NEW.supplier_slug IS NULL\n           OR (NEW.product_id IS NOT NULL AND NEW.product_catalog_reference IS NULL)\n           OR NEW.unit_price IS NULL OR NEW.line_subtotal IS NULL OR NEW.line_total IS NULL THEN\n           RAISE EXCEPTION 'Commercial order-item snapshot is required during migration';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1203-314a9adb25ea1a7a",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1203:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1203,
        "endLine": 1232,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN\n           RETURN NEW;\n         END IF;\n         IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n            OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n            OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n            OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n            OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n            OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1203-1232; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent B2B commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1482,
        "endLine": 1523,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete control-flow and field-set comparison): source first returns NEW when lumera.snapshot_backfill is on. When off it rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date. Canonical has no GUC bypass; source permits every named change while bypass is on.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1342-41322590b0facfaf",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1342:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1342,
        "endLine": 1376,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n          OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n          OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n          OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n          OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n          OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n          OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n          OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n          OR NEW.quantity IS DISTINCT FROM OLD.quantity\n          OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n          OR NEW.line_total IS DISTINCT FROM OLD.line_total\n          OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n          OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n          OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n          OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n          OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n          OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n          OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n          OR NEW.price_source IS DISTINCT FROM OLD.price_source\n          OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n          OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n          OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n          OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n          OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n          OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n          OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n          OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n          OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n          RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1342-1376; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent B2B commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1482,
        "endLine": 1523,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd. There is no GUC bypass or additional field predicate.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1377-7a16f65e6e343d67",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1377:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1377,
        "endLine": 1406,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n          OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n          OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n          OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n          OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n          OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n          OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n          OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n          OR NEW.quantity IS DISTINCT FROM OLD.quantity\n          OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n          OR NEW.line_total IS DISTINCT FROM OLD.line_total\n          OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n          OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n          OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n          OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n          OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n          OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n          OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id\n          OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n          OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n          OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n          OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n          OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n          RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1377-1406; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent retail commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1561,
        "endLine": 1606,
        "sqlOrCode": "CREATE FUNCTION public.prevent_retail_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value\n           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, personalized_treatment_bundle_discount_rsd, post_treatment_recommendation_discount_rsd, aftercare_recommendation_id, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1565-1602 it omits exactly product_id, product_name, product_image_url, variant_value, variant_label, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date. That is the entire canonical bundle group at lines 1583-1590, plus the listed identity/G2 fields. There is no GUC bypass or additional predicate.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1415-e4229e6071e9a67a",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1415:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1415,
        "endLine": 1423,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_g2_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN\n          RAISE EXCEPTION 'Retail G2 promotion allocations are immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1415-1423; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects retail G2 allocation changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1545,
        "endLine": 1554,
        "sqlOrCode": "CREATE FUNCTION public.prevent_retail_g2_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN\n          RAISE EXCEPTION 'Retail G2 promotion allocations are immutable';\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-1427-c335b6f63de49bb8",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:1427:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 1427,
        "endLine": 1435,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_g2_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN\n          RAISE EXCEPTION 'Order G2 promotion allocations are immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 1427-1435; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects B2B G2 allocation changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1466,
        "endLine": 1475,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_g2_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN\n          RAISE EXCEPTION 'Order G2 promotion allocations are immutable';\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2500-b465c4834db0bf01",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2500:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2500,
        "endLine": 2503,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_bundle_component_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n         RAISE EXCEPTION 'Order bundle component snapshot is immutable';\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2500-2503; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Always raises for covered bundle-component updates.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1455,
        "endLine": 1459,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_bundle_component_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$ BEGIN\n         RAISE EXCEPTION 'Order bundle component snapshot is immutable';\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2606-f73073563692a53c",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2606:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2606,
        "endLine": 2621,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.validate_bundle_component()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       DECLARE component_supplier uuid; component_variants jsonb; bundle_supplier uuid;\n       BEGIN\n         SELECT supplier_id, variants INTO component_supplier, component_variants\n           FROM ${s}.products WHERE id = NEW.product_id FOR KEY SHARE;\n         SELECT supplier_id INTO bundle_supplier\n           FROM ${s}.product_bundles WHERE id = NEW.bundle_id FOR KEY SHARE;\n         IF component_supplier IS DISTINCT FROM bundle_supplier THEN\n           RAISE EXCEPTION 'Bundle components must belong to the bundle supplier';\n         END IF;\n         IF component_variants IS NOT NULL AND jsonb_array_length(component_variants) > 0 THEN\n           RAISE EXCEPTION 'Bundle components with variants are not supported';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2606-2621; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Locks/validates product/bundle supplier and variants.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1733,
        "endLine": 1749,
        "sqlOrCode": "CREATE FUNCTION public.validate_bundle_component() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       DECLARE component_supplier uuid; component_variants jsonb; bundle_supplier uuid;\n       BEGIN\n         SELECT supplier_id, variants INTO component_supplier, component_variants\n           FROM \"public\".products WHERE id = NEW.product_id FOR KEY SHARE;\n         SELECT supplier_id INTO bundle_supplier\n           FROM \"public\".product_bundles WHERE id = NEW.bundle_id FOR KEY SHARE;\n         IF component_supplier IS DISTINCT FROM bundle_supplier THEN\n           RAISE EXCEPTION 'Bundle components must belong to the bundle supplier';\n         END IF;\n         IF component_variants IS NOT NULL AND jsonb_array_length(component_variants) > 0 THEN\n           RAISE EXCEPTION 'Bundle components with variants are not supported';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2625-8d5de63e198cd17a",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2625:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2625,
        "endLine": 2642,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.enqueue_restocked_product_waitlist()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF OLD.stock = 0 AND NEW.stock > 0 THEN\n           INSERT INTO ${s}.product_waitlist_notification_outbox\n             (waitlist_id, audience, salon_id, user_id, product_id)\n           SELECT id, audience, salon_id, user_id, product_id\n             FROM ${s}.product_waitlist\n             WHERE product_id = NEW.id AND status = 'ACTIVE'\n           ON CONFLICT (waitlist_id) DO NOTHING;\n           UPDATE ${s}.product_waitlist waiter SET status = 'NOTIFIED',\n             notified_at = now(), updated_at = now()\n             WHERE waiter.product_id = NEW.id AND waiter.status = 'ACTIVE'\n               AND EXISTS (SELECT 1 FROM ${s}.product_waitlist_notification_outbox outbox\n                 WHERE outbox.waitlist_id = waiter.id);\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2625-2642; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "When fired on stock 0→positive, inserts deduplicated outbox rows and updates matching waitlist rows to NOTIFIED.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1359,
        "endLine": 1377,
        "sqlOrCode": "CREATE FUNCTION public.enqueue_restocked_product_waitlist() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF OLD.stock = 0 AND NEW.stock > 0 THEN\n           INSERT INTO \"public\".product_waitlist_notification_outbox\n             (waitlist_id, audience, salon_id, user_id, product_id)\n           SELECT id, audience, salon_id, user_id, product_id\n             FROM \"public\".product_waitlist\n             WHERE product_id = NEW.id AND status = 'ACTIVE'\n           ON CONFLICT (waitlist_id) DO NOTHING;\n           UPDATE \"public\".product_waitlist waiter SET status = 'NOTIFIED',\n             notified_at = now(), updated_at = now()\n             WHERE waiter.product_id = NEW.id AND waiter.status = 'ACTIVE'\n               AND EXISTS (SELECT 1 FROM \"public\".product_waitlist_notification_outbox outbox\n                 WHERE outbox.waitlist_id = waiter.id);\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2646-f754b207b4953c65",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2646:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2646,
        "endLine": 2680,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n            OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n            OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n            OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n            OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n            OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n            OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n            OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n            OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n            OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n            OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2646-2680; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent B2B commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1482,
        "endLine": 1523,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete field-set comparison): source rejects changes to supplier_id, supplier_name, supplier_slug, product_catalog_reference, product_sku_snapshot, market, currency, unit_price, discount_snapshot, quantity, line_subtotal, line_total, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Against canonical lines 1486-1519 it omits exactly product_id, product_name, product_sku, price, automatic_promotion_discount_rsd, threshold_reward_discount_rsd. There is no GUC bypass or additional field predicate.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2683-5485f544de16d7bb",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2683:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2683,
        "endLine": 2688,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n       IF (to_jsonb(NEW) - ARRAY['id','order_id','created_at','updated_at'])\n          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['id','order_id','created_at','updated_at']) THEN\n         RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n       END IF; RETURN NEW; END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2683-2688; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent retail commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1561,
        "endLine": 1606,
        "sqlOrCode": "CREATE FUNCTION public.prevent_retail_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value\n           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete control-flow comparison): source does not enumerate business fields. It raises when (to_jsonb(NEW) - ARRAY['id','order_id','created_at','updated_at']) is distinct from the corresponding OLD JSON; it therefore protects every present row column except exactly id, order_id, created_at, and updated_at. Canonical lines 1565-1602 instead protects exactly this named set: product_id, product_name, product_image_url, product_catalog_reference, variant_value, variant_label, quantity, supplier_id, supplier_name, supplier_slug, product_sku_snapshot, market, currency, unit_price, discount_snapshot, line_subtotal, line_total, automatic_promotion_discount_rsd, threshold_reward_discount_rsd, bundle_id, base_unit_price, effective_unit_price, price_source, line_discount, bundle_name_snapshot, bundle_components_snapshot, estimated_delivery_date, unit_cost_price_rsd, line_cogs_rsd, referral_discount_rsd, realized_revenue_rsd, personalized_treatment_bundle_discount_rsd, post_treatment_recommendation_discount_rsd, aftercare_recommendation_id, category_id_snapshot, category_name_snapshot, brand_snapshot, is_reward_gift, reward_snapshot. Both predicates permit changes to id, order_id, created_at, and updated_at. The difference is only that the source's universal-minus-four predicate rejects changes to any current/future non-excluded column outside canonical's explicit list. No GUC branch exists.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2832-30aedb47b317e08d",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2832:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2832,
        "endLine": 2838,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_coupon_order_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n        IF NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd THEN\n          RAISE EXCEPTION 'Order coupon allocation is immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2832-2838; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects coupon allocation changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1400,
        "endLine": 1407,
        "sqlOrCode": "CREATE FUNCTION public.prevent_coupon_order_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$ BEGIN\n        IF NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd THEN\n          RAISE EXCEPTION 'Order coupon allocation is immutable';\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-2845-4ff564bcb8cbfe1b",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:2845:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 2845,
        "endLine": 2853,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_b2b_invoice_snapshot_update()\n      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n        IF OLD.invoice_issued_at IS NOT NULL AND (\n          NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.invoice_issued_at IS DISTINCT FROM OLD.invoice_issued_at\n          OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.coupon_code_snapshot IS DISTINCT FROM OLD.coupon_code_snapshot\n          OR NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd OR NEW.coupon_free_shipping IS DISTINCT FROM OLD.coupon_free_shipping\n        ) THEN RAISE EXCEPTION 'Finalized B2B invoice snapshot is immutable'; END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 2845-2853; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "After invoice issue, rejects invoice/coupon evidence changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1384,
        "endLine": 1393,
        "sqlOrCode": "CREATE FUNCTION public.prevent_b2b_invoice_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$ BEGIN\n        IF OLD.invoice_issued_at IS NOT NULL AND (\n          NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.invoice_issued_at IS DISTINCT FROM OLD.invoice_issued_at\n          OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.coupon_code_snapshot IS DISTINCT FROM OLD.coupon_code_snapshot\n          OR NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd OR NEW.coupon_free_shipping IS DISTINCT FROM OLD.coupon_free_shipping\n        ) THEN RAISE EXCEPTION 'Finalized B2B invoice snapshot is immutable'; END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3100-5160af5bfa71def3",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3100:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3100,
        "endLine": 3112,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.validate_b2c_banner_destination()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      BEGIN\n        IF NEW.destination_category_id IS NOT NULL AND NOT EXISTS (\n          SELECT 1 FROM ${s}.product_categories c WHERE c.id=NEW.destination_category_id\n            AND c.supplier_id=NEW.supplier_id FOR KEY SHARE\n        ) THEN RAISE EXCEPTION 'Banner category destination must belong to supplier'; END IF;\n        IF NEW.destination_product_id IS NOT NULL AND NOT EXISTS (\n          SELECT 1 FROM ${s}.products p WHERE p.id=NEW.destination_product_id\n            AND p.supplier_id=NEW.supplier_id AND p.retail_enabled=true FOR KEY SHARE\n        ) THEN RAISE EXCEPTION 'Banner product destination must belong to supplier'; END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 3100-3112; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Locks/validates supplier-owned retail-enabled destinations.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1713,
        "endLine": 1726,
        "sqlOrCode": "CREATE FUNCTION public.validate_b2c_banner_destination() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.destination_category_id IS NOT NULL AND NOT EXISTS (\n          SELECT 1 FROM \"public\".product_categories c WHERE c.id=NEW.destination_category_id\n            AND c.supplier_id=NEW.supplier_id FOR KEY SHARE\n        ) THEN RAISE EXCEPTION 'Banner category destination must belong to supplier'; END IF;\n        IF NEW.destination_product_id IS NOT NULL AND NOT EXISTS (\n          SELECT 1 FROM \"public\".products p WHERE p.id=NEW.destination_product_id\n            AND p.supplier_id=NEW.supplier_id AND p.retail_enabled=true FOR KEY SHARE\n        ) THEN RAISE EXCEPTION 'Banner product destination must belong to supplier'; END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3428-ea1abf46bda6e98c",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3428:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3428,
        "endLine": 3435,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.protect_aftercare_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n      IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id OR NEW.settings_version IS DISTINCT FROM OLD.settings_version\n        OR NEW.entitlement_token_hash IS DISTINCT FROM OLD.entitlement_token_hash OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot\n        OR NEW.treatment_snapshot IS DISTINCT FROM OLD.treatment_snapshot OR NEW.window_started_at IS DISTINCT FROM OLD.window_started_at\n        OR NEW.window_ends_at IS DISTINCT FROM OLD.window_ends_at OR NEW.activates_at IS DISTINCT FROM OLD.activates_at\n        OR NEW.entitlement_expires_at IS DISTINCT FROM OLD.entitlement_expires_at THEN\n        RAISE EXCEPTION 'aftercare recommendation evidence is immutable';\n      END IF; RETURN NEW; END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 3428-3435; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects changes to aftercare recommendation evidence.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1628,
        "endLine": 1637,
        "sqlOrCode": "CREATE FUNCTION public.protect_aftercare_evidence() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$ BEGIN\n      IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id OR NEW.settings_version IS DISTINCT FROM OLD.settings_version\n        OR NEW.entitlement_token_hash IS DISTINCT FROM OLD.entitlement_token_hash OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot\n        OR NEW.treatment_snapshot IS DISTINCT FROM OLD.treatment_snapshot OR NEW.window_started_at IS DISTINCT FROM OLD.window_started_at\n        OR NEW.window_ends_at IS DISTINCT FROM OLD.window_ends_at OR NEW.activates_at IS DISTINCT FROM OLD.activates_at\n        OR NEW.entitlement_expires_at IS DISTINCT FROM OLD.entitlement_expires_at THEN\n        RAISE EXCEPTION 'aftercare recommendation evidence is immutable';\n      END IF; RETURN NEW; END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3438-1b685f86e49f086f",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3438:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3438,
        "endLine": 3446,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.protect_aftercare_line_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN\n      IF NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id OR NEW.kind IS DISTINCT FROM OLD.kind\n        OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n        OR NEW.treatment_ids IS DISTINCT FROM OLD.treatment_ids OR NEW.covered_product_ids IS DISTINCT FROM OLD.covered_product_ids\n        OR NEW.catalog_snapshot IS DISTINCT FROM OLD.catalog_snapshot OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot\n        OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent\n        OR NEW.discount_allocation_snapshot IS DISTINCT FROM OLD.discount_allocation_snapshot THEN\n        RAISE EXCEPTION 'aftercare recommendation line evidence is immutable';\n      END IF; RETURN NEW; END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 3438-3446; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects changes to aftercare line evidence.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1644,
        "endLine": 1654,
        "sqlOrCode": "CREATE FUNCTION public.protect_aftercare_line_evidence() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$ BEGIN\n      IF NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id OR NEW.kind IS DISTINCT FROM OLD.kind\n        OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n        OR NEW.treatment_ids IS DISTINCT FROM OLD.treatment_ids OR NEW.covered_product_ids IS DISTINCT FROM OLD.covered_product_ids\n        OR NEW.catalog_snapshot IS DISTINCT FROM OLD.catalog_snapshot OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot\n        OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent\n        OR NEW.discount_allocation_snapshot IS DISTINCT FROM OLD.discount_allocation_snapshot THEN\n        RAISE EXCEPTION 'aftercare recommendation line evidence is immutable';\n      END IF; RETURN NEW; END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3453-5f85daadd826e97e",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3453:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3453,
        "endLine": 3493,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 3453-3493; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent B2B commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1482,
        "endLine": 1523,
        "sqlOrCode": "CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku\n           OR NEW.price IS DISTINCT FROM OLD.price\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-3494-e2e6198fa61aa689",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:3494:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 3494,
        "endLine": 3538,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_retail_order_item_commercial_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value\n           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 3494-3538; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Revision-dependent retail commercial evidence enforcement; final body is named-field protection.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1561,
        "endLine": 1606,
        "sqlOrCode": "CREATE FUNCTION public.prevent_retail_order_item_commercial_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.product_id IS DISTINCT FROM OLD.product_id\n           OR NEW.product_name IS DISTINCT FROM OLD.product_name\n           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url\n           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference\n           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value\n           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label\n           OR NEW.quantity IS DISTINCT FROM OLD.quantity\n           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id\n           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name\n           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug\n           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot\n           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency\n           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price\n           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot\n           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal\n           OR NEW.line_total IS DISTINCT FROM OLD.line_total\n           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd\n           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd\n           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id\n           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price\n           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price\n           OR NEW.price_source IS DISTINCT FROM OLD.price_source\n           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount\n           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot\n           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot\n           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date\n           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd\n           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd\n           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd\n           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd\n           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd\n           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd\n           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id\n           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot\n           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot\n           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot\n           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift\n           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN\n           RAISE EXCEPTION 'Order item commercial snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4140-168dce238fe4d30f",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4140:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4140,
        "endLine": 4154,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_education_gift_voucher_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email\n           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 4140-4154; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects voucher purchase/presentation snapshot changes; revisions differ.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1414,
        "endLine": 1430,
        "sqlOrCode": "CREATE FUNCTION public.prevent_education_gift_voucher_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot\n           OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot\n           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "DIFF (complete field-set comparison): source rejects exactly course_id, center_id, purchaser_id, recipient_user_id, recipient_email, course_title_snapshot, course_image_url_snapshot, amount_snapshot, currency_snapshot, code_hash, code_last4, payment_reference. Against canonical lines 1418-1426 it omits exactly recipient_name_snapshot and gift_message_snapshot. There is no additional predicate or GUC branch.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Exhaustive source/canonical field-set or control-flow difference is recorded; it cannot be resolved by object-name equivalence.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4168-0ef0ddc715fef765",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4168:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4168,
        "endLine": 4183,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.prevent_education_gift_voucher_snapshot_update()\n       RETURNS trigger LANGUAGE plpgsql AS $$\n       BEGIN\n         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot\n           OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot\n           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 4168-4183; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects voucher purchase/presentation snapshot changes; revisions differ.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1414,
        "endLine": 1430,
        "sqlOrCode": "CREATE FUNCTION public.prevent_education_gift_voucher_snapshot_update() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n       BEGIN\n         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id\n           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id\n           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot\n           OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot\n           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot\n           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot\n           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot\n           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4\n           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN\n           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';\n         END IF;\n         RETURN NEW;\n       END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4551-946da234d73bf7e2",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4551:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4551,
        "endLine": 4562,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.assign_immutable_business_payment_reference() RETURNS trigger AS $$\n      BEGIN\n        IF TG_OP = 'INSERT' AND NEW.payment_reference_number IS NULL THEN\n          NEW.payment_reference_number := CASE WHEN TG_TABLE_NAME = 'salons'\n            THEN 'SAL' || replace(NEW.id::text, '-', '')\n            ELSE 'EDU' || replace(NEW.id::text, '-', '') END;\n        ELSIF TG_OP = 'UPDATE' AND NEW.payment_reference_number IS DISTINCT FROM OLD.payment_reference_number THEN\n          RAISE EXCEPTION 'payment_reference_number is immutable';\n        END IF;\n        RETURN NEW;\n      END;\n    $$ LANGUAGE plpgsql`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 4551-4562; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Assigns missing INSERT reference and rejects later reference changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1296,
        "endLine": 1309,
        "sqlOrCode": "CREATE FUNCTION public.assign_immutable_business_payment_reference() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF TG_OP = 'INSERT' AND NEW.payment_reference_number IS NULL THEN\n          NEW.payment_reference_number := CASE WHEN TG_TABLE_NAME = 'salons'\n            THEN 'SAL' || replace(NEW.id::text, '-', '')\n            ELSE 'EDU' || replace(NEW.id::text, '-', '') END;\n        ELSIF TG_OP = 'UPDATE' AND NEW.payment_reference_number IS DISTINCT FROM OLD.payment_reference_number THEN\n          RAISE EXCEPTION 'payment_reference_number is immutable';\n        END IF;\n        RETURN NEW;\n      END;\n    $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-4939-216de9e834eb57cb",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:4939:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 4939,
        "endLine": 4947,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.reject_bundle_payment_reference_change() RETURNS trigger AS $$\n       BEGIN\n         IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n           OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n           RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n         END IF;\n         RETURN NEW;\n       END\n     $$ LANGUAGE plpgsql`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 4939-4947; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects bundle payment_reference/payment_instructions changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1696,
        "endLine": 1706,
        "sqlOrCode": "CREATE FUNCTION public.reject_bundle_payment_reference_change() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n        END IF;\n        RETURN NEW;\n      END\n    $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-550-f22c72e35ddc73eb",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:550:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 550,
        "endLine": 551,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.referral_prevent_mutation() RETURNS trigger\n      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Referral financial and attribution records are append-only'; END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 550-551; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Always raises; its bound referral UPDATE/DELETE calls fail.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1661,
        "endLine": 1663,
        "sqlOrCode": "CREATE FUNCTION public.referral_prevent_mutation() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$ BEGIN RAISE EXCEPTION 'Referral financial and attribution records are append-only'; END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-552-338d4a1040e1d84d",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:552:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 552,
        "endLine": 570,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.referral_protect_attribution_identity() RETURNS trigger\n      LANGUAGE plpgsql AS $$\n      BEGIN\n        IF TG_OP = 'DELETE'\n          OR NEW.id IS DISTINCT FROM OLD.id\n          OR NEW.referral_code_id IS DISTINCT FROM OLD.referral_code_id\n          OR NEW.channel IS DISTINCT FROM OLD.channel\n          OR NEW.referrer_user_id IS DISTINCT FROM OLD.referrer_user_id\n          OR NEW.referred_user_id IS DISTINCT FROM OLD.referred_user_id\n          OR NEW.referred_salon_id IS DISTINCT FROM OLD.referred_salon_id\n          OR NEW.referred_education_center_id IS DISTINCT FROM OLD.referred_education_center_id\n          OR NEW.captured_at IS DISTINCT FROM OLD.captured_at\n          OR NEW.locked_until IS DISTINCT FROM OLD.locked_until\n          OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key\n          OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN\n          RAISE EXCEPTION 'Referral attribution identity is immutable';\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 552-570; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Rejects DELETE and named attribution identity changes.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1670,
        "endLine": 1689,
        "sqlOrCode": "CREATE FUNCTION public.referral_protect_attribution_identity() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      BEGIN\n        IF TG_OP = 'DELETE'\n          OR NEW.id IS DISTINCT FROM OLD.id\n          OR NEW.referral_code_id IS DISTINCT FROM OLD.referral_code_id\n          OR NEW.channel IS DISTINCT FROM OLD.channel\n          OR NEW.referrer_user_id IS DISTINCT FROM OLD.referrer_user_id\n          OR NEW.referred_user_id IS DISTINCT FROM OLD.referred_user_id\n          OR NEW.referred_salon_id IS DISTINCT FROM OLD.referred_salon_id\n          OR NEW.referred_education_center_id IS DISTINCT FROM OLD.referred_education_center_id\n          OR NEW.captured_at IS DISTINCT FROM OLD.captured_at\n          OR NEW.locked_until IS DISTINCT FROM OLD.locked_until\n          OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key\n          OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN\n          RAISE EXCEPTION 'Referral attribution identity is immutable';\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "ensureBusinessGrowthSchema/source-discovered-747-eb2ed4eed4debb49",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:747:5",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 747,
        "endLine": 782,
        "sqlOrCode": "    `CREATE OR REPLACE FUNCTION ${s}.enforce_supplier_catalog_ownership()\n      RETURNS trigger LANGUAGE plpgsql AS $$\n      DECLARE parent_supplier uuid; category_supplier uuid; supplier_scope_value ${s}.supplier_scope;\n      BEGIN\n        IF TG_TABLE_NAME = 'product_categories' THEN\n          IF NEW.parent_id IS NOT NULL THEN\n            SELECT supplier_id INTO parent_supplier FROM ${s}.product_categories WHERE id = NEW.parent_id;\n            IF parent_supplier IS NULL OR parent_supplier <> NEW.supplier_id THEN\n              RAISE EXCEPTION 'Category parent must belong to the same supplier';\n            END IF;\n            IF NEW.id IS NOT NULL AND NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Category cannot be its own parent'; END IF;\n            IF NEW.id IS NOT NULL AND EXISTS (\n              WITH RECURSIVE ancestors AS (\n                SELECT id, parent_id FROM ${s}.product_categories WHERE id = NEW.parent_id\n                UNION\n                SELECT category.id, category.parent_id FROM ${s}.product_categories category\n                JOIN ancestors ON category.id = ancestors.parent_id\n              ) SELECT 1 FROM ancestors WHERE id = NEW.id\n            ) THEN RAISE EXCEPTION 'Category parent would create a cycle'; END IF;\n          END IF;\n        ELSE\n          SELECT supplier_id INTO category_supplier FROM ${s}.product_categories WHERE id = NEW.category_id;\n          IF NEW.category_id IS NOT NULL AND (category_supplier IS NULL OR category_supplier <> NEW.supplier_id) THEN\n            RAISE EXCEPTION 'Product category must belong to the same supplier';\n          END IF;\n          SELECT scope INTO supplier_scope_value FROM ${s}.suppliers\n          WHERE id = NEW.supplier_id\n          FOR SHARE;\n          IF supplier_scope_value IS NULL\n             OR (NEW.retail_enabled AND supplier_scope_value NOT IN ('B2C', 'BOTH'))\n             OR (NEW.professional_enabled AND supplier_scope_value NOT IN ('B2B', 'BOTH')) THEN\n            RAISE EXCEPTION 'Product sales channels are not permitted by supplier scope';\n          END IF;\n        END IF;\n        RETURN NEW;\n      END $$`"
      }
    ],
    "execution": {
      "entrypoint": {
        "path": "artifacts/api-server/src/index.ts",
        "startLine": 81,
        "endLine": 92,
        "sqlOrCode": "await ensureBusinessGrowthSchema() before listen() and worker startup."
      },
      "sourceOrder": "Static tableStatements literal at 747-782; array constructed after fast-path return and sequentially queried at 5128-5137. Same-name later replacements supersede earlier body.",
      "conditional": "Full static rollout branch only: owner is called every boot, but this literal executes only if tracker missing/behind; current-version branch returns 5043-5125.",
      "dependencies": [
        "quoteSchema and SET search_path 4995,5008-5009",
        "tableStatements begins 252; sequential query 5132-5137",
        "prior successful table/column/trigger DDL"
      ]
    },
    "effects": {
      "type": "function-replacement",
      "startupDataMutation": "None by this CREATE OR REPLACE. Later trigger invocation may affect DML; enqueue_restocked_product_waitlist mutates rows only when fired.",
      "detail": "Reads/locks supplier/category rows and rejects ownership, cycle, or scope violations.",
      "replacementSemantics": "Replacing a function changes its catalog definition and can immediately alter already-bound trigger behavior."
    },
    "repeatSafety": {
      "assessment": "UNKNOWN — not production-proven safe/idempotent.",
      "evidence": "CREATE OR REPLACE permits redefinition and advisory lock serializes runner (5002-5006, 5155-5158), but neither proves compatible trigger bindings, privileges, columns, concurrent DML, partial autocommit rollout, or operational safety.",
      "specificRisk": "Multiple source revisions intentionally replace the same name. Partial/retried autocommit deployment can expose interim policy; no DB was inspected."
    },
    "stateDependence": {
      "assessment": "YES / UNKNOWN extent.",
      "detail": "Depends on tracker, prior DDL, function/trigger catalog, and later DML rows. Current production state unknown.",
      "prohibitedCheck": "No database connection or production-state inspection."
    },
    "canonicalComparison": {
      "classification": "schema definition and runtime operational behavior, not startup data transformation",
      "canonicalFunction": {
        "path": "lib/db/migrations/000001_canonical_schema/migration.sql",
        "startLine": 1316,
        "endLine": 1352,
        "sqlOrCode": "CREATE FUNCTION public.enforce_supplier_catalog_ownership() RETURNS trigger\n    LANGUAGE plpgsql\n    AS $$\n      DECLARE parent_supplier uuid; category_supplier uuid; supplier_scope_value \"public\".supplier_scope;\n      BEGIN\n        IF TG_TABLE_NAME = 'product_categories' THEN\n          IF NEW.parent_id IS NOT NULL THEN\n            SELECT supplier_id INTO parent_supplier FROM \"public\".product_categories WHERE id = NEW.parent_id;\n            IF parent_supplier IS NULL OR parent_supplier <> NEW.supplier_id THEN\n              RAISE EXCEPTION 'Category parent must belong to the same supplier';\n            END IF;\n            IF NEW.id IS NOT NULL AND NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Category cannot be its own parent'; END IF;\n            IF NEW.id IS NOT NULL AND EXISTS (\n              WITH RECURSIVE ancestors AS (\n                SELECT id, parent_id FROM \"public\".product_categories WHERE id = NEW.parent_id\n                UNION\n                SELECT category.id, category.parent_id FROM \"public\".product_categories category\n                JOIN ancestors ON category.id = ancestors.parent_id\n              ) SELECT 1 FROM ancestors WHERE id = NEW.id\n            ) THEN RAISE EXCEPTION 'Category parent would create a cycle'; END IF;\n          END IF;\n        ELSE\n          SELECT supplier_id INTO category_supplier FROM \"public\".product_categories WHERE id = NEW.category_id;\n          IF NEW.category_id IS NOT NULL AND (category_supplier IS NULL OR category_supplier <> NEW.supplier_id) THEN\n            RAISE EXCEPTION 'Product category must belong to the same supplier';\n          END IF;\n          SELECT scope INTO supplier_scope_value FROM \"public\".suppliers\n          WHERE id = NEW.supplier_id\n          FOR SHARE;\n          IF supplier_scope_value IS NULL\n             OR (NEW.retail_enabled AND supplier_scope_value NOT IN ('B2C', 'BOTH'))\n             OR (NEW.professional_enabled AND supplier_scope_value NOT IN ('B2B', 'BOTH')) THEN\n            RAISE EXCEPTION 'Product sales channels are not permitted by supplier scope';\n          END IF;\n        END IF;\n        RETURN NEW;\n      END $$;"
      },
      "semanticComparison": "MATCH: with dynamic schema substituted as public and ignoring CREATE OR REPLACE versus initial CREATE FUNCTION syntax, complete body predicates, control flow, references, and exception behavior match canonical.",
      "scope": "000001 creates fresh public baseline; it does not encode startup predicate, dynamic schema invocation, advisory lock, autocommit/retry, trigger rebinding, or adjacent reconciliation.",
      "semanticCategories": {
        "definition": "YES: canonical complete CREATE FUNCTION body is preserved in canonicalFunction evidence.",
        "historicalDataTransformation": "NO for the function definition itself: neither source replacement nor canonical function DDL updates historical rows at startup.",
        "currentDataReconciliation": "NO for the function definition itself. Adjacent fast/static rollout updates are listed as dependencies and require separate audit.",
        "runtimeOperationalBehavior": "YES: trigger function body can reject DML, SELECT/lock dependent rows, or for enqueue_restocked_product_waitlist mutate rows when trigger invocation occurs.",
        "unknown": "Deployed catalog, trigger bindings, privileges, and production data state are not verified."
      }
    },
    "evidenceAssessment": {
      "status": "UNRESOLVED",
      "provisional": "Canonical body match is fresh-public-baseline evidence only; startup replacement remains UNRESOLVED.",
      "requiredBeforeDecision": [
        "Inspect pg_get_functiondef, triggers, columns, ownership, and privileges in approved non-production evidence environment.",
        "Test fresh baseline, legacy upgrade, current-version fast path, retry after interruption, concurrent startup, and permitted/rejected DML.",
        "Review adjacent trigger DDL and reconciliation separately."
      ]
    },
    "uncertainties": [
      "Production target schema, deployed bodies/bindings, dependencies, privileges, and rows are UNKNOWN without DB evidence.",
      "Crosswalk numeric executionOrder is absent for these records; source line/array order is reported.",
      "Canonical SHA 643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60 comparison is not a safety or retirement conclusion."
    ]
  },
  {
    "id": "booking-command/transaction-and-advisory-lock",
    "owner": "ensureBookingCommandSchema",
    "sourcePath": "artifacts/api-server/src/lib/booking-command-schema.ts:9-12,35-38",
    "evidenceSourcePath": "artifacts/api-server/src/lib/booking-command-schema.ts:9-12,34-38",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/booking-command-schema.ts",
        "startLine": 9,
        "endLine": 12,
        "sqlOrCode": "  const client = await (await resolveStartupDdlPool(poolOverride)).connect();\n  let locked = false; try { await client.query(\"begin\"); await setLocalStartupDdlTimeouts(client);\n    await client.query(\"SELECT pg_advisory_lock($1)\", [LOCK_KEY]); locked = true;\n    await client.query(`"
      },
      {
        "path": "artifacts/api-server/src/lib/booking-command-schema.ts",
        "startLine": 34,
        "endLine": 38,
        "sqlOrCode": "    await client.query(\"commit\"); } catch (error) { await client.query(\"rollback\").catch(() => {}); throw error; } finally {\n    try {\n      if (locked) await client.query(\"SELECT pg_advisory_unlock($1)\", [LOCK_KEY]).catch(() => {});\n    } finally {\n      client.release();\n    }"
      }
    ],
    "execution": "The owner invocation is an unconditional 7th top-level await in artifacts/api-server/src/index.ts:90, after Business Growth, Media, Shipping, Marketplace, Referral, and Web Push. On a reached invocation it begins transaction, sets local timeouts, takes LOCK_KEY, then DDL; commits or catches/attempts rollback; finally conditionally unlocks/releases. Individual downstream operations remain conditional on preceding success and database state.",
    "effects": "Runtime operational scaffolding: transaction state, local timeout policy, session advisory lock, client release. No direct data mutation in this fragment.",
    "repeatSafety": "UNKNOWN for the lifecycle. Code proves unlock is gated by locked and release is in finally; rollback/unlock failures are swallowed, and downstream DDL/database state is not proven repeat-safe by this fragment.",
    "stateDependence": "Depends on a connectable pooled client, advisory-lock availability, transaction state, timeout helper behavior, and the later DDL's existing catalog state; production state was not inspected.",
    "canonicalComparison": "Canonical defines booking_command_receipts and final indexes (000001:2600-2614,7193-7197,10343-10353), which is schema definition. It contains no matching advisory lock, timeout helper, transaction lifecycle, or client cleanup; runtime operational behavior is not represented.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "What migration/deployment serialization replaces this lock?",
      "Do rollback/unlock failures leave a retry-safe pooled session?",
      "Which later DDL actions need a transaction?"
    ]
  },
  {
    "id": "business-growth/advisory-lock-and-session-state",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5002-5010,5153-5160,5190-5204",
    "evidenceSourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5002-5010,5150-5160,5171-5197,5201-5204",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5002,
        "endLine": 5010,
        "sqlOrCode": "  await client.query(\n    \"SELECT pg_advisory_lock($1)\",\n    [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY],\n  );\n  locked = true;\n  let rolloutError: unknown; try {\n    // Constrain unqualified name resolution inside DO blocks to the target schema.\n    await client.query(`SET search_path TO ${quoted}`);"
      },
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5150,
        "endLine": 5160,
        "sqlOrCode": "  } catch (error) { rolloutError = error; throw error; } finally {\n    // Custom GUCs are session scoped. Always close the narrowly-scoped\n    // migration bypass before this client can return to the pool.\n    await client.query(\"ROLLBACK\").catch(() => {});\n    let cleanupError: unknown; try { await client.query(`SELECT set_config('lumera.snapshot_backfill', 'off', false)`); } catch (error) { cleanupError = error; }\n    if (locked) await client.query(\n      \"SELECT pg_advisory_unlock($1)\",\n      [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY],\n    ).catch((error) => { cleanupError ??= error; });\n    if (cleanupError && !rolloutError) throw cleanupError;\n  }"
      },
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5171,
        "endLine": 5197,
        "sqlOrCode": "  const client = await (await resolveStartupDdlPool(poolOverride)).connect();\n  let previousSearchPath: string | undefined; let previousTimeouts: StartupDdlSessionTimeouts | undefined; let startupError: unknown;\n  try { previousSearchPath = await currentSearchPath(client); previousTimeouts = await readStartupDdlSessionTimeouts(client); await applyStartupDdlSessionTimeouts(client);\n    await runBusinessGrowthSchemaDdl(client, schemaName);\n    const cleanup = await client.query<{\n      candidates: number; detached_users: number; deleted_salons: number; retired_salons: number;\n    }>(`SELECT candidates, detached_users, deleted_salons, retired_salons\n         FROM ${quoteSchema(schemaName)}.education_salon_cleanup_reports WHERE version = 99`);\n    if (cleanup.rows[0]) {\n      logger.info(\n        { version: 99, ...cleanup.rows[0] },\n        \"Education registration salon cleanup report\",\n      );\n    }\n    logger.info(\n      { version: BUSINESS_GROWTH_SCHEMA_VERSION, schema: schemaName },\n      \"Business Growth database schema is ready\",\n    );\n  } catch (error) { startupError = error; throw error; } finally { let cleanupError: unknown; if (previousTimeouts) await restoreStartupDdlSessionTimeouts(client, previousTimeouts).catch((error) => { cleanupError = error; });\n    // Restore search_path on the pooled client so it does not leak to reuse.\n    try {\n      if (previousSearchPath) await client.query(`SET search_path TO ${previousSearchPath}`);\n    } catch (error) {\n      cleanupError ??= error;\n    }\n    client.release();\n    if (cleanupError && !startupError) throw cleanupError;\n  }"
      },
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5201,
        "endLine": 5204,
        "sqlOrCode": "async function currentSearchPath(client: PoolClient): Promise<string> {\n  const result = await client.query<{ search_path: string }>(\"SHOW search_path\");\n  const value = result.rows[0]?.search_path;\n  return value && value.trim().length ? value : '\"$user\", public';\n}"
      }
    ],
    "execution": "The owner invocation is an unconditional 1st top-level await (index.ts:84). The wrapper captures existing search_path/timeouts, applies timeouts, runs an autocommit inner rollout under a shared advisory lock, then attempts rollback/GUC-off/unlock and outer timeout/search_path restoration. The protected rollout is branch-dependent: static roles (2695), payment work (4881/4894), and interim functions are missing/behind-marker only; current-marker repairs return at 5039-5125.",
    "effects": "Runtime operational and session-state behavior: advisory lock, search_path, timeout settings, rollback attempt, custom session GUC, pooled-client cleanup.",
    "repeatSafety": "UNKNOWN. Same lock can be reacquired, but every step depends on current pooled-session state; cleanup errors may be suppressed if rollout already failed.",
    "stateDependence": "Depends on client prior search_path/timeouts, lock availability, any open transaction, and custom GUC state. No production session/catalog inspection occurred.",
    "canonicalComparison": "000001 line 21 has dump setup pg_catalog.set_config('search_path', '', false), not this protocol. No canonical pg_advisory_lock or lumera.snapshot_backfill behavior was found. This is operational behavior, not schema definition.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Who owns lock/GUC/session cleanup after startup DDL retirement?",
      "Are all failure paths safe to return to the pool?",
      "Which autocommit operations require this exact ordering?"
    ]
  },
  {
    "id": "business-growth/cleanup-report-read",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5175-5178",
    "evidenceSourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5175-5184",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5175,
        "endLine": 5184,
        "sqlOrCode": "    const cleanup = await client.query<{\n      candidates: number; detached_users: number; deleted_salons: number; retired_salons: number;\n    }>(`SELECT candidates, detached_users, deleted_salons, retired_salons\n         FROM ${quoteSchema(schemaName)}.education_salon_cleanup_reports WHERE version = 99`);\n    if (cleanup.rows[0]) {\n      logger.info(\n        { version: 99, ...cleanup.rows[0] },\n        \"Education registration salon cleanup report\",\n      );\n    }"
      }
    ],
    "execution": "Within owner 1, after runBusinessGrowthSchemaDdl returns and before the ready log. The owner is invoked each reached startup; this query runs only after the inner runner successfully returns from its applicable marker-controlled branch.",
    "effects": "Read-only observation plus conditional application logging; no source write.",
    "repeatSafety": "Read is repeatable without changing rows, but operational safety is UNKNOWN because absence of the table makes the query fail startup and current row 99 controls logging.",
    "stateDependence": "Requires education_salon_cleanup_reports and depends on whether version 99 exists; neither was inspected in production.",
    "canonicalComparison": "000001:4291-4301 and 8037-8041 define the report table/PK. It has no version-99 SELECT, log, or historical report-writing transformation. Definition does not prove report provenance.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Where is the reviewed writer for version 99?",
      "Must a missing report/table block startup after migration adoption?"
    ]
  },
  {
    "id": "business-growth/rollout-marker-read",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5036-5042",
    "evidenceSourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5035-5043",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5035,
        "endLine": 5043,
        "sqlOrCode": "    const rolloutTable = `${schemaName}.business_growth_schema_rollout`;\n    const existingRollout = await client.query<{ relation: string | null }>(\n      \"SELECT to_regclass($1)::text AS relation\", [rolloutTable],\n    );\n    if (existingRollout.rows[0]?.relation) {\n      const state = await client.query<{ version: number }>(\n        `SELECT version FROM ${quoted}.business_growth_schema_rollout WHERE singleton = true`,\n      );\n      if ((state.rows[0]?.version ?? 0) >= BUSINESS_GROWTH_SCHEMA_VERSION) {"
      }
    ],
    "execution": "Within owner 1 after report-table/cover-image repairs. On each successful entry to this point, it probes marker relation; it reads version only if relation exists. A current version selects the fast path and returns at source line 5125.",
    "effects": "Read-only observation that controls runtime reconciliation branch selection.",
    "repeatSafety": "UNKNOWN. Syntax is read-only, but current marker existence/version selects materially different work; branch equivalence is not proven.",
    "stateDependence": "Directly depends on uninspected production relation existence, singleton row, and version. Missing row is treated as version 0.",
    "canonicalComparison": "000001:2672-2680 and 7225-7229 define the marker table/PK. No to_regclass probe, version predicate, or fast-path decision exists; canonical covers definition only.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Does marker state reliably equal completed migration state?",
      "How are empty, malformed, or divergent marker states recovered?"
    ]
  },
  {
    "id": "business-growth/rollout-marker-write",
    "owner": "ensureBusinessGrowthSchema",
    "sourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5145-5148",
    "evidenceSourcePath": "artifacts/api-server/src/lib/business-growth-schema.ts:5139-5149",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/business-growth-schema.ts",
        "startLine": 5139,
        "endLine": 5149,
        "sqlOrCode": "    await client.query(`CREATE TABLE IF NOT EXISTS ${quoted}.business_growth_schema_rollout (\n      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),\n      version integer NOT NULL,\n      completed_at timestamptz NOT NULL DEFAULT now()\n    )`);\n    await client.query(\n      `INSERT INTO ${quoted}.business_growth_schema_rollout (singleton, version, completed_at)\n       VALUES (true, $1, now())\n       ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, completed_at = EXCLUDED.completed_at`,\n      [BUSINESS_GROWTH_SCHEMA_VERSION],\n    );"
      }
    ],
    "execution": "After the full statement-array loop on non-fast-path execution in owner 1; deliberately autocommit per source lines 5134-5138.",
    "effects": "Current-data reconciliation / rollout-marker write. Creates table if absent, inserts or updates singleton version and completed_at.",
    "repeatSafety": "Not idempotent as row values: every qualifying rerun updates completed_at. ON CONFLICT alone is not a proof of safety; it relies on singleton PK and successful preceding work. Overall UNKNOWN.",
    "stateDependence": "Depends on branch selected by marker read, table/PK state, existing row, version constant, and prior rollout actions; production state uninspected.",
    "canonicalComparison": "000001 defines table/PK (2672-2680,7225-7229) but has no INSERT/upsert, version constant, or completion timestamp write. It is definition, not current-state reconciliation.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Can autocommit marker update falsely record completed work?",
      "What ledger state replaces this marker?"
    ]
  },
  {
    "id": "education-bundle/learner-id-backfill",
    "owner": "ensureEducationBundlePurchaseSchema",
    "sourcePath": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:54-58",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts",
        "startLine": 54,
        "endLine": 58,
        "sqlOrCode": "    await client.query(`UPDATE ${schema}.education_bundle_purchases purchase\n      SET learner_user_id = employee.user_id\n      FROM ${schema}.employees employee\n      WHERE purchase.target_type = 'salon_employee' AND purchase.employee_id = employee.id\n        AND purchase.learner_user_id IS NULL AND employee.user_id IS NOT NULL`);"
      }
    ],
    "execution": "8th owner (index.ts:91), in its one transaction, after old target checks are dropped (52-53) and before replacement check add/validate (59-63).",
    "effects": "Existing-data mutation: assigns learner_user_id from employees.user_id for selected purchases.",
    "repeatSafety": "Conditional convergence only: filled rows no longer match IS NULL. Overall UNKNOWN because mapping correctness and unmatched invalid rows depend on current data and subsequent validation can fail.",
    "stateDependence": "Depends on actual purchases, employee rows/user_id mappings, and nulls; production was not inspected.",
    "canonicalComparison": "000001 defines learner_user_id, target check, and user FK (3421-3448,16440-16444); it contains no UPDATE from employees.user_id. Historical transformation is absent.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Is employee.user_id the approved learner identity for every candidate?",
      "How many selected/unmatched rows exist?",
      "What is the compensating plan for a wrong assignment?"
    ]
  },
  {
    "id": "education-bundle/payment-reference-backfill",
    "owner": "ensureEducationBundlePurchaseSchema",
    "sourcePath": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:24-31",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts",
        "startLine": 24,
        "endLine": 31,
        "sqlOrCode": "    await client.query(`UPDATE ${schema}.education_bundle_purchases\n      SET payment_reference = 'BND-' || left(replace(id::text, '-', ''), 30),\n          payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}',\n            to_jsonb('BND-' || left(replace(id::text, '-', ''), 30)), true)\n      WHERE payment_reference IS NULL`);\n    await client.query(`UPDATE ${schema}.education_bundle_purchases\n      SET payment_instructions = jsonb_set(COALESCE(payment_instructions, '{}'::jsonb), '{reference}', to_jsonb(payment_reference), true)\n      WHERE payment_instructions->>'reference' IS DISTINCT FROM payment_reference`);"
      }
    ],
    "execution": "8th owner, after payment_reference add/drop trigger (22-23), before NOT NULL, unique index, snapshot check, function and trigger (32-51); same transaction.",
    "effects": "Existing financial data mutation: generates BND UUID-derived references and rewrites JSON reference snapshots.",
    "repeatSafety": "Conditional convergence predicates are concrete (IS NULL; IS DISTINCT FROM), but uniqueness of truncated values and correctness of JSON rewrite are not proven. Overall UNKNOWN.",
    "stateDependence": "Depends on current purchase IDs/payment values/JSON and later unique/not-null constraints; production data was not inspected.",
    "canonicalComparison": "000001 has final NOT NULL/check (3421-3448), unique index (11162-11165), function (1693-1706), and trigger (14775-14778), but no update. Canonical is definition, not backfill.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Do generated 30-character references collide?",
      "Is overwriting every mismatched snapshot approved financial policy?",
      "What restore/compensation is available?"
    ]
  },
  {
    "id": "education-bundle/payment-reference-function",
    "owner": "ensureEducationBundlePurchaseSchema",
    "sourcePath": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:39-47",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts",
        "startLine": 39,
        "endLine": 47,
        "sqlOrCode": "    await client.query(`CREATE OR REPLACE FUNCTION ${schema}.reject_bundle_payment_reference_change() RETURNS trigger AS $$\n      BEGIN\n        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference\n          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN\n          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';\n        END IF;\n        RETURN NEW;\n      END\n    $$ LANGUAGE plpgsql`);"
      }
    ],
    "execution": "8th owner; after payment updates and constraints, before drop/recreate of the trigger at 48-51; same transaction.",
    "effects": "Existing-schema reconciliation: replaces trigger-function definition, no direct row update.",
    "repeatSafety": "Syntactically repeatable through CREATE OR REPLACE, but semantic safety is UNKNOWN: current installed definition/trigger bindings/callers were not compared in production.",
    "stateDependence": "Depends on function namespace and trigger/table state; production catalog uninspected.",
    "canonicalComparison": "Canonical has materially matching function body (000001:1693-1706) and trigger binding (14775-14778): definition evidence only, not proof current production definition/data is correct.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Does installed function exactly match canonical?",
      "Are all expected triggers bound to it?",
      "Is a versioned replacement needed?"
    ]
  },
  {
    "id": "education-bundle/transaction-and-advisory-lock",
    "owner": "ensureEducationBundlePurchaseSchema",
    "sourcePath": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:9-12,81-84",
    "evidenceSourcePath": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:6-8,85",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts",
        "startLine": 6,
        "endLine": 8,
        "sqlOrCode": "  const schema = `\"${schemaName}\"`, client = await (await resolveStartupDdlPool(poolOverride)).connect(); let locked = false;\n  try { await client.query(\"begin\"); await setLocalStartupDdlTimeouts(client);\n    await client.query(\"SELECT pg_advisory_lock($1)\", [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY]); locked = true;"
      },
      {
        "path": "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts",
        "startLine": 85,
        "endLine": 85,
        "sqlOrCode": "    await client.query(\"commit\"); } catch (error) { await client.query(\"rollback\").catch(() => {}); throw error; } finally { try { if (locked) await client.query(\"SELECT pg_advisory_unlock($1)\", [BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY]).catch(() => {}); } finally { client.release(); } }"
      }
    ],
    "execution": "8th owner after all other startup owners; brackets all Education Bundle statements in one transaction and shares Business Growth advisory lock.",
    "effects": "Operational transaction, timeout and advisory-lock scaffolding.",
    "repeatSafety": "UNKNOWN. The code proves conditional unlock/client release but swallows rollback/unlock failure and does not prove downstream actions repeat-safe.",
    "stateDependence": "Client/lock/transaction availability and preceding-owner success determine execution; production state uninspected.",
    "canonicalComparison": "Canonical contains final bundle objects but no this transaction, timeout, advisory-lock, or pooled-client lifecycle. Runtime behavior is absent.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Why must this share Business Growth lock?",
      "Which migration transaction boundary safely pairs updates/constraints?"
    ]
  },
  {
    "id": "marketplace/advisory-lock-and-session-state",
    "owner": "ensureMarketplacePerformanceIndexes",
    "sourcePath": "artifacts/api-server/src/lib/marketplace-performance-schema.ts:18-20,39-44",
    "evidenceSourcePath": "artifacts/api-server/src/lib/marketplace-performance-schema.ts:16-20,39-46",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/marketplace-performance-schema.ts",
        "startLine": 16,
        "endLine": 20,
        "sqlOrCode": "  const client = await (await resolveStartupDdlPool(poolOverride)).connect(); let previousTimeouts: StartupDdlSessionTimeouts | undefined;\n  let locked = false; let startupError: unknown;\n  try { previousTimeouts = await readStartupDdlSessionTimeouts(client); await applyStartupDdlSessionTimeouts(client);\n    await client.query(\"select pg_advisory_lock($1)\", [MARKETPLACE_PERFORMANCE_INDEX_LOCK]);\n    locked = true;"
      },
      {
        "path": "artifacts/api-server/src/lib/marketplace-performance-schema.ts",
        "startLine": 39,
        "endLine": 46,
        "sqlOrCode": "  } catch (error) { startupError = error; throw error; } finally {\n    let cleanupError: unknown;\n    if (locked) {\n      await client.query(\"select pg_advisory_unlock($1)\", [MARKETPLACE_PERFORMANCE_INDEX_LOCK]).catch((error) => { cleanupError = error; });\n    }\n    if (previousTimeouts) await restoreStartupDdlSessionTimeouts(client, previousTimeouts).catch((error) => { cleanupError ??= error; });\n    client.release();\n    if (cleanupError && !startupError) throw cleanupError;\n  }"
      }
    ],
    "execution": "The owner invocation is unconditional in 4th position. No transaction is opened; after its setup succeeds, protected body executes four CREATE INDEX CONCURRENTLY statements (21-37), then cleanup.",
    "effects": "Runtime advisory lock and session-timeout save/apply/restore around nontransactional concurrent index builds.",
    "repeatSafety": "UNKNOWN. Reacquisition/release is coded, but current index validity after interruption and suppressed cleanup error behavior are not proven.",
    "stateDependence": "Depends on session timeout state, lock availability, and existing index/catalog validity; production catalog/session uninspected.",
    "canonicalComparison": "Final named indexes are canonical definitions (000001:9755-9758,13143-13153,13374-13377). Canonical has no CONCURRENTLY execution, lock, or timeout lifecycle.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "How are invalid concurrent indexes detected/recovered?",
      "What nontransactional migration mode preserves this behavior?"
    ]
  },
  {
    "id": "media/transaction-and-advisory-lock",
    "owner": "ensureMediaSchema",
    "sourcePath": "artifacts/api-server/src/lib/media-schema.ts:105-109",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/media-schema.ts",
        "startLine": 11,
        "endLine": 103,
        "sqlOrCode": "  const statements = [\n    `DO $$ BEGIN\n      CREATE TYPE image_asset_status AS ENUM ('pending', 'processing', 'ready', 'failed');\n    EXCEPTION\n      WHEN duplicate_object THEN null;\n    END $$`,\n    `CREATE TABLE IF NOT EXISTS image_assets (\n      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n      uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,\n      original_filename text NOT NULL,\n      source_content_type text NOT NULL,\n      source_size integer NOT NULL,\n      staging_object_path text NOT NULL,\n      original_object_path text,\n      original_width integer,\n      original_height integer,\n      variants jsonb,\n      status image_asset_status NOT NULL DEFAULT 'pending',\n      alt_text text NOT NULL DEFAULT '',\n      failure_reason text,\n      expires_at timestamptz NOT NULL,\n      created_at timestamptz NOT NULL DEFAULT now(),\n      updated_at timestamptz NOT NULL DEFAULT now()\n    )`,\n    `CREATE UNIQUE INDEX IF NOT EXISTS image_assets_staging_object_path_unique ON image_assets (staging_object_path)`,\n    `CREATE INDEX IF NOT EXISTS image_assets_uploader_created_idx ON image_assets (uploaded_by_user_id, created_at)`,\n    `CREATE INDEX IF NOT EXISTS image_assets_status_expires_idx ON image_assets (status, expires_at)`,\n    `ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS alt_text text NOT NULL DEFAULT ''`,\n    `CREATE TABLE IF NOT EXISTS media_assets (\n      id uuid PRIMARY KEY,\n      owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,\n      scope text NOT NULL,\n      resource_id uuid,\n      visibility text NOT NULL DEFAULT 'public',\n      original_file_name text NOT NULL,\n      original_content_type text NOT NULL,\n      width integer NOT NULL,\n      height integer NOT NULL,\n      content_hash text NOT NULL,\n      alt_text text NOT NULL DEFAULT '',\n      cleanup_reserved_at timestamptz,\n      test_cleanup_key text,\n      created_at timestamptz NOT NULL DEFAULT now()\n    )`,\n    `ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS cleanup_reserved_at timestamptz`,\n    `ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS test_cleanup_key text`,\n    `ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text text NOT NULL DEFAULT ''`,\n    `CREATE INDEX IF NOT EXISTS media_assets_owner_created_idx ON media_assets (owner_user_id, created_at)`,\n    `CREATE INDEX IF NOT EXISTS media_assets_scope_resource_idx ON media_assets (scope, resource_id)`,\n    `CREATE INDEX IF NOT EXISTS media_assets_content_hash_idx ON media_assets (content_hash)`,\n    `CREATE INDEX IF NOT EXISTS media_assets_cleanup_reservation_idx ON media_assets (resource_id, cleanup_reserved_at)`,\n    `CREATE INDEX IF NOT EXISTS media_assets_test_cleanup_idx ON media_assets (test_cleanup_key)`,\n    `CREATE TABLE IF NOT EXISTS media_variants (\n      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n      asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,\n      size_name text NOT NULL,\n      format text NOT NULL,\n      object_path text NOT NULL,\n      content_type text NOT NULL,\n      width integer NOT NULL,\n      height integer NOT NULL,\n      byte_size integer NOT NULL,\n      etag text NOT NULL,\n      created_at timestamptz NOT NULL DEFAULT now()\n    )`,\n    `CREATE UNIQUE INDEX IF NOT EXISTS media_variants_asset_size_format_unique ON media_variants (asset_id, size_name, format)`,\n    `CREATE UNIQUE INDEX IF NOT EXISTS media_variants_object_path_unique ON media_variants (object_path)`,\n    `CREATE INDEX IF NOT EXISTS media_variants_asset_idx ON media_variants (asset_id)`,\n    `CREATE TABLE IF NOT EXISTS media_upload_tickets (\n      id uuid PRIMARY KEY,\n      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      scope text NOT NULL,\n      resource_id uuid,\n      staging_object_path text NOT NULL,\n      original_file_name text NOT NULL,\n      content_type text NOT NULL,\n      byte_size integer NOT NULL,\n      expires_at timestamptz NOT NULL,\n      finalized_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,\n      finalized_at timestamptz,\n      cleanup_failure_count integer NOT NULL DEFAULT 0,\n      last_cleanup_failure_at timestamptz,\n      test_cleanup_key text,\n      promotion_cleanup_paths jsonb NOT NULL DEFAULT '[]'::jsonb,\n      created_at timestamptz NOT NULL DEFAULT now()\n    )`,\n    `ALTER TABLE media_upload_tickets ADD COLUMN IF NOT EXISTS test_cleanup_key text`,\n    `ALTER TABLE media_upload_tickets ADD COLUMN IF NOT EXISTS promotion_cleanup_paths jsonb NOT NULL DEFAULT '[]'::jsonb`,\n    `CREATE UNIQUE INDEX IF NOT EXISTS media_upload_tickets_staging_path_unique ON media_upload_tickets (staging_object_path)`,\n    `CREATE INDEX IF NOT EXISTS media_upload_tickets_owner_expires_idx ON media_upload_tickets (owner_user_id, expires_at)`,\n    `CREATE INDEX IF NOT EXISTS media_upload_tickets_cleanup_idx ON media_upload_tickets (expires_at, finalized_at)`,\n    `CREATE INDEX IF NOT EXISTS media_upload_tickets_test_cleanup_idx ON media_upload_tickets (test_cleanup_key)`,\n  ];"
      },
      {
        "path": "artifacts/api-server/src/lib/media-schema.ts",
        "startLine": 105,
        "endLine": 109,
        "sqlOrCode": "  try { await client.query(\"begin\"); await setLocalStartupDdlTimeouts(client); await client.query(\"select pg_advisory_lock(hashtext($1))\", [\"lumera:media-schema:v1\"]); locked = true;\n    for (const statement of statements) { await client.query(statement); }\n    await client.query(\"commit\"); logger.info(\"Media database schema is ready\");\n  } catch (error) { await client.query(\"rollback\").catch(() => {}); throw error; }\n  finally { if (locked) await client.query(\"select pg_advisory_unlock(hashtext($1))\", [\"lumera:media-schema:v1\"]).catch(() => {}); client.release(); }"
      }
    ],
    "execution": "The owner invocation is unconditional in 2nd position. It starts a transaction; after setup succeeds, the grouped curated SQL literals at lines 11-103 execute serially in array order at line 106; commit or attempted rollback then lock cleanup.",
    "effects": "Runtime transaction/local timeout/hash advisory-lock scaffolding around ordered DDL array; this record itself is not a data mutation.",
    "repeatSafety": "UNKNOWN. Array order and cleanup attempts are evidenced, but rollback/unlock errors are swallowed and array members' catalog/data preconditions vary.",
    "stateDependence": "Depends on pooled client, lock/transaction state, and every statement's existing schema state; no production inspection.",
    "canonicalComparison": "Canonical defines media end-state tables/indexes (for example 000001:4663-4666,4857-4906,12534-12803) but no ordered startup loop, transaction, timeout, or advisory-lock lifecycle.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Which exact array members require one transaction?",
      "What replaces serialization?",
      "Can all failure paths be safely retried?"
    ]
  },
  {
    "id": "referral/tracking-start-backfill",
    "owner": "ensureReferralSchema",
    "sourcePath": "artifacts/api-server/src/lib/referral-schema.ts:27-41",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/referral-schema.ts",
        "startLine": 27,
        "endLine": 41,
        "sqlOrCode": "    await client.query(`\n      update ${schema}.referral_qualifications q\n      set tracking_started_at = coalesce(\n        (select min(a.created_at)\n         from ${schema}.business_verification_audits a\n         where a.next_status = 'verified'\n           and a.evidence->>'referralAttributionId' = q.attribution_id::text),\n        q.updated_at\n      )\n      from ${schema}.referral_attributions r\n      where r.id = q.attribution_id\n        and r.channel in ('A', 'B1')\n        and q.status <> 'pending_verification'\n        and q.tracking_started_at is null\n    `);"
      }
    ],
    "execution": "The owner invocation is unconditional in 5th position. After additive columns (16-23) succeed, this update runs before enum alteration and commit (42-49), inside its transaction/lock.",
    "effects": "Historical data transformation: updates selected referral qualification timestamps from earliest verified audit or legacy updated_at fallback.",
    "repeatSafety": "Conditional convergence only: successful rows cease matching IS NULL. Overall UNKNOWN because audit match/fallback policy and candidates are current data-dependent.",
    "stateDependence": "Depends on referral qualification/attribution/audit contents, JSON attribution linkage, statuses, channels, and timestamps; production not inspected.",
    "canonicalComparison": "000001 defines nullable tracking_started_at (5645-5663) and attribution FK (18560-18564), but no audit lookup/update/fallback. Historical transformation is absent.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Is updated_at approved when audit proof is absent?",
      "How are unmatched and ambiguous audit records handled?",
      "What is the restore policy?"
    ]
  },
  {
    "id": "referral/transaction-and-advisory-lock",
    "owner": "ensureReferralSchema",
    "sourcePath": "artifacts/api-server/src/lib/referral-schema.ts:16-18,48-53",
    "evidenceSourcePath": "artifacts/api-server/src/lib/referral-schema.ts:12-15,49-55",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/referral-schema.ts",
        "startLine": 12,
        "endLine": 15,
        "sqlOrCode": "  const client = await pool.connect(); let locked = false;\n  try {\n    await client.query(\"begin\"); await setLocalStartupDdlTimeouts(client); await client.query(\"select pg_advisory_lock(hashtext($1))\", [\"lumera:referral-schema\"]); locked = true;\n    // The transaction-local policy bounds both advisory-lock and DDL waits."
      },
      {
        "path": "artifacts/api-server/src/lib/referral-schema.ts",
        "startLine": 49,
        "endLine": 55,
        "sqlOrCode": "    await client.query(\"commit\");\n  } catch (error) {\n    await client.query(\"rollback\").catch(() => {});\n    throw error;\n  } finally {\n    if (locked) await client.query(\"select pg_advisory_unlock(hashtext($1))\", [\"lumera:referral-schema\"]).catch(() => {});\n    client.release();"
      }
    ],
    "execution": "The owner invocation is unconditional in 5th position; after setup succeeds it surrounds referral statements, including tracking backfill, with transaction/local timeout/hash lock.",
    "effects": "Runtime transaction and advisory-lock scaffolding.",
    "repeatSafety": "UNKNOWN; successful lock lifecycle is coded but rollback/unlock failure is suppressed and paired backfill/schema effects are state-dependent.",
    "stateDependence": "Depends on client/lock/transaction state and prior owner success; production uninspected.",
    "canonicalComparison": "Canonical has referral definitions, not this lock/timeout/transaction protocol.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "What serialization and recovery mechanism replaces this paired runtime transaction?"
    ]
  },
  {
    "id": "shipping/duplicate-row-cleanup",
    "owner": "ensureShippingConfigSchema",
    "sourcePath": "artifacts/api-server/src/lib/shipping-config.ts:24-35,54-65",
    "evidenceSourcePath": "artifacts/api-server/src/lib/shipping-config.ts:24-35,47-65",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/shipping-config.ts",
        "startLine": 24,
        "endLine": 35,
        "sqlOrCode": "    await client.query(\"begin\"); await setLocalStartupDdlTimeouts(client); await client.query(\"select pg_advisory_lock(hashtext($1))\", [SHIPPING_RULES_LOCK_KEY]);\n    locked = true;\n    // Transaction-local timeouts bound both advisory-lock and table-lock waits.\n    await runShippingConfigSchemaDdl(client, schemaName);\n    await client.query(\"commit\");\n  } catch (error) {\n    await client.query(\"rollback\").catch(() => {});\n    throw error;\n  } finally {\n    if (locked) {\n      await client.query(\"select pg_advisory_unlock(hashtext($1))\", [SHIPPING_RULES_LOCK_KEY])\n        .catch(() => {});\n    }"
      },
      {
        "path": "artifacts/api-server/src/lib/shipping-config.ts",
        "startLine": 47,
        "endLine": 65,
        "sqlOrCode": "export async function runShippingConfigSchemaDdl(\n  client: PoolClient,\n  schemaName: string,\n): Promise<void> {\n  const schema = quoteSchema(schemaName);\n  // Index names are scoped by the current schema in PostgreSQL; keep the\n  // table qualified while making the target schema local to this transaction.\n  await client.query(`set local search_path to ${schema}`);\n  await client.query(`lock table ${schema}.shipping_rules in share row exclusive mode`);\n  await client.query(`\n    delete from ${schema}.shipping_rules\n    where id <> (\n      select id from ${schema}.shipping_rules order by id asc limit 1\n    )\n  `);\n  await client.query(`\n    create unique index if not exists ${SHIPPING_RULES_INDEX_NAME}\n    on ${schema}.shipping_rules ((true))\n  `);\n}"
      }
    ],
    "execution": "The owner invocation is unconditional in 3rd position; after wrapper transaction/lock setup it calls helper, whose executable SQL order is set local search_path, table lock, delete, unique index, then commit.",
    "effects": "Destructive existing-data cleanup plus schema reconciliation. Deletes every non-lowest UUID shipping rule.",
    "repeatSafety": "Second successful cleanup has no duplicates to delete, but semantic safety is UNKNOWN: deleted rows cannot be restored from this code and lowest UUID may not be approved survivor.",
    "stateDependence": "Directly depends on current row count/UUID ordering and table lock availability; production data was not inspected.",
    "canonicalComparison": "000001 defines shipping_rules (6536-6548) and singleton index (14558-14561), but no table lock/delete/survivor policy. Canonical definition does not represent destructive cleanup.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Which row is business-approved survivor?",
      "What backup/restore exists?",
      "How many duplicates and what lock impact exist?"
    ]
  },
  {
    "id": "ensureWebPushSchema/source-discovered-82-dd7107a5f655438a",
    "owner": "ensureWebPushSchema",
    "sourcePath": "artifacts/api-server/src/lib/web-push-schema.ts:82:22",
    "evidenceSourcePath": "artifacts/api-server/src/lib/web-push-schema.ts:82",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/web-push-schema.ts",
        "startLine": 80,
        "endLine": 84,
        "sqlOrCode": "  await client.query(`ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS expires_at timestamptz`);\n  await client.query(`ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`);\n  await client.query(`UPDATE ${schema}.system_push_deliveries SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL`);\n  await client.query(`ALTER TABLE ${schema}.system_push_deliveries ALTER COLUMN expires_at SET NOT NULL`);\n  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS system_push_deliveries_event_subscription_unique ON ${schema}.system_push_deliveries(event_key, subscription_id)`);"
      }
    ],
    "execution": "The owner invocation is unconditional in 6th position. After outer transaction/lock setup and add-if-absent success, inner routine line 82 runs before NOT NULL, inside outer transaction/lock (10-24).",
    "effects": "Existing-data expiration backfill: fills null expires_at as created_at plus 24 hours.",
    "repeatSafety": "Conditional convergence only: rows filled no longer match WHERE expires_at IS NULL. Overall UNKNOWN because 24-hour policy and candidate row data are not verified.",
    "stateDependence": "Depends on table/column, null candidates, created_at values, and subsequent NOT NULL success; production uninspected.",
    "canonicalComparison": "000001 defines expires_at NOT NULL in system_push_deliveries (6711-6734) and final indexes (14670-14701), but no update/backfill. Definition is not historical data policy.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "Are historical delivery expiry semantics truly 24 hours?",
      "How many nulls exist and will retroactive expiry affect delivery/retention?"
    ]
  },
  {
    "id": "web-push/transaction-and-advisory-lock",
    "owner": "ensureWebPushSchema",
    "sourcePath": "artifacts/api-server/src/lib/web-push-schema.ts:11-15,18-24",
    "evidenceSourcePath": "artifacts/api-server/src/lib/web-push-schema.ts:10-24",
    "sourceEvidence": [
      {
        "path": "artifacts/api-server/src/lib/web-push-schema.ts",
        "startLine": 10,
        "endLine": 24,
        "sqlOrCode": "export async function ensureWebPushSchema(schemaName = \"public\", poolOverride?: StartupDdlPool): Promise<void> {\n  const client = await (await resolveStartupDdlPool(poolOverride)).connect();\n  let locked = false;\n  try {\n    await client.query(\"begin\"); await setLocalStartupDdlTimeouts(client); await client.query(\"select pg_advisory_lock(hashtext($1))\", [LOCK_KEY]);\n    locked = true;\n    // Transaction-local timeouts bound startup lock and schema work.\n    await runWebPushSchemaDdl(client, schemaName);\n    await client.query(\"commit\");\n  } catch (error) {\n    await client.query(\"rollback\").catch(() => {});\n    throw error;\n  } finally {\n    if (locked) await client.query(\"select pg_advisory_unlock(hashtext($1))\", [LOCK_KEY]).catch(() => {});\n    client.release();\n  }"
      }
    ],
    "execution": "The owner invocation is unconditional in 6th position; it begins transaction, applies local timeouts, takes hash advisory lock, then invokes inner queries in source order 30-88 subject to preceding success, commits/rolls back, unlocks/releases.",
    "effects": "Runtime transaction/local timeout/advisory-lock scaffolding.",
    "repeatSafety": "UNKNOWN. Code demonstrates conditional unlock and client release, not safe retry after suppressed rollback/unlock failure or all inner operations.",
    "stateDependence": "Depends on pooled client, lock/transaction state and inner schema/data state; production uninspected.",
    "canonicalComparison": "Canonical defines final push tables/indexes/FKs (5499-5504,6711-6734,13437-13447,14670-14701,19352-19364), not this runtime protocol.",
    "evidenceAssessment": "UNRESOLVED — provisional only.",
    "uncertainties": [
      "What versioned transaction sequence will pair column/backfill/not-null?",
      "Is lock cleanup proven under connection loss?"
    ]
  }
]
```
