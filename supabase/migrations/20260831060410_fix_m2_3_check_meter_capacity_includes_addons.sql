-- bugs_sa.md M2-3 (P1) · Add-on meter credits were ignored by enforcement.
--
-- resolve_tenant_entitlement stacks plan and add-on meter credits correctly. check_meter_capacity
-- — the function that actually decides whether an action is allowed — read only plan_meters. So a
-- tenant on a plan with 1,000 dialer minutes who bought a 500-minute add-on was still blocked at
-- 1,000: they paid for credits the enforcement path could not see.
--
-- The two now compute the same number. That is the point: an allowance a customer is shown and an
-- allowance they are held to must not be produced by two different pieces of arithmetic.

create or replace function public.check_meter_capacity(
  p_tenant_id uuid,
  p_meter_key text,
  p_qty integer default 1
)
returns table(allowed boolean, used integer, included integer, hard_cap boolean, pct_used numeric, reason text)
language plpgsql
as $function$
declare
  v_plan uuid;
  v_sub uuid;
  v_included integer;
  v_hard_cap boolean;
  v_used integer;
  v_grants integer;
  v_addons integer;
  v_period timestamptz;
begin
  if p_qty < 0 then raise exception 'meter quantity cannot be negative'; end if;

  v_plan := tenant_current_plan(p_tenant_id);
  v_period := tenant_current_period_start(p_tenant_id);

  select coalesce(ut.used_qty, 0) into v_used
    from usage_totals ut
   where ut.tenant_id = p_tenant_id and ut.meter_key = p_meter_key and ut.period_start = v_period;
  v_used := coalesce(v_used, 0);

  if v_plan is null then
    return query select true, v_used, null::integer, false, null::numeric, 'no_subscription'::text;
    return;
  end if;

  select case when pm.meter_key is not null then pm.included_qty else mp.default_included end,
         coalesce(pm.hard_cap, m.default_hard_cap, true)
    into v_included, v_hard_cap
    from meters m
    left join plan_meters pm on pm.plan_id = v_plan and pm.meter_key = m.meter_key
    left join meter_pricing mp on mp.meter_key = m.meter_key
   where m.meter_key = p_meter_key;

  if not found then
    return query select true, v_used, null::integer, false, null::numeric, 'not_metered'::text;
    return;
  end if;

  -- The subscription, for its attached add-ons. Detached ones are excluded, so removing an add-on
  -- removes its credits — the same rule resolve_tenant_entitlement applies.
  select s.id into v_sub
    from subscriptions s
   where s.tenant_id = p_tenant_id
     and s.status in ('trialing', 'active', 'past_due', 'cancelling')
   order by s.created_at desc
   limit 1;

  select coalesce(sum(am.included_qty), 0)::integer into v_addons
    from subscription_addons sa
    join addon_meters am on am.addon_id = sa.addon_id
   where sa.subscription_id = v_sub
     and sa.detached_at is null
     and am.meter_key = p_meter_key;

  select coalesce(sum(cg.quantity), 0)::integer into v_grants
    from credit_grants cg
   where cg.tenant_id = p_tenant_id and cg.meter_key = p_meter_key and cg.granted_at >= v_period;

  -- Null stays null: an explicitly unlimited allowance is not made finite by adding to it. This
  -- mirrors resolve_tenant_entitlement exactly, so the two cannot disagree.
  if v_included is not null then
    v_included := v_included + coalesce(v_addons, 0) + coalesce(v_grants, 0);
  end if;

  if v_included is null then
    return query select true, v_used, null::integer, coalesce(v_hard_cap, false), null::numeric, 'unlimited'::text;
    return;
  end if;

  if v_included = 0 then
    return query select (not coalesce(v_hard_cap, true)), v_used, v_included, v_hard_cap, 100::numeric, 'no_allowance'::text;
    return;
  end if;

  return query select
    case when v_hard_cap then (v_used + p_qty) <= v_included else true end,
    v_used,
    v_included,
    v_hard_cap,
    round((v_used::numeric / v_included) * 100, 1),
    case
      when v_hard_cap and (v_used + p_qty) > v_included then 'over_cap'
      when (v_used::numeric / v_included) >= 0.8 then 'near_cap'
      else 'ok'
    end::text;
end;
$function$;
