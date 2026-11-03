-- ---------------------------------------------------------------------------
-- Pool leads stuck in `working` are returned to the cadence.
--
-- 20260913401000 made serve_next_lead's reclaim restore the LEAD as well as the work item: a lead
-- whose lock lapsed went back to `fresh` (never dialled) or `retry` (due now). 20260917144000
-- restated serve_next_lead and dropped that restore, so for a week every abandoned lock put the
-- work item back in the pool with its lead still `working` — a state no serving tier matches. The
-- item is visible, unclaimed, and never served again. 20260924323000 put the restore back; this
-- repairs the leads the gap left behind.
--
-- Measured before writing (2026-09-24, service role, all tenants): 15 pool items with a `working`
-- lead, all in one tenant, none with an attempt on them. The rule is the reclaim's, applied once:
--   · a lead nobody dialled goes back to `fresh`, its next_dial_after untouched;
--   · a lead with attempts goes back to `retry`, due now (the abandoned call was not an attempt).
-- Only items that are genuinely in the pool: unclaimed, not locked, and with no other live claim on
-- the same lead. A `working` lead behind a claimed item is being worked and is left alone.
--
-- Idempotent: a second run finds nothing to change.
-- ---------------------------------------------------------------------------

update public.agent_leads l
   set lead_state = case when coalesce(l.attempts_made, 0) = 0 then 'fresh' else 'retry' end,
       next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after
                              else least(coalesce(l.next_dial_after, now()), now()) end,
       updated_at = now()
  from public.lead_queue q
 where q.lead_id = l.id
   and q.tenant_id = l.tenant_id
   and q.status = 'unclaimed'
   and (q.locked_until is null or q.locked_until < now())
   and l.lead_state = 'working'
   and not exists (
         select 1 from public.lead_queue other
          where other.lead_id = l.id
            and other.tenant_id = l.tenant_id
            and other.status = 'claimed'
       );

do $$
declare
  v_left integer;
begin
  select count(*) into v_left
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.status = 'unclaimed'
     and (q.locked_until is null or q.locked_until < now())
     and l.lead_state = 'working'
     and not exists (select 1 from public.lead_queue other
                      where other.lead_id = l.id and other.tenant_id = l.tenant_id and other.status = 'claimed');
  if v_left <> 0 then
    raise exception '% pool leads are still stuck in working', v_left;
  end if;
  raise notice 'no pool lead is stuck in working';
end $$;
