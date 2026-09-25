-- SA-4.9: return the complete usage monitor in one bounded JSON value. The
-- previous set-returning RPC was invoked once per PostgREST page and repeated
-- the full tenant x meter calculation for every 1,000-row page.
create or replace function public.admin_usage_monitor_json(p_over_80 boolean default false)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
with tenant_periods as (
  select t.id, t.name, t.status::text, tenant_current_period_start(t.id) as period_start,
    tenant_current_plan(t.id) as plan_id
  from tenants t
),
grid as (
  select tp.id, tp.name, tp.status, tp.period_start, tp.plan_id,
    m.meter_key, m.label, m.unit, m.default_hard_cap
  from tenant_periods tp cross join meters m
),
grant_totals as (
  select g.id as tenant_id, g.meter_key, coalesce(sum(cg.quantity), 0)::integer as grant_qty
  from grid g
  left join credit_grants cg
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
  left join plan_meters pm on pm.plan_id = g.plan_id and pm.meter_key = g.meter_key
  left join meter_pricing mp on mp.meter_key = g.meter_key
  left join grant_totals gt on gt.tenant_id = g.id and gt.meter_key = g.meter_key
  left join usage_totals ut on ut.tenant_id = g.id and ut.meter_key = g.meter_key and ut.period_start = g.period_start
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
select coalesce(jsonb_agg(to_jsonb(rows) order by case when rows.included_qty is null or rows.included_qty = 0 then -1 else rows.used_qty::numeric / rows.included_qty end desc, rows.tenant_name, rows.meter_key), '[]'::jsonb)
from rows;
$$;

revoke all on function public.admin_usage_monitor_json(boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_usage_monitor_json(boolean) to service_role;
