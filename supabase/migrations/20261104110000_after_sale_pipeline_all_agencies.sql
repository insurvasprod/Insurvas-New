-- Book of business · the Sales pipeline after the sale, for every agency (owner 2026-11-04: "All agencies").
--
-- 20261104100000 added public.add_after_sale_pipeline(tenant) and gave it to new agencies and Ellery & Fields.
-- This runs it for every other agency with an all-in-one default pipeline. Per agency it adds only what is
-- missing: Issued and In force after Submitted / Issued (the closed stages after them move down to make room),
-- Lapsed and Charged back at the end, "issued → Issued" on a hand-saved application stage map with no issued
-- row, and the five starter pipeline rules in Forecast (nothing moves until each is switched live). Leads,
-- outcome routing and saved map rows are kept. Safe to run again.
--
-- Rollback, per agency: delete the five rules by name; archive the four stages if they hold no lead.

begin;

do $$
begin
  if to_regprocedure('public.add_after_sale_pipeline(uuid)') is null then
    raise exception '20261104110000: apply 20261104100000 first';
  end if;
end $$;

do $$
declare
  v_tenant record;
begin
  for v_tenant in
    select distinct p.tenant_id from public.tenant_pipelines p where p.partner_type is null and p.is_default
  loop
    perform public.add_after_sale_pipeline(v_tenant.tenant_id);
  end loop;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  -- Every agency with an all-in-one default pipeline has the four stages (by name, archived or not).
  select count(*) into v_n from public.tenant_pipelines p
   where p.partner_type is null and p.is_default
     and (select count(*) from public.tenant_pipeline_stages s
           where s.pipeline_id = p.id and s.name in ('Issued', 'In force', 'Lapsed', 'Charged back')) < 4;
  if v_n > 0 then
    raise exception '20261104110000: % agencies are missing after-sale stages', v_n;
  end if;
  -- No pipeline has two active stages in one position.
  select count(*) into v_n from (
    select s.pipeline_id, s.position from public.tenant_pipeline_stages s
      join public.tenant_pipelines p on p.id = s.pipeline_id and p.partner_type is null and p.is_default
     where not s.is_archived group by 1, 2 having count(*) > 1) d;
  if v_n > 0 then
    raise exception '20261104110000: % stage positions are taken twice', v_n;
  end if;
  -- The five starter rules: an agency that archived one of the target stages gets no rule for it, by design,
  -- so this only reports.
  select count(*) into v_n from public.tenant_pipelines p
   where p.partner_type is null and p.is_default
     and (select count(*) from public.pipeline_rule r where r.tenant_id = p.tenant_id
           and r.name in ('Issued → Issued', 'Advance received → In force', 'Commission credited → In force', 'Lapsed → Lapsed', 'Chargeback received → Charged back')) < 5;
  raise notice '20261104110000: % agencies have fewer than five starter rules (a target stage is archived)', v_n;
end $$;

commit;
