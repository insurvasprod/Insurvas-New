-- Book of business · every policy status moves the card (owner 2026-11-04).
--
-- The owner: "there are multiple statuses when you get a policy… based on those statuses we need to adjust it to
-- the exact pipeline", and In force must come from the policy file, not wait for a commission line. LA-4.5's
-- nine normalized statuses are the vocabulary. This migration:
--
--   1. lets a pipeline rule listen for the four status events the code now raises (lib/pipelineRules/events.ts):
--      submitted, in_force, at_risk, paid_up — the check on pipeline_rule_version.event is widened;
--   2. adds to every all-in-one Sales pipeline the stages the statuses still lacked, after the ones it has:
--        At risk (won, after In force) · Paid up (won, after At risk) · Declined, Withdrawn, Not taken (lost, at
--        the end, before Lapsed and Charged back where those sit last).
--      A stage the pipeline already has by name is left as it is;
--   3. adds starter rules, in Forecast, one per status, each moving a card forward only, from the Sales
--      pipeline's own stages and from every sold stage on the agency's other pipelines (as 20261104120000):
--        Submitted (carrier file) → Submitted      from the open stages before it
--        In force → In force                      from Submitted, Issued, At risk
--        Paid again → In force                    from At risk
--        At risk → At risk                        from Issued, In force
--        Paid up → Paid up                        from Issued, In force, At risk
--        Declined → Declined                      from the open stages, Submitted, Issued
--        Withdrawn → Withdrawn                    from the open stages, Submitted, Issued
--        Not taken → Not taken                    from Submitted, Issued
--      and gives the earlier Lapsed and Chargeback starter rules a new version that also moves from At risk.
--      A rule the agency already has by the same name is left alone. Nothing moves until each rule is switched live.
--
-- public.add_policy_status_pipeline(tenant) does 2 and 3 for one agency, once, and is safe to run again. New
-- agencies get it from seed_default_pipelines; every existing agency with an all-in-one default gets it here.
--
-- Rollback: restore the event check to 20261102100000's list (after deleting versions with the new events),
-- restore seed_default_pipelines from 20261104100000, drop public.add_policy_status_pipeline(uuid); per agency,
-- delete the eight rules by name and archive the five stages if they hold no lead.

begin;

-- ─── 1. the events a rule may listen for ───────────────────────────────────────────────────────────────
alter table public.pipeline_rule_version drop constraint if exists pipeline_rule_version_event_check;
alter table public.pipeline_rule_version add constraint pipeline_rule_version_event_check check (event in (
  'submitted', 'issued', 'waiting_first_payment', 'first_payment_missed', 'later_payment_missed', 'paid_again',
  'in_force', 'at_risk', 'paid_up',
  'lapsed', 'not_taken', 'cancelled', 'declined', 'withdrawn',
  'advance_received', 'commission_credited', 'chargeback_received'));

-- seed_default_pipelines must still be 20261104100000's body before it is restated.
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%perform public.add_after_sale_pipeline(p_tenant_id);%' or v_def like '%add_policy_status_pipeline%' then
    raise exception '20261104130000: seed_default_pipelines is not the 20261104100000 body; re-read it before restating';
  end if;
end $$;

-- ─── 2 + 3. the stages and the starter rules, for one agency ───────────────────────────────────────────
create or replace function public.add_policy_status_pipeline(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
  v_name text;
  v_after text;
  v_anchor integer;
  v_last integer;
  v_other uuid[];
  v_open uuid[];
  v_rule uuid;
  v_version integer;
  r record;
  s record;
begin
  select id into v_pipeline from public.tenant_pipelines
   where tenant_id = p_tenant_id and partner_type is null and is_default;
  if v_pipeline is null then return; end if;

  -- Won stages, each right after the stage it follows (the stages after it move down one place).
  for v_name, v_after in select * from (values ('At risk', 'In force'), ('Paid up', 'At risk')) as t(name, after) loop
    continue when exists (select 1 from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = v_name);
    select position into v_anchor from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived and name = v_after;
    if v_anchor is null then
      select coalesce(max(position), -1) into v_last from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived;
      v_anchor := v_last;
    end if;
    -- Two steps: the active-position index is unique, so the stages after pass through a free range first.
    update public.tenant_pipeline_stages set position = position + 1000000, updated_at = now()
     where pipeline_id = v_pipeline and not is_archived and position > v_anchor;
    update public.tenant_pipeline_stages set position = position - 1000000 + 1, updated_at = now()
     where pipeline_id = v_pipeline and not is_archived and position > 1000000;
    insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
    values (v_pipeline, v_name, v_anchor + 1, 'won', case v_name when 'At risk' then '#b35c00' else '#0a8769' end)
    on conflict (pipeline_id, name) do nothing;
  end loop;

  -- Lost stages, before Lapsed when the pipeline has it (the closed-by-the-carrier group stays together), else at the end.
  foreach v_name in array array['Declined', 'Withdrawn', 'Not taken'] loop
    continue when exists (select 1 from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = v_name);
    select position into v_anchor from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived and name = 'Lapsed';
    if v_anchor is not null then
      update public.tenant_pipeline_stages set position = position + 1000000, updated_at = now()
       where pipeline_id = v_pipeline and not is_archived and position >= v_anchor;
      update public.tenant_pipeline_stages set position = position - 1000000 + 1, updated_at = now()
       where pipeline_id = v_pipeline and not is_archived and position > 1000000;
    else
      select coalesce(max(position), -1) + 1 into v_anchor from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived;
    end if;
    insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
    values (v_pipeline, v_name, v_anchor, 'lost', case v_name when 'Declined' then '#c62828' when 'Withdrawn' then '#59606b' else '#e04e00' end)
    on conflict (pipeline_id, name) do nothing;
  end loop;

  -- The stages the rules move from and to, by name; a sold stage on another pipeline counts as a from-stage too.
  select coalesce(array_agg(st.id order by st.id), '{}') into v_other
    from public.tenant_pipeline_stages st join public.tenant_pipelines p on p.id = st.pipeline_id
   where p.tenant_id = p_tenant_id and p.id <> v_pipeline and not st.is_archived and (st.stage_type = 'won' or st.name = 'Issued');
  select coalesce(array_agg(st.id order by st.position), '{}') into v_open
    from public.tenant_pipeline_stages st
   where st.pipeline_id = v_pipeline and not st.is_archived and st.stage_type = 'open';

  for r in
    select * from (values
      ('Submitted (carrier file) → Submitted', 'submitted',  'Submitted',  array['']::text[],                       true,  'Submitted to {carrier}, policy {policy_number}.'),
      ('In force → In force',                  'in_force',   'In force',   array['Submitted', 'Issued', 'At risk'],  false, 'In force at {carrier}, policy {policy_number}, paid to {paid_to_date}.'),
      ('Paid again → In force',                'paid_again', 'In force',   array['At risk'],                         false, 'Paid again at {carrier}, policy {policy_number}, paid to {paid_to_date}.'),
      ('At risk → At risk',                    'at_risk',    'At risk',    array['Issued', 'In force'],              false, 'At risk at {carrier}, policy {policy_number}, paid to {paid_to_date}.'),
      ('Paid up → Paid up',                    'paid_up',    'Paid up',    array['Issued', 'In force', 'At risk'],   false, 'Paid up at {carrier}, policy {policy_number}.'),
      ('Declined → Declined',                  'declined',   'Declined',   array['Submitted', 'Issued'],             true,  'Declined by {carrier}, policy {policy_number}.'),
      ('Withdrawn → Withdrawn',                'withdrawn',  'Withdrawn',  array['Submitted', 'Issued'],             true,  'Withdrawn at {carrier}, policy {policy_number}.'),
      ('Not taken → Not taken',                'not_taken',  'Not taken',  array['Submitted', 'Issued'],             false, 'Not taken at {carrier}, policy {policy_number}.')
    ) as t(name, event, target, from_names, with_open, note)
  loop
    continue when exists (select 1 from public.pipeline_rule pr where pr.tenant_id = p_tenant_id and pr.name = r.name);
    select st.id into v_rule from public.tenant_pipeline_stages st where st.pipeline_id = v_pipeline and not st.is_archived and st.name = r.target;
    continue when v_rule is null;  -- the target stage is archived or renamed: no rule for it
    insert into public.pipeline_rule (tenant_id, name, mode, enabled, current_version, forecast_since)
    values (p_tenant_id, r.name, 'forecast', true, 1, now())
    returning id into v_rule;
    insert into public.pipeline_rule_version (tenant_id, rule_id, version, event, carrier_ids, from_stage_ids, target_pipeline_id, target_stage_id, note_on, note_template)
    select p_tenant_id, v_rule, 1, r.event, '{}',
           (select coalesce(array_agg(distinct x), '{}') from unnest(
              (select coalesce(array_agg(st.id), '{}') from public.tenant_pipeline_stages st where st.pipeline_id = v_pipeline and not st.is_archived and st.name = any(r.from_names))
              || (case when r.with_open then v_open else '{}' end) || v_other) x),
           v_pipeline,
           (select st.id from public.tenant_pipeline_stages st where st.pipeline_id = v_pipeline and not st.is_archived and st.name = r.target),
           true, r.note;
  end loop;

  -- The earlier starter rules for Lapsed and Chargeback also move from At risk now: a new version, untouched rules only.
  for s in
    select pr.id as rule_id, pr.current_version, v.event, v.carrier_ids, v.from_stage_ids, v.target_pipeline_id, v.target_stage_id, v.note_on, v.note_template,
           (select st.id from public.tenant_pipeline_stages st where st.pipeline_id = v_pipeline and not st.is_archived and st.name = 'At risk') as at_risk
      from public.pipeline_rule pr
      join public.pipeline_rule_version v on v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version
     where pr.tenant_id = p_tenant_id and pr.created_by is null
       and pr.name in ('Lapsed → Lapsed', 'Chargeback received → Charged back')
  loop
    continue when s.at_risk is null or s.at_risk = any(s.from_stage_ids);
    v_version := s.current_version + 1;
    insert into public.pipeline_rule_version (tenant_id, rule_id, version, event, carrier_ids, from_stage_ids, target_pipeline_id, target_stage_id, note_on, note_template)
    values (p_tenant_id, s.rule_id, v_version, s.event, s.carrier_ids, s.from_stage_ids || s.at_risk, s.target_pipeline_id, s.target_stage_id, s.note_on, s.note_template)
    on conflict (rule_id, version) do nothing;
    update public.pipeline_rule set current_version = v_version, updated_at = now() where tenant_id = p_tenant_id and id = s.rule_id and current_version = s.current_version;
  end loop;
end;
$$;

revoke all on function public.add_policy_status_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.add_policy_status_pipeline(uuid) to service_role;

-- ─── a new agency starts with it ───────────────────────────────────────────────────────────────────────
create or replace function public.seed_default_pipelines(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- [20261027300000] One all-in-one pipeline; partner pipelines are added from Settings when wanted.
  perform public.seed_general_pipeline(p_tenant_id);
  -- [20261104100000] Issued, In force, Lapsed and Charged back, and the starter pipeline rules in Forecast.
  perform public.add_after_sale_pipeline(p_tenant_id);
  -- [20261104130000] At risk, Paid up, Declined, Withdrawn, Not taken, and a starter rule per status.
  perform public.add_policy_status_pipeline(p_tenant_id);
  -- [20261022200000] Marketing and affiliate pipelines start with their own outcome stages (none yet
  -- for a new agency; kept so a re-run on an agency that has them still seeds them).
  perform public.seed_partner_pipeline_outcomes(p_tenant_id);
end;
$$;

revoke all on function public.seed_default_pipelines(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_pipelines(uuid) to service_role;

-- ─── every existing agency ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant record;
begin
  for v_tenant in select distinct p.tenant_id from public.tenant_pipelines p where p.partner_type is null and p.is_default loop
    perform public.add_policy_status_pipeline(v_tenant.tenant_id);
  end loop;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
  v_pipeline uuid;
begin
  if position('add_policy_status_pipeline(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0 then
    raise exception '20261104130000: seed_default_pipelines does not add the status stages';
  end if;
  -- Every agency with an all-in-one default pipeline has the five stages (by name, archived or not).
  select count(*) into v_n from public.tenant_pipelines p
   where p.partner_type is null and p.is_default
     and (select count(*) from public.tenant_pipeline_stages s
           where s.pipeline_id = p.id and s.name in ('At risk', 'Paid up', 'Declined', 'Withdrawn', 'Not taken')) < 5;
  if v_n > 0 then
    raise exception '20261104130000: % agencies are missing status stages', v_n;
  end if;
  -- No pipeline has two active stages in one position.
  select count(*) into v_n from (
    select s.pipeline_id, s.position from public.tenant_pipeline_stages s
      join public.tenant_pipelines p on p.id = s.pipeline_id and p.partner_type is null and p.is_default
     where not s.is_archived group by 1, 2 having count(*) > 1) d;
  if v_n > 0 then
    raise exception '20261104130000: % stage positions are taken twice', v_n;
  end if;
  -- Every rule points at a version that exists, and every version's event is allowed.
  select count(*) into v_n from public.pipeline_rule pr
   where not exists (select 1 from public.pipeline_rule_version v where v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version);
  if v_n > 0 then
    raise exception '20261104130000: % rules point at a version that does not exist', v_n;
  end if;
  -- Ellery & Fields: the eight starter rules, in Forecast; a second run adds nothing.
  select id into v_pipeline from public.tenant_pipelines where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and partner_type is null and is_default;
  perform public.add_policy_status_pipeline('d6f3950f-0d88-4e66-869f-0de2ea6b396b');
  select count(*) into v_n from public.pipeline_rule where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and mode = 'forecast'
     and name in ('Submitted (carrier file) → Submitted', 'In force → In force', 'Paid again → In force', 'At risk → At risk', 'Paid up → Paid up', 'Declined → Declined', 'Withdrawn → Withdrawn', 'Not taken → Not taken');
  if v_n <> 8 then
    raise exception '20261104130000: Ellery & Fields has % of the eight status rules in Forecast', v_n;
  end if;
  select count(*) into v_n from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived;
  raise notice '20261104130000: Ellery & Fields'' Sales pipeline has % active stages', v_n;
end $$;

commit;
