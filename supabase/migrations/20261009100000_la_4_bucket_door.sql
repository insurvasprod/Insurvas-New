-- LA-4 bucket door, round 2 (2026-10-09) · the bucket as its own page: expected / received / missing
-- / unexpected files per day, checks on a schedule and on demand, files deleted from the bucket.
--
--   1. Carriers: Aflac, American Home Life, American Amicable, Corebridge, Sentinel Security Life,
--      and carrier_folder_alias, so a Drive-style folder named "AMAM" or "Mutual of Omaha" finds its
--      carrier (the agency's own alias wins over the platform's).
--   2. File types: 'new_business' (a carrier's pending-applications report, read like a policy file)
--      beside policies and commissions; file kind 'xls' (Excel 2003 XML) beside csv, xlsx and pdf.
--   3. One current file per carrier, type, day AND agency: two agencies' files of one day no longer
--      replace each other.
--   4. A bucket file deleted from the bucket is marked removed_from_bucket_at, never deleted: its
--      history stays. The same object back at its path, or the same bytes at a new path, restores it
--      (restored_at), with exactly the data it had.
--   5. Drive-style paths: <tenant>/<MM-DD-YYYY>/<agency>/<carrier folder>/<Policies|Commissions|New
--      Business>/<file>, beside the existing <tenant>/inbox/<YYYY-MM-DD>/… layout.
--   6. carrier_file_expectation (which files an agency expects, on which weekdays),
--      carrier_bucket_settings (when the bucket is checked, in which time zone) and
--      carrier_bucket_check (every check: scheduled, manual or the 5-minute poll), with a cron job
--      that runs each agency's scheduled checks.
--
-- Rollback: the new tables and functions can be dropped; the constraints can be put back as in
-- 20261008100000 / 20261008120000 / 20261008130000 once no row uses 'new_business' or 'xls'.

-- ─── 1. carriers and folder aliases ─────────────────────────────────────────────────────────────
-- Platform carriers (organization_id null), as the LA-0 bridge seeds them: code is unique among those.
insert into public.carriers (code, name, organization_id, status, is_active, sort_order)
select x.code, x.name, null, 'active', true, x.sort_order
  from (values
    ('aflac', 'Aflac', 90),
    ('american_home_life', 'American Home Life', 100),
    ('american_amicable', 'American Amicable', 110),
    ('corebridge', 'Corebridge Financial', 120),
    ('sentinel_security_life', 'Sentinel Security Life', 130)
  ) as x(code, name, sort_order)
 where not exists (select 1 from public.carriers c where c.code = x.code and c.organization_id is null);

create table if not exists public.carrier_folder_alias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  alias text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint carrier_folder_alias_alias check (alias = lower(btrim(alias)) and char_length(alias) between 1 and 120)
);
create unique index if not exists carrier_folder_alias_key
  on public.carrier_folder_alias (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), alias);
create index if not exists carrier_folder_alias_carrier_idx on public.carrier_folder_alias (carrier_id);
create index if not exists carrier_folder_alias_created_by_idx on public.carrier_folder_alias (created_by);
alter table public.carrier_folder_alias enable row level security;
drop policy if exists carrier_folder_alias_tenant_read on public.carrier_folder_alias;
create policy carrier_folder_alias_tenant_read on public.carrier_folder_alias
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_folder_alias from public, anon, authenticated;
revoke update, truncate on public.carrier_folder_alias from service_role, tenant_app;
grant select, insert, delete on public.carrier_folder_alias to service_role;
grant select on public.carrier_folder_alias to tenant_app;

-- The folder names carriers' portals and agencies' Drives use. A carrier's own name and code always
-- match too (in the app), so these are only the other spellings.
insert into public.carrier_folder_alias (tenant_id, carrier_id, alias)
select null, c.id, a.alias
  from (values
    ('aetna', 'aetna'), ('aetna (accendo)', 'aetna'), ('accendo', 'aetna'), ('cvs', 'aetna'),
    ('aflac', 'aflac'), ('aflac (tier one)', 'aflac'), ('tier one', 'aflac'),
    ('ahl', 'american_home_life'), ('american home life', 'american_home_life'), ('the american home life', 'american_home_life'),
    ('amam', 'american_amicable'), ('american amicable', 'american_amicable'),
    ('corebridge', 'corebridge'), ('corebridge financial', 'corebridge'), ('american general', 'corebridge'), ('agl', 'corebridge'),
    ('ssl', 'sentinel_security_life'), ('sentinel', 'sentinel_security_life'), ('sentinel security life', 'sentinel_security_life'),
    ('mutual of omaha', 'mutual_of_omaha'), ('moo', 'mutual_of_omaha'), ('united of omaha', 'mutual_of_omaha'),
    ('americo', 'americo')
  ) as a(alias, code)
  join public.carriers c on c.code = a.code and c.organization_id is null
on conflict do nothing;

-- ─── 2. file types and kinds ────────────────────────────────────────────────────────────────────
alter table public.file_registry drop constraint if exists file_registry_file_type;
alter table public.file_registry add constraint file_registry_file_type
  check (file_type is null or file_type in ('policies', 'commissions', 'new_business'));
alter table public.file_registry drop constraint if exists file_registry_kind;
alter table public.file_registry add constraint file_registry_kind
  check (file_kind is null or file_kind in ('csv', 'xlsx', 'xls', 'pdf'));
alter table public.carrier_layout_map drop constraint if exists carrier_layout_map_file_type;
alter table public.carrier_layout_map add constraint carrier_layout_map_file_type
  check (file_type in ('policies', 'commissions', 'new_business'));
alter table public.carrier_layout_assignment drop constraint if exists carrier_layout_assignment_file_type;
alter table public.carrier_layout_assignment add constraint carrier_layout_assignment_file_type
  check (file_type in ('policies', 'commissions', 'new_business'));
alter table public.carrier_status_map drop constraint if exists carrier_status_map_file_type;
alter table public.carrier_status_map add constraint carrier_status_map_file_type
  check (file_type in ('policies', 'commissions', 'new_business'));
alter table public.unmapped_status_queue drop constraint if exists unmapped_status_queue_file_type;
alter table public.unmapped_status_queue add constraint unmapped_status_queue_file_type
  check (file_type in ('policies', 'commissions', 'new_business'));

-- ─── 3 + 4. removed from the bucket, and one current file per agency ────────────────────────────
alter table public.file_registry add column if not exists removed_from_bucket_at timestamptz;
alter table public.file_registry add column if not exists restored_at timestamptz;
alter table public.file_registry drop constraint if exists file_registry_removed_is_bucket;
alter table public.file_registry add constraint file_registry_removed_is_bucket
  check (removed_from_bucket_at is null or source = 'bucket');
create index if not exists file_registry_bucket_live_idx on public.file_registry (tenant_id, storage_path) where source = 'bucket';

drop index if exists public.file_registry_current_key;
create unique index file_registry_current_key
  on public.file_registry (tenant_id, carrier_id, file_type, file_date, coalesce(path_agency, ''))
  where superseded_by_file_id is null and carrier_id is not null and file_type is not null and file_date is not null;

-- What a file IS never changes, with one exception: a file removed from the bucket that comes back
-- at a new path is the same file, so its storage_path moves with it as it is restored.
create or replace function public.file_registry_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.carrier_id is distinct from old.carrier_id
     or new.file_type is distinct from old.file_type
     or new.file_date is distinct from old.file_date
     or new.agency_id is distinct from old.agency_id
     or new.path_agency is distinct from old.path_agency
     or new.original_filename is distinct from old.original_filename
     or (new.storage_path is distinct from old.storage_path
         and not (old.removed_from_bucket_at is not null and new.removed_from_bucket_at is null))
     or new.content_hash is distinct from old.content_hash
     or new.file_bytes is distinct from old.file_bytes
     or new.source is distinct from old.source
     or new.uploaded_by is distinct from old.uploaded_by
     or new.email_from is distinct from old.email_from
     or new.received_at is distinct from old.received_at then
    raise exception 'A registered file''s identity cannot change; register the corrected file instead.'
      using errcode = 'P0001';
  end if;
  if old.superseded_by_file_id is not null and new.superseded_by_file_id is distinct from old.superseded_by_file_id then
    raise exception 'A superseded file stays superseded by the file that replaced it.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

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
  p_email_message_id text
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
    insert into public.file_registry_skips (tenant_id, original_file_id, content_hash, source, original_filename, storage_path, uploaded_by, email_from)
    -- Only a bucket drop leaves an object behind to remember; the other doors check before storing.
    values (p_tenant_id, v_existing.id, p_content_hash, p_source, p_original_filename,
            case when p_source = 'bucket' then p_storage_path end,
            p_uploaded_by, p_email_from)
    on conflict (storage_path) where storage_path is not null do nothing
    returning id into v_skip;
    return jsonb_build_object('outcome', 'skipped', 'file_id', v_existing.id, 'skip_id', v_skip);
  end if;

  if p_carrier_id is not null and p_file_type is not null and p_file_date is not null then
    -- One current file per carrier, type and day for each agency (the path's agency folder).
    select id into v_current from public.file_registry
     where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type
       and file_date = p_file_date and coalesce(path_agency, '') = coalesce(p_path_agency, '')
       and superseded_by_file_id is null
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
revoke all on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text) to service_role;

-- ─── 5. the bucket door accepts both layouts ────────────────────────────────────────────────────
create or replace function public.list_unregistered_carrier_drops(p_limit integer default 100)
returns table (storage_path text, file_bytes bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select o.name, coalesce((o.metadata ->> 'size')::bigint, 0), o.created_at
    from storage.objects o
   where o.bucket_id = 'carrier-files'
     and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(inbox/|[0-9]{2}-[0-9]{2}-[0-9]{4}/)'
     and o.name !~ '/\.emptyFolderPlaceholder$'
     and not exists (select 1 from public.file_registry r where r.storage_path = o.name)
     and not exists (select 1 from public.file_registry_skips s where s.storage_path = o.name)
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.list_unregistered_carrier_drops(integer) from public, anon, authenticated;
grant execute on function public.list_unregistered_carrier_drops(integer) to service_role;

-- Files deleted from the bucket, and files back at their path: marks both, returns their ids.
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
revoke all on function public.sync_carrier_bucket_removals(uuid) from public, anon, authenticated;
grant execute on function public.sync_carrier_bucket_removals(uuid) to service_role;

-- ─── 6. expected files, check times, checks ─────────────────────────────────────────────────────
create table if not exists public.carrier_file_expectation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  path_agency text not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  file_type text not null,
  -- 0 Sunday … 6 Saturday, in the agency's check time zone.
  weekdays smallint[] not null default '{1,2,3,4,5}',
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_file_expectation_type check (file_type in ('policies', 'commissions', 'new_business')),
  constraint carrier_file_expectation_agency check (char_length(btrim(path_agency)) between 1 and 120),
  constraint carrier_file_expectation_days check (weekdays <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(weekdays) between 1 and 7),
  constraint carrier_file_expectation_key unique (tenant_id, path_agency, carrier_id, file_type)
);
create index if not exists carrier_file_expectation_carrier_idx on public.carrier_file_expectation (carrier_id);
create index if not exists carrier_file_expectation_created_by_idx on public.carrier_file_expectation (created_by);
alter table public.carrier_file_expectation enable row level security;
drop policy if exists carrier_file_expectation_tenant_read on public.carrier_file_expectation;
create policy carrier_file_expectation_tenant_read on public.carrier_file_expectation
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_file_expectation from public, anon, authenticated;
revoke truncate on public.carrier_file_expectation from service_role, tenant_app;
-- Configuration, not evidence: an agency edits and removes its own expectations.
grant select, insert, update, delete on public.carrier_file_expectation to service_role;
grant select on public.carrier_file_expectation to tenant_app;

create table if not exists public.carrier_bucket_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  check_times time[] not null default '{10:00,16:00}',
  timezone text not null default 'America/New_York',
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint carrier_bucket_settings_times check (cardinality(check_times) between 0 and 24),
  constraint carrier_bucket_settings_tz check (char_length(timezone) between 1 and 64)
);
create index if not exists carrier_bucket_settings_updated_by_idx on public.carrier_bucket_settings (updated_by);
alter table public.carrier_bucket_settings enable row level security;
drop policy if exists carrier_bucket_settings_tenant_read on public.carrier_bucket_settings;
create policy carrier_bucket_settings_tenant_read on public.carrier_bucket_settings
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_bucket_settings from public, anon, authenticated;
revoke delete, truncate on public.carrier_bucket_settings from service_role, tenant_app;
grant select, insert, update on public.carrier_bucket_settings to service_role;
grant select on public.carrier_bucket_settings to tenant_app;

create table if not exists public.carrier_bucket_check (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  check_date date not null,
  checked_at timestamptz not null default now(),
  trigger text not null,
  checked_by uuid references public.users(id) on delete set null,
  found integer not null default 0,
  registered integer not null default 0,
  removed integer not null default 0,
  restored integer not null default 0,
  note text,
  constraint carrier_bucket_check_trigger check (trigger in ('schedule', 'manual', 'poll')),
  constraint carrier_bucket_check_counts check (found >= 0 and registered >= 0 and removed >= 0 and restored >= 0),
  constraint carrier_bucket_check_note check (note is null or char_length(note) <= 500)
);
create index if not exists carrier_bucket_check_day_idx on public.carrier_bucket_check (tenant_id, check_date, checked_at desc);
create index if not exists carrier_bucket_check_checked_by_idx on public.carrier_bucket_check (checked_by);
alter table public.carrier_bucket_check enable row level security;
drop policy if exists carrier_bucket_check_tenant_read on public.carrier_bucket_check;
create policy carrier_bucket_check_tenant_read on public.carrier_bucket_check
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_bucket_check from public, anon, authenticated;
revoke update, delete, truncate on public.carrier_bucket_check from service_role, tenant_app;
grant select, insert on public.carrier_bucket_check to service_role;
grant select on public.carrier_bucket_check to tenant_app;

-- Every 15 minutes: an agency whose check time fell in the last 15 minutes (its own time zone) has
-- its removals synced and a scheduled check recorded, and the app is asked to poll. A slot is
-- checked once: a second run inside the same 15 minutes finds the check already recorded.
create or replace function public.run_scheduled_bucket_checks()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_sync jsonb;
  v_count integer := 0;
begin
  for v_row in
    select s.tenant_id, s.timezone, (now() at time zone s.timezone) as local_now
      from public.carrier_bucket_settings s
     where exists (select 1 from pg_timezone_names z where z.name = s.timezone)
       and exists (
         select 1 from unnest(s.check_times) t
          where (now() at time zone s.timezone)::time >= t
            and (now() at time zone s.timezone)::time < t + interval '15 minutes')
       and not exists (
         select 1 from public.carrier_bucket_check c
          where c.tenant_id = s.tenant_id and c.trigger = 'schedule'
            and c.checked_at > now() - interval '15 minutes')
  loop
    v_sync := public.sync_carrier_bucket_removals(v_row.tenant_id);
    insert into public.carrier_bucket_check (tenant_id, check_date, trigger, removed, restored)
    values (v_row.tenant_id, v_row.local_now::date, 'schedule',
            jsonb_array_length(v_sync -> 'removed'), jsonb_array_length(v_sync -> 'restored'));
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform public.trigger_carrier_file_poll();
  end if;
  return v_count;
end;
$$;
revoke all on function public.run_scheduled_bucket_checks() from public, anon, authenticated;
grant execute on function public.run_scheduled_bucket_checks() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la4-bucket-scheduled-checks', '*/15 * * * *', $cron$select public.run_scheduled_bucket_checks()$cron$);
  else
    raise notice '20261009100000: pg_cron is not installed; scheduled bucket checks are skipped.';
  end if;
end $$;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_indexdef('public.file_registry_current_key'::regclass);
begin
  if (select count(*) from public.carriers where organization_id is null and code in ('aflac', 'american_home_life', 'american_amicable', 'corebridge', 'sentinel_security_life')) <> 5 then
    raise exception '20261009100000: the five new carriers are not all there';
  end if;
  if (select count(*) from public.carrier_folder_alias where tenant_id is null) < 20 then
    raise exception '20261009100000: the platform folder aliases are missing';
  end if;
  if position('path_agency' in v_def) = 0 then
    raise exception '20261009100000: the current-file index does not include the agency: %', v_def;
  end if;
  if position('restored' in pg_get_functiondef('public.register_carrier_file(uuid,uuid,text,date,text,text,text,text,bigint,text,text,text,uuid,text,text,text,text)'::regprocedure)) = 0 then
    raise exception '20261009100000: register_carrier_file does not restore a removed file';
  end if;
  if position('[0-9]{2}-[0-9]{2}-[0-9]{4}' in pg_get_functiondef('public.list_unregistered_carrier_drops(integer)'::regprocedure)) = 0 then
    raise exception '20261009100000: the bucket listing does not read the Drive layout';
  end if;
  if has_table_privilege('service_role', 'public.file_registry', 'DELETE')
     or has_table_privilege('service_role', 'public.carrier_bucket_check', 'DELETE')
     or has_table_privilege('service_role', 'public.carrier_bucket_check', 'UPDATE') then
    raise exception '20261009100000: registered files or checks can be deleted or edited';
  end if;
  if has_function_privilege('anon', 'public.sync_carrier_bucket_removals(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.run_scheduled_bucket_checks()', 'EXECUTE') then
    raise exception '20261009100000: anon can run a bucket function';
  end if;
  -- The guard still refuses an identity change, and still allows the restore move.
  if position('removed_from_bucket_at is not null and new.removed_from_bucket_at is null' in pg_get_functiondef('public.file_registry_guard()'::regprocedure)) = 0 then
    raise exception '20261009100000: the identity guard does not allow a restore';
  end if;
end $$;
