-- ============================================================================
-- Pending migrations — 11 files, each in its own transaction
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
--    1. 20260924351000_admin_login_activity_stats_v2.sql
--    2. 20260924352000_addon_price_lock_and_version_availability.sql
--    3. 20260924353000_admin_last_super_admin_guard.sql
--    4. 20260924355000_admin_audit_summary.sql
--    5. 20260924357000_admin_carrier_usage_and_deactivation_guard.sql
--    6. 20260924360000_credits_limits_one_allowance.sql
--    7. 20260924360100_overage_uses_the_enforced_allowance.sql
--    8. 20260925500000_admin_user_directory.sql
--    9. 20260925502000_trial_outcome_timestamps.sql
--   10. 20260925504000_template_drafts.sql
--   11. 20260925507000_state_disclosure_review.sql
-- ============================================================================

-- ─── [1/11] 20260924351000_admin_login_activity_stats_v2.sql ──────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Admin › Login activity: stats v2, and the indexes login_events was declared with.
--
-- 1. admin_login_activity_stats_v2() — the four figures of admin_login_activity_stats() plus
--    logins_last_week_to_date, the successful sign-ins from the start of LAST week up to this same
--    moment a week ago, so the "Logins this week" tile can compare like with like. A new name rather
--    than a replacement: v1's return type cannot change under `create or replace`, and the page
--    falls back to v1 until this file is applied.
--
--    Semantics are v1's as it is LIVE (probed 2026-09-24 with pg_get_functiondef: the
--    20260911141000 body, not the baseline dump's):
--      - logins_* count successful attempts of every actor, tenant users and staff alike;
--      - active_last_15_min counts distinct tenant USERS (user_id) only — staff are not counted.
--    Day and week boundaries are pinned to UTC with the three-argument date_trunc, so the figure
--    does not move with the session TimeZone; the page labels its times UTC.
--    The scan is bounded to the last two ISO weeks, so login_events_ts_idx serves it.
--
-- 2. login_events_ts_idx / _user_ts_idx / _admin_ts_idx — declared in 0000_baseline.sql but absent
--    from the live table (only login_events_pkey exists, probed 2026-09-24). Same names and
--    definitions as the baseline, `if not exists`, so a database that has them is untouched.
--
-- 3. login_events_email_trgm_idx — only where pg_trgm is installed (it is, in public, on the live
--    project). Serves the page's "Search actor, IP" box, which is an ilike '%term%' on email.
--
-- Read-only function, service_role only (the admin plane reads through the service client).
-- ---------------------------------------------------------------------------

create index if not exists login_events_ts_idx on public.login_events using btree (ts desc);
create index if not exists login_events_user_ts_idx on public.login_events using btree (user_id, ts desc);
create index if not exists login_events_admin_ts_idx on public.login_events using btree (admin_id, ts desc);

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_schema is null then
    raise notice '20260924351000: pg_trgm is not installed, email search stays a sequential scan';
    return;
  end if;
  execute format(
    'create index if not exists login_events_email_trgm_idx on public.login_events using gin (email %I.gin_trgm_ops)',
    v_schema
  );
end;
$$;

create or replace function public.admin_login_activity_stats_v2()
returns table (
  logins_today integer,
  logins_this_week integer,
  logins_last_week_to_date integer,
  failed_today integer,
  active_last_15_min integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('day', now(), 'UTC') as day_start,
      date_trunc('week', now(), 'UTC') as week_start
  )
  select
    count(*) filter (where le.success and le.ts >= b.day_start)::integer,
    count(*) filter (where le.success and le.ts >= b.week_start)::integer,
    count(*) filter (
      where le.success and le.ts >= b.week_start - interval '7 days' and le.ts < now() - interval '7 days'
    )::integer,
    -- Failures matter on their own: a spike is the brute-force signal login protection acts on.
    count(*) filter (where not le.success and le.ts >= b.day_start)::integer,
    count(distinct le.user_id) filter (where le.success and le.ts > now() - interval '15 minutes')::integer
  from bounds b
  left join public.login_events le
    on le.ts >= b.week_start - interval '7 days';
$$;

comment on function public.admin_login_activity_stats_v2() is
  'Admin Login activity tiles: v1''s four figures (UTC day/week) plus successful sign-ins last week up to this moment a week ago. 20260924351000.';

revoke all on function public.admin_login_activity_stats_v2() from public, anon, authenticated, tenant_app;
grant execute on function public.admin_login_activity_stats_v2() to service_role;

do $$
declare
  v_row record;
begin
  -- Same guard as 20260924346000: a role without CREATE could not have applied anything above.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924351000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.admin_login_activity_stats_v2()') is null then
    raise exception 'admin_login_activity_stats_v2 was not created';
  end if;
  if has_function_privilege('anon', 'public.admin_login_activity_stats_v2()', 'execute')
     or has_function_privilege('tenant_app', 'public.admin_login_activity_stats_v2()', 'execute') then
    raise exception 'admin_login_activity_stats_v2 must be service_role only';
  end if;
  if to_regclass('public.login_events_ts_idx') is null then
    raise exception 'login_events_ts_idx is missing';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_trgm')
     and to_regclass('public.login_events_email_trgm_idx') is null then
    raise exception 'pg_trgm is installed but login_events_email_trgm_idx was not created';
  end if;

  -- Exactly one row, even on an empty table (the left join keeps the bounds row).
  select * into strict v_row from public.admin_login_activity_stats_v2();
  if v_row.logins_today is null or v_row.logins_today > v_row.logins_this_week then
    raise exception 'admin_login_activity_stats_v2 returned inconsistent figures';
  end if;

  raise notice '20260924351000: admin_login_activity_stats_v2 and login_events indexes ready';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924351000', 'admin_login_activity_stats_v2') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/11] 20260924352000_addon_price_lock_and_version_availability.sql ──────────
begin;

-- Add-on catalog: lock price and billing cycle while billed, and stop dropping older plan versions
--
-- Two changes to public.admin_upsert_addon, both from the user's decision on the Add-ons board.
-- The function is redefined from its latest definition (20260914110000); its signature and return
-- type are unchanged, so `create or replace` is enough and existing grants survive (they are
-- re-stated below anyway).
--
-- 1. Price lock. The period invoice reads the CURRENT addons.price_cents and billing_cycle for every
--    live attachment (lib/billing/gather.ts fetchAttachedAddons, lib/billing/lines.ts addonLines).
--    Editing the price therefore repriced every subscriber at their next invoice with no notice, and
--    editing the cycle made the invoice skip the add-on outright (a cycle mismatch is skipped, not
--    billed). While the add-on is attached to any subscription the billing run still invoices —
--    detached_at is null and the subscription is not cancelled, the same filter gather.ts uses —
--    price and cycle cannot change: staff archive it and create a new code instead. Name,
--    description, sort order and the archive switch stay editable.
--
-- 2. Plan-version availability. The editor lists one row per plan code (admin_plan_list = latest
--    version), and the old function replaced EVERY plan_available_addons row with that list. So any
--    save removed the add-on from older plan versions — which copy availability when a new version
--    is cut (20260903260000) and still carry live subscribers — and their tenants then needed an
--    audited override to attach it. Now only rows for LATEST versions that the caller did not list
--    are removed; rows for older versions are kept.
--
-- Additive and idempotent. The app enforces both rules itself until this is applied.

create or replace function public.admin_upsert_addon(
  p_addon_id       uuid default null,
  p_code           text default null,
  p_name           text default null,
  p_description    text default null,
  p_price_cents    integer default null,
  p_billing_cycle  public.billing_cycle default null,
  p_is_active      boolean default true,
  p_sort_order     integer default 0,
  p_feature_keys   text[] default '{}'::text[],
  p_meters         jsonb default '[]'::jsonb,
  p_plan_ids       uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addon                   public.addons%rowtype;
  v_id                      uuid;
  v_meter                   jsonb;
  v_meter_key               text;
  v_qty                     integer;
  v_has_live_attachments    boolean := false;
  v_has_billed_attachments  boolean := false;
  v_grants_changed          boolean := false;
  v_meters_changed          boolean := false;
begin
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 120 then
    raise exception 'invalid_addon_name' using errcode = 'check_violation';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'invalid_addon_price' using errcode = 'check_violation';
  end if;
  if p_billing_cycle is null then
    raise exception 'invalid_billing_cycle' using errcode = 'check_violation';
  end if;
  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'invalid_sort_order' using errcode = 'check_violation';
  end if;
  if p_meters is null or jsonb_typeof(p_meters) <> 'array' then
    raise exception 'invalid_meter_configuration' using errcode = 'check_violation';
  end if;

  if p_addon_id is null then
    if p_code is null or p_code !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'invalid_addon_code' using errcode = 'check_violation';
    end if;
  else
    select * into v_addon from public.addons where id = p_addon_id for update;
    if not found then
      raise exception 'addon_not_found' using errcode = 'foreign_key_violation';
    end if;
    -- Codes are referenced by invoices and external catalog consumers; archive and create a new
    -- code instead of renaming one in place.
    if p_code is not null and p_code <> v_addon.code then
      raise exception 'code_immutable' using errcode = 'check_violation';
    end if;
  end if;

  if exists (
    select 1 from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key)
    where not exists (
      select 1 from public.features f
      where f.feature_key = keys.feature_key and not f.is_archived
    )
  ) then
    raise exception 'feature_not_found' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key)
    group by keys.feature_key having count(*) > 1
  ) then
    raise exception 'duplicate_feature_key' using errcode = 'unique_violation';
  end if;

  for v_meter in select value from jsonb_array_elements(p_meters) as items(value) loop
    v_meter_key := v_meter->>'meter_key';
    if v_meter_key is null or length(btrim(v_meter_key)) = 0 or length(v_meter_key) > 80
       or (v_meter->>'included_qty') is null
       or (v_meter->>'included_qty') !~ '^[0-9]+$' then
      raise exception 'invalid_meter_configuration' using errcode = 'check_violation';
    end if;
    v_qty := (v_meter->>'included_qty')::integer;
    if v_qty <= 0 then
      raise exception 'invalid_meter_quantity' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.meters m where m.meter_key = v_meter_key) then
      raise exception 'meter_not_found' using errcode = 'foreign_key_violation';
    end if;
  end loop;

  if exists (
    select meter_key from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer)
    group by meter_key having count(*) > 1
  ) then
    raise exception 'duplicate_meter_key' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_plan_ids, '{}'::uuid[])) as ids(plan_id)
    where not exists (select 1 from public.plans p where p.id = ids.plan_id)
  ) then
    raise exception 'plan_not_found' using errcode = 'foreign_key_violation';
  end if;

  if p_addon_id is not null then
    select exists (
      select 1 from public.subscription_addons sa
      where sa.addon_id = p_addon_id and sa.detached_at is null
    ) into v_has_live_attachments;

    -- The billing run's own filter: every subscription that is not cancelled is invoiced.
    select exists (
      select 1
        from public.subscription_addons sa
        join public.subscriptions s on s.id = sa.subscription_id
       where sa.addon_id = p_addon_id
         and sa.detached_at is null
         and s.status <> 'cancelled'
    ) into v_has_billed_attachments;

    if v_has_billed_attachments
       and (p_price_cents <> v_addon.price_cents or p_billing_cycle <> v_addon.billing_cycle) then
      raise exception 'addon_price_has_live_attachments' using errcode = 'check_violation';
    end if;

    v_grants_changed :=
      exists (
        select 1 from public.addon_features af
        where af.addon_id = p_addon_id
          and not (af.feature_key = any(coalesce(p_feature_keys, '{}'::text[])))
      )
      or exists (
        select 1 from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key)
        where not exists (
          select 1 from public.addon_features af
          where af.addon_id = p_addon_id and af.feature_key = keys.feature_key
        )
      );

    v_meters_changed :=
      exists (
        select 1 from public.addon_meters am
        where am.addon_id = p_addon_id
          and not exists (
            select 1 from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer)
            where rows.meter_key = am.meter_key and rows.included_qty = am.included_qty
          )
      )
      or exists (
        select 1 from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer)
        where not exists (
          select 1 from public.addon_meters am
          where am.addon_id = p_addon_id
            and am.meter_key = rows.meter_key and am.included_qty = rows.included_qty
        )
      );

    if v_has_live_attachments and (v_grants_changed or v_meters_changed) then
      raise exception 'addon_grants_have_live_attachments' using errcode = 'check_violation';
    end if;
  end if;

  if p_addon_id is null then
    insert into public.addons (code, name, description, price_cents, billing_cycle, is_active, sort_order)
    values (p_code, btrim(p_name), nullif(btrim(p_description), ''), p_price_cents, p_billing_cycle, p_is_active, p_sort_order)
    returning id into v_id;
  else
    update public.addons
       set name = btrim(p_name),
           description = nullif(btrim(p_description), ''),
           price_cents = p_price_cents,
           billing_cycle = p_billing_cycle,
           is_active = p_is_active,
           sort_order = p_sort_order
     where id = p_addon_id;
    v_id := p_addon_id;
  end if;

  delete from public.addon_features where addon_id = v_id;
  insert into public.addon_features (addon_id, feature_key)
  select v_id, keys.feature_key from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key);

  delete from public.addon_meters where addon_id = v_id;
  insert into public.addon_meters (addon_id, meter_key, included_qty)
  select v_id, rows.meter_key, rows.included_qty
    from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer);

  -- Only the latest version of each plan code is something the caller could have seen and
  -- unticked. A row for an older version is kept: that version's subscribers keep being offered
  -- the add-on without an override.
  delete from public.plan_available_addons paa
   where paa.addon_id = v_id
     and not (paa.plan_id = any(coalesce(p_plan_ids, '{}'::uuid[])))
     and not exists (
       select 1
         from public.plans cur
         join public.plans newer on newer.code = cur.code and newer.version > cur.version
        where cur.id = paa.plan_id
     );
  insert into public.plan_available_addons (addon_id, plan_id)
  select v_id, ids.plan_id from unnest(coalesce(p_plan_ids, '{}'::uuid[])) as ids(plan_id)
  on conflict (plan_id, addon_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_addon(uuid, text, text, text, integer, public.billing_cycle, boolean, integer, text[], jsonb, uuid[])
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_upsert_addon(uuid, text, text, text, integer, public.billing_cycle, boolean, integer, text[], jsonb, uuid[])
  to service_role;

comment on function public.admin_upsert_addon(uuid, text, text, text, integer, public.billing_cycle, boolean, integer, text[], jsonb, uuid[]) is
  'Add-on catalog write. Price and billing cycle are locked while any non-cancelled subscription '
  'has the add-on attached (addon_price_has_live_attachments); grants are locked while any live '
  'attachment exists; availability rows for older plan versions are never removed by a save.';

do $$
declare
  v_fn  regprocedure := to_regprocedure(
    'public.admin_upsert_addon(uuid,text,text,text,integer,public.billing_cycle,boolean,integer,text[],jsonb,uuid[])');
  v_def text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924352000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if v_fn is null then
    raise exception 'public.admin_upsert_addon is missing';
  end if;
  v_def := pg_get_functiondef(v_fn);
  if v_def !~ 'addon_price_has_live_attachments' then
    raise exception 'admin_upsert_addon does not lock price and billing cycle while billed';
  end if;
  if v_def !~ 'addon_grants_have_live_attachments' then
    raise exception 'admin_upsert_addon lost its live-grant protection';
  end if;
  if v_def !~ 'newer\.version > cur\.version' then
    raise exception 'admin_upsert_addon still removes availability from older plan versions';
  end if;
  if has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute') then
    raise exception 'admin_upsert_addon is executable by a client role';
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'admin_upsert_addon is not executable by service_role';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924352000', 'addon_price_lock_and_version_availability') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/11] 20260924353000_admin_last_super_admin_guard.sql ───────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Never zero active super admins (user decision, board p-adm-admins)
--
-- Only a super admin can manage staff accounts (app/api/admin/admins/**), and nobody can change their
-- own account. That already makes it hard to remove the last active super admin from the console,
-- but not impossible: two super admins who deactivate or demote each other at the same moment each
-- see the other as "someone else is still active", and both succeed. The console is then locked to
-- everyone, and only a service-role script or the SQL editor can let anyone back in.
--
-- PATCH /api/admin/admins/[id] checks the rule before it writes (so it holds before this file is
-- applied); this trigger is what makes it hold under concurrency and for every other writer — the QA
-- scripts in scripts/, provision-demo-accounts.mjs, and the SQL editor itself.
--
-- How the two triggers work together
--   1. BEFORE UPDATE OF role, is_active / BEFORE DELETE, FOR EACH STATEMENT: take one transaction-
--      scoped advisory lock. It is taken before the statement locks any row, so two writers queue
--      here instead of each holding one super admin's row and waiting for the other's (a deadlock).
--      Updates that touch neither column (last_login_at on every sign-in) do not fire it.
--   2. BEFORE UPDATE OF role, is_active / BEFORE DELETE, FOR EACH ROW, only for a row that IS an active
--      super admin: if it will not be one afterwards, lock the other active super admin rows
--      (FOR UPDATE) and count them. None left -> refuse with check_violation and the prefix
--      `last_active_super_admin`, which the route turns into a 409 shown inline.
--   A row trigger sees the rows its own statement already changed, so a bulk update (the fixture
--   sweep) that would deactivate every active super admin is refused at the last one, and the whole
--   statement rolls back.
--   3. BEFORE TRUNCATE: truncate skips row triggers, so it is refused while any active super admin
--      exists. Nothing in this repository truncates admin_users.
--
-- Additive: two functions and four triggers, created idempotently. No data changes.
-- ---------------------------------------------------------------------------

create or replace function public.admin_users_serialize_super_admin_changes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('public.admin_users:last_active_super_admin', 0));
  return null;
end;
$$;

comment on function public.admin_users_serialize_super_admin_changes() is
  'Statement trigger on admin_users: one advisory lock per transaction, so changes that could remove an active super admin are made one at a time. 20260924353000.';

create or replace function public.admin_users_keep_an_active_super_admin()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_others integer;
begin
  -- The WHEN clause has already established that OLD is an active super admin.
  if tg_op = 'UPDATE' and new.role::text = 'super_admin' and new.is_active then
    return new;
  end if;

  perform 1
     from public.admin_users a
    where a.role::text = 'super_admin'
      and a.is_active
      and a.id <> old.id
      for update;

  select count(*)::integer
    into v_others
    from public.admin_users a
   where a.role::text = 'super_admin'
     and a.is_active
     and a.id <> old.id;

  if v_others = 0 then
    raise exception 'last_active_super_admin: % is the only active super admin', old.email
      using errcode = 'check_violation',
            hint = 'Make another account an active super admin first.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.admin_users_keep_an_active_super_admin() is
  'Row trigger on admin_users: refuses an update or delete that would leave no active super admin (last_active_super_admin, check_violation). Mirrored by lib/adminStaff/present.ts staffChangeRefusal. 20260924353000.';

create or replace function public.admin_users_refuse_truncate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from public.admin_users a where a.role::text = 'super_admin' and a.is_active) then
    raise exception 'last_active_super_admin: admin_users cannot be truncated while it holds an active super admin'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

comment on function public.admin_users_refuse_truncate() is
  'Truncate skips row triggers; refuses TRUNCATE admin_users while an active super admin exists. 20260924353000.';

revoke all on function public.admin_users_serialize_super_admin_changes() from public, anon, authenticated, tenant_app;
revoke all on function public.admin_users_keep_an_active_super_admin() from public, anon, authenticated, tenant_app;
revoke all on function public.admin_users_refuse_truncate() from public, anon, authenticated, tenant_app;

drop trigger if exists admin_users_serialize_update on public.admin_users;
create trigger admin_users_serialize_update
  before update of role, is_active on public.admin_users
  for each statement
  execute function public.admin_users_serialize_super_admin_changes();

drop trigger if exists admin_users_serialize_delete on public.admin_users;
create trigger admin_users_serialize_delete
  before delete on public.admin_users
  for each statement
  execute function public.admin_users_serialize_super_admin_changes();

drop trigger if exists admin_users_keep_super_admin_update on public.admin_users;
create trigger admin_users_keep_super_admin_update
  before update of role, is_active on public.admin_users
  for each row
  when (old.role::text = 'super_admin' and old.is_active)
  execute function public.admin_users_keep_an_active_super_admin();

drop trigger if exists admin_users_keep_super_admin_delete on public.admin_users;
create trigger admin_users_keep_super_admin_delete
  before delete on public.admin_users
  for each row
  when (old.role::text = 'super_admin' and old.is_active)
  execute function public.admin_users_keep_an_active_super_admin();

drop trigger if exists admin_users_refuse_truncate on public.admin_users;
create trigger admin_users_refuse_truncate
  before truncate on public.admin_users
  for each statement
  execute function public.admin_users_refuse_truncate();

-- Assertions ----------------------------------------------------------------------------------------

do $$
declare
  v_trigger text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924353000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  foreach v_trigger in array array[
    'admin_users_serialize_update',
    'admin_users_serialize_delete',
    'admin_users_keep_super_admin_update',
    'admin_users_keep_super_admin_delete',
    'admin_users_refuse_truncate'
  ] loop
    if not exists (
      select 1
        from pg_trigger t
       where t.tgrelid = 'public.admin_users'::regclass
         and t.tgname = v_trigger
         and not t.tgisinternal
         and t.tgenabled <> 'D'
    ) then
      raise exception '20260924353000: trigger % is missing or disabled on admin_users', v_trigger;
    end if;
  end loop;

  if pg_get_functiondef('public.admin_users_keep_an_active_super_admin()'::regprocedure) !~ 'for update' then
    raise exception '20260924353000: the guard does not lock the remaining super admin rows';
  end if;

  if not exists (select 1 from public.admin_users a where a.role::text = 'super_admin' and a.is_active) then
    raise notice '20260924353000: guard installed, but there is no active super admin today (run npm run seed:super-admin on an empty table)';
  end if;

  raise notice '20260924353000: admin_users can no longer lose its last active super admin';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924353000', 'admin_last_super_admin_guard') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/11] 20260924355000_admin_audit_summary.sql ────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Audit log figures (p-adm-audit-log): the four tiles above /admin/audit-log.
--
--   Entries today   rows since 00:00 UTC today, and how many distinct staff members wrote them
--   This week       rows in the last 7 days (a rolling window, not a calendar week — user decision)
--   Money actions   rows in the last 7 days whose action is in p_money_actions
--
-- The money list is passed in rather than written here, so there is one list: lib/audit/
-- moneyActions.ts (credit notes, invoice voids, manual payments, credit grants, billing.* and the
-- overage waivers). A function that hard-coded its own copy would drift the first time an action
-- was added.
--
-- p_actor_id carries the page's per-actor rule (user decision): a super admin passes null and
-- counts every row; anyone else passes their own admin id and counts only their own actions. The
-- rule is applied by the caller exactly as the list query applies it, so the tiles can never count
-- rows the table would not show.
--
-- One pass over the last 7 days on audit_log_ts_idx (ts desc). Read-only, security invoker,
-- service_role only — the same shape as admin_tenant_activity (20260924347000). Additive: one new
-- function, nothing existing is redefined.
-- ---------------------------------------------------------------------------

create or replace function public.admin_audit_summary(
  p_actor_id uuid default null,
  p_money_actions text[] default '{}'::text[]
)
returns table (
  day_start timestamptz,
  week_start timestamptz,
  today_count bigint,
  today_admins bigint,
  week_count bigint,
  money_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as day_start,
           now() - interval '7 days' as week_start
  ),
  recent as (
    select a.ts, a.actor_type::text as actor_type, a.actor_id, a.action
      from public.audit_log a, bounds b
     where a.ts >= b.week_start
       and (p_actor_id is null or a.actor_id = p_actor_id)
  )
  select b.day_start,
         b.week_start,
         count(r.ts) filter (where r.ts >= b.day_start),
         count(distinct r.actor_id) filter (where r.ts >= b.day_start and r.actor_type = 'admin'),
         count(r.ts),
         count(r.ts) filter (where r.action = any(coalesce(p_money_actions, '{}'::text[])))
    from bounds b
    left join recent r on true
   group by b.day_start, b.week_start;
$$;

comment on function public.admin_audit_summary(uuid, text[]) is
  'Figures above /admin/audit-log: rows today (UTC) and distinct staff today, rows and money actions in the last 7 days. p_actor_id null = every actor (super admin); otherwise only that admin''s rows. See 20260924355000.';

revoke all on function public.admin_audit_summary(uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_audit_summary(uuid, text[]) to service_role;

-- Assert the effect: the function exists with this signature, only service_role may run it, it
-- always answers exactly one row, and an actor that has never acted counts zero everywhere.
do $$
declare
  v_rows integer;
  v_today bigint;
  v_week bigint;
  v_money bigint;
  v_admins bigint;
begin
  -- The parse-checker runs this with a role that cannot create anything, so nothing above landed
  -- and there is nothing to assert. Same guard as 20260924346000.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924355000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.admin_audit_summary(uuid, text[])') is null then
    raise exception 'admin_audit_summary(uuid, text[]) was not created';
  end if;

  if not has_function_privilege('service_role', 'public.admin_audit_summary(uuid, text[])', 'execute') then
    raise exception 'service_role cannot execute admin_audit_summary';
  end if;
  if has_function_privilege('anon', 'public.admin_audit_summary(uuid, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.admin_audit_summary(uuid, text[])', 'execute') then
    raise exception 'admin_audit_summary is executable by anon or authenticated; it must be service_role only';
  end if;

  select count(*) into v_rows from public.admin_audit_summary(null, array['credit_note.approved']);
  if v_rows <> 1 then
    raise exception 'admin_audit_summary returned % rows; it must always return one', v_rows;
  end if;

  select s.today_count, s.week_count, s.money_count, s.today_admins
    into v_today, v_week, v_money, v_admins
    from public.admin_audit_summary(gen_random_uuid(), array['credit_note.approved']) s;
  if v_today <> 0 or v_week <> 0 or v_money <> 0 or v_admins <> 0 then
    raise exception 'admin_audit_summary counted rows for an actor that does not exist';
  end if;

  raise notice '20260924355000: admin_audit_summary in place';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924355000', 'admin_audit_summary') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/11] 20260924357000_admin_carrier_usage_and_deactivation_guard.sql ─────────
begin;

-- ---------------------------------------------------------------------------
-- Platform carrier usage, and no deactivating a carrier tenants still use (board p-adm-carriers)
--
-- The staff console's Carriers page is the platform library every tenant picks from (Settings ›
-- Carrier library, Appointments, the statement import). Deactivating a carrier hides it from those
-- pickers, drops the tenant's contract rows for it out of Settings › Carrier library, and leaves its
-- appointments showing "Carrier" instead of a name. Until now that happened with one click and no
-- count of who it would hit.
--
-- User decision: a carrier any tenant USES cannot be deactivated. "Uses" means, per tenant,
--   · an active contract   tenant_carriers.is_active (one active row per tenant and carrier), or
--   · an open appointment  appointments.status <> 'terminated' and not past terminated_at.
-- A super admin may override with a written reason; the route requires the reason and the role,
-- audits it, and calls admin_set_carrier_active, which is the only thing that raises the override.
--
-- What this file adds (additive and idempotent; one backfill of the legacy status column):
--   1. admin_carrier_usage(p_carrier_id)   per platform carrier: tenants, contract tenants,
--                                          appointment tenants, open and recorded appointments.
--   2. admin_carrier_usage_totals()        distinct tenants across the library, appointment totals.
--   3. carriers_platform_state()           BEFORE INSERT OR UPDATE row trigger on platform rows:
--        · keeps the legacy `status` column (active | paused | archived, carriers_status_check on the
--          live database) in step with is_active, whichever of the two a writer changed;
--        · refuses active -> inactive while the carrier is in use, unless the transaction-local
--          setting app.carrier_deactivation_override is 'on' (check_violation, prefix carrier_in_use,
--          counts as JSON in DETAIL, which the route turns into a 409).
--   4. admin_set_carrier_active(...)       the one writer of that setting. It uses
--        set_config(..., is_local => true) — SET LOCAL — never a session SET: TENANT_DB_URL is the
--        transaction-mode pooler, where a session setting would outlive this call and leak into
--        whoever gets the backend next. It resets the setting as soon as its update is done.
--   5. carriers_platform_code_key          a partial unique index on code for platform rows. The live
--        table's only uniqueness is (organization_id, code), and NULLs are distinct, so two platform
--        rows could share a code. Skipped with a notice if duplicates already exist.
--
-- Organization-owned rows (organization_id is not null, the organization-era CRM) are untouched by
-- every part of this file.
-- ---------------------------------------------------------------------------

-- 1. Usage per platform carrier ---------------------------------------------------------------------

create or replace function public.admin_carrier_usage(p_carrier_id uuid default null)
returns table (
  carrier_id uuid,
  tenants integer,
  contract_tenants integer,
  appointment_tenants integer,
  open_appointments integer,
  appointments integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with platform as (
    select c.id
      from public.carriers c
     where c.organization_id is null
       and (p_carrier_id is null or c.id = p_carrier_id)
  ),
  contracts as (
    select tc.carrier_id, tc.tenant_id
      from public.tenant_carriers tc
      join platform p on p.id = tc.carrier_id
     where tc.is_active
  ),
  appts as (
    select a.carrier_id,
           a.tenant_id,
           (a.status <> 'terminated' and (a.terminated_at is null or a.terminated_at >= current_date)) as is_open
      from public.appointments a
      join platform p on p.id = a.carrier_id
  ),
  users as (
    select carrier_id, tenant_id from contracts
    union
    select carrier_id, tenant_id from appts where is_open
  )
  select p.id as carrier_id,
         coalesce((select count(distinct u.tenant_id) from users u where u.carrier_id = p.id), 0)::integer,
         coalesce((select count(distinct k.tenant_id) from contracts k where k.carrier_id = p.id), 0)::integer,
         coalesce((select count(distinct x.tenant_id) from appts x where x.carrier_id = p.id and x.is_open), 0)::integer,
         coalesce((select count(*) from appts x where x.carrier_id = p.id and x.is_open), 0)::integer,
         coalesce((select count(*) from appts x where x.carrier_id = p.id), 0)::integer
    from platform p;
$$;

comment on function public.admin_carrier_usage(uuid) is
  'Staff console Carriers: per platform carrier, the tenants using it (active contract or open appointment), split by kind, plus open and recorded appointments. Also the deactivation guard''s count. 20260924357000.';

-- 2. Totals across the library ----------------------------------------------------------------------

create or replace function public.admin_carrier_usage_totals()
returns table (tenants integer, appointments integer, open_appointments integer)
language sql
stable
security invoker
set search_path = public
as $$
  with platform as (
    select c.id from public.carriers c where c.organization_id is null
  ),
  appts as (
    select a.tenant_id,
           (a.status <> 'terminated' and (a.terminated_at is null or a.terminated_at >= current_date)) as is_open
      from public.appointments a
      join platform p on p.id = a.carrier_id
  ),
  users as (
    select tc.tenant_id
      from public.tenant_carriers tc
      join platform p on p.id = tc.carrier_id
     where tc.is_active
    union
    select tenant_id from appts where is_open
  )
  select (select count(distinct tenant_id) from users)::integer,
         (select count(*) from appts)::integer,
         (select count(*) from appts where is_open)::integer;
$$;

comment on function public.admin_carrier_usage_totals() is
  'Staff console Carriers: distinct tenants using any platform carrier, and appointments recorded / open against platform carriers. 20260924357000.';

-- Backfill the legacy status column before the trigger exists, so this update is not re-interpreted.
update public.carriers
   set status = case when is_active then 'active' else 'archived' end
 where organization_id is null
   and status is distinct from (case when is_active then 'active' else 'archived' end);

-- 3. The row trigger --------------------------------------------------------------------------------

create or replace function public.carriers_platform_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usage record;
begin
  if new.organization_id is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := case when new.is_active then 'active' else 'archived' end;
    return new;
  end if;

  -- Whichever of the two the writer changed wins; the other follows.
  if new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'active' else 'archived' end;
  elsif new.status is distinct from old.status then
    new.is_active := (new.status = 'active');
    new.status := case when new.is_active then 'active' else 'archived' end;
  end if;

  if old.is_active and not new.is_active then
    select u.* into v_usage from public.admin_carrier_usage(new.id) u;
    if coalesce(v_usage.tenants, 0) > 0
       and coalesce(current_setting('app.carrier_deactivation_override', true), '') <> 'on' then
      raise exception 'carrier_in_use: % is used by % tenant(s)', new.code, v_usage.tenants
        using errcode = 'check_violation',
              detail = json_build_object(
                'tenants', v_usage.tenants,
                'contract_tenants', v_usage.contract_tenants,
                'appointment_tenants', v_usage.appointment_tenants,
                'open_appointments', v_usage.open_appointments,
                'appointments', v_usage.appointments
              )::text,
              hint = 'A super admin can deactivate it from the staff console with a recorded reason.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.carriers_platform_state() is
  'Row trigger on carriers (platform rows only): keeps status in step with is_active, and refuses deactivating a carrier tenants use (carrier_in_use, check_violation) unless admin_set_carrier_active raised the transaction-local override. 20260924357000.';

drop trigger if exists carriers_platform_state on public.carriers;
create trigger carriers_platform_state
  before insert or update on public.carriers
  for each row
  execute function public.carriers_platform_state();

-- 4. The one writer of the override -----------------------------------------------------------------

create or replace function public.admin_set_carrier_active(
  p_carrier_id uuid,
  p_is_active boolean,
  p_override_reason text default null
)
returns table (
  id uuid,
  code text,
  name text,
  is_active boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_current boolean;
begin
  select c.is_active into v_current
    from public.carriers c
   where c.id = p_carrier_id and c.organization_id is null
   for update;

  if not found then
    raise exception 'carrier_not_found: %', p_carrier_id using errcode = 'no_data_found';
  end if;

  if p_override_reason is not null then
    if length(trim(p_override_reason)) < 10 then
      raise exception 'override_reason_too_short' using errcode = 'check_violation';
    end if;
    -- SET LOCAL: scoped to this transaction, so it cannot leak through the pooler.
    perform set_config('app.carrier_deactivation_override', 'on', true);
  end if;

  if v_current is distinct from p_is_active then
    update public.carriers c set is_active = p_is_active where c.id = p_carrier_id;
  end if;

  -- Only the update above was meant to see it.
  perform set_config('app.carrier_deactivation_override', '', true);

  return query
    select c.id, c.code, c.name, c.is_active, c.sort_order, c.created_at, c.updated_at
      from public.carriers c
     where c.id = p_carrier_id;
end;
$$;

comment on function public.admin_set_carrier_active(uuid, boolean, text) is
  'Staff console Carriers: activates or deactivates a platform carrier. A non-null reason (10+ characters) raises the transaction-local override the deactivation guard honours; the route requires super_admin for it and audits it. 20260924357000.';

-- Grants: service role only (the staff console's API). Revoke first so re-running is exact.
revoke all on function public.admin_carrier_usage(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_carrier_usage_totals() from public, anon, authenticated, tenant_app;
revoke all on function public.carriers_platform_state() from public, anon, authenticated, tenant_app;
revoke all on function public.admin_set_carrier_active(uuid, boolean, text) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_carrier_usage(uuid) to service_role;
grant execute on function public.admin_carrier_usage_totals() to service_role;
grant execute on function public.admin_set_carrier_active(uuid, boolean, text) to service_role;

-- 5. One code per platform carrier ------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.carriers c
     where c.organization_id is null
     group by c.code
    having count(*) > 1
  ) then
    raise notice '20260924357000: carriers_platform_code_key skipped, two platform carriers share a code; the API still refuses new duplicates';
  else
    execute 'create unique index if not exists carriers_platform_code_key on public.carriers (code) where organization_id is null';
  end if;
end;
$$;

-- Assertions ----------------------------------------------------------------------------------------

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924357000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.admin_carrier_usage(uuid)') is null
     or to_regprocedure('public.admin_carrier_usage_totals()') is null
     or to_regprocedure('public.admin_set_carrier_active(uuid,boolean,text)') is null then
    raise exception '20260924357000: a carrier usage function is missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.carriers'::regclass
       and t.tgname = 'carriers_platform_state'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
  ) then
    raise exception '20260924357000: trigger carriers_platform_state is missing or disabled';
  end if;

  if pg_get_functiondef('public.admin_set_carrier_active(uuid,boolean,text)'::regprocedure)
       !~ 'set_config\(''app\.carrier_deactivation_override'', ''on'', true\)' then
    raise exception '20260924357000: the override is not transaction-local';
  end if;

  if exists (
    select 1 from public.carriers c
     where c.organization_id is null
       and c.status is distinct from (case when c.is_active then 'active' else 'archived' end)
  ) then
    raise exception '20260924357000: a platform carrier''s status disagrees with is_active';
  end if;

  if exists (
    select 1
      from public.admin_carrier_usage() u
     where u.tenants < greatest(u.contract_tenants, u.appointment_tenants)
        or u.open_appointments > u.appointments
  ) then
    raise exception '20260924357000: admin_carrier_usage returned inconsistent counts';
  end if;

  raise notice '20260924357000: carrier usage readable; carriers tenants use can no longer be deactivated without an override';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924357000', 'admin_carrier_usage_and_deactivation_guard') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/11] 20260924360000_credits_limits_one_allowance.sql ───────────────────────
begin;

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

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924360000', 'credits_limits_one_allowance') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/11] 20260924360100_overage_uses_the_enforced_allowance.sql ────────────────
begin;

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

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924360100', 'overage_uses_the_enforced_allowance') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/11] 20260925500000_admin_user_directory.sql ───────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Admin › Users: the directory with one lifecycle per row, counted by the one seat rule
--
-- The Users list shows four lifecycle states (Active, Invited, Suspended, Deactivated), filters by
-- them with server-side paging, and counts them in the tiles above the table. "Invited" is the one
-- seat rule's invited seat (lib/tenantTeam/seats.ts seatState, 20260924346000): an invited /
-- pending_verification person, OR an active person whose membership of this row's tenant was never
-- accepted. That needs tenant_users.accepted_at on the row, which admin_user_list does not carry.
--
-- Additive: a NEW view beside admin_user_list (which stays as it is for its other readers) and a new
-- stats function. Rows are the same rows admin_user_list returns (one per person per tenant; a person
-- in no tenant is one row), with three extra columns. lib/adminUsersList/directory.ts reads this view
-- and falls back to admin_user_list + a TypeScript pass until this file is applied.
--
-- The lifecycle CASE mirrors lib/adminUsersList/lifecycle.ts lifecycleOf, which calls seatState. Keep
-- the three in step (seats.ts, user_status_holds_seat, this CASE).
-- ---------------------------------------------------------------------------

-- 1. The view ---------------------------------------------------------------------------------------
-- Columns of admin_user_list from its latest definition (20260911141000), then accepted_at,
-- invited_at and lifecycle.

create or replace view public.admin_user_directory
with (security_invoker = true)
as
select
  u.id,
  u.name,
  u.email,
  u.phone,
  u.status,
  u.last_login_at,
  u.created_at,
  tu.tenant_id,
  t.name as tenant_name,
  tu.role as tenant_role,
  plan.code as plan_code,
  u.password_hash is not null as has_password,
  u.suspended_at,
  u.suspension_reason,
  (
    select count(distinct le.ip)
      from public.login_events le
     where le.user_id = u.id
       and le.success
       and le.ip is not null
       and le.ts > (now() - interval '24 hours')
  ) as distinct_ips_24h,
  tu.accepted_at,
  tu.invited_at,
  case
    when u.status::text in ('inactive', 'deactivated') then 'deactivated'
    when u.status::text = 'deleted' then 'deleted'
    when u.status::text = 'suspended' then 'suspended'
    when u.status::text in ('invited', 'pending_verification') then 'invited'
    -- A membership never accepted holds an invited seat, whatever the account-wide status says.
    when u.status::text = 'active' and tu.user_id is not null and tu.accepted_at is null then 'invited'
    when u.status::text = 'active' then 'active'
    else u.status::text
  end as lifecycle
from public.users u
left join public.tenant_users tu on tu.user_id = u.id
left join public.tenants t on t.id = tu.tenant_id
left join public.subscriptions subscription
  on subscription.tenant_id = tu.tenant_id
 and subscription.status <> 'cancelled'::public.subscription_status
left join public.plans plan on plan.id = subscription.plan_id;

comment on view public.admin_user_directory is
  'Admin Users list: admin_user_list plus accepted_at, invited_at and lifecycle (active / invited / suspended / deactivated / deleted) by the one seat rule. Read by lib/adminUsersList/directory.ts. 20260925500000.';

revoke all on public.admin_user_directory from public, anon, authenticated, tenant_app;
grant select on public.admin_user_directory to service_role;

-- 2. The tiles --------------------------------------------------------------------------------------
-- Every count is over the rows the list shows (deleted people excluded), so the tiles and the
-- "N of M users" line under the toolbar can never disagree.

create or replace function public.admin_user_directory_stats()
returns table (
  rows_total          integer,
  tenants             integer,
  tenantless          integer,
  active              integer,
  invited             integer,
  invited_stale       integer,
  suspended           integer,
  suspended_no_reason integer,
  deactivated         integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::integer,
    count(distinct d.tenant_id)::integer,
    count(*) filter (where d.tenant_id is null)::integer,
    count(*) filter (where d.lifecycle = 'active')::integer,
    count(*) filter (where d.lifecycle = 'invited')::integer,
    -- Age of the invitation: the membership's invited_at, or the account's creation for a person
    -- invited without a tenant.
    count(*) filter (
      where d.lifecycle = 'invited'
        and coalesce(d.invited_at, d.created_at) < now() - interval '7 days'
    )::integer,
    count(*) filter (where d.lifecycle = 'suspended')::integer,
    count(*) filter (where d.lifecycle = 'suspended' and nullif(btrim(coalesce(d.suspension_reason, '')), '') is null)::integer,
    count(*) filter (where d.lifecycle = 'deactivated')::integer
  from public.admin_user_directory d
  where d.status::text <> 'deleted';
$$;

comment on function public.admin_user_directory_stats() is
  'Admin Users list tiles: rows, tenants, tenantless rows and lifecycle counts over admin_user_directory (deleted excluded). 20260925500000.';

revoke all on function public.admin_user_directory_stats() from public, anon, authenticated, tenant_app;
grant execute on function public.admin_user_directory_stats() to service_role;

-- 3. Assertions -------------------------------------------------------------------------------------

do $$
declare
  v_bad integer;
begin
  -- Same guard as 20260924346000: a role that cannot create in public could not have applied the
  -- objects above (scripts/check-migrations.mjs parse-checks with such a role).
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925500000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.admin_user_directory') is null then
    raise exception 'admin_user_directory was not created';
  end if;
  if to_regprocedure('public.admin_user_directory_stats()') is null then
    raise exception 'admin_user_directory_stats was not created';
  end if;
  if has_table_privilege('anon', 'public.admin_user_directory', 'select') then
    raise exception 'admin_user_directory must not be readable by anon';
  end if;
  if has_function_privilege('anon', 'public.admin_user_directory_stats()', 'execute') then
    raise exception 'admin_user_directory_stats must not be executable by anon';
  end if;

  -- Same rows as admin_user_list, so the list and its counts describe one population.
  select abs((select count(*) from public.admin_user_directory) - (select count(*) from public.admin_user_list))
    into v_bad;
  if v_bad <> 0 then
    raise exception 'admin_user_directory returns % rows more or fewer than admin_user_list', v_bad;
  end if;

  -- Every row that holds a seat by the one seat rule is active, invited or suspended, and none else.
  select count(*) into v_bad
    from public.admin_user_directory d
   where (d.tenant_id is not null)
     and (d.lifecycle in ('active', 'invited', 'suspended')) <> coalesce(d.status::text in ('active', 'suspended', 'invited', 'pending_verification'), false);
  if v_bad <> 0 then
    raise exception 'admin_user_directory lifecycle disagrees with the one seat rule on % rows', v_bad;
  end if;

  raise notice '20260925500000: admin_user_directory and admin_user_directory_stats ready';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925500000', 'admin_user_directory') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/11] 20260925502000_trial_outcome_timestamps.sql ───────────────────────────
begin;

-- Record the moment a trial ends, and how (Admin › Trials, board p-adm-trials).
--
-- The Trials page's "Converted this month" and "Lapsed this month" tiles had nothing to count
-- from: no column says when a subscription stopped trialing. They were inferred from the first
-- successful payment or the cancellation date, and many cancelled trials carry no cancellation
-- date at all. Owner decision (2026-09-25): record it.
--
-- A BEFORE UPDATE trigger stamps the subscription the first time its status leaves 'trialing':
--   converted — the new status is a paying one (active, past_due, cancelling), the same reading
--               lib/trials/boardModel.ts isConvertedStatus uses;
--   lapsed    — anything else (cancelled, expired, …).
-- It is written once and never moved: a converted subscription later cancelled is still a trial
-- that converted. No backfill — history cannot be recovered honestly, so existing rows stay null
-- and the page keeps inferring for them (and says so on hover).

alter table public.subscriptions
  add column if not exists trial_outcome text,
  add column if not exists trial_outcome_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_trial_outcome_check') then
    alter table public.subscriptions add constraint subscriptions_trial_outcome_check
      check (trial_outcome is null or trial_outcome in ('converted', 'lapsed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_trial_outcome_pair_check') then
    alter table public.subscriptions add constraint subscriptions_trial_outcome_pair_check
      check ((trial_outcome is null) = (trial_outcome_at is null));
  end if;
end $$;

create or replace function public.record_subscription_trial_outcome()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'trialing'
     and new.status is distinct from 'trialing'
     and old.trial_outcome_at is null
     and new.trial_outcome_at is null then
    new.trial_outcome := case when new.status in ('active', 'past_due', 'cancelling') then 'converted' else 'lapsed' end;
    new.trial_outcome_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.record_subscription_trial_outcome() from public, anon, authenticated;

drop trigger if exists subscriptions_record_trial_outcome on public.subscriptions;
create trigger subscriptions_record_trial_outcome
  before update of status on public.subscriptions
  for each row
  execute function public.record_subscription_trial_outcome();

-- The month tiles read "ended this month"; the index keeps that a range scan as the table grows.
create index if not exists subscriptions_trial_outcome_at_idx
  on public.subscriptions (trial_outcome_at)
  where trial_outcome_at is not null;

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925502000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'trial_outcome_at') then
    raise exception 'subscriptions.trial_outcome_at is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'subscriptions' and t.tgname = 'subscriptions_record_trial_outcome' and not t.tgisinternal
  ) then
    raise exception 'subscriptions_record_trial_outcome trigger is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925502000', 'trial_outcome_timestamps') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/11] 20260925504000_template_drafts.sql ────────────────────────────────────
begin;

-- Template drafts (admin Templates page, board p-adm-templates).
--
-- The board splits templates into Published, Draft and Archived. Today a template has one flag,
-- is_active: true means tenants can pick it, false means they cannot. "Not offered" covers two
-- different things that the page must tell apart:
--
--   Draft     never offered to tenants yet — being built
--   Archived  was offered, then withdrawn
--
-- published_at records the first moment a template was offered. It is stamped by a trigger, not by
-- the application, so every path that makes a template active — admin_save_template (create), the
-- restore/publish PATCH — stamps it without each one having to remember. Once set it is never
-- cleared: archiving a published template keeps it "Archived", not "Draft".
--
-- Backfill: every template that exists before this column was created with is_active = true
-- (admin_save_template defaults to true, admin_duplicate_template always inserted true), so each one
-- was published at created_at, including the ones archived since. The backfill runs only in the
-- same statement block that adds the column, so re-running this file never marks a real draft as
-- published.
--
-- Duplicates start as drafts (owner decision, 2026-09-25). admin_duplicate_template used to insert
-- the copy active, so a copy was offered to every agency the moment it was made. It is redefined
-- below from its latest definition (20260902140000_la_1_4_duplicate_metadata_ambiguity_fix) with
-- one change — the copy is inserted is_active = false, published_at null — and the same signature,
-- return type and grants (0006 + 20260912360000: service_role only).
--
-- Nothing else changes: no row other than the new column is written, and tenant copies
-- (tenant_templates) are untouched.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'templates' and column_name = 'published_at'
  ) then
    alter table public.templates add column published_at timestamptz;
    update public.templates set published_at = created_at where published_at is null;
    comment on column public.templates.published_at is
      'First time the template was offered to tenants (is_active became true). Null = draft, never offered.';
  end if;
end;
$$;

create or replace function public.stamp_template_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and new.published_at is null then
    new.published_at := now();
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null and new.published_at is null then
    -- A template that was offered once stays "was offered": archiving is not un-publishing.
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_template_published_at() from public;

drop trigger if exists templates_stamp_published_at on public.templates;
create trigger templates_stamp_published_at
  before insert or update on public.templates
  for each row execute function public.stamp_template_published_at();

-- Same signature and return type as the live function, so create or replace is enough (no drop).
create or replace function public.admin_duplicate_template(p_template_id uuid, p_name text, p_created_by uuid default null)
returns table(template_id uuid, version integer)
language plpgsql security definer set search_path = public
as $$
declare source_row public.templates%rowtype; new_template_id uuid;
begin
  select * into source_row from public.templates where id = p_template_id;
  if not found then raise exception 'template_not_found'; end if;
  -- The copy is a draft: hidden from agencies until an admin publishes it.
  insert into public.templates (name, product_code, version, description, is_active, published_at, created_by)
  values (p_name, source_row.product_code, 1, source_row.description, false, null, coalesce(p_created_by, source_row.created_by)) returning id into new_template_id;
  insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select new_template_id, 1, f.field_key, f.label, f.type, f.is_required, f.options, f.sort_order, f.help_text, f.validation
  from public.template_fields f
  where f.template_id = p_template_id and f.version = source_row.version;
  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, 1, s.stage_key, s.label, s.stage_type, s.color, s.sort_order
  from public.template_stages s
  where s.template_id = p_template_id and s.version = source_row.version;
  insert into public.template_forms (template_id, version, form_definition)
  select new_template_id, 1, tf.form_definition
  from public.template_forms tf
  where tf.template_id = p_template_id and tf.version = source_row.version;
  template_id := new_template_id; version := 1; return next;
end;
$$;

revoke all on function public.admin_duplicate_template(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_duplicate_template(uuid, text, uuid) to service_role;

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925504000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'templates' and column_name = 'published_at'
  ) then
    raise exception 'templates.published_at is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.templates'::regclass and tgname = 'templates_stamp_published_at' and not tgisinternal
  ) then
    raise exception 'templates_stamp_published_at trigger is missing';
  end if;

  if exists (select 1 from public.templates where is_active and published_at is null) then
    raise exception 'an active template has no published_at';
  end if;

  if pg_get_functiondef('public.admin_duplicate_template(uuid,text,uuid)'::regprocedure) !~ 'is_active, published_at, created_by\)\s*values \(p_name, source_row\.product_code, 1, source_row\.description, false, null' then
    raise exception 'admin_duplicate_template does not insert the copy as a draft';
  end if;

  if has_function_privilege('anon', 'public.admin_duplicate_template(uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_duplicate_template(uuid,text,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_duplicate_template(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'admin_duplicate_template grants drifted (service_role only)';
  end if;

  raise notice '20260925504000: template drafts in place (published_at + stamp trigger, duplicates start as drafts)';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925504000', 'template_drafts') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [11/11] 20260925507000_state_disclosure_review.sql ────────────────────────────
begin;

-- State disclosures: propose, review, publish.
--
-- `state_disclosures` is read by the dialer before every call (lib/dialerScripts/service.ts): the
-- newest row for (state, product_code) whose effective_from has arrived is the wording the agent
-- must read. Any row written there is therefore live on its date, with no second pair of eyes.
--
-- This migration adds a holding table in front of it. Staff propose wording here; a DIFFERENT
-- admin approves it (or, when no other eligible admin is active, its author with a written
-- attestation), and only the approval writes into state_disclosures, in one transaction. The
-- dialer, its read, and confirm_call_disclosure are untouched, and no existing row is changed.
--
-- Nothing here writes disclosure wording. The table starts empty.

create table if not exists public.state_disclosure_proposals (
  id uuid primary key default gen_random_uuid(),
  product_code text not null check (product_code ~ '^[a-z0-9_]{1,80}$'),
  states text[] not null check (
    cardinality(states) between 1 and 51
    and array_to_string(states, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ),
  required_text text not null check (char_length(btrim(required_text)) between 1 and 8000),
  effective_from date not null,
  note text check (note is null or char_length(note) <= 2000),
  source text not null default 'editor' check (source in ('editor', 'import')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- Admins are deactivated rather than deleted, but a delete must not be blocked by history.
  proposed_by uuid references public.admin_users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references public.admin_users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  published_ids uuid[] not null default '{}',
  -- Written by an author who approved their own proposal because no other active admin could
  -- (see approve_state_disclosure_proposal). Null for every ordinary, second-admin approval.
  self_approval_attestation text check (
    self_approval_attestation is null or char_length(btrim(self_approval_attestation)) between 10 and 500
  ),
  constraint state_disclosure_proposals_review_shape check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null)
  ),
  -- Four eyes: whoever proposed the wording cannot be the one who approves it, unless they were the
  -- only eligible admin and left a written attestation.
  constraint state_disclosure_proposals_four_eyes check (
    status <> 'approved'
    or proposed_by is null
    or reviewed_by is distinct from proposed_by
    or self_approval_attestation is not null
  )
);

create index if not exists state_disclosure_proposals_status_idx
  on public.state_disclosure_proposals (status, proposed_at desc);
create index if not exists state_disclosure_proposals_product_idx
  on public.state_disclosure_proposals (product_code, effective_from);
create index if not exists state_disclosure_proposals_proposed_by_idx
  on public.state_disclosure_proposals (proposed_by);
create index if not exists state_disclosure_proposals_reviewed_by_idx
  on public.state_disclosure_proposals (reviewed_by);

alter table public.state_disclosure_proposals enable row level security;

-- Staff-console data only: no tenant ever reads a proposal, so there is no tenant_app policy and
-- no grant beyond service_role. No DELETE either: a proposal is part of the record.
revoke all on public.state_disclosure_proposals from anon, authenticated, public, tenant_app;
grant select, insert, update on public.state_disclosure_proposals to service_role;

-- Approve one pending proposal and publish it, atomically.
--
-- Refuses (and writes nothing) when: the proposal is not pending; the reviewer is not an active
-- admin; the reviewer is the proposer while another active super_admin or platform_config admin
-- exists; the effective date is not in the future (UTC), so a new version can never cover a call
-- already placed today; the text still carries the seed's placeholder marker; or a version for the
-- same state, product and date already exists (the unique key would otherwise turn this into an
-- overwrite of wording that may already be on record).
--
-- Self-approval: a platform with a single eligible admin must not be locked out of ever publishing.
-- When no OTHER active super_admin / platform_config admin exists, the proposer may approve their
-- own proposal, but only with a 10-500 character written attestation, stored on the proposal.
create or replace function public.approve_state_disclosure_proposal(
  p_proposal_id uuid,
  p_reviewer uuid,
  p_review_note text default null,
  p_attestation text default null
)
returns public.state_disclosure_proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.state_disclosure_proposals;
  v_today date := (now() at time zone 'utc')::date;
  v_conflicts text;
  v_ids uuid[];
  v_attestation text := nullif(btrim(coalesce(p_attestation, '')), '');
  v_self boolean;
begin
  select * into v_row from public.state_disclosure_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'PROPOSAL_NOT_FOUND';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'PROPOSAL_NOT_PENDING';
  end if;
  if p_reviewer is null
     or not exists (select 1 from public.admin_users a where a.id = p_reviewer and a.is_active) then
    raise exception 'REVIEWER_NOT_ACTIVE';
  end if;
  v_self := v_row.proposed_by is not null and v_row.proposed_by = p_reviewer;
  if v_self then
    if exists (
      select 1 from public.admin_users a
       where a.id <> p_reviewer
         and a.is_active
         and a.role::text in ('super_admin', 'platform_config')
    ) then
      raise exception 'REVIEWER_IS_PROPOSER';
    end if;
    if v_attestation is null or char_length(v_attestation) not between 10 and 500 then
      raise exception 'ATTESTATION_REQUIRED';
    end if;
  else
    -- Only a self-approval carries an attestation.
    v_attestation := null;
  end if;
  if v_row.effective_from <= v_today then
    raise exception 'EFFECTIVE_DATE_NOT_IN_FUTURE';
  end if;
  if ltrim(v_row.required_text) like '[PLACEHOLDER%' then
    raise exception 'PLACEHOLDER_TEXT';
  end if;

  select string_agg(d.state, ',' order by d.state) into v_conflicts
    from public.state_disclosures d
   where d.product_code = v_row.product_code
     and d.state = any (v_row.states)
     and d.effective_from = v_row.effective_from;
  if v_conflicts is not null then
    raise exception 'VERSION_EXISTS:%', v_conflicts;
  end if;

  with inserted as (
    insert into public.state_disclosures (state, product_code, required_text, effective_from)
    select distinct s, v_row.product_code, v_row.required_text, v_row.effective_from
      from unnest(v_row.states) as s
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from inserted;

  update public.state_disclosure_proposals
     set status = 'approved',
         reviewed_by = p_reviewer,
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
         published_ids = v_ids,
         self_approval_attestation = v_attestation
   where id = p_proposal_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.approve_state_disclosure_proposal(uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.approve_state_disclosure_proposal(uuid, uuid, text, text) to service_role;

-- Whether this admin may approve their own proposals: true only when no OTHER active super_admin
-- or platform_config admin exists. The review screen asks this rather than deciding it itself.
create or replace function public.state_disclosure_self_approval_allowed(p_admin uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.admin_users a
     where a.id <> p_admin
       and a.is_active
       and a.role::text in ('super_admin', 'platform_config')
  );
$$;

revoke all on function public.state_disclosure_self_approval_allowed(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.state_disclosure_self_approval_allowed(uuid) to service_role;

-- Assertions ----------------------------------------------------------------------------------------

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925507000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.state_disclosure_proposals') is null then
    raise exception '20260925507000: state_disclosure_proposals is missing';
  end if;
  if not exists (
    select 1 from pg_class c where c.oid = 'public.state_disclosure_proposals'::regclass and c.relrowsecurity
  ) then
    raise exception '20260925507000: RLS is not enabled on state_disclosure_proposals';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'state_disclosure_proposals_four_eyes'
       and conrelid = 'public.state_disclosure_proposals'::regclass
  ) then
    raise exception '20260925507000: the four-eyes constraint is missing';
  end if;
  if to_regprocedure('public.approve_state_disclosure_proposal(uuid, uuid, text, text)') is null then
    raise exception '20260925507000: approve_state_disclosure_proposal is missing';
  end if;
  if has_function_privilege('authenticated', 'public.approve_state_disclosure_proposal(uuid, uuid, text, text)', 'EXECUTE') then
    raise exception '20260925507000: approve_state_disclosure_proposal is executable by authenticated';
  end if;
  if to_regprocedure('public.state_disclosure_self_approval_allowed(uuid)') is null then
    raise exception '20260925507000: state_disclosure_self_approval_allowed is missing';
  end if;
  if pg_get_functiondef('public.approve_state_disclosure_proposal(uuid, uuid, text, text)'::regprocedure) !~ 'ATTESTATION_REQUIRED' then
    raise exception '20260925507000: self-approval does not require an attestation';
  end if;

  raise notice '20260925507000: disclosure wording now goes through a second admin before the dialer sees it';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925507000', 'state_disclosure_review') on conflict do nothing;
  end if;
end $bundle$;
commit;
