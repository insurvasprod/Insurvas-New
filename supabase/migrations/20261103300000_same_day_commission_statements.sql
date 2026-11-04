-- QA 2026-11-03 · two commission statements from one carrier on the same day are two statements.
--
-- register_carrier_file kept one current file per carrier, type and day (file_registry_current_key), so a
-- second American Amicable commission statement dated Nov 3 silently replaced the first and took its lines
-- out of the books. Policy files keep that rule (a day's policy file is one snapshot of the book). Commission
-- files may now have several current files on one day:
--
--   · file_registry_current_key covers every type but commissions;
--   · register_carrier_file takes p_replace (default true, so the bucket and email doors read exactly as
--     before). With p_replace = false a commission file is added beside the day's others; with true (the
--     upload door's "Yes, it replaces it", and "Replace with a corrected file") it replaces the day's newest.
--
-- The upload door (app/api/app/carrier-files) asks the person before it sends p_replace = true.
--
-- Rollback (only while no day has two current commission files):
--   drop function if exists public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean);
--   re-run section 1 of 20261009210000_la_4_e2e_fixes.sql (the 17-argument function) and its grants;
--   drop index if exists public.file_registry_current_key;
--   create unique index file_registry_current_key on public.file_registry (tenant_id, carrier_id, file_type, file_date, coalesce(path_agency, ''))
--     where superseded_by_file_id is null and carrier_id is not null and file_type is not null and file_date is not null;

-- ─── 1. one current file per day, except commission statements ─────────────────────────────────────────
drop index if exists public.file_registry_current_key;
create unique index file_registry_current_key
  on public.file_registry (tenant_id, carrier_id, file_type, file_date, coalesce(path_agency, ''))
  where superseded_by_file_id is null and carrier_id is not null and file_type is not null and file_date is not null
    and file_type <> 'commissions';
-- The lookup the commission path still makes (the day's newest current file) keeps an index.
create index if not exists file_registry_current_commissions_idx
  on public.file_registry (tenant_id, carrier_id, file_date, received_at desc)
  where superseded_by_file_id is null and file_type = 'commissions';

-- ─── 2. register_carrier_file with p_replace ────────────────────────────────────────────────────────────
-- A new argument is a new signature: the 17-argument function goes, so PostgREST sees one candidate.
drop function if exists public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text);

create or replace function public.register_carrier_file(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_file_type text,
  p_file_date date,
  p_path_agency text,
  p_original_filename text,
  p_storage_path text,
  p_content_hash text,
  p_file_bytes bigint,
  p_content_type text,
  p_file_kind text,
  p_source text,
  p_uploaded_by uuid,
  p_status text,
  p_error_detail text,
  p_email_from text,
  p_email_message_id text,
  p_replace boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.file_registry%rowtype;
  v_current uuid;
  v_new uuid := gen_random_uuid();
  v_skip uuid;
  v_type text;
begin
  if p_status not in ('received', 'failed') then
    raise exception 'A file is registered as received or failed.' using errcode = '22023';
  end if;

  -- One registration at a time per agency: dedup and reissue read and then write.
  perform pg_advisory_xact_lock(hashtextextended('file_registry:' || p_tenant_id::text, 0));

  select * into v_existing from public.file_registry
   where tenant_id = p_tenant_id and content_hash = p_content_hash;
  if v_existing.id is not null then
    -- The same bytes back in the bucket after they were removed: the same file, restored.
    if p_source = 'bucket' and v_existing.source = 'bucket' and v_existing.removed_from_bucket_at is not null then
      update public.file_registry
         set storage_path = p_storage_path, removed_from_bucket_at = null, restored_at = now()
       where id = v_existing.id;
      return jsonb_build_object('outcome', 'restored', 'file_id', v_existing.id);
    end if;
    -- The same bytes, now with their carrier, after the first copy failed only for want of one (an
    -- email from an unknown sender): that file is told its carrier, type and day and read like a new
    -- arrival, instead of every later copy being skipped as its duplicate (20261009210000).
    if v_existing.carrier_id is null and v_existing.status = 'failed' and v_existing.raw_extracted_at is null
       and p_carrier_id is not null and p_file_type is not null and p_file_date is not null and p_status = 'received' then
      if p_replace or p_file_type <> 'commissions' then
        select id into v_current from public.file_registry
         where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type
           and file_date = p_file_date and coalesce(path_agency, '') = coalesce(v_existing.path_agency, '')
           and superseded_by_file_id is null
         order by received_at desc
         limit 1
         for update;
        if v_current is not null then
          update public.file_registry
             set superseded_by_file_id = v_existing.id, superseded_at = now(), status = 'superseded'
           where id = v_current;
        end if;
      end if;
      update public.file_registry
         set carrier_id = p_carrier_id, file_type = p_file_type, file_date = p_file_date,
             file_kind = coalesce(file_kind, p_file_kind), status = 'received', error_detail = null
       where id = v_existing.id;
      -- A bucket drop leaves its own object behind: remember it, so the bucket is not read twice.
      if p_source = 'bucket' then
        insert into public.file_registry_skips (tenant_id, original_file_id, content_hash, source, original_filename, storage_path, uploaded_by, email_from)
        values (p_tenant_id, v_existing.id, p_content_hash, p_source, p_original_filename, p_storage_path, p_uploaded_by, p_email_from)
        on conflict (storage_path) where storage_path is not null do nothing;
      end if;
      return jsonb_build_object('outcome', 'registered', 'file_id', v_existing.id, 'superseded_file_id', v_current,
                                'attributed', true, 'storage_path', v_existing.storage_path);
    end if;
    insert into public.file_registry_skips (tenant_id, original_file_id, content_hash, source, original_filename, storage_path, uploaded_by, email_from)
    -- Only a bucket drop leaves an object behind to remember; the other doors check before storing.
    values (p_tenant_id, v_existing.id, p_content_hash, p_source, p_original_filename,
            case when p_source = 'bucket' then p_storage_path end,
            p_uploaded_by, p_email_from)
    on conflict (storage_path) where storage_path is not null do nothing
    returning id into v_skip;
    return jsonb_build_object('outcome', 'skipped', 'file_id', v_existing.id, 'skip_id', v_skip);
  end if;

  v_type := p_file_type;
  -- One current file per carrier, type and day for each agency (the path's agency folder) — except a
  -- commission statement the person said is a different one (p_replace = false), which sits beside it.
  if p_carrier_id is not null and v_type is not null and p_file_date is not null and (p_replace or v_type <> 'commissions') then
    select id into v_current from public.file_registry
     where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = v_type
       and file_date = p_file_date and coalesce(path_agency, '') = coalesce(p_path_agency, '')
       and superseded_by_file_id is null
     order by received_at desc
     limit 1
     for update;
    if v_current is not null then
      -- The pointer first (the foreign key is deferred), so the current-file index never sees two.
      update public.file_registry
         set superseded_by_file_id = v_new, superseded_at = now(), status = 'superseded'
       where id = v_current;
    end if;
  end if;

  insert into public.file_registry (
    id, tenant_id, path_agency, carrier_id, file_type, file_date, original_filename, storage_path,
    content_hash, file_bytes, content_type, file_kind, status, error_detail, source, uploaded_by,
    email_from, email_message_id
  ) values (
    v_new, p_tenant_id, p_path_agency, p_carrier_id, p_file_type, p_file_date, p_original_filename, p_storage_path,
    p_content_hash, p_file_bytes, p_content_type, p_file_kind, p_status, p_error_detail, p_source, p_uploaded_by,
    p_email_from, p_email_message_id
  );

  return jsonb_build_object('outcome', 'registered', 'file_id', v_new, 'superseded_file_id', v_current);
end;
$$;

revoke all on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean) to service_role;

-- ─── check ──────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_indexdef('public.file_registry_current_key'::regclass);
begin
  if position('commissions' in v_def) = 0 then
    raise exception '20261103300000: file_registry_current_key still covers commission files';
  end if;
  if (select count(*) from pg_proc where proname = 'register_carrier_file' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '20261103300000: register_carrier_file has more than one signature';
  end if;
  if position('p_replace' in pg_get_functiondef('public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean)'::regprocedure)) = 0 then
    raise exception '20261103300000: register_carrier_file does not take p_replace';
  end if;
  if has_function_privilege('authenticated', 'public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean)', 'EXECUTE') then
    raise exception '20261103300000: register_carrier_file is callable by authenticated';
  end if;
end;
$$;
