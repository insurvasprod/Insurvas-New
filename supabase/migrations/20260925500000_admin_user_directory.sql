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
