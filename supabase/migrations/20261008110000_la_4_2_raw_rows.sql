-- LA-4.2 (Notion sprint) · the raw layer: every row of every file, exactly as it arrived, forever.
--
-- Layer 1 of the three-layer model (Module 4 doc §4). A carrier file's rows are stored once, never
-- changed and never deleted; everything above them (snapshots, change log, current state, LA-4.6/4.7)
-- can be thrown away and rebuilt from here. A corrected file is a NEW file (LA-4.1's reissue path),
-- never an edit of these rows.
--
--   · raw_rows: one row per data row of a spreadsheet, keyed by the file's own column headers
--     verbatim (spelling, spacing, case). Blank cells are kept as "". Nothing is filtered: a blank
--     line in the middle of a file is a row. row_number is the physical line in the source (1-based),
--     so "row 14 of the file" means row 14.
--   · What sits above the header row (a title, an agent number) is kept on the file as raw_preamble;
--     the header row itself as raw_columns (column letter, header text, the key used). The whole grid
--     can be rebuilt from the three, which is what lets a later parser read a column the first one
--     ignored without anyone re-uploading anything.
--   · Immutable by permission: UPDATE, DELETE and TRUNCATE are revoked from the application roles, and
--     a trigger refuses them for everyone else.
--   · Partitioned by hash of file_id (16 ways) so the table grows across partitions instead of one
--     heap; a file's rows always share a partition.
--   · reprocess_runs: every reprocess — which files, which parser version, how many rows read and
--     changed, who or what triggered it.
--
-- PDFs get their rows from LA-4.4's extraction (page and line references), not here.
--
-- Additive. Requires 20261008100000 (file_registry).
--
-- Rollback (only while nothing above Layer 1 exists):
--   drop function if exists public.finalize_raw_extraction(uuid, uuid, integer, text, integer, jsonb, jsonb);
--   drop function if exists public.insert_raw_rows(uuid, uuid, jsonb);
--   drop table if exists public.reprocess_runs, public.raw_rows;
--   alter table public.file_registry drop column if exists raw_error, drop column if exists raw_extracted_at, drop column if exists raw_preamble,
--     drop column if exists raw_columns, drop column if exists raw_header_row, drop column if exists sheet_name;

-- ─── the file learns how its rows were read ────────────────────────────────────────────────────
alter table public.file_registry
  add column if not exists sheet_name text,
  add column if not exists raw_header_row integer,
  add column if not exists raw_columns jsonb,
  add column if not exists raw_preamble jsonb,
  add column if not exists raw_extracted_at timestamptz,
  -- Why the rows could not be read. Also set on a replaced file (which keeps status 'superseded'),
  -- so the sweep stops retrying a file that will never read.
  add column if not exists raw_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'file_registry_raw_error') then
    alter table public.file_registry add constraint file_registry_raw_error check (
      raw_error is null or (char_length(raw_error) <= 2000 and raw_extracted_at is null)
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'file_registry_raw_complete') then
    alter table public.file_registry add constraint file_registry_raw_complete check (
      raw_extracted_at is null
      or (row_count is not null and row_count >= 0 and raw_header_row is not null and raw_header_row >= 1
          and jsonb_typeof(raw_columns) = 'array' and jsonb_typeof(raw_preamble) = 'array')
    );
  end if;
end $$;

comment on column public.file_registry.raw_columns is
  'LA-4.2: the header row, in order: [{column: "A", header: <verbatim>, key: <payload key>}]. The key is the header itself unless blank or repeated.';
comment on column public.file_registry.raw_preamble is
  'LA-4.2: every row above the header row, as arrays of cell text, so the whole grid can be rebuilt.';

-- The guard from 20261008100000, plus: once a file's rows are extracted, how they were read is fixed.
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
  if old.raw_extracted_at is not null and (
       new.raw_extracted_at is distinct from old.raw_extracted_at
       or new.row_count is distinct from old.row_count
       or new.sheet_name is distinct from old.sheet_name
       or new.raw_header_row is distinct from old.raw_header_row
       or new.raw_columns is distinct from old.raw_columns
       or new.raw_preamble is distinct from old.raw_preamble) then
    raise exception 'A file''s raw rows are fixed once extracted.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ─── raw_rows ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.raw_rows (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  file_id uuid not null references public.file_registry(id),
  row_number integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint raw_rows_pkey primary key (file_id, row_number),
  -- Later layers point at a raw row by (file_id, id): every snapshot and ledger entry carries both.
  constraint raw_rows_file_id_id_key unique (file_id, id),
  constraint raw_rows_row_number check (row_number >= 1),
  constraint raw_rows_payload check (jsonb_typeof(payload) = 'object')
) partition by hash (file_id);

do $$
declare
  i integer;
begin
  for i in 0..15 loop
    execute format('create table if not exists public.raw_rows_p%s partition of public.raw_rows for values with (modulus 16, remainder %s)', lpad(i::text, 2, '0'), i);
  end loop;
end $$;

create index if not exists raw_rows_tenant_idx on public.raw_rows (tenant_id, file_id);

create or replace function public.raw_rows_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Raw rows are never changed or removed; register a corrected file instead.' using errcode = 'P0001';
end;
$$;

drop trigger if exists raw_rows_no_update on public.raw_rows;
create trigger raw_rows_no_update before update or delete on public.raw_rows
  for each row execute function public.raw_rows_immutable();
drop trigger if exists raw_rows_no_truncate on public.raw_rows;
create trigger raw_rows_no_truncate before truncate on public.raw_rows
  for each statement execute function public.raw_rows_immutable();

alter table public.raw_rows enable row level security;
drop policy if exists raw_rows_tenant_read on public.raw_rows;
create policy raw_rows_tenant_read on public.raw_rows
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.raw_rows from public, anon, authenticated;
revoke update, delete, truncate on public.raw_rows from service_role, tenant_app;
grant select, insert on public.raw_rows to service_role;
grant select on public.raw_rows to tenant_app;

do $$
declare
  part record;
begin
  -- The partitions are reached only through raw_rows (and its policy and triggers).
  for part in select inhrelid::regclass as name from pg_inherits where inhparent = 'public.raw_rows'::regclass loop
    execute format('revoke all on %s from public, anon, authenticated, service_role, tenant_app', part.name);
  end loop;
end $$;

-- ─── writing a file's rows: idempotent in chunks, then sealed with its count ───────────────────
create or replace function public.insert_raw_rows(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  if not exists (select 1 from public.file_registry where id = p_file_id and tenant_id = p_tenant_id and raw_extracted_at is null and file_kind in ('csv', 'xlsx')) then
    raise exception 'That file is not waiting for its rows.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows come as an array.' using errcode = '22023';
  end if;
  -- A retried chunk inserts nothing twice: the same file and line are the same raw row.
  insert into public.raw_rows (tenant_id, file_id, row_number, payload)
  select p_tenant_id, p_file_id, (r ->> 'row_number')::integer, r -> 'payload'
    from jsonb_array_elements(p_rows) r
  on conflict (file_id, row_number) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.finalize_raw_extraction(
  p_tenant_id uuid,
  p_file_id uuid,
  p_row_count integer,
  p_sheet_name text,
  p_header_row integer,
  p_columns jsonb,
  p_preamble jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file public.file_registry%rowtype;
  v_found integer;
begin
  select * into v_file from public.file_registry where id = p_file_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'That file is not in this workspace.' using errcode = 'P0002';
  end if;
  if v_file.raw_extracted_at is not null then
    if v_file.row_count = p_row_count then return v_file.row_count; end if;
    raise exception 'This file''s rows were already extracted (% rows).', v_file.row_count using errcode = 'P0001';
  end if;
  select count(*) into v_found from public.raw_rows where file_id = p_file_id;
  -- The registry's row_count is a promise about raw_rows: it is only written when they agree.
  if v_found <> p_row_count then
    raise exception 'Expected % raw rows for this file, found %.', p_row_count, v_found using errcode = 'P0001';
  end if;
  update public.file_registry
     set row_count = p_row_count, sheet_name = p_sheet_name, raw_header_row = p_header_row,
         raw_columns = p_columns, raw_preamble = p_preamble, raw_extracted_at = now()
   where id = p_file_id;
  return p_row_count;
end;
$$;

revoke all on function public.insert_raw_rows(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_raw_extraction(uuid, uuid, integer, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.insert_raw_rows(uuid, uuid, jsonb) to service_role;
grant execute on function public.finalize_raw_extraction(uuid, uuid, integer, text, integer, jsonb, jsonb) to service_role;

-- ─── reprocess runs ────────────────────────────────────────────────────────────────────────────
create table if not exists public.reprocess_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trigger text not null,
  triggered_by uuid references public.users(id) on delete set null,
  scope jsonb not null,
  parser_version text,
  file_ids uuid[] not null default '{}',
  rows_read integer not null default 0,
  rows_changed integer not null default 0,
  stages jsonb not null default '[]'::jsonb,
  status text not null default 'running',
  error_detail text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint reprocess_runs_trigger check (trigger in ('manual', 'parser_update', 'status_map_approval', 'reissue', 'scheduled')),
  constraint reprocess_runs_status check (status in ('running', 'succeeded', 'failed')),
  constraint reprocess_runs_scope check (jsonb_typeof(scope) = 'object'),
  constraint reprocess_runs_finished check ((status = 'running') = (finished_at is null)),
  constraint reprocess_runs_failed_says_why check (status <> 'failed' or error_detail is not null),
  constraint reprocess_runs_counts check (rows_read >= 0 and rows_changed >= 0)
);
create index if not exists reprocess_runs_tenant_idx on public.reprocess_runs (tenant_id, started_at desc);
create index if not exists reprocess_runs_triggered_by_idx on public.reprocess_runs (triggered_by);

alter table public.reprocess_runs enable row level security;
drop policy if exists reprocess_runs_tenant_read on public.reprocess_runs;
create policy reprocess_runs_tenant_read on public.reprocess_runs
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.reprocess_runs from public, anon, authenticated;
revoke delete, truncate on public.reprocess_runs from service_role, tenant_app;
grant select, insert, update on public.reprocess_runs to service_role;
grant select on public.reprocess_runs to tenant_app;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_inherits where inhparent = 'public.raw_rows'::regclass) <> 16 then
    raise exception '20261008110000: raw_rows must have 16 partitions';
  end if;
  if has_table_privilege('service_role', 'public.raw_rows', 'UPDATE')
     or has_table_privilege('service_role', 'public.raw_rows', 'DELETE')
     or has_table_privilege('tenant_app', 'public.raw_rows', 'UPDATE')
     or has_table_privilege('tenant_app', 'public.raw_rows', 'DELETE') then
    raise exception '20261008110000: raw rows can be changed or removed by an application role';
  end if;
  if has_table_privilege('service_role', 'public.raw_rows_p00', 'INSERT') then
    raise exception '20261008110000: a partition can be written directly';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'raw_rows_no_update' and not tgisinternal) then
    raise exception '20261008110000: the immutability trigger is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'file_registry_raw_complete') then
    raise exception '20261008110000: file_registry_raw_complete is missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'finalize_raw_extraction' and prosecdef) then
    raise exception '20261008110000: finalize_raw_extraction is missing';
  end if;
  if has_table_privilege('service_role', 'public.reprocess_runs', 'DELETE') then
    raise exception '20261008110000: reprocess runs can be deleted';
  end if;
end $$;
