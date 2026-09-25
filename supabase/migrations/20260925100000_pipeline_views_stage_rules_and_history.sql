-- Pipeline views (the /app/leads Stages · Board · Table · List screens, the stage editor and the
-- new-pipeline wizard). Additive only: new columns with defaults, one new table, one new function.
-- Nothing is dropped or renamed, and the screens work before this is applied — they switch these
-- features on when the columns and the function exist.
--
--   1. A stage can say how long a lead may sit in it (time_allowed_minutes) and whether reaching it
--      counts as the lead being worked (counts_as_worked). Past the time a lead turns red everywhere;
--      it never moves on its own.
--   2. A pipeline can be a draft (status = 'draft'): built but not live. A draft is never a default,
--      so no lead is routed into it, and agents are not offered it.
--   3. Every stage change is written down (tenant_lead_stage_events): from where, to where, which
--      disposition moved it, from which screen, and who. Until now only the audit log held the new
--      stage — never the old one.
--   4. apply_lead_disposition_move: the one path a board drop, a table bulk change or a list quick
--      action takes. It resolves the disposition's stage (one stage per outcome, agency-wide — the
--      existing stage_dispositions rule), moves the lead on all three rows it is stored on, stamps
--      the outcome on the work item and records the event, in one transaction.

-- ── 1. stage rules ────────────────────────────────────────────────────────────────────────────
alter table public.tenant_pipeline_stages
  add column if not exists time_allowed_minutes integer;

-- The first stage of a pipeline is where a lead arrives untouched, so it is not "worked" by default.
-- Set only in the run that adds the column; a re-run never overwrites what an owner chose since.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_pipeline_stages' and column_name = 'counts_as_worked'
  ) then
    alter table public.tenant_pipeline_stages add column counts_as_worked boolean not null default true;
    update public.tenant_pipeline_stages set counts_as_worked = false where position = 0;
  end if;
end;
$$;

alter table public.tenant_pipeline_stages drop constraint if exists tenant_pipeline_stages_time_allowed_range;
alter table public.tenant_pipeline_stages add constraint tenant_pipeline_stages_time_allowed_range
  check (time_allowed_minutes is null or (time_allowed_minutes between 1 and 525600));

-- When a lead entered the stage it is in — what "in stage 2d 04h" and "past the time allowed" are
-- measured from. Kept by a trigger on every stage change, so the dialer, the outcome wizard, the
-- board and an owner's correction all keep it right without each remembering to.
alter table public.agent_leads add column if not exists stage_entered_at timestamptz;
-- Deliberately NOT backfilled. Leads already in a stage have no honest entry time: updated_at moves
-- on any edit, and rewriting ~215k rows would fire agent_leads_touch_updated_at (erasing "last
-- touched" across the book) or need a table lock to avoid it. A null reads as "since arrival" in the
-- app and is never counted past its time allowed; the trigger below stamps every lead on its next
-- stage change, and setting a default rewrites nothing that exists.
alter table public.agent_leads alter column stage_entered_at set default now();

create or replace function public.agent_leads_stamp_stage_entered()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists agent_leads_stamp_stage_entered on public.agent_leads;
create trigger agent_leads_stamp_stage_entered
  before insert or update of stage_id on public.agent_leads
  for each row execute function public.agent_leads_stamp_stage_entered();

create index if not exists agent_leads_tenant_stage_entered_idx
  on public.agent_leads (tenant_id, stage_id, stage_entered_at);

-- ── 2. draft pipelines ────────────────────────────────────────────────────────────────────────
alter table public.tenant_pipelines
  add column if not exists status text not null default 'live';

alter table public.tenant_pipelines drop constraint if exists tenant_pipelines_status_check;
alter table public.tenant_pipelines add constraint tenant_pipelines_status_check
  check (status in ('draft', 'live'));

-- A draft can never be where new leads land.
alter table public.tenant_pipelines drop constraint if exists tenant_pipelines_draft_not_default;
alter table public.tenant_pipelines add constraint tenant_pipelines_draft_not_default
  check (status = 'live' or not is_default);

-- ── 3. stage history ──────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  from_pipeline_id uuid,
  from_stage_id uuid,
  to_pipeline_id uuid not null,
  to_stage_id uuid not null,
  -- Null only for an owner correcting data with the direct stage edit.
  disposition_key text,
  source text not null check (source in ('board', 'table', 'list', 'lead_detail', 'owner_fix')),
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tenant_lead_stage_events_lead_idx
  on public.tenant_lead_stage_events (tenant_id, lead_id, created_at desc);
create index if not exists tenant_lead_stage_events_stage_idx
  on public.tenant_lead_stage_events (tenant_id, to_stage_id, created_at desc);

alter table public.tenant_lead_stage_events enable row level security;
drop policy if exists tenant_lead_stage_events_tenant_scoped on public.tenant_lead_stage_events;
create policy tenant_lead_stage_events_tenant_scoped on public.tenant_lead_stage_events
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_lead_stage_events from anon, authenticated, public;
grant select on public.tenant_lead_stage_events to tenant_app;
-- Append-only: the history is only ever added to.
grant select, insert on public.tenant_lead_stage_events to service_role;

-- ── 4. the move ───────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_lead_disposition_move(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition_key text,
  p_actor uuid,
  p_source text
)
returns table (lead_id uuid, from_stage_id uuid, to_pipeline_id uuid, to_stage_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destination record;
  v_lead record;
begin
  if p_source not in ('board', 'table', 'list', 'lead_detail') then
    raise exception 'invalid_move_source';
  end if;

  -- The outcome must exist and still be pickable.
  if not exists (
    select 1 from public.dispositions d
     where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and d.is_active
  ) then
    raise exception 'disposition_not_active';
  end if;

  -- Its one stage, which must be live and in a live pipeline.
  select s.pipeline_id, s.id as stage_id into v_destination
    from public.stage_dispositions m
    join public.tenant_pipeline_stages s on s.id = m.stage_id
    join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = m.tenant_id
   where m.tenant_id = p_tenant_id
     and m.disposition_key = p_disposition_key
     and not s.is_archived
     and p.status = 'live';
  if not found then raise exception 'disposition_not_mapped'; end if;

  select l.pipeline_id, l.stage_id into v_lead
    from public.agent_leads l
   where l.id = p_lead_id and l.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'lead_not_found'; end if;

  update public.agent_leads
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id, updated_at = now()
   where id = p_lead_id and tenant_id = p_tenant_id;
  update public.lead_queue
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id,
         disposition = p_disposition_key, disposition_at = now(), disposition_by = p_actor, updated_at = now()
   where lead_queue.lead_id = p_lead_id and lead_queue.tenant_id = p_tenant_id;
  update public.deal_flow
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id, updated_at = now()
   where deal_flow.lead_id = p_lead_id and deal_flow.tenant_id = p_tenant_id;

  insert into public.tenant_lead_stage_events
    (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)
  values
    (p_tenant_id, p_lead_id, v_lead.pipeline_id, v_lead.stage_id, v_destination.pipeline_id, v_destination.stage_id, p_disposition_key, p_source, p_actor);

  return query select p_lead_id, v_lead.stage_id, v_destination.pipeline_id, v_destination.stage_id;
end;
$$;

revoke all on function public.apply_lead_disposition_move(uuid, uuid, text, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.apply_lead_disposition_move(uuid, uuid, text, uuid, text) to service_role;
