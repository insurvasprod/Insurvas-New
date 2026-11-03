-- Put 'expired' back into lead_queue_status_check. This is a self-inflicted regression.
--
-- The status vocabulary has been declared five times, each declaration a full rebuild of the
-- constraint rather than an amendment, so whichever file sorts last wins outright:
--
--   20260903000000  LA-1.23  9 values, including 'expired'
--   20260903100000  LA-1.12  5 values
--   20260903120000  LA-1.14  8 values, no 'expired'
--   20260903170000  LA-1.23  9 values -- a corrective, written for exactly this reason
--   20260912430000  LA-1.12  8 values, no 'expired'   <- applies last, so 'expired' is gone
--
-- 20260903170000 exists solely to defend against this. Its opening comment reads: "later LA-1
-- migrations rebuild lead_queue_status_check, so preserve the new terminal status". Someone saw the
-- pattern, wrote the corrective, and said why.
--
-- 20260912430000 is mine, from porting LA-1.12 onto the renamed disposition tables earlier today. I
-- carried that task's constraint forward verbatim without checking what had been added to it since,
-- which dropped 'expired' and silently disarmed the expiry half of LA-1.23. The rule adopted in
-- 20260912440000 -- grep the migrations for the object and read every hit in order -- is the rule
-- that would have caught it, and it is the rule I did not apply to this constraint.
--
-- The cost was not theoretical. run_unclaimed_sla sets status = 'expired', so the whole expiry rung
-- failed with 23514 and verify-unclaimed-sla threw during setup. LA-1.23's third acceptance criterion
-- ("expiry only ever matches unclaimed rows") and fourth ("expired leads are readable and reopenable")
-- were both unreachable -- no row could reach the state they describe.
--
-- The value below is the union of all five declarations, which is also 20260903170000's list
-- unchanged. No status any LA-1 task has ever declared is dropped here.

alter table public.lead_queue drop constraint if exists lead_queue_status_check;
alter table public.lead_queue add constraint lead_queue_status_check
  check (status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired'));

do $$
declare
  rejected text;
begin
  -- Assert every value in the union is accepted, by name. Counting them would pass on the wrong nine.
  select string_agg(v, ', ') into rejected
  from unnest(array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active',
                    'completed', 'closed', 'dropped', 'expired']) as v
  where not (pg_get_constraintdef(
    (select oid from pg_constraint where conname = 'lead_queue_status_check'
       and conrelid = 'public.lead_queue'::regclass)
  ) like '%''' || v || '''%');
  if rejected is not null then
    raise exception 'lead_queue_status_check does not admit: %', rejected;
  end if;
end;
$$;
