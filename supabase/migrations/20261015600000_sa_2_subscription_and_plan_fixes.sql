-- SA-2 audit fixes, part 1 of 2 · subscriptions and plan versions.
--
--   1. admin_change_subscription_plan decides "now or at period end" itself. The browser used to
--      decide (apply_now was trusted as sent), so a crafted request could apply a downgrade
--      mid-period and refund nothing. Rule (SA-2.7): a downgrade — cheaper on the subscription's own
--      cycle — always waits for the period end; an upgrade or a same-price move may apply now or be
--      queued, as asked. p_apply_now is now a request, not an order.
--   2. The entitlement is rebuilt INSIDE the transaction of every change that alters access now
--      (plan change applied now, immediate cancel). Assign and pause/resume already did. A rebuild
--      that fails rolls the change back with it, so the route can no longer commit a change and then
--      fail half-way with the idempotency claim stuck at "pending".
--   3. admin_create_plan_version copies every column of every version-owned table, found from the
--      catalog, so a limit column added later (as max_setter_seats and max_active_campaigns were) is
--      never silently dropped again. plan_product_access, also version-owned, was not copied at all.
--      Version numbers are taken under a per-code lock.
--   4. admin_save_plan_version_complete: features, prices, every limit, the plan's meters and the
--      subscribers' entitlement rebuild in ONE transaction. The plan editor ran three calls, so a
--      failure after the first left a published version with the old limits.
--
-- Functions are restated from their live definitions (pg_get_functiondef, 2026-10-15).
-- Rollback: re-run 20260911137000 (change plan, cancel) and 20260903260000 (create version); drop
-- function public.admin_save_plan_version_complete(uuid, text[], integer, integer, integer, integer,
-- integer, jsonb, jsonb) and public.sa2_copy_plan_rows(regclass, uuid, uuid, text).

-- ─── 1 + 2 · change plan ─────────────────────────────────────────────────────────────────────────

create or replace function public.admin_change_subscription_plan(
  p_subscription_id uuid,
  p_new_plan_id     uuid,
  p_apply_now       boolean default true
)
returns table (applied_now boolean, effective_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub       public.subscriptions%rowtype;
  v_plan      public.plans%rowtype;
  v_price     public.plan_prices%rowtype;
  v_offered   boolean;
  v_boundary  timestamptz;
  v_old_cents integer;
  v_new_cents integer;
  v_apply_now boolean;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_sub.status = 'cancelled' then
    raise exception 'subscription_state_not_cancellable' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.plans where id = p_new_plan_id;
  if v_plan.id is null then
    raise exception 'plan_not_found' using errcode = 'check_violation';
  end if;
  if v_plan.is_archived then
    -- Archived plans keep working for existing subscribers but are not available to move onto.
    raise exception 'plan_archived' using errcode = 'check_violation';
  end if;

  -- The target plan must actually be sold on this subscription's cycle (SA-2.4).
  select * into v_price from public.plan_prices where plan_id = p_new_plan_id;
  v_offered := case v_sub.billing_cycle
    when 'monthly'   then v_price.price_monthly_cents is not null
    when 'quarterly' then v_price.price_quarterly_cents is not null
    when 'yearly'    then v_price.price_yearly_cents is not null
  end;
  if v_price.plan_id is null or not coalesce(v_offered, false) then
    raise exception 'cycle_not_offered' using errcode = 'check_violation';
  end if;

  -- The server decides. Both prices are read on the subscription's own cycle; a downgrade never
  -- applies before the period it was paid for ends. With no current price there is nothing to
  -- compare, so the request stands.
  v_new_cents := case v_sub.billing_cycle
    when 'monthly'   then v_price.price_monthly_cents
    when 'quarterly' then v_price.price_quarterly_cents
    when 'yearly'    then v_price.price_yearly_cents
  end;
  select case v_sub.billing_cycle
           when 'monthly'   then pp.price_monthly_cents
           when 'quarterly' then pp.price_quarterly_cents
           when 'yearly'    then pp.price_yearly_cents
         end
    into v_old_cents
    from public.plan_prices pp
   where pp.plan_id = v_sub.plan_id;
  v_apply_now := coalesce(p_apply_now, true)
                 and not (v_old_cents is not null and v_new_cents < v_old_cents);

  v_boundary := coalesce(v_sub.current_period_end, v_sub.current_period_start);

  if v_apply_now then
    update public.subscriptions
       set plan_id         = p_new_plan_id,
           pending_plan_id = null
     where id = p_subscription_id;

    -- Rebuilt here, in the same transaction: a failed rebuild undoes the change instead of leaving
    -- the tenant moved with stale access. The caller settles proration after the commit.
    perform public.refresh_tenant_entitlement(v_sub.tenant_id);
    return query select true, now();
  else
    -- A queued change takes effect exactly at the boundary. Nothing about the entitlement changes
    -- until then — rebuilding now would revoke access the tenant has already paid for.
    update public.subscriptions
       set pending_plan_id = p_new_plan_id
     where id = p_subscription_id;

    return query select false, v_boundary;
  end if;
end;
$$;

comment on function public.admin_change_subscription_plan(uuid, uuid, boolean) is
  'SA-2.7 · Moves a subscription onto another plan version now, or queues it to the period boundary. '
  'A downgrade (cheaper on the subscription''s cycle) is always queued, whatever p_apply_now asks. '
  'Rebuilds the entitlement in the same transaction when it applies now.';

-- ─── 2 · cancel ──────────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_cancel_subscription(
  p_subscription_id uuid,
  p_reason          text default null,
  p_immediate       boolean default false
)
returns table (cancelled_now boolean, effective_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub      public.subscriptions%rowtype;
  v_boundary timestamptz;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_sub.status = 'cancelled' then
    raise exception 'subscription_state_not_cancellable' using errcode = 'check_violation';
  end if;

  v_boundary := coalesce(v_sub.current_period_end, now());

  if p_immediate then
    update public.subscriptions
       set status               = 'cancelled',
           cancel_at_period_end = false,
           cancel_reason        = p_reason,
           cancelled_at         = now()
     where id = p_subscription_id;

    -- Access changes now, so the entitlement does too, in this transaction.
    perform public.refresh_tenant_entitlement(v_sub.tenant_id);
    return query select true, now();
  else
    -- 'cancelling' still resolves to FULL access in entitlement_access_for_status: the term is
    -- paid for, so the tenant keeps everything until it expires.
    update public.subscriptions
       set status               = 'cancelling',
           cancel_at_period_end = true,
           cancel_reason        = p_reason
     where id = p_subscription_id;

    return query select false, v_boundary;
  end if;
end;
$$;

comment on function public.admin_cancel_subscription(uuid, text, boolean) is
  'SA-2.7 · Immediate cancellation ends access now (and rebuilds the entitlement in the same '
  'transaction); the default cancels at the period boundary and leaves full access until then.';

-- ─── 3 · new plan version ────────────────────────────────────────────────────────────────────────

-- Copies one plan's rows of a version-owned table to another plan: every column the table has now
-- or gains later, except the key that is being changed and the row timestamps (which restart).
create or replace function public.sa2_copy_plan_rows(
  p_table      regclass,
  p_from       uuid,
  p_to         uuid,
  p_upsert_key text default null
)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_cols text;
  v_set  text;
  v_n    integer;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
    into v_cols, v_set
    from pg_attribute a
   where a.attrelid = p_table
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('plan_id', 'created_at', 'updated_at')
     and a.attgenerated = ''
     and a.attidentity = '';

  if v_cols is null then
    execute format('insert into %s (plan_id) select $2 from %s where plan_id = $1 on conflict do nothing', p_table, p_table)
      using p_from, p_to;
  elsif p_upsert_key is not null then
    execute format('insert into %1$s (plan_id, %2$s) select $2, %2$s from %1$s where plan_id = $1 on conflict (%3$s) do update set %4$s',
                   p_table, v_cols, p_upsert_key, v_set)
      using p_from, p_to;
  else
    execute format('insert into %1$s (plan_id, %2$s) select $2, %2$s from %1$s where plan_id = $1 on conflict do nothing',
                   p_table, v_cols)
      using p_from, p_to;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.admin_create_plan_version(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_id uuid;
  v_code text;
  v_next integer;
begin
  select p.code into v_code from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'no_data_found';
  end if;

  -- Two publishes of one plan at once would both read the same max(version) and one would fail on
  -- (code, version). Serialised per code instead.
  perform pg_advisory_xact_lock(hashtextextended('plan-version:' || v_code, 0));

  select coalesce(max(p.version), 0) + 1 into v_next
    from public.plans p where p.code = v_code;

  insert into public.plans (code, version, name, plan_type, description, is_public, is_archived, sort_order)
  select p.code, v_next, p.name, p.plan_type, p.description, p.is_public, false, p.sort_order
    from public.plans p where p.id = p_plan_id
  returning id into v_new_id;

  -- Every version-owned relation, every column. plan_limits is an upsert: the individual-plan trigger
  -- may already have seeded the new version's row.
  perform public.sa2_copy_plan_rows('public.plan_features', p_plan_id, v_new_id);
  perform public.sa2_copy_plan_rows('public.plan_prices', p_plan_id, v_new_id);
  perform public.sa2_copy_plan_rows('public.plan_limits', p_plan_id, v_new_id, 'plan_id');
  perform public.sa2_copy_plan_rows('public.plan_meters', p_plan_id, v_new_id);
  perform public.sa2_copy_plan_rows('public.plan_available_addons', p_plan_id, v_new_id);
  perform public.sa2_copy_plan_rows('public.plan_product_access', p_plan_id, v_new_id);

  return v_new_id;
end;
$$;

comment on function public.admin_create_plan_version(uuid) is
  'SA-2.2 · Clones a plan into its next version with every version-owned row (features, prices, all '
  'limit columns, meters, add-ons, product access). Existing subscribers stay on the old version.';

-- ─── 4 · one transaction for the whole plan save ─────────────────────────────────────────────────

create or replace function public.admin_save_plan_version_complete(
  p_plan_id         uuid,
  p_feature_keys    text[],
  p_price_monthly   integer,
  p_price_quarterly integer,
  p_price_yearly    integer,
  p_setup_fee       integer,
  p_trial_days      integer,
  p_limits          jsonb default '{}'::jsonb,
  p_meters          jsonb default null
)
returns table (target_plan_id uuid, target_version integer, created_new_version boolean, refreshed_tenants integer)
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_target  uuid;
  v_version integer;
  v_new     boolean;
  v_key     text;
  v_value   jsonb;
  v_meter   jsonb;
  v_tenant  uuid;
  v_n       integer := 0;
begin
  if not exists (select 1 from public.plans p where p.id = p_plan_id) then
    raise exception 'plan_not_found' using errcode = 'no_data_found';
  end if;
  if p_limits is not null and jsonb_typeof(p_limits) <> 'object' then
    raise exception 'invalid_plan_limit' using errcode = 'invalid_parameter_value';
  end if;
  if p_meters is not null and jsonb_typeof(p_meters) <> 'array' then
    raise exception 'invalid_plan_meter' using errcode = 'invalid_parameter_value';
  end if;

  -- Features and prices, and the decision to edit in place or publish the next version.
  select s.target_plan_id, s.target_version, s.created_new_version
    into v_target, v_version, v_new
    from public.admin_save_plan_version(p_plan_id, p_feature_keys, p_price_monthly, p_price_quarterly,
                                        p_price_yearly, p_setup_fee, p_trial_days) s;

  -- Limits: any column of plan_limits, by name. Only the keys sent are written.
  if p_limits is not null and p_limits <> '{}'::jsonb then
    insert into public.plan_limits (plan_id) values (v_target) on conflict (plan_id) do nothing;
    for v_key, v_value in select e.key, e.value from jsonb_each(p_limits) e loop
      if v_key = 'plan_id' or not exists (
        select 1 from pg_attribute a
         where a.attrelid = 'public.plan_limits'::regclass and a.attname = v_key and a.attnum > 0 and not a.attisdropped
      ) then
        raise exception 'unknown_plan_limit: %', v_key using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_typeof(v_value) not in ('null', 'number')
         or (jsonb_typeof(v_value) = 'number'
             and ((v_value #>> '{}')::numeric < 0 or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
                  or (v_value #>> '{}')::numeric > 2147483647)) then
        raise exception 'invalid_plan_limit: %', v_key using errcode = 'invalid_parameter_value';
      end if;
      execute format('update public.plan_limits set %I = $1 where plan_id = $2', v_key)
        using (case when jsonb_typeof(v_value) = 'null' then null else (v_value #>> '{}')::integer end), v_target;
    end loop;
  end if;

  -- Meters: the full list for this version. A meter left out takes the platform default again.
  -- included_qty null = unlimited, 0 = none; hard_cap defaults to true.
  if p_meters is not null then
    for v_meter in select e.value from jsonb_array_elements(p_meters) e loop
      if jsonb_typeof(v_meter) <> 'object' or coalesce(v_meter ->> 'meter_key', '') = ''
         or coalesce(jsonb_typeof(v_meter -> 'included_qty'), 'missing') not in ('null', 'number')
         or coalesce(jsonb_typeof(v_meter -> 'hard_cap'), 'boolean') <> 'boolean'
         or (jsonb_typeof(v_meter -> 'included_qty') = 'number'
             and ((v_meter ->> 'included_qty')::numeric < 0 or (v_meter ->> 'included_qty')::numeric <> trunc((v_meter ->> 'included_qty')::numeric)
                  or (v_meter ->> 'included_qty')::numeric > 2147483647)) then
        raise exception 'invalid_plan_meter: %', coalesce(v_meter ->> 'meter_key', '?') using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_meters)) <> (select count(distinct e.value ->> 'meter_key') from jsonb_array_elements(p_meters) e) then
      raise exception 'duplicate_plan_meter' using errcode = 'invalid_parameter_value';
    end if;

    delete from public.plan_meters pm
     where pm.plan_id = v_target
       and pm.meter_key not in (select e.value ->> 'meter_key' from jsonb_array_elements(p_meters) e);
    insert into public.plan_meters (plan_id, meter_key, included_qty, hard_cap)
    select v_target, e.value ->> 'meter_key', (e.value ->> 'included_qty')::integer, coalesce((e.value ->> 'hard_cap')::boolean, true)
      from jsonb_array_elements(p_meters) e
    on conflict (plan_id, meter_key) do update
      set included_qty = excluded.included_qty, hard_cap = excluded.hard_cap;
  end if;

  -- An edit in place changes what existing subscribers get: rebuild them here, so a failed rebuild
  -- fails the save. A new version has no subscribers yet.
  if not v_new then
    for v_tenant in
      select distinct s.tenant_id from public.subscriptions s where s.plan_id = v_target and s.status <> 'cancelled'
    loop
      perform public.refresh_tenant_entitlement(v_tenant);
      v_n := v_n + 1;
    end loop;
  end if;

  return query select v_target, v_version, v_new, v_n;
end;
$$;

comment on function public.admin_save_plan_version_complete(uuid, text[], integer, integer, integer, integer, integer, jsonb, jsonb) is
  'SA-2.3/2.4/2.5 · The plan editor''s one save: features, prices, any plan_limits column, the plan''s '
  'meters, and the subscribers'' entitlements, in one transaction. Publishes the next version when the '
  'plan has live subscribers.';

-- ─── access ──────────────────────────────────────────────────────────────────────────────────────

revoke all on function public.admin_change_subscription_plan(uuid, uuid, boolean) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_cancel_subscription(uuid, text, boolean) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_create_plan_version(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.sa2_copy_plan_rows(regclass, uuid, uuid, text) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_save_plan_version_complete(uuid, text[], integer, integer, integer, integer, integer, jsonb, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_change_subscription_plan(uuid, uuid, boolean) to service_role;
grant execute on function public.admin_cancel_subscription(uuid, text, boolean) to service_role;
grant execute on function public.admin_create_plan_version(uuid) to service_role;
grant execute on function public.sa2_copy_plan_rows(regclass, uuid, uuid, text) to service_role;
grant execute on function public.admin_save_plan_version_complete(uuid, text[], integer, integer, integer, integer, integer, jsonb, jsonb) to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.admin_change_subscription_plan(uuid, uuid, boolean)'::regprocedure);
  if position('v_new_cents < v_old_cents' in v_def) = 0 or position('refresh_tenant_entitlement' in v_def) = 0 then
    raise exception 'SA-2 fix: admin_change_subscription_plan is not the new definition';
  end if;
  v_def := pg_get_functiondef('public.admin_create_plan_version(uuid)'::regprocedure);
  if position('plan_product_access' in v_def) = 0 then
    raise exception 'SA-2 fix: admin_create_plan_version is not the new definition';
  end if;
  if has_function_privilege('tenant_app', 'public.admin_save_plan_version_complete(uuid, text[], integer, integer, integer, integer, integer, jsonb, jsonb)', 'execute') then
    raise exception 'SA-2 fix: tenant_app must not be able to save plans';
  end if;
end;
$$;
