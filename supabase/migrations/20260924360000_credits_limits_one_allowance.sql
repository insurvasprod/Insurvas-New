-- Credits & limits · one definition of a tenant's allowance.
--
-- Before this, three readers disagreed about how much of a meter a tenant may use:
--
--                                      plan row   platform default   add-on credits   grants
--   check_meter_capacity (enforcement)   yes          yes                 yes           yes
--   refresh_tenant_entitlement (cache)   yes          NO                  yes           yes
--   admin_usage_monitor_json (admin)     yes          yes                 NO            yes
--
-- So a tenant who had bought an add-on could show as exhausted on the staff monitor while enforcement
-- still let them work, and a meter the plan leaves to the platform default was enforced at that
-- default while the agent's own usage panel (the cache) said nothing about it. This migration brings
-- the two readers into line with enforcement, which is unchanged:
--
--   1. meter_pricing gets a row for every meter. SA-4.9 seeded it from the meters that existed then;
--      the LA-2.22 meters (monthly_leads_imported, consent_cert_claims) never had one, so their
--      platform default could not be set. Rows are added as unpriced with no default (= unlimited,
--      today's behaviour); nothing existing changes.
--   2. admin_usage_monitor_json is restated from 20260913330000 with:
--        - the subscription picks and grant window of check_meter_capacity (20260912500000): plan and
--          period from tenant_current_plan / tenant_current_period_start, add-on credits from the
--          newest trialing|active|past_due|cancelling subscription, grants since the period start;
--        - add-on credits in the allowance (and a new `addon_qty` key; every existing key is kept);
--        - the warn threshold from settings `usage.warn_percent` (default 80, clamped 1–99) instead
--          of a hard-coded 0.8;
--        - the board's row-state rule: 'over' strictly past the limit, 'warning' at or above the
--          threshold including exactly at the limit, else 'ok' ('exhausted' is retired);
--        - only rows with a finite limit, and not 0-of-0 rows (user decision: unlimited rows are left
--          out of the monitor);
--        - nearest the limit first.
--      Signature and return type are unchanged, so create or replace is safe.
--   3. refresh_tenant_entitlement is restated from its latest definition, 20260924344000 (tenant
--      feature overrides), changing ONLY the meter block: a meter the plan does not set now takes
--      meter_pricing.default_included, exactly as check_meter_capacity resolves it. A meter with
--      neither a plan row nor a platform default stays out of the snapshot, as before (every reader
--      treats absent as unlimited). Overrides, disabled_features, credit grants, limits and the
--      credit_grants_included flag are carried over verbatim and asserted below.
--
-- admin_usage_monitor (the table-returning sibling that period billing reads for overage) is NOT
-- touched here: it also leaves add-on credits out, but it decides what customers are invoiced, and
-- that is a billing decision, not this screen's.

-- --------------------------------------------------------------------------
-- 1. A pricing row for every meter
-- --------------------------------------------------------------------------

insert into public.meter_pricing (meter_key, cost_cents, sell_cents, default_included)
select m.meter_key, 0, 0, null
  from public.meters m
on conflict (meter_key) do nothing;

-- --------------------------------------------------------------------------
-- 2. The staff usage monitor
-- --------------------------------------------------------------------------

create or replace function public.admin_usage_monitor_json(p_over_80 boolean default false)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
with warn as (
  -- usage.warn_percent, the same setting lib/settings meterWarnThreshold() reads. A missing row or a
  -- non-number falls back to the coded default of 80.
  select coalesce(
    (select case when jsonb_typeof(s.value) = 'number'
                 then least(greatest((s.value #>> '{}')::numeric, 1), 99) end
       from public.settings s
      where s.key = 'usage.warn_percent'),
    80
  ) / 100.0 as fraction
),
tenant_periods as (
  select t.id, t.name, t.status::text as status,
    public.tenant_current_period_start(t.id) as period_start,
    public.tenant_current_plan(t.id) as plan_id,
    (select s.id
       from public.subscriptions s
      where s.tenant_id = t.id
        and s.status in ('trialing', 'active', 'past_due', 'cancelling')
      order by s.created_at desc
      limit 1) as addon_subscription_id
  from public.tenants t
),
grid as (
  -- No plan means check_meter_capacity answers 'no_subscription' (unlimited), so there is no finite
  -- limit to watch.
  select tp.id, tp.name, tp.status, tp.period_start, tp.plan_id, tp.addon_subscription_id,
    m.meter_key, m.label, m.unit, m.default_hard_cap
  from tenant_periods tp
  cross join public.meters m
  where tp.plan_id is not null
),
addon_totals as (
  select g.id as tenant_id, g.meter_key, sum(am.included_qty)::integer as addon_qty
  from grid g
  join public.subscription_addons sa on sa.subscription_id = g.addon_subscription_id and sa.detached_at is null
  join public.addon_meters am on am.addon_id = sa.addon_id and am.meter_key = g.meter_key
  group by g.id, g.meter_key
),
grant_totals as (
  select g.id as tenant_id, g.meter_key, sum(cg.quantity)::integer as grant_qty
  from grid g
  join public.credit_grants cg
    on cg.tenant_id = g.id
   and cg.meter_key = g.meter_key
   and cg.granted_at >= g.period_start
  group by g.id, g.meter_key
),
calculated as (
  select g.id, g.name, g.status, g.meter_key, g.label, g.unit, g.period_start,
    coalesce(ut.used_qty, 0)::integer as used_qty,
    case when pm.meter_key is not null then pm.included_qty else mp.default_included end as base_included,
    coalesce(ad.addon_qty, 0)::integer as addon_qty,
    coalesce(gt.grant_qty, 0)::integer as grant_qty,
    pm.included_qty as plan_included,
    coalesce(pm.hard_cap, g.default_hard_cap, true) as hard_cap
  from grid g
  left join public.plan_meters pm on pm.plan_id = g.plan_id and pm.meter_key = g.meter_key
  left join public.meter_pricing mp on mp.meter_key = g.meter_key
  left join addon_totals ad on ad.tenant_id = g.id and ad.meter_key = g.meter_key
  left join grant_totals gt on gt.tenant_id = g.id and gt.meter_key = g.meter_key
  left join public.usage_totals ut on ut.tenant_id = g.id and ut.meter_key = g.meter_key and ut.period_start = g.period_start
),
effective as (
  -- An unlimited source stays unlimited: add-ons and grants cannot turn it into a finite cap.
  select c.*,
    case when c.base_included is null then null::integer
         else c.base_included + c.addon_qty + c.grant_qty end as included_qty
  from calculated c
),
rows as (
  select e.id as tenant_id, e.name as tenant_name, e.status as tenant_status, e.meter_key,
    e.label as meter_label, e.unit, e.used_qty, e.included_qty, e.grant_qty, e.addon_qty,
    e.plan_included as plan_included_qty, e.hard_cap,
    case when e.included_qty = 0 then null::numeric
         else round((e.used_qty::numeric / e.included_qty) * 100, 1) end as percent_used,
    case when e.used_qty > e.included_qty then 'over'
         when e.included_qty > 0 and e.used_qty >= e.included_qty * (select fraction from warn) then 'warning'
         else 'ok' end as alert_level,
    e.period_start,
    case when e.included_qty = 0 then 1e12 else e.used_qty::numeric / e.included_qty end as proximity
  from effective e
  where e.included_qty is not null
    and not (e.included_qty = 0 and e.used_qty = 0)
)
select coalesce(jsonb_agg(to_jsonb(rows) - 'proximity' order by rows.proximity desc, rows.tenant_name, rows.meter_key), '[]'::jsonb)
from rows
where not p_over_80 or rows.alert_level <> 'ok';
$$;

comment on function public.admin_usage_monitor_json(boolean) is
  'Staff usage monitor: every tenant x meter with a finite limit, the allowance resolved exactly as '
  'check_meter_capacity does (plan row or platform default, plus add-on credits, plus period grants), '
  'alert_level over|warning|ok against usage.warn_percent, nearest the limit first. p_over_80 keeps '
  'rows at or above the threshold. 20260924360000.';

revoke all on function public.admin_usage_monitor_json(boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_usage_monitor_json(boolean) to service_role;

-- --------------------------------------------------------------------------
-- 3. The engine, restated from 20260924344000 with the platform default in the meter block
-- --------------------------------------------------------------------------

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
  v_granted text[];
  v_disabled jsonb;
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
      select coalesce(jsonb_agg(granted.feature_key order by granted.feature_key), '[]'::jsonb)
        into v_features
        from unnest(public.plan_and_addon_feature_keys(v_plan.id, v_sub.id)) as granted(feature_key);

      -- 20260924360000: the plan's own row wins; a meter the plan does not set takes the platform
      -- default (meter_pricing.default_included), as check_meter_capacity does. A meter with neither
      -- stays out of the snapshot (absent = unlimited to every reader), as before.
      with plan_m as (
        select m.meter_key,
          case when pm.meter_key is not null then pm.included_qty else mp.default_included end as included_qty,
          pm.hard_cap
          from public.meters m
          left join public.plan_meters pm on pm.plan_id = v_plan.id and pm.meter_key = m.meter_key
          left join public.meter_pricing mp on mp.meter_key = m.meter_key
         where pm.meter_key is not null or mp.default_included is not null
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
        'max_partner_users', v_limits.max_partner_users,
        'max_setter_seats', v_limits.max_setter_seats,
        'max_active_campaigns', v_limits.max_active_campaigns
      ),
      'period_start', v_sub.current_period_start,
      'credit_grants_included', true
    );
  end if;

  -- Per-tenant overrides. Never applied to a cancelled tenant: cancelled means nothing is granted,
  -- and an "on" override must not quietly reopen an account that has ended.
  if coalesce(v_entitlement->>'status', '') <> 'cancelled' then
    v_granted := array(select jsonb_array_elements_text(coalesce(v_entitlement->'features', '[]'::jsonb)));

    -- Granted by the plan (or the LA-0 default) and switched off for this tenant. Kept apart from
    -- "not granted" so the agent app says "not available on your account", not "upgrade".
    select coalesce(jsonb_agg(o.feature_key order by o.feature_key), '[]'::jsonb)
      into v_disabled
      from public.tenant_feature_overrides o
     where o.tenant_id = p_tenant_id
       and o.state = 'off'
       and o.feature_key = any(v_granted);

    select coalesce(jsonb_agg(effective.feature_key order by effective.feature_key), '[]'::jsonb)
      into v_features
      from (
        select g.feature_key
          from unnest(v_granted) as g(feature_key)
         where not exists (
           select 1 from public.tenant_feature_overrides o
            where o.tenant_id = p_tenant_id and o.feature_key = g.feature_key and o.state = 'off'
         )
        union
        select o.feature_key
          from public.tenant_feature_overrides o
         where o.tenant_id = p_tenant_id and o.state = 'on'
      ) effective;

    v_entitlement := v_entitlement || jsonb_build_object('features', v_features, 'disabled_features', v_disabled);
  else
    v_entitlement := v_entitlement || jsonb_build_object('disabled_features', '[]'::jsonb);
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

comment on function public.refresh_tenant_entitlement(uuid) is
  'Recomputes and caches one tenant''s entitlement: plan + attached add-on features, then per-tenant '
  'overrides (tenant_feature_overrides; off ones listed in disabled_features), plan meters (or the '
  'platform default in meter_pricing.default_included where the plan sets none, as check_meter_capacity) '
  '+ add-on credits + credit grants, plan limits. Falls back to la0_default_entitlement() with no '
  'subscription. The platform kill switch is applied on top of this at every enforcement point, not here.';

revoke all on function public.refresh_tenant_entitlement(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_tenant_entitlement(uuid) to service_role;

-- --------------------------------------------------------------------------
-- Assertions
-- --------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_marker text;
  v_monitor jsonb;
  v_key text;
  v_tenant uuid;
  v_meter text;
  v_result jsonb;
  v_cached integer;
  v_enforced integer;
  v_monitored integer;
  v_row jsonb;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924360000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- 1 ---------------------------------------------------------------------------------------------
  if exists (select 1 from public.meters m where not exists (select 1 from public.meter_pricing mp where mp.meter_key = m.meter_key)) then
    raise exception 'a meter still has no meter_pricing row';
  end if;

  -- Privileges: service role only, for both functions.
  if has_function_privilege('tenant_app', 'public.admin_usage_monitor_json(boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_usage_monitor_json(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_usage_monitor_json(boolean)', 'execute')
     or has_function_privilege('tenant_app', 'public.refresh_tenant_entitlement(uuid)', 'execute') then
    raise exception 'the usage monitor or the entitlement engine is executable outside the service role';
  end if;
  if not has_function_privilege('service_role', 'public.admin_usage_monitor_json(boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.refresh_tenant_entitlement(uuid)', 'execute') then
    raise exception 'service_role cannot execute the usage monitor or the entitlement engine';
  end if;

  -- 2 ---------------------------------------------------------------------------------------------
  select pg_get_functiondef('public.admin_usage_monitor_json(boolean)'::regprocedure) into v_def;
  foreach v_marker in array array['addon_meters', 'usage.warn_percent', 'tenant_current_plan', 'tenant_current_period_start',
                                  'cancelling', 'meter_pricing', 'credit_grants'] loop
    if position(v_marker in v_def) = 0 then
      raise exception 'admin_usage_monitor_json does not read %', v_marker;
    end if;
  end loop;

  v_monitor := public.admin_usage_monitor_json(false);
  if jsonb_typeof(v_monitor) <> 'array' then
    raise exception 'admin_usage_monitor_json no longer returns an array';
  end if;
  if jsonb_array_length(v_monitor) > 0 then
    -- Every key scripts/verify-credits-limits.mjs and lib/creditsLimits read, plus the new addon_qty.
    foreach v_key in array array['tenant_id', 'tenant_name', 'tenant_status', 'meter_key', 'meter_label', 'unit',
                                 'used_qty', 'included_qty', 'grant_qty', 'addon_qty', 'plan_included_qty',
                                 'hard_cap', 'percent_used', 'alert_level', 'period_start'] loop
      if not ((v_monitor->0) ? v_key) then
        raise exception 'admin_usage_monitor_json rows lost the % key', v_key;
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(v_monitor) r where r->'included_qty' = 'null'::jsonb) then
      raise exception 'admin_usage_monitor_json returned an unlimited row';
    end if;
    if exists (select 1 from jsonb_array_elements(v_monitor) r where r->>'alert_level' not in ('over', 'warning', 'ok')) then
      raise exception 'admin_usage_monitor_json returned an alert level outside over|warning|ok';
    end if;
  end if;
  if exists (select 1 from jsonb_array_elements(public.admin_usage_monitor_json(true)) r where r->>'alert_level' = 'ok') then
    raise exception 'the over-threshold filter let an ok row through';
  end if;

  -- The monitor agrees with enforcement wherever an add-on contributes (read-only).
  for v_row in
    select r from jsonb_array_elements(v_monitor) r where (r->>'addon_qty')::integer > 0 limit 20
  loop
    select c.included into v_enforced
      from public.check_meter_capacity((v_row->>'tenant_id')::uuid, v_row->>'meter_key', 0) c;
    if v_enforced is distinct from (v_row->>'included_qty')::integer then
      raise exception 'monitor says % for tenant % meter %, enforcement says %',
        v_row->>'included_qty', v_row->>'tenant_id', v_row->>'meter_key', v_enforced;
    end if;
  end loop;

  -- 3 ---------------------------------------------------------------------------------------------
  select pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure) into v_def;
  foreach v_marker in array array['tenant_feature_overrides', 'disabled_features', 'plan_and_addon_feature_keys',
                                  'la0_default_entitlement', 'entitlement_access_for_status', 'credit_grants',
                                  'credit_grants_included', 'max_setter_seats', 'max_active_campaigns',
                                  'addon_meters', 'detached_at is null', 'default_included'] loop
    if position(v_marker in v_def) = 0 then
      raise exception 'refresh_tenant_entitlement regressed: % is missing', v_marker;
    end if;
  end loop;

  -- Behaviour, rolled back: give a meter the probe tenant's plan does not set a platform default and a
  -- grant, rebuild, and require the cache, enforcement and the monitor to report the same allowance.
  -- The inner block raises CRL01 to undo every write (the default, the grant, the cache row).
  select s.tenant_id, m.meter_key
    into v_tenant, v_meter
    from public.subscriptions s
    cross join public.meters m
   where s.status in ('active', 'trialing')
     and s.current_period_start is not null
     and s.current_period_start <= now()
     and not exists (select 1 from public.subscriptions s2
                      where s2.tenant_id = s.tenant_id and s2.id <> s.id
                        and (s2.status <> 'cancelled' and s2.started_at > s.started_at
                             or s2.created_at > s.created_at and s2.status in ('trialing', 'active', 'past_due', 'cancelling')))
     and not exists (select 1 from public.plan_meters pm where pm.plan_id = s.plan_id and pm.meter_key = m.meter_key)
     and not exists (select 1 from public.subscription_addons sa
                       join public.addon_meters am on am.addon_id = sa.addon_id
                      where sa.subscription_id = s.id and sa.detached_at is null and am.meter_key = m.meter_key)
   order by s.started_at desc, m.sort_order
   limit 1;

  if v_tenant is null then
    raise notice '20260924360000: no live tenant with a meter left to the platform default; behaviour probe skipped';
    return;
  end if;

  begin
    update public.meter_pricing set default_included = 4321 where meter_key = v_meter;
    insert into public.credit_grants (tenant_id, meter_key, quantity, reason)
    values (v_tenant, v_meter, 7, 'migration probe, rolled back');

    v_result := public.refresh_tenant_entitlement(v_tenant);
    v_cached := (v_result->'meters'->v_meter->>'included')::integer;
    select c.included into v_enforced from public.check_meter_capacity(v_tenant, v_meter, 0) c;
    select (r->>'included_qty')::integer into v_monitored
      from jsonb_array_elements(public.admin_usage_monitor_json(false)) r
     where r->>'tenant_id' = v_tenant::text and r->>'meter_key' = v_meter;
    raise exception 'probe rolled back' using errcode = 'CRL01';
  exception when sqlstate 'CRL01' then
    null;
  end;

  if v_result is null then
    raise exception 'refresh_tenant_entitlement returned nothing for the probe tenant';
  end if;
  if not (v_result ? 'disabled_features') or coalesce((v_result->>'credit_grants_included')::boolean, false) is not true
     or not ((v_result->'limits') ? 'max_setter_seats') or not ((v_result->'limits') ? 'max_active_campaigns') then
    raise exception 'the rebuilt entitlement lost disabled_features, credit_grants_included or the LA-2.22 limits';
  end if;
  if v_cached is distinct from 4328 then
    raise exception 'the cached entitlement says % for % (expected the platform default 4321 + the 7 granted)', v_cached, v_meter;
  end if;
  if v_enforced is distinct from 4328 then
    raise exception 'enforcement says % for % (expected 4328)', v_enforced, v_meter;
  end if;
  if v_monitored is distinct from 4328 then
    raise exception 'the usage monitor says % for % (expected 4328)', v_monitored, v_meter;
  end if;
  if exists (select 1 from public.credit_grants where reason = 'migration probe, rolled back') then
    raise exception 'the behaviour probe left a grant behind';
  end if;

  raise notice '20260924360000: cache, enforcement and monitor agree (% on tenant %, probe rolled back)', v_meter, v_tenant;
end $$;
