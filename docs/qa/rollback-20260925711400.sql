-- Rollback for 20260925711400: restores the four serve functions exactly as they were live on
-- 2026-09-25 before it (read with pg_get_functiondef), and drops the two functions it added.
-- Run in the SQL editor only if 711400 has to be undone.

CREATE OR REPLACE FUNCTION public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
 RETURNS TABLE(work_item_id uuid, lead_id uuid, tier integer, tier_name text, locked_until timestamp with time zone, appointment_notes text, selection_reason text, score numeric, cohort text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_candidate_cap integer := 50;
  v_qid uuid;
  v_lead uuid;
  v_priority integer;
  v_own boolean := false;
  v_notes text;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_cohort text := 'control';
  v_serve_control boolean := false;
  v_score numeric;
  v_reason text;
  v_signals jsonb := '{}'::jsonb;
  v_tier_reason text;
  -- 20260925700000: may this agent take a lead from the unclaimed pool? Their own assigned leads
  -- are served either way.
  v_pool_ok boolean := true;
  s record;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  -- The reclaim. An abandoned lock returns the lead as well as the work item (20260913401000): a
  -- lead nobody dialled goes back to `fresh`, one with attempts to `retry`, due now. An ASSIGNED
  -- lead goes back to its assignee, unlocked; everything else goes back to the pool.
  with kept as (
    update lead_queue q
       set locked_until = null, updated_at = v_now
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and q.owner_user_id is not null
       and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = q.owner_user_id
    returning q.lead_id
  ), reclaimed as (
    update lead_queue q
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and (q.owner_user_id is null
            or coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) is distinct from q.owner_user_id)
    returning q.lead_id
  )
  update agent_leads l
     set lead_state = case when coalesce(l.attempts_made, 0) = 0 then 'fresh' else 'retry' end,
         next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after
                                else least(coalesce(l.next_dial_after, v_now), v_now) end,
         updated_at = v_now
    from (select k.lead_id from kept k union select r.lead_id from reclaimed r) rc
   where l.id = rc.lead_id
     and l.tenant_id = p_tenant_id
     and l.lead_state = 'working';

  -- The open-lead ceiling, read after the reclaim (which can only lower the count).
  v_pool_ok := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id);

  -- The holdout is decided per serve so the control group is actually dialled; the cohort is a
  -- property of the lead so its outcome stays attributable.
  v_serve_control := v_enabled and (random() * 100) < v_holdout;

  if v_enabled and not v_serve_control then
    -- ── scored path ────────────────────────────────────────────────────────
    with eligible as materialized (
      select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' and coalesce(l.attempts_made, 0) = 0 then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
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
         and (
               (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
            or (q.status = 'claimed'
                and q.owner_user_id = p_agent_user_id
                and q.claimed_by = p_agent_user_id
                and q.locked_until is null
                and q.disposition is null
                and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
         )
         -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
         and (q.status <> 'unclaimed' or v_pool_ok)
         and (abs(hashtextextended(q.lead_id::text, 42)) % 100) >= v_holdout
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
         and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
    ),
    candidates as (
      -- ONE reference to `eligible`, which is why the tier filter is an ORDER BY rather than a
      -- `priority = (select min(priority) from eligible)`.
      select e.*
        from eligible e
       where e.priority is not null
       order by e.priority, coalesce(e.posted_at, e.queued_at) desc
       limit v_candidate_cap
    )
    -- `priority` leads the final ordering too: scoring orders WITHIN a tier; it does not get a
    -- vote on which tier comes first.
    select c.qid, c.lid, c.priority, c.own
      into v_qid, v_lead, v_priority, v_own
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
  -- Runs when scoring is off, when this serve drew the holdout, and when the scored pool turned
  -- out to be empty. The cohort filter is applied only while the holdout is being served.
  if v_qid is null then
    with eligible as (
      select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' and coalesce(l.attempts_made, 0) = 0 then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
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
         and (
               (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
            or (q.status = 'claimed'
                and q.owner_user_id = p_agent_user_id
                and q.claimed_by = p_agent_user_id
                and q.locked_until is null
                and q.disposition is null
                and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
         )
         -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
         and (q.status <> 'unclaimed' or v_pool_ok)
         and (not v_serve_control
              or (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout)
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
         and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
    )
    select e.qid, e.lid, e.priority, e.own
      into v_qid, v_lead, v_priority, v_own
      from eligible e
     where e.priority is not null
     order by e.priority,
              -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
              coalesce(e.posted_at, e.queued_at)
     limit 1;

    if v_qid is not null then
      v_cohort := case
        when not v_enabled then 'control'
        when (abs(hashtextextended(v_lead::text, 42)) % 100) < v_holdout then 'control'
        else 'scored' end;
    end if;
  end if;

  if v_qid is null then
    return;
  end if;

  -- The claim. The status re-check on the pool path is the race guard: a second agent who chose
  -- the same lead a moment later updates nothing and is served nothing.
  if not coalesce(v_own, false) then
    update lead_queue q
       set status = 'claimed',
           claimed_by = p_agent_user_id,
           owner_user_id = p_agent_user_id,
           claimed_at = v_now,
           locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_qid and q.status = 'unclaimed';
  else
    -- Already the agent's. Locked for the call; claimed_at stays the assignment time.
    update lead_queue q
       set locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_qid
       and q.status = 'claimed'
       and q.owner_user_id = p_agent_user_id
       and q.locked_until is null;
  end if;

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

  -- THE REASON, ALWAYS.
  v_tier_reason := case v_priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;
  if coalesce(v_own, false) then
    v_tier_reason := v_tier_reason || ' (assigned to you)';
  end if;

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

CREATE OR REPLACE FUNCTION public.dialer_queue_preview(p_tenant_id uuid, p_agent_user_id uuid, p_tiers integer[] DEFAULT NULL::integer[], p_limit integer DEFAULT 25, p_cap integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_cap integer := least(greatest(coalesce(p_cap, 1000), 1), 5000);
  v_count integer;
  v_rows jsonb;
  v_pool_ok boolean := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id);
begin
  with eligible as materialized (
    select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' and coalesce(l.attempts_made, 0) = 0 then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
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
           l.values as vals, coalesce(l.attempts_made, 0) as attempts_made,
           l.posted_at as posted_at, q.queued_at as queued_at
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and (
             (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
          or (q.status = 'claimed'
              and q.owner_user_id = p_agent_user_id
              and q.claimed_by = p_agent_user_id
              and q.locked_until is null
              and q.disposition is null
              and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
       )
       -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
       and (q.status <> 'unclaimed' or v_pool_ok)
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
       and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
       and l.lead_state <> 'exhausted'
       and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
  ),
  servable as (
    select e.* from eligible e where e.priority is not null
  )
  select (select count(*)::integer from (select 1 from servable limit v_cap + 1) capped),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'work_item_id', r.qid,
                    'lead_id', r.lid,
                    'tier', r.priority,
                    'tier_name', case r.priority
                                   when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
                                   when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
                    'name', coalesce(nullif(btrim(r.vals->>'full_name'), ''),
                                     nullif(btrim(concat_ws(' ', r.vals->>'first_name', r.vals->>'last_name')), ''),
                                     nullif(btrim(r.vals->>'name'), '')),
                    'state', nullif(upper(btrim(coalesce(r.vals->>'state', ''))), ''),
                    'attempts_made', r.attempts_made,
                    'assigned_to_you', r.own
                  ) order by r.priority, coalesce(r.posted_at, r.queued_at) desc)
             from (
               select s.* from servable s
                where p_tiers is null or s.priority = any(p_tiers)
                order by s.priority, coalesce(s.posted_at, s.queued_at) desc
                limit v_limit
             ) r
         ), '[]'::jsonb)
    into v_count, v_rows;

  return jsonb_build_object(
    'count', least(v_count, v_cap),
    'capped', v_count > v_cap,
    'cap', v_cap,
    'rows', v_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.serve_lead_by_id(p_tenant_id uuid, p_agent_user_id uuid, p_work_item_id uuid)
 RETURNS TABLE(work_item_id uuid, lead_id uuid, tier integer, tier_name text, locked_until timestamp with time zone, appointment_notes text, selection_reason text, cohort text, refusal text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_q lead_queue%rowtype;
  v_own boolean := false;
  v_row record;
  v_notes text;
  v_tier_reason text;
  v_reason text;
begin
  -- The same reclaim serve_next_lead runs, so a lock another agent abandoned is pickable and the
  -- lead it held is restored first.
  with kept as (
    update lead_queue q
       set locked_until = null, updated_at = v_now
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and q.owner_user_id is not null
       and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = q.owner_user_id
    returning q.lead_id
  ), reclaimed as (
    update lead_queue q
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and (q.owner_user_id is null
            or coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) is distinct from q.owner_user_id)
    returning q.lead_id
  )
  update agent_leads l
     set lead_state = case when coalesce(l.attempts_made, 0) = 0 then 'fresh' else 'retry' end,
         next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after
                                else least(coalesce(l.next_dial_after, v_now), v_now) end,
         updated_at = v_now
    from (select k.lead_id from kept k union select r.lead_id from reclaimed r) rc
   where l.id = rc.lead_id
     and l.tenant_id = p_tenant_id
     and l.lead_state = 'working';

  -- The lock. Everything below reads the row this transaction now owns.
  select * into v_q from lead_queue q
   where q.id = p_work_item_id and q.tenant_id = p_tenant_id
   for update;
  if not found then
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_found'::text;
    return;
  end if;

  if v_q.status = 'claimed' and v_q.claimed_by = p_agent_user_id
     and v_q.locked_until is not null and v_q.locked_until >= v_now then
    -- Already locked to this agent (served a moment ago). Nothing to claim; say so.
    return query select v_q.id, v_q.lead_id, null::integer, null::text, v_q.locked_until, null::text, null::text, null::text, 'held_by_you'::text;
    return;
  elsif v_q.status = 'unclaimed' and (v_q.locked_until is null or v_q.locked_until < v_now) then
    v_own := false;
  elsif v_q.status = 'claimed'
        and v_q.owner_user_id = p_agent_user_id
        and v_q.claimed_by = p_agent_user_id
        and v_q.locked_until is null
        and v_q.disposition is null
        and coalesce(public.callback_work_item_holder(p_tenant_id, v_q.id), lead_queue_assignee(p_tenant_id, v_q.id)) = p_agent_user_id then
    v_own := true;
  else
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'taken'::text;
    return;
  end if;

  -- 20260925700000: a POOL lead is refused to an agent at their open-lead ceiling, as Serve next
  -- refuses it. A lead already assigned to them is theirs and is not counted against the pick.
  if not v_own and not agent_can_take_pool_lead(p_tenant_id, p_agent_user_id) then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'at_capacity'::text;
    return;
  end if;

  -- Every predicate serve_next_lead applies to a candidate, evaluated one by one so a refusal
  -- names its rule. The tier CASE is serve_next_lead's, character for character.
  select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' and coalesce(l.attempts_made, 0) = 0 then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
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
         (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id)) as campaign_ok,
         sup.suppressed as suppressed,
         sup.list_type as list_type,
         tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now) as window_ok,
         (l.lead_state <> 'exhausted') as not_exhausted,
         agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state') as licensed
    into v_row
    from lead_queue q
    join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    cross join lateral is_phone_suppressed(p_tenant_id, l.values->>'phone') sup
   where q.tenant_id = p_tenant_id and q.id = v_q.id;

  if not found then
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_found'::text;
    return;
  end if;
  -- `is not true` / `is not false`, as the serving WHERE clause reads them: a null is a refusal.
  if v_row.not_exhausted is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'exhausted'::text; return;
  end if;
  if v_row.campaign_ok is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'campaign_not_servable'::text; return;
  end if;
  if v_row.suppressed is not false then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, ('suppressed:' || coalesce(v_row.list_type, 'unknown'))::text; return;
  end if;
  if v_row.window_ok is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'outside_window'::text; return;
  end if;
  if v_row.licensed is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_licensed'::text; return;
  end if;
  if v_row.priority is null then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_due'::text; return;
  end if;

  -- The claim, as serve_next_lead makes it. The row is locked, so the status re-check cannot lose a
  -- race here; it is kept so the two claims read the same.
  if not v_own then
    update lead_queue q
       set status = 'claimed',
           claimed_by = p_agent_user_id,
           owner_user_id = p_agent_user_id,
           claimed_at = v_now,
           locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_q.id and q.status = 'unclaimed';
  else
    update lead_queue q
       set locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_q.id
       and q.status = 'claimed'
       and q.owner_user_id = p_agent_user_id
       and q.locked_until is null;
  end if;
  if not found then
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'taken'::text;
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_q.lead_id and l.tenant_id = p_tenant_id;

  if v_row.priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_q.lead_id
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  v_tier_reason := case v_row.priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;
  v_reason := 'You picked this lead from the queue. ' || v_tier_reason
              || case when v_own then ' (assigned to you)' else '' end || '.';

  insert into tenant_scoring_decisions
    (tenant_id, lead_id, work_item_id, agent_user_id, cohort, score, signal_snapshot,
     selection_reason, served_at)
  values
    (p_tenant_id, v_q.lead_id, v_q.id, p_agent_user_id, 'picked', null, '{}'::jsonb, v_reason, v_now);

  return query
    select v_q.id, v_q.lead_id, v_row.priority::integer,
           case v_row.priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes,
           v_reason,
           'picked'::text,
           null::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.scoring_queue_preview(p_tenant_id uuid, p_agent_user_id uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_candidate_cap integer := 50;
  v_held_limit integer := 10;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_total numeric := 0;
  v_capacity_gate boolean := to_regprocedure('public.agent_can_take_pool_lead(uuid, uuid)') is not null;
  v_pool_open boolean := true;
  v_result jsonb;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  select coalesce(sum(w.weight), 0) into v_total from scoring_weights_for(p_tenant_id) w;

  if v_capacity_gate then
    execute 'select public.agent_can_take_pool_lead($1, $2)' into v_pool_open using p_tenant_id, p_agent_user_id;
    v_pool_open := coalesce(v_pool_open, true);
  end if;

  with base as materialized (
    select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' and coalesce(l.attempts_made, 0) = 0 then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
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
           l.values as vals,
           l.values->>'state' as raw_state,
           l.campaign_id as campaign_id,
           coalesce(l.attempts_made, 0) as attempts_made,
           coalesce(l.posted_at, q.queued_at) as aged_at,
           (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout as in_holdout
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and (
             (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now) and v_pool_open)
          or (q.status = 'claimed'
              and q.owner_user_id = p_agent_user_id
              and q.claimed_by = p_agent_user_id
              and q.locked_until is null
              and q.disposition is null
              and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
       )
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
       and l.lead_state <> 'exhausted'
       and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
  ),
  due as (
    select b.* from base b where b.priority is not null
  ),
  -- The calling window, once per (state, campaign). The explainer runs only where it is closed.
  windows as materialized (
    select k.raw_state, k.campaign_id, k.can_dial,
           w.reason as window_reason, w.zone, w.start_minute, w.local_minute
      from (
        select d.raw_state, d.campaign_id,
               tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, v_now) as can_dial
          from (select distinct u.raw_state, u.campaign_id from due u) d
      ) k
      left join lateral (
        select tw.reason, tw.zone, tw.start_minute, tw.local_minute
          from tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, v_now) tw
         where not k.can_dial
      ) w on true
  ),
  servable as materialized (
    select u.* from due u
      join windows k on k.raw_state is not distinct from u.raw_state
                    and k.campaign_id is not distinct from u.campaign_id
     where k.can_dial
  ),
  held as materialized (
    select u.*, k.window_reason, k.zone, k.start_minute, k.local_minute,
           case when k.window_reason = 'before_open' and k.start_minute is not null and k.local_minute is not null
                then greatest(k.start_minute - k.local_minute, 0) end as minutes_until_open
      from due u
      join windows k on k.raw_state is not distinct from u.raw_state
                    and k.campaign_id is not distinct from u.campaign_id
     where not k.can_dial
  ),
  -- Scoring on: the scored path serves the scored cohort, and falls back to everyone when that
  -- cohort has nothing servable. Scoring off: everyone, in the plain order.
  mode as (
    select v_enabled and exists (select 1 from servable s where not s.in_holdout) as ranked
  ),
  candidates as (
    select s.*
      from servable s, mode m
     where not m.ranked or not s.in_holdout
     order by s.priority,
              case when m.ranked then -extract(epoch from s.aged_at) else extract(epoch from s.aged_at) end
     limit v_candidate_cap
  ),
  scored as (
    select c.*, sl.score, sl.reasons
      from candidates c
      cross join lateral score_lead(p_tenant_id, c.lid, v_now) sl
  ),
  ordered as (
    select sc.*,
           row_number() over (
             order by sc.priority,
                      case when m.ranked then sc.score end desc nulls last,
                      case when m.ranked then 0 else extract(epoch from sc.aged_at) end,
                      sc.aged_at
           ) as position
      from scored sc, mode m
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'enabled', v_enabled,
    'ranked', (select m.ranked from mode m),
    'holdout_pct', v_holdout,
    'total_weight', v_total,
    'capacity_gate', v_capacity_gate,
    'pool_open', v_pool_open,
    'servable_count', (select count(*)::integer from servable),
    'held_back_count', (select count(*)::integer from held),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'position', o.position,
               'work_item_id', o.qid,
               'lead_id', o.lid,
               'name', coalesce(nullif(btrim(o.vals->>'full_name'), ''),
                                nullif(btrim(concat_ws(' ', o.vals->>'first_name', o.vals->>'last_name')), ''),
                                nullif(btrim(o.vals->>'name'), '')),
               'state', nullif(upper(btrim(coalesce(o.raw_state, ''))), ''),
               'attempts_made', o.attempts_made,
               'tier', o.priority,
               'tier_name', case o.priority
                              when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
                              when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
               'tier_reason', (case o.priority
                                 when 1 then 'Posted less than five minutes ago'
                                 when 2 then 'A callback you promised is due'
                                 when 3 then 'An appointment a setter booked is due'
                                 when 4 then 'Due for a retry, in a slot it has not been tried in'
                                 when 5 then 'A fresh lead that has never been called'
                                 when 6 then 'Due for a nurture touch'
                               end) || case when o.own then ' (assigned to you)' else '' end,
               'assigned_to_you', o.own,
               'cohort', case when not v_enabled then null
                              when o.in_holdout then 'control' else 'scored' end,
               'score', o.score,
               'reasons', to_jsonb(coalesce(o.reasons, array[]::text[]))
             ) order by o.position)
        from ordered o
       where o.position <= v_limit
    ), '[]'::jsonb),
    'held_back', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_item_id', h.qid,
               'lead_id', h.lid,
               'name', coalesce(nullif(btrim(h.vals->>'full_name'), ''),
                                nullif(btrim(concat_ws(' ', h.vals->>'first_name', h.vals->>'last_name')), ''),
                                nullif(btrim(h.vals->>'name'), '')),
               'state', nullif(upper(btrim(coalesce(h.raw_state, ''))), ''),
               'attempts_made', h.attempts_made,
               'tier_name', case h.priority
                              when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
                              when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
               'reason', coalesce(h.window_reason, 'closed'),
               'zone', h.zone,
               'start_minute', h.start_minute,
               'local_minute', h.local_minute,
               'minutes_until_open', h.minutes_until_open
             ) order by h.minutes_until_open nulls last, h.priority, h.aged_at)
        from (
          select * from held hh
           order by hh.minutes_until_open nulls last, hh.priority, hh.aged_at
           limit v_held_limit
        ) h
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

drop function if exists public.serve_mix_sample(uuid, uuid, integer);
drop function if exists public.serve_eligible(uuid, uuid, timestamp with time zone, boolean);
