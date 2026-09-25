-- ---------------------------------------------------------------------------
-- Dialer · Serve next respects the agent's open-lead ceiling
--
-- User decision (2026-09-25): an agent at their open-lead ceiling is not served UNCLAIMED POOL
-- leads. Their own assigned leads are still served — the ceiling limits how much an agent takes
-- from the pool, it never strands work an owner already routed to them.
--
--   agent_open_lead_load(tenant, user)      the agent's open-lead count and ceiling, counted
--       exactly as assign_lead_core counts them (20260924300000: lead_queue rows the agent owns in
--       'claimed', 'buffer_active', 'handed_pending' or 'la_active' with no disposition) against
--       agent_capacity.max_open_leads (20260913490000). No agent_capacity row = no ceiling set.
--
--   agent_can_take_pool_lead(tenant, user)  true when the count is below the ceiling, and always
--       true when no ceiling is set. The shared helper: the Scoring preview calls it too
--       (to_regprocedure-guarded) so its preview matches Serve next.
--
--   serve_next_lead        restated from its latest definition (20260924323000; nothing later
--       redefines or patches it) with ONE predicate added to both candidate queries:
--           and (q.status <> 'unclaimed' or v_pool_ok)
--       v_pool_ok is computed once per serve, after the reclaim (a reclaim can lower the count).
--   The pick (serve_lead_by_id) and the queue list (dialer_queue_preview) get the same rule in
--   20260925700010, a file of their own so each serving function keeps a migration to itself.
--
-- Nothing else in the body changes; the tier CASE is untouched.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.lead_queue_assignee(uuid, uuid)') is null then
    raise exception 'lead_queue_assignee does not exist; apply 20260924323000 before this file';
  end if;
  if to_regclass('public.agent_capacity') is null then
    raise exception 'agent_capacity does not exist; apply 20260913490000 before this file';
  end if;
end $$;

-- ── the load, and the shared helper ────────────────────────────────────────
create or replace function public.agent_open_lead_load(p_tenant_id uuid, p_user_id uuid)
returns table(open_leads integer, max_open_leads integer)
language sql
stable
security definer
set search_path = public
as $function$
  select (select count(*)::integer from public.lead_queue q
           where q.tenant_id = p_tenant_id and q.owner_user_id = p_user_id
             and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
             and q.disposition is null),
         (select c.max_open_leads from public.agent_capacity c
           where c.tenant_id = p_tenant_id and c.user_id = p_user_id);
$function$;

revoke all on function public.agent_open_lead_load(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_open_lead_load(uuid, uuid) to tenant_app, service_role;

create or replace function public.agent_can_take_pool_lead(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((select l.max_open_leads is null or l.open_leads < l.max_open_leads
                     from public.agent_open_lead_load(p_tenant_id, p_user_id) l), true);
$function$;

revoke all on function public.agent_can_take_pool_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_can_take_pool_lead(uuid, uuid) to tenant_app, service_role;

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

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_next_lead(uuid, uuid) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_serve text;
  v_n integer;
  v_tenant uuid;
  v_user uuid;
  v_ok boolean;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.serve_next_lead(uuid, uuid)'::regprocedure) into v_serve;

  -- The capacity predicate is on both serving paths.
  select count(*) into v_n from regexp_matches(v_serve, 'q\.status <> ''unclaimed'' or v_pool_ok', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: the capacity predicate is on % candidate paths, not 2', v_n; end if;
  if strpos(v_serve, 'v_pool_ok := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id)') = 0 then
    raise exception 'serve_next_lead does not read agent_can_take_pool_lead';
  end if;

  -- Every gate 20260924323000 carried is still on both paths.
  if (length(v_serve) - length(replace(v_serve, 'agent_may_work_state(p_tenant_id, p_agent_user_id', ''))) / length('agent_may_work_state(p_tenant_id, p_agent_user_id') <> 2 then
    raise exception 'serve_next_lead: the licence filter is not in both candidate queries';
  end if;
  if (length(v_serve) - length(replace(v_serve, 'lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id', ''))) / length('lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id') <> 2 then
    raise exception 'serve_next_lead: the assigned-to-you predicate is not in both candidate queries';
  end if;
  select count(*) into v_n from regexp_matches(v_serve, 'is_phone_suppressed\(p_tenant_id', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: suppression is not checked on both paths (found %)', v_n; end if;
  select count(*) into v_n from regexp_matches(v_serve, 'tenant_can_dial_now\(p_tenant_id', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: the calling window is not checked on both paths (found %)', v_n; end if;
  if v_serve !~ 'reclaimed as' or v_serve !~ 'kept as' or v_serve !~ 'set lead_state = case when coalesce\(l\.attempts_made, 0\) = 0' then
    raise exception 'serve_next_lead: the reclaim no longer restores the lead';
  end if;
  if v_serve !~ 'where q\.id = v_qid and q\.status = ''unclaimed''' then
    raise exception 'serve_next_lead: the pool claim lost its race guard';
  end if;

  -- The helper answers, and "no ceiling" is true.
  select tu.tenant_id, tu.user_id into v_tenant, v_user from public.tenant_users tu limit 1;
  if v_tenant is not null then
    select public.agent_can_take_pool_lead(v_tenant, v_user) into v_ok;
    if v_ok is null then raise exception 'agent_can_take_pool_lead returned null'; end if;
  end if;
  if public.agent_can_take_pool_lead(gen_random_uuid(), gen_random_uuid()) is not true then
    raise exception 'agent_can_take_pool_lead is not true when no ceiling is set';
  end if;
  if not has_function_privilege('tenant_app', 'public.agent_can_take_pool_lead(uuid, uuid)', 'execute') then
    raise exception 'tenant_app cannot execute agent_can_take_pool_lead';
  end if;

  raise notice '20260925700000: Serve next leaves the pool alone for an agent at capacity';
end $$;
