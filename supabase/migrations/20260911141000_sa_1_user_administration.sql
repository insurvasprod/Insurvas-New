-- SA-1 · User administration (SA-1.1, SA-1.4, SA-1.5, and the invitation store SA-1.2 needs)
--
-- `/api/admin/users` and `/admin/users` currently return 500: `public.admin_user_list` does not
-- exist. Neither do `user_invitations`, `users.suspended_at`, `users.suspension_reason`, or five
-- of the six `admin_*` user functions the routes call.
--
-- The view definition itself already existed in
-- `20260903340000_sa_1_1_admin_users_live_plan.sql` and could never be applied, because it joins
-- `subscriptions` and `plans` — which did not exist until SA-2.2. They do now, so it is repeated
-- here (unchanged in substance) as part of a migration that can actually run.
--
-- TWO FUNCTIONS ARE DELIBERATELY NOT IN THIS MIGRATION. `admin_create_user` and
-- `admin_update_user_with_email_change` cannot be written as SQL-only transactions any more:
-- `public.users.id` has no default and carries `users_id_fkey` to `auth.users`, because LA-0 made
-- Supabase Auth the credential authority for the tenant plane. A function that inserts a brand-new
-- `public.users` row therefore has nothing to point at, and creating the `auth.users` row from SQL
-- means hand-writing `encrypted_password` and an `auth.identities` row, which is exactly the kind
-- of thing that breaks quietly on the next Auth upgrade. The same applies to changing an email:
-- the address lives in `auth.users` too, so a SQL-only update would leave the two halves
-- disagreeing about who the user is.
--
-- That is an architectural decision, not an implementation detail — see
-- docs/architecture/sa-completion-backlog.md. Everything else in SA-1 works without it.

-- --------------------------------------------------------------------------
-- Lifecycle columns (SA-1.4)
-- --------------------------------------------------------------------------

alter table public.users add column if not exists suspended_at timestamptz;
alter table public.users add column if not exists suspension_reason text;

comment on column public.users.suspension_reason is
  'SA-1.4 · Why this user was suspended. Shown to the admin on the users screen, and the reason a '
  'suspended user is told when they try to sign in.';

-- --------------------------------------------------------------------------
-- Invitation / token store (SA-1.2)
--
-- `users.status` is `text` in this project, not the declared `user_status` enum. Deliberately left
-- alone: it is a column the organizations-era CRM shares, and converting a live column's type is a
-- far bigger change than this migration should make. The transition guard below validates the
-- value instead. `user_token_purpose` is new here, so it can be a real enum.
-- --------------------------------------------------------------------------

do $$ begin
  create type public.user_token_purpose as enum ('invite', 'password_reset', 'email_change', 'email_verification');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_invitations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  purpose     public.user_token_purpose not null default 'invite',
  token_hash  text not null,
  new_email   text,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  partner_id  uuid
);

comment on table public.user_invitations is
  'SA-1.2 · One row per issued token. Only the HASH is stored — the token itself exists only in '
  'the email that carried it, so a database read cannot be replayed as an account takeover.';

comment on column public.user_invitations.new_email is
  'For purpose = email_change: the address being moved to, held here until the token is accepted '
  'so an unconfirmed change never lands on the account.';

do $$ begin
  alter table public.user_invitations add constraint user_invitations_user_id_fkey
    foreign key (user_id) references public.users (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_invitations add constraint user_invitations_token_hash_key unique (token_hash);
exception when duplicate_table or duplicate_object then null; end $$;

-- At most one live token per user per purpose. Replacing an invitation must invalidate the old
-- one, or a resend would leave two working links to the same account.
create unique index if not exists user_invitations_one_live_idx
  on public.user_invitations (user_id, purpose) where accepted_at is null;

create index if not exists user_invitations_expiry_idx on public.user_invitations (expires_at) where accepted_at is null;

alter table public.user_invitations enable row level security;
drop policy if exists user_invitations_service_role_only on public.user_invitations;
create policy user_invitations_service_role_only on public.user_invitations
  for all to service_role using (true) with check (true);
revoke all on public.user_invitations from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.user_invitations to service_role;

-- --------------------------------------------------------------------------
-- admin_user_list (SA-1.1)
--
-- Repeated from 20260903340000 so a database built from these migrations gets it. The tenant's
-- LIVE subscription plan, not the legacy free-text tenants.plan_code.
-- --------------------------------------------------------------------------

create or replace view public.admin_user_list as
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
    -- The shared-account signal (SA-1.5): one person does not sign in from six addresses in a day.
    select count(distinct le.ip)
      from public.login_events le
     where le.user_id = u.id
       and le.success
       and le.ip is not null
       and le.ts > (now() - interval '24 hours')
  ) as distinct_ips_24h
from public.users u
left join public.tenant_users tu on tu.user_id = u.id
left join public.tenants t on t.id = tu.tenant_id
left join public.subscriptions subscription
  on subscription.tenant_id = tu.tenant_id
 and subscription.status <> 'cancelled'::public.subscription_status
left join public.plans plan on plan.id = subscription.plan_id;

comment on view public.admin_user_list is
  'SA-1.1 · The platform user directory. Read by lib/users/list.ts, which filters, searches and '
  'paginates against it.';

revoke all on public.admin_user_list from public, anon, authenticated, tenant_app;
grant select on public.admin_user_list to service_role;

-- --------------------------------------------------------------------------
-- admin_user_stats (SA-1.1) — the counts above the directory
-- --------------------------------------------------------------------------

create or replace function public.admin_user_stats()
returns table (total integer, active integer, inactive integer, suspended integer, signed_up_this_month integer)
language sql
stable
security invoker
set search_path = public
as $$
  -- 'deleted' is excluded from every count, matching the directory itself: a deleted user is not
  -- on the platform, and counting them would make the total disagree with the list beneath it.
  select
    count(*) filter (where u.status <> 'deleted')::integer,
    count(*) filter (where u.status = 'active')::integer,
    count(*) filter (where u.status = 'inactive')::integer,
    count(*) filter (where u.status = 'suspended')::integer,
    count(*) filter (where u.status <> 'deleted' and u.created_at >= date_trunc('month', now()))::integer
  from public.users u;
$$;

-- --------------------------------------------------------------------------
-- admin_login_activity_stats (SA-1.5)
-- --------------------------------------------------------------------------

create or replace function public.admin_login_activity_stats()
returns table (logins_today integer, logins_this_week integer, failed_today integer, active_last_15_min integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where le.success and le.ts >= date_trunc('day', now()))::integer,
    count(*) filter (where le.success and le.ts >= date_trunc('week', now()))::integer,
    -- Failures matter on their own: a spike is the brute-force signal SA-6.2 will act on.
    count(*) filter (where not le.success and le.ts >= date_trunc('day', now()))::integer,
    count(distinct le.user_id) filter (where le.success and le.ts > now() - interval '15 minutes')::integer
  from public.login_events le;
$$;

-- --------------------------------------------------------------------------
-- admin_set_user_status (SA-1.4)
--
-- Error strings are fixed by lib/users/setStatus.ts, which turns them into 409s:
-- USER_ALREADY_IN_STATE, USER_TRANSITION_NOT_ALLOWED, seat_limit_reached:<used>:<max>.
-- --------------------------------------------------------------------------

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
  v_tenant  uuid;
  v_max     integer;
  v_used    integer;
  v_allowed boolean;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;

  if p_status not in ('pending_verification', 'active', 'inactive', 'suspended', 'deleted') then
    raise exception 'USER_TRANSITION_NOT_ALLOWED: unknown status %', p_status using errcode = 'check_violation';
  end if;

  if v_user.status = p_status then
    raise exception 'USER_ALREADY_IN_STATE' using errcode = 'check_violation';
  end if;

  -- SA-1.4's lifecycle. Deletion is terminal; everything else is reversible, which is why
  -- hard deletion was descoped in favour of a status.
  v_allowed := case
    when v_user.status = 'deleted' then false
    when p_status = 'deleted' then true
    when p_status = 'active' then v_user.status in ('inactive', 'suspended', 'pending_verification')
    when p_status = 'inactive' then v_user.status in ('active', 'suspended')
    when p_status = 'suspended' then v_user.status in ('active', 'inactive')
    when p_status = 'pending_verification' then false
    else false
  end;

  if not v_allowed then
    raise exception 'USER_TRANSITION_NOT_ALLOWED: % -> %', v_user.status, p_status using errcode = 'check_violation';
  end if;

  -- Re-activating consumes a seat, so it is the moment the plan limit applies. Deactivating
  -- never can.
  if p_status = 'active' then
    select tu.tenant_id into v_tenant from public.tenant_users tu where tu.user_id = p_user_id limit 1;
    if v_tenant is not null then
      select l.max_seats into v_max
        from public.plan_limits l
       where l.plan_id = public.tenant_current_plan(v_tenant);
      if v_max is not null then
        -- Count only members who will occupy a seat once this one is active.
        select count(*)::integer into v_used
          from public.tenant_users tu
          join public.users u on u.id = tu.user_id
         where tu.tenant_id = v_tenant and u.status = 'active' and u.id <> p_user_id;
        if (v_used + 1) > v_max then
          raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;

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

-- --------------------------------------------------------------------------
-- admin_replace_user_token (SA-1.2 resend invite / send reset)
--
-- lib routes map PASSWORD_ALREADY_SET and USER_REMOVED to "no longer waiting for an invitation".
-- --------------------------------------------------------------------------

create or replace function public.admin_replace_user_token(
  p_user_id    uuid,
  p_purpose    text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid default null,
  p_new_email  text default null
)
returns public.user_invitations
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_row  public.user_invitations%rowtype;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null or v_user.status = 'deleted' then
    raise exception 'USER_REMOVED' using errcode = 'check_violation';
  end if;

  -- Re-inviting someone who has already set a password would hand out a fresh account-setup link
  -- for a live account. A password reset is the correct tool there, and has its own purpose.
  if p_purpose = 'invite' and v_user.password_hash is not null then
    raise exception 'PASSWORD_ALREADY_SET' using errcode = 'check_violation';
  end if;

  -- Supersede any outstanding token of the same purpose. Marking it accepted is what retires it
  -- without deleting the record of it having been issued.
  update public.user_invitations
     set accepted_at = now()
   where user_id = p_user_id and purpose = p_purpose::public.user_token_purpose and accepted_at is null;

  insert into public.user_invitations (user_id, purpose, token_hash, new_email, expires_at, created_by)
  values (p_user_id, p_purpose::public.user_token_purpose, p_token_hash, p_new_email, p_expires_at, p_created_by)
  returning * into v_row;

  return v_row;
end;
$$;

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------

revoke all on function public.admin_user_stats() from public, anon, authenticated, tenant_app;
revoke all on function public.admin_login_activity_stats() from public, anon, authenticated, tenant_app;
revoke all on function public.admin_set_user_status(uuid, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_replace_user_token(uuid, text, text, timestamptz, uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_user_stats() to service_role;
grant execute on function public.admin_login_activity_stats() to service_role;
grant execute on function public.admin_set_user_status(uuid, text, text) to service_role;
grant execute on function public.admin_replace_user_token(uuid, text, text, timestamptz, uuid, text) to service_role;
