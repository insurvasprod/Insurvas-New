-- Marketing and affiliate leads stay in their own pipeline when an outcome is recorded (owner, 2026-10-22).
--
-- Notion Module 1 §12 / LA-1.9: one intake for publishers, marketing companies and affiliates, but each type has its own
-- pipeline. Until now an outcome mapped to ONE stage per agency (stage_dispositions, unique per tenant and key), and only
-- the publisher pipeline was seeded with outcomes. Since 20260922220000 that one stage is looked up in ANY pipeline, so
-- "Application submitted" on a marketing or affiliate lead moved it out of its pipeline into Publisher transfers ›
-- Submitted. Walked live 2026-10-22 in LA-1.25 Alert Demo: 8 outcomes mapped on Publisher transfers, 0 on Marketing
-- leads, 0 on Affiliate referrals.
--
-- What changes:
--   1. pipeline_disposition_stages: an outcome's stage INSIDE one pipeline, at most one per (tenant, pipeline, outcome).
--      Several outcomes may share a stage (Not interested, Do not call and Did not qualify all end on "Disqualified").
--   2. resolve_disposition_stage(tenant, pipeline, outcome): the lead's own pipeline's stage first, then the agency-wide
--      stage_dispositions row exactly as before, else null (the lead stays where it is, as before).
--   3. The four functions that move a lead on an outcome read it, through one in-place edit each:
--        complete_disposition                the inbound outcome wizard
--        complete_existing_dial_disposition  the dialer (live path)
--        apply_lead_disposition_move         board / table / list / lead page
--        move_lead_to_disposition            the older board path, still the fallback
--   4. Every agency's default Marketing leads and Affiliate referrals pipelines get default outcome stages, and
--      seed_default_pipelines seeds them for every new agency. An outcome whose agency-wide stage is already inside that
--      pipeline is left to it (the agency chose it); everything else would have left the pipeline, so it gets a stage in it.
--
-- What deliberately does not change: the agency-wide mapping and every screen that edits it; a lead in a pipeline with no
-- row of its own for an outcome (publisher, product, custom pipelines) behaves exactly as before; unmapped still means
-- the lead stays where it is. Deleting a pipeline's row hands the outcome back to the agency-wide rule.
--
-- In-place edits follow 20261015540000: pg_get_functiondef, CRLF normalised, one anchor counted and replaced once, a
-- re-run is a no-op, and a self-check at the end.
--
-- Rollback: re-run the previous definitions of the five patched functions (pg_get_functiondef before this file), then
--   drop function public.seed_partner_pipeline_outcomes(uuid), public.resolve_disposition_stage(uuid, uuid, text, boolean);
--   drop table public.pipeline_disposition_stages; drop function public.pipeline_disposition_stages_check();

-- ─── 1. the table ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pipeline_disposition_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pipeline_id uuid not null references public.tenant_pipelines(id) on delete cascade,
  stage_id uuid not null references public.tenant_pipeline_stages(id) on delete cascade,
  disposition_key text not null check (disposition_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_disposition_stages_one_per_pipeline unique (tenant_id, pipeline_id, disposition_key)
);
-- The two foreign keys a pipeline or stage delete cascades through.
create index if not exists pipeline_disposition_stages_pipeline_idx on public.pipeline_disposition_stages (pipeline_id);
create index if not exists pipeline_disposition_stages_stage_idx on public.pipeline_disposition_stages (stage_id);

-- The stage must be in that pipeline, and the pipeline the tenant's.
create or replace function public.pipeline_disposition_stages_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
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
drop trigger if exists pipeline_disposition_stages_check on public.pipeline_disposition_stages;
create trigger pipeline_disposition_stages_check
  before insert or update on public.pipeline_disposition_stages
  for each row execute function public.pipeline_disposition_stages_check();

-- Same access as stage_dispositions: tenant-scoped reads for tenant_app, writes through the service client only.
alter table public.pipeline_disposition_stages enable row level security;
drop policy if exists pipeline_disposition_stages_tenant_scoped on public.pipeline_disposition_stages;
create policy pipeline_disposition_stages_tenant_scoped on public.pipeline_disposition_stages
  for all
  using (tenant_id = (nullif((select current_setting('app.tenant_id', true)), ''))::uuid)
  with check (tenant_id = (nullif((select current_setting('app.tenant_id', true)), ''))::uuid);
revoke all on public.pipeline_disposition_stages from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on public.pipeline_disposition_stages from tenant_app';
    execute 'grant select on public.pipeline_disposition_stages to tenant_app';
  end if;
end
$$;

-- ─── 2. the lookup ──────────────────────────────────────────────────────────────────────────────────
-- p_live_only: the board path also refuses a stage in a draft pipeline (apply_lead_disposition_move did).
create or replace function public.resolve_disposition_stage(p_tenant_id uuid, p_pipeline_id uuid, p_disposition_key text, p_live_only boolean default false)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select o.stage_id
       from public.pipeline_disposition_stages o
       join public.tenant_pipeline_stages s on s.id = o.stage_id and s.pipeline_id = o.pipeline_id
       join public.tenant_pipelines p on p.id = o.pipeline_id and p.tenant_id = o.tenant_id
      where o.tenant_id = p_tenant_id
        and o.pipeline_id = p_pipeline_id
        and o.disposition_key = p_disposition_key
        and not s.is_archived
        and (not p_live_only or p.status = 'live')),
    (select sd.stage_id
       from public.stage_dispositions sd
       join public.tenant_pipeline_stages s on s.id = sd.stage_id
       join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = sd.tenant_id
      where sd.tenant_id = p_tenant_id
        and sd.disposition_key = p_disposition_key
        and not s.is_archived
        and (not p_live_only or p.status = 'live')
      limit 1)
  );
$$;
revoke all on function public.resolve_disposition_stage(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.resolve_disposition_stage(uuid, uuid, text, boolean) to service_role;

-- ─── 3. the defaults ────────────────────────────────────────────────────────────────────────────────
-- Stage names are the ones seed_default_pipelines creates; a pipeline whose stage was renamed or archived simply gets
-- no row for that outcome. A pipeline that already has rows of its own is never seeded again, so an agency's edits and
-- deletions stand.
create or replace function public.seed_partner_pipeline_outcomes(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with defaults (partner_type, disposition_key, stage_name) as (
    values
      ('marketing', 'application_submitted', 'Converted'),
      ('marketing', 'sent_to_underwriting',  'Converted'),
      ('marketing', 'no_payment_method',     'Qualified - Needs Conversion'),
      ('marketing', 'callback_scheduled',    'Pickup - Needs Callback'),
      ('marketing', 'inbound_return_call',   'Call Lead'),
      ('marketing', 'call_dropped',          'No Pickup - Needs Connection'),
      ('marketing', 'no_answer',             'No Pickup - Needs Connection'),
      ('marketing', 'voicemail',             'No Pickup - Needs Connection'),
      ('marketing', 'busy',                  'No Pickup - Needs Connection'),
      ('marketing', 'did_not_qualify',       'Disqualified - Do Not Call'),
      ('marketing', 'not_interested',        'Disqualified - Do Not Call'),
      ('marketing', 'do_not_call',           'Disqualified - Do Not Call'),
      ('marketing', 'wrong_number',          'Disqualified - Do Not Call'),
      ('marketing', 'disconnected',          'Disqualified - Do Not Call'),
      ('affiliate', 'application_submitted', 'Submitted'),
      ('affiliate', 'sent_to_underwriting',  'Submitted'),
      ('affiliate', 'no_payment_method',     'Qualified'),
      ('affiliate', 'callback_scheduled',    'Contacted'),
      ('affiliate', 'inbound_return_call',   'Contacted'),
      ('affiliate', 'call_dropped',          'Contacted'),
      ('affiliate', 'no_answer',             'Contacted'),
      ('affiliate', 'voicemail',             'Contacted'),
      ('affiliate', 'busy',                  'Contacted'),
      ('affiliate', 'did_not_qualify',       'Not Interested'),
      ('affiliate', 'not_interested',        'Not Interested'),
      ('affiliate', 'do_not_call',           'Not Interested'),
      ('affiliate', 'wrong_number',          'Not Interested'),
      ('affiliate', 'disconnected',          'Not Interested')
  )
  insert into public.pipeline_disposition_stages (tenant_id, pipeline_id, stage_id, disposition_key)
  select p_tenant_id, p.id, s.id, d.disposition_key
    from public.tenant_pipelines p
    join defaults d on d.partner_type = p.partner_type::text
    join public.tenant_pipeline_stages s on s.pipeline_id = p.id and s.name = d.stage_name and not s.is_archived
   where p.tenant_id = p_tenant_id
     and p.is_default
     and p.partner_type::text in ('marketing', 'affiliate')
     and not exists (select 1 from public.pipeline_disposition_stages o where o.tenant_id = p_tenant_id and o.pipeline_id = p.id)
     -- The agency already sends this outcome to a stage of this pipeline: that is its choice, and it already applies.
     and not exists (
       select 1
         from public.stage_dispositions sd
         join public.tenant_pipeline_stages ms on ms.id = sd.stage_id
        where sd.tenant_id = p_tenant_id and sd.disposition_key = d.disposition_key and ms.pipeline_id = p.id
     )
  on conflict (tenant_id, pipeline_id, disposition_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.seed_partner_pipeline_outcomes(uuid) from public, anon, authenticated;
grant execute on function public.seed_partner_pipeline_outcomes(uuid) to service_role;

-- ─── 4. the in-place edits ──────────────────────────────────────────────────────────────────────────
do $$
declare
  v_sigs text[] := array[
    'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)',
    'public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)',
    'public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)',
    'public.move_lead_to_disposition(uuid,uuid,text)',
    'public.seed_default_pipelines(uuid)'
  ];
  v_anchors text[] := array[
$a1$  select sd.stage_id into v_stage_id
    from public.stage_dispositions sd
    join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
   where sd.tenant_id = p_tenant_id
     and sd.disposition_key = p_disposition_key
     -- Any pipeline: the dedicated pipeline reserved for this disposition is the point.
     and not ps.is_archived
   limit 1;$a1$,
$a2$    select ps.id, ps.pipeline_id into v_stage_id, v_stage_pipeline
      from public.stage_dispositions sd
      join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
     where sd.tenant_id = p_tenant_id
       and sd.disposition_key = p_disposition
       and not ps.is_archived
     limit 1;$a2$,
$a3$  select s.pipeline_id, s.id as stage_id into v_destination
    from public.stage_dispositions m
    join public.tenant_pipeline_stages s on s.id = m.stage_id
    join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = m.tenant_id
   where m.tenant_id = p_tenant_id
     and m.disposition_key = p_disposition_key
     and not s.is_archived
     and p.status = 'live';$a3$,
$a4$  select s.pipeline_id, s.id as stage_id into destination
  from public.stage_dispositions d
  join public.tenant_pipeline_stages s on s.id = d.stage_id
  join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = d.tenant_id
  where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and not s.is_archived;$a4$,
$a5$    end if;
  end loop;
end;$a5$
  ];
  v_news text[] := array[
$n1$  -- [20261022200000] The lead's own pipeline's stage for this outcome first, then the agency-wide one (any pipeline).
  v_stage_id := public.resolve_disposition_stage(
    p_tenant_id,
    (select l.pipeline_id from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id),
    p_disposition_key,
    false);$n1$,
$n2$    -- [20261022200000] The lead's own pipeline's stage for this outcome first, then the agency-wide one (any pipeline).
    v_stage_id := public.resolve_disposition_stage(p_tenant_id, v_lead.pipeline_id, p_disposition, false);
    select ps.pipeline_id into v_stage_pipeline from public.tenant_pipeline_stages ps where ps.id = v_stage_id;$n2$,
$n3$  -- [20261022200000] The lead's own pipeline's stage for this outcome first, then the agency-wide one.
  select s.pipeline_id, s.id as stage_id into v_destination
    from public.tenant_pipeline_stages s
   where s.id = public.resolve_disposition_stage(
           p_tenant_id,
           (select l.pipeline_id from public.agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id),
           p_disposition_key,
           true);$n3$,
$n4$  -- [20261022200000] The lead's own pipeline's stage for this outcome first, then the agency-wide one.
  select s.pipeline_id, s.id as stage_id into destination
  from public.tenant_pipeline_stages s
  where s.id = public.resolve_disposition_stage(
          p_tenant_id,
          (select l.pipeline_id from public.agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id),
          p_disposition_key,
          false);$n4$,
$n5$    end if;
  end loop;
  -- [20261022200000] Marketing and affiliate pipelines start with their own outcome stages.
  perform public.seed_partner_pipeline_outcomes(p_tenant_id);
end;$n5$
  ];
  v_sig regprocedure;
  v_body text;
  v_anchor text;
  v_new text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261022200000: skipped, % cannot create in public', current_user;
    return;
  end if;
  for i in 1 .. array_length(v_sigs, 1) loop
    v_sig := to_regprocedure(v_sigs[i]);
    if v_sig is null then
      raise exception '20261022200000: % is not installed', v_sigs[i];
    end if;
    v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
    if position('[20261022200000]' in v_body) > 0 then
      raise notice '20261022200000: % already patched', v_sigs[i];
      continue;
    end if;
    -- The SQL editor stores a paste with CRLF, so the anchors and replacements in THIS file arrive with \r\n while the
    -- live body was just normalised to \n: normalise both sides, or nothing ever matches (found 0, 2026-10-22).
    v_anchor := replace(v_anchors[i], E'\r\n', E'\n');
    v_new := replace(v_news[i], E'\r\n', E'\n');
    v_count := (length(v_body) - length(replace(v_body, v_anchor, ''))) / length(v_anchor);
    if v_count <> 1 then
      raise exception '20261022200000: expected the outcome lookup once in %, found %', v_sigs[i], v_count;
    end if;
    execute replace(v_body, v_anchor, v_new);
  end loop;
end
$$;

-- ─── 5. the defaults for every agency that exists today ─────────────────────────────────────────────
do $$
declare
  v_tenant record;
  v_rows integer := 0;
begin
  for v_tenant in select t.id from public.tenants t loop
    v_rows := v_rows + public.seed_partner_pipeline_outcomes(v_tenant.id);
  end loop;
  raise notice '20261022200000: % marketing / affiliate outcome stages seeded', v_rows;
end
$$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_sigs text[] := array[
    'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)',
    'public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)',
    'public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)',
    'public.move_lead_to_disposition(uuid,uuid,text)'
  ];
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261022200000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  perform 'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
          'public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)'::regprocedure;
  for i in 1 .. array_length(v_sigs, 1) loop
    v_body := replace(pg_get_functiondef(to_regprocedure(v_sigs[i])), E'\r\n', E'\n');
    if position('resolve_disposition_stage(' in v_body) = 0 then
      raise exception '20261022200000: % does not read the pipeline''s own outcome stage', v_sigs[i];
    end if;
    -- Every lookup goes through the resolver: no direct read of the agency-wide table is left.
    if position('stage_dispositions' in v_body) > 0 then
      raise exception '20261022200000: % still reads stage_dispositions directly', v_sigs[i];
    end if;
  end loop;
  if position('seed_partner_pipeline_outcomes(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0 then
    raise exception '20261022200000: seed_default_pipelines does not seed the partner outcome stages';
  end if;
  -- The other halves of the patched functions are unchanged.
  if position('suppress_phone(p_tenant_id, v_lead.phone, ''internal''' in
       pg_get_functiondef('public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception '20261022200000: the board''s do-not-call write changed';
  end if;
  if position('disposition_not_mapped' in pg_get_functiondef('public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)'::regprocedure)) = 0
     or position('disposition_not_mapped' in pg_get_functiondef('public.move_lead_to_disposition(uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception '20261022200000: an unmapped outcome no longer refuses the board move';
  end if;
end
$$;
