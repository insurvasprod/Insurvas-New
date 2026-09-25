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
