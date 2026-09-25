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
