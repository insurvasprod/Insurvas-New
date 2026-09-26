-- Module 2 serving, resolved "per the documentation" (user, 2026-09-25).
--
-- LA-2.8  "Within a tier, ordered by the score from LA-2.13. Across campaigns, interleaved by
--          mixing weight so one campaign does not starve another."
--         "Serving is under 200ms with 100,000 eligible leads."
-- LA-2.13 "Scoring adds under 50ms to serving."
-- LA-2.20-5 "Recycled leads in the lowest tier."
-- LA-2.1-7 "Two active campaigns weighted 4 and 2 serve roughly 2:1."
--
-- What was wrong (demo-readiness pass, 2026-09-25):
--   · With scoring on, only the 50 NEWEST top-tier leads were ever scored, and mixing_weight only
--     broke exact score ties — so weights never applied and older lists starved (Crestview, weight
--     3, first appeared at queue-age rank 470). With scoring off, weights applied per LEAD, so a
--     campaign's share was weight × list size, not weight.
--   · Every queued row paid four function calls (calling window, licence, suppression, slot):
--     the owner's queue preview took 9.8 s at ~15k queued; a setter's timed out (503).
--   · A recycled lead went to tier 4 after its first no-answer, ahead of every fresh lead.
--
-- What changes:
--   · serve_eligible() — NEW. The single eligibility query for Serve next and the queue list. The
--     calling window and licence are evaluated once per state (51 rows), plus once per state for a
--     campaign that sets its own window; the slot once per state; suppression is an index
--     anti-join on the two lists is_phone_suppressed reads; due callbacks and appointments are
--     small precomputed sets. Every rule is the same rule as before (see the checks at the end).
--   · serve_next_lead — tier first, then ONE weighted draw among the campaigns that have a lead in
--     that tier, then the best score (scored cohort, newest 50 of that campaign scored) or the
--     oldest (naive order). Reclaim, capacity gate, holdout cohorts, claim, reason and the scoring
--     decision row are byte-for-byte the live function's.
--   · dialer_queue_preview — same output, rows from serve_eligible().
--   · serve_lead_by_id, scoring_queue_preview — their tier CASE gets the recycled → tier 6 rule, in
--     place, so all four agree on tiers.
--   · serve_mix_sample() — NEW, read-only: draws the campaign step N times without serving anything,
--     so the 4:2 → 2:1 behaviour can be checked (LA-2.1-7).
--
-- Safety: the function bodies below were assembled from the live definitions (pg_get_functiondef)
-- with only the marked [711400] parts changed. After creating them this file re-reads them and
-- rolls everything back if an earlier rule is missing, then runs serve_next_lead once for a real
-- tenant inside a sub-transaction that is always rolled back — so a function that fails at run time
-- fails the migration instead of the dialer. Rollback: docs/qa/rollback-20260925711400.sql.

-- ── serve_eligible ────────────────────────────────────────────────────────────────────────────
create or replace function public.serve_eligible(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean)
returns table(qid uuid, lid uuid, own boolean, priority integer, campaign_id uuid, weight integer,
              posted_at timestamp with time zone, queued_at timestamp with time zone,
              holdout_bucket integer, vals jsonb, attempts_made integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with st as materialized (
    -- The states this agent may be served right now: inside the customer's legal window for the
    -- agency (tenant_can_dial_now with no campaign) and licensed (agent_may_work_state, which honours
    -- licence expiry). Once per state instead of once per queued lead.
    select tz.state, public.current_slot_for_state(tz.state, p_now) as slot
      from public.state_timezones tz
     where public.tenant_can_dial_now(p_tenant_id, tz.state, null, p_now)
       and public.agent_may_work_state(p_tenant_id, p_agent_user_id, tz.state)
  ),
  sc as materialized (
    -- The scrub gate: active and scrubbed campaigns only.
    select cs.id, cs.mixing_weight from public.campaigns_servable cs where cs.tenant_id = p_tenant_id
  ),
  cw as materialized (
    -- A campaign's own calling window can only narrow the agency's; these are the (campaign, state)
    -- pairs it closes right now. Campaigns without their own window never appear here.
    select c.id as campaign_id, st.state
      from public.tenant_campaigns c
      join sc on sc.id = c.id
      cross join st
     where c.tenant_id = p_tenant_id
       and (c.calling_window_start_hour is not null or c.calling_window_end_hour is not null
            or c.calling_window_start_minute is not null or c.calling_window_end_minute is not null)
       and not public.tenant_can_dial_now(p_tenant_id, st.state, c.id, p_now)
  ),
  cb as materialized (
    -- Tier 2: exactly callback_tier_due, asked only of callbacks that could be due.
    select distinct t.work_item_id as qid
      from public.tenant_callbacks t
     where t.tenant_id = p_tenant_id
       and t.status in ('scheduled', 'due')
       and t.scheduled_at_utc <= p_now
       and public.callback_tier_due(p_tenant_id, t.work_item_id, p_now)
  ),
  ap as materialized (
    -- Tier 3: an appointment a setter booked is due, for this agent or for anyone.
    select distinct a.lead_id
      from public.tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.status in ('booked', 'confirmed')
       and a.starts_at_utc <= p_now
       and (a.agent_user_id = p_agent_user_id or a.agent_user_id is null)
  ),
  base as (
    select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
           l.campaign_id, coalesce(sc.mixing_weight, 1) as weight,
           l.posted_at, q.queued_at, l.values as vals, coalesce(l.attempts_made, 0) as attempts_made,
           l.lead_state, l.next_dial_after, l.next_preferred_slot,
           (coalesce(l.recycle_count, 0) > 0 and l.last_reactivated_at is not null) as recycled,
           st.slot,
           (abs(hashtextextended(q.lead_id::text, 42)) % 100)::integer as holdout_bucket,
           regexp_replace(coalesce(l.values->>'phone', ''), '[^0-9]', '', 'g') as digits_raw
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
      -- tenant_can_dial_now refuses anything that is not exactly two letters, so the join key is too
      join st on st.state = upper(l.values->>'state') and l.values->>'state' ~ '^[A-Za-z]{2}$'
      left join sc on sc.id = l.campaign_id
     where q.tenant_id = p_tenant_id
       and (
             -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
             (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < p_now) and p_pool_ok)
          or (q.status = 'claimed'
              and q.owner_user_id = p_agent_user_id
              and q.claimed_by = p_agent_user_id
              and q.locked_until is null
              and q.disposition is null
              and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), public.lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
       )
       and l.lead_state <> 'exhausted'
       and (l.campaign_id is null or sc.id is not null)
       and not exists (select 1 from cw where cw.campaign_id = l.campaign_id and cw.state = st.state)
  ),
  unsuppressed as (
    -- is_phone_suppressed's two lists, as an index anti-join on the same normalised digits.
    select b.*
      from base b
      cross join lateral (
        select case when length(b.digits_raw) = 11 and left(b.digits_raw, 1) = '1'
                    then right(b.digits_raw, 10) else b.digits_raw end as digits
      ) d
     where not exists (select 1 from public.tenant_suppression_list s
                        where s.tenant_id = p_tenant_id and s.phone_digits = d.digits)
       and not exists (select 1 from public.tenant_do_not_call x
                        where x.tenant_id = p_tenant_id and x.phone_digits = d.digits and x.is_active)
  ),
  tiered as (
    select u.*,
           case
             when u.posted_at is not null and u.posted_at >= p_now - interval '5 minutes' and u.attempts_made = 0 then 1
             when exists (select 1 from cb where cb.qid = u.qid) then 2
             when exists (select 1 from ap where ap.lead_id = u.lid) then 3
             when u.lead_state = 'retry' and u.next_dial_after is not null and u.next_dial_after <= p_now
                  and not u.recycled
                  and (u.slot = u.next_preferred_slot
                       or not exists (select 1 from public.tenant_call_attempts ca
                                       where ca.tenant_id = p_tenant_id and ca.lead_id = u.lid and ca.slot = u.slot)) then 4
             when u.lead_state = 'fresh' and (u.next_dial_after is null or u.next_dial_after <= p_now) then 5
             when u.lead_state = 'nurture' and u.next_dial_after is not null and u.next_dial_after <= p_now then 6
             -- LA-2.20-5: a recycled lead that is retry-due stays in the lowest tier, same slot rule.
             when u.lead_state = 'retry' and u.next_dial_after is not null and u.next_dial_after <= p_now
                  and u.recycled
                  and (u.slot = u.next_preferred_slot
                       or not exists (select 1 from public.tenant_call_attempts ca
                                       where ca.tenant_id = p_tenant_id and ca.lead_id = u.lid and ca.slot = u.slot)) then 6
             else null
           end as priority
      from unsuppressed u
  )
  select t.qid, t.lid, t.own, t.priority, t.campaign_id, t.weight, t.posted_at, t.queued_at,
         t.holdout_bucket, t.vals, t.attempts_made
    from tiered t
   where t.priority is not null;
$function$;
revoke all on function public.serve_eligible(uuid, uuid, timestamp with time zone, boolean) from public, anon, authenticated;
grant execute on function public.serve_eligible(uuid, uuid, timestamp with time zone, boolean) to tenant_app, service_role;

-- ── serve_next_lead ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
 RETURNS TABLE(work_item_id uuid, lead_id uuid, tier integer, tier_name text, locked_until timestamp with time zone, appointment_notes text, selection_reason text, score numeric, cohort text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  -- [711400] how many of the chosen campaign's leads are scored: the newest this many, so scoring
  -- stays inside LA-2.13's 50 ms. The campaign itself is chosen first, by weight, over ALL of them.
  v_candidate_cap integer := 50;
  v_scored boolean := false;
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

  -- ── [711400] the choice ───────────────────────────────────────────────────
  --
  -- LA-2.8: "Within a tier, ordered by the score from LA-2.13. Across campaigns, interleaved by
  -- mixing weight so one campaign does not starve another."
  --   1. the tier: the lowest one any eligible lead is in;
  --   2. the campaign: one draw, weighted by mixing_weight, among the campaigns with a lead in that
  --      tier — so weights 4 and 2 serve about 2:1 whatever the list sizes, and an old list is not
  --      starved by a newer import (before, only the 50 newest leads were ever looked at);
  --   3. the lead: scored cohort → the best score among that campaign's newest v_candidate_cap;
  --      naive order (scoring off, or this serve drew the holdout) → the oldest.
  -- Eligibility lives in serve_eligible(): the calling window, licence and slot are worked out once
  -- per state and suppression is an index anti-join, instead of four function calls per queued row
  -- (LA-2.8: under 200 ms at 100,000 eligible).
  --
  -- Cohorts, unchanged: the holdout is per lead (hashtextextended bucket). With scoring on, a serve
  -- that drew the holdout takes only holdout leads and one that did not takes only the rest; if its
  -- side is empty it falls back to every eligible lead in the naive order.
  with el_all as materialized (
    select * from public.serve_eligible(p_tenant_id, p_agent_user_id, v_now, v_pool_ok)
  ),
  el_pref as materialized (
    select * from el_all e
     where not v_enabled
        or (v_serve_control and e.holdout_bucket < v_holdout)
        or (not v_serve_control and e.holdout_bucket >= v_holdout)
  ),
  side as (
    select exists (select 1 from el_pref) as pref,
           v_enabled and not v_serve_control and exists (select 1 from el_pref) as scored
  ),
  el as materialized (
    select * from el_pref where (select pref from side)
    union all
    select * from el_all where not (select pref from side)
  ),
  top_tier as (
    select min(e.priority) as p from el e
  ),
  camps as (
    select e.campaign_id, max(e.weight) as w
      from el e, top_tier t
     where e.priority = t.p
     group by e.campaign_id
  ),
  pick as (
    select c.campaign_id
      from camps c
     order by -ln(greatest(random(), 1e-9)) / greatest(c.w, 1)
     limit 1
  ),
  cand as (
    select e.*
      from el e, top_tier t, pick k
     where e.priority = t.p
       and e.campaign_id is not distinct from k.campaign_id
     -- scored: the newest first (they are the ones scored); naive: the oldest first
     order by case when (select scored from side) then -extract(epoch from coalesce(e.posted_at, e.queued_at))
                   else extract(epoch from coalesce(e.posted_at, e.queued_at)) end
     limit v_candidate_cap
  )
  select c.qid, c.lid, c.priority, c.own, (select scored from side)
    into v_qid, v_lead, v_priority, v_own, v_scored
    from cand c
    left join lateral (
      select sl.score from public.score_lead(p_tenant_id, c.lid, v_now) sl
       where (select scored from side)
    ) lsc on true
   -- (not `s`: serve_next_lead declares a PL/pgSQL record named s, which would shadow the alias)
   order by lsc.score desc nulls last,
            case when (select scored from side) then -extract(epoch from coalesce(c.posted_at, c.queued_at))
                 else extract(epoch from coalesce(c.posted_at, c.queued_at)) end
   limit 1;

  if v_qid is not null then
    v_cohort := case
      when v_scored then 'scored'
      when not v_enabled then 'control'
      when (abs(hashtextextended(v_lead::text, 42)) % 100) < v_holdout then 'control'
      else 'scored' end;
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

-- ── dialer_queue_preview ──────────────────────────────────────────────────────────────────────
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
  -- [711400] One set-based eligibility for the queue list and for Serve next (serve_eligible), so
  -- the list shows what the dialer would serve and costs one scan instead of four function calls
  -- per queued row. Same rows, same fields, same order.
  with servable as materialized (
    select e.qid, e.lid, e.own, e.priority, e.vals, e.attempts_made, e.posted_at, e.queued_at
      from public.serve_eligible(p_tenant_id, p_agent_user_id, v_now, v_pool_ok) e
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

-- ── serve_lead_by_id (tier CASE only) ─────────────────────────────────────────────────────────
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
                    -- [711400] LA-2.20-5: a recycled lead is served in the lowest tier, even when retry-due.
                    and not (coalesce(l.recycle_count, 0) > 0 and l.last_reactivated_at is not null)
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
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and coalesce(l.recycle_count, 0) > 0 and l.last_reactivated_at is not null
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 6
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

-- ── scoring_queue_preview (tier CASE only) ────────────────────────────────────────────────────
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
                    -- [711400] LA-2.20-5: a recycled lead is served in the lowest tier, even when retry-due.
                    and not (coalesce(l.recycle_count, 0) > 0 and l.last_reactivated_at is not null)
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
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and coalesce(l.recycle_count, 0) > 0 and l.last_reactivated_at is not null
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 6
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

-- ── serve_mix_sample: the campaign draw, without serving anything ─────────────────────────────
create or replace function public.serve_mix_sample(p_tenant_id uuid, p_agent_user_id uuid, p_draws integer default 1000)
returns table(campaign_id uuid, campaign_name text, weight integer, leads_in_tier bigint, tier integer, picks integer, share numeric)
language sql
volatile
security definer
set search_path to 'public'
as $function$
  with el as materialized (
    select * from public.serve_eligible(p_tenant_id, p_agent_user_id, now(),
                                        public.agent_can_take_pool_lead(p_tenant_id, p_agent_user_id))
  ),
  t as (select min(e.priority) as p from el e),
  camps as (
    select e.campaign_id, max(e.weight) as w, count(*) as n
      from el e, t where e.priority = t.p group by e.campaign_id
  ),
  draws as (
    select x.campaign_id
      from generate_series(1, greatest(1, least(coalesce(p_draws, 1000), 20000))) g
      cross join lateral (
        select c.campaign_id from camps c
         where g.g > 0
         order by -ln(greatest(random(), 1e-9)) / greatest(c.w, 1)
         limit 1
      ) x
  )
  select c.campaign_id, tc.name, c.w, c.n, (select p from t),
         count(d.campaign_id)::integer,
         round(count(d.campaign_id)::numeric / nullif((select count(*) from draws), 0), 3)
    from camps c
    left join draws d on d.campaign_id is not distinct from c.campaign_id
    left join public.tenant_campaigns tc on tc.id = c.campaign_id
   group by c.campaign_id, tc.name, c.w, c.n
   order by 6 desc;
$function$;
revoke all on function public.serve_mix_sample(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.serve_mix_sample(uuid, uuid, integer) to tenant_app, service_role;

-- ── Nothing earlier was lost ──────────────────────────────────────────────────────────────────
do $check$
declare
  v_serve text := replace(pg_get_functiondef('public.serve_next_lead(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  v_elig text := replace(pg_get_functiondef('public.serve_eligible(uuid,uuid,timestamp with time zone,boolean)'::regprocedure), E'\r\n', E'\n');
  v_prev text := replace(pg_get_functiondef('public.dialer_queue_preview(uuid,uuid,integer[],integer,integer)'::regprocedure), E'\r\n', E'\n');
  v_byid text := replace(pg_get_functiondef('public.serve_lead_by_id(uuid,uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  v_sqp text := replace(pg_get_functiondef('public.scoring_queue_preview(uuid,uuid,integer)'::regprocedure), E'\r\n', E'\n');
begin
  -- serve_next_lead keeps its reclaim (holder-first, both steps), capacity gate, holdout, claim and decision row
  if v_serve not like '%agent_can_take_pool_lead%' then raise exception '711400 check: capacity gate lost'; end if;
  if (length(v_serve) - length(replace(v_serve, 'callback_work_item_holder', ''))) / length('callback_work_item_holder') < 2 then
    raise exception '711400 check: holder-first reclaim lost'; end if;
  if v_serve not like '%hashtextextended%' or v_serve not like '%v_serve_control%' then raise exception '711400 check: holdout cohort lost'; end if;
  if v_serve not like '%tenant_scoring_decisions%' or v_serve not like '%v_lock_minutes%' then raise exception '711400 check: claim or decision row lost'; end if;
  if v_serve not like '%serve_eligible%' or v_serve not like '%mixing weight%' then raise exception '711400 check: serve_next_lead not rewired'; end if;
  -- serve_eligible carries every eligibility rule and every tier
  if v_elig not like '%campaigns_servable%' then raise exception '711400 check: scrub gate missing'; end if;
  if v_elig not like '%tenant_can_dial_now%' or v_elig not like '%agent_may_work_state%' then raise exception '711400 check: window/licence missing'; end if;
  if v_elig not like '%tenant_suppression_list%' or v_elig not like '%tenant_do_not_call%' then raise exception '711400 check: suppression missing'; end if;
  if v_elig not like '%callback_tier_due%' or v_elig not like '%callback_work_item_holder%' or v_elig not like '%p_pool_ok%' then
    raise exception '711400 check: callback tier, holder or capacity missing'; end if;
  if v_elig not like '%u.attempts_made = 0 then 1%' then raise exception '711400 check: tier 1 must require no dial yet (709500)'; end if;
  if v_elig not like '%''exhausted''%' or v_elig not like '%u.recycled%' then raise exception '711400 check: exhausted or recycled rule missing'; end if;
  if v_prev not like '%serve_eligible%' or v_prev not like '%assigned_to_you%' then raise exception '711400 check: preview not rewired'; end if;
  if v_byid not like '%[711400]%' or v_sqp not like '%[711400]%' then raise exception '711400 check: recycled tier not patched into both'; end if;
  if v_byid not like '%attempts_made, 0) = 0 then 1%' or v_sqp not like '%attempts_made, 0) = 0 then 1%' then
    raise exception '711400 check: tier 1 rule (709500) lost in serve_lead_by_id or scoring_queue_preview'; end if;
end;
$check$;

-- ── Run it once for real, then roll that run back ─────────────────────────────────────────────
do $selftest$
declare
  v_tenant uuid;
  v_agent uuid;
  v_t0 timestamptz;
begin
  select q.tenant_id, tu.user_id into v_tenant, v_agent
    from public.lead_queue q
    join public.tenant_users tu on tu.tenant_id = q.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null
   where q.status = 'unclaimed'
   group by q.tenant_id, tu.user_id
   order by count(*) desc
   limit 1;
  if v_tenant is null then
    raise notice '711400 self-test skipped: no tenant has an unclaimed lead';
    return;
  end if;

  v_t0 := clock_timestamp();
  perform public.dialer_queue_preview(v_tenant, v_agent);
  raise notice '711400 self-test: dialer_queue_preview % ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  perform * from public.serve_mix_sample(v_tenant, v_agent, 200);

  begin
    v_t0 := clock_timestamp();
    perform * from public.serve_next_lead(v_tenant, v_agent);
    raise notice '711400 self-test: serve_next_lead % ms (rolled back)', round(extract(epoch from clock_timestamp() - v_t0) * 1000);
    raise exception 'M2_711400_SELFTEST_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'M2_711400_SELFTEST_ROLLBACK' then raise; end if;
  end;
end;
$selftest$;
