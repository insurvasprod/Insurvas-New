-- Settings defaults · the all-in-one Sales pipeline for NEW agencies (docs/settings/DEFAULTS.md,
-- owner pick 2026-11-03).
--
-- Application stages (LA-3.23) moves a card by stage name when an agency has saved no map of its
-- own (lib/applications/stageSyncService.ts). The Sales pipeline had only "Submitted" of those names,
-- so a new agency's cards never followed their applications. A new agency's Sales pipeline now also
-- carries Quoted, Application started, Pending requirements, Issued and Lost, in board order.
--
-- Stage types: Submitted, Pending requirements and Issued are `won` (a submitted sale stays counted
-- as won while it is underwritten, and the stage-map check does not flag a won stage before Issued
-- when Issued is itself won). Lost is `lost`.
--
-- Existing agencies are NOT touched: the function returns at once for an agency that already has an
-- all-in-one default (all 608 of them as of 2026-11-03), and their stage lists are theirs. The
-- outcome routing is unchanged (TS twin: INSURVAS_OUTCOME_STAGES in lib/pipelines/outcomesBoard.ts).
--
-- Restated from the live body (pg_get_functiondef, read 2026-11-03, identical to 20261027300000); the
-- only change is the stage list. The guard refuses to replace a body that has moved on since.

begin;

do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.seed_general_pipeline(uuid)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%(v_pipeline, ''Submitted'',            5, ''won'',  ''#0a8769''),%'
     or v_def like '%Pending requirements%' then
    raise exception '20261103110000: seed_general_pipeline is not the 20261027300000 body; re-read it before restating';
  end if;
end $$;

create or replace function public.seed_general_pipeline(p_tenant_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  -- [20261103110000] Quoted, Application started, Pending requirements, Issued and Lost carry the
  -- application states' default names (lib/salesSettings/stageMapChecks.ts DEFAULT_STAGE_NAME).
  insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
    (v_pipeline, 'New lead',              0, 'open', '#4457c7'),
    (v_pipeline, 'Trying to reach',       1, 'open', '#59606b'),
    (v_pipeline, 'Callback scheduled',    2, 'open', '#b35c00'),
    (v_pipeline, 'Qualified',             3, 'open', '#b02a9b'),
    (v_pipeline, 'Quoted',                4, 'open', '#4457c7'),
    (v_pipeline, 'Application started',   5, 'open', '#0091a8'),
    (v_pipeline, 'Sent to underwriting',  6, 'open', '#0091a8'),
    (v_pipeline, 'Submitted',             7, 'won',  '#0a8769'),
    (v_pipeline, 'Pending requirements',  8, 'won',  '#b35c00'),
    (v_pipeline, 'Issued',                9, 'won',  '#0a8769'),
    (v_pipeline, 'Not interested',       10, 'lost', '#c62828'),
    (v_pipeline, 'Did not qualify',      11, 'lost', '#e04e00'),
    (v_pipeline, 'Lost',                 12, 'lost', '#c62828'),
    (v_pipeline, 'Bad number',           13, 'lost', '#59606b'),
    (v_pipeline, 'Do not call',          14, 'lost', '#c62828')
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
$function$;

-- ── check ────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('public.seed_general_pipeline(uuid)'::regprocedure);
begin
  if v_def not like '%Pending requirements%' or v_def not like '%''Issued''%' or v_def not like '%''Quoted''%' then
    raise exception '20261103110000: seed_general_pipeline does not carry the application stages';
  end if;
end $$;

commit;
