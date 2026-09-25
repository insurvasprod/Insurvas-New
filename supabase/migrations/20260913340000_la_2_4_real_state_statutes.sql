-- ---------------------------------------------------------------------------
-- LA-2.4 corrective · the 52 seeded "state rules" were 52 copies of the federal default
--
-- `calling_window_state_rules` holds 52 rows, which reads like the statutes are covered. Every one
-- of them is:
--
--   start_local 08:00  end_local 21:00  allowed_weekdays {0,1,2,3,4,5,6}  source platform_federal_default
--
-- That is the federal rule wearing a state code. Florida's 20:00 cutoff and its Sunday ban,
-- Oklahoma's, Louisiana's — none of them are in the table. A state with a tighter statute was NOT
-- being enforced over the federal default, which is LA-2.4's criterion 2, and the row count made it
-- look otherwise.
--
-- Caught by asserting a known statute rather than counting rows: a Sunday 11:00 call to a Florida
-- lead came back `allowed = true`. A check that only counted 52 rows would have passed.
--
-- These are the states whose restrictions are most commonly cited, with the statute named in
-- `source` so each one can be checked. **This is a starting set, not a legal opinion** — the table
-- exists so it can be maintained platform-side without a deploy, and it should be reviewed by
-- somebody qualified before it is relied on. What it definitely is, is closer to right than
-- fifty-two copies of the federal default.
-- ---------------------------------------------------------------------------

-- 8pm cutoff, and no Sunday solicitation.
update public.calling_window_state_rules
   set end_local = time '20:00',
       allowed_weekdays = array[1,2,3,4,5,6]::smallint[],
       source = 'Fla. Stat. 501.616(6) — 8pm cutoff, no Sunday solicitation (unreviewed)'
 where state_code = 'FL';

update public.calling_window_state_rules
   set end_local = time '20:00',
       allowed_weekdays = array[1,2,3,4,5,6]::smallint[],
       source = 'Okla. Stat. tit. 15 §775B.3 — 8pm cutoff, no Sunday (unreviewed)'
 where state_code = 'OK';

update public.calling_window_state_rules
   set end_local = time '20:00',
       allowed_weekdays = array[1,2,3,4,5,6]::smallint[],
       source = 'La. R.S. 45:844.13 — 8pm cutoff, no Sunday (unreviewed)'
 where state_code = 'LA';

-- 8pm cutoff only.
update public.calling_window_state_rules
   set end_local = time '20:00',
       source = 'Ala. Code §8-19A-14 — 8pm cutoff (unreviewed)'
 where state_code = 'AL';

update public.calling_window_state_rules
   set end_local = time '20:00',
       source = 'Miss. Code §77-3-703 — 8pm cutoff (unreviewed)'
 where state_code = 'MS';

update public.calling_window_state_rules
   set end_local = time '20:00',
       source = 'Wyo. Stat. §40-12-303 — 8pm cutoff (unreviewed)'
 where state_code = 'WY';

-- Holiday restrictions. block_holidays is already true on every row, so these only record why.
update public.calling_window_state_rules
   set source = 'Ind. Code §24-4.7 — no calls on state holidays (unreviewed)'
 where state_code = 'IN';

update public.calling_window_state_rules
   set source = 'N.J.A.C. 13:45D — no calls on state holidays (unreviewed)'
 where state_code = 'NJ';

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_count integer;
  v_sunday timestamptz;
  v_monday_late timestamptz;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the statute assertions were skipped';
    return;
  end if;

  -- The instants are COMPUTED, not written down.
  --
  -- The first version of these assertions used dates in June 2026 and failed, reporting that
  -- Florida was still dialable on a Sunday. The rules carry effective_from = 2026-09-08, so in
  -- June no state rule is in force at all and the federal default correctly applies. The code was
  -- right and the test was wrong — which is exactly what `effective_to` and `effective_from` exist
  -- to express, so the fix is to ask for a date the statute is actually in force on.
  --
  -- Next Sunday at 11:00 Eastern, and the Monday after at 20:30 Eastern.
  v_sunday := (date_trunc('week', current_date + interval '7 days') + interval '6 days' + interval '11 hours')
                at time zone 'America/New_York';
  v_monday_late := (date_trunc('week', current_date + interval '14 days') + interval '20 hours 30 minutes')
                     at time zone 'America/New_York';

  if extract(dow from (v_sunday at time zone 'America/New_York')) <> 0 then
    raise exception 'the computed Sunday is not a Sunday (%), so the assertion would prove nothing',
      v_sunday at time zone 'America/New_York';
  end if;

  -- Criterion 2: a tighter state statute beats the federal default.
  if public.tenant_can_dial_now(v_tenant, 'FL', null, v_sunday) then
    raise exception 'a Florida lead is dialable at 11:00 on a Sunday (%)', v_sunday;
  end if;

  -- And the restriction is specific rather than a blanket ban that costs every state its Sundays.
  if not public.tenant_can_dial_now(v_tenant, 'NY', null, v_sunday) then
    raise exception 'a New York lead lost its Sunday, which no statute requires';
  end if;

  -- Florida's 20:00 cutoff, on a Monday so the Sunday rule is not what is being measured.
  if public.tenant_can_dial_now(v_tenant, 'FL', null, v_monday_late) then
    raise exception 'a Florida lead is dialable at 20:30, past the 20:00 statutory cutoff';
  end if;
  if not public.tenant_can_dial_now(v_tenant, 'NY', null, v_monday_late) then
    raise exception 'a New York lead lost an hour it is federally entitled to';
  end if;

  -- Nothing was widened past the federal floor.
  select count(*) into v_count from public.calling_window_rules_in_force()
   where start_hour < 8 or end_hour > 21;
  if v_count > 0 then
    raise exception '% state rule(s) are now wider than the federal window', v_count;
  end if;

  -- And the set is no longer uniformly the federal default, which is the whole finding.
  select count(*) into v_count from (
    select distinct start_hour, end_hour, no_sunday from public.calling_window_rules_in_force()
  ) shapes;
  if v_count < 2 then
    raise exception 'every state still has an identical rule; the statutes did not land';
  end if;

  raise notice 'state statutes in force: % distinct rule shapes across 52 states', v_count;
end $$;
