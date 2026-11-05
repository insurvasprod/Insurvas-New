-- Book of business · carrier status words and the missed-payment rules, checked against the real carrier files
-- (owner 2026-11-05; Downloads\Safe_Harbour_Edited_Files - corrected, 15 files, 8 carriers, read 2026-11-05).
--
-- Every status word in those files already has an approved mapping. Five map to the wrong normalized status
-- against the owner's carrier-rules spec (pasted 2026-11-04) and LA-4.5's vocabulary:
--
--   American Amicable  Act-Pastdue                            active    → at_risk     (in force, behind on payment)
--   American Amicable  InfNotTaken                            lapsed    → not_taken   (issued, never paid)
--   Sentinel           Cancelled [NP] Non Payment of Premium  not_taken → lapsed      (cancelled for non-payment)
--   Corebridge         Lapse Pending                          active    → at_risk
--   Corebridge         Conservation Pending                   active    → at_risk
--
-- The carrier's own word is kept on every snapshot (carrier_status_raw), so nothing is lost: the next file that
-- carries one of these words writes the corrected status, and its change moves the card. Earlier snapshots are
-- left as they were read (history stays honest).
--
-- Missed payments: Aetna, Aflac and AHL (and MoO) show a policy behind on payment as Active, so only the paid-to
-- date says it is at risk. The events first_payment_missed and later_payment_missed already exist (they need the
-- carrier's grace, set in Setup › Carrier rules, never a default). Two starter rules, in Forecast, move such a
-- card to At risk; each agency gets them, new agencies through seed_default_pipelines.
--
-- Rollback: put the five words back (the old values are in the comments above), with carrier_status_map_guard
-- disabled around that update exactly as section 1 does; drop
-- public.add_missed_payment_rules(uuid); restore seed_default_pipelines from 20261104130000; per agency, delete
-- the two rules by name.

begin;

-- ─── 1. the five status words ──────────────────────────────────────────────────────────────────────────
-- An approved mapping never changes (carrier_status_map_guard, LA-4.5), and the app has no way to correct one.
-- These five were approved wrong, so the guard is switched off for this one update and on again in the same
-- transaction: no other connection ever sees it off (the catalog change is only visible after commit), and the
-- check block below fails the whole paste if it is not back on. Each row's notes keep the status it was read with.
alter table public.carrier_status_map disable trigger carrier_status_map_guard;

do $$
declare
  v_n integer;
  v_total integer := 0;
begin
  with fixes(carrier, raw, from_status, to_status) as (values
    ('American Amicable',      'Act-Pastdue',                           'active',    'at_risk'),
    ('American Amicable',      'InfNotTaken',                           'lapsed',    'not_taken'),
    ('Sentinel Security Life', 'Cancelled [NP] Non Payment of Premium', 'not_taken', 'lapsed'),
    ('Corebridge Financial',   'Lapse Pending',                         'active',    'at_risk'),
    ('Corebridge Financial',   'Conservation Pending',                  'active',    'at_risk')
  )
  update public.carrier_status_map m
     set status_normalized = f.to_status,
         notes = trim(both ' ' from coalesce(m.notes, '') || ' [20261105100000] was ' || f.from_status || '; corrected against the real files and the carrier-rules spec.'),
         mapped_at = now()
    from fixes f
    join public.carriers c on c.name = f.carrier
   where m.carrier_id = c.id and m.file_type = 'policies' and m.carrier_status_raw = f.raw and m.status_normalized = f.from_status;
  get diagnostics v_n = row_count;
  raise notice '20261105100000: % status words corrected', v_n;
end $$;

alter table public.carrier_status_map enable trigger carrier_status_map_guard;

-- seed_default_pipelines must still be 20261104130000's body before it is restated.
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%perform public.add_policy_status_pipeline(p_tenant_id);%' or v_def like '%add_missed_payment_rules%' then
    raise exception '20261105100000: seed_default_pipelines is not the 20261104130000 body; re-read it before restating';
  end if;
end $$;

-- ─── 2. the missed-payment rules, for one agency ───────────────────────────────────────────────────────
create or replace function public.add_missed_payment_rules(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
  v_target uuid;
  v_other uuid[];
  v_rule uuid;
  r record;
begin
  select id into v_pipeline from public.tenant_pipelines where tenant_id = p_tenant_id and partner_type is null and is_default;
  if v_pipeline is null then return; end if;
  select id into v_target from public.tenant_pipeline_stages where pipeline_id = v_pipeline and not is_archived and name = 'At risk';
  if v_target is null then return; end if;
  -- Sold stages on the agency's other pipelines count as from-stages too (as 20261104120000).
  select coalesce(array_agg(st.id order by st.id), '{}') into v_other
    from public.tenant_pipeline_stages st join public.tenant_pipelines p on p.id = st.pipeline_id
   where p.tenant_id = p_tenant_id and p.id <> v_pipeline and not st.is_archived and (st.stage_type = 'won' or st.name = 'Issued');
  for r in
    select * from (values
      ('First payment missed → At risk', 'first_payment_missed', array['Issued'],             'First premium missed at {carrier}, policy {policy_number}: {days_past_due} days late, {days_left} days left.'),
      ('Later payment missed → At risk', 'later_payment_missed', array['Issued', 'In force'], 'Payment missed at {carrier}, policy {policy_number}: paid to {paid_to_date}, {days_left} days left.')
    ) as t(name, event, from_names, note)
  loop
    continue when exists (select 1 from public.pipeline_rule pr where pr.tenant_id = p_tenant_id and pr.name = r.name);
    insert into public.pipeline_rule (tenant_id, name, mode, enabled, current_version, forecast_since)
    values (p_tenant_id, r.name, 'forecast', true, 1, now())
    returning id into v_rule;
    insert into public.pipeline_rule_version (tenant_id, rule_id, version, event, carrier_ids, from_stage_ids, target_pipeline_id, target_stage_id, note_on, note_template)
    select p_tenant_id, v_rule, 1, r.event, '{}',
           (select coalesce(array_agg(distinct x), '{}') from unnest(
              (select coalesce(array_agg(st.id), '{}') from public.tenant_pipeline_stages st where st.pipeline_id = v_pipeline and not st.is_archived and st.name = any(r.from_names)) || v_other) x),
           v_pipeline, v_target, true, r.note;
  end loop;
end;
$$;

revoke all on function public.add_missed_payment_rules(uuid) from public, anon, authenticated;
grant execute on function public.add_missed_payment_rules(uuid) to service_role;

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
end;
$$;

revoke all on function public.seed_default_pipelines(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_pipelines(uuid) to service_role;

do $$
declare
  v_tenant record;
begin
  for v_tenant in select distinct p.tenant_id from public.tenant_pipelines p where p.partner_type is null and p.is_default loop
    perform public.add_missed_payment_rules(v_tenant.tenant_id);
  end loop;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.carrier_status_map m join public.carriers c on c.id = m.carrier_id
   where m.file_type = 'policies' and (
     (c.name = 'American Amicable' and m.carrier_status_raw in ('Act-Pastdue') and m.status_normalized <> 'at_risk') or
     (c.name = 'American Amicable' and m.carrier_status_raw in ('InfNotTaken') and m.status_normalized <> 'not_taken') or
     (c.name = 'Sentinel Security Life' and m.carrier_status_raw = 'Cancelled [NP] Non Payment of Premium' and m.status_normalized <> 'lapsed') or
     (c.name = 'Corebridge Financial' and m.carrier_status_raw in ('Lapse Pending', 'Conservation Pending') and m.status_normalized <> 'at_risk'));
  if v_n > 0 then
    raise exception '20261105100000: % status words still map the old way', v_n;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.carrier_status_map'::regclass
                  and tgname = 'carrier_status_map_guard' and tgenabled = 'O') then
    raise exception '20261105100000: the approved-mapping guard is not back on';
  end if;
  if position('add_missed_payment_rules(p_tenant_id)' in pg_get_functiondef('public.seed_default_pipelines(uuid)'::regprocedure)) = 0 then
    raise exception '20261105100000: seed_default_pipelines does not add the missed-payment rules';
  end if;
  perform public.add_missed_payment_rules('d6f3950f-0d88-4e66-869f-0de2ea6b396b');
  select count(*) into v_n from public.pipeline_rule where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and name in ('First payment missed → At risk', 'Later payment missed → At risk');
  if v_n <> 2 then
    raise exception '20261105100000: Ellery & Fields has % of the two missed-payment rules', v_n;
  end if;
end $$;

commit;
