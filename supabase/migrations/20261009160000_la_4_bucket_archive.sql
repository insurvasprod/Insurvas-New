-- LA-4 bucket door, round 2 (2026-10-09) · a file deleted from the bucket is put back.
--
-- The owner decided (2026-10-08): when Check now finds a file missing from the bucket, it uploads
-- it again, so files don't sit "removed". The bucket object is the only copy of a file's bytes, so
-- every bucket file now gets a second, private copy, and a missing file is copied back from it:
--
--   1. carrier-files-archive: a private bucket, reached only with the service role, one object per
--      registered bucket file at <tenant id>/<file id>. Nobody browsing the agency's folders sees it.
--   2. bucket_files_to_archive: bucket files that are still in the bucket but have no copy yet (new
--      drops are copied as they arrive; this catches the ones from before, and any that failed).
--   3. bucket_files_to_put_back: bucket files missing from their path that have a copy. Check now and
--      the five-minute poll copy each back to the same path.
--   4. sync_carrier_bucket_removals marks a file removed only when it has NO copy to put back, so the
--      scheduled check (which runs in the database and cannot copy bytes) never removes a file the
--      app is about to restore. A file with no copy still follows 20261009150000.
--
-- Rollback: re-run sync_carrier_bucket_removals from 20261009100000; drop the two functions; the
-- archive bucket and its copies can stay (empty it in Storage first if it is to be dropped).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carrier-files-archive', 'carrier-files-archive', false, 26214400, null)
on conflict (id) do nothing;

-- Files deleted from the bucket with no copy to put back, and files back at their path.
create or replace function public.sync_carrier_bucket_removals(p_tenant_id uuid default null)
returns jsonb
language sql
security definer
set search_path = public, storage, pg_temp
as $$
  with gone as (
    update public.file_registry r
       set removed_from_bucket_at = now()
     where r.source = 'bucket' and r.removed_from_bucket_at is null
       and (p_tenant_id is null or r.tenant_id = p_tenant_id)
       and not exists (select 1 from storage.objects o where o.bucket_id = 'carrier-files' and o.name = r.storage_path)
       -- A file with a copy is put back by the app, not removed.
       and not exists (select 1 from storage.objects a where a.bucket_id = 'carrier-files-archive' and a.name = r.tenant_id::text || '/' || r.id::text)
    returning r.id
  ), back as (
    update public.file_registry r
       set removed_from_bucket_at = null, restored_at = now()
     where r.source = 'bucket' and r.removed_from_bucket_at is not null
       and (p_tenant_id is null or r.tenant_id = p_tenant_id)
       and exists (select 1 from storage.objects o where o.bucket_id = 'carrier-files' and o.name = r.storage_path)
    returning r.id
  )
  select jsonb_build_object(
    'removed', coalesce((select jsonb_agg(id) from gone), '[]'::jsonb),
    'restored', coalesce((select jsonb_agg(id) from back), '[]'::jsonb));
$$;

-- Bucket files still in the bucket with no copy yet. Newest first: the latest files matter most.
create or replace function public.bucket_files_to_archive(p_tenant_id uuid default null, p_limit integer default 50)
returns table (tenant_id uuid, file_id uuid, storage_path text, archive_path text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select r.tenant_id, r.id, r.storage_path, r.tenant_id::text || '/' || r.id::text
    from public.file_registry r
   where r.source = 'bucket' and r.storage_path is not null
     and (p_tenant_id is null or r.tenant_id = p_tenant_id)
     and exists (select 1 from storage.objects o where o.bucket_id = 'carrier-files' and o.name = r.storage_path)
     and not exists (select 1 from storage.objects a where a.bucket_id = 'carrier-files-archive' and a.name = r.tenant_id::text || '/' || r.id::text)
   order by r.received_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- Bucket files missing from their path that have a copy to put back.
create or replace function public.bucket_files_to_put_back(p_tenant_id uuid default null, p_limit integer default 50)
returns table (tenant_id uuid, file_id uuid, storage_path text, archive_path text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select r.tenant_id, r.id, r.storage_path, r.tenant_id::text || '/' || r.id::text
    from public.file_registry r
   where r.source = 'bucket' and r.storage_path is not null
     and (p_tenant_id is null or r.tenant_id = p_tenant_id)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'carrier-files' and o.name = r.storage_path)
     and exists (select 1 from storage.objects a where a.bucket_id = 'carrier-files-archive' and a.name = r.tenant_id::text || '/' || r.id::text)
   order by r.received_at
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- What each check put back, beside what it read, removed and restored.
alter table public.carrier_bucket_check add column if not exists put_back integer not null default 0;

revoke all on function public.sync_carrier_bucket_removals(uuid) from public, anon, authenticated;
grant execute on function public.sync_carrier_bucket_removals(uuid) to service_role;
revoke all on function public.bucket_files_to_archive(uuid, integer) from public, anon, authenticated;
grant execute on function public.bucket_files_to_archive(uuid, integer) to service_role;
revoke all on function public.bucket_files_to_put_back(uuid, integer) from public, anon, authenticated;
grant execute on function public.bucket_files_to_put_back(uuid, integer) to service_role;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'carrier-files-archive' and not public) then
    raise exception '20261009160000: the archive bucket is missing or public';
  end if;
  if position('carrier-files-archive' in pg_get_functiondef('public.sync_carrier_bucket_removals(uuid)'::regprocedure)) = 0 then
    raise exception '20261009160000: the scheduled check would still remove a file that has a copy';
  end if;
  if has_function_privilege('authenticated', 'public.bucket_files_to_put_back(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.bucket_files_to_archive(uuid, integer)', 'execute') then
    raise exception '20261009160000: the archive lists are open to signed-in users';
  end if;
end $$;
