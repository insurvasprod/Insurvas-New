-- Overage billing uses the allowance enforcement uses (user decision, 2026-09-25).
--
-- Period billing charges overage from admin_usage_monitor (lib/billing/gather.ts fetchUsage and the
-- --dry preview in scripts/run-period-billing.mjs both read its included_qty; lib/billing/lines.ts
-- overageLinesByMeter bills used - included for soft-capped meters). Its latest definition,
-- 0013_credit_limits_plan_precedence.sql, resolved the allowance as plan row or platform default plus
-- period grants, and left ADD-ON CREDITS out. A customer who paid for an add-on carrying 500 more
-- dialer minutes was therefore billed overage on those 500 minutes, while check_meter_capacity
-- (20260912500000) let them use them as included. It also gave a tenant with no plan the platform
-- default as a finite allowance, where enforcement says unlimited ('no_subscription').
--
-- Restated from 0013 with ONLY the allowance maths changed, to check_meter_capacity's:
--   - plan and period: tenant_current_plan / tenant_current_period_start (unchanged);
--   - base: the plan's row, else meter_pricing.default_included (unchanged); none when there is no plan;
--   - add-on credits: attached (detached_at is null) add-ons of the tenant's newest
--     trialing|active|past_due|cancelling subscription (new);
--   - grants since the period start (unchanged);
--   - an unlimited base stays unlimited (unchanged).
-- Signature, return columns, alert levels, the 0.8 warning line, the filter and the ordering are as
-- they were. create or replace is safe: the return type is identical.

create or replace function public.admin_usage_monitor(p_over_80 boolean default false)
returns table(tenant_id uuid, tenant_name text, tenant_status text, meter_key text, meter_label text, unit text, used_qty integer, included_qty integer, grant_qty integer, plan_included_qty integer, hard_cap boolean, percent_used numeric, alert_level text, period_start timestamptz)
language sql security definer set search_path = public
as $$
with tenant_periods as (
  select t.id, t.name, t.status::text, tenant_current_period_start(t.id) as period_start, tenant_current_plan(t.id) as plan_id,
    (select s.id from subscriptions s
      where s.tenant_id = t.id and s.status in ('trialing', 'active', 'past_due', 'cancelling')
      order by s.created_at desc limit 1) as addon_subscription_id
  from tenants t
),
grid as (select tp.id, tp.name, tp.status, tp.period_start, tp.plan_id, tp.addon_subscription_id, m.meter_key, m.label, m.unit, m.default_hard_cap from tenant_periods tp cross join meters m),
monitor_values as (
  select g.*, pm.included_qty as plan_included,
    case when g.plan_id is null then null::integer
         when pm.meter_key is not null then pm.included_qty
         else mp.default_included end as base_included,
    coalesce(pm.hard_cap, g.default_hard_cap, true) as hard_cap,
    coalesce(ad.quantity, 0)::integer as addon_qty,
    coalesce(gr.quantity, 0)::integer as grant_qty,
    coalesce(ut.used_qty, 0)::integer as used_qty
  from grid g
  left join plan_meters pm on pm.plan_id = g.plan_id and pm.meter_key = g.meter_key
  left join meter_pricing mp on mp.meter_key = g.meter_key
  left join lateral (
    select sum(am.included_qty)::integer as quantity
      from subscription_addons sa
      join addon_meters am on am.addon_id = sa.addon_id
     where sa.subscription_id = g.addon_subscription_id and sa.detached_at is null and am.meter_key = g.meter_key
  ) ad on true
  left join lateral (select sum(cg.quantity)::integer as quantity from credit_grants cg where cg.tenant_id = g.id and cg.meter_key = g.meter_key and g.period_start is not null and cg.granted_at >= g.period_start) gr on true
  left join usage_totals ut on ut.tenant_id = g.id and ut.meter_key = g.meter_key and ut.period_start = g.period_start
),
calculated as (select v.*, case when v.base_included is null then null::integer else v.base_included + v.addon_qty + v.grant_qty end as effective_included from monitor_values v)
select c.id, c.name, c.status, c.meter_key, c.label, c.unit, c.used_qty, c.effective_included, c.grant_qty, c.plan_included, c.hard_cap, case when c.effective_included is null or c.effective_included = 0 then null::numeric else round((c.used_qty::numeric / c.effective_included) * 100, 1) end, case when c.effective_included is not null and c.effective_included > 0 and c.used_qty >= c.effective_included then 'exhausted' when c.effective_included is not null and c.effective_included > 0 and c.used_qty >= c.effective_included * 0.8 then 'warning' else 'ok' end, c.period_start from calculated c where not p_over_80 or (c.effective_included is not null and c.effective_included > 0 and c.used_qty::numeric / c.effective_included >= 0.8) order by case when c.effective_included is null or c.effective_included = 0 then -1 else c.used_qty::numeric / c.effective_included end desc, c.name, c.meter_key;
$$;

comment on function public.admin_usage_monitor(boolean) is
  'Per tenant x meter usage against the allowance check_meter_capacity enforces: plan row or platform '
  'default (none without a plan), plus attached add-on credits, plus period grants. Period billing '
  'charges overage from included_qty. 20260924360100.';

revoke all on function public.admin_usage_monitor(boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_usage_monitor(boolean) to service_role;

-- --------------------------------------------------------------------------
-- Assertions
-- --------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_marker text;
  v_tenant uuid;
  v_sub uuid;
  v_meter text;
  v_addon uuid;
  v_billed integer;
  v_enforced integer;
  v_billed_after_detach integer;
  v_enforced_after_detach integer;
  v_mismatch text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924360100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if has_function_privilege('tenant_app', 'public.admin_usage_monitor(boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_usage_monitor(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_usage_monitor(boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_usage_monitor(boolean)', 'execute') then
    raise exception 'admin_usage_monitor must be executable by the service role only';
  end if;

  select pg_get_functiondef('public.admin_usage_monitor(boolean)'::regprocedure) into v_def;
  foreach v_marker in array array['addon_meters', 'detached_at is null', 'cancelling', 'default_included', 'credit_grants',
                                  'tenant_current_plan', 'tenant_current_period_start'] loop
    if position(v_marker in v_def) = 0 then
      raise exception 'admin_usage_monitor does not read %', v_marker;
    end if;
  end loop;

  -- Read-only: wherever live data already has an add-on contributing, billing and enforcement agree.
  select format('tenant %s meter %s: billing %s, enforcement %s', m.tenant_id, m.meter_key, m.included_qty, c.included)
    into v_mismatch
    from public.admin_usage_monitor(false) m
    cross join lateral public.check_meter_capacity(m.tenant_id, m.meter_key, 0) c
   where exists (select 1 from public.subscriptions s
                   join public.subscription_addons sa on sa.subscription_id = s.id and sa.detached_at is null
                   join public.addon_meters am on am.addon_id = sa.addon_id and am.meter_key = m.meter_key
                  where s.tenant_id = m.tenant_id)
     and m.included_qty is distinct from c.included
   limit 1;
  if v_mismatch is not null then
    raise exception 'overage allowance disagrees with enforcement where an add-on contributes: %', v_mismatch;
  end if;

  -- Behaviour, rolled back: on a live tenant, give a meter its plan does not set a platform default of
  -- 1000, attach a disposable add-on carrying 500 more and grant 7. Billing and enforcement must both
  -- say 1507; after detaching the add-on, both must say 1007. The inner block raises OVG01 to undo
  -- every write (the default, the add-on, its meter, the attachment and the grant).
  select s.tenant_id, s.id, m.meter_key
    into v_tenant, v_sub, v_meter
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
    raise notice '20260924360100: no live tenant with a meter left to the platform default; behaviour probe skipped';
    return;
  end if;

  begin
    insert into public.meter_pricing (meter_key) values (v_meter) on conflict (meter_key) do nothing;
    update public.meter_pricing set default_included = 1000 where meter_key = v_meter;
    insert into public.addons (code, name, price_cents, is_active)
    values ('probe_20260924360100', 'Migration probe, rolled back', 0, true)
    returning id into v_addon;
    insert into public.addon_meters (addon_id, meter_key, included_qty) values (v_addon, v_meter, 500);
    insert into public.subscription_addons (subscription_id, addon_id) values (v_sub, v_addon);
    insert into public.credit_grants (tenant_id, meter_key, quantity, reason)
    values (v_tenant, v_meter, 7, 'migration probe, rolled back');

    select m.included_qty into v_billed from public.admin_usage_monitor(false) m
     where m.tenant_id = v_tenant and m.meter_key = v_meter;
    select c.included into v_enforced from public.check_meter_capacity(v_tenant, v_meter, 0) c;

    update public.subscription_addons set detached_at = now() where subscription_id = v_sub and addon_id = v_addon;
    select m.included_qty into v_billed_after_detach from public.admin_usage_monitor(false) m
     where m.tenant_id = v_tenant and m.meter_key = v_meter;
    select c.included into v_enforced_after_detach from public.check_meter_capacity(v_tenant, v_meter, 0) c;

    raise exception 'probe rolled back' using errcode = 'OVG01';
  exception when sqlstate 'OVG01' then
    null;
  end;

  if v_enforced is distinct from 1507 then
    raise exception 'probe setup: enforcement says % for % (expected 1000 default + 500 add-on + 7 granted)', v_enforced, v_meter;
  end if;
  if v_billed is distinct from v_enforced then
    raise exception 'overage billing says % for % while enforcement says % (an add-on contributes)', v_billed, v_meter, v_enforced;
  end if;
  if v_billed_after_detach is distinct from 1007 or v_enforced_after_detach is distinct from 1007 then
    raise exception 'after detaching the add-on: billing %, enforcement % (expected 1007 both)', v_billed_after_detach, v_enforced_after_detach;
  end if;
  if exists (select 1 from public.addons where code = 'probe_20260924360100')
     or exists (select 1 from public.credit_grants where reason = 'migration probe, rolled back') then
    raise exception 'the behaviour probe left rows behind';
  end if;

  raise notice '20260924360100: overage allowance matches enforcement (% on tenant %: 1507 with the add-on, 1007 without; probe rolled back)', v_meter, v_tenant;
end $$;
