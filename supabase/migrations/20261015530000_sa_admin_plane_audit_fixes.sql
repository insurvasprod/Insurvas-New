-- SA admin plane · audit fixes (2026-10-15)
--
-- 1. admin_update_user_with_email_change names its tenant.
--    It picked the user's tenant with `tenant_users ... limit 1` and no order, so for a user in two
--    tenants (workspace switching) an admin edit changed the role, and ran the last-owner guard, in
--    whichever tenant Postgres returned first. It now takes p_tenant_id: given, the user must be a
--    member of exactly that tenant (TENANT_MEMBERSHIP_NOT_FOUND otherwise); omitted, the edit is
--    refused when the user belongs to more than one (TENANT_AMBIGUOUS). The route sends the tenant
--    of the row being edited. Redefined from its latest definition (20260911142000); the old
--    8-argument signature is dropped so PostgREST has one function to resolve, and p_tenant_id
--    defaults to null so an 8-argument call still reaches it.
--
-- 2. Create tenant sets plan, billing and trial (doc 2 §5.3).
--    admin_assign_subscription_with_trial is admin_assign_subscription (latest: 20260912510000) with
--    an optional trial length; admin_assign_subscription becomes a wrapper passing null, so the two
--    can never disagree about plan guards. admin_create_tenant_with_billing provisions the tenant,
--    the owner invitation (admin_attach_user_to_tenant, as before) and the subscription in one
--    transaction, and records the billing choice:
--      card     billing_mode 'automatic' — the owner pays through checkout
--      manual   billing_mode 'manual'    — invoiced, paid by bank transfer
--      comped   billing_mode 'manual' + a tenant_comps row with its mandatory reason, no trial.
--    "The comped option needs a mandatory reason field and shows up in a report. Free accounts
--    multiply silently otherwise." tenant_comps is that report's source (GET /api/admin/tenants/comped).

-- --------------------------------------------------------------------------
-- 1. Edit a user in a named tenant
-- --------------------------------------------------------------------------

drop function if exists public.admin_update_user_with_email_change(uuid, text, text, text, text, text, timestamptz, uuid);

create or replace function public.admin_update_user_with_email_change(
  p_user_id         uuid,
  p_name            text,
  p_phone           text,
  p_role            text,
  p_requested_email text,
  p_token_hash      text,
  p_expires_at      timestamptz,
  p_created_by      uuid,
  p_tenant_id       uuid default null
)
returns table (
  old_name             text,
  new_name             text,
  old_phone            text,
  new_phone            text,
  old_role             text,
  new_role             text,
  email_change_created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user         public.users%rowtype;
  v_tenant       uuid;
  v_old_role     text;
  v_owner_count  integer;
  v_memberships  integer;
  v_email_change boolean := false;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;

  -- The tenant the role belongs to, never a guess.
  if p_tenant_id is not null then
    select tu.tenant_id, tu.role::text into v_tenant, v_old_role
      from public.tenant_users tu
     where tu.user_id = p_user_id and tu.tenant_id = p_tenant_id;
    if v_tenant is null then
      raise exception 'TENANT_MEMBERSHIP_NOT_FOUND' using errcode = 'no_data_found';
    end if;
  else
    select count(*)::integer into v_memberships from public.tenant_users tu where tu.user_id = p_user_id;
    if v_memberships > 1 then
      raise exception 'TENANT_AMBIGUOUS' using errcode = 'check_violation';
    end if;
    select tu.tenant_id, tu.role::text into v_tenant, v_old_role
      from public.tenant_users tu where tu.user_id = p_user_id;
  end if;

  -- LA-0.2: "a tenant must always keep at least one owner — removing or demoting the last one is
  -- blocked". This is that guard, and it is in the database rather than the form because the form
  -- is not the only caller.
  if v_tenant is not null and v_old_role = 'owner' and p_role <> 'owner' then
    select count(*)::integer into v_owner_count
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_tenant and tu.role = 'owner' and u.status <> 'deleted';
    if v_owner_count <= 1 then
      raise exception 'LAST_OWNER' using errcode = 'check_violation';
    end if;
  end if;

  -- Checked before anything is written. The whole function is one transaction, so a clash leaves
  -- the name, phone and role untouched too.
  if lower(btrim(p_requested_email)) <> lower(v_user.email)
     and exists (select 1 from public.users u
                  where lower(u.email) = lower(btrim(p_requested_email)) and u.id <> p_user_id) then
    raise exception 'EMAIL_ALREADY_REGISTERED' using errcode = 'unique_violation';
  end if;

  update public.users
     set name  = coalesce(nullif(btrim(p_name), ''), name),
         phone = p_phone
   where id = p_user_id;

  if v_tenant is not null and p_role is not null and p_role <> v_old_role then
    update public.tenant_users set role = p_role::public.tenant_user_role
     where tenant_id = v_tenant and user_id = p_user_id;
    -- A role change takes effect on the user's next REQUEST, not their next login
    -- (LA-0.2 criterion 5), which is what bumping session_version buys.
    update public.users set session_version = coalesce(session_version, 0) + 1 where id = p_user_id;
  end if;

  if lower(btrim(p_requested_email)) <> lower(v_user.email) then
    -- Staged, never applied here. Supersede any outstanding request so only one confirmation link
    -- can ever work.
    update public.user_invitations
       set accepted_at = now()
     where user_id = p_user_id and purpose = 'email_change' and accepted_at is null;

    insert into public.user_invitations (user_id, purpose, token_hash, new_email, expires_at, created_by)
    values (p_user_id, 'email_change', p_token_hash, lower(btrim(p_requested_email)), p_expires_at, p_created_by);

    v_email_change := true;
  end if;

  return query
    select v_user.name, coalesce(nullif(btrim(p_name), ''), v_user.name),
           v_user.phone, p_phone,
           v_old_role, coalesce(p_role, v_old_role),
           v_email_change;
end;
$$;

comment on function public.admin_update_user_with_email_change(uuid, text, text, text, text, text, timestamptz, uuid, uuid) is
  'SA-1.3 · Edits a user''s name, phone and role IN ONE NAMED TENANT (p_tenant_id; refused as '
  'TENANT_AMBIGUOUS when omitted for a user in several), staging any email change. LAST_OWNER guard '
  'counts non-deleted owners of that tenant.';

revoke all on function public.admin_update_user_with_email_change(uuid, text, text, text, text, text, timestamptz, uuid, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_update_user_with_email_change(uuid, text, text, text, text, text, timestamptz, uuid, uuid)
  to service_role;

-- --------------------------------------------------------------------------
-- 2a. Assign a subscription, with an optional trial length
-- --------------------------------------------------------------------------

create or replace function public.admin_assign_subscription_with_trial(
  p_tenant_id     uuid,
  p_plan_id       uuid,
  p_billing_cycle text default 'monthly',
  p_start         timestamp with time zone default now(),
  p_trial_days    integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_trial_days integer;
  v_price integer;
  v_status public.subscription_status;
  v_trial_ends timestamptz;
begin
  if not exists (
    select 1 from public.tenants where id = p_tenant_id
  ) then
    raise exception 'tenant_not_found' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1
      from public.subscriptions
     where tenant_id = p_tenant_id
       and status <> 'cancelled'
  ) then
    raise exception 'already_subscribed';
  end if;

  if not exists (
    select 1 from public.plans where id = p_plan_id
  ) then
    raise exception 'plan_not_found';
  end if;

  if exists (
    select 1 from public.plans where id = p_plan_id and is_archived
  ) then
    raise exception 'plan_archived';
  end if;

  if p_trial_days is not null and (p_trial_days < 0 or p_trial_days > 90) then
    raise exception 'trial_days_out_of_range' using errcode = 'check_violation';
  end if;

  select case p_billing_cycle
           when 'monthly' then pp.price_monthly_cents
           when 'quarterly' then pp.price_quarterly_cents
           when 'yearly' then pp.price_yearly_cents
         end,
         pp.trial_days
    into v_price, v_trial_days
    from public.plan_prices pp
   where pp.plan_id = p_plan_id;

  if v_price is null then
    raise exception 'cycle_not_offered';
  end if;

  -- An explicit length (0 = start billing now) overrides the plan's own trial.
  if p_trial_days is not null then
    v_trial_days := p_trial_days;
  end if;

  if coalesce(v_trial_days, 0) > 0 then
    v_status := 'trialing';
    v_trial_ends := p_start + (v_trial_days || ' days')::interval;
  else
    v_status := 'active';
    v_trial_ends := null;
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, billing_cycle, started_at,
    current_period_start, current_period_end, trial_ends_at
  ) values (
    p_tenant_id,
    p_plan_id,
    v_status,
    p_billing_cycle::public.billing_cycle,
    p_start,
    p_start,
    public.period_end_for(p_start, p_billing_cycle::public.billing_cycle),
    v_trial_ends
  )
  returning id into v_id;

  perform public.refresh_tenant_entitlement(p_tenant_id);
  return v_id;
end;
$function$;

comment on function public.admin_assign_subscription_with_trial(uuid, uuid, text, timestamptz, integer) is
  'SA-2.7 + doc 2 §5.3. Assigns only an active, sellable plan and refuses a second live subscription. '
  'p_trial_days (0–90) overrides the plan''s trial; null keeps it; 0 starts billing now.';

revoke all on function public.admin_assign_subscription_with_trial(uuid, uuid, text, timestamptz, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_assign_subscription_with_trial(uuid, uuid, text, timestamptz, integer)
  to service_role;

-- The original signature stays (routes and scripts call it), as a wrapper: one body, one set of guards.
create or replace function public.admin_assign_subscription(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_billing_cycle text default 'monthly',
  p_start timestamp with time zone default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return public.admin_assign_subscription_with_trial(p_tenant_id, p_plan_id, p_billing_cycle, p_start, null);
end;
$function$;

comment on function public.admin_assign_subscription(uuid, uuid, text, timestamptz) is
  'SA-2.7 compatibility repair. Assigns only an active, sellable plan and refuses a second live subscription. '
  'Delegates to admin_assign_subscription_with_trial with the plan''s own trial.';

revoke all on function public.admin_assign_subscription(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_assign_subscription(uuid, uuid, text, timestamptz)
  to service_role;

-- --------------------------------------------------------------------------
-- 2b. Comped tenants, with their reason
-- --------------------------------------------------------------------------

create table if not exists public.tenant_comps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  reason      text not null,
  created_by  uuid references public.admin_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  constraint tenant_comps_reason_check check (char_length(btrim(reason)) between 5 and 500)
);

comment on table public.tenant_comps is
  'Doc 2 §5.3 · A tenant given the platform free of charge, with the mandatory reason. One open row '
  '(ended_at null) per comped tenant. Written only by admin_create_tenant_with_billing; read by the '
  'comped-tenants report (GET /api/admin/tenants/comped).';

create unique index if not exists tenant_comps_one_open_idx
  on public.tenant_comps (tenant_id) where ended_at is null;

alter table public.tenant_comps enable row level security;

-- Written only through the security-definer function below. Supabase's default privileges give
-- service_role every privilege on a new table, so its writes are revoked explicitly.
revoke all on table public.tenant_comps from public, anon, authenticated, tenant_app;
revoke insert, update, delete, truncate on table public.tenant_comps from service_role;
grant select on table public.tenant_comps to service_role;

-- --------------------------------------------------------------------------
-- 2c. Create a tenant with its plan, billing choice and trial
-- --------------------------------------------------------------------------

create or replace function public.admin_create_tenant_with_billing(
  p_user_id      uuid,
  p_owner_name   text,
  p_owner_email  text,
  p_tenant_name  text,
  p_plan_id      uuid,
  p_billing      text,
  p_comp_reason  text,
  p_trial_days   integer,
  p_token_hash   text,
  p_expires_at   timestamptz,
  p_created_by   uuid
)
returns table (user_id uuid, tenant_id uuid, subscription_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid;
  v_tenant uuid;
  v_sub    uuid;
  v_reason text := nullif(btrim(coalesce(p_comp_reason, '')), '');
begin
  if p_billing is null or p_billing not in ('card', 'manual', 'comped') then
    raise exception 'billing_invalid' using errcode = 'check_violation';
  end if;
  if p_plan_id is null then
    raise exception 'plan_required' using errcode = 'check_violation';
  end if;
  if p_billing = 'comped' then
    if v_reason is null or char_length(v_reason) < 5 then
      raise exception 'comp_reason_required' using errcode = 'check_violation';
    end if;
    if coalesce(p_trial_days, 0) <> 0 then
      raise exception 'comped_has_no_trial' using errcode = 'check_violation';
    end if;
  elsif v_reason is not null then
    raise exception 'comp_reason_only_for_comped' using errcode = 'check_violation';
  end if;

  -- Tenant, owner membership and invitation, exactly as every other provisioning path does them.
  select a.user_id, a.tenant_id into v_user, v_tenant
    from public.admin_attach_user_to_tenant(
      p_user_id, p_owner_name, p_owner_email, null, null, p_tenant_name, 'owner',
      p_token_hash, p_expires_at, p_created_by
    ) a;

  v_sub := public.admin_assign_subscription_with_trial(
    v_tenant, p_plan_id, 'monthly', now(),
    case when p_billing = 'comped' then 0 else p_trial_days end
  );

  update public.tenants
     set billing_mode = case when p_billing = 'card' then 'automatic' else 'manual' end
   where id = v_tenant;

  if p_billing = 'comped' then
    insert into public.tenant_comps (tenant_id, reason, created_by)
    values (v_tenant, v_reason, p_created_by);
  end if;

  return query select v_user, v_tenant, v_sub;
end;
$$;

comment on function public.admin_create_tenant_with_billing(uuid, text, text, text, uuid, text, text, integer, text, timestamptz, uuid) is
  'Doc 2 §5.3 · Creates a tenant with its invited owner, plan and monthly subscription in one '
  'transaction. p_billing card | manual | comped (comped needs p_comp_reason, has no trial, and is '
  'recorded in tenant_comps). p_trial_days null = the plan''s trial, 0 = start billing now.';

revoke all on function public.admin_create_tenant_with_billing(uuid, text, text, text, uuid, text, text, integer, text, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_create_tenant_with_billing(uuid, text, text, text, uuid, text, text, integer, text, timestamptz, uuid)
  to service_role;

-- --------------------------------------------------------------------------
-- Self-check
-- --------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.admin_update_user_with_email_change(uuid,text,text,text,text,text,timestamptz,uuid)') is not null then
    raise exception 'the 8-argument admin_update_user_with_email_change still exists';
  end if;
  if to_regprocedure('public.admin_update_user_with_email_change(uuid,text,text,text,text,text,timestamptz,uuid,uuid)') is null then
    raise exception 'admin_update_user_with_email_change(…, p_tenant_id) is missing';
  end if;
  if to_regprocedure('public.admin_assign_subscription_with_trial(uuid,uuid,text,timestamptz,integer)') is null
     or to_regprocedure('public.admin_create_tenant_with_billing(uuid,text,text,text,uuid,text,text,integer,text,timestamptz,uuid)') is null then
    raise exception 'a provisioning function is missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_comps', 'INSERT')
     or has_table_privilege('service_role', 'public.tenant_comps', 'UPDATE')
     or has_table_privilege('service_role', 'public.tenant_comps', 'DELETE')
     or has_table_privilege('service_role', 'public.tenant_comps', 'TRUNCATE') then
    raise exception 'tenant_comps must be written only by admin_create_tenant_with_billing (service_role still has insert/update/delete/truncate)';
  end if;
  if has_table_privilege('tenant_app', 'public.tenant_comps', 'SELECT') then
    raise exception 'tenant_app must not read tenant_comps';
  end if;
end;
$$;
