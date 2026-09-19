-- lumera:migration-format 1
-- lumera:id 000002
-- lumera:mode transactional
-- lumera:description Apply the admitted supported startup data state
-- lumera:min-postgres 16
-- lumera:max-postgres 16
-- lumera:precondition-sql SELECT current_setting('server_version_num')::integer >= 160000
-- lumera:postcondition-sql SELECT to_regclass('public.users') IS NOT NULL
-- lumera:recovery Transaction rollback leaves the database unchanged; resolve the admission error before retrying
-- lumera:end-header

SET LOCAL search_path = public, pg_catalog;

CREATE TEMP TABLE startup_category_seed ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('frizeri', 'Frizeri', '["Ženski frizer", "Muški frizer", "Kolorista"]'::jsonb, true, NULL::text),
  ('barberi', 'Barberi', '["Šišanje", "Brijanje", "Stilizovanje brade"]'::jsonb, true, NULL),
  ('kozmetika', 'Kozmetika', '[]'::jsonb, true, NULL),
  ('kozmeticari', 'Kozmetičari', '["Nega lica", "Depilacija", "Tretmani tela"]'::jsonb, true, NULL),
  ('nokti', 'Nokti (Manikir/Pedikir)', '["Manikir", "Pedikir", "Nail artist"]'::jsonb, true, NULL),
  ('lash-brow', 'Lash/Brow', '["Ekstenzije trepavica", "Laminacija trepavica", "Obrve"]'::jsonb, true, NULL),
  ('make-up', 'Make-up', '["Dnevna šminka", "Svečana šminka"]'::jsonb, true, NULL),
  ('sminkeri', 'Šminkeri', '["Dnevna šminka", "Svečana šminka", "Editorial"]'::jsonb, true, NULL),
  ('pmu', 'PMU', '["Obrve", "Usne", "Eyeliner"]'::jsonb, true, NULL),
  ('estetika-masaza', 'Estetika i masaža', '["Estetika", "Masaža", "Terapeut"]'::jsonb, true, NULL),
  ('masaza-terapeuti', 'Masaža/Terapeuti', '["Relaks masaža", "Sportska masaža", "Terapeut"]'::jsonb, true, NULL),
  ('estetika-anti-aging', 'Estetika/anti-aging', '["Anti-aging", "Mezoterapija", "Nega lica"]'::jsonb, true, NULL),
  ('pomocno-osoblje', 'Pomoćno osoblje', '["Recepcija", "Asistent u salonu", "Šampon"]'::jsonb, true, NULL),
  ('tattoo-piercing', 'Tattoo/Piercing', '["Tattoo", "Piercing"]'::jsonb, true, 'beauty_jobs_tattoo_piercing'),
  ('iznajmljivanje-opreme', 'Iznajmljivanje opreme', '[]'::jsonb, true, NULL),
  ('iznajmljivanje-prostora-stolice', 'Iznajmljivanje prostora/stolice', '["Stolica", "Kabina", "Prostor"]'::jsonb, true, NULL),
  ('freelance-angazmani', 'Freelance/angažmani', '[]'::jsonb, true, NULL)
) AS seed(slug, name, subtype_labels, enabled, feature_flag);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.beauty_job_categories p JOIN pg_temp.startup_category_seed s USING (slug)
    WHERE ROW(p.name,p.subtype_labels,p.enabled,p.feature_flag)
       IS DISTINCT FROM ROW(s.name,s.subtype_labels,s.enabled,s.feature_flag)
  ) THEN
    RAISE EXCEPTION 'SUPPORTED_STARTUP_CATEGORY_PAYLOAD_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE (slug = 'lumera-legacy' AND id <> '9b5970ea-0a8c-5e60-9d32-2a09f0890560')
       OR (id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560' AND slug <> 'lumera-legacy')
  ) THEN
    RAISE EXCEPTION 'SUPPORTED_STARTUP_SUPPLIER_IDENTITY_CONFLICT';
  END IF;
  IF (SELECT count(*) FROM public.beauty_job_platform_settings) > 1
    OR (SELECT count(*) FROM public.shop_settings) > 1
    OR (SELECT count(*) FROM public.b2c_display_settings) > 1 THEN
    RAISE EXCEPTION 'SUPPORTED_STARTUP_AMBIGUOUS_SINGLETON';
  END IF;
END $$;

INSERT INTO public.suppliers (id, name, slug, scope, active)
VALUES ('9b5970ea-0a8c-5e60-9d32-2a09f0890560', 'LUMERA Legacy Catalog', 'lumera-legacy', 'BOTH', true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.beauty_job_platform_settings (listing_expiry_days, hourly_posting_limit)
SELECT 30, 5 WHERE NOT EXISTS (SELECT 1 FROM public.beauty_job_platform_settings);
INSERT INTO public.beauty_job_categories (slug, name, subtype_labels, enabled, feature_flag)
SELECT slug, name, subtype_labels, enabled, feature_flag FROM pg_temp.startup_category_seed
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.shop_settings DEFAULT VALUES ON CONFLICT DO NOTHING;
INSERT INTO public.b2c_display_settings DEFAULT VALUES ON CONFLICT DO NOTHING;
INSERT INTO public.aftercare_settings (version)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.aftercare_settings);
INSERT INTO public.education_placement_settings (kind, scope, price, slot_count, duration_days)
VALUES ('featured_salon', 'home', 5000, 12, 30) ON CONFLICT (kind, scope) DO NOTHING;
INSERT INTO public.education_b2b_discount_settings (id, version)
VALUES (true, 1) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans
  (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active)
SELECT seed.name, 0, 30, '[]'::jsonb, jsonb_build_object('courses', seed.course_limit),
       'education', seed.course_limit, true, 'Cena uključuje PDV.', false
FROM (VALUES ('Education Start', 5), ('Education Growth', 15), ('Education Academy', 30))
  seed(name, course_limit)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscription_plans p
  WHERE p.audience = 'education' AND p.course_limit = seed.course_limit
);

INSERT INTO public.education_salon_cleanup_reports
  (version, candidates, detached_users, deleted_salons, retired_salons)
SELECT 99, 0, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.education_salon_cleanup_reports WHERE version = 99);

CREATE OR REPLACE FUNCTION public.prevent_education_gift_voucher_snapshot_update() RETURNS trigger
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