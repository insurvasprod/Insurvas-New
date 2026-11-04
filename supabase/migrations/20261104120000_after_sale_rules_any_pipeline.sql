-- Book of business · the starter after-sale rules also pick up sold cards on other pipelines (owner 2026-11-04).
--
-- 20261104100000's five starter rules move a card only from Sales pipeline stages. A lead sold through a partner
-- or marketing pipeline (Marketing leads › Converted, Publisher transfers › Submitted or Issued, Affiliate
-- referrals › Submitted) stayed where it was when its policy was issued, lapsed or charged back. The owner wants
-- every sold card on the Sales pipeline's after-sale stages, whichever pipeline it came through.
--
-- So each starter rule still at its first version (the agency has not edited it) gets a second version whose
-- from-stages are its own plus every sold stage on the agency's other pipelines: a `won` stage, or one named
-- Issued. Versions are never changed (pipeline_rule_version_guard), so this adds version 2 and points the rule
-- at it; version 1 and what it recorded stay. A rule the agency edited is left alone. Safe to run again.
--
-- A pipeline added later is not in these lists; its sold stages can be added on the rule's page.
--
-- Rollback, per rule: update pipeline_rule set current_version = 1 where the rule is one of the five.

begin;

create or replace function public.widen_after_sale_rules(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sales uuid;
  v_other uuid[];
  v_done integer := 0;
  r record;
begin
  select id into v_sales from public.tenant_pipelines
   where tenant_id = p_tenant_id and partner_type is null and is_default;
  if v_sales is null then return 0; end if;

  select coalesce(array_agg(s.id order by s.id), '{}') into v_other
    from public.tenant_pipeline_stages s
    join public.tenant_pipelines p on p.id = s.pipeline_id
   where p.tenant_id = p_tenant_id and p.id <> v_sales and not s.is_archived
     and (s.stage_type = 'won' or s.name = 'Issued');
  if array_length(v_other, 1) is null then return 0; end if;

  for r in
    select pr.id as rule_id, v.event, v.carrier_ids, v.from_stage_ids, v.target_pipeline_id, v.target_stage_id, v.note_on, v.note_template
      from public.pipeline_rule pr
      join public.pipeline_rule_version v on v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = 1
     where pr.tenant_id = p_tenant_id and pr.current_version = 1 and pr.created_by is null
       and pr.name in ('Issued → Issued', 'Advance received → In force', 'Commission credited → In force', 'Lapsed → Lapsed', 'Chargeback received → Charged back')
  loop
    insert into public.pipeline_rule_version (tenant_id, rule_id, version, event, carrier_ids, from_stage_ids, target_pipeline_id, target_stage_id, note_on, note_template)
    values (p_tenant_id, r.rule_id, 2, r.event, r.carrier_ids,
            (select coalesce(array_agg(distinct x), '{}') from unnest(r.from_stage_ids || v_other) x),
            r.target_pipeline_id, r.target_stage_id, r.note_on, r.note_template)
    on conflict (rule_id, version) do nothing;
    update public.pipeline_rule set current_version = 2, updated_at = now() where tenant_id = p_tenant_id and id = r.rule_id and current_version = 1;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.widen_after_sale_rules(uuid) from public, anon, authenticated;
grant execute on function public.widen_after_sale_rules(uuid) to service_role;

do $$
declare
  v_tenant record;
  v_rules integer := 0;
begin
  for v_tenant in select distinct tenant_id from public.pipeline_rule where created_by is null loop
    v_rules := v_rules + public.widen_after_sale_rules(v_tenant.tenant_id);
  end loop;
  raise notice '20261104120000: % starter rules widened', v_rules;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  -- Every rule points at a version that exists.
  select count(*) into v_n from public.pipeline_rule pr
   where not exists (select 1 from public.pipeline_rule_version v where v.tenant_id = pr.tenant_id and v.rule_id = pr.id and v.version = pr.current_version);
  if v_n > 0 then
    raise exception '20261104120000: % rules point at a version that does not exist', v_n;
  end if;
  -- Running it again widens nothing.
  if public.widen_after_sale_rules('d6f3950f-0d88-4e66-869f-0de2ea6b396b') <> 0 then
    raise exception '20261104120000: a second run widened Ellery & Fields again';
  end if;
end $$;

commit;
