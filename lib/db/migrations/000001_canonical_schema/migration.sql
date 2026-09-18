-- lumera:migration-format 1
-- lumera:id 000001
-- lumera:mode transactional
-- lumera:description Establish the canonical Lumera schema baseline
-- lumera:min-postgres 16
-- lumera:max-postgres 16
-- lumera:precondition-sql SELECT current_setting('server_version_num')::integer >= 160000
-- lumera:postcondition-sql SELECT to_regclass('public.users') IS NOT NULL
-- lumera:recovery Transaction rollback leaves the database unchanged; resolve the SQL error before retrying
-- lumera:end-header
--
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: aftercare_delivery_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.aftercare_delivery_kind AS ENUM (
    'FIRST',
    'SECOND',
    'REPLENISHMENT'
);


--
-- Name: aftercare_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.aftercare_delivery_status AS ENUM (
    'QUEUED',
    'PROCESSING',
    'SENT',
    'FAILED',
    'SKIPPED'
);


--
-- Name: aftercare_first_timing; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.aftercare_first_timing AS ENUM (
    'IMMEDIATE_AFTER_COMPLETION',
    'NEXT_DAY'
);


--
-- Name: aftercare_line_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.aftercare_line_kind AS ENUM (
    'PRODUCT',
    'PREMADE_BUNDLE',
    'PERSONALIZED_BUNDLE'
);


--
-- Name: aftercare_recommendation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.aftercare_recommendation_status AS ENUM (
    'PENDING',
    'ACTIVE',
    'CONVERTED',
    'EXPIRED',
    'CANCELLED'
);


--
-- Name: appointment_deposit_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_deposit_status AS ENUM (
    'pending',
    'paid',
    'waived',
    'refunded',
    'forfeited'
);


--
-- Name: appointment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_status AS ENUM (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no-show'
);


--
-- Name: appointment_waitlist_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_waitlist_status AS ENUM (
    'waiting',
    'notified',
    'converted',
    'cancelled',
    'expired'
);


--
-- Name: approval_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.approval_request_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'EXPIRED'
);


--
-- Name: automation_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_action AS ENUM (
    'send_email',
    'send_sms',
    'send_email_and_sms'
);


--
-- Name: automation_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_run_status AS ENUM (
    'pending',
    'sent',
    'skipped',
    'failed'
);


--
-- Name: automation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_status AS ENUM (
    'active',
    'paused',
    'draft'
);


--
-- Name: automation_trigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_trigger AS ENUM (
    'inactive_days',
    'birthday',
    'visit_count',
    'first_visit_completed',
    'package_completed',
    'appointment_cancelled',
    'expected_return_overdue'
);


--
-- Name: b2c_banner_destination_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.b2c_banner_destination_kind AS ENUM (
    'CATEGORY',
    'PRODUCT',
    'FILTERED_LISTING',
    'CUSTOM_INTERNAL_PATH'
);


--
-- Name: b2c_banner_placement; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.b2c_banner_placement AS ENUM (
    'HERO',
    'BELOW_CATEGORIES',
    'IN_RESULTS'
);


--
-- Name: b2c_product_sort; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.b2c_product_sort AS ENUM (
    'RECOMMENDED',
    'PRICE_ASC',
    'PRICE_DESC',
    'NEWEST',
    'BEST_RATED',
    'MOST_POPULAR'
);


--
-- Name: beauty_job_contact_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_contact_status AS ENUM (
    'pending',
    'viewed',
    'accepted',
    'declined',
    'replied'
);


--
-- Name: beauty_job_listing_intent; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_listing_intent AS ENUM (
    'offering',
    'seeking'
);


--
-- Name: beauty_job_listing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_listing_status AS ENUM (
    'active',
    'expired',
    'closed',
    'rejected'
);


--
-- Name: beauty_job_listing_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_listing_type AS ENUM (
    'job',
    'equipment_rental',
    'space_rental',
    'freelance'
);


--
-- Name: beauty_job_moderation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_moderation_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: beauty_job_posted_by_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_posted_by_type AS ENUM (
    'salon',
    'user'
);


--
-- Name: beauty_job_price_period; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_price_period AS ENUM (
    'hour',
    'day',
    'week',
    'month',
    'project',
    'fixed'
);


--
-- Name: beauty_job_rental_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_rental_request_status AS ENUM (
    'pending',
    'accepted',
    'declined'
);


--
-- Name: beauty_job_report_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.beauty_job_report_status AS ENUM (
    'pending',
    'resolved',
    'dismissed'
);


--
-- Name: bundle_market; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bundle_market AS ENUM (
    'B2B',
    'B2C',
    'BOTH'
);


--
-- Name: cart_price_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cart_price_source AS ENUM (
    'FULL_PRICE',
    'SALE',
    'TIER',
    'LOYALTY_TIER_PRICE',
    'BUNDLE'
);


--
-- Name: catalog_sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.catalog_sync_status AS ENUM (
    'NOT_CONNECTED',
    'VALIDATED',
    'FAILED'
);


--
-- Name: commerce_audience; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commerce_audience AS ENUM (
    'B2B',
    'B2C'
);


--
-- Name: commission_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commission_type AS ENUM (
    'percent_of_revenue',
    'fixed_per_treatment'
);


--
-- Name: coupon_discount_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.coupon_discount_type AS ENUM (
    'PERCENTAGE',
    'FIXED_RSD'
);


--
-- Name: course_format; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.course_format AS ENUM (
    'online',
    'in-person',
    'hybrid'
);


--
-- Name: customer_retention_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_retention_status AS ENUM (
    'NEW',
    'ACTIVE',
    'VIP',
    'AT_RISK',
    'LOST'
);


--
-- Name: delivery_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.delivery_method AS ENUM (
    'courier',
    'personal_belgrade'
);


--
-- Name: education_attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_attendance_status AS ENUM (
    'present',
    'absent',
    'excused'
);


--
-- Name: education_booking_group_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_booking_group_status AS ENUM (
    'pending',
    'active',
    'waitlisted',
    'cancelled'
);


--
-- Name: education_bundle_purchase_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_bundle_purchase_status AS ENUM (
    'pending_payment',
    'settled',
    'cancelled',
    'refunded'
);


--
-- Name: education_bundle_purchase_target; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_bundle_purchase_target AS ENUM (
    'individual',
    'salon_employee'
);


--
-- Name: education_center_verification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_center_verification_status AS ENUM (
    'pending',
    'verified',
    'rejected',
    'suspended'
);


--
-- Name: education_course_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_course_level AS ENUM (
    'beginner',
    'intermediate',
    'advanced',
    'all-levels'
);


--
-- Name: education_course_type_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_course_type_status AS ENUM (
    'approved',
    'pending',
    'rejected'
);


--
-- Name: education_deposit_disposition; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_deposit_disposition AS ENUM (
    'refund',
    'forfeit',
    'transfer'
);


--
-- Name: education_dispute_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_dispute_status AS ENUM (
    'open',
    'under_review',
    'resolved_refund',
    'resolved_payout',
    'rejected',
    'cancelled'
);


--
-- Name: education_enrollment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_enrollment_status AS ENUM (
    'pending',
    'active',
    'completed',
    'cancelled'
);


--
-- Name: education_escrow_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_escrow_status AS ENUM (
    'held',
    'ready_for_payout',
    'frozen',
    'paid_out',
    'refunded',
    'partially_refunded'
);


--
-- Name: education_featured_charge_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_featured_charge_status AS ENUM (
    'pending',
    'paid',
    'cancelled',
    'refunded'
);


--
-- Name: education_gift_voucher_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_gift_voucher_status AS ENUM (
    'pending_payment',
    'active',
    'redeemed',
    'refunded',
    'cancelled'
);


--
-- Name: education_installment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_installment_status AS ENUM (
    'pending',
    'settled',
    'refunded',
    'cancelled'
);


--
-- Name: education_ledger_entry_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_ledger_entry_type AS ENUM (
    'charge',
    'platform_fee',
    'reserve_hold',
    'release',
    'payout',
    'refund',
    'adjustment'
);


--
-- Name: education_outbox_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_outbox_status AS ENUM (
    'pending',
    'processing',
    'sent',
    'failed'
);


--
-- Name: education_participant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_participant_status AS ENUM (
    'reserved',
    'waitlisted',
    'cancelled'
);


--
-- Name: education_payment_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_payment_mode AS ENUM (
    'online_full',
    'live_deposit',
    'live_off_platform'
);


--
-- Name: education_payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_payment_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded'
);


--
-- Name: education_payout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_payout_status AS ENUM (
    'pending',
    'paid',
    'cancelled'
);


--
-- Name: education_placement_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_placement_kind AS ENUM (
    'featured_salon',
    'featured_center',
    'special_offer'
);


--
-- Name: education_placement_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_placement_scope AS ENUM (
    'home',
    'category',
    'subcategory'
);


--
-- Name: education_placement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_placement_status AS ENUM (
    'pending_payment',
    'active',
    'expired',
    'cancelled',
    'rejected'
);


--
-- Name: education_review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_review_status AS ENUM (
    'pending',
    'published',
    'rejected'
);


--
-- Name: education_scheduling_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_scheduling_mode AS ENUM (
    'fixed_group',
    'individual_calendar'
);


--
-- Name: education_staff_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_staff_role AS ENUM (
    'owner_admin',
    'manager_reception',
    'educator'
);


--
-- Name: education_thread_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_thread_status AS ENUM (
    'open',
    'closed'
);


--
-- Name: education_waitlist_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education_waitlist_status AS ENUM (
    'waiting',
    'offered',
    'expired',
    'enrolled',
    'cancelled'
);


--
-- Name: email_campaign_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_campaign_status AS ENUM (
    'draft',
    'scheduled',
    'sent',
    'failed'
);


--
-- Name: email_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_delivery_status AS ENUM (
    'queued',
    'processing',
    'sent',
    'failed',
    'skipped'
);


--
-- Name: fulfillment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fulfillment_status AS ENUM (
    'RECEIVED',
    'PREPARING',
    'PACKING',
    'SHIPPED',
    'COMPLETED',
    'CANCELLED'
);


--
-- Name: image_asset_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.image_asset_status AS ENUM (
    'pending',
    'processing',
    'ready',
    'failed'
);


--
-- Name: integration_key; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_key AS ENUM (
    'sms',
    'brevo',
    'google_oauth',
    'facebook_oauth',
    'cloudflare',
    'web_push'
);


--
-- Name: leave_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.leave_request_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: loyalty_point_entry_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.loyalty_point_entry_type AS ENUM (
    'AWARD',
    'REVERSAL',
    'ADJUSTMENT'
);


--
-- Name: oauth_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.oauth_provider AS ENUM (
    'google',
    'facebook'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'confirmed',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled'
);


--
-- Name: package_payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.package_payment_method AS ENUM (
    'pay_at_salon',
    'bank_transfer'
);


--
-- Name: package_purchase_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.package_purchase_status AS ENUM (
    'pending_payment',
    'active',
    'completed',
    'expired',
    'cancelled'
);


--
-- Name: package_redemption_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.package_redemption_status AS ENUM (
    'redeemed',
    'reversed'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'CARD',
    'BANK_TRANSFER',
    'CASH_AT_SALON',
    'CASH_ON_DELIVERY',
    'FREE'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'pending',
    'paid',
    'refunded',
    'failed'
);


--
-- Name: price_inquiry_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.price_inquiry_status AS ENUM (
    'NEW',
    'CONTACTED',
    'CLOSED'
);


--
-- Name: product_waitlist_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_waitlist_status AS ENUM (
    'ACTIVE',
    'NOTIFIED',
    'UNSUBSCRIBED'
);


--
-- Name: referral_attribution_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_attribution_status AS ENUM (
    'attributed',
    'rejected',
    'under_review',
    'expired'
);


--
-- Name: referral_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_channel AS ENUM (
    'A',
    'B1',
    'B2',
    'C',
    'D'
);


--
-- Name: referral_credit_entry_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_credit_entry_type AS ENUM (
    'held',
    'available',
    'redeemed',
    'expired',
    'reversed',
    'negative_offset',
    'restored'
);


--
-- Name: referral_milestone_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_milestone_kind AS ENUM (
    'salon_subscription_reduction',
    'education_commission_reduction'
);


--
-- Name: referral_qualification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_qualification_status AS ENUM (
    'pending_verification',
    'tracking',
    'qualified',
    'held',
    'available',
    'reversed',
    'rejected'
);


--
-- Name: referral_review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_review_status AS ENUM (
    'open',
    'approved',
    'rejected',
    'dismissed'
);


--
-- Name: referral_wallet_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_wallet_kind AS ENUM (
    'B2B',
    'B2C'
);


--
-- Name: retail_review_moderation_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retail_review_moderation_action AS ENUM (
    'KEEP',
    'DISMISS_REPORTS',
    'REMOVE',
    'RESTORE'
);


--
-- Name: retail_review_moderation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retail_review_moderation_status AS ENUM (
    'PUBLISHED',
    'REPORTED',
    'AUTO_FLAGGED',
    'REMOVED'
);


--
-- Name: retail_review_report_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retail_review_report_reason AS ENUM (
    'SPAM',
    'ABUSE',
    'HATE',
    'PERSONAL_INFORMATION',
    'MISLEADING',
    'OTHER'
);


--
-- Name: retail_subscription_attempt_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retail_subscription_attempt_status AS ENUM (
    'PROCESSING',
    'CREATED',
    'INSUFFICIENT_STOCK',
    'SKIPPED'
);


--
-- Name: retail_subscription_frequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retail_subscription_frequency AS ENUM (
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'EVERY_TWO_MONTHS'
);


--
-- Name: retail_subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retail_subscription_status AS ENUM (
    'ACTIVE',
    'PAUSED',
    'CANCELLED'
);


--
-- Name: rma_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rma_status AS ENUM (
    'RECEIVED',
    'IN_REVIEW',
    'APPROVED',
    'REJECTED'
);


--
-- Name: salon_inventory_movement_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.salon_inventory_movement_type AS ENUM (
    'purchase',
    'consumption',
    'adjustment'
);


--
-- Name: salon_resource_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.salon_resource_type AS ENUM (
    'chair',
    'booth',
    'bed',
    'room',
    'equipment',
    'other'
);


--
-- Name: shift_swap_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shift_swap_status AS ENUM (
    'pending_colleague',
    'colleague_declined',
    'pending_owner',
    'owner_declined',
    'approved',
    'cancelled'
);


--
-- Name: similar_products_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.similar_products_mode AS ENUM (
    'AUTO_CATEGORY',
    'MANUAL'
);


--
-- Name: sms_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sms_delivery_status AS ENUM (
    'queued',
    'processing',
    'sent',
    'failed',
    'skipped'
);


--
-- Name: sms_message_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sms_message_type AS ENUM (
    'appointment_confirmation',
    'appointment_reminder',
    'education_session_reminder',
    'education_waitlist_offer',
    'education_session_cancelled',
    'automation',
    'retail_order',
    'referral',
    'admin_alert'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'trial',
    'active',
    'past_due',
    'cancelled',
    'suspended',
    'free_via_loyalty'
);


--
-- Name: supplier_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.supplier_scope AS ENUM (
    'B2B',
    'B2C',
    'BOTH'
);


--
-- Name: system_push_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.system_push_delivery_status AS ENUM (
    'queued',
    'processing',
    'sent',
    'failed'
);


--
-- Name: treatment_photo_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.treatment_photo_kind AS ENUM (
    'before',
    'after'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'SUPER_ADMIN',
    'ADMIN',
    'SALON_OWNER',
    'SALON_EMPLOYEE',
    'EDUCATION_CENTER_OWNER',
    'INSTRUCTOR',
    'CUSTOMER',
    'STUDENT',
    'JOBSEEKER',
    'EDUKATIVNI_CENTAR'
);


--
-- Name: assign_immutable_business_payment_reference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_immutable_business_payment_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF TG_OP = 'INSERT' AND NEW.payment_reference_number IS NULL THEN
          NEW.payment_reference_number := CASE WHEN TG_TABLE_NAME = 'salons'
            THEN 'SAL' || replace(NEW.id::text, '-', '')
            ELSE 'EDU' || replace(NEW.id::text, '-', '') END;
        ELSIF TG_OP = 'UPDATE' AND NEW.payment_reference_number IS DISTINCT FROM OLD.payment_reference_number THEN
          RAISE EXCEPTION 'payment_reference_number is immutable';
        END IF;
        RETURN NEW;
      END;
    $$;


--
-- Name: enforce_supplier_catalog_ownership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_supplier_catalog_ownership() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE parent_supplier uuid; category_supplier uuid; supplier_scope_value "public".supplier_scope;
      BEGIN
        IF TG_TABLE_NAME = 'product_categories' THEN
          IF NEW.parent_id IS NOT NULL THEN
            SELECT supplier_id INTO parent_supplier FROM "public".product_categories WHERE id = NEW.parent_id;
            IF parent_supplier IS NULL OR parent_supplier <> NEW.supplier_id THEN
              RAISE EXCEPTION 'Category parent must belong to the same supplier';
            END IF;
            IF NEW.id IS NOT NULL AND NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Category cannot be its own parent'; END IF;
            IF NEW.id IS NOT NULL AND EXISTS (
              WITH RECURSIVE ancestors AS (
                SELECT id, parent_id FROM "public".product_categories WHERE id = NEW.parent_id
                UNION
                SELECT category.id, category.parent_id FROM "public".product_categories category
                JOIN ancestors ON category.id = ancestors.parent_id
              ) SELECT 1 FROM ancestors WHERE id = NEW.id
            ) THEN RAISE EXCEPTION 'Category parent would create a cycle'; END IF;
          END IF;
        ELSE
          SELECT supplier_id INTO category_supplier FROM "public".product_categories WHERE id = NEW.category_id;
          IF NEW.category_id IS NOT NULL AND (category_supplier IS NULL OR category_supplier <> NEW.supplier_id) THEN
            RAISE EXCEPTION 'Product category must belong to the same supplier';
          END IF;
          SELECT scope INTO supplier_scope_value FROM "public".suppliers
          WHERE id = NEW.supplier_id
          FOR SHARE;
          IF supplier_scope_value IS NULL
             OR (NEW.retail_enabled AND supplier_scope_value NOT IN ('B2C', 'BOTH'))
             OR (NEW.professional_enabled AND supplier_scope_value NOT IN ('B2B', 'BOTH')) THEN
            RAISE EXCEPTION 'Product sales channels are not permitted by supplier scope';
          END IF;
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: enqueue_restocked_product_waitlist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_restocked_product_waitlist() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF OLD.stock = 0 AND NEW.stock > 0 THEN
           INSERT INTO "public".product_waitlist_notification_outbox
             (waitlist_id, audience, salon_id, user_id, product_id)
           SELECT id, audience, salon_id, user_id, product_id
             FROM "public".product_waitlist
             WHERE product_id = NEW.id AND status = 'ACTIVE'
           ON CONFLICT (waitlist_id) DO NOTHING;
           UPDATE "public".product_waitlist waiter SET status = 'NOTIFIED',
             notified_at = now(), updated_at = now()
             WHERE waiter.product_id = NEW.id AND waiter.status = 'ACTIVE'
               AND EXISTS (SELECT 1 FROM "public".product_waitlist_notification_outbox outbox
                 WHERE outbox.waitlist_id = waiter.id);
         END IF;
         RETURN NEW;
       END $$;


--
-- Name: prevent_b2b_invoice_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_b2b_invoice_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
        IF OLD.invoice_issued_at IS NOT NULL AND (
          NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.invoice_issued_at IS DISTINCT FROM OLD.invoice_issued_at
          OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.coupon_code_snapshot IS DISTINCT FROM OLD.coupon_code_snapshot
          OR NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd OR NEW.coupon_free_shipping IS DISTINCT FROM OLD.coupon_free_shipping
        ) THEN RAISE EXCEPTION 'Finalized B2B invoice snapshot is immutable'; END IF;
        RETURN NEW;
      END $$;


--
-- Name: prevent_coupon_order_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_coupon_order_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
        IF NEW.coupon_discount_rsd IS DISTINCT FROM OLD.coupon_discount_rsd THEN
          RAISE EXCEPTION 'Order coupon allocation is immutable';
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: prevent_education_gift_voucher_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_education_gift_voucher_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.center_id IS DISTINCT FROM OLD.center_id
           OR NEW.purchaser_id IS DISTINCT FROM OLD.purchaser_id OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
           OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.recipient_name_snapshot IS DISTINCT FROM OLD.recipient_name_snapshot
           OR NEW.gift_message_snapshot IS DISTINCT FROM OLD.gift_message_snapshot
           OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot
           OR NEW.course_image_url_snapshot IS DISTINCT FROM OLD.course_image_url_snapshot
           OR NEW.amount_snapshot IS DISTINCT FROM OLD.amount_snapshot OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
           OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.code_last4 IS DISTINCT FROM OLD.code_last4
           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
           RAISE EXCEPTION 'Education gift voucher purchase snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$;


--
-- Name: prevent_incomplete_commercial_snapshot_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_incomplete_commercial_snapshot_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF current_setting('lumera.snapshot_backfill', true) = 'on' THEN RETURN NEW; END IF;
         IF NEW.supplier_id IS NULL OR NEW.supplier_name IS NULL OR NEW.supplier_slug IS NULL
           OR (NEW.product_id IS NOT NULL AND NEW.product_catalog_reference IS NULL)
           OR NEW.unit_price IS NULL OR NEW.line_subtotal IS NULL OR NEW.line_total IS NULL THEN
           RAISE EXCEPTION 'Commercial order-item snapshot is required during migration';
         END IF;
         RETURN NEW;
       END $$;


--
-- Name: prevent_order_bundle_component_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_order_bundle_component_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
         RAISE EXCEPTION 'Order bundle component snapshot is immutable';
       END $$;


--
-- Name: prevent_order_g2_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_order_g2_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN
          RAISE EXCEPTION 'Order G2 promotion allocations are immutable';
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: prevent_order_item_commercial_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_order_item_commercial_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.product_name IS DISTINCT FROM OLD.product_name
           OR NEW.product_sku IS DISTINCT FROM OLD.product_sku
           OR NEW.price IS DISTINCT FROM OLD.price
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
           OR NEW.line_total IS DISTINCT FROM OLD.line_total
           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd
           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price
           OR NEW.price_source IS DISTINCT FROM OLD.price_source
           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount
           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot
           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
           RAISE EXCEPTION 'Order item commercial snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$;


--
-- Name: prevent_order_promotion_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_order_promotion_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN
          RAISE EXCEPTION 'Order promotion snapshot is immutable';
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: prevent_retail_g2_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_retail_g2_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
          OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd THEN
          RAISE EXCEPTION 'Retail G2 promotion allocations are immutable';
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: prevent_retail_order_item_commercial_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_retail_order_item_commercial_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.product_name IS DISTINCT FROM OLD.product_name
           OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url
           OR NEW.product_catalog_reference IS DISTINCT FROM OLD.product_catalog_reference
           OR NEW.variant_value IS DISTINCT FROM OLD.variant_value
           OR NEW.variant_label IS DISTINCT FROM OLD.variant_label
           OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
           OR NEW.supplier_slug IS DISTINCT FROM OLD.supplier_slug
           OR NEW.product_sku_snapshot IS DISTINCT FROM OLD.product_sku_snapshot
           OR NEW.market IS DISTINCT FROM OLD.market OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.discount_snapshot IS DISTINCT FROM OLD.discount_snapshot
           OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal
           OR NEW.line_total IS DISTINCT FROM OLD.line_total
           OR NEW.automatic_promotion_discount_rsd IS DISTINCT FROM OLD.automatic_promotion_discount_rsd
           OR NEW.threshold_reward_discount_rsd IS DISTINCT FROM OLD.threshold_reward_discount_rsd
           OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
           OR NEW.base_unit_price IS DISTINCT FROM OLD.base_unit_price
           OR NEW.effective_unit_price IS DISTINCT FROM OLD.effective_unit_price
           OR NEW.price_source IS DISTINCT FROM OLD.price_source
           OR NEW.line_discount IS DISTINCT FROM OLD.line_discount
           OR NEW.bundle_name_snapshot IS DISTINCT FROM OLD.bundle_name_snapshot
           OR NEW.bundle_components_snapshot IS DISTINCT FROM OLD.bundle_components_snapshot
           OR NEW.estimated_delivery_date IS DISTINCT FROM OLD.estimated_delivery_date
           OR NEW.unit_cost_price_rsd IS DISTINCT FROM OLD.unit_cost_price_rsd
           OR NEW.line_cogs_rsd IS DISTINCT FROM OLD.line_cogs_rsd
           OR NEW.referral_discount_rsd IS DISTINCT FROM OLD.referral_discount_rsd
           OR NEW.realized_revenue_rsd IS DISTINCT FROM OLD.realized_revenue_rsd
           OR NEW.personalized_treatment_bundle_discount_rsd IS DISTINCT FROM OLD.personalized_treatment_bundle_discount_rsd
           OR NEW.post_treatment_recommendation_discount_rsd IS DISTINCT FROM OLD.post_treatment_recommendation_discount_rsd
           OR NEW.aftercare_recommendation_id IS DISTINCT FROM OLD.aftercare_recommendation_id
           OR NEW.category_id_snapshot IS DISTINCT FROM OLD.category_id_snapshot
           OR NEW.category_name_snapshot IS DISTINCT FROM OLD.category_name_snapshot
           OR NEW.brand_snapshot IS DISTINCT FROM OLD.brand_snapshot
           OR NEW.is_reward_gift IS DISTINCT FROM OLD.is_reward_gift
           OR NEW.reward_snapshot IS DISTINCT FROM OLD.reward_snapshot THEN
           RAISE EXCEPTION 'Order item commercial snapshot is immutable';
         END IF;
         RETURN NEW;
       END $$;


--
-- Name: prevent_retail_order_promotion_snapshot_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_retail_order_promotion_snapshot_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.promotion_snapshot IS DISTINCT FROM OLD.promotion_snapshot THEN
          RAISE EXCEPTION 'Retail order promotion snapshot is immutable';
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: protect_aftercare_evidence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_aftercare_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
      IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id OR NEW.settings_version IS DISTINCT FROM OLD.settings_version
        OR NEW.entitlement_token_hash IS DISTINCT FROM OLD.entitlement_token_hash OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
        OR NEW.treatment_snapshot IS DISTINCT FROM OLD.treatment_snapshot OR NEW.window_started_at IS DISTINCT FROM OLD.window_started_at
        OR NEW.window_ends_at IS DISTINCT FROM OLD.window_ends_at OR NEW.activates_at IS DISTINCT FROM OLD.activates_at
        OR NEW.entitlement_expires_at IS DISTINCT FROM OLD.entitlement_expires_at THEN
        RAISE EXCEPTION 'aftercare recommendation evidence is immutable';
      END IF; RETURN NEW; END $$;


--
-- Name: protect_aftercare_line_evidence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_aftercare_line_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
      IF NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
        OR NEW.treatment_ids IS DISTINCT FROM OLD.treatment_ids OR NEW.covered_product_ids IS DISTINCT FROM OLD.covered_product_ids
        OR NEW.catalog_snapshot IS DISTINCT FROM OLD.catalog_snapshot OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot
        OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent
        OR NEW.discount_allocation_snapshot IS DISTINCT FROM OLD.discount_allocation_snapshot THEN
        RAISE EXCEPTION 'aftercare recommendation line evidence is immutable';
      END IF; RETURN NEW; END $$;


--
-- Name: referral_prevent_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_prevent_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Referral financial and attribution records are append-only'; END $$;


--
-- Name: referral_protect_attribution_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_protect_attribution_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF TG_OP = 'DELETE'
          OR NEW.id IS DISTINCT FROM OLD.id
          OR NEW.referral_code_id IS DISTINCT FROM OLD.referral_code_id
          OR NEW.channel IS DISTINCT FROM OLD.channel
          OR NEW.referrer_user_id IS DISTINCT FROM OLD.referrer_user_id
          OR NEW.referred_user_id IS DISTINCT FROM OLD.referred_user_id
          OR NEW.referred_salon_id IS DISTINCT FROM OLD.referred_salon_id
          OR NEW.referred_education_center_id IS DISTINCT FROM OLD.referred_education_center_id
          OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
          OR NEW.locked_until IS DISTINCT FROM OLD.locked_until
          OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
          OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'Referral attribution identity is immutable';
        END IF;
        RETURN NEW;
      END $$;


--
-- Name: reject_bundle_payment_reference_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_bundle_payment_reference_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN
          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';
        END IF;
        RETURN NEW;
      END
    $$;


--
-- Name: validate_b2c_banner_destination(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_b2c_banner_destination() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.destination_category_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "public".product_categories c WHERE c.id=NEW.destination_category_id
            AND c.supplier_id=NEW.supplier_id FOR KEY SHARE
        ) THEN RAISE EXCEPTION 'Banner category destination must belong to supplier'; END IF;
        IF NEW.destination_product_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "public".products p WHERE p.id=NEW.destination_product_id
            AND p.supplier_id=NEW.supplier_id AND p.retail_enabled=true FOR KEY SHARE
        ) THEN RAISE EXCEPTION 'Banner product destination must belong to supplier'; END IF;
        RETURN NEW;
      END $$;


--
-- Name: validate_bundle_component(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_bundle_component() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       DECLARE component_supplier uuid; component_variants jsonb; bundle_supplier uuid;
       BEGIN
         SELECT supplier_id, variants INTO component_supplier, component_variants
           FROM "public".products WHERE id = NEW.product_id FOR KEY SHARE;
         SELECT supplier_id INTO bundle_supplier
           FROM "public".product_bundles WHERE id = NEW.bundle_id FOR KEY SHARE;
         IF component_supplier IS DISTINCT FROM bundle_supplier THEN
           RAISE EXCEPTION 'Bundle components must belong to the bundle supplier';
         END IF;
         IF component_variants IS NOT NULL AND jsonb_array_length(component_variants) > 0 THEN
           RAISE EXCEPTION 'Bundle components with variants are not supported';
         END IF;
         RETURN NEW;
       END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: aftercare_completion_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aftercare_completion_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    customer_user_id uuid,
    transition_key text NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    claim_token text,
    claim_expires_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aftercare_completion_events_attempts_check CHECK ((attempts >= 0))
);


--
-- Name: aftercare_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aftercare_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recommendation_id uuid NOT NULL,
    line_id uuid,
    kind public.aftercare_delivery_kind NOT NULL,
    status public.aftercare_delivery_status DEFAULT 'QUEUED'::public.aftercare_delivery_status NOT NULL,
    event_key text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    claim_token text,
    claim_expires_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    provider_message_id text,
    provider_status text,
    provider_event_at timestamp with time zone,
    accepted_at timestamp with time zone,
    sent_at timestamp with time zone,
    failed_at timestamp with time zone,
    last_error text,
    payload_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aftercare_deliveries_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT aftercare_deliveries_replenishment_line_check CHECK (((kind <> 'REPLENISHMENT'::public.aftercare_delivery_kind) OR (line_id IS NOT NULL)))
);


--
-- Name: aftercare_recommendation_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aftercare_recommendation_appointments (
    recommendation_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    treatment_id uuid NOT NULL,
    appointment_snapshot jsonb NOT NULL
);


--
-- Name: aftercare_recommendation_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aftercare_recommendation_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recommendation_id uuid NOT NULL,
    kind public.aftercare_line_kind NOT NULL,
    product_id uuid,
    bundle_id uuid,
    treatment_ids jsonb NOT NULL,
    covered_product_ids jsonb NOT NULL,
    catalog_snapshot jsonb NOT NULL,
    pricing_snapshot jsonb NOT NULL,
    discount_kind text NOT NULL,
    discount_percent integer NOT NULL,
    discount_allocation_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    replenishment_due_at timestamp with time zone,
    replenishment_sent_at timestamp with time zone,
    purchased_at timestamp with time zone,
    purchased_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aftercare_recommendation_lines_coverage_check CHECK (((jsonb_array_length(treatment_ids) > 0) AND (jsonb_array_length(covered_product_ids) > 0))),
    CONSTRAINT aftercare_recommendation_lines_discount_check CHECK (((discount_percent >= 0) AND (discount_percent <= 100))),
    CONSTRAINT aftercare_recommendation_lines_shape_check CHECK ((((kind = 'PRODUCT'::public.aftercare_line_kind) AND (product_id IS NOT NULL) AND (bundle_id IS NULL)) OR ((kind = 'PREMADE_BUNDLE'::public.aftercare_line_kind) AND (product_id IS NULL) AND (bundle_id IS NOT NULL)) OR ((kind = 'PERSONALIZED_BUNDLE'::public.aftercare_line_kind) AND (product_id IS NULL) AND (bundle_id IS NULL))))
);


--
-- Name: aftercare_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aftercare_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_user_id uuid NOT NULL,
    settings_version integer NOT NULL,
    status public.aftercare_recommendation_status DEFAULT 'PENDING'::public.aftercare_recommendation_status NOT NULL,
    entitlement_token_hash text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    window_ends_at timestamp with time zone NOT NULL,
    activates_at timestamp with time zone NOT NULL,
    entitlement_expires_at timestamp with time zone NOT NULL,
    settings_snapshot jsonb NOT NULL,
    treatment_snapshot jsonb NOT NULL,
    read_at timestamp with time zone,
    first_sent_at timestamp with time zone,
    second_sent_at timestamp with time zone,
    converted_at timestamp with time zone,
    converted_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aftercare_recommendations_window_check CHECK (((window_ends_at > window_started_at) AND (entitlement_expires_at > activates_at)))
);


--
-- Name: aftercare_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aftercare_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    first_timing public.aftercare_first_timing DEFAULT 'IMMEDIATE_AFTER_COMPLETION'::public.aftercare_first_timing NOT NULL,
    cooldown_days integer DEFAULT 30 NOT NULL,
    second_reminder_delay_days integer DEFAULT 6 NOT NULL,
    post_treatment_discount_enabled boolean DEFAULT false NOT NULL,
    post_treatment_discount_percent integer DEFAULT 0 NOT NULL,
    post_treatment_discount_validity_days integer DEFAULT 30 NOT NULL,
    personalized_bundle_discount_percent integer DEFAULT 10 NOT NULL,
    combination_window_days integer DEFAULT 30 NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aftercare_settings_discount_enabled_check CHECK (((NOT post_treatment_discount_enabled) OR (post_treatment_discount_percent > 0))),
    CONSTRAINT aftercare_settings_percent_check CHECK ((((post_treatment_discount_percent >= 0) AND (post_treatment_discount_percent <= 100)) AND ((personalized_bundle_discount_percent >= 1) AND (personalized_bundle_discount_percent <= 100)))),
    CONSTRAINT aftercare_settings_positive_days_check CHECK (((cooldown_days > 0) AND (second_reminder_delay_days > 0) AND (post_treatment_discount_validity_days > 0) AND (combination_window_days > 0)))
);


--
-- Name: appointment_add_ons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_add_ons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    add_on_id uuid,
    name text NOT NULL,
    duration_minutes integer NOT NULL,
    price integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appointment_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    amount integer NOT NULL,
    status public.appointment_deposit_status DEFAULT 'pending'::public.appointment_deposit_status NOT NULL,
    settled_at timestamp with time zone,
    settled_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_deposits_amount_check CHECK ((amount >= 0))
);


--
-- Name: appointment_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appointment_resource_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_resource_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_resource_allocations_quantity_positive CHECK ((quantity >= 1))
);


--
-- Name: appointment_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    salon_customer_id uuid,
    service_id uuid NOT NULL,
    employee_id uuid,
    total_appointments integer NOT NULL,
    recurrence_frequency text,
    recurrence_interval integer,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appointment_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    status public.appointment_status NOT NULL,
    action text,
    changed_by_user_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appointment_treatments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_treatments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    service_id uuid NOT NULL,
    employee_id uuid,
    "position" integer NOT NULL,
    duration_minutes integer NOT NULL,
    buffer_minutes integer DEFAULT 0 NOT NULL,
    price integer NOT NULL,
    planned_start_time text,
    planned_end_time text,
    actual_started_at timestamp with time zone,
    actual_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_treatments_duration_check CHECK (((duration_minutes > 0) AND (buffer_minutes >= 0))),
    CONSTRAINT appointment_treatments_position_check CHECK (("position" >= 0))
);


--
-- Name: appointment_waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    service_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    employee_id uuid,
    desired_date date NOT NULL,
    earliest_time text DEFAULT '00:00'::text NOT NULL,
    latest_time text DEFAULT '23:59'::text NOT NULL,
    status public.appointment_waitlist_status DEFAULT 'waiting'::public.appointment_waitlist_status NOT NULL,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_waitlist_window_check CHECK ((earliest_time < latest_time))
);


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    customer_id uuid,
    salon_customer_id uuid,
    employee_id uuid,
    service_id uuid NOT NULL,
    series_id uuid,
    booking_group_id uuid,
    appointment_date date NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    duration_minutes integer NOT NULL,
    pre_processing_minutes integer DEFAULT 0 NOT NULL,
    processing_minutes integer DEFAULT 0 NOT NULL,
    post_processing_minutes integer DEFAULT 0 NOT NULL,
    buffer_minutes integer DEFAULT 0 NOT NULL,
    seat_count integer DEFAULT 1 NOT NULL,
    price integer NOT NULL,
    treatment_location text DEFAULT 'salon'::text NOT NULL,
    travel_fee integer DEFAULT 0 NOT NULL,
    treatment_address_line_1 text,
    treatment_address_city text,
    treatment_address_postal_code text,
    treatment_address_details text,
    status public.appointment_status DEFAULT 'pending'::public.appointment_status NOT NULL,
    notes text,
    cancellation_reason text,
    planned_date date,
    planned_start_time text,
    planned_end_time text,
    arrived_at timestamp with time zone,
    arrived_by_user_id uuid,
    actual_started_at timestamp with time zone,
    started_by_user_id uuid,
    actual_completed_at timestamp with time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    completed_at timestamp with time zone,
    completed_by_user_id uuid,
    no_show_at timestamp with time zone,
    no_show_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointments_buffer_minutes_check CHECK ((buffer_minutes >= 0)),
    CONSTRAINT appointments_seat_count_check CHECK ((seat_count >= 1)),
    CONSTRAINT appointments_segments_check CHECK (((pre_processing_minutes >= 0) AND (processing_minutes >= 0) AND (post_processing_minutes >= 0) AND (((pre_processing_minutes = 0) AND (processing_minutes = 0) AND (post_processing_minutes = 0)) OR (((pre_processing_minutes + processing_minutes) + post_processing_minutes) = duration_minutes))))
);


--
-- Name: automatic_xy_promotion_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automatic_xy_promotion_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid NOT NULL,
    target_role text NOT NULL,
    product_id uuid,
    category_id uuid,
    CONSTRAINT automatic_xy_targets_one_target_check CHECK ((num_nonnulls(product_id, category_id) = 1)),
    CONSTRAINT automatic_xy_targets_role_check CHECK ((target_role = ANY (ARRAY['BUY'::text, 'REWARD'::text])))
);


--
-- Name: automatic_xy_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automatic_xy_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    market text NOT NULL,
    buy_quantity integer NOT NULL,
    reward_quantity integer NOT NULL,
    reward_percent integer NOT NULL,
    per_order_reward_unit_cap integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automatic_xy_promotions_market_check CHECK ((market = ANY (ARRAY['B2B'::text, 'B2C'::text, 'BOTH'::text]))),
    CONSTRAINT automatic_xy_promotions_quantities_check CHECK (((buy_quantity > 0) AND (reward_quantity > 0) AND ((reward_percent >= 1) AND (reward_percent <= 100)) AND ((per_order_reward_unit_cap IS NULL) OR (per_order_reward_unit_cap > 0)))),
    CONSTRAINT automatic_xy_promotions_schedule_check CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT automatic_xy_promotions_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text]))),
    CONSTRAINT automatic_xy_promotions_version_check CHECK ((version >= 1))
);


--
-- Name: automation_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    event_key text NOT NULL,
    channel text NOT NULL,
    recipient_email text,
    recipient_phone text,
    status text DEFAULT 'queued'::text NOT NULL,
    processing_started_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    provider_message_id text,
    error_message text,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    failed_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    name text NOT NULL,
    trigger public.automation_trigger NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    action public.automation_action NOT NULL,
    email_subject text,
    email_body text,
    sms_body text,
    voucher_code text,
    status public.automation_status DEFAULT 'draft'::public.automation_status NOT NULL,
    ai_proposed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    rule_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    salon_customer_id uuid NOT NULL,
    status public.automation_run_status DEFAULT 'pending'::public.automation_run_status NOT NULL,
    skip_reason text,
    error_message text,
    attributed_appointment_id uuid,
    executed_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: b2b_cart_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2b_cart_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    cart_id uuid,
    idempotency_key text NOT NULL,
    content_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: b2b_invoice_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2b_invoice_sequences (
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2b_invoice_sequences_number_check CHECK ((last_number >= 0))
);


--
-- Name: b2b_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2b_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    public_id text NOT NULL,
    salon_id uuid NOT NULL,
    source_cart_id uuid,
    customer_company_name text,
    seller_snapshot jsonb NOT NULL,
    item_snapshots jsonb NOT NULL,
    subtotal_without_vat integer NOT NULL,
    vat_amount integer NOT NULL,
    total_with_vat integer NOT NULL,
    currency text DEFAULT 'RSD'::text NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2b_quotes_totals_check CHECK (((subtotal_without_vat >= 0) AND (vat_amount >= 0) AND (total_with_vat = (subtotal_without_vat + vat_amount))))
);


--
-- Name: b2c_display_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2c_display_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    default_sort public.b2c_product_sort DEFAULT 'RECOMMENDED'::public.b2c_product_sort NOT NULL,
    enabled_sort_options jsonb DEFAULT '["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "NEWEST", "BEST_RATED", "MOST_POPULAR"]'::jsonb NOT NULL,
    page_size integer DEFAULT 24 NOT NULL,
    show_out_of_stock boolean DEFAULT true NOT NULL,
    recently_viewed_enabled boolean DEFAULT true NOT NULL,
    recently_viewed_max integer DEFAULT 12 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2c_display_settings_values_check CHECK ((((page_size >= 1) AND (page_size <= 100)) AND ((recently_viewed_max >= 1) AND (recently_viewed_max <= 100)) AND (version >= 1) AND (jsonb_typeof(enabled_sort_options) = 'array'::text)))
);


--
-- Name: b2c_need_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2c_need_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2c_need_tags_key_check CHECK ((key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)),
    CONSTRAINT b2c_need_tags_version_check CHECK ((version >= 1))
);


--
-- Name: b2c_product_need_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2c_product_need_tags (
    product_id uuid NOT NULL,
    need_tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: b2c_product_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2c_product_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2c_product_types_slug_check CHECK ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)),
    CONSTRAINT b2c_product_types_version_check CHECK ((version >= 1))
);


--
-- Name: b2c_promotional_banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2c_promotional_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    internal_name text NOT NULL,
    supplier_id uuid NOT NULL,
    desktop_image_url text NOT NULL,
    mobile_image_url text,
    headline text NOT NULL,
    text text,
    cta_label text,
    destination_kind public.b2c_banner_destination_kind NOT NULL,
    destination_category_id uuid,
    destination_product_id uuid,
    filtered_listing jsonb,
    custom_internal_path text,
    placement public.b2c_banner_placement NOT NULL,
    active boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2c_banners_destination_check CHECK ((((destination_kind = 'CATEGORY'::public.b2c_banner_destination_kind) AND (num_nonnulls(destination_category_id, destination_product_id, filtered_listing, custom_internal_path) = 1) AND (destination_category_id IS NOT NULL)) OR ((destination_kind = 'PRODUCT'::public.b2c_banner_destination_kind) AND (num_nonnulls(destination_category_id, destination_product_id, filtered_listing, custom_internal_path) = 1) AND (destination_product_id IS NOT NULL)) OR ((destination_kind = 'FILTERED_LISTING'::public.b2c_banner_destination_kind) AND (num_nonnulls(destination_category_id, destination_product_id, filtered_listing, custom_internal_path) = 1) AND (filtered_listing IS NOT NULL)) OR ((destination_kind = 'CUSTOM_INTERNAL_PATH'::public.b2c_banner_destination_kind) AND (num_nonnulls(destination_category_id, destination_product_id, filtered_listing, custom_internal_path) = 1) AND (custom_internal_path IS NOT NULL)))),
    CONSTRAINT b2c_banners_internal_path_check CHECK (((custom_internal_path IS NULL) OR ((custom_internal_path ~~ '/%'::text) AND (custom_internal_path !~~ '//%'::text)))),
    CONSTRAINT b2c_banners_version_check CHECK ((version >= 1)),
    CONSTRAINT b2c_banners_window_check CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (starts_at < ends_at)))
);


--
-- Name: b2c_recently_viewed_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.b2c_recently_viewed_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    viewer_token_hash text,
    user_id uuid,
    product_id uuid NOT NULL,
    last_viewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT b2c_recent_views_one_owner_check CHECK ((num_nonnulls(viewer_token_hash, user_id) = 1))
);


--
-- Name: beauty_glossary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_glossary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    term text NOT NULL,
    slug text NOT NULL,
    definition text NOT NULL,
    category text NOT NULL
);


--
-- Name: beauty_job_application_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_application_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    from_status public.beauty_job_contact_status NOT NULL,
    to_status public.beauty_job_contact_status NOT NULL,
    private_note text,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    subtype_labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    feature_flag text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    applicant_user_id uuid NOT NULL,
    applicant_message text NOT NULL,
    applicant_status public.beauty_job_contact_status DEFAULT 'pending'::public.beauty_job_contact_status NOT NULL,
    author_reply text,
    author_status public.beauty_job_contact_status DEFAULT 'pending'::public.beauty_job_contact_status NOT NULL,
    rejection_note text,
    decision_actor_user_id uuid,
    decision_at timestamp with time zone,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_listing_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_listing_availability (
    listing_id uuid NOT NULL,
    availability_pattern text NOT NULL,
    day_labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    salon_id uuid,
    user_id uuid,
    posted_by_type public.beauty_job_posted_by_type NOT NULL,
    type public.beauty_job_listing_type NOT NULL,
    intent public.beauty_job_listing_intent DEFAULT 'offering'::public.beauty_job_listing_intent NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    city text NOT NULL,
    region text NOT NULL,
    latitude double precision,
    longitude double precision,
    price_amount integer,
    price_period public.beauty_job_price_period,
    negotiable boolean DEFAULT false NOT NULL,
    is_urgent boolean DEFAULT false NOT NULL,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    cover_image_description text,
    is_test boolean DEFAULT false NOT NULL,
    status public.beauty_job_listing_status DEFAULT 'active'::public.beauty_job_listing_status NOT NULL,
    moderation_status public.beauty_job_moderation_status DEFAULT 'pending'::public.beauty_job_moderation_status NOT NULL,
    moderation_reason text,
    moderation_internal_note text,
    moderated_at timestamp with time zone,
    contact_count integer DEFAULT 0 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beauty_job_listings_coordinates_pair CHECK (((latitude IS NULL) = (longitude IS NULL))),
    CONSTRAINT beauty_job_listings_exactly_one_author CHECK (((((salon_id IS NOT NULL))::integer + ((user_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT beauty_job_listings_posted_by_matches_author CHECK ((((posted_by_type = 'salon'::public.beauty_job_posted_by_type) AND (salon_id IS NOT NULL) AND (user_id IS NULL)) OR ((posted_by_type = 'user'::public.beauty_job_posted_by_type) AND (user_id IS NOT NULL) AND (salon_id IS NULL)))),
    CONSTRAINT beauty_job_listings_price_nonnegative CHECK (((price_amount IS NULL) OR (price_amount >= 0))),
    CONSTRAINT beauty_job_listings_urgent_only_freelance CHECK (((NOT is_urgent) OR (type = 'freelance'::public.beauty_job_listing_type)))
);


--
-- Name: beauty_job_moderation_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_moderation_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    acting_admin_user_id uuid,
    action text NOT NULL,
    public_reason text,
    internal_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_user_id uuid NOT NULL,
    listing_id uuid,
    contact_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_platform_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_expiry_days integer DEFAULT 30 NOT NULL,
    hourly_posting_limit integer DEFAULT 5 NOT NULL,
    updated_by_user_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beauty_job_platform_settings_expiry_positive CHECK ((listing_expiry_days > 0)),
    CONSTRAINT beauty_job_platform_settings_limit_positive CHECK ((hourly_posting_limit > 0))
);


--
-- Name: beauty_job_rental_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_rental_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    applicant_user_id uuid NOT NULL,
    message text,
    status public.beauty_job_rental_request_status DEFAULT 'pending'::public.beauty_job_rental_request_status NOT NULL,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_rental_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_rental_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beauty_job_rental_slots_positive_duration CHECK ((ends_at > starts_at))
);


--
-- Name: beauty_job_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    reporter_user_id uuid,
    reason text NOT NULL,
    status public.beauty_job_report_status DEFAULT 'pending'::public.beauty_job_report_status NOT NULL,
    resolved_by_user_id uuid,
    resolution_note text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beauty_job_saved_listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beauty_job_saved_listings (
    user_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_command_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_command_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    idempotency_key text NOT NULL,
    command_type text NOT NULL,
    payload_fingerprint text NOT NULL,
    response_status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    customer_id uuid,
    salon_customer_id uuid,
    created_by_user_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bulk_sale_campaign_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bulk_sale_campaign_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    product_id uuid,
    category_id uuid,
    CONSTRAINT bulk_sale_campaign_targets_one_target_check CHECK ((num_nonnulls(product_id, category_id) = 1))
);


--
-- Name: bulk_sale_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bulk_sale_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    market text NOT NULL,
    discount_type text NOT NULL,
    discount_value integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bulk_sale_campaigns_market_check CHECK ((market = ANY (ARRAY['B2B'::text, 'B2C'::text, 'BOTH'::text]))),
    CONSTRAINT bulk_sale_campaigns_schedule_check CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT bulk_sale_campaigns_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text]))),
    CONSTRAINT bulk_sale_campaigns_type_check CHECK ((discount_type = ANY (ARRAY['PERCENT'::text, 'FIXED_RSD'::text]))),
    CONSTRAINT bulk_sale_campaigns_value_check CHECK ((discount_value > 0)),
    CONSTRAINT bulk_sale_campaigns_version_check CHECK ((version >= 1))
);


--
-- Name: business_growth_schema_rollout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_growth_schema_rollout (
    singleton boolean DEFAULT true NOT NULL,
    version integer NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_growth_schema_rollout_singleton_check CHECK ((singleton = true))
);


--
-- Name: business_verification_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_verification_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_entity_business_id uuid NOT NULL,
    previous_status text,
    next_status text NOT NULL,
    reason text,
    actor_user_id uuid,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cart_threshold_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_threshold_rewards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    market text NOT NULL,
    spend_threshold_rsd integer NOT NULL,
    reward_kind text NOT NULL,
    discount_percent integer,
    gift_product_id uuid,
    gift_quantity integer,
    active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cart_threshold_rewards_kind_check CHECK ((reward_kind = ANY (ARRAY['FREE_SHIPPING'::text, 'GIFT_PRODUCT'::text, 'PERCENT_DISCOUNT'::text]))),
    CONSTRAINT cart_threshold_rewards_market_check CHECK ((market = ANY (ARRAY['B2B'::text, 'B2C'::text, 'BOTH'::text]))),
    CONSTRAINT cart_threshold_rewards_shape_check CHECK ((((reward_kind = 'FREE_SHIPPING'::text) AND (discount_percent IS NULL) AND (gift_product_id IS NULL) AND (gift_quantity IS NULL)) OR ((reward_kind = 'PERCENT_DISCOUNT'::text) AND ((discount_percent >= 1) AND (discount_percent <= 100)) AND (gift_product_id IS NULL) AND (gift_quantity IS NULL)) OR ((reward_kind = 'GIFT_PRODUCT'::text) AND (gift_product_id IS NOT NULL) AND (gift_quantity > 0) AND (discount_percent IS NULL)))),
    CONSTRAINT cart_threshold_rewards_threshold_check CHECK ((spend_threshold_rsd >= 0)),
    CONSTRAINT cart_threshold_rewards_version_check CHECK ((version >= 1))
);


--
-- Name: catalog_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'META'::text NOT NULL,
    status public.catalog_sync_status DEFAULT 'NOT_CONNECTED'::public.catalog_sync_status NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    validation_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commerce_customer_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commerce_customer_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    waitlist_id uuid,
    title text NOT NULL,
    message text NOT NULL,
    href text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commerce_experience_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commerce_experience_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    header_enabled boolean DEFAULT false NOT NULL,
    header_messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    header_interval_seconds integer DEFAULT 5 NOT NULL,
    smart_search_mode text DEFAULT 'AUTOMATIC'::text NOT NULL,
    smart_search_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    bestseller_period_days integer DEFAULT 30 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by_user_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commerce_experience_settings_values_check CHECK ((((header_interval_seconds >= 2) AND (header_interval_seconds <= 60)) AND (smart_search_mode = ANY (ARRAY['AUTOMATIC'::text, 'MANUAL'::text])) AND (jsonb_array_length(smart_search_product_ids) <= 5) AND (bestseller_period_days = ANY (ARRAY[30, 60])) AND (version >= 1)))
);


--
-- Name: coupon_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coupon_id uuid NOT NULL,
    audience public.commerce_audience NOT NULL,
    order_id uuid,
    retail_order_id uuid,
    salon_id uuid,
    user_id uuid,
    guest_email_normalized text,
    code_snapshot text NOT NULL,
    discount_rsd integer DEFAULT 0 NOT NULL,
    free_shipping boolean DEFAULT false NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupon_redemptions_customer_check CHECK ((num_nonnulls(salon_id, user_id, guest_email_normalized) = 1)),
    CONSTRAINT coupon_redemptions_order_check CHECK ((num_nonnulls(order_id, retail_order_id) = 1))
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    audience public.commerce_audience,
    discount_type public.coupon_discount_type NOT NULL,
    discount_value integer NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    minimum_spend_rsd integer DEFAULT 0 NOT NULL,
    maximum_spend_rsd integer,
    free_shipping boolean DEFAULT false NOT NULL,
    include_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclude_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    include_category_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclude_category_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    include_bundle_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclude_bundle_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    usage_limit integer,
    per_customer_usage_limit integer,
    usage_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupons_dates_check CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT coupons_discount_check CHECK ((((discount_type = 'PERCENTAGE'::public.coupon_discount_type) AND ((discount_value >= 1) AND (discount_value <= 100))) OR ((discount_type = 'FIXED_RSD'::public.coupon_discount_type) AND (discount_value > 0)))),
    CONSTRAINT coupons_limits_check CHECK ((((usage_limit IS NULL) OR (usage_limit > 0)) AND ((per_customer_usage_limit IS NULL) OR (per_customer_usage_limit > 0)))),
    CONSTRAINT coupons_spend_check CHECK (((minimum_spend_rsd >= 0) AND ((maximum_spend_rsd IS NULL) OR (maximum_spend_rsd >= minimum_spend_rsd))))
);


--
-- Name: courier_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courier_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    tracking_url_template text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: course_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    section_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: course_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    day_number integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    duration_minutes integer,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: course_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    user_id uuid,
    salon_id uuid,
    employee_id uuid,
    session_id uuid,
    purchaser_id uuid NOT NULL,
    status public.education_enrollment_status DEFAULT 'pending'::public.education_enrollment_status NOT NULL,
    payment_status public.education_payment_status DEFAULT 'pending'::public.education_payment_status NOT NULL,
    charged_amount integer,
    progress integer DEFAULT 0 NOT NULL,
    next_lesson text,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL,
    access_granted_at timestamp with time zone,
    access_expires_at timestamp with time zone,
    access_days_snapshot integer,
    course_price_snapshot integer,
    duration_snapshot text,
    extension_prices_snapshot jsonb,
    digital_content_consent_at timestamp with time zone,
    digital_content_consent_user_id uuid,
    digital_content_consent_text_snapshot text,
    digital_content_consent_version_snapshot text,
    completed_at timestamp with time zone,
    certificate_issued_at timestamp with time zone,
    certificate_number text,
    certificate_path text,
    audit_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text,
    idempotency_fingerprint text,
    payment_instructions_snapshot jsonb,
    bundle_purchase_id uuid,
    booking_group_id uuid,
    participant_id uuid,
    participant_key text GENERATED ALWAYS AS (COALESCE((employee_id)::text, '00000000-0000-0000-0000-000000000000'::text)) STORED,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_enrollments_access_snapshot_check CHECK (((access_days_snapshot IS NULL) OR (access_days_snapshot > 0))),
    CONSTRAINT course_enrollments_digital_consent_snapshot_check CHECK ((((digital_content_consent_at IS NULL) AND (digital_content_consent_user_id IS NULL) AND (digital_content_consent_text_snapshot IS NULL) AND (digital_content_consent_version_snapshot IS NULL)) OR ((digital_content_consent_at IS NOT NULL) AND (digital_content_consent_user_id IS NOT NULL) AND (length(btrim(digital_content_consent_text_snapshot)) > 0) AND (length(btrim(digital_content_consent_version_snapshot)) > 0)))),
    CONSTRAINT course_enrollments_operational_user_check CHECK (((user_id IS NOT NULL) OR (participant_id IS NOT NULL)))
);


--
-- Name: course_lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_lessons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: course_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: course_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    enrollment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    status public.education_review_status DEFAULT 'pending'::public.education_review_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: course_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    location text,
    capacity integer DEFAULT 20 NOT NULL,
    reserved_seats integer DEFAULT 0 NOT NULL,
    minimum_enrollments integer,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid,
    salon_id uuid,
    instructor_id uuid,
    instructor_profile_id uuid,
    category_id uuid,
    subcategory_id uuid,
    course_type_id uuid,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category text NOT NULL,
    format public.course_format NOT NULL,
    city text,
    price integer NOT NULL,
    duration text NOT NULL,
    duration_minutes integer,
    theory_hours integer,
    practical_hours integer,
    level public.education_course_level DEFAULT 'all-levels'::public.education_course_level NOT NULL,
    learning_outcomes jsonb DEFAULT '[]'::jsonb NOT NULL,
    included_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    requirements text DEFAULT ''::text NOT NULL,
    rating integer DEFAULT 0 NOT NULL,
    certification boolean DEFAULT false NOT NULL,
    certificate_name text,
    accredited boolean DEFAULT false NOT NULL,
    language text DEFAULT 'Srpski'::text,
    trailer_url text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    faq jsonb DEFAULT '[]'::jsonb NOT NULL,
    payment_mode public.education_payment_mode DEFAULT 'online_full'::public.education_payment_mode NOT NULL,
    deposit_amount integer,
    image_url text NOT NULL,
    cover_image_description text,
    is_test boolean DEFAULT false NOT NULL,
    published boolean DEFAULT true NOT NULL,
    subscription_suspended boolean DEFAULT false NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    featured_until timestamp with time zone,
    featured_activated_at timestamp with time zone,
    featured_fee integer DEFAULT 0 NOT NULL,
    refund_policy text DEFAULT 'Povraćaj je moguć do isteka roka zaštite kupovine. Ako centar otkaže termin, kupovina se refundira u celosti.'::text NOT NULL,
    gift_voucher_eligible boolean DEFAULT false NOT NULL,
    group_discount_minimum integer,
    group_discount_percent integer,
    scheduling_mode public.education_scheduling_mode DEFAULT 'fixed_group'::public.education_scheduling_mode NOT NULL,
    operational_time_zone text DEFAULT 'Europe/Belgrade'::text NOT NULL,
    cancellation_deadline_hours integer DEFAULT 0 NOT NULL,
    deposit_disposition public.education_deposit_disposition DEFAULT 'refund'::public.education_deposit_disposition NOT NULL,
    minimum_enrollment_risk_deadline timestamp with time zone,
    early_bird_price integer,
    early_bird_cutoff timestamp with time zone,
    installment_count integer DEFAULT 1 NOT NULL,
    start_date date,
    end_date date,
    online_access_days integer,
    extension_price_1_month integer,
    extension_price_3_months integer,
    extension_price_6_months integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT courses_cancellation_deadline_check CHECK (((cancellation_deadline_hours >= 0) AND (cancellation_deadline_hours <= 8760))),
    CONSTRAINT courses_deposit_amount_nonnegative_check CHECK (((deposit_amount IS NULL) OR (deposit_amount >= 0))),
    CONSTRAINT courses_duration_minutes_check CHECK (((duration_minutes IS NULL) OR (duration_minutes > 0))),
    CONSTRAINT courses_early_bird_check CHECK ((((early_bird_price IS NULL) AND (early_bird_cutoff IS NULL)) OR ((early_bird_price >= 0) AND (early_bird_price <= price) AND (early_bird_cutoff IS NOT NULL)))),
    CONSTRAINT courses_extension_prices_check CHECK ((((extension_price_1_month IS NULL) OR (extension_price_1_month >= 0)) AND ((extension_price_3_months IS NULL) OR (extension_price_3_months >= 0)) AND ((extension_price_6_months IS NULL) OR (extension_price_6_months >= 0)))),
    CONSTRAINT courses_installment_count_check CHECK ((installment_count = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT courses_live_deposit_check CHECK (((payment_mode <> 'live_deposit'::public.education_payment_mode) OR ((format = ANY (ARRAY['in-person'::public.course_format, 'hybrid'::public.course_format])) AND (deposit_amount > 0)))),
    CONSTRAINT courses_live_off_platform_check CHECK (((payment_mode <> 'live_off_platform'::public.education_payment_mode) OR (format = ANY (ARRAY['in-person'::public.course_format, 'hybrid'::public.course_format])))),
    CONSTRAINT courses_non_deposit_amount_check CHECK (((payment_mode = 'live_deposit'::public.education_payment_mode) OR (deposit_amount IS NULL))),
    CONSTRAINT courses_online_access_check CHECK (((format <> 'online'::public.course_format) OR (online_access_days > 0))),
    CONSTRAINT courses_operational_timezone_check CHECK ((operational_time_zone = 'Europe/Belgrade'::text)),
    CONSTRAINT courses_practical_hours_nonnegative_check CHECK (((practical_hours IS NULL) OR (practical_hours >= 0))),
    CONSTRAINT courses_published_live_deposit_refund_policy_check CHECK (((NOT (published AND (payment_mode = 'live_deposit'::public.education_payment_mode))) OR (length(btrim(refund_policy)) > 0))),
    CONSTRAINT courses_theory_hours_nonnegative_check CHECK (((theory_hours IS NULL) OR (theory_hours >= 0)))
);


--
-- Name: customer_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    user_id uuid NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    deep_link text,
    read_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_package_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_package_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    package_id uuid NOT NULL,
    salon_customer_id uuid NOT NULL,
    total_sessions integer NOT NULL,
    remaining_sessions integer NOT NULL,
    quota_policy text DEFAULT 'shared_pool'::text NOT NULL,
    price_in_dinars integer NOT NULL,
    payment_method public.package_payment_method DEFAULT 'pay_at_salon'::public.package_payment_method NOT NULL,
    status public.package_purchase_status DEFAULT 'pending_payment'::public.package_purchase_status NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    payment_confirmed_at timestamp with time zone,
    payment_confirmed_by_user_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_password_setup_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_password_setup_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    administrator_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_password_setup_audits_action_check CHECK ((action = ANY (ARRAY['CUSTOMER_CREATED'::text, 'PASSWORD_SET'::text])))
);


--
-- Name: customer_password_setup_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_password_setup_rate_limits (
    key_hash text NOT NULL,
    action text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    request_count integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_password_setup_rate_limits_count_check CHECK ((request_count > 0))
);


--
-- Name: customer_password_setup_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_password_setup_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    issued_by_user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    invalidated_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_password_setup_tokens_attempts_check CHECK (((failed_attempts >= 0) AND ((max_attempts >= 1) AND (max_attempts <= 10))))
);


--
-- Name: education_access_extensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_access_extensions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    purchaser_id uuid NOT NULL,
    months integer NOT NULL,
    amount integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    previous_access_expires_at timestamp with time zone NOT NULL,
    extended_access_expires_at timestamp with time zone NOT NULL,
    payment_obligation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT education_access_extensions_amount_check CHECK ((amount >= 0)),
    CONSTRAINT education_access_extensions_months_check CHECK ((months = ANY (ARRAY[1, 3, 6]))),
    CONSTRAINT education_access_extensions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'settled'::text, 'cancelled'::text])))
);


--
-- Name: education_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    status public.education_attendance_status NOT NULL,
    recorded_by_user_id uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_b2b_discount_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_b2b_discount_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    actor_user_id uuid,
    tiers_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_b2b_discount_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_b2b_discount_settings (
    id boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by_user_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_b2b_discount_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_b2b_discount_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    min_spend_rsd integer NOT NULL,
    max_spend_rsd integer,
    discount_percent integer NOT NULL,
    sort_order integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_b2b_discount_tiers_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 100))),
    CONSTRAINT education_b2b_discount_tiers_range_check CHECK (((min_spend_rsd >= 0) AND ((max_spend_rsd IS NULL) OR (max_spend_rsd >= min_spend_rsd))))
);


--
-- Name: education_b2b_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_b2b_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price_rsd integer NOT NULL,
    line_total_rsd integer NOT NULL
);


--
-- Name: education_b2b_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_b2b_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    purchaser_user_id uuid NOT NULL,
    lines_snapshot jsonb NOT NULL,
    subtotal_rsd integer NOT NULL,
    discount_rsd integer NOT NULL,
    total_rsd integer NOT NULL,
    benefit_snapshot jsonb NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    fulfillment_status text DEFAULT 'RECEIVED'::text NOT NULL,
    completed_at timestamp with time zone,
    refunded_amount_rsd integer DEFAULT 0 NOT NULL,
    settled_by_user_id uuid,
    settled_at timestamp with time zone,
    idempotency_key text,
    idempotency_fingerprint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_b2b_orders_fulfillment_status_check CHECK ((fulfillment_status = ANY (ARRAY['RECEIVED'::text, 'PREPARING'::text, 'PACKING'::text, 'SHIPPED'::text, 'COMPLETED'::text, 'CANCELLED'::text]))),
    CONSTRAINT education_b2b_orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text, 'cancelled'::text]))),
    CONSTRAINT education_b2b_orders_refund_check CHECK (((refunded_amount_rsd >= 0) AND (refunded_amount_rsd <= total_rsd)))
);


--
-- Name: education_bank_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bank_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_item_id text NOT NULL,
    normalized_reference text NOT NULL,
    normalized_amount integer NOT NULL,
    result text NOT NULL,
    rejection_reason text,
    obligation_id uuid,
    received_at timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_bank_transactions_amount_check CHECK ((normalized_amount > 0)),
    CONSTRAINT education_bank_transactions_decision_check CHECK ((((result = 'processing'::text) AND (obligation_id IS NULL) AND (rejection_reason IS NULL) AND (processed_at IS NULL)) OR ((result = 'settled'::text) AND (obligation_id IS NOT NULL) AND (rejection_reason IS NULL) AND (processed_at IS NOT NULL)) OR ((result = 'rejected'::text) AND (length(btrim(rejection_reason)) > 0) AND (processed_at IS NOT NULL)))),
    CONSTRAINT education_bank_transactions_reference_check CHECK ((length(btrim(normalized_reference)) > 0)),
    CONSTRAINT education_bank_transactions_result_check CHECK ((result = ANY (ARRAY['processing'::text, 'settled'::text, 'rejected'::text]))),
    CONSTRAINT education_bank_transactions_source_check CHECK (((length(btrim(source)) > 0) AND (length(btrim(source_item_id)) > 0)))
);


--
-- Name: education_booking_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_booking_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    course_id uuid NOT NULL,
    session_id uuid,
    purchaser_id uuid,
    created_by_user_id uuid,
    status public.education_booking_group_status DEFAULT 'pending'::public.education_booking_group_status NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_booking_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_booking_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_group_id uuid NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    email text,
    phone text,
    status public.education_participant_status DEFAULT 'reserved'::public.education_participant_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_booking_participants_contact_check CHECK (((user_id IS NOT NULL) OR (email IS NOT NULL) OR (phone IS NOT NULL)))
);


--
-- Name: education_bundle_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bundle_courses (
    bundle_id uuid NOT NULL,
    course_id uuid NOT NULL,
    sort_order integer NOT NULL
);


--
-- Name: education_bundle_purchase_escrows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bundle_purchase_escrows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    center_id uuid NOT NULL,
    gross_amount integer NOT NULL,
    platform_fee_amount integer DEFAULT 0 NOT NULL,
    reserve_amount integer DEFAULT 0 NOT NULL,
    net_amount integer NOT NULL,
    status public.education_escrow_status DEFAULT 'held'::public.education_escrow_status NOT NULL,
    release_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_bundle_purchase_escrows_amounts_check CHECK (((gross_amount >= 0) AND (platform_fee_amount >= 0) AND (reserve_amount >= 0) AND (net_amount >= 0) AND ((platform_fee_amount + reserve_amount) <= gross_amount) AND (net_amount = ((gross_amount - platform_fee_amount) - reserve_amount))))
);


--
-- Name: education_bundle_purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bundle_purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    course_id uuid NOT NULL,
    course_title text NOT NULL,
    course_terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_bundle_purchase_ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bundle_purchase_ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    escrow_id uuid NOT NULL,
    entry_type public.education_ledger_entry_type NOT NULL,
    amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: education_bundle_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bundle_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bundle_id uuid NOT NULL,
    center_id uuid NOT NULL,
    purchaser_id uuid NOT NULL,
    target_type public.education_bundle_purchase_target NOT NULL,
    learner_user_id uuid,
    salon_id uuid,
    employee_id uuid,
    amount integer NOT NULL,
    currency text DEFAULT 'RSD'::text NOT NULL,
    status public.education_bundle_purchase_status DEFAULT 'pending_payment'::public.education_bundle_purchase_status NOT NULL,
    payment_method public.payment_method,
    payment_reference text NOT NULL,
    payment_instructions jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    idempotency_fingerprint text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    settled_by_user_id uuid,
    cancelled_at timestamp with time zone,
    refunded_at timestamp with time zone,
    audit_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_bundle_purchases_amount_check CHECK ((amount >= 0)),
    CONSTRAINT education_bundle_purchases_payment_reference_snapshot_check CHECK ((((payment_instructions ->> 'reference'::text) IS NOT NULL) AND ((payment_instructions ->> 'reference'::text) = payment_reference))),
    CONSTRAINT education_bundle_purchases_target_check CHECK ((((target_type = 'individual'::public.education_bundle_purchase_target) AND (learner_user_id IS NOT NULL) AND (salon_id IS NULL) AND (employee_id IS NULL)) OR ((target_type = 'salon_employee'::public.education_bundle_purchase_target) AND (learner_user_id IS NOT NULL) AND (salon_id IS NOT NULL) AND (employee_id IS NOT NULL))))
);


--
-- Name: education_bundles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_bundles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    price integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_bundles_price_check CHECK ((price >= 0))
);


--
-- Name: education_center_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_center_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    enrollment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    status public.education_review_status DEFAULT 'pending'::public.education_review_status NOT NULL,
    admin_note text,
    moderated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_center_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: education_center_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_center_staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    user_id uuid NOT NULL,
    instructor_profile_id uuid,
    role public.education_staff_role NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_center_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_center_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    status public.subscription_status DEFAULT 'trial'::public.subscription_status NOT NULL,
    due_amount integer DEFAULT 0 NOT NULL,
    payment_method public.payment_method DEFAULT 'BANK_TRANSFER'::public.payment_method NOT NULL,
    billing_cycle text DEFAULT 'monthly'::text NOT NULL,
    payment_reference text,
    paid_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    trial_started_at timestamp with time zone,
    trial_ends_at timestamp with time zone,
    grace_ends_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    auto_renew boolean DEFAULT true NOT NULL,
    contract_kind text DEFAULT 'standard'::text NOT NULL,
    contract_ends_at timestamp with time zone,
    course_limit_override integer,
    current_price_snapshot integer,
    current_course_limit_snapshot integer,
    pending_plan_id uuid,
    pending_billing_cycle text,
    pending_plan_effective_at timestamp with time zone,
    pending_keep_course_ids jsonb,
    grace_extension_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_center_subscriptions_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))),
    CONSTRAINT education_center_subscriptions_contract_kind_check CHECK ((contract_kind = ANY (ARRAY['standard'::text, 'custom'::text]))),
    CONSTRAINT education_center_subscriptions_course_limit_override_check CHECK (((course_limit_override IS NULL) OR (course_limit_override >= 0))),
    CONSTRAINT education_center_subscriptions_current_course_limit_check CHECK (((current_course_limit_snapshot IS NULL) OR (current_course_limit_snapshot >= 0))),
    CONSTRAINT education_center_subscriptions_pending_billing_cycle_check CHECK (((pending_billing_cycle IS NULL) OR (pending_billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))))
);


--
-- Name: education_centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_centers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    city text NOT NULL,
    description text NOT NULL,
    image_url text NOT NULL,
    contact_email text,
    contact_phone text,
    contact_address text,
    pib text,
    registration_number text,
    website_url text,
    instagram_url text,
    payment_reference_number text,
    legal_entity_type text DEFAULT 'legal_entity'::text NOT NULL,
    bank_account text,
    bank_account_environment text DEFAULT 'production'::text NOT NULL,
    commission_percent_override integer,
    reserve_percent_override integer,
    online_refund_days_override integer,
    live_appeal_days_override integer,
    featured_course_price_override integer,
    verification_status public.education_center_verification_status DEFAULT 'pending'::public.education_center_verification_status NOT NULL,
    verification_note text,
    verified_at timestamp with time zone,
    verified_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_centers_bank_account_check CHECK (((bank_account IS NULL) OR (bank_account ~ '^[0-9]{18}$'::text))),
    CONSTRAINT education_centers_bank_account_environment_check CHECK ((bank_account_environment = ANY (ARRAY['production'::text, 'test'::text]))),
    CONSTRAINT education_centers_commission_override_check CHECK (((commission_percent_override >= 0) AND (commission_percent_override <= 100))),
    CONSTRAINT education_centers_featured_price_override_check CHECK ((featured_course_price_override >= 0)),
    CONSTRAINT education_centers_legal_entity_type_check CHECK ((legal_entity_type = ANY (ARRAY['individual'::text, 'legal_entity'::text]))),
    CONSTRAINT education_centers_live_appeal_override_check CHECK (((live_appeal_days_override >= 0) AND (live_appeal_days_override <= 365))),
    CONSTRAINT education_centers_online_refund_override_check CHECK (((online_refund_days_override >= 0) AND (online_refund_days_override <= 365))),
    CONSTRAINT education_centers_reserve_override_check CHECK (((reserve_percent_override >= 0) AND (reserve_percent_override <= 100)))
);


--
-- Name: education_contact_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_contact_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    learner_user_id uuid,
    enrollment_id uuid,
    channel text NOT NULL,
    note text NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_course_metric_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_course_metric_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    center_id uuid NOT NULL,
    actor_user_id uuid,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    dedupe_key text,
    CONSTRAINT education_course_metric_events_type_check CHECK ((event_type = ANY (ARRAY['view'::text, 'inquiry'::text])))
);


--
-- Name: education_course_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_course_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subcategory_id uuid NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    status public.education_course_type_status DEFAULT 'pending'::public.education_course_type_status NOT NULL,
    proposed_by_center_id uuid,
    reviewed_by_user_id uuid,
    review_note text,
    reviewed_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_custom_plan_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_custom_plan_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    requested_course_limit integer NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_by_user_id uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_custom_plan_requests_limit_check CHECK ((requested_course_limit > 0)),
    CONSTRAINT education_custom_plan_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: education_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    opened_by_user_id uuid NOT NULL,
    reason text NOT NULL,
    details text NOT NULL,
    status public.education_dispute_status DEFAULT 'open'::public.education_dispute_status NOT NULL,
    resolution_note text,
    resolved_by_user_id uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_educator_absences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_educator_absences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    start_time text,
    end_time text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_educator_absences_date_check CHECK ((end_date >= start_date)),
    CONSTRAINT education_educator_absences_time_check CHECK ((((start_time IS NULL) AND (end_time IS NULL)) OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (start_time < end_time))))
);


--
-- Name: education_educator_weekly_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_educator_weekly_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_educator_weekly_availability_interval_check CHECK ((start_time < end_time)),
    CONSTRAINT education_educator_weekly_availability_weekday_check CHECK (((weekday >= 1) AND (weekday <= 7)))
);


--
-- Name: education_escrows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_escrows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    center_id uuid NOT NULL,
    gross_amount integer NOT NULL,
    platform_fee integer NOT NULL,
    reserve_amount integer NOT NULL,
    net_amount integer NOT NULL,
    release_at timestamp with time zone NOT NULL,
    status public.education_escrow_status DEFAULT 'held'::public.education_escrow_status NOT NULL,
    payment_reference text,
    frozen_at timestamp with time zone,
    released_at timestamp with time zone,
    net_paid_at timestamp with time zone,
    reserve_paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_featured_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_featured_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    center_id uuid,
    salon_id uuid,
    amount integer NOT NULL,
    status public.education_featured_charge_status DEFAULT 'pending'::public.education_featured_charge_status NOT NULL,
    payment_method public.payment_method DEFAULT 'BANK_TRANSFER'::public.payment_method NOT NULL,
    payment_reference text,
    activated_by_user_id uuid,
    settled_by_user_id uuid,
    note text,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_financial_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_financial_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    reason text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    time_zone text DEFAULT 'Europe/Belgrade'::text NOT NULL,
    CONSTRAINT education_financial_audit_timezone_check CHECK ((time_zone = 'Europe/Belgrade'::text))
);


--
-- Name: education_financial_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_financial_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    escrow_id uuid,
    enrollment_id uuid,
    actor_user_id uuid,
    event_type text NOT NULL,
    previous_status text,
    next_status text,
    amount integer,
    note text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_gift_vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_gift_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    center_id uuid NOT NULL,
    purchaser_id uuid NOT NULL,
    recipient_user_id uuid,
    recipient_email text,
    recipient_name_snapshot text,
    gift_message_snapshot text,
    course_title_snapshot text NOT NULL,
    course_image_url_snapshot text NOT NULL,
    amount_snapshot integer NOT NULL,
    currency_snapshot text DEFAULT 'RSD'::text NOT NULL,
    code_hash text NOT NULL,
    code_last4 text NOT NULL,
    status public.education_gift_voucher_status DEFAULT 'pending_payment'::public.education_gift_voucher_status NOT NULL,
    payment_reference text NOT NULL,
    idempotency_key text,
    settled_by_user_id uuid,
    settled_at timestamp with time zone,
    redeemed_by_user_id uuid,
    redeemed_enrollment_id uuid,
    redeemed_at timestamp with time zone,
    refunded_by_user_id uuid,
    refunded_at timestamp with time zone,
    refund_note text,
    dispute_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_gift_vouchers_amount_check CHECK ((amount_snapshot >= 0)),
    CONSTRAINT education_gift_vouchers_recipient_check CHECK ((num_nonnulls(recipient_user_id, recipient_email) >= 1))
);


--
-- Name: education_grace_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_grace_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    author_user_id uuid NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    user_id uuid NOT NULL,
    center_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_installment_settlement_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_installment_settlement_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installment_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    response_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_installment_settlement_command_fingerprint_check CHECK ((length(request_fingerprint) = 64)),
    CONSTRAINT education_installment_settlement_command_key_check CHECK ((length(btrim(idempotency_key)) > 0))
);


--
-- Name: education_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    price_snapshot_id uuid NOT NULL,
    installment_number integer NOT NULL,
    amount integer NOT NULL,
    status public.education_installment_status DEFAULT 'pending'::public.education_installment_status NOT NULL,
    payment_reference text NOT NULL,
    payment_instructions_snapshot jsonb,
    due_at timestamp with time zone,
    settled_by_user_id uuid,
    settled_at timestamp with time zone,
    refunded_amount integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_installments_amount_check CHECK (((amount > 0) AND (refunded_amount >= 0) AND (refunded_amount <= amount)))
);


--
-- Name: education_instructors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_instructors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    photo_url text,
    biography text DEFAULT ''::text NOT NULL,
    industry_years integer DEFAULT 0 NOT NULL,
    experience_years integer DEFAULT 0 NOT NULL,
    specializations jsonb DEFAULT '[]'::jsonb NOT NULL,
    qualifications jsonb DEFAULT '[]'::jsonb NOT NULL,
    portfolio_media jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    product_id uuid,
    name text NOT NULL,
    quantity_on_hand integer DEFAULT 0 NOT NULL,
    reorder_level integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_inventory_nonnegative_check CHECK (((quantity_on_hand >= 0) AND (reorder_level >= 0)))
);


--
-- Name: education_inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    center_id uuid NOT NULL,
    delta integer NOT NULL,
    course_id uuid,
    session_id uuid,
    note text NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_inventory_movements_delta_check CHECK ((delta <> 0))
);


--
-- Name: education_ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    escrow_id uuid NOT NULL,
    enrollment_id uuid NOT NULL,
    center_id uuid NOT NULL,
    type public.education_ledger_entry_type NOT NULL,
    amount integer NOT NULL,
    note text,
    actor_user_id uuid,
    idempotency_key text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid,
    center_id uuid,
    object_path text NOT NULL,
    alt_text text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_media_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_media_uploads (
    id uuid NOT NULL,
    course_id uuid NOT NULL,
    center_id uuid NOT NULL,
    object_path text NOT NULL,
    content_type text NOT NULL,
    size integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attached_at timestamp with time zone,
    cleanup_failure_count integer DEFAULT 0 NOT NULL,
    last_cleanup_failure_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_notification_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_notification_archives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id text NOT NULL,
    payload jsonb NOT NULL,
    original_created_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    enrollment_id uuid,
    waitlist_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    action_url text,
    event_key text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    session_id uuid,
    participant_id uuid,
    event_type text NOT NULL,
    dedupe_key text NOT NULL,
    payload jsonb NOT NULL,
    status public.education_outbox_status DEFAULT 'pending'::public.education_outbox_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    leased_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_payment_obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_payment_obligations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid,
    salon_id uuid,
    enrollment_id uuid,
    subscription_id uuid,
    plan_id_snapshot uuid,
    plan_monthly_price_snapshot integer,
    course_limit_snapshot integer,
    kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expected_amount integer NOT NULL,
    confirmed_amount integer,
    calculation_policy_snapshot jsonb,
    recipient_name_snapshot text NOT NULL,
    recipient_account_snapshot text NOT NULL,
    payment_code_snapshot text NOT NULL,
    purpose_snapshot text NOT NULL,
    reference_snapshot text NOT NULL,
    ips_payload_snapshot text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone,
    billing_cycle_snapshot text,
    service_period_start timestamp with time zone,
    service_period_end timestamp with time zone,
    confirmed_at timestamp with time zone,
    confirmed_by_user_id uuid,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    CONSTRAINT education_payment_obligations_account_check CHECK ((recipient_account_snapshot ~ '^[0-9]{18}$'::text)),
    CONSTRAINT education_payment_obligations_amount_check CHECK (((expected_amount > 0) AND ((confirmed_amount IS NULL) OR (confirmed_amount >= 0)))),
    CONSTRAINT education_payment_obligations_code_check CHECK ((payment_code_snapshot = ANY (ARRAY['221'::text, '289'::text]))),
    CONSTRAINT education_payment_obligations_cycle_check CHECK (((billing_cycle_snapshot IS NULL) OR (billing_cycle_snapshot = ANY (ARRAY['monthly'::text, 'yearly'::text])))),
    CONSTRAINT education_payment_obligations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text]))),
    CONSTRAINT education_payment_obligations_target_check CHECK ((num_nonnulls(center_id, salon_id) >= 1))
);


--
-- Name: education_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    amount integer NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status public.education_payout_status DEFAULT 'pending'::public.education_payout_status NOT NULL,
    reference text,
    note text,
    created_by_user_id uuid,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_placement_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_placement_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.education_placement_kind NOT NULL,
    scope public.education_placement_scope NOT NULL,
    price integer NOT NULL,
    slot_count integer NOT NULL,
    duration_days integer NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_placement_settings_duration_days_check CHECK ((duration_days > 0)),
    CONSTRAINT education_placement_settings_price_check CHECK ((price >= 0)),
    CONSTRAINT education_placement_settings_slot_count_check CHECK ((slot_count > 0))
);


--
-- Name: education_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.education_placement_kind NOT NULL,
    scope public.education_placement_scope NOT NULL,
    scope_category_id uuid,
    scope_subcategory_id uuid,
    scope_key text GENERATED ALWAYS AS (COALESCE((scope_category_id)::text, (scope_subcategory_id)::text, 'home'::text)) STORED,
    center_id uuid,
    salon_id uuid,
    course_id uuid,
    slot_number integer NOT NULL,
    price_snapshot integer NOT NULL,
    duration_days_snapshot integer NOT NULL,
    status public.education_placement_status DEFAULT 'pending_payment'::public.education_placement_status NOT NULL,
    payment_reference text,
    payment_ips_payload_snapshot text,
    payment_recipient_name_snapshot text,
    payment_recipient_account_snapshot text,
    payment_purpose_snapshot text,
    payment_currency_snapshot text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    rotation_seed integer DEFAULT 0 NOT NULL,
    settled_by_user_id uuid,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_placements_dates_check CHECK ((((starts_at IS NULL) AND (ends_at IS NULL)) OR ((starts_at IS NOT NULL) AND (ends_at IS NOT NULL) AND (ends_at > starts_at)))),
    CONSTRAINT education_placements_duration_days_check CHECK ((duration_days_snapshot > 0)),
    CONSTRAINT education_placements_price_check CHECK ((price_snapshot >= 0)),
    CONSTRAINT education_placements_scope_check CHECK ((((scope = 'home'::public.education_placement_scope) AND (scope_category_id IS NULL) AND (scope_subcategory_id IS NULL)) OR ((scope = 'category'::public.education_placement_scope) AND (scope_category_id IS NOT NULL) AND (scope_subcategory_id IS NULL)) OR ((scope = 'subcategory'::public.education_placement_scope) AND (scope_category_id IS NULL) AND (scope_subcategory_id IS NOT NULL)))),
    CONSTRAINT education_placements_slot_check CHECK ((slot_number > 0)),
    CONSTRAINT education_placements_target_check CHECK ((((kind = 'featured_salon'::public.education_placement_kind) AND (salon_id IS NOT NULL) AND (center_id IS NULL) AND (course_id IS NULL)) OR ((kind = 'featured_center'::public.education_placement_kind) AND (center_id IS NOT NULL) AND (salon_id IS NULL) AND (course_id IS NULL)) OR ((kind = 'special_offer'::public.education_placement_kind) AND (course_id IS NOT NULL) AND (center_id IS NULL) AND (salon_id IS NULL))))
);


--
-- Name: education_platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_platform_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    commission_percent integer DEFAULT 15 NOT NULL,
    reserve_percent integer DEFAULT 10 NOT NULL,
    online_refund_days integer DEFAULT 14 NOT NULL,
    live_appeal_days integer DEFAULT 7 NOT NULL,
    featured_course_price integer DEFAULT 0 NOT NULL,
    ips_recipient_name text,
    ips_recipient_account text,
    ips_account_environment text DEFAULT 'production'::text NOT NULL,
    ips_purpose text,
    bank_reconciliation_enabled boolean DEFAULT false NOT NULL,
    bank_reconciliation_access_method text,
    bank_reconciliation_access_confirmed_at timestamp with time zone,
    bank_reconciliation_access_confirmed_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_platform_settings_bank_reconciliation_access_method_c CHECK (((bank_reconciliation_access_method IS NULL) OR (bank_reconciliation_access_method = ANY (ARRAY['camt053'::text, 'csv'::text, 'raiffeisen_open_banking'::text, 'aggregator'::text])))),
    CONSTRAINT education_platform_settings_bank_reconciliation_confirmation_ch CHECK ((num_nonnulls(bank_reconciliation_access_method, bank_reconciliation_access_confirmed_at, bank_reconciliation_access_confirmed_by_user_id) = ANY (ARRAY[0, 3]))),
    CONSTRAINT education_platform_settings_ips_account_environment_check CHECK ((ips_account_environment = ANY (ARRAY['production'::text, 'test'::text])))
);


--
-- Name: education_price_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_price_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_group_id uuid NOT NULL,
    course_id uuid NOT NULL,
    gross_amount integer NOT NULL,
    platform_fee integer NOT NULL,
    reserve_amount integer NOT NULL,
    net_amount integer NOT NULL,
    early_bird_applied boolean DEFAULT false NOT NULL,
    discount_reason text DEFAULT 'none'::text NOT NULL,
    early_bird_cutoff_snapshot timestamp with time zone,
    installment_count integer NOT NULL,
    deposit_disposition public.education_deposit_disposition NOT NULL,
    cancellation_deadline_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_price_snapshots_amounts_check CHECK (((gross_amount >= 0) AND (platform_fee >= 0) AND (reserve_amount >= 0) AND (net_amount >= 0) AND (gross_amount = ((platform_fee + reserve_amount) + net_amount)))),
    CONSTRAINT education_price_snapshots_discount_reason_check CHECK ((discount_reason = ANY (ARRAY['none'::text, 'early_bird'::text, 'group'::text, 'early_bird_and_group'::text]))),
    CONSTRAINT education_price_snapshots_installments_check CHECK ((installment_count = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: education_recurrence_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_recurrence_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    response_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_recurrence_commands_fingerprint_check CHECK ((length(request_fingerprint) = 64)),
    CONSTRAINT education_recurrence_commands_key_check CHECK ((length(btrim(idempotency_key)) > 0))
);


--
-- Name: education_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    capacity integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT education_resources_kind_check CHECK ((kind = ANY (ARRAY['room'::text, 'equipment'::text])))
);


--
-- Name: education_salon_cleanup_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_salon_cleanup_reports (
    version integer NOT NULL,
    candidates integer NOT NULL,
    detached_users integer NOT NULL,
    deleted_salons integer NOT NULL,
    retired_salons integer NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_session_educators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_session_educators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    assigned_by_user_id uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_session_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_session_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_id uuid NOT NULL,
    session_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    CONSTRAINT education_session_resources_quantity_check CHECK ((quantity > 0))
);


--
-- Name: education_subcategories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_subcategories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    purchaser_id uuid NOT NULL,
    center_id uuid NOT NULL,
    status public.education_thread_status DEFAULT 'open'::public.education_thread_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_trial_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_trial_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    normalized_email_hash text NOT NULL,
    normalized_phone_hash text,
    normalized_pib_hash text,
    normalized_registration_number_hash text,
    normalized_bank_account_hash text,
    user_id uuid,
    center_id uuid,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    course_id uuid NOT NULL,
    user_id uuid NOT NULL,
    purchaser_id uuid NOT NULL,
    employee_id uuid,
    "position" integer NOT NULL,
    status public.education_waitlist_status DEFAULT 'waiting'::public.education_waitlist_status NOT NULL,
    offered_at timestamp with time zone,
    expires_at timestamp with time zone,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: education_wishlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_wishlists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by_user_id uuid NOT NULL,
    audience text NOT NULL,
    loyalty_tier_id uuid,
    title text NOT NULL,
    subject text NOT NULL,
    html_content text NOT NULL,
    scheduled_at timestamp with time zone,
    status public.email_campaign_status DEFAULT 'draft'::public.email_campaign_status NOT NULL,
    brevo_campaign_id integer,
    recipient_count integer DEFAULT 0 NOT NULL,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    email_type text NOT NULL,
    salon_id uuid,
    appointment_id uuid,
    recipient_email text NOT NULL,
    recipient_name text,
    subject text NOT NULL,
    html_content text,
    status public.email_delivery_status DEFAULT 'queued'::public.email_delivery_status NOT NULL,
    provider_message_id text,
    error_message text,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    retryable_failure boolean DEFAULT false NOT NULL,
    next_retry_at timestamp with time zone,
    processing_token text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_clock_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_clock_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    clock_in_at timestamp with time zone NOT NULL,
    clock_out_at timestamp with time zone,
    edited_by_owner boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_commission_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_commission_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    commission_type public.commission_type DEFAULT 'percent_of_revenue'::public.commission_type NOT NULL,
    commission_percent integer DEFAULT 0 NOT NULL,
    fixed_amount_in_dinars integer DEFAULT 0 NOT NULL,
    per_service_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text NOT NULL,
    status public.leave_request_status DEFAULT 'pending'::public.leave_request_status NOT NULL,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_location_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_location_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_location_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_location_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    break_start text,
    break_end text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    average_rating integer DEFAULT 0 NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    break_start text,
    break_end text
);


--
-- Name: employee_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    service_id uuid NOT NULL
);


--
-- Name: employee_time_off; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_time_off (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    salon_id uuid,
    start_date date NOT NULL,
    end_date date NOT NULL,
    start_time text,
    end_time text,
    reason text NOT NULL,
    CONSTRAINT employee_time_off_time_order_check CHECK (((start_time IS NULL) OR (start_time < end_time))),
    CONSTRAINT employee_time_off_times_together_check CHECK (((start_time IS NULL) = (end_time IS NULL)))
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    role text NOT NULL,
    bio text NOT NULL,
    avatar_url text NOT NULL,
    email text,
    specialties jsonb DEFAULT '[]'::jsonb NOT NULL,
    can_order_independently boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: favorite_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorite_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: image_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    uploaded_by_user_id uuid,
    original_filename text NOT NULL,
    source_content_type text NOT NULL,
    source_size integer NOT NULL,
    staging_object_path text NOT NULL,
    original_object_path text,
    original_width integer,
    original_height integer,
    variants jsonb,
    status public.image_asset_status DEFAULT 'pending'::public.image_asset_status NOT NULL,
    alt_text text DEFAULT ''::text NOT NULL,
    failure_reason text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspiration_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspiration_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    service_id uuid,
    title text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    image_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    integration public.integration_key NOT NULL,
    setting_key text NOT NULL,
    encrypted_value text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jobseeker_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobseeker_profiles (
    user_id uuid NOT NULL,
    bio text DEFAULT ''::text NOT NULL,
    portfolio_media jsonb DEFAULT '[]'::jsonb NOT NULL,
    skill_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    category_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jobseeker_profiles_portfolio_count CHECK (((jsonb_array_length(portfolio_media) = 0) OR ((jsonb_array_length(portfolio_media) >= 3) AND (jsonb_array_length(portfolio_media) <= 5))))
);


--
-- Name: jobseeker_salon_interests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobseeker_salon_interests (
    user_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: legal_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    normalized_pib text NOT NULL,
    legal_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: legal_entity_businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entity_businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_entity_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    salon_id uuid,
    education_center_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_entity_businesses_one_business_check CHECK ((num_nonnulls(salon_id, education_center_id) = 1))
);


--
-- Name: lesson_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_by_user_id uuid NOT NULL
);


--
-- Name: loyalty_point_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_point_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audience public.commerce_audience NOT NULL,
    salon_id uuid,
    user_id uuid,
    order_id uuid,
    retail_order_id uuid,
    type public.loyalty_point_entry_type NOT NULL,
    points integer NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loyalty_point_ledger_order_check CHECK ((num_nonnulls(order_id, retail_order_id) <= 1)),
    CONSTRAINT loyalty_point_ledger_owner_check CHECK ((((audience = 'B2B'::public.commerce_audience) AND (salon_id IS NOT NULL) AND (user_id IS NULL)) OR ((audience = 'B2C'::public.commerce_audience) AND (user_id IS NOT NULL) AND (salon_id IS NULL))))
);


--
-- Name: loyalty_pricing_tier_product_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_pricing_tier_product_exclusions (
    tier_id uuid NOT NULL,
    product_id uuid NOT NULL
);


--
-- Name: loyalty_pricing_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_pricing_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    market text NOT NULL,
    spend_threshold_rsd integer NOT NULL,
    discount_percent integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loyalty_pricing_tiers_market_check CHECK ((market = ANY (ARRAY['B2B'::text, 'B2C'::text, 'BOTH'::text]))),
    CONSTRAINT loyalty_pricing_tiers_percent_check CHECK (((discount_percent >= 1) AND (discount_percent <= 100))),
    CONSTRAINT loyalty_pricing_tiers_threshold_check CHECK ((spend_threshold_rsd >= 0)),
    CONSTRAINT loyalty_pricing_tiers_version_check CHECK ((version >= 1))
);


--
-- Name: loyalty_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    spend_threshold integer NOT NULL,
    period text DEFAULT 'monthly'::text NOT NULL,
    subscription_discount_percent integer DEFAULT 0 NOT NULL,
    product_discount_percent integer DEFAULT 0 NOT NULL,
    free_subscription boolean DEFAULT false NOT NULL,
    premium_listing boolean DEFAULT false NOT NULL,
    free_shipping boolean DEFAULT false NOT NULL,
    benefits jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_assets (
    id uuid NOT NULL,
    owner_user_id uuid,
    scope text NOT NULL,
    resource_id uuid,
    visibility text DEFAULT 'public'::text NOT NULL,
    original_file_name text NOT NULL,
    original_content_type text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    content_hash text NOT NULL,
    alt_text text DEFAULT ''::text NOT NULL,
    cleanup_reserved_at timestamp with time zone,
    test_cleanup_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_upload_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_upload_tickets (
    id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    scope text NOT NULL,
    resource_id uuid,
    staging_object_path text NOT NULL,
    original_file_name text NOT NULL,
    content_type text NOT NULL,
    byte_size integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    finalized_asset_id uuid,
    finalized_at timestamp with time zone,
    cleanup_failure_count integer DEFAULT 0 NOT NULL,
    last_cleanup_failure_at timestamp with time zone,
    test_cleanup_key text,
    promotion_cleanup_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    size_name text NOT NULL,
    format text NOT NULL,
    object_path text NOT NULL,
    content_type text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    byte_size integer NOT NULL,
    etag text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider public.oauth_provider NOT NULL,
    provider_account_id text NOT NULL,
    provider_email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_login_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_login_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    provider public.oauth_provider NOT NULL,
    flow text NOT NULL,
    user_id uuid,
    code_verifier text,
    referral_code text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_approval_request_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_approval_request_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    product_id uuid,
    bundle_id uuid,
    product_name text NOT NULL,
    product_sku_snapshot text,
    quantity integer NOT NULL,
    catalog_snapshot jsonb NOT NULL,
    CONSTRAINT order_approval_request_lines_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_approval_request_lines_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: order_approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_approval_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    submitted_by_user_id uuid NOT NULL,
    cart_id uuid NOT NULL,
    status public.approval_request_status DEFAULT 'PENDING'::public.approval_request_status NOT NULL,
    idempotency_key text NOT NULL,
    quote_version text NOT NULL,
    quote_snapshot jsonb NOT NULL,
    coupon_code text,
    referral_credit_intent_rsd integer DEFAULT 0 NOT NULL,
    reviewer_user_id uuid,
    reviewer_reason text,
    decided_at timestamp with time zone,
    finalized_order_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_bundle_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_bundle_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    product_catalog_reference text NOT NULL,
    quantity integer NOT NULL,
    CONSTRAINT order_bundle_components_quantity_check CHECK ((quantity > 0))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    variant_value text,
    variant_label text,
    product_sku text,
    quantity integer NOT NULL,
    price integer NOT NULL,
    supplier_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_slug text NOT NULL,
    product_catalog_reference text,
    product_sku_snapshot text,
    category_id_snapshot uuid,
    category_name_snapshot text,
    brand_snapshot text,
    market text DEFAULT 'B2B'::text NOT NULL,
    currency text DEFAULT 'RSD'::text NOT NULL,
    unit_price integer NOT NULL,
    discount_snapshot integer,
    line_subtotal integer NOT NULL,
    line_total integer NOT NULL,
    unit_cost_price_rsd integer DEFAULT 0 NOT NULL,
    line_cogs_rsd integer DEFAULT 0 NOT NULL,
    referral_discount_rsd integer DEFAULT 0 NOT NULL,
    realized_revenue_rsd integer DEFAULT 0 NOT NULL,
    bundle_id uuid,
    base_unit_price integer DEFAULT 0 NOT NULL,
    effective_unit_price integer DEFAULT 0 NOT NULL,
    price_source public.cart_price_source DEFAULT 'FULL_PRICE'::public.cart_price_source NOT NULL,
    line_discount integer DEFAULT 0 NOT NULL,
    coupon_discount_rsd integer DEFAULT 0 NOT NULL,
    automatic_promotion_discount_rsd integer DEFAULT 0 NOT NULL,
    threshold_reward_discount_rsd integer DEFAULT 0 NOT NULL,
    is_reward_gift boolean DEFAULT false NOT NULL,
    reward_snapshot jsonb,
    bundle_name_snapshot text,
    bundle_components_snapshot jsonb,
    estimated_delivery_date text,
    CONSTRAINT order_items_g2_discount_check CHECK (((automatic_promotion_discount_rsd >= 0) AND (threshold_reward_discount_rsd >= 0))),
    CONSTRAINT order_items_profit_snapshot_check CHECK (((unit_cost_price_rsd >= 0) AND (line_cogs_rsd >= 0) AND (referral_discount_rsd >= 0) AND (realized_revenue_rsd >= 0) AND (referral_discount_rsd <= line_total))),
    CONSTRAINT order_items_reward_gift_check CHECK (((NOT is_reward_gift) OR ((product_id IS NOT NULL) AND (bundle_id IS NULL) AND (unit_price = 0) AND (price = 0) AND (line_subtotal = 0) AND (line_total = 0) AND (reward_snapshot IS NOT NULL)))),
    CONSTRAINT order_items_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    actor_user_id uuid,
    actor_name text DEFAULT 'Administrator'::text NOT NULL,
    field text NOT NULL,
    previous_value text,
    next_value text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    fulfillment_status public.fulfillment_status DEFAULT 'RECEIVED'::public.fulfillment_status NOT NULL,
    total integer NOT NULL,
    shipping_cost integer DEFAULT 0 NOT NULL,
    shipping_name text NOT NULL,
    shipping_address text NOT NULL,
    shipping_phone text,
    shipping_email text,
    shipping_city text,
    shipping_postal_code text,
    shipping_note text,
    shipping_is_salon_address boolean DEFAULT true NOT NULL,
    billing_company_name text,
    billing_tax_id text,
    billing_registration_number text,
    billing_address text,
    billing_city text,
    billing_postal_code text,
    subtotal integer DEFAULT 0 NOT NULL,
    referral_credit_merchandise_subtotal_rsd integer DEFAULT 0 NOT NULL,
    referral_credit_pre_credit_payable_total_rsd integer DEFAULT 0 NOT NULL,
    referral_credit_applied_rsd integer DEFAULT 0 NOT NULL,
    coupon_code_snapshot text,
    coupon_discount_rsd integer DEFAULT 0 NOT NULL,
    coupon_free_shipping boolean DEFAULT false NOT NULL,
    promotion_snapshot jsonb,
    referral_credit_restored_at timestamp with time zone,
    total_weight_grams integer DEFAULT 0 NOT NULL,
    payment_method public.payment_method NOT NULL,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status NOT NULL,
    delivery_method public.delivery_method DEFAULT 'courier'::public.delivery_method NOT NULL,
    courier_service_id uuid,
    courier_service text,
    tracking_number text,
    tracking_url text,
    admin_note text,
    estimated_delivery_date text,
    invoice_number text,
    invoice_issued_at timestamp with time zone,
    seller_snapshot jsonb,
    loyalty_points_awarded integer DEFAULT 0 NOT NULL,
    loyalty_points_reversed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: package_purchase_service_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_purchase_service_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    service_id uuid NOT NULL,
    total_quota integer DEFAULT 0 NOT NULL,
    remaining_quota integer DEFAULT 0 NOT NULL,
    CONSTRAINT package_purchase_service_links_quota_nonnegative CHECK (((total_quota >= 0) AND (remaining_quota >= 0) AND (remaining_quota <= total_quota)))
);


--
-- Name: package_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    salon_customer_id uuid NOT NULL,
    purchase_service_link_id uuid,
    service_id uuid,
    status public.package_redemption_status DEFAULT 'redeemed'::public.package_redemption_status NOT NULL,
    original_appointment_price integer DEFAULT 0 NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    reversed_at timestamp with time zone,
    reversed_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: package_service_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_service_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid NOT NULL,
    service_id uuid NOT NULL,
    quota integer DEFAULT 1 NOT NULL,
    CONSTRAINT package_service_links_quota_positive CHECK ((quota > 0))
);


--
-- Name: phone_verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_normalized text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    last_requested_at timestamp with time zone DEFAULT now() NOT NULL,
    last_request_ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: phone_verification_proofs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_verification_proofs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    phone_normalized text NOT NULL,
    verification_method text DEFAULT 'sms_otp'::text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revocation_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_retention_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_retention_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    new_customer_window_days integer NOT NULL,
    default_interval_days integer NOT NULL,
    at_risk_interval_percent integer NOT NULL,
    lost_interval_percent integer NOT NULL,
    lost_minimum_days integer NOT NULL,
    vip_min_completed_visits integer NOT NULL,
    vip_spend_percent_of_median integer NOT NULL,
    changed_by_user_id uuid,
    change_source text DEFAULT 'manual'::text NOT NULL,
    restored_from_version integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    message text NOT NULL,
    status public.price_inquiry_status DEFAULT 'NEW'::public.price_inquiry_status NOT NULL,
    internal_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text NOT NULL,
    logo_url text,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: product_bundle_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_bundle_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bundle_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT product_bundle_components_quantity_check CHECK ((quantity > 0))
);


--
-- Name: product_bundles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_bundles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    image_url text,
    market public.bundle_market NOT NULL,
    b2b_price integer,
    b2c_price integer,
    linked_treatment_id uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_bundles_market_prices_check CHECK ((((market = 'B2B'::public.bundle_market) AND (b2b_price > 0) AND (b2c_price IS NULL)) OR ((market = 'B2C'::public.bundle_market) AND (b2c_price > 0) AND (b2b_price IS NULL)) OR ((market = 'BOTH'::public.bundle_market) AND (b2b_price > 0) AND (b2c_price > 0))))
);


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid DEFAULT '9b5970ea-0a8c-5e60-9d32-2a09f0890560'::uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    parent_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    icon text,
    image_url text,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: product_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    display_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_treatment_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_treatment_mappings (
    product_id uuid NOT NULL,
    treatment_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_upsell_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_upsell_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    alternative_product_id uuid NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_upsell_links_not_self_check CHECK ((product_id <> alternative_product_id)),
    CONSTRAINT product_upsell_links_sort_check CHECK (((sort_order >= 1) AND (sort_order <= 3)))
);


--
-- Name: product_waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    audience public.commerce_audience NOT NULL,
    salon_id uuid,
    user_id uuid,
    status public.product_waitlist_status DEFAULT 'ACTIVE'::public.product_waitlist_status NOT NULL,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_waitlist_owner_check CHECK ((((audience = 'B2B'::public.commerce_audience) AND (salon_id IS NOT NULL) AND (user_id IS NULL)) OR ((audience = 'B2C'::public.commerce_audience) AND (user_id IS NOT NULL) AND (salon_id IS NULL))))
);


--
-- Name: product_waitlist_notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_waitlist_notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waitlist_id uuid NOT NULL,
    audience public.commerce_audience NOT NULL,
    salon_id uuid,
    user_id uuid,
    product_id uuid NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_wishlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_wishlists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid DEFAULT '9b5970ea-0a8c-5e60-9d32-2a09f0890560'::uuid NOT NULL,
    category_id uuid,
    category_name text NOT NULL,
    subcategory_name text,
    name text NOT NULL,
    brand text,
    description text NOT NULL,
    short_description text,
    image_url text NOT NULL,
    cover_image_description text,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    price integer NOT NULL,
    cost_price_rsd integer,
    average_duration_days integer,
    discount_price integer,
    discount_price_ends_at timestamp with time zone,
    retail_enabled boolean DEFAULT false NOT NULL,
    public_description text,
    public_price integer,
    public_discount_price integer,
    public_discount_price_ends_at timestamp with time zone,
    product_type_id uuid,
    ingredients text,
    usage_instructions text,
    characteristics jsonb DEFAULT '[]'::jsonb NOT NULL,
    search_synonyms jsonb DEFAULT '[]'::jsonb NOT NULL,
    professional_enabled boolean DEFAULT true NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    catalog_reference text DEFAULT ('LUM-'::text || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 12))) NOT NULL,
    sku text NOT NULL,
    unit text NOT NULL,
    weight_grams integer,
    is_new boolean DEFAULT false NOT NULL,
    is_bestseller boolean DEFAULT false NOT NULL,
    variant_type text,
    variants jsonb,
    similar_products_mode public.similar_products_mode DEFAULT 'AUTO_CATEGORY'::public.similar_products_mode NOT NULL,
    similar_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    cross_sell_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    quantity_pricing_tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    minimum_order_quantity integer DEFAULT 1 NOT NULL,
    delivery_business_days_override integer,
    subscription_allowed boolean DEFAULT false NOT NULL,
    subscription_discount_percent integer,
    loyalty_pricing_excluded boolean DEFAULT false NOT NULL,
    price_on_request boolean DEFAULT false NOT NULL,
    bulk_matrix_enabled boolean DEFAULT false NOT NULL,
    average_rating integer DEFAULT 0 NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT products_average_duration_days_check CHECK (((average_duration_days IS NULL) OR (average_duration_days > 0))),
    CONSTRAINT products_cost_price_rsd_check CHECK (((cost_price_rsd IS NULL) OR (cost_price_rsd >= 0)))
);


--
-- Name: provider_webhook_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_webhook_receipts (
    provider text NOT NULL,
    last_event_at timestamp with time zone,
    rejected_payload_count integer DEFAULT 0 NOT NULL,
    rejected_payload_times jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_rejected_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    enabled boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone,
    disabled_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: referral_attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_attributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referral_code_id uuid NOT NULL,
    channel public.referral_channel NOT NULL,
    referrer_user_id uuid NOT NULL,
    referred_user_id uuid NOT NULL,
    referred_salon_id uuid,
    referred_education_center_id uuid,
    status public.referral_attribution_status DEFAULT 'attributed'::public.referral_attribution_status NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone NOT NULL,
    rejection_reason text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_attributions_target_business_check CHECK (((num_nonnulls(referred_salon_id, referred_education_center_id) = 0) OR ((channel = ANY (ARRAY['A'::public.referral_channel, 'B1'::public.referral_channel])) AND (num_nonnulls(referred_salon_id, referred_education_center_id) = 1))))
);


--
-- Name: referral_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    channel public.referral_channel NOT NULL,
    referrer_user_id uuid NOT NULL,
    referrer_salon_id uuid,
    referrer_education_center_id uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_codes_source_channel_check CHECK ((((channel = ANY (ARRAY['B1'::public.referral_channel, 'B2'::public.referral_channel])) AND (num_nonnulls(referrer_salon_id, referrer_education_center_id) = 0)) OR ((channel = 'C'::public.referral_channel) AND (referrer_education_center_id IS NOT NULL) AND (referrer_salon_id IS NULL)) OR ((channel = 'D'::public.referral_channel) AND (referrer_salon_id IS NOT NULL) AND (referrer_education_center_id IS NULL)) OR ((channel = 'A'::public.referral_channel) AND (num_nonnulls(referrer_salon_id, referrer_education_center_id) = 1))))
);


--
-- Name: referral_credit_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_credit_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_kind public.referral_wallet_kind NOT NULL,
    owner_user_id uuid NOT NULL,
    salon_id uuid,
    education_center_id uuid,
    referral_attribution_id uuid,
    type public.referral_credit_entry_type NOT NULL,
    amount_rsd integer NOT NULL,
    expires_at timestamp with time zone,
    effective_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_credit_ledger_wallet_business_check CHECK ((((wallet_kind = 'B2C'::public.referral_wallet_kind) AND (salon_id IS NULL) AND (education_center_id IS NULL)) OR ((wallet_kind = 'B2B'::public.referral_wallet_kind) AND (num_nonnulls(salon_id, education_center_id) = 1))))
);


--
-- Name: referral_credit_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_credit_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_entry_id uuid NOT NULL,
    order_id uuid,
    retail_order_id uuid,
    amount_rsd integer NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_credit_redemptions_one_order_check CHECK ((num_nonnulls(order_id, retail_order_id) = 1)),
    CONSTRAINT referral_credit_redemptions_positive_amount_check CHECK ((amount_rsd > 0))
);


--
-- Name: referral_milestone_benefits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_milestone_benefits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_user_id uuid NOT NULL,
    channel public.referral_channel NOT NULL,
    benefit_salon_id uuid,
    benefit_education_center_id uuid,
    qualifying_count integer NOT NULL,
    kind public.referral_milestone_kind NOT NULL,
    billing_cycle_start timestamp with time zone,
    billing_cycle_end timestamp with time zone,
    discount_percent integer,
    applied_at timestamp with time zone,
    neutralized_at timestamp with time zone,
    neutralized_by_user_id uuid,
    neutralization_reason text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_milestone_benefits_business_check CHECK ((((channel = 'A'::public.referral_channel) AND (kind = 'salon_subscription_reduction'::public.referral_milestone_kind) AND (benefit_salon_id IS NOT NULL) AND (benefit_education_center_id IS NULL)) OR ((channel = ANY (ARRAY['A'::public.referral_channel, 'C'::public.referral_channel])) AND (kind = 'education_commission_reduction'::public.referral_milestone_kind) AND (benefit_education_center_id IS NOT NULL) AND (benefit_salon_id IS NULL)))),
    CONSTRAINT referral_milestone_benefits_discount_percent_check CHECK (((discount_percent IS NULL) OR ((discount_percent > 0) AND (discount_percent <= 100))))
);


--
-- Name: referral_qualification_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_qualification_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    qualification_id uuid NOT NULL,
    appointment_id uuid,
    enrollment_id uuid,
    eligible_at timestamp with time zone NOT NULL,
    invalidated_at timestamp with time zone,
    invalidation_reason text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_qualification_evidence_one_source_check CHECK ((num_nonnulls(appointment_id, enrollment_id) = 1))
);


--
-- Name: referral_qualifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_qualifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attribution_id uuid NOT NULL,
    referred_salon_id uuid,
    referred_education_center_id uuid,
    status public.referral_qualification_status DEFAULT 'pending_verification'::public.referral_qualification_status NOT NULL,
    required_evidence_count integer NOT NULL,
    tracking_started_at timestamp with time zone,
    qualified_at timestamp with time zone,
    hold_until timestamp with time zone,
    available_at timestamp with time zone,
    reversed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_qualifications_target_business_check CHECK ((num_nonnulls(referred_salon_id, referred_education_center_id) <= 1))
);


--
-- Name: referral_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attribution_id uuid,
    qualification_id uuid,
    status public.referral_review_status DEFAULT 'open'::public.referral_review_status NOT NULL,
    reason_code text NOT NULL,
    detail text,
    score integer,
    reviewed_by_user_id uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reorder_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reorder_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audience public.commerce_audience NOT NULL,
    salon_id uuid,
    user_id uuid,
    idempotency_key text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retail_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid,
    bundle_id uuid,
    variant_value text,
    product_name text NOT NULL,
    product_image_url text NOT NULL,
    product_catalog_reference text,
    unit_price integer NOT NULL,
    quantity integer NOT NULL,
    weight_grams integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retail_cart_items_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: retail_carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    user_id uuid,
    contact_email text,
    activity_version integer DEFAULT 1 NOT NULL,
    reminder_enqueued_activity_version integer,
    completed_activity_version integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retail_carts_activity_version_check CHECK ((activity_version >= 1))
);


--
-- Name: retail_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_image_url text NOT NULL,
    product_catalog_reference text,
    variant_value text,
    variant_label text,
    unit_price integer NOT NULL,
    quantity integer NOT NULL,
    supplier_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_slug text NOT NULL,
    product_sku_snapshot text,
    category_id_snapshot uuid,
    category_name_snapshot text,
    brand_snapshot text,
    market text DEFAULT 'B2C'::text NOT NULL,
    currency text DEFAULT 'RSD'::text NOT NULL,
    discount_snapshot integer,
    line_subtotal integer NOT NULL,
    line_total integer NOT NULL,
    unit_cost_price_rsd integer DEFAULT 0 NOT NULL,
    line_cogs_rsd integer DEFAULT 0 NOT NULL,
    referral_discount_rsd integer DEFAULT 0 NOT NULL,
    realized_revenue_rsd integer DEFAULT 0 NOT NULL,
    bundle_id uuid,
    base_unit_price integer DEFAULT 0 NOT NULL,
    effective_unit_price integer DEFAULT 0 NOT NULL,
    price_source public.cart_price_source DEFAULT 'FULL_PRICE'::public.cart_price_source NOT NULL,
    line_discount integer DEFAULT 0 NOT NULL,
    coupon_discount_rsd integer DEFAULT 0 NOT NULL,
    personalized_treatment_bundle_discount_rsd integer DEFAULT 0 NOT NULL,
    post_treatment_recommendation_discount_rsd integer DEFAULT 0 NOT NULL,
    aftercare_recommendation_id uuid,
    automatic_promotion_discount_rsd integer DEFAULT 0 NOT NULL,
    threshold_reward_discount_rsd integer DEFAULT 0 NOT NULL,
    is_reward_gift boolean DEFAULT false NOT NULL,
    reward_snapshot jsonb,
    bundle_name_snapshot text,
    bundle_components_snapshot jsonb,
    estimated_delivery_date text,
    CONSTRAINT retail_order_items_aftercare_discount_check CHECK (((personalized_treatment_bundle_discount_rsd >= 0) AND (post_treatment_recommendation_discount_rsd >= 0) AND ((personalized_treatment_bundle_discount_rsd + post_treatment_recommendation_discount_rsd) <= line_subtotal))),
    CONSTRAINT retail_order_items_g2_discount_check CHECK (((automatic_promotion_discount_rsd >= 0) AND (threshold_reward_discount_rsd >= 0))),
    CONSTRAINT retail_order_items_profit_snapshot_check CHECK (((unit_cost_price_rsd >= 0) AND (line_cogs_rsd >= 0) AND (referral_discount_rsd >= 0) AND (realized_revenue_rsd >= 0) AND (referral_discount_rsd <= line_total))),
    CONSTRAINT retail_order_items_reward_gift_check CHECK (((NOT is_reward_gift) OR ((product_id IS NOT NULL) AND (bundle_id IS NULL) AND (unit_price = 0) AND (line_subtotal = 0) AND (line_total = 0) AND (reward_snapshot IS NOT NULL)))),
    CONSTRAINT retail_order_items_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: retail_order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    retail_order_id uuid NOT NULL,
    actor_user_id uuid,
    actor_name text DEFAULT 'Administrator'::text NOT NULL,
    field text NOT NULL,
    previous_value text,
    next_value text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retail_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number text NOT NULL,
    cart_id uuid NOT NULL,
    user_id uuid,
    tracking_token_hash text NOT NULL,
    tracking_token_expires_at timestamp with time zone DEFAULT (now() + '180 days'::interval) NOT NULL,
    tracking_token_rotated_at timestamp with time zone,
    tracking_token_revoked_at timestamp with time zone,
    idempotency_key text NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    fulfillment_status public.fulfillment_status DEFAULT 'RECEIVED'::public.fulfillment_status NOT NULL,
    payment_method public.payment_method NOT NULL,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status NOT NULL,
    delivery_method public.delivery_method DEFAULT 'courier'::public.delivery_method NOT NULL,
    subtotal integer NOT NULL,
    referral_credit_merchandise_subtotal_rsd integer DEFAULT 0 NOT NULL,
    referral_credit_pre_credit_payable_total_rsd integer DEFAULT 0 NOT NULL,
    referral_credit_applied_rsd integer DEFAULT 0 NOT NULL,
    coupon_code_snapshot text,
    coupon_discount_rsd integer DEFAULT 0 NOT NULL,
    coupon_free_shipping boolean DEFAULT false NOT NULL,
    promotion_snapshot jsonb,
    referral_credit_restored_at timestamp with time zone,
    shipping_cost integer DEFAULT 0 NOT NULL,
    total integer NOT NULL,
    shipping_name text NOT NULL,
    shipping_address text NOT NULL,
    shipping_city text NOT NULL,
    shipping_postal_code text NOT NULL,
    shipping_phone text NOT NULL,
    shipping_email text NOT NULL,
    shipping_note text,
    tracking_number text,
    tracking_url text,
    estimated_delivery_date text,
    loyalty_points_awarded integer DEFAULT 0 NOT NULL,
    loyalty_points_reversed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retail_product_review_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_product_review_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retail_product_review_moderation_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_product_review_moderation_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    moderator_user_id uuid NOT NULL,
    action public.retail_review_moderation_action NOT NULL,
    previous_status public.retail_review_moderation_status,
    next_status public.retail_review_moderation_status NOT NULL,
    reason text,
    internal_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retail_product_review_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_product_review_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    reporter_user_id uuid NOT NULL,
    reason public.retail_review_report_reason NOT NULL,
    explanation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retail_product_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_product_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text NOT NULL,
    moderation_status public.retail_review_moderation_status DEFAULT 'PUBLISHED'::public.retail_review_moderation_status NOT NULL,
    moderation_reason text,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retail_product_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: retail_product_subscription_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_product_subscription_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    due_at timestamp with time zone NOT NULL,
    status public.retail_subscription_attempt_status DEFAULT 'PROCESSING'::public.retail_subscription_attempt_status NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_token uuid NOT NULL,
    order_id uuid,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retail_subscription_attempts_retry_count_check CHECK ((retry_count >= 0))
);


--
-- Name: retail_product_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_product_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    frequency public.retail_subscription_frequency NOT NULL,
    status public.retail_subscription_status DEFAULT 'ACTIVE'::public.retail_subscription_status NOT NULL,
    discount_percent_snapshot integer NOT NULL,
    payment_method public.payment_method NOT NULL,
    delivery_method public.delivery_method NOT NULL,
    contact_snapshot jsonb NOT NULL,
    delivery_snapshot jsonb NOT NULL,
    anchor_day integer NOT NULL,
    next_due_at timestamp with time zone NOT NULL,
    blocked_until timestamp with time zone,
    paused_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    last_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retail_product_subscriptions_anchor_day_check CHECK (((anchor_day >= 1) AND (anchor_day <= 31))),
    CONSTRAINT retail_product_subscriptions_discount_percent_check CHECK (((discount_percent_snapshot >= 0) AND (discount_percent_snapshot <= 100))),
    CONSTRAINT retail_product_subscriptions_quantity_check CHECK ((quantity > 0))
);


--
-- Name: retail_tracking_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_tracking_rate_limits (
    client_key_hash text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retail_tracking_rate_limits_count_check CHECK ((request_count >= 0))
);


--
-- Name: review_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    appointment_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    notification_id uuid,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone
);


--
-- Name: review_reward_issuances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_reward_issuances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    review_id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    percent_snapshot integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_reward_percent_check CHECK (((percent_snapshot >= 1) AND (percent_snapshot <= 100)))
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    employee_id uuid,
    service_name text NOT NULL,
    rating integer NOT NULL,
    text text NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    show_profile_photo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rma_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rma_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rma_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rma_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rma_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rma_id uuid NOT NULL,
    actor_user_id uuid,
    previous_status public.rma_status,
    next_status public.rma_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rmas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rma_number text NOT NULL,
    order_id uuid,
    order_item_id uuid,
    retail_order_id uuid,
    retail_order_item_id uuid,
    requester_user_id uuid NOT NULL,
    quantity integer NOT NULL,
    reason text NOT NULL,
    description text NOT NULL,
    status public.rma_status DEFAULT 'RECEIVED'::public.rma_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rmas_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT rmas_target_check CHECK (((num_nonnulls(order_id, retail_order_id) = 1) AND (num_nonnulls(order_item_id, retail_order_item_id) = 1))),
    CONSTRAINT rmas_target_pair_check CHECK ((((order_id IS NOT NULL) AND (order_item_id IS NOT NULL) AND (retail_order_id IS NULL) AND (retail_order_item_id IS NULL)) OR ((order_id IS NULL) AND (order_item_id IS NULL) AND (retail_order_id IS NOT NULL) AND (retail_order_item_id IS NOT NULL))))
);


--
-- Name: salon_booking_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_booking_settings (
    salon_id uuid NOT NULL,
    slot_granularity_minutes integer DEFAULT 15 NOT NULL,
    minimum_lead_time_minutes integer DEFAULT 0 NOT NULL,
    max_booking_horizon_days integer,
    cancellation_deadline_minutes integer DEFAULT 0 NOT NULL,
    reminder_offsets_minutes jsonb DEFAULT '[]'::jsonb NOT NULL,
    reminder_channels jsonb DEFAULT '[]'::jsonb NOT NULL,
    max_visit_gap_minutes integer DEFAULT 0 NOT NULL,
    minimum_useful_late_treatment_minutes integer DEFAULT 0 NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salon_booking_settings_granularity_check CHECK ((slot_granularity_minutes = ANY (ARRAY[5, 10, 15, 30]))),
    CONSTRAINT salon_booking_settings_horizon_check CHECK (((max_booking_horizon_days IS NULL) OR ((max_booking_horizon_days >= 0) AND (max_booking_horizon_days <= 3650)))),
    CONSTRAINT salon_booking_settings_nonnegative_check CHECK (((minimum_lead_time_minutes >= 0) AND ((max_booking_horizon_days IS NULL) OR ((max_booking_horizon_days >= 0) AND (max_booking_horizon_days <= 3650))) AND (cancellation_deadline_minutes >= 0) AND (max_visit_gap_minutes >= 0) AND (minimum_useful_late_treatment_minutes >= 0)))
);


--
-- Name: salon_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    brand_id uuid NOT NULL
);


--
-- Name: salon_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    user_id uuid,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    phone_normalized text,
    sms_opt_out boolean DEFAULT false NOT NULL,
    birth_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_date_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_date_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    date date NOT NULL,
    closed boolean DEFAULT false NOT NULL,
    open_time text,
    close_time text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salon_date_hours_window_check CHECK (((closed AND (open_time IS NULL) AND (close_time IS NULL)) OR ((NOT closed) AND (open_time IS NOT NULL) AND (close_time IS NOT NULL) AND (open_time < close_time))))
);


--
-- Name: salon_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    weekday integer NOT NULL,
    open_time text NOT NULL,
    close_time text NOT NULL,
    closed boolean DEFAULT false NOT NULL
);


--
-- Name: salon_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity double precision DEFAULT 0 NOT NULL,
    unit_content_amount double precision DEFAULT 1 NOT NULL,
    usage_unit text,
    low_stock_threshold double precision,
    peak_quantity double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    product_id uuid NOT NULL,
    type public.salon_inventory_movement_type NOT NULL,
    quantity_delta double precision NOT NULL,
    appointment_id uuid,
    service_id uuid,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_location_creation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_location_creation_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_loyalty_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_loyalty_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    tier_id uuid,
    current_period_spend integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_notification_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_notification_archives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id text NOT NULL,
    payload jsonb NOT NULL,
    original_created_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    href text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salon_resource_downtime; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_resource_downtime (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salon_resource_downtime_window_check CHECK ((starts_at < ends_at))
);


--
-- Name: salon_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salon_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    name text NOT NULL,
    type public.salon_resource_type DEFAULT 'other'::public.salon_resource_type NOT NULL,
    capacity integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salon_resources_capacity_positive CHECK ((capacity >= 1))
);


--
-- Name: salons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    city text NOT NULL,
    municipality text NOT NULL,
    address text NOT NULL,
    postal_code text,
    phone text NOT NULL,
    email text NOT NULL,
    company_name text,
    company_tax_id text,
    company_registration_number text,
    company_address text,
    company_city text,
    company_postal_code text,
    payment_reference_number text,
    provisioning_source text,
    short_description text NOT NULL,
    description text NOT NULL,
    image_url text NOT NULL,
    cover_image_description text,
    gallery jsonb DEFAULT '[]'::jsonb NOT NULL,
    video_url text,
    rating integer DEFAULT 0 NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    latitude double precision,
    longitude double precision,
    home_service boolean DEFAULT false NOT NULL,
    home_service_radius_km integer DEFAULT 10 NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    top_salon boolean DEFAULT false NOT NULL,
    accepts_cards boolean DEFAULT false NOT NULL,
    instant_booking boolean DEFAULT false NOT NULL,
    serves_men boolean DEFAULT false NOT NULL,
    serves_men_manually_set boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saved_retail_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_retail_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid,
    bundle_id uuid,
    variant_value text,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_retail_cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT saved_retail_cart_items_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: saved_shop_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_shop_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid,
    bundle_id uuid,
    variant_value text,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_shop_cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT saved_shop_cart_items_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: service_add_on_resource_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_add_on_resource_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    add_on_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    CONSTRAINT service_add_on_resource_quantity_check CHECK ((quantity >= 1))
);


--
-- Name: service_add_ons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_add_ons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    name text NOT NULL,
    duration_minutes integer DEFAULT 0 NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_add_ons_duration_check CHECK ((duration_minutes >= 0)),
    CONSTRAINT service_add_ons_price_check CHECK ((price >= 0))
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text NOT NULL,
    fallback_image_url text,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: service_product_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_product_consumptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    service_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity_per_use double precision NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_resource_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_resource_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_resource_requirements_quantity_positive CHECK ((quantity >= 1))
);


--
-- Name: service_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    main_category text NOT NULL,
    subcategory text NOT NULL,
    typical_duration_minutes integer NOT NULL,
    price_min integer NOT NULL,
    price_max integer NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    category_id uuid,
    category_name text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    duration_minutes integer NOT NULL,
    pre_processing_minutes integer DEFAULT 0 NOT NULL,
    processing_minutes integer DEFAULT 0 NOT NULL,
    post_processing_minutes integer DEFAULT 0 NOT NULL,
    seat_capacity integer DEFAULT 1 NOT NULL,
    required_employee_count integer DEFAULT 1 NOT NULL,
    deposit_amount integer,
    buffer_minutes integer DEFAULT 0 NOT NULL,
    price integer NOT NULL,
    promo_price integer,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    package_treatments integer,
    image_url text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    home_service_available boolean DEFAULT false NOT NULL,
    home_service_fee integer DEFAULT 0 NOT NULL,
    home_service_minimum_order integer,
    CONSTRAINT services_buffer_minutes_check CHECK ((buffer_minutes >= 0)),
    CONSTRAINT services_deposit_amount_check CHECK (((deposit_amount IS NULL) OR (deposit_amount >= 0))),
    CONSTRAINT services_processing_segments_check CHECK (((pre_processing_minutes >= 0) AND (processing_minutes >= 0) AND (post_processing_minutes >= 0) AND (((pre_processing_minutes = 0) AND (processing_minutes = 0) AND (post_processing_minutes = 0)) OR ((duration_minutes = ((pre_processing_minutes + processing_minutes) + post_processing_minutes)) AND (duration_minutes > 0))))),
    CONSTRAINT services_required_employee_count_check CHECK (((required_employee_count >= 1) AND (required_employee_count <= 20))),
    CONSTRAINT services_seat_capacity_check CHECK ((seat_capacity >= 1)),
    CONSTRAINT services_segments_check CHECK (((pre_processing_minutes >= 0) AND (processing_minutes >= 0) AND (post_processing_minutes >= 0) AND (((pre_processing_minutes = 0) AND (processing_minutes = 0) AND (post_processing_minutes = 0)) OR (((pre_processing_minutes + processing_minutes) + post_processing_minutes) = duration_minutes))))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shift_swap_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_swap_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    requester_employee_id uuid NOT NULL,
    target_employee_id uuid NOT NULL,
    swap_date date NOT NULL,
    note text,
    status public.shift_swap_status DEFAULT 'pending_colleague'::public.shift_swap_status NOT NULL,
    colleague_responded_at timestamp with time zone,
    owner_reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipping_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    free_shipping_threshold integer DEFAULT 0 NOT NULL,
    tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    personal_delivery_enabled boolean DEFAULT false NOT NULL,
    personal_delivery_name text DEFAULT 'Lična dostava u Beogradu'::text NOT NULL,
    personal_delivery_price integer DEFAULT 0 NOT NULL,
    personal_delivery_description text DEFAULT 'Dostava na adresu u Beogradu.'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shop_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_loyalty_points boolean DEFAULT true NOT NULL,
    points_per_100_rsd integer DEFAULT 1 NOT NULL,
    low_stock_threshold integer DEFAULT 5 NOT NULL,
    default_delivery_business_days integer DEFAULT 3 NOT NULL,
    seller_company_name text,
    seller_tax_id text,
    seller_registration_number text,
    seller_address text,
    seller_city text,
    seller_postal_code text,
    seller_bank_account text,
    seller_contact_email text,
    seller_contact_phone text,
    retail_cart_reminder_enabled boolean DEFAULT false NOT NULL,
    retail_cart_reminder_delay_hours integer DEFAULT 24 NOT NULL,
    retail_cart_reminder_brevo_template_id integer,
    quote_validity_days integer DEFAULT 7 NOT NULL,
    review_rewards_enabled boolean DEFAULT false NOT NULL,
    review_invitation_delay_days integer DEFAULT 7 NOT NULL,
    review_reward_percent integer DEFAULT 5 NOT NULL,
    review_reward_validity_days integer DEFAULT 30 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shop_settings_retail_cart_reminder_delay_check CHECK (((retail_cart_reminder_delay_hours >= 1) AND (retail_cart_reminder_delay_hours <= 720))),
    CONSTRAINT shop_settings_retail_cart_reminder_template_check CHECK (((retail_cart_reminder_brevo_template_id IS NULL) OR (retail_cart_reminder_brevo_template_id > 0))),
    CONSTRAINT shop_settings_values_check CHECK (((points_per_100_rsd >= 0) AND (low_stock_threshold >= 1) AND ((default_delivery_business_days >= 1) AND (default_delivery_business_days <= 365)) AND ((retail_cart_reminder_delay_hours >= 1) AND (retail_cart_reminder_delay_hours <= 720)) AND ((retail_cart_reminder_brevo_template_id IS NULL) OR (retail_cart_reminder_brevo_template_id > 0)) AND ((quote_validity_days >= 1) AND (quote_validity_days <= 90)) AND ((review_invitation_delay_days >= 7) AND (review_invitation_delay_days <= 10)) AND ((review_reward_percent >= 1) AND (review_reward_percent <= 100)) AND ((review_reward_validity_days >= 1) AND (review_reward_validity_days <= 365)) AND (version >= 1)))
);


--
-- Name: shopping_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopping_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid,
    bundle_id uuid,
    variant_value text,
    product_name text NOT NULL,
    product_image_url text NOT NULL,
    variant_label text,
    product_sku text,
    unit_price integer NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shopping_cart_items_target_check CHECK ((num_nonnulls(product_id, bundle_id) = 1))
);


--
-- Name: shopping_carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopping_carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sms_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    salon_id uuid,
    appointment_id uuid,
    message_type public.sms_message_type NOT NULL,
    recipient_phone text NOT NULL,
    body text NOT NULL,
    status public.sms_delivery_status DEFAULT 'queued'::public.sms_delivery_status NOT NULL,
    processing_started_at timestamp with time zone,
    submission_started_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    provider_message_id text,
    error_message text,
    sent_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sms_delivery_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_delivery_archives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id text NOT NULL,
    payload jsonb NOT NULL,
    original_created_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    price integer NOT NULL,
    trial_days integer DEFAULT 0 NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    audience text DEFAULT 'salon'::text NOT NULL,
    course_limit integer,
    vat_included boolean DEFAULT false NOT NULL,
    price_copy text,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT subscription_plans_audience_check CHECK ((audience = ANY (ARRAY['salon'::text, 'education'::text]))),
    CONSTRAINT subscription_plans_course_limit_check CHECK (((course_limit IS NULL) OR (course_limit > 0)))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    status public.subscription_status DEFAULT 'trial'::public.subscription_status NOT NULL,
    due_amount integer NOT NULL,
    payment_method public.payment_method DEFAULT 'BANK_TRANSFER'::public.payment_method NOT NULL,
    current_period_end timestamp with time zone
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    scope public.supplier_scope DEFAULT 'BOTH'::public.supplier_scope NOT NULL,
    logo_url text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_push_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_push_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    subscription_id uuid NOT NULL,
    user_id uuid NOT NULL,
    payload jsonb NOT NULL,
    status public.system_push_delivery_status DEFAULT 'queued'::public.system_push_delivery_status NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    claim_token text,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    last_attempt_at timestamp with time zone,
    last_http_status integer,
    last_error text,
    sent_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: treatment_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treatment_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    price_in_dinars integer NOT NULL,
    session_count integer NOT NULL,
    validity_days integer DEFAULT 365 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    quota_policy text DEFAULT 'shared_pool'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: treatment_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treatment_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    salon_customer_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    employee_id uuid,
    uploaded_by_user_id uuid,
    kind public.treatment_photo_kind NOT NULL,
    media_asset_id uuid NOT NULL,
    consent_confirmed boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: treatment_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treatment_taxonomy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    taxonomy_key text NOT NULL,
    category_name text NOT NULL,
    treatment_name text NOT NULL,
    search_terms jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT treatment_taxonomy_key_check CHECK ((taxonomy_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text,
    phone_normalized text,
    date_of_birth date,
    active_salon_id uuid,
    password_hash text NOT NULL,
    password_set_at timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    role public.user_role DEFAULT 'CUSTOMER'::public.user_role NOT NULL,
    avatar_url text,
    active boolean DEFAULT true NOT NULL,
    marketing_emails_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aftercare_completion_events aftercare_completion_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_completion_events
    ADD CONSTRAINT aftercare_completion_events_pkey PRIMARY KEY (id);


--
-- Name: aftercare_deliveries aftercare_deliveries_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_deliveries
    ADD CONSTRAINT aftercare_deliveries_event_key_unique UNIQUE (event_key);


--
-- Name: aftercare_deliveries aftercare_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_deliveries
    ADD CONSTRAINT aftercare_deliveries_pkey PRIMARY KEY (id);


--
-- Name: aftercare_recommendation_lines aftercare_recommendation_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_lines
    ADD CONSTRAINT aftercare_recommendation_lines_pkey PRIMARY KEY (id);


--
-- Name: aftercare_recommendations aftercare_recommendations_entitlement_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendations
    ADD CONSTRAINT aftercare_recommendations_entitlement_token_hash_unique UNIQUE (entitlement_token_hash);


--
-- Name: aftercare_recommendations aftercare_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendations
    ADD CONSTRAINT aftercare_recommendations_pkey PRIMARY KEY (id);


--
-- Name: aftercare_settings aftercare_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_settings
    ADD CONSTRAINT aftercare_settings_pkey PRIMARY KEY (id);


--
-- Name: appointment_add_ons appointment_add_ons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_add_ons
    ADD CONSTRAINT appointment_add_ons_pkey PRIMARY KEY (id);


--
-- Name: appointment_deposits appointment_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_deposits
    ADD CONSTRAINT appointment_deposits_pkey PRIMARY KEY (id);


--
-- Name: appointment_employees appointment_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_employees
    ADD CONSTRAINT appointment_employees_pkey PRIMARY KEY (id);


--
-- Name: appointment_resource_allocations appointment_resource_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_allocations
    ADD CONSTRAINT appointment_resource_allocations_pkey PRIMARY KEY (id);


--
-- Name: appointment_series appointment_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_series
    ADD CONSTRAINT appointment_series_pkey PRIMARY KEY (id);


--
-- Name: appointment_status_history appointment_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_status_history
    ADD CONSTRAINT appointment_status_history_pkey PRIMARY KEY (id);


--
-- Name: appointment_treatments appointment_treatments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_treatments
    ADD CONSTRAINT appointment_treatments_pkey PRIMARY KEY (id);


--
-- Name: appointment_waitlist appointment_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: automatic_xy_promotion_targets automatic_xy_promotion_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_xy_promotion_targets
    ADD CONSTRAINT automatic_xy_promotion_targets_pkey PRIMARY KEY (id);


--
-- Name: automatic_xy_promotions automatic_xy_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_xy_promotions
    ADD CONSTRAINT automatic_xy_promotions_pkey PRIMARY KEY (id);


--
-- Name: automation_deliveries automation_deliveries_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_deliveries
    ADD CONSTRAINT automation_deliveries_event_key_unique UNIQUE (event_key);


--
-- Name: automation_deliveries automation_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_deliveries
    ADD CONSTRAINT automation_deliveries_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: automation_runs automation_runs_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_event_key_unique UNIQUE (event_key);


--
-- Name: automation_runs automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);


--
-- Name: b2b_cart_imports b2b_cart_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_cart_imports
    ADD CONSTRAINT b2b_cart_imports_pkey PRIMARY KEY (id);


--
-- Name: b2b_invoice_sequences b2b_invoice_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_invoice_sequences
    ADD CONSTRAINT b2b_invoice_sequences_pkey PRIMARY KEY (year);


--
-- Name: b2b_quotes b2b_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_quotes
    ADD CONSTRAINT b2b_quotes_pkey PRIMARY KEY (id);


--
-- Name: b2c_display_settings b2c_display_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_display_settings
    ADD CONSTRAINT b2c_display_settings_pkey PRIMARY KEY (id);


--
-- Name: b2c_need_tags b2c_need_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_need_tags
    ADD CONSTRAINT b2c_need_tags_pkey PRIMARY KEY (id);


--
-- Name: b2c_product_types b2c_product_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_product_types
    ADD CONSTRAINT b2c_product_types_pkey PRIMARY KEY (id);


--
-- Name: b2c_promotional_banners b2c_promotional_banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_promotional_banners
    ADD CONSTRAINT b2c_promotional_banners_pkey PRIMARY KEY (id);


--
-- Name: b2c_recently_viewed_products b2c_recently_viewed_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_recently_viewed_products
    ADD CONSTRAINT b2c_recently_viewed_products_pkey PRIMARY KEY (id);


--
-- Name: beauty_glossary beauty_glossary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_glossary
    ADD CONSTRAINT beauty_glossary_pkey PRIMARY KEY (id);


--
-- Name: beauty_glossary beauty_glossary_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_glossary
    ADD CONSTRAINT beauty_glossary_slug_unique UNIQUE (slug);


--
-- Name: beauty_glossary beauty_glossary_term_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_glossary
    ADD CONSTRAINT beauty_glossary_term_unique UNIQUE (term);


--
-- Name: beauty_job_application_actions beauty_job_application_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_application_actions
    ADD CONSTRAINT beauty_job_application_actions_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_categories beauty_job_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_categories
    ADD CONSTRAINT beauty_job_categories_name_key UNIQUE (name);


--
-- Name: beauty_job_categories beauty_job_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_categories
    ADD CONSTRAINT beauty_job_categories_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_categories beauty_job_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_categories
    ADD CONSTRAINT beauty_job_categories_slug_key UNIQUE (slug);


--
-- Name: beauty_job_contacts beauty_job_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_contacts
    ADD CONSTRAINT beauty_job_contacts_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_listing_availability beauty_job_listing_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_listing_availability
    ADD CONSTRAINT beauty_job_listing_availability_pkey PRIMARY KEY (listing_id);


--
-- Name: beauty_job_listings beauty_job_listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_listings
    ADD CONSTRAINT beauty_job_listings_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_moderation_audit beauty_job_moderation_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_moderation_audit
    ADD CONSTRAINT beauty_job_moderation_audit_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_notifications beauty_job_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_notifications
    ADD CONSTRAINT beauty_job_notifications_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_platform_settings beauty_job_platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_platform_settings
    ADD CONSTRAINT beauty_job_platform_settings_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_rental_requests beauty_job_rental_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_rental_requests
    ADD CONSTRAINT beauty_job_rental_requests_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_rental_slots beauty_job_rental_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_rental_slots
    ADD CONSTRAINT beauty_job_rental_slots_pkey PRIMARY KEY (id);


--
-- Name: beauty_job_reports beauty_job_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_reports
    ADD CONSTRAINT beauty_job_reports_pkey PRIMARY KEY (id);


--
-- Name: booking_command_receipts booking_command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_command_receipts
    ADD CONSTRAINT booking_command_receipts_pkey PRIMARY KEY (id);


--
-- Name: booking_groups booking_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_groups
    ADD CONSTRAINT booking_groups_pkey PRIMARY KEY (id);


--
-- Name: bulk_sale_campaign_targets bulk_sale_campaign_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_sale_campaign_targets
    ADD CONSTRAINT bulk_sale_campaign_targets_pkey PRIMARY KEY (id);


--
-- Name: bulk_sale_campaigns bulk_sale_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_sale_campaigns
    ADD CONSTRAINT bulk_sale_campaigns_pkey PRIMARY KEY (id);


--
-- Name: business_growth_schema_rollout business_growth_schema_rollout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_growth_schema_rollout
    ADD CONSTRAINT business_growth_schema_rollout_pkey PRIMARY KEY (singleton);


--
-- Name: business_verification_audits business_verification_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verification_audits
    ADD CONSTRAINT business_verification_audits_pkey PRIMARY KEY (id);


--
-- Name: cart_threshold_rewards cart_threshold_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_threshold_rewards
    ADD CONSTRAINT cart_threshold_rewards_pkey PRIMARY KEY (id);


--
-- Name: catalog_sync_runs catalog_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_sync_runs
    ADD CONSTRAINT catalog_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: commerce_customer_notifications commerce_customer_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_customer_notifications
    ADD CONSTRAINT commerce_customer_notifications_pkey PRIMARY KEY (id);


--
-- Name: commerce_experience_settings commerce_experience_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_experience_settings
    ADD CONSTRAINT commerce_experience_settings_pkey PRIMARY KEY (id);


--
-- Name: coupon_redemptions coupon_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_unique UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: courier_services courier_services_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courier_services
    ADD CONSTRAINT courier_services_code_unique UNIQUE (code);


--
-- Name: courier_services courier_services_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courier_services
    ADD CONSTRAINT courier_services_name_unique UNIQUE (name);


--
-- Name: courier_services courier_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courier_services
    ADD CONSTRAINT courier_services_pkey PRIMARY KEY (id);


--
-- Name: course_categories course_categories_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_categories
    ADD CONSTRAINT course_categories_name_unique UNIQUE (name);


--
-- Name: course_categories course_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_categories
    ADD CONSTRAINT course_categories_pkey PRIMARY KEY (id);


--
-- Name: course_categories course_categories_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_categories
    ADD CONSTRAINT course_categories_slug_unique UNIQUE (slug);


--
-- Name: course_days course_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_days
    ADD CONSTRAINT course_days_pkey PRIMARY KEY (id);


--
-- Name: course_enrollments course_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_pkey PRIMARY KEY (id);


--
-- Name: course_lessons course_lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_lessons
    ADD CONSTRAINT course_lessons_pkey PRIMARY KEY (id);


--
-- Name: course_modules course_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_modules
    ADD CONSTRAINT course_modules_pkey PRIMARY KEY (id);


--
-- Name: course_reviews course_reviews_enrollment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT course_reviews_enrollment_id_unique UNIQUE (enrollment_id);


--
-- Name: course_reviews course_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT course_reviews_pkey PRIMARY KEY (id);


--
-- Name: course_sessions course_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_sessions
    ADD CONSTRAINT course_sessions_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: customer_notes customer_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notes
    ADD CONSTRAINT customer_notes_pkey PRIMARY KEY (id);


--
-- Name: customer_notifications customer_notifications_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notifications
    ADD CONSTRAINT customer_notifications_event_key_unique UNIQUE (event_key);


--
-- Name: customer_notifications customer_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notifications
    ADD CONSTRAINT customer_notifications_pkey PRIMARY KEY (id);


--
-- Name: customer_package_purchases customer_package_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_package_purchases
    ADD CONSTRAINT customer_package_purchases_pkey PRIMARY KEY (id);


--
-- Name: customer_password_setup_audits customer_password_setup_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_password_setup_audits
    ADD CONSTRAINT customer_password_setup_audits_pkey PRIMARY KEY (id);


--
-- Name: customer_password_setup_tokens customer_password_setup_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_password_setup_tokens
    ADD CONSTRAINT customer_password_setup_tokens_pkey PRIMARY KEY (id);


--
-- Name: education_access_extensions education_access_extensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_access_extensions
    ADD CONSTRAINT education_access_extensions_pkey PRIMARY KEY (id);


--
-- Name: education_attendance education_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_attendance
    ADD CONSTRAINT education_attendance_pkey PRIMARY KEY (id);


--
-- Name: education_b2b_discount_audits education_b2b_discount_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_discount_audits
    ADD CONSTRAINT education_b2b_discount_audits_pkey PRIMARY KEY (id);


--
-- Name: education_b2b_discount_settings education_b2b_discount_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_discount_settings
    ADD CONSTRAINT education_b2b_discount_settings_pkey PRIMARY KEY (id);


--
-- Name: education_b2b_discount_tiers education_b2b_discount_tiers_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_discount_tiers
    ADD CONSTRAINT education_b2b_discount_tiers_no_overlap EXCLUDE USING gist (int8range((min_spend_rsd)::bigint,
CASE
    WHEN (max_spend_rsd IS NULL) THEN NULL::bigint
    ELSE ((max_spend_rsd)::bigint + 1)
END, '[)'::text) WITH &&);


--
-- Name: education_b2b_discount_tiers education_b2b_discount_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_discount_tiers
    ADD CONSTRAINT education_b2b_discount_tiers_pkey PRIMARY KEY (id);


--
-- Name: education_b2b_order_items education_b2b_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_order_items
    ADD CONSTRAINT education_b2b_order_items_pkey PRIMARY KEY (id);


--
-- Name: education_b2b_orders education_b2b_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_orders
    ADD CONSTRAINT education_b2b_orders_pkey PRIMARY KEY (id);


--
-- Name: education_bank_transactions education_bank_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bank_transactions
    ADD CONSTRAINT education_bank_transactions_pkey PRIMARY KEY (id);


--
-- Name: education_booking_groups education_booking_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_groups
    ADD CONSTRAINT education_booking_groups_pkey PRIMARY KEY (id);


--
-- Name: education_booking_participants education_booking_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_participants
    ADD CONSTRAINT education_booking_participants_pkey PRIMARY KEY (id);


--
-- Name: education_bundle_purchase_escrows education_bundle_purchase_escrows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_escrows
    ADD CONSTRAINT education_bundle_purchase_escrows_pkey PRIMARY KEY (id);


--
-- Name: education_bundle_purchase_escrows education_bundle_purchase_escrows_purchase_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_escrows
    ADD CONSTRAINT education_bundle_purchase_escrows_purchase_id_unique UNIQUE (purchase_id);


--
-- Name: education_bundle_purchase_items education_bundle_purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_items
    ADD CONSTRAINT education_bundle_purchase_items_pkey PRIMARY KEY (id);


--
-- Name: education_bundle_purchase_ledger_entries education_bundle_purchase_ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_ledger_entries
    ADD CONSTRAINT education_bundle_purchase_ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: education_bundle_purchases education_bundle_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_pkey PRIMARY KEY (id);


--
-- Name: education_bundles education_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundles
    ADD CONSTRAINT education_bundles_pkey PRIMARY KEY (id);


--
-- Name: education_center_reviews education_center_reviews_enrollment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_reviews
    ADD CONSTRAINT education_center_reviews_enrollment_id_unique UNIQUE (enrollment_id);


--
-- Name: education_center_reviews education_center_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_reviews
    ADD CONSTRAINT education_center_reviews_pkey PRIMARY KEY (id);


--
-- Name: education_center_staff education_center_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_staff
    ADD CONSTRAINT education_center_staff_pkey PRIMARY KEY (id);


--
-- Name: education_center_subscriptions education_center_subscriptions_center_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_subscriptions
    ADD CONSTRAINT education_center_subscriptions_center_id_unique UNIQUE (center_id);


--
-- Name: education_center_subscriptions education_center_subscriptions_payment_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_subscriptions
    ADD CONSTRAINT education_center_subscriptions_payment_reference_unique UNIQUE (payment_reference);


--
-- Name: education_center_subscriptions education_center_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_subscriptions
    ADD CONSTRAINT education_center_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: education_centers education_centers_payment_reference_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_centers
    ADD CONSTRAINT education_centers_payment_reference_number_unique UNIQUE (payment_reference_number);


--
-- Name: education_centers education_centers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_centers
    ADD CONSTRAINT education_centers_pkey PRIMARY KEY (id);


--
-- Name: education_contact_history education_contact_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_contact_history
    ADD CONSTRAINT education_contact_history_pkey PRIMARY KEY (id);


--
-- Name: education_course_metric_events education_course_metric_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_metric_events
    ADD CONSTRAINT education_course_metric_events_pkey PRIMARY KEY (id);


--
-- Name: education_course_types education_course_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_types
    ADD CONSTRAINT education_course_types_pkey PRIMARY KEY (id);


--
-- Name: education_custom_plan_requests education_custom_plan_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_custom_plan_requests
    ADD CONSTRAINT education_custom_plan_requests_pkey PRIMARY KEY (id);


--
-- Name: education_disputes education_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_disputes
    ADD CONSTRAINT education_disputes_pkey PRIMARY KEY (id);


--
-- Name: education_educator_absences education_educator_absences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_educator_absences
    ADD CONSTRAINT education_educator_absences_pkey PRIMARY KEY (id);


--
-- Name: education_educator_weekly_availability education_educator_weekly_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_educator_weekly_availability
    ADD CONSTRAINT education_educator_weekly_availability_pkey PRIMARY KEY (id);


--
-- Name: education_escrows education_escrows_enrollment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_escrows
    ADD CONSTRAINT education_escrows_enrollment_id_unique UNIQUE (enrollment_id);


--
-- Name: education_escrows education_escrows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_escrows
    ADD CONSTRAINT education_escrows_pkey PRIMARY KEY (id);


--
-- Name: education_featured_charges education_featured_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_featured_charges
    ADD CONSTRAINT education_featured_charges_pkey PRIMARY KEY (id);


--
-- Name: education_financial_audit_log education_financial_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_financial_audit_log
    ADD CONSTRAINT education_financial_audit_log_pkey PRIMARY KEY (id);


--
-- Name: education_financial_events education_financial_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_financial_events
    ADD CONSTRAINT education_financial_events_pkey PRIMARY KEY (id);


--
-- Name: education_gift_vouchers education_gift_vouchers_code_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_code_hash_unique UNIQUE (code_hash);


--
-- Name: education_gift_vouchers education_gift_vouchers_payment_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_payment_reference_unique UNIQUE (payment_reference);


--
-- Name: education_gift_vouchers education_gift_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_pkey PRIMARY KEY (id);


--
-- Name: education_gift_vouchers education_gift_vouchers_redeemed_enrollment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_redeemed_enrollment_id_unique UNIQUE (redeemed_enrollment_id);


--
-- Name: education_grace_notes education_grace_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_grace_notes
    ADD CONSTRAINT education_grace_notes_pkey PRIMARY KEY (id);


--
-- Name: education_inquiries education_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inquiries
    ADD CONSTRAINT education_inquiries_pkey PRIMARY KEY (id);


--
-- Name: education_installment_settlement_commands education_installment_settlement_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installment_settlement_commands
    ADD CONSTRAINT education_installment_settlement_commands_pkey PRIMARY KEY (id);


--
-- Name: education_installments education_installments_payment_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installments
    ADD CONSTRAINT education_installments_payment_reference_unique UNIQUE (payment_reference);


--
-- Name: education_installments education_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installments
    ADD CONSTRAINT education_installments_pkey PRIMARY KEY (id);


--
-- Name: education_instructors education_instructors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_instructors
    ADD CONSTRAINT education_instructors_pkey PRIMARY KEY (id);


--
-- Name: education_inventory_items education_inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_items
    ADD CONSTRAINT education_inventory_items_pkey PRIMARY KEY (id);


--
-- Name: education_inventory_movements education_inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_movements
    ADD CONSTRAINT education_inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: education_ledger_entries education_ledger_entries_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_ledger_entries
    ADD CONSTRAINT education_ledger_entries_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: education_ledger_entries education_ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_ledger_entries
    ADD CONSTRAINT education_ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: education_media education_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_media
    ADD CONSTRAINT education_media_pkey PRIMARY KEY (id);


--
-- Name: education_media_uploads education_media_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_media_uploads
    ADD CONSTRAINT education_media_uploads_pkey PRIMARY KEY (id);


--
-- Name: education_messages education_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_messages
    ADD CONSTRAINT education_messages_pkey PRIMARY KEY (id);


--
-- Name: education_notification_archives education_notification_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notification_archives
    ADD CONSTRAINT education_notification_archives_pkey PRIMARY KEY (id);


--
-- Name: education_notification_archives education_notification_archives_source_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notification_archives
    ADD CONSTRAINT education_notification_archives_source_id_unique UNIQUE (source_id);


--
-- Name: education_notifications education_notifications_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notifications
    ADD CONSTRAINT education_notifications_event_key_unique UNIQUE (event_key);


--
-- Name: education_notifications education_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notifications
    ADD CONSTRAINT education_notifications_pkey PRIMARY KEY (id);


--
-- Name: education_outbox education_outbox_dedupe_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_outbox
    ADD CONSTRAINT education_outbox_dedupe_key_unique UNIQUE (dedupe_key);


--
-- Name: education_outbox education_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_outbox
    ADD CONSTRAINT education_outbox_pkey PRIMARY KEY (id);


--
-- Name: education_payment_obligations education_payment_obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_pkey PRIMARY KEY (id);


--
-- Name: education_payment_obligations education_payment_obligations_reference_snapshot_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_reference_snapshot_unique UNIQUE (reference_snapshot);


--
-- Name: education_payouts education_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payouts
    ADD CONSTRAINT education_payouts_pkey PRIMARY KEY (id);


--
-- Name: education_placement_settings education_placement_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placement_settings
    ADD CONSTRAINT education_placement_settings_pkey PRIMARY KEY (id);


--
-- Name: education_placements education_placements_active_slot_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_active_slot_no_overlap EXCLUDE USING gist (kind WITH =, scope WITH =, scope_key WITH =, slot_number WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((status = 'active'::public.education_placement_status));


--
-- Name: education_placements education_placements_payment_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_payment_reference_unique UNIQUE (payment_reference);


--
-- Name: education_placements education_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_pkey PRIMARY KEY (id);


--
-- Name: education_platform_settings education_platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_platform_settings
    ADD CONSTRAINT education_platform_settings_pkey PRIMARY KEY (id);


--
-- Name: education_price_snapshots education_price_snapshots_booking_group_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_price_snapshots
    ADD CONSTRAINT education_price_snapshots_booking_group_id_unique UNIQUE (booking_group_id);


--
-- Name: education_price_snapshots education_price_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_price_snapshots
    ADD CONSTRAINT education_price_snapshots_pkey PRIMARY KEY (id);


--
-- Name: education_recurrence_commands education_recurrence_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_recurrence_commands
    ADD CONSTRAINT education_recurrence_commands_pkey PRIMARY KEY (id);


--
-- Name: education_resources education_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_resources
    ADD CONSTRAINT education_resources_pkey PRIMARY KEY (id);


--
-- Name: education_salon_cleanup_reports education_salon_cleanup_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_salon_cleanup_reports
    ADD CONSTRAINT education_salon_cleanup_reports_pkey PRIMARY KEY (version);


--
-- Name: education_sections education_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_sections
    ADD CONSTRAINT education_sections_pkey PRIMARY KEY (id);


--
-- Name: education_sections education_sections_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_sections
    ADD CONSTRAINT education_sections_slug_unique UNIQUE (slug);


--
-- Name: education_session_educators education_session_educators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_educators
    ADD CONSTRAINT education_session_educators_pkey PRIMARY KEY (id);


--
-- Name: education_session_educators education_session_educators_session_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_educators
    ADD CONSTRAINT education_session_educators_session_id_unique UNIQUE (session_id);


--
-- Name: education_session_resources education_session_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_resources
    ADD CONSTRAINT education_session_resources_pkey PRIMARY KEY (id);


--
-- Name: education_subcategories education_subcategories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_subcategories
    ADD CONSTRAINT education_subcategories_pkey PRIMARY KEY (id);


--
-- Name: education_threads education_threads_enrollment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_threads
    ADD CONSTRAINT education_threads_enrollment_id_unique UNIQUE (enrollment_id);


--
-- Name: education_threads education_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_threads
    ADD CONSTRAINT education_threads_pkey PRIMARY KEY (id);


--
-- Name: education_trial_claims education_trial_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_trial_claims
    ADD CONSTRAINT education_trial_claims_pkey PRIMARY KEY (id);


--
-- Name: education_waitlist education_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_waitlist
    ADD CONSTRAINT education_waitlist_pkey PRIMARY KEY (id);


--
-- Name: education_wishlists education_wishlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_wishlists
    ADD CONSTRAINT education_wishlists_pkey PRIMARY KEY (id);


--
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);


--
-- Name: email_deliveries email_deliveries_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_event_key_unique UNIQUE (event_key);


--
-- Name: email_deliveries email_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY (id);


--
-- Name: employee_clock_entries employee_clock_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_clock_entries
    ADD CONSTRAINT employee_clock_entries_pkey PRIMARY KEY (id);


--
-- Name: employee_commission_settings employee_commission_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_settings
    ADD CONSTRAINT employee_commission_settings_pkey PRIMARY KEY (id);


--
-- Name: employee_leave_requests employee_leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_requests
    ADD CONSTRAINT employee_leave_requests_pkey PRIMARY KEY (id);


--
-- Name: employee_location_assignments employee_location_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_location_assignments
    ADD CONSTRAINT employee_location_assignments_pkey PRIMARY KEY (id);


--
-- Name: employee_location_schedules employee_location_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_location_schedules
    ADD CONSTRAINT employee_location_schedules_pkey PRIMARY KEY (id);


--
-- Name: employee_ratings employee_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_ratings
    ADD CONSTRAINT employee_ratings_pkey PRIMARY KEY (id);


--
-- Name: employee_schedules employee_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_schedules
    ADD CONSTRAINT employee_schedules_pkey PRIMARY KEY (id);


--
-- Name: employee_services employee_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_services
    ADD CONSTRAINT employee_services_pkey PRIMARY KEY (id);


--
-- Name: employee_time_off employee_time_off_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_time_off
    ADD CONSTRAINT employee_time_off_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: favorite_employees favorite_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_employees
    ADD CONSTRAINT favorite_employees_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: image_assets image_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_pkey PRIMARY KEY (id);


--
-- Name: image_assets image_assets_staging_object_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_staging_object_path_unique UNIQUE (staging_object_path);


--
-- Name: inspiration_items inspiration_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspiration_items
    ADD CONSTRAINT inspiration_items_pkey PRIMARY KEY (id);


--
-- Name: integration_settings integration_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_settings
    ADD CONSTRAINT integration_settings_pkey PRIMARY KEY (id);


--
-- Name: jobseeker_profiles jobseeker_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobseeker_profiles
    ADD CONSTRAINT jobseeker_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: legal_entities legal_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_pkey PRIMARY KEY (id);


--
-- Name: legal_entity_businesses legal_entity_businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_businesses
    ADD CONSTRAINT legal_entity_businesses_pkey PRIMARY KEY (id);


--
-- Name: lesson_progress lesson_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_pkey PRIMARY KEY (id);


--
-- Name: loyalty_point_ledger loyalty_point_ledger_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_point_ledger
    ADD CONSTRAINT loyalty_point_ledger_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: loyalty_point_ledger loyalty_point_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_point_ledger
    ADD CONSTRAINT loyalty_point_ledger_pkey PRIMARY KEY (id);


--
-- Name: loyalty_pricing_tiers loyalty_pricing_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_pricing_tiers
    ADD CONSTRAINT loyalty_pricing_tiers_pkey PRIMARY KEY (id);


--
-- Name: loyalty_tiers loyalty_tiers_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_name_unique UNIQUE (name);


--
-- Name: loyalty_tiers loyalty_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_pkey PRIMARY KEY (id);


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);


--
-- Name: media_upload_tickets media_upload_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_upload_tickets
    ADD CONSTRAINT media_upload_tickets_pkey PRIMARY KEY (id);


--
-- Name: media_variants media_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_variants
    ADD CONSTRAINT media_variants_pkey PRIMARY KEY (id);


--
-- Name: oauth_identities oauth_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_identities
    ADD CONSTRAINT oauth_identities_pkey PRIMARY KEY (id);


--
-- Name: oauth_login_states oauth_login_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_login_states
    ADD CONSTRAINT oauth_login_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_login_states oauth_login_states_state_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_login_states
    ADD CONSTRAINT oauth_login_states_state_unique UNIQUE (state);


--
-- Name: order_approval_request_lines order_approval_request_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_request_lines
    ADD CONSTRAINT order_approval_request_lines_pkey PRIMARY KEY (id);


--
-- Name: order_approval_requests order_approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_pkey PRIMARY KEY (id);


--
-- Name: order_bundle_components order_bundle_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_bundle_components
    ADD CONSTRAINT order_bundle_components_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: orders orders_invoice_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_invoice_number_unique UNIQUE (invoice_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: package_purchase_service_links package_purchase_service_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_purchase_service_links
    ADD CONSTRAINT package_purchase_service_links_pkey PRIMARY KEY (id);


--
-- Name: package_redemptions package_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_pkey PRIMARY KEY (id);


--
-- Name: package_service_links package_service_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_service_links
    ADD CONSTRAINT package_service_links_pkey PRIMARY KEY (id);


--
-- Name: phone_verification_codes phone_verification_codes_phone_normalized_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_verification_codes
    ADD CONSTRAINT phone_verification_codes_phone_normalized_unique UNIQUE (phone_normalized);


--
-- Name: phone_verification_codes phone_verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_verification_codes
    ADD CONSTRAINT phone_verification_codes_pkey PRIMARY KEY (id);


--
-- Name: phone_verification_proofs phone_verification_proofs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_verification_proofs
    ADD CONSTRAINT phone_verification_proofs_pkey PRIMARY KEY (id);


--
-- Name: platform_retention_settings platform_retention_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_retention_settings
    ADD CONSTRAINT platform_retention_settings_pkey PRIMARY KEY (id);


--
-- Name: price_inquiries price_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inquiries
    ADD CONSTRAINT price_inquiries_pkey PRIMARY KEY (id);


--
-- Name: product_brands product_brands_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_brands
    ADD CONSTRAINT product_brands_name_unique UNIQUE (name);


--
-- Name: product_brands product_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_brands
    ADD CONSTRAINT product_brands_pkey PRIMARY KEY (id);


--
-- Name: product_brands product_brands_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_brands
    ADD CONSTRAINT product_brands_slug_unique UNIQUE (slug);


--
-- Name: product_bundle_components product_bundle_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundle_components
    ADD CONSTRAINT product_bundle_components_pkey PRIMARY KEY (id);


--
-- Name: product_bundles product_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundles
    ADD CONSTRAINT product_bundles_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- Name: product_documents product_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_documents
    ADD CONSTRAINT product_documents_pkey PRIMARY KEY (id);


--
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);


--
-- Name: product_upsell_links product_upsell_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_upsell_links
    ADD CONSTRAINT product_upsell_links_pkey PRIMARY KEY (id);


--
-- Name: product_waitlist_notification_outbox product_waitlist_notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist_notification_outbox
    ADD CONSTRAINT product_waitlist_notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: product_waitlist_notification_outbox product_waitlist_notification_outbox_waitlist_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist_notification_outbox
    ADD CONSTRAINT product_waitlist_notification_outbox_waitlist_id_unique UNIQUE (waitlist_id);


--
-- Name: product_waitlist product_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist
    ADD CONSTRAINT product_waitlist_pkey PRIMARY KEY (id);


--
-- Name: product_wishlists product_wishlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_wishlists
    ADD CONSTRAINT product_wishlists_pkey PRIMARY KEY (id);


--
-- Name: product_wishlists product_wishlists_user_product_variant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_wishlists
    ADD CONSTRAINT product_wishlists_user_product_variant_unique UNIQUE NULLS NOT DISTINCT (user_id, product_id, variant_value);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_unique UNIQUE (sku);


--
-- Name: provider_webhook_receipts provider_webhook_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_webhook_receipts
    ADD CONSTRAINT provider_webhook_receipts_pkey PRIMARY KEY (provider);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: referral_attributions referral_attributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_pkey PRIMARY KEY (id);


--
-- Name: referral_codes referral_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_pkey PRIMARY KEY (id);


--
-- Name: referral_credit_ledger referral_credit_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_ledger
    ADD CONSTRAINT referral_credit_ledger_pkey PRIMARY KEY (id);


--
-- Name: referral_credit_redemptions referral_credit_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_redemptions
    ADD CONSTRAINT referral_credit_redemptions_pkey PRIMARY KEY (id);


--
-- Name: referral_milestone_benefits referral_milestone_benefits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_milestone_benefits
    ADD CONSTRAINT referral_milestone_benefits_pkey PRIMARY KEY (id);


--
-- Name: referral_qualification_evidence referral_qualification_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualification_evidence
    ADD CONSTRAINT referral_qualification_evidence_pkey PRIMARY KEY (id);


--
-- Name: referral_qualifications referral_qualifications_attribution_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualifications
    ADD CONSTRAINT referral_qualifications_attribution_id_unique UNIQUE (attribution_id);


--
-- Name: referral_qualifications referral_qualifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualifications
    ADD CONSTRAINT referral_qualifications_pkey PRIMARY KEY (id);


--
-- Name: referral_reviews referral_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_reviews
    ADD CONSTRAINT referral_reviews_pkey PRIMARY KEY (id);


--
-- Name: reorder_actions reorder_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reorder_actions
    ADD CONSTRAINT reorder_actions_pkey PRIMARY KEY (id);


--
-- Name: retail_cart_items retail_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_cart_items
    ADD CONSTRAINT retail_cart_items_pkey PRIMARY KEY (id);


--
-- Name: retail_carts retail_carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_carts
    ADD CONSTRAINT retail_carts_pkey PRIMARY KEY (id);


--
-- Name: retail_carts retail_carts_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_carts
    ADD CONSTRAINT retail_carts_token_hash_unique UNIQUE (token_hash);


--
-- Name: retail_order_items retail_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_order_items
    ADD CONSTRAINT retail_order_items_pkey PRIMARY KEY (id);


--
-- Name: retail_order_status_history retail_order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_order_status_history
    ADD CONSTRAINT retail_order_status_history_pkey PRIMARY KEY (id);


--
-- Name: retail_orders retail_orders_order_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_orders
    ADD CONSTRAINT retail_orders_order_number_unique UNIQUE (order_number);


--
-- Name: retail_orders retail_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_orders
    ADD CONSTRAINT retail_orders_pkey PRIMARY KEY (id);


--
-- Name: retail_orders retail_orders_tracking_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_orders
    ADD CONSTRAINT retail_orders_tracking_token_hash_unique UNIQUE (tracking_token_hash);


--
-- Name: retail_product_review_attachments retail_product_review_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_attachments
    ADD CONSTRAINT retail_product_review_attachments_pkey PRIMARY KEY (id);


--
-- Name: retail_product_review_moderation_audits retail_product_review_moderation_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_moderation_audits
    ADD CONSTRAINT retail_product_review_moderation_audits_pkey PRIMARY KEY (id);


--
-- Name: retail_product_review_reports retail_product_review_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_reports
    ADD CONSTRAINT retail_product_review_reports_pkey PRIMARY KEY (id);


--
-- Name: retail_product_reviews retail_product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_reviews
    ADD CONSTRAINT retail_product_reviews_pkey PRIMARY KEY (id);


--
-- Name: retail_product_subscription_attempts retail_product_subscription_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_subscription_attempts
    ADD CONSTRAINT retail_product_subscription_attempts_pkey PRIMARY KEY (id);


--
-- Name: retail_product_subscriptions retail_product_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_subscriptions
    ADD CONSTRAINT retail_product_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: retail_tracking_rate_limits retail_tracking_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_tracking_rate_limits
    ADD CONSTRAINT retail_tracking_rate_limits_pkey PRIMARY KEY (client_key_hash);


--
-- Name: review_invitations review_invitations_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_invitations
    ADD CONSTRAINT review_invitations_event_key_unique UNIQUE (event_key);


--
-- Name: review_invitations review_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_invitations
    ADD CONSTRAINT review_invitations_pkey PRIMARY KEY (id);


--
-- Name: review_reward_issuances review_reward_issuances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_reward_issuances
    ADD CONSTRAINT review_reward_issuances_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: rma_attachments rma_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_attachments
    ADD CONSTRAINT rma_attachments_pkey PRIMARY KEY (id);


--
-- Name: rma_status_history rma_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_status_history
    ADD CONSTRAINT rma_status_history_pkey PRIMARY KEY (id);


--
-- Name: rmas rmas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmas
    ADD CONSTRAINT rmas_pkey PRIMARY KEY (id);


--
-- Name: salon_booking_settings salon_booking_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_booking_settings
    ADD CONSTRAINT salon_booking_settings_pkey PRIMARY KEY (salon_id);


--
-- Name: salon_brands salon_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_brands
    ADD CONSTRAINT salon_brands_pkey PRIMARY KEY (id);


--
-- Name: salon_customers salon_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_customers
    ADD CONSTRAINT salon_customers_pkey PRIMARY KEY (id);


--
-- Name: salon_date_hours salon_date_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_date_hours
    ADD CONSTRAINT salon_date_hours_pkey PRIMARY KEY (id);


--
-- Name: salon_hours salon_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_hours
    ADD CONSTRAINT salon_hours_pkey PRIMARY KEY (id);


--
-- Name: salon_inventory_movements salon_inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: salon_inventory salon_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory
    ADD CONSTRAINT salon_inventory_pkey PRIMARY KEY (id);


--
-- Name: salon_location_creation_requests salon_location_creation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_location_creation_requests
    ADD CONSTRAINT salon_location_creation_requests_pkey PRIMARY KEY (id);


--
-- Name: salon_loyalty_statuses salon_loyalty_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_loyalty_statuses
    ADD CONSTRAINT salon_loyalty_statuses_pkey PRIMARY KEY (id);


--
-- Name: salon_loyalty_statuses salon_loyalty_statuses_salon_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_loyalty_statuses
    ADD CONSTRAINT salon_loyalty_statuses_salon_id_unique UNIQUE (salon_id);


--
-- Name: salon_notification_archives salon_notification_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_notification_archives
    ADD CONSTRAINT salon_notification_archives_pkey PRIMARY KEY (id);


--
-- Name: salon_notification_archives salon_notification_archives_source_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_notification_archives
    ADD CONSTRAINT salon_notification_archives_source_id_unique UNIQUE (source_id);


--
-- Name: salon_notifications salon_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_notifications
    ADD CONSTRAINT salon_notifications_pkey PRIMARY KEY (id);


--
-- Name: salon_resource_downtime salon_resource_downtime_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_resource_downtime
    ADD CONSTRAINT salon_resource_downtime_pkey PRIMARY KEY (id);


--
-- Name: salon_resources salon_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_resources
    ADD CONSTRAINT salon_resources_pkey PRIMARY KEY (id);


--
-- Name: salons salons_payment_reference_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salons
    ADD CONSTRAINT salons_payment_reference_number_unique UNIQUE (payment_reference_number);


--
-- Name: salons salons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salons
    ADD CONSTRAINT salons_pkey PRIMARY KEY (id);


--
-- Name: salons salons_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salons
    ADD CONSTRAINT salons_slug_unique UNIQUE (slug);


--
-- Name: saved_retail_cart_items saved_retail_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_retail_cart_items
    ADD CONSTRAINT saved_retail_cart_items_pkey PRIMARY KEY (id);


--
-- Name: saved_shop_cart_items saved_shop_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_shop_cart_items
    ADD CONSTRAINT saved_shop_cart_items_pkey PRIMARY KEY (id);


--
-- Name: service_add_on_resource_requirements service_add_on_resource_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_add_on_resource_requirements
    ADD CONSTRAINT service_add_on_resource_requirements_pkey PRIMARY KEY (id);


--
-- Name: service_add_ons service_add_ons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_add_ons
    ADD CONSTRAINT service_add_ons_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_name_unique UNIQUE (name);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_slug_unique UNIQUE (slug);


--
-- Name: service_product_consumptions service_product_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_product_consumptions
    ADD CONSTRAINT service_product_consumptions_pkey PRIMARY KEY (id);


--
-- Name: service_resource_requirements service_resource_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource_requirements
    ADD CONSTRAINT service_resource_requirements_pkey PRIMARY KEY (id);


--
-- Name: service_templates service_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_templates
    ADD CONSTRAINT service_templates_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash);


--
-- Name: shift_swap_requests shift_swap_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_pkey PRIMARY KEY (id);


--
-- Name: shipping_rules shipping_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rules
    ADD CONSTRAINT shipping_rules_pkey PRIMARY KEY (id);


--
-- Name: shop_settings shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_settings
    ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (id);


--
-- Name: shopping_cart_items shopping_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_cart_items
    ADD CONSTRAINT shopping_cart_items_pkey PRIMARY KEY (id);


--
-- Name: shopping_carts shopping_carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_carts
    ADD CONSTRAINT shopping_carts_pkey PRIMARY KEY (id);


--
-- Name: shopping_carts shopping_carts_salon_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_carts
    ADD CONSTRAINT shopping_carts_salon_id_unique UNIQUE (salon_id);


--
-- Name: sms_deliveries sms_deliveries_event_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_deliveries
    ADD CONSTRAINT sms_deliveries_event_key_unique UNIQUE (event_key);


--
-- Name: sms_deliveries sms_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_deliveries
    ADD CONSTRAINT sms_deliveries_pkey PRIMARY KEY (id);


--
-- Name: sms_delivery_archives sms_delivery_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_delivery_archives
    ADD CONSTRAINT sms_delivery_archives_pkey PRIMARY KEY (id);


--
-- Name: sms_delivery_archives sms_delivery_archives_source_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_delivery_archives
    ADD CONSTRAINT sms_delivery_archives_source_id_unique UNIQUE (source_id);


--
-- Name: subscription_plans subscription_plans_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_name_unique UNIQUE (name);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_slug_unique UNIQUE (slug);


--
-- Name: system_push_deliveries system_push_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_push_deliveries
    ADD CONSTRAINT system_push_deliveries_pkey PRIMARY KEY (id);


--
-- Name: treatment_packages treatment_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_packages
    ADD CONSTRAINT treatment_packages_pkey PRIMARY KEY (id);


--
-- Name: treatment_photos treatment_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_photos
    ADD CONSTRAINT treatment_photos_pkey PRIMARY KEY (id);


--
-- Name: treatment_taxonomy treatment_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_taxonomy
    ADD CONSTRAINT treatment_taxonomy_pkey PRIMARY KEY (id);


--
-- Name: treatment_taxonomy treatment_taxonomy_taxonomy_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_taxonomy
    ADD CONSTRAINT treatment_taxonomy_taxonomy_key_unique UNIQUE (taxonomy_key);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: aftercare_completion_events_customer_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_completion_events_customer_user_idx ON public.aftercare_completion_events USING btree (customer_user_id);


--
-- Name: aftercare_completion_events_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_completion_events_due_idx ON public.aftercare_completion_events USING btree (processed_at, available_at, claim_expires_at);


--
-- Name: aftercare_completion_events_transition_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_completion_events_transition_unique ON public.aftercare_completion_events USING btree (appointment_id, transition_key);


--
-- Name: aftercare_deliveries_campaign_kind_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_deliveries_campaign_kind_unique ON public.aftercare_deliveries USING btree (recommendation_id, kind) WHERE (line_id IS NULL);


--
-- Name: aftercare_deliveries_due_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_deliveries_due_claim_idx ON public.aftercare_deliveries USING btree (status, scheduled_at, claim_expires_at);


--
-- Name: aftercare_deliveries_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_deliveries_line_idx ON public.aftercare_deliveries USING btree (line_id);


--
-- Name: aftercare_deliveries_line_kind_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_deliveries_line_kind_unique ON public.aftercare_deliveries USING btree (recommendation_id, line_id, kind) WHERE (line_id IS NOT NULL);


--
-- Name: aftercare_deliveries_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_deliveries_provider_idx ON public.aftercare_deliveries USING btree (provider_message_id);


--
-- Name: aftercare_recommendation_appointments_appointment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_recommendation_appointments_appointment_unique ON public.aftercare_recommendation_appointments USING btree (appointment_id);


--
-- Name: aftercare_recommendation_appointments_recommendation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_appointments_recommendation_idx ON public.aftercare_recommendation_appointments USING btree (recommendation_id);


--
-- Name: aftercare_recommendation_appointments_treatment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_appointments_treatment_idx ON public.aftercare_recommendation_appointments USING btree (treatment_id);


--
-- Name: aftercare_recommendation_lines_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_lines_bundle_idx ON public.aftercare_recommendation_lines USING btree (bundle_id);


--
-- Name: aftercare_recommendation_lines_bundle_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_recommendation_lines_bundle_unique ON public.aftercare_recommendation_lines USING btree (recommendation_id, bundle_id) WHERE (kind = 'PREMADE_BUNDLE'::public.aftercare_line_kind);


--
-- Name: aftercare_recommendation_lines_personalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_recommendation_lines_personalized_unique ON public.aftercare_recommendation_lines USING btree (recommendation_id) WHERE (kind = 'PERSONALIZED_BUNDLE'::public.aftercare_line_kind);


--
-- Name: aftercare_recommendation_lines_product_cooldown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_lines_product_cooldown_idx ON public.aftercare_recommendation_lines USING btree (product_id, purchased_at);


--
-- Name: aftercare_recommendation_lines_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_recommendation_lines_product_unique ON public.aftercare_recommendation_lines USING btree (recommendation_id, product_id) WHERE (kind = 'PRODUCT'::public.aftercare_line_kind);


--
-- Name: aftercare_recommendation_lines_purchased_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_lines_purchased_order_idx ON public.aftercare_recommendation_lines USING btree (purchased_order_id);


--
-- Name: aftercare_recommendation_lines_replenishment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_lines_replenishment_idx ON public.aftercare_recommendation_lines USING btree (replenishment_sent_at, replenishment_due_at);


--
-- Name: aftercare_recommendation_lines_stats_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendation_lines_stats_idx ON public.aftercare_recommendation_lines USING btree (product_id, created_at);


--
-- Name: aftercare_recommendations_conversion_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendations_conversion_order_idx ON public.aftercare_recommendations USING btree (converted_order_id);


--
-- Name: aftercare_recommendations_customer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendations_customer_created_idx ON public.aftercare_recommendations USING btree (customer_user_id, created_at);


--
-- Name: aftercare_recommendations_stats_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_recommendations_stats_idx ON public.aftercare_recommendations USING btree (created_at, status, converted_at);


--
-- Name: aftercare_settings_created_by_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aftercare_settings_created_by_user_idx ON public.aftercare_settings USING btree (created_by_user_id);


--
-- Name: aftercare_settings_current_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_settings_current_unique ON public.aftercare_settings USING btree (is_current) WHERE is_current;


--
-- Name: aftercare_settings_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aftercare_settings_version_unique ON public.aftercare_settings USING btree (version);


--
-- Name: appointment_add_ons_add_on_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_add_ons_add_on_idx ON public.appointment_add_ons USING btree (add_on_id);


--
-- Name: appointment_add_ons_appointment_add_on_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_add_ons_appointment_add_on_unique ON public.appointment_add_ons USING btree (appointment_id, add_on_id);


--
-- Name: appointment_add_ons_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_add_ons_appointment_idx ON public.appointment_add_ons USING btree (appointment_id);


--
-- Name: appointment_deposits_appointment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_deposits_appointment_unique ON public.appointment_deposits USING btree (appointment_id);


--
-- Name: appointment_deposits_salon_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_deposits_salon_status_idx ON public.appointment_deposits USING btree (salon_id, status);


--
-- Name: appointment_deposits_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_deposits_settled_by_idx ON public.appointment_deposits USING btree (settled_by_user_id);


--
-- Name: appointment_employees_appointment_employee_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_employees_appointment_employee_unique ON public.appointment_employees USING btree (appointment_id, employee_id);


--
-- Name: appointment_employees_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_employees_appointment_idx ON public.appointment_employees USING btree (appointment_id);


--
-- Name: appointment_employees_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_employees_employee_idx ON public.appointment_employees USING btree (employee_id);


--
-- Name: appointment_resource_allocations_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_resource_allocations_appointment_idx ON public.appointment_resource_allocations USING btree (appointment_id);


--
-- Name: appointment_resource_allocations_appt_resource_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_resource_allocations_appt_resource_unique ON public.appointment_resource_allocations USING btree (appointment_id, resource_id);


--
-- Name: appointment_resource_allocations_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_resource_allocations_resource_idx ON public.appointment_resource_allocations USING btree (resource_id);


--
-- Name: appointment_series_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_series_created_by_idx ON public.appointment_series USING btree (created_by_user_id);


--
-- Name: appointment_series_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_series_employee_idx ON public.appointment_series USING btree (employee_id);


--
-- Name: appointment_series_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_series_salon_created_idx ON public.appointment_series USING btree (salon_id, created_at);


--
-- Name: appointment_series_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_series_salon_customer_idx ON public.appointment_series USING btree (salon_customer_id);


--
-- Name: appointment_series_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_series_service_idx ON public.appointment_series USING btree (service_id);


--
-- Name: appointment_status_history_appt_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_status_history_appt_created_idx ON public.appointment_status_history USING btree (appointment_id, created_at);


--
-- Name: appointment_status_history_changed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_status_history_changed_by_idx ON public.appointment_status_history USING btree (changed_by_user_id);


--
-- Name: appointment_treatments_appointment_position_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_treatments_appointment_position_unique ON public.appointment_treatments USING btree (appointment_id, "position");


--
-- Name: appointment_treatments_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_treatments_employee_idx ON public.appointment_treatments USING btree (employee_id);


--
-- Name: appointment_treatments_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_treatments_service_idx ON public.appointment_treatments USING btree (service_id);


--
-- Name: appointment_waitlist_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_waitlist_customer_idx ON public.appointment_waitlist USING btree (customer_id);


--
-- Name: appointment_waitlist_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_waitlist_employee_idx ON public.appointment_waitlist USING btree (employee_id);


--
-- Name: appointment_waitlist_live_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_waitlist_live_unique ON public.appointment_waitlist USING btree (salon_id, service_id, customer_id, desired_date) WHERE (status = ANY (ARRAY['waiting'::public.appointment_waitlist_status, 'notified'::public.appointment_waitlist_status]));


--
-- Name: appointment_waitlist_salon_date_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_waitlist_salon_date_status_idx ON public.appointment_waitlist USING btree (salon_id, desired_date, status);


--
-- Name: appointment_waitlist_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_waitlist_service_idx ON public.appointment_waitlist USING btree (service_id);


--
-- Name: appointments_arrived_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_arrived_by_idx ON public.appointments USING btree (arrived_by_user_id);


--
-- Name: appointments_booking_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_booking_group_idx ON public.appointments USING btree (booking_group_id);


--
-- Name: appointments_cancelled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_cancelled_by_idx ON public.appointments USING btree (cancelled_by_user_id);


--
-- Name: appointments_completed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_completed_by_idx ON public.appointments USING btree (completed_by_user_id);


--
-- Name: appointments_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_created_by_idx ON public.appointments USING btree (created_by_user_id);


--
-- Name: appointments_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_customer_idx ON public.appointments USING btree (customer_id);


--
-- Name: appointments_employee_date_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_employee_date_status_idx ON public.appointments USING btree (employee_id, appointment_date, status);


--
-- Name: appointments_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_employee_idx ON public.appointments USING btree (employee_id);


--
-- Name: appointments_no_show_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_no_show_by_idx ON public.appointments USING btree (no_show_by_user_id);


--
-- Name: appointments_salon_customer_completed_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_salon_customer_completed_date_idx ON public.appointments USING btree (salon_customer_id, appointment_date) WHERE (status = 'completed'::public.appointment_status);


--
-- Name: appointments_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_salon_customer_idx ON public.appointments USING btree (salon_customer_id);


--
-- Name: appointments_schedule_lookup_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_schedule_lookup_index ON public.appointments USING btree (salon_id, appointment_date, employee_id, status);


--
-- Name: appointments_series_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_series_idx ON public.appointments USING btree (series_id);


--
-- Name: appointments_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_service_idx ON public.appointments USING btree (service_id);


--
-- Name: appointments_started_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_started_by_idx ON public.appointments USING btree (started_by_user_id);


--
-- Name: appointments_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_updated_by_idx ON public.appointments USING btree (updated_by_user_id);


--
-- Name: automatic_xy_promotions_market_status_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automatic_xy_promotions_market_status_schedule_idx ON public.automatic_xy_promotions USING btree (market, status, starts_at, ends_at);


--
-- Name: automatic_xy_targets_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automatic_xy_targets_category_idx ON public.automatic_xy_promotion_targets USING btree (category_id);


--
-- Name: automatic_xy_targets_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automatic_xy_targets_product_idx ON public.automatic_xy_promotion_targets USING btree (product_id);


--
-- Name: automatic_xy_targets_role_category_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automatic_xy_targets_role_category_unique ON public.automatic_xy_promotion_targets USING btree (promotion_id, target_role, category_id) WHERE (category_id IS NOT NULL);


--
-- Name: automatic_xy_targets_role_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automatic_xy_targets_role_product_unique ON public.automatic_xy_promotion_targets USING btree (promotion_id, target_role, product_id) WHERE (product_id IS NOT NULL);


--
-- Name: automation_deliveries_claim_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_deliveries_claim_expiry_idx ON public.automation_deliveries USING btree (status, claim_expires_at);


--
-- Name: automation_deliveries_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_deliveries_run_idx ON public.automation_deliveries USING btree (run_id);


--
-- Name: automation_deliveries_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_deliveries_salon_created_idx ON public.automation_deliveries USING btree (salon_id, created_at);


--
-- Name: automation_rules_salon_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_rules_salon_status_idx ON public.automation_rules USING btree (salon_id, status);


--
-- Name: automation_runs_attributed_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_attributed_appointment_idx ON public.automation_runs USING btree (attributed_appointment_id);


--
-- Name: automation_runs_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_attribution_idx ON public.automation_runs USING btree (salon_id, salon_customer_id, status);


--
-- Name: automation_runs_cooldown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_cooldown_idx ON public.automation_runs USING btree (rule_id, salon_customer_id, sent_at);


--
-- Name: automation_runs_rule_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_rule_customer_idx ON public.automation_runs USING btree (rule_id, salon_customer_id);


--
-- Name: automation_runs_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_salon_created_idx ON public.automation_runs USING btree (salon_id, created_at);


--
-- Name: automation_runs_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_salon_customer_idx ON public.automation_runs USING btree (salon_customer_id);


--
-- Name: b2b_cart_imports_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2b_cart_imports_cart_idx ON public.b2b_cart_imports USING btree (cart_id);


--
-- Name: b2b_cart_imports_salon_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2b_cart_imports_salon_idempotency_unique ON public.b2b_cart_imports USING btree (salon_id, idempotency_key);


--
-- Name: b2b_quotes_public_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2b_quotes_public_id_unique ON public.b2b_quotes USING btree (public_id);


--
-- Name: b2b_quotes_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2b_quotes_salon_created_idx ON public.b2b_quotes USING btree (salon_id, created_at);


--
-- Name: b2b_quotes_source_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2b_quotes_source_cart_idx ON public.b2b_quotes USING btree (source_cart_id);


--
-- Name: b2c_banners_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_banners_category_idx ON public.b2c_promotional_banners USING btree (destination_category_id);


--
-- Name: b2c_banners_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_banners_created_by_idx ON public.b2c_promotional_banners USING btree (created_by_user_id);


--
-- Name: b2c_banners_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_banners_product_idx ON public.b2c_promotional_banners USING btree (destination_product_id);


--
-- Name: b2c_banners_supplier_window_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_banners_supplier_window_sort_idx ON public.b2c_promotional_banners USING btree (supplier_id, active, placement, starts_at, ends_at, sort_order, id);


--
-- Name: b2c_banners_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_banners_updated_by_idx ON public.b2c_promotional_banners USING btree (updated_by_user_id);


--
-- Name: b2c_display_settings_singleton_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2c_display_settings_singleton_unique ON public.b2c_display_settings USING btree ((true));


--
-- Name: b2c_display_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_display_settings_updated_by_idx ON public.b2c_display_settings USING btree (updated_by_user_id);


--
-- Name: b2c_need_tags_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_need_tags_active_sort_idx ON public.b2c_need_tags USING btree (active, sort_order, id);


--
-- Name: b2c_need_tags_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_need_tags_created_by_idx ON public.b2c_need_tags USING btree (created_by_user_id);


--
-- Name: b2c_need_tags_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2c_need_tags_key_unique ON public.b2c_need_tags USING btree (key);


--
-- Name: b2c_need_tags_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_need_tags_updated_by_idx ON public.b2c_need_tags USING btree (updated_by_user_id);


--
-- Name: b2c_product_need_tags_product_tag_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2c_product_need_tags_product_tag_unique ON public.b2c_product_need_tags USING btree (product_id, need_tag_id);


--
-- Name: b2c_product_need_tags_tag_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_product_need_tags_tag_product_idx ON public.b2c_product_need_tags USING btree (need_tag_id, product_id);


--
-- Name: b2c_product_types_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_product_types_active_sort_idx ON public.b2c_product_types USING btree (active, sort_order, id);


--
-- Name: b2c_product_types_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_product_types_created_by_idx ON public.b2c_product_types USING btree (created_by_user_id);


--
-- Name: b2c_product_types_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2c_product_types_slug_unique ON public.b2c_product_types USING btree (slug);


--
-- Name: b2c_product_types_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_product_types_updated_by_idx ON public.b2c_product_types USING btree (updated_by_user_id);


--
-- Name: b2c_recent_views_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_recent_views_product_idx ON public.b2c_recently_viewed_products USING btree (product_id);


--
-- Name: b2c_recent_views_user_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2c_recent_views_user_product_unique ON public.b2c_recently_viewed_products USING btree (user_id, product_id) WHERE (user_id IS NOT NULL);


--
-- Name: b2c_recent_views_user_viewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_recent_views_user_viewed_idx ON public.b2c_recently_viewed_products USING btree (user_id, last_viewed_at);


--
-- Name: b2c_recent_views_viewer_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX b2c_recent_views_viewer_product_unique ON public.b2c_recently_viewed_products USING btree (viewer_token_hash, product_id) WHERE (viewer_token_hash IS NOT NULL);


--
-- Name: b2c_recent_views_viewer_viewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX b2c_recent_views_viewer_viewed_idx ON public.b2c_recently_viewed_products USING btree (viewer_token_hash, last_viewed_at);


--
-- Name: beauty_job_application_actions_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_application_actions_actor_created_idx ON public.beauty_job_application_actions USING btree (actor_user_id, created_at);


--
-- Name: beauty_job_application_actions_contact_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_application_actions_contact_created_idx ON public.beauty_job_application_actions USING btree (contact_id, created_at);


--
-- Name: beauty_job_application_actions_listing_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_application_actions_listing_created_idx ON public.beauty_job_application_actions USING btree (listing_id, created_at);


--
-- Name: beauty_job_contacts_applicant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_contacts_applicant_created_idx ON public.beauty_job_contacts USING btree (applicant_user_id, created_at);


--
-- Name: beauty_job_contacts_decision_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_contacts_decision_actor_idx ON public.beauty_job_contacts USING btree (decision_actor_user_id);


--
-- Name: beauty_job_contacts_listing_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_contacts_listing_created_idx ON public.beauty_job_contacts USING btree (listing_id, created_at);


--
-- Name: beauty_job_contacts_listing_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_contacts_listing_status_created_idx ON public.beauty_job_contacts USING btree (listing_id, author_status, created_at);


--
-- Name: beauty_job_listings_category_visibility_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_listings_category_visibility_created_idx ON public.beauty_job_listings USING btree (category_id, intent, status, moderation_status, created_at);


--
-- Name: beauty_job_listings_city_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_listings_city_region_idx ON public.beauty_job_listings USING btree (city, region);


--
-- Name: beauty_job_listings_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_listings_expiry_idx ON public.beauty_job_listings USING btree (status, expires_at);


--
-- Name: beauty_job_listings_moderation_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_listings_moderation_created_idx ON public.beauty_job_listings USING btree (moderation_status, created_at);


--
-- Name: beauty_job_listings_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_listings_salon_created_idx ON public.beauty_job_listings USING btree (salon_id, created_at);


--
-- Name: beauty_job_listings_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_listings_user_created_idx ON public.beauty_job_listings USING btree (user_id, created_at);


--
-- Name: beauty_job_moderation_audit_action_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_moderation_audit_action_created_idx ON public.beauty_job_moderation_audit USING btree (action, created_at);


--
-- Name: beauty_job_moderation_audit_admin_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_moderation_audit_admin_created_idx ON public.beauty_job_moderation_audit USING btree (acting_admin_user_id, created_at);


--
-- Name: beauty_job_moderation_audit_listing_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_moderation_audit_listing_created_idx ON public.beauty_job_moderation_audit USING btree (listing_id, created_at);


--
-- Name: beauty_job_notifications_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_notifications_contact_idx ON public.beauty_job_notifications USING btree (contact_id);


--
-- Name: beauty_job_notifications_expiry_warning_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX beauty_job_notifications_expiry_warning_unique ON public.beauty_job_notifications USING btree (recipient_user_id, listing_id) WHERE ((type = 'expiry_warning'::text) AND (listing_id IS NOT NULL));


--
-- Name: beauty_job_notifications_listing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_notifications_listing_idx ON public.beauty_job_notifications USING btree (listing_id);


--
-- Name: beauty_job_notifications_recipient_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_notifications_recipient_created_idx ON public.beauty_job_notifications USING btree (recipient_user_id, created_at);


--
-- Name: beauty_job_platform_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_platform_settings_updated_by_idx ON public.beauty_job_platform_settings USING btree (updated_by_user_id);


--
-- Name: beauty_job_rental_requests_applicant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_rental_requests_applicant_created_idx ON public.beauty_job_rental_requests USING btree (applicant_user_id, created_at);


--
-- Name: beauty_job_rental_requests_listing_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_rental_requests_listing_created_idx ON public.beauty_job_rental_requests USING btree (listing_id, created_at);


--
-- Name: beauty_job_rental_requests_slot_accepted_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX beauty_job_rental_requests_slot_accepted_unique ON public.beauty_job_rental_requests USING btree (slot_id) WHERE (status = 'accepted'::public.beauty_job_rental_request_status);


--
-- Name: beauty_job_rental_requests_slot_applicant_pending_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX beauty_job_rental_requests_slot_applicant_pending_unique ON public.beauty_job_rental_requests USING btree (slot_id, applicant_user_id) WHERE (status = 'pending'::public.beauty_job_rental_request_status);


--
-- Name: beauty_job_rental_requests_slot_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_rental_requests_slot_status_idx ON public.beauty_job_rental_requests USING btree (slot_id, status);


--
-- Name: beauty_job_rental_slots_listing_starts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_rental_slots_listing_starts_idx ON public.beauty_job_rental_slots USING btree (listing_id, starts_at);


--
-- Name: beauty_job_reports_listing_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_reports_listing_status_idx ON public.beauty_job_reports USING btree (listing_id, status);


--
-- Name: beauty_job_reports_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_reports_reporter_idx ON public.beauty_job_reports USING btree (reporter_user_id);


--
-- Name: beauty_job_reports_resolved_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_reports_resolved_by_idx ON public.beauty_job_reports USING btree (resolved_by_user_id);


--
-- Name: beauty_job_saved_listings_listing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beauty_job_saved_listings_listing_idx ON public.beauty_job_saved_listings USING btree (listing_id);


--
-- Name: beauty_job_saved_listings_user_listing_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX beauty_job_saved_listings_user_listing_unique ON public.beauty_job_saved_listings USING btree (user_id, listing_id);


--
-- Name: booking_command_receipts_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_command_receipts_actor_created_idx ON public.booking_command_receipts USING btree (actor_type, actor_id, created_at);


--
-- Name: booking_command_receipts_scope_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_command_receipts_scope_key_unique ON public.booking_command_receipts USING btree (salon_id, actor_type, actor_id, idempotency_key);


--
-- Name: booking_groups_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_groups_created_by_idx ON public.booking_groups USING btree (created_by_user_id);


--
-- Name: booking_groups_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_groups_customer_idx ON public.booking_groups USING btree (customer_id);


--
-- Name: booking_groups_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_groups_salon_created_idx ON public.booking_groups USING btree (salon_id, created_at);


--
-- Name: booking_groups_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_groups_salon_customer_idx ON public.booking_groups USING btree (salon_customer_id);


--
-- Name: bulk_sale_campaign_targets_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bulk_sale_campaign_targets_category_idx ON public.bulk_sale_campaign_targets USING btree (category_id);


--
-- Name: bulk_sale_campaign_targets_category_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bulk_sale_campaign_targets_category_unique ON public.bulk_sale_campaign_targets USING btree (campaign_id, category_id) WHERE (category_id IS NOT NULL);


--
-- Name: bulk_sale_campaign_targets_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bulk_sale_campaign_targets_product_idx ON public.bulk_sale_campaign_targets USING btree (product_id);


--
-- Name: bulk_sale_campaign_targets_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bulk_sale_campaign_targets_product_unique ON public.bulk_sale_campaign_targets USING btree (campaign_id, product_id) WHERE (product_id IS NOT NULL);


--
-- Name: bulk_sale_campaigns_market_status_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bulk_sale_campaigns_market_status_schedule_idx ON public.bulk_sale_campaigns USING btree (market, status, starts_at, ends_at);


--
-- Name: business_verification_audits_actor_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_verification_audits_actor_user_idx ON public.business_verification_audits USING btree (actor_user_id);


--
-- Name: business_verification_audits_business_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_verification_audits_business_created_idx ON public.business_verification_audits USING btree (legal_entity_business_id, created_at);


--
-- Name: cart_threshold_rewards_gift_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cart_threshold_rewards_gift_product_idx ON public.cart_threshold_rewards USING btree (gift_product_id);


--
-- Name: cart_threshold_rewards_market_active_threshold_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cart_threshold_rewards_market_active_threshold_idx ON public.cart_threshold_rewards USING btree (market, active, spend_threshold_rsd);


--
-- Name: catalog_sync_runs_provider_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_sync_runs_provider_created_idx ON public.catalog_sync_runs USING btree (provider, created_at);


--
-- Name: catalog_sync_runs_requested_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_sync_runs_requested_by_idx ON public.catalog_sync_runs USING btree (requested_by_user_id);


--
-- Name: commerce_customer_notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_customer_notifications_user_created_idx ON public.commerce_customer_notifications USING btree (user_id, created_at);


--
-- Name: commerce_customer_notifications_waitlist_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commerce_customer_notifications_waitlist_unique ON public.commerce_customer_notifications USING btree (waitlist_id) WHERE (waitlist_id IS NOT NULL);


--
-- Name: commerce_experience_settings_singleton_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commerce_experience_settings_singleton_unique ON public.commerce_experience_settings USING btree ((true));


--
-- Name: commerce_experience_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_experience_settings_updated_by_idx ON public.commerce_experience_settings USING btree (updated_by_user_id);


--
-- Name: coupon_redemptions_coupon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coupon_redemptions_coupon_customer_idx ON public.coupon_redemptions USING btree (coupon_id, user_id, salon_id);


--
-- Name: coupon_redemptions_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX coupon_redemptions_order_unique ON public.coupon_redemptions USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: coupon_redemptions_retail_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX coupon_redemptions_retail_order_unique ON public.coupon_redemptions USING btree (retail_order_id) WHERE (retail_order_id IS NOT NULL);


--
-- Name: coupon_redemptions_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coupon_redemptions_salon_idx ON public.coupon_redemptions USING btree (salon_id);


--
-- Name: coupon_redemptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coupon_redemptions_user_idx ON public.coupon_redemptions USING btree (user_id);


--
-- Name: coupons_active_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coupons_active_dates_idx ON public.coupons USING btree (active, starts_at, ends_at);


--
-- Name: course_categories_section_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_categories_section_sort_idx ON public.course_categories USING btree (section_id, sort_order);


--
-- Name: course_days_course_day_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX course_days_course_day_unique ON public.course_days USING btree (course_id, day_number);


--
-- Name: course_days_course_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_days_course_sort_idx ON public.course_days USING btree (course_id, sort_order);


--
-- Name: course_enrollments_access_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_access_expiry_idx ON public.course_enrollments USING btree (user_id, access_expires_at);


--
-- Name: course_enrollments_booking_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_booking_group_idx ON public.course_enrollments USING btree (booking_group_id);


--
-- Name: course_enrollments_bundle_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_bundle_purchase_idx ON public.course_enrollments USING btree (bundle_purchase_id);


--
-- Name: course_enrollments_course_purchaser_participant_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX course_enrollments_course_purchaser_participant_unique ON public.course_enrollments USING btree (course_id, purchaser_id, participant_key) WHERE ((participant_id IS NULL) AND (status <> 'cancelled'::public.education_enrollment_status));


--
-- Name: course_enrollments_digital_consent_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_digital_consent_user_idx ON public.course_enrollments USING btree (digital_content_consent_user_id);


--
-- Name: course_enrollments_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_employee_idx ON public.course_enrollments USING btree (employee_id);


--
-- Name: course_enrollments_participant_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX course_enrollments_participant_active_unique ON public.course_enrollments USING btree (participant_id) WHERE ((participant_id IS NOT NULL) AND (status <> 'cancelled'::public.education_enrollment_status));


--
-- Name: course_enrollments_purchaser_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX course_enrollments_purchaser_idempotency_unique ON public.course_enrollments USING btree (purchaser_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: course_enrollments_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_salon_idx ON public.course_enrollments USING btree (salon_id);


--
-- Name: course_enrollments_session_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_session_status_idx ON public.course_enrollments USING btree (session_id, status);


--
-- Name: course_enrollments_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_enrollments_user_status_idx ON public.course_enrollments USING btree (user_id, status);


--
-- Name: course_lessons_module_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_lessons_module_sort_idx ON public.course_lessons USING btree (module_id, sort_order);


--
-- Name: course_modules_course_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_modules_course_sort_idx ON public.course_modules USING btree (course_id, sort_order);


--
-- Name: course_reviews_course_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_reviews_course_status_created_idx ON public.course_reviews USING btree (course_id, status, created_at);


--
-- Name: course_reviews_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_reviews_user_idx ON public.course_reviews USING btree (user_id);


--
-- Name: course_sessions_course_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_sessions_course_starts_at_idx ON public.course_sessions USING btree (course_id, starts_at);


--
-- Name: courses_category_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_category_published_idx ON public.courses USING btree (category_id, published, archived);


--
-- Name: courses_center_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_center_published_idx ON public.courses USING btree (center_id, published, archived);


--
-- Name: courses_course_type_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_course_type_published_idx ON public.courses USING btree (course_type_id, published, archived);


--
-- Name: courses_featured_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_featured_until_idx ON public.courses USING btree (is_featured, featured_until);


--
-- Name: courses_format_city_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_format_city_published_idx ON public.courses USING btree (format, city, published);


--
-- Name: courses_instructor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_instructor_idx ON public.courses USING btree (instructor_id);


--
-- Name: courses_instructor_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_instructor_profile_idx ON public.courses USING btree (instructor_profile_id);


--
-- Name: courses_published_archived_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_published_archived_created_idx ON public.courses USING btree (published, archived, created_at);


--
-- Name: courses_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_salon_idx ON public.courses USING btree (salon_id);


--
-- Name: courses_subcategory_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_subcategory_published_idx ON public.courses USING btree (subcategory_id, published, archived);


--
-- Name: customer_notes_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_notes_customer_idx ON public.customer_notes USING btree (customer_id);


--
-- Name: customer_notes_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_notes_salon_customer_idx ON public.customer_notes USING btree (salon_id, customer_id);


--
-- Name: customer_notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_notifications_user_created_idx ON public.customer_notifications USING btree (user_id, created_at);


--
-- Name: customer_notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_notifications_user_unread_idx ON public.customer_notifications USING btree (user_id, created_at) WHERE (read_at IS NULL);


--
-- Name: customer_package_purchases_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_package_purchases_customer_idx ON public.customer_package_purchases USING btree (salon_customer_id);


--
-- Name: customer_package_purchases_package_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_package_purchases_package_idx ON public.customer_package_purchases USING btree (package_id);


--
-- Name: customer_package_purchases_payment_confirmed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_package_purchases_payment_confirmed_by_idx ON public.customer_package_purchases USING btree (payment_confirmed_by_user_id);


--
-- Name: customer_package_purchases_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_package_purchases_salon_customer_idx ON public.customer_package_purchases USING btree (salon_id, salon_customer_id);


--
-- Name: customer_package_purchases_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_package_purchases_status_idx ON public.customer_package_purchases USING btree (status, expires_at);


--
-- Name: customer_password_setup_audits_admin_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_password_setup_audits_admin_created_idx ON public.customer_password_setup_audits USING btree (administrator_user_id, created_at);


--
-- Name: customer_password_setup_audits_target_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_password_setup_audits_target_created_idx ON public.customer_password_setup_audits USING btree (target_user_id, created_at);


--
-- Name: customer_password_setup_rate_limits_key_action_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_password_setup_rate_limits_key_action_unique ON public.customer_password_setup_rate_limits USING btree (key_hash, action);


--
-- Name: customer_password_setup_rate_limits_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_password_setup_rate_limits_updated_idx ON public.customer_password_setup_rate_limits USING btree (updated_at);


--
-- Name: customer_password_setup_tokens_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_password_setup_tokens_expiry_idx ON public.customer_password_setup_tokens USING btree (expires_at);


--
-- Name: customer_password_setup_tokens_hash_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_password_setup_tokens_hash_unique ON public.customer_password_setup_tokens USING btree (token_hash);


--
-- Name: customer_password_setup_tokens_issuer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_password_setup_tokens_issuer_created_idx ON public.customer_password_setup_tokens USING btree (issued_by_user_id, created_at);


--
-- Name: customer_password_setup_tokens_one_active_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_password_setup_tokens_one_active_user ON public.customer_password_setup_tokens USING btree (user_id) WHERE ((consumed_at IS NULL) AND (invalidated_at IS NULL));


--
-- Name: customer_password_setup_tokens_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_password_setup_tokens_user_created_idx ON public.customer_password_setup_tokens USING btree (user_id, created_at);


--
-- Name: education_access_extensions_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_access_extensions_enrollment_idx ON public.education_access_extensions USING btree (enrollment_id, created_at);


--
-- Name: education_access_extensions_open_enrollment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_access_extensions_open_enrollment_unique ON public.education_access_extensions USING btree (enrollment_id) WHERE (status = 'pending'::text);


--
-- Name: education_access_extensions_payment_obligation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_access_extensions_payment_obligation_idx ON public.education_access_extensions USING btree (payment_obligation_id);


--
-- Name: education_access_extensions_purchaser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_access_extensions_purchaser_idx ON public.education_access_extensions USING btree (purchaser_id);


--
-- Name: education_attendance_participant_session_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_attendance_participant_session_unique ON public.education_attendance USING btree (participant_id, session_id);


--
-- Name: education_attendance_recorded_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_attendance_recorded_by_idx ON public.education_attendance USING btree (recorded_by_user_id);


--
-- Name: education_attendance_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_attendance_session_idx ON public.education_attendance USING btree (session_id);


--
-- Name: education_b2b_discount_audits_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_discount_audits_actor_idx ON public.education_b2b_discount_audits USING btree (actor_user_id);


--
-- Name: education_b2b_discount_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_discount_settings_updated_by_idx ON public.education_b2b_discount_settings USING btree (updated_by_user_id);


--
-- Name: education_b2b_discount_tiers_sort_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_b2b_discount_tiers_sort_unique ON public.education_b2b_discount_tiers USING btree (sort_order);


--
-- Name: education_b2b_order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_order_items_order_idx ON public.education_b2b_order_items USING btree (order_id);


--
-- Name: education_b2b_order_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_order_items_product_idx ON public.education_b2b_order_items USING btree (product_id);


--
-- Name: education_b2b_orders_center_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_orders_center_created_idx ON public.education_b2b_orders USING btree (center_id, created_at);


--
-- Name: education_b2b_orders_center_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_b2b_orders_center_idempotency_unique ON public.education_b2b_orders USING btree (center_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: education_b2b_orders_purchaser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_orders_purchaser_idx ON public.education_b2b_orders USING btree (purchaser_user_id);


--
-- Name: education_b2b_orders_qualified_spend_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_orders_qualified_spend_idx ON public.education_b2b_orders USING btree (center_id, payment_status, fulfillment_status, completed_at);


--
-- Name: education_b2b_orders_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_b2b_orders_settled_by_idx ON public.education_b2b_orders USING btree (settled_by_user_id);


--
-- Name: education_bank_transactions_obligation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bank_transactions_obligation_idx ON public.education_bank_transactions USING btree (obligation_id);


--
-- Name: education_bank_transactions_result_received_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bank_transactions_result_received_idx ON public.education_bank_transactions USING btree (result, received_at);


--
-- Name: education_bank_transactions_settled_obligation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bank_transactions_settled_obligation_unique ON public.education_bank_transactions USING btree (obligation_id) WHERE ((result = 'settled'::text) AND (obligation_id IS NOT NULL));


--
-- Name: education_bank_transactions_source_item_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bank_transactions_source_item_unique ON public.education_bank_transactions USING btree (source, source_item_id);


--
-- Name: education_booking_groups_actor_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_booking_groups_actor_idempotency_unique ON public.education_booking_groups USING btree (created_by_user_id, idempotency_key);


--
-- Name: education_booking_groups_center_session_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_booking_groups_center_session_status_idx ON public.education_booking_groups USING btree (center_id, session_id, status);


--
-- Name: education_booking_groups_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_booking_groups_course_idx ON public.education_booking_groups USING btree (course_id);


--
-- Name: education_booking_groups_purchaser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_booking_groups_purchaser_idx ON public.education_booking_groups USING btree (purchaser_id);


--
-- Name: education_booking_groups_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_booking_groups_session_idx ON public.education_booking_groups USING btree (session_id);


--
-- Name: education_booking_participants_group_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_booking_participants_group_status_idx ON public.education_booking_participants USING btree (booking_group_id, status);


--
-- Name: education_booking_participants_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_booking_participants_user_idx ON public.education_booking_participants USING btree (user_id);


--
-- Name: education_bundle_courses_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_courses_course_idx ON public.education_bundle_courses USING btree (course_id);


--
-- Name: education_bundle_courses_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_courses_order_unique ON public.education_bundle_courses USING btree (bundle_id, sort_order);


--
-- Name: education_bundle_courses_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_courses_unique ON public.education_bundle_courses USING btree (bundle_id, course_id);


--
-- Name: education_bundle_purchase_escrows_center_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchase_escrows_center_status_idx ON public.education_bundle_purchase_escrows USING btree (center_id, status);


--
-- Name: education_bundle_purchase_items_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchase_items_course_idx ON public.education_bundle_purchase_items USING btree (course_id);


--
-- Name: education_bundle_purchase_items_course_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchase_items_course_unique ON public.education_bundle_purchase_items USING btree (purchase_id, course_id);


--
-- Name: education_bundle_purchase_items_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchase_items_order_unique ON public.education_bundle_purchase_items USING btree (purchase_id, sort_order);


--
-- Name: education_bundle_purchase_ledger_charge_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchase_ledger_charge_unique ON public.education_bundle_purchase_ledger_entries USING btree (escrow_id) WHERE (entry_type = 'charge'::public.education_ledger_entry_type);


--
-- Name: education_bundle_purchase_ledger_escrow_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchase_ledger_escrow_created_idx ON public.education_bundle_purchase_ledger_entries USING btree (escrow_id, created_at);


--
-- Name: education_bundle_purchase_ledger_fee_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchase_ledger_fee_unique ON public.education_bundle_purchase_ledger_entries USING btree (escrow_id) WHERE (entry_type = 'platform_fee'::public.education_ledger_entry_type);


--
-- Name: education_bundle_purchase_ledger_reserve_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchase_ledger_reserve_unique ON public.education_bundle_purchase_ledger_entries USING btree (escrow_id) WHERE (entry_type = 'reserve_hold'::public.education_ledger_entry_type);


--
-- Name: education_bundle_purchases_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_bundle_idx ON public.education_bundle_purchases USING btree (bundle_id);


--
-- Name: education_bundle_purchases_center_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_center_status_idx ON public.education_bundle_purchases USING btree (center_id, status);


--
-- Name: education_bundle_purchases_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_employee_idx ON public.education_bundle_purchases USING btree (employee_id);


--
-- Name: education_bundle_purchases_learner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_learner_idx ON public.education_bundle_purchases USING btree (learner_user_id);


--
-- Name: education_bundle_purchases_payment_reference_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchases_payment_reference_unique ON public.education_bundle_purchases USING btree (payment_reference);


--
-- Name: education_bundle_purchases_purchaser_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_bundle_purchases_purchaser_idempotency_unique ON public.education_bundle_purchases USING btree (purchaser_id, idempotency_key);


--
-- Name: education_bundle_purchases_purchaser_requested_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_purchaser_requested_idx ON public.education_bundle_purchases USING btree (purchaser_id, requested_at);


--
-- Name: education_bundle_purchases_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_salon_idx ON public.education_bundle_purchases USING btree (salon_id);


--
-- Name: education_bundle_purchases_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundle_purchases_settled_by_idx ON public.education_bundle_purchases USING btree (settled_by_user_id);


--
-- Name: education_bundles_center_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_bundles_center_published_idx ON public.education_bundles USING btree (center_id, published);


--
-- Name: education_center_reviews_center_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_reviews_center_status_created_idx ON public.education_center_reviews USING btree (center_id, status, created_at);


--
-- Name: education_center_reviews_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_reviews_user_idx ON public.education_center_reviews USING btree (user_id);


--
-- Name: education_center_staff_center_role_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_staff_center_role_active_idx ON public.education_center_staff USING btree (center_id, role, active);


--
-- Name: education_center_staff_center_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_center_staff_center_user_unique ON public.education_center_staff USING btree (center_id, user_id);


--
-- Name: education_center_staff_instructor_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_staff_instructor_profile_idx ON public.education_center_staff USING btree (instructor_profile_id);


--
-- Name: education_center_staff_one_active_educator_center_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_center_staff_one_active_educator_center_unique ON public.education_center_staff USING btree (user_id) WHERE ((role = 'educator'::public.education_staff_role) AND active);


--
-- Name: education_center_subscriptions_grace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_subscriptions_grace_idx ON public.education_center_subscriptions USING btree (status, grace_ends_at);


--
-- Name: education_center_subscriptions_pending_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_subscriptions_pending_plan_idx ON public.education_center_subscriptions USING btree (pending_plan_id);


--
-- Name: education_center_subscriptions_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_center_subscriptions_plan_idx ON public.education_center_subscriptions USING btree (plan_id);


--
-- Name: education_centers_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_centers_owner_idx ON public.education_centers USING btree (owner_id);


--
-- Name: education_centers_verified_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_centers_verified_by_idx ON public.education_centers USING btree (verified_by_user_id);


--
-- Name: education_contact_history_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_contact_history_actor_idx ON public.education_contact_history USING btree (actor_user_id);


--
-- Name: education_contact_history_center_learner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_contact_history_center_learner_idx ON public.education_contact_history USING btree (center_id, learner_user_id, created_at);


--
-- Name: education_contact_history_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_contact_history_enrollment_idx ON public.education_contact_history USING btree (enrollment_id);


--
-- Name: education_contact_history_learner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_contact_history_learner_idx ON public.education_contact_history USING btree (learner_user_id);


--
-- Name: education_course_metric_events_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_course_metric_events_actor_idx ON public.education_course_metric_events USING btree (actor_user_id);


--
-- Name: education_course_metric_events_center_90d_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_course_metric_events_center_90d_idx ON public.education_course_metric_events USING btree (center_id, event_type, occurred_at);


--
-- Name: education_course_metric_events_course_30d_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_course_metric_events_course_30d_idx ON public.education_course_metric_events USING btree (course_id, event_type, occurred_at);


--
-- Name: education_course_metric_events_dedupe_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_course_metric_events_dedupe_unique ON public.education_course_metric_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: education_course_types_proposed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_course_types_proposed_by_idx ON public.education_course_types USING btree (proposed_by_center_id);


--
-- Name: education_course_types_reviewed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_course_types_reviewed_by_idx ON public.education_course_types USING btree (reviewed_by_user_id);


--
-- Name: education_course_types_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_course_types_status_idx ON public.education_course_types USING btree (status, active, sort_order);


--
-- Name: education_course_types_subcategory_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_course_types_subcategory_normalized_unique ON public.education_course_types USING btree (subcategory_id, normalized_name);


--
-- Name: education_custom_plan_requests_center_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_custom_plan_requests_center_created_idx ON public.education_custom_plan_requests USING btree (center_id, created_at);


--
-- Name: education_custom_plan_requests_requested_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_custom_plan_requests_requested_by_idx ON public.education_custom_plan_requests USING btree (requested_by_user_id);


--
-- Name: education_custom_plan_requests_resolved_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_custom_plan_requests_resolved_by_idx ON public.education_custom_plan_requests USING btree (resolved_by_user_id);


--
-- Name: education_custom_plan_requests_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_custom_plan_requests_status_created_idx ON public.education_custom_plan_requests USING btree (status, created_at);


--
-- Name: education_disputes_one_active_per_enrollment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_disputes_one_active_per_enrollment_unique ON public.education_disputes USING btree (enrollment_id) WHERE (status = ANY (ARRAY['open'::public.education_dispute_status, 'under_review'::public.education_dispute_status]));


--
-- Name: education_disputes_opened_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_disputes_opened_by_idx ON public.education_disputes USING btree (opened_by_user_id);


--
-- Name: education_disputes_resolved_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_disputes_resolved_by_idx ON public.education_disputes USING btree (resolved_by_user_id);


--
-- Name: education_disputes_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_disputes_status_created_idx ON public.education_disputes USING btree (status, created_at);


--
-- Name: education_educator_absences_staff_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_educator_absences_staff_dates_idx ON public.education_educator_absences USING btree (staff_id, start_date, end_date);


--
-- Name: education_educator_weekly_availability_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_educator_weekly_availability_unique ON public.education_educator_weekly_availability USING btree (staff_id, weekday, start_time, end_time);


--
-- Name: education_escrows_center_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_escrows_center_status_idx ON public.education_escrows USING btree (center_id, status);


--
-- Name: education_escrows_release_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_escrows_release_idx ON public.education_escrows USING btree (status, release_at);


--
-- Name: education_featured_charges_activated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_featured_charges_activated_by_idx ON public.education_featured_charges USING btree (activated_by_user_id);


--
-- Name: education_featured_charges_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_featured_charges_center_idx ON public.education_featured_charges USING btree (center_id);


--
-- Name: education_featured_charges_course_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_featured_charges_course_created_idx ON public.education_featured_charges USING btree (course_id, created_at);


--
-- Name: education_featured_charges_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_featured_charges_salon_idx ON public.education_featured_charges USING btree (salon_id);


--
-- Name: education_featured_charges_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_featured_charges_settled_by_idx ON public.education_featured_charges USING btree (settled_by_user_id);


--
-- Name: education_featured_charges_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_featured_charges_status_idx ON public.education_featured_charges USING btree (status, created_at);


--
-- Name: education_financial_audit_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_audit_actor_idx ON public.education_financial_audit_log USING btree (actor_user_id);


--
-- Name: education_financial_audit_actor_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_audit_actor_occurred_idx ON public.education_financial_audit_log USING btree (actor_user_id, occurred_at);


--
-- Name: education_financial_audit_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_audit_entity_idx ON public.education_financial_audit_log USING btree (entity_type, entity_id, occurred_at);


--
-- Name: education_financial_audit_occurred_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_audit_occurred_id_idx ON public.education_financial_audit_log USING btree (occurred_at, id);


--
-- Name: education_financial_events_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_events_actor_idx ON public.education_financial_events USING btree (actor_user_id);


--
-- Name: education_financial_events_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_events_enrollment_idx ON public.education_financial_events USING btree (enrollment_id);


--
-- Name: education_financial_events_escrow_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_financial_events_escrow_created_idx ON public.education_financial_events USING btree (escrow_id, created_at);


--
-- Name: education_financial_events_release_per_escrow_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_financial_events_release_per_escrow_unique ON public.education_financial_events USING btree (escrow_id) WHERE (event_type = 'escrow_released'::text);


--
-- Name: education_gift_vouchers_center_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_center_status_idx ON public.education_gift_vouchers USING btree (center_id, status, created_at);


--
-- Name: education_gift_vouchers_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_course_idx ON public.education_gift_vouchers USING btree (course_id);


--
-- Name: education_gift_vouchers_dispute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_dispute_idx ON public.education_gift_vouchers USING btree (dispute_id);


--
-- Name: education_gift_vouchers_purchaser_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_purchaser_created_idx ON public.education_gift_vouchers USING btree (purchaser_id, created_at, id);


--
-- Name: education_gift_vouchers_purchaser_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_gift_vouchers_purchaser_idempotency_unique ON public.education_gift_vouchers USING btree (purchaser_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: education_gift_vouchers_recipient_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_recipient_created_idx ON public.education_gift_vouchers USING btree (recipient_user_id, created_at, id);


--
-- Name: education_gift_vouchers_redeemed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_redeemed_by_idx ON public.education_gift_vouchers USING btree (redeemed_by_user_id);


--
-- Name: education_gift_vouchers_refunded_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_refunded_by_idx ON public.education_gift_vouchers USING btree (refunded_by_user_id);


--
-- Name: education_gift_vouchers_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_gift_vouchers_settled_by_idx ON public.education_gift_vouchers USING btree (settled_by_user_id);


--
-- Name: education_grace_notes_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_grace_notes_author_idx ON public.education_grace_notes USING btree (author_user_id);


--
-- Name: education_grace_notes_center_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_grace_notes_center_created_idx ON public.education_grace_notes USING btree (center_id, created_at);


--
-- Name: education_inquiries_center_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inquiries_center_status_created_idx ON public.education_inquiries USING btree (center_id, status, created_at);


--
-- Name: education_inquiries_course_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inquiries_course_created_idx ON public.education_inquiries USING btree (course_id, created_at);


--
-- Name: education_inquiries_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inquiries_user_created_idx ON public.education_inquiries USING btree (user_id, created_at);


--
-- Name: education_installment_settlement_command_actor_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_installment_settlement_command_actor_key_unique ON public.education_installment_settlement_commands USING btree (actor_user_id, idempotency_key);


--
-- Name: education_installment_settlement_command_installment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_installment_settlement_command_installment_idx ON public.education_installment_settlement_commands USING btree (installment_id);


--
-- Name: education_installments_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_installments_settled_by_idx ON public.education_installments USING btree (settled_by_user_id);


--
-- Name: education_installments_snapshot_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_installments_snapshot_number_unique ON public.education_installments USING btree (price_snapshot_id, installment_number);


--
-- Name: education_instructors_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_instructors_center_idx ON public.education_instructors USING btree (center_id);


--
-- Name: education_instructors_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_instructors_user_idx ON public.education_instructors USING btree (user_id);


--
-- Name: education_inventory_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_center_idx ON public.education_inventory_items USING btree (center_id);


--
-- Name: education_inventory_movements_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_movements_actor_idx ON public.education_inventory_movements USING btree (actor_user_id);


--
-- Name: education_inventory_movements_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_movements_center_idx ON public.education_inventory_movements USING btree (center_id);


--
-- Name: education_inventory_movements_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_movements_course_idx ON public.education_inventory_movements USING btree (course_id);


--
-- Name: education_inventory_movements_item_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_movements_item_created_idx ON public.education_inventory_movements USING btree (item_id, created_at);


--
-- Name: education_inventory_movements_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_movements_session_idx ON public.education_inventory_movements USING btree (session_id);


--
-- Name: education_inventory_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_inventory_product_idx ON public.education_inventory_items USING btree (product_id);


--
-- Name: education_ledger_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_ledger_actor_idx ON public.education_ledger_entries USING btree (actor_user_id);


--
-- Name: education_ledger_center_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_ledger_center_created_idx ON public.education_ledger_entries USING btree (center_id, created_at);


--
-- Name: education_ledger_enrollment_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_ledger_enrollment_created_idx ON public.education_ledger_entries USING btree (enrollment_id, created_at);


--
-- Name: education_ledger_refund_per_escrow_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_ledger_refund_per_escrow_unique ON public.education_ledger_entries USING btree (escrow_id) WHERE (type = 'refund'::public.education_ledger_entry_type);


--
-- Name: education_ledger_release_per_escrow_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_ledger_release_per_escrow_unique ON public.education_ledger_entries USING btree (escrow_id) WHERE (type = 'release'::public.education_ledger_entry_type);


--
-- Name: education_media_center_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_media_center_sort_idx ON public.education_media USING btree (center_id, sort_order);


--
-- Name: education_media_course_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_media_course_sort_idx ON public.education_media USING btree (course_id, sort_order);


--
-- Name: education_media_uploads_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_media_uploads_center_idx ON public.education_media_uploads USING btree (center_id);


--
-- Name: education_media_uploads_cleanup_failures_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_media_uploads_cleanup_failures_idx ON public.education_media_uploads USING btree (cleanup_failure_count, created_at);


--
-- Name: education_media_uploads_cleanup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_media_uploads_cleanup_idx ON public.education_media_uploads USING btree (expires_at, attached_at);


--
-- Name: education_media_uploads_course_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_media_uploads_course_expires_idx ON public.education_media_uploads USING btree (course_id, expires_at);


--
-- Name: education_media_uploads_object_path_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_media_uploads_object_path_unique ON public.education_media_uploads USING btree (object_path);


--
-- Name: education_messages_sender_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_messages_sender_idx ON public.education_messages USING btree (sender_id);


--
-- Name: education_messages_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_messages_thread_created_idx ON public.education_messages USING btree (thread_id, created_at);


--
-- Name: education_notification_archives_archived_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_notification_archives_archived_at_idx ON public.education_notification_archives USING btree (archived_at);


--
-- Name: education_notifications_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_notifications_enrollment_idx ON public.education_notifications USING btree (enrollment_id);


--
-- Name: education_notifications_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_notifications_retention_idx ON public.education_notifications USING btree (created_at) WHERE (read_at IS NOT NULL);


--
-- Name: education_notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_notifications_user_created_idx ON public.education_notifications USING btree (user_id, created_at);


--
-- Name: education_notifications_waitlist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_notifications_waitlist_idx ON public.education_notifications USING btree (waitlist_id);


--
-- Name: education_outbox_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_outbox_center_idx ON public.education_outbox USING btree (center_id);


--
-- Name: education_outbox_delivery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_outbox_delivery_idx ON public.education_outbox USING btree (status, available_at);


--
-- Name: education_outbox_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_outbox_participant_idx ON public.education_outbox USING btree (participant_id);


--
-- Name: education_outbox_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_outbox_session_idx ON public.education_outbox USING btree (session_id);


--
-- Name: education_payment_obligations_cancelled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_cancelled_by_idx ON public.education_payment_obligations USING btree (cancelled_by_user_id);


--
-- Name: education_payment_obligations_center_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_center_status_idx ON public.education_payment_obligations USING btree (center_id, status, due_at);


--
-- Name: education_payment_obligations_confirmed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_confirmed_by_idx ON public.education_payment_obligations USING btree (confirmed_by_user_id);


--
-- Name: education_payment_obligations_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_enrollment_idx ON public.education_payment_obligations USING btree (enrollment_id);


--
-- Name: education_payment_obligations_pending_subscription_kind_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_payment_obligations_pending_subscription_kind_uniq ON public.education_payment_obligations USING btree (subscription_id) WHERE ((status = 'pending'::text) AND (subscription_id IS NOT NULL) AND (kind = ANY (ARRAY['subscription_renewal'::text, 'subscription_upgrade'::text])));


--
-- Name: education_payment_obligations_plan_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_plan_snapshot_idx ON public.education_payment_obligations USING btree (plan_id_snapshot);


--
-- Name: education_payment_obligations_renewal_period_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_payment_obligations_renewal_period_uniq ON public.education_payment_obligations USING btree (subscription_id, service_period_start) WHERE ((kind = 'subscription_renewal'::text) AND (status = ANY (ARRAY['pending'::text, 'paid'::text])) AND (subscription_id IS NOT NULL) AND (service_period_start IS NOT NULL));


--
-- Name: education_payment_obligations_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_salon_idx ON public.education_payment_obligations USING btree (salon_id);


--
-- Name: education_payment_obligations_subscription_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payment_obligations_subscription_idx ON public.education_payment_obligations USING btree (subscription_id);


--
-- Name: education_payouts_center_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payouts_center_created_idx ON public.education_payouts USING btree (center_id, created_at);


--
-- Name: education_payouts_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_payouts_created_by_idx ON public.education_payouts USING btree (created_by_user_id);


--
-- Name: education_placement_settings_kind_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_placement_settings_kind_scope_unique ON public.education_placement_settings USING btree (kind, scope);


--
-- Name: education_placement_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placement_settings_updated_by_idx ON public.education_placement_settings USING btree (updated_by_user_id);


--
-- Name: education_placements_category_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_category_slot_idx ON public.education_placements USING btree (scope_category_id, slot_number, status);


--
-- Name: education_placements_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_center_idx ON public.education_placements USING btree (center_id);


--
-- Name: education_placements_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_course_idx ON public.education_placements USING btree (course_id);


--
-- Name: education_placements_pending_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_pending_created_idx ON public.education_placements USING btree (status, created_at);


--
-- Name: education_placements_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_salon_idx ON public.education_placements USING btree (salon_id);


--
-- Name: education_placements_scope_status_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_scope_status_dates_idx ON public.education_placements USING btree (kind, scope, status, starts_at, ends_at);


--
-- Name: education_placements_settled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_settled_by_idx ON public.education_placements USING btree (settled_by_user_id);


--
-- Name: education_placements_subcategory_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_placements_subcategory_slot_idx ON public.education_placements USING btree (scope_subcategory_id, slot_number, status);


--
-- Name: education_platform_settings_bank_access_confirmed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_platform_settings_bank_access_confirmed_by_idx ON public.education_platform_settings USING btree (bank_reconciliation_access_confirmed_by_user_id);


--
-- Name: education_platform_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_platform_settings_updated_by_idx ON public.education_platform_settings USING btree (updated_by_user_id);


--
-- Name: education_price_snapshots_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_price_snapshots_course_idx ON public.education_price_snapshots USING btree (course_id);


--
-- Name: education_recurrence_commands_actor_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_recurrence_commands_actor_key_unique ON public.education_recurrence_commands USING btree (actor_user_id, idempotency_key);


--
-- Name: education_recurrence_commands_center_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_recurrence_commands_center_created_idx ON public.education_recurrence_commands USING btree (center_id, created_at);


--
-- Name: education_resources_center_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_resources_center_kind_idx ON public.education_resources USING btree (center_id, kind);


--
-- Name: education_sections_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_sections_active_sort_idx ON public.education_sections USING btree (active, sort_order);


--
-- Name: education_session_educators_assigned_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_session_educators_assigned_by_idx ON public.education_session_educators USING btree (assigned_by_user_id);


--
-- Name: education_session_educators_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_session_educators_staff_idx ON public.education_session_educators USING btree (staff_id);


--
-- Name: education_session_resources_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_session_resources_session_idx ON public.education_session_resources USING btree (session_id);


--
-- Name: education_session_resources_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_session_resources_unique ON public.education_session_resources USING btree (resource_id, session_id);


--
-- Name: education_subcategories_category_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_subcategories_category_active_sort_idx ON public.education_subcategories USING btree (category_id, active, sort_order);


--
-- Name: education_subcategories_category_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_subcategories_category_slug_unique ON public.education_subcategories USING btree (category_id, slug);


--
-- Name: education_threads_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_threads_center_idx ON public.education_threads USING btree (center_id);


--
-- Name: education_threads_purchaser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_threads_purchaser_idx ON public.education_threads USING btree (purchaser_id);


--
-- Name: education_trial_claims_bank_account_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_trial_claims_bank_account_unique ON public.education_trial_claims USING btree (normalized_bank_account_hash) WHERE (normalized_bank_account_hash IS NOT NULL);


--
-- Name: education_trial_claims_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_trial_claims_center_idx ON public.education_trial_claims USING btree (center_id);


--
-- Name: education_trial_claims_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_trial_claims_email_unique ON public.education_trial_claims USING btree (normalized_email_hash);


--
-- Name: education_trial_claims_phone_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_trial_claims_phone_unique ON public.education_trial_claims USING btree (normalized_phone_hash) WHERE (normalized_phone_hash IS NOT NULL);


--
-- Name: education_trial_claims_pib_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_trial_claims_pib_unique ON public.education_trial_claims USING btree (normalized_pib_hash) WHERE (normalized_pib_hash IS NOT NULL);


--
-- Name: education_trial_claims_registration_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_trial_claims_registration_number_unique ON public.education_trial_claims USING btree (normalized_registration_number_hash) WHERE (normalized_registration_number_hash IS NOT NULL);


--
-- Name: education_trial_claims_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_trial_claims_user_idx ON public.education_trial_claims USING btree (user_id);


--
-- Name: education_waitlist_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_waitlist_course_idx ON public.education_waitlist USING btree (course_id);


--
-- Name: education_waitlist_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_waitlist_employee_idx ON public.education_waitlist USING btree (employee_id);


--
-- Name: education_waitlist_purchaser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_waitlist_purchaser_idx ON public.education_waitlist USING btree (purchaser_id);


--
-- Name: education_waitlist_session_position_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_waitlist_session_position_unique ON public.education_waitlist USING btree (session_id, "position") WHERE (status = ANY (ARRAY['waiting'::public.education_waitlist_status, 'offered'::public.education_waitlist_status]));


--
-- Name: education_waitlist_session_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_waitlist_session_status_idx ON public.education_waitlist USING btree (session_id, status, "position");


--
-- Name: education_waitlist_session_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_waitlist_session_user_unique ON public.education_waitlist USING btree (session_id, user_id) WHERE (status = ANY (ARRAY['waiting'::public.education_waitlist_status, 'offered'::public.education_waitlist_status]));


--
-- Name: education_waitlist_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_waitlist_user_idx ON public.education_waitlist USING btree (user_id);


--
-- Name: education_wishlists_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_wishlists_course_idx ON public.education_wishlists USING btree (course_id);


--
-- Name: education_wishlists_user_course_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX education_wishlists_user_course_unique ON public.education_wishlists USING btree (user_id, course_id);


--
-- Name: education_wishlists_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX education_wishlists_user_created_idx ON public.education_wishlists USING btree (user_id, created_at, id);


--
-- Name: email_campaigns_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_campaigns_created_by_idx ON public.email_campaigns USING btree (created_by_user_id);


--
-- Name: email_deliveries_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_appointment_idx ON public.email_deliveries USING btree (appointment_id);


--
-- Name: email_deliveries_beauty_job_alert_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_beauty_job_alert_history_idx ON public.email_deliveries USING btree (recipient_email, created_at) WHERE (email_type = 'beauty_job_delivery_alert'::text);


--
-- Name: email_deliveries_beauty_job_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_beauty_job_issue_idx ON public.email_deliveries USING btree (status, created_at) WHERE (email_type = ANY (ARRAY['beauty_job_new_contact'::text, 'beauty_job_author_reply'::text, 'beauty_job_moderation'::text, 'beauty_job_expiry_warning'::text]));


--
-- Name: email_deliveries_provider_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_provider_message_idx ON public.email_deliveries USING btree (provider_message_id) WHERE (email_type = 'automation'::text);


--
-- Name: email_deliveries_report_alert_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_report_alert_history_idx ON public.email_deliveries USING btree (email_type, recipient_email) WHERE (email_type = ANY (ARRAY['delivery_report_silence_alert'::text, 'delivery_report_recovery_alert'::text]));


--
-- Name: email_deliveries_retry_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_retry_index ON public.email_deliveries USING btree (status, next_retry_at);


--
-- Name: email_deliveries_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_salon_idx ON public.email_deliveries USING btree (salon_id);


--
-- Name: employee_clock_entries_employee_in_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_clock_entries_employee_in_idx ON public.employee_clock_entries USING btree (employee_id, clock_in_at);


--
-- Name: employee_clock_entries_one_open_per_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_clock_entries_one_open_per_employee ON public.employee_clock_entries USING btree (employee_id) WHERE (clock_out_at IS NULL);


--
-- Name: employee_clock_entries_salon_in_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_clock_entries_salon_in_idx ON public.employee_clock_entries USING btree (salon_id, clock_in_at);


--
-- Name: employee_commission_settings_employee_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_commission_settings_employee_unique ON public.employee_commission_settings USING btree (employee_id);


--
-- Name: employee_commission_settings_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_commission_settings_salon_idx ON public.employee_commission_settings USING btree (salon_id);


--
-- Name: employee_commission_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_commission_settings_updated_by_idx ON public.employee_commission_settings USING btree (updated_by_user_id);


--
-- Name: employee_leave_requests_employee_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_leave_requests_employee_created_idx ON public.employee_leave_requests USING btree (employee_id, created_at);


--
-- Name: employee_location_assignments_employee_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_location_assignments_employee_active_idx ON public.employee_location_assignments USING btree (employee_id, active);


--
-- Name: employee_location_assignments_employee_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_location_assignments_employee_salon_unique ON public.employee_location_assignments USING btree (employee_id, salon_id);


--
-- Name: employee_location_assignments_one_default_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_location_assignments_one_default_unique ON public.employee_location_assignments USING btree (employee_id) WHERE (is_default = true);


--
-- Name: employee_location_assignments_salon_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_location_assignments_salon_active_idx ON public.employee_location_assignments USING btree (salon_id, active);


--
-- Name: employee_location_schedules_employee_salon_weekday_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_location_schedules_employee_salon_weekday_idx ON public.employee_location_schedules USING btree (employee_id, salon_id, weekday);


--
-- Name: employee_location_schedules_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_location_schedules_salon_idx ON public.employee_location_schedules USING btree (salon_id);


--
-- Name: employee_location_schedules_window_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_location_schedules_window_unique ON public.employee_location_schedules USING btree (employee_id, salon_id, weekday, start_time, end_time);


--
-- Name: employee_ratings_employee_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_ratings_employee_unique ON public.employee_ratings USING btree (employee_id);


--
-- Name: employee_ratings_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_ratings_salon_idx ON public.employee_ratings USING btree (salon_id);


--
-- Name: employee_schedules_employee_weekday_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_schedules_employee_weekday_idx ON public.employee_schedules USING btree (employee_id, weekday);


--
-- Name: employee_services_employee_service_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_services_employee_service_unique ON public.employee_services USING btree (employee_id, service_id);


--
-- Name: employee_services_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_services_service_idx ON public.employee_services USING btree (service_id);


--
-- Name: employee_time_off_employee_date_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_time_off_employee_date_time_idx ON public.employee_time_off USING btree (employee_id, start_date, end_date, start_time, end_time);


--
-- Name: employee_time_off_employee_salon_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_time_off_employee_salon_start_idx ON public.employee_time_off USING btree (employee_id, salon_id, start_date);


--
-- Name: employee_time_off_employee_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_time_off_employee_start_idx ON public.employee_time_off USING btree (employee_id, start_date);


--
-- Name: employee_time_off_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_time_off_salon_idx ON public.employee_time_off USING btree (salon_id);


--
-- Name: employees_salon_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_salon_active_idx ON public.employees USING btree (salon_id, active);


--
-- Name: employees_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_user_idx ON public.employees USING btree (user_id);


--
-- Name: favorite_employees_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favorite_employees_employee_idx ON public.favorite_employees USING btree (employee_id);


--
-- Name: favorite_employees_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favorite_employees_salon_idx ON public.favorite_employees USING btree (salon_id);


--
-- Name: favorite_employees_user_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX favorite_employees_user_salon_unique ON public.favorite_employees USING btree (user_id, salon_id);


--
-- Name: favorites_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favorites_salon_idx ON public.favorites USING btree (salon_id);


--
-- Name: favorites_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favorites_user_idx ON public.favorites USING btree (user_id);


--
-- Name: image_assets_status_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX image_assets_status_expires_idx ON public.image_assets USING btree (status, expires_at);


--
-- Name: image_assets_uploader_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX image_assets_uploader_created_idx ON public.image_assets USING btree (uploaded_by_user_id, created_at);


--
-- Name: inspiration_items_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inspiration_items_salon_created_idx ON public.inspiration_items USING btree (salon_id, created_at);


--
-- Name: inspiration_items_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inspiration_items_service_idx ON public.inspiration_items USING btree (service_id);


--
-- Name: integration_settings_integration_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integration_settings_integration_key_unique ON public.integration_settings USING btree (integration, setting_key);


--
-- Name: integration_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_settings_updated_by_idx ON public.integration_settings USING btree (updated_by_user_id);


--
-- Name: jobseeker_profiles_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobseeker_profiles_updated_idx ON public.jobseeker_profiles USING btree (updated_at);


--
-- Name: jobseeker_salon_interests_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobseeker_salon_interests_salon_idx ON public.jobseeker_salon_interests USING btree (salon_id);


--
-- Name: jobseeker_salon_interests_user_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX jobseeker_salon_interests_user_salon_unique ON public.jobseeker_salon_interests USING btree (user_id, salon_id);


--
-- Name: legal_entities_normalized_pib_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_entities_normalized_pib_unique ON public.legal_entities USING btree (normalized_pib);


--
-- Name: legal_entity_businesses_center_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_entity_businesses_center_unique ON public.legal_entity_businesses USING btree (education_center_id) WHERE (education_center_id IS NOT NULL);


--
-- Name: legal_entity_businesses_entity_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_entity_businesses_entity_owner_idx ON public.legal_entity_businesses USING btree (legal_entity_id, owner_user_id);


--
-- Name: legal_entity_businesses_owner_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_entity_businesses_owner_user_idx ON public.legal_entity_businesses USING btree (owner_user_id);


--
-- Name: legal_entity_businesses_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_entity_businesses_salon_unique ON public.legal_entity_businesses USING btree (salon_id) WHERE (salon_id IS NOT NULL);


--
-- Name: lesson_progress_completed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lesson_progress_completed_by_idx ON public.lesson_progress USING btree (completed_by_user_id);


--
-- Name: lesson_progress_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lesson_progress_enrollment_idx ON public.lesson_progress USING btree (enrollment_id);


--
-- Name: lesson_progress_enrollment_lesson_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lesson_progress_enrollment_lesson_unique ON public.lesson_progress USING btree (enrollment_id, lesson_id);


--
-- Name: lesson_progress_lesson_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lesson_progress_lesson_idx ON public.lesson_progress USING btree (lesson_id);


--
-- Name: loyalty_point_ledger_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_point_ledger_order_idx ON public.loyalty_point_ledger USING btree (order_id);


--
-- Name: loyalty_point_ledger_retail_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_point_ledger_retail_order_idx ON public.loyalty_point_ledger USING btree (retail_order_id);


--
-- Name: loyalty_point_ledger_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_point_ledger_salon_created_idx ON public.loyalty_point_ledger USING btree (salon_id, created_at);


--
-- Name: loyalty_point_ledger_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_point_ledger_user_created_idx ON public.loyalty_point_ledger USING btree (user_id, created_at);


--
-- Name: loyalty_pricing_tier_product_exclusions_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_pricing_tier_product_exclusions_product_idx ON public.loyalty_pricing_tier_product_exclusions USING btree (product_id);


--
-- Name: loyalty_pricing_tier_product_exclusions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_pricing_tier_product_exclusions_unique ON public.loyalty_pricing_tier_product_exclusions USING btree (tier_id, product_id);


--
-- Name: loyalty_pricing_tiers_market_active_threshold_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_pricing_tiers_market_active_threshold_idx ON public.loyalty_pricing_tiers USING btree (market, active, spend_threshold_rsd);


--
-- Name: loyalty_pricing_tiers_market_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_pricing_tiers_market_name_unique ON public.loyalty_pricing_tiers USING btree (market, name);


--
-- Name: media_assets_cleanup_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_assets_cleanup_reservation_idx ON public.media_assets USING btree (resource_id, cleanup_reserved_at);


--
-- Name: media_assets_content_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_assets_content_hash_idx ON public.media_assets USING btree (content_hash);


--
-- Name: media_assets_owner_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_assets_owner_created_idx ON public.media_assets USING btree (owner_user_id, created_at);


--
-- Name: media_assets_scope_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_assets_scope_resource_idx ON public.media_assets USING btree (scope, resource_id);


--
-- Name: media_assets_test_cleanup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_assets_test_cleanup_idx ON public.media_assets USING btree (test_cleanup_key);


--
-- Name: media_upload_tickets_cleanup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_upload_tickets_cleanup_idx ON public.media_upload_tickets USING btree (expires_at, finalized_at);


--
-- Name: media_upload_tickets_finalized_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_upload_tickets_finalized_asset_idx ON public.media_upload_tickets USING btree (finalized_asset_id);


--
-- Name: media_upload_tickets_owner_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_upload_tickets_owner_expires_idx ON public.media_upload_tickets USING btree (owner_user_id, expires_at);


--
-- Name: media_upload_tickets_staging_path_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX media_upload_tickets_staging_path_unique ON public.media_upload_tickets USING btree (staging_object_path);


--
-- Name: media_upload_tickets_test_cleanup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_upload_tickets_test_cleanup_idx ON public.media_upload_tickets USING btree (test_cleanup_key);


--
-- Name: media_variants_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_variants_asset_idx ON public.media_variants USING btree (asset_id);


--
-- Name: media_variants_asset_size_format_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX media_variants_asset_size_format_unique ON public.media_variants USING btree (asset_id, size_name, format);


--
-- Name: media_variants_object_path_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX media_variants_object_path_unique ON public.media_variants USING btree (object_path);


--
-- Name: oauth_identities_provider_account_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX oauth_identities_provider_account_unique ON public.oauth_identities USING btree (provider, provider_account_id);


--
-- Name: oauth_identities_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_identities_user_idx ON public.oauth_identities USING btree (user_id);


--
-- Name: oauth_login_states_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_login_states_user_idx ON public.oauth_login_states USING btree (user_id);


--
-- Name: order_approval_request_lines_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_request_lines_bundle_idx ON public.order_approval_request_lines USING btree (bundle_id);


--
-- Name: order_approval_request_lines_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_request_lines_product_idx ON public.order_approval_request_lines USING btree (product_id);


--
-- Name: order_approval_request_lines_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_request_lines_request_idx ON public.order_approval_request_lines USING btree (request_id);


--
-- Name: order_approval_requests_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_requests_cart_idx ON public.order_approval_requests USING btree (cart_id);


--
-- Name: order_approval_requests_employee_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_requests_employee_created_idx ON public.order_approval_requests USING btree (employee_id, created_at);


--
-- Name: order_approval_requests_finalized_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_approval_requests_finalized_order_unique ON public.order_approval_requests USING btree (finalized_order_id) WHERE (finalized_order_id IS NOT NULL);


--
-- Name: order_approval_requests_reviewer_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_requests_reviewer_user_idx ON public.order_approval_requests USING btree (reviewer_user_id);


--
-- Name: order_approval_requests_salon_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_approval_requests_salon_key_unique ON public.order_approval_requests USING btree (salon_id, idempotency_key);


--
-- Name: order_approval_requests_salon_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_requests_salon_status_created_idx ON public.order_approval_requests USING btree (salon_id, status, created_at);


--
-- Name: order_approval_requests_submitted_by_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_approval_requests_submitted_by_user_idx ON public.order_approval_requests USING btree (submitted_by_user_id);


--
-- Name: order_bundle_components_item_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_bundle_components_item_product_unique ON public.order_bundle_components USING btree (order_item_id, product_id);


--
-- Name: order_bundle_components_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_bundle_components_product_idx ON public.order_bundle_components USING btree (product_id);


--
-- Name: order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id);


--
-- Name: order_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_product_idx ON public.order_items USING btree (product_id);


--
-- Name: order_items_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_supplier_idx ON public.order_items USING btree (supplier_id);


--
-- Name: order_status_history_order_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_status_history_order_created_idx ON public.order_status_history USING btree (order_id, created_at);


--
-- Name: orders_courier_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_courier_service_idx ON public.orders USING btree (courier_service_id);


--
-- Name: orders_payment_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_payment_status_idx ON public.orders USING btree (payment_status, created_at);


--
-- Name: orders_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_salon_created_idx ON public.orders USING btree (salon_id, created_at);


--
-- Name: orders_salon_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_salon_status_idx ON public.orders USING btree (salon_id, status);


--
-- Name: package_purchase_service_links_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_purchase_service_links_purchase_idx ON public.package_purchase_service_links USING btree (purchase_id);


--
-- Name: package_purchase_service_links_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_purchase_service_links_service_idx ON public.package_purchase_service_links USING btree (service_id);


--
-- Name: package_purchase_service_links_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX package_purchase_service_links_unique ON public.package_purchase_service_links USING btree (purchase_id, service_id);


--
-- Name: package_redemptions_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_appointment_idx ON public.package_redemptions USING btree (appointment_id);


--
-- Name: package_redemptions_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_customer_idx ON public.package_redemptions USING btree (salon_customer_id);


--
-- Name: package_redemptions_purchase_appointment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX package_redemptions_purchase_appointment_unique ON public.package_redemptions USING btree (purchase_id, appointment_id);


--
-- Name: package_redemptions_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_purchase_idx ON public.package_redemptions USING btree (purchase_id);


--
-- Name: package_redemptions_purchase_service_link_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_purchase_service_link_idx ON public.package_redemptions USING btree (purchase_service_link_id);


--
-- Name: package_redemptions_reversed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_reversed_by_idx ON public.package_redemptions USING btree (reversed_by_user_id);


--
-- Name: package_redemptions_salon_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_salon_customer_idx ON public.package_redemptions USING btree (salon_id, salon_customer_id);


--
-- Name: package_redemptions_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_redemptions_service_idx ON public.package_redemptions USING btree (service_id);


--
-- Name: package_service_links_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_service_links_service_idx ON public.package_service_links USING btree (service_id);


--
-- Name: package_service_links_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX package_service_links_unique ON public.package_service_links USING btree (package_id, service_id);


--
-- Name: phone_verification_proofs_phone_method_verified_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX phone_verification_proofs_phone_method_verified_unique ON public.phone_verification_proofs USING btree (phone_normalized, verification_method, verified_at);


--
-- Name: phone_verification_proofs_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_verification_proofs_user_active_idx ON public.phone_verification_proofs USING btree (user_id, verified_at) WHERE (revoked_at IS NULL);


--
-- Name: platform_retention_settings_changed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_retention_settings_changed_by_idx ON public.platform_retention_settings USING btree (changed_by_user_id);


--
-- Name: platform_retention_settings_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_retention_settings_version_unique ON public.platform_retention_settings USING btree (version);


--
-- Name: price_inquiries_product_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_inquiries_product_created_idx ON public.price_inquiries USING btree (product_id, created_at);


--
-- Name: price_inquiries_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_inquiries_status_created_idx ON public.price_inquiries USING btree (status, created_at);


--
-- Name: price_inquiries_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_inquiries_supplier_idx ON public.price_inquiries USING btree (supplier_id);


--
-- Name: product_bundle_components_bundle_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_bundle_components_bundle_product_unique ON public.product_bundle_components USING btree (bundle_id, product_id);


--
-- Name: product_bundle_components_bundle_sort_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_bundle_components_bundle_sort_unique ON public.product_bundle_components USING btree (bundle_id, sort_order);


--
-- Name: product_bundle_components_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_bundle_components_product_idx ON public.product_bundle_components USING btree (product_id);


--
-- Name: product_bundles_supplier_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_bundles_supplier_active_idx ON public.product_bundles USING btree (supplier_id, active);


--
-- Name: product_bundles_treatment_market_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_bundles_treatment_market_active_idx ON public.product_bundles USING btree (linked_treatment_id, market, active);


--
-- Name: product_categories_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_active_sort_idx ON public.product_categories USING btree (active, sort_order);


--
-- Name: product_categories_parent_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_parent_sort_idx ON public.product_categories USING btree (parent_id, sort_order);


--
-- Name: product_categories_supplier_active_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_supplier_active_sort_idx ON public.product_categories USING btree (supplier_id, active, sort_order);


--
-- Name: product_categories_supplier_parent_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_categories_supplier_parent_name_unique ON public.product_categories USING btree (supplier_id, parent_id, name);


--
-- Name: product_categories_supplier_parent_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_categories_supplier_parent_slug_unique ON public.product_categories USING btree (supplier_id, parent_id, slug);


--
-- Name: product_categories_supplier_parent_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_supplier_parent_sort_idx ON public.product_categories USING btree (supplier_id, parent_id, sort_order);


--
-- Name: product_categories_supplier_root_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_categories_supplier_root_name_unique ON public.product_categories USING btree (supplier_id, name) WHERE (parent_id IS NULL);


--
-- Name: product_categories_supplier_root_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_categories_supplier_root_slug_unique ON public.product_categories USING btree (supplier_id, slug) WHERE (parent_id IS NULL);


--
-- Name: product_documents_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_documents_asset_idx ON public.product_documents USING btree (media_asset_id);


--
-- Name: product_documents_product_asset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_documents_product_asset_unique ON public.product_documents USING btree (product_id, media_asset_id);


--
-- Name: product_documents_product_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_documents_product_sort_idx ON public.product_documents USING btree (product_id, sort_order, id);


--
-- Name: product_reviews_product_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_reviews_product_salon_unique ON public.product_reviews USING btree (product_id, salon_id);


--
-- Name: product_reviews_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_reviews_salon_idx ON public.product_reviews USING btree (salon_id);


--
-- Name: product_treatment_mappings_treatment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_treatment_mappings_treatment_idx ON public.product_treatment_mappings USING btree (treatment_id, product_id);


--
-- Name: product_treatment_mappings_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_treatment_mappings_unique ON public.product_treatment_mappings USING btree (product_id, treatment_id);


--
-- Name: product_upsell_links_alternative_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_upsell_links_alternative_idx ON public.product_upsell_links USING btree (alternative_product_id);


--
-- Name: product_upsell_links_product_alternative_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_upsell_links_product_alternative_unique ON public.product_upsell_links USING btree (product_id, alternative_product_id);


--
-- Name: product_upsell_links_product_sort_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_upsell_links_product_sort_unique ON public.product_upsell_links USING btree (product_id, sort_order);


--
-- Name: product_waitlist_active_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_waitlist_active_salon_unique ON public.product_waitlist USING btree (product_id, salon_id) WHERE ((status = 'ACTIVE'::public.product_waitlist_status) AND (salon_id IS NOT NULL));


--
-- Name: product_waitlist_active_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_waitlist_active_user_unique ON public.product_waitlist USING btree (product_id, user_id) WHERE ((status = 'ACTIVE'::public.product_waitlist_status) AND (user_id IS NOT NULL));


--
-- Name: product_waitlist_notification_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_notification_outbox_pending_idx ON public.product_waitlist_notification_outbox USING btree (created_at) WHERE (processed_at IS NULL);


--
-- Name: product_waitlist_notification_outbox_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_notification_outbox_product_idx ON public.product_waitlist_notification_outbox USING btree (product_id);


--
-- Name: product_waitlist_notification_outbox_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_notification_outbox_salon_idx ON public.product_waitlist_notification_outbox USING btree (salon_id);


--
-- Name: product_waitlist_notification_outbox_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_notification_outbox_user_idx ON public.product_waitlist_notification_outbox USING btree (user_id);


--
-- Name: product_waitlist_product_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_product_status_idx ON public.product_waitlist USING btree (product_id, status);


--
-- Name: product_waitlist_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_salon_idx ON public.product_waitlist USING btree (salon_id);


--
-- Name: product_waitlist_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_waitlist_user_idx ON public.product_waitlist USING btree (user_id);


--
-- Name: product_wishlists_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_wishlists_product_idx ON public.product_wishlists USING btree (product_id);


--
-- Name: product_wishlists_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_wishlists_user_created_idx ON public.product_wishlists USING btree (user_id, created_at);


--
-- Name: products_active_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_active_created_idx ON public.products USING btree (active, created_at);


--
-- Name: products_b2c_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_b2c_search_idx ON public.products USING gin (to_tsvector('simple'::regconfig, ((((((COALESCE(name, ''::text) || ' '::text) || COALESCE(brand, ''::text)) || ' '::text) || COALESCE(category_name, ''::text)) || ' '::text) || COALESCE(subcategory_name, ''::text))));


--
-- Name: products_brand_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_brand_active_idx ON public.products USING btree (brand, active);


--
-- Name: products_catalog_reference_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_catalog_reference_unique ON public.products USING btree (catalog_reference);


--
-- Name: products_category_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_category_active_idx ON public.products USING btree (category_id, active);


--
-- Name: products_product_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_product_type_idx ON public.products USING btree (product_type_id);


--
-- Name: products_professional_active_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_professional_active_created_idx ON public.products USING btree (professional_enabled, active, created_at);


--
-- Name: products_retail_active_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_retail_active_created_idx ON public.products USING btree (retail_enabled, active, created_at);


--
-- Name: products_supplier_active_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_supplier_active_created_idx ON public.products USING btree (supplier_id, active, created_at);


--
-- Name: products_supplier_category_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_supplier_category_active_idx ON public.products USING btree (supplier_id, category_id, active);


--
-- Name: products_supplier_retail_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_supplier_retail_brand_idx ON public.products USING btree (supplier_id, retail_enabled, active, brand, id);


--
-- Name: products_supplier_retail_price_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_supplier_retail_price_idx ON public.products USING btree (supplier_id, retail_enabled, active, public_price, id);


--
-- Name: products_supplier_type_retail_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_supplier_type_retail_active_idx ON public.products USING btree (supplier_id, product_type_id, retail_enabled, active);


--
-- Name: push_subscriptions_endpoint_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_subscriptions_endpoint_unique ON public.push_subscriptions USING btree (endpoint);


--
-- Name: push_subscriptions_user_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_enabled_idx ON public.push_subscriptions USING btree (user_id, enabled);


--
-- Name: referral_attributions_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_attributions_idempotency_unique ON public.referral_attributions USING btree (idempotency_key);


--
-- Name: referral_attributions_referral_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_attributions_referral_code_idx ON public.referral_attributions USING btree (referral_code_id);


--
-- Name: referral_attributions_referred_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_attributions_referred_center_idx ON public.referral_attributions USING btree (referred_education_center_id);


--
-- Name: referral_attributions_referred_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_attributions_referred_salon_idx ON public.referral_attributions USING btree (referred_salon_id);


--
-- Name: referral_attributions_referred_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_attributions_referred_user_unique ON public.referral_attributions USING btree (referred_user_id);


--
-- Name: referral_attributions_referrer_channel_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_attributions_referrer_channel_created_idx ON public.referral_attributions USING btree (referrer_user_id, channel, created_at);


--
-- Name: referral_codes_center_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_codes_center_channel_idx ON public.referral_codes USING btree (referrer_education_center_id, channel);


--
-- Name: referral_codes_center_channel_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_codes_center_channel_unique ON public.referral_codes USING btree (referrer_education_center_id, channel) WHERE (referrer_education_center_id IS NOT NULL);


--
-- Name: referral_codes_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_codes_code_unique ON public.referral_codes USING btree (code);


--
-- Name: referral_codes_salon_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_codes_salon_channel_idx ON public.referral_codes USING btree (referrer_salon_id, channel);


--
-- Name: referral_codes_salon_channel_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_codes_salon_channel_unique ON public.referral_codes USING btree (referrer_salon_id, channel) WHERE (referrer_salon_id IS NOT NULL);


--
-- Name: referral_codes_user_channel_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_codes_user_channel_unique ON public.referral_codes USING btree (referrer_user_id, channel) WHERE ((referrer_salon_id IS NULL) AND (referrer_education_center_id IS NULL));


--
-- Name: referral_credit_ledger_actor_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_credit_ledger_actor_user_idx ON public.referral_credit_ledger USING btree (actor_user_id);


--
-- Name: referral_credit_ledger_center_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_credit_ledger_center_effective_idx ON public.referral_credit_ledger USING btree (education_center_id, effective_at);


--
-- Name: referral_credit_ledger_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_credit_ledger_idempotency_unique ON public.referral_credit_ledger USING btree (idempotency_key);


--
-- Name: referral_credit_ledger_owner_wallet_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_credit_ledger_owner_wallet_effective_idx ON public.referral_credit_ledger USING btree (owner_user_id, wallet_kind, effective_at);


--
-- Name: referral_credit_ledger_referral_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_credit_ledger_referral_attribution_idx ON public.referral_credit_ledger USING btree (referral_attribution_id);


--
-- Name: referral_credit_ledger_salon_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_credit_ledger_salon_effective_idx ON public.referral_credit_ledger USING btree (salon_id, effective_at);


--
-- Name: referral_credit_redemptions_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_credit_redemptions_idempotency_unique ON public.referral_credit_redemptions USING btree (idempotency_key);


--
-- Name: referral_credit_redemptions_ledger_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_credit_redemptions_ledger_entry_idx ON public.referral_credit_redemptions USING btree (ledger_entry_id);


--
-- Name: referral_credit_redemptions_order_ledger_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_credit_redemptions_order_ledger_unique ON public.referral_credit_redemptions USING btree (order_id, ledger_entry_id) WHERE (order_id IS NOT NULL);


--
-- Name: referral_credit_redemptions_retail_order_ledger_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_credit_redemptions_retail_order_ledger_unique ON public.referral_credit_redemptions USING btree (retail_order_id, ledger_entry_id) WHERE (retail_order_id IS NOT NULL);


--
-- Name: referral_milestone_benefits_center_channel_count_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_milestone_benefits_center_channel_count_unique ON public.referral_milestone_benefits USING btree (benefit_education_center_id, channel, qualifying_count) WHERE (benefit_education_center_id IS NOT NULL);


--
-- Name: referral_milestone_benefits_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_milestone_benefits_idempotency_unique ON public.referral_milestone_benefits USING btree (idempotency_key);


--
-- Name: referral_milestone_benefits_neutralized_by_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_milestone_benefits_neutralized_by_user_idx ON public.referral_milestone_benefits USING btree (neutralized_by_user_id);


--
-- Name: referral_milestone_benefits_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_milestone_benefits_pending_idx ON public.referral_milestone_benefits USING btree (channel, billing_cycle_start) WHERE (applied_at IS NULL);


--
-- Name: referral_milestone_benefits_referrer_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_milestone_benefits_referrer_user_idx ON public.referral_milestone_benefits USING btree (referrer_user_id);


--
-- Name: referral_milestone_benefits_salon_channel_count_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_milestone_benefits_salon_channel_count_unique ON public.referral_milestone_benefits USING btree (benefit_salon_id, channel, qualifying_count) WHERE (benefit_salon_id IS NOT NULL);


--
-- Name: referral_qualification_evidence_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_qualification_evidence_appointment_idx ON public.referral_qualification_evidence USING btree (appointment_id);


--
-- Name: referral_qualification_evidence_appointment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_qualification_evidence_appointment_unique ON public.referral_qualification_evidence USING btree (qualification_id, appointment_id) WHERE (appointment_id IS NOT NULL);


--
-- Name: referral_qualification_evidence_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_qualification_evidence_enrollment_idx ON public.referral_qualification_evidence USING btree (enrollment_id);


--
-- Name: referral_qualification_evidence_enrollment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_qualification_evidence_enrollment_unique ON public.referral_qualification_evidence USING btree (qualification_id, enrollment_id) WHERE (enrollment_id IS NOT NULL);


--
-- Name: referral_qualification_evidence_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX referral_qualification_evidence_idempotency_unique ON public.referral_qualification_evidence USING btree (idempotency_key);


--
-- Name: referral_qualifications_referred_education_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_qualifications_referred_education_center_idx ON public.referral_qualifications USING btree (referred_education_center_id);


--
-- Name: referral_qualifications_referred_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_qualifications_referred_salon_idx ON public.referral_qualifications USING btree (referred_salon_id);


--
-- Name: referral_qualifications_status_hold_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_qualifications_status_hold_idx ON public.referral_qualifications USING btree (status, hold_until);


--
-- Name: referral_reviews_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_reviews_attribution_idx ON public.referral_reviews USING btree (attribution_id);


--
-- Name: referral_reviews_qualification_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_reviews_qualification_idx ON public.referral_reviews USING btree (qualification_id);


--
-- Name: referral_reviews_reviewed_by_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_reviews_reviewed_by_user_idx ON public.referral_reviews USING btree (reviewed_by_user_id);


--
-- Name: referral_reviews_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_reviews_status_created_idx ON public.referral_reviews USING btree (status, created_at);


--
-- Name: reorder_actions_salon_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reorder_actions_salon_key_unique ON public.reorder_actions USING btree (salon_id, idempotency_key) WHERE (salon_id IS NOT NULL);


--
-- Name: reorder_actions_user_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reorder_actions_user_key_unique ON public.reorder_actions USING btree (user_id, idempotency_key) WHERE (user_id IS NOT NULL);


--
-- Name: retail_cart_items_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_cart_items_bundle_idx ON public.retail_cart_items USING btree (bundle_id);


--
-- Name: retail_cart_items_cart_bundle_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_cart_items_cart_bundle_unique ON public.retail_cart_items USING btree (cart_id, bundle_id) WHERE (bundle_id IS NOT NULL);


--
-- Name: retail_cart_items_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_cart_items_cart_idx ON public.retail_cart_items USING btree (cart_id);


--
-- Name: retail_cart_items_cart_product_variant_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_cart_items_cart_product_variant_unique ON public.retail_cart_items USING btree (cart_id, product_id, variant_value) NULLS NOT DISTINCT;


--
-- Name: retail_cart_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_cart_items_product_idx ON public.retail_cart_items USING btree (product_id);


--
-- Name: retail_carts_reminder_sweep_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_carts_reminder_sweep_idx ON public.retail_carts USING btree (updated_at, activity_version) WHERE ((reminder_enqueued_activity_version IS NULL) OR (reminder_enqueued_activity_version < activity_version));


--
-- Name: retail_carts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_carts_user_idx ON public.retail_carts USING btree (user_id);


--
-- Name: retail_order_items_aftercare_recommendation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_order_items_aftercare_recommendation_idx ON public.retail_order_items USING btree (aftercare_recommendation_id) WHERE (aftercare_recommendation_id IS NOT NULL);


--
-- Name: retail_order_items_catalog_reference_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_order_items_catalog_reference_order_idx ON public.retail_order_items USING btree (product_catalog_reference, order_id);


--
-- Name: retail_order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_order_items_order_idx ON public.retail_order_items USING btree (order_id);


--
-- Name: retail_order_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_order_items_product_idx ON public.retail_order_items USING btree (product_id);


--
-- Name: retail_order_items_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_order_items_supplier_idx ON public.retail_order_items USING btree (supplier_id);


--
-- Name: retail_order_status_history_order_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_order_status_history_order_created_idx ON public.retail_order_status_history USING btree (retail_order_id, created_at);


--
-- Name: retail_orders_cart_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_orders_cart_idempotency_unique ON public.retail_orders USING btree (cart_id, idempotency_key);


--
-- Name: retail_orders_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_orders_status_created_idx ON public.retail_orders USING btree (status, created_at);


--
-- Name: retail_orders_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_orders_user_created_idx ON public.retail_orders USING btree (user_id, created_at);


--
-- Name: retail_product_review_attachments_asset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_product_review_attachments_asset_unique ON public.retail_product_review_attachments USING btree (media_asset_id);


--
-- Name: retail_product_review_attachments_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_review_attachments_review_idx ON public.retail_product_review_attachments USING btree (review_id);


--
-- Name: retail_product_reviews_item_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_product_reviews_item_user_unique ON public.retail_product_reviews USING btree (order_item_id, user_id);


--
-- Name: retail_product_reviews_order_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_reviews_order_item_idx ON public.retail_product_reviews USING btree (order_item_id);


--
-- Name: retail_product_reviews_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_reviews_product_idx ON public.retail_product_reviews USING btree (product_id);


--
-- Name: retail_product_reviews_product_moderation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_reviews_product_moderation_idx ON public.retail_product_reviews USING btree (product_id, moderation_status);


--
-- Name: retail_product_reviews_product_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_reviews_product_status_created_idx ON public.retail_product_reviews USING btree (product_id, moderation_status, created_at);


--
-- Name: retail_product_reviews_product_user_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_product_reviews_product_user_active_unique ON public.retail_product_reviews USING btree (product_id, user_id) WHERE (moderation_status <> 'REMOVED'::public.retail_review_moderation_status);


--
-- Name: retail_product_reviews_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_reviews_user_idx ON public.retail_product_reviews USING btree (user_id);


--
-- Name: retail_product_subscriptions_due_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_subscriptions_due_claim_idx ON public.retail_product_subscriptions USING btree (status, next_due_at);


--
-- Name: retail_product_subscriptions_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_subscriptions_product_idx ON public.retail_product_subscriptions USING btree (product_id);


--
-- Name: retail_product_subscriptions_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_product_subscriptions_user_created_idx ON public.retail_product_subscriptions USING btree (user_id, created_at);


--
-- Name: retail_review_moderation_audits_moderator_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_review_moderation_audits_moderator_created_idx ON public.retail_product_review_moderation_audits USING btree (moderator_user_id, created_at);


--
-- Name: retail_review_moderation_audits_review_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_review_moderation_audits_review_created_idx ON public.retail_product_review_moderation_audits USING btree (review_id, created_at);


--
-- Name: retail_review_reports_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_review_reports_reporter_idx ON public.retail_product_review_reports USING btree (reporter_user_id);


--
-- Name: retail_review_reports_review_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_review_reports_review_created_idx ON public.retail_product_review_reports USING btree (review_id, created_at);


--
-- Name: retail_review_reports_review_reporter_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_review_reports_review_reporter_unique ON public.retail_product_review_reports USING btree (review_id, reporter_user_id);


--
-- Name: retail_subscription_attempts_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_subscription_attempts_order_idx ON public.retail_product_subscription_attempts USING btree (order_id);


--
-- Name: retail_subscription_attempts_status_claimed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_subscription_attempts_status_claimed_idx ON public.retail_product_subscription_attempts USING btree (status, claimed_at);


--
-- Name: retail_subscription_attempts_subscription_due_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX retail_subscription_attempts_subscription_due_unique ON public.retail_product_subscription_attempts USING btree (subscription_id, due_at);


--
-- Name: retail_tracking_rate_limits_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retail_tracking_rate_limits_updated_idx ON public.retail_tracking_rate_limits USING btree (updated_at);


--
-- Name: review_invitations_appointment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX review_invitations_appointment_unique ON public.review_invitations USING btree (appointment_id);


--
-- Name: review_invitations_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_invitations_customer_idx ON public.review_invitations USING btree (customer_id, invited_at);


--
-- Name: review_invitations_notification_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_invitations_notification_idx ON public.review_invitations USING btree (notification_id);


--
-- Name: review_reward_issuances_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX review_reward_issuances_order_unique ON public.review_reward_issuances USING btree (order_id);


--
-- Name: review_reward_issuances_review_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX review_reward_issuances_review_unique ON public.review_reward_issuances USING btree (review_id);


--
-- Name: reviews_customer_salon_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reviews_customer_salon_unique ON public.reviews USING btree (customer_id, salon_id);


--
-- Name: reviews_employee_visible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_employee_visible_idx ON public.reviews USING btree (employee_id, visible);


--
-- Name: reviews_salon_visible_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_salon_visible_created_idx ON public.reviews USING btree (salon_id, visible, created_at);


--
-- Name: rma_attachments_asset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rma_attachments_asset_unique ON public.rma_attachments USING btree (media_asset_id);


--
-- Name: rma_attachments_rma_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rma_attachments_rma_idx ON public.rma_attachments USING btree (rma_id);


--
-- Name: rma_status_history_actor_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rma_status_history_actor_user_idx ON public.rma_status_history USING btree (actor_user_id);


--
-- Name: rma_status_history_rma_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rma_status_history_rma_created_idx ON public.rma_status_history USING btree (rma_id, created_at);


--
-- Name: rmas_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rmas_number_unique ON public.rmas USING btree (rma_number);


--
-- Name: rmas_order_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rmas_order_created_idx ON public.rmas USING btree (order_id, created_at);


--
-- Name: rmas_order_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rmas_order_item_idx ON public.rmas USING btree (order_item_id);


--
-- Name: rmas_requester_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rmas_requester_user_idx ON public.rmas USING btree (requester_user_id);


--
-- Name: rmas_retail_order_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rmas_retail_order_created_idx ON public.rmas USING btree (retail_order_id, created_at);


--
-- Name: rmas_retail_order_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rmas_retail_order_item_idx ON public.rmas USING btree (retail_order_item_id);


--
-- Name: rmas_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rmas_status_created_idx ON public.rmas USING btree (status, created_at);


--
-- Name: salon_booking_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_booking_settings_updated_by_idx ON public.salon_booking_settings USING btree (updated_by_user_id);


--
-- Name: salon_brands_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_brands_brand_idx ON public.salon_brands USING btree (brand_id);


--
-- Name: salon_brands_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_brands_salon_idx ON public.salon_brands USING btree (salon_id);


--
-- Name: salon_customers_phone_legacy_normalized_expr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_customers_phone_legacy_normalized_expr_idx ON public.salon_customers USING btree (NULLIF(
CASE
    WHEN (regexp_replace(regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '^00'::text, ''::text) ~~ '0%'::text) THEN ('381'::text || SUBSTRING(regexp_replace(regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '^00'::text, ''::text) FROM 2))
    ELSE regexp_replace(regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '^00'::text, ''::text)
END, ''::text)) WHERE (NULLIF(
CASE
    WHEN (regexp_replace(regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '^00'::text, ''::text) ~~ '0%'::text) THEN ('381'::text || SUBSTRING(regexp_replace(regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '^00'::text, ''::text) FROM 2))
    ELSE regexp_replace(regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '^00'::text, ''::text)
END, ''::text) IS NOT NULL);


--
-- Name: salon_customers_phone_normalized_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_customers_phone_normalized_idx ON public.salon_customers USING btree (phone_normalized) WHERE (phone_normalized IS NOT NULL);


--
-- Name: salon_customers_salon_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_customers_salon_id_idx ON public.salon_customers USING btree (salon_id, id);


--
-- Name: salon_customers_salon_phone_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_customers_salon_phone_normalized_unique ON public.salon_customers USING btree (salon_id, phone_normalized);


--
-- Name: salon_customers_salon_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_customers_salon_user_unique ON public.salon_customers USING btree (salon_id, user_id);


--
-- Name: salon_customers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_customers_user_idx ON public.salon_customers USING btree (user_id);


--
-- Name: salon_date_hours_salon_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_date_hours_salon_date_unique ON public.salon_date_hours USING btree (salon_id, date);


--
-- Name: salon_hours_salon_weekday_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_hours_salon_weekday_idx ON public.salon_hours USING btree (salon_id, weekday);


--
-- Name: salon_inventory_movements_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_movements_appointment_idx ON public.salon_inventory_movements USING btree (appointment_id);


--
-- Name: salon_inventory_movements_consumption_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_inventory_movements_consumption_unique ON public.salon_inventory_movements USING btree (appointment_id, product_id) WHERE (type = 'consumption'::public.salon_inventory_movement_type);


--
-- Name: salon_inventory_movements_inventory_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_movements_inventory_created_idx ON public.salon_inventory_movements USING btree (inventory_id, created_at);


--
-- Name: salon_inventory_movements_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_movements_order_idx ON public.salon_inventory_movements USING btree (order_id);


--
-- Name: salon_inventory_movements_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_movements_product_idx ON public.salon_inventory_movements USING btree (product_id);


--
-- Name: salon_inventory_movements_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_movements_salon_created_idx ON public.salon_inventory_movements USING btree (salon_id, created_at);


--
-- Name: salon_inventory_movements_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_movements_service_idx ON public.salon_inventory_movements USING btree (service_id);


--
-- Name: salon_inventory_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_inventory_product_idx ON public.salon_inventory USING btree (product_id);


--
-- Name: salon_inventory_salon_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_inventory_salon_product_unique ON public.salon_inventory USING btree (salon_id, product_id);


--
-- Name: salon_location_creation_requests_owner_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_location_creation_requests_owner_key_unique ON public.salon_location_creation_requests USING btree (owner_id, idempotency_key);


--
-- Name: salon_loyalty_statuses_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_loyalty_statuses_tier_idx ON public.salon_loyalty_statuses USING btree (tier_id);


--
-- Name: salon_notification_archives_archived_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_notification_archives_archived_at_idx ON public.salon_notification_archives USING btree (archived_at);


--
-- Name: salon_notifications_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_notifications_retention_idx ON public.salon_notifications USING btree (created_at) WHERE (read_at IS NOT NULL);


--
-- Name: salon_notifications_salon_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_notifications_salon_created_at_idx ON public.salon_notifications USING btree (salon_id, created_at);


--
-- Name: salon_resource_downtime_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_resource_downtime_created_by_idx ON public.salon_resource_downtime USING btree (created_by_user_id);


--
-- Name: salon_resource_downtime_resource_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_resource_downtime_resource_window_idx ON public.salon_resource_downtime USING btree (resource_id, starts_at, ends_at);


--
-- Name: salon_resources_salon_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salon_resources_salon_active_idx ON public.salon_resources USING btree (salon_id, active);


--
-- Name: salon_resources_salon_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX salon_resources_salon_name_unique ON public.salon_resources USING btree (salon_id, name);


--
-- Name: salons_city_active_rating_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salons_city_active_rating_idx ON public.salons USING btree (city, active, rating);


--
-- Name: salons_city_normalized_active_rating_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salons_city_normalized_active_rating_idx ON public.salons USING btree (lower(city), active, rating);


--
-- Name: salons_featured_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salons_featured_active_idx ON public.salons USING btree (featured, active);


--
-- Name: salons_municipality_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salons_municipality_active_idx ON public.salons USING btree (municipality, active);


--
-- Name: salons_municipality_normalized_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salons_municipality_normalized_active_idx ON public.salons USING btree (lower(municipality), active);


--
-- Name: salons_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salons_owner_idx ON public.salons USING btree (owner_id);


--
-- Name: saved_retail_cart_items_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_retail_cart_items_bundle_idx ON public.saved_retail_cart_items USING btree (bundle_id);


--
-- Name: saved_retail_cart_items_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_retail_cart_items_cart_idx ON public.saved_retail_cart_items USING btree (cart_id);


--
-- Name: saved_retail_cart_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_retail_cart_items_product_idx ON public.saved_retail_cart_items USING btree (product_id);


--
-- Name: saved_shop_cart_items_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_shop_cart_items_bundle_idx ON public.saved_shop_cart_items USING btree (bundle_id);


--
-- Name: saved_shop_cart_items_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_shop_cart_items_cart_idx ON public.saved_shop_cart_items USING btree (cart_id);


--
-- Name: saved_shop_cart_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_shop_cart_items_product_idx ON public.saved_shop_cart_items USING btree (product_id);


--
-- Name: service_add_on_resource_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_add_on_resource_resource_idx ON public.service_add_on_resource_requirements USING btree (resource_id);


--
-- Name: service_add_on_resource_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_add_on_resource_unique ON public.service_add_on_resource_requirements USING btree (add_on_id, resource_id);


--
-- Name: service_add_ons_service_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_add_ons_service_active_idx ON public.service_add_ons USING btree (service_id, active);


--
-- Name: service_add_ons_service_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_add_ons_service_name_unique ON public.service_add_ons USING btree (service_id, name);


--
-- Name: service_product_consumptions_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_product_consumptions_product_idx ON public.service_product_consumptions USING btree (product_id);


--
-- Name: service_product_consumptions_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_product_consumptions_salon_idx ON public.service_product_consumptions USING btree (salon_id);


--
-- Name: service_product_consumptions_service_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_product_consumptions_service_product_unique ON public.service_product_consumptions USING btree (service_id, product_id);


--
-- Name: service_resource_requirements_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_resource_requirements_resource_idx ON public.service_resource_requirements USING btree (resource_id);


--
-- Name: service_resource_requirements_service_resource_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_resource_requirements_service_resource_unique ON public.service_resource_requirements USING btree (service_id, resource_id);


--
-- Name: service_templates_category_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_templates_category_name_unique ON public.service_templates USING btree (main_category, name);


--
-- Name: service_templates_category_subcategory_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_templates_category_subcategory_index ON public.service_templates USING btree (main_category, subcategory);


--
-- Name: services_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_category_idx ON public.services USING btree (category_id);


--
-- Name: services_salon_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_salon_active_idx ON public.services USING btree (salon_id, active);


--
-- Name: services_salon_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_salon_category_idx ON public.services USING btree (salon_id, category_id);


--
-- Name: sessions_user_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_expires_idx ON public.sessions USING btree (user_id, expires_at);


--
-- Name: shift_swap_requests_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swap_requests_requester_idx ON public.shift_swap_requests USING btree (requester_employee_id, created_at);


--
-- Name: shift_swap_requests_salon_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swap_requests_salon_status_idx ON public.shift_swap_requests USING btree (salon_id, status, created_at);


--
-- Name: shift_swap_requests_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swap_requests_target_idx ON public.shift_swap_requests USING btree (target_employee_id, created_at);


--
-- Name: shipping_rules_singleton_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shipping_rules_singleton_unique ON public.shipping_rules USING btree ((true));


--
-- Name: shop_settings_singleton_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shop_settings_singleton_unique ON public.shop_settings USING btree ((true));


--
-- Name: shopping_cart_items_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopping_cart_items_bundle_idx ON public.shopping_cart_items USING btree (bundle_id);


--
-- Name: shopping_cart_items_cart_bundle_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shopping_cart_items_cart_bundle_unique ON public.shopping_cart_items USING btree (cart_id, bundle_id) WHERE (bundle_id IS NOT NULL);


--
-- Name: shopping_cart_items_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopping_cart_items_cart_idx ON public.shopping_cart_items USING btree (cart_id);


--
-- Name: shopping_cart_items_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopping_cart_items_product_idx ON public.shopping_cart_items USING btree (product_id);


--
-- Name: sms_deliveries_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_deliveries_appointment_idx ON public.sms_deliveries USING btree (appointment_id);


--
-- Name: sms_deliveries_claim_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_deliveries_claim_expiry_idx ON public.sms_deliveries USING btree (status, claim_expires_at);


--
-- Name: sms_deliveries_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_deliveries_retention_idx ON public.sms_deliveries USING btree (created_at) WHERE (status = ANY (ARRAY['sent'::public.sms_delivery_status, 'skipped'::public.sms_delivery_status]));


--
-- Name: sms_deliveries_retry_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_deliveries_retry_index ON public.sms_deliveries USING btree (status, next_retry_at);


--
-- Name: sms_deliveries_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_deliveries_salon_idx ON public.sms_deliveries USING btree (salon_id);


--
-- Name: sms_delivery_archives_archived_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_delivery_archives_archived_at_idx ON public.sms_delivery_archives USING btree (archived_at);


--
-- Name: subscription_plans_audience_active_price_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_plans_audience_active_price_idx ON public.subscription_plans USING btree (audience, active, price);


--
-- Name: subscriptions_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_plan_idx ON public.subscriptions USING btree (plan_id);


--
-- Name: subscriptions_salon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_salon_idx ON public.subscriptions USING btree (salon_id);


--
-- Name: suppliers_active_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppliers_active_name_idx ON public.suppliers USING btree (active, name);


--
-- Name: system_push_deliveries_claim_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_push_deliveries_claim_expiry_idx ON public.system_push_deliveries USING btree (claim_expires_at);


--
-- Name: system_push_deliveries_event_subscription_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_push_deliveries_event_subscription_unique ON public.system_push_deliveries USING btree (event_key, subscription_id);


--
-- Name: system_push_deliveries_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_push_deliveries_ready_idx ON public.system_push_deliveries USING btree (status, next_attempt_at);


--
-- Name: system_push_deliveries_subscription_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_push_deliveries_subscription_idx ON public.system_push_deliveries USING btree (subscription_id);


--
-- Name: system_push_deliveries_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_push_deliveries_user_idx ON public.system_push_deliveries USING btree (user_id);


--
-- Name: treatment_packages_salon_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_packages_salon_active_idx ON public.treatment_packages USING btree (salon_id, active);


--
-- Name: treatment_photos_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_photos_appointment_idx ON public.treatment_photos USING btree (appointment_id);


--
-- Name: treatment_photos_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_photos_employee_idx ON public.treatment_photos USING btree (employee_id);


--
-- Name: treatment_photos_media_asset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX treatment_photos_media_asset_unique ON public.treatment_photos USING btree (media_asset_id);


--
-- Name: treatment_photos_salon_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_photos_salon_created_idx ON public.treatment_photos USING btree (salon_id, created_at);


--
-- Name: treatment_photos_salon_customer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_photos_salon_customer_created_idx ON public.treatment_photos USING btree (salon_customer_id, created_at);


--
-- Name: treatment_photos_uploaded_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_photos_uploaded_by_idx ON public.treatment_photos USING btree (uploaded_by_user_id);


--
-- Name: treatment_taxonomy_active_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treatment_taxonomy_active_name_idx ON public.treatment_taxonomy USING btree (active, category_name, treatment_name);


--
-- Name: users_phone_normalized_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_phone_normalized_unique ON public.users USING btree (phone_normalized) WHERE (phone_normalized IS NOT NULL);


--
-- Name: b2c_promotional_banners b2c_banners_validate_destination; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER b2c_banners_validate_destination BEFORE INSERT OR UPDATE OF supplier_id, destination_category_id, destination_product_id ON public.b2c_promotional_banners FOR EACH ROW EXECUTE FUNCTION public.validate_b2c_banner_destination();


--
-- Name: education_bundle_purchases education_bundle_purchases_payment_reference_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER education_bundle_purchases_payment_reference_immutable BEFORE UPDATE OF payment_reference, payment_instructions ON public.education_bundle_purchases FOR EACH ROW EXECUTE FUNCTION public.reject_bundle_payment_reference_change();


--
-- Name: education_centers education_centers_immutable_payment_reference; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER education_centers_immutable_payment_reference BEFORE INSERT OR UPDATE OF payment_reference_number ON public.education_centers FOR EACH ROW EXECUTE FUNCTION public.assign_immutable_business_payment_reference();


--
-- Name: education_gift_vouchers education_gift_vouchers_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER education_gift_vouchers_snapshot_immutable BEFORE UPDATE ON public.education_gift_vouchers FOR EACH ROW EXECUTE FUNCTION public.prevent_education_gift_voucher_snapshot_update();


--
-- Name: order_bundle_components order_bundle_components_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_bundle_components_immutable BEFORE UPDATE ON public.order_bundle_components FOR EACH ROW EXECUTE FUNCTION public.prevent_order_bundle_component_update();


--
-- Name: order_items order_items_commercial_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_commercial_snapshot_immutable BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_order_item_commercial_snapshot_update();


--
-- Name: order_items order_items_coupon_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_coupon_snapshot_immutable BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_coupon_order_snapshot_update();


--
-- Name: order_items order_items_g2_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_g2_snapshot_immutable BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_order_g2_snapshot_update();


--
-- Name: orders orders_invoice_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_invoice_snapshot_immutable BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.prevent_b2b_invoice_snapshot_update();


--
-- Name: orders orders_promotion_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_promotion_snapshot_immutable BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.prevent_order_promotion_snapshot_update();


--
-- Name: product_bundle_components product_bundle_components_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_bundle_components_validate BEFORE INSERT OR UPDATE ON public.product_bundle_components FOR EACH ROW EXECUTE FUNCTION public.validate_bundle_component();


--
-- Name: product_categories product_categories_supplier_ownership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_categories_supplier_ownership BEFORE INSERT OR UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.enforce_supplier_catalog_ownership();


--
-- Name: products products_enqueue_restocked_waitlist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_enqueue_restocked_waitlist AFTER UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION public.enqueue_restocked_product_waitlist();


--
-- Name: products products_supplier_ownership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_supplier_ownership BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_supplier_catalog_ownership();


--
-- Name: aftercare_recommendations protect_aftercare_recommendation_evidence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_aftercare_recommendation_evidence BEFORE UPDATE ON public.aftercare_recommendations FOR EACH ROW EXECUTE FUNCTION public.protect_aftercare_evidence();


--
-- Name: aftercare_recommendation_lines protect_aftercare_recommendation_line_evidence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_aftercare_recommendation_line_evidence BEFORE UPDATE ON public.aftercare_recommendation_lines FOR EACH ROW EXECUTE FUNCTION public.protect_aftercare_line_evidence();


--
-- Name: referral_attributions referral_attributions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER referral_attributions_append_only BEFORE DELETE OR UPDATE ON public.referral_attributions FOR EACH ROW EXECUTE FUNCTION public.referral_protect_attribution_identity();


--
-- Name: referral_credit_ledger referral_credit_ledger_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER referral_credit_ledger_append_only BEFORE DELETE OR UPDATE ON public.referral_credit_ledger FOR EACH ROW EXECUTE FUNCTION public.referral_prevent_mutation();


--
-- Name: referral_credit_redemptions referral_credit_redemptions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER referral_credit_redemptions_append_only BEFORE DELETE OR UPDATE ON public.referral_credit_redemptions FOR EACH ROW EXECUTE FUNCTION public.referral_prevent_mutation();


--
-- Name: retail_order_items retail_order_items_commercial_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER retail_order_items_commercial_snapshot_immutable BEFORE UPDATE ON public.retail_order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_retail_order_item_commercial_snapshot_update();


--
-- Name: retail_order_items retail_order_items_coupon_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER retail_order_items_coupon_snapshot_immutable BEFORE UPDATE ON public.retail_order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_coupon_order_snapshot_update();


--
-- Name: retail_order_items retail_order_items_g2_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER retail_order_items_g2_snapshot_immutable BEFORE UPDATE ON public.retail_order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_retail_g2_snapshot_update();


--
-- Name: retail_orders retail_orders_promotion_snapshot_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER retail_orders_promotion_snapshot_immutable BEFORE UPDATE ON public.retail_orders FOR EACH ROW EXECUTE FUNCTION public.prevent_retail_order_promotion_snapshot_update();


--
-- Name: salons salons_immutable_payment_reference; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER salons_immutable_payment_reference BEFORE INSERT OR UPDATE OF payment_reference_number ON public.salons FOR EACH ROW EXECUTE FUNCTION public.assign_immutable_business_payment_reference();


--
-- Name: aftercare_completion_events aftercare_completion_events_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_completion_events
    ADD CONSTRAINT aftercare_completion_events_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: aftercare_completion_events aftercare_completion_events_customer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_completion_events
    ADD CONSTRAINT aftercare_completion_events_customer_user_id_users_id_fk FOREIGN KEY (customer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: aftercare_deliveries aftercare_deliveries_line_id_aftercare_recommendation_lines_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_deliveries
    ADD CONSTRAINT aftercare_deliveries_line_id_aftercare_recommendation_lines_id_ FOREIGN KEY (line_id) REFERENCES public.aftercare_recommendation_lines(id) ON DELETE CASCADE;


--
-- Name: aftercare_deliveries aftercare_deliveries_recommendation_id_aftercare_recommendation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_deliveries
    ADD CONSTRAINT aftercare_deliveries_recommendation_id_aftercare_recommendation FOREIGN KEY (recommendation_id) REFERENCES public.aftercare_recommendations(id) ON DELETE CASCADE;


--
-- Name: aftercare_recommendation_appointments aftercare_recommendation_appointments_appointment_id_appointmen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_appointments
    ADD CONSTRAINT aftercare_recommendation_appointments_appointment_id_appointmen FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE RESTRICT;


--
-- Name: aftercare_recommendation_appointments aftercare_recommendation_appointments_recommendation_id_afterca; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_appointments
    ADD CONSTRAINT aftercare_recommendation_appointments_recommendation_id_afterca FOREIGN KEY (recommendation_id) REFERENCES public.aftercare_recommendations(id) ON DELETE CASCADE;


--
-- Name: aftercare_recommendation_appointments aftercare_recommendation_appointments_treatment_id_treatment_ta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_appointments
    ADD CONSTRAINT aftercare_recommendation_appointments_treatment_id_treatment_ta FOREIGN KEY (treatment_id) REFERENCES public.treatment_taxonomy(id) ON DELETE RESTRICT;


--
-- Name: aftercare_recommendation_lines aftercare_recommendation_lines_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_lines
    ADD CONSTRAINT aftercare_recommendation_lines_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE SET NULL;


--
-- Name: aftercare_recommendation_lines aftercare_recommendation_lines_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_lines
    ADD CONSTRAINT aftercare_recommendation_lines_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: aftercare_recommendation_lines aftercare_recommendation_lines_purchased_order_id_retail_orders; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_lines
    ADD CONSTRAINT aftercare_recommendation_lines_purchased_order_id_retail_orders FOREIGN KEY (purchased_order_id) REFERENCES public.retail_orders(id) ON DELETE SET NULL;


--
-- Name: aftercare_recommendation_lines aftercare_recommendation_lines_recommendation_id_aftercare_reco; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendation_lines
    ADD CONSTRAINT aftercare_recommendation_lines_recommendation_id_aftercare_reco FOREIGN KEY (recommendation_id) REFERENCES public.aftercare_recommendations(id) ON DELETE CASCADE;


--
-- Name: aftercare_recommendations aftercare_recommendations_converted_order_id_retail_orders_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendations
    ADD CONSTRAINT aftercare_recommendations_converted_order_id_retail_orders_id_f FOREIGN KEY (converted_order_id) REFERENCES public.retail_orders(id) ON DELETE SET NULL;


--
-- Name: aftercare_recommendations aftercare_recommendations_customer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_recommendations
    ADD CONSTRAINT aftercare_recommendations_customer_user_id_users_id_fk FOREIGN KEY (customer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: aftercare_settings aftercare_settings_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aftercare_settings
    ADD CONSTRAINT aftercare_settings_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointment_add_ons appointment_add_ons_add_on_id_service_add_ons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_add_ons
    ADD CONSTRAINT appointment_add_ons_add_on_id_service_add_ons_id_fk FOREIGN KEY (add_on_id) REFERENCES public.service_add_ons(id) ON DELETE SET NULL;


--
-- Name: appointment_add_ons appointment_add_ons_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_add_ons
    ADD CONSTRAINT appointment_add_ons_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_deposits appointment_deposits_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_deposits
    ADD CONSTRAINT appointment_deposits_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_deposits appointment_deposits_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_deposits
    ADD CONSTRAINT appointment_deposits_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: appointment_deposits appointment_deposits_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_deposits
    ADD CONSTRAINT appointment_deposits_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointment_employees appointment_employees_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_employees
    ADD CONSTRAINT appointment_employees_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_employees appointment_employees_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_employees
    ADD CONSTRAINT appointment_employees_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: appointment_resource_allocations appointment_resource_allocations_appointment_id_appointments_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_allocations
    ADD CONSTRAINT appointment_resource_allocations_appointment_id_appointments_id FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_resource_allocations appointment_resource_allocations_resource_id_salon_resources_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_allocations
    ADD CONSTRAINT appointment_resource_allocations_resource_id_salon_resources_id FOREIGN KEY (resource_id) REFERENCES public.salon_resources(id) ON DELETE CASCADE;


--
-- Name: appointment_series appointment_series_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_series
    ADD CONSTRAINT appointment_series_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointment_series appointment_series_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_series
    ADD CONSTRAINT appointment_series_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: appointment_series appointment_series_salon_customer_id_salon_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_series
    ADD CONSTRAINT appointment_series_salon_customer_id_salon_customers_id_fk FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE SET NULL;


--
-- Name: appointment_series appointment_series_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_series
    ADD CONSTRAINT appointment_series_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: appointment_series appointment_series_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_series
    ADD CONSTRAINT appointment_series_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: appointment_status_history appointment_status_history_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_status_history
    ADD CONSTRAINT appointment_status_history_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_status_history appointment_status_history_changed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_status_history
    ADD CONSTRAINT appointment_status_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointment_treatments appointment_treatments_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_treatments
    ADD CONSTRAINT appointment_treatments_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_treatments appointment_treatments_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_treatments
    ADD CONSTRAINT appointment_treatments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: appointment_treatments appointment_treatments_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_treatments
    ADD CONSTRAINT appointment_treatments_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE RESTRICT;


--
-- Name: appointment_waitlist appointment_waitlist_customer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: appointment_waitlist appointment_waitlist_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: appointment_waitlist appointment_waitlist_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: appointment_waitlist appointment_waitlist_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_arrived_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_arrived_by_user_id_users_id_fk FOREIGN KEY (arrived_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_booking_group_id_booking_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_booking_group_id_booking_groups_id_fk FOREIGN KEY (booking_group_id) REFERENCES public.booking_groups(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_cancelled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_cancelled_by_user_id_users_id_fk FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_completed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_completed_by_user_id_users_id_fk FOREIGN KEY (completed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_customer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- Name: appointments appointments_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_no_show_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_show_by_user_id_users_id_fk FOREIGN KEY (no_show_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_salon_customer_id_salon_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_salon_customer_id_salon_customers_id_fk FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_series_id_appointment_series_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_series_id_appointment_series_id_fk FOREIGN KEY (series_id) REFERENCES public.appointment_series(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: appointments appointments_started_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_started_by_user_id_users_id_fk FOREIGN KEY (started_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automatic_xy_promotion_targets automatic_xy_promotion_targets_category_id_product_categories_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_xy_promotion_targets
    ADD CONSTRAINT automatic_xy_promotion_targets_category_id_product_categories_i FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON DELETE CASCADE;


--
-- Name: automatic_xy_promotion_targets automatic_xy_promotion_targets_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_xy_promotion_targets
    ADD CONSTRAINT automatic_xy_promotion_targets_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: automatic_xy_promotion_targets automatic_xy_promotion_targets_promotion_id_automatic_xy_promot; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_xy_promotion_targets
    ADD CONSTRAINT automatic_xy_promotion_targets_promotion_id_automatic_xy_promot FOREIGN KEY (promotion_id) REFERENCES public.automatic_xy_promotions(id) ON DELETE CASCADE;


--
-- Name: automation_deliveries automation_deliveries_run_id_automation_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_deliveries
    ADD CONSTRAINT automation_deliveries_run_id_automation_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.automation_runs(id) ON DELETE CASCADE;


--
-- Name: automation_deliveries automation_deliveries_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_deliveries
    ADD CONSTRAINT automation_deliveries_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: automation_rules automation_rules_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: automation_runs automation_runs_attributed_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_attributed_appointment_id_appointments_id_fk FOREIGN KEY (attributed_appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: automation_runs automation_runs_rule_id_automation_rules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_rule_id_automation_rules_id_fk FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE;


--
-- Name: automation_runs automation_runs_salon_customer_id_salon_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_salon_customer_id_salon_customers_id_fk FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE CASCADE;


--
-- Name: automation_runs automation_runs_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: b2b_cart_imports b2b_cart_imports_cart_id_shopping_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_cart_imports
    ADD CONSTRAINT b2b_cart_imports_cart_id_shopping_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.shopping_carts(id) ON DELETE SET NULL;


--
-- Name: b2b_cart_imports b2b_cart_imports_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_cart_imports
    ADD CONSTRAINT b2b_cart_imports_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: b2b_quotes b2b_quotes_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_quotes
    ADD CONSTRAINT b2b_quotes_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: b2b_quotes b2b_quotes_source_cart_id_shopping_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2b_quotes
    ADD CONSTRAINT b2b_quotes_source_cart_id_shopping_carts_id_fk FOREIGN KEY (source_cart_id) REFERENCES public.shopping_carts(id) ON DELETE SET NULL;


--
-- Name: b2c_display_settings b2c_display_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_display_settings
    ADD CONSTRAINT b2c_display_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_need_tags b2c_need_tags_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_need_tags
    ADD CONSTRAINT b2c_need_tags_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_need_tags b2c_need_tags_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_need_tags
    ADD CONSTRAINT b2c_need_tags_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_product_need_tags b2c_product_need_tags_need_tag_id_b2c_need_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_product_need_tags
    ADD CONSTRAINT b2c_product_need_tags_need_tag_id_b2c_need_tags_id_fk FOREIGN KEY (need_tag_id) REFERENCES public.b2c_need_tags(id) ON DELETE RESTRICT;


--
-- Name: b2c_product_need_tags b2c_product_need_tags_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_product_need_tags
    ADD CONSTRAINT b2c_product_need_tags_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: b2c_product_types b2c_product_types_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_product_types
    ADD CONSTRAINT b2c_product_types_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_product_types b2c_product_types_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_product_types
    ADD CONSTRAINT b2c_product_types_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_promotional_banners b2c_promotional_banners_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_promotional_banners
    ADD CONSTRAINT b2c_promotional_banners_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_promotional_banners b2c_promotional_banners_destination_category_id_product_categor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_promotional_banners
    ADD CONSTRAINT b2c_promotional_banners_destination_category_id_product_categor FOREIGN KEY (destination_category_id) REFERENCES public.product_categories(id) ON DELETE RESTRICT;


--
-- Name: b2c_promotional_banners b2c_promotional_banners_destination_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_promotional_banners
    ADD CONSTRAINT b2c_promotional_banners_destination_product_id_products_id_fk FOREIGN KEY (destination_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: b2c_promotional_banners b2c_promotional_banners_supplier_id_suppliers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_promotional_banners
    ADD CONSTRAINT b2c_promotional_banners_supplier_id_suppliers_id_fk FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: b2c_promotional_banners b2c_promotional_banners_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_promotional_banners
    ADD CONSTRAINT b2c_promotional_banners_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: b2c_recently_viewed_products b2c_recently_viewed_products_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_recently_viewed_products
    ADD CONSTRAINT b2c_recently_viewed_products_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: b2c_recently_viewed_products b2c_recently_viewed_products_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.b2c_recently_viewed_products
    ADD CONSTRAINT b2c_recently_viewed_products_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: beauty_job_application_actions beauty_job_application_actions_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_application_actions
    ADD CONSTRAINT beauty_job_application_actions_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beauty_job_contacts beauty_job_contacts_applicant_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_contacts
    ADD CONSTRAINT beauty_job_contacts_applicant_user_id_users_id_fk FOREIGN KEY (applicant_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: beauty_job_contacts beauty_job_contacts_decision_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_contacts
    ADD CONSTRAINT beauty_job_contacts_decision_actor_user_id_users_id_fk FOREIGN KEY (decision_actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beauty_job_contacts beauty_job_contacts_listing_id_beauty_job_listings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_contacts
    ADD CONSTRAINT beauty_job_contacts_listing_id_beauty_job_listings_id_fk FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_listing_availability beauty_job_listing_availability_listing_id_beauty_job_listings_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_listing_availability
    ADD CONSTRAINT beauty_job_listing_availability_listing_id_beauty_job_listings_ FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_listings beauty_job_listings_category_id_beauty_job_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_listings
    ADD CONSTRAINT beauty_job_listings_category_id_beauty_job_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.beauty_job_categories(id) ON DELETE RESTRICT;


--
-- Name: beauty_job_listings beauty_job_listings_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_listings
    ADD CONSTRAINT beauty_job_listings_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: beauty_job_listings beauty_job_listings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_listings
    ADD CONSTRAINT beauty_job_listings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: beauty_job_moderation_audit beauty_job_moderation_audit_acting_admin_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_moderation_audit
    ADD CONSTRAINT beauty_job_moderation_audit_acting_admin_user_id_users_id_fk FOREIGN KEY (acting_admin_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beauty_job_notifications beauty_job_notifications_contact_id_beauty_job_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_notifications
    ADD CONSTRAINT beauty_job_notifications_contact_id_beauty_job_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.beauty_job_contacts(id) ON DELETE CASCADE;


--
-- Name: beauty_job_notifications beauty_job_notifications_listing_id_beauty_job_listings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_notifications
    ADD CONSTRAINT beauty_job_notifications_listing_id_beauty_job_listings_id_fk FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_notifications beauty_job_notifications_recipient_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_notifications
    ADD CONSTRAINT beauty_job_notifications_recipient_user_id_users_id_fk FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: beauty_job_platform_settings beauty_job_platform_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_platform_settings
    ADD CONSTRAINT beauty_job_platform_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beauty_job_rental_requests beauty_job_rental_requests_applicant_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_rental_requests
    ADD CONSTRAINT beauty_job_rental_requests_applicant_user_id_users_id_fk FOREIGN KEY (applicant_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: beauty_job_rental_requests beauty_job_rental_requests_listing_id_beauty_job_listings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_rental_requests
    ADD CONSTRAINT beauty_job_rental_requests_listing_id_beauty_job_listings_id_fk FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_rental_requests beauty_job_rental_requests_slot_id_beauty_job_rental_slots_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_rental_requests
    ADD CONSTRAINT beauty_job_rental_requests_slot_id_beauty_job_rental_slots_id_f FOREIGN KEY (slot_id) REFERENCES public.beauty_job_rental_slots(id) ON DELETE CASCADE;


--
-- Name: beauty_job_rental_slots beauty_job_rental_slots_listing_id_beauty_job_listings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_rental_slots
    ADD CONSTRAINT beauty_job_rental_slots_listing_id_beauty_job_listings_id_fk FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_reports beauty_job_reports_listing_id_beauty_job_listings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_reports
    ADD CONSTRAINT beauty_job_reports_listing_id_beauty_job_listings_id_fk FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_reports beauty_job_reports_reporter_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_reports
    ADD CONSTRAINT beauty_job_reports_reporter_user_id_users_id_fk FOREIGN KEY (reporter_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beauty_job_reports beauty_job_reports_resolved_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_reports
    ADD CONSTRAINT beauty_job_reports_resolved_by_user_id_users_id_fk FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beauty_job_saved_listings beauty_job_saved_listings_listing_id_beauty_job_listings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_saved_listings
    ADD CONSTRAINT beauty_job_saved_listings_listing_id_beauty_job_listings_id_fk FOREIGN KEY (listing_id) REFERENCES public.beauty_job_listings(id) ON DELETE CASCADE;


--
-- Name: beauty_job_saved_listings beauty_job_saved_listings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beauty_job_saved_listings
    ADD CONSTRAINT beauty_job_saved_listings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: booking_command_receipts booking_command_receipts_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_command_receipts
    ADD CONSTRAINT booking_command_receipts_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: booking_groups booking_groups_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_groups
    ADD CONSTRAINT booking_groups_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: booking_groups booking_groups_customer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_groups
    ADD CONSTRAINT booking_groups_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: booking_groups booking_groups_salon_customer_id_salon_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_groups
    ADD CONSTRAINT booking_groups_salon_customer_id_salon_customers_id_fk FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE SET NULL;


--
-- Name: booking_groups booking_groups_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_groups
    ADD CONSTRAINT booking_groups_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: bulk_sale_campaign_targets bulk_sale_campaign_targets_campaign_id_bulk_sale_campaigns_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_sale_campaign_targets
    ADD CONSTRAINT bulk_sale_campaign_targets_campaign_id_bulk_sale_campaigns_id_f FOREIGN KEY (campaign_id) REFERENCES public.bulk_sale_campaigns(id) ON DELETE CASCADE;


--
-- Name: bulk_sale_campaign_targets bulk_sale_campaign_targets_category_id_product_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_sale_campaign_targets
    ADD CONSTRAINT bulk_sale_campaign_targets_category_id_product_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON DELETE CASCADE;


--
-- Name: bulk_sale_campaign_targets bulk_sale_campaign_targets_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_sale_campaign_targets
    ADD CONSTRAINT bulk_sale_campaign_targets_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: business_verification_audits business_verification_audits_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verification_audits
    ADD CONSTRAINT business_verification_audits_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: business_verification_audits business_verification_audits_legal_entity_business_id_legal_ent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verification_audits
    ADD CONSTRAINT business_verification_audits_legal_entity_business_id_legal_ent FOREIGN KEY (legal_entity_business_id) REFERENCES public.legal_entity_businesses(id) ON DELETE CASCADE;


--
-- Name: cart_threshold_rewards cart_threshold_rewards_gift_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_threshold_rewards
    ADD CONSTRAINT cart_threshold_rewards_gift_product_id_products_id_fk FOREIGN KEY (gift_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: catalog_sync_runs catalog_sync_runs_requested_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_sync_runs
    ADD CONSTRAINT catalog_sync_runs_requested_by_user_id_users_id_fk FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: commerce_customer_notifications commerce_customer_notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_customer_notifications
    ADD CONSTRAINT commerce_customer_notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: commerce_customer_notifications commerce_customer_notifications_waitlist_id_product_waitlist_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_customer_notifications
    ADD CONSTRAINT commerce_customer_notifications_waitlist_id_product_waitlist_id FOREIGN KEY (waitlist_id) REFERENCES public.product_waitlist(id) ON DELETE SET NULL;


--
-- Name: commerce_experience_settings commerce_experience_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_experience_settings
    ADD CONSTRAINT commerce_experience_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: coupon_redemptions coupon_redemptions_coupon_id_coupons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_coupon_id_coupons_id_fk FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE RESTRICT;


--
-- Name: coupon_redemptions coupon_redemptions_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: coupon_redemptions coupon_redemptions_retail_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_retail_order_id_retail_orders_id_fk FOREIGN KEY (retail_order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: coupon_redemptions coupon_redemptions_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: coupon_redemptions coupon_redemptions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: course_categories course_categories_section_id_education_sections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_categories
    ADD CONSTRAINT course_categories_section_id_education_sections_id_fk FOREIGN KEY (section_id) REFERENCES public.education_sections(id) ON DELETE SET NULL;


--
-- Name: course_days course_days_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_days
    ADD CONSTRAINT course_days_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_enrollments course_enrollments_booking_group_id_education_booking_groups_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_booking_group_id_education_booking_groups_id FOREIGN KEY (booking_group_id) REFERENCES public.education_booking_groups(id) ON DELETE SET NULL;


--
-- Name: course_enrollments course_enrollments_bundle_purchase_id_education_bundle_purchase; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_bundle_purchase_id_education_bundle_purchase FOREIGN KEY (bundle_purchase_id) REFERENCES public.education_bundle_purchases(id) ON DELETE RESTRICT;


--
-- Name: course_enrollments course_enrollments_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_enrollments course_enrollments_digital_content_consent_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_digital_content_consent_user_id_users_id_fk FOREIGN KEY (digital_content_consent_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: course_enrollments course_enrollments_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: course_enrollments course_enrollments_participant_id_education_booking_participant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_participant_id_education_booking_participant FOREIGN KEY (participant_id) REFERENCES public.education_booking_participants(id) ON DELETE SET NULL;


--
-- Name: course_enrollments course_enrollments_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: course_enrollments course_enrollments_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: course_enrollments course_enrollments_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE SET NULL;


--
-- Name: course_enrollments course_enrollments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: course_lessons course_lessons_module_id_course_modules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_lessons
    ADD CONSTRAINT course_lessons_module_id_course_modules_id_fk FOREIGN KEY (module_id) REFERENCES public.course_modules(id) ON DELETE CASCADE;


--
-- Name: course_modules course_modules_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_modules
    ADD CONSTRAINT course_modules_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_reviews course_reviews_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT course_reviews_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_reviews course_reviews_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT course_reviews_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: course_reviews course_reviews_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT course_reviews_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: course_sessions course_sessions_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_sessions
    ADD CONSTRAINT course_sessions_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: courses courses_category_id_course_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_category_id_course_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.course_categories(id) ON DELETE SET NULL;


--
-- Name: courses courses_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: courses courses_course_type_id_education_course_types_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_course_type_id_education_course_types_id_fk FOREIGN KEY (course_type_id) REFERENCES public.education_course_types(id) ON DELETE SET NULL;


--
-- Name: courses courses_instructor_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_instructor_id_users_id_fk FOREIGN KEY (instructor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: courses courses_instructor_profile_id_education_instructors_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_instructor_profile_id_education_instructors_id_fk FOREIGN KEY (instructor_profile_id) REFERENCES public.education_instructors(id) ON DELETE SET NULL;


--
-- Name: courses courses_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: courses courses_subcategory_id_education_subcategories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_subcategory_id_education_subcategories_id_fk FOREIGN KEY (subcategory_id) REFERENCES public.education_subcategories(id) ON DELETE SET NULL;


--
-- Name: customer_notes customer_notes_customer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notes
    ADD CONSTRAINT customer_notes_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customer_notes customer_notes_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notes
    ADD CONSTRAINT customer_notes_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: customer_notifications customer_notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notifications
    ADD CONSTRAINT customer_notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customer_package_purchases customer_package_purchases_package_id_treatment_packages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_package_purchases
    ADD CONSTRAINT customer_package_purchases_package_id_treatment_packages_id_fk FOREIGN KEY (package_id) REFERENCES public.treatment_packages(id) ON DELETE RESTRICT;


--
-- Name: customer_package_purchases customer_package_purchases_payment_confirmed_by_user_id_users_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_package_purchases
    ADD CONSTRAINT customer_package_purchases_payment_confirmed_by_user_id_users_i FOREIGN KEY (payment_confirmed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_package_purchases customer_package_purchases_salon_customer_id_salon_customers_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_package_purchases
    ADD CONSTRAINT customer_package_purchases_salon_customer_id_salon_customers_id FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE CASCADE;


--
-- Name: customer_package_purchases customer_package_purchases_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_package_purchases
    ADD CONSTRAINT customer_package_purchases_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: customer_password_setup_audits customer_password_setup_audits_administrator_user_id_users_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_password_setup_audits
    ADD CONSTRAINT customer_password_setup_audits_administrator_user_id_users_id_f FOREIGN KEY (administrator_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: customer_password_setup_audits customer_password_setup_audits_target_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_password_setup_audits
    ADD CONSTRAINT customer_password_setup_audits_target_user_id_users_id_fk FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: customer_password_setup_tokens customer_password_setup_tokens_issued_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_password_setup_tokens
    ADD CONSTRAINT customer_password_setup_tokens_issued_by_user_id_users_id_fk FOREIGN KEY (issued_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: customer_password_setup_tokens customer_password_setup_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_password_setup_tokens
    ADD CONSTRAINT customer_password_setup_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_access_extensions education_access_extensions_enrollment_id_course_enrollments_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_access_extensions
    ADD CONSTRAINT education_access_extensions_enrollment_id_course_enrollments_id FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE RESTRICT;


--
-- Name: education_access_extensions education_access_extensions_payment_obligation_id_education_pay; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_access_extensions
    ADD CONSTRAINT education_access_extensions_payment_obligation_id_education_pay FOREIGN KEY (payment_obligation_id) REFERENCES public.education_payment_obligations(id) ON DELETE RESTRICT;


--
-- Name: education_access_extensions education_access_extensions_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_access_extensions
    ADD CONSTRAINT education_access_extensions_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_attendance education_attendance_participant_id_education_booking_participa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_attendance
    ADD CONSTRAINT education_attendance_participant_id_education_booking_participa FOREIGN KEY (participant_id) REFERENCES public.education_booking_participants(id) ON DELETE CASCADE;


--
-- Name: education_attendance education_attendance_recorded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_attendance
    ADD CONSTRAINT education_attendance_recorded_by_user_id_users_id_fk FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_attendance education_attendance_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_attendance
    ADD CONSTRAINT education_attendance_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE CASCADE;


--
-- Name: education_b2b_discount_audits education_b2b_discount_audits_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_discount_audits
    ADD CONSTRAINT education_b2b_discount_audits_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_b2b_discount_settings education_b2b_discount_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_discount_settings
    ADD CONSTRAINT education_b2b_discount_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_b2b_order_items education_b2b_order_items_order_id_education_b2b_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_order_items
    ADD CONSTRAINT education_b2b_order_items_order_id_education_b2b_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.education_b2b_orders(id) ON DELETE RESTRICT;


--
-- Name: education_b2b_order_items education_b2b_order_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_order_items
    ADD CONSTRAINT education_b2b_order_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: education_b2b_orders education_b2b_orders_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_orders
    ADD CONSTRAINT education_b2b_orders_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: education_b2b_orders education_b2b_orders_purchaser_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_orders
    ADD CONSTRAINT education_b2b_orders_purchaser_user_id_users_id_fk FOREIGN KEY (purchaser_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_b2b_orders education_b2b_orders_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_b2b_orders
    ADD CONSTRAINT education_b2b_orders_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_bank_transactions education_bank_transactions_obligation_id_education_payment_obl; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bank_transactions
    ADD CONSTRAINT education_bank_transactions_obligation_id_education_payment_obl FOREIGN KEY (obligation_id) REFERENCES public.education_payment_obligations(id) ON DELETE RESTRICT;


--
-- Name: education_booking_groups education_booking_groups_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_groups
    ADD CONSTRAINT education_booking_groups_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_booking_groups education_booking_groups_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_groups
    ADD CONSTRAINT education_booking_groups_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_booking_groups education_booking_groups_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_groups
    ADD CONSTRAINT education_booking_groups_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_booking_groups education_booking_groups_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_groups
    ADD CONSTRAINT education_booking_groups_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_booking_groups education_booking_groups_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_groups
    ADD CONSTRAINT education_booking_groups_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE SET NULL;


--
-- Name: education_booking_participants education_booking_participants_booking_group_id_education_booki; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_participants
    ADD CONSTRAINT education_booking_participants_booking_group_id_education_booki FOREIGN KEY (booking_group_id) REFERENCES public.education_booking_groups(id) ON DELETE CASCADE;


--
-- Name: education_booking_participants education_booking_participants_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_booking_participants
    ADD CONSTRAINT education_booking_participants_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_bundle_courses education_bundle_courses_bundle_id_education_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_courses
    ADD CONSTRAINT education_bundle_courses_bundle_id_education_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.education_bundles(id) ON DELETE CASCADE;


--
-- Name: education_bundle_courses education_bundle_courses_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_courses
    ADD CONSTRAINT education_bundle_courses_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchase_escrows education_bundle_purchase_escrows_center_id_education_centers_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_escrows
    ADD CONSTRAINT education_bundle_purchase_escrows_center_id_education_centers_i FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchase_escrows education_bundle_purchase_escrows_purchase_id_education_bundle_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_escrows
    ADD CONSTRAINT education_bundle_purchase_escrows_purchase_id_education_bundle_ FOREIGN KEY (purchase_id) REFERENCES public.education_bundle_purchases(id) ON DELETE CASCADE;


--
-- Name: education_bundle_purchase_items education_bundle_purchase_items_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_items
    ADD CONSTRAINT education_bundle_purchase_items_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchase_items education_bundle_purchase_items_purchase_id_education_bundle_pu; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_items
    ADD CONSTRAINT education_bundle_purchase_items_purchase_id_education_bundle_pu FOREIGN KEY (purchase_id) REFERENCES public.education_bundle_purchases(id) ON DELETE CASCADE;


--
-- Name: education_bundle_purchase_ledger_entries education_bundle_purchase_ledger_entries_escrow_id_education_bu; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchase_ledger_entries
    ADD CONSTRAINT education_bundle_purchase_ledger_entries_escrow_id_education_bu FOREIGN KEY (escrow_id) REFERENCES public.education_bundle_purchase_escrows(id) ON DELETE CASCADE;


--
-- Name: education_bundle_purchases education_bundle_purchases_bundle_id_education_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_bundle_id_education_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.education_bundles(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchases education_bundle_purchases_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchases education_bundle_purchases_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchases education_bundle_purchases_learner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_learner_user_id_users_id_fk FOREIGN KEY (learner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchases education_bundle_purchases_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchases education_bundle_purchases_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: education_bundle_purchases education_bundle_purchases_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundle_purchases
    ADD CONSTRAINT education_bundle_purchases_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_bundles education_bundles_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_bundles
    ADD CONSTRAINT education_bundles_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_center_reviews education_center_reviews_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_reviews
    ADD CONSTRAINT education_center_reviews_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_center_reviews education_center_reviews_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_reviews
    ADD CONSTRAINT education_center_reviews_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_center_reviews education_center_reviews_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_reviews
    ADD CONSTRAINT education_center_reviews_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_center_staff education_center_staff_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_staff
    ADD CONSTRAINT education_center_staff_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_center_staff education_center_staff_instructor_profile_id_education_instruct; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_staff
    ADD CONSTRAINT education_center_staff_instructor_profile_id_education_instruct FOREIGN KEY (instructor_profile_id) REFERENCES public.education_instructors(id) ON DELETE SET NULL;


--
-- Name: education_center_staff education_center_staff_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_staff
    ADD CONSTRAINT education_center_staff_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_center_subscriptions education_center_subscriptions_center_id_education_centers_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_subscriptions
    ADD CONSTRAINT education_center_subscriptions_center_id_education_centers_id_f FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_center_subscriptions education_center_subscriptions_pending_plan_id_subscription_pla; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_subscriptions
    ADD CONSTRAINT education_center_subscriptions_pending_plan_id_subscription_pla FOREIGN KEY (pending_plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: education_center_subscriptions education_center_subscriptions_plan_id_subscription_plans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_center_subscriptions
    ADD CONSTRAINT education_center_subscriptions_plan_id_subscription_plans_id_fk FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: education_centers education_centers_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_centers
    ADD CONSTRAINT education_centers_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: education_centers education_centers_verified_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_centers
    ADD CONSTRAINT education_centers_verified_by_user_id_users_id_fk FOREIGN KEY (verified_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_contact_history education_contact_history_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_contact_history
    ADD CONSTRAINT education_contact_history_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_contact_history education_contact_history_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_contact_history
    ADD CONSTRAINT education_contact_history_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_contact_history education_contact_history_enrollment_id_course_enrollments_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_contact_history
    ADD CONSTRAINT education_contact_history_enrollment_id_course_enrollments_id_f FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE SET NULL;


--
-- Name: education_contact_history education_contact_history_learner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_contact_history
    ADD CONSTRAINT education_contact_history_learner_user_id_users_id_fk FOREIGN KEY (learner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_course_metric_events education_course_metric_events_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_metric_events
    ADD CONSTRAINT education_course_metric_events_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_course_metric_events education_course_metric_events_center_id_education_centers_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_metric_events
    ADD CONSTRAINT education_course_metric_events_center_id_education_centers_id_f FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_course_metric_events education_course_metric_events_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_metric_events
    ADD CONSTRAINT education_course_metric_events_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_course_types education_course_types_proposed_by_center_id_education_centers_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_types
    ADD CONSTRAINT education_course_types_proposed_by_center_id_education_centers_ FOREIGN KEY (proposed_by_center_id) REFERENCES public.education_centers(id) ON DELETE SET NULL;


--
-- Name: education_course_types education_course_types_reviewed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_types
    ADD CONSTRAINT education_course_types_reviewed_by_user_id_users_id_fk FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_course_types education_course_types_subcategory_id_education_subcategories_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_course_types
    ADD CONSTRAINT education_course_types_subcategory_id_education_subcategories_i FOREIGN KEY (subcategory_id) REFERENCES public.education_subcategories(id) ON DELETE CASCADE;


--
-- Name: education_custom_plan_requests education_custom_plan_requests_center_id_education_centers_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_custom_plan_requests
    ADD CONSTRAINT education_custom_plan_requests_center_id_education_centers_id_f FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_custom_plan_requests education_custom_plan_requests_requested_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_custom_plan_requests
    ADD CONSTRAINT education_custom_plan_requests_requested_by_user_id_users_id_fk FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_custom_plan_requests education_custom_plan_requests_resolved_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_custom_plan_requests
    ADD CONSTRAINT education_custom_plan_requests_resolved_by_user_id_users_id_fk FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_disputes education_disputes_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_disputes
    ADD CONSTRAINT education_disputes_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_disputes education_disputes_opened_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_disputes
    ADD CONSTRAINT education_disputes_opened_by_user_id_users_id_fk FOREIGN KEY (opened_by_user_id) REFERENCES public.users(id);


--
-- Name: education_disputes education_disputes_resolved_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_disputes
    ADD CONSTRAINT education_disputes_resolved_by_user_id_users_id_fk FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_educator_absences education_educator_absences_staff_id_education_center_staff_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_educator_absences
    ADD CONSTRAINT education_educator_absences_staff_id_education_center_staff_id_ FOREIGN KEY (staff_id) REFERENCES public.education_center_staff(id) ON DELETE CASCADE;


--
-- Name: education_educator_weekly_availability education_educator_weekly_availability_staff_id_education_cente; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_educator_weekly_availability
    ADD CONSTRAINT education_educator_weekly_availability_staff_id_education_cente FOREIGN KEY (staff_id) REFERENCES public.education_center_staff(id) ON DELETE CASCADE;


--
-- Name: education_escrows education_escrows_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_escrows
    ADD CONSTRAINT education_escrows_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_escrows education_escrows_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_escrows
    ADD CONSTRAINT education_escrows_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_featured_charges education_featured_charges_activated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_featured_charges
    ADD CONSTRAINT education_featured_charges_activated_by_user_id_users_id_fk FOREIGN KEY (activated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_featured_charges education_featured_charges_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_featured_charges
    ADD CONSTRAINT education_featured_charges_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_featured_charges education_featured_charges_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_featured_charges
    ADD CONSTRAINT education_featured_charges_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_featured_charges education_featured_charges_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_featured_charges
    ADD CONSTRAINT education_featured_charges_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: education_featured_charges education_featured_charges_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_featured_charges
    ADD CONSTRAINT education_featured_charges_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_financial_audit_log education_financial_audit_log_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_financial_audit_log
    ADD CONSTRAINT education_financial_audit_log_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_financial_events education_financial_events_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_financial_events
    ADD CONSTRAINT education_financial_events_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_financial_events education_financial_events_enrollment_id_course_enrollments_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_financial_events
    ADD CONSTRAINT education_financial_events_enrollment_id_course_enrollments_id_ FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_financial_events education_financial_events_escrow_id_education_escrows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_financial_events
    ADD CONSTRAINT education_financial_events_escrow_id_education_escrows_id_fk FOREIGN KEY (escrow_id) REFERENCES public.education_escrows(id) ON DELETE CASCADE;


--
-- Name: education_gift_vouchers education_gift_vouchers_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: education_gift_vouchers education_gift_vouchers_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE RESTRICT;


--
-- Name: education_gift_vouchers education_gift_vouchers_dispute_id_education_disputes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_dispute_id_education_disputes_id_fk FOREIGN KEY (dispute_id) REFERENCES public.education_disputes(id) ON DELETE SET NULL;


--
-- Name: education_gift_vouchers education_gift_vouchers_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.education_disputes(id) ON DELETE SET NULL;


--
-- Name: education_gift_vouchers education_gift_vouchers_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_gift_vouchers education_gift_vouchers_recipient_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_recipient_user_id_users_id_fk FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_gift_vouchers education_gift_vouchers_redeemed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_redeemed_by_user_id_users_id_fk FOREIGN KEY (redeemed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_gift_vouchers education_gift_vouchers_redeemed_enrollment_id_course_enrollmen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_redeemed_enrollment_id_course_enrollmen FOREIGN KEY (redeemed_enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE RESTRICT;


--
-- Name: education_gift_vouchers education_gift_vouchers_refunded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_refunded_by_user_id_users_id_fk FOREIGN KEY (refunded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_gift_vouchers education_gift_vouchers_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_gift_vouchers
    ADD CONSTRAINT education_gift_vouchers_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_grace_notes education_grace_notes_author_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_grace_notes
    ADD CONSTRAINT education_grace_notes_author_user_id_users_id_fk FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_grace_notes education_grace_notes_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_grace_notes
    ADD CONSTRAINT education_grace_notes_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_inquiries education_inquiries_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inquiries
    ADD CONSTRAINT education_inquiries_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_inquiries education_inquiries_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inquiries
    ADD CONSTRAINT education_inquiries_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_inquiries education_inquiries_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inquiries
    ADD CONSTRAINT education_inquiries_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_installment_settlement_commands education_installment_settlement_commands_actor_user_id_users_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installment_settlement_commands
    ADD CONSTRAINT education_installment_settlement_commands_actor_user_id_users_i FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_installment_settlement_commands education_installment_settlement_commands_installment_id_educat; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installment_settlement_commands
    ADD CONSTRAINT education_installment_settlement_commands_installment_id_educat FOREIGN KEY (installment_id) REFERENCES public.education_installments(id) ON DELETE CASCADE;


--
-- Name: education_installments education_installments_price_snapshot_id_education_price_snapsh; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installments
    ADD CONSTRAINT education_installments_price_snapshot_id_education_price_snapsh FOREIGN KEY (price_snapshot_id) REFERENCES public.education_price_snapshots(id) ON DELETE RESTRICT;


--
-- Name: education_installments education_installments_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_installments
    ADD CONSTRAINT education_installments_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_instructors education_instructors_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_instructors
    ADD CONSTRAINT education_instructors_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_instructors education_instructors_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_instructors
    ADD CONSTRAINT education_instructors_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_inventory_items education_inventory_items_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_items
    ADD CONSTRAINT education_inventory_items_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_inventory_items education_inventory_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_items
    ADD CONSTRAINT education_inventory_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: education_inventory_movements education_inventory_movements_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_movements
    ADD CONSTRAINT education_inventory_movements_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_inventory_movements education_inventory_movements_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_movements
    ADD CONSTRAINT education_inventory_movements_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: education_inventory_movements education_inventory_movements_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_movements
    ADD CONSTRAINT education_inventory_movements_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: education_inventory_movements education_inventory_movements_item_id_education_inventory_items; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_movements
    ADD CONSTRAINT education_inventory_movements_item_id_education_inventory_items FOREIGN KEY (item_id) REFERENCES public.education_inventory_items(id) ON DELETE RESTRICT;


--
-- Name: education_inventory_movements education_inventory_movements_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_inventory_movements
    ADD CONSTRAINT education_inventory_movements_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE SET NULL;


--
-- Name: education_ledger_entries education_ledger_entries_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_ledger_entries
    ADD CONSTRAINT education_ledger_entries_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_ledger_entries education_ledger_entries_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_ledger_entries
    ADD CONSTRAINT education_ledger_entries_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_ledger_entries education_ledger_entries_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_ledger_entries
    ADD CONSTRAINT education_ledger_entries_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_ledger_entries education_ledger_entries_escrow_id_education_escrows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_ledger_entries
    ADD CONSTRAINT education_ledger_entries_escrow_id_education_escrows_id_fk FOREIGN KEY (escrow_id) REFERENCES public.education_escrows(id) ON DELETE CASCADE;


--
-- Name: education_media education_media_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_media
    ADD CONSTRAINT education_media_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_media education_media_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_media
    ADD CONSTRAINT education_media_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_media_uploads education_media_uploads_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_media_uploads
    ADD CONSTRAINT education_media_uploads_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_media_uploads education_media_uploads_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_media_uploads
    ADD CONSTRAINT education_media_uploads_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_messages education_messages_sender_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_messages
    ADD CONSTRAINT education_messages_sender_id_users_id_fk FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_messages education_messages_thread_id_education_threads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_messages
    ADD CONSTRAINT education_messages_thread_id_education_threads_id_fk FOREIGN KEY (thread_id) REFERENCES public.education_threads(id) ON DELETE CASCADE;


--
-- Name: education_notifications education_notifications_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notifications
    ADD CONSTRAINT education_notifications_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_notifications education_notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notifications
    ADD CONSTRAINT education_notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_notifications education_notifications_waitlist_id_education_waitlist_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_notifications
    ADD CONSTRAINT education_notifications_waitlist_id_education_waitlist_id_fk FOREIGN KEY (waitlist_id) REFERENCES public.education_waitlist(id) ON DELETE CASCADE;


--
-- Name: education_outbox education_outbox_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_outbox
    ADD CONSTRAINT education_outbox_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_outbox education_outbox_participant_id_education_booking_participants_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_outbox
    ADD CONSTRAINT education_outbox_participant_id_education_booking_participants_ FOREIGN KEY (participant_id) REFERENCES public.education_booking_participants(id) ON DELETE CASCADE;


--
-- Name: education_outbox education_outbox_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_outbox
    ADD CONSTRAINT education_outbox_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE CASCADE;


--
-- Name: education_payment_obligations education_payment_obligations_cancelled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_cancelled_by_user_id_users_id_fk FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_payment_obligations education_payment_obligations_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: education_payment_obligations education_payment_obligations_confirmed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_confirmed_by_user_id_users_id_fk FOREIGN KEY (confirmed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_payment_obligations education_payment_obligations_enrollment_id_course_enrollments_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_enrollment_id_course_enrollments_ FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE RESTRICT;


--
-- Name: education_payment_obligations education_payment_obligations_plan_id_snapshot_subscription_pla; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_plan_id_snapshot_subscription_pla FOREIGN KEY (plan_id_snapshot) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT;


--
-- Name: education_payment_obligations education_payment_obligations_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: education_payment_obligations education_payment_obligations_subscription_id_education_center_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payment_obligations
    ADD CONSTRAINT education_payment_obligations_subscription_id_education_center_ FOREIGN KEY (subscription_id) REFERENCES public.education_center_subscriptions(id) ON DELETE RESTRICT;


--
-- Name: education_payouts education_payouts_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payouts
    ADD CONSTRAINT education_payouts_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_payouts education_payouts_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_payouts
    ADD CONSTRAINT education_payouts_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_placement_settings education_placement_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placement_settings
    ADD CONSTRAINT education_placement_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_placements education_placements_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_placements education_placements_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_placements education_placements_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: education_placements education_placements_scope_category_id_course_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_scope_category_id_course_categories_id_fk FOREIGN KEY (scope_category_id) REFERENCES public.course_categories(id) ON DELETE CASCADE;


--
-- Name: education_placements education_placements_scope_subcategory_id_education_subcategori; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_scope_subcategory_id_education_subcategori FOREIGN KEY (scope_subcategory_id) REFERENCES public.education_subcategories(id) ON DELETE CASCADE;


--
-- Name: education_placements education_placements_settled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_placements
    ADD CONSTRAINT education_placements_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_platform_settings education_platform_settings_bank_reconciliation_access_confirme; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_platform_settings
    ADD CONSTRAINT education_platform_settings_bank_reconciliation_access_confirme FOREIGN KEY (bank_reconciliation_access_confirmed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: education_platform_settings education_platform_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_platform_settings
    ADD CONSTRAINT education_platform_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_price_snapshots education_price_snapshots_booking_group_id_education_booking_gr; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_price_snapshots
    ADD CONSTRAINT education_price_snapshots_booking_group_id_education_booking_gr FOREIGN KEY (booking_group_id) REFERENCES public.education_booking_groups(id) ON DELETE RESTRICT;


--
-- Name: education_price_snapshots education_price_snapshots_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_price_snapshots
    ADD CONSTRAINT education_price_snapshots_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE RESTRICT;


--
-- Name: education_recurrence_commands education_recurrence_commands_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_recurrence_commands
    ADD CONSTRAINT education_recurrence_commands_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_recurrence_commands education_recurrence_commands_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_recurrence_commands
    ADD CONSTRAINT education_recurrence_commands_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_resources education_resources_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_resources
    ADD CONSTRAINT education_resources_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_session_educators education_session_educators_assigned_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_educators
    ADD CONSTRAINT education_session_educators_assigned_by_user_id_users_id_fk FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_session_educators education_session_educators_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_educators
    ADD CONSTRAINT education_session_educators_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE CASCADE;


--
-- Name: education_session_educators education_session_educators_staff_id_education_center_staff_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_educators
    ADD CONSTRAINT education_session_educators_staff_id_education_center_staff_id_ FOREIGN KEY (staff_id) REFERENCES public.education_center_staff(id) ON DELETE RESTRICT;


--
-- Name: education_session_resources education_session_resources_resource_id_education_resources_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_resources
    ADD CONSTRAINT education_session_resources_resource_id_education_resources_id_ FOREIGN KEY (resource_id) REFERENCES public.education_resources(id) ON DELETE RESTRICT;


--
-- Name: education_session_resources education_session_resources_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_session_resources
    ADD CONSTRAINT education_session_resources_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE CASCADE;


--
-- Name: education_subcategories education_subcategories_category_id_course_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_subcategories
    ADD CONSTRAINT education_subcategories_category_id_course_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.course_categories(id) ON DELETE CASCADE;


--
-- Name: education_threads education_threads_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_threads
    ADD CONSTRAINT education_threads_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: education_threads education_threads_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_threads
    ADD CONSTRAINT education_threads_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: education_threads education_threads_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_threads
    ADD CONSTRAINT education_threads_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_trial_claims education_trial_claims_center_id_education_centers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_trial_claims
    ADD CONSTRAINT education_trial_claims_center_id_education_centers_id_fk FOREIGN KEY (center_id) REFERENCES public.education_centers(id) ON DELETE SET NULL;


--
-- Name: education_trial_claims education_trial_claims_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_trial_claims
    ADD CONSTRAINT education_trial_claims_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: education_waitlist education_waitlist_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_waitlist
    ADD CONSTRAINT education_waitlist_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_waitlist education_waitlist_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_waitlist
    ADD CONSTRAINT education_waitlist_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: education_waitlist education_waitlist_purchaser_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_waitlist
    ADD CONSTRAINT education_waitlist_purchaser_id_users_id_fk FOREIGN KEY (purchaser_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_waitlist education_waitlist_session_id_course_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_waitlist
    ADD CONSTRAINT education_waitlist_session_id_course_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.course_sessions(id) ON DELETE CASCADE;


--
-- Name: education_waitlist education_waitlist_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_waitlist
    ADD CONSTRAINT education_waitlist_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: education_wishlists education_wishlists_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_wishlists
    ADD CONSTRAINT education_wishlists_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: education_wishlists education_wishlists_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_wishlists
    ADD CONSTRAINT education_wishlists_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_campaigns email_campaigns_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: email_deliveries email_deliveries_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: email_deliveries email_deliveries_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE SET NULL;


--
-- Name: employee_clock_entries employee_clock_entries_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_clock_entries
    ADD CONSTRAINT employee_clock_entries_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_clock_entries employee_clock_entries_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_clock_entries
    ADD CONSTRAINT employee_clock_entries_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employee_commission_settings employee_commission_settings_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_settings
    ADD CONSTRAINT employee_commission_settings_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_commission_settings employee_commission_settings_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_settings
    ADD CONSTRAINT employee_commission_settings_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employee_commission_settings employee_commission_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_settings
    ADD CONSTRAINT employee_commission_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employee_leave_requests employee_leave_requests_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_requests
    ADD CONSTRAINT employee_leave_requests_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_location_assignments employee_location_assignments_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_location_assignments
    ADD CONSTRAINT employee_location_assignments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_location_assignments employee_location_assignments_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_location_assignments
    ADD CONSTRAINT employee_location_assignments_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employee_location_schedules employee_location_schedules_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_location_schedules
    ADD CONSTRAINT employee_location_schedules_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_location_schedules employee_location_schedules_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_location_schedules
    ADD CONSTRAINT employee_location_schedules_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employee_ratings employee_ratings_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_ratings
    ADD CONSTRAINT employee_ratings_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_ratings employee_ratings_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_ratings
    ADD CONSTRAINT employee_ratings_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employee_schedules employee_schedules_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_schedules
    ADD CONSTRAINT employee_schedules_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_services employee_services_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_services
    ADD CONSTRAINT employee_services_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_services employee_services_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_services
    ADD CONSTRAINT employee_services_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: employee_time_off employee_time_off_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_time_off
    ADD CONSTRAINT employee_time_off_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_time_off employee_time_off_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_time_off
    ADD CONSTRAINT employee_time_off_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employees employees_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: employees employees_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: favorite_employees favorite_employees_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_employees
    ADD CONSTRAINT favorite_employees_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: favorite_employees favorite_employees_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_employees
    ADD CONSTRAINT favorite_employees_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: favorite_employees favorite_employees_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_employees
    ADD CONSTRAINT favorite_employees_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: image_assets image_assets_uploaded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_uploaded_by_user_id_users_id_fk FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspiration_items inspiration_items_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspiration_items
    ADD CONSTRAINT inspiration_items_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: inspiration_items inspiration_items_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspiration_items
    ADD CONSTRAINT inspiration_items_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;


--
-- Name: integration_settings integration_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_settings
    ADD CONSTRAINT integration_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: jobseeker_profiles jobseeker_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobseeker_profiles
    ADD CONSTRAINT jobseeker_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: jobseeker_salon_interests jobseeker_salon_interests_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobseeker_salon_interests
    ADD CONSTRAINT jobseeker_salon_interests_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: jobseeker_salon_interests jobseeker_salon_interests_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobseeker_salon_interests
    ADD CONSTRAINT jobseeker_salon_interests_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: legal_entity_businesses legal_entity_businesses_education_center_id_education_centers_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_businesses
    ADD CONSTRAINT legal_entity_businesses_education_center_id_education_centers_i FOREIGN KEY (education_center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: legal_entity_businesses legal_entity_businesses_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_businesses
    ADD CONSTRAINT legal_entity_businesses_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE RESTRICT;


--
-- Name: legal_entity_businesses legal_entity_businesses_owner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_businesses
    ADD CONSTRAINT legal_entity_businesses_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: legal_entity_businesses legal_entity_businesses_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_businesses
    ADD CONSTRAINT legal_entity_businesses_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: lesson_progress lesson_progress_completed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_completed_by_user_id_users_id_fk FOREIGN KEY (completed_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: lesson_progress lesson_progress_enrollment_id_course_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_enrollment_id_course_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE CASCADE;


--
-- Name: lesson_progress lesson_progress_lesson_id_course_lessons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_lesson_id_course_lessons_id_fk FOREIGN KEY (lesson_id) REFERENCES public.course_lessons(id) ON DELETE CASCADE;


--
-- Name: loyalty_point_ledger loyalty_point_ledger_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_point_ledger
    ADD CONSTRAINT loyalty_point_ledger_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: loyalty_point_ledger loyalty_point_ledger_retail_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_point_ledger
    ADD CONSTRAINT loyalty_point_ledger_retail_order_id_retail_orders_id_fk FOREIGN KEY (retail_order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: loyalty_point_ledger loyalty_point_ledger_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_point_ledger
    ADD CONSTRAINT loyalty_point_ledger_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: loyalty_point_ledger loyalty_point_ledger_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_point_ledger
    ADD CONSTRAINT loyalty_point_ledger_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: loyalty_pricing_tier_product_exclusions loyalty_pricing_tier_product_exclusions_product_id_products_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_pricing_tier_product_exclusions
    ADD CONSTRAINT loyalty_pricing_tier_product_exclusions_product_id_products_id_ FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: loyalty_pricing_tier_product_exclusions loyalty_pricing_tier_product_exclusions_tier_id_loyalty_pricing; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_pricing_tier_product_exclusions
    ADD CONSTRAINT loyalty_pricing_tier_product_exclusions_tier_id_loyalty_pricing FOREIGN KEY (tier_id) REFERENCES public.loyalty_pricing_tiers(id) ON DELETE CASCADE;


--
-- Name: media_assets media_assets_owner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: media_upload_tickets media_upload_tickets_finalized_asset_id_media_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_upload_tickets
    ADD CONSTRAINT media_upload_tickets_finalized_asset_id_media_assets_id_fk FOREIGN KEY (finalized_asset_id) REFERENCES public.media_assets(id) ON DELETE SET NULL;


--
-- Name: media_upload_tickets media_upload_tickets_owner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_upload_tickets
    ADD CONSTRAINT media_upload_tickets_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_variants media_variants_asset_id_media_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_variants
    ADD CONSTRAINT media_variants_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: oauth_identities oauth_identities_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_identities
    ADD CONSTRAINT oauth_identities_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oauth_login_states oauth_login_states_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_login_states
    ADD CONSTRAINT oauth_login_states_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_approval_request_lines order_approval_request_lines_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_request_lines
    ADD CONSTRAINT order_approval_request_lines_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE RESTRICT;


--
-- Name: order_approval_request_lines order_approval_request_lines_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_request_lines
    ADD CONSTRAINT order_approval_request_lines_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: order_approval_request_lines order_approval_request_lines_request_id_order_approval_requests; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_request_lines
    ADD CONSTRAINT order_approval_request_lines_request_id_order_approval_requests FOREIGN KEY (request_id) REFERENCES public.order_approval_requests(id) ON DELETE CASCADE;


--
-- Name: order_approval_requests order_approval_requests_cart_id_shopping_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_cart_id_shopping_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.shopping_carts(id) ON DELETE RESTRICT;


--
-- Name: order_approval_requests order_approval_requests_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: order_approval_requests order_approval_requests_finalized_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_finalized_order_id_orders_id_fk FOREIGN KEY (finalized_order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: order_approval_requests order_approval_requests_reviewer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_reviewer_user_id_users_id_fk FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: order_approval_requests order_approval_requests_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: order_approval_requests order_approval_requests_submitted_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_approval_requests
    ADD CONSTRAINT order_approval_requests_submitted_by_user_id_users_id_fk FOREIGN KEY (submitted_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: order_bundle_components order_bundle_components_order_item_id_order_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_bundle_components
    ADD CONSTRAINT order_bundle_components_order_item_id_order_items_id_fk FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: order_bundle_components order_bundle_components_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_bundle_components
    ADD CONSTRAINT order_bundle_components_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: order_items order_items_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_status_history order_status_history_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_courier_service_id_courier_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_courier_service_id_courier_services_id_fk FOREIGN KEY (courier_service_id) REFERENCES public.courier_services(id) ON DELETE SET NULL;


--
-- Name: orders orders_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id);


--
-- Name: package_purchase_service_links package_purchase_service_links_purchase_id_customer_package_pur; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_purchase_service_links
    ADD CONSTRAINT package_purchase_service_links_purchase_id_customer_package_pur FOREIGN KEY (purchase_id) REFERENCES public.customer_package_purchases(id) ON DELETE CASCADE;


--
-- Name: package_purchase_service_links package_purchase_service_links_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_purchase_service_links
    ADD CONSTRAINT package_purchase_service_links_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: package_redemptions package_redemptions_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE RESTRICT;


--
-- Name: package_redemptions package_redemptions_purchase_id_customer_package_purchases_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_purchase_id_customer_package_purchases_id_f FOREIGN KEY (purchase_id) REFERENCES public.customer_package_purchases(id) ON DELETE CASCADE;


--
-- Name: package_redemptions package_redemptions_purchase_service_link_id_package_purchase_s; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_purchase_service_link_id_package_purchase_s FOREIGN KEY (purchase_service_link_id) REFERENCES public.package_purchase_service_links(id) ON DELETE RESTRICT;


--
-- Name: package_redemptions package_redemptions_reversed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_reversed_by_user_id_users_id_fk FOREIGN KEY (reversed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: package_redemptions package_redemptions_salon_customer_id_salon_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_salon_customer_id_salon_customers_id_fk FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE CASCADE;


--
-- Name: package_redemptions package_redemptions_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: package_redemptions package_redemptions_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE RESTRICT;


--
-- Name: package_service_links package_service_links_package_id_treatment_packages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_service_links
    ADD CONSTRAINT package_service_links_package_id_treatment_packages_id_fk FOREIGN KEY (package_id) REFERENCES public.treatment_packages(id) ON DELETE CASCADE;


--
-- Name: package_service_links package_service_links_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_service_links
    ADD CONSTRAINT package_service_links_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: phone_verification_proofs phone_verification_proofs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_verification_proofs
    ADD CONSTRAINT phone_verification_proofs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: platform_retention_settings platform_retention_settings_changed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_retention_settings
    ADD CONSTRAINT platform_retention_settings_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: price_inquiries price_inquiries_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inquiries
    ADD CONSTRAINT price_inquiries_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: price_inquiries price_inquiries_supplier_id_suppliers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inquiries
    ADD CONSTRAINT price_inquiries_supplier_id_suppliers_id_fk FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: product_bundle_components product_bundle_components_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundle_components
    ADD CONSTRAINT product_bundle_components_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE CASCADE;


--
-- Name: product_bundle_components product_bundle_components_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundle_components
    ADD CONSTRAINT product_bundle_components_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: product_bundles product_bundles_linked_treatment_id_treatment_taxonomy_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundles
    ADD CONSTRAINT product_bundles_linked_treatment_id_treatment_taxonomy_id_fk FOREIGN KEY (linked_treatment_id) REFERENCES public.treatment_taxonomy(id) ON DELETE SET NULL;


--
-- Name: product_bundles product_bundles_supplier_id_suppliers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundles
    ADD CONSTRAINT product_bundles_supplier_id_suppliers_id_fk FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: product_categories product_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id) ON DELETE RESTRICT;


--
-- Name: product_categories product_categories_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: product_documents product_documents_media_asset_id_media_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_documents
    ADD CONSTRAINT product_documents_media_asset_id_media_assets_id_fk FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE RESTRICT;


--
-- Name: product_documents product_documents_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_documents
    ADD CONSTRAINT product_documents_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: product_treatment_mappings product_treatment_mappings_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_treatment_mappings
    ADD CONSTRAINT product_treatment_mappings_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_treatment_mappings product_treatment_mappings_treatment_id_treatment_taxonomy_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_treatment_mappings
    ADD CONSTRAINT product_treatment_mappings_treatment_id_treatment_taxonomy_id_f FOREIGN KEY (treatment_id) REFERENCES public.treatment_taxonomy(id) ON DELETE CASCADE;


--
-- Name: product_upsell_links product_upsell_links_alternative_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_upsell_links
    ADD CONSTRAINT product_upsell_links_alternative_product_id_products_id_fk FOREIGN KEY (alternative_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: product_upsell_links product_upsell_links_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_upsell_links
    ADD CONSTRAINT product_upsell_links_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_waitlist_notification_outbox product_waitlist_notification_outbox_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist_notification_outbox
    ADD CONSTRAINT product_waitlist_notification_outbox_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_waitlist_notification_outbox product_waitlist_notification_outbox_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist_notification_outbox
    ADD CONSTRAINT product_waitlist_notification_outbox_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: product_waitlist_notification_outbox product_waitlist_notification_outbox_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist_notification_outbox
    ADD CONSTRAINT product_waitlist_notification_outbox_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_waitlist_notification_outbox product_waitlist_notification_outbox_waitlist_id_product_waitli; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist_notification_outbox
    ADD CONSTRAINT product_waitlist_notification_outbox_waitlist_id_product_waitli FOREIGN KEY (waitlist_id) REFERENCES public.product_waitlist(id) ON DELETE CASCADE;


--
-- Name: product_waitlist product_waitlist_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist
    ADD CONSTRAINT product_waitlist_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_waitlist product_waitlist_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist
    ADD CONSTRAINT product_waitlist_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: product_waitlist product_waitlist_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_waitlist
    ADD CONSTRAINT product_waitlist_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_wishlists product_wishlists_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_wishlists
    ADD CONSTRAINT product_wishlists_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_wishlists product_wishlists_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_wishlists
    ADD CONSTRAINT product_wishlists_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_product_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_product_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON DELETE SET NULL;


--
-- Name: products products_product_type_id_b2c_product_types_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_product_type_id_b2c_product_types_id_fk FOREIGN KEY (product_type_id) REFERENCES public.b2c_product_types(id) ON DELETE RESTRICT;


--
-- Name: products products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: push_subscriptions push_subscriptions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_attributions referral_attributions_referral_code_id_referral_codes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_referral_code_id_referral_codes_id_fk FOREIGN KEY (referral_code_id) REFERENCES public.referral_codes(id) ON DELETE RESTRICT;


--
-- Name: referral_attributions referral_attributions_referred_education_center_id_education_ce; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_referred_education_center_id_education_ce FOREIGN KEY (referred_education_center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: referral_attributions referral_attributions_referred_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_referred_salon_id_salons_id_fk FOREIGN KEY (referred_salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: referral_attributions referral_attributions_referred_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_referred_user_id_users_id_fk FOREIGN KEY (referred_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: referral_attributions referral_attributions_referrer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_referrer_user_id_users_id_fk FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: referral_codes referral_codes_referrer_education_center_id_education_centers_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_referrer_education_center_id_education_centers_i FOREIGN KEY (referrer_education_center_id) REFERENCES public.education_centers(id) ON DELETE CASCADE;


--
-- Name: referral_codes referral_codes_referrer_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_referrer_salon_id_salons_id_fk FOREIGN KEY (referrer_salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: referral_codes referral_codes_referrer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_referrer_user_id_users_id_fk FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_ledger referral_credit_ledger_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_ledger
    ADD CONSTRAINT referral_credit_ledger_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_credit_ledger referral_credit_ledger_education_center_id_education_centers_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_ledger
    ADD CONSTRAINT referral_credit_ledger_education_center_id_education_centers_id FOREIGN KEY (education_center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_ledger referral_credit_ledger_owner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_ledger
    ADD CONSTRAINT referral_credit_ledger_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_ledger referral_credit_ledger_referral_attribution_id_referral_attribu; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_ledger
    ADD CONSTRAINT referral_credit_ledger_referral_attribution_id_referral_attribu FOREIGN KEY (referral_attribution_id) REFERENCES public.referral_attributions(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_ledger referral_credit_ledger_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_ledger
    ADD CONSTRAINT referral_credit_ledger_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_redemptions referral_credit_redemptions_ledger_entry_id_referral_credit_led; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_redemptions
    ADD CONSTRAINT referral_credit_redemptions_ledger_entry_id_referral_credit_led FOREIGN KEY (ledger_entry_id) REFERENCES public.referral_credit_ledger(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_redemptions referral_credit_redemptions_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_redemptions
    ADD CONSTRAINT referral_credit_redemptions_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_redemptions referral_credit_redemptions_retail_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_redemptions
    ADD CONSTRAINT referral_credit_redemptions_retail_order_id_fkey FOREIGN KEY (retail_order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: referral_credit_redemptions referral_credit_redemptions_retail_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_credit_redemptions
    ADD CONSTRAINT referral_credit_redemptions_retail_order_id_retail_orders_id_fk FOREIGN KEY (retail_order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: referral_milestone_benefits referral_milestone_benefits_benefit_education_center_id_educati; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_milestone_benefits
    ADD CONSTRAINT referral_milestone_benefits_benefit_education_center_id_educati FOREIGN KEY (benefit_education_center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: referral_milestone_benefits referral_milestone_benefits_benefit_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_milestone_benefits
    ADD CONSTRAINT referral_milestone_benefits_benefit_salon_id_salons_id_fk FOREIGN KEY (benefit_salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: referral_milestone_benefits referral_milestone_benefits_neutralized_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_milestone_benefits
    ADD CONSTRAINT referral_milestone_benefits_neutralized_by_user_id_users_id_fk FOREIGN KEY (neutralized_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_milestone_benefits referral_milestone_benefits_referrer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_milestone_benefits
    ADD CONSTRAINT referral_milestone_benefits_referrer_user_id_users_id_fk FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: referral_qualification_evidence referral_qualification_evidence_appointment_id_appointments_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualification_evidence
    ADD CONSTRAINT referral_qualification_evidence_appointment_id_appointments_id_ FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE RESTRICT;


--
-- Name: referral_qualification_evidence referral_qualification_evidence_enrollment_id_course_enrollment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualification_evidence
    ADD CONSTRAINT referral_qualification_evidence_enrollment_id_course_enrollment FOREIGN KEY (enrollment_id) REFERENCES public.course_enrollments(id) ON DELETE RESTRICT;


--
-- Name: referral_qualification_evidence referral_qualification_evidence_qualification_id_referral_quali; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualification_evidence
    ADD CONSTRAINT referral_qualification_evidence_qualification_id_referral_quali FOREIGN KEY (qualification_id) REFERENCES public.referral_qualifications(id) ON DELETE CASCADE;


--
-- Name: referral_qualifications referral_qualifications_attribution_id_referral_attributions_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualifications
    ADD CONSTRAINT referral_qualifications_attribution_id_referral_attributions_id FOREIGN KEY (attribution_id) REFERENCES public.referral_attributions(id) ON DELETE RESTRICT;


--
-- Name: referral_qualifications referral_qualifications_referred_education_center_id_education_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualifications
    ADD CONSTRAINT referral_qualifications_referred_education_center_id_education_ FOREIGN KEY (referred_education_center_id) REFERENCES public.education_centers(id) ON DELETE RESTRICT;


--
-- Name: referral_qualifications referral_qualifications_referred_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualifications
    ADD CONSTRAINT referral_qualifications_referred_salon_id_salons_id_fk FOREIGN KEY (referred_salon_id) REFERENCES public.salons(id) ON DELETE RESTRICT;


--
-- Name: referral_reviews referral_reviews_attribution_id_referral_attributions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_reviews
    ADD CONSTRAINT referral_reviews_attribution_id_referral_attributions_id_fk FOREIGN KEY (attribution_id) REFERENCES public.referral_attributions(id) ON DELETE CASCADE;


--
-- Name: referral_reviews referral_reviews_qualification_id_referral_qualifications_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_reviews
    ADD CONSTRAINT referral_reviews_qualification_id_referral_qualifications_id_fk FOREIGN KEY (qualification_id) REFERENCES public.referral_qualifications(id) ON DELETE CASCADE;


--
-- Name: referral_reviews referral_reviews_reviewed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_reviews
    ADD CONSTRAINT referral_reviews_reviewed_by_user_id_users_id_fk FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: reorder_actions reorder_actions_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reorder_actions
    ADD CONSTRAINT reorder_actions_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: reorder_actions reorder_actions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reorder_actions
    ADD CONSTRAINT reorder_actions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: retail_cart_items retail_cart_items_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_cart_items
    ADD CONSTRAINT retail_cart_items_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE CASCADE;


--
-- Name: retail_cart_items retail_cart_items_cart_id_retail_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_cart_items
    ADD CONSTRAINT retail_cart_items_cart_id_retail_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.retail_carts(id) ON DELETE CASCADE;


--
-- Name: retail_cart_items retail_cart_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_cart_items
    ADD CONSTRAINT retail_cart_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: retail_carts retail_carts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_carts
    ADD CONSTRAINT retail_carts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: retail_order_items retail_order_items_aftercare_recommendation_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_order_items
    ADD CONSTRAINT retail_order_items_aftercare_recommendation_fk FOREIGN KEY (aftercare_recommendation_id) REFERENCES public.aftercare_recommendations(id) ON DELETE RESTRICT;


--
-- Name: retail_order_items retail_order_items_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_order_items
    ADD CONSTRAINT retail_order_items_order_id_retail_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.retail_orders(id) ON DELETE CASCADE;


--
-- Name: retail_order_items retail_order_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_order_items
    ADD CONSTRAINT retail_order_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: retail_order_status_history retail_order_status_history_retail_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_order_status_history
    ADD CONSTRAINT retail_order_status_history_retail_order_id_retail_orders_id_fk FOREIGN KEY (retail_order_id) REFERENCES public.retail_orders(id) ON DELETE CASCADE;


--
-- Name: retail_orders retail_orders_cart_id_retail_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_orders
    ADD CONSTRAINT retail_orders_cart_id_retail_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.retail_carts(id) ON DELETE RESTRICT;


--
-- Name: retail_orders retail_orders_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_orders
    ADD CONSTRAINT retail_orders_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: retail_product_review_attachments retail_product_review_attachments_media_asset_id_media_assets_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_attachments
    ADD CONSTRAINT retail_product_review_attachments_media_asset_id_media_assets_i FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE RESTRICT;


--
-- Name: retail_product_review_attachments retail_product_review_attachments_review_id_retail_product_revi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_attachments
    ADD CONSTRAINT retail_product_review_attachments_review_id_retail_product_revi FOREIGN KEY (review_id) REFERENCES public.retail_product_reviews(id) ON DELETE CASCADE;


--
-- Name: retail_product_review_moderation_audits retail_product_review_moderation_audits_moderator_user_id_users; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_moderation_audits
    ADD CONSTRAINT retail_product_review_moderation_audits_moderator_user_id_users FOREIGN KEY (moderator_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: retail_product_review_moderation_audits retail_product_review_moderation_audits_review_id_retail_produc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_moderation_audits
    ADD CONSTRAINT retail_product_review_moderation_audits_review_id_retail_produc FOREIGN KEY (review_id) REFERENCES public.retail_product_reviews(id) ON DELETE CASCADE;


--
-- Name: retail_product_review_reports retail_product_review_reports_reporter_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_reports
    ADD CONSTRAINT retail_product_review_reports_reporter_user_id_users_id_fk FOREIGN KEY (reporter_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: retail_product_review_reports retail_product_review_reports_review_id_retail_product_reviews_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_review_reports
    ADD CONSTRAINT retail_product_review_reports_review_id_retail_product_reviews_ FOREIGN KEY (review_id) REFERENCES public.retail_product_reviews(id) ON DELETE CASCADE;


--
-- Name: retail_product_reviews retail_product_reviews_order_item_id_retail_order_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_reviews
    ADD CONSTRAINT retail_product_reviews_order_item_id_retail_order_items_id_fk FOREIGN KEY (order_item_id) REFERENCES public.retail_order_items(id) ON DELETE RESTRICT;


--
-- Name: retail_product_reviews retail_product_reviews_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_reviews
    ADD CONSTRAINT retail_product_reviews_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: retail_product_reviews retail_product_reviews_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_reviews
    ADD CONSTRAINT retail_product_reviews_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: retail_product_subscription_attempts retail_product_subscription_attempts_order_id_retail_orders_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_subscription_attempts
    ADD CONSTRAINT retail_product_subscription_attempts_order_id_retail_orders_id_ FOREIGN KEY (order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: retail_product_subscription_attempts retail_product_subscription_attempts_subscription_id_retail_pro; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_subscription_attempts
    ADD CONSTRAINT retail_product_subscription_attempts_subscription_id_retail_pro FOREIGN KEY (subscription_id) REFERENCES public.retail_product_subscriptions(id) ON DELETE CASCADE;


--
-- Name: retail_product_subscriptions retail_product_subscriptions_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_subscriptions
    ADD CONSTRAINT retail_product_subscriptions_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: retail_product_subscriptions retail_product_subscriptions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_product_subscriptions
    ADD CONSTRAINT retail_product_subscriptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: review_invitations review_invitations_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_invitations
    ADD CONSTRAINT review_invitations_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: review_invitations review_invitations_customer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_invitations
    ADD CONSTRAINT review_invitations_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: review_invitations review_invitations_notification_id_customer_notifications_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_invitations
    ADD CONSTRAINT review_invitations_notification_id_customer_notifications_id_fk FOREIGN KEY (notification_id) REFERENCES public.customer_notifications(id) ON DELETE SET NULL;


--
-- Name: review_reward_issuances review_reward_issuances_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_reward_issuances
    ADD CONSTRAINT review_reward_issuances_order_id_retail_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_customer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- Name: reviews reviews_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: reviews reviews_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: rma_attachments rma_attachments_media_asset_id_media_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_attachments
    ADD CONSTRAINT rma_attachments_media_asset_id_media_assets_id_fk FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE RESTRICT;


--
-- Name: rma_attachments rma_attachments_rma_id_rmas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_attachments
    ADD CONSTRAINT rma_attachments_rma_id_rmas_id_fk FOREIGN KEY (rma_id) REFERENCES public.rmas(id) ON DELETE CASCADE;


--
-- Name: rma_status_history rma_status_history_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_status_history
    ADD CONSTRAINT rma_status_history_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: rma_status_history rma_status_history_rma_id_rmas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rma_status_history
    ADD CONSTRAINT rma_status_history_rma_id_rmas_id_fk FOREIGN KEY (rma_id) REFERENCES public.rmas(id) ON DELETE CASCADE;


--
-- Name: rmas rmas_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmas
    ADD CONSTRAINT rmas_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: rmas rmas_order_item_id_order_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmas
    ADD CONSTRAINT rmas_order_item_id_order_items_id_fk FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE RESTRICT;


--
-- Name: rmas rmas_requester_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmas
    ADD CONSTRAINT rmas_requester_user_id_users_id_fk FOREIGN KEY (requester_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: rmas rmas_retail_order_id_retail_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmas
    ADD CONSTRAINT rmas_retail_order_id_retail_orders_id_fk FOREIGN KEY (retail_order_id) REFERENCES public.retail_orders(id) ON DELETE RESTRICT;


--
-- Name: rmas rmas_retail_order_item_id_retail_order_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmas
    ADD CONSTRAINT rmas_retail_order_item_id_retail_order_items_id_fk FOREIGN KEY (retail_order_item_id) REFERENCES public.retail_order_items(id) ON DELETE RESTRICT;


--
-- Name: salon_booking_settings salon_booking_settings_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_booking_settings
    ADD CONSTRAINT salon_booking_settings_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_booking_settings salon_booking_settings_updated_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_booking_settings
    ADD CONSTRAINT salon_booking_settings_updated_by_user_id_users_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: salon_brands salon_brands_brand_id_product_brands_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_brands
    ADD CONSTRAINT salon_brands_brand_id_product_brands_id_fk FOREIGN KEY (brand_id) REFERENCES public.product_brands(id) ON DELETE CASCADE;


--
-- Name: salon_brands salon_brands_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_brands
    ADD CONSTRAINT salon_brands_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_customers salon_customers_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_customers
    ADD CONSTRAINT salon_customers_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_customers salon_customers_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_customers
    ADD CONSTRAINT salon_customers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: salon_date_hours salon_date_hours_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_date_hours
    ADD CONSTRAINT salon_date_hours_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_hours salon_hours_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_hours
    ADD CONSTRAINT salon_hours_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_inventory_movements salon_inventory_movements_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: salon_inventory_movements salon_inventory_movements_inventory_id_salon_inventory_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_inventory_id_salon_inventory_id_fk FOREIGN KEY (inventory_id) REFERENCES public.salon_inventory(id) ON DELETE CASCADE;


--
-- Name: salon_inventory_movements salon_inventory_movements_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: salon_inventory_movements salon_inventory_movements_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: salon_inventory_movements salon_inventory_movements_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_inventory_movements salon_inventory_movements_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory_movements
    ADD CONSTRAINT salon_inventory_movements_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;


--
-- Name: salon_inventory salon_inventory_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory
    ADD CONSTRAINT salon_inventory_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: salon_inventory salon_inventory_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_inventory
    ADD CONSTRAINT salon_inventory_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_location_creation_requests salon_location_creation_requests_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_location_creation_requests
    ADD CONSTRAINT salon_location_creation_requests_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: salon_loyalty_statuses salon_loyalty_statuses_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_loyalty_statuses
    ADD CONSTRAINT salon_loyalty_statuses_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_loyalty_statuses salon_loyalty_statuses_tier_id_loyalty_tiers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_loyalty_statuses
    ADD CONSTRAINT salon_loyalty_statuses_tier_id_loyalty_tiers_id_fk FOREIGN KEY (tier_id) REFERENCES public.loyalty_tiers(id) ON DELETE SET NULL;


--
-- Name: salon_notifications salon_notifications_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_notifications
    ADD CONSTRAINT salon_notifications_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salon_resource_downtime salon_resource_downtime_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_resource_downtime
    ADD CONSTRAINT salon_resource_downtime_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: salon_resource_downtime salon_resource_downtime_resource_id_salon_resources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_resource_downtime
    ADD CONSTRAINT salon_resource_downtime_resource_id_salon_resources_id_fk FOREIGN KEY (resource_id) REFERENCES public.salon_resources(id) ON DELETE CASCADE;


--
-- Name: salon_resources salon_resources_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salon_resources
    ADD CONSTRAINT salon_resources_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: salons salons_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salons
    ADD CONSTRAINT salons_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: saved_retail_cart_items saved_retail_cart_items_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_retail_cart_items
    ADD CONSTRAINT saved_retail_cart_items_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE CASCADE;


--
-- Name: saved_retail_cart_items saved_retail_cart_items_cart_id_retail_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_retail_cart_items
    ADD CONSTRAINT saved_retail_cart_items_cart_id_retail_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.retail_carts(id) ON DELETE CASCADE;


--
-- Name: saved_retail_cart_items saved_retail_cart_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_retail_cart_items
    ADD CONSTRAINT saved_retail_cart_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: saved_shop_cart_items saved_shop_cart_items_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_shop_cart_items
    ADD CONSTRAINT saved_shop_cart_items_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE CASCADE;


--
-- Name: saved_shop_cart_items saved_shop_cart_items_cart_id_shopping_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_shop_cart_items
    ADD CONSTRAINT saved_shop_cart_items_cart_id_shopping_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.shopping_carts(id) ON DELETE CASCADE;


--
-- Name: saved_shop_cart_items saved_shop_cart_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_shop_cart_items
    ADD CONSTRAINT saved_shop_cart_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: service_add_on_resource_requirements service_add_on_resource_requirements_add_on_id_service_add_ons_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_add_on_resource_requirements
    ADD CONSTRAINT service_add_on_resource_requirements_add_on_id_service_add_ons_ FOREIGN KEY (add_on_id) REFERENCES public.service_add_ons(id) ON DELETE CASCADE;


--
-- Name: service_add_on_resource_requirements service_add_on_resource_requirements_resource_id_salon_resource; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_add_on_resource_requirements
    ADD CONSTRAINT service_add_on_resource_requirements_resource_id_salon_resource FOREIGN KEY (resource_id) REFERENCES public.salon_resources(id) ON DELETE CASCADE;


--
-- Name: service_add_ons service_add_ons_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_add_ons
    ADD CONSTRAINT service_add_ons_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_product_consumptions service_product_consumptions_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_product_consumptions
    ADD CONSTRAINT service_product_consumptions_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: service_product_consumptions service_product_consumptions_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_product_consumptions
    ADD CONSTRAINT service_product_consumptions_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: service_product_consumptions service_product_consumptions_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_product_consumptions
    ADD CONSTRAINT service_product_consumptions_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_resource_requirements service_resource_requirements_resource_id_salon_resources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource_requirements
    ADD CONSTRAINT service_resource_requirements_resource_id_salon_resources_id_fk FOREIGN KEY (resource_id) REFERENCES public.salon_resources(id) ON DELETE CASCADE;


--
-- Name: service_resource_requirements service_resource_requirements_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource_requirements
    ADD CONSTRAINT service_resource_requirements_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: services services_category_id_service_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_category_id_service_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.service_categories(id) ON DELETE SET NULL;


--
-- Name: services services_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: shift_swap_requests shift_swap_requests_requester_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_requester_employee_id_employees_id_fk FOREIGN KEY (requester_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: shift_swap_requests shift_swap_requests_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: shift_swap_requests shift_swap_requests_target_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_target_employee_id_employees_id_fk FOREIGN KEY (target_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: shopping_cart_items shopping_cart_items_bundle_id_product_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_cart_items
    ADD CONSTRAINT shopping_cart_items_bundle_id_product_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.product_bundles(id) ON DELETE CASCADE;


--
-- Name: shopping_cart_items shopping_cart_items_cart_id_shopping_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_cart_items
    ADD CONSTRAINT shopping_cart_items_cart_id_shopping_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.shopping_carts(id) ON DELETE CASCADE;


--
-- Name: shopping_cart_items shopping_cart_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_cart_items
    ADD CONSTRAINT shopping_cart_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: shopping_carts shopping_carts_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_carts
    ADD CONSTRAINT shopping_carts_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: sms_deliveries sms_deliveries_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_deliveries
    ADD CONSTRAINT sms_deliveries_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: sms_deliveries sms_deliveries_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_deliveries
    ADD CONSTRAINT sms_deliveries_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_plan_id_subscription_plans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_subscription_plans_id_fk FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: subscriptions subscriptions_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: system_push_deliveries system_push_deliveries_subscription_id_push_subscriptions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_push_deliveries
    ADD CONSTRAINT system_push_deliveries_subscription_id_push_subscriptions_id_fk FOREIGN KEY (subscription_id) REFERENCES public.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: system_push_deliveries system_push_deliveries_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_push_deliveries
    ADD CONSTRAINT system_push_deliveries_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: treatment_packages treatment_packages_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_packages
    ADD CONSTRAINT treatment_packages_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: treatment_photos treatment_photos_appointment_id_appointments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_photos
    ADD CONSTRAINT treatment_photos_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: treatment_photos treatment_photos_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_photos
    ADD CONSTRAINT treatment_photos_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: treatment_photos treatment_photos_salon_customer_id_salon_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_photos
    ADD CONSTRAINT treatment_photos_salon_customer_id_salon_customers_id_fk FOREIGN KEY (salon_customer_id) REFERENCES public.salon_customers(id) ON DELETE CASCADE;


--
-- Name: treatment_photos treatment_photos_salon_id_salons_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_photos
    ADD CONSTRAINT treatment_photos_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;


--
-- Name: treatment_photos treatment_photos_uploaded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treatment_photos
    ADD CONSTRAINT treatment_photos_uploaded_by_user_id_users_id_fk FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
--
