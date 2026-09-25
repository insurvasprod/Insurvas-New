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
