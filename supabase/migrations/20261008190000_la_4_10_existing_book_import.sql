-- LA-4.10 (Notion sprint) · existing-book import: a new agency uploads each carrier's latest policy
-- file and sees its book on day one — through the SAME pipeline (LA-4.1 → 4.7), not a special path.
--
--   · file_registry.is_initial_import  set by the import screen's upload. Everything else about the
--     file is ordinary: raw rows, parse, status gate, snapshots, current rows.
--   · No phantom changes: a policy's first snapshot already makes one first-seen event and no change
--     row (LA-4.6), so an imported book of 400 policies makes 0 policy_change rows.
--   · Bulk matching (LA-4.8 in import mode): these policies predate us, so each one not linked by
--     number gets its client (exact identity, or a provisional one) WITHOUT a queue-1 item, and the
--     file gets ONE `initial_import` summary item instead — 400 items on day one is a wall.
--   · carrier_portal_guidance  where each carrier's file lives in its portal, in plain words. Content,
--     edited by staff without a deploy. It ships EMPTY: no portal instructions are invented here.
--   · book_import_carrier  the agency's progress per carrier: imported, or skipped (reversible).
--
-- Additive. Requires 20261008180100 (the exception queues).
--
-- Rollback:
--   (re-run 20261008180000's queue_owner definition)
--   drop table if exists public.book_import_carrier, public.carrier_portal_guidance;
--   alter table public.file_registry drop column if exists is_initial_import;

alter table public.file_registry add column if not exists is_initial_import boolean not null default false;
create index if not exists file_registry_initial_import_idx on public.file_registry (tenant_id, carrier_id) where is_initial_import;

-- ─── portal guidance (platform content) ─────────────────────────────────────────────────────────
create table if not exists public.carrier_portal_guidance (
  carrier_id uuid primary key references public.carriers(id) on delete cascade,
  where_in_portal text,
  report_name text,
  format_hint text,
  notes text,
  updated_by_admin uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint carrier_portal_guidance_lengths check (
    (where_in_portal is null or char_length(where_in_portal) <= 1000) and (report_name is null or char_length(report_name) <= 200)
    and (format_hint is null or char_length(format_hint) <= 200) and (notes is null or char_length(notes) <= 2000)
  ),
  constraint carrier_portal_guidance_has_content check (coalesce(where_in_portal, report_name, format_hint, notes) is not null)
);
create index if not exists carrier_portal_guidance_updated_by_idx on public.carrier_portal_guidance (updated_by_admin) where updated_by_admin is not null;

-- ─── per-carrier import progress ────────────────────────────────────────────────────────────────
create table if not exists public.book_import_carrier (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  status text not null,
  file_id uuid references public.file_registry(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, carrier_id),
  constraint book_import_carrier_status check (status in ('imported', 'skipped'))
);
create index if not exists book_import_carrier_carrier_idx on public.book_import_carrier (carrier_id);
create index if not exists book_import_carrier_file_idx on public.book_import_carrier (file_id) where file_id is not null;
create index if not exists book_import_carrier_updated_by_idx on public.book_import_carrier (updated_by) where updated_by is not null;

-- ─── the summary item: a fourth queue type, owned by the agency's owner ─────────────────────────
alter table public.queue_item drop constraint if exists queue_item_type;
alter table public.queue_item add constraint queue_item_type check (queue_type in ('no_deal_flow', 'no_policy', 'multi_policy', 'initial_import', 'unmapped_status', 'orphan_commission', 'file_failed'));
alter table public.queue_assignment_rule drop constraint if exists queue_assignment_rule_type;
alter table public.queue_assignment_rule add constraint queue_assignment_rule_type check (queue_type in ('no_deal_flow', 'no_policy', 'multi_policy', 'initial_import', 'unmapped_status', 'orphan_commission', 'file_failed'));

-- queue_owner as in 20261008180000, with initial_import → the owner by default.
create or replace function public.queue_owner(p_tenant_id uuid, p_queue_type text, p_writing_agent uuid default null)
returns table (user_id uuid, role text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_user uuid;
begin
  select r.owner_role into v_role from public.queue_assignment_rule r where r.tenant_id = p_tenant_id and r.queue_type = p_queue_type;
  v_role := coalesce(v_role, case p_queue_type when 'multi_policy' then 'operations' when 'orphan_commission' then 'operations' when 'file_failed' then 'operations' when 'unmapped_status' then 'operations' when 'initial_import' then 'admin' else 'writing_agent' end);
  if v_role = 'writing_agent' then
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     -- A writing agent who can open the queue screen (it carries premiums: owner or producer).
     where tu.tenant_id = p_tenant_id and tu.user_id = p_writing_agent and u.status = 'active' and tu.role::text in ('owner', 'producer');
  else
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and u.status = 'active'
       and tu.role::text = case v_role when 'operations' then 'bookkeeper' when 'retention' then 'producer' else 'owner' end
     order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
  end if;
  if v_user is null then
    -- Nobody in that role (or the agent is unknown): the agency's owner, never nobody.
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.role::text = 'owner' and u.status = 'active'
     order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
    v_role := 'admin';
  end if;
  if v_user is null then
    raise exception 'queue_owner: agency % has no active owner to own a queue item', p_tenant_id using errcode = 'P0001';
  end if;
  return query select v_user, v_role;
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.carrier_portal_guidance enable row level security;
alter table public.book_import_carrier enable row level security;
drop policy if exists carrier_portal_guidance_read on public.carrier_portal_guidance;
create policy carrier_portal_guidance_read on public.carrier_portal_guidance for select to tenant_app using (true);
drop policy if exists book_import_carrier_read on public.book_import_carrier;
create policy book_import_carrier_read on public.book_import_carrier for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_portal_guidance, public.book_import_carrier from public, anon, authenticated;
revoke truncate on public.carrier_portal_guidance, public.book_import_carrier from service_role, tenant_app;
grant select, insert, update, delete on public.carrier_portal_guidance, public.book_import_carrier to service_role;
grant select on public.carrier_portal_guidance, public.book_import_carrier to tenant_app;

do $$
begin
  if exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.role::text = 'owner' and u.status = 'active')
     and (select o.role from public.queue_owner((select tu.tenant_id from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.role::text = 'owner' and u.status = 'active' limit 1), 'initial_import', null) o) <> 'admin' then
    raise exception '20261008190000: the import summary must belong to the owner by default';
  end if;
  if exists (select 1 from public.carrier_portal_guidance) and not exists (select 1 from public.carrier_portal_guidance where updated_by_admin is not null) then
    raise exception '20261008190000: guidance rows must be written by staff';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'file_registry' and column_name = 'is_initial_import') then
    raise exception '20261008190000: file_registry.is_initial_import is missing';
  end if;
end $$;
