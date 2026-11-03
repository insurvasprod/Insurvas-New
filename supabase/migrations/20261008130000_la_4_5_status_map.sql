-- LA-4.5 (Notion sprint) · one status vocabulary for every carrier, and the unknown-status gate.
--
-- Every carrier has its own words for a policy's state ("INFORCE", "Lapse-NonPay", "Grace Period").
-- They are mapped into nine shared values, and the carrier's own word is always kept beside ours:
--
--   submitted · declined · withdrawn · approved_unpaid · not_taken · active · at_risk · lapsed · paid_up
--
-- Matching is EXACT: no trimming, no case folding, nothing fuzzy. "ACTIVE" and "ACTIVE " are two
-- different words, and the second goes to the queue rather than quietly becoming the first.
--
-- An unseen word never maps silently. Its rows are held back from everything downstream, the word
-- goes on the agency's unmapped-status queue (one entry per distinct word, with how many rows wait on
-- it), the parser guardian records it and the agency is told. A person maps it; a mapping takes
-- effect only once approved, and approving it reprocesses the held rows — nothing is uploaded again.
--
-- Mappings are platform data (a carrier's word means the same for every agency) and are kept, never
-- edited, once approved. No mapping is seeded: seeds come only from statuses actually seen in real
-- carrier sample files (owner decision 2026-10-07).
--
-- Additive. Requires 20261008100000, 20261008120000.
--
-- Rollback:
--   alter table public.file_registry drop column if exists held_row_count;
--   drop function if exists public.approve_status_mapping(uuid, uuid, uuid);
--   drop function if exists public.record_unmapped_statuses(uuid, uuid, uuid, text, jsonb);
--   drop table if exists public.unmapped_status_occurrences, public.unmapped_status_queue, public.carrier_status_map;

create table if not exists public.carrier_status_map (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  file_type text not null,
  carrier_status_raw text not null,
  status_normalized text not null,
  mapped_by uuid references public.users(id) on delete set null,
  mapped_by_admin uuid references public.admin_users(id) on delete set null,
  mapped_at timestamptz not null default now(),
  approved_by uuid references public.users(id) on delete restrict,
  approved_by_admin uuid references public.admin_users(id) on delete restrict,
  approved_at timestamptz,
  proposal_source text not null default 'manual',
  notes text,
  constraint carrier_status_map_key unique (carrier_id, file_type, carrier_status_raw),
  constraint carrier_status_map_file_type check (file_type in ('policies', 'commissions')),
  constraint carrier_status_map_raw check (char_length(carrier_status_raw) between 1 and 200),
  constraint carrier_status_map_normalized check (status_normalized in ('submitted', 'declined', 'withdrawn', 'approved_unpaid', 'not_taken', 'active', 'at_risk', 'lapsed', 'paid_up')),
  constraint carrier_status_map_approved check ((approved_at is null) = (approved_by is null and approved_by_admin is null)),
  constraint carrier_status_map_proposal check (proposal_source in ('manual', 'ai')),
  constraint carrier_status_map_notes check (notes is null or char_length(notes) <= 1000)
);
create index if not exists carrier_status_map_lookup_idx on public.carrier_status_map (carrier_id, file_type) where approved_at is not null;
create index if not exists carrier_status_map_mapped_by_idx on public.carrier_status_map (mapped_by);
create index if not exists carrier_status_map_mapped_by_admin_idx on public.carrier_status_map (mapped_by_admin);
create index if not exists carrier_status_map_approved_by_idx on public.carrier_status_map (approved_by);
create index if not exists carrier_status_map_approved_by_admin_idx on public.carrier_status_map (approved_by_admin);

-- An approved mapping is history: what a file was read with. It is never changed or removed.
create or replace function public.carrier_status_map_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.approved_at is not null then
      raise exception 'An approved status mapping is never removed.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.approved_at is not null then
    raise exception 'An approved status mapping cannot change.' using errcode = 'P0001';
  end if;
  if new.carrier_id is distinct from old.carrier_id or new.file_type is distinct from old.file_type
     or new.carrier_status_raw is distinct from old.carrier_status_raw then
    raise exception 'A status mapping keeps the carrier word it was made for.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists carrier_status_map_guard on public.carrier_status_map;
create trigger carrier_status_map_guard before update or delete on public.carrier_status_map
  for each row execute function public.carrier_status_map_guard();

create table if not exists public.unmapped_status_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  file_type text not null,
  carrier_status_raw text not null,
  row_count integer not null default 0,
  first_seen_file_id uuid references public.file_registry(id),
  first_seen_at timestamptz not null default now(),
  proposed_status_normalized text,
  proposal_reasoning text,
  proposed_at timestamptz,
  proposed_model_id text,
  notified_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_by_admin uuid references public.admin_users(id) on delete set null,
  resolved_at timestamptz,
  resolution_map_id uuid references public.carrier_status_map(id),
  constraint unmapped_status_queue_key unique (tenant_id, carrier_id, file_type, carrier_status_raw),
  constraint unmapped_status_queue_file_type check (file_type in ('policies', 'commissions')),
  constraint unmapped_status_queue_raw check (char_length(carrier_status_raw) between 1 and 200),
  constraint unmapped_status_queue_rows check (row_count >= 0),
  constraint unmapped_status_queue_proposal check (proposed_status_normalized is null or proposed_status_normalized in ('submitted', 'declined', 'withdrawn', 'approved_unpaid', 'not_taken', 'active', 'at_risk', 'lapsed', 'paid_up')),
  constraint unmapped_status_queue_resolved check ((resolved_at is null) = (resolution_map_id is null))
);
create index if not exists unmapped_status_queue_open_idx on public.unmapped_status_queue (carrier_id, file_type, carrier_status_raw) where resolved_at is null;
create index if not exists unmapped_status_queue_tenant_idx on public.unmapped_status_queue (tenant_id, resolved_at);
create index if not exists unmapped_status_queue_file_idx on public.unmapped_status_queue (first_seen_file_id);
create index if not exists unmapped_status_queue_resolved_by_idx on public.unmapped_status_queue (resolved_by);
create index if not exists unmapped_status_queue_resolved_by_admin_idx on public.unmapped_status_queue (resolved_by_admin);
create index if not exists unmapped_status_queue_map_idx on public.unmapped_status_queue (resolution_map_id);

-- How many rows of each file wait on each word: the queue's count is their sum, so re-parsing a file
-- replaces its own count instead of adding to it.
create table if not exists public.unmapped_status_occurrences (
  queue_id uuid not null references public.unmapped_status_queue(id) on delete cascade,
  file_id uuid not null references public.file_registry(id),
  row_count integer not null,
  updated_at timestamptz not null default now(),
  constraint unmapped_status_occurrences_pkey primary key (queue_id, file_id),
  constraint unmapped_status_occurrences_rows check (row_count >= 0)
);
create index if not exists unmapped_status_occurrences_file_idx on public.unmapped_status_occurrences (file_id);

alter table public.file_registry add column if not exists held_row_count integer;
comment on column public.file_registry.held_row_count is
  'LA-4.5: typed rows held back because their carrier status is not mapped yet. They pass once a mapping is approved and the file is reprocessed.';

-- What one parse of one file found unmapped: [{ "raw": "<word, verbatim>", "rows": n }]. Returns the
-- queue entries, saying which are new (so the agency is told once per word).
create or replace function public.record_unmapped_statuses(p_tenant_id uuid, p_file_id uuid, p_carrier_id uuid, p_file_type text, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_queue uuid;
  v_new boolean;
  v_out jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.file_registry where id = p_file_id and tenant_id = p_tenant_id) then
    raise exception 'That file is not in this workspace.' using errcode = 'P0002';
  end if;
  -- This file's earlier counts are replaced, not added to.
  update public.unmapped_status_occurrences o set row_count = 0, updated_at = now()
    from public.unmapped_status_queue q
   where o.queue_id = q.id and o.file_id = p_file_id and q.tenant_id = p_tenant_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) loop
    insert into public.unmapped_status_queue (tenant_id, carrier_id, file_type, carrier_status_raw, first_seen_file_id)
    values (p_tenant_id, p_carrier_id, p_file_type, v_item ->> 'raw', p_file_id)
    on conflict (tenant_id, carrier_id, file_type, carrier_status_raw) do nothing
    returning id into v_queue;
    v_new := v_queue is not null;
    if v_queue is null then
      select id into v_queue from public.unmapped_status_queue
       where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type and carrier_status_raw = v_item ->> 'raw';
    end if;
    insert into public.unmapped_status_occurrences (queue_id, file_id, row_count)
    values (v_queue, p_file_id, (v_item ->> 'rows')::integer)
    on conflict (queue_id, file_id) do update set row_count = excluded.row_count, updated_at = now();
    v_out := v_out || jsonb_build_object('id', v_queue, 'raw', v_item ->> 'raw', 'new', v_new);
  end loop;
  update public.unmapped_status_queue q
     set row_count = coalesce((select sum(o.row_count) from public.unmapped_status_occurrences o where o.queue_id = q.id), 0)
   where q.tenant_id = p_tenant_id and q.carrier_id = p_carrier_id and q.file_type = p_file_type;
  return v_out;
end;
$$;

-- Approving a mapping makes it take effect and resolves every agency's queue entry for that word.
-- Returns the files whose held rows now pass, for the caller to reprocess.
create or replace function public.approve_status_mapping(p_map_id uuid, p_admin_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.carrier_status_map%rowtype;
  v_files jsonb;
begin
  if (p_admin_id is null) = (p_user_id is null) then
    raise exception 'A status mapping is approved by one person: staff or an agency member.' using errcode = '22023';
  end if;
  select * into v_map from public.carrier_status_map where id = p_map_id for update;
  if not found then raise exception 'That status mapping does not exist.' using errcode = 'P0002'; end if;
  if v_map.approved_at is not null then raise exception 'That status mapping is already approved.' using errcode = 'P0001'; end if;
  update public.carrier_status_map set approved_by = p_user_id, approved_by_admin = p_admin_id, approved_at = now() where id = p_map_id;
  select coalesce(jsonb_agg(distinct jsonb_build_object('tenant_id', q.tenant_id, 'file_id', o.file_id)), '[]'::jsonb) into v_files
    from public.unmapped_status_queue q
    join public.unmapped_status_occurrences o on o.queue_id = q.id and o.row_count > 0
   where q.carrier_id = v_map.carrier_id and q.file_type = v_map.file_type and q.carrier_status_raw = v_map.carrier_status_raw and q.resolved_at is null;
  update public.unmapped_status_queue
     set resolved_at = now(), resolved_by = p_user_id, resolved_by_admin = p_admin_id, resolution_map_id = p_map_id
   where carrier_id = v_map.carrier_id and file_type = v_map.file_type and carrier_status_raw = v_map.carrier_status_raw and resolved_at is null;
  return v_files;
end;
$$;

revoke all on function public.record_unmapped_statuses(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.approve_status_mapping(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_unmapped_statuses(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.approve_status_mapping(uuid, uuid, uuid) to service_role;

alter table public.carrier_status_map enable row level security;
alter table public.unmapped_status_queue enable row level security;
alter table public.unmapped_status_occurrences enable row level security;
drop policy if exists carrier_status_map_read on public.carrier_status_map;
create policy carrier_status_map_read on public.carrier_status_map for select to tenant_app using (approved_at is not null);
drop policy if exists unmapped_status_queue_tenant_read on public.unmapped_status_queue;
create policy unmapped_status_queue_tenant_read on public.unmapped_status_queue for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists unmapped_status_occurrences_tenant_read on public.unmapped_status_occurrences;
create policy unmapped_status_occurrences_tenant_read on public.unmapped_status_occurrences for select to tenant_app
  using (exists (select 1 from public.unmapped_status_queue q where q.id = queue_id and q.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));

revoke all on public.carrier_status_map, public.unmapped_status_queue, public.unmapped_status_occurrences from public, anon, authenticated;
revoke truncate on public.carrier_status_map from service_role, tenant_app;
revoke delete, truncate on public.unmapped_status_queue, public.unmapped_status_occurrences from service_role, tenant_app;
grant select, insert, update, delete on public.carrier_status_map to service_role;
grant select, insert, update on public.unmapped_status_queue, public.unmapped_status_occurrences to service_role;
grant select on public.carrier_status_map, public.unmapped_status_queue, public.unmapped_status_occurrences to tenant_app;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'carrier_status_map_guard' and not tgisinternal) then
    raise exception '20261008130000: the approved-mapping guard is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_status_map_key') then
    raise exception '20261008130000: one mapping per carrier word is not enforced';
  end if;
  if not exists (select 1 from pg_proc where proname = 'approve_status_mapping' and prosecdef)
     or not exists (select 1 from pg_proc where proname = 'record_unmapped_statuses' and prosecdef) then
    raise exception '20261008130000: a status-gate function is missing';
  end if;
  if has_table_privilege('service_role', 'public.unmapped_status_queue', 'DELETE') then
    raise exception '20261008130000: queue entries can be deleted';
  end if;
  if exists (select 1 from public.carrier_status_map) then
    raise notice '20261008130000: status mappings already exist; nothing was seeded here.';
  end if;
end $$;
