-- Performance pass (2026-10-20, SQL leftovers) · Assignments / Lead routing: assignment_insights.
--
-- Measured on the demo tenant (LA-1.25 Alert Demo: 3 routable members, 14 licensed states, 12,816 unclaimed
-- work items) as tenant_app in a rolled-back transaction:
--   · the "unlicensed leads" count joined each unclaimed work item to its lead one primary-key probe at a
--     time — 12,816 probes, 52k buffers: 58 ms warm, 0.9–2 s on a fresh connection;
--   · eligible states were worked out member by member, state by state: 3 × 14 calls of
--     assignment_candidate_is_eligible, each re-asking tenant_plan_audience and re-running its checks.
--
-- What changes (the result is the same jsonb — see "Parity" below):
--   1. eligible_states / the licensed union: one set-based query with assignment_candidate_is_eligible's
--      rules for an owner or producer, no product, a non-empty state, licence not required:
--        · plan audience 'agency' → an active producer row, appointed in that state today;
--        · the agency holds an unexpired licence in the state, and an active appointment there with an
--          active carrier that has no un-contracted requirement (the same for every member, so asked once);
--        · the member's own recorded states, when any are recorded, include it unexpired.
--      assignment_candidate_is_eligible itself is unchanged (the router still calls it per lead).
--   2. unlicensed_leads: the tenant's lead states are read once (16.5k buffers) and hash-joined to the
--      unclaimed work items, instead of a probe per work item (0.19 s vs 1.8 s cold, 43 vs 58 ms warm).
--   Everything else in the function is unchanged.
--
-- Parity (demo tenant, rolled-back rehearsal as tenant_app with app.tenant_id + owner app.user_id): the new
-- function returns the same jsonb as the live one for p_since = 1, 7, 30 and 365 days back. The self-check
-- below compares eligible_states and unlicensed_leads with the per-member / per-lead forms for every tenant.
--
-- Rollback: re-create public.assignment_insights from its previous definition (pg_get_functiondef before
-- this file).

begin;

create or replace function public.assignment_insights(p_tenant_id uuid, p_since timestamp with time zone)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
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

  -- Each routable member's states: assignment_candidate_is_eligible(tenant, member, role, null, state, false)
  -- for every state the agency holds a licence row in, as one query (perf 2026-10-20; was a call per
  -- member per state).
  with st as (
    select distinct upper(btrim(l.state)) as state
      from public.licenses l
     where l.tenant_id = p_tenant_id and btrim(coalesce(l.state, '')) <> ''
  ),
  members as (
    select tu.user_id
      from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
     where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
  ),
  agency as (
    select coalesce(public.tenant_plan_audience(p_tenant_id) = 'agency', false) as is_agency
  ),
  -- The agency's own licence and carrier appointment in the state: the same answer for every member.
  writable as (
    select st.state
      from st
     where exists (
             select 1 from public.licenses l
              where l.tenant_id = p_tenant_id
                and upper(btrim(l.state)) = st.state
                and (l.expires_at is null or l.expires_at >= current_date))
       and exists (
             select 1
               from public.appointments a
               join public.tenant_carriers tc
                 on tc.tenant_id = a.tenant_id
                and tc.carrier_id = a.carrier_id
                and tc.is_active and not exists (select 1 from public.tenant_carrier_requirements r where r.tenant_id = tc.tenant_id and r.carrier_id = tc.carrier_id and not r.contracted)
              where a.tenant_id = p_tenant_id
                and upper(btrim(a.state)) = st.state
                and a.status = 'active'
                and (a.effective_from is null or a.effective_from <= current_date)
                and (a.terminated_at is null or a.terminated_at >= current_date)
                and (a.expires_at is null or a.expires_at >= current_date))
  ),
  eligible as (
    select m.user_id, w.state
      from members m
      cross join writable w
      cross join agency g
     where (not g.is_agency
            or (exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = m.user_id and p.status = 'active')
                and exists (
                  select 1 from public.producer_appointment a join public.producer p on p.id = a.producer_id
                   where a.tenant_id = p_tenant_id and p.user_id = m.user_id and a.state = w.state and a.status = 'appointed'
                     and (a.effective_from is null or a.effective_from <= current_date) and (a.expires_on is null or a.expires_on >= current_date))))
       and (not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = m.user_id)
            or exists (select 1 from public.tenant_user_licensed_states s
                        where s.tenant_id = p_tenant_id and s.user_id = m.user_id and s.state = w.state
                          and (s.expires_on is null or s.expires_on >= current_date)))
  ),
  per_member as (
    select m.user_id,
           coalesce((select array_agg(e.state order by e.state) from eligible e where e.user_id = m.user_id), '{}'::text[]) as states
      from members m
  )
  select coalesce(jsonb_object_agg(pm.user_id::text, to_jsonb(pm.states)), '{}'::jsonb),
         coalesce((select array_agg(e.state) from eligible e), '{}'::text[])
    into v_states, v_union
    from per_member pm;

  -- The tenant's lead states read once and hash-joined (perf 2026-10-20; was a probe per work item).
  with lead_state as materialized (
    select a.id, upper(btrim(coalesce(a.values->>'state', a.values->>'state_code', ''))) as us_state
      from public.agent_leads a
     where a.tenant_id = p_tenant_id
  )
  select count(*)::integer into v_unlicensed
    from public.lead_queue q
    join lead_state l on l.id = q.lead_id
   where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
     and not (l.us_state = any(v_union));

  return jsonb_build_object('since', p_since, 'routed', v_routed, 'skips', v_skips, 'skipped_leads', v_skipped_leads,
                            'landed', v_landed, 'licence_expiring', v_expiring, 'auto_routed', v_auto,
                            'eligible_states', v_states, 'unlicensed_leads', v_unlicensed);
end;
$function$;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
-- For every tenant with a routable member: eligible_states equals the per-member, per-state calls of
-- assignment_candidate_is_eligible (the loop this file replaces, verbatim), and unlicensed_leads equals the
-- per-work-item count.
do $$
declare
  v_t record;
  v_member record;
  v_member_states text[];
  v_got jsonb;
  v_ref jsonb;
  v_union text[];
  v_count integer;
begin
  for v_t in
    select distinct tu.tenant_id from public.tenant_users tu
     where tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
  loop
    v_got := public.assignment_insights(v_t.tenant_id, now() - interval '30 days');
    v_ref := '{}'::jsonb;
    v_union := '{}'::text[];
    for v_member in
      select tu.user_id, tu.role::text as role
        from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
       where tu.tenant_id = v_t.tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
    loop
      select coalesce(array_agg(st.state order by st.state), '{}'::text[]) into v_member_states
        from (select distinct upper(btrim(l.state)) as state from public.licenses l where l.tenant_id = v_t.tenant_id and btrim(coalesce(l.state, '')) <> '') st
       where public.assignment_candidate_is_eligible(v_t.tenant_id, v_member.user_id, v_member.role, null, st.state, false);
      v_ref := v_ref || jsonb_build_object(v_member.user_id::text, to_jsonb(v_member_states));
      v_union := v_union || v_member_states;
    end loop;
    if v_got->'eligible_states' is distinct from v_ref then
      raise exception 'perf: assignment_insights eligible_states differ for tenant %: % vs %', v_t.tenant_id, v_got->'eligible_states', v_ref;
    end if;
    select count(*)::integer into v_count
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = v_t.tenant_id and q.status = 'unclaimed'
       and not (upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = any(v_union));
    if (v_got->>'unlicensed_leads')::integer is distinct from v_count then
      raise exception 'perf: assignment_insights unlicensed_leads differ for tenant %: % vs %', v_t.tenant_id, v_got->>'unlicensed_leads', v_count;
    end if;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
