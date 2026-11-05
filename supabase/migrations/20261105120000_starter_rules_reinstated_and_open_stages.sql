-- Book of business · pipeline rules: the starter rules move a card from every open stage, from the sold stages of the
-- other pipelines, and (In force, Paid again) from Lapsed (owner 2026-11-05).
--
-- Why, from the status test and audit (docs/la4/E2E-2026-11-02.md, 2026-11-05):
--   * "Yes, move it back": a reinstated policy stayed on Lapsed. In force and Paid again now move from Lapsed.
--   * A card on a Marketing leads open stage (Eve Paidupadv, paid up) was never moved: no starter rule moved from it.
--   * A stage a person adds (the test's "Needs requirements") was not a from-stage of any rule, so Declined, Not taken
--     and the rest skipped a card waiting there. From now on the app adds a new stage to the starter rules when it is
--     created (lib/pipelineRules/store.ts addStageToStarterRules); this migration does it for the stages that exist.
--
-- So each starter rule (pipeline_rule.created_by is null; an owner's own rule is theirs) gets a new version (versions
-- are never edited) whose from-stages add: every open stage of every one of the agency's pipelines, the won stages of
-- its other pipelines, and Lapsed for In force / Paid again. Never the rule's own target. A rule already covering all
-- of them is left alone, so a second run adds nothing. The rule's mode is kept: a Live rule acts from the new version
-- on (nothing earlier is replayed).
--
-- Rollback: per agency, save the previous version's from-stages as a new version (Setup › Pipeline rules), or point
-- pipeline_rule.current_version back at it; drop public.widen_starter_rules(uuid); restore seed_default_pipelines
-- from 20261105100000.

begin;

-- seed_default_pipelines must still be 20261105100000's body before it is restated.
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%perform public.add_missed_payment_rules(p_tenant_id);%' or v_def like '%widen_starter_rules%' then
    raise exception '20261105120000: seed_default_pipelines is not the 20261105100000 body; re-read it before restating';
  end if;
end $$;

-- ─── one agency ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.widen_starter_rules(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
  v_lapsed uuid;
  v_common uuid[];
  v_want uuid[];
  v_version integer;
  s record;
begin
  select id into v_pipeline from public.tenant_pipelines where tenant_id = p_tenant_id and partner_type is null and is_default;
  if v_pipeline is null then return; end if;
  select id into v_lapsed from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived and name = 'Lapsed';
  -- Every open stage of every pipeline, and the won stages of the other pipelines.
  select coalesce(array_agg(st.id order by st.id), '{}') into v_common
    from public.tenant_pipeline_stages st join public.tenant_pipelines p on p.id = st.pipeline_id
   where p.tenant_id = p_tenant_id and not st.is_archived
     and (st.stage_type = 'open' or (p.id <> v_pipeline and st.stage_type = 'won'));
  for s in
    select pr.id as rule_id, pr.name, pr.current_version, v.event, v.carrier_ids, v.from_stage_ids, v.target_pipeline_id, v.target_stage_id, v.note_on, v.note_template
      from public.pipeline_rule pr
      join public.pipeline_rule_version v on v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version
     where pr.tenant_id = p_tenant_id and pr.created_by is null
  loop
    v_want := v_common || (case when s.name in ('In force → In force', 'Paid again → In force') and v_lapsed is not null then array[v_lapsed] else '{}'::uuid[] end);
    v_want := array(select x from unnest(v_want) x where x <> s.target_stage_id and not x = any(s.from_stage_ids));
    continue when cardinality(v_want) = 0;
    v_version := s.current_version + 1;
    insert into public.pipeline_rule_version (tenant_id, rule_id, version, event, carrier_ids, from_stage_ids, target_pipeline_id, target_stage_id, note_on, note_template)
    values (p_tenant_id, s.rule_id, v_version, s.event, s.carrier_ids, s.from_stage_ids || v_want, s.target_pipeline_id, s.target_stage_id, s.note_on, s.note_template)
    on conflict (rule_id, version) do nothing;
    update public.pipeline_rule set current_version = v_version, updated_at = now()
     where tenant_id = p_tenant_id and id = s.rule_id and current_version = s.current_version;
  end loop;
end;
$$;

revoke all on function public.widen_starter_rules(uuid) from public, anon, authenticated;
grant execute on function public.widen_starter_rules(uuid) to service_role;

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
  -- [20261105100000] First and later payment missed → At risk.
  perform public.add_missed_payment_rules(p_tenant_id);
  -- [20261022200000] Marketing and affiliate pipelines start with their own outcome stages (none yet
  -- for a new agency; kept so a re-run on an agency that has them still seeds them).
  perform public.seed_partner_pipeline_outcomes(p_tenant_id);
  -- [20261105120000] The starter rules move from every open stage, other pipelines' sold stages, and Lapsed.
  perform public.widen_starter_rules(p_tenant_id);
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
    perform public.widen_starter_rules(v_tenant.tenant_id);
  end loop;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  if position('widen_starter_rules(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0 then
    raise exception '20261105120000: seed_default_pipelines does not widen the starter rules';
  end if;
  -- Every starter In force / Paid again rule moves from its agency's Sales › Lapsed.
  select count(*) into v_n
    from public.pipeline_rule pr
    join public.pipeline_rule_version v on v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version
    join public.tenant_pipelines p on p.tenant_id = pr.tenant_id and p.partner_type is null and p.is_default
    join public.tenant_pipeline_stages st on st.pipeline_id = p.id and not st.is_archived and st.name = 'Lapsed'
   where pr.created_by is null and pr.name in ('In force → In force', 'Paid again → In force')
     and not st.id = any(v.from_stage_ids);
  if v_n > 0 then
    raise exception '20261105120000: % starter rules still do not move from Lapsed', v_n;
  end if;
  -- Every starter rule moves from every open stage of its agency (except its own target).
  select count(*) into v_n
    from public.pipeline_rule pr
    join public.pipeline_rule_version v on v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version
    join public.tenant_pipelines p on p.tenant_id = pr.tenant_id
    join public.tenant_pipeline_stages st on st.pipeline_id = p.id and not st.is_archived and st.stage_type = 'open'
   where pr.created_by is null and st.id <> v.target_stage_id and not st.id = any(v.from_stage_ids);
  if v_n > 0 then
    raise exception '20261105120000: % open stages are missing from starter rules', v_n;
  end if;
  -- Every rule points at a version that exists.
  select count(*) into v_n from public.pipeline_rule pr
   where not exists (select 1 from public.pipeline_rule_version v where v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version);
  if v_n > 0 then
    raise exception '20261105120000: % rules point at a version that does not exist', v_n;
  end if;
end $$;

commit;
