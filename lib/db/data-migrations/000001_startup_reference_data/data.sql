-- Explicit data step, NOT a schema-baseline migration or rollout marker.
-- The caller must hold a transaction and validate the pinned table contract.
-- Source: business-growth-schema.ts tableStatements; see startup-data report.
LOCK TABLE public.suppliers, public.beauty_job_platform_settings,
  public.beauty_job_categories, public.shop_settings, public.b2c_display_settings,
  public.aftercare_settings, public.education_placement_settings,
  public.education_b2b_discount_settings IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE (slug = 'lumera-legacy' AND id <> '9b5970ea-0a8c-5e60-9d32-2a09f0890560')
       OR (id = '9b5970ea-0a8c-5e60-9d32-2a09f0890560' AND slug <> 'lumera-legacy')
  ) THEN
    RAISE EXCEPTION 'STARTUP_DATA_SUPPLIER_IDENTITY_CONFLICT';
  END IF;
  IF (SELECT count(*) FROM public.beauty_job_platform_settings) > 1
    OR (SELECT count(*) FROM public.shop_settings) > 1
    OR (SELECT count(*) FROM public.b2c_display_settings) > 1 THEN
    RAISE EXCEPTION 'STARTUP_DATA_AMBIGUOUS_SINGLETON';
  END IF;
END $$;

-- The VALUES payload below is identical to the original startup payload.
-- Unlike startup's ON CONFLICT DO UPDATE, mismatching existing payloads abort.
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
    RAISE EXCEPTION 'STARTUP_DATA_CATEGORY_PAYLOAD_CONFLICT';
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