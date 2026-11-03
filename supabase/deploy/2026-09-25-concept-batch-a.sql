-- CONCEPT BATCH A (Design 2), 20260925700000-705100, in filename order. Notes:
--  * 700000 must precede 701100 (scoring_queue_preview asserts its tier CASE matches serve_next_lead).
--  * 703200 needs 703100's ledger changes.
--  * 702100: assign_lead_core keeps its 6-arg form as a wrapper, so nothing old code calls is dropped.
--  * 705000 backfills tenant_lead_activity from tenant_call_attempts and RAISEs (fails) if any
--    matchable outcome is left unlinked; expect about 9 outcomes linked.
--  * 705100 drops and recreates tenant_activity_report with a new p_flag parameter, grants included.

-- ============================================================================
-- Pending migrations — 18 files, each in its own transaction
-- Generated 2026-09-25 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260925700000_dialer_serve_respects_agent_capacity.sql
--    2. 20260925700010_dialer_pick_and_list_respect_agent_capacity.sql
--    3. 20260925700100_dialer_lead_return_window.sql
--    4. 20260925700200_dialer_suppression_hits_at_dial.sql
--    5. 20260925700300_dialer_callback_inside_the_calling_window.sql
--    6. 20260925701000_scoring_cohort_stats_since.sql
--    7. 20260925701100_scoring_queue_preview.sql
--    8. 20260925702000_agent_licence_expiry.sql
--    9. 20260925702100_assignment_router_strategy_conditions_auto_route.sql
--   10. 20260925702200_return_leads_when_a_licence_lapses.sql
--   11. 20260925703000_lead_list_pool_blockers.sql
--   12. 20260925703100_scrub_ledger_records_in_file_duplicates.sql
--   13. 20260925703200_claim_ledger_holds_import_removals.sql
--   14. 20260925704000_booking_refuses_an_agent_with_no_hours.sql
--   15. 20260925704200_rebook_a_no_show.sql
--   16. 20260925704300_setter_scorecard_for_one_agent.sql
--   17. 20260925705000_activity_log_learns_the_dial_and_outcome.sql
--   18. 20260925705100_activity_report_row_detail_and_flag_filter.sql
-- ============================================================================

-- ─── [1/18] 20260925700000_dialer_serve_respects_agent_capacity.sql ───────────────
begin;

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

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925700000', 'dialer_serve_respects_agent_capacity') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/18] 20260925700010_dialer_pick_and_list_respect_agent_capacity.sql ────────
begin;

-- ---------------------------------------------------------------------------
-- Dialer · the pick and the queue list respect the agent's open-lead ceiling
--
-- The companion to 20260925700000 (agent_can_take_pool_lead, and serve_next_lead's capacity
-- predicate), which must be applied first. (Both bodies are PL/pgSQL, bound when they run, so the
-- order is checked in the assertions below rather than by a guard that would stop a dry run.)
--
--   serve_lead_by_id       restated from its latest definition (20260924323100): a pick of a POOL
--       lead by an agent at the ceiling is refused with the code 'at_capacity', worded by the
--       dialer. A lead already assigned to the agent is theirs and is picked as before.
--   dialer_queue_preview   restated from 20260924323100 with serve_next_lead's predicate
--           and (q.status <> 'unclaimed' or v_pool_ok)
--       so the list never offers a pool lead the pick would refuse.
--
-- Nothing else changes in either body. The assertion at the end re-checks that both still carry
-- serve_next_lead's tier CASE character for character, and every serving gate.
-- ---------------------------------------------------------------------------

-- ── the pick ───────────────────────────────────────────────────────────────
create or replace function public.serve_lead_by_id(p_tenant_id uuid, p_agent_user_id uuid, p_work_item_id uuid)
returns table(
  work_item_id uuid,
  lead_id uuid,
  tier integer,
  tier_name text,
  locked_until timestamptz,
  appointment_notes text,
  selection_reason text,
  cohort text,
  refusal text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        and lead_queue_assignee(p_tenant_id, v_q.id) = p_agent_user_id then
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

revoke all on function public.serve_lead_by_id(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_lead_by_id(uuid, uuid, uuid) to tenant_app, service_role;

-- ── the list ───────────────────────────────────────────────────────────────
create or replace function public.dialer_queue_preview(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_tiers integer[] default null,
  p_limit integer default 25,
  p_cap integer default 1000
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
              and lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id)
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

revoke all on function public.dialer_queue_preview(uuid, uuid, integer[], integer, integer) from public, anon, authenticated;
grant execute on function public.dialer_queue_preview(uuid, uuid, integer[], integer, integer) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_serve text;
  v_pick text;
  v_preview text;
  v_serve_case text;
  v_fn text;
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700010: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.agent_can_take_pool_lead(uuid, uuid)') is null then
    raise exception 'agent_can_take_pool_lead does not exist; apply 20260925700000 before this file';
  end if;

  select pg_get_functiondef('public.serve_next_lead(uuid, uuid)'::regprocedure) into v_serve;
  select pg_get_functiondef('public.serve_lead_by_id(uuid, uuid, uuid)'::regprocedure) into v_pick;
  select pg_get_functiondef('public.dialer_queue_preview(uuid, uuid, integer[], integer, integer)'::regprocedure) into v_preview;

  if strpos(v_pick, 'agent_can_take_pool_lead(p_tenant_id, p_agent_user_id)') = 0 or strpos(v_pick, 'at_capacity') = 0 then
    raise exception 'serve_lead_by_id does not refuse a pool pick at capacity';
  end if;
  if strpos(v_preview, 'q.status <> ''unclaimed'' or v_pool_ok') = 0 then
    raise exception 'dialer_queue_preview offers pool leads to an agent at capacity';
  end if;

  -- The tier CASE is still serve_next_lead's in the pick and the list, and every gate is there.
  v_serve_case := substring(
    regexp_replace(regexp_replace(v_serve, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
    from 'case when l\.posted_at is not null.*?end as priority');
  if v_serve_case is null then raise exception 'could not find the tier CASE in serve_next_lead'; end if;
  foreach v_fn in array array['serve_lead_by_id', 'dialer_queue_preview'] loop
    v_body := case v_fn when 'serve_lead_by_id' then v_pick else v_preview end;
    if strpos(regexp_replace(regexp_replace(v_body, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), v_serve_case) = 0 then
      raise exception '%: its tier CASE differs from serve_next_lead''s', v_fn;
    end if;
    if strpos(v_body, 'campaigns_servable') = 0 or strpos(v_body, 'is_phone_suppressed(p_tenant_id') = 0
       or strpos(v_body, 'tenant_can_dial_now(p_tenant_id') = 0 or strpos(v_body, 'agent_may_work_state(p_tenant_id, p_agent_user_id') = 0
       or strpos(v_body, 'lead_state <> ''exhausted''') = 0 or strpos(v_body, 'lead_queue_assignee(p_tenant_id') = 0 then
      raise exception '%: a serving gate is missing', v_fn;
    end if;
  end loop;

  raise notice '20260925700010: the pick and the queue list leave the pool alone for an agent at capacity';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925700010', 'dialer_pick_and_list_respect_agent_capacity') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/18] 20260925700100_dialer_lead_return_window.sql ──────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Dialer · Wrong number and Disconnected say whether the lead can go back to its vendor
--
-- User decision (2026-09-25): the dialer offers Wrong number and Disconnected as built-in outcomes.
-- Both close the lead (disposition_default_ends_call, 20260924140000). A lead bought from a vendor
-- campaign, still inside that vendor's return window, is then CLAIMABLE: vendor_claimable_leads
-- (20260913440000) already derives that from the attempt's disposition, so recording the outcome is
-- what marks it — there is no second flag to keep in step.
--
-- What was missing is the sentence the agent reads before recording it: "Claimable from DataLeads ·
-- 11 days left", or "Not claimable: <reason>". lead_return_window answers it with the SAME
-- arithmetic vendor_claimable_leads uses — the lead's created_at plus the vendor's
-- return_window_days, and a lead already on a claim is not claimable again — so the confirm line
-- and the Returns screen cannot disagree.
--
--   reason (null when claimable):
--     no_campaign       the lead did not come from a vendor campaign
--     no_return_window  the vendor's return window is 0 days
--     window_closed     the window has passed
--     already_claimed   the lead is already on a return claim — by lead, or (20260925703200) its
--                       number was already claimed from this campaign as an import removal
--
-- Read-only (STABLE). Additive: a new function, nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.lead_return_window(p_tenant_id uuid, p_lead_id uuid)
returns table(
  campaign_id uuid,
  campaign_name text,
  vendor_name text,
  return_window_days integer,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_lead record;
  v_until timestamptz;
  v_claimed boolean;
begin
  select l.id, l.created_at, c.id as cid, c.name as cname, v.name as vname, v.return_window_days as days,
         coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone') as phone
    into v_lead
    from public.agent_leads l
    left join public.tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
    left join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    return;
  end if;

  if v_lead.cid is null or v_lead.vname is null then
    return query select null::uuid, null::text, null::text, null::integer, null::timestamptz, null::integer, false, 'no_campaign'::text;
    return;
  end if;

  v_until := v_lead.created_at + make_interval(days => coalesce(v_lead.days, 0));
  select exists (
    select 1 from public.lead_claim_items i join public.lead_claims cl on cl.id = i.claim_id
     where i.tenant_id = p_tenant_id and i.lead_id = p_lead_id
  ) into v_claimed;

  -- One number, one claim (20260925703200): a number this campaign already claimed as an IMPORT
  -- REMOVAL (a claim item with scrub_rejection_id and no lead_id) is not claimable again, exactly as
  -- vendor_claimable_leads excludes it. That column arrives with 20260925703200, which may not be
  -- applied yet, so it is looked for first and the match runs through EXECUTE: this function
  -- creates and answers either way, and picks the check up as soon as the column exists.
  if not v_claimed and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'scrub_rejection_id'
  ) then
    execute $q$
      select exists (
        select 1 from public.lead_claim_items ri
          join public.tenant_campaign_scrub_rejections r on r.id = ri.scrub_rejection_id
         where ri.tenant_id = $1
           and r.tenant_id = $1
           and r.campaign_id = $2
           and r.phone_digits = right(regexp_replace(coalesce($3, ''), '[^0-9]', '', 'g'), 10)
      )$q$
      into v_claimed
      using p_tenant_id, v_lead.cid, v_lead.phone;
  end if;

  return query select
    v_lead.cid, v_lead.cname, v_lead.vname, coalesce(v_lead.days, 0), v_until,
    greatest(0, floor(extract(epoch from (v_until - now())) / 86400))::integer,
    (coalesce(v_lead.days, 0) > 0 and v_until > now() and not v_claimed),
    case
      when coalesce(v_lead.days, 0) = 0 then 'no_return_window'
      when v_claimed then 'already_claimed'
      when v_until <= now() then 'window_closed'
    end::text;
end;
$function$;

revoke all on function public.lead_return_window(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lead_return_window(uuid, uuid) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_lead record;
  v_row record;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.lead_return_window(uuid, uuid)'::regprocedure) into v_def;
  -- The Returns screen's arithmetic, not a second opinion.
  if strpos(v_def, 'created_at + make_interval(days =>') = 0 or strpos(v_def, 'lead_claim_items') = 0 then
    raise exception 'lead_return_window no longer computes the window as vendor_claimable_leads does';
  end if;
  -- An import-removal claim of the same number counts as already claimed (20260925703200).
  if strpos(v_def, 'ri.scrub_rejection_id') = 0 or strpos(v_def, 'r.phone_digits = right(') = 0 then
    raise exception 'lead_return_window ignores import-removal claims of the same number';
  end if;
  -- The derived claim still reads these two outcomes, which is what "marks it claimable".
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), '''wrong_number'', ''disconnected''') = 0 then
    raise exception 'vendor_claimable_leads no longer reads wrong_number / disconnected attempts';
  end if;
  if public.disposition_default_ends_call('wrong_number') is not true or public.disposition_default_ends_call('disconnected') is not true then
    raise exception 'wrong_number / disconnected no longer close the lead by default';
  end if;

  -- A real lead answers exactly one row, with a reason exactly when it is not claimable.
  select l.tenant_id, l.id into v_lead from public.agent_leads l limit 1;
  if v_lead.id is not null then
    select * into v_row from public.lead_return_window(v_lead.tenant_id, v_lead.id);
    if v_row.claimable is null then raise exception 'lead_return_window returned no row for a real lead'; end if;
    if v_row.claimable = (v_row.reason is not null) then
      raise exception 'lead_return_window: claimable and reason disagree (%, %)', v_row.claimable, v_row.reason;
    end if;
  end if;
  if not has_function_privilege('tenant_app', 'public.lead_return_window(uuid, uuid)', 'execute') then
    raise exception 'tenant_app cannot execute lead_return_window';
  end if;
  raise notice '20260925700100: lead_return_window answers whether a wrong number can go back to its vendor';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925700100', 'dialer_lead_return_window') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/18] 20260925700200_dialer_suppression_hits_at_dial.sql ────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Dialer · every stored suppression list is re-checked at the dial, one row per list
--
-- The dial gate (getDialerEligibility → is_tenant_phone_suppressed, 20260924340000) read ONLY the
-- agency's own list, tenant_do_not_call. The scrub results — TCPA litigator, federal DNC, state DNC
-- and invalid numbers, stored in tenant_suppression_list by the import scrub and the campaign
-- scrub — stopped a lead from being SERVED (is_phone_suppressed, in serve_next_lead) but were never
-- asked again when the agent dialled, so a lead opened another way (the search path, or a lead that
-- was served before its number was scrubbed) reached the dial with a litigator hit on file.
--
-- User decision (2026-09-25): the dial re-checks every stored list, and a hit refuses the dial with
-- the list named. tenant_phone_suppression_hits returns one row per list the number is on, so the
-- dialer can both refuse by name and show the stack. No vendor is called: these are the stored
-- results (the live per-dial litigator lookup was declined — it costs a fee per dial).
--
-- Same number normalisation as is_phone_suppressed / is_tenant_phone_suppressed: digits only, a
-- leading 1 dropped from eleven digits.
--
-- Read-only (STABLE). Additive: a new function, nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_phone_suppression_hits(p_tenant_id uuid, p_phone text)
returns table(list_type text, reason text, source text, added_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with d as (
    select case when length(x.digits) = 11 and left(x.digits, 1) = '1' then right(x.digits, 10) else x.digits end as digits
      from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) x
  )
  select t.list_type, t.reason, t.source, t.added_at
    from (
      select 'internal'::text as list_type, dnc.reason, 'disposition'::text as source, dnc.created_at as added_at
        from public.tenant_do_not_call dnc, d
       where dnc.tenant_id = p_tenant_id and dnc.is_active and dnc.phone_digits = d.digits
      union all
      select s.list_type, s.reason, s.source, s.added_at
        from public.tenant_suppression_list s, d
       where s.tenant_id = p_tenant_id and s.phone_digits = d.digits
    ) t
   order by case t.list_type when 'tcpa_litigator' then 0 when 'federal_dnc' then 1 when 'state_dnc' then 2 when 'internal' then 3 else 4 end,
            t.added_at;
$function$;

revoke all on function public.tenant_phone_suppression_hits(uuid, text) from public, anon, authenticated;
grant execute on function public.tenant_phone_suppression_hits(uuid, text) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_row record;
  v_n integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- Every number the serving gate refuses is a hit here too, for both tables.
  select s.tenant_id, s.phone_digits, s.list_type into v_row from public.tenant_suppression_list s limit 1;
  if v_row.tenant_id is not null then
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_row.tenant_id, '+1' || v_row.phone_digits) h where h.list_type = v_row.list_type;
    if v_n <> 1 then raise exception 'tenant_phone_suppression_hits misses a % scrub hit', v_row.list_type; end if;
  end if;
  select t.tenant_id, t.phone_digits into v_row from public.tenant_do_not_call t where t.is_active limit 1;
  if v_row.tenant_id is not null then
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_row.tenant_id, v_row.phone_digits) h where h.list_type = 'internal';
    if v_n < 1 then raise exception 'tenant_phone_suppression_hits misses the agency''s own list'; end if;
  end if;
  select count(*) into v_n from public.tenant_phone_suppression_hits(gen_random_uuid(), '5555550100');
  if v_n <> 0 then raise exception 'tenant_phone_suppression_hits reports a hit for an unknown tenant'; end if;
  if not has_function_privilege('tenant_app', 'public.tenant_phone_suppression_hits(uuid, text)', 'execute') then
    raise exception 'tenant_app cannot execute tenant_phone_suppression_hits';
  end if;
  raise notice '20260925700200: the dial can re-check every stored suppression list';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925700200', 'dialer_suppression_hits_at_dial') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/18] 20260925700300_dialer_callback_inside_the_calling_window.sql ──────────
begin;

-- ---------------------------------------------------------------------------
-- Dialer · a callback booked from the dialer is inside the customer's calling window
--
-- Appointments audit (2026-09-25). complete_dial_disposition_with_callback (20260923170000, its only
-- definition) applied the wizard's future-time, timezone and assignee rules but not the calling
-- window. The route checked the window first in TypeScript (checkCallbackInCallingWindow), so the
-- screen was right — but the function is the one place every caller passes through, and the
-- wizard's own booking paths already refuse an out-of-window time in SQL
-- (assert_callback_in_window, 20260913360000). A caller that skipped the route could book 3am.
--
-- Restated in full from 20260923170000 with ONE line added, after the past-time check and before
-- anything is written:
--
--     perform public.assert_callback_in_window(p_tenant_id, v_attempt.lead_id, v_scheduled_at);
--
-- which raises CALLBACK_NO_STATE or CALLBACK_OUTSIDE_WINDOW. Both roll the whole call back, so a
-- refused time costs no attempt. The route words both codes. Same signature, same grants
-- (service_role only).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.assert_callback_in_window(uuid, uuid, timestamp with time zone)') is null then
    raise exception 'assert_callback_in_window does not exist; apply 20260913360000 before this file';
  end if;
end $$;

create or replace function public.complete_dial_disposition_with_callback(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_callback_local timestamp without time zone,
  p_customer_timezone text,
  p_assigned_to uuid default null,
  p_callback_note text default null,
  p_idempotency_key text default null,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.tenant_call_attempts;
  v_existing public.tenant_callbacks;
  v_callback public.tenant_callbacks;
  v_assignee uuid;
  v_scheduled_at timestamptz;
  v_result record;
begin
  select * into v_attempt
    from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.work_item_id is null then raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING'; end if;

  -- Idempotency first, and it returns without dispositioning. A retried request must not spend a
  -- second attempt on the lead's cadence just because the first response was lost.
  if p_idempotency_key is not null then
    select c.* into v_existing
      from public.tenant_callbacks c
     where c.tenant_id = p_tenant_id and c.idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'callback_id', v_existing.id,
        'scheduled_at_utc', v_existing.scheduled_at_utc,
        'status', v_existing.status,
        'duplicate', true);
    end if;
  end if;

  -- The wizard's rules, applied identically. Cheap, and every one of them fails before a write.
  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  if not exists (select 1 from pg_timezone_names where name = btrim(p_customer_timezone)) then
    raise exception 'CALLBACK_TIMEZONE_INVALID';
  end if;
  v_scheduled_at := p_callback_local at time zone btrim(p_customer_timezone);
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  -- 20260925700300: the customer's calling window at the booked instant, as the wizard's paths
  -- check it. Raises CALLBACK_NO_STATE / CALLBACK_OUTSIDE_WINDOW before anything is written.
  perform public.assert_callback_in_window(p_tenant_id, v_attempt.lead_id, v_scheduled_at);
  if p_callback_note is not null
     and (char_length(btrim(p_callback_note)) < 1 or char_length(btrim(p_callback_note)) > 1000) then
    raise exception 'CALLBACK_NOTE_INVALID';
  end if;

  v_assignee := coalesce(p_assigned_to, p_agent_user_id);
  if not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = v_assignee
       and tu.accepted_at is not null and u.status::text = 'active'
  ) then raise exception 'CALLBACK_ASSIGNEE_INVALID'; end if;

  -- The call itself: attempt row, attempts_made, lead state, work item, and the pipeline routing
  -- added in 20260923160000. Unchanged, and still the only thing that records the call.
  select * into v_result
    from public.complete_existing_dial_disposition(
      p_tenant_id, p_attempt_id, p_agent_user_id, 'callback_scheduled',
      p_dial_clicked_at, p_provider_call_id);

  insert into public.tenant_callbacks
    (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by, idempotency_key)
  values
    (p_tenant_id, v_attempt.lead_id, v_attempt.work_item_id, v_scheduled_at, btrim(p_customer_timezone),
     v_assignee, nullif(btrim(p_callback_note), ''), 'scheduled', p_agent_user_id, p_idempotency_key)
  returning * into v_callback;

  insert into public.callback_history
    (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note)
  values
    (p_tenant_id, v_callback.id, v_attempt.lead_id, p_agent_user_id, 'scheduled',
     v_callback.scheduled_at_utc, v_callback.status, v_callback.note);

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.callback_scheduled', 'callback', v_callback.id::text,
          jsonb_build_object('leadId', v_callback.lead_id, 'workItemId', v_callback.work_item_id,
                             'scheduledAtUtc', v_callback.scheduled_at_utc,
                             'customerTimezone', v_callback.customer_timezone,
                             'source', 'dialer', 'attemptId', p_attempt_id));

  return jsonb_build_object(
    'lead_state', v_result.lead_state,
    'reason', v_result.reason,
    'callback_id', v_callback.id,
    'scheduled_at_utc', v_callback.scheduled_at_utc,
    'customer_timezone', v_callback.customer_timezone,
    'assigned_to', v_callback.assigned_to,
    'duplicate', false);
end;
$function$;

revoke all on function public.complete_dial_disposition_with_callback(uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text, timestamptz, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.complete_dial_disposition_with_callback(uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text, timestamptz, text)
  to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition_with_callback';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_dial_disposition_with_callback, found %', v_count;
  end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition_with_callback';

  if strpos(v_src, 'assert_callback_in_window(p_tenant_id, v_attempt.lead_id, v_scheduled_at)') = 0 then
    raise exception 'the dialer callback path does not check the calling window';
  end if;
  -- The window is checked before the call is recorded, so a refusal costs no attempt.
  if strpos(v_src, 'assert_callback_in_window') > strpos(v_src, 'complete_existing_dial_disposition') then
    raise exception 'the window is checked after the call was recorded';
  end if;
  -- Everything 20260923170000 asserted still holds.
  if strpos(v_src, 'insert into public.tenant_callbacks') = 0 or strpos(v_src, 'complete_existing_dial_disposition') = 0 then
    raise exception 'the dialer callback path lost its callback write or its call record';
  end if;
  if strpos(v_src, 'CALLBACK_DATE_PAST') = 0 or strpos(v_src, 'CALLBACK_TIMEZONE_INVALID') = 0 or strpos(v_src, 'CALLBACK_ASSIGNEE_INVALID') = 0 then
    raise exception 'the dialer callback path validates less than the wizard does';
  end if;
  if has_function_privilege('tenant_app', 'public.complete_dial_disposition_with_callback(uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text, timestamp with time zone, text)', 'execute') then
    raise exception 'complete_dial_disposition_with_callback is executable by tenant_app again';
  end if;
  raise notice '20260925700300: a dialer callback must fall inside the customer''s calling window';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925700300', 'dialer_callback_inside_the_calling_window') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/18] 20260925701000_scoring_cohort_stats_since.sql ─────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Queue scoring · "Is it working?" over the last 14 days, not only since the beginning
--
-- `tenant_scoring_cohort_stats` (20260913390000) is all-time: one row per cohort since the first
-- serve ever recorded. The concept board (LA-2 §13) reads the comparison over "last 14 days", and
-- the user chose a 14-day default with an all-time toggle. An all-time figure also hides a change
-- of weights: the arm totals keep the dials served under the old weights for as long as the tenant
-- exists.
--
-- `tenant_scoring_cohort_stats_since(tenant, from)` is the same aggregate with a lower bound on
-- served_at. `p_from` null is all-time and returns exactly what the view returns for the two
-- experiment arms. The 'picked' cohort (a lead an agent chose by hand, 20260924323100) is left out
-- on purpose: it is on neither side of the holdout comparison.
--
-- Read-only, STABLE. The index tenant_scoring_decisions_tenant_served_idx (tenant_id, served_at
-- desc) already serves the range.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_scoring_cohort_stats_since(
  p_tenant_id uuid,
  p_from timestamptz default null
)
returns table(
  cohort text,
  served bigint,
  contacted bigint,
  contact_rate_pct numeric,
  average_score numeric,
  since timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select d.cohort,
         count(*) as served,
         count(d.contacted_at) as contacted,
         case when count(*) > 0
              then round(100.0 * count(d.contacted_at) / count(*), 1) end as contact_rate_pct,
         round(avg(d.score), 2) as average_score,
         min(d.served_at) as since
    from public.tenant_scoring_decisions d
   where d.tenant_id = p_tenant_id
     and d.cohort in ('scored', 'control')
     and (p_from is null or d.served_at >= p_from)
   group by d.cohort;
$function$;

revoke all on function public.tenant_scoring_cohort_stats_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_scoring_cohort_stats_since(uuid, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_mismatch integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925701000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.tenant_scoring_cohort_stats_since(uuid, timestamp with time zone)') is null then
    raise exception '20260925701000: tenant_scoring_cohort_stats_since is missing';
  end if;
  if not has_function_privilege('tenant_app', 'public.tenant_scoring_cohort_stats_since(uuid, timestamp with time zone)', 'execute') then
    raise exception '20260925701000: tenant_app cannot execute tenant_scoring_cohort_stats_since';
  end if;

  -- All-time must be the view, arm for arm, for the tenant with the most decisions.
  select d.tenant_id into v_tenant
    from public.tenant_scoring_decisions d
   group by d.tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice '20260925701000: no scoring decisions yet; the comparison with the view was skipped';
    return;
  end if;

  select count(*) into v_mismatch
    from (select s.cohort, s.served, s.contacted
            from public.tenant_scoring_cohort_stats s
           where s.tenant_id = v_tenant and s.cohort in ('scored', 'control')) v
    full join public.tenant_scoring_cohort_stats_since(v_tenant, null) f on f.cohort = v.cohort
   where v.served is distinct from f.served or v.contacted is distinct from f.contacted;
  if v_mismatch > 0 then
    raise exception '20260925701000: all-time cohort stats differ from tenant_scoring_cohort_stats (% arms)', v_mismatch;
  end if;

  raise notice '20260925701000: tenant_scoring_cohort_stats_since matches the all-time view';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925701000', 'scoring_cohort_stats_since') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/18] 20260925701100_scoring_queue_preview.sql ──────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Queue scoring · "Preview the queue": next up and why, and who is held back
--
-- The concept board (LA-2 §13) shows, on the scoring screen, the leads the scorer would hand an
-- agent next with the reasons for each, and the leads that are due but held back by the calling
-- window ("7:12am her time, Oregon opens at 8. Enters the queue in 48 minutes"). Nothing could
-- answer that: the only list, dialer_queue_preview (20260924323100), is in tier order with no score
-- and no reason, and every queue query drops an out-of-window lead without saying so.
--
-- scoring_queue_preview(tenant, agent, limit) returns, for ONE chosen agent (user decision: the
-- preview is per agent, because what Serve next hands out depends on the agent's own assigned
-- leads, the states they may work and — once the Dialer builder lands it — their capacity):
--
--   rows       up to `limit` (default 25, at most 50) servable leads, in the order serve_next_lead's
--              path would take them. Scoring on: tier first, then score, over the same 50-candidate
--              retrieval (newest first within the tier) restricted to the scored cohort, falling
--              back to the whole pool when the scored cohort has nothing servable — exactly as
--              serve_next_lead does. Scoring off: tier, then oldest first (the plain order). Each row
--              carries the tier reason serve_next_lead writes, score_lead's reasons and the score.
--   held_back  up to 10 leads that pass every serving gate EXCEPT the calling window, with
--              tenant_dial_window's reason code and, when the window has not opened yet today, the
--              minutes until it does. Soonest first.
--   counts, the effective total weight (so the screen can show score / total weight as 0–1), and
--   whether the capacity gate was applied.
--
-- READ-ONLY. STABLE, no claim, no reclaim, and no tenant_scoring_decisions row: a preview that
-- recorded a decision would put leads nobody dialled on one side of the holdout comparison.
--
-- WHAT IT CANNOT MIRROR, and the screen says so: serve_next_lead breaks ties within a tier with a
-- weighted random draw over the campaign mixing weights, and draws the holdout per serve by coin
-- flip; a preview has neither. It also does not run serve_next_lead's reclaim, so a lead whose lock
-- lapsed a moment ago appears once the next serve releases it.
--
-- THE GATES are serve_next_lead's, from its latest body (20260924323000): pool or assigned-to-you,
-- a servable campaign, not suppressed, inside the calling window, not exhausted, a state the agent
-- may work. The tier CASE is copied character for character and compared with the live body below.
--
-- THE CAPACITY GATE. 20260925700000 restates serve_next_lead so an agent at their open-lead ceiling
-- is not handed UNCLAIMED POOL leads (their own assigned leads still are), through
-- public.agent_can_take_pool_lead(tenant, user), read once per serve as `v_pool_ok`. That file is
-- another session's and may not be applied first, and a static call to a missing function fails
-- when the statement is planned, so the helper is looked up with to_regprocedure and called with
-- EXECUTE only when present. It depends on the agent alone, so one call per preview answers it for
-- every pool row — the same shape as serve_next_lead's `(q.status <> 'unclaimed' or v_pool_ok)`.
--
-- The calling window is evaluated once per distinct (state, campaign) rather than once per row. The
-- answer is a function of (tenant, state, campaign, instant) only, so the result is the same as
-- serve_next_lead's per-row predicate, at a fraction of the cost, and the explainer runs only for
-- the combinations that are closed.
--
-- Requires 20260924323000 (lead_queue_assignee), 20260924220200 (agent_may_work_state) and
-- 20260924323200 (tenant_dial_window).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.lead_queue_assignee(uuid, uuid)') is null then
    raise exception 'lead_queue_assignee does not exist; apply 20260924323000 before this file';
  end if;
  if to_regprocedure('public.agent_may_work_state(uuid, uuid, text)') is null then
    raise exception 'agent_may_work_state does not exist; apply 20260924220200 before this file';
  end if;
  if to_regprocedure('public.tenant_dial_window(uuid, text, uuid, timestamp with time zone)') is null then
    raise exception 'tenant_dial_window does not exist; apply 20260924323200 before this file';
  end if;
end $$;

create or replace function public.scoring_queue_preview(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
              and lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id)
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

revoke all on function public.scoring_queue_preview(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.scoring_queue_preview(uuid, uuid, integer) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_serve text;
  v_preview text;
  v_preview_flat text;
  v_serve_case text;
  v_tenant uuid;
  v_agent uuid;
  v_out jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925701100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.serve_next_lead(uuid, uuid)'::regprocedure) into v_serve;
  select pg_get_functiondef('public.scoring_queue_preview(uuid, uuid, integer)'::regprocedure) into v_preview;
  v_preview_flat := regexp_replace(regexp_replace(v_preview, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');

  -- The tier CASE, comments dropped and whitespace normalised, must be the live serving function's.
  v_serve_case := substring(
    regexp_replace(regexp_replace(v_serve, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
    from 'case when l\.posted_at is not null.*?end as priority');
  if v_serve_case is null then
    raise exception '20260925701100: could not find the tier CASE in serve_next_lead';
  end if;
  if strpos(v_preview_flat, v_serve_case) = 0 then
    raise exception '20260925701100: scoring_queue_preview''s tier CASE differs from serve_next_lead''s';
  end if;

  -- Every gate serving applies.
  if strpos(v_preview, 'campaigns_servable') = 0 or strpos(v_preview, 'is_phone_suppressed(p_tenant_id') = 0
     or strpos(v_preview, 'tenant_can_dial_now(p_tenant_id') = 0 or strpos(v_preview, 'agent_may_work_state(p_tenant_id, p_agent_user_id') = 0
     or strpos(v_preview, 'lead_state <> ''exhausted''') = 0 or strpos(v_preview, 'lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id') = 0
     or strpos(v_preview, 'hashtextextended(q.lead_id::text, 42)') = 0 then
    raise exception '20260925701100: a serving gate is missing from scoring_queue_preview';
  end if;
  -- When Serve next applies the capacity gate, the preview must be able to.
  if strpos(v_serve, 'agent_can_take_pool_lead') > 0 and strpos(v_preview, 'agent_can_take_pool_lead') = 0 then
    raise exception '20260925701100: serve_next_lead applies the capacity gate and the preview does not';
  end if;

  -- Read-only: no statement that writes, and STABLE.
  if v_preview_flat ~* '\m(insert\s+into|delete\s+from|update\s+[a-z_]+\s+(q|l|d)?\s*set)\M' then
    raise exception '20260925701100: scoring_queue_preview writes; it must be read-only';
  end if;
  if (select provolatile from pg_proc where oid = 'public.scoring_queue_preview(uuid, uuid, integer)'::regprocedure) <> 's' then
    raise exception '20260925701100: scoring_queue_preview is not STABLE';
  end if;
  if not has_function_privilege('tenant_app', 'public.scoring_queue_preview(uuid, uuid, integer)', 'execute') then
    raise exception '20260925701100: tenant_app cannot execute scoring_queue_preview';
  end if;

  -- One real run, for the tenant with the most queued leads and one of its dialing members.
  select q.tenant_id into v_tenant from public.lead_queue q group by q.tenant_id order by count(*) desc limit 1;
  if v_tenant is not null then
    select tu.user_id into v_agent from public.tenant_users tu
     where tu.tenant_id = v_tenant and tu.role in ('owner', 'producer', 'setter') and tu.accepted_at is not null
     limit 1;
  end if;
  if v_agent is null then
    raise notice '20260925701100: no queued tenant with a dialing member; the live run was skipped';
  else
    v_out := public.scoring_queue_preview(v_tenant, v_agent, 5);
    if jsonb_typeof(v_out->'rows') <> 'array' or jsonb_typeof(v_out->'held_back') <> 'array'
       or v_out->'total_weight' is null or jsonb_array_length(v_out->'rows') > 5 then
      raise exception '20260925701100: scoring_queue_preview returned an unexpected shape: %', left(v_out::text, 400);
    end if;
  end if;

  raise notice '20260925701100: scoring_queue_preview mirrors serve_next_lead''s tiers and gates and writes nothing';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925701100', 'scoring_queue_preview') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/18] 20260925702000_agent_licence_expiry.sql ───────────────────────────────
begin;

-- Team & access › Licensed in: a personal licence can expire.
--
-- tenant_user_licensed_states (20260924110000) records WHICH states a person is licensed in, and
-- nothing about until when. An agent whose Ohio licence lapsed kept being handed, and served, Ohio
-- leads until an owner remembered to untick the box. This file:
--
--   tenant_user_licensed_states.expires_on   the date the person's own licence in that state lapses;
--                                            null = no expiry recorded. The licence counts THROUGH
--                                            that day and stops counting the day after, as the
--                                            agency licence (licenses.expires_at) does.
--   set_tenant_user_licensed_states          restated: a save that keeps a state keeps its expiry.
--                                            It used to delete every row and re-insert, which
--                                            would silently wipe every expiry on each save.
--   set_tenant_user_licensed_states_with_expiry   the Team & access editor's save: states + dates.
--   assignment_candidate_is_eligible / assignment_ineligibility_reason   restated from their
--       latest definition (20260924310000). An expired personal state is NOT held.
--   agent_may_work_state                     restated from its latest definition (20260924220200):
--       the dialer applies the same rule, so an agent is not served a lead in a state they may no
--       longer be handed.
--
-- One subtlety, stated where it is enforced: "any states recorded?" still counts the expired rows.
-- An agent whose only recorded state has lapsed must not fall back to "judge me on the agency" —
-- that would turn a lapse into MORE reach, not less.
--
-- Additive and idempotent. Signatures, return types and grants are unchanged for every restated
-- function. Nothing existing becomes invalid: every row has no expiry.

-- ── schema ────────────────────────────────────────────────────────────────
alter table public.tenant_user_licensed_states add column if not exists expires_on date;
create index if not exists tenant_user_licensed_states_expiry_idx
  on public.tenant_user_licensed_states (expires_on) where expires_on is not null;

-- ── saves ─────────────────────────────────────────────────────────────────
-- Same signature and return as 20260924110000. A state that stays keeps its row, and so its expiry.
create or replace function public.set_tenant_user_licensed_states(p_tenant_id uuid, p_user_id uuid, p_states text[])
returns setof text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_states text[];
begin
  if not exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id) then
    raise exception 'member_not_found';
  end if;
  select coalesce(array_agg(distinct upper(btrim(x))), '{}'::text[]) into v_states
    from unnest(coalesce(p_states, '{}')) as x where btrim(x) <> '';
  delete from public.tenant_user_licensed_states s
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and not (s.state = any(v_states));
  insert into public.tenant_user_licensed_states (tenant_id, user_id, state)
  select p_tenant_id, p_user_id, x from unnest(v_states) as x
  on conflict (tenant_id, user_id, state) do nothing;
  return query select s.state from public.tenant_user_licensed_states s
    where s.tenant_id = p_tenant_id and s.user_id = p_user_id order by s.state;
end;
$$;
revoke all on function public.set_tenant_user_licensed_states(uuid, uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.set_tenant_user_licensed_states(uuid, uuid, text[]) to service_role;

-- p_rows: [{ "state": "OH", "expires_on": "2026-10-04" | null }]. Replaces the person's list whole,
-- in one statement, so the router never reads half of it.
create or replace function public.set_tenant_user_licensed_states_with_expiry(p_tenant_id uuid, p_user_id uuid, p_rows jsonb)
returns table (state text, expires_on date)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row jsonb;
  v_state text;
  v_date date;
  v_states text[] := '{}'::text[];
  v_dates date[] := '{}'::date[];
begin
  if not exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id) then
    raise exception 'member_not_found';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then
    raise exception 'invalid_licensed_states' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_state := upper(btrim(coalesce(v_row->>'state', '')));
    if v_state !~ '^[A-Z]{2}$' then raise exception 'invalid_licensed_states' using errcode = '22023'; end if;
    v_date := case when jsonb_typeof(v_row->'expires_on') = 'string' and btrim(v_row->>'expires_on') <> ''
                   then (v_row->>'expires_on')::date end;
    if v_state = any(v_states) then continue; end if;
    v_states := v_states || v_state;
    v_dates := v_dates || v_date;
  end loop;

  delete from public.tenant_user_licensed_states s
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and not (s.state = any(v_states));
  insert into public.tenant_user_licensed_states as s (tenant_id, user_id, state, expires_on)
  select p_tenant_id, p_user_id, x.state, x.expires_on
    from unnest(v_states, v_dates) as x(state, expires_on)
  on conflict on constraint tenant_user_licensed_states_pkey do update set expires_on = excluded.expires_on;

  return query select s.state, s.expires_on from public.tenant_user_licensed_states s
    where s.tenant_id = p_tenant_id and s.user_id = p_user_id order by s.state;
end;
$$;
revoke all on function public.set_tenant_user_licensed_states_with_expiry(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.set_tenant_user_licensed_states_with_expiry(uuid, uuid, jsonb) to service_role;

-- ── eligibility ───────────────────────────────────────────────────────────
-- Restated from 20260924310000. The only change in each function is the personal-state clause:
-- a recorded state counts while its expires_on is null or today or later.
create or replace function public.assignment_candidate_is_eligible(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;
  if p_requires_licensed and p_role = 'setter' then return false; end if;
  if p_role = 'setter' then return true; end if;
  if v_state = '' then return false; end if;

  return
    exists (
      select 1 from public.licenses l
       where l.tenant_id = p_tenant_id
         and upper(btrim(l.state)) = v_state
         and (l.expires_at is null or l.expires_at >= current_date)
    )
    and exists (
      select 1
        from public.appointments a
        join public.tenant_carriers tc
          on tc.tenant_id = a.tenant_id
         and tc.carrier_id = a.carrier_id
         and tc.is_active
       where a.tenant_id = p_tenant_id
         and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and (a.expires_at is null or a.expires_at >= current_date)
    )
    -- The agent's own states, when any are recorded (expired rows still count as "recorded", so a
    -- lapse never widens reach back to the agency's). New: a lapsed personal state is not held.
    and (
      not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s
                  where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state
                    and (s.expires_on is null or s.expires_on >= current_date))
    );
end;
$function$;

create or replace function public.assignment_ineligibility_reason(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_licensed boolean;
  v_appointed boolean;
  v_agent_ok boolean;
  v_lapsed date;
begin
  if p_role not in ('owner', 'producer', 'setter') then
    return format('A %s cannot be given leads to work.', coalesce(p_role, 'member with no role'));
  end if;
  if p_requires_licensed and p_role = 'setter' then
    return 'This lead needs a licensed agent, and a setter cannot write business.';
  end if;
  if p_role = 'setter' then return null; end if;
  if v_state = '' then
    return 'This lead has no state on it, so there is no way to tell who is licensed to work it.';
  end if;

  select exists (
    select 1 from public.licenses l
     where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state
       and (l.expires_at is null or l.expires_at >= current_date)
  ) into v_licensed;

  select exists (
    select 1 from public.appointments a
      join public.tenant_carriers tc
        on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
     where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
       and a.status = 'active'
       and (a.effective_from is null or a.effective_from <= current_date)
       and (a.terminated_at is null or a.terminated_at >= current_date)
       and (a.expires_at is null or a.expires_at >= current_date)
  ) into v_appointed;

  select not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s
                  where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state
                    and (s.expires_on is null or s.expires_on >= current_date))
    into v_agent_ok;

  if v_licensed and v_appointed and v_agent_ok then return null; end if;

  if not v_licensed and not v_appointed then
    return format(
      'Your agency %s for %s and has no active carrier appointment there. Both are needed before anyone can be given a %s lead.',
      case when exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state)
           then 'has an expired licence' else 'has no licence on record' end,
      v_state, v_state);
  end if;
  if not v_licensed then
    if exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state) then
      return format('Your agency''s %s licence has expired. Renew it on States & licences before working %s leads.', v_state, v_state);
    end if;
    return format('Your agency has no %s licence on record. Add it on States & licences before working %s leads.', v_state, v_state);
  end if;
  if not v_appointed then
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and a.expires_at < current_date
    ) then
      return format('Your agency''s carrier appointment in %s has expired, so nothing can be written there. Renew it on Appointments & licences.', v_state);
    end if;
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'pending'
    ) then
      return format('Your agency''s carrier appointment in %s is still pending with the carrier. %s leads can be worked once it is active.', v_state, v_state);
    end if;
    return format('Your agency is licensed in %s but has no active carrier appointment there, so nothing can be written. Add one on States & licences.', v_state);
  end if;
  -- New: the person's own licence in the state is recorded and has lapsed.
  select s.expires_on into v_lapsed from public.tenant_user_licensed_states s
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state and s.expires_on < current_date;
  if v_lapsed is not null then
    return format('This agent''s own %s licence expired on %s. Record the renewal on Team & access, or give the lead to someone licensed there.',
                  v_state, to_char(v_lapsed, 'FMDD Mon YYYY'));
  end if;
  return format('This agent is not licensed in %s. Add %s to their licensed states on Team & access, or give the lead to someone who is.', v_state, v_state);
end;
$function$;

revoke all on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  to service_role;
revoke all on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  to service_role;

-- ── the dialer's rule ─────────────────────────────────────────────────────
-- Restated from 20260924220200 (no later file redefines it; 20260925700000 and 20260925701100 only
-- call it). Same signature, language, volatility and grants. The only change is the personal-state
-- clause, identical to the router's above.
create or replace function public.agent_may_work_state(p_tenant_id uuid, p_user_id uuid, p_state text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with member as (
    select tu.role::text as role
      from public.tenant_users tu
     where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id
  ), wanted as (
    select upper(btrim(coalesce(p_state, ''))) as state
  )
  select coalesce((
    select case
      when m.role = 'setter' then true
      when m.role not in ('owner', 'producer') then false
      when w.state = '' then false
      else exists (
             select 1 from public.licenses l
              where l.tenant_id = p_tenant_id
                and upper(btrim(l.state)) = w.state
                and (l.expires_at is null or l.expires_at >= current_date)
           )
           and (
             not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
             or exists (select 1 from public.tenant_user_licensed_states s
                         where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = w.state
                           and (s.expires_on is null or s.expires_on >= current_date))
           )
    end
    from member m cross join wanted w
  ), false);
$function$;

revoke all on function public.agent_may_work_state(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agent_may_work_state(uuid, uuid, text) to tenant_app, service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_def text;
begin
  -- A parse-check run (tenant_app) cannot add the column or replace the functions.
  if not has_schema_privilege('public', 'CREATE')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'tenant_user_licensed_states' and column_name = 'expires_on') then
    raise notice 'agent licence expiry: schema not present; skipping the checks';
    return;
  end if;

  select pg_get_functiondef('public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 's\.expires_on is null or s\.expires_on >= current_date' then
    raise exception 'assignment_candidate_is_eligible still accepts a lapsed personal licence';
  end if;
  if v_def !~ 'a\.expires_at is null or a\.expires_at >= current_date' or v_def !~ 'a\.status = ''active''' or v_def !~ 'l\.expires_at is null or l\.expires_at >= current_date' then
    raise exception 'assignment_candidate_is_eligible lost a rule after the rewrite';
  end if;
  select pg_get_functiondef('public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 'own %s licence expired on' or v_def !~ 'has expired, so nothing can be written there' or v_def !~ 'still pending with the carrier' then
    raise exception 'assignment_ineligibility_reason does not explain every refusal';
  end if;
  select pg_get_functiondef('public.agent_may_work_state(uuid, uuid, text)'::regprocedure) into v_def;
  if v_def !~ 's\.expires_on is null or s\.expires_on >= current_date' then
    raise exception 'agent_may_work_state still serves a lapsed personal licence';
  end if;
  select pg_get_functiondef('public.set_tenant_user_licensed_states(uuid, uuid, text[])'::regprocedure) into v_def;
  if v_def ~ 'delete from public\.tenant_user_licensed_states s where s\.tenant_id = p_tenant_id and s\.user_id = p_user_id;' then
    raise exception 'set_tenant_user_licensed_states still wipes every expiry on save';
  end if;

  if has_function_privilege('tenant_app', 'public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)', 'execute')
     or has_function_privilege('tenant_app', 'public.set_tenant_user_licensed_states_with_expiry(uuid, uuid, jsonb)', 'execute') then
    raise exception 'the tenant plane can execute a service-role function';
  end if;
  if not has_function_privilege('tenant_app', 'public.agent_may_work_state(uuid, uuid, text)', 'execute') then
    raise exception 'agent_may_work_state lost its tenant_app grant (the dialer calls it)';
  end if;
  raise notice 'agent licence expiry: a lapsed personal state is refused by assignment and by the dialer';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925702000', 'agent_licence_expiry') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/18] 20260925702100_assignment_router_strategy_conditions_auto_route.sql ───
begin;

-- /app/assignments · the concept board's routing rules, made real (LA-2.24 concept audit).
--
-- One restatement of the router (assign_lead_core, latest definition 20260924300000), plus the
-- functions that read and write the chain around it. What changes:
--
--   Strategy     assignment_rules.strategy: 'round_robin' (the default, and every existing rule) or
--                'least_loaded' ("fewest open first"): candidates who hold the fewest open leads are
--                offered the lead first; the round-robin order breaks ties. Capacity is still the
--                ceiling in both.
--   Conditions   assignment_rules.conditions: up to two more conditions ANDed with the rule's own
--                match ("State is TX AND product is final_expense"). Each is { match_type,
--                match_values } with match_type campaign | state | language | product. A language
--                condition pairs the lead with a speaker exactly as a language rule does; a product
--                condition marked licensed_only keeps setters off it exactly as a product rule does.
--   Licence skip A rule the lead matched whose EVERY candidate was refused by the licence gate is
--                logged once, per rule, as an assignment_skip_events row with reason 'licence' and
--                no user: "the rule would have broken licensing, so the lead fell through". Written
--                on success only, as every skip is.
--   Auto-route   assignment_settings.auto_route_posted (off by default). When an owner turns it on,
--                a lead a vendor POSTS is routed the moment it lands (auto_route_posted_lead, called
--                by the lead-post ingest path), through the tenant's 'realtime' rules only — never
--                the rest of the chain, never the implicit roster fallback. The router runs with a
--                system actor (p_system_route); every gate applies: licence, language, day off, rest
--                days, same household, capacity. If nobody may take it, it stays in the pool. Each
--                attempt writes one audit_log row. The owner the router picked is re-checked against
--                assignment_candidate_is_eligible before the move stands.
--   Fallback     publish_assignment_rules keeps any fallback rule LAST, whatever order it was sent in.
--   Insights     assignment_insights gains where skipped leads landed ("→ rule 4"), the personal
--                licences lapsing within 30 days with the open leads they hold in that state, and
--                how many leads were routed on arrival.
--
-- assign_lead_core gains a seventh argument, p_system_route. The six-argument form keeps its exact
-- signature, return type and grants and passes false, so every existing caller — assign_lead, the
-- routing preview, bulk list assignment (20260924342000) and the rotation job — runs the router
-- below unchanged apart from the three new rule features. The seven-argument form is executable by
-- its owner only: nothing outside these security-definer functions can reach the system path.
--
-- assignment_candidate_is_eligible and assignment_ineligibility_reason are CALLED, never redefined
-- (20260925702000 owns them).
--
-- Additive. New columns are defaulted; the widened skip-reason check keeps every value it accepted.
-- Requires 20260924300000 and 20260925702000.

do $$
begin
  if to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)') is null then
    if has_schema_privilege('public', 'CREATE') then
      raise exception 'Apply 20260924300000_lead_assignment_board.sql first: this file restates its router.';
    end if;
    raise notice 'assignment router: assign_lead_core is missing (apply 20260924300000 first); continuing only because this connection cannot change the schema';
  end if;
end $$;

-- ── schema ────────────────────────────────────────────────────────────────
alter table public.assignment_rules add column if not exists strategy text not null default 'round_robin';
alter table public.assignment_rules add column if not exists conditions jsonb not null default '[]'::jsonb;
alter table public.assignment_settings add column if not exists auto_route_posted boolean not null default false;

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_constraint where conname = 'assignment_rules_strategy_valid') then
    alter table public.assignment_rules
      add constraint assignment_rules_strategy_valid check (strategy in ('round_robin', 'least_loaded'));
  end if;
  -- Shape only: a table CHECK cannot look inside the elements without a subquery.
  -- publish_assignment_rules validates each one.
  if not exists (select 1 from pg_constraint where conname = 'assignment_rules_conditions_shape') then
    alter table public.assignment_rules
      add constraint assignment_rules_conditions_shape
      check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 2);
  end if;

  -- 'licence' joins the skip reasons, and a licence skip names a rule rather than a person.
  for r in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.assignment_skip_events'::regclass and c.contype = 'c'
       and c.conname <> 'assignment_skip_events_reason_valid'
       and pg_get_constraintdef(c.oid) ~ '\mreason\M'
  loop
    execute format('alter table public.assignment_skip_events drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'assignment_skip_events_reason_valid') then
    alter table public.assignment_skip_events
      add constraint assignment_skip_events_reason_valid
      check (reason in ('capacity', 'rest', 'household', 'day_off', 'licence'));
  end if;
  alter table public.assignment_skip_events alter column user_id drop not null;
  if not exists (select 1 from pg_constraint where conname = 'assignment_skip_events_user_unless_licence') then
    alter table public.assignment_skip_events
      add constraint assignment_skip_events_user_unless_licence check (user_id is not null or reason = 'licence');
  end if;
end $$;

-- ── rule matching ─────────────────────────────────────────────────────────
--
-- One condition, as the rule's own match always was (20260924300000's branches, unchanged). Stable:
-- the 'realtime' branch reads now().
create or replace function public.assignment_condition_matches(p_type text, p_values jsonb, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_value text;
  v_values jsonb;
  v_seconds numeric;
  v_match jsonb := coalesce(p_values, '{}'::jsonb);
begin
  if p_type = 'fallback' then return true; end if;
  if p_type = 'campaign' then
    return p_lead.campaign_id is not null and (
      v_match->'campaign_ids' ? p_lead.campaign_id::text
      or v_match->'values' ? p_lead.campaign_id::text
    );
  end if;
  if p_type = 'state' then
    v_value := upper(trim(coalesce(p_lead.values->>'state', p_lead.values->>'state_code', '')));
    v_values := coalesce(v_match->'states', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where upper(trim(x.value)) = v_value);
  end if;
  if p_type = 'language' then
    v_value := lower(trim(coalesce(p_lead.values->>'language', p_lead.values->>'preferred_language', p_lead.values->>'language_code', '')));
    v_values := coalesce(v_match->'languages', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_type = 'product' then
    v_value := lower(trim(coalesce(p_lead.product_line, p_lead.values->>'product_code', p_lead.values->>'product', '')));
    v_values := coalesce(v_match->'products', v_match->'product_codes', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_type = 'realtime' then
    v_seconds := case when jsonb_typeof(v_match->'seconds') = 'number' then (v_match->>'seconds')::numeric end;
    return v_seconds is not null and v_seconds > 0
       and p_lead.posted_at is not null
       and p_lead.posted_at >= now() - make_interval(secs => v_seconds::double precision);
  end if;
  return false;
end;
$function$;

-- The rule's own match AND each extra condition. An extra condition may only be one of the four
-- list types; anything else stored there matches nothing rather than everything.
create or replace function public.assignment_rule_matches(p_rule public.assignment_rules, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_condition jsonb;
begin
  if not public.assignment_condition_matches(p_rule.match_type, p_rule.match_values, p_lead) then return false; end if;
  if p_rule.conditions is null or jsonb_typeof(p_rule.conditions) <> 'array' then return true; end if;
  for v_condition in select value from jsonb_array_elements(p_rule.conditions) loop
    if coalesce(v_condition->>'match_type', '') not in ('campaign', 'state', 'language', 'product') then return false; end if;
    if not public.assignment_condition_matches(v_condition->>'match_type', v_condition->'match_values', p_lead) then return false; end if;
  end loop;
  return true;
end;
$function$;

-- A language rule, or a rule with a language condition, pairs the lead with a speaker.
create or replace function public.assignment_rule_pairs_language(p_rule public.assignment_rules)
returns boolean
language sql
immutable
as $function$
  select coalesce((p_rule).match_type = 'language', false)
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof((p_rule).conditions) = 'array' then (p_rule).conditions else '[]'::jsonb end) c(value)
                  where c.value->>'match_type' = 'language');
$function$;

-- A product rule, or a rule with a product condition, marked licensed_only needs a licensed agent.
create or replace function public.assignment_rule_requires_licence(p_rule public.assignment_rules)
returns boolean
language sql
immutable
as $function$
  select (coalesce((p_rule).match_type = 'product', false)
          and jsonb_typeof((p_rule).match_values->'licensed_only') = 'boolean'
          and ((p_rule).match_values->>'licensed_only')::boolean)
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof((p_rule).conditions) = 'array' then (p_rule).conditions else '[]'::jsonb end) c(value)
                  where c.value->>'match_type' = 'product'
                    and jsonb_typeof(c.value->'match_values'->'licensed_only') = 'boolean'
                    and (c.value->'match_values'->>'licensed_only')::boolean);
$function$;

-- ── the router ────────────────────────────────────────────────────────────
--
-- Restated from 20260924300000. Every change is marked "CONCEPT n":
--
--   1  System route (auto-route on arrival). p_system_route = true: no actor, a named work item that
--      is still in the pool, no target, no rotation. Only 'realtime' rules are tried, and no implicit
--      fallback is appended. The event is 'assigned', assigned_by null.
--   2  Conditions: assignment_rule_matches ANDs them. Language pairing and licensed-only are read
--      through assignment_rule_pairs_language / assignment_rule_requires_licence, so a condition
--      has the same effect as the rule type it names.
--   3  Strategy: 'least_loaded' orders candidates by open leads (agent_capacity.current_open, which
--      the lead_queue trigger keeps current) before the round-robin order. The recount under the
--      row lock is unchanged, so the ceiling is exactly as strict as before.
--   4  Licence skip: a real rule whose every candidate the licence gate refused writes one 'licence'
--      skip for that rule (no user) when the lead falls through it.
create or replace function public.assign_lead_core(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_rotate_from_user_id uuid,
  p_system_route boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item public.lead_queue%rowtype;
  v_lead public.agent_leads%rowtype;
  v_rule public.assignment_rules%rowtype;
  v_selected_rule public.assignment_rules%rowtype;
  v_capacity public.agent_capacity%rowtype;
  v_candidate record;
  v_state text;
  v_product text;
  v_language text;
  v_contact_key text;
  v_rest_days integer := 0;
  v_requires_licensed boolean := false;
  v_selected_user uuid;
  v_selected_role text;
  v_from_user uuid;
  v_event_type text;
  v_event_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_open integer;
  v_rule_found boolean := false;
  v_round_robin_last uuid;
  v_actor_role text;
  v_settings_last uuid;
  v_max_items integer := 1;
  v_items_tried integer := 0;
  v_tried uuid[] := '{}'::uuid[];
  v_rules public.assignment_rules[];
  v_real_rules integer := 0;
  v_has_fallback boolean := false;
  v_household_owners uuid[] := '{}'::uuid[];
  v_zone text;
  v_dow integer;
  v_skip_items uuid[] := '{}'::uuid[];
  v_skip_rules uuid[] := '{}'::uuid[];
  v_skip_users uuid[] := '{}'::uuid[];
  v_skip_reasons text[] := '{}'::text[];
  v_n_candidates integer := 0;
  v_n_licence integer := 0;
  v_n_language integer := 0;
  v_n_day_off integer := 0;
  v_n_rest integer := 0;
  v_n_household integer := 0;
  v_n_capacity integer := 0;
  -- CONCEPT 2–4 state.
  v_system boolean := coalesce(p_system_route, false);
  v_pairs_language boolean;
  v_least_loaded boolean;
  v_rule_candidates integer;
  v_rule_licence integer;
begin
  -- CONCEPT 1: the system route names one pooled work item and nobody else.
  if v_system and (p_work_item_id is null or p_target_user_id is not null or p_rotate_from_user_id is not null or p_actor_user_id is not null) then
    raise exception 'ASSIGNMENT_AUTO_ROUTE_INVALID';
  end if;
  -- A rotation may run with no actor; so may the system route. Everything else must name an active member.
  if p_rotate_from_user_id is not null and (p_work_item_id is null or p_target_user_id is not null) then
    raise exception 'ASSIGNMENT_ROTATION_INVALID';
  end if;
  if (p_rotate_from_user_id is not null or v_system) and p_actor_user_id is null then
    v_actor_role := null;
  else
    select tu.role::text into v_actor_role
      from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
         and tu.accepted_at is not null and u.status::text = 'active'
      limit 1;
    if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  end if;

  -- Reconcile stale rows even if an external user-status mutation did not fire the trigger.
  update public.lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
         claimed_at = null, locked_until = null, updated_at = now()
    from public.users u
   where q.tenant_id = p_tenant_id and q.owner_user_id = u.id
     and u.status::text <> 'active'
     and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
     and q.disposition is null;

  select coalesce(s.rest_days, 0), s.last_assignee_id into v_rest_days, v_settings_last from public.assignment_settings s where s.tenant_id = p_tenant_id;
  v_rest_days := coalesce(v_rest_days, 0);

  begin
    select nullif(btrim(ap.timezone), '') into v_zone from public.agency_profiles ap where ap.tenant_id = p_tenant_id;
    v_dow := extract(dow from (now() at time zone coalesce(v_zone, 'UTC')))::integer;
  exception when others then
    v_dow := extract(dow from (now() at time zone 'UTC'))::integer;
  end;

  -- Skip-ahead only for "assign the next eligible lead" — no work item, no target.
  if p_work_item_id is null and p_target_user_id is null then v_max_items := 25; end if;

  <<items>>
  loop
    exit items when v_items_tried >= v_max_items;
    v_items_tried := v_items_tried + 1;

    if p_work_item_id is null then
      select q.* into v_item
        from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
         and q.id <> all(v_tried)
       order by q.tier nulls last, q.queued_at, q.id
       limit 1
       for update skip locked;
    else
      select q.* into v_item from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.id = p_work_item_id for update;
    end if;
    if not found then
      if v_items_tried = 1 then raise exception 'ASSIGNMENT_WORK_ITEM_NOT_FOUND'; end if;
      exit items;
    end if;
    v_tried := array_append(v_tried, v_item.id);
    select l.* into v_lead from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id for update;
    if not found then raise exception 'ASSIGNMENT_LEAD_NOT_FOUND'; end if;

    v_state := upper(trim(coalesce(v_lead.values->>'state', v_lead.values->>'state_code', '')));
    v_product := lower(trim(coalesce(v_lead.product_line, v_lead.values->>'product_code', v_lead.values->>'product', '')));
    v_language := lower(trim(coalesce(v_lead.values->>'language', v_lead.values->>'preferred_language', v_lead.values->>'language_code', '')));
    v_contact_key := public.assignment_contact_key(v_lead.values, v_lead.id);

    v_n_candidates := 0; v_n_licence := 0; v_n_language := 0; v_n_day_off := 0;
    v_n_rest := 0; v_n_household := 0; v_n_capacity := 0;
    v_selected_rule := null;
    v_rule_found := false;
    v_selected_user := null;
    v_selected_role := null;

    if p_rotate_from_user_id is not null
       and (v_item.owner_user_id is distinct from p_rotate_from_user_id or v_item.status <> 'claimed' or v_item.disposition is not null) then
      raise exception 'ASSIGNMENT_ROTATION_STALE';
    end if;
    -- CONCEPT 1: only a lead still waiting in the pool is routed on arrival.
    if v_system and (v_item.status <> 'unclaimed' or v_item.owner_user_id is not null) then
      raise exception 'ASSIGNMENT_AUTO_ROUTE_NOT_POOLED';
    end if;

    -- A claimed, undispositioned row is the live conversation. Automated assignment never takes it
    -- away from its current owner. An explicit target is the deliberate manual reassignment path and
    -- requires a reason below. (A rotation is the one automated caller let past, and only after
    -- rotate_unanswered_assignments has established there is no call, open attempt or promised
    -- callback on it.)
    if v_item.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and v_item.owner_user_id is not null and v_item.disposition is null and p_target_user_id is null and p_rotate_from_user_id is null then
      return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_item.owner_user_id, 'owner_role', v_item.owner_role, 'sticky', true, 'reason', 'Active ownership is sticky until disposition');
    end if;
    if v_item.status not in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active') then raise exception 'ASSIGNMENT_WORK_ITEM_CLOSED'; end if;
    if p_target_user_id is not null and p_target_user_id <> coalesce(v_item.owner_user_id, p_actor_user_id)
       and v_actor_role not in ('owner', 'producer') then
      raise exception 'ASSIGNMENT_MANAGER_REQUIRED';
    end if;
    if p_target_user_id is not null and v_item.owner_user_id is not null and p_target_user_id <> v_item.owner_user_id and v_event_reason is null then raise exception 'REASSIGNMENT_REASON_REQUIRED'; end if;

    -- Everyone else holding this household right now.
    select coalesce(array_agg(distinct q2.owner_user_id), '{}'::uuid[]) into v_household_owners
      from public.lead_queue q2
      join public.agent_leads l2 on l2.id = q2.lead_id and l2.tenant_id = q2.tenant_id
     where q2.tenant_id = p_tenant_id
       and q2.id <> v_item.id
       and q2.owner_user_id is not null
       and q2.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
       and q2.disposition is null
       and public.assignment_contact_key(l2.values, l2.id) = v_contact_key;

    if p_target_user_id is not null then
      -- First match wins for the manual path: the first matching rule decides whether the lead needs
      -- a licensed agent, and has its round-robin pointer moved by the assignment, as before.
      for v_rule in
        select r.* from public.assignment_rules r
         where r.tenant_id = p_tenant_id and r.is_active
           and public.assignment_rule_matches(r, v_lead)
         order by r.priority, r.id
      loop
        v_selected_rule := v_rule;
        v_rule_found := true;
        exit;
      end loop;
      if v_selected_rule.id is null then
        v_selected_rule.id := gen_random_uuid();
        v_selected_rule.assignee_ids := '{}'::uuid[];
        v_selected_rule.match_type := 'fallback';
      end if;
      v_round_robin_last := coalesce(v_selected_rule.last_assignee_id, v_settings_last);
      -- CONCEPT 2: licensed-only read from the rule and its conditions.
      v_requires_licensed := v_product in ('term_life', 'term-life', 'term life')
        or public.assignment_rule_requires_licence(v_selected_rule);

      select tu.role::text into v_selected_role
        from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id
         and tu.accepted_at is not null and u.status::text = 'active';
      if not found or not public.assignment_candidate_is_eligible(p_tenant_id, p_target_user_id, v_selected_role, v_product, v_state, v_requires_licensed) then raise exception 'ASSIGNMENT_TARGET_NOT_ELIGIBLE'; end if;
      if p_target_user_id <> coalesce(v_item.owner_user_id, '00000000-0000-0000-0000-000000000000')::uuid then
        if v_rest_days > 0
           and not (v_actor_role in ('owner', 'producer') and v_event_reason is not null)
           and exists (
          select 1 from public.lead_assignment_events e
           where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
             and e.to_user_id is not null and e.to_user_id <> p_target_user_id
             and e.created_at > now() - make_interval(days => v_rest_days)
        ) then raise exception 'ASSIGNMENT_TARGET_RESTING'; end if;
        if exists (select 1 from unnest(v_household_owners) o(user_id) where o.user_id <> p_target_user_id) then
          raise exception 'ASSIGNMENT_HOUSEHOLD_OWNED';
        end if;
      end if;
      insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, p_target_user_id) on conflict do nothing;
      select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = p_target_user_id for update;
      select count(*)::integer into v_open from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.owner_user_id = p_target_user_id
         and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null
         and q.id <> v_item.id;
      update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = p_target_user_id;
      if p_target_user_id <> coalesce(v_item.owner_user_id, '00000000-0000-0000-0000-000000000000')::uuid and v_open >= v_capacity.max_open_leads then raise exception 'ASSIGNMENT_TARGET_AT_CAPACITY'; end if;
      v_selected_user := p_target_user_id;
    else
      -- Every matching rule, in order, then the implicit fallback. CONCEPT 1: the system route tries
      -- the real-time rules only, with no implicit fallback behind them.
      select coalesce(array_agg(r order by r.priority, r.id), '{}'::public.assignment_rules[]),
             coalesce(bool_or(r.match_type = 'fallback'), false)
        into v_rules, v_has_fallback
        from public.assignment_rules r
       where r.tenant_id = p_tenant_id and r.is_active
         and (not v_system or r.match_type = 'realtime')
         and public.assignment_rule_matches(r, v_lead);
      v_real_rules := coalesce(cardinality(v_rules), 0);
      if not v_has_fallback and not v_system then
        v_rule := null;
        v_rule.id := gen_random_uuid();
        v_rule.assignee_ids := '{}'::uuid[];
        v_rule.match_type := 'fallback';
        v_rules := array_append(v_rules, v_rule);
      end if;

      v_requires_licensed := false;
      <<rules>>
      for v_rule_index in 1 .. cardinality(v_rules) loop
        v_rule := v_rules[v_rule_index];
        v_round_robin_last := coalesce(v_rule.last_assignee_id, v_settings_last);
        -- A licensed-only rule the lead matched is a fact about the lead: falling through it must not
        -- let a setter take what it said needs a licence. CONCEPT 2: conditions count too.
        v_requires_licensed := v_requires_licensed or v_product in ('term_life', 'term-life', 'term life')
          or public.assignment_rule_requires_licence(v_rule);
        v_pairs_language := public.assignment_rule_pairs_language(v_rule);
        v_least_loaded := coalesce(v_rule.strategy, 'round_robin') = 'least_loaded';
        v_rule_candidates := 0;
        v_rule_licence := 0;

        -- Lock each capacity row before recounting it. The row itself is never trusted as the source of
        -- truth, which keeps concurrent assignments from crossing the configured maximum.
        for v_candidate in
          select tu.user_id, tu.role::text as role, c.max_open_leads,
                 coalesce(c.languages, '{}'::text[]) as languages, c.weekday_off,
                 case when cardinality(v_rule.assignee_ids) > 0 then array_position(v_rule.assignee_ids, tu.user_id) else null end as configured_position
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id and u.status::text = 'active'
            left join public.agent_capacity c on c.tenant_id = p_tenant_id and c.user_id = tu.user_id
           where tu.tenant_id = p_tenant_id and tu.accepted_at is not null
             and (cardinality(v_rule.assignee_ids) = 0 or tu.user_id = any(v_rule.assignee_ids))
             -- Never back to the owner it is being rotated away from.
             and (p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id)
           order by
                    -- CONCEPT 3: fewest open first, when the rule asks for it.
                    case when v_least_loaded then coalesce(c.current_open, 0) else 0 end,
                    case
                      when cardinality(v_rule.assignee_ids) > 0 and v_round_robin_last is not null
                        then case when array_position(v_rule.assignee_ids, tu.user_id) > coalesce(array_position(v_rule.assignee_ids, v_round_robin_last), 0) then 0 else 1 end
                      when cardinality(v_rule.assignee_ids) = 0 and v_round_robin_last is not null
                        then case when tu.user_id > v_round_robin_last then 0 else 1 end
                      else 0
                    end,
                    case when cardinality(v_rule.assignee_ids) > 0 then array_position(v_rule.assignee_ids, tu.user_id) end nulls last,
                    tu.user_id
        loop
          v_n_candidates := v_n_candidates + 1;
          v_rule_candidates := v_rule_candidates + 1;
          if not public.assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id, v_candidate.role, v_product, v_state, v_requires_licensed) then
            v_n_licence := v_n_licence + 1;
            v_rule_licence := v_rule_licence + 1;
            continue;
          end if;
          -- Language pairing: a language rule, or a rule with a language condition (CONCEPT 2).
          if v_pairs_language and not exists (
            select 1 from unnest(v_candidate.languages) x(value) where lower(btrim(x.value)) = v_language
          ) then
            v_n_language := v_n_language + 1;
            continue;
          end if;
          if v_candidate.weekday_off is not null and v_candidate.weekday_off = v_dow then
            v_n_day_off := v_n_day_off + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'day_off'::text);
            continue;
          end if;
          if v_rest_days > 0 and exists (
            select 1 from public.lead_assignment_events e
             where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
               and e.to_user_id is not null and e.to_user_id <> v_candidate.user_id
               and e.created_at > now() - make_interval(days => v_rest_days)
          ) then
            v_n_rest := v_n_rest + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'rest'::text);
            continue;
          end if;
          if exists (select 1 from unnest(v_household_owners) o(user_id) where o.user_id <> v_candidate.user_id) then
            v_n_household := v_n_household + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'household'::text);
            continue;
          end if;
          insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, v_candidate.user_id) on conflict do nothing;
          select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = v_candidate.user_id for update;
          select count(*)::integer into v_open from public.lead_queue q
           where q.tenant_id = p_tenant_id and q.owner_user_id = v_candidate.user_id
             and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null;
          update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = v_candidate.user_id;
          if v_open >= v_capacity.max_open_leads then
            v_n_capacity := v_n_capacity + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'capacity'::text);
          end if;
          if v_open >= v_capacity.max_open_leads then continue; end if;
          v_selected_user := v_candidate.user_id;
          v_selected_role := v_candidate.role;
          exit;
        end loop;

        if v_selected_user is not null then
          v_selected_rule := v_rule;
          v_rule_found := v_rule_index <= v_real_rules;
          exit;
        end if;
        -- CONCEPT 4: the rule would have broken licensing for every one of its candidates, so the
        -- lead falls through it. One row for the rule, no person.
        if v_rule_index <= v_real_rules and v_rule_candidates > 0 and v_rule_licence = v_rule_candidates then
          v_skip_items := array_append(v_skip_items, v_item.id);
          v_skip_rules := array_append(v_skip_rules, v_rule.id);
          v_skip_users := array_append(v_skip_users, null::uuid);
          v_skip_reasons := array_append(v_skip_reasons, 'licence'::text);
        end if;
      end loop;
    end if;

    exit items when v_selected_user is not null;
  end loop;

  if v_selected_user is null then
    raise exception 'NO_ELIGIBLE_ASSIGNEE' using detail = jsonb_build_object(
      'leads_tried', v_items_tried, 'work_item_id', v_item.id, 'state', v_state, 'product', v_product,
      'requires_licensed', v_requires_licensed, 'candidates', v_n_candidates, 'licence', v_n_licence,
      'language', v_n_language, 'day_off', v_n_day_off, 'rest', v_n_rest, 'household', v_n_household,
      'capacity', v_n_capacity, 'system_route', v_system)::text;
  end if;

  v_from_user := v_item.owner_user_id;
  v_event_type := case when v_from_user is null then case when p_work_item_id is null or v_system then 'assigned' else 'pulled' end else 'reassigned' end;
  if v_from_user is not null and v_event_reason is null then v_event_reason := 'Manual reassignment'; end if;
  v_event_reason := coalesce(v_event_reason, 'Rule-based assignment');
  update public.lead_queue
     set status = 'claimed', claimed_by = v_selected_user, owner_user_id = v_selected_user,
         owner_role = v_selected_role, claimed_at = coalesce(claimed_at, now()), locked_until = null, updated_at = now()
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, to_user_id, event_type, reason, assigned_by, rule_id)
  values (p_tenant_id, v_item.id, v_item.lead_id, v_contact_key, v_from_user, v_selected_user, v_event_type, v_event_reason, p_actor_user_id,
          case when p_target_user_id is null and v_rule_found then v_selected_rule.id end);
  if cardinality(v_skip_reasons) > 0 then
    insert into public.assignment_skip_events (tenant_id, work_item_id, rule_id, user_id, reason)
    select p_tenant_id, s.work_item_id, s.rule_id, s.user_id, s.reason
      from unnest(v_skip_items, v_skip_rules, v_skip_users, v_skip_reasons) as s(work_item_id, rule_id, user_id, reason);
  end if;
  if v_selected_rule.id is not null and v_selected_rule.match_type <> 'fallback' then
    update public.assignment_rules set last_assignee_id = v_selected_user where id = v_selected_rule.id and tenant_id = p_tenant_id;
  end if;
  if v_selected_rule.match_type = 'fallback' then
    if v_rule_found then
      update public.assignment_rules set last_assignee_id = v_selected_user where id = v_selected_rule.id and tenant_id = p_tenant_id;
    else
      insert into public.assignment_settings (tenant_id, last_assignee_id) values (p_tenant_id, v_selected_user)
      on conflict (tenant_id) do update set last_assignee_id = excluded.last_assignee_id, updated_at = now();
    end if;
  end if;
  perform public.refresh_agent_capacity_for_user(p_tenant_id, v_selected_user);
  if v_from_user is not null and v_from_user <> v_selected_user then perform public.refresh_agent_capacity_for_user(p_tenant_id, v_from_user); end if;
  return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_selected_user, 'owner_role', v_selected_role, 'rule_id', case when v_rule_found then v_selected_rule.id else null end, 'rule_match_type', v_selected_rule.match_type, 'sticky', false, 'reason', v_event_reason, 'leads_skipped', greatest(v_items_tried - 1, 0));
end;
$function$;

-- The six-argument router every existing caller uses: same signature, return type and grants as
-- 20260924300000; the system route is off.
create or replace function public.assign_lead_core(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_rotate_from_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  return public.assign_lead_core(p_tenant_id, p_actor_user_id, p_work_item_id, p_target_user_id, p_reason, p_rotate_from_user_id, false);
end;
$function$;

-- ── auto-route on arrival ─────────────────────────────────────────────────
--
-- Called by the lead-post ingest path (lib/leadPost/service.ts) once a posted lead is queued. Does
-- nothing unless the tenant switched it on. Never raises for an ordinary refusal: the lead simply
-- stays in the pool, and the vendor's post has already been accepted.
create or replace function public.auto_route_posted_lead(p_tenant_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_on boolean;
  v_posted timestamptz;
  v_state text;
  v_product text;
  v_item uuid;
  v_result jsonb;
  v_error text;
  v_detail text;
  v_owner uuid;
  v_role text;
  v_out jsonb;
begin
  select s.auto_route_posted into v_on from public.assignment_settings s where s.tenant_id = p_tenant_id;
  if not coalesce(v_on, false) then return jsonb_build_object('routed', false, 'reason', 'off'); end if;

  select l.posted_at,
         upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))),
         lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', '')))
    into v_posted, v_state, v_product
    from public.agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found or v_posted is null then return jsonb_build_object('routed', false, 'reason', 'not_posted'); end if;

  select q.id into v_item from public.lead_queue q
   where q.tenant_id = p_tenant_id and q.lead_id = p_lead_id and q.status = 'unclaimed' and q.owner_user_id is null
   order by q.queued_at desc, q.id
   limit 1;
  if v_item is null then return jsonb_build_object('routed', false, 'reason', 'not_in_pool'); end if;

  begin
    v_result := public.assign_lead_core(p_tenant_id, null, v_item, null, 'Routed on arrival by a real-time rule', null, true);
    -- The router already asked the gate. Asked again here, of the owner it chose, so that no future
    -- change to the router can route a posted lead to someone the gate refuses: the refusal undoes
    -- the move with everything else in this block.
    v_owner := (v_result->>'owner_user_id')::uuid;
    select tu.role::text into v_role from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_owner;
    if v_owner is null or not public.assignment_candidate_is_eligible(p_tenant_id, v_owner, v_role, v_product, v_state, v_product in ('term_life', 'term-life', 'term life')) then
      raise exception 'ASSIGNMENT_AUTO_ROUTE_GATE_REFUSED';
    end if;
  exception when others then
    get stacked diagnostics v_error = message_text, v_detail = pg_exception_detail;
    v_result := null;
  end;

  if v_result is not null then
    v_out := jsonb_build_object('routed', true, 'work_item_id', v_item, 'owner_user_id', v_result->'owner_user_id', 'rule_id', v_result->'rule_id');
    insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
    values ('system', 'tenant.lead_auto_routed', 'lead_queue', v_item::text,
            jsonb_build_object('tenantId', p_tenant_id, 'leadId', p_lead_id, 'toUserId', v_result->'owner_user_id', 'ruleId', v_result->'rule_id'));
  else
    v_out := jsonb_build_object('routed', false, 'reason', coalesce(v_error, 'unknown'), 'work_item_id', v_item);
    insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
    values ('system', 'tenant.lead_auto_route_skipped', 'lead_queue', v_item::text,
            jsonb_build_object('tenantId', p_tenant_id, 'leadId', p_lead_id, 'reason', coalesce(v_error, 'unknown'),
                               'detail', case when v_detail is not null and v_detail ~ '^\{' then v_detail::jsonb end));
  end if;
  return v_out;
end;
$function$;

-- ── board figures ─────────────────────────────────────────────────────────
--
-- Restated from 20260924300000. Every key it returned keeps its meaning. New:
--   landed             per rule: where the leads it skipped someone on were finally routed
--                      [{ rule_id, landed_rule_id (null = whole roster), leads }]. A skip and the
--                      assignment it was part of are written in one transaction, so they share
--                      created_at (now()) and work item.
--   licence_expiring   personal licences lapsing within 30 days, or lapsed and still holding open
--                      leads in that state: [{ user_id, state, expires_on, open_leads }]
--   auto_routed        leads routed on arrival since p_since
create or replace function public.assignment_insights(p_tenant_id uuid, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_routed jsonb;
  v_skips jsonb;
  v_skipped_leads jsonb;
  v_landed jsonb;
  v_expiring jsonb := '[]'::jsonb;
  v_auto integer := 0;
  v_states jsonb := '{}'::jsonb;
  v_union text[] := '{}'::text[];
  v_member record;
  v_member_states text[];
  v_unlicensed integer;
begin
  select coalesce(jsonb_object_agg(x.rule_id::text, x.n), '{}'::jsonb) into v_routed
    from (select e.rule_id, count(*)::integer as n
            from public.lead_assignment_events e
           where e.tenant_id = p_tenant_id and e.rule_id is not null and e.created_at >= p_since
           group by e.rule_id) x;

  select coalesce(jsonb_agg(jsonb_build_object('rule_id', y.rule_id, 'user_id', y.user_id, 'reason', y.reason, 'count', y.n)), '[]'::jsonb) into v_skips
    from (select s.rule_id, s.user_id, s.reason, count(*)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since
           group by s.rule_id, s.user_id, s.reason) y;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', z.user_id, 'reason', z.reason, 'leads', z.n)), '[]'::jsonb) into v_skipped_leads
    from (select s.user_id, s.reason, count(distinct s.work_item_id)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since and s.user_id is not null
           group by s.user_id, s.reason) z;

  select coalesce(jsonb_agg(jsonb_build_object('rule_id', w.rule_id, 'landed_rule_id', w.landed_rule_id, 'leads', w.n)), '[]'::jsonb) into v_landed
    from (select s.rule_id, e.rule_id as landed_rule_id, count(distinct s.work_item_id)::integer as n
            from public.assignment_skip_events s
            join public.lead_assignment_events e
              on e.tenant_id = s.tenant_id and e.work_item_id = s.work_item_id and e.created_at = s.created_at
             and e.to_user_id is not null
           where s.tenant_id = p_tenant_id and s.created_at >= p_since and s.rule_id is not null
           group by s.rule_id, e.rule_id) w;

  -- Personal licence expiry arrives with 20260925702000; before it there is nothing to warn about.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_user_licensed_states' and column_name = 'expires_on') then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'state', x.state, 'expires_on', x.expires_on, 'open_leads', x.open_leads)
                                order by x.expires_on, x.state), '[]'::jsonb)
        from (select s.user_id, s.state, s.expires_on,
                     (select count(*)::integer from public.lead_queue q
                        join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
                       where q.tenant_id = s.tenant_id and q.owner_user_id = s.user_id
                         and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null
                         and upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = s.state) as open_leads
                from public.tenant_user_licensed_states s
                join public.tenant_users tu on tu.tenant_id = s.tenant_id and tu.user_id = s.user_id and tu.role::text in ('owner', 'producer')
               where s.tenant_id = $1 and s.expires_on is not null and s.expires_on <= current_date + 30) x
       where x.expires_on >= current_date or x.open_leads > 0
    $q$ into v_expiring using p_tenant_id;
  end if;

  select count(*)::integer into v_auto
    from public.lead_assignment_events e
   where e.tenant_id = p_tenant_id and e.created_at >= p_since and e.assigned_by is null
     and e.reason = 'Routed on arrival by a real-time rule';

  for v_member in
    select tu.user_id, tu.role::text as role
      from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
     where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
  loop
    select coalesce(array_agg(st.state order by st.state), '{}'::text[]) into v_member_states
      from (select distinct upper(btrim(l.state)) as state from public.licenses l where l.tenant_id = p_tenant_id and btrim(coalesce(l.state, '')) <> '') st
     where public.assignment_candidate_is_eligible(p_tenant_id, v_member.user_id, v_member.role, null, st.state, false);
    v_states := v_states || jsonb_build_object(v_member.user_id::text, to_jsonb(v_member_states));
    v_union := v_union || v_member_states;
  end loop;

  select count(*)::integer into v_unlicensed
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
     and not (upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = any(v_union));

  return jsonb_build_object('since', p_since, 'routed', v_routed, 'skips', v_skips, 'skipped_leads', v_skipped_leads,
                            'landed', v_landed, 'licence_expiring', v_expiring, 'auto_routed', v_auto,
                            'eligible_states', v_states, 'unlicensed_leads', v_unlicensed);
end;
$function$;

-- ── publishing a draft of the rules ───────────────────────────────────────
--
-- Restated from 20260924300000. p_rules is the chain in order:
--   [{ "id"?: uuid, "match_type": text, "match_values": object, "assignee_ids": [uuid], "is_active"?: bool,
--      "strategy"?: 'round_robin' | 'least_loaded', "conditions"?: [{ "match_type", "match_values" }] }]
-- New: strategy and conditions are validated and stored, and every fallback rule is placed after
-- every other rule (in the order sent), because a fallback matches everything and anything after it
-- would only ever be reached by the leads it could not place.
create or replace function public.publish_assignment_rules(p_tenant_id uuid, p_actor_user_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_role text;
  v_rule jsonb;
  v_index integer := 0;
  v_id uuid;
  v_kept uuid[] := '{}'::uuid[];
  v_assignees uuid[];
  v_strategy text;
  v_conditions jsonb;
  v_condition jsonb;
  v_clean jsonb;
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;

  perform 1 from public.assignment_rules r where r.tenant_id = p_tenant_id for update;

  for v_rule in
    select x.value from jsonb_array_elements(p_rules) with ordinality x(value, ord)
     order by (x.value->>'match_type' = 'fallback'), x.ord
  loop
    v_index := v_index + 1;
    v_strategy := coalesce(nullif(v_rule->>'strategy', ''), 'round_robin');
    if v_strategy not in ('round_robin', 'least_loaded') then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;
    v_conditions := coalesce(v_rule->'conditions', '[]'::jsonb);
    if jsonb_typeof(v_conditions) <> 'array' or jsonb_array_length(v_conditions) > 2
       or (v_rule->>'match_type' = 'fallback' and jsonb_array_length(v_conditions) > 0) then
      raise exception 'ASSIGNMENT_RULES_INVALID';
    end if;
    v_clean := '[]'::jsonb;
    for v_condition in select value from jsonb_array_elements(v_conditions) loop
      if coalesce(v_condition->>'match_type', '') not in ('campaign', 'state', 'language', 'product')
         or jsonb_typeof(v_condition->'match_values') <> 'object'
         or v_condition->'match_values' = '{}'::jsonb then
        raise exception 'ASSIGNMENT_RULES_INVALID';
      end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('match_type', v_condition->>'match_type', 'match_values', v_condition->'match_values'));
    end loop;

    select coalesce(array_agg(d.user_id order by d.ord), '{}'::uuid[]) into v_assignees
      from (
        select distinct on (tu.user_id) tu.user_id, x.ord
          from jsonb_array_elements_text(coalesce(v_rule->'assignee_ids', '[]'::jsonb)) with ordinality x(value, ord)
          join public.tenant_users tu on tu.tenant_id = p_tenant_id and tu.user_id::text = lower(btrim(x.value))
         order by tu.user_id, x.ord
      ) d;
    v_id := nullif(v_rule->>'id', '')::uuid;
    if v_id is not null then
      update public.assignment_rules
         set priority = v_index * 10,
             match_type = v_rule->>'match_type',
             match_values = coalesce(v_rule->'match_values', '{}'::jsonb),
             assignee_ids = v_assignees,
             is_active = coalesce((v_rule->>'is_active')::boolean, true),
             strategy = v_strategy,
             conditions = v_clean
       where id = v_id and tenant_id = p_tenant_id;
      if not found then raise exception 'ASSIGNMENT_RULE_NOT_FOUND'; end if;
    else
      insert into public.assignment_rules (tenant_id, priority, match_type, match_values, assignee_ids, is_active, created_by, strategy, conditions)
      values (p_tenant_id, v_index * 10, v_rule->>'match_type', coalesce(v_rule->'match_values', '{}'::jsonb), v_assignees,
              coalesce((v_rule->>'is_active')::boolean, true), p_actor_user_id, v_strategy, v_clean)
      returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
  end loop;

  update public.assignment_rules set is_active = false
   where tenant_id = p_tenant_id and is_active and not (id = any(v_kept));

  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.priority, r.id)
      from public.assignment_rules r where r.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end;
$function$;

-- ── grants ────────────────────────────────────────────────────────────────
-- The seven-argument router and the auto-route are internal to this plane: the owner runs them
-- through the security-definer functions above. The helpers are called by the router only.
revoke all on function public.assign_lead_core(uuid, uuid, uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated, tenant_app, service_role;
revoke all on function
  public.assign_lead_core(uuid, uuid, uuid, uuid, text, uuid),
  public.assignment_condition_matches(text, jsonb, public.agent_leads),
  public.assignment_rule_pairs_language(public.assignment_rules),
  public.assignment_rule_requires_licence(public.assignment_rules),
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.auto_route_posted_lead(uuid, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.auto_route_posted_lead(uuid, uuid)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_core text;
  v_six text;
  v_rule public.assignment_rules;
  v_lead public.agent_leads;
  v_tenant uuid;
  v_actor uuid;
  v_before bigint;
  v_after bigint;
  v_skips_before bigint;
  v_skips_after bigint;
  v_preview jsonb;
  v_off jsonb;
  v_lead_id uuid;
begin
  if not has_schema_privilege('public', 'CREATE')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'assignment_rules' and column_name = 'conditions')
     or to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)') is null then
    raise notice 'assignment router: schema not present; skipping the behaviour checks';
    return;
  end if;
  select prosrc into v_core from pg_proc where oid = to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)');
  select prosrc into v_six from pg_proc where oid = to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)');
  if v_six not like '%p_rotate_from_user_id, false)%' then raise exception 'the six-argument router does not turn the system route off'; end if;

  -- Everything 20260924300000 asserted of the router, asserted of its restatement.
  if v_core not like '%v_max_items := 25%' then raise exception 'assign_lead: skip-ahead is missing'; end if;
  if v_core not like '%for v_rule_index in 1 .. cardinality(v_rules)%' then raise exception 'assign_lead: rule fall-through is missing'; end if;
  if v_core not like '%assignment_skip_events%' then raise exception 'assign_lead: the skip log is not written'; end if;
  if v_core not like '%rule_id)%' then raise exception 'assign_lead: rule_id is not recorded on the event'; end if;
  if v_core not like '%ASSIGNMENT_TARGET_RESTING%' or v_core not like '%ASSIGNMENT_HOUSEHOLD_OWNED%' then raise exception 'assign_lead: manual reassignment skips the household checks'; end if;
  if v_core not like '%assignment_rule_pairs_language(v_rule)%' then raise exception 'assign_lead: language pairing is missing'; end if;
  if v_core not like '%p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id%' then raise exception 'assign_lead: a rotation can hand the lead back to its owner'; end if;
  if v_core not like '%ASSIGNMENT_TARGET_NOT_ELIGIBLE%' or v_core not like '%ASSIGNMENT_TARGET_AT_CAPACITY%'
     or v_core not like '%REASSIGNMENT_REASON_REQUIRED%' or v_core not like '%ASSIGNMENT_MANAGER_REQUIRED%'
     or v_core not like '%Active ownership is sticky until disposition%' then
    raise exception 'assign_lead lost one of its refusals';
  end if;
  if v_core not like '%if v_open >= v_capacity.max_open_leads then continue;%' then raise exception 'assign_lead: a full agent is no longer skipped'; end if;
  if v_core not like '%assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id%' then raise exception 'assign_lead: the licence gate is not asked of every candidate'; end if;
  -- And the new behaviour.
  if v_core not like '%(not v_system or r.match_type = ''realtime'')%' or v_core not like '%if not v_has_fallback and not v_system then%' then
    raise exception 'assign_lead: the system route can reach rules other than real-time ones';
  end if;
  if v_core not like '%''licence''::text%' then raise exception 'assign_lead: licence fall-through is not logged'; end if;
  if v_core not like '%case when v_least_loaded then coalesce(c.current_open, 0) else 0 end%' then raise exception 'assign_lead: fewest-open-first is missing'; end if;
  if has_function_privilege('service_role', 'public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)', 'execute')
     or has_function_privilege('tenant_app', 'public.auto_route_posted_lead(uuid,uuid)', 'execute') then
    raise exception 'the system route is executable by a role that must not run it';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where oid = to_regprocedure('public.auto_route_posted_lead(uuid,uuid)')) not like '%assignment_candidate_is_eligible%' then
    raise exception 'auto_route_posted_lead does not re-check the gate';
  end if;

  -- Conditions are ANDed, built in memory: nothing is written.
  v_rule.match_type := 'realtime';
  v_rule.match_values := '{"seconds": 60}'::jsonb;
  v_rule.conditions := '[{"match_type": "state", "match_values": {"states": ["TX"]}}]'::jsonb;
  v_lead.posted_at := now() - interval '10 seconds';
  v_lead.values := '{"state": "TX"}'::jsonb;
  if not public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a TX lead posted 10 seconds ago missed "real-time AND TX"'; end if;
  v_lead.values := '{"state": "OH"}'::jsonb;
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'an OH lead matched "real-time AND TX"'; end if;
  v_rule.conditions := '[{"match_type": "fallback", "match_values": {}}]'::jsonb;
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a fallback stored as a condition matched everything'; end if;
  v_rule.conditions := '[{"match_type": "language", "match_values": {"languages": ["es"]}}]'::jsonb;
  if not public.assignment_rule_pairs_language(v_rule) then raise exception 'a language condition does not pair'; end if;

  -- The switch starts off: a tenant that has not turned it on is never routed on arrival.
  select l.tenant_id, l.id into v_tenant, v_lead_id
    from public.agent_leads l
    left join public.assignment_settings s on s.tenant_id = l.tenant_id
   where not coalesce(s.auto_route_posted, false)
   limit 1;
  if v_lead_id is not null then
    v_off := public.auto_route_posted_lead(v_tenant, v_lead_id);
    if coalesce((v_off->>'routed')::boolean, true) or v_off->>'reason' <> 'off' then
      raise exception 'auto_route_posted_lead routed a lead for a tenant with the switch off: %', v_off;
    end if;
  end if;

  -- The preview still leaves nothing behind.
  v_tenant := null;
  select tu.tenant_id, tu.user_id into v_tenant, v_actor
    from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
   where tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
     and exists (select 1 from public.lead_queue q where q.tenant_id = tu.tenant_id and q.status = 'unclaimed')
   order by tu.tenant_id
   limit 1;
  if v_tenant is null then
    raise notice 'assignment router: no tenant with a manager and an unclaimed lead; preview probe skipped';
    return;
  end if;
  select count(*) into v_before from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_skips_before from public.assignment_skip_events where tenant_id = v_tenant;
  v_preview := public.assignment_preview(v_tenant, v_actor, 3);
  select count(*) into v_after from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_skips_after from public.assignment_skip_events where tenant_id = v_tenant;
  if jsonb_typeof(v_preview) <> 'array' then raise exception 'assignment_preview did not return rows'; end if;
  if v_after <> v_before or v_skips_after <> v_skips_before then
    raise exception 'assignment_preview left % event(s) and % skip(s) behind', v_after - v_before, v_skips_after - v_skips_before;
  end if;
  raise notice 'assignment router: strategy, conditions, licence fall-through and the system route are in place; preview of % lead(s) rolled back cleanly', jsonb_array_length(v_preview);
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925702100', 'assignment_router_strategy_conditions_auto_route') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/18] 20260925702200_return_leads_when_a_licence_lapses.sql ─────────────────
begin;

-- Lead assignment · when a personal licence lapses, that agent's open leads in the state go back to
-- the pool (user decision, LA-2.24 concept audit).
--
-- 20260925702000 made a lapsed personal state stop counting: the router will not hand the agent a
-- new lead there and the dialer will not serve one. Leads the agent ALREADY owns in that state were
-- stranded — owned, so nobody else could be given them, and unservable to the owner. This job
-- returns them, with the rotation job's guards (rotate_unanswered_assignments, 20260924300000):
--
--   · only status 'claimed' with no disposition — never a live transfer (buffer_active,
--     handed_pending, la_active);
--   · never while the lead has an open call (active_calls), an attempt with no disposition in the
--     last two hours (a dial may be in progress), or a callback the customer booked (scheduled or
--     due);
--   · never while the dialer holds its lock (locked_until in the future);
--   · and only when the gate itself now refuses the owner for that lead — a renewal recorded since
--     (a new expires_on), or an owner whose states were cleared, keeps the lead.
--
-- Each return writes the usual 'auto_returned' event (reason "Licence in OH lapsed on 4 Oct 2026",
-- assigned_by null), and one audit_log row. The capacity trigger frees the slot. Run by
-- /api/cron/licence-lapse (vercel.json), never from a trigger.
--
-- Additive. Requires 20260925702000 (tenant_user_licensed_states.expires_on).

create or replace function public.return_lapsed_licence_assignments(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_row record;
  v_returned integer := 0;
  v_checked integer := 0;
  v_kept integer := 0;
  v_reason text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_user_licensed_states' and column_name = 'expires_on') then
    return jsonb_build_object('skipped', true, 'reason', 'tenant_user_licensed_states.expires_on is missing (20260925702000)');
  end if;

  for v_row in
    select q.id as work_item_id, q.tenant_id, q.lead_id, q.owner_user_id, s.state, s.expires_on,
           tu.role::text as role,
           lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', ''))) as product,
           public.assignment_contact_key(l.values, l.id) as contact_key
      from public.tenant_user_licensed_states s
      join public.tenant_users tu on tu.tenant_id = s.tenant_id and tu.user_id = s.user_id
      join public.lead_queue q on q.tenant_id = s.tenant_id and q.owner_user_id = s.user_id
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where s.expires_on is not null and s.expires_on < current_date
       and q.status = 'claimed' and q.disposition is null
       and (q.locked_until is null or q.locked_until < now())
       and upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = s.state
       and not exists (select 1 from public.active_calls ac where ac.tenant_id = q.tenant_id and ac.work_item_id = q.id and ac.ended_at is null)
       and not exists (select 1 from public.tenant_call_attempts op
                        where op.tenant_id = q.tenant_id and op.lead_id = q.lead_id
                          and op.disposition is null and op.attempted_at > now() - interval '2 hours')
       and not exists (select 1 from public.tenant_callbacks cb
                        where cb.tenant_id = q.tenant_id and cb.work_item_id = q.id and cb.status in ('scheduled', 'due'))
     order by q.tenant_id, s.expires_on, q.claimed_at nulls first, q.id
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    v_checked := v_checked + 1;
    -- The gate decides, not this query: a renewal or a cleared list keeps the lead with its owner.
    if public.assignment_candidate_is_eligible(v_row.tenant_id, v_row.owner_user_id, v_row.role, v_row.product, v_row.state, false) then
      v_kept := v_kept + 1;
      continue;
    end if;
    perform 1 from public.lead_queue
     where id = v_row.work_item_id and tenant_id = v_row.tenant_id and owner_user_id = v_row.owner_user_id
       and status = 'claimed' and disposition is null
     for update skip locked;
    if not found then
      v_kept := v_kept + 1;
      continue;
    end if;
    v_reason := format('Licence in %s lapsed on %s', v_row.state, to_char(v_row.expires_on, 'FMDD Mon YYYY'));
    update public.lead_queue
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
           claimed_at = null, locked_until = null, updated_at = now()
     where id = v_row.work_item_id and tenant_id = v_row.tenant_id;
    insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, event_type, reason, assigned_by)
    values (v_row.tenant_id, v_row.work_item_id, v_row.lead_id, v_row.contact_key, v_row.owner_user_id, 'auto_returned', v_reason, null);
    insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
    values ('system', 'tenant.lead_returned_licence_lapsed', 'lead_queue', v_row.work_item_id::text,
            jsonb_build_object('tenantId', v_row.tenant_id, 'leadId', v_row.lead_id, 'fromUserId', v_row.owner_user_id,
                               'state', v_row.state, 'expiresOn', v_row.expires_on));
    v_returned := v_returned + 1;
  end loop;
  return jsonb_build_object('checked', v_checked, 'returned', v_returned, 'kept', v_kept);
end;
$function$;

revoke all on function public.return_lapsed_licence_assignments(integer) from public, anon, authenticated, tenant_app;
grant execute on function public.return_lapsed_licence_assignments(integer) to service_role;

do $$
declare
  v_def text;
begin
  if not has_schema_privilege('public', 'CREATE')
     or to_regprocedure('public.return_lapsed_licence_assignments(integer)') is null then
    raise notice 'licence lapse return: schema not present; skipping the checks';
    return;
  end if;
  select prosrc into v_def from pg_proc where oid = to_regprocedure('public.return_lapsed_licence_assignments(integer)');
  if v_def not like '%from public.active_calls%' or v_def not like '%op.disposition is null and op.attempted_at > now() - interval ''2 hours''%'
     or v_def not like '%cb.status in (''scheduled'', ''due'')%' or v_def not like '%q.status = ''claimed''%' then
    raise exception 'return_lapsed_licence_assignments lost one of the rotation guards';
  end if;
  if v_def not like '%assignment_candidate_is_eligible%' then
    raise exception 'return_lapsed_licence_assignments returns leads without asking the gate';
  end if;
  if has_function_privilege('tenant_app', 'public.return_lapsed_licence_assignments(integer)', 'execute') then
    raise exception 'the tenant plane can run the licence lapse job';
  end if;
  raise notice 'licence lapse return: in place';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925702200', 'return_leads_when_a_licence_lapses') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [11/18] 20260925703000_lead_list_pool_blockers.sql ────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Lead lists · why the pool leads of one list are not being served
--
-- Pool concept audit (LA-2 §6, 2026-09-25). A lead in the pool (lead_queue.status = 'unclaimed',
-- nobody owning it) is not waiting to be "released": Serve next hands it to any agent who passes
-- the gates. What the lead-list page could not say is which gate is holding the rest. The assign
-- drawer's preview answered it for assignment (licence, capacity, no state) — not for serving, and
-- only while the drawer is open.
--
-- lead_list_pool_blockers(tenant, campaign) answers it for serving, with the gates serve_next_lead
-- applies (20260925700000, restated from 20260924323000), in this order — each lead is counted once,
-- under the first gate it fails:
--
--   campaign        the list is not in campaigns_servable (not active, or not scrubbed)
--   exhausted       lead_state = 'exhausted'
--   suppressed      is_phone_suppressed says so (a number suppressed after import)
--   no_state        no two-letter state, or a state with no timezone: no legal calling window
--   no_agent        no active member may work the state (agent_may_work_state)
--   rules_stale     the calling-window rules feed is stale, so tenant_can_dial_now refuses all
--   outside_window  the state's window is shut now; next_at is when it next opens
--   at_capacity     everyone who may work the state is at their open-lead ceiling
--                   (agent_can_take_pool_lead, 20260925700000 — only when that helper exists)
--   waiting         fresh/retry/nurture whose next_dial_after is still in the future
--   unscheduled     retry/nurture with no next_dial_after: no tier ever reaches it
--   lead_state      any other lead_state (detail carries it)
--   ready           none of the above: Serve next can hand it out now
--
-- Grouped by state FIRST: the state-level answers (timezone, who may work it, the window and when
-- it opens) are computed once per distinct state, then every lead is classified against them. The
-- per-lead checks are only the ones that are properties of the lead (state, suppression, cadence).
--
-- The retry tier's slot rule (a retry waits for a part of the day it has not been tried in) is an
-- ordering detail of serve_next_lead and is not modelled: a due retry is counted as ready.
--
-- The next opening is found by asking tenant_can_dial_now itself, in 15-minute steps for up to
-- eight days, then minute by minute back to the edge — so it honours every layer (state rules,
-- holidays, the agency's hours, the campaign's hours) exactly as the dial does, and cannot drift
-- from it. Not asked when the rules feed is stale, because then the answer is "never" by design.
--
-- Read-only (STABLE). Service role only, like the other lead-list reads (lib/leadLists/detail.ts
-- reads through the service client after the page's own guard). Additive: a new function.
-- ---------------------------------------------------------------------------

create or replace function public.lead_list_pool_blockers(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_campaign record;
  v_servable boolean;
  v_stale boolean;
  v_has_capacity boolean := to_regprocedure('public.agent_can_take_pool_lead(uuid, uuid)') is not null;
  v_row record;
  v_states text[] := '{}'::text[];
  v_zones text[] := '{}'::text[];
  v_kinds text[] := '{}'::text[];
  v_next timestamptz[] := '{}'::timestamptz[];
  v_kind text;
  v_zone text;
  v_at timestamptz;
  v_found boolean;
  v_room boolean;
  v_step integer;
  v_groups jsonb;
  v_total integer;
begin
  if p_tenant_id is null or p_campaign_id is null then
    return null;
  end if;

  select c.id, c.status, c.scrub_status
    into v_campaign
    from public.tenant_campaigns c
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;

  v_servable := exists (
    select 1 from public.campaigns_servable cs
     where cs.id = p_campaign_id and cs.tenant_id = p_tenant_id
  );
  v_stale := public.calling_window_rules_stale(now());

  -- ── once per state ──────────────────────────────────────────────────────
  for v_row in
    select distinct upper(btrim(coalesce(l.values->>'state', ''))) as st
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and l.campaign_id = p_campaign_id
       and q.status = 'unclaimed'
       and q.owner_user_id is null
  loop
    v_zone := null;
    v_at := null;

    if v_row.st !~ '^[A-Z]{2}$' then
      v_kind := 'no_state';
    else
      select tz.timezone into v_zone from public.state_timezones tz where tz.state = v_row.st;
      if v_zone is null then
        v_kind := 'no_state';
      elsif not exists (
        select 1
          from public.tenant_users tu
          join public.users u on u.id = tu.user_id and u.status::text = 'active'
         where tu.tenant_id = p_tenant_id
           and public.agent_may_work_state(p_tenant_id, tu.user_id, v_row.st)
      ) then
        v_kind := 'no_agent';
      elsif v_stale then
        v_kind := 'rules_stale';
      elsif not public.tenant_can_dial_now(p_tenant_id, v_row.st, p_campaign_id, v_now) then
        v_kind := 'outside_window';
        -- When it next opens: 15-minute steps for eight days, then back to the minute it opened.
        v_at := date_trunc('minute', v_now);
        v_found := false;
        for v_step in 1..768 loop
          v_at := v_at + interval '15 minutes';
          if public.tenant_can_dial_now(p_tenant_id, v_row.st, p_campaign_id, v_at) then
            v_found := true;
            exit;
          end if;
        end loop;
        if v_found then
          for v_step in 1..14 loop
            exit when not public.tenant_can_dial_now(p_tenant_id, v_row.st, p_campaign_id, v_at - interval '1 minute');
            v_at := v_at - interval '1 minute';
          end loop;
        else
          v_at := null;
        end if;
      else
        -- Open now. Serve next still refuses an agent at the ceiling a POOL lead (20260925700000),
        -- so the state is only open if somebody who may work it has room. Dynamic, because the
        -- helper belongs to another migration that may not be applied yet.
        v_room := true;
        if v_has_capacity then
          execute 'select exists (
                     select 1
                       from public.tenant_users tu
                       join public.users u on u.id = tu.user_id and u.status::text = ''active''
                      where tu.tenant_id = $1
                        and public.agent_may_work_state($1, tu.user_id, $2)
                        and public.agent_can_take_pool_lead($1, tu.user_id))'
             into v_room
            using p_tenant_id, v_row.st;
        end if;
        v_kind := case when coalesce(v_room, true) then 'open' else 'at_capacity' end;
      end if;
    end if;

    v_states := v_states || v_row.st;
    v_zones := v_zones || v_zone;
    v_kinds := v_kinds || v_kind;
    v_next := v_next || v_at;
  end loop;

  -- ── every lead, against its state ───────────────────────────────────────
  with pool as (
    select upper(btrim(coalesce(l.values->>'state', ''))) as st,
           l.values->>'phone' as phone,
           coalesce(l.lead_state, '') as lead_state,
           l.next_dial_after
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and l.campaign_id = p_campaign_id
       and q.status = 'unclaimed'
       and q.owner_user_id is null
  ), facts as (
    select f.st, f.zone, f.kind, f.next_at
      from unnest(v_states, v_zones, v_kinds, v_next) as f(st, zone, kind, next_at)
  ), classified as (
    select p.st, f.zone, f.next_at as opens_at, p.lead_state, p.next_dial_after,
           case
             when not v_servable then 'campaign'
             when p.lead_state = 'exhausted' then 'exhausted'
             when (select s.suppressed from public.is_phone_suppressed(p_tenant_id, p.phone) s) then 'suppressed'
             when f.kind <> 'open' then f.kind
             when p.lead_state in ('retry', 'nurture') and p.next_dial_after is null then 'unscheduled'
             when p.lead_state in ('fresh', 'retry', 'nurture') and p.next_dial_after > v_now then 'waiting'
             when p.lead_state not in ('fresh', 'retry', 'nurture') then 'lead_state'
             else 'ready'
           end as blocker
      from pool p
      join facts f on f.st = p.st
  ), grouped as (
    select c.blocker,
           nullif(c.st, '') as state,
           case when c.blocker = 'lead_state' then nullif(c.lead_state, '') end as detail,
           count(*)::integer as n,
           case
             when c.blocker = 'outside_window' then min(c.opens_at)
             when c.blocker = 'waiting' then min(c.next_dial_after)
           end as next_at,
           min(c.zone) as zone
      from classified c
     group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'blocker', g.blocker, 'state', g.state, 'detail', g.detail, 'count', g.n,
             'next_at', g.next_at, 'zone', g.zone)
           order by g.blocker, g.n desc, g.state), '[]'::jsonb),
         coalesce(sum(g.n), 0)::integer
    into v_groups, v_total
    from grouped g;

  return jsonb_build_object(
    'total', v_total,
    'campaign', jsonb_build_object('servable', v_servable, 'status', v_campaign.status, 'scrub_status', v_campaign.scrub_status),
    'rules_stale', v_stale,
    'capacity_checked', v_has_capacity,
    'checked_at', v_now,
    'groups', v_groups
  );
end;
$function$;

revoke all on function public.lead_list_pool_blockers(uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.lead_list_pool_blockers(uuid, uuid, timestamptz) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925703000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.lead_list_pool_blockers(uuid, uuid, timestamptz)') is null then
    raise exception '20260925703000: lead_list_pool_blockers was not created';
  end if;
  if has_function_privilege('anon', 'public.lead_list_pool_blockers(uuid, uuid, timestamptz)', 'execute')
     or has_function_privilege('tenant_app', 'public.lead_list_pool_blockers(uuid, uuid, timestamptz)', 'execute') then
    raise exception '20260925703000: lead_list_pool_blockers must be service-role only';
  end if;

  -- A list that is not this tenant's is not found, not an empty pool.
  if public.lead_list_pool_blockers('00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid()) is not null then
    raise exception '20260925703000: an unknown list must return null';
  end if;

  -- The gates are the ones serve_next_lead applies.
  select pg_get_functiondef('public.lead_list_pool_blockers(uuid, uuid, timestamptz)'::regprocedure) into v_def;
  if strpos(v_def, 'campaigns_servable') = 0 or strpos(v_def, 'is_phone_suppressed(p_tenant_id') = 0
     or strpos(v_def, 'tenant_can_dial_now(p_tenant_id') = 0 or strpos(v_def, 'agent_may_work_state(p_tenant_id') = 0 then
    raise exception '20260925703000: lead_list_pool_blockers is missing one of serving''s gates';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925703000', 'lead_list_pool_blockers') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [12/18] 20260925703100_scrub_ledger_records_in_file_duplicates.sql ────────────
begin;

-- ---------------------------------------------------------------------------
-- Scrub ledger · a number repeated inside one file is a removed, claimable row
--
-- User decision (2026-09-25, Pool concept audit): duplicates INSIDE THE SAME FILE are not usable
-- and ARE claimable — the vendor billed the same person twice. Duplicates of a lead the agency
-- already had stay usable and are not claimable (the import attaches the campaign to that lead).
--
-- Until now the ledger could not hold them, for two reasons:
--
--   1. The outcome check allowed only ('dnc', 'tcpa_litigator', 'invalid', 'suppressed').
--      Widened with 'duplicate_in_file'.
--
--   2. The ledger was unique on (tenant, campaign, phone). A number that appears three times has
--      TWO repeats, both billed, and a phone-level key can hold one. So each row now carries an
--      `occurrence`: 1 for every existing outcome (unchanged — the same number is still recorded
--      once per campaign, which is what stops a retried import from billing the vendor twice), and
--      2, 3, … for the second, third, … appearance of a number inside a file. The key becomes
--      (tenant, campaign, phone, occurrence). Re-importing the same file produces the same
--      occurrences, so it is still idempotent on the fact itself.
--
-- record_campaign_scrub_rejections is restated from its only definition (20260917140000) with the
-- occurrence read from the payload — forced to 1 for every outcome but a duplicate, so no caller
-- can use it to record the same DNC number twice — and the conflict target moved to the new key.
-- Same signature, same grants (service role only).
--
-- tenant_campaign_costs needs no change: records_usable is purchased minus count(*) of ledger rows,
-- so each recorded repeat lowers the usable count by one from the day this is applied. Earlier
-- imports are not backfilled — the files are not kept — which is why the lead-list screen says
-- from when repeats are counted.
-- ---------------------------------------------------------------------------

alter table public.tenant_campaign_scrub_rejections
  add column if not exists occurrence integer not null default 1;

do $$
declare
  v_name text;
begin
  -- The occurrence is a small positive count; a file is at most 20,000 rows (MAX_LEAD_IMPORT_ROWS).
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_occurrence_check'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_occurrence_check check (occurrence between 1 and 20000);
  end if;

  -- The outcome check, whatever it was named when the table was created.
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ 'outcome'
       and c.conname not in ('tenant_campaign_scrub_rejections_outcome_check_v2',
                             'tenant_campaign_scrub_rejections_occurrence_outcome_check')
  loop
    execute format('alter table public.tenant_campaign_scrub_rejections drop constraint %I', v_name);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_outcome_check_v2'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_outcome_check_v2
      check (outcome in ('dnc', 'tcpa_litigator', 'invalid', 'suppressed', 'duplicate_in_file'));
  end if;
  -- Only a duplicate may be a second or later occurrence.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_occurrence_outcome_check'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_occurrence_outcome_check
      check (occurrence = 1 or outcome = 'duplicate_in_file');
  end if;

  -- The phone-level key, whatever it was named, is replaced by the occurrence-level one.
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and c.contype = 'u'
       and c.conname <> 'tenant_campaign_scrub_rejections_occurrence_key'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(c.conkey) k(attnum)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           = array['campaign_id', 'phone_digits', 'tenant_id']
  loop
    execute format('alter table public.tenant_campaign_scrub_rejections drop constraint %I', v_name);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_occurrence_key'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_occurrence_key
      unique (tenant_id, campaign_id, phone_digits, occurrence);
  end if;
end $$;

-- ── recording a rejection ──────────────────────────────────────────────────
create or replace function public.record_campaign_scrub_rejections(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid,
  p_rejections jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item jsonb;
  v_recorded integer := 0;
  v_inserted integer := 0;
  v_digits text;
  v_outcome text;
  v_occurrence integer;
begin
  if p_tenant_id is null or p_campaign_id is null then
    raise exception 'REJECTION_SCOPE_INVALID';
  end if;
  if jsonb_typeof(p_rejections) <> 'array' then
    raise exception 'REJECTION_PAYLOAD_INVALID';
  end if;
  if not exists (
    select 1 from public.tenant_campaigns
     where id = p_campaign_id and tenant_id = p_tenant_id
  ) then
    raise exception 'REJECTION_CAMPAIGN_SCOPE_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_rejections)
  loop
    v_digits := regexp_replace(coalesce(v_item->>'phone_digits', ''), '[^0-9]', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then
      v_digits := right(v_digits, 10);
    end if;
    -- A rejection with no usable phone cannot be claimed from a vendor and cannot be matched to a
    -- suppression entry, so it is not evidence. Skipped rather than raised: one unparseable cell
    -- must not fail an import that is otherwise correct.
    if length(v_digits) <> 10 then
      continue;
    end if;

    v_outcome := coalesce(nullif(v_item->>'outcome', ''), 'suppressed');
    -- A repeat inside a file is the second appearance or later; every other outcome is recorded
    -- once per number per campaign, whatever the payload says.
    if v_outcome = 'duplicate_in_file' then
      v_occurrence := case when coalesce(v_item->>'occurrence', '') ~ '^[0-9]{1,5}$'
                           then least(greatest((v_item->>'occurrence')::integer, 2), 20000)
                           else 2 end;
    else
      v_occurrence := 1;
    end if;

    insert into public.tenant_campaign_scrub_rejections
      (tenant_id, campaign_id, phone_digits, outcome, detail, source_key, created_by, occurrence)
    values (
      p_tenant_id,
      p_campaign_id,
      v_digits,
      v_outcome,
      nullif(v_item->>'detail', ''),
      nullif(v_item->>'source_key', ''),
      p_created_by,
      v_occurrence
    )
    on conflict (tenant_id, campaign_id, phone_digits, occurrence) do nothing;

    -- ROW_COUNT rather than FOUND. Both would work here, but FOUND is also written by the
    -- enclosing FOR loop, and a reader should not have to know which statement set it last to
    -- know whether this vendor is about to be billed for a number twice.
    get diagnostics v_inserted = row_count;
    v_recorded := v_recorded + v_inserted;
  end loop;

  return v_recorded;
end;
$function$;

revoke all on function public.record_campaign_scrub_rejections(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, tenant_app;
grant execute on function public.record_campaign_scrub_rejections(uuid, uuid, uuid, jsonb)
  to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_recorded integer;
  v_usable integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925703100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice '20260925703100: behavioural check skipped, no tenant in this database';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
    values (v_tenant, '703100 duplicate check ' || gen_random_uuid()::text, 'list')
    returning id into v_vendor;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, total_spend_cents, records_purchased)
    values (v_tenant, v_vendor, '703100 duplicate check ' || gen_random_uuid()::text, 'list', 1000, 10)
    returning id into v_campaign;

  -- One DNC hit, and one number that appears three times: two repeats. A DNC payload that claims
  -- occurrence 5 is still recorded once.
  select public.record_campaign_scrub_rejections(v_tenant, v_campaign, null, jsonb_build_array(
    jsonb_build_object('phone_digits', '3125550100', 'outcome', 'dnc', 'occurrence', 5),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 2),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 3)
  )) into v_recorded;
  if v_recorded <> 3 then
    raise exception '20260925703100: expected 3 rows recorded, got %', v_recorded;
  end if;

  -- The same file again records nothing.
  select public.record_campaign_scrub_rejections(v_tenant, v_campaign, null, jsonb_build_array(
    jsonb_build_object('phone_digits', '3125550100', 'outcome', 'dnc'),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 2),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 3)
  )) into v_recorded;
  if v_recorded <> 0 then
    raise exception '20260925703100: re-recording must record 0, got %', v_recorded;
  end if;

  select records_usable into v_usable from public.tenant_campaign_costs where campaign_id = v_campaign;
  if v_usable <> 7 then
    raise exception '20260925703100: expected 7 usable of 10, got %', v_usable;
  end if;

  delete from public.tenant_campaign_scrub_rejections where campaign_id = v_campaign;
  delete from public.tenant_campaigns where id = v_campaign;
  delete from public.tenant_lead_vendors where id = v_vendor;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925703100', 'scrub_ledger_records_in_file_duplicates') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [13/18] 20260925703200_claim_ledger_holds_import_removals.sql ─────────────────
begin;

-- ---------------------------------------------------------------------------
-- Vendor returns · a row removed at import can be claimed in the ledger, not only exported
--
-- User decision (2026-09-25, Pool concept audit): the rows the scrub removed at import go into the
-- claim ledger. Until now they could only be downloaded as a CSV (Export claimable rows): the
-- ledger's item row required a lead, and a removed row never became one — it is evidence in
-- tenant_campaign_scrub_rejections, not a lead.
--
--   lead_claim_items      lead_id becomes nullable; a new scrub_rejection_id points at the ledger
--                         row instead. Exactly one of the two is set. A removed row can be on one
--                         claim at most (partial unique index). Reason widened with
--                         'duplicate_in_file' (20260925703100), here and on lead_claims.
--   enforce_lead_claim_item_tenant   restated from 20260913440000: a removal item must belong to
--                         the claim's tenant and campaign, exactly as a lead item must.
--   vendor_claimable_leads           restated from 20260913440000 with two more exclusions:
--                         · a lead whose number is already claimed as an import removal of the same
--                           campaign is not offered again (a DNC row imported-and-suppressed is
--                           both a lead and a ledger row — one number, one claim);
--                         · a hit on the agency's OWN do-not-call list (screening outcome 'dnc'
--                           with no screening result) is not offered at all — the Returns audit
--                           found the lead-based branch charging them to the vendor, against the
--                           lead-list rule. Only a registry hit, which has a screening result, is.
--   create_import_removal_claim(tenant, campaign, actor, reason?)   drafts a claim from the
--                         campaign's creditable, unclaimed removals still inside the vendor's
--                         return window, at the same per-record rate create_vendor_return_claim
--                         uses, and writes one audit row. The claim is a normal draft: it is
--                         submitted and resolved through the existing update_vendor_return_claim.
--
-- Creditable is the lead-list screen's rule (lib/leadLists/detail.ts CREDITABLE): TCPA litigator,
-- registry DNC, invalid, and a repeat inside the file. A hit on the agency's OWN do-not-call list
-- is the agency's decision, not the vendor's defect, and is never claimed; the ledger records it as
-- 'dnc' with the screening sentence "…on your do-not-call list…", which is how it is told apart.
--
-- The existing lead-based flows (create_vendor_return_claim, vendor_returns_report,
-- vendor_return_claim_detail, update_vendor_return_claim) keep their signatures and behaviour.
-- ---------------------------------------------------------------------------

alter table public.lead_claim_items alter column lead_id drop not null;

alter table public.lead_claim_items
  add column if not exists scrub_rejection_id uuid references public.tenant_campaign_scrub_rejections(id);

do $$
declare
  v_name text;
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_subject_check') then
    alter table public.lead_claim_items
      add constraint lead_claim_items_subject_check check (num_nonnulls(lead_id, scrub_rejection_id) = 1);
  end if;

  -- The reason checks, whatever they were named when the tables were created.
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.lead_claim_items'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ 'reason' and c.conname <> 'lead_claim_items_reason_check_v2'
  loop
    execute format('alter table public.lead_claim_items drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_reason_check_v2') then
    alter table public.lead_claim_items add constraint lead_claim_items_reason_check_v2
      check (reason in ('wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone', 'duplicate_in_file'));
  end if;

  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.lead_claims'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '''mixed''' and c.conname <> 'lead_claims_reason_check_v2'
  loop
    execute format('alter table public.lead_claims drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claims'::regclass and conname = 'lead_claims_reason_check_v2') then
    alter table public.lead_claims add constraint lead_claims_reason_check_v2
      check (reason in ('mixed', 'wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone', 'duplicate_in_file'));
  end if;
end $$;

create unique index if not exists lead_claim_items_scrub_rejection_key
  on public.lead_claim_items (tenant_id, scrub_rejection_id)
  where scrub_rejection_id is not null;

-- ── an item belongs to its claim's tenant and campaign ─────────────────────
create or replace function public.enforce_lead_claim_item_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claim_tenant uuid;
  v_claim_campaign uuid;
  v_claim_vendor uuid;
  v_lead_tenant uuid;
  v_lead_campaign uuid;
  v_campaign_vendor uuid;
begin
  select tenant_id, campaign_id, vendor_id into v_claim_tenant, v_claim_campaign, v_claim_vendor
    from lead_claims where id = new.claim_id;
  -- A lead item is checked against the lead; a removal item against the ledger row. Both carry a
  -- tenant and a campaign, and the check is the same one.
  if new.scrub_rejection_id is not null then
    select tenant_id, campaign_id into v_lead_tenant, v_lead_campaign
      from tenant_campaign_scrub_rejections where id = new.scrub_rejection_id;
  else
    select tenant_id, campaign_id into v_lead_tenant, v_lead_campaign
      from agent_leads where id = new.lead_id;
  end if;
  select vendor_id into v_campaign_vendor from tenant_campaigns where id = v_claim_campaign;
  if v_claim_tenant is null or v_lead_tenant is distinct from new.tenant_id
     or v_claim_tenant is distinct from new.tenant_id
     or v_lead_campaign is distinct from v_claim_campaign
     or v_campaign_vendor is distinct from v_claim_vendor then
    raise exception 'LEAD_CLAIM_ITEM_TENANT_MISMATCH';
  end if;
  if tg_op = 'UPDATE' and (old.claim_id is distinct from new.claim_id or old.lead_id is distinct from new.lead_id
                           or old.scrub_rejection_id is distinct from new.scrub_rejection_id
                           or old.tenant_id is distinct from new.tenant_id) then
    raise exception 'LEAD_CLAIM_ITEM_ATTRIBUTION_IMMUTABLE';
  end if;
  return new;
end;
$function$;

-- ── the lead-based candidates, minus numbers already claimed as removals ────
create or replace function public.vendor_claimable_leads(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns table(
  lead_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  campaign_name text,
  vendor_name text,
  lead_created_at timestamptz,
  reason text,
  source_type text,
  source_id uuid,
  evidence jsonb,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select l.id as lead_id, l.campaign_id, c.vendor_id, c.name as campaign_name, v.name as vendor_name,
           l.created_at as lead_created_at,
            case coalesce(sr.outcome, l.screening_outcome) when 'dnc' then 'dnc' when 'tcpa_litigator' then 'tcpa_litigator' else 'invalid_phone' end as reason,
           'scrub'::text as source_type, l.screening_result_id as source_id,
           jsonb_build_object('source', 'scrub', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'screening_outcome', coalesce(sr.outcome, l.screening_outcome),
             'screening_result_id', l.screening_result_id, 'screening_checked_at', l.screening_checked_at,
             'screening_version', l.screening_version) as evidence,
           l.created_at + make_interval(days => v.return_window_days) as claimable_until,
           1 as priority
       from agent_leads l
       left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
       and coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone')
       -- A hit on the agency's OWN do-not-call list is stored as 'dnc' with no screening result
       -- (lib/compliance/screening.ts): it is the agency's decision, not the vendor's defect, and is
       -- never charged back. Only a registry hit — one with a screening result — is.
       and not (coalesce(sr.outcome, l.screening_outcome) = 'dnc' and l.screening_result_id is null)
    union all
    select l.id, l.campaign_id, c.vendor_id, c.name, v.name, l.created_at,
           a.disposition, 'disposition', a.id,
           jsonb_build_object('source', 'disposition', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'disposition', a.disposition,
             'attempt_id', a.id, 'attempted_at', a.attempted_at, 'dial_clicked_at', a.dial_clicked_at,
             'attempt_number', a.attempt_number) as evidence,
           l.created_at + make_interval(days => v.return_window_days), 2
      from agent_leads l
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
      join lateral (
        select a.* from tenant_call_attempts a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.disposition in ('wrong_number', 'disconnected')
         order by a.attempted_at desc, a.id desc limit 1
      ) a on true
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  one_per_lead as (
    select distinct on (lead_id) * from candidates
     where not exists (
       select 1 from lead_claim_items i join lead_claims cl on cl.id = i.claim_id
        where i.tenant_id = p_tenant_id and i.lead_id = candidates.lead_id
     )
       -- One number, one claim: not a lead whose number this campaign already claimed as an
       -- import removal (20260925703200).
       and not exists (
         select 1 from lead_claim_items ri
           join tenant_campaign_scrub_rejections r on r.id = ri.scrub_rejection_id
          where ri.tenant_id = p_tenant_id
            and r.tenant_id = p_tenant_id
            and r.campaign_id = candidates.campaign_id
            and r.phone_digits = right(regexp_replace(coalesce(candidates.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
       )
     order by lead_id, priority, claimable_until desc
  )
  select lead_id, campaign_id, vendor_id, campaign_name, vendor_name, lead_created_at, reason,
         source_type, source_id, evidence, claimable_until,
         greatest(0, floor(extract(epoch from (claimable_until - now())) / 86400))::integer as days_remaining,
         claimable_until > now() as claimable
    from one_per_lead
   order by claimable_until asc, lead_created_at asc;
$function$;

-- ── drafting a claim from the import removals ──────────────────────────────
create or replace function public.create_import_removal_claim(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_vendor uuid;
  v_window integer;
  v_rate numeric;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_claim uuid;
  v_rows integer;
  v_amount integer;
  v_claim_reason text;
begin
  if v_reason is not null and v_reason not in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file') then
    raise exception 'LEAD_CLAIM_REASON_INVALID';
  end if;

  -- The campaign row is locked so two presses cannot both draft the same rows; the partial unique
  -- index on lead_claim_items would refuse the second anyway, but as an error rather than a no-op.
  select c.vendor_id, c.total_spend_cents::numeric / nullif(c.records_purchased, 0), v.return_window_days
    into v_vendor, v_rate, v_window
    from tenant_campaigns c
    join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id
     for update of c;
  if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  if v_rate is null then raise exception 'LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST'; end if;

  create temporary table if not exists pg_temp.import_removal_claim_rows (
    id uuid, phone_digits text, reason text, evidence jsonb
  ) on commit drop;
  truncate pg_temp.import_removal_claim_rows;

  insert into pg_temp.import_removal_claim_rows (id, phone_digits, reason, evidence)
  select r.id, r.phone_digits,
         case r.outcome when 'invalid' then 'invalid_phone' else r.outcome end,
         jsonb_build_object('source', 'import_removal', 'scrub_rejection_id', r.id, 'phone', r.phone_digits,
                            'outcome', r.outcome, 'detail', r.detail, 'source_row', r.source_key,
                            'occurrence', r.occurrence, 'rejected_at', r.rejected_at)
    from tenant_campaign_scrub_rejections r
   where r.tenant_id = p_tenant_id
     and r.campaign_id = p_campaign_id
     and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
     -- The agency's own list is its decision, not the vendor's defect.
     and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
     and (v_reason is null or r.outcome = v_reason)
     and r.rejected_at + make_interval(days => v_window) > now()
     and not exists (
       select 1 from lead_claim_items i where i.tenant_id = p_tenant_id and i.scrub_rejection_id = r.id
     )
     -- Already claimed as a lead of this campaign (an imported-and-suppressed DNC row is both).
     and not exists (
       select 1 from lead_claim_items i
         join agent_leads l on l.id = i.lead_id and l.tenant_id = i.tenant_id
        where i.tenant_id = p_tenant_id
          and l.campaign_id = p_campaign_id
          and right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) = r.phone_digits
     );

  select count(*)::integer, round(count(*) * v_rate)::integer,
         case when count(distinct reason) = 1 then min(reason) else 'mixed' end
    into v_rows, v_amount, v_claim_reason
    from pg_temp.import_removal_claim_rows;
  if v_rows = 0 then raise exception 'LEAD_CLAIM_NO_CLAIMABLE_LEADS'; end if;

  insert into lead_claims (tenant_id, campaign_id, vendor_id, reason, lead_count, amount_claimed_cents, created_by)
  values (p_tenant_id, p_campaign_id, v_vendor, v_claim_reason, v_rows, v_amount, p_created_by)
  returning id into v_claim;

  insert into lead_claim_items (claim_id, tenant_id, lead_id, scrub_rejection_id, reason, evidence)
  select v_claim, p_tenant_id, null, x.id, x.reason, x.evidence
    from pg_temp.import_removal_claim_rows x;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, reason, metadata)
  values ('tenant', p_created_by, 'tenant.vendor_claim_drafted_from_import', 'lead_claim', v_claim::text, null,
          jsonb_build_object(
            'tenantId', p_tenant_id,
            'campaign_id', p_campaign_id,
            'vendor_id', v_vendor,
            'claim_id', v_claim,
            'rows', v_rows,
            'amount_claimed_cents', v_amount,
            'reason', coalesce(v_reason, 'all')));

  return jsonb_build_object('claim_id', v_claim, 'rows', v_rows, 'amount_claimed_cents', v_amount);
end;
$function$;

revoke all on function public.create_import_removal_claim(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.create_import_removal_claim(uuid, uuid, uuid, text) to service_role;
revoke all on function public.vendor_claimable_leads(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_claimable_leads(uuid, uuid) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925703200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'scrub_rejection_id') then
    raise exception '20260925703200: lead_claim_items.scrub_rejection_id was not added';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'lead_id' and is_nullable = 'NO') then
    raise exception '20260925703200: lead_claim_items.lead_id is still not null';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_subject_check') then
    raise exception '20260925703200: an item must name exactly one of a lead or a removal';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'lead_claim_items_scrub_rejection_key') then
    raise exception '20260925703200: a removal could be claimed twice';
  end if;
  if to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is null then
    raise exception '20260925703200: create_import_removal_claim was not created';
  end if;
  if has_function_privilege('anon', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('tenant_app', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute') then
    raise exception '20260925703200: create_import_removal_claim must be service-role only';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'scrub_rejection_id') = 0 then
    raise exception '20260925703200: vendor_claimable_leads does not exclude numbers claimed as removals';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure),
            'and not (coalesce(sr.outcome, l.screening_outcome) = ''dnc'' and l.screening_result_id is null)') = 0 then
    raise exception '20260925703200: vendor_claimable_leads offers hits on the agency''s own do-not-call list to the vendor';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), '''wrong_number'', ''disconnected''') = 0 then
    raise exception '20260925703200: vendor_claimable_leads lost the wrong-number / disconnected branch';
  end if;
  if strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925703200: create_import_removal_claim claims hits on the agency''s own list';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925703200', 'claim_ledger_holds_import_removals') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [14/18] 20260925704000_booking_refuses_an_agent_with_no_hours.sql ─────────────
begin;

-- ---------------------------------------------------------------------------
-- Appointments (LA-2 §11) · an agent with no working hours cannot be booked
--
-- `book_appointment` checked working hours and blocked time only when the agent had availability
-- rows: the zone came from the first of them, and `if v_zone is not null then ... end if` skipped
-- both checks when there were none. So an agent who had never set their hours could be booked at
-- any time inside the customer's calling window — exactly the "time that does not exist" the
-- calendar says cannot be typed. The pickers never offered such an agent (their list is built from
-- availability), but the API took the booking.
--
-- USER DECISION 2026-09-25: refuse it, with its own code, APPOINTMENT_AGENT_HAS_NO_HOURS.
-- Appointments already on the books are untouched: this is a booking rule, not a sweep.
--
-- `reschedule_appointment` and `rebook_appointment` (20260925704200) both book through this
-- function, so they refuse the same way.
--
-- Reproduced from 20260924230200 (its latest definition); every rule is kept in the same order with
-- the same exception names. The one addition is marked [704000].
-- ---------------------------------------------------------------------------

create or replace function public.book_appointment(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_agent_user_id uuid,
  p_booked_by uuid,
  p_starts_at_utc timestamptz,
  p_notes text default null,
  p_duration_minutes integer default null
)
returns table(appointment_id uuid, starts_at_utc timestamptz, duration_minutes integer, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy record;
  v_minutes integer;
  v_buffer integer;
  v_zone text;
  v_state text;
  v_campaign uuid;
  v_customer_zone text;
  v_local timestamp;
  v_dow smallint;
  v_id uuid;
  v_booked_that_day integer;
  v_range tstzrange;
  v_agency_cap integer;
  v_agency_zone text;
  v_agency_day date;
  v_seat smallint := 1;
begin
  if p_starts_at_utc <= now() then
    raise exception 'APPOINTMENT_IN_THE_PAST';
  end if;

  -- [704000] Nobody can be booked who has no working hours. Checked before anything else about
  -- the agent, because every later rule (hours, blocks, same-day, the per-agent cap) is read in
  -- the zone those hours carry.
  if not exists (
    select 1 from tenant_agent_availability av
     where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id
  ) then
    raise exception 'APPOINTMENT_AGENT_HAS_NO_HOURS';
  end if;

  select * into v_policy from tenant_agent_booking_policy
   where tenant_id = p_tenant_id and user_id = p_agent_user_id;
  v_minutes := coalesce(p_duration_minutes, v_policy.appointment_minutes, 30);
  v_buffer := coalesce(v_policy.buffer_minutes, 0);
  v_range := tstzrange(p_starts_at_utc, p_starts_at_utc + make_interval(mins => v_minutes), '[)');

  select l.values->>'state', l.campaign_id into v_state, v_campaign
    from agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if v_state is null then
    raise exception 'APPOINTMENT_LEAD_HAS_NO_STATE';
  end if;

  select timezone into v_customer_zone from state_timezones where state = upper(v_state);
  if v_customer_zone is null then
    raise exception 'APPOINTMENT_LEAD_HAS_NO_STATE';
  end if;

  -- [added] A stale state-rules feed refuses every dial (20260924230100), and an appointment is a
  -- call. Said as itself rather than as "outside the customer's window".
  if public.calling_window_rules_stale(now()) then
    raise exception 'APPOINTMENT_CALLING_RULES_STALE';
  end if;

  -- The customer's legal window, at the booked instant. An appointment is a call, and an
  -- appointment at 3am is a call at 3am that our own system put in the diary.
  if not tenant_can_dial_now(p_tenant_id, v_state, v_campaign, p_starts_at_utc) then
    raise exception 'APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW';
  end if;

  -- The agent's own working hours, in the agent's zone.
  select av.timezone into v_zone from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id limit 1;

  -- Same-day booking, in the agent's own day. On by default, which is how booking always behaved.
  if coalesce(v_policy.allow_same_day, true) = false
     and (p_starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date
         = (now() at time zone coalesce(v_zone, 'UTC'))::date then
    raise exception 'APPOINTMENT_SAME_DAY_NOT_ALLOWED';
  end if;

  if v_zone is not null then
    v_local := p_starts_at_utc at time zone v_zone;
    v_dow := extract(dow from v_local)::smallint;

    if not exists (
      select 1 from tenant_agent_availability av
       where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id
         and av.weekday = v_dow
         and v_local::time >= av.start_time
         and (v_local + make_interval(mins => v_minutes))::time <= av.end_time
    ) then
      raise exception 'APPOINTMENT_OUTSIDE_AVAILABILITY';
    end if;

    -- One-off blocks: the stored instant, exactly as before.
    if exists (
      select 1 from tenant_agent_blocks b
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and coalesce(b.repeats, 'none') = 'none'
         and tstzrange(b.starts_at, b.ends_at, '[)') && v_range
    ) then
      raise exception 'APPOINTMENT_BLOCKED_TIME';
    end if;

    -- Repeating blocks: every occurrence whose day could reach the requested range.
    if exists (
      select 1
        from tenant_agent_blocks b
        cross join lateral generate_series(
          ((p_starts_at_utc at time zone v_zone)::date
            - ceil(extract(epoch from (b.ends_at - b.starts_at)) / 86400.0)::integer)::timestamp,
          ((p_starts_at_utc + make_interval(mins => v_minutes)) at time zone v_zone)::date::timestamp,
          interval '1 day'
        ) as g(d)
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and coalesce(b.repeats, 'none') <> 'none'
         and g.d::date >= (b.starts_at at time zone v_zone)::date
         and case b.repeats
               when 'daily' then true
               when 'weekdays' then extract(isodow from g.d) between 1 and 5
               when 'weekly' then extract(dow from g.d) = extract(dow from (b.starts_at at time zone v_zone))
               when 'yearly' then to_char(g.d, 'MM-DD') = to_char(b.starts_at at time zone v_zone, 'MM-DD')
               else false
             end
         and tstzrange(
               (g.d::date + (b.starts_at at time zone v_zone)::time) at time zone v_zone,
               ((g.d::date + (b.starts_at at time zone v_zone)::time) at time zone v_zone) + (b.ends_at - b.starts_at),
               '[)'
             ) && v_range
    ) then
      raise exception 'APPOINTMENT_BLOCKED_TIME';
    end if;
  end if;

  -- [added] Busy time in a connected Google or Outlook calendar, when the agent honours it. Only a
  -- CONNECTED calendar counts: a pending or failed connection has no trustworthy busy set.
  if coalesce(v_policy.honour_linked_calendars, true) and exists (
    select 1
      from tenant_calendar_busy cb
      join tenant_connected_calendars cc on cc.id = cb.calendar_id and cc.status = 'connected'
     where cb.tenant_id = p_tenant_id and cb.user_id = p_agent_user_id
       and cb.ends_at > p_starts_at_utc
       and tstzrange(cb.starts_at, cb.ends_at, '[)') && v_range
  ) then
    raise exception 'APPOINTMENT_LINKED_CALENDAR_BUSY';
  end if;

  -- The daily cap, server-side. Counted in the AGENT's day, not UTC's: a cap of eight means eight
  -- in his working day, and a UTC day would split it across two of his.
  if v_policy.max_per_day is not null then
    select count(*) into v_booked_that_day
      from tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.agent_user_id = p_agent_user_id
       and a.status in ('booked', 'confirmed')
       and (a.starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date
           = (p_starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date;

    if v_booked_that_day >= v_policy.max_per_day then
      raise exception 'APPOINTMENT_DAILY_CAP_REACHED';
    end if;
  end if;

  -- [added] The agency's cap: every live appointment in the tenant that day, in the agency's own
  -- timezone. The lock makes "count, then insert" one decision per tenant-day.
  select s.max_per_day into v_agency_cap from tenant_booking_settings s where s.tenant_id = p_tenant_id;
  if v_agency_cap is not null then
    begin
      select nullif(btrim(ap.timezone), '') into v_agency_zone from agency_profiles ap where ap.tenant_id = p_tenant_id;
    exception when undefined_table or undefined_column then
      v_agency_zone := null;
    end;
    v_agency_zone := coalesce(v_agency_zone, v_zone, 'UTC');
    v_agency_day := (p_starts_at_utc at time zone v_agency_zone)::date;
    perform pg_advisory_xact_lock(hashtextextended('booking-cap:' || p_tenant_id::text || ':' || v_agency_day::text, 0));

    select count(*) into v_booked_that_day
      from tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.status in ('booked', 'confirmed')
       and a.starts_at_utc >= (v_agency_day::timestamp at time zone v_agency_zone)
       and a.starts_at_utc < ((v_agency_day + 1)::timestamp at time zone v_agency_zone);

    if v_booked_that_day >= v_agency_cap then
      raise exception 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED';
    end if;
  end if;

  -- The overlap itself is NOT checked here — buffer included. The exclusion constraint decides it,
  -- seat by seat, which is the only way two setters racing on the same slot get one winner.
  begin
    insert into tenant_appointments
      (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
       customer_timezone, notes, buffer_minutes, seat)
    values
      (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
       v_customer_zone, nullif(btrim(p_notes), ''), v_buffer, 1)
    returning id into v_id;
  exception when exclusion_violation then
    -- [added] Double-booking allowed: the second seat. Refused in turn if it is taken too.
    if not coalesce(v_policy.allow_double_booking, false) then
      raise exception 'APPOINTMENT_SLOT_TAKEN';
    end if;
    v_seat := 2;
  end;

  if v_id is null and v_seat = 2 then
    begin
      insert into tenant_appointments
        (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
         customer_timezone, notes, buffer_minutes, seat)
      values
        (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
         v_customer_zone, nullif(btrim(p_notes), ''), v_buffer, 2)
      returning id into v_id;
    exception when exclusion_violation then
      raise exception 'APPOINTMENT_SLOT_TAKEN';
    end;
  end if;

  return query select v_id, p_starts_at_utc, v_minutes,
    format('Booked for %s in the customer''s %s.', p_starts_at_utc at time zone v_customer_zone, v_customer_zone)
      || case when v_seat = 2 then ' Double-booked: this slot already had an appointment.' else '' end;
end;
$function$;

revoke all on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925704000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_appointment';
  if v_def is null or v_def !~ 'APPOINTMENT_AGENT_HAS_NO_HOURS' then
    raise exception 'book_appointment does not refuse an agent with no working hours';
  end if;
  -- Nothing the previous definition enforced was lost in the rewrite.
  if v_def !~ 'APPOINTMENT_IN_THE_PAST' or v_def !~ 'APPOINTMENT_LEAD_HAS_NO_STATE'
     or v_def !~ 'APPOINTMENT_CALLING_RULES_STALE' or v_def !~ 'APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW'
     or v_def !~ 'APPOINTMENT_SAME_DAY_NOT_ALLOWED' or v_def !~ 'APPOINTMENT_OUTSIDE_AVAILABILITY'
     or v_def !~ 'APPOINTMENT_BLOCKED_TIME' or v_def !~ 'b\.repeats'
     or v_def !~ 'APPOINTMENT_LINKED_CALENDAR_BUSY' or v_def !~ 'APPOINTMENT_DAILY_CAP_REACHED'
     or v_def !~ 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED' or v_def !~ 'allow_double_booking'
     or v_def !~ 'APPOINTMENT_SLOT_TAKEN' then
    raise exception 'book_appointment is missing a rule after the 704000 rewrite';
  end if;

  if has_function_privilege('tenant_app', 'public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer)', 'execute') then
    raise exception 'the tenant plane can call book_appointment directly';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925704000', 'booking_refuses_an_agent_with_no_hours') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [15/18] 20260925704200_rebook_a_no_show.sql ───────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Appointments (LA-2 §11) · rebook a no-show
--
-- The board puts two actions on a no-show: "Call her now" and "Rebook". There was no way to do the
-- second: `reschedule_appointment` only moves a live (booked / confirmed) appointment, and a
-- no-show is closed. The only route was to book the lead again from scratch, which lost the link
-- between the two appointments.
--
-- USER DECISION 2026-09-25:
--   * the person who rebooks is `booked_by` on the new appointment (the scorecard credits them);
--   * the no-show STAYS a no-show and keeps counting against whoever booked it. Rebooking is a new
--     appointment, not an amendment of the old one — otherwise a setter could launder a no-show
--     into a show by rebooking it.
--
-- What this adds:
--   tenant_appointments.rebooked_from   the no-show this appointment was rebooked from.
--   rebook_appointment(...)             books through book_appointment (every rule, the race, the
--                                       caps) and links the new row to the no-show. Refuses a row
--                                       that is not a no-show (APPOINTMENT_NOT_A_NO_SHOW) and a
--                                       no-show that already has a live rebooking
--                                       (APPOINTMENT_ALREADY_REBOOKED). The no-show is locked while
--                                       this runs, so two people rebooking it at once get one
--                                       winner.
--   reschedule_appointment(...)         reproduced from 20260913370000 (its latest definition),
--                                       unchanged except that a rebooked appointment keeps its
--                                       `rebooked_from` when it is moved, so the chain survives a
--                                       reschedule. [704200] marks the addition.
-- ---------------------------------------------------------------------------

alter table public.tenant_appointments
  add column if not exists rebooked_from uuid references public.tenant_appointments(id) on delete set null;

create index if not exists tenant_appointments_rebooked_from_idx
  on public.tenant_appointments (rebooked_from)
  where rebooked_from is not null;

-- ── rebook ─────────────────────────────────────────────────────────────────
create or replace function public.rebook_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_starts_at_utc timestamptz,
  p_agent_user_id uuid default null
)
returns table(appointment_id uuid, starts_at_utc timestamptz, duration_minutes integer, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_result record;
begin
  select * into a from tenant_appointments t
   where t.id = p_appointment_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status <> 'no_show' then raise exception 'APPOINTMENT_NOT_A_NO_SHOW'; end if;

  -- One live rebooking per no-show. A rebooking that was itself cancelled frees it again; one that
  -- was rescheduled is followed by its replacement, which carries the same `rebooked_from`.
  if exists (
    select 1 from tenant_appointments r
     where r.tenant_id = p_tenant_id and r.rebooked_from = a.id
       and r.status in ('booked', 'confirmed', 'pending', 'showed')
  ) then
    raise exception 'APPOINTMENT_ALREADY_REBOOKED';
  end if;

  -- Every booking rule, unchanged: the customer's window, hours, blocks, caps and the slot race.
  -- The actor is `booked_by`; the duration is the agent's current policy, not the old slot's.
  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, coalesce(p_agent_user_id, a.agent_user_id), p_actor, p_starts_at_utc, a.notes, null);

  update tenant_appointments t set rebooked_from = a.id, updated_at = now()
   where t.id = v_result.appointment_id;

  return query select v_result.appointment_id, v_result.starts_at_utc, v_result.duration_minutes,
    ('Rebooked. ' || v_result.reason || ' The no-show stays on the record.')::text;
end;
$function$;

revoke all on function public.rebook_appointment(uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.rebook_appointment(uuid, uuid, uuid, timestamptz, uuid) to service_role;

-- ── reschedule keeps the chain ─────────────────────────────────────────────
create or replace function public.reschedule_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_starts_at_utc timestamptz
)
returns table(appointment_id uuid, starts_at_utc timestamptz, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_new uuid;
  v_result record;
begin
  select * into a from tenant_appointments
   where id = p_appointment_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'APPOINTMENT_NOT_ACTIVE'; end if;

  -- The old row leaves the constraint's scope FIRST, in the same transaction, so the new time may
  -- legitimately be the old one and a reschedule can never collide with itself. If the booking
  -- below fails, this rolls back with it and the original slot is still held.
  update tenant_appointments set status = 'rescheduled', updated_at = now() where id = a.id;

  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, a.agent_user_id, p_actor, p_starts_at_utc, a.notes, a.duration_minutes);
  v_new := v_result.appointment_id;

  -- [704200] A rebooked appointment that is moved is still the rebooking of the same no-show.
  if a.rebooked_from is not null then
    update tenant_appointments set rebooked_from = a.rebooked_from where id = v_new;
  end if;

  return query select v_new, p_starts_at_utc, 'Rescheduled; the previous slot is free.'::text;
end;
$function$;

revoke all on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925704200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_appointments' and column_name = 'rebooked_from'
  ) then
    raise exception 'tenant_appointments.rebooked_from was not added';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rebook_appointment';
  if v_def is null or v_def !~ 'APPOINTMENT_NOT_A_NO_SHOW' or v_def !~ 'APPOINTMENT_ALREADY_REBOOKED'
     or v_def !~ 'book_appointment\(' or v_def !~ 'for update' then
    raise exception 'rebook_appointment does not book through book_appointment under a lock';
  end if;
  -- The no-show itself is never rewritten.
  if v_def ~ 'set status' then
    raise exception 'rebook_appointment changes the no-show it rebooks';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reschedule_appointment';
  if v_def !~ 'rebooked_from' or v_def !~ 'APPOINTMENT_NOT_ACTIVE' then
    raise exception 'reschedule_appointment lost a rule or does not keep rebooked_from';
  end if;

  if has_function_privilege('tenant_app', 'public.rebook_appointment(uuid, uuid, uuid, timestamptz, uuid)', 'execute') then
    raise exception 'the tenant plane can call rebook_appointment directly';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925704200', 'rebook_a_no_show') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [16/18] 20260925704300_setter_scorecard_for_one_agent.sql ─────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Appointments (LA-2 §11) · the setter scorecard for ONE agent's calendar
--
-- The board's "Setters · last 30 days" sits on the licensed agent's own page and is about the
-- setters who book into THAT calendar: "61 slots of your calendar spent on nobody". The page read
-- `tenant_setter_scorecard`, which is per setter across the whole agency, scoped by permission:
-- an owner saw every setter's bookings for every agent, and a producer (scorecard.view.own) saw
-- only their own rows — an empty table on the one page that is about them.
--
-- USER DECISION 2026-09-25: the scorecard on this page covers only setters booking into this
-- agent's calendar, it is visible to producers too, and it is ranked by shown.
--
-- `setter_scorecard_for_agent` returns, per person who booked into the agent's calendar (the agent
-- booking for themselves is not a setter and is left out), the same counts and the same rules as
-- `tenant_setter_scorecard` (20260913415000):
--   booked    appointments they booked into this calendar, by booking date, since p_since;
--   showed / no_show / pending   by status — pending is never a no-show;
--   sold      a later application_submitted / sent_to_underwriting on the lead;
--   dials / contacts   the setter's own dialling since p_since, across every calendar (a dial is
--             not booked into anyone's calendar until it becomes an appointment).
-- Ranking is the caller's job; the page sorts by shown.
--
-- Service role only, like the other booking functions: the page reads it server-side after its
-- own owner/producer gate, and the agent id is always the signed-in user.
-- ---------------------------------------------------------------------------

create or replace function public.setter_scorecard_for_agent(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_since timestamptz
)
returns table(user_id uuid, booked integer, showed integer, no_show integer, pending integer, sold integer, dials integer, contacts integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select ap.booked_by, ap.status, ap.lead_id, ap.starts_at_utc, ap.tenant_id
      from tenant_appointments ap
     where ap.tenant_id = p_tenant_id
       and ap.agent_user_id = p_agent_user_id
       and ap.booked_by is not null
       and ap.booked_by <> p_agent_user_id
       and ap.created_at >= p_since
  ),
  booked as (
    select m.booked_by as user_id,
           count(*)::integer as booked,
           count(*) filter (where m.status = 'showed')::integer as showed,
           count(*) filter (where m.status = 'no_show')::integer as no_show,
           count(*) filter (where m.status = 'pending')::integer as pending,
           count(*) filter (
             where exists (
               select 1 from tenant_call_attempts ca2
                where ca2.tenant_id = m.tenant_id
                  and ca2.lead_id = m.lead_id
                  and ca2.attempted_at >= m.starts_at_utc
                  and ca2.disposition in ('application_submitted', 'sent_to_underwriting')
             )
           )::integer as sold
      from mine m
     group by m.booked_by
  )
  select b.user_id, b.booked, b.showed, b.no_show, b.pending, b.sold,
         coalesce(d.dials, 0)::integer, coalesce(d.contacts, 0)::integer
    from booked b
    left join lateral (
      select count(*) as dials,
             count(*) filter (where is_contact_disposition(ca.disposition)) as contacts
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id
         and ca.agent_id = b.user_id
         and ca.attempted_at >= p_since
    ) d on true;
$function$;

revoke all on function public.setter_scorecard_for_agent(uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.setter_scorecard_for_agent(uuid, uuid, timestamptz) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925704300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'setter_scorecard_for_agent';
  if v_def is null or v_def !~ 'agent_user_id = p_agent_user_id' or v_def !~ 'booked_by <> p_agent_user_id' then
    raise exception 'setter_scorecard_for_agent is not scoped to the one calendar';
  end if;

  -- Runs, and returns nothing for an agent who does not exist.
  perform 1 from public.setter_scorecard_for_agent(gen_random_uuid(), gen_random_uuid(), now() - interval '30 days');

  if has_function_privilege('tenant_app', 'public.setter_scorecard_for_agent(uuid, uuid, timestamptz)', 'execute') then
    raise exception 'the tenant plane can read another agent''s setter scorecard directly';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925704300', 'setter_scorecard_for_one_agent') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [17/18] 20260925705000_activity_log_learns_the_dial_and_outcome.sql ───────────
begin;

-- Activity · the call log learns the dial and the outcome.
--
-- THE DEFECT. tenant_lead_activity (20260913460000) was told about a call by one trigger, AFTER
-- INSERT on tenant_call_attempts. The dialer inserts the attempt EMPTY when it prepares the call
-- (lib/dialerScripts/service.ts, startAttempt) and only later UPDATEs dial_clicked_at (the Dial
-- press) and disposition (complete_existing_dial_disposition). So the one trigger always copied two
-- nulls, and no activity row ever carried a click or an outcome: Dials, Logged and the contact rate
-- read zero on the Activity page and on the agent scorecard behind it. Confirmed live 2026-09-25:
-- 53 activity rows, 0 clicked, 0 logged; 11 attempts dialled, 9 with an outcome.
--
-- THE FIX. The same trigger now also fires on UPDATE OF dial_clicked_at, disposition, and links
-- the attempt to the card it belongs to:
--   1. a row already linked to this attempt (call_attempt_id, new here);
--   2. else the latest card served for the attempt's work item, to the same agent, at or before the
--      attempt, that has no outcome yet;
--   3. else the latest such card for the same lead and agent.
-- A card linked to an earlier attempt that never got an outcome (prepared, dialled, abandoned) can
-- be re-linked by the next attempt on it; one with an outcome never is.
--
-- INBOUND RETURN CALLS STAY UNMATCHED. They were never served (decision 1 of 20260917145000): an
-- attempt with no work item is inbound by construction (an outbound attempt requires a claim), so
-- it is never matched. One started while the agent held a claim is matched at the Dial press like
-- any call, and un-matched again the moment it is recorded as `inbound_return_call`.
--
-- The link never blocks a dial. Any error inside it is raised as a WARNING and the dialer's own
-- transaction carries on: the call log is evidence, not a gate.

alter table public.tenant_lead_activity
  add column if not exists call_attempt_id uuid references public.tenant_call_attempts(id) on delete set null;

create index if not exists tenant_lead_activity_call_attempt_idx
  on public.tenant_lead_activity (call_attempt_id) where call_attempt_id is not null;
create index if not exists tenant_lead_activity_work_item_served_idx
  on public.tenant_lead_activity (tenant_id, work_item_id, served_at desc) where work_item_id is not null;
create index if not exists tenant_lead_activity_lead_agent_served_idx
  on public.tenant_lead_activity (tenant_id, lead_id, agent_user_id, served_at desc);

-- One attempt → its card. Returns the activity row it wrote to, or null when there is none.
-- `p_dispositioned_at` is when the outcome was recorded: now() from the trigger, the audit time
-- from the backfill. It is only used the first time a card gets an outcome.
create or replace function public.link_call_attempt_to_activity(
  p_attempt public.tenant_call_attempts,
  p_dispositioned_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_target uuid;
begin
  -- An inbound return call is not an outbound card's call. Undo a link made at its Dial press.
  if p_attempt.disposition = 'inbound_return_call' then
    update public.tenant_lead_activity
       set call_attempt_id = null, clicked_at = null, updated_at = now()
     where call_attempt_id = p_attempt.id and tenant_id = p_attempt.tenant_id and disposition is null;
    return null;
  end if;

  -- Nothing to say yet (prepared, not dialled), or an inbound attempt with no claim.
  if p_attempt.dial_clicked_at is null and p_attempt.disposition is null then return null; end if;
  if p_attempt.work_item_id is null then return null; end if;

  select a.id into v_target
    from public.tenant_lead_activity a
   where a.call_attempt_id = p_attempt.id and a.tenant_id = p_attempt.tenant_id
   limit 1;

  if v_target is null then
    select a.id into v_target
      from public.tenant_lead_activity a
     where a.tenant_id = p_attempt.tenant_id
       and a.work_item_id = p_attempt.work_item_id
       and a.lead_id = p_attempt.lead_id
       and (p_attempt.agent_id is null or a.agent_user_id = p_attempt.agent_id)
       and a.disposition is null
       and a.served_at <= p_attempt.attempted_at
       and (a.call_attempt_id is null or exists (
             select 1 from public.tenant_call_attempts o
              where o.id = a.call_attempt_id and o.id <> p_attempt.id
                and o.disposition is null and o.attempted_at <= p_attempt.attempted_at))
     order by a.served_at desc, a.id desc
     limit 1
     for update of a;
  end if;

  if v_target is null then
    select a.id into v_target
      from public.tenant_lead_activity a
     where a.tenant_id = p_attempt.tenant_id
       and a.lead_id = p_attempt.lead_id
       and (p_attempt.agent_id is null or a.agent_user_id = p_attempt.agent_id)
       and a.disposition is null
       and a.served_at <= p_attempt.attempted_at
       and (a.call_attempt_id is null or exists (
             select 1 from public.tenant_call_attempts o
              where o.id = a.call_attempt_id and o.id <> p_attempt.id
                and o.disposition is null and o.attempted_at <= p_attempt.attempted_at))
     order by a.served_at desc, a.id desc
     limit 1
     for update of a;
  end if;

  if v_target is null then return null; end if;

  update public.tenant_lead_activity a
     set call_attempt_id = p_attempt.id,
         -- The card's first Dial press. A re-link after an abandoned attempt keeps the earlier one.
         clicked_at = coalesce(a.clicked_at, p_attempt.dial_clicked_at),
         dispositioned_at = case
           when a.disposition is null and p_attempt.disposition is not null
             then coalesce(a.dispositioned_at, p_dispositioned_at, clock_timestamp())
           else a.dispositioned_at end,
         disposition = coalesce(a.disposition, p_attempt.disposition),
         updated_at = now()
   where a.id = v_target;
  return v_target;
end;
$function$;

revoke all on function public.link_call_attempt_to_activity(public.tenant_call_attempts, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.link_call_attempt_to_activity(public.tenant_call_attempts, timestamptz) to service_role;

-- Restated from 20260913460000 (its only definition). Same name, same trigger name, so nothing
-- else that refers to either changes.
create or replace function public.record_lead_attempt_activity()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $function$
begin
  if tg_op = 'UPDATE'
     and new.dial_clicked_at is not distinct from old.dial_clicked_at
     and new.disposition is not distinct from old.disposition then
    return new;
  end if;
  begin
    perform public.link_call_attempt_to_activity(
      new,
      case when new.disposition is not null and (tg_op = 'INSERT' or old.disposition is null) then clock_timestamp() end
    );
  exception when others then
    -- Evidence, not a gate: a failed link must never undo the dial or the outcome it describes.
    raise warning 'tenant_lead_activity link failed for attempt %: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;

drop trigger if exists tenant_call_attempt_record_activity on public.tenant_call_attempts;
create trigger tenant_call_attempt_record_activity
  after insert or update of dial_clicked_at, disposition on public.tenant_call_attempts
  for each row execute function public.record_lead_attempt_activity();

-- ── one-time backfill ─────────────────────────────────────────────────────────
-- Oldest attempt first, so each takes the card it was made on before a later one looks. The
-- outcome time is the audit row complete_existing_dial_disposition writes for that attempt, then
-- the work item's disposition time, then the Dial press, then the attempt itself.
-- Idempotent: a second run finds every attempt already linked and changes nothing.
do $$
declare
  r public.tenant_call_attempts;
  v_at timestamptz;
begin
  -- Same guard as the checks below: a role that could not create the function cannot run it.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925705000: backfill skipped, % cannot create in public', current_user;
    return;
  end if;
  for r in
    select * from public.tenant_call_attempts
     where dial_clicked_at is not null or disposition is not null
     order by attempted_at, id
  loop
    v_at := null;
    if r.disposition is not null then
      select min(al.ts) into v_at
        from public.audit_log al
       where al.action = 'tenant.dial_dispositioned' and al.target_id::text = r.id::text;
      if v_at is null and r.work_item_id is not null then
        select q.disposition_at into v_at
          from public.lead_queue q
         where q.id = r.work_item_id and q.disposition is not distinct from r.disposition;
      end if;
      v_at := coalesce(v_at, r.dial_clicked_at, r.attempted_at);
    end if;
    perform public.link_call_attempt_to_activity(r, v_at);
  end loop;
end $$;

do $$
declare
  v_matchable integer;
  v_linked integer;
  v_outcomes integer;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925705000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_activity' and column_name = 'call_attempt_id') then
    raise exception 'tenant_lead_activity.call_attempt_id is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'tenant_call_attempts' and t.tgname = 'tenant_call_attempt_record_activity'
       and not t.tgisinternal and (t.tgtype & 16) = 16  -- fires on UPDATE
  ) then
    raise exception 'tenant_call_attempt_record_activity does not fire on update';
  end if;

  -- "Where it can": an outbound outcome is matchable when its agent was served a card for that
  -- lead after the agent's previous outcome on it and at or before this attempt. Every one of
  -- those must now carry the outcome on a linked card.
  with outcomes as (
    select ca.*,
           lag(ca.attempted_at) over (partition by ca.tenant_id, ca.lead_id, ca.agent_id order by ca.attempted_at, ca.id) as prev_at
      from public.tenant_call_attempts ca
     where ca.disposition is not null and ca.disposition <> 'inbound_return_call'
       and ca.work_item_id is not null and ca.agent_id is not null
  )
  select count(*) filter (where exists (
           select 1 from public.tenant_lead_activity a
            where a.tenant_id = o.tenant_id and a.lead_id = o.lead_id and a.agent_user_id = o.agent_id
              and a.served_at <= o.attempted_at and (o.prev_at is null or a.served_at > o.prev_at))),
         count(*) filter (where exists (
           select 1 from public.tenant_lead_activity a
            where a.call_attempt_id = o.id and a.disposition = o.disposition)),
         count(*)
    into v_matchable, v_linked, v_outcomes
    from outcomes o;

  raise notice '20260925705000: % outbound outcomes, % matchable to a served card, % linked', v_outcomes, v_matchable, v_linked;
  if v_linked < v_matchable then
    raise exception 'backfill linked % of % matchable outcomes to their served card', v_linked, v_matchable;
  end if;

  if exists (select 1 from public.tenant_lead_activity a
               join public.tenant_call_attempts ca on ca.id = a.call_attempt_id
              where ca.disposition = 'inbound_return_call' or ca.work_item_id is null) then
    raise exception 'an inbound return call is linked to a served card';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925705000', 'activity_log_learns_the_dial_and_outcome') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [18/18] 20260925705100_activity_report_row_detail_and_flag_filter.sql ─────────
begin;

-- Activity · what each row of the call log can now say, and a filter by integrity flag.
--
-- Restated from the LATEST definition of tenant_activity_report (20260915170000, which replaced
-- 20260913460000). Everything it returned it still returns, in the same shape. Added:
--
--   p_flag       narrows the rows (and `total`) to one integrity flag, or 'any' for every flagged
--                row — the page's Data integrity view and its "Logged without a dial" filter, paged
--                in SQL instead of by reading the whole window into the app. The scorecard is NOT
--                narrowed by it: it describes the population the flag is found in.
--                A setter may not filter by 'zero_click_disposition' (the user's decision: the
--                zero-click review is for owners and producers).
--
--   per row      lead_state · dial_attempt_number (the dialer's attempt_number of the linked call,
--                20260925705000) · open_to_log_seconds (served → outcome) · callback_at +
--                callback_timezone (the callback booked on this card's work item after it was
--                served) · deal_face_amount_cents + deal_product (the deal record written for this
--                lead after it was served) · on_internal_dnc (the number is on the tenant's own
--                do-not-call list) · vendor_claim_status (the lead is an item on a vendor claim).
--                Detail is read for the rows returned only, never for the whole window.
--
--   scorecard    zero_click per agent (outcomes on a card with no Dial press), for the page's
--                "logged with no dial" figure and its per-agent concentration line.
--
-- `impossibly_fast_disposition` now also fires on the served → outcome time when the card's own
-- open time was never recorded (nothing records card_open_seconds today). The flag's meaning —
-- "an outcome under five seconds after the card" — is unchanged; it had simply stopped being able
-- to fire.
--
-- Adding a parameter changes the signature, so the function is dropped and re-created with the
-- same grants. The app calls it with named arguments and only passes p_flag when a flag is asked
-- for, falling back to the old call (and filtering itself) until this is applied.

drop function if exists public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean);

create or replace function public.tenant_activity_report(
  p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text,
  p_agent_user_id uuid default null, p_campaign_id uuid default null, p_disposition text default null,
  p_from_at timestamptz default null, p_to_at timestamptz default null,
  p_page integer default 1, p_page_size integer default 50, p_export boolean default false,
  p_flag text default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_rows jsonb;
  v_total bigint;
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_flag text := nullif(btrim(coalesce(p_flag, '')), '');
begin
  if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;
  if v_flag is not null and v_flag not in ('any', 'zero_click_disposition', 'served_never_dispositioned', 'impossibly_fast_disposition') then
    raise exception 'ACTIVITY_FLAG_INVALID';
  end if;
  if v_flag = 'zero_click_disposition' and p_actor_role not in ('owner', 'producer') then
    raise exception 'ACTIVITY_FLAG_FORBIDDEN';
  end if;

  -- One statement: the count is over the filtered set, the detail over the returned page only.
  with flagged as (
    select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name,
      l.values->>'full_name' as lead_name,
      left(coalesce(
        nullif(btrim(l.values->>'state'), ''),
        nullif(btrim(l.values->>'state_code'), ''),
        nullif(btrim(l.values->>'primary_state'), '')
      ), 40) as lead_state,
      l.values->>'phone' as lead_phone,
      case when a.dispositioned_at is not null
        then greatest(0, floor(extract(epoch from (a.dispositioned_at - a.served_at))))::integer end as open_to_log_seconds,
      array_remove(array[
        case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
        case when a.disposition is null then 'served_never_dispositioned' end,
        case when a.disposition is not null
              and coalesce(a.card_open_seconds, floor(extract(epoch from (a.dispositioned_at - a.served_at)))::integer) < 5
             then 'impossibly_fast_disposition' end
      ], null) as integrity_flags
    from tenant_lead_activity a
    left join users u on u.id = a.agent_user_id
    left join tenant_campaigns c on c.id = a.campaign_id
    join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
    where a.tenant_id = p_tenant_id
      and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
      and (p_campaign_id is null or a.campaign_id = p_campaign_id)
      and (p_disposition is null or a.disposition = p_disposition)
      and (p_from_at is null or a.served_at >= p_from_at)
      and (p_to_at is null or a.served_at < p_to_at)
      and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
  ), filtered as (
    select f.* from flagged f
     where v_flag is null
        or (v_flag = 'any' and cardinality(f.integrity_flags) > 0)
        or v_flag = any(f.integrity_flags)
  ), page_rows as (
    select * from filtered
     order by served_at desc, id desc
     limit case when p_export then null else v_size end
     offset case when p_export then 0 else (v_page - 1) * v_size end
  ), detailed as (
    select p.*,
      ca.attempt_number as dial_attempt_number,
      cb.scheduled_at_utc as callback_at,
      cb.customer_timezone as callback_timezone,
      df.face_amount_cents as deal_face_amount_cents,
      df.product_type as deal_product,
      (p.disposition is not null and exists (
        select 1 from tenant_do_not_call dnc
         where dnc.tenant_id = p.tenant_id and dnc.is_active
           and dnc.phone_digits = right(regexp_replace(coalesce(p.lead_phone, ''), '[^0-9]', '', 'g'), 10)
           and regexp_replace(coalesce(p.lead_phone, ''), '[^0-9]', '', 'g') ~ '^1?[0-9]{10}$'
      )) as on_internal_dnc,
      vc.status as vendor_claim_status
    from page_rows p
    left join tenant_call_attempts ca on ca.id = p.call_attempt_id and ca.tenant_id = p.tenant_id
    left join lateral (
      select cb0.scheduled_at_utc, cb0.customer_timezone
        from tenant_callbacks cb0
       where p.disposition is not null and p.work_item_id is not null
         and cb0.tenant_id = p.tenant_id and cb0.work_item_id = p.work_item_id and cb0.lead_id = p.lead_id
         and cb0.created_at >= p.served_at
         and cb0.created_at <= coalesce(p.dispositioned_at, p.served_at) + interval '5 minutes'
       order by cb0.created_at desc limit 1
    ) cb on true
    left join lateral (
      select d.face_amount_cents, d.product_type
        from deal_flow d
       where p.disposition is not null
         and d.tenant_id = p.tenant_id and d.lead_id = p.lead_id
         and d.created_at >= p.served_at
         and d.created_at <= coalesce(p.dispositioned_at, p.served_at) + interval '1 hour'
       order by d.created_at desc limit 1
    ) df on true
    left join lateral (
      select lc.status
        from lead_claim_items li join lead_claims lc on lc.id = li.claim_id
       where p.disposition is not null
         and li.tenant_id = p.tenant_id and li.lead_id = p.lead_id
       order by li.created_at desc limit 1
    ) vc on true
  )
  select (select count(*) from filtered),
         (select coalesce(jsonb_agg(to_jsonb(d) - 'lead_phone' order by d.served_at desc, d.id desc), '[]'::jsonb) from detailed d)
    into v_total, v_rows;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'export', p_export, 'flag', v_flag,
    'scorecard', (
      with visible as (
        select a.* from tenant_lead_activity a
        where a.tenant_id = p_tenant_id
          and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
          and (p_campaign_id is null or a.campaign_id = p_campaign_id)
          and (p_disposition is null or a.disposition = p_disposition)
          and (p_from_at is null or a.served_at >= p_from_at)
          and (p_to_at is null or a.served_at < p_to_at)
          and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
      ),
      per_agent as (
        select v.agent_user_id,
          count(*)::integer as served,
          count(*) filter (where v.clicked_at is not null)::integer as clicked,
          count(*) filter (where v.disposition is not null)::integer as logged,
          count(*) filter (where v.disposition is not null and v.clicked_at is null)::integer as zero_click,
          count(*) filter (where v.disposition is not null and v.disposition not in ('no_answer','voicemail','busy','call_dropped','wrong_number','disconnected'))::integer as contacts
        from visible v
        group by v.agent_user_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'agent_user_id', p.agent_user_id,
        'agent_name', (select coalesce(u.name, 'Unknown agent') from users u where u.id = p.agent_user_id),
        'served', p.served,
        'clicked', p.clicked,
        'logged', p.logged,
        'zero_click', p.zero_click,
        'contact_rate_percent', case when p.clicked > 0 then round(100.0 * p.contacts / p.clicked, 1) end,
        'disposition_breakdown', (
          select coalesce(jsonb_object_agg(coalesce(d.disposition, 'unlogged'), d.n), '{}'::jsonb)
          from (select v2.disposition, count(*) n from visible v2 where v2.agent_user_id = p.agent_user_id group by v2.disposition) d
        ),
        'callbacks_booked', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = p.agent_user_id and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
        'callbacks_kept', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = p.agent_user_id and cb.status = 'completed' and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
        'appointments_booked', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
        'appointments_showed', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and ap.status = 'showed' and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
        'applications_started', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = p.agent_user_id and ca.disposition = 'application_started' and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at)),
        'applications_submitted', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = p.agent_user_id and ca.disposition in ('application_submitted','sent_to_underwriting') and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at))
      ) order by p.agent_user_id), '[]'::jsonb)
      from per_agent p
    )
  );
end;
$function$;

revoke all on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text) to tenant_app, service_role;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925705100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text)') is null then
    raise exception 'tenant_activity_report with p_flag is missing';
  end if;
  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean)') is not null then
    raise exception 'the old tenant_activity_report signature is still there; PostgREST would find two';
  end if;
  if not has_function_privilege('service_role', 'public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text)', 'execute') then
    raise exception 'service_role cannot execute tenant_activity_report';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925705100', 'activity_report_row_detail_and_flag_filter') on conflict do nothing;
  end if;
end $bundle$;
commit;
