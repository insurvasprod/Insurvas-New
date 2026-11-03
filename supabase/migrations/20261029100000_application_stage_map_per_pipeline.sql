-- Pipeline sync per pipeline (owner, 2026-10-29: "yes, all pipelines").
--
-- tenant_application_stage_map held one stage per application state for the whole agency, so only the
-- pipeline that stage sat in followed its applications: a lead on another pipeline (Marketing leads,
-- Affiliate referrals) never moved, or was pulled across into that pipeline. Now each pipeline has its
-- own map, and a lead's card moves only within the pipeline it is on.
--
--   1. pipeline_id: the pipeline the row belongs to. Existing rows take their stage's pipeline.
--   2. One stage per state per pipeline: the key becomes (tenant_id, pipeline_id, sync_key).
--   3. The stage must sit in that pipeline (the same-tenant trigger now checks both).
--   4. An agency that already maps something gets its other pipelines filled where a stage carries the
--      state's own name (Submitted, Issued, Lost, …; case-insensitive), the rule Settings already uses
--      for its first suggestion. Nothing else is guessed: an unmapped state still moves nothing.
--
-- Down: delete the rows step 4 added (updated_by is null and pipeline_id differs from the first row's),
-- drop the new key, restore primary key (tenant_id, sync_key) once one row per state remains, drop
-- pipeline_id, and restore 20260926101000's trigger body.

set local lock_timeout = '5s';

-- ── 1 · the pipeline each row belongs to ─────────────────────────────────────
alter table public.tenant_application_stage_map
  add column if not exists pipeline_id uuid references public.tenant_pipelines(id) on delete cascade;

update public.tenant_application_stage_map m
   set pipeline_id = s.pipeline_id
  from public.tenant_pipeline_stages s
 where s.id = m.stage_id
   and m.pipeline_id is null;

alter table public.tenant_application_stage_map alter column pipeline_id set not null;

-- ── 2 · one stage per state per pipeline ─────────────────────────────────────
alter table public.tenant_application_stage_map drop constraint if exists tenant_application_stage_map_pkey;
alter table public.tenant_application_stage_map
  add constraint tenant_application_stage_map_pkey primary key (tenant_id, pipeline_id, sync_key);

-- ── 3 · the stage is this tenant's, and in this pipeline ─────────────────────
create or replace function public.tenant_application_stage_map_same_tenant()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from public.tenant_pipeline_stages s
                   join public.tenant_pipelines p on p.id = s.pipeline_id
                  where s.id = new.stage_id and p.tenant_id = new.tenant_id) then
    raise exception 'STAGE_MAP_FOREIGN_STAGE: stage % is not in a pipeline of tenant %', new.stage_id, new.tenant_id;
  end if;
  if new.pipeline_id is not null and not exists (select 1 from public.tenant_pipeline_stages s where s.id = new.stage_id and s.pipeline_id = new.pipeline_id) then
    raise exception 'STAGE_MAP_OTHER_PIPELINE: stage % is not in pipeline %', new.stage_id, new.pipeline_id;
  end if;
  return new;
end;
$function$;

-- ── 4 · the other pipelines, by the states' own stage names ──────────────────
insert into public.tenant_application_stage_map (tenant_id, pipeline_id, sync_key, stage_id)
select distinct on (p.tenant_id, p.id, k.sync_key) p.tenant_id, p.id, k.sync_key, s.id
  from (values ('quoted', 'quoted'), ('application_started', 'application started'), ('submitted', 'submitted'),
               ('pending_requirements', 'pending requirements'), ('issued', 'issued'), ('requoting', 'quoted'), ('lost', 'lost')) as k(sync_key, stage_name)
  join public.tenant_pipeline_stages s on lower(btrim(s.name)) = k.stage_name and not s.is_archived
  join public.tenant_pipelines p on p.id = s.pipeline_id
 where exists (select 1 from public.tenant_application_stage_map m where m.tenant_id = p.tenant_id)
   and not exists (select 1 from public.tenant_application_stage_map m where m.tenant_id = p.tenant_id and m.pipeline_id = p.id and m.sync_key = k.sync_key)
 order by p.tenant_id, p.id, k.sync_key, s.position
on conflict do nothing;

-- ── checks ───────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_application_stage_map' and column_name = 'pipeline_id' and is_nullable = 'YES') then
    raise exception '20261029100000: pipeline_id should be required';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_stage_map_pkey' and pg_get_constraintdef(oid) like '%pipeline_id%') then
    raise exception '20261029100000: the key is not per pipeline';
  end if;
  if exists (select 1 from public.tenant_application_stage_map m join public.tenant_pipeline_stages s on s.id = m.stage_id where s.pipeline_id <> m.pipeline_id) then
    raise exception '20261029100000: a row points at a stage in another pipeline';
  end if;
end $$;

notify pgrst, 'reload schema';
