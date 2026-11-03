-- Per-tenant feature overrides (admin tenant record, "Feature overrides" tab; board p-adm-tenant-features).
--
-- The plan (plus attached add-ons) is the answer for almost every tenant. An override is a deliberate
-- deviation for ONE tenant: a feature switched on that the plan does not include, or one switched off
-- that it does. Each row carries who set it, when, and why, so the next person does not have to guess.
--
-- Three things are NOT this table, and must stay apart from it:
--   entitlement  = what the plan and add-ons grant                 (plan_features / addon_features)
--   kill switch  = off for everyone, platform-wide, super admin    (feature_switches, 0014)
--   override     = on or off for this one tenant                   (this file)
--
-- Evaluation order: the entitlement is built from the plan and add-ons, overrides are applied to it
-- inside refresh_tenant_entitlement(), and the kill switch is still applied on top of the result at
-- every enforcement point (lib/features/killSwitchRules.ts). So a kill switch always wins: an "on"
-- override cannot bring back a feature that is off for everyone.
--
-- A feature overridden OFF is recorded in the entitlement's `disabled_features`, so the agent app can
-- tell "your plan does not include this" (upgrade prompt) from "not available on your account"
-- (neutral notice, code feature_disabled_for_tenant). Selling someone an upgrade for something they
-- already pay for is the mistake that separation exists to prevent.
--
-- Who may write is decided in the admin route AND re-checked here: super_admin and support_agent may
-- switch a feature off or remove an override; only super_admin may switch on a feature the plan does
-- not include, because that hands out something nobody is paying for.
--
-- refresh_tenant_entitlement() is restated from its latest definition
-- (20260913330000_sa_4_9_live_runtime_repair.sql: security definer, credit grants merged into meter
-- allowances) with four additive changes:
--   1. the plan + add-on feature set comes from plan_and_addon_feature_keys(), which the admin read
--      and write functions below also use, so "what the plan says" has one definition;
--   2. overrides are applied on both paths (subscription and the LA-0 no-subscription default), never
--      to a cancelled tenant;
--   3. limits carry max_setter_seats / max_active_campaigns (LA-2.22), so a fresh snapshot no longer
--      needs ensure_outbound_entitlement() to normalise it on first read;
--   4. the snapshot says `credit_grants_included: true`, so lib/entitlements/get.ts stops adding the
--      period's credit grants a second time (its compatibility merge exists for the older function,
--      which did not include them).
-- The signature and return type are unchanged, so create or replace is safe.

-- --------------------------------------------------------------------------
-- The table
-- --------------------------------------------------------------------------

create table if not exists public.tenant_feature_overrides (
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  feature_key text        not null references public.features (feature_key) on update cascade,
  state       text        not null,
  reason      text        not null,
  review_on   date,
  set_by      uuid        references public.admin_users (id) on delete set null,
  set_at      timestamptz not null default now(),
  constraint tenant_feature_overrides_pkey primary key (tenant_id, feature_key),
  constraint tenant_feature_overrides_state_check check (state in ('on', 'off')),
  -- Same bounds the route validates. The reason is the "why" half of the audit criterion, so an
  -- empty one is refused by the database as well as the form.
  constraint tenant_feature_overrides_reason_check check (char_length(btrim(reason)) between 5 and 500)
);

comment on table public.tenant_feature_overrides is
  'Per-tenant deviations from the plan: a feature switched on or off for one tenant, with who, when '
  'and why. Applied by refresh_tenant_entitlement(); the platform kill switch (feature_switches) still '
  'wins. Removing a row returns the tenant to the plan; the audit log keeps the history.';
comment on column public.tenant_feature_overrides.review_on is
  'Optional date shown next to the override as a reminder to review it. Nothing happens on this date.';

-- "Which tenants have an override on this feature" — the Features page and any future report.
create index if not exists tenant_feature_overrides_feature_idx
  on public.tenant_feature_overrides (feature_key);

-- Control-plane data, like feature_switches: RLS with no policy denies every role that does not
-- bypass it, and the tenant plane never reads this table — it reads the cached entitlement.
alter table public.tenant_feature_overrides enable row level security;

revoke all on public.tenant_feature_overrides from public;
revoke all on public.tenant_feature_overrides from anon;
revoke all on public.tenant_feature_overrides from authenticated;
revoke all on public.tenant_feature_overrides from tenant_app;
grant select, insert, update, delete on public.tenant_feature_overrides to service_role;

-- --------------------------------------------------------------------------
-- What a plan and its attached add-ons grant — one definition
-- --------------------------------------------------------------------------

create or replace function public.plan_and_addon_feature_keys(p_plan_id uuid, p_subscription_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  -- Archived features stay granted (SA-2.1): archiving tidies the picker, it never revokes.
  select coalesce(array_agg(granted.feature_key order by granted.feature_key), array[]::text[])
    from (
      select pf.feature_key
        from public.plan_features pf
       where pf.plan_id = p_plan_id
      union
      select af.feature_key
        from public.subscription_addons sa
        join public.addon_features af on af.addon_id = sa.addon_id
       where sa.subscription_id = p_subscription_id
         and sa.detached_at is null
    ) granted;
$$;

comment on function public.plan_and_addon_feature_keys(uuid, uuid) is
  'Plan features UNION the features of add-ons still attached to the subscription. Used by '
  'refresh_tenant_entitlement() and the admin feature-override functions, so they agree.';

revoke all on function public.plan_and_addon_feature_keys(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.plan_and_addon_feature_keys(uuid, uuid) to service_role;

-- --------------------------------------------------------------------------
-- The engine, restated from 20260913330000 with overrides applied
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
  'overrides (tenant_feature_overrides; off ones listed in disabled_features), plan meters + add-on '
  'credits + credit grants, plan limits. Falls back to la0_default_entitlement() with no subscription. '
  'The platform kill switch is applied on top of this at every enforcement point, not here.';

revoke all on function public.refresh_tenant_entitlement(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_tenant_entitlement(uuid) to service_role;

-- --------------------------------------------------------------------------
-- What a tenant is granted before overrides — the same subscription pick as the engine
-- --------------------------------------------------------------------------

create or replace function public.tenant_granted_feature_keys(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_sub_id uuid;
  v_plan_id uuid;
  v_status text;
  v_default jsonb;
begin
  select s.id, s.plan_id, s.status::text
    into v_sub_id, v_plan_id, v_status
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
   order by (s.status <> 'cancelled') desc, s.started_at desc
   limit 1;

  if v_sub_id is null then
    v_default := public.la0_default_entitlement(p_tenant_id);
    if v_default is null then
      return null;
    end if;
    return jsonb_build_object(
      'source', 'default',
      'status', v_default->>'status',
      'plan_id', null,
      'subscription_id', null,
      'keys', case when v_default->>'status' = 'cancelled' then '[]'::jsonb
                   else coalesce(v_default->'features', '[]'::jsonb) end
    );
  end if;

  return jsonb_build_object(
    'source', 'subscription',
    'status', v_status,
    'plan_id', v_plan_id,
    'subscription_id', v_sub_id,
    'keys', case when v_status = 'cancelled' then '[]'::jsonb
                 else to_jsonb(public.plan_and_addon_feature_keys(v_plan_id, v_sub_id)) end
  );
end;
$$;

revoke all on function public.tenant_granted_feature_keys(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_granted_feature_keys(uuid) to service_role;

-- --------------------------------------------------------------------------
-- The admin tab's read: every catalog feature, what the plan says, and the override if any
-- --------------------------------------------------------------------------

create or replace function public.admin_tenant_feature_overrides(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_granted jsonb;
  v_keys text[];
  v_plan_id uuid;
  v_sub_id uuid;
  v_plan jsonb;
  v_tenants integer;
begin
  v_granted := public.tenant_granted_feature_keys(p_tenant_id);
  if v_granted is null then
    return null;
  end if;

  v_keys := array(select jsonb_array_elements_text(v_granted->'keys'));
  v_plan_id := nullif(v_granted->>'plan_id', '')::uuid;
  v_sub_id := nullif(v_granted->>'subscription_id', '')::uuid;

  if v_plan_id is not null then
    select jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'version', p.version)
      into v_plan
      from public.plans p
     where p.id = v_plan_id;

    -- "The plan is the answer for N tenants": tenants whose live subscription is on this plan version.
    select count(distinct s.tenant_id)::integer
      into v_tenants
      from public.subscriptions s
     where s.plan_id = v_plan_id
       and s.status <> 'cancelled';
  end if;

  return jsonb_build_object(
    'source', v_granted->>'source',
    'status', v_granted->>'status',
    'plan', v_plan,
    'tenants_on_plan', v_tenants,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
          'feature_key', f.feature_key,
          'label', f.label,
          'module', f.module,
          'module_label', coalesce(m.label, f.module),
          'is_archived', f.is_archived,
          'plan_grants', f.feature_key = any(v_keys),
          'in_plan', exists (
            select 1 from public.plan_features pf where pf.plan_id = v_plan_id and pf.feature_key = f.feature_key
          ),
          'addon_names', coalesce((
            select jsonb_agg(distinct ad.name)
              from public.subscription_addons sa
              join public.addon_features af on af.addon_id = sa.addon_id
              join public.addons ad on ad.id = sa.addon_id
             where sa.subscription_id = v_sub_id
               and sa.detached_at is null
               and af.feature_key = f.feature_key
          ), '[]'::jsonb),
          'override', case when o.feature_key is null then null else jsonb_build_object(
            'state', o.state,
            'reason', o.reason,
            'review_on', o.review_on,
            'set_at', o.set_at,
            'set_by_name', a.name,
            'set_by_role', a.role::text
          ) end
        ) order by coalesce(m.sort_order, 999), f.sort_order, f.label)
        from public.features f
        left join public.feature_modules m on m.key = f.module
        left join public.tenant_feature_overrides o on o.tenant_id = p_tenant_id and o.feature_key = f.feature_key
        left join public.admin_users a on a.id = o.set_by
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_tenant_feature_overrides(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_tenant_feature_overrides(uuid) to service_role;

-- --------------------------------------------------------------------------
-- The admin writes. Each one changes the override and rebuilds the entitlement in ONE transaction,
-- so an override can never be saved while the tenant's cached access still says otherwise.
-- --------------------------------------------------------------------------

create or replace function public.admin_set_tenant_feature_override(
  p_tenant_id uuid,
  p_feature_key text,
  p_state text,
  p_reason text,
  p_review_on date,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_active boolean;
  v_archived boolean;
  v_granted jsonb;
  v_plan_grants boolean;
  v_before jsonb;
  v_after jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tenant_feature_overrides:' || p_tenant_id::text, 0));

  if p_state is null or p_state not in ('on', 'off') then
    raise exception 'override_state_invalid' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(btrim(p_reason)) > 500 then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;

  select a.role::text, a.is_active into v_role, v_active from public.admin_users a where a.id = p_admin_id;
  if v_role is null or not v_active or v_role not in ('super_admin', 'support_agent') then
    raise exception 'override_admin_not_allowed' using errcode = '42501';
  end if;
  if p_state = 'on' and v_role <> 'super_admin' then
    raise exception 'override_on_super_admin_only' using errcode = '42501';
  end if;

  select f.is_archived into v_archived from public.features f where f.feature_key = p_feature_key;
  if v_archived is null then
    raise exception 'override_feature_unknown' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'override_feature_archived' using errcode = '22023';
  end if;

  v_granted := public.tenant_granted_feature_keys(p_tenant_id);
  if v_granted is null then
    raise exception 'override_tenant_not_found' using errcode = 'P0002';
  end if;
  if v_granted->>'status' = 'cancelled' then
    raise exception 'override_tenant_cancelled' using errcode = '22023';
  end if;

  v_plan_grants := (v_granted->'keys') ? p_feature_key;
  if (p_state = 'on' and v_plan_grants) or (p_state = 'off' and not v_plan_grants) then
    raise exception 'override_matches_plan' using errcode = '22023';
  end if;

  select to_jsonb(o) into v_before
    from public.tenant_feature_overrides o
   where o.tenant_id = p_tenant_id and o.feature_key = p_feature_key;

  insert into public.tenant_feature_overrides as o (tenant_id, feature_key, state, reason, review_on, set_by, set_at)
  values (p_tenant_id, p_feature_key, p_state, btrim(p_reason), p_review_on, p_admin_id, now())
  on conflict (tenant_id, feature_key) do update
    set state = excluded.state,
        reason = excluded.reason,
        review_on = excluded.review_on,
        set_by = excluded.set_by,
        set_at = excluded.set_at
  returning to_jsonb(o) into v_after;

  perform public.refresh_tenant_entitlement(p_tenant_id);

  return jsonb_build_object('before', v_before, 'after', v_after, 'plan_grants', v_plan_grants);
end;
$$;

revoke all on function public.admin_set_tenant_feature_override(uuid, text, text, text, date, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_set_tenant_feature_override(uuid, text, text, text, date, uuid) to service_role;

create or replace function public.admin_remove_tenant_feature_override(
  p_tenant_id uuid,
  p_feature_key text,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_active boolean;
  v_before jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tenant_feature_overrides:' || p_tenant_id::text, 0));

  -- Removing either kind returns the tenant to what the plan says: an "off" removal restores
  -- something they pay for, an "on" removal takes back something they do not. Neither hands out
  -- an unpaid feature, so both roles that may switch off may also remove.
  select a.role::text, a.is_active into v_role, v_active from public.admin_users a where a.id = p_admin_id;
  if v_role is null or not v_active or v_role not in ('super_admin', 'support_agent') then
    raise exception 'override_admin_not_allowed' using errcode = '42501';
  end if;

  delete from public.tenant_feature_overrides o
   where o.tenant_id = p_tenant_id and o.feature_key = p_feature_key
  returning to_jsonb(o) into v_before;

  if v_before is null then
    raise exception 'override_not_found' using errcode = 'P0002';
  end if;

  perform public.refresh_tenant_entitlement(p_tenant_id);

  return jsonb_build_object('before', v_before);
end;
$$;

revoke all on function public.admin_remove_tenant_feature_override(uuid, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_remove_tenant_feature_override(uuid, text, uuid) to service_role;

-- --------------------------------------------------------------------------
-- Assertions
-- --------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
  v_off text;
  v_on text;
  v_result jsonb;
  v_def text;
begin
  if to_regclass('public.tenant_feature_overrides') is null then
    raise exception 'tenant_feature_overrides was not created';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.tenant_feature_overrides'::regclass) then
    raise exception 'tenant_feature_overrides must have row level security enabled';
  end if;
  if has_table_privilege('tenant_app', 'public.tenant_feature_overrides', 'select') then
    raise exception 'tenant_app can read tenant_feature_overrides; the tenant plane must read the entitlement only';
  end if;

  if has_function_privilege('tenant_app', 'public.admin_set_tenant_feature_override(uuid,text,text,text,date,uuid)', 'execute')
     or has_function_privilege('tenant_app', 'public.admin_remove_tenant_feature_override(uuid,text,uuid)', 'execute')
     or has_function_privilege('tenant_app', 'public.admin_tenant_feature_overrides(uuid)', 'execute')
     or has_function_privilege('tenant_app', 'public.refresh_tenant_entitlement(uuid)', 'execute') then
    raise exception 'a feature-override or entitlement function is executable by tenant_app';
  end if;
  if not has_function_privilege('service_role', 'public.admin_set_tenant_feature_override(uuid,text,text,text,date,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_remove_tenant_feature_override(uuid,text,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_tenant_feature_overrides(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.refresh_tenant_entitlement(uuid)', 'execute') then
    raise exception 'service_role cannot execute a feature-override or entitlement function';
  end if;

  select pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure) into v_def;
  if position('tenant_feature_overrides' in v_def) = 0 or position('disabled_features' in v_def) = 0
     or position('credit_grants' in v_def) = 0 then
    raise exception 'refresh_tenant_entitlement does not apply overrides and credit grants';
  end if;

  -- Behaviour, rolled back: switch one granted feature off and one ungranted feature on for a real
  -- tenant, rebuild, and read the snapshot. The inner block raises OVR01 to undo every write
  -- (the overrides and the rebuilt cache row); the variables keep what was observed.
  select s.tenant_id, (select k from unnest(public.plan_and_addon_feature_keys(s.plan_id, s.id)) k limit 1)
    into v_tenant, v_off
    from public.subscriptions s
   where s.status <> 'cancelled'
     and cardinality(public.plan_and_addon_feature_keys(s.plan_id, s.id)) > 0
     and not exists (select 1 from public.subscriptions s2
                      where s2.tenant_id = s.tenant_id and s2.status <> 'cancelled' and s2.started_at > s.started_at)
   order by s.started_at desc
   limit 1;

  if v_tenant is null then
    raise notice 'tenant feature overrides: no tenant with a live subscription and a granted feature; behaviour probe skipped';
    return;
  end if;

  select f.feature_key into v_on
    from public.features f
   where not f.is_archived
     and not (f.feature_key = any(
       select s.k from public.subscriptions sub, unnest(public.plan_and_addon_feature_keys(sub.plan_id, sub.id)) s(k)
        where sub.tenant_id = v_tenant and sub.status <> 'cancelled'))
   order by f.feature_key
   limit 1;

  begin
    insert into public.tenant_feature_overrides (tenant_id, feature_key, state, reason)
    values (v_tenant, v_off, 'off', 'migration probe, rolled back');
    if v_on is not null then
      insert into public.tenant_feature_overrides (tenant_id, feature_key, state, reason)
      values (v_tenant, v_on, 'on', 'migration probe, rolled back');
    end if;
    v_result := public.refresh_tenant_entitlement(v_tenant);
    raise exception 'probe rolled back' using errcode = 'OVR01';
  exception when sqlstate 'OVR01' then
    null;
  end;

  if v_result is null then
    raise exception 'refresh_tenant_entitlement returned nothing for the probe tenant';
  end if;
  if (v_result->'features') ? v_off then
    raise exception 'a feature overridden off (%) is still in the entitlement', v_off;
  end if;
  if not ((v_result->'disabled_features') ? v_off) then
    raise exception 'a feature overridden off (%) is missing from disabled_features', v_off;
  end if;
  if v_on is not null and not ((v_result->'features') ? v_on) then
    raise exception 'a feature overridden on (%) is missing from the entitlement', v_on;
  end if;
  if exists (select 1 from public.tenant_feature_overrides where reason = 'migration probe, rolled back') then
    raise exception 'the behaviour probe left an override behind';
  end if;

  raise notice 'tenant feature overrides: in place; probe on one tenant switched % off and % on, then rolled back',
    v_off, coalesce(v_on, '(no ungranted feature)');
end $$;
