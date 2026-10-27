-- Settings › Pipelines & outcomes (owner, 2026-10-27): one all-in-one pipeline every agent uses by default.
--
-- A new agency used to start with three partner pipelines (Publisher transfers, Marketing leads, Affiliate
-- referrals) and 22 stages before it had a single partner, which is hard to read on day one. Now:
--
-- 1. seed_general_pipeline(tenant) builds "Sales pipeline": the agency's default pipeline with no partner
--    type, ten stages from new lead to sold or closed, and where each of the 14 standard outcomes sends a
--    lead in it (pipeline_disposition_stages, so the dialer moves leads from the first call). An agency
--    that already has a default pipeline with no partner type keeps it untouched.
-- 2. seed_default_pipelines (the new-agency trigger) seeds only that pipeline. Partner pipelines are
--    added when the agency wants them; until then a partner's leads enter the Sales pipeline too
--    (resolvePartnerEntryStage / resolveRuntimeStage in lib/pipelines/service.ts fall back to it).
-- 3. Every existing agency gets the Sales pipeline as well. Their partner pipelines, stages, outcome
--    choices and leads are not touched; leads with no partner created from now on enter the Sales
--    pipeline instead of Marketing leads.
--
-- Rollback: restore seed_default_pipelines from 20261022200000 (section 3), then
--   drop function public.seed_general_pipeline(uuid);
-- and delete the Sales pipelines that hold no lead, if wanted.

-- ─── 1. the all-in-one pipeline ────────────────────────────────────────────────────────────────────
create or replace function public.seed_general_pipeline(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
begin
  -- The agency already has an all-in-one default: that is its choice.
  select id into v_pipeline from public.tenant_pipelines
   where tenant_id = p_tenant_id and partner_type is null and is_default;
  if v_pipeline is not null then return v_pipeline; end if;

  select id into v_pipeline from public.tenant_pipelines
   where tenant_id = p_tenant_id and partner_type is null and name = 'Sales pipeline';
  if v_pipeline is null then
    insert into public.tenant_pipelines (tenant_id, name, partner_type, is_default, status)
    values (p_tenant_id, 'Sales pipeline', null, true, 'live')
    returning id into v_pipeline;
  else
    update public.tenant_pipelines set is_default = true, status = 'live', updated_at = now() where id = v_pipeline;
  end if;

  -- Colours are the board's palette (lib/pipelines/outcomesBoard.ts STAGE_SWATCHES).
  insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
    (v_pipeline, 'New lead',             0, 'open', '#4457c7'),
    (v_pipeline, 'Trying to reach',      1, 'open', '#59606b'),
    (v_pipeline, 'Callback scheduled',   2, 'open', '#b35c00'),
    (v_pipeline, 'Qualified',            3, 'open', '#b02a9b'),
    (v_pipeline, 'Sent to underwriting', 4, 'open', '#0091a8'),
    (v_pipeline, 'Submitted',            5, 'won',  '#0a8769'),
    (v_pipeline, 'Not interested',       6, 'lost', '#c62828'),
    (v_pipeline, 'Did not qualify',      7, 'lost', '#e04e00'),
    (v_pipeline, 'Bad number',           8, 'lost', '#59606b'),
    (v_pipeline, 'Do not call',          9, 'lost', '#c62828')
  on conflict (pipeline_id, name) do nothing;

  -- Where each standard outcome takes a lead in this pipeline. Seeded once: a pipeline that already has
  -- outcome rows keeps them.
  if not exists (select 1 from public.pipeline_disposition_stages o where o.tenant_id = p_tenant_id and o.pipeline_id = v_pipeline) then
    with defaults (disposition_key, stage_name) as (
      values
        ('no_answer',             'Trying to reach'),
        ('voicemail',             'Trying to reach'),
        ('busy',                  'Trying to reach'),
        ('call_dropped',          'Trying to reach'),
        ('callback_scheduled',    'Callback scheduled'),
        ('inbound_return_call',   'Callback scheduled'),
        ('no_payment_method',     'Qualified'),
        ('sent_to_underwriting',  'Sent to underwriting'),
        ('application_submitted', 'Submitted'),
        ('not_interested',        'Not interested'),
        ('did_not_qualify',       'Did not qualify'),
        ('wrong_number',          'Bad number'),
        ('disconnected',          'Bad number'),
        ('do_not_call',           'Do not call')
    )
    insert into public.pipeline_disposition_stages (tenant_id, pipeline_id, stage_id, disposition_key)
    select p_tenant_id, v_pipeline, s.id, d.disposition_key
      from defaults d
      join public.tenant_pipeline_stages s on s.pipeline_id = v_pipeline and s.name = d.stage_name and not s.is_archived
    on conflict (tenant_id, pipeline_id, disposition_key) do nothing;
  end if;

  return v_pipeline;
end;
$$;

revoke all on function public.seed_general_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.seed_general_pipeline(uuid) to service_role;

-- ─── 2. a new agency starts with the all-in-one pipeline only ──────────────────────────────────────
create or replace function public.seed_default_pipelines(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- [20261027300000] One all-in-one pipeline; partner pipelines are added from Settings when wanted.
  perform public.seed_general_pipeline(p_tenant_id);
  -- [20261022200000] Marketing and affiliate pipelines start with their own outcome stages (none yet
  -- for a new agency; kept so a re-run on an agency that has them still seeds them).
  perform public.seed_partner_pipeline_outcomes(p_tenant_id);
end;
$$;

revoke all on function public.seed_default_pipelines(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_pipelines(uuid) to service_role;

-- ─── 3. every existing agency gets it too ──────────────────────────────────────────────────────────
-- Ellery & Fields (the demo agency, owner 2026-10-27): its default with no partner type is a leftover
-- "Test" pipeline (3 stages, no leads, no outcome rows). It stops being the default, so the backfill
-- below gives the agency the Sales pipeline; "Test" itself is kept and can be deleted from Settings.
update public.tenant_pipelines
   set is_default = false, updated_at = now()
 where id = '724eadd8-78b9-417d-9272-9fbc3aef3ba2'
   and tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b'
   and partner_type is null and name = 'Test' and is_default;

do $$
declare
  v_tenant record;
begin
  for v_tenant in select id from public.tenants loop
    perform public.seed_general_pipeline(v_tenant.id);
  end loop;
end;
$$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.tenants t
   where not exists (select 1 from public.tenant_pipelines p where p.tenant_id = t.id and p.partner_type is null and p.is_default);
  if v_missing > 0 then
    raise exception '20261027300000: % agencies have no all-in-one default pipeline', v_missing;
  end if;
  if position('seed_general_pipeline(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0
     or position('seed_partner_pipeline_outcomes(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0 then
    raise exception '20261027300000: seed_default_pipelines does not seed the all-in-one pipeline';
  end if;
  if not exists (select 1 from public.tenant_pipelines p where p.tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b'
                  and p.partner_type is null and p.is_default and p.name = 'Sales pipeline') then
    raise exception '20261027300000: Ellery & Fields does not have the Sales pipeline as its default';
  end if;
  select count(*) into v_missing from public.tenant_pipelines p
   where p.partner_type is null and p.is_default and p.name = 'Sales pipeline'
     and (select count(*) from public.pipeline_disposition_stages o where o.pipeline_id = p.id) < 14;
  if v_missing > 0 then
    raise exception '20261027300000: % Sales pipelines are missing outcome rows', v_missing;
  end if;
end;
$$;
