-- SA-4.9 hardening: a plan_meters row, including an explicit NULL (unlimited), always wins over
-- the platform default. This keeps SA-2.5's NULL-vs-missing distinction intact.

create or replace function public.resolve_tenant_entitlement(p_tenant_id uuid)
returns table(feature_keys text[], meter_allowances jsonb, max_seats integer, subscription_status subscription_status, plan_id uuid)
language plpgsql
as $$
declare v_sub record;
begin
  select s.id, s.plan_id, s.status into v_sub from subscriptions s
  where s.tenant_id = p_tenant_id and s.status <> 'cancelled'
  order by s.created_at desc limit 1;
  if not found then return query select array[]::text[], '{}'::jsonb, null::integer, null::subscription_status, null::uuid; return; end if;
  return query
  with plan_feats as (select pf.feature_key from plan_features pf where pf.plan_id = v_sub.plan_id),
  addon_feats as (select af.feature_key from subscription_addons sa join addon_features af on af.addon_id = sa.addon_id where sa.subscription_id = v_sub.id and sa.detached_at is null),
  all_feats as (select feature_key from plan_feats union select feature_key from addon_feats),
  base_meters as (
    select m.meter_key,
      case when pm.meter_key is not null then pm.included_qty else mp.default_included end as included_qty,
      coalesce(pm.hard_cap, m.default_hard_cap, true) as hard_cap
    from meters m left join plan_meters pm on pm.plan_id = v_sub.plan_id and pm.meter_key = m.meter_key
    left join meter_pricing mp on mp.meter_key = m.meter_key
  ),
  addon_meter_rows as (select am.meter_key, sum(am.included_qty)::integer as included_qty from subscription_addons sa join addon_meters am on am.addon_id = sa.addon_id where sa.subscription_id = v_sub.id and sa.detached_at is null group by am.meter_key),
  merged_meters as (select b.meter_key, case when b.included_qty is null then null else b.included_qty + coalesce(a.included_qty, 0) end as included_qty, b.hard_cap from base_meters b left join addon_meter_rows a on a.meter_key = b.meter_key),
  grant_rows as (select cg.meter_key, sum(cg.quantity)::integer as quantity from credit_grants cg where cg.tenant_id = p_tenant_id and cg.granted_at >= tenant_current_period_start(p_tenant_id) group by cg.meter_key),
  effective_meters as (select mm.meter_key, case when mm.included_qty is null then null else mm.included_qty + coalesce(gr.quantity, 0) end as included_qty, mm.hard_cap from merged_meters mm left join grant_rows gr on gr.meter_key = mm.meter_key)
  select coalesce((select array_agg(feature_key order by feature_key) from all_feats), array[]::text[]),
    coalesce((select jsonb_object_agg(meter_key, jsonb_build_object('included', included_qty, 'hard_cap', hard_cap)) from effective_meters), '{}'::jsonb),
    (select pl.max_seats from plan_limits pl where pl.plan_id = v_sub.plan_id), v_sub.status, v_sub.plan_id;
end;
$$;

create or replace function public.check_meter_capacity(p_tenant_id uuid, p_meter_key text, p_qty integer default 1)
returns table(allowed boolean, used integer, included integer, hard_cap boolean, pct_used numeric, reason text)
language plpgsql
as $$
declare v_plan uuid; v_included integer; v_hard_cap boolean; v_used integer; v_grants integer; v_period timestamptz;
begin
  if p_qty < 0 then raise exception 'meter quantity cannot be negative'; end if;
  v_plan := tenant_current_plan(p_tenant_id); v_period := tenant_current_period_start(p_tenant_id);
  select coalesce(ut.used_qty, 0) into v_used from usage_totals ut where ut.tenant_id = p_tenant_id and ut.meter_key = p_meter_key and ut.period_start = v_period;
  v_used := coalesce(v_used, 0);
  if v_plan is null then return query select true, v_used, null::integer, false, null::numeric, 'no_subscription'::text; return; end if;
  select case when pm.meter_key is not null then pm.included_qty else mp.default_included end, coalesce(pm.hard_cap, m.default_hard_cap, true) into v_included, v_hard_cap
  from meters m left join plan_meters pm on pm.plan_id = v_plan and pm.meter_key = m.meter_key left join meter_pricing mp on mp.meter_key = m.meter_key where m.meter_key = p_meter_key;
  if not found then return query select true, v_used, null::integer, false, null::numeric, 'not_metered'::text; return; end if;
  select coalesce(sum(cg.quantity), 0)::integer into v_grants from credit_grants cg where cg.tenant_id = p_tenant_id and cg.meter_key = p_meter_key and cg.granted_at >= v_period;
  if v_included is not null then v_included := v_included + coalesce(v_grants, 0); end if;
  if v_included is null then return query select true, v_used, null::integer, coalesce(v_hard_cap, false), null::numeric, 'unlimited'::text; return; end if;
  if v_included = 0 then return query select (not coalesce(v_hard_cap, true)), v_used, v_included, v_hard_cap, 100::numeric, 'no_allowance'::text; return; end if;
  return query select case when v_hard_cap then (v_used + p_qty) <= v_included else true end, v_used, v_included, v_hard_cap, round((v_used::numeric / v_included) * 100, 1), case when v_hard_cap and (v_used + p_qty) > v_included then 'over_cap' when (v_used::numeric / v_included) >= 0.8 then 'near_cap' else 'ok' end::text;
end;
$$;

create or replace function public.admin_usage_monitor(p_over_80 boolean default false)
returns table(tenant_id uuid, tenant_name text, tenant_status text, meter_key text, meter_label text, unit text, used_qty integer, included_qty integer, grant_qty integer, plan_included_qty integer, hard_cap boolean, percent_used numeric, alert_level text, period_start timestamptz)
language sql security definer set search_path = public
as $$
with tenant_periods as (select t.id, t.name, t.status::text, tenant_current_period_start(t.id) as period_start, tenant_current_plan(t.id) as plan_id from tenants t),
grid as (select tp.id, tp.name, tp.status, tp.period_start, tp.plan_id, m.meter_key, m.label, m.unit, m.default_hard_cap from tenant_periods tp cross join meters m),
monitor_values as (select g.*, pm.included_qty as plan_included, case when pm.meter_key is not null then pm.included_qty else mp.default_included end as base_included, coalesce(pm.hard_cap, g.default_hard_cap, true) as hard_cap, coalesce(gr.quantity, 0)::integer as grant_qty, coalesce(ut.used_qty, 0)::integer as used_qty from grid g left join plan_meters pm on pm.plan_id = g.plan_id and pm.meter_key = g.meter_key left join meter_pricing mp on mp.meter_key = g.meter_key left join lateral (select sum(cg.quantity)::integer as quantity from credit_grants cg where cg.tenant_id = g.id and cg.meter_key = g.meter_key and g.period_start is not null and cg.granted_at >= g.period_start) gr on true left join usage_totals ut on ut.tenant_id = g.id and ut.meter_key = g.meter_key and ut.period_start = g.period_start),
calculated as (select v.*, case when v.base_included is null then null::integer else v.base_included + v.grant_qty end as effective_included from monitor_values v)
select c.id, c.name, c.status, c.meter_key, c.label, c.unit, c.used_qty, c.effective_included, c.grant_qty, c.plan_included, c.hard_cap, case when c.effective_included is null or c.effective_included = 0 then null::numeric else round((c.used_qty::numeric / c.effective_included) * 100, 1) end, case when c.effective_included is not null and c.effective_included > 0 and c.used_qty >= c.effective_included then 'exhausted' when c.effective_included is not null and c.effective_included > 0 and c.used_qty >= c.effective_included * 0.8 then 'warning' else 'ok' end, c.period_start from calculated c where not p_over_80 or (c.effective_included is not null and c.effective_included > 0 and c.used_qty::numeric / c.effective_included >= 0.8) order by case when c.effective_included is null or c.effective_included = 0 then -1 else c.used_qty::numeric / c.effective_included end desc, c.name, c.meter_key;
$$;

revoke all on function public.admin_usage_monitor(boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_usage_monitor(boolean) to service_role;
