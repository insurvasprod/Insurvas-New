-- LA-8.5 (Notion sprint, Module 8 — Settings) · Subscription self-service.
--
-- The plan changes, pauses and cancellations themselves are SA-2's functions, called unchanged by the
-- new tenant route (app/api/app/billing). This migration holds only what the owner's decisions of
-- 2026-10-15 change in the platform's rules:
--
--   1. Cancelled is READ-ONLY, like paused — not locked out. A cancelled agency can read its book,
--      statements and commission history, and cannot dial, submit applications or process
--      statements, for the retention window; after it, access is none (as cancelled was before).
--        entitlement_access_for_status: cancelled -> read_only (accessRule.test.mjs holds the
--        application's accessLevelForStatus to the same mapping).
--        refresh_tenant_entitlement: restated from its latest definition (20260924360000), changing
--        only the cancelled branch, the override guard and one new key, retention_until.
--        It keeps LA-4.10's plan_name line (20261003100000 patched it in place, so it is not in
--        20260924360000's text; the first apply of this file dropped it — 20261015330100 restores it).
--   2. The retention window is the platform setting billing.cancelled_retention_days, 90 days unless
--      staff change it (coded default in lib/settings/constants.ts; this reads the same setting).
--   3. Cancelling offers a pause once: subscriptions.pause_offered_at records that it was offered.
--
-- Already-cancelled subscriptions keep their cancelled_at, so one cancelled more than 90 days ago stays
-- without access. Their entitlements are rebuilt at the end so the change is seen at once.

-- --------------------------------------------------------------------------
-- 1. The retention window
-- --------------------------------------------------------------------------

create or replace function public.cancelled_retention_days()
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select least(3650, greatest(1, (s.value #>> '{}')::numeric::integer))
       from public.settings s
      where s.key = 'billing.cancelled_retention_days'
        and jsonb_typeof(s.value) = 'number'),
    90);
$$;

comment on function public.cancelled_retention_days() is
  'LA-8.5 · How long a cancelled agency keeps read-only access to its records: the platform setting '
  'billing.cancelled_retention_days, 1–3650, default 90 (as lib/settings/constants.ts).';

revoke all on function public.cancelled_retention_days() from public, anon, authenticated, tenant_app;
grant execute on function public.cancelled_retention_days() to service_role;

-- --------------------------------------------------------------------------
-- 2. Cancelled is read-only
-- --------------------------------------------------------------------------

create or replace function public.entitlement_access_for_status(p_status text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_status
    when 'trialing'   then 'full'
    when 'active'     then 'full'
    when 'past_due'   then 'full'       -- chasing payment must not break the product
    when 'cancelling' then 'full'       -- paid through the end of the term
    when 'suspended'  then 'read_only'
    when 'paused'     then 'read_only'
    when 'cancelled'  then 'read_only'  -- LA-8.5: for the retention window; refresh_tenant_entitlement ends it
  end;
$$;

comment on function public.entitlement_access_for_status(text) is
  'SA-2.8, LA-8.5 · Mirrors accessLevelForStatus() in lib/subscriptions/access.ts. Suspended, paused '
  'and cancelled keep READ access to the book of business; a cancelled one only until retention_until.';

-- --------------------------------------------------------------------------
-- The engine (restated; see the header)
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
  v_retention_until timestamptz;
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
      -- LA-8.5 (owner decision 2026-10-15): cancelled is read-only, like paused, for the retention
      -- window. The plan's features stay so the book, the statements and the commission history can
      -- still be READ; every write route refuses a read-only account. Meters are empty: nothing is
      -- consumed. Past the window access is none and nothing is granted, as before.
      v_retention_until := coalesce(v_sub.cancelled_at, now()) + make_interval(days => public.cancelled_retention_days());
      v_meters := '{}'::jsonb;
      if v_retention_until <= now() then
        v_access := 'none';
        v_features := '[]'::jsonb;
      else
        select coalesce(jsonb_agg(granted.feature_key order by granted.feature_key), '[]'::jsonb)
          into v_features
          from unnest(public.plan_and_addon_feature_keys(v_plan.id, v_sub.id)) as granted(feature_key);
      end if;
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
      'plan_name', v_plan.name,
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
      'credit_grants_included', true,
      'retention_until', v_retention_until
    );
  end if;

  -- Per-tenant overrides. An "on" override is never applied to a cancelled tenant: it must not
  -- quietly reopen an account that has ended. An "off" one still is (LA-8.5: a cancelled tenant keeps
  -- its plan's features to read, so staff switching one off must still hold). None past the window.
  if coalesce(v_entitlement->>'access', '') <> 'none' then
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
           and coalesce(v_entitlement->>'status', '') <> 'cancelled'
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
  'LA-8.5: a cancelled tenant is read-only with its plan''s features until retention_until (cancelled_at + '
  'billing.cancelled_retention_days), then none. Recomputes and caches one tenant''s entitlement: plan + attached add-on features, then per-tenant '
  'overrides (tenant_feature_overrides; off ones listed in disabled_features), plan meters (or the '
  'platform default in meter_pricing.default_included where the plan sets none, as check_meter_capacity) '
  '+ add-on credits + credit grants, plan limits. Falls back to la0_default_entitlement() with no '
  'subscription. The platform kill switch is applied on top of this at every enforcement point, not here.';

revoke all on function public.refresh_tenant_entitlement(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_tenant_entitlement(uuid) to service_role;

-- --------------------------------------------------------------------------
-- 3. The pause is offered once
-- --------------------------------------------------------------------------

alter table public.subscriptions add column if not exists pause_offered_at timestamptz;

comment on column public.subscriptions.pause_offered_at is
  'LA-8.5 · When the agency was offered a pause instead of cancelling (accepted or not). Offered once.';

-- --------------------------------------------------------------------------
-- 4. Rebuild every cancelled tenant's entitlement, so the rule applies now
-- --------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select distinct s.tenant_id from public.subscriptions s
     where s.status = 'cancelled'
       and not exists (select 1 from public.subscriptions o where o.tenant_id = s.tenant_id and o.status <> 'cancelled')
  loop
    perform public.refresh_tenant_entitlement(v_tenant);
  end loop;
end;
$$;
