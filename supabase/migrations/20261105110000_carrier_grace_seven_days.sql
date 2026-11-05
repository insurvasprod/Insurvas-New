-- Book of business · Setup › Carrier rules: a 7-day payment grace for every carrier (owner 2026-11-05: "Yes, 7 days").
--
-- The carrier-rules spec left the grace buffer open (3 or 7 days). 7 fits the measured delay before a carrier's
-- paid-to date moves after a draft clears, so it raises fewer false alarms. Until now no carrier had a grace, so
-- the missed-payment events (first_payment_missed, later_payment_missed) never fired and the At risk rules
-- (20261105100000) could not move a card.
--
-- Platform rules are dated rows: the newest one on or before a day wins, and an agency's own row beats it from its
-- date (Setup › Carrier rules). So this adds a row per carrier and payment kind from 2026-11-05, keeping the window
-- the carrier already had:
--   first payment:    grace 7; window 8 for Americo (its seeded "about eight days"), else not set
--   ongoing payment:  grace 7; window 45 for Aetna, Aflac and AHL (the measured 45-day lapse clock), else not set
-- Unverified (source "observed", like the seeded rows): a person verifies each on the carrier's page.
-- The test carrier "LA14 Market …" is left out. Safe to run again.
--
-- Rollback: delete from public.carrier_retention_rule where tenant_id is null and effective_from = '2026-11-05'
--           and notes like '[20261105110000]%';

begin;

insert into public.carrier_retention_rule (tenant_id, carrier_id, rule_type, window_days, grace_days, source, effective_from, notes)
select null, c.id, k.rule_type,
       case
         when k.rule_type = 'first_payment' and c.code = 'americo' then 8
         when k.rule_type = 'ongoing_payment' and c.code in ('aetna', 'aflac', 'american_home_life') then 45
       end,
       7, 'observed', date '2026-11-05',
       '[20261105110000] Owner decision 2026-11-05: 7-day grace for every carrier (the spec''s open buffer, 3 or 7). Unverified.'
  from public.carriers c
  cross join (values ('first_payment'), ('ongoing_payment')) as k(rule_type)
 where c.status = 'active' and c.code not like 'la14%'
   and not exists (select 1 from public.carrier_retention_rule r
                    where r.tenant_id is null and r.carrier_id = c.id and r.rule_type = k.rule_type
                      and r.effective_from = date '2026-11-05' and r.notes like '[20261105110000]%');

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  -- Every active real carrier now has a platform grace of 7 for both payment kinds, on or before today.
  select count(*) into v_n
    from public.carriers c cross join (values ('first_payment'), ('ongoing_payment')) as k(rule_type)
   where c.status = 'active' and c.code not like 'la14%'
     and coalesce((select r.grace_days from public.carrier_retention_rule r
                    where r.tenant_id is null and r.carrier_id = c.id and r.rule_type = k.rule_type and r.effective_from <= current_date and not r.cleared
                    order by r.effective_from desc, r.created_at desc limit 1), -1) <> 7;
  if v_n > 0 then
    raise exception '20261105110000: % carrier rules do not read a 7-day grace', v_n;
  end if;
  -- The windows the carriers already had are kept.
  if (select window_days from public.carrier_retention_rule r join public.carriers c on c.id = r.carrier_id
       where r.tenant_id is null and c.code = 'aetna' and r.rule_type = 'ongoing_payment' order by r.effective_from desc, r.created_at desc limit 1) is distinct from 45 then
    raise exception '20261105110000: Aetna lost its 45-day window';
  end if;
end $$;

commit;
