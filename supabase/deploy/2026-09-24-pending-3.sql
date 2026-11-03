-- ============================================================================
-- Pending migrations — 4 files, each in its own transaction
-- Generated 2026-09-24 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260924344000_tenant_feature_overrides.sql
--    2. 20260924346000_one_seat_rule.sql
--    3. 20260924346100_admin_tenant_member_sign_ins.sql
--    4. 20260924347000_admin_tenant_record_activity.sql
-- ============================================================================

-- ─── [1/4] 20260924344000_tenant_feature_overrides.sql ───────────────────────────
begin;

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

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924344000', 'tenant_feature_overrides') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/4] 20260924346000_one_seat_rule.sql ──────────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- One seat rule, everywhere (user decision, admin tenant record › Users & seats)
--
-- A seat is held by a membership whose person is active, suspended, or invited and not accepted yet
-- (`invited`, and this application's spelling of it, `pending_verification`). A membership whose
-- person is inactive / deactivated (the two spellings of one state, see 20260912340000) or deleted
-- does not hold a seat.
--
-- Before this file the database had four different answers to "how many seats are used":
--
--   tenant_seats_used (20260911135000)             every tenant_users row, whatever the state
--   admin_set_user_status (20260911141000, text)   active members only
--   admin_set_user_status (20260903310000, enum)   active + suspended
--   admin_attach_user_to_tenant (20260913100000)   active members only
--   buffer seats, invite path (20260913385000)     active + suspended assistants
--   buffer seats, role change (20260910120000)     every assistant row
--   setter seats, trigger (20260914105621)         every setter row
--
-- So an invite held a seat on the tenant's own invite path and did not on the admin's; a deactivated
-- person held a seat forever on one path and none on another. Each function below is rebuilt from
-- its LATEST definition with only the counting changed, all of them through one predicate.
--
-- Additive in spirit: same signatures, same grants, same error strings (lib/users/setStatus.ts and
-- app/api/app/team/** already parse `seat_limit_reached:<used>:<max>`, `max_buffer_seats:<used>:<max>`
-- and `max_setter_seats:<used>:<max>`).
-- ---------------------------------------------------------------------------

-- 1. The rule ---------------------------------------------------------------------------------------

create or replace function public.user_status_holds_seat(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_status in ('active', 'suspended', 'invited', 'pending_verification'), false);
$$;

comment on function public.user_status_holds_seat(text) is
  'The one seat rule: active, suspended and invited (invited / pending_verification) people hold a seat; inactive, deactivated and deleted do not. Mirrored by lib/tenantTeam/seats.ts.';

revoke all on function public.user_status_holds_seat(text) from public, anon, authenticated, tenant_app;
grant execute on function public.user_status_holds_seat(text) to service_role;

-- 2. Seats used ------------------------------------------------------------------------------------
-- From 20260911135000 (the latest definition); only the WHERE clause changes.

create or replace function public.tenant_seats_used(p_tenant_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id
     and public.user_status_holds_seat(u.status::text);
$$;

comment on function public.tenant_seats_used(uuid) is
  'Seats held by this tenant under the one seat rule (user_status_holds_seat): active, suspended and not-yet-accepted invited members. 20260924346000.';

revoke all on function public.tenant_seats_used(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_seats_used(uuid) to service_role;

-- 2b. The seat limit ------------------------------------------------------------------------------
-- plan_limits.max_seats for the tenant's current plan; an individual plan with no explicit max_seats is
-- ONE seat (user decision), the same fallback as lib/tenantTeam/seats.ts seatLimitFor and the
-- entitlement engine. Null = no limit (no plan, or a non-individual plan without a cap). Used only by
-- the checks that decide whether someone can join or be activated: nobody already in is removed, an
-- individual tenant already over one seat simply cannot add another.

create or replace function public.tenant_seat_limit(p_tenant_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(pl.max_seats, case when p.plan_type::text = 'individual' then 1 end)
    from public.plans p
    left join public.plan_limits pl on pl.plan_id = p.id
   where p.id = public.tenant_current_plan(p_tenant_id);
$$;

comment on function public.tenant_seat_limit(uuid) is
  'Seat limit of the tenant''s current plan: plan_limits.max_seats, or 1 for an individual plan without one (mirrors lib/tenantTeam/seats.ts seatLimitFor). Null = no limit. 20260924346000.';

revoke all on function public.tenant_seat_limit(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_seat_limit(uuid) to service_role;

-- 3. The check a status change makes ----------------------------------------------------------------
-- A person starts holding a seat when they move from a state that does not hold one into a state that
-- does (inactive -> active, inactive -> suspended, ...). Status is account-wide, so the check runs for
-- every tenant they belong to, under the same per-tenant lock the invite path takes.

create or replace function public.assert_user_seat_transition(p_user_id uuid, p_from text, p_to text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r        record;
  v_plan   uuid;
  v_max    integer;
  v_buffer integer;
  v_setter integer;
  v_used   integer;
begin
  if public.user_status_holds_seat(p_from) or not public.user_status_holds_seat(p_to) then
    return;
  end if;

  for r in
    select tu.tenant_id, tu.role::text as role
      from public.tenant_users tu
     where tu.user_id = p_user_id
     order by tu.tenant_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(r.tenant_id::text, 0));
    v_plan := public.tenant_current_plan(r.tenant_id);
    continue when v_plan is null;

    select pl.max_buffer_seats, pl.max_setter_seats
      into v_buffer, v_setter
      from public.plan_limits pl
     where pl.plan_id = v_plan;
    v_max := public.tenant_seat_limit(r.tenant_id);

    -- The person does not hold a seat yet (p_from), so the count below excludes them.
    if v_max is not null then
      v_used := public.tenant_seats_used(r.tenant_id);
      if v_used + 1 > v_max then
        raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'check_violation';
      end if;
    end if;

    if r.role = 'assistant' and v_buffer is not null then
      select count(*)::integer into v_used
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
       where tu.tenant_id = r.tenant_id
         and tu.role::text = 'assistant'
         and public.user_status_holds_seat(u.status::text);
      if v_used + 1 > v_buffer then
        raise exception 'max_buffer_seats:%:%', v_used, v_buffer using errcode = 'check_violation';
      end if;
    end if;

    if r.role = 'setter' and v_setter is not null then
      select count(*)::integer into v_used
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
       where tu.tenant_id = r.tenant_id
         and tu.role::text = 'setter'
         and public.user_status_holds_seat(u.status::text);
      if v_used + 1 > v_setter then
        raise exception 'max_setter_seats:%:%', v_used, v_setter using errcode = 'check_violation';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_user_seat_transition(uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.assert_user_seat_transition(uuid, text, text) to service_role;

-- 4. admin_set_user_status, text overload -----------------------------------------------------------
-- From 20260911141000 (the latest). The lifecycle is unchanged; the seat block is the shared check,
-- which now also covers inactive -> suspended (a suspended person holds a seat).

create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status  text,
  p_reason  text default null
)
returns public.users
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user    public.users%rowtype;
  v_allowed boolean;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;

  if p_status not in ('pending_verification', 'active', 'inactive', 'suspended', 'deleted') then
    raise exception 'USER_TRANSITION_NOT_ALLOWED: unknown status %', p_status using errcode = 'check_violation';
  end if;

  if v_user.status::text = p_status then
    raise exception 'USER_ALREADY_IN_STATE' using errcode = 'check_violation';
  end if;

  -- SA-1.4's lifecycle. Deletion is terminal; everything else is reversible, which is why
  -- hard deletion was descoped in favour of a status.
  v_allowed := case
    when v_user.status::text = 'deleted' then false
    when p_status = 'deleted' then true
    when p_status = 'active' then v_user.status::text in ('inactive', 'suspended', 'pending_verification')
    when p_status = 'inactive' then v_user.status::text in ('active', 'suspended')
    when p_status = 'suspended' then v_user.status::text in ('active', 'inactive')
    when p_status = 'pending_verification' then false
    else false
  end;

  if not v_allowed then
    raise exception 'USER_TRANSITION_NOT_ALLOWED: % -> %', v_user.status, p_status using errcode = 'check_violation';
  end if;

  -- The one seat rule: only a move INTO a seat-holding state can be refused. Deactivating and
  -- deleting never can.
  perform public.assert_user_seat_transition(p_user_id, v_user.status::text, p_status);

  update public.users
     set status            = p_status,
         suspended_at      = case when p_status = 'suspended' then now() else null end,
         suspension_reason = case when p_status = 'suspended' then p_reason else null end,
         -- Every state change invalidates outstanding sessions: resolveTenantContext() compares
         -- session_version on each request, so a suspended user is out on their next click rather
         -- than at their next login.
         session_version   = coalesce(v_user.session_version, 0) + 1
   where id = p_user_id
  returning * into v_user;

  return v_user;
end;
$$;

revoke all on function public.admin_set_user_status(uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_set_user_status(uuid, text, text) to service_role;

-- 5. admin_set_user_status, enum overload -----------------------------------------------------------
-- 20260903310000 declared a second overload over the repository's `user_status` enum. The live
-- users.status is text with a CHECK (20260912340000), so that type, and therefore this overload, may
-- not exist in a given database. Rebuilt only where it does, with the same seat check, so neither
-- overload can be used to step around the rule. Nested IFs: to_regprocedure may raise on a type name
-- that does not exist, and SQL does not promise to short-circuit AND.

do $do$
begin
  if to_regtype('public.user_status') is not null then
    if to_regprocedure('public.admin_set_user_status(uuid,public.user_status,text)') is not null then
      execute $ddl$
        create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.user_status, p_reason text default null)
        returns table(old_status public.user_status, new_status public.user_status)
        language plpgsql security definer set search_path = public
        as $function$
        declare
          v_user public.users%rowtype; v_tenant_id uuid;
        begin
          select u.* into v_user from public.users u where u.id = p_user_id for update;
          if not found then raise exception 'USER_NOT_FOUND'; end if;
          select tu.tenant_id into v_tenant_id from public.tenant_users tu where tu.user_id = p_user_id limit 1 for update;
          if found then perform 1 from public.tenants t where t.id = v_tenant_id for update; end if;
          if v_user.status::text = p_status::text then raise exception 'USER_ALREADY_IN_STATE'; end if;
          if not ((v_user.status::text = 'active' and p_status::text in ('inactive', 'suspended'))
               or (v_user.status::text in ('inactive', 'suspended') and p_status::text = 'active')) then
            raise exception 'USER_TRANSITION_NOT_ALLOWED:%:%', v_user.status, p_status;
          end if;
          perform public.assert_user_seat_transition(p_user_id, v_user.status::text, p_status::text);
          update public.users set status = p_status,
            suspended_at = case when p_status::text = 'suspended' then coalesce(suspended_at, now()) else null end,
            suspension_reason = case when p_status::text = 'suspended' then nullif(btrim(p_reason), '') else null end,
            session_version = coalesce(session_version, 0) + 1
           where id = p_user_id;
          return query select v_user.status::text::public.user_status, p_status;
        end;
        $function$
      $ddl$;
      execute 'revoke all on function public.admin_set_user_status(uuid,public.user_status,text) from public, anon, authenticated, tenant_app';
      execute 'grant execute on function public.admin_set_user_status(uuid,public.user_status,text) to service_role';
    end if;
  end if;
end;
$do$;

-- 6. admin_attach_user_to_tenant --------------------------------------------------------------------
-- From 20260913100000 (the latest). The seat count is tenant_seats_used, less this person if their
-- membership already holds a seat there (the ON CONFLICT path re-attaches an existing member).

create or replace function public.admin_attach_user_to_tenant(
  p_user_id         uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_tenant_id       uuid,
  p_new_tenant_name text,
  p_role            text,
  p_token_hash      text,
  p_expires_at      timestamptz,
  p_created_by      uuid
)
returns table (user_id uuid, tenant_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant         uuid;
  v_max            integer;
  v_used           integer;
  v_self           integer;
  v_effective_role text;
begin
  if p_tenant_id is null and nullif(btrim(coalesce(p_new_tenant_name, '')), '') is null then
    raise exception 'tenant_required' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'user_not_provisioned' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
      from public.users u
     where lower(u.email) = lower(p_email)
       and u.id <> p_user_id
  ) then
    raise exception 'EMAIL_ALREADY_REGISTERED' using errcode = 'unique_violation';
  end if;

  if p_tenant_id is not null then
    v_tenant := p_tenant_id;
    if not exists (select 1 from public.tenants t where t.id = v_tenant) then
      raise exception 'tenant_not_found' using errcode = 'foreign_key_violation';
    end if;
    v_effective_role := p_role;
  else
    insert into public.tenants (name, status, onboarding_state)
    values (btrim(p_new_tenant_name), 'active', 'pending')
    returning id into v_tenant;
    v_effective_role := 'owner';
  end if;

  -- The same lock the invite path and the status check take, so two attachments on the last seat
  -- produce one member and one refusal.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

  v_max := public.tenant_seat_limit(v_tenant);

  if v_max is not null then
    select count(*)::integer into v_self
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_tenant
       and tu.user_id = p_user_id
       and public.user_status_holds_seat(u.status::text);
    v_used := public.tenant_seats_used(v_tenant) - v_self;
    if (v_used + 1) > v_max then
      raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'check_violation';
    end if;
  end if;

  update public.users
     set name   = coalesce(nullif(btrim(p_name), ''), name),
         email  = lower(btrim(p_email)),
         phone  = p_phone,
         status = case when status = 'deleted' then status else 'pending_verification' end
   where id = p_user_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant, p_user_id, v_effective_role::public.tenant_user_role)
  on conflict on constraint tenant_users_pkey do update
    set role = excluded.role;

  insert into public.user_invitations (user_id, purpose, token_hash, expires_at, created_by)
  values (p_user_id, 'invite', p_token_hash, p_expires_at, p_created_by);

  return query select p_user_id, v_tenant;
end;
$$;

comment on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) is
  'SA-1.2 · Attaches an Auth-created user to a tenant, forces the first new-tenant membership to owner, and issues an invitation transactionally. Seats counted by the one seat rule (20260924346000).';

revoke all on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) to service_role;

-- 7. tenant_invite_user_with_auth -------------------------------------------------------------------
-- From 20260913385000 (the latest). max_seats already went through tenant_seats_used; the buffer
-- sub-limit now counts by the same rule (it counted active + suspended, so an unaccepted assistant
-- invite did not hold a buffer seat).

create or replace function public.tenant_invite_user_with_auth(
  p_auth_user_id uuid,
  p_name text,
  p_email text,
  p_role public.tenant_user_role,
  p_tenant_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_max_buffer_seats integer default null
)
returns table(user_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_max_seats integer;
  v_used integer;
begin
  -- The same lock the rest of the seat arithmetic takes. Two owners inviting simultaneously on a
  -- plan with one seat left must produce one member and one refusal, not two members.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant_not_found';
  end if;

  if not exists (
    select 1 from public.users
    where id = p_auth_user_id and lower(email) = lower(btrim(p_email))
  ) then
    raise exception 'auth_profile_not_found';
  end if;

  if exists (
    select 1 from public.users
    where lower(email) = lower(btrim(p_email)) and id <> p_auth_user_id
  ) then
    raise exception 'email_exists';
  end if;

  if exists (select 1 from public.tenant_users membership where membership.tenant_id = p_tenant_id and membership.user_id = p_auth_user_id) then
    raise exception 'email_exists';
  end if;

  -- THE SEAT LIMIT, for every role including setter. Read from plan_limits rather than from a
  -- number the caller passed, so a client that omits or forges it cannot buy itself a seat.
  -- tenant_seat_limit: an individual plan without an explicit max_seats is one seat.
  v_max_seats := public.tenant_seat_limit(p_tenant_id);
  if v_max_seats is not null then
    v_used := public.tenant_seats_used(p_tenant_id);
    if v_used >= v_max_seats then
      raise exception 'seat_limit_reached:%:%', v_used, v_max_seats;
    end if;
  end if;

  -- The buffer-seat sub-limit still applies on top: an assistant consumes a seat AND a buffer seat,
  -- counted by the same rule as seats.
  if p_role = 'assistant' then
    select count(*)::integer into v_count
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id
      and tu.role = 'assistant'
      and public.user_status_holds_seat(u.status::text);
    if p_max_buffer_seats is not null and v_count >= p_max_buffer_seats then
      raise exception 'max_buffer_seats:%:%', v_count, p_max_buffer_seats;
    end if;
  end if;

  update public.users
     set name = btrim(p_name),
         full_name = btrim(p_name),
         display_name = btrim(p_name),
         status = 'invited',
         active = false,
         must_reset_password = true,
         updated_at = now()
   where id = p_auth_user_id;

  insert into public.tenant_users (tenant_id, user_id, role, accepted_at)
  values (p_tenant_id, p_auth_user_id, p_role, null);

  insert into public.user_invitations (user_id, tenant_id, token_hash, expires_at, created_by, purpose)
  values (p_auth_user_id, p_tenant_id, p_token_hash, p_expires_at, null, 'invite');

  return query select p_auth_user_id, p_tenant_id;
end;
$$;

revoke all on function public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)
  to service_role;

-- 8. tenant_update_member_role_with_limit -----------------------------------------------------------
-- From 20260910120000 (the latest). It counted every assistant row, deactivated ones included, and
-- refused even when the person being changed holds no seat. Now: held assistants only, and only when
-- the person being made an assistant holds a seat themselves.

create or replace function public.tenant_update_member_role_with_limit(p_tenant_id uuid, p_user_id uuid, p_role public.tenant_user_role, p_max_buffer_seats integer default null)
returns table(old_role public.tenant_user_role, new_role public.tenant_user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_role = 'assistant' and p_max_buffer_seats is not null
     and exists (select 1 from public.users u where u.id = p_user_id and public.user_status_holds_seat(u.status::text)) then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
    select count(*)::integer into v_used
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id
       and tu.role = 'assistant'
       and tu.user_id <> p_user_id
       and public.user_status_holds_seat(u.status::text);
    -- With the numbers now: app/api/app/team/[userId]/route.ts matches `max_buffer_seats:<used>:<max>`
    -- and answered a bare 'max_buffer_seats' with a generic 500.
    if v_used >= p_max_buffer_seats then
      raise exception 'max_buffer_seats:%:%', v_used, p_max_buffer_seats;
    end if;
  end if;
  return query select * from public.tenant_update_member_role(p_tenant_id, p_user_id, p_role);
end;
$$;

revoke all on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) to service_role;

-- 9. enforce_outbound_fixed_limits (setter seats) ---------------------------------------------------
-- From 20260914105621 (the latest). Only the setter count changes; the campaign branch is verbatim.

create or replace function public.enforce_outbound_fixed_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan uuid;
  v_cap integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
  v_plan := public.tenant_current_plan(new.tenant_id);

  if tg_table_name = 'tenant_users' then
    if new.role::text = 'setter' then
      select max_setter_seats into v_cap from public.plan_limits where plan_id = v_plan;
      if v_cap is not null then
        select count(*)::integer into v_used
          from public.tenant_users tu
          join public.users u on u.id = tu.user_id
         where tu.tenant_id = new.tenant_id
           and tu.role::text = 'setter'
           and public.user_status_holds_seat(u.status::text);
        if v_used > v_cap then
          raise exception 'max_setter_seats:%:%', v_used - 1, v_cap;
        end if;
      end if;
    end if;
  elsif tg_table_name = 'tenant_campaigns' then
    if new.status = 'active' then
      select max_active_campaigns into v_cap from public.plan_limits where plan_id = v_plan;
      if v_cap is not null then
        select count(*)::integer into v_used
          from public.tenant_campaigns
         where tenant_id = new.tenant_id and status = 'active';
        if v_used > v_cap then
          raise exception 'max_active_campaigns:%:%', v_used - 1, v_cap;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_outbound_fixed_limits()
  from public, anon, authenticated, tenant_app;

-- 10. Assertions ------------------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924346000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not public.user_status_holds_seat('invited') or not public.user_status_holds_seat('suspended')
     or not public.user_status_holds_seat('active') or not public.user_status_holds_seat('pending_verification')
     or public.user_status_holds_seat('inactive') or public.user_status_holds_seat('deactivated')
     or public.user_status_holds_seat('deleted') or public.user_status_holds_seat(null) then
    raise exception 'user_status_holds_seat does not implement the one seat rule';
  end if;

  foreach v_def in array array[
    'public.tenant_seats_used(uuid)',
    'public.admin_set_user_status(uuid,text,text)',
    'public.admin_attach_user_to_tenant(uuid,text,text,text,uuid,text,text,text,timestamptz,uuid)',
    'public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)',
    'public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer)',
    'public.enforce_outbound_fixed_limits()'
  ] loop
    if to_regprocedure(v_def) is null then
      raise exception '% is missing', v_def;
    end if;
    if pg_get_functiondef(to_regprocedure(v_def)) !~ '(user_status_holds_seat|assert_user_seat_transition|tenant_seats_used)' then
      raise exception '% does not count seats by the one seat rule', v_def;
    end if;
  end loop;

  foreach v_def in array array[
    'public.assert_user_seat_transition(uuid,text,text)',
    'public.admin_attach_user_to_tenant(uuid,text,text,text,uuid,text,text,text,timestamptz,uuid)',
    'public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)'
  ] loop
    if pg_get_functiondef(to_regprocedure(v_def)) !~ 'tenant_seat_limit' then
      raise exception '% does not read the seat limit through tenant_seat_limit', v_def;
    end if;
  end loop;

  if pg_get_functiondef('public.admin_set_user_status(uuid,text,text)'::regprocedure) !~ 'assert_user_seat_transition' then
    raise exception 'admin_set_user_status(text) does not use the shared seat check';
  end if;

  raise notice '20260924346000: one seat rule in place (active, suspended, invited hold a seat)';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924346000', 'one_seat_rule') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/4] 20260924346100_admin_tenant_member_sign_ins.sql ───────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Admin tenant record › Users & seats: "Sign-ins (30d)"
--
-- Successful sign-ins per member of one tenant over the last N days, from login_events. One grouped
-- read instead of a count per person; login_events_user_ts_idx (user_id, ts desc) serves it.
--
-- login_events belong to a person, not to a tenant: someone in two agencies has one sign-in history,
-- and it is that history the column shows.
--
-- Read-only, service_role only (the admin plane reads through the service client).
-- ---------------------------------------------------------------------------

create or replace function public.admin_tenant_member_sign_ins(p_tenant_id uuid, p_days integer default 30)
returns table(user_id uuid, sign_ins integer)
language sql
stable
security invoker
set search_path = public
as $$
  select tu.user_id, count(le.id)::integer as sign_ins
    from public.tenant_users tu
    left join public.login_events le
      on le.user_id = tu.user_id
     and le.success
     and le.ts > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366)))
   where tu.tenant_id = p_tenant_id
   group by tu.user_id;
$$;

comment on function public.admin_tenant_member_sign_ins(uuid, integer) is
  'Successful sign-ins per member of a tenant over the last p_days (1-366, default 30). Admin tenant record, Users & seats. 20260924346100.';

revoke all on function public.admin_tenant_member_sign_ins(uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_tenant_member_sign_ins(uuid, integer) to service_role;

do $$
begin
  -- Same guard as 20260924346000: a role without CREATE could not have applied the function.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924346100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.admin_tenant_member_sign_ins(uuid,integer)') is null then
    raise exception 'admin_tenant_member_sign_ins was not created';
  end if;
  if has_function_privilege('anon', 'public.admin_tenant_member_sign_ins(uuid,integer)', 'execute') then
    raise exception 'admin_tenant_member_sign_ins must not be executable by anon';
  end if;
  raise notice '20260924346100: admin_tenant_member_sign_ins ready';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924346100', 'admin_tenant_member_sign_ins') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/4] 20260924347000_admin_tenant_record_activity.sql ───────────────────────
begin;

-- Admin tenant record, Activity tab: one agency's staff and system audit trail, newest first.
--
-- "What has been done to this agency" is spread over several target ids — the tenant itself, its
-- subscriptions, the people in it, its invoices — so the tab cannot ask audit_log one `target_id =`
-- question. Before this migration the app lists those ids itself and sends them as one `in (...)`
-- filter, capped so the request stays a sane size; this function does the same join in the database,
-- uncapped, and returns the page plus the total in one call.
--
-- Additive only: one index, one new function. Nothing existing is redefined.
--   * audit_log_target_ts_idx — audit_log had no index on target_id, so the audit-log screen's
--     `?target=` filter and this tab both scanned every row (45,000+). Plain CREATE INDEX: this runs
--     in the migration's transaction, and at this size the build takes well under a second.
--   * admin_tenant_activity(...) — read-only, service_role only, like the other admin_* reads.
--
-- Tenant-plane rows (actor_type 'tenant': the agency's own agents at work) are excluded; this is the
-- record of what staff and the platform did to the agency. Every admin who can open the tenant sees
-- all of it (user decision); /admin/audit-log keeps its own stricter per-actor rule.

create index if not exists audit_log_target_ts_idx on public.audit_log (target_id, ts desc);

create or replace function public.admin_tenant_activity(
  p_tenant_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  ts timestamptz,
  actor_type text,
  actor_id uuid,
  action text,
  target_type text,
  target_id text,
  reason text,
  metadata jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with targets as (
    select p_tenant_id::text as target_id
    union
    select s.id::text from public.subscriptions s where s.tenant_id = p_tenant_id
    union
    select tu.user_id::text from public.tenant_users tu where tu.tenant_id = p_tenant_id
    union
    select i.id::text from public.platform_invoices i where i.tenant_id = p_tenant_id
  ),
  matched as (
    select a.id, a.ts, a.actor_type::text as actor_type, a.actor_id, a.action, a.target_type, a.target_id,
           a.reason, a.metadata
      from public.audit_log a
      join targets t on t.target_id = a.target_id
     where a.actor_type::text <> 'tenant'
  )
  select m.id, m.ts, m.actor_type, m.actor_id, m.action, m.target_type, m.target_id, m.reason, m.metadata,
         count(*) over () as total_count
    from matched m
   order by m.ts desc, m.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.admin_tenant_activity(uuid, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_tenant_activity(uuid, integer, integer) to service_role;

-- Assert the effect: the index exists on the right columns, the function exists with this exact
-- signature, only service_role may run it, and it answers (on a random uuid: zero rows, no error).
do $$
declare
  v_rows integer;
begin
  -- The parse-checker runs this with a role that cannot create anything, so nothing above landed
  -- and there is nothing to assert. Same guard as 20260924346000.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924347000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'audit_log' and indexname = 'audit_log_target_ts_idx'
       and indexdef ilike '%(target_id, ts desc)%'
  ) then
    raise exception 'audit_log_target_ts_idx is missing or not on (target_id, ts desc)';
  end if;

  if to_regprocedure('public.admin_tenant_activity(uuid, integer, integer)') is null then
    raise exception 'admin_tenant_activity(uuid, integer, integer) was not created';
  end if;

  if not has_function_privilege('service_role', 'public.admin_tenant_activity(uuid, integer, integer)', 'execute') then
    raise exception 'service_role cannot execute admin_tenant_activity';
  end if;
  if has_function_privilege('anon', 'public.admin_tenant_activity(uuid, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_tenant_activity(uuid, integer, integer)', 'execute') then
    raise exception 'admin_tenant_activity is executable by anon or authenticated; it must be service_role only';
  end if;

  select count(*) into v_rows from public.admin_tenant_activity(gen_random_uuid(), 50, 0);
  if v_rows <> 0 then
    raise exception 'admin_tenant_activity returned % rows for a tenant that does not exist', v_rows;
  end if;

  raise notice 'admin tenant activity: index and function in place';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924347000', 'admin_tenant_record_activity') on conflict do nothing;
  end if;
end $bundle$;
commit;
