-- ---------------------------------------------------------------------------
-- Dialer · "Serve next" includes the leads assigned to you
--
-- Lead assignment (assign_lead) hands a work item to one agent and leaves it
--
--     status = 'claimed', claimed_by = owner_user_id = the agent, locked_until = null
--
-- and serve_next_lead only ever looked at `status = 'unclaimed'`. So a lead an owner routed to Ray
-- was, from the dialer's point of view, gone: it was on Ray's assignment list and on nobody's
-- queue, and pressing Next could never reach it. User decision (2026-09-24): Serve next includes
-- the agent's OWN assigned leads, in the normal tier order, never another agent's, and behind every
-- gate the pool is behind.
--
-- "Assigned to you" is read from the assignment log, not guessed from the queue row: the latest
-- lead_assignment_events row for the work item must be an assignment (assigned / pulled /
-- reassigned) to this agent. An inbound transfer the agent claimed on the Agent Floor also leaves a
-- claimed row with no lock, and that is not an outbound assignment — the log is what tells them
-- apart. `lead_queue_assignee` answers the question once, for this function, serve_lead_by_id and
-- the queue preview.
--
-- Three changes to serve_next_lead, restated in full from 20260917144000 (the live body, verified
-- against pg_get_functiondef on 2026-09-24) with 20260924220200's licence filter folded in:
--
--   1. The candidate predicate admits the agent's own assigned, unlocked, undispositioned items
--      beside the unclaimed pool. Tiers, the calling window, suppression, the campaign gate and
--      agent_may_work_state apply to both exactly as before.
--
--   2. The claim. A pool lead is claimed as it always was (the `status = 'unclaimed'` re-check is
--      the race guard). An assigned lead is already the agent's: it is only locked for the call,
--      and claimed_at — the assignment time the assignment board reads — is left alone.
--
--   3. THE RECLAIM, which had quietly lost a fix. 20260913401000 made the reclaim of an abandoned
--      lock restore the LEAD as well as the work item ("an agent who claims a lead and walks away
--      does not release it; he destroys it" — the lead stays `working`, which no tier serves).
--      20260917144000 restated the function from 20260913399000 and dropped that restore; its
--      assertion checked only that `set status = 'unclaimed'` survived, which it did. The live
--      body has no restore today. It is put back here, and extended: an assigned lead whose lock
--      lapses goes back to its assignee (unlocked), not to the pool, so abandoning a call does not
--      silently undo an owner's assignment.
--
-- Requires 20260924220200 (agent_may_work_state). Built on it, not instead of it: that file's
-- patch is a no-op once this body is in place (it looks for its marker and returns).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.agent_may_work_state(uuid, uuid, text)') is null then
    raise exception 'agent_may_work_state does not exist; apply 20260924220200 before this file';
  end if;
end $$;

-- ── who a work item is assigned to, per the assignment log ─────────────────
create or replace function public.lead_queue_assignee(p_tenant_id uuid, p_work_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select case when e.event_type in ('assigned', 'pulled', 'reassigned') then e.to_user_id end
    from public.lead_assignment_events e
   where e.tenant_id = p_tenant_id and e.work_item_id = p_work_item_id
   order by e.created_at desc
   limit 1;
$function$;

revoke all on function public.lead_queue_assignee(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lead_queue_assignee(uuid, uuid) to tenant_app, service_role;

-- ── the serving query ──────────────────────────────────────────────────────
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
       and lead_queue_assignee(p_tenant_id, q.id) = q.owner_user_id
    returning q.lead_id
  ), reclaimed as (
    update lead_queue q
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and (q.owner_user_id is null
            or lead_queue_assignee(p_tenant_id, q.id) is distinct from q.owner_user_id)
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

  -- The holdout is decided per serve so the control group is actually dialled; the cohort is a
  -- property of the lead so its outcome stays attributable.
  v_serve_control := v_enabled and (random() * 100) < v_holdout;

  if v_enabled and not v_serve_control then
    -- ── scored path ────────────────────────────────────────────────────────
    with eligible as materialized (
      select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
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
         and (
               (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
            or (q.status = 'claimed'
                and q.owner_user_id = p_agent_user_id
                and q.claimed_by = p_agent_user_id
                and q.locked_until is null
                and q.disposition is null
                and lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id)
         )
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
         and (
               (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
            or (q.status = 'claimed'
                and q.owner_user_id = p_agent_user_id
                and q.claimed_by = p_agent_user_id
                and q.locked_until is null
                and q.disposition is null
                and lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id)
         )
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

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_next_lead(uuid, uuid) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_n integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'serve_next_lead';

  -- Both paths carry every gate.
  if (length(v_def) - length(replace(v_def, 'agent_may_work_state(p_tenant_id, p_agent_user_id', ''))) / length('agent_may_work_state(p_tenant_id, p_agent_user_id') <> 2 then
    raise exception 'serve_next_lead: the licence filter is not in both candidate queries';
  end if;
  if (length(v_def) - length(replace(v_def, 'lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id', ''))) / length('lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id') <> 2 then
    raise exception 'serve_next_lead: the assigned-to-you predicate is not in both candidate queries';
  end if;
  select count(*) into v_n from regexp_matches(v_def, 'is_phone_suppressed\(p_tenant_id', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: suppression is not checked on both paths (found %)', v_n; end if;
  select count(*) into v_n from regexp_matches(v_def, 'tenant_can_dial_now\(p_tenant_id', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: the calling window is not checked on both paths (found %)', v_n; end if;

  -- The reclaim restores the lead again, and an assigned lead goes home rather than to the pool.
  if v_def !~ 'reclaimed as' or v_def !~ 'kept as' or v_def !~ 'set lead_state = case when coalesce\(l\.attempts_made, 0\) = 0' then
    raise exception 'serve_next_lead: the reclaim no longer restores the lead';
  end if;

  -- The pool claim still re-checks status, so two agents cannot hold one lead.
  if v_def !~ 'where q\.id = v_qid and q\.status = ''unclaimed''' then
    raise exception 'serve_next_lead: the pool claim lost its race guard';
  end if;

  if not has_function_privilege('tenant_app', 'public.lead_queue_assignee(uuid, uuid)', 'execute') then
    raise exception 'tenant_app cannot execute lead_queue_assignee';
  end if;
  raise notice 'serve_next_lead serves the agent''s own assigned leads, behind every gate, and restores abandoned leads';
end $$;
