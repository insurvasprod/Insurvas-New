-- LA-1.9: the pipeline operations, ported onto the renamed tables.
--
-- 20260912270000 gave this application tenant_pipelines and tenant_pipeline_stages, because
-- public.pipelines belongs to the organizations-era CRM and is keyed by bigint. It deliberately
-- carried across only what LA-1.4 needed: the tables, the default seeding, and the tenant trigger.
-- The rest of LA-1.9 was left out rather than ported blind, and recorded as backlog 170.
--
-- This is that remainder. Five functions and one table, none of which exist in this database:
--
--   reorder_pipeline_stages    archive_pipeline_stage    delete_tenant_pipeline
--   set_stage_disposition      move_lead_to_disposition  stage_dispositions
--
-- verify-rpc-contract named all five independently, from the other direction: they are RPCs the
-- application calls that the database does not have, so every route reaching one returns 500.
-- verify-pipelines fails seven checks on exactly this.
--
-- The bodies are the originals from 20260902190000, 20260902200000 and 20260902204659 with
-- pipelines -> tenant_pipelines and pipeline_stages -> tenant_pipeline_stages. Parameter names and
-- order are unchanged, because lib/pipelines/service.ts already calls them by those names.
--
-- TWO DELIBERATE OMISSIONS, both in delete_tenant_pipeline's "is this pipeline in use" guard.
--
-- The original also refuses deletion when a disposition walk references one of the pipeline's
-- stages, and then clears disposition_flows rows pointing at them. Neither can be carried across:
--
--   disposition_walks   does not exist in this database at all -- it is LA-1.12, still unbuilt.
--                       A guard against rows in a table that cannot hold any is not a guard.
--   disposition_flows   exists, but it is the CRM's table, keyed by bigint, and quarantined for the
--                       same reason public.pipelines was. This application's stage ids could never
--                       appear in it, and deleting from another product's table is the line this
--                       reconciliation has not crossed all week.
--
-- Both clauses must come back when LA-1.12 lands and brings disposition_walks with it. Until then
-- their absence is safe and stated rather than silent. Recorded in backlog 170.

create table if not exists public.stage_dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage_id uuid not null references public.tenant_pipeline_stages(id) on delete restrict,
  disposition_key text not null check (disposition_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- LA-1.9's first named trap: the existing system's map is one-to-one globally, so two tenants
  -- cannot both have a "New Submission" disposition. Both keys are scoped by tenant_id here.
  unique (tenant_id, disposition_key),
  unique (tenant_id, stage_id)
);

alter table public.stage_dispositions enable row level security;

drop policy if exists stage_dispositions_tenant_scoped on public.stage_dispositions;
create policy stage_dispositions_tenant_scoped on public.stage_dispositions for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.stage_dispositions from anon, authenticated, public;
grant select on public.stage_dispositions to tenant_app;
grant select, insert, update, delete on public.stage_dispositions to service_role;

-- Positions are renumbered by shifting every row out of range first, because the partial unique
-- index on (pipeline_id, position) where not is_archived would otherwise collide mid-update.
create or replace function public.reorder_pipeline_stages(
  p_tenant_id uuid,
  p_pipeline_id uuid,
  p_stage_ids uuid[]
)
returns setof public.tenant_pipeline_stages
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
begin
  if not exists (select 1 from public.tenant_pipelines where id = p_pipeline_id and tenant_id = p_tenant_id) then
    raise exception 'pipeline_not_found';
  end if;
  select count(*) into expected_count from public.tenant_pipeline_stages where pipeline_id = p_pipeline_id and not is_archived;
  if coalesce(array_length(p_stage_ids, 1), 0) <> expected_count
    or (select count(*) from unnest(p_stage_ids) as ids(id)) <> expected_count
    or exists (
      select 1 from public.tenant_pipeline_stages s
      where s.pipeline_id = p_pipeline_id and not s.is_archived
        and not (s.id = any(p_stage_ids))
    ) then
    raise exception 'stage_set_mismatch';
  end if;
  perform 1 from public.tenant_pipeline_stages where pipeline_id = p_pipeline_id for update;
  update public.tenant_pipeline_stages set position = position + 1000000, updated_at = now()
    where pipeline_id = p_pipeline_id and not is_archived;
  update public.tenant_pipeline_stages s set position = u.position - 1, updated_at = now()
  from unnest(p_stage_ids) with ordinality as u(id, position)
  where s.id = u.id and s.pipeline_id = p_pipeline_id;
  return query select * from public.tenant_pipeline_stages where pipeline_id = p_pipeline_id order by is_archived, position, created_at;
end;
$$;

create or replace function public.archive_pipeline_stage(p_tenant_id uuid, p_stage_id uuid)
returns public.tenant_pipeline_stages
language plpgsql
security definer
set search_path = public
as $$
declare
  stage_row public.tenant_pipeline_stages;
  active_count integer;
begin
  select s.* into stage_row from public.tenant_pipeline_stages s join public.tenant_pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id and p.tenant_id = p_tenant_id for update;
  if stage_row.id is null then raise exception 'stage_not_found'; end if;
  select count(*) into active_count from public.tenant_pipeline_stages where pipeline_id = stage_row.pipeline_id and not is_archived;
  if not stage_row.is_archived and active_count <= 1 then raise exception 'pipeline_requires_stage'; end if;
  update public.tenant_pipeline_stages set is_archived = true, updated_at = now() where id = p_stage_id returning * into stage_row;
  with ranked as (
    select id, row_number() over (order by position, created_at) - 1 as new_position
    from public.tenant_pipeline_stages where pipeline_id = stage_row.pipeline_id and not is_archived
  )
  update public.tenant_pipeline_stages s set position = ranked.new_position, updated_at = now()
  from ranked where ranked.id = s.id;
  return stage_row;
end;
$$;

create or replace function public.delete_tenant_pipeline(
  p_tenant_id uuid,
  p_pipeline_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_default boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_pipeline_id::text, 0));

  select p.is_default into v_is_default
  from public.tenant_pipelines p
  where p.id = p_pipeline_id and p.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'pipeline_not_found';
  end if;
  if v_is_default then
    raise exception 'default_pipeline';
  end if;

  -- The disposition_walks clause from the original is omitted: that table does not exist yet. See
  -- the header, and restore it with LA-1.12.
  if exists (
    select 1 from public.agent_leads l
    where l.tenant_id = p_tenant_id and l.pipeline_id = p_pipeline_id
  ) or exists (
    select 1 from public.lead_queue q
    where q.tenant_id = p_tenant_id and q.pipeline_id = p_pipeline_id
  ) or exists (
    select 1 from public.deal_flow d
    where d.tenant_id = p_tenant_id and d.pipeline_id = p_pipeline_id
  ) then
    raise exception 'pipeline_in_use';
  end if;

  delete from public.stage_dispositions d
  using public.tenant_pipeline_stages s
  where d.tenant_id = p_tenant_id
    and d.stage_id = s.id
    and s.pipeline_id = p_pipeline_id;

  delete from public.tenant_pipelines p
  where p.id = p_pipeline_id and p.tenant_id = p_tenant_id;
end;
$$;

-- The advisory lock serialises remapping within one tenant, so two admins mapping the same
-- disposition cannot both pass the uniqueness check and race the insert.
create or replace function public.set_stage_disposition(
  p_tenant_id uuid,
  p_stage_id uuid,
  p_disposition_key text
)
returns public.stage_dispositions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.stage_dispositions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  if not exists (
    select 1 from public.tenant_pipeline_stages s join public.tenant_pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id and p.tenant_id = p_tenant_id and not s.is_archived
  ) then raise exception 'stage_not_found'; end if;
  delete from public.stage_dispositions where tenant_id = p_tenant_id and (stage_id = p_stage_id or disposition_key = p_disposition_key);
  insert into public.stage_dispositions (tenant_id, stage_id, disposition_key)
  values (p_tenant_id, p_stage_id, p_disposition_key)
  returning * into result;
  return result;
end;
$$;

-- LA-1.9's third trap: stage is stored once, as an id. This writes the id onto all three records
-- that carry one and derives nothing from a name.
create or replace function public.move_lead_to_disposition(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition_key text
)
returns table (lead_id uuid, pipeline_id uuid, stage_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  destination record;
begin
  select s.pipeline_id, s.id as stage_id into destination
  from public.stage_dispositions d
  join public.tenant_pipeline_stages s on s.id = d.stage_id
  join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = d.tenant_id
  where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and not s.is_archived;
  if not found then raise exception 'disposition_not_mapped'; end if;
  update public.agent_leads l set pipeline_id = destination.pipeline_id, stage_id = destination.stage_id
    where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then raise exception 'lead_not_found'; end if;
  update public.lead_queue set pipeline_id = destination.pipeline_id, stage_id = destination.stage_id where lead_queue.lead_id = p_lead_id and lead_queue.tenant_id = p_tenant_id;
  update public.deal_flow set pipeline_id = destination.pipeline_id, stage_id = destination.stage_id where deal_flow.lead_id = p_lead_id and deal_flow.tenant_id = p_tenant_id;
  return query select p_lead_id, destination.pipeline_id, destination.stage_id;
end;
$$;

-- LA-1.9's fourth trap: pipeline configuration was readable and deletable by any authenticated user,
-- including every external partner account. These are service-role only; the routes gate on an owner
-- session above them.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reorder_pipeline_stages', 'archive_pipeline_stage', 'delete_tenant_pipeline',
                         'set_stage_disposition', 'move_lead_to_disposition')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, tenant_app', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end;
$$;

-- Assert the five exist and none is client-reachable, rather than trusting the loop above.
do $$
declare
  present integer;
  reachable integer;
begin
  select count(distinct p.proname) into present
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('reorder_pipeline_stages', 'archive_pipeline_stage', 'delete_tenant_pipeline',
                       'set_stage_disposition', 'move_lead_to_disposition');
  if present <> 5 then
    raise exception 'expected 5 pipeline functions, found %', present;
  end if;

  select count(*) into reachable
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('reorder_pipeline_stages', 'archive_pipeline_stage', 'delete_tenant_pipeline',
                       'set_stage_disposition', 'move_lead_to_disposition')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if reachable > 0 then
    raise exception '% pipeline function(s) remain client-executable', reachable;
  end if;
end;
$$;
