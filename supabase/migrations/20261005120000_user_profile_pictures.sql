-- Profile pictures for agency users (2026-10-05).
--
-- A person can add a photo on Your profile; the top bar shows it in place of their initials.
--
-- The file lives in a PRIVATE bucket, read through the app (GET /api/app/profile/avatar redirects
-- to a short-lived signed URL for the signed-in person's own picture), never by a public link.
-- `users.avatar_path` is the object's path in that bucket; `avatar_updated_at` changes with every
-- upload so a browser never shows a cached old photo.
--
-- Additive and idempotent. Rollback:
--   alter table public.users drop column if exists avatar_updated_at;
--   alter table public.users drop column if exists avatar_path;
--   delete from storage.objects where bucket_id = 'user-avatars';
--   delete from storage.buckets where id = 'user-avatars';

alter table public.users add column if not exists avatar_path text;
alter table public.users add column if not exists avatar_updated_at timestamptz;

-- 2 MB is plenty for a square photo the browser shows at 64px; three common image types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-avatars', 'user-avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261005120000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'avatar_path'
  ) then
    raise exception 'users.avatar_path is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'avatar_updated_at'
  ) then
    raise exception 'users.avatar_updated_at is missing';
  end if;
  if not exists (select 1 from storage.buckets where id = 'user-avatars' and public = false) then
    raise exception 'the user-avatars bucket is missing or public';
  end if;
end $$;
