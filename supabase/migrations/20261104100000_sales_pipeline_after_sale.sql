-- Book of business · the Sales pipeline after the sale (owner, 2026-11-04).
--
-- After a carrier file links a policy to its lead, nothing moved the lead's card and there was nowhere to move
-- it: the Sales pipeline ended at Submitted (Issued for agencies made since 20261103110000), and an agency
-- starts with no pipeline rules. This adds, to an agency's all-in-one Sales pipeline:
--
--   Stages     Issued (won) and In force (won) right after Submitted / Issued; Lapsed (lost) and
--              Charged back (lost) at the end. A stage the pipeline already has, by name, is kept as it is.
--   Map        "issued" → Issued, for a pipeline whose application stage map (LA-3.23) is saved by hand and
--              has no issued row. A pipeline with no saved map already follows Issued by its name.
--   Rules      five starter pipeline rules (LA-4, lib/pipelineRules/), all in Forecast (owner 2026-11-02:
--              each rule goes live on its own switch), each moving a card forward only:
--                Issued               → Issued        from Submitted
--                Advance received     → In force      from Submitted, Issued
--                Commission credited  → In force      from Submitted, Issued
--                Lapsed               → Lapsed        from Issued, In force
--                Chargeback received  → Charged back  from Issued, In force, Lapsed
--              A rule the agency already has by the same name is left alone.
--
-- public.add_after_sale_pipeline(tenant) does all three, once, and is safe to run again. New agencies get it
-- from seed_default_pipelines. Existing agencies are NOT changed here, except Ellery & Fields, the demo agency;
-- 20261104110000 gives every other agency the same (owner 2026-11-04: "All agencies"). Applied 2026-11-04.
--
-- Rollback: restore seed_default_pipelines from 20261027300000 (section 2), then
--   drop function public.add_after_sale_pipeline(uuid);
-- and, per agency, delete the five rules by name and archive the four stages if wanted.

begin;

-- seed_default_pipelines must still be 20261027300000's body before it is restated.
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%perform public.seed_general_pipeline(p_tenant_id);%'
     or v_def not like '%perform public.seed_partner_pipeline_outcomes(p_tenant_id);%'
     or v_def like '%add_after_sale_pipeline%' then
    raise exception '20261104100000: seed_default_pipelines is not the 20261027300000 body; re-read it before restating';
  end if;
end $$;

-- ─── 1. the stages, the map row and the starter rules, for one agency ──────────────────────────────────
create or replace function public.add_after_sale_pipeline(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
  v_anchor integer;
  v_need text[] := '{}';
  v_name text;
  v_k integer;
  v_last integer;
  v_submitted uuid;
  v_issued uuid;
  v_in_force uuid;
  v_lapsed uuid;
  v_charged_back uuid;
  v_rule uuid;
  r record;
begin
  select id into v_pipeline from public.tenant_pipelines
   where tenant_id = p_tenant_id and partner_type is null and is_default;
  if v_pipeline is null then return; end if;

  -- Issued and In force go right after the furthest of Submitted / Issued; the stages after it move down.
  select max(position) into v_anchor from public.tenant_pipeline_stages
   where pipeline_id = v_pipeline and not is_archived and name in ('Submitted', 'Issued');
  foreach v_name in array array['Issued', 'In force'] loop
    if not exists (select 1 from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = v_name) then
      v_need := v_need || v_name;
    end if;
  end loop;
  if v_anchor is not null and array_length(v_need, 1) > 0 then
    -- Two steps: the active-position index is unique, so stages pass through a free range first.
    update public.tenant_pipeline_stages set position = position + 1000000, updated_at = now()
     where pipeline_id = v_pipeline and not is_archived and position > v_anchor;
    update public.tenant_pipeline_stages set position = position - 1000000 + array_length(v_need, 1), updated_at = now()
     where pipeline_id = v_pipeline and not is_archived and position > 1000000;
    v_k := 0;
    foreach v_name in array v_need loop
      v_k := v_k + 1;
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
      values (v_pipeline, v_name, v_anchor + v_k, 'won', '#0a8769')
      on conflict (pipeline_id, name) do nothing;
    end loop;
  elsif array_length(v_need, 1) > 0 then
    -- No Submitted or Issued to follow (renamed or removed): append.
    foreach v_name in array v_need loop
      select coalesce(max(position), -1) into v_last from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived;
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
      values (v_pipeline, v_name, v_last + 1, 'won', '#0a8769')
      on conflict (pipeline_id, name) do nothing;
    end loop;
  end if;

  -- Lapsed and Charged back close the sale: at the end, with the other lost stages.
  foreach v_name in array array['Lapsed', 'Charged back'] loop
    if not exists (select 1 from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = v_name) then
      select coalesce(max(position), -1) into v_last from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived;
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
      values (v_pipeline, v_name, v_last + 1, 'lost', case v_name when 'Lapsed' then '#e04e00' else '#c62828' end)
      on conflict (pipeline_id, name) do nothing;
    end if;
  end loop;

  select id into v_submitted    from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = 'Submitted'    and not is_archived;
  select id into v_issued       from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = 'Issued'       and not is_archived;
  select id into v_in_force     from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = 'In force'     and not is_archived;
  select id into v_lapsed       from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = 'Lapsed'       and not is_archived;
  select id into v_charged_back from public.tenant_pipeline_stages where pipeline_id = v_pipeline and name = 'Charged back' and not is_archived;

  -- A hand-saved application stage map (LA-3.23) with no issued row: the card follows an issued application.
  if v_issued is not null
     and exists (select 1 from public.tenant_application_stage_map m where m.tenant_id = p_tenant_id and m.pipeline_id = v_pipeline)
     and not exists (select 1 from public.tenant_application_stage_map m where m.tenant_id = p_tenant_id and m.pipeline_id = v_pipeline and m.sync_key = 'issued') then
    insert into public.tenant_application_stage_map (tenant_id, pipeline_id, sync_key, stage_id)
    values (p_tenant_id, v_pipeline, 'issued', v_issued)
    on conflict do nothing;
  end if;

  -- The starter rules, in Forecast. from_stage_ids leave out any stage the pipeline does not have.
  for r in
    select * from (values
      ('Issued → Issued',                   'issued',              v_issued,       array[v_submitted],                       'Issued by {carrier}, policy {policy_number}.'),
      ('Advance received → In force',       'advance_received',    v_in_force,     array[v_submitted, v_issued],             'Advance of {amount} received from {carrier} on policy {policy_number}.'),
      ('Commission credited → In force',    'commission_credited', v_in_force,     array[v_submitted, v_issued],             'Commission of {amount} credited by {carrier} on policy {policy_number}.'),
      ('Lapsed → Lapsed',                   'lapsed',              v_lapsed,       array[v_issued, v_in_force],              'Lapsed at {carrier}, policy {policy_number}, paid to {paid_to_date}.'),
      ('Chargeback received → Charged back','chargeback_received', v_charged_back, array[v_issued, v_in_force, v_lapsed],    'Chargeback of {amount} from {carrier} on policy {policy_number}.')
    ) as t(name, event, target, from_ids, note)
  loop
    continue when r.target is null;
    continue when exists (select 1 from public.pipeline_rule pr where pr.tenant_id = p_tenant_id and pr.name = r.name);
    insert into public.pipeline_rule (tenant_id, name, mode, enabled, current_version, forecast_since)
    values (p_tenant_id, r.name, 'forecast', true, 1, now())
    returning id into v_rule;
    insert into public.pipeline_rule_version (tenant_id, rule_id, version, event, carrier_ids, from_stage_ids, target_pipeline_id, target_stage_id, note_on, note_template)
    values (p_tenant_id, v_rule, 1, r.event, '{}', array_remove(r.from_ids, null), v_pipeline, r.target, true, r.note);
  end loop;
end;
$$;

revoke all on function public.add_after_sale_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.add_after_sale_pipeline(uuid) to service_role;

-- ─── 2. a new agency starts with it ────────────────────────────────────────────────────────────────────
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
  -- [20261022200000] Marketing and affiliate pipelines start with their own outcome stages (none yet
  -- for a new agency; kept so a re-run on an agency that has them still seeds them).
  perform public.seed_partner_pipeline_outcomes(p_tenant_id);
end;
$$;

revoke all on function public.seed_default_pipelines(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_pipelines(uuid) to service_role;

-- ─── 3. the demo agency (owner 2026-11-04) ─────────────────────────────────────────────────────────────
select public.add_after_sale_pipeline('d6f3950f-0d88-4e66-869f-0de2ea6b396b');

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_pipeline uuid;
  v_n integer;
begin
  if position('add_after_sale_pipeline(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0 then
    raise exception '20261104100000: seed_default_pipelines does not add the after-sale stages';
  end if;
  select id into v_pipeline from public.tenant_pipelines
   where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and partner_type is null and is_default;
  select count(*) into v_n from public.tenant_pipeline_stages
   where pipeline_id = v_pipeline and not is_archived and name in ('Issued', 'In force', 'Lapsed', 'Charged back');
  if v_n <> 4 then
    raise exception '20261104100000: Ellery & Fields has % of the four after-sale stages', v_n;
  end if;
  select count(*) into v_n from public.pipeline_rule
   where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and mode = 'forecast'
     and name in ('Issued → Issued', 'Advance received → In force', 'Commission credited → In force', 'Lapsed → Lapsed', 'Chargeback received → Charged back');
  if v_n <> 5 then
    raise exception '20261104100000: Ellery & Fields has % of the five starter rules in Forecast', v_n;
  end if;
  -- Running it again changes nothing.
  perform public.add_after_sale_pipeline('d6f3950f-0d88-4e66-869f-0de2ea6b396b');
  select count(*) into v_n from public.pipeline_rule where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and name like '% → %';
  if v_n <> 5 then
    raise exception '20261104100000: a second run added rules (% now)', v_n;
  end if;
end $$;

commit;
