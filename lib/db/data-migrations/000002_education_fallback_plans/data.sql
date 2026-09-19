-- Supported ONLY for unreferenced, empty or exact partially seeded fallback plans.
-- Shared/legacy/custom plans require separately reviewed reconciliation.
LOCK TABLE public.subscription_plans, public.subscriptions,
  public.education_center_subscriptions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscriptions)
    OR EXISTS (SELECT 1 FROM public.education_center_subscriptions) THEN
    RAISE EXCEPTION 'STARTUP_DATA_PLAN_RELATIONSHIPS_REQUIRE_RECONCILIATION';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscription_plans p
    WHERE (
      p.audience = 'education' AND p.price = 0 AND p.trial_days = 30
      AND p.features = '[]'::jsonb AND p.vat_included = true
      AND p.price_copy = 'Cena uključuje PDV.' AND p.active = false
      AND p.limits = jsonb_build_object('courses', p.course_limit)
      AND ((p.name = 'Education Start' AND p.course_limit = 5)
        OR (p.name = 'Education Growth' AND p.course_limit = 15)
        OR (p.name = 'Education Academy' AND p.course_limit = 30))
    ) IS NOT TRUE
  ) OR EXISTS (
    SELECT course_limit FROM public.subscription_plans GROUP BY course_limit HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'STARTUP_DATA_EXISTING_PLANS_REQUIRE_RECONCILIATION';
  END IF;
END $$;

INSERT INTO public.subscription_plans
  (name, price, trial_days, features, limits, audience, course_limit, vat_included, price_copy, active)
SELECT seed.name, 0, 30, '[]'::jsonb, jsonb_build_object('courses', seed.course_limit),
       'education', seed.course_limit, true, 'Cena uključuje PDV.', false
FROM (VALUES ('Education Start', 5), ('Education Growth', 15), ('Education Academy', 30)) seed(name, course_limit)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscription_plans p WHERE p.audience = 'education' AND p.course_limit = seed.course_limit
);