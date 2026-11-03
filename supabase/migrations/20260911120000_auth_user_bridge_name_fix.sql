-- LA-0 blocker: no user can be created on this project, by any path.
--
-- `public.users.name` is NOT NULL with no default. The auth bridge trigger
-- `private.handle_new_auth_user()` inserts `full_name` and `display_name` but never `name`, so
-- every insert into `auth.users` raises 23502 and Supabase Auth reports the generic
-- "Database error creating new user". That breaks:
--
--   * self-serve signup and invitation acceptance (the app's own paths),
--   * `auth.admin.createUser` (the supported fixture path),
--   * and therefore every LA-0.1-LA-0.6 live acceptance fixture, all of which need a user.
--
-- Raw inserts into `public.users` cannot substitute: `id` has no default and carries
-- `users_id_fkey` to `auth.users`, which is correct and stays.
--
-- This is additive and idempotent: it replaces one function body, adds the missing column to the
-- insert, and changes nothing else. `name` is derived from the same metadata the trigger already
-- reads, falling back to the local part of the email so the NOT NULL can never be violated again.
--
-- Verify with: npm run verify:agent-shell (or any LA-0 verify suite) — they fail at fixture
-- setup before this migration and reach their assertions after it.

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_full_name text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_display_name text := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    ''
  );
  -- NOT NULL with no default. Never allow this to resolve to NULL: prefer the supplied name,
  -- then the display name, then the local part of the email, then a non-empty placeholder.
  v_name text := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'name',
    nullif(v_full_name, ''),
    nullif(v_display_name, ''),
    split_part(coalesce(new.email, ''), '@', 1)
  )), '');
begin
  insert into public.users (id, email, name, full_name, display_name, status, active)
  values (
    new.id,
    new.email,
    coalesce(v_name, 'Unnamed user'),
    v_full_name,
    v_display_name,
    'invited',
    false
  )
  on conflict (id) do update
    set email = excluded.email,
        -- Only fill a blank name; never overwrite one a person has already set.
        name = case when btrim(coalesce(public.users.name, '')) = '' then excluded.name else public.users.name end,
        updated_at = now();
  return new;
end;
$function$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
