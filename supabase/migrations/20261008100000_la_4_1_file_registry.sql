-- LA-4.1 (Notion sprint) · the file registry and the three ingestion doors.
--
-- One contract for getting a carrier file into the system, whatever door it came through: a manual
-- upload, an email to the agency's own address, or a script dropping files into the bucket. Every
-- door ends in one row here, and everything downstream (the raw layer, LA-4.2) reads only this table.
--
-- What a row knows WITHOUT opening the file: carrier, file type (policies | commissions), file date
-- and agency. For a bucket drop they come from the path <date>/<agency>/<carrier>/<Policies|Commissions>/<file>;
-- for an upload or an email they are collected at the door and a synthetic path is written. A file
-- that cannot be read therefore still lands here, correctly attributed, with status 'failed'.
--
--   · The same bytes twice are skipped, and the skip is recorded (file_registry_skips) with a pointer
--     to the file already held.
--   · A different file for the same carrier, type and day is a reissue: the new one is registered and
--     the old one is marked superseded. Neither is ever deleted.
--   · agency_id is here and nullable. In this product the agency is the tenant today; the column is
--     the hook for agencies under an IMO/FMO tenant. The agency segment of a path is kept verbatim.
--
-- Also: the private bucket 'carrier-files'; per-tenant inbound email tokens (Postmark inbound);
-- known carrier senders for the email door; the finder the bucket poller uses; and a pg_cron job that
-- asks the app to poll, when pg_net and the two vault secrets exist (otherwise it is skipped with a
-- notice and the poll route can be called by any scheduler).
--
-- Additive. Requires tenants, users, carriers (20260831110000). Statements (tenant_commission_statements)
-- are untouched: the new pipeline is built beside them (owner decision 2026-10-07).
--
-- Rollback:
--   select cron.unschedule('la4-carrier-file-poll') where exists (select 1 from cron.job where jobname = 'la4-carrier-file-poll');
--   drop function if exists public.trigger_carrier_file_poll();
--   drop function if exists public.list_unregistered_carrier_drops(integer);
--   drop function if exists public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text);
--   drop table if exists public.carrier_inbound_senders, public.tenant_inbound_addresses, public.file_registry_skips, public.file_registry;
--   delete from storage.objects where bucket_id = 'carrier-files'; delete from storage.buckets where id = 'carrier-files';

-- ─── the bucket ────────────────────────────────────────────────────────────────────────────────
-- Private; reached only through the service role (no storage.objects policy, as every bucket here).
-- 25 MB: the bucket door has no request-body limit. Uploads through the app stay under 4 MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('carrier-files', 'carrier-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ─── file_registry ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.file_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  path_agency text,
  carrier_id uuid references public.carriers(id) on delete restrict,
  file_type text,
  file_date date,
  original_filename text not null,
  storage_path text not null,
  content_hash text not null,
  file_bytes bigint not null,
  content_type text,
  file_kind text,
  parser_id uuid,
  parser_version integer,
  row_count integer,
  status text not null default 'received',
  error_detail text,
  source text not null,
  uploaded_by uuid references public.users(id) on delete set null,
  email_from text,
  email_message_id text,
  received_at timestamptz not null default now(),
  parsed_at timestamptz,
  superseded_by_file_id uuid,
  superseded_at timestamptz,
  constraint file_registry_storage_path_key unique (storage_path),
  constraint file_registry_tenant_hash_key unique (tenant_id, content_hash),
  constraint file_registry_superseded_by_fkey foreign key (superseded_by_file_id)
    references public.file_registry(id) deferrable initially deferred,
  constraint file_registry_file_type check (file_type is null or file_type in ('policies', 'commissions')),
  constraint file_registry_status check (status in ('received', 'parsing', 'parsed', 'failed', 'superseded')),
  constraint file_registry_source check (source in ('upload', 'email', 'bucket')),
  constraint file_registry_kind check (file_kind is null or file_kind in ('csv', 'xlsx', 'pdf')),
  constraint file_registry_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint file_registry_bytes check (file_bytes >= 0),
  constraint file_registry_filename check (char_length(original_filename) between 1 and 255),
  constraint file_registry_path_agency check (path_agency is null or char_length(path_agency) between 1 and 120),
  constraint file_registry_error check (error_detail is null or char_length(error_detail) <= 2000),
  -- Attribution is complete unless the file failed: a failed file may be missing what its door could
  -- not tell (an email from an unknown sender), and says so in error_detail.
  constraint file_registry_attributed check (
    status = 'failed' or (carrier_id is not null and file_type is not null and file_date is not null)
  ),
  constraint file_registry_failed_says_why check (status <> 'failed' or error_detail is not null),
  -- A bucket drop has no uploader; the other two doors always know who (or which address) sent it.
  constraint file_registry_bucket_has_no_uploader check (source <> 'bucket' or uploaded_by is null),
  constraint file_registry_superseded_pair check ((status = 'superseded') = (superseded_by_file_id is not null)),
  constraint file_registry_superseded_at check ((superseded_by_file_id is null) = (superseded_at is null)),
  constraint file_registry_tenant_path check (storage_path like tenant_id::text || '/%')
);

comment on column public.file_registry.agency_id is
  'Nullable: a solo agent has no agency. No agencies table exists yet; the agency is the tenant today (LA-4.1).';
comment on column public.file_registry.file_date is
  'From the path or the door''s form, never from the file''s contents.';

-- The file that currently stands for one carrier, type and day. A reissue moves this pointer.
create unique index if not exists file_registry_current_key
  on public.file_registry (tenant_id, carrier_id, file_type, file_date)
  where superseded_by_file_id is null and carrier_id is not null and file_type is not null and file_date is not null;
create index if not exists file_registry_tenant_received_idx on public.file_registry (tenant_id, received_at desc);
create index if not exists file_registry_carrier_idx on public.file_registry (carrier_id);
create index if not exists file_registry_uploaded_by_idx on public.file_registry (uploaded_by);
create index if not exists file_registry_superseded_by_idx on public.file_registry (superseded_by_file_id);

-- What a file IS never changes after it is registered: only its processing state moves.
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
     or new.storage_path is distinct from old.storage_path
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

drop trigger if exists file_registry_guard on public.file_registry;
create trigger file_registry_guard before update on public.file_registry
  for each row execute function public.file_registry_guard();

alter table public.file_registry enable row level security;
drop policy if exists file_registry_tenant_read on public.file_registry;
create policy file_registry_tenant_read on public.file_registry
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.file_registry from public, anon, authenticated;
revoke delete, truncate on public.file_registry from service_role, tenant_app;
grant select, insert, update on public.file_registry to service_role;
grant select on public.file_registry to tenant_app;

-- ─── skips ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.file_registry_skips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  original_file_id uuid not null references public.file_registry(id),
  content_hash text not null,
  source text not null,
  original_filename text not null,
  storage_path text,
  uploaded_by uuid references public.users(id) on delete set null,
  email_from text,
  skipped_at timestamptz not null default now(),
  constraint file_registry_skips_source check (source in ('upload', 'email', 'bucket')),
  constraint file_registry_skips_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint file_registry_skips_filename check (char_length(original_filename) between 1 and 255)
);
create index if not exists file_registry_skips_tenant_idx on public.file_registry_skips (tenant_id, skipped_at desc);
create index if not exists file_registry_skips_original_idx on public.file_registry_skips (original_file_id);
create index if not exists file_registry_skips_uploaded_by_idx on public.file_registry_skips (uploaded_by);
-- A dropped duplicate is skipped once, not on every poll.
create unique index if not exists file_registry_skips_path_key on public.file_registry_skips (storage_path) where storage_path is not null;

alter table public.file_registry_skips enable row level security;
drop policy if exists file_registry_skips_tenant_read on public.file_registry_skips;
create policy file_registry_skips_tenant_read on public.file_registry_skips
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.file_registry_skips from public, anon, authenticated;
revoke update, delete, truncate on public.file_registry_skips from service_role, tenant_app;
grant select, insert on public.file_registry_skips to service_role;
grant select on public.file_registry_skips to tenant_app;

-- ─── the email door: one address per agency, and the carriers' known senders ───────────────────
create table if not exists public.tenant_inbound_addresses (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  token text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tenant_inbound_addresses_token_key unique (token),
  constraint tenant_inbound_addresses_token check (token ~ '^[a-z0-9]{20,40}$')
);
create index if not exists tenant_inbound_addresses_created_by_idx on public.tenant_inbound_addresses (created_by);
alter table public.tenant_inbound_addresses enable row level security;
drop policy if exists tenant_inbound_addresses_tenant_read on public.tenant_inbound_addresses;
create policy tenant_inbound_addresses_tenant_read on public.tenant_inbound_addresses
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_inbound_addresses from public, anon, authenticated;
revoke update, delete, truncate on public.tenant_inbound_addresses from service_role, tenant_app;
grant select, insert on public.tenant_inbound_addresses to service_role;
grant select on public.tenant_inbound_addresses to tenant_app;

-- A sender is an exact address ("commissions@americo.com") or a whole domain ("@americo.com").
-- tenant_id null is a platform-wide sender; a tenant's own row wins over it. Exact match only.
create table if not exists public.carrier_inbound_senders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  sender text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint carrier_inbound_senders_sender check (
    sender = lower(sender) and char_length(sender) <= 254
    and (sender ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or sender ~ '^@[^@\s]+\.[^@\s]+$')
  )
);
create unique index if not exists carrier_inbound_senders_key
  on public.carrier_inbound_senders (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), sender);
create index if not exists carrier_inbound_senders_carrier_idx on public.carrier_inbound_senders (carrier_id);
create index if not exists carrier_inbound_senders_tenant_idx on public.carrier_inbound_senders (tenant_id);
create index if not exists carrier_inbound_senders_created_by_idx on public.carrier_inbound_senders (created_by);
alter table public.carrier_inbound_senders enable row level security;
drop policy if exists carrier_inbound_senders_tenant_read on public.carrier_inbound_senders;
create policy carrier_inbound_senders_tenant_read on public.carrier_inbound_senders
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_inbound_senders from public, anon, authenticated;
revoke update, truncate on public.carrier_inbound_senders from service_role, tenant_app;
-- A sender is configuration, not evidence: an agency may remove one it added.
grant select, insert, delete on public.carrier_inbound_senders to service_role;
grant select on public.carrier_inbound_senders to tenant_app;

-- ─── registering a file: dedup, reissue and insert, atomically ─────────────────────────────────
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
  v_existing uuid;
  v_current uuid;
  v_new uuid := gen_random_uuid();
  v_skip uuid;
begin
  if p_status not in ('received', 'failed') then
    raise exception 'A file is registered as received or failed.' using errcode = '22023';
  end if;

  -- One registration at a time per agency: dedup and reissue read and then write.
  perform pg_advisory_xact_lock(hashtextextended('file_registry:' || p_tenant_id::text, 0));

  select id into v_existing from public.file_registry
   where tenant_id = p_tenant_id and content_hash = p_content_hash;
  if v_existing is not null then
    insert into public.file_registry_skips (tenant_id, original_file_id, content_hash, source, original_filename, storage_path, uploaded_by, email_from)
    -- Only a bucket drop leaves an object behind to remember; the other doors check before storing.
    values (p_tenant_id, v_existing, p_content_hash, p_source, p_original_filename,
            case when p_source = 'bucket' then p_storage_path end,
            p_uploaded_by, p_email_from)
    on conflict (storage_path) where storage_path is not null do nothing
    returning id into v_skip;
    return jsonb_build_object('outcome', 'skipped', 'file_id', v_existing, 'skip_id', v_skip);
  end if;

  if p_carrier_id is not null and p_file_type is not null and p_file_date is not null then
    select id into v_current from public.file_registry
     where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type
       and file_date = p_file_date and superseded_by_file_id is null
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

-- ─── the bucket door: what scripts dropped that nobody has registered yet ──────────────────────
-- Scripts write <tenant id>/inbox/<date>/<agency>/<carrier>/<Policies|Commissions>/<file>. The app
-- downloads, hashes and registers each one; a registered or skipped path is never returned again.
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
     and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/inbox/'
     and not exists (select 1 from public.file_registry r where r.storage_path = o.name)
     and not exists (select 1 from public.file_registry_skips s where s.storage_path = o.name)
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.list_unregistered_carrier_drops(integer) from public, anon, authenticated;
grant execute on function public.list_unregistered_carrier_drops(integer) to service_role;

-- ─── the schedule: pg_cron asks the app to poll ─────────────────────────────────────────────────
-- pg_cron runs SQL only, and hashing a file needs its bytes, so the job calls the app's poll route
-- through pg_net. It needs two vault secrets: 'app_base_url' (https://…, no trailing slash) and
-- 'carrier_files_poll_secret' (the app's CARRIER_FILES_POLL_SECRET). Missing either, it does nothing.
create or replace function public.trigger_carrier_file_poll()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'carrier_files_poll_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using v_url || '/api/internal/carrier-files/poll',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
          '{}'::jsonb;
end;
$$;
revoke all on function public.trigger_carrier_file_poll() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension if not exists pg_net;
    exception when others then
      raise notice '20261008100000: pg_net could not be enabled (%); the poll job is skipped. Call /api/internal/carrier-files/poll from another scheduler.', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-carrier-file-poll', '*/5 * * * *', $cron$select public.trigger_carrier_file_poll()$cron$);
    exception when others then
      raise notice '20261008100000: the poll job could not be scheduled (%).', sqlerrm;
    end;
  else
    raise notice '20261008100000: pg_cron is not installed; the poll job is skipped.';
  end if;
end $$;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'carrier-files' and public = false) then
    raise exception '20261008100000: the private carrier-files bucket is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'file_registry' and column_name = 'agency_id' and is_nullable = 'YES') then
    raise exception '20261008100000: file_registry.agency_id must exist and be nullable';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'file_registry_current_key') then
    raise exception '20261008100000: the one-current-file-per-day index is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'file_registry_guard' and not tgisinternal) then
    raise exception '20261008100000: the identity guard is missing';
  end if;
  if has_table_privilege('service_role', 'public.file_registry', 'DELETE')
     or has_table_privilege('service_role', 'public.file_registry_skips', 'DELETE') then
    raise exception '20261008100000: registered files or skips can be deleted';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'file_registry' and policyname = 'file_registry_tenant_read') then
    raise exception '20261008100000: the tenant read policy is missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'register_carrier_file' and prosecdef) then
    raise exception '20261008100000: register_carrier_file is missing';
  end if;
  if has_function_privilege('authenticated', 'public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text)', 'EXECUTE') then
    raise exception '20261008100000: register_carrier_file is callable by authenticated';
  end if;
  if not exists (select 1 from pg_proc where proname = 'list_unregistered_carrier_drops') then
    raise exception '20261008100000: the bucket finder is missing';
  end if;
end $$;
