# Migration-built data-transfer inventory

Authority: the owned PostgreSQL 16 target was built by `applyMigrations` loading migrations 000001–000004. The source dump was restored only into the same runner's separately named disposable source database. Source metadata/counts were read in one REPEATABLE READ READ ONLY transaction. No source migration-ledger rows were read.

Actual output:
```text
INVENTORY target_tables=256 source_tables=256 source_rows=46483 target_seed_rows=28
TRIGGERS source=24 target=24
FUNCTIONS source=22 target=21
CLEANUP_REPORT_TABLE target_exists=true source_count=1 target_count=1
FAULT_FUNCTION source_count=1 source_attached_triggers=0 target_count=0
OWNED_CLUSTER_REMOVED
```

## Corrections to the provisional inventory

- `public.education_salon_cleanup_reports` **exists** in the migration-built target and contains one migration-generated receipt. Source also contains one row. The original source-only classification was wrong; it is now compare-with-seeded-rows and requires a provenance decision.
- The six provisional `order_items` nullability differences were Drizzle representation artifacts. Actual PostgreSQL source and migration-built target agree. No nullability drift remains.
- All other provisional column-difference locations remain: seven target-only columns and one changed default. The raw catalog values—not normalized Drizzle expressions—are recorded in inventory.json.
- The actual target has 256 application tables, ten seeded tables and 28 seed rows; not the provisional 255 tables and nine seeded-table classification.
- The target FK dependency multiset also differs from the provisional inventory on the tables listed below (including additional canonical duplicate FKs and the aftercare reference). Exact prior and actual definitions are retained in inventory.json:
  - `public.education_gift_vouchers`: provisional 9 FK entries; actual target 10 FK entries.
  - `public.product_categories`: provisional 1 FK entries; actual target 2 FK entries.
  - `public.products`: provisional 2 FK entries; actual target 3 FK entries.
  - `public.referral_credit_redemptions`: provisional 3 FK entries; actual target 4 FK entries.
  - `public.retail_order_items`: provisional 2 FK entries; actual target 3 FK entries.
- Source has 24 user triggers and 22 application functions. Actual target has 24 user triggers and 21 application functions; these are now measured target-side facts.

## Per-table inventory

The JSON companion records each foreign-key name, referenced table, complete definition, all raw source and target columns (type, nullability, default, generated/identity attributes), each difference, seed location, and owner-decision flags. Counts below are actual restored/source and freshly migrated/target counts. Transfer is the default; compare-with-seeded-rows is a blocking reconciliation proposal, not permission to remove or overwrite seeds. The operational migration ledger alone is never transferred.

Migration 000001 creates the baseline schema and does not seed application rows. The ten seeded tables receive their rows from migration 000002; each exact INSERT line is recorded in `seededBy`. An empty `seededBy` means neither migration seeds that table.

| Table | Source rows | Target seed rows | FK dependencies | Column differences | Proposed classification | Owner decision |
|---|---:|---:|---|---:|---|---|
| `public.aftercare_completion_events` | 2 | 0 | appointments, users | 0 | transfer | — |
| `public.aftercare_deliveries` | 15 | 0 | aftercare_recommendation_lines, aftercare_recommendations | 0 | transfer | required |
| `public.aftercare_recommendation_appointments` | 5 | 0 | appointments, aftercare_recommendations, treatment_taxonomy | 0 | transfer | — |
| `public.aftercare_recommendation_lines` | 11 | 0 | product_bundles, products, retail_orders, aftercare_recommendations | 0 | transfer | — |
| `public.aftercare_recommendations` | 11 | 0 | retail_orders, users | 0 | transfer | — |
| `public.aftercare_settings` | 3 | 1 | users | 0 | compare-with-seeded-rows | — |
| `public.appointment_add_ons` | 0 | 0 | service_add_ons, appointments | 0 | transfer | — |
| `public.appointment_deposits` | 0 | 0 | appointments, salons, users | 0 | transfer | — |
| `public.appointment_employees` | 0 | 0 | appointments, employees | 0 | transfer | — |
| `public.appointment_resource_allocations` | 7 | 0 | appointments, salon_resources | 0 | transfer | — |
| `public.appointment_series` | 8 | 0 | users, employees, salon_customers, salons, services | 0 | transfer | — |
| `public.appointment_status_history` | 175 | 0 | appointments, users | 0 | transfer | required |
| `public.appointment_treatments` | 13316 | 0 | appointments, employees, services | 0 | transfer | — |
| `public.appointment_waitlist` | 0 | 0 | users, employees, salons, services | 0 | transfer | required |
| `public.appointments` | 13296 | 0 | users, booking_groups, employees, salon_customers, salons, appointment_series, services | 0 | transfer | — |
| `public.automatic_xy_promotion_targets` | 0 | 0 | product_categories, products, automatic_xy_promotions | 0 | transfer | — |
| `public.automatic_xy_promotions` | 0 | 0 | — | 0 | transfer | — |
| `public.automation_deliveries` | 0 | 0 | automation_runs, salons | 0 | transfer | required |
| `public.automation_rules` | 0 | 0 | salons | 0 | transfer | — |
| `public.automation_runs` | 0 | 0 | appointments, automation_rules, salon_customers, salons | 0 | transfer | — |
| `public.b2b_cart_imports` | 0 | 0 | shopping_carts, salons | 0 | transfer | — |
| `public.b2b_invoice_sequences` | 1 | 0 | — | 0 | transfer | — |
| `public.b2b_quotes` | 2 | 0 | salons, shopping_carts | 0 | transfer | — |
| `public.b2c_display_settings` | 1 | 1 | users | 0 | compare-with-seeded-rows | — |
| `public.b2c_need_tags` | 2 | 0 | users | 0 | transfer | — |
| `public.b2c_product_need_tags` | 3 | 0 | b2c_need_tags, products | 0 | transfer | — |
| `public.b2c_product_types` | 1 | 0 | users | 0 | transfer | — |
| `public.b2c_promotional_banners` | 0 | 0 | users, product_categories, products, suppliers | 0 | transfer | — |
| `public.b2c_recently_viewed_products` | 1 | 0 | products, users | 0 | transfer | required |
| `public.beauty_glossary` | 5 | 0 | — | 0 | transfer | — |
| `public.beauty_job_application_actions` | 19 | 0 | users | 0 | transfer | — |
| `public.beauty_job_categories` | 17 | 17 | — | 0 | compare-with-seeded-rows | — |
| `public.beauty_job_contacts` | 1 | 0 | users, beauty_job_listings | 0 | transfer | — |
| `public.beauty_job_listing_availability` | 12 | 0 | beauty_job_listings | 0 | transfer | — |
| `public.beauty_job_listings` | 124 | 0 | beauty_job_categories, salons, users | 1 | transfer | — |
| `public.beauty_job_moderation_audit` | 1 | 0 | users | 0 | transfer | required |
| `public.beauty_job_notifications` | 2 | 0 | beauty_job_contacts, beauty_job_listings, users | 0 | transfer | required |
| `public.beauty_job_platform_settings` | 1 | 1 | users | 0 | compare-with-seeded-rows | — |
| `public.beauty_job_rental_requests` | 0 | 0 | users, beauty_job_listings, beauty_job_rental_slots | 0 | transfer | — |
| `public.beauty_job_rental_slots` | 12 | 0 | beauty_job_listings | 0 | transfer | — |
| `public.beauty_job_reports` | 3 | 0 | beauty_job_listings, users | 0 | transfer | — |
| `public.beauty_job_saved_listings` | 0 | 0 | beauty_job_listings, users | 0 | transfer | — |
| `public.booking_command_receipts` | 166 | 0 | salons | 0 | transfer | required |
| `public.booking_groups` | 37 | 0 | users, salon_customers, salons | 0 | transfer | — |
| `public.bulk_sale_campaign_targets` | 0 | 0 | bulk_sale_campaigns, product_categories, products | 0 | transfer | — |
| `public.bulk_sale_campaigns` | 0 | 0 | — | 0 | transfer | — |
| `public.business_growth_schema_rollout` | 1 | 0 | — | 0 | transfer | — |
| `public.business_verification_audits` | 0 | 0 | users, legal_entity_businesses | 0 | transfer | required |
| `public.cart_threshold_rewards` | 0 | 0 | products | 0 | transfer | — |
| `public.catalog_sync_runs` | 0 | 0 | users | 0 | transfer | required |
| `public.commerce_customer_notifications` | 0 | 0 | users, product_waitlist | 0 | transfer | required |
| `public.commerce_experience_settings` | 1 | 0 | users | 0 | transfer | — |
| `public.coupon_redemptions` | 0 | 0 | coupons, orders, retail_orders, salons, users | 0 | transfer | — |
| `public.coupons` | 10 | 0 | — | 0 | transfer | — |
| `public.courier_services` | 7 | 0 | — | 0 | transfer | — |
| `public.course_categories` | 25 | 0 | education_sections | 0 | transfer | — |
| `public.course_days` | 24 | 0 | courses | 0 | transfer | — |
| `public.course_enrollments` | 35 | 0 | education_booking_groups, education_bundle_purchases, courses, users, employees, education_booking_participants, salons, course_sessions | 0 | transfer | — |
| `public.course_lessons` | 8 | 0 | course_modules | 0 | transfer | — |
| `public.course_modules` | 6 | 0 | courses | 0 | transfer | — |
| `public.course_reviews` | 0 | 0 | courses, course_enrollments, users | 0 | transfer | — |
| `public.course_sessions` | 29 | 0 | courses | 0 | transfer | required |
| `public.courses` | 32 | 0 | course_categories, education_centers, education_course_types, users, education_instructors, salons, education_subcategories | 0 | transfer | — |
| `public.customer_notes` | 0 | 0 | users, salons | 0 | transfer | — |
| `public.customer_notifications` | 224 | 0 | users | 0 | transfer | required |
| `public.customer_package_purchases` | 9 | 0 | treatment_packages, users, salon_customers, salons | 0 | transfer | — |
| `public.customer_password_setup_audits` | 1 | 0 | users | 0 | transfer | required |
| `public.customer_password_setup_rate_limits` | 9 | 0 | — | 0 | transfer | required |
| `public.customer_password_setup_tokens` | 1 | 0 | users | 0 | transfer | required |
| `public.education_access_extensions` | 1 | 0 | course_enrollments, education_payment_obligations, users | 0 | transfer | — |
| `public.education_attendance` | 0 | 0 | education_booking_participants, users, course_sessions | 0 | transfer | — |
| `public.education_b2b_discount_audits` | 0 | 0 | users | 0 | transfer | required |
| `public.education_b2b_discount_settings` | 1 | 1 | users | 0 | compare-with-seeded-rows | — |
| `public.education_b2b_discount_tiers` | 0 | 0 | — | 0 | transfer | — |
| `public.education_b2b_order_items` | 0 | 0 | education_b2b_orders, products | 0 | transfer | — |
| `public.education_b2b_orders` | 0 | 0 | education_centers, users | 2 | transfer | — |
| `public.education_bank_transactions` | 0 | 0 | education_payment_obligations | 0 | transfer | — |
| `public.education_booking_groups` | 1 | 0 | education_centers, courses, users, course_sessions | 0 | transfer | — |
| `public.education_booking_participants` | 1 | 0 | education_booking_groups, users | 0 | transfer | — |
| `public.education_bundle_courses` | 0 | 0 | education_bundles, courses | 0 | transfer | — |
| `public.education_bundle_purchase_escrows` | 0 | 0 | education_centers, education_bundle_purchases | 0 | transfer | — |
| `public.education_bundle_purchase_items` | 0 | 0 | courses, education_bundle_purchases | 0 | transfer | — |
| `public.education_bundle_purchase_ledger_entries` | 0 | 0 | education_bundle_purchase_escrows | 0 | transfer | required |
| `public.education_bundle_purchases` | 0 | 0 | education_bundles, education_centers, employees, users, salons | 0 | transfer | — |
| `public.education_bundles` | 0 | 0 | education_centers | 0 | transfer | — |
| `public.education_center_reviews` | 0 | 0 | education_centers, course_enrollments, users | 0 | transfer | — |
| `public.education_center_staff` | 0 | 0 | education_centers, education_instructors, users | 0 | transfer | — |
| `public.education_center_subscriptions` | 11 | 0 | education_centers, subscription_plans | 0 | transfer | — |
| `public.education_centers` | 25 | 0 | users | 0 | transfer | — |
| `public.education_contact_history` | 0 | 0 | users, education_centers, course_enrollments | 0 | transfer | required |
| `public.education_course_metric_events` | 14 | 0 | users, education_centers, courses | 0 | transfer | — |
| `public.education_course_types` | 563 | 0 | education_centers, users, education_subcategories | 0 | transfer | — |
| `public.education_custom_plan_requests` | 0 | 0 | education_centers, users | 0 | transfer | — |
| `public.education_disputes` | 1 | 0 | course_enrollments, users | 0 | transfer | — |
| `public.education_educator_absences` | 0 | 0 | education_center_staff | 0 | transfer | — |
| `public.education_educator_weekly_availability` | 0 | 0 | education_center_staff | 0 | transfer | — |
| `public.education_escrows` | 22 | 0 | education_centers, course_enrollments | 0 | transfer | — |
| `public.education_featured_charges` | 0 | 0 | users, education_centers, courses, salons | 0 | transfer | — |
| `public.education_financial_audit_log` | 16 | 0 | users | 0 | transfer | required |
| `public.education_financial_events` | 27 | 0 | users, course_enrollments, education_escrows | 0 | transfer | — |
| `public.education_gift_vouchers` | 6 | 0 | education_centers, courses, education_disputes, users, course_enrollments | 0 | transfer | — |
| `public.education_grace_notes` | 0 | 0 | users, education_centers | 0 | transfer | — |
| `public.education_inquiries` | 0 | 0 | education_centers, courses, users | 0 | transfer | — |
| `public.education_installment_settlement_commands` | 0 | 0 | users, education_installments | 0 | transfer | — |
| `public.education_installments` | 2 | 0 | education_price_snapshots, users | 0 | transfer | — |
| `public.education_instructors` | 1 | 0 | education_centers, users | 0 | transfer | — |
| `public.education_inventory_items` | 0 | 0 | education_centers, products | 0 | transfer | — |
| `public.education_inventory_movements` | 0 | 0 | users, education_centers, courses, education_inventory_items, course_sessions | 0 | transfer | — |
| `public.education_ledger_entries` | 71 | 0 | users, education_centers, course_enrollments, education_escrows | 0 | transfer | required |
| `public.education_media` | 0 | 0 | education_centers, courses | 0 | transfer | — |
| `public.education_media_uploads` | 0 | 0 | education_centers, courses | 0 | transfer | — |
| `public.education_messages` | 0 | 0 | users, education_threads | 0 | transfer | — |
| `public.education_notification_archives` | 0 | 0 | — | 0 | transfer | required |
| `public.education_notifications` | 40 | 0 | course_enrollments, users, education_waitlist | 0 | transfer | required |
| `public.education_outbox` | 7 | 0 | education_centers, education_booking_participants, course_sessions | 0 | transfer | required |
| `public.education_payment_obligations` | 6 | 0 | users, education_centers, course_enrollments, subscription_plans, salons, education_center_subscriptions | 0 | transfer | — |
| `public.education_payouts` | 3 | 0 | education_centers, users | 0 | transfer | — |
| `public.education_placement_settings` | 4 | 1 | users | 0 | compare-with-seeded-rows | — |
| `public.education_placements` | 0 | 0 | education_centers, courses, salons, course_categories, education_subcategories, users | 0 | transfer | — |
| `public.education_platform_settings` | 93 | 0 | users | 0 | transfer | — |
| `public.education_price_snapshots` | 1 | 0 | education_booking_groups, courses | 0 | transfer | — |
| `public.education_recurrence_commands` | 0 | 0 | users, education_centers | 0 | transfer | — |
| `public.education_resources` | 0 | 0 | education_centers | 0 | transfer | — |
| `public.education_salon_cleanup_reports` | 1 | 1 | — | 0 | compare-with-seeded-rows | required |
| `public.education_sections` | 6 | 0 | — | 0 | transfer | — |
| `public.education_session_educators` | 0 | 0 | users, course_sessions, education_center_staff | 0 | transfer | required |
| `public.education_session_resources` | 0 | 0 | education_resources, course_sessions | 0 | transfer | required |
| `public.education_subcategories` | 127 | 0 | course_categories | 0 | transfer | — |
| `public.education_threads` | 14 | 0 | education_centers, course_enrollments, users | 0 | transfer | — |
| `public.education_trial_claims` | 3 | 0 | education_centers, users | 0 | transfer | — |
| `public.education_waitlist` | 22 | 0 | courses, employees, users, course_sessions | 0 | transfer | required |
| `public.education_wishlists` | 0 | 0 | courses, users | 0 | transfer | — |
| `public.email_campaigns` | 0 | 0 | users | 0 | transfer | — |
| `public.email_deliveries` | 7726 | 0 | appointments, salons | 0 | transfer | required |
| `public.employee_clock_entries` | 1 | 0 | employees, salons | 0 | transfer | — |
| `public.employee_commission_settings` | 0 | 0 | employees, salons, users | 0 | transfer | — |
| `public.employee_leave_requests` | 0 | 0 | employees | 0 | transfer | — |
| `public.employee_location_assignments` | 99 | 0 | employees, salons | 0 | transfer | — |
| `public.employee_location_schedules` | 14 | 0 | employees, salons | 0 | transfer | — |
| `public.employee_ratings` | 0 | 0 | employees, salons | 0 | transfer | — |
| `public.employee_schedules` | 14 | 0 | employees | 0 | transfer | — |
| `public.employee_services` | 302 | 0 | employees, services | 0 | transfer | — |
| `public.employee_time_off` | 2 | 0 | employees, salons | 0 | transfer | — |
| `public.employees` | 93 | 0 | salons, users | 0 | transfer | — |
| `public.favorite_employees` | 1 | 0 | employees, salons, users | 0 | transfer | — |
| `public.favorites` | 1 | 0 | salons, users | 0 | transfer | — |
| `public.image_assets` | 0 | 0 | users | 0 | transfer | — |
| `public.inspiration_items` | 95 | 0 | salons, services | 0 | transfer | — |
| `public.integration_settings` | 6 | 0 | users | 0 | transfer | — |
| `public.jobseeker_profiles` | 0 | 0 | users | 0 | transfer | — |
| `public.jobseeker_salon_interests` | 0 | 0 | salons, users | 0 | transfer | — |
| `public.legal_entities` | 81 | 0 | — | 0 | transfer | — |
| `public.legal_entity_businesses` | 4 | 0 | education_centers, legal_entities, users, salons | 0 | transfer | — |
| `public.lesson_progress` | 8 | 0 | users, course_enrollments, course_lessons | 0 | transfer | — |
| `public.loyalty_point_ledger` | 0 | 0 | orders, retail_orders, salons, users | 0 | transfer | required |
| `public.loyalty_pricing_tier_product_exclusions` | 0 | 0 | products, loyalty_pricing_tiers | 0 | transfer | — |
| `public.loyalty_pricing_tiers` | 0 | 0 | — | 0 | transfer | — |
| `public.loyalty_tiers` | 4 | 0 | — | 0 | transfer | — |
| `public.media_assets` | 171 | 0 | users | 0 | transfer | — |
| `public.media_upload_tickets` | 34 | 0 | media_assets, users | 0 | transfer | — |
| `public.media_variants` | 1710 | 0 | media_assets | 0 | transfer | — |
| `public.oauth_identities` | 0 | 0 | users | 0 | transfer | — |
| `public.oauth_login_states` | 0 | 0 | users | 0 | transfer | required |
| `public.order_approval_request_lines` | 0 | 0 | product_bundles, products, order_approval_requests | 0 | transfer | — |
| `public.order_approval_requests` | 0 | 0 | shopping_carts, employees, orders, users, salons | 0 | transfer | — |
| `public.order_bundle_components` | 0 | 0 | order_items, products | 0 | transfer | — |
| `public.order_items` | 0 | 0 | orders, products | 0 | transfer | — |
| `public.order_status_history` | 0 | 0 | orders | 0 | transfer | required |
| `public.orders` | 0 | 0 | courier_services, salons | 0 | transfer | — |
| `public.package_purchase_service_links` | 12 | 0 | customer_package_purchases, services | 0 | transfer | — |
| `public.package_redemptions` | 6 | 0 | appointments, customer_package_purchases, package_purchase_service_links, users, salon_customers, salons, services | 0 | transfer | — |
| `public.package_service_links` | 6 | 0 | treatment_packages, services | 0 | transfer | — |
| `public.phone_verification_codes` | 2 | 0 | — | 0 | transfer | — |
| `public.phone_verification_proofs` | 34 | 0 | users | 0 | transfer | — |
| `public.platform_retention_settings` | 0 | 0 | users | 0 | transfer | — |
| `public.price_inquiries` | 2 | 0 | products, suppliers | 0 | transfer | — |
| `public.product_brands` | 6 | 0 | — | 0 | transfer | — |
| `public.product_bundle_components` | 12 | 0 | product_bundles, products | 0 | transfer | — |
| `public.product_bundles` | 7 | 0 | treatment_taxonomy, suppliers | 0 | transfer | — |
| `public.product_categories` | 94 | 0 | product_categories, suppliers | 0 | transfer | — |
| `public.product_documents` | 0 | 0 | media_assets, products | 0 | transfer | — |
| `public.product_reviews` | 0 | 0 | products, salons | 0 | transfer | — |
| `public.product_treatment_mappings` | 5 | 0 | products, treatment_taxonomy | 0 | transfer | — |
| `public.product_upsell_links` | 0 | 0 | products | 0 | transfer | — |
| `public.product_waitlist` | 0 | 0 | products, salons, users | 0 | transfer | required |
| `public.product_waitlist_notification_outbox` | 0 | 0 | products, salons, users, product_waitlist | 0 | transfer | required |
| `public.product_wishlists` | 0 | 0 | products, users | 0 | transfer | — |
| `public.products` | 113 | 0 | product_categories, b2c_product_types, suppliers | 0 | transfer | — |
| `public.provider_webhook_receipts` | 2 | 0 | — | 0 | transfer | required |
| `public.push_subscriptions` | 0 | 0 | users | 0 | transfer | — |
| `public.referral_attributions` | 1 | 0 | referral_codes, education_centers, salons, users | 0 | transfer | — |
| `public.referral_codes` | 50 | 0 | education_centers, salons, users | 0 | transfer | — |
| `public.referral_credit_ledger` | 7 | 0 | users, education_centers, referral_attributions, salons | 0 | transfer | required |
| `public.referral_credit_redemptions` | 0 | 0 | referral_credit_ledger, orders, retail_orders | 0 | transfer | — |
| `public.referral_milestone_benefits` | 0 | 0 | education_centers, salons, users | 0 | transfer | — |
| `public.referral_qualification_evidence` | 0 | 0 | appointments, course_enrollments, referral_qualifications | 0 | transfer | — |
| `public.referral_qualifications` | 1 | 0 | referral_attributions, education_centers, salons | 0 | transfer | — |
| `public.referral_reviews` | 1 | 0 | referral_attributions, referral_qualifications, users | 0 | transfer | — |
| `public.reorder_actions` | 0 | 0 | salons, users | 0 | transfer | — |
| `public.retail_cart_items` | 8 | 0 | product_bundles, retail_carts, products | 0 | transfer | — |
| `public.retail_carts` | 200 | 0 | users | 0 | transfer | — |
| `public.retail_order_items` | 0 | 0 | aftercare_recommendations, retail_orders, products | 0 | transfer | — |
| `public.retail_order_status_history` | 0 | 0 | retail_orders | 0 | transfer | required |
| `public.retail_orders` | 6 | 0 | retail_carts, users | 0 | transfer | — |
| `public.retail_product_review_attachments` | 0 | 0 | media_assets, retail_product_reviews | 0 | transfer | — |
| `public.retail_product_review_moderation_audits` | 0 | 0 | users, retail_product_reviews | 0 | transfer | required |
| `public.retail_product_review_reports` | 0 | 0 | users, retail_product_reviews | 0 | transfer | — |
| `public.retail_product_reviews` | 0 | 0 | retail_order_items, products, users | 1 | transfer | — |
| `public.retail_product_subscription_attempts` | 0 | 0 | retail_orders, retail_product_subscriptions | 0 | transfer | — |
| `public.retail_product_subscriptions` | 0 | 0 | products, users | 0 | transfer | — |
| `public.retail_tracking_rate_limits` | 1 | 0 | — | 0 | transfer | required |
| `public.review_invitations` | 11 | 0 | appointments, users, customer_notifications | 0 | transfer | — |
| `public.review_reward_issuances` | 2 | 0 | retail_orders | 0 | transfer | — |
| `public.reviews` | 0 | 0 | users, employees, salons | 0 | transfer | — |
| `public.rma_attachments` | 0 | 0 | media_assets, rmas | 0 | transfer | — |
| `public.rma_status_history` | 0 | 0 | users, rmas | 0 | transfer | required |
| `public.rmas` | 0 | 0 | orders, order_items, users, retail_orders, retail_order_items | 0 | transfer | — |
| `public.salon_booking_settings` | 95 | 0 | salons, users | 0 | transfer | — |
| `public.salon_brands` | 287 | 0 | product_brands, salons | 0 | transfer | — |
| `public.salon_customers` | 1509 | 0 | salons, users | 0 | transfer | — |
| `public.salon_date_hours` | 15 | 0 | salons | 0 | transfer | — |
| `public.salon_hours` | 575 | 0 | salons | 0 | transfer | — |
| `public.salon_inventory` | 11 | 0 | products, salons | 0 | transfer | — |
| `public.salon_inventory_movements` | 1 | 0 | appointments, salon_inventory, orders, products, salons, services | 0 | transfer | — |
| `public.salon_location_creation_requests` | 0 | 0 | users | 0 | transfer | — |
| `public.salon_loyalty_statuses` | 1 | 0 | salons, loyalty_tiers | 0 | transfer | — |
| `public.salon_notification_archives` | 1 | 0 | — | 0 | transfer | required |
| `public.salon_notifications` | 60 | 0 | salons | 0 | transfer | required |
| `public.salon_resource_downtime` | 0 | 0 | users, salon_resources | 0 | transfer | — |
| `public.salon_resources` | 3 | 0 | salons | 0 | transfer | — |
| `public.salons` | 95 | 0 | users | 4 | transfer | — |
| `public.saved_retail_cart_items` | 1 | 0 | product_bundles, retail_carts, products | 0 | transfer | — |
| `public.saved_shop_cart_items` | 0 | 0 | product_bundles, shopping_carts, products | 0 | transfer | — |
| `public.service_add_on_resource_requirements` | 0 | 0 | service_add_ons, salon_resources | 0 | transfer | — |
| `public.service_add_ons` | 0 | 0 | services | 0 | transfer | — |
| `public.service_categories` | 16 | 0 | — | 0 | transfer | — |
| `public.service_product_consumptions` | 0 | 0 | products, salons, services | 0 | transfer | — |
| `public.service_resource_requirements` | 2 | 0 | salon_resources, services | 0 | transfer | — |
| `public.service_templates` | 171 | 0 | — | 0 | transfer | — |
| `public.services` | 159 | 0 | service_categories, salons | 0 | transfer | — |
| `public.sessions` | 631 | 0 | users | 0 | transfer | required |
| `public.shift_swap_requests` | 0 | 0 | employees, salons | 0 | transfer | — |
| `public.shipping_rules` | 1 | 0 | — | 0 | transfer | — |
| `public.shop_settings` | 1 | 1 | — | 0 | compare-with-seeded-rows | — |
| `public.shopping_cart_items` | 3 | 0 | product_bundles, shopping_carts, products | 0 | transfer | — |
| `public.shopping_carts` | 8 | 0 | salons | 0 | transfer | — |
| `public.sms_deliveries` | 2404 | 0 | appointments, salons | 0 | transfer | required |
| `public.sms_delivery_archives` | 0 | 0 | — | 0 | transfer | required |
| `public.subscription_plans` | 7 | 3 | — | 0 | compare-with-seeded-rows | — |
| `public.subscriptions` | 10 | 0 | subscription_plans, salons | 0 | transfer | — |
| `public.suppliers` | 38 | 1 | — | 0 | compare-with-seeded-rows | — |
| `public.system_push_deliveries` | 0 | 0 | push_subscriptions, users | 0 | transfer | required |
| `public.treatment_packages` | 10 | 0 | salons | 0 | transfer | — |
| `public.treatment_photos` | 0 | 0 | appointments, employees, salon_customers, salons, users | 0 | transfer | — |
| `public.treatment_taxonomy` | 180 | 0 | — | 0 | transfer | — |
| `public.users` | 461 | 0 | — | 0 | transfer | — |

## Raw column differences

- `public.beauty_job_listings.first_published_at`: **target-only**; source `null`; target `{"name":"first_published_at","type":"timestamp with time zone","notNull":false,"default":null,"identity":"","generated":""}`.
- `public.education_b2b_orders.idempotency_key`: **target-only**; source `null`; target `{"name":"idempotency_key","type":"text","notNull":false,"default":null,"identity":"","generated":""}`.
- `public.education_b2b_orders.idempotency_fingerprint`: **target-only**; source `null`; target `{"name":"idempotency_fingerprint","type":"text","notNull":false,"default":null,"identity":"","generated":""}`.
- `public.retail_product_reviews.comment`: **default**; source `"''::text"`; target `null`.
- `public.salons.entrance_directions`: **target-only**; source `null`; target `{"name":"entrance_directions","type":"text","notNull":false,"default":null,"identity":"","generated":""}`.
- `public.salons.intercom`: **target-only**; source `null`; target `{"name":"intercom","type":"text","notNull":false,"default":null,"identity":"","generated":""}`.
- `public.salons.floor`: **target-only**; source `null`; target `{"name":"floor","type":"text","notNull":false,"default":null,"identity":"","generated":""}`.
- `public.salons.apartment`: **target-only**; source `null`; target `{"name":"apartment","type":"text","notNull":false,"default":null,"identity":"","generated":""}`.

## Business decisions — not exclusions

Every table remains included unless an owner explicitly names an exclusion. All snapshot data is demo data, so promotion/retention of *any* snapshot row is itself an owner decision for a future real move. This proof does not approve it. Specific additional decisions:
- `public.aftercare_deliveries`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.appointment_status_history`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.appointment_waitlist`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.automation_deliveries`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.b2c_recently_viewed_products`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.beauty_job_moderation_audit`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.beauty_job_notifications`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.booking_command_receipts`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.business_verification_audits`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.catalog_sync_runs`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.commerce_customer_notifications`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.course_sessions`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.customer_notifications`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.customer_password_setup_audits`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.customer_password_setup_rate_limits`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.customer_password_setup_tokens`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_b2b_discount_audits`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_bundle_purchase_ledger_entries`: Business ledger: transfer by default; do not confuse with the operational lumera_migration_ledger exception.
- `public.education_contact_history`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_financial_audit_log`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_ledger_entries`: Business ledger: transfer by default; do not confuse with the operational lumera_migration_ledger exception.
- `public.education_notification_archives`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_notifications`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_outbox`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_salon_cleanup_reports`: Migration-generated cleanup evidence differs between source and target; owner must choose preservation/provenance policy. No implicit overwrite or exclusion.
- `public.education_session_educators`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_session_resources`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.education_waitlist`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.email_deliveries`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.loyalty_point_ledger`: Business ledger: transfer by default; do not confuse with the operational lumera_migration_ledger exception.
- `public.oauth_login_states`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.order_status_history`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.product_waitlist`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.product_waitlist_notification_outbox`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.provider_webhook_receipts`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.referral_credit_ledger`: Business ledger: transfer by default; do not confuse with the operational lumera_migration_ledger exception.
- `public.retail_order_status_history`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.retail_product_review_moderation_audits`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.retail_tracking_rate_limits`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.rma_status_history`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.salon_notification_archives`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.salon_notifications`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.sessions`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.sms_deliveries`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.sms_delivery_archives`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.
- `public.system_push_deliveries`: Business retention/scope decision required (operational/session/outbox/delivery/history/audit/test-like category); this is a flag, not an exclusion.

## Target trigger inventory and prevention

The transfer engine refuses ALWAYS/REPLICA user triggers, sets transaction-local `session_replication_role=replica` for loading, then restores origin mode. Ordinary application triggers and FK triggers are suppressed; explicit FK/check/unique/exclusion validation is therefore required before commit. No application service or external delivery worker is started by the tool. Suppression does not itself decide how future workers should handle transferred pending messages; that is an owner decision.

| Table | Trigger | Function | Effect |
|---|---|---|---|
| `aftercare_recommendation_lines` | `protect_aftercare_recommendation_line_evidence` | `protect_aftercare_line_evidence` | Rejects changes to immutable aftercare recommendation-line evidence. |
| `aftercare_recommendations` | `protect_aftercare_recommendation_evidence` | `protect_aftercare_evidence` | Rejects changes to immutable aftercare recommendation evidence. |
| `b2c_promotional_banners` | `b2c_banners_validate_destination` | `validate_b2c_banner_destination` | Validates banner destination and destination-field consistency. |
| `education_bundle_purchases` | `education_bundle_purchases_payment_reference_immutable` | `reject_bundle_payment_reference_change` | Rejects changes to assigned bundle-payment references. |
| `education_centers` | `education_centers_immutable_payment_reference` | `assign_immutable_business_payment_reference` | Assigns a payment reference on insert and rejects later reference changes. |
| `education_gift_vouchers` | `education_gift_vouchers_snapshot_immutable` | `prevent_education_gift_voucher_snapshot_update` | Rejects changes to immutable gift-voucher snapshot fields. |
| `order_bundle_components` | `order_bundle_components_immutable` | `prevent_order_bundle_component_update` | Rejects changes to recorded order-bundle components. |
| `order_items` | `order_items_commercial_snapshot_immutable` | `prevent_order_item_commercial_snapshot_update` | Rejects changes to commercial order-item evidence. |
| `order_items` | `order_items_coupon_snapshot_immutable` | `prevent_coupon_order_snapshot_update` | Rejects changes to coupon order evidence. |
| `order_items` | `order_items_g2_snapshot_immutable` | `prevent_order_g2_snapshot_update` | Rejects changes to immutable B2B G2 order evidence. |
| `orders` | `orders_invoice_snapshot_immutable` | `prevent_b2b_invoice_snapshot_update` | Rejects updates to immutable B2B invoice snapshot fields. |
| `orders` | `orders_promotion_snapshot_immutable` | `prevent_order_promotion_snapshot_update` | Rejects changes to immutable order-promotion evidence. |
| `product_bundle_components` | `product_bundle_components_validate` | `validate_bundle_component` | Validates bundle-component compatibility and rejects invalid components. |
| `product_categories` | `product_categories_supplier_ownership` | `enforce_supplier_catalog_ownership` | Checks supplier ownership of catalog rows and raises on mismatch. |
| `products` | `products_enqueue_restocked_waitlist` | `enqueue_restocked_product_waitlist` | Creates product-restock waitlist outbox records when product availability changes; this is an externally deliverable side effect. |
| `products` | `products_supplier_ownership` | `enforce_supplier_catalog_ownership` | Checks supplier ownership of catalog rows and raises on mismatch. |
| `referral_attributions` | `referral_attributions_append_only` | `referral_protect_attribution_identity` | Rejects changes to attribution identity fields. |
| `referral_credit_ledger` | `referral_credit_ledger_append_only` | `referral_prevent_mutation` | Rejects updates/deletes of append-only referral ledger/redemption rows. |
| `referral_credit_redemptions` | `referral_credit_redemptions_append_only` | `referral_prevent_mutation` | Rejects updates/deletes of append-only referral ledger/redemption rows. |
| `retail_order_items` | `retail_order_items_commercial_snapshot_immutable` | `prevent_retail_order_item_commercial_snapshot_update` | Rejects changes to retail commercial order-item evidence. |
| `retail_order_items` | `retail_order_items_coupon_snapshot_immutable` | `prevent_coupon_order_snapshot_update` | Rejects changes to coupon order evidence. |
| `retail_order_items` | `retail_order_items_g2_snapshot_immutable` | `prevent_retail_g2_snapshot_update` | Rejects changes to retail G2 order evidence. |
| `retail_orders` | `retail_orders_promotion_snapshot_immutable` | `prevent_retail_order_promotion_snapshot_update` | Rejects changes to retail order-promotion evidence. |
| `salons` | `salons_immutable_payment_reference` | `assign_immutable_business_payment_reference` | Assigns a payment reference on insert and rejects later reference changes. |

## Actual target functions

| Function | Attached triggers | Definition SHA-256 | Effect |
|---|---:|---|---|
| `assign_immutable_business_payment_reference` | 2 | `1b8e175bc3d55c1d8c32953559e36462e230a4e1b21918dabf7fe11e33e286ff` | Assigns a payment reference on insert and rejects later reference changes. |
| `enforce_supplier_catalog_ownership` | 2 | `bdbf1d7664f3d2081bb1560be5f921c1776e3254169e192a0f9defe7874f75b7` | Checks supplier ownership of catalog rows and raises on mismatch. |
| `enqueue_restocked_product_waitlist` | 1 | `2012c1d211509cacd5beb7a41d835ff74b88c82a87758d28a09e547354fb044d` | Creates product-restock waitlist outbox records when product availability changes; this is an externally deliverable side effect. |
| `prevent_b2b_invoice_snapshot_update` | 1 | `2c603f86e5b774362190f45fe9ace196e33af9f34557c539ae32647859b35688` | Rejects updates to immutable B2B invoice snapshot fields. |
| `prevent_coupon_order_snapshot_update` | 2 | `11e5a70f406949ba839616ded78b35d0b95c5c1ea23e0e14b91b9c72c7145e28` | Rejects changes to coupon order evidence. |
| `prevent_education_gift_voucher_snapshot_update` | 1 | `525cc5cfabc261e3e5a07514550188e7aca4da247f3b01852e7919532cd89586` | Rejects changes to immutable gift-voucher snapshot fields. |
| `prevent_incomplete_commercial_snapshot_insert` | 0 | `6e1e3f053b275c6d15c0e4416ca4b24aa102de77baa9173d984d616ac10a425e` | Validates commercial snapshot completeness; unattached in the target. |
| `prevent_order_bundle_component_update` | 1 | `7352eef34d16ff19dd58da4773482158471ea18f878063dc98e7d850d654a4f1` | Rejects changes to recorded order-bundle components. |
| `prevent_order_g2_snapshot_update` | 1 | `6cca834c43085600c4a5d696522e058572de1378e711684546a1e478024f3abb` | Rejects changes to immutable B2B G2 order evidence. |
| `prevent_order_item_commercial_snapshot_update` | 1 | `18009c78d69f305a4747604016193e4996780030838683648c417102465e5977` | Rejects changes to commercial order-item evidence. |
| `prevent_order_promotion_snapshot_update` | 1 | `2b7bd4d32cf362dac86c2ad52d3b1dc283c641810e745ab6c078519f63c04494` | Rejects changes to immutable order-promotion evidence. |
| `prevent_retail_g2_snapshot_update` | 1 | `1a7b8420b1bc5e1253011178ef6f5900044079e62fcca6bbc407b9a90782b871` | Rejects changes to retail G2 order evidence. |
| `prevent_retail_order_item_commercial_snapshot_update` | 1 | `1bb17fb134a635f9ad2a944073e4f38f537cd753868f6da5e00b856f298d913a` | Rejects changes to retail commercial order-item evidence. |
| `prevent_retail_order_promotion_snapshot_update` | 1 | `616d8e41459c6d4d1514be1727ddd3dd737474c907f2975861dfd852d823c38f` | Rejects changes to retail order-promotion evidence. |
| `protect_aftercare_evidence` | 1 | `128e7665b4f53730fd8c35d466622bd1e4032bc8e051115c55f7861ea1d36b7c` | Rejects changes to immutable aftercare recommendation evidence. |
| `protect_aftercare_line_evidence` | 1 | `efeba76cffa5aaecf4d4647a083901299f98187dd85411a14681d06cf5c0edd5` | Rejects changes to immutable aftercare recommendation-line evidence. |
| `referral_prevent_mutation` | 2 | `4e83d6ed1dbff7266a984ed62a061f2e94c2e35cab8c0ed96f1deb3c5dcd3964` | Rejects updates/deletes of append-only referral ledger/redemption rows. |
| `referral_protect_attribution_identity` | 1 | `3b131f0d038fc72b680b8d4f4b18baf87ea86a234619645e09780056589aa56b` | Rejects changes to attribution identity fields. |
| `reject_bundle_payment_reference_change` | 1 | `92cce73d4a1c6f82b0b13f0b48488faf8fa439fcc67bf0d13e81f806dfa6c9d2` | Rejects changes to assigned bundle-payment references. |
| `validate_b2c_banner_destination` | 1 | `c4b3887d2ec11cecd32cb6c80520840017c4a0b6e8d03c13af202fb1be15c226` | Validates banner destination and destination-field consistency. |
| `validate_bundle_component` | 1 | `07b383d9426aa27f86cf5674688c085161dee36d66ba963bc20fc2e01fd8270b` | Validates bundle-component compatibility and rejects invalid components. |

## Unattached source fault-injection function

`appointment_cancel_email_fault_ba4be4fa_f647_4c52_b8f8_ef3a36b7` has zero attached triggers in the restored source and is absent from the migration-built target. Its function body matches the cancellation-email enqueue fault injection in `artifacts/api-server/src/lib/appointment-routes.test.ts:1273`, introduced in commit `fcc7ae09`. The function raises when the customer-cancellation email outbox insert occurs; it is test instrumentation, not application schema authority. The retained tracked implementation uses the unsuffixed name: the exact historical actor/run responsible for this UUID-suffixed object cannot be proved from these artifacts and is not asserted. Data transfer copies no functions or triggers.

## Data outside PostgreSQL

- **object-storage-images-and-media**: Database rows contain object paths, stable media URLs, image URLs, and media metadata whose referenced blobs live outside PostgreSQL. A future plan must inventory/copy objects and validate referential reachability separately. Code references: `artifacts/api-server/src/lib/object-storage.ts:18-39`, `artifacts/api-server/src/lib/image-storage.ts:3-60`, `artifacts/api-server/src/routes/marketplace.ts:3250-3351`, `artifacts/api-server/src/routes/marketplace.ts:4352-4373`, `lib/db/src/schema/media.ts:15-87`, `lib/db/src/schema/education.ts:596-633`.
- **externally-configured-secrets**: Provider credentials, OAuth client secrets, webhook secrets, VAPID keys, encryption/session material, and job secrets are environment/integration configuration, not row data to copy blindly. No secret value was read. Code references: `artifacts/api-server/src/lib/integrations.ts:39-92`, `artifacts/api-server/src/lib/integrations.ts:116-161`, `artifacts/api-server/src/routes/marketplace.ts:1328-1336`, `artifacts/api-server/src/routes/marketplace.ts:5280-5281`, `artifacts/api-server/src/routes/marketplace.ts:6054-6072`.
- **external-providers-and-urls**: Brevo, Infobip/SMS, Google/Facebook OAuth, Cloudflare, web push, arbitrary validated external media/video URLs, and Unsplash-backed legacy media require explicit target configuration and post-transfer validation without copying secret material. Code references: `artifacts/api-server/src/lib/brevo.ts:100-116`, `artifacts/api-server/src/lib/sms.ts:150-151`, `artifacts/api-server/src/lib/provider-events.ts:59-73`, `artifacts/api-server/src/routes/marketplace.ts:1342-1362`, `artifacts/api-server/src/routes/marketplace.ts:5355-5357`, `artifacts/api-server/src/routes/marketplace.ts:9646`, `artifacts/api-server/src/lib/media-migration.ts:64-108`.

Database object paths/URLs copy as shared column values. The tool does not fetch or copy blobs, re-sign URLs, copy credentials, send mail/SMS, or validate provider ownership. Object-storage ownership, blob migration, URL reachability and external-provider configuration need separate phase-8 approval.
