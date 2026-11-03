-- M2 LA-2.13 · Reports › Queue scoring: "Preview the queue" asks each per-lead rule once, not once per queue row.
--
-- QA R-3.2 (docs/qa/COMPLIANCE-REPORTS-QA.md), 3 Nov 2026: scoring_queue_preview on the demo agency
-- (12,957 open queue rows) took 7.8–8.4 s and hit the 8 s statement timeout on two calls in three, so
-- GET /api/app/scoring/preview answered 500.
--
-- Where the time went (read-only profile over the tenant pooler, 3 Nov 2026):
--   agent_may_work_state per queue row    5.4–7.1 s   it reads the agent's roles and licences, ~13,000 times
--   is_phone_suppressed per queue row     1.0 s       a plpgsql call per row, 7 rows actually suppressed
--   current_slot_for_state per row        up to 1.0 s it depends only on the state
--   callback_tier_due per row             0.6 s       no callback was due
--   the queue scan itself                 0.2–0.3 s
--   calling windows (109 keys) + scoring  ~0.6 s
--
-- The fix keeps every rule and changes only how often it is asked:
--   · pool: the queue rows read once over plain columns (status, lock, campaign scrub, not exhausted).
--   · states: agent_may_work_state and current_slot_for_state once per distinct state (21 here). Both
--     read a missing state as '', so the key is coalesce(state, '').
--   · suppression: is_phone_suppressed runs only where an indexed probe finds the lead's digits on the
--     suppression or do-not-call list. Those probes are the only way the function can answer true.
--   · callback tier: callback_tier_due runs only where an open callback for the work item is due by now,
--     the row its own first condition needs.
--   · claimed rows still need the holder-first check (callback holder, else last assignee).
-- Everything from `due` onward (windows on the lead's own clock, servable/held, the ranking, the JSON)
-- is the live text unchanged.
--
-- Measured as pg_temp copies on the demo agency, same transaction, rolled back, identical JSON apart
-- from generated_at for five agents: owner 6.5–8.5 s → 0.55–0.88 s over 12 calls on one connection
-- (no generic-plan cliff after call 5); second owner 6.9 s → 0.8 s; producer, setter and assistant
-- (pool closed) unchanged at ~0.15–0.25 s.
--
-- APPLY AFTER 20260929203300. A whole-body replace: it refuses to run unless the live body is exactly
-- the one it was written from (md5 of the body with CRLF normalised), so a later in-place patch is never
-- silently undone. Before replacing, it runs the old preview for the demo owner, then the new one in
-- the same transaction, and fails closed if they disagree on any count or setting, the tiers listed, or
-- the held-back (minutes until open, tier). The old call takes about 8 s of that.
--
-- One ordering change: the work item id is now the last tiebreak in the four orderings. Leads that tie on
-- every key (a bulk import shares one queue time) were listed in plan order, so the preview could name
-- different tied leads on each refresh, and the first paste of this file failed its exact-JSON check on it.

do $migrate$
declare
  v_sig constant regprocedure := 'public.scoring_queue_preview(uuid,uuid,integer)'::regprocedure;
  v_demo constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_live text;
  v_owner uuid;
  v_before jsonb;
  v_after jsonb;
  v_new constant text := $new$
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

  -- [20261103] R-3.2: the queue is read once over plain columns, then each per-lead rule is asked as
  -- few times as it can be. The licence gate and the dialling slot depend only on the state, so they
  -- are asked once per state, not once per queue row. Suppression and a due callback are asked only
  -- where an indexed probe finds a row that could make them true. The rules themselves are unchanged.
  with pool as materialized (
    select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own, q.queued_at,
           l.posted_at, l.attempts_made as lead_attempts, l.lead_state, l.next_dial_after,
           l.recycle_count, l.last_reactivated_at, l.next_preferred_slot,
           l.values as vals,
           l.values->>'state' as raw_state,
           -- both state rules read a missing state as ''
           coalesce(l.values->>'state', '') as state_key,
           l.values->>'phone' as raw_phone,
           -- is_phone_suppressed's own normalisation
           case when length(ph.digits) = 11 and left(ph.digits, 1) = '1' then right(ph.digits, 10) else ph.digits end as phone_digits,
           -- [203300] LA-2.2-4: the lead's own zone, when it has one, is its window's clock
           l.dial_timezone as dial_tz,
           l.campaign_id as campaign_id
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
      cross join lateral (select regexp_replace(coalesce(l.values->>'phone', ''), '[^0-9]', '', 'g') as digits) ph
     where q.tenant_id = p_tenant_id
       and (
             (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now) and v_pool_open)
          or (q.status = 'claimed'
              and q.owner_user_id = p_agent_user_id
              and q.claimed_by = p_agent_user_id
              and q.locked_until is null
              and q.disposition is null)
       )
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and l.lead_state <> 'exhausted'
  ),
  states as materialized (
    select s.state_key,
           agent_may_work_state(p_tenant_id, p_agent_user_id, s.state_key) as may_work,
           current_slot_for_state(s.state_key, v_now) as slot
      from (select distinct p.state_key from pool p) s
  ),
  base as materialized (
    select p.qid, p.lid, p.own,
             case
               when p.posted_at is not null and p.posted_at >= v_now - interval '5 minutes' and coalesce(p.lead_attempts, 0) = 0 then 1
               when case when exists (select 1 from tenant_callbacks cb
                                       where cb.tenant_id = p_tenant_id and cb.work_item_id = p.qid
                                         and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now)
                         then public.callback_tier_due(p_tenant_id, p.qid, v_now) else false end then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = p.lid
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when p.lead_state = 'retry' and p.next_dial_after is not null and p.next_dial_after <= v_now
                    -- [711400] LA-2.20-5: a recycled lead is served in the lowest tier, even when retry-due.
                    and not (coalesce(p.recycle_count, 0) > 0 and p.last_reactivated_at is not null)
                    and (
                      st.slot = p.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = p.lid
                           and ca.slot = st.slot
                      )
                    ) then 4
               when p.lead_state = 'fresh' and (p.next_dial_after is null or p.next_dial_after <= v_now) then 5
               when p.lead_state = 'nurture' and p.next_dial_after is not null and p.next_dial_after <= v_now then 6
               when p.lead_state = 'retry' and p.next_dial_after is not null and p.next_dial_after <= v_now
                    and coalesce(p.recycle_count, 0) > 0 and p.last_reactivated_at is not null
                    and (
                      st.slot = p.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = p.lid
                           and ca.slot = st.slot
                      )
                    ) then 6
               else null
             end as priority,
           p.vals,
           p.raw_state,
           p.dial_tz,
           p.campaign_id,
           coalesce(p.lead_attempts, 0) as attempts_made,
           coalesce(p.posted_at, p.queued_at) as aged_at,
           (abs(hashtextextended(p.lid::text, 42)) % 100) < v_holdout as in_holdout
      from pool p
      join states st on st.state_key = p.state_key
     where st.may_work
       and (not p.own
            or coalesce(public.callback_work_item_holder(p_tenant_id, p.qid), lead_queue_assignee(p_tenant_id, p.qid)) = p_agent_user_id)
       and not case when exists (select 1 from tenant_suppression_list s
                                  where s.tenant_id = p_tenant_id and s.phone_digits = p.phone_digits)
                      or exists (select 1 from tenant_do_not_call d
                                  where d.tenant_id = p_tenant_id and d.phone_digits = p.phone_digits and d.is_active)
                    then (select sup.suppressed from is_phone_suppressed(p_tenant_id, p.raw_phone) sup)
                    else false end
  ),
  due as (
    select b.* from base b where b.priority is not null
  ),
  -- The calling window, once per (state, campaign). The explainer runs only where it is closed.
  windows as materialized (
    select k.raw_state, k.campaign_id, k.dial_tz, k.can_dial,
           w.reason as window_reason, coalesce(k.dial_tz, w.zone) as zone, w.start_minute, w.local_minute
      from (
        select d.raw_state, d.campaign_id, d.dial_tz, d.at_lead_clock,
               coalesce(tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, d.at_lead_clock), false) as can_dial
          from (select distinct u.raw_state, u.campaign_id, u.dial_tz,
                       case when u.dial_tz is null then v_now
                            when u.dial_tz in (select tz.timezone from state_timezones tz)
                              then ((v_now at time zone u.dial_tz) at time zone (select tz.timezone from state_timezones tz where tz.state = upper(u.raw_state)))
                       end as at_lead_clock
                  from due u) d
      ) k
      left join lateral (
        select tw.reason, tw.zone, tw.start_minute, tw.local_minute
          from tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, k.at_lead_clock) tw
         where not k.can_dial
      ) w on true
  ),
  servable as materialized (
    select u.* from due u
      join windows k on k.raw_state is not distinct from u.raw_state
                    and k.campaign_id is not distinct from u.campaign_id
     where k.can_dial and k.dial_tz is not distinct from u.dial_tz
  ),
  held as materialized (
    select u.*, k.window_reason, k.zone, k.start_minute, k.local_minute,
           case when k.window_reason = 'before_open' and k.start_minute is not null and k.local_minute is not null
                then greatest(k.start_minute - k.local_minute, 0) end as minutes_until_open
      from due u
      join windows k on k.raw_state is not distinct from u.raw_state
                    and k.campaign_id is not distinct from u.campaign_id
     where not k.can_dial and k.dial_tz is not distinct from u.dial_tz
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
              case when m.ranked then -extract(epoch from s.aged_at) else extract(epoch from s.aged_at) end,
              -- [20261103] the work item breaks a tie, so a bulk import's equal queue times list the same leads every time
              s.qid
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
                      sc.aged_at,
                      sc.qid
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
             ) order by h.minutes_until_open nulls last, h.priority, h.aged_at, h.qid)
        from (
          select * from held hh
           order by hh.minutes_until_open nulls last, hh.priority, hh.aged_at, hh.qid
           limit v_held_limit
        ) h
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$
$new$;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261103200000: skipped, % cannot create in public', current_user;
    return;
  end if;
  v_live := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('[20261103]' in v_live) > 0 then
    raise notice '20261103200000: scoring_queue_preview already asks each rule once';
    return;
  end if;
  if position('[203300]' in v_live) = 0 then
    raise exception '20261103200000: apply 20260929203300 first. Nothing was changed.';
  end if;
  if md5(v_live) <> '4ef1e1f4cd16dd559f91fa58e5e40559' then
    raise exception '20261103200000: the live scoring_queue_preview is not the body this file was written from (md5 %). Nothing was changed.', md5(v_live);
  end if;

  -- The old answer for the demo owner, kept to compare against the new one below.
  if exists (select 1 from public.tenants where id = v_demo) then
    select tu.user_id into v_owner
      from public.tenant_users tu
     where tu.tenant_id = v_demo and tu.role::text = 'owner'
     order by tu.user_id limit 1;
    if v_owner is not null then
      v_before := public.scoring_queue_preview(v_demo, v_owner);
    end if;
  end if;

  execute v_new;

  if v_before is not null then
    v_after := public.scoring_queue_preview(v_demo, v_owner);
    -- Leads that tie on every sort key (a bulk import shares one queue time) were listed in whatever order
    -- the plan produced, so the old body can name different tied leads than the new one. What a tie cannot
    -- change is compared: every count and setting exactly, the tiers of the listed rows, and the
    -- (minutes until open, tier) of the held-back list.
    select (x.j - 'generated_at' - 'rows' - 'held_back')
           || jsonb_build_object(
                'row_tiers', (select coalesce(jsonb_agg(r->'tier' order by (r->>'tier')::integer), '[]'::jsonb)
                                from jsonb_array_elements(x.j->'rows') r),
                'held_keys', (select coalesce(jsonb_agg(jsonb_build_array(h->'minutes_until_open', h->'tier_name')
                                                        order by (h->>'minutes_until_open')::integer nulls last, h->>'tier_name'), '[]'::jsonb)
                                from jsonb_array_elements(x.j->'held_back') h))
      into v_before
      from (select v_before as j) x;
    select (x.j - 'generated_at' - 'rows' - 'held_back')
           || jsonb_build_object(
                'row_tiers', (select coalesce(jsonb_agg(r->'tier' order by (r->>'tier')::integer), '[]'::jsonb)
                                from jsonb_array_elements(x.j->'rows') r),
                'held_keys', (select coalesce(jsonb_agg(jsonb_build_array(h->'minutes_until_open', h->'tier_name')
                                                        order by (h->>'minutes_until_open')::integer nulls last, h->>'tier_name'), '[]'::jsonb)
                                from jsonb_array_elements(x.j->'held_back') h))
      into v_after
      from (select v_after as j) x;
    if v_before is distinct from v_after then
      raise exception '20261103200000: the new preview differs from the old one for the demo owner (servable % -> %, held back % -> %). Nothing was changed. If the queue was being worked while this ran, run it again.',
        v_before->>'servable_count', v_after->>'servable_count', v_before->>'held_back_count', v_after->>'held_back_count';
    end if;
    raise notice '20261103200000: the demo owner''s preview is identical (% servable, % held back)',
      v_after->>'servable_count', v_after->>'held_back_count';
  else
    raise notice '20261103200000: the demo tenant is not in this database, the parity check was skipped';
  end if;
end;
$migrate$;

revoke all on function public.scoring_queue_preview(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.scoring_queue_preview(uuid, uuid, integer) to tenant_app, service_role;

-- ── what it asks once, and every rule the preview already carried ──────────────────────────────
do $check$
declare
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261103200000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef('public.scoring_queue_preview(uuid,uuid,integer)'::regprocedure), E'\r\n', E'\n');
  if position('[20261103]' in v_body) = 0 then raise exception '20261103200000 check: the new body is not live'; end if;
  if position('agent_may_work_state(p_tenant_id, p_agent_user_id, s.state_key) as may_work' in v_body) = 0
     or position('from (select distinct p.state_key from pool p) s' in v_body) = 0 then
    raise exception '20261103200000 check: the licence gate is not asked once per state'; end if;
  if position('then (select sup.suppressed from is_phone_suppressed(p_tenant_id, p.raw_phone) sup)' in v_body) = 0 then raise exception '20261103200000 check: suppression is gone'; end if;
  if position('then public.callback_tier_due(p_tenant_id, p.qid, v_now) else false end then 2' in v_body) = 0 then raise exception '20261103200000 check: tier 2 is no longer callback_tier_due'; end if;
  if position('coalesce(public.callback_work_item_holder(p_tenant_id, p.qid), lead_queue_assignee(p_tenant_id, p.qid)) = p_agent_user_id' in v_body) = 0 then raise exception '20261103200000 check: holder-first own leads are gone'; end if;
  -- what it already carried
  if position('campaigns_servable' in v_body) = 0 then raise exception '20261103200000 check: the scrub gate is gone'; end if;
  if position('l.lead_state <> ''exhausted''' in v_body) = 0 then raise exception '20261103200000 check: exhausted leads are listed'; end if;
  if position('coalesce(p.lead_attempts, 0) = 0 then 1' in v_body) = 0 then raise exception '20261103200000 check: tier 1 no longer requires no dial yet'; end if;
  if position('[711400]' in v_body) = 0 then raise exception '20261103200000 check: the recycled-retry tier rule is gone'; end if;
  if position('agent_can_take_pool_lead' in v_body) = 0 or position('v_pool_open' in v_body) = 0 then raise exception '20261103200000 check: the capacity gate is gone'; end if;
  if position('in_holdout' in v_body) = 0 then raise exception '20261103200000 check: the holdout cohort is gone'; end if;
  if position('coalesce(tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, d.at_lead_clock), false) as can_dial' in v_body) = 0
     or position('tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, k.at_lead_clock)' in v_body) = 0 then
    raise exception '20261103200000 check: the window is not asked on the lead''s clock'; end if;
end;
$check$;
