-- LA-4.3 (Notion sprint) · the spreadsheet parser framework: declarative, versioned layout maps.
--
-- A carrier's spreadsheet is read into typed rows by a LAYOUT MAP: which header row, which sheet,
-- and for each source column (its header, verbatim) the field it becomes, its type and one named
-- transform. There is no code in a map — if reading a file needs an `if`, it is a transform here.
--
--   · One layout is one lineage (layout_key) of numbered versions: draft → in_review → published →
--     retired. A published version never changes; editing it means version N+1. Publishing retires
--     the version before it. Every file records the map id and version that parsed it.
--   · Layouts are not owned by a carrier. A carrier is ASSIGNED a layout per file type, so the
--     46-column layout Aetna, Aflac and AHL share exists once and is referenced three times.
--   · The platform maintains them (tenant_id null, staff in the admin plane); an agency may hold its
--     own override — its own assignment, or its own version of a layout. Resolution: the agency's,
--     then the platform's, then nothing ("no layout map for this carrier and file type").
--   · The parse is deterministic: no model runs during it. What it notices — an unknown column, a
--     big swing in row count, unreadable values, totals that do not add up — is written as a finding
--     by the parser guardian (agent_findings, the LA-4.19 table, created here first). A missing
--     required column, or totals that do not balance, fail the file and nothing goes further.
--
-- This deliberately follows LA-3.13's carrier field maps (20260926100800, 20260926102510): the
-- statuses, the frozen-once-published guard, staff approvers, proposal_source as the AI seam.
--
-- No layout is seeded: seeds come only from real carrier sample files (owner decision 2026-10-07).
--
-- Additive. Requires 20261008100000 and 20261008110000.
--
-- Rollback:
--   alter table public.file_registry drop constraint if exists file_registry_parser_fkey, drop column if exists parse_block, drop column if exists parsed_row_count;
--   drop function if exists public.publish_layout_map(uuid, uuid, uuid);
--   drop table if exists public.agent_findings, public.carrier_layout_assignment, public.carrier_layout_map_entry, public.carrier_layout_map;

-- ─── layouts ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.carrier_layout_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  layout_key text not null,
  name text not null,
  file_type text not null,
  version integer not null,
  status text not null default 'draft',
  header_row_index integer,
  sheet_name text,
  row_count_swing_pct integer not null default 50,
  total_row_column text,
  total_row_value text,
  proposal_source text not null default 'manual',
  created_by uuid references public.users(id) on delete set null,
  created_by_admin uuid references public.admin_users(id) on delete restrict,
  approved_by uuid references public.users(id) on delete restrict,
  approved_by_admin uuid references public.admin_users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_layout_map_key check (layout_key ~ '^[a-z][a-z0-9_]{2,60}$'),
  constraint carrier_layout_map_name check (char_length(btrim(name)) between 1 and 120),
  constraint carrier_layout_map_file_type check (file_type in ('policies', 'commissions')),
  constraint carrier_layout_map_version check (version > 0),
  constraint carrier_layout_map_status check (status in ('draft', 'in_review', 'published', 'retired')),
  constraint carrier_layout_map_header_row check (header_row_index is null or header_row_index between 1 and 200),
  constraint carrier_layout_map_sheet check (sheet_name is null or char_length(sheet_name) between 1 and 120),
  constraint carrier_layout_map_swing check (row_count_swing_pct between 1 and 1000),
  constraint carrier_layout_map_total_row check ((total_row_column is null) = (total_row_value is null)),
  constraint carrier_layout_map_total_row_commissions check (total_row_column is null or file_type = 'commissions'),
  constraint carrier_layout_map_proposal check (proposal_source in ('manual', 'ai')),
  constraint carrier_layout_map_approved check (
    status not in ('published', 'retired') or ((approved_by is not null or approved_by_admin is not null) and approved_at is not null)
  )
);

create unique index if not exists carrier_layout_map_version_key
  on public.carrier_layout_map (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), layout_key, version);
-- One live version per layout, per scope.
create unique index if not exists carrier_layout_map_one_published
  on public.carrier_layout_map (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), layout_key)
  where status = 'published';
create index if not exists carrier_layout_map_tenant_idx on public.carrier_layout_map (tenant_id);
create index if not exists carrier_layout_map_created_by_idx on public.carrier_layout_map (created_by);
create index if not exists carrier_layout_map_created_by_admin_idx on public.carrier_layout_map (created_by_admin);
create index if not exists carrier_layout_map_approved_by_idx on public.carrier_layout_map (approved_by);
create index if not exists carrier_layout_map_approved_by_admin_idx on public.carrier_layout_map (approved_by_admin);

create table if not exists public.carrier_layout_map_entry (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.carrier_layout_map(id) on delete cascade,
  source_column text not null,
  target_field text not null,
  data_type text not null,
  transform text not null default 'none',
  required boolean not null default false,
  sort_order integer not null default 0,
  enum_values jsonb,
  constraint carrier_layout_map_entry_target_key unique (map_id, target_field),
  constraint carrier_layout_map_entry_source check (char_length(source_column) between 1 and 200),
  constraint carrier_layout_map_entry_target check (target_field ~ '^[a-z][a-z0-9_]{1,60}$'),
  constraint carrier_layout_map_entry_type check (data_type in ('text', 'int_cents', 'date', 'basis_points', 'enum', 'integer')),
  constraint carrier_layout_map_entry_transform check (transform in ('none', 'strip_currency', 'mmddyyyy', 'yyyymmdd', 'digits_only', 'negate', 'pct_to_bp')),
  constraint carrier_layout_map_entry_enum check ((data_type = 'enum') = (enum_values is not null) and (enum_values is null or jsonb_typeof(enum_values) = 'object'))
);
create index if not exists carrier_layout_map_entry_map_idx on public.carrier_layout_map_entry (map_id, sort_order);

-- ─── which layout a carrier's files use ────────────────────────────────────────────────────────
create table if not exists public.carrier_layout_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  file_type text not null,
  layout_key text not null,
  created_by uuid references public.users(id) on delete set null,
  created_by_admin uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint carrier_layout_assignment_file_type check (file_type in ('policies', 'commissions')),
  constraint carrier_layout_assignment_key check (layout_key ~ '^[a-z][a-z0-9_]{2,60}$')
);
create unique index if not exists carrier_layout_assignment_scope_key
  on public.carrier_layout_assignment (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), carrier_id, file_type);
create index if not exists carrier_layout_assignment_carrier_idx on public.carrier_layout_assignment (carrier_id);
create index if not exists carrier_layout_assignment_tenant_idx on public.carrier_layout_assignment (tenant_id);
create index if not exists carrier_layout_assignment_created_by_idx on public.carrier_layout_assignment (created_by);
create index if not exists carrier_layout_assignment_created_by_admin_idx on public.carrier_layout_assignment (created_by_admin);

-- ─── a published version is frozen (the LA-3.13 rule) ──────────────────────────────────────────
create or replace function public.carrier_layout_map_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    if new.status in ('published', 'retired') then
      raise exception 'A layout map is published from a draft, never inserted published.' using errcode = 'P0001';
    end if;
    select file_type into v_type from public.carrier_layout_map
     where layout_key = new.layout_key and coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     limit 1;
    if v_type is not null and v_type <> new.file_type then
      raise exception 'Every version of layout % reads % files.', new.layout_key, v_type using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'A published layout map is never deleted; retire it.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status in ('published', 'retired') then
    if new.tenant_id is distinct from old.tenant_id or new.layout_key is distinct from old.layout_key
       or new.name is distinct from old.name or new.file_type is distinct from old.file_type
       or new.version is distinct from old.version or new.header_row_index is distinct from old.header_row_index
       or new.sheet_name is distinct from old.sheet_name or new.row_count_swing_pct is distinct from old.row_count_swing_pct
       or new.total_row_column is distinct from old.total_row_column or new.total_row_value is distinct from old.total_row_value
       or new.proposal_source is distinct from old.proposal_source or new.created_by is distinct from old.created_by
       or new.created_by_admin is distinct from old.created_by_admin or new.approved_by is distinct from old.approved_by
       or new.approved_by_admin is distinct from old.approved_by_admin or new.approved_at is distinct from old.approved_at then
      raise exception 'A published layout map cannot be edited; start version % instead.', old.version + 1 using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'A published layout map can only be retired.' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists carrier_layout_map_guard on public.carrier_layout_map;
create trigger carrier_layout_map_guard before insert or update or delete on public.carrier_layout_map
  for each row execute function public.carrier_layout_map_guard();

create or replace function public.carrier_layout_map_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.carrier_layout_map where id = coalesce(new.map_id, old.map_id);
  -- A map being deleted (a draft) takes its entries with it; its row is already gone here.
  if v_status in ('published', 'retired') then
    raise exception 'A published layout map''s columns cannot change; start a new version.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.map_id is distinct from old.map_id then
    raise exception 'An entry stays on its map.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists carrier_layout_map_entry_guard on public.carrier_layout_map_entry;
create trigger carrier_layout_map_entry_guard before insert or update or delete on public.carrier_layout_map_entry
  for each row execute function public.carrier_layout_map_entry_guard();

-- Publishing: the draft becomes the live version and the one before it retires, in one step.
create or replace function public.publish_layout_map(p_map_id uuid, p_admin_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.carrier_layout_map%rowtype;
begin
  if (p_admin_id is null) = (p_user_id is null) then
    raise exception 'A layout map is approved by one person: staff or an agency member.' using errcode = '22023';
  end if;
  select * into v_map from public.carrier_layout_map where id = p_map_id for update;
  if not found then raise exception 'That layout map does not exist.' using errcode = 'P0002'; end if;
  if v_map.status not in ('draft', 'in_review') then
    raise exception 'Only a draft or a map in review can be published.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.carrier_layout_map_entry where map_id = p_map_id) then
    raise exception 'A layout map needs at least one column before it is published.' using errcode = 'P0001';
  end if;
  update public.carrier_layout_map set status = 'retired'
   where layout_key = v_map.layout_key and status = 'published' and id <> p_map_id
     and coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_map.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
  update public.carrier_layout_map
     set status = 'published', approved_by = p_user_id, approved_by_admin = p_admin_id, approved_at = now()
   where id = p_map_id;
  return p_map_id;
end;
$$;
revoke all on function public.publish_layout_map(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_layout_map(uuid, uuid, uuid) to service_role;

-- ─── the file records the map that parsed it ───────────────────────────────────────────────────
alter table public.file_registry add column if not exists parse_block text;
-- Typed rows the map read (raw rows minus blank lines, a total row, and rows held back): what the
-- next file's row-count swing is measured against.
alter table public.file_registry add column if not exists parsed_row_count integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'file_registry_parse_block') then
    alter table public.file_registry add constraint file_registry_parse_block check (parse_block is null or parse_block = 'no_layout_map');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'file_registry_parser_fkey') then
    alter table public.file_registry add constraint file_registry_parser_fkey foreign key (parser_id) references public.carrier_layout_map(id);
  end if;
end $$;
create index if not exists file_registry_parser_idx on public.file_registry (parser_id);
comment on column public.file_registry.parse_block is
  'LA-4.3: why a file is waiting rather than parsed — no_layout_map until one is published for its carrier and type.';

-- ─── agent findings (the LA-4.19 table, first used by the parser guardian) ─────────────────────
create table if not exists public.agent_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_name text not null,
  run_id uuid,
  file_id uuid references public.file_registry(id),
  map_id uuid references public.carrier_layout_map(id),
  map_version integer,
  finding_type text not null,
  severity text not null,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  reasoning text not null,
  proposed_action jsonb,
  status text not null default 'open',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_by_admin uuid references public.admin_users(id) on delete set null,
  reviewed_at timestamptz,
  model_id text,
  prompt_version text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  constraint agent_findings_dedupe_key unique (tenant_id, dedupe_key),
  constraint agent_findings_agent check (agent_name in ('file_monitor', 'parser_guardian', 'pdf_extractor', 'matching_agent', 'commission_reconciler', 'insights_analyst')),
  constraint agent_findings_severity check (severity in ('info', 'warning', 'blocking')),
  constraint agent_findings_status check (status in ('open', 'approved', 'rejected', 'auto_resolved')),
  constraint agent_findings_reasoning check (char_length(reasoning) between 1 and 4000),
  constraint agent_findings_confidence check (confidence is null or confidence between 0 and 1),
  constraint agent_findings_model check ((model_id is null) = (prompt_version is null))
);
create index if not exists agent_findings_tenant_idx on public.agent_findings (tenant_id, created_at desc);
create index if not exists agent_findings_file_idx on public.agent_findings (file_id);
create index if not exists agent_findings_map_idx on public.agent_findings (map_id);
create index if not exists agent_findings_reviewed_by_idx on public.agent_findings (reviewed_by);
create index if not exists agent_findings_reviewed_by_admin_idx on public.agent_findings (reviewed_by_admin);

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.carrier_layout_map enable row level security;
alter table public.carrier_layout_map_entry enable row level security;
alter table public.carrier_layout_assignment enable row level security;
alter table public.agent_findings enable row level security;

drop policy if exists carrier_layout_map_tenant_read on public.carrier_layout_map;
create policy carrier_layout_map_tenant_read on public.carrier_layout_map
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_layout_map_entry_tenant_read on public.carrier_layout_map_entry;
create policy carrier_layout_map_entry_tenant_read on public.carrier_layout_map_entry
  for select to tenant_app
  using (exists (select 1 from public.carrier_layout_map m where m.id = map_id
                  and (m.tenant_id is null or m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists carrier_layout_assignment_tenant_read on public.carrier_layout_assignment;
create policy carrier_layout_assignment_tenant_read on public.carrier_layout_assignment
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists agent_findings_tenant_read on public.agent_findings;
create policy agent_findings_tenant_read on public.agent_findings
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.carrier_layout_map, public.carrier_layout_map_entry, public.carrier_layout_assignment, public.agent_findings from public, anon, authenticated;
revoke truncate on public.carrier_layout_map, public.carrier_layout_map_entry from service_role, tenant_app;
revoke delete, truncate on public.agent_findings from service_role, tenant_app;
grant select, insert, update, delete on public.carrier_layout_map, public.carrier_layout_map_entry, public.carrier_layout_assignment to service_role;
grant select, insert, update on public.agent_findings to service_role;
grant select on public.carrier_layout_map, public.carrier_layout_map_entry, public.carrier_layout_assignment, public.agent_findings to tenant_app;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'carrier_layout_map_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'carrier_layout_map_entry_guard' and not tgisinternal) then
    raise exception '20261008120000: the frozen-once-published guards are missing';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'carrier_layout_map_one_published') then
    raise exception '20261008120000: one-published-version index is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'file_registry_parser_fkey') then
    raise exception '20261008120000: file_registry.parser_id does not point at a layout map';
  end if;
  if has_table_privilege('service_role', 'public.agent_findings', 'DELETE') then
    raise exception '20261008120000: findings can be deleted';
  end if;
  if not exists (select 1 from pg_proc where proname = 'publish_layout_map' and prosecdef) then
    raise exception '20261008120000: publish_layout_map is missing';
  end if;
  if exists (select 1 from public.carrier_layout_map) then
    raise notice '20261008120000: layout maps already exist; nothing was seeded here.';
  end if;
end $$;
