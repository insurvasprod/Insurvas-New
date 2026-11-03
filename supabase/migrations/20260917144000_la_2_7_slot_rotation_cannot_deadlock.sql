-- LA-2.7, as amended by decision 2 of "Sixteen Open Questions, Answered" (2026-09-11, newer than
-- every task page):
--
--   "If every slot has already been used, take the least recently used slot rather than blocking or
--    waiting. **The engine must never deadlock because it ran out of fresh slots.**"
--
-- It deadlocks today, and the arithmetic makes it reachable rather than theoretical.
--
-- There are six slots — early_morning, late_morning, afternoon, early_evening, late_evening,
-- weekend — and the attempt ceiling is seven. The serving query admits a retry lead to tier 4 only
-- when:
--
--     not exists (select 1 from tenant_call_attempts ca
--                  where ca.lead_id = l.id
--                    and ca.slot = current_slot_for_state(state, now))
--
-- Once a lead has been dialled in all six slots, every value `current_slot_for_state` can return
-- matches a prior attempt, so that condition is false at every hour of every day, forever. The lead
-- sits at `lead_state = 'retry'` with an elapsed timer and is never served again. No other tier
-- takes it: tier 5 requires `fresh`, tier 6 requires `nurture`. So attempt seven never happens, and
-- because exhaustion is recorded by the disposition path, the lead never reaches nurture either —
-- it is stuck, invisibly, in a state that looks active.
--
-- Two things are wrong and both are fixed here.
--
-- **1. The serving condition has no fallback.** `schedule_next_attempt` does have one, so the
-- scheduler happily writes `next_preferred_slot` for attempt seven — and then the serving query
-- refuses to act on it. The fallback existed on the wrong side of the gate.
--
-- The fix reads the slot the scheduler already chose. `next_preferred_slot` is written alongside
-- `next_dial_after` on every retry, and it is only ever set to an already-used slot in the
-- scheduler's own all-slots-used branch. So "the current slot is the one the scheduler asked for"
-- is exactly the fallback, and in the ordinary case the existing unused-slot branch still fires
-- first. One column comparison on the hot path: no extra subquery and no extra function call, which
-- matters because this query is already the module's known performance problem.
--
-- **2. The scheduler's fallback was not least-recently-used, and was not even deterministic.**
-- It took `v_tried[1]` from `array_agg(distinct ca.slot)`, and the order of a `distinct` aggregate
-- is unspecified — so the "fallback slot" was whichever one the planner happened to emit first.
-- Decision 2 asks for the least recently used, which is the only choice that means anything: it is
-- the slot whose evidence is oldest, and therefore the one most worth testing again.

-- ── the scheduler, with a real LRU fallback ────────────────────────────────
create or replace function public.schedule_next_attempt(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition text,
  p_at timestamptz default now()
)
returns table(due_at timestamptz, attempt_number integer, slot text, exhausted boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made integer;
  v_next integer;
  v_ceiling integer := 7;
  v_campaign uuid;
  v_state text;
  v_delay interval;
  v_preferred text;
  v_slot text;
  v_tried text[];
  v_unused text[];
  v_available text[] := array['early_morning','late_morning','afternoon','early_evening','late_evening','weekend'];
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state'
    into v_made, v_campaign, v_state
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  v_next := v_made + 1;

  -- The ceiling terminates rather than schedules. Returning a date far in the future would have
  -- been the easy way to say "stop" and the wrong one: a queue that only checks whether the timer
  -- has elapsed would serve it eventually.
  if v_made >= v_ceiling - 1 then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A disposition-specific row beats the catch-all, and a campaign row beats the tenant default.
  -- "No-answer and voicemail should not behave identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (r.campaign_id = v_campaign or r.campaign_id is null)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.campaign_id is not null) desc, (r.disposition_scope is not null) desc
   limit 1;

  -- The default table from the task, front-loaded, used when the tenant has defined nothing.
  if v_delay is null then
    v_delay := case v_next
      when 1 then interval '2 hours'
      when 2 then interval '1 day'
      when 3 then interval '1 day'
      when 4 then interval '2 days'
      when 5 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 4 then v_preferred := 'weekend'; end if;
  end if;

  -- Slots this lead has already been DIALLED in. `slot` is NOT NULL on the attempts table, but the
  -- filter is explicit anyway: a single null would make `not (s = any(v_tried))` evaluate to null
  -- for every candidate and silently empty `v_unused`, which would turn slot rotation off across
  -- the whole tenant without any error.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select coalesce(array_agg(s order by ord), array[]::text[]) into v_unused
      from unnest(v_available) with ordinality as u(s, ord)
     where not (u.s = any(v_tried));

    if array_length(v_unused, 1) is null then
      -- Every slot has been dialled. Decision 2: take the LEAST RECENTLY USED slot rather than
      -- blocking. The previous version took `v_tried[1]`, and because the order of a `distinct`
      -- aggregate is unspecified that was whichever slot the planner emitted first — not the
      -- oldest, and not even stable between runs.
      --
      -- Least recently used is the only choice that carries information: it is the slot whose
      -- evidence is oldest, so it is the one whose "they do not answer then" is least likely to
      -- still be true. `ca.slot` breaks ties so the answer is deterministic.
      select ca.slot into v_slot
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null
       group by ca.slot
       order by max(ca.attempted_at) asc, ca.slot asc
       limit 1;
      -- Only reachable if the lead has no attempts at all, in which case v_unused would not have
      -- been empty. Kept so the function cannot return a null slot under any path.
      v_slot := coalesce(v_slot, v_available[1]);
    else
      -- ADVANCE BY ATTEMPT NUMBER rather than always taking the first unused slot. Every call in a
      -- single working day happens in the same real-world slot, so `v_tried` barely moves between
      -- attempts, and taking the first unused entry proposed the same hour over and over. The
      -- proposal is a hypothesis about when this person answers; repeating one that has already
      -- been made is not a hypothesis.
      v_slot := v_unused[((v_next - 1) % array_length(v_unused, 1)) + 1];
    end if;
  end if;

  -- The delay is a FLOOR, not an appointment. Decision 2: "retry no sooner than the configured
  -- delay, at the next unused slot inside the legal window." This function returns the earliest
  -- moment the lead becomes eligible; the serving query holds it back until the chosen slot
  -- actually arrives, which is what makes "+2h" and "a different slot" compatible rather than
  -- contradictory.
  return query select p_at + v_delay, v_next, v_slot, false;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to tenant_app, service_role;

-- ── the serving query, which can no longer deadlock ────────────────────────
--
-- Reproduced in full because a function body cannot be patched. The ONLY change from
-- 20260913399000 is the tier-4 slot condition, in both the scored and the naive path: it now also
-- admits the lead when the current slot is the one the scheduler chose. Everything else — the
-- materialized-candidates shape, the holdout arithmetic, the reclaim, the reason text — is
-- unchanged, deliberately, so this migration is reviewable as a one-line behavioural change.
create or replace function public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
returns table(
  work_item_id uuid,
  lead_id uuid,
  tier integer,
  tier_name text,
  locked_until timestamptz,
  appointment_notes text,
  selection_reason text,
  score numeric,
  cohort text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_candidate_cap integer := 50;
  v_qid uuid;
  v_lead uuid;
  v_priority integer;
  v_notes text;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_cohort text := 'control';
  v_serve_control boolean := false;
  v_score numeric;
  v_reason text;
  v_signals jsonb := '{}'::jsonb;
  v_tier_reason text;
  s record;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  update lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
   where q.tenant_id = p_tenant_id
     and q.status = 'claimed'
     and q.locked_until is not null
     and q.locked_until < v_now;

  -- The holdout is decided per serve so the control group is actually dialled; the cohort is a
  -- property of the lead so its outcome stays attributable. Both halves are needed: a holdout that
  -- is never served produces no contact rate, and a lead that changes sides produces a meaningless
  -- one.
  v_serve_control := v_enabled and (random() * 100) < v_holdout;

  if v_enabled and not v_serve_control then
    -- ── scored path ────────────────────────────────────────────────────────
    with eligible as materialized (
      select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when exists (select 1 from tenant_callbacks cb
                             where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                               and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      -- The scheduler's choice. Only ever an already-used slot when every slot has
                      -- been used, which is the least-recently-used fallback decision 2 requires.
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and q.status = 'unclaimed'
         and (q.locked_until is null or q.locked_until < v_now)
         and (abs(hashtextextended(q.lead_id::text, 42)) % 100) >= v_holdout
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
    ),
    candidates as (
      -- ONE reference to `eligible`, which is why the tier filter is an ORDER BY rather than a
      -- `priority = (select min(priority) from eligible)`. A CTE named twice is materialised, and
      -- materialising meant evaluating is_phone_suppressed and tenant_can_dial_now over the whole
      -- queue and then walking it a second time for the minimum. Sorting by priority first picks
      -- the best tier without ever asking what the best tier is.
      select e.*
        from eligible e
       where e.priority is not null
       order by e.priority, coalesce(e.posted_at, e.queued_at) desc
       limit v_candidate_cap
    )
    -- `priority` leads the final ordering too. The cap can spill into the next tier when the best
    -- tier holds fewer than fifty leads, and without this a fresh lead with a high score would be
    -- served ahead of a callback the customer is waiting for. Scoring orders WITHIN a tier; it
    -- does not get a vote on which tier comes first.
    select c.qid, c.lid, c.priority
      into v_qid, v_lead, v_priority
      from candidates c
      cross join lateral score_lead(p_tenant_id, c.lid, v_now) sl
     order by c.priority,
              sl.score desc,
              -ln(greatest(random(), 1e-9)) / greatest(c.weight, 1),
              coalesce(c.posted_at, c.queued_at)
     limit 1;
    v_cohort := 'scored';
  end if;

  -- ── naive path ─────────────────────────────────────────────────────────
  --
  -- This is LA-2.8's query, unchanged. It runs when scoring is off, when this serve drew the
  -- holdout, and when the scored pool turned out to be empty. The cohort filter is applied only
  -- while the holdout is being served; the empty-pool fallback drops it, because a queue that goes
  -- idle over a coin flip is worse than a comparison with slightly uneven arms.
  if v_qid is null then
    with eligible as (
      select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when exists (select 1 from tenant_callbacks cb
                             where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                               and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and q.status = 'unclaimed'
         and (q.locked_until is null or q.locked_until < v_now)
         and (not v_serve_control
              or (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout)
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
    )
    select e.qid, e.lid, e.priority
      into v_qid, v_lead, v_priority
      from eligible e
     where e.priority is not null
     order by e.priority,
              -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
              coalesce(e.posted_at, e.queued_at)
     limit 1;

    if v_qid is not null then
      -- The lead's own cohort, not the pool this serve drew from: a scored lead reached by the
      -- empty-pool fallback is still a scored lead, and recording it as control would put a lead
      -- the scorer chose on the control side of the comparison.
      v_cohort := case
        when not v_enabled then 'control'
        when (abs(hashtextextended(v_lead::text, 42)) % 100) < v_holdout then 'control'
        else 'scored' end;
    end if;
  end if;

  if v_qid is null then
    return;
  end if;

  update lead_queue q
     set status = 'claimed',
         claimed_by = p_agent_user_id,
         owner_user_id = p_agent_user_id,
         claimed_at = v_now,
         locked_until = v_now + make_interval(mins => v_lock_minutes),
         updated_at = v_now
   where q.id = v_qid and q.status = 'unclaimed';

  if not found then
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_lead and l.tenant_id = p_tenant_id;

  if v_priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_lead
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  -- THE REASON, ALWAYS. Criterion 1 says every served lead carries one, and that includes the
  -- leads served while scoring is off — which is every lead, on the day this ships. The tier is a
  -- reason in itself: "this customer asked you to ring back now" explains the choice more
  -- completely than any score could.
  v_tier_reason := case v_priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;

  if v_enabled and v_cohort = 'scored' then
    select sl.score, sl.reasons, sl.signals into s from score_lead(p_tenant_id, v_lead, v_now) sl;
    v_score := s.score;
    v_signals := coalesce(s.signals, '{}'::jsonb);
    v_reason := v_tier_reason || case
      when array_length(s.reasons, 1) > 0 then ' — ' || array_to_string(s.reasons, '; ')
      else '' end;
  else
    v_reason := v_tier_reason || case
      when v_enabled then ' — served in the naive order, as part of the holdout'
      else '' end;
    v_score := null;
  end if;

  insert into tenant_scoring_decisions
    (tenant_id, lead_id, work_item_id, agent_user_id, cohort, score, signal_snapshot,
     selection_reason, served_at)
  values
    (p_tenant_id, v_lead, v_qid, p_agent_user_id, v_cohort, v_score, v_signals, v_reason, v_now);

  return query
    select v_qid, v_lead, v_priority,
           case v_priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes,
           v_reason,
           v_score,
           v_cohort;
end;
$function$;

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_next_lead(uuid, uuid) to tenant_app, service_role;

-- ── the deadlock, asserted absent ──────────────────────────────────────────
do $$
declare
  v_reclaim integer;
  v_fallback integer;
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'serve_next_lead';

  -- The reclaim fix from 20260913401000 must survive this rewrite. It is the reason an abandoned
  -- lock returns the lead to the pool (LA-2.8 criterion 3), and re-emitting the function is exactly
  -- how a previous fix gets quietly dropped.
  select count(*) into v_reclaim
    from regexp_matches(v_def, 'set status = ''unclaimed''', 'g');
  if v_reclaim < 1 then
    raise exception 'LA-2.8: the reclaim of abandoned locks did not survive the rewrite';
  end if;

  -- Both paths — scored and naive — must carry the fallback, or a tenant with scoring enabled and
  -- a holdout draw still deadlocks half the time.
  select count(*) into v_fallback
    from regexp_matches(v_def, 'current_slot_for_state\(l\.values->>''state'', v_now\) = l\.next_preferred_slot', 'g');
  if v_fallback <> 2 then
    raise exception 'LA-2.7: expected the slot fallback in both serving paths, found %', v_fallback;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_next_attempt';
  if v_def !~ 'order by max\(ca\.attempted_at\) asc' then
    raise exception 'LA-2.7: the all-slots-used fallback is not least-recently-used';
  end if;
  if v_def ~ 'v_slot := v_tried\[1\]' then
    raise exception 'LA-2.7: the non-deterministic v_tried[1] fallback is still present';
  end if;

  raise notice 'LA-2.7: slot rotation falls back to least-recently-used and can no longer deadlock';
end $$;
