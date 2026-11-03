-- ---------------------------------------------------------------------------
-- LA-2.13 criterion 5, fifth pass · say `materialized` and mean it
--
-- The fourth pass removed the second reference to `eligible` so the CTE would be inlined, and the
-- serve got SLOWER — 105ms to 256.7ms at a thousand queued leads. Inlining was the wrong goal.
--
-- `eligible` filters on is_phone_suppressed and tenant_can_dial_now, which are expensive function
-- calls, not index predicates. Materialised, each row pays for them once. Inlined, the planner is
-- free to push those expressions into the sort and the projection and evaluate them again, and at
-- a thousand rows paying twice for the expensive half costs more than the tuplestore ever did.
--
-- The accidental materialisation of the third pass was therefore load-bearing, and removing it
-- removed a property the query needed. This says `as materialized` explicitly, which keeps that
-- property while still naming the CTE once — so there is no second walk for the minimum, and the
-- tier-first ordering from the fourth pass is kept, because that one was a correctness fix rather
-- than a performance one.
-- ---------------------------------------------------------------------------

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
                    and not exists (
                      select 1 from tenant_call_attempts ca
                       where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                         and ca.slot = current_slot_for_state(l.values->>'state', v_now)
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
                    and not exists (
                      select 1 from tenant_call_attempts ca
                       where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                         and ca.slot = current_slot_for_state(l.values->>'state', v_now)
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
