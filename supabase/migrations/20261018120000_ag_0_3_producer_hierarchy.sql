-- AG-0.3 (Notion sprint, Agency Module 0) · who reports to whom, effective-dated, so a reorg never rewrites
-- history.
--
--   producer_hierarchy  one row per (producer, period). parent_producer_id null = reports to the owner.
--                       Two levels ship (owner above producers; a manager above his reports), but the table
--                       carries parent_producer_id so depth can grow later WITHOUT a migration.
--   Overlaps            one producer cannot have two managers on one day — an EXCLUSION constraint over the
--                       date range (btree_gist), not a trigger (spec rule).
--   Cycles              a producer can never report to himself or to anyone below him — refused by the one
--                       writer, move_producer_to_manager, which walks the chain as of the move date.
--   History             a move CLOSES the current row (effective_to = the day before) and INSERTS a new one.
--                       Nobody may UPDATE a row's parent: the application roles hold no UPDATE at all, and
--                       the writer only ever sets effective_to on the row it closes.
--   producer_direct_reports(manager, as_of)  ONE level deep, as of a date. NOT the recursive descendants
--                       query: when three levels are asked for, that becomes a recursive CTE and every report
--                       needs a roll-up toggle — a project, flagged, not quietly built.
--
-- Requires 20261018100000 (producer), btree_gist (20260913370000).
--
-- Rollback:
--   drop function if exists public.producer_direct_reports(uuid, uuid, date);
--   drop function if exists public.move_producer_to_manager(uuid, uuid, uuid, date, uuid);
--   drop table if exists public.producer_hierarchy;

create extension if not exists btree_gist;

create table if not exists public.producer_hierarchy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agency_id uuid not null,
  producer_id uuid not null,
  parent_producer_id uuid,
  effective_from date not null,
  effective_to date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint producer_hierarchy_producer_fk foreign key (producer_id, tenant_id) references public.producer (id, tenant_id) on delete cascade,
  constraint producer_hierarchy_parent_fk foreign key (parent_producer_id, tenant_id) references public.producer (id, tenant_id) on delete restrict,
  constraint producer_hierarchy_agency_fk foreign key (agency_id, tenant_id) references public.agency (id, tenant_id) on delete cascade,
  constraint producer_hierarchy_unique_start unique (producer_id, effective_from),
  constraint producer_hierarchy_not_self check (parent_producer_id is null or parent_producer_id <> producer_id),
  constraint producer_hierarchy_dates check (effective_to is null or effective_to >= effective_from),
  -- One manager per producer per day. daterange is [from, to] inclusive; an open end runs forever.
  constraint producer_hierarchy_no_overlap exclude using gist (
    producer_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);
create index if not exists producer_hierarchy_parent_asof on public.producer_hierarchy (tenant_id, parent_producer_id, effective_from);

revoke all on public.producer_hierarchy from public, anon, authenticated;
revoke insert, update, delete, truncate on public.producer_hierarchy from service_role, tenant_app;
grant select on public.producer_hierarchy to service_role, tenant_app;

alter table public.producer_hierarchy enable row level security;
drop policy if exists producer_hierarchy_tenant_read on public.producer_hierarchy;
create policy producer_hierarchy_tenant_read on public.producer_hierarchy for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── the one writer ───────────────────────────────────────────────────────────────────────────────
-- p_parent null = reports to the owner. p_effective_from is the first day under the new manager.
create or replace function public.move_producer_to_manager(
  p_tenant_id uuid,
  p_producer_id uuid,
  p_parent_producer_id uuid,
  p_effective_from date,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_current public.producer_hierarchy%rowtype;
  v_walk uuid;
  v_depth int := 0;
  v_id uuid;
begin
  select agency_id into v_agency from public.producer where id = p_producer_id and tenant_id = p_tenant_id;
  if v_agency is null then raise exception 'producer_not_found' using errcode = 'P0001'; end if;
  if p_effective_from is null then raise exception 'effective_from_required' using errcode = 'P0001'; end if;
  if p_parent_producer_id is not null then
    if p_parent_producer_id = p_producer_id then raise exception 'hierarchy_cycle' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.producer where id = p_parent_producer_id and tenant_id = p_tenant_id and status <> 'offboarded') then
      raise exception 'manager_not_found' using errcode = 'P0001';
    end if;
    -- Walk up from the new manager as of the move date: meeting the producer means a cycle.
    v_walk := p_parent_producer_id;
    while v_walk is not null and v_depth < 64 loop
      select h.parent_producer_id into v_walk
        from public.producer_hierarchy h
       where h.producer_id = v_walk and p_effective_from between h.effective_from and coalesce(h.effective_to, 'infinity'::date);
      if v_walk = p_producer_id then raise exception 'hierarchy_cycle' using errcode = 'P0001'; end if;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- The row in force on the move date. A move dated before it started is a correction of that row's start,
  -- which history forbids; refuse rather than rewrite.
  select * into v_current from public.producer_hierarchy h
   where h.producer_id = p_producer_id and p_effective_from between h.effective_from and coalesce(h.effective_to, 'infinity'::date)
   for update;
  if found then
    if v_current.parent_producer_id is not distinct from p_parent_producer_id then
      return v_current.id; -- already reports there; nothing to write
    end if;
    if v_current.effective_from = p_effective_from then
      raise exception 'hierarchy_same_day' using errcode = 'P0001',
        hint = 'This producer already moved on that day. Pick the next day.';
    end if;
    update public.producer_hierarchy set effective_to = p_effective_from - 1 where id = v_current.id;
  end if;
  -- A later row already scheduled would overlap an open-ended insert; end the new row the day before it.
  insert into public.producer_hierarchy (tenant_id, agency_id, producer_id, parent_producer_id, effective_from, effective_to, created_by)
  values (
    p_tenant_id, v_agency, p_producer_id, p_parent_producer_id, p_effective_from,
    (select min(h.effective_from) - 1 from public.producer_hierarchy h where h.producer_id = p_producer_id and h.effective_from > p_effective_from),
    p_actor
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.move_producer_to_manager(uuid, uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.move_producer_to_manager(uuid, uuid, uuid, date, uuid) to service_role;

-- ─── one level deep, as of a date ──────────────────────────────────────────────────────────────────
create or replace function public.producer_direct_reports(p_tenant_id uuid, p_manager_producer_id uuid, p_as_of date)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.producer_id
    from public.producer_hierarchy h
   where h.tenant_id = p_tenant_id
     and h.parent_producer_id = p_manager_producer_id
     and p_as_of between h.effective_from and coalesce(h.effective_to, '9999-12-31'::date);
$$;
revoke all on function public.producer_direct_reports(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.producer_direct_reports(uuid, uuid, date) to service_role, tenant_app;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.producer_hierarchy', 'UPDATE')
     or has_table_privilege('tenant_app', 'public.producer_hierarchy', 'UPDATE') then
    raise exception 'AG-0.3: an application role can UPDATE hierarchy rows';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'producer_hierarchy_no_overlap' and contype = 'x') then
    raise exception 'AG-0.3: overlapping hierarchy periods are not refused by an exclusion constraint';
  end if;
end;
$$;
