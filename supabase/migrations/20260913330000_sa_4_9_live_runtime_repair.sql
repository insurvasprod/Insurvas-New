-- SA-4.9 live-runtime repair.
--
-- The shared project currently contains a compatibility placeholder for
-- admin_usage_monitor_json and an older refresh_tenant_entitlement function that does not
-- include period credit grants. Keep this migration additive and reversible by replacing only
-- the two narrowly scoped functions. No records are changed by this migration.

create or replace function public.admin_usage_monitor_json(p_over_80 boolean default false)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
with tenant_periods as (
  select t.id, t.name, t.status::text, public.tenant_current_period_start(t.id) as period_start,
    public.tenant_current_plan(t.id) as plan_id
  from public.tenants t
),
grid as (
  select tp.id, tp.name, tp.status, tp.period_start, tp.plan_id,
    m.meter_key, m.label, m.unit, m.default_hard_cap
  from tenant_periods tp cross join public.meters m
),
grant_totals as (
  select g.id as tenant_id, g.meter_key, coalesce(sum(cg.quantity), 0)::integer as grant_qty
  from grid g
  left join public.credit_grants cg
    on cg.tenant_id = g.id
    and cg.meter_key = g.meter_key
    and g.period_start is not null
    and cg.granted_at >= g.period_start
  group by g.id, g.meter_key
),
calculated as (
  select g.id, g.name, g.status, g.meter_key, g.label, g.unit,
    coalesce(ut.used_qty, 0)::integer as used_qty,
    case when pm.meter_key is not null then pm.included_qty else mp.default_included end as base_included,
    coalesce(gt.grant_qty, 0)::integer as grant_qty,
    pm.included_qty as plan_included,
    coalesce(pm.hard_cap, g.default_hard_cap, true) as hard_cap,
    g.period_start
  from grid g
  left join public.plan_meters pm on pm.plan_id = g.plan_id and pm.meter_key = g.meter_key
  left join public.meter_pricing mp on mp.meter_key = g.meter_key
  left join grant_totals gt on gt.tenant_id = g.id and gt.meter_key = g.meter_key
  left join public.usage_totals ut on ut.tenant_id = g.id and ut.meter_key = g.meter_key and ut.period_start = g.period_start
),
rows as (
  select c.id as tenant_id, c.name as tenant_name, c.status as tenant_status, c.meter_key,
    c.label as meter_label, c.unit, c.used_qty,
    case when c.base_included is null then null::integer else c.base_included + c.grant_qty end as included_qty,
    c.grant_qty, c.plan_included as plan_included_qty, c.hard_cap,
    case when c.base_included is null or c.base_included + c.grant_qty = 0 then null::numeric
      else round((c.used_qty::numeric / (c.base_included + c.grant_qty)) * 100, 1) end as percent_used,
    case when c.base_included is not null and c.base_included + c.grant_qty > 0 and c.used_qty >= c.base_included + c.grant_qty then 'exhausted'
      when c.base_included is not null and c.base_included + c.grant_qty > 0 and c.used_qty >= (c.base_included + c.grant_qty) * 0.8 then 'warning'
      else 'ok' end as alert_level,
    c.period_start
  from calculated c
  where not p_over_80 or (c.base_included is not null and c.base_included + c.grant_qty > 0 and c.used_qty::numeric / (c.base_included + c.grant_qty) >= 0.8)
)
select coalesce(jsonb_agg(to_jsonb(rows) order by
  case when rows.included_qty is null or rows.included_qty = 0 then -1 else rows.used_qty::numeric / rows.included_qty end desc,
  rows.tenant_name, rows.meter_key), '[]'::jsonb)
from rows;
$$;

revoke all on function public.admin_usage_monitor_json(boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_usage_monitor_json(boolean) to service_role;

create or replace function public.refresh_tenant_entitlement(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_limits public.plan_limits%rowtype;
  v_features jsonb;
  v_meters jsonb;
  v_status text;
  v_access text;
  v_entitlement jsonb;
begin
  select s.* into v_sub
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
   order by (s.status <> 'cancelled') desc, s.started_at desc
   limit 1;

  if v_sub.id is null then
    v_entitlement := public.la0_default_entitlement(p_tenant_id);
    if v_entitlement is null then
      raise exception 'tenant_not_found' using errcode = 'no_data_found';
    end if;
  else
    select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;
    if v_plan.id is null then
      raise exception 'plan_not_found for subscription %', v_sub.id using errcode = 'foreign_key_violation';
    end if;

    select l.* into v_limits from public.plan_limits l where l.plan_id = v_plan.id;
    v_status := v_sub.status::text;
    v_access := public.entitlement_access_for_status(v_status);

    if v_status = 'cancelled' then
      v_features := '[]'::jsonb;
      v_meters := '{}'::jsonb;
    else
      select coalesce(jsonb_agg(feature_key order by feature_key), '[]'::jsonb)
        into v_features
        from (
          select pf.feature_key from public.plan_features pf where pf.plan_id = v_plan.id
          union
          select af.feature_key
            from public.subscription_addons sa
            join public.addon_features af on af.addon_id = sa.addon_id
           where sa.subscription_id = v_sub.id and sa.detached_at is null
        ) granted;

      with plan_m as (
        select pm.meter_key, pm.included_qty, pm.hard_cap
          from public.plan_meters pm where pm.plan_id = v_plan.id
      ), addon_m as (
        select am.meter_key, sum(am.included_qty)::integer as qty
          from public.subscription_addons sa
          join public.addon_meters am on am.addon_id = sa.addon_id
         where sa.subscription_id = v_sub.id and sa.detached_at is null
         group by am.meter_key
      ), merged as (
        select coalesce(p.meter_key, a.meter_key) as meter_key,
          case when p.meter_key is not null and p.included_qty is null then null
            else coalesce(p.included_qty, 0) + coalesce(a.qty, 0) end as included_qty,
          coalesce(p.hard_cap, m.default_hard_cap, true) as hard_cap
        from plan_m p
        full join addon_m a on a.meter_key = p.meter_key
        left join public.meters m on m.meter_key = coalesce(p.meter_key, a.meter_key)
      ), grants as (
        select cg.meter_key, sum(cg.quantity)::integer as qty
          from public.credit_grants cg
         where cg.tenant_id = p_tenant_id and cg.granted_at >= v_sub.current_period_start
         group by cg.meter_key
      )
      select coalesce(jsonb_object_agg(merged.meter_key, jsonb_build_object(
        'included', case when merged.included_qty is null then null else merged.included_qty + coalesce(grants.qty, 0) end,
        'hard_cap', merged.hard_cap,
        'used', coalesce(t.used_qty, 0)
      )), '{}'::jsonb)
        into v_meters
        from merged
        left join grants on grants.meter_key = merged.meter_key
        left join public.usage_totals t
          on t.tenant_id = p_tenant_id
         and t.meter_key = merged.meter_key
         and t.period_start = v_sub.current_period_start;
    end if;

    v_entitlement := jsonb_build_object(
      'tenant_id', p_tenant_id,
      'plan_code', v_plan.code,
      'plan_version', v_plan.version,
      'status', v_status,
      'access', v_access,
      'computed_at', now(),
      'features', v_features,
      'meters', v_meters,
      'limits', jsonb_build_object(
        'max_seats', coalesce(v_limits.max_seats, case when v_plan.plan_type = 'individual' then 1 else null end),
        'max_publishers', v_limits.max_publishers,
        'max_marketing_partners', v_limits.max_marketing_partners,
        'max_affiliates', v_limits.max_affiliates,
        'max_buffer_seats', v_limits.max_buffer_seats,
        'max_partner_users', v_limits.max_partner_users
      ),
      'period_start', v_sub.current_period_start
    );
  end if;

  insert into public.tenant_entitlements (tenant_id, entitlement, computed_at, version)
  values (p_tenant_id, v_entitlement, now(), 1)
  on conflict (tenant_id) do update
    set entitlement = excluded.entitlement,
        computed_at = excluded.computed_at,
        version = public.tenant_entitlements.version + 1;
  return v_entitlement;
end;
$$;

revoke all on function public.refresh_tenant_entitlement(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_tenant_entitlement(uuid) to service_role;
