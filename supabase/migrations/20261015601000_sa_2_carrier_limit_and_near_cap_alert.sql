-- SA-2 audit fixes, part 2 of 2 · max_carriers is enforced, and the 80% allowance warning is sent.
--
--   1. refresh_tenant_entitlement puts plans.max_carriers into the entitlement's limits. It was on
--      the plan and in the editor, and nothing read it.
--   2. save_tenant_carrier (the one write path for an agency's carrier contracts: Carrier library and
--      the Rate card both call it) refuses a NEW carrier past that limit, under a per-tenant lock.
--      Re-saving a carrier already held is never refused. The error is
--      'carrier_limit_reached:<held>:<limit>' and the app turns it into a 403 with the numbers.
--   3. Crossing the usage warning threshold (settings usage.warn_percent, 80 by default — the value the
--      usage monitor and check_meter_capacity's near_cap use) on a capped meter writes one in-app
--      notification per owner, once per meter per billing period (the source key dedupes). It is a
--      trigger on usage_totals, so every writer — record_usage, consume_meter_capacity, anything
--      added later — is covered. The notifications job emails it like any outbox event
--      (lib/notifications/events.ts: allowance_near_cap). A failed notification never fails the usage
--      write that crossed the line.
--   4. Cached entitlements without max_carriers are rebuilt, so the limit applies from now rather
--      than from each tenant's next change.
--
-- refresh_tenant_entitlement and save_tenant_carrier are restated from their live definitions
-- (pg_get_functiondef, 2026-10-15: 20261015330000 + the 20261015330100 plan_name patch).
-- Rollback: re-run 20261015330000 + 20261015330100 (engine) and 20260910120000's save_tenant_carrier;
-- drop trigger usage_totals_near_cap_alert on public.usage_totals; drop function
-- public.notify_meter_near_cap().

-- ─── 1 · the engine, with max_carriers ───────────────────────────────────────────────────────────

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
        'max_carriers', v_limits.max_carriers,
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

-- ─── 2 · the carrier limit ───────────────────────────────────────────────────────────────────────

create or replace function public.save_tenant_carrier(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_contract_level_bp integer,
  p_writing_number text,
  p_effective_from date
)
returns public.tenant_carriers
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row   public.tenant_carriers;
  v_limit integer;
  v_held  integer;
begin
  if not exists (select 1 from public.carriers where id = p_carrier_id and organization_id is null and is_active) then
    raise exception 'Carrier is not available';
  end if;

  -- SA-2.5 · plans.max_carriers, read from the tenant's cached entitlement (the contract the whole
  -- app obeys). Absent or null = unlimited. One lock per tenant, so two saves at once cannot both
  -- take the last slot. A carrier the agency already holds is a re-save and never refused.
  perform pg_advisory_xact_lock(hashtextextended('tenant-carriers:' || p_tenant_id::text, 0));
  select case when jsonb_typeof(e.entitlement #> '{limits,max_carriers}') = 'number'
              then (e.entitlement #>> '{limits,max_carriers}')::integer end
    into v_limit
    from public.tenant_entitlements e
   where e.tenant_id = p_tenant_id;
  if v_limit is not null
     and not exists (select 1 from public.tenant_carriers tc where tc.tenant_id = p_tenant_id and tc.carrier_id = p_carrier_id and tc.is_active) then
    select count(distinct tc.carrier_id) into v_held
      from public.tenant_carriers tc
     where tc.tenant_id = p_tenant_id and tc.is_active;
    if v_held >= v_limit then
      raise exception 'carrier_limit_reached:%:%', v_held, v_limit using errcode = 'check_violation';
    end if;
  end if;

  update public.tenant_carriers set is_active = false where tenant_id = p_tenant_id and carrier_id = p_carrier_id and is_active;
  insert into public.tenant_carriers (tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active)
  values (p_tenant_id, p_carrier_id, p_contract_level_bp, trim(p_writing_number), p_effective_from, true)
  on conflict (tenant_id, carrier_id, effective_from) do update set contract_level_bp = excluded.contract_level_bp, writing_number = excluded.writing_number, is_active = true
  returning * into v_row;
  return v_row;
end;
$$;

-- ─── 3 · the 80% warning ─────────────────────────────────────────────────────────────────────────

create or replace function public.notify_meter_near_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_cap   record;
  v_warn  numeric;
  v_label text;
  v_unit  text;
begin
  if tg_op = 'UPDATE' and new.used_qty <= old.used_qty then
    return new;
  end if;

  begin
    -- Only the live billing period; a correction to an old one tells nobody anything.
    if new.period_start is distinct from public.tenant_current_period_start(new.tenant_id) then
      return new;
    end if;

    select * into v_cap from public.check_meter_capacity(new.tenant_id, new.meter_key, 0);
    if v_cap.included is null or v_cap.included <= 0 then
      return new; -- unlimited, or no allowance at all: there is no 80% of it
    end if;

    -- usage.warn_percent, read the way admin_usage_monitor_json reads it (default 80, clamped 1–99).
    select coalesce(
      (select case when jsonb_typeof(s.value) = 'number'
                   then least(greatest((s.value #>> '{}')::numeric, 1), 99) end
         from public.settings s
        where s.key = 'usage.warn_percent'),
      80
    ) / 100.0 into v_warn;

    if new.used_qty < v_cap.included * v_warn then
      return new;
    end if;

    select m.label, m.unit into v_label, v_unit from public.meters m where m.meter_key = new.meter_key;

    insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
    select new.tenant_id, tu.user_id, 'allowance_near_cap',
           coalesce(v_label, new.meter_key) || ': ' || round(100.0 * new.used_qty / v_cap.included) || '% of this period''s allowance used',
           new.used_qty || ' of ' || v_cap.included || ' ' || coalesce(v_unit, 'unit') || 's used. '
             || case when v_cap.hard_cap then 'At the limit this stops working until the period renews or you add credits.'
                     else 'Past the limit each extra one is billed as overage.' end,
           '/app/settings#billing',
           'allowance-near-cap:' || new.meter_key || ':' || to_char(new.period_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id and u.status = 'active'
      join public.tenants t on t.id = tu.tenant_id and t.status::text <> 'suspended'
     where tu.tenant_id = new.tenant_id
       and tu.role::text = 'owner'
       and tu.accepted_at is not null
    on conflict (tenant_id, recipient_user_id, source_key) do nothing;
  exception when others then
    raise warning 'SA-2.5: could not write the allowance warning for tenant % meter %: %', new.tenant_id, new.meter_key, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists usage_totals_near_cap_alert on public.usage_totals;
create trigger usage_totals_near_cap_alert
after insert or update of used_qty on public.usage_totals
for each row execute function public.notify_meter_near_cap();

revoke all on function public.notify_meter_near_cap() from public, anon, authenticated, tenant_app;

-- ─── 4 · bring cached entitlements up to date ────────────────────────────────────────────────────

do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select e.tenant_id from public.tenant_entitlements e
     where not (coalesce(e.entitlement -> 'limits', '{}'::jsonb) ? 'max_carriers')
       and exists (select 1 from public.subscriptions s where s.tenant_id = e.tenant_id)
  loop
    begin
      perform public.refresh_tenant_entitlement(v_tenant);
    exception when others then
      raise warning 'SA-2.5: could not rebuild the entitlement of tenant %: %', v_tenant, sqlerrm;
    end;
  end loop;
end;
$$;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────

do $$
begin
  if position('''max_carriers''' in pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure)) = 0 then
    raise exception 'SA-2 fix: the entitlement engine does not carry max_carriers';
  end if;
  if position('carrier_limit_reached' in pg_get_functiondef('public.save_tenant_carrier(uuid, uuid, integer, text, date)'::regprocedure)) = 0 then
    raise exception 'SA-2 fix: save_tenant_carrier does not enforce max_carriers';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'usage_totals_near_cap_alert' and tgrelid = 'public.usage_totals'::regclass and tgenabled <> 'D') then
    raise exception 'SA-2 fix: the allowance warning trigger is missing';
  end if;
end;
$$;
