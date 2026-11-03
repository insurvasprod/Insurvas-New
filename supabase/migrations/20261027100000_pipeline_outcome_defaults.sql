-- Settings › Pipelines & outcomes (owner, 2026-10-27): works out of the box, and a pipeline may keep a
-- lead where it is.
--
-- 1. A pipeline's own row may now name no stage: "in this pipeline, this outcome keeps the lead where it
--    is" (pipeline_disposition_stages.stage_id null). Before, a pipeline could only point an outcome at
--    one of its stages, and an outcome with an agency-wide stage always moved the lead.
-- 2. The same-name default. An outcome with no choice of its own in the lead's pipeline goes to the
--    stage in that pipeline with its own name ("Needs callback" → Needs callback), so nothing has to be
--    mapped before the dialer moves leads sensibly. An agency-wide stage that is already in the lead's
--    pipeline still wins over the name, so a choice an agency made is never overridden.
--
-- resolve_disposition_stage, in order:
--   1. the lead's pipeline's own row: its stage, or (stage_id null) nothing: the lead stays;
--   2. the agency-wide stage, when it is in the lead's pipeline;
--   3. a live stage in the lead's pipeline whose name is the outcome's label;
--   4. the agency-wide stage anywhere (as before);
--   5. nothing: the lead stays where it is.
-- Same signature; the four movers that call it (complete_disposition, complete_existing_dial_disposition,
-- apply_lead_disposition_move, move_lead_to_disposition) need no change. lib/pipelines/outcomeResolution.ts
-- is its TypeScript twin and follows the same order.
--
-- Rollback: re-run section 2 of 20261022200000 (the SQL resolver) and its trigger function, delete the
-- rows with a null stage_id, then set stage_id not null again.

-- ─── 1. a row may keep the lead where it is ────────────────────────────────────────────────────────
alter table public.pipeline_disposition_stages alter column stage_id drop not null;

create or replace function public.pipeline_disposition_stages_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage_id is null then
    -- "Stays where it is": the pipeline must still be the tenant's.
    if not exists (select 1 from public.tenant_pipelines p where p.id = new.pipeline_id and p.tenant_id = new.tenant_id) then
      raise exception 'stage_not_in_pipeline' using errcode = '23514';
    end if;
  elsif not exists (
    select 1
      from public.tenant_pipeline_stages s
      join public.tenant_pipelines p on p.id = s.pipeline_id
     where s.id = new.stage_id and s.pipeline_id = new.pipeline_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'stage_not_in_pipeline' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.pipeline_disposition_stages_check() from public, anon, authenticated;

-- ─── 2. the lookup ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.resolve_disposition_stage(p_tenant_id uuid, p_pipeline_id uuid, p_disposition_key text, p_live_only boolean default false)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_found boolean;
  v_stage uuid;
begin
  if p_pipeline_id is not null then
    -- 1. The pipeline's own choice. A row whose stage was archived falls through, as before.
    select true, o.stage_id
      into v_found, v_stage
      from public.pipeline_disposition_stages o
      join public.tenant_pipelines p on p.id = o.pipeline_id and p.tenant_id = o.tenant_id
      left join public.tenant_pipeline_stages s on s.id = o.stage_id and s.pipeline_id = o.pipeline_id
     where o.tenant_id = p_tenant_id
       and o.pipeline_id = p_pipeline_id
       and o.disposition_key = p_disposition_key
       and (o.stage_id is null or (s.id is not null and not s.is_archived and (not p_live_only or p.status = 'live')));
    if v_found then
      return v_stage;
    end if;

    -- 2. The agency-wide stage, when it is in this pipeline.
    select sd.stage_id
      into v_stage
      from public.stage_dispositions sd
      join public.tenant_pipeline_stages s on s.id = sd.stage_id
      join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = sd.tenant_id
     where sd.tenant_id = p_tenant_id
       and sd.disposition_key = p_disposition_key
       and s.pipeline_id = p_pipeline_id
       and not s.is_archived
       and (not p_live_only or p.status = 'live')
     limit 1;
    if v_stage is not null then
      return v_stage;
    end if;

    -- 3. The same-name default: a stage in this pipeline named like the outcome.
    select s.id
      into v_stage
      from public.tenant_pipeline_stages s
      join public.tenant_pipelines p on p.id = s.pipeline_id
      join public.dispositions d on d.tenant_id = p.tenant_id and d.disposition_key = p_disposition_key
     where p.id = p_pipeline_id
       and p.tenant_id = p_tenant_id
       and not s.is_archived
       and (not p_live_only or p.status = 'live')
       and lower(btrim(s.name)) = lower(btrim(d.label))
     order by s.position
     limit 1;
    if v_stage is not null then
      return v_stage;
    end if;
  end if;

  -- 4. The agency-wide stage anywhere.
  select sd.stage_id
    into v_stage
    from public.stage_dispositions sd
    join public.tenant_pipeline_stages s on s.id = sd.stage_id
    join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = sd.tenant_id
   where sd.tenant_id = p_tenant_id
     and sd.disposition_key = p_disposition_key
     and not s.is_archived
     and (not p_live_only or p.status = 'live')
   limit 1;
  return v_stage;
end;
$$;
revoke all on function public.resolve_disposition_stage(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.resolve_disposition_stage(uuid, uuid, text, boolean) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select a.attnotnull from pg_attribute a where a.attrelid = 'public.pipeline_disposition_stages'::regclass and a.attname = 'stage_id') then
    raise exception 'pipeline_disposition_stages.stage_id is still NOT NULL';
  end if;
  if pg_get_functiondef('public.resolve_disposition_stage(uuid,uuid,text,boolean)'::regprocedure) !~ 'lower\(btrim\(s\.name\)\) = lower\(btrim\(d\.label\)\)' then
    raise exception 'resolve_disposition_stage has no same-name default';
  end if;
  if pg_get_functiondef('public.pipeline_disposition_stages_check()'::regprocedure) !~ 'new\.stage_id is null' then
    raise exception 'pipeline_disposition_stages_check does not allow a stays row';
  end if;
end;
$$;
