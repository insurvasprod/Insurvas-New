-- Self-serve local signup needs one transaction: tenant, owner, selected plan, subscription,
-- entitlement and audit trail must not be left partially created when a retry or validation error
-- occurs. This is intentionally a local subscription activation path; provider checkout remains a
-- separate Whop flow and is not called during signup.
CREATE OR REPLACE FUNCTION public.self_serve_signup_with_subscription(
  p_tenant_name text,
  p_owner_name text,
  p_owner_email text,
  p_owner_password_hash text,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle
)
RETURNS TABLE(tenant_id uuid, user_id uuid, subscription_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_subscription_id uuid;
  v_price integer;
  v_trial_days integer;
  v_status public.subscription_status;
  v_trial_ends_at timestamptz;
  v_plan_code text;
BEGIN
  IF nullif(btrim(p_tenant_name), '') IS NULL
     OR nullif(btrim(p_owner_name), '') IS NULL
     OR nullif(btrim(p_owner_email), '') IS NULL
     OR nullif(p_owner_password_hash, '') IS NULL THEN
    RAISE EXCEPTION 'invalid_signup_input' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.code
    INTO v_plan_code
    FROM public.plans p
   WHERE p.id = p_plan_id
     AND p.is_public
     AND NOT p.is_archived
     AND p.version = (
       SELECT max(latest.version)
         FROM public.plans latest
        WHERE latest.code = p.code
     )
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_available' USING ERRCODE = 'P0001';
  END IF;

  SELECT CASE p_billing_cycle
           WHEN 'monthly' THEN prices.price_monthly_cents
           WHEN 'quarterly' THEN prices.price_quarterly_cents
           ELSE prices.price_yearly_cents
         END,
         prices.trial_days
    INTO v_price, v_trial_days
    FROM public.plan_prices prices
   WHERE prices.plan_id = p_plan_id;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'billing_cycle_not_available' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(v_trial_days, 0) > 0 THEN
    v_status := 'trialing';
    v_trial_ends_at := now() + make_interval(days => v_trial_days);
  ELSE
    v_status := 'active';
    v_trial_ends_at := NULL;
  END IF;

  INSERT INTO public.users (email, password_hash, name, status)
  VALUES (lower(btrim(p_owner_email)), p_owner_password_hash, btrim(p_owner_name), 'active')
  RETURNING id INTO v_user_id;

  INSERT INTO public.tenants (name, status, plan_code, onboarding_state)
  VALUES (btrim(p_tenant_name), 'active', v_plan_code, 'completed')
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_users (tenant_id, user_id, role, accepted_at)
  VALUES (v_tenant_id, v_user_id, 'owner', now());

  INSERT INTO public.signup_selections (tenant_id, plan_id, billing_cycle)
  VALUES (v_tenant_id, p_plan_id, p_billing_cycle);

  INSERT INTO public.subscriptions (
    tenant_id, plan_id, status, billing_cycle, started_at,
    current_period_start, current_period_end, trial_ends_at
  )
  VALUES (
    v_tenant_id, p_plan_id, v_status, p_billing_cycle, now(),
    now(), public.period_end_for(now(), p_billing_cycle), v_trial_ends_at
  )
  RETURNING id INTO v_subscription_id;

  PERFORM public.refresh_tenant_entitlement(v_tenant_id);

  INSERT INTO public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  VALUES (
    'system', NULL, 'tenant.signup_completed', 'tenant', v_tenant_id::text,
    jsonb_build_object('plan_id', p_plan_id, 'plan_code', v_plan_code, 'billing_cycle', p_billing_cycle)
  );

  RETURN QUERY SELECT v_tenant_id, v_user_id, v_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.self_serve_signup_with_subscription(
  text, text, text, text, uuid, public.billing_cycle
) FROM PUBLIC, anon, authenticated, tenant_app;
GRANT EXECUTE ON FUNCTION public.self_serve_signup_with_subscription(
  text, text, text, text, uuid, public.billing_cycle
) TO service_role;
