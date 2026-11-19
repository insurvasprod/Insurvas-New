-- ---------------------------------------------------------------------------
-- Staff sessions can be ended from the server (security review 2026-11, M-2)
--
-- A staff session is a signed 12-hour cookie. Until now nothing on the server could end one early:
-- signing out only cleared the cookie in that browser, so a copy of it kept working until it
-- expired. Deactivating the account was the only kill switch.
--
-- admin_users.session_version is the fix. Every staff session token carries the version it was
-- issued at (claim `ver`), and every request compares it with this column (resolveAdminContext,
-- getCurrentAdmin). Raising the column ends every session of that admin at once:
--
--   * POST /api/admin/auth/logout           signing out ends the admin's sessions everywhere;
--   * POST /api/admin/admins/:id/sessions   a super admin's "Sign out everywhere" for another admin;
--   * PATCH /api/admin/admins/:id           deactivating or reactivating an admin.
--
-- The raise is one conditional update (where session_version = <read>), so two raises at once
-- cannot skip a number (lib/adminAuth/sessionVersion.ts).
--
-- Tokens issued before this column existed carry no `ver` and count as version 0, which is the
-- default here, so applying this signs nobody out. Until it is applied the app skips the check
-- (42703 / PGRST204) and signing out only clears the cookie, as before.
--
-- Updating only this column fires none of the 20260924353000 super-admin guard triggers (they are
-- BEFORE UPDATE OF role, is_active). service_role already holds table-level UPDATE on admin_users,
-- which covers a new column; nothing else can read or write the table.
--
-- Additive and idempotent: one column with a default. No other data changes.
-- ---------------------------------------------------------------------------

alter table public.admin_users
  add column if not exists session_version integer not null default 0;

-- Guarded so scripts/check-migrations.mjs (which cannot run the ALTER above) does not report the
-- comment's missing column; on a real apply the column always exists by now.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_users' and column_name = 'session_version'
  ) then
    comment on column public.admin_users.session_version is
      'Raised to end every staff session of this admin at once. Each session token carries the version it was issued at; a token at any other version is refused (security review 2026-11, M-2).';
  end if;
end;
$$;

-- PostgREST caches the schema; without this the new column is PGRST204 until the next reload.
notify pgrst, 'reload schema';

-- Assertions ----------------------------------------------------------------------------------------

do $$
declare
  v_type text;
  v_nullable text;
  v_default text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261117200000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select c.data_type, c.is_nullable, c.column_default
    into v_type, v_nullable, v_default
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'admin_users'
     and c.column_name = 'session_version';

  if v_type is null then
    raise exception '20261117200000: admin_users.session_version is missing';
  end if;
  if v_type <> 'integer' then
    raise exception '20261117200000: admin_users.session_version is %, expected integer', v_type;
  end if;
  if v_nullable <> 'NO' then
    raise exception '20261117200000: admin_users.session_version must be not null';
  end if;
  if v_default is distinct from '0' then
    raise exception '20261117200000: admin_users.session_version must default to 0 (tokens without a version count as 0), found %', v_default;
  end if;

  if not has_column_privilege('service_role', 'public.admin_users', 'session_version', 'UPDATE') then
    raise exception '20261117200000: service_role cannot update admin_users.session_version, so signing out cannot end sessions';
  end if;
  if has_table_privilege('anon', 'public.admin_users', 'SELECT')
     or has_table_privilege('authenticated', 'public.admin_users', 'SELECT') then
    raise warning '20261117200000: admin_users is readable by anon or authenticated; 20260910133000 should have revoked that';
  end if;

  raise notice '20261117200000: admin_users.session_version in place; staff sessions can be ended from the server';
end;
$$;
