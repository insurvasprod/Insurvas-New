-- SA-2.6 repair: keep live entitlement resolution and meter enforcement in agreement.
--
-- The later SA-2.8 refresh migration replaced the earlier source-of-truth resolver, and the
-- SA-2.5 capacity function did not include subscription add-ons. That left an attached meter
-- credit visible in one path but unenforced in another. This additive repair restores one
-- calculation for plan defaults, add-on credits, and tenant credit grants.

create or replace function public.resolve_tenant_entitlement(p_tenant_id uuid)
returns table(
  feature_keys text[],
  max_seats integer,
  meter_allowances jsonb,
  plan_id uuid,
  subscription_status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_sub record;
begin
  select s.id, s.plan_id, s.status, s.created_at
    into v_sub
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
     and s.status <> 'cancelled'
   order by s.created_at desc
   limit 1;

  if not found then
    return query
      select array[]::text[], null::integer, '{}'::jsonb, null::uuid, null::text;
    return;
  end if;

  return query
  with plan_feats as (
    select pf.feature_key
      from public.plan_features pf
     where pf.plan_id = v_sub.plan_id
  ),
  addon_feats as (
    select af.feature_key
      from public.subscription_addons sa
      join public.addon_features af on af.addon_id = sa.addon_id
     where sa.subscription_id = v_sub.id
       and sa.detached_at is null
  ),
  all_feats as (
    select feature_key from plan_feats
    union
    select feature_key from addon_feats
  ),
  base_meters as (
    select m.meter_key,
           case
             when pm.meter_key is not null then pm.included_qty
             else mp.default_included
           end as included_qty,
           coalesce(pm.hard_cap, m.default_hard_cap, true) as hard_cap
      from public.meters m
      left join public.plan_meters pm
        on pm.plan_id = v_sub.plan_id
       and pm.meter_key = m.meter_key
      left join public.meter_pricing mp on mp.meter_key = m.meter_key
  ),
  addon_meter_rows as (
    select am.meter_key, sum(am.included_qty)::integer as included_qty
      from public.subscription_addons sa
      join public.addon_meters am on am.addon_id = sa.addon_id
     where sa.subscription_id = v_sub.id
       and sa.detached_at is null
     group by am.meter_key
  ),
  merged_meters as (
    select b.meter_key,
           case
             when b.included_qty is null then null
             else b.included_qty + coalesce(a.included_qty, 0)
           end as included_qty,
           b.hard_cap
      from base_meters b
      left join addon_meter_rows a on a.meter_key = b.meter_key
  ),
  grant_rows as (
    select cg.meter_key, sum(cg.quantity)::integer as quantity
      from public.credit_grants cg
     where cg.tenant_id = p_tenant_id
       and cg.granted_at >= public.tenant_current_period_start(p_tenant_id)
     group by cg.meter_key
  ),
  effective_meters as (
    select mm.meter_key,
           case
             when mm.included_qty is null then null
             else mm.included_qty + coalesce(gr.quantity, 0)
           end as included_qty,
           mm.hard_cap
      from merged_meters mm
      left join grant_rows gr on gr.meter_key = mm.meter_key
  )
  select
    coalesce((select array_agg(feature_key order by feature_key) from all_feats), array[]::text[]),
    coalesce(
      (select pl.max_seats
         from public.plan_limits pl
        where pl.plan_id = v_sub.plan_id),
      case when exists (
        select 1 from public.plans p
         where p.id = v_sub.plan_id and p.plan_type = 'individual'
      ) then 1 else null end
    ),
    coalesce((select jsonb_object_agg(
      meter_key,
      jsonb_build_object('included', included_qty, 'hard_cap', hard_cap)
    ) from effective_meters), '{}'::jsonb),
    v_sub.plan_id,
    v_sub.status::text;
end;
$$;

comment on function public.resolve_tenant_entitlement(uuid) is
  'SA-2.6 repair: resolves plan features, add-on features, plan meter defaults, add-on credits, '
  'and tenant grants from live source records; the result is also used by meter QA.';

create or replace function public.check_meter_capacity(
  p_tenant_id uuid,
  p_meter_key text,
  p_qty integer default 1
)
returns table(
  allowed boolean,
  used integer,
  included integer,
  hard_cap boolean,
  pct_used numeric,
  reason text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_subscription_id uuid;
  v_period timestamptz;
  v_used integer := 0;
  v_included integer;
  v_hard_cap boolean;
  v_addon_qty integer := 0;
  v_grant_qty integer := 0;
begin
  if p_qty < 0 then
    raise exception 'meter quantity cannot be negative' using errcode = 'invalid_parameter_value';
  end if;

  v_plan_id := public.tenant_current_plan(p_tenant_id);
  v_period := public.tenant_current_period_start(p_tenant_id);

  select coalesce(ut.used_qty, 0)
    into v_used
    from public.usage_totals ut
   where ut.tenant_id = p_tenant_id
     and ut.meter_key = p_meter_key
     and ut.period_start = v_period;

  if v_plan_id is null then
    return query select true, coalesce(v_used, 0), null::integer, false, null::numeric, 'no_subscription'::text;
    return;
  end if;

  select case
           when pm.meter_key is not null then pm.included_qty
           else mp.default_included
         end,
         coalesce(pm.hard_cap, m.default_hard_cap, true)
    into v_included, v_hard_cap
    from public.meters m
    left join public.plan_meters pm
      on pm.plan_id = v_plan_id
     and pm.meter_key = m.meter_key
    left join public.meter_pricing mp on mp.meter_key = m.meter_key
   where m.meter_key = p_meter_key;

  if not found then
    return query select true, coalesce(v_used, 0), null::integer, false, null::numeric, 'not_metered'::text;
    return;
  end if;

  select s.id
    into v_subscription_id
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
     and s.status in ('trialing', 'active', 'past_due', 'cancelling')
   order by s.created_at desc
   limit 1;

  select coalesce(sum(am.included_qty), 0)::integer
    into v_addon_qty
    from public.subscription_addons sa
    join public.addon_meters am on am.addon_id = sa.addon_id
   where sa.subscription_id = v_subscription_id
     and sa.detached_at is null
     and am.meter_key = p_meter_key;

  select coalesce(sum(cg.quantity), 0)::integer
    into v_grant_qty
    from public.credit_grants cg
   where cg.tenant_id = p_tenant_id
     and cg.meter_key = p_meter_key
     and cg.granted_at >= v_period;

  -- An explicit unlimited plan allowance remains unlimited. Add-ons and grants cannot turn an
  -- unlimited source into a finite cap.
  if v_included is not null then
    v_included := v_included + coalesce(v_addon_qty, 0) + coalesce(v_grant_qty, 0);
  end if;

  if v_included is null then
    return query select true, coalesce(v_used, 0), null::integer, coalesce(v_hard_cap, false), null::numeric, 'unlimited'::text;
    return;
  end if;

  if v_included = 0 then
    return query select (not coalesce(v_hard_cap, true)), coalesce(v_used, 0), 0, v_hard_cap, 100::numeric, 'no_allowance'::text;
    return;
  end if;

  return query
    select
      case when v_hard_cap then (coalesce(v_used, 0) + p_qty) <= v_included else true end,
      coalesce(v_used, 0),
      v_included,
      v_hard_cap,
      round((coalesce(v_used, 0)::numeric / v_included) * 100, 1),
      case
        when v_hard_cap and (coalesce(v_used, 0) + p_qty) > v_included then 'over_cap'
        when (coalesce(v_used, 0)::numeric / v_included) >= 0.8 then 'near_cap'
        else 'ok'
      end::text;
end;
$$;

comment on function public.check_meter_capacity(uuid, text, integer) is
  'SA-2.5/SA-2.6 repair: enforces the same plan, add-on, and tenant-grant allowance used by '
  'resolve_tenant_entitlement; detached add-ons no longer contribute credits.';

revoke all on function public.resolve_tenant_entitlement(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.check_meter_capacity(uuid, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.resolve_tenant_entitlement(uuid) to service_role;
grant execute on function public.check_meter_capacity(uuid, text, integer) to service_role;
