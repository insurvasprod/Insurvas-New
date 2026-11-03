-- Settings defaults (docs/settings/DEFAULTS.md): paste this whole file into the Supabase SQL editor.
-- Three migrations, each in its own begin/commit, in order. Each one stops itself if the live function changed.

-- ════ 20261103100000_calling_window_insurvas_default ════
-- Settings defaults · calling windows (docs/settings/DEFAULTS.md, owner pick 2026-11-03).
--
-- An agency with no calling-window row of its own now dials inside the Insurvas default instead of
-- the bare federal floor: 9:00 am–8:00 pm in the customer's zone, no Sundays, no federal holidays.
-- Narrowing only, like every layer: the state rules still apply on top, and an agency that saves its
-- own hours or switches keeps them (3 agencies have hours, 2 have switches, as of 2026-11-03).
--
-- IMPACT: the other ~608 agencies narrow from 8–9 to 9–8 and stop dialing on Sundays and federal
-- holidays the moment this is applied. Telephony is not live yet, so nothing is spoken to anyone.
--
-- NOT LEGAL ADVICE. These hours are a conservative starting point; the owner or counsel must review
-- them. The Settings page marks them "Needs legal review".
--
-- Restated from the live bodies of tenant_can_dial_now and its explainer tenant_dial_window
-- (pg_get_functiondef, read 2026-11-03, identical
-- to 20260929201000); the only change is the two `else` branches. The guard below refuses to replace
-- a body that has moved on since.
--
-- TS twin: INSURVAS_DEFAULT_WINDOW / INSURVAS_DEFAULT_OPTIONS in lib/callingWindow/engine.ts. The
-- Settings page treats this function's presence as "the default is live".

begin;

create or replace function public.calling_window_insurvas_default()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'start_minute', 540,
    'end_minute', 1200,
    'no_sunday', true,
    'no_federal_holidays', true,
    'campaign_overrides_enabled', true
  );
$$;

comment on function public.calling_window_insurvas_default() is
  'The Insurvas default calling window for an agency with no row of its own (docs/settings/DEFAULTS.md). Needs owner/counsel review.';

revoke all on function public.calling_window_insurvas_default() from public;
grant execute on function public.calling_window_insurvas_default() to authenticated, service_role;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure) into v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  if v_def not like '%[201000] Minutes, and the state''s own Sunday window%'
     or v_def not like '%v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);%'
     or v_def like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_can_dial_now is not the 20260929201000 body; re-read it before restating';
  end if;
end $$;

create or replace function public.tenant_can_dial_now(p_tenant_id uuid, p_state text, p_campaign_id uuid, p_at timestamp with time zone default now())
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_zone text;
  -- The customer's wall clock: `p_at at time zone v_zone` is a local timestamp.
  v_local timestamp;
  v_minute integer;
  v_dow integer;
  v_start integer := 8 * 60;   -- federal floor, in minutes of the customer's day
  v_end integer := 21 * 60;
  v_rule record;
  v_tenant record;
  v_options record;
  v_campaign record;
  v_campaigns_apply boolean := true;
  -- [20261103100000] The Insurvas default, for an agency with no row of its own.
  v_default jsonb := public.calling_window_insurvas_default();
begin
  -- A lead with no state has no timezone and is not dialable. Absence of data is not permission.
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then return false; end if;

  -- A stale rules feed refuses the dial rather than guessing. Checked against now(), not p_at: the
  -- question is whether the rules can be trusted today, whatever instant is being asked about.
  if public.calling_window_rules_stale(now()) then return false; end if;

  select timezone into v_zone from public.state_timezones where state = upper(p_state);
  if v_zone is null then return false; end if;

  v_local := p_at at time zone v_zone;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  -- Each layer may only narrow. max(start), min(end) is the only operation, so a row that tries to
  -- widen is a no-op rather than a privilege escalation.
  select * into v_rule from public.calling_window_rules_in_force(v_local::date) r
   where r.state = upper(p_state);
  if found then
    -- [201000] Minutes, and the state's own Sunday window when it has one.
    if v_dow = 0 and v_rule.sunday_start_minute is not null then
      v_start := greatest(v_start, v_rule.sunday_start_minute);
      v_end := least(v_end, v_rule.sunday_end_minute);
    else
      v_start := greatest(v_start, coalesce(v_rule.start_minute, v_rule.start_hour * 60));
      v_end := least(v_end, coalesce(v_rule.end_minute, v_rule.end_hour * 60));
    end if;
    if v_rule.no_sunday and v_dow = 0 then return false; end if;
    if v_rule.allowed_weekdays is not null and not (v_dow::smallint = any(v_rule.allowed_weekdays)) then return false; end if;
    -- [201000] The state's own holidays AND the federal calendar (state_code NULL). NULL is never
    -- IN a list, so the federal rows used to be skipped here.
    if v_rule.no_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code in ('*', upper(p_state)))
    ) then return false; end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows where tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, coalesce(v_tenant.start_minute, v_tenant.start_hour * 60));
    v_end := least(v_end, coalesce(v_tenant.end_minute, v_tenant.end_hour * 60));
  else
    -- [20261103100000] No hours of its own: the Insurvas default hours.
    v_start := greatest(v_start, (v_default ->> 'start_minute')::integer);
    v_end := least(v_end, (v_default ->> 'end_minute')::integer);
  end if;

  select * into v_options from public.tenant_calling_window_options where tenant_id = p_tenant_id;
  if found then
    if v_options.no_sunday and v_dow = 0 then return false; end if;
    if v_options.no_federal_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then return false; end if;
    v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);
  else
    -- [20261103100000] No switches of its own: the Insurvas default switches.
    if (v_default ->> 'no_sunday')::boolean and v_dow = 0 then return false; end if;
    if (v_default ->> 'no_federal_holidays')::boolean and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then return false; end if;
    v_campaigns_apply := coalesce((v_default ->> 'campaign_overrides_enabled')::boolean, true);
  end if;

  if p_campaign_id is not null and v_campaigns_apply then
    select coalesce(calling_window_start_minute, calling_window_start_hour * 60) as s,
           coalesce(calling_window_end_minute, calling_window_end_hour * 60) as e
      into v_campaign from public.tenant_campaigns
     where id = p_campaign_id and tenant_id = p_tenant_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then return false; end if;
  return v_minute >= v_start and v_minute < v_end;
end;
$function$;

-- ── the explainer, which must agree with the decision ───────────────────────
-- tenant_dial_window says WHY a dial is refused (the dialer and Calling windows read it). Restated
-- from its live body (read 2026-11-03, identical to 20260929201000) with the same two `else` branches.
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.tenant_dial_window(uuid,text,uuid,timestamp with time zone)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%Checked with the same predicate as tenant_can_dial_now.%'
     or v_def like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_dial_window is not the 20260929201000 body; re-read it before restating';
  end if;
end $$;

create or replace function public.tenant_dial_window(p_tenant_id uuid, p_state text, p_campaign_id uuid, p_at timestamp with time zone default now())
 returns table(allowed boolean, start_minute integer, end_minute integer, zone text, local_minute integer, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_zone text;
  v_local timestamp;
  v_minute integer;
  v_dow integer;
  v_start integer := 8 * 60;
  v_end integer := 21 * 60;
  v_rule record;
  v_tenant record;
  v_options record;
  v_campaign record;
  v_campaigns_apply boolean := true;
  v_holiday_federal boolean;
  -- [20261103100000] The Insurvas default, for an agency with no row of its own.
  v_default jsonb := public.calling_window_insurvas_default();
begin
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then
    return query select false, null::integer, null::integer, null::text, null::integer, 'no_state'::text;
    return;
  end if;

  if public.calling_window_rules_stale(now()) then
    return query select false, null::integer, null::integer, null::text, null::integer, 'rules_stale'::text;
    return;
  end if;

  select st.timezone into v_zone from public.state_timezones st where st.state = upper(p_state);
  if v_zone is null then
    return query select false, null::integer, null::integer, null::text, null::integer, 'no_zone'::text;
    return;
  end if;

  v_local := p_at at time zone v_zone;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  select * into v_rule from public.calling_window_rules_in_force(v_local::date) r
   where r.state = upper(p_state);
  if found then
    if v_dow = 0 and v_rule.sunday_start_minute is not null then
      v_start := greatest(v_start, v_rule.sunday_start_minute);
      v_end := least(v_end, v_rule.sunday_end_minute);
    else
      v_start := greatest(v_start, coalesce(v_rule.start_minute, v_rule.start_hour * 60));
      v_end := least(v_end, coalesce(v_rule.end_minute, v_rule.end_hour * 60));
    end if;
    if v_rule.no_sunday and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'state_no_sunday'::text;
      return;
    end if;
    if v_rule.allowed_weekdays is not null and not (v_dow::smallint = any(v_rule.allowed_weekdays)) then
      return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
      return;
    end if;
    -- A federal date is named as one: 'federal_holiday' reads better than "a state holiday" on
    -- Thanksgiving. Checked with the same predicate as tenant_can_dial_now.
    select bool_or(h.state_code is null or h.state_code = '*') into v_holiday_federal
      from public.calling_window_holidays h
     where h.holiday_date = v_local::date
       and h.blocked
       and (h.state_code is null or h.state_code in ('*', upper(p_state)));
    if v_rule.no_holidays and v_holiday_federal is not null then
      return query select false, v_start, v_end, v_zone, v_minute,
        (case when v_holiday_federal then 'federal_holiday' else 'state_holiday' end)::text;
      return;
    end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows w where w.tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, coalesce(v_tenant.start_minute, v_tenant.start_hour * 60));
    v_end := least(v_end, coalesce(v_tenant.end_minute, v_tenant.end_hour * 60));
  else
    -- [20261103100000] No hours of its own: the Insurvas default hours.
    v_start := greatest(v_start, (v_default ->> 'start_minute')::integer);
    v_end := least(v_end, (v_default ->> 'end_minute')::integer);
  end if;

  select * into v_options from public.tenant_calling_window_options o where o.tenant_id = p_tenant_id;
  if found then
    if v_options.no_sunday and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'agency_no_sunday'::text;
      return;
    end if;
    if v_options.no_federal_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then
      return query select false, v_start, v_end, v_zone, v_minute, 'federal_holiday'::text;
      return;
    end if;
    v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);
  else
    -- [20261103100000] No switches of its own: the Insurvas default switches.
    if (v_default ->> 'no_sunday')::boolean and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'agency_no_sunday'::text;
      return;
    end if;
    if (v_default ->> 'no_federal_holidays')::boolean and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then
      return query select false, v_start, v_end, v_zone, v_minute, 'federal_holiday'::text;
      return;
    end if;
    v_campaigns_apply := coalesce((v_default ->> 'campaign_overrides_enabled')::boolean, true);
  end if;

  if p_campaign_id is not null and v_campaigns_apply then
    select coalesce(c.calling_window_start_minute, c.calling_window_start_hour * 60) as s,
           coalesce(c.calling_window_end_minute, c.calling_window_end_hour * 60) as e
      into v_campaign from public.tenant_campaigns c
     where c.id = p_campaign_id and c.tenant_id = p_tenant_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then
    return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
    return;
  end if;
  if v_minute < v_start then
    return query select false, v_start, v_end, v_zone, v_minute, 'before_open'::text;
    return;
  end if;
  if v_minute >= v_end then
    return query select false, v_start, v_end, v_zone, v_minute, 'after_close'::text;
    return;
  end if;
  return query select true, v_start, v_end, v_zone, v_minute, 'open'::text;
end;
$function$;

-- ── check ────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure);
  -- An agency with no rows at all: the Insurvas default is what both functions apply.
  v_tenant uuid := gen_random_uuid();
  v_state text;
  v_hour integer;
  v_at timestamptz;
  v_explained boolean;
  v_decided boolean;
  v_base constant timestamptz := timestamptz '2026-11-22 00:00:00+00';
begin
  if v_def not like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_can_dial_now does not read the Insurvas default';
  end if;
  if pg_get_functiondef('public.tenant_dial_window(uuid,text,uuid,timestamp with time zone)'::regprocedure) not like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_dial_window does not read the Insurvas default';
  end if;
  -- Every state, eight days around Thanksgiving 2026 (a Sunday and a federal holiday inside),
  -- twice an hour: the explainer and the dial check must agree on the default too.
  for v_state in select st.state from public.state_timezones st union all select 'XX' loop
    for v_hour in 0 .. (8 * 24 - 1) loop
      foreach v_at in array array[v_base + make_interval(hours => v_hour), v_base + make_interval(hours => v_hour, mins => 45)] loop
        select w.allowed into v_explained from public.tenant_dial_window(v_tenant, v_state, null, v_at) w;
        v_decided := public.tenant_can_dial_now(v_tenant, v_state, null, v_at);
        if v_explained is distinct from coalesce(v_decided, false) then
          raise exception 'tenant_dial_window disagrees with tenant_can_dial_now for state % at %: % vs %',
            v_state, v_at, v_explained, v_decided;
        end if;
      end loop;
    end loop;
  end loop;
  -- The default bites: 8:30 am in New York on a Monday is inside federal hours but outside 9–8.
  if public.tenant_can_dial_now(v_tenant, 'NY', null, (date '2026-11-23' + time '08:30') at time zone 'America/New_York') then
    raise exception '20261103100000: the default did not narrow the morning';
  end if;
  if (public.calling_window_insurvas_default() ->> 'start_minute')::integer <> 540
     or (public.calling_window_insurvas_default() ->> 'end_minute')::integer <> 1200 then
    raise exception '20261103100000: the Insurvas default is not 9:00–20:00';
  end if;
end $$;

commit;

-- ════ 20261103110000_sales_pipeline_application_stages ════
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

-- ════ 20261103120000_platform_templates_every_line ════
-- Settings defaults · Insurvas templates for every catalogue line (docs/settings/DEFAULTS.md, owner
-- pick 2026-11-03: "All lines, for review").
--
-- Before this, only Final Expense had all three Insurvas templates and Term Life had only health
-- questions, so every other line borrowed Final Expense's questions, quote inputs and field set
-- (pickTemplate / pickQuotationTemplate / fieldSetFor fall back to final_expense). This adds platform
-- rows (tenant_id null), published at version 1, so a new agency can work any line it switches on:
--
--   underwriting           whole_life, iul, medicare_advantage, annuity
--   quotation              term_life, whole_life, iul, medicare_advantage, annuity
--   application_field_set  term_life, whole_life, iul, medicare_advantage, annuity
--   disclosures (DRAFT)    MA_TPMO_DISCLAIMER, ANNUITY_SUITABILITY — unpublished, so no application
--                          carries them until Insurvas staff review and publish them.
--
-- NEEDS REVIEW. The new templates are a working starting point written from general US practice,
-- not carrier- or counsel-approved wording; the names end "needs review" so the Settings pages say
-- so. The Medicare Advantage and annuity ones touch CMS marketing rules and the NAIC best-interest
-- standard, and must be reviewed by the owner or counsel before they are relied on.
--
-- Existing agencies keep their own templates: their own rows win over these (own → platform), and
-- nothing here writes a tenant row. Insert-only and idempotent (`on conflict do nothing` on the
-- coalesced version index). Every definition is validated against the editor's own Zod schemas by
-- lib/salesSettings/platformTemplates.test.mjs, which reads this file.

begin;

-- ── 1 · underwriting ─────────────────────────────────────────────────────────

-- Whole Life (simplified issue): the persistency questions, build and tobacco, the common knockouts.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Whole Life — standard · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": true,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Sets the draft date — the biggest lever on month-4 lapse.", "persistency": true},
    {"field_key": "deposit_account", "label": "Is the account you'll pay from the one it lands in?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 40, "help_text": "A yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Does that policy have a cash value you plan to move to the new one?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "height_in", "label": "Height (inches)", "type": "number", "is_required": true,
     "options": [], "sort_order": 100, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_lb", "label": "Weight (pounds)", "type": "number", "is_required": true,
     "options": [], "sort_order": 110, "help_text": "Read against the carrier's build chart."},
    {"field_key": "tobacco", "label": "Have you used tobacco or nicotine in the last 12 months?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "terminal", "label": "Have you been diagnosed with a terminal illness, or are you in hospice care?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "confined", "label": "Are you in a nursing home, or do you need help with bathing, dressing or eating?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "oxygen", "label": "In the last 2 years, have you used oxygen equipment?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 220, "help_text": null},
    {"field_key": "cancer", "label": "Have you been diagnosed with or treated for cancer in the last 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 230, "help_text": null},
    {"field_key": "heart_stroke", "label": "Have you had a heart attack, stroke or heart surgery in the last 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 240, "help_text": null},
    {"field_key": "copd", "label": "Do you have COPD, emphysema or chronic bronchitis?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 250, "help_text": null},
    {"field_key": "diabetes", "label": "Do you have diabetes?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 260, "help_text": null},
    {"field_key": "diabetes_insulin", "label": "Do you use insulin?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 261, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 300, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 400, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": true, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "build", "label": "Height, weight and tobacco", "sort_order": 20, "fields": [
      {"field_key": "height_in", "is_required": true, "show_when": null},
      {"field_key": "weight_lb", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null}
    ]},
    {"section_key": "health", "label": "Health", "sort_order": 30, "fields": [
      {"field_key": "terminal", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Simplified-issue whole life declines a terminal diagnosis or hospice care."},
      {"field_key": "confined", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Most carriers decline nursing-home confinement or help with daily living; guaranteed issue only."},
      {"field_key": "oxygen", "is_required": true, "show_when": null},
      {"field_key": "cancer", "is_required": true, "show_when": null},
      {"field_key": "heart_stroke", "is_required": true, "show_when": null},
      {"field_key": "copd", "is_required": true, "show_when": null},
      {"field_key": "diabetes", "is_required": true, "show_when": null},
      {"field_key": "diabetes_insulin", "is_required": false, "show_when": {"field_key": "diabetes", "equals": "true"}}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 40, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 50, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'whole_life'
on conflict do nothing;

-- Indexed Universal Life: fully underwritten like term, plus the goal and how it is funded.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Indexed Universal Life — standard · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When is your pay or Social Security deposited?", "type": "single_select", "is_required": false,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Payday from work", "Other"],
     "sort_order": 10, "help_text": "Sets the draft date.", "persistency": true},
    {"field_key": "deposit_account", "label": "Is the account you'll pay from the one it lands in?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 40, "help_text": "A yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Does that policy have a cash value you plan to move to the new one?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "coverage_goal", "label": "What matters most from this policy?", "type": "single_select", "is_required": true,
     "options": ["Death benefit for my family", "Tax-advantaged cash value", "Supplemental retirement income", "Business or key person", "Estate planning"],
     "sort_order": 60, "help_text": "Written into the case notes, so the recommendation can be explained later."},
    {"field_key": "funding_source", "label": "How will the premium be paid?", "type": "single_select", "is_required": true,
     "options": ["Monthly from income", "Annual from savings", "Lump sum", "Premium financing"],
     "sort_order": 70, "help_text": null},
    {"field_key": "height_in", "label": "Height (inches)", "type": "number", "is_required": true,
     "options": [], "sort_order": 100, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_lb", "label": "Weight (pounds)", "type": "number", "is_required": true,
     "options": [], "sort_order": 110, "help_text": "Read against the carrier's build chart."},
    {"field_key": "tobacco", "label": "Have you used tobacco or nicotine in the last 12 months?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "driving_dui", "label": "Any DUI or DWI in the last 5 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "hazardous_avocations", "label": "Do you fly as a pilot, or take part in scuba diving, skydiving, climbing or motor racing?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "hazardous_avocations_details", "label": "Which, and how often?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 211, "help_text": null},
    {"field_key": "family_history_before_60", "label": "Has a parent or sibling died of, or been diagnosed with, heart disease or cancer before age 60?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 300, "help_text": null},
    {"field_key": "annual_income", "label": "Annual earned income", "type": "currency", "is_required": true,
     "options": [], "sort_order": 400, "help_text": "Carriers cap face amount at a multiple of income."},
    {"field_key": "net_worth", "label": "Household net worth", "type": "currency", "is_required": true,
     "options": [], "sort_order": 410, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 500, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 600, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": false, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "goal", "label": "What it is for", "sort_order": 20, "fields": [
      {"field_key": "coverage_goal", "is_required": true, "show_when": null},
      {"field_key": "funding_source", "is_required": true, "show_when": null}
    ]},
    {"section_key": "build", "label": "Height, weight and tobacco", "sort_order": 30, "fields": [
      {"field_key": "height_in", "is_required": true, "show_when": null},
      {"field_key": "weight_lb", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null}
    ]},
    {"section_key": "lifestyle", "label": "Driving and activities", "sort_order": 40, "fields": [
      {"field_key": "driving_dui", "is_required": true, "show_when": null},
      {"field_key": "hazardous_avocations", "is_required": true, "show_when": null},
      {"field_key": "hazardous_avocations_details", "is_required": false, "show_when": {"field_key": "hazardous_avocations", "equals": "true"}}
    ]},
    {"section_key": "family", "label": "Family history", "sort_order": 50, "fields": [
      {"field_key": "family_history_before_60", "is_required": true, "show_when": null}
    ]},
    {"section_key": "financial", "label": "Financial justification", "sort_order": 60, "fields": [
      {"field_key": "annual_income", "is_required": true, "show_when": null},
      {"field_key": "net_worth", "is_required": true, "show_when": null}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 70, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 80, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'iul'
on conflict do nothing;

-- Medicare Advantage: eligibility and fit, not health underwriting. CMS rules apply to these calls.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Medicare Advantage — eligibility · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": false,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Only matters for a plan with a premium.", "persistency": true},
    {"field_key": "deposit_account", "label": "If the plan has a premium, will it come from the account your benefits land in?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else help you decide on your health coverage?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 40, "help_text": "Asked on every Insurvas template; a yes brings up the life replacement notice.", "persistency": true},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "scope_of_appointment", "label": "Is a Scope of Appointment on file for the plan types discussed today?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 60, "help_text": "CMS rules decide when one is needed and how far ahead. Check your agency's compliance guidance."},
    {"field_key": "medicare_parts_ab", "label": "Are you enrolled in both Medicare Part A and Part B?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 100, "help_text": null},
    {"field_key": "election_period", "label": "Which enrollment period does this fall in?", "type": "single_select", "is_required": true,
     "options": ["Initial Enrollment Period", "Annual Enrollment Period (Oct 15 – Dec 7)", "Medicare Advantage Open Enrollment (Jan 1 – Mar 31)", "Special Enrollment Period", "Not sure"],
     "sort_order": 110, "help_text": "The carrier's form asks for the election and, for a Special Enrollment Period, the reason."},
    {"field_key": "sep_reason", "label": "What is the reason for the Special Enrollment Period?", "type": "text", "is_required": false,
     "options": [], "sort_order": 111, "help_text": null},
    {"field_key": "current_coverage", "label": "What coverage do you have now?", "type": "single_select", "is_required": true,
     "options": ["Original Medicare only", "A Medicare Advantage plan", "A Medicare Supplement (Medigap)", "Employer or retiree coverage", "Medicaid", "None"],
     "sort_order": 120, "help_text": null},
    {"field_key": "medicaid_or_extra_help", "label": "Do you have Medicaid or Extra Help with drug costs?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 130, "help_text": "A yes may open a Special Needs Plan."},
    {"field_key": "doctors_to_keep", "label": "Which doctors and hospitals do you want to keep?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 200, "help_text": "Check each against the plan's network before enrolling."},
    {"field_key": "preferred_pharmacy", "label": "Which pharmacy do you use?", "type": "text", "is_required": false,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "medications", "label": "Prescriptions", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 220, "help_text": "Name and dose, to check each plan's drug list."},
    {"field_key": "notes", "label": "Anything else to note", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 300, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "scope_of_appointment", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "false"}, "knockout_note": "Record a Scope of Appointment before discussing plan types, where CMS rules require one."},
      {"field_key": "ss_deposit_day", "is_required": false, "show_when": null},
      {"field_key": "deposit_account", "is_required": false, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": false, "show_when": null},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "eligibility", "label": "Eligibility", "sort_order": 20, "fields": [
      {"field_key": "medicare_parts_ab", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "false"}, "knockout_note": "Medicare Advantage needs both Part A and Part B."},
      {"field_key": "election_period", "is_required": true, "show_when": null},
      {"field_key": "sep_reason", "is_required": false, "show_when": {"field_key": "election_period", "equals": "Special Enrollment Period"}},
      {"field_key": "current_coverage", "is_required": true, "show_when": null},
      {"field_key": "medicaid_or_extra_help", "is_required": true, "show_when": null}
    ]},
    {"section_key": "fit", "label": "Doctors and drugs", "sort_order": 30, "fields": [
      {"field_key": "doctors_to_keep", "is_required": false, "show_when": null},
      {"field_key": "preferred_pharmacy", "is_required": false, "show_when": null},
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 40, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'medicare_advantage'
on conflict do nothing;

-- Annuity: the suitability facts a best-interest recommendation rests on. No health questions.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Annuity — suitability · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": false,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Only matters for a flexible-premium annuity.", "persistency": true},
    {"field_key": "deposit_account", "label": "Will the money come from an account in your own name?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 40, "help_text": "Asked on every Insurvas template; a yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Will money come from an existing annuity or life policy's cash value?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "objective", "label": "What is this money for?", "type": "single_select", "is_required": true,
     "options": ["Guaranteed income for life", "Growth with protection from loss", "Tax deferral", "Leaving it to my family"],
     "sort_order": 100, "help_text": null},
    {"field_key": "time_horizon", "label": "When do you expect to start using it?", "type": "single_select", "is_required": true,
     "options": ["Right away", "Within 5 years", "5 to 10 years", "More than 10 years"],
     "sort_order": 110, "help_text": null},
    {"field_key": "liquidity_need", "label": "Could you need this money for an emergency before the surrender period ends?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "risk_tolerance", "label": "How do you feel about your savings going down in value?", "type": "single_select", "is_required": true,
     "options": ["I can't accept any loss", "A small dip is fine for more growth", "I accept market ups and downs"],
     "sort_order": 130, "help_text": null},
    {"field_key": "source_of_funds", "label": "Where is the money coming from?", "type": "single_select", "is_required": true,
     "options": ["Bank savings or CD", "Retirement plan rollover (401k, IRA)", "Existing annuity", "Life insurance cash value", "Sale of a home or business", "Other"],
     "sort_order": 140, "help_text": null},
    {"field_key": "annual_income", "label": "Annual household income", "type": "currency", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "liquid_net_worth", "label": "Savings you could reach quickly, after this purchase", "type": "currency", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "net_worth", "label": "Household net worth, not counting your home", "type": "currency", "is_required": true,
     "options": [], "sort_order": 220, "help_text": null},
    {"field_key": "notes", "label": "Why this annuity fits (for the file)", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 300, "help_text": "The reason for the recommendation, in the agent's words."}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": false, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": false, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": true, "show_when": null},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "needs", "label": "Goals and needs", "sort_order": 20, "fields": [
      {"field_key": "objective", "is_required": true, "show_when": null},
      {"field_key": "time_horizon", "is_required": true, "show_when": null},
      {"field_key": "liquidity_need", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Money that may be needed before the surrender period ends is a poor fit for most annuities."},
      {"field_key": "risk_tolerance", "is_required": true, "show_when": null},
      {"field_key": "source_of_funds", "is_required": true, "show_when": null}
    ]},
    {"section_key": "financial", "label": "Financial picture", "sort_order": 30, "fields": [
      {"field_key": "annual_income", "is_required": true, "show_when": null},
      {"field_key": "liquid_net_worth", "is_required": true, "show_when": null},
      {"field_key": "net_worth", "is_required": true, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 40, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'annuity'
on conflict do nothing;

-- ── 2 · quotation ────────────────────────────────────────────────────────────

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Term Life — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "term_length", "label": "Term length (years)", "type": "number", "is_required": true, "options": [], "sort_order": 60, "help_text": "10, 15, 20, 25 or 30, where the carrier offers it."},
    {"field_key": "health_class", "label": "Health class quoted", "type": "single_select", "is_required": true,
     "options": ["Preferred Plus", "Preferred", "Standard Plus", "Standard", "Table rated"], "sort_order": 70, "help_text": "The class the quote assumes; underwriting decides the real one."},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Accidental death", "Child rider", "Waiver of premium", "Terminal illness", "Return of premium"], "sort_order": 80, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "term_length", "is_required": true, "show_when": null},
      {"field_key": "health_class", "is_required": true, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'term_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Whole Life — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "tier", "label": "Tier", "type": "single_select", "is_required": true, "options": ["level", "graded", "modified", "gi"], "sort_order": 60, "help_text": null},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Accidental death", "Child rider", "Waiver of premium", "Terminal illness", "Paid-up additions"], "sort_order": 70, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "tier", "is_required": true, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'whole_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Indexed Universal Life — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "health_class", "label": "Health class quoted", "type": "single_select", "is_required": true,
     "options": ["Preferred Plus", "Preferred", "Standard Plus", "Standard", "Table rated"], "sort_order": 60, "help_text": "The class the illustration assumes; underwriting decides the real one."},
    {"field_key": "planned_premium", "label": "Planned premium", "type": "currency", "is_required": false, "options": [], "sort_order": 70, "help_text": "What the client means to pay, if more than the minimum."},
    {"field_key": "premium_mode", "label": "Paid", "type": "single_select", "is_required": false, "options": ["Monthly", "Quarterly", "Annually"], "sort_order": 80, "help_text": null},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Chronic illness", "Critical illness", "Terminal illness", "Waiver of premium", "Child rider"], "sort_order": 90, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "health_class", "is_required": true, "show_when": null},
      {"field_key": "planned_premium", "is_required": false, "show_when": null},
      {"field_key": "premium_mode", "is_required": false, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'iul'
on conflict do nothing;

-- The Quote step always asks a face amount and a date of birth; for these two lines the face amount
-- is labelled for what it holds (no plan has a face amount; an annuity has a deposit).
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Medicare Advantage — plan fit · needs review', 1, 'published', $def${
  "age_basis": "last",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 20, "help_text": null},
    {"field_key": "zip_code", "label": "ZIP code", "type": "text", "is_required": true, "options": [], "sort_order": 30, "help_text": "Plans are sold by county; the ZIP finds it."},
    {"field_key": "plan_type", "label": "Plan type", "type": "single_select", "is_required": true, "options": ["HMO", "PPO", "PFFS", "Special Needs Plan"], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Monthly plan premium", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": "Medicare Advantage has no face amount: record the plan's monthly premium, $0 included."},
    {"field_key": "drug_coverage", "label": "Includes drug coverage (MAPD)", "type": "boolean", "is_required": true, "options": [], "sort_order": 60, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Plan", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "zip_code", "is_required": true, "show_when": null},
      {"field_key": "plan_type", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "drug_coverage", "is_required": true, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'medicare_advantage'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Annuity — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Owner's date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 20, "help_text": null},
    {"field_key": "face_amount", "label": "Amount to deposit", "type": "currency", "is_required": true, "options": [], "sort_order": 30, "help_text": "An annuity has no face amount: record the premium deposited."},
    {"field_key": "annuity_type", "label": "Annuity type", "type": "single_select", "is_required": true, "options": ["Multi-year guaranteed (MYGA)", "Fixed indexed", "Immediate income (SPIA)", "Deferred income"], "sort_order": 40, "help_text": null},
    {"field_key": "tax_status", "label": "Tax status", "type": "single_select", "is_required": true, "options": ["Qualified (IRA, rollover)", "Non-qualified"], "sort_order": 50, "help_text": null},
    {"field_key": "surrender_years", "label": "Surrender period (years)", "type": "number", "is_required": false, "options": [], "sort_order": 60, "help_text": null},
    {"field_key": "income_rider", "label": "Income rider", "type": "boolean", "is_required": false, "options": [], "sort_order": 70, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "annuity_type", "is_required": true, "show_when": null},
      {"field_key": "tax_status", "is_required": true, "show_when": null},
      {"field_key": "surrender_years", "is_required": false, "show_when": null},
      {"field_key": "income_rider", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'annuity'
on conflict do nothing;

-- ── 3 · application field sets ───────────────────────────────────────────────

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Term Life — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip",
               "custom.drivers_license_number", "custom.drivers_license_state", "custom.occupation", "custom.annual_income"],
  "optional": ["insured.middle_initial", "insured.birth_state", "contact.email", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship"],
  "custom": [
    {"key": "custom.drivers_license_number", "label": "Driver's license number", "type": "text", "group": "insured"},
    {"key": "custom.drivers_license_state", "label": "Driver's license state", "type": "state", "group": "insured"},
    {"key": "custom.occupation", "label": "Occupation", "type": "text", "group": "insured"},
    {"key": "custom.annual_income", "label": "Annual earned income", "type": "currency", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'term_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Whole Life — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip"],
  "optional": ["insured.middle_initial", "insured.birth_state", "contact.email", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship",
               "custom.occupation"],
  "custom": [
    {"key": "custom.occupation", "label": "Occupation", "type": "text", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'whole_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Indexed Universal Life — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "contact.email", "addr.line1", "addr.city", "addr.state", "addr.zip",
               "custom.drivers_license_number", "custom.drivers_license_state", "custom.occupation", "custom.annual_income", "custom.net_worth"],
  "optional": ["insured.middle_initial", "insured.birth_state", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship", "custom.employer"],
  "custom": [
    {"key": "custom.drivers_license_number", "label": "Driver's license number", "type": "text", "group": "insured"},
    {"key": "custom.drivers_license_state", "label": "Driver's license state", "type": "state", "group": "insured"},
    {"key": "custom.occupation", "label": "Occupation", "type": "text", "group": "insured"},
    {"key": "custom.employer", "label": "Employer", "type": "text", "group": "insured"},
    {"key": "custom.annual_income", "label": "Annual earned income", "type": "currency", "group": "insured"},
    {"key": "custom.net_worth", "label": "Household net worth", "type": "currency", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'iul'
on conflict do nothing;

-- Medicare Advantage: the enrollment form's facts. The Medicare number is an identifier the carrier
-- needs; it is not masked like the SSN (a custom question cannot be), which is part of the review.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Medicare Advantage — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "contact.phone",
               "addr.line1", "addr.city", "addr.state", "addr.zip",
               "custom.medicare_number", "custom.part_a_date", "custom.part_b_date"],
  "optional": ["insured.middle_initial", "contact.email", "addr.line2", "custom.primary_care_provider", "custom.medicaid_number", "custom.emergency_contact"],
  "custom": [
    {"key": "custom.medicare_number", "label": "Medicare number (MBI)", "type": "text", "group": "insured"},
    {"key": "custom.part_a_date", "label": "Part A effective date", "type": "date", "group": "insured"},
    {"key": "custom.part_b_date", "label": "Part B effective date", "type": "date", "group": "insured"},
    {"key": "custom.primary_care_provider", "label": "Primary care provider", "type": "text", "group": "insured"},
    {"key": "custom.medicaid_number", "label": "Medicaid number", "type": "text", "group": "insured"},
    {"key": "custom.emergency_contact", "label": "Emergency contact (name and phone)", "type": "text", "group": "contact"}
  ],
  "help": {
    "custom.medicare_number": "From the red, white and blue Medicare card: 11 letters and numbers."
  }
}$def$::jsonb, now()
  from public.products p
 where p.code = 'medicare_advantage'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Annuity — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn",
               "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip",
               "owner.same_as_insured", "custom.tax_status", "custom.source_of_funds"],
  "optional": ["insured.middle_initial", "contact.email", "addr.line2", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship",
               "custom.drivers_license_number", "custom.drivers_license_state"],
  "labels": {
    "owner.same_as_insured": "Owner is the annuitant"
  },
  "custom": [
    {"key": "custom.tax_status", "label": "Tax status", "type": "choice", "options": ["Qualified (IRA, rollover)", "Non-qualified"], "group": "cov"},
    {"key": "custom.source_of_funds", "label": "Source of funds", "type": "choice", "options": ["Bank savings or CD", "Retirement plan rollover", "Existing annuity", "Life insurance cash value", "Other"], "group": "cov"},
    {"key": "custom.drivers_license_number", "label": "Driver's license number", "type": "text", "group": "insured"},
    {"key": "custom.drivers_license_state", "label": "Driver's license state", "type": "state", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'annuity'
on conflict do nothing;

-- ── 4 · disclosures, as unpublished drafts ───────────────────────────────────
-- Platform drafts are never loaded by an application (refreshDisclosures reads published rows only)
-- and never listed for an agency (disclosureLibrary shows published platform rows only). They wait
-- for Insurvas staff to review the wording, add their rules and publish them.

insert into public.application_disclosures (tenant_id, code, title, body_markdown, version, status) values
  (null, 'MA_TPMO_DISCLAIMER', 'Medicare Advantage: plans we represent', $body$
[DRAFT — NOT COMPLIANCE-APPROVED. Review the current CMS marketing rules before publishing.]

We do not offer every plan available in your area. Currently we represent **[number]**
organizations which offer **[number]** products in your area. Please contact Medicare.gov,
1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of
your options.
$body$, 1, 'draft'),
  (null, 'ANNUITY_SUITABILITY', 'Annuity recommendation: what you told us', $body$
[DRAFT — NOT COMPLIANCE-APPROVED. Review against your state's annuity best-interest rule before publishing.]

Before recommending this annuity, your agent asked about your financial situation, goals, time
horizon, need for access to the money, tolerance for risk, and where the money is coming from.

Please confirm that:

- the information you gave is complete and accurate;
- you understand this annuity has a **surrender period**, and that taking out more than the free
  withdrawal amount during it can cost you a surrender charge;
- you have enough other money available for emergencies;
- if this replaces an existing annuity or policy, you were told what you may give up;
- you have a free-look period after the contract is delivered.

Ask any question you have before we continue.
$body$, 1, 'draft')
on conflict do nothing;

-- ── 5 · checks ───────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(want.kind || '/' || want.code, ', ') into v_missing
    from (values
      ('underwriting', 'whole_life'), ('underwriting', 'iul'), ('underwriting', 'medicare_advantage'), ('underwriting', 'annuity'),
      ('quotation', 'term_life'), ('quotation', 'whole_life'), ('quotation', 'iul'), ('quotation', 'medicare_advantage'), ('quotation', 'annuity'),
      ('application_field_set', 'term_life'), ('application_field_set', 'whole_life'), ('application_field_set', 'iul'),
      ('application_field_set', 'medicare_advantage'), ('application_field_set', 'annuity')
    ) as want(kind, code)
   where exists (select 1 from public.products p where p.code = want.code)
     and not exists (
       select 1 from public.sales_templates t
        where t.tenant_id is null and t.carrier_id is null and t.status = 'published'
          and t.kind = want.kind and t.product_code = want.code
     );
  if v_missing is not null then
    raise exception '20261103120000: no published Insurvas template for %', v_missing;
  end if;
  if (select count(*) from public.application_disclosures
       where tenant_id is null and code in ('MA_TPMO_DISCLAIMER', 'ANNUITY_SUITABILITY')) <> 2 then
    raise exception '20261103120000: the two draft disclosures are missing';
  end if;
  if exists (select 1 from public.application_disclosures
              where tenant_id is null and code in ('MA_TPMO_DISCLAIMER', 'ANNUITY_SUITABILITY') and status <> 'draft') then
    raise exception '20261103120000: a reviewed-only disclosure is not a draft';
  end if;
end $$;

commit;

