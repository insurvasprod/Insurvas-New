-- SA-2.8 · Entitlement engine
--
-- "Turns plan + add-ons + status into one cached JSON object." It is the whole contract between
-- the admin plane and the agent app: the agent app never queries a plan, a subscription or a
-- price, it reads this object and obeys it.
--
-- What this changes. `refresh_tenant_entitlement()` already existed, but the LA-0 compatibility
-- bridge defined it as a pass-through to `la0_default_entitlement()` — a fixed feature list that
-- never looks at a subscription. That is why every tenant reports `access: full` no matter what
-- their subscription says, and why `npm run verify:entitlements` fails "access is read_only" and
-- "access is none". The cache had no producer. This gives it one.
--
-- Compatibility is deliberate: a tenant with no subscription row still gets the bridge default, so
-- the six existing LA-0 tenants keep working exactly as they do now. Only tenants that actually
-- have a subscription switch to the computed path.
--
-- Also included, and strictly speaking SA-2.7: `admin_assign_subscription`. SA-2.8's own
-- acceptance criterion is "automated test: for each seeded plan, assert the exact feature list the
-- agent gets", and the test that does it (scripts/verify-entitlements.mjs) cannot assign a plan
-- without this function. Assign only — change, pause and cancel remain SA-2.7.

-- --------------------------------------------------------------------------
-- The status → access rule, in SQL
--
-- This mirrors accessLevelForStatus() in lib/subscriptions/access.ts, which carries the rule the
-- whole product rests on: "a suspended tenant can always still read their own book of business.
-- Suspend the doing, preserve the seeing."
--
-- Two implementations of one rule is a drift risk, so lib/entitlements/accessRule.test.mjs reads
-- this function's mapping out of the migration and fails if it stops matching the TypeScript.
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
    when 'cancelled'  then 'none'
  end;
$$;

comment on function public.entitlement_access_for_status(text) is
  'SA-2.8 · Mirrors accessLevelForStatus() in lib/subscriptions/access.ts. Suspended and paused '
  'keep READ access to the book of business; only cancelled removes it.';

-- --------------------------------------------------------------------------
-- The engine
-- --------------------------------------------------------------------------

create or replace function public.refresh_tenant_entitlement(p_tenant_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub         public.subscriptions%rowtype;
  v_plan        public.plans%rowtype;
  v_features    jsonb;
  v_status      text;
  v_access      text;
  v_entitlement jsonb;
begin
  -- The governing subscription: a live one if there is any, otherwise the most recent cancelled
  -- one, so a cancelled tenant resolves to 'none' rather than falling back to the bridge default
  -- and silently regaining access.
  select s.* into v_sub
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
   order by (s.status <> 'cancelled') desc, s.started_at desc
   limit 1;

  if v_sub.id is null then
    -- No subscription at all. Bridge tenants provisioned before SA-2 live here; keep their
    -- behaviour unchanged rather than cutting their access off.
    v_entitlement := public.la0_default_entitlement(p_tenant_id);
    if v_entitlement is null then
      raise exception 'tenant_not_found' using errcode = 'no_data_found';
    end if;
  else
    select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;
    if v_plan.id is null then
      raise exception 'plan_not_found for subscription %', v_sub.id using errcode = 'foreign_key_violation';
    end if;

    v_status := v_sub.status::text;
    v_access := public.entitlement_access_for_status(v_status);

    if v_status = 'cancelled' then
      -- Access ends with the subscription. Everything else keeps the plan's features, including
      -- suspended and paused — those are read_only, not empty.
      v_features := '[]'::jsonb;
    else
      -- Archived features are deliberately NOT filtered out. SA-2.1: "archiving a feature does
      -- not break plans that already reference it — it stays enforced for existing subscribers
      -- and disappears from the picker." The picker filters; the entitlement must not.
      select coalesce(jsonb_agg(pf.feature_key order by pf.feature_key), '[]'::jsonb)
        into v_features
        from public.plan_features pf
       where pf.plan_id = v_plan.id;
    end if;

    v_entitlement := jsonb_build_object(
      'tenant_id',    p_tenant_id,
      'plan_code',    v_plan.code,
      'plan_version', v_plan.version,
      'status',       v_status,
      'access',       v_access,
      'computed_at',  now(),
      'features',     v_features,
      -- Metered allowances arrive with SA-2.5 (plan_limits, meters, usage_totals). An empty
      -- object is the honest answer today: no meter is enforced, rather than a meter reported as
      -- unlimited.
      'meters',       '{}'::jsonb,
      'limits',       jsonb_build_object(
                        -- SA-2.2: an individual plan is "always 1 seat". The remaining limits
                        -- come from plan_limits in SA-2.5; null means unlimited, per the
                        -- Entitlement type in lib/entitlements/types.ts.
                        'max_seats',               case when v_plan.plan_type = 'individual' then 1 else null end,
                        'max_publishers',          null,
                        'max_marketing_partners',  null,
                        'max_affiliates',          null,
                        'max_buffer_seats',        null,
                        'max_partner_users',       null
                      ),
      'period_start', v_sub.current_period_start
    );
  end if;

  insert into public.tenant_entitlements (tenant_id, entitlement, computed_at, version)
  values (p_tenant_id, v_entitlement, now(), 1)
  on conflict (tenant_id) do update
    set entitlement = excluded.entitlement,
        computed_at = excluded.computed_at,
        version     = public.tenant_entitlements.version + 1;

  return v_entitlement;
end;
$$;

comment on function public.refresh_tenant_entitlement(uuid) is
  'SA-2.8 · Recomputes and caches one tenant''s entitlement from its subscription, plan and plan '
  'features. Falls back to la0_default_entitlement() for tenants with no subscription.';

-- Service role only. The agent app reads the cached row, never this function.
revoke all on function public.refresh_tenant_entitlement(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.entitlement_access_for_status(text) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_tenant_entitlement(uuid) to service_role;
grant execute on function public.entitlement_access_for_status(text) to service_role;

-- --------------------------------------------------------------------------
-- admin_assign_subscription — SA-2.7's assign half, needed by SA-2.8's own test
-- --------------------------------------------------------------------------

create or replace function public.admin_assign_subscription(
  p_tenant_id      uuid,
  p_plan_id        uuid,
  p_billing_cycle  text default 'monthly',
  p_start          timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'plan_not_found' using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant_not_found' using errcode = 'foreign_key_violation';
  end if;

  -- One live subscription per tenant, matching subscriptions_one_live_per_tenant_idx. Assigning
  -- over an existing live subscription replaces the plan on it rather than creating a second.
  insert into public.subscriptions (tenant_id, plan_id, billing_cycle, status, started_at, current_period_start)
  values (p_tenant_id, p_plan_id, p_billing_cycle::public.billing_cycle, 'active', p_start, p_start)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    update public.subscriptions
       set plan_id              = p_plan_id,
           billing_cycle        = p_billing_cycle::public.billing_cycle,
           started_at           = p_start,
           current_period_start = p_start
     where tenant_id = p_tenant_id and status <> 'cancelled'
     returning id into v_id;
  end if;

  -- SA-2.7's criterion is that the entitlement is rebuilt BEFORE the call returns, so the
  -- agent's next page load already reflects the change.
  perform public.refresh_tenant_entitlement(p_tenant_id);

  return v_id;
end;
$$;

comment on function public.admin_assign_subscription(uuid, uuid, text, timestamptz) is
  'SA-2.7 (assign only) · Puts a tenant on a plan version and rebuilds their entitlement before '
  'returning. Change, pause and cancel are still to be written.';

revoke all on function public.admin_assign_subscription(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_assign_subscription(uuid, uuid, text, timestamptz) to service_role;
