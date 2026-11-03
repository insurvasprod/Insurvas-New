-- ---------------------------------------------------------------------------
-- Admin second factor: refuse a replayed code (user decision, board p-adm-login)
--
-- A TOTP code is valid for its 30-second step plus one step of drift either side, and until now
-- nothing stopped the same code being accepted twice inside that window. admin_users.last_totp_step
-- records the time step (30s periods since the epoch) of the last code accepted for each admin.
-- POST /api/admin/auth/verify-2fa claims a new step with one conditional update:
--
--   update admin_users set last_totp_step = <step>
--    where id = <admin> and (last_totp_step is null or last_totp_step < <step>)
--   returning id
--
-- so a code from a step <= the last accepted one matches no row and is refused, and of two
-- concurrent verifies with the same code only one gets its row back (lib/adminAuth/totpReplay.ts).
--
-- Updating only this column fires none of the 20260924353000 super-admin guard triggers (they are
-- BEFORE UPDATE OF role, is_active). service_role already holds table-level UPDATE on admin_users,
-- which covers a new column; nothing else can read or write the table.
--
-- Until this is applied the app skips the replay check (42703 / PGRST204) and keeps the lockout.
-- Additive and idempotent: one nullable column. No data changes; null means "no code accepted yet".
-- ---------------------------------------------------------------------------

alter table public.admin_users
  add column if not exists last_totp_step bigint;

-- Guarded so scripts/check-migrations.mjs (which cannot run the ALTER above) does not report the
-- comment's missing column; on a real apply the column always exists by now.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_users' and column_name = 'last_totp_step'
  ) then
    comment on column public.admin_users.last_totp_step is
      'Time step (unix seconds / 30) of the last second-factor code accepted for this admin. A code from this step or earlier is refused (replay protection). Null until the first sign-in after 20260924364000.';
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
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924364000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select c.data_type, c.is_nullable
    into v_type, v_nullable
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'admin_users'
     and c.column_name = 'last_totp_step';

  if v_type is null then
    raise exception '20260924364000: admin_users.last_totp_step is missing';
  end if;
  if v_type <> 'bigint' then
    raise exception '20260924364000: admin_users.last_totp_step is %, expected bigint', v_type;
  end if;
  if v_nullable <> 'YES' then
    raise exception '20260924364000: admin_users.last_totp_step must be nullable (null = no code accepted yet)';
  end if;

  if not has_column_privilege('service_role', 'public.admin_users', 'last_totp_step', 'UPDATE') then
    raise exception '20260924364000: service_role cannot update admin_users.last_totp_step, so verify-2fa cannot claim a step';
  end if;
  -- Not this file's to fix (20260910133000 revokes these), so a warning rather than a failed apply.
  if has_table_privilege('anon', 'public.admin_users', 'SELECT')
     or has_table_privilege('authenticated', 'public.admin_users', 'SELECT') then
    raise warning '20260924364000: admin_users is readable by anon or authenticated; 20260910133000 should have revoked that';
  end if;

  raise notice '20260924364000: admin_users.last_totp_step in place; a second-factor code is accepted once';
end;
$$;
