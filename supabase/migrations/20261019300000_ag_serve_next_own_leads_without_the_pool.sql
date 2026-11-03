-- Agency Module 0 · AG-0.10 follow-up · Serve next for an agency producer is serve_next_lead (2026-10-19).
--
-- Since 20261019100000, agent_can_take_pool_lead answers false for a narrowed agency session (producer, manager,
-- assistant, setter), and serve_next_lead hands that answer (v_pool_ok) to serve_top / serve_tier_candidates /
-- serve_eligible_ids. serve_eligible_ids then admits only the agent's OWN assigned leads (status claimed,
-- owner_user_id = claimed_by = the agent, assignee = the agent) — so serve_next_lead already gives an agency
-- producer the weighted campaign draw, the cohorts and the scoring over his own leads, and never the pool.
-- serve_next_lead itself needs no change; the app now routes agency sessions back through it
-- (app/api/app/dialer/next, lib/dialerScripts/service.ts serveNextLead) and drops its tier-order workaround.
--
-- What this file fixes is the cost of that answer. With the pool closed, serve_top still read the agency-wide
-- due retries and zoned leads, and for every campaign without an own fresh lead it paged through that
-- campaign's whole fresh POOL (serve_fresh_page / serve_fresh_scan, 100 rows a page, an eligibility pass per
-- page) looking for a lead it can never be given. In an agency with a large unassigned pool that is a full
-- scan per press of Next. Every lead eligible without the pool is in serve_small_qids (its first branch is
-- "claimed and owned by this agent"), so with p_pool_ok false both functions now read only that set. The
-- eligible rows, tiers, campaigns and weights are identical; only the reads that could find nothing are gone.
--
-- Solo tenants: an individual-plan agent reaches p_pool_ok = false only at his open-lead ceiling
-- (20260925700000); there too the answer is unchanged and cheaper. With the pool open nothing changes at all.
--
-- Built from the LIVE bodies (pg_get_functiondef, 2026-10-19, CRLF normalised); every changed line
-- carries the marker [AG 20261019300000], on the line or in the comment just above it. Grants are kept by create or replace.
--
-- Rollback: re-run serve_top and serve_tier_candidates from 20260929203000.

CREATE OR REPLACE FUNCTION public.serve_top(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean, p_side text, p_holdout integer, p_min_tier integer DEFAULT 1)
 RETURNS TABLE(tier integer, campaign_id uuid, weight integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_small uuid[] := public.serve_small_qids(p_tenant_id, p_agent_user_id, p_now);
  -- [AG 20261019300000] without the pool every lead this agent may be served is his own, and serve_small_qids
  -- already lists all of those; the pool-wide sets below are read only when the pool is open to him.
  v_zoned uuid[] := case when p_pool_ok then public.serve_zoned_qids(p_tenant_id) else '{}'::uuid[] end;
  v_states text[];
  v_due uuid[];
  v_rows jsonb;
  v_due_rows jsonb := '[]'::jsonb;
  v_top integer;
  v_found uuid[] := '{}'::uuid[];
  v_any5 boolean := false;
  v_keep uuid[];
  v_weight integer;
  g record;
begin
  -- The small sets and the zoned leads, read once: (tier, campaign, weight) of every eligible row.
  select coalesce(jsonb_agg(jsonb_build_object('p', e.priority, 'c', e.campaign_id, 'w', e.weight)), '[]'::jsonb)
    into v_rows
    from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_small || v_zoned) e
   where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority >= p_min_tier;
  select min((r->>'p')::integer) into v_top from jsonb_array_elements(v_rows) r;
  if v_top is not null and v_top <= 3 then
    return query
      select v_top, (r->>'c')::uuid, max((r->>'w')::integer)
        from jsonb_array_elements(v_rows) r
       where (r->>'p')::integer = v_top
       group by (r->>'c')::uuid;
    return;
  end if;

  v_due := case when p_pool_ok then public.serve_due_qids(p_tenant_id, p_now) else '{}'::uuid[] end; -- [AG 20261019300000]
  if cardinality(v_due) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('p', e.priority, 'c', e.campaign_id, 'w', e.weight)), '[]'::jsonb)
      into v_due_rows
      from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_due) e
     where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority >= p_min_tier;
  end if;
  v_due_rows := v_due_rows || v_rows;
  select min((r->>'p')::integer) into v_top from jsonb_array_elements(v_due_rows) r;
  if v_top = 4 then
    return query
      select 4, (r->>'c')::uuid, max((r->>'w')::integer)
        from jsonb_array_elements(v_due_rows) r
       where (r->>'p')::integer = 4
       group by (r->>'c')::uuid;
    return;
  end if;

  -- Tier 5: the agent's own and the zoned fresh leads, then one probe per campaign (and for the
  -- leads with no campaign) over the states open on their own clock.
  if p_min_tier <= 5 then
  for g in
    select (r->>'c')::uuid as campaign_id, max((r->>'w')::integer) as w
      from jsonb_array_elements(v_rows) r
     where (r->>'p')::integer = 5
     group by (r->>'c')::uuid
  loop
    tier := 5; campaign_id := g.campaign_id; weight := g.w;
    v_found := v_found || coalesce(g.campaign_id, v_zero);
    v_any5 := true;
    return next;
  end loop;

  -- [AG 20261019300000] the probes below look for POOL leads; his own fresh leads were all in v_rows above.
  if p_pool_ok then -- [AG 20261019300000]
  v_states := public.serve_open_states(p_tenant_id, p_agent_user_id, p_now);
  -- One read for every campaign at once: the first few fresh leads of each open state.
  if cardinality(v_states) > 0 then
    select coalesce(array_agg(p.qid), '{}'::uuid[]) into v_keep
      from (select sc.id from public.campaigns_servable sc where sc.tenant_id = p_tenant_id
            union all select null::uuid) gg
      cross join unnest(v_states) s(state)
      cross join lateral public.serve_fresh_page(p_tenant_id, gg.id, s.state, false, null, null, 5) p;
    for g in
      select e.campaign_id, max(e.weight)::integer as w
        from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
       where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
       group by e.campaign_id
    loop
      continue when coalesce(g.campaign_id, v_zero) = any(v_found);
      tier := 5; campaign_id := g.campaign_id; weight := g.w;
      v_found := v_found || coalesce(g.campaign_id, v_zero);
      v_any5 := true;
      return next;
    end loop;
  end if;
  -- Then, campaign by campaign, deeper for the ones the first read did not settle.
  for g in
    select sc.id from public.campaigns_servable sc where sc.tenant_id = p_tenant_id
    union all
    select null::uuid
  loop
    continue when coalesce(g.id, v_zero) = any(v_found);
    v_keep := public.serve_fresh_scan(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, p_side, p_holdout,
                                      g.id, v_states, 'any', 1, '{}'::uuid[]);
    continue when cardinality(v_keep) = 0;
    select max(e.weight)::integer into v_weight
      from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
     where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
       and e.campaign_id is not distinct from g.id;
    if v_weight is not null then
      tier := 5; campaign_id := g.id; weight := v_weight;
      v_any5 := true;
      return next;
    end if;
  end loop;
  end if; -- p_pool_ok [AG 20261019300000]
  end if;
  if v_any5 then return; end if;

  if v_top = 6 then
    return query
      select 6, (r->>'c')::uuid, max((r->>'w')::integer)
        from jsonb_array_elements(v_due_rows) r
       where (r->>'p')::integer = 6
       group by (r->>'c')::uuid;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.serve_tier_candidates(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean, p_side text, p_holdout integer, p_tier integer, p_campaign_id uuid, p_newest boolean, p_cap integer)
 RETURNS TABLE(qid uuid, lid uuid, own boolean, priority integer, posted_at timestamp with time zone, queued_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_cap integer := greatest(coalesce(p_cap, 50), 1);
  v_keep uuid[];
begin
  v_keep := public.serve_small_qids(p_tenant_id, p_agent_user_id, p_now);
  -- [AG 20261019300000] without the pool only his own leads are eligible, and serve_small_qids lists every one.
  if not coalesce(p_pool_ok, false) then
    null; -- [AG 20261019300000]
  elsif p_tier in (4, 6) then
    v_keep := public.serve_due_qids(p_tenant_id, p_now) || v_keep;
  elsif p_tier = 5 then
    v_keep := public.serve_fresh_scan(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, p_side, p_holdout, p_campaign_id,
                                      public.serve_open_states(p_tenant_id, p_agent_user_id, p_now),
                                      case when p_newest then 'newest' else 'oldest' end, v_cap,
                                      v_keep || public.serve_zoned_qids(p_tenant_id));
  end if;

  return query
    select e.qid, e.lid, e.own, e.priority, e.posted_at, e.queued_at
      from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
     where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout)
       and e.priority = p_tier
       and e.campaign_id is not distinct from p_campaign_id
     order by case when p_newest then -extract(epoch from coalesce(e.posted_at, e.queued_at))
                   else extract(epoch from coalesce(e.posted_at, e.queued_at)) end,
              e.qid
     limit v_cap;
end;
$function$;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.serve_top(uuid,uuid,timestamptz,boolean,text,integer,integer)'::regprocedure)
     not like '%when p_pool_ok then public.serve_due_qids%' then
    raise exception 'AG 20261019300000: serve_top still reads the due pool without the pool';
  end if;
  if pg_get_functiondef('public.serve_top(uuid,uuid,timestamptz,boolean,text,integer,integer)'::regprocedure)
     not like '%end if; -- p_pool_ok%' then
    raise exception 'AG 20261019300000: serve_top still probes the fresh pool without the pool';
  end if;
  if pg_get_functiondef('public.serve_tier_candidates(uuid,uuid,timestamptz,boolean,text,integer,integer,uuid,boolean,integer)'::regprocedure)
     not like '%if not coalesce(p_pool_ok, false) then%' then
    raise exception 'AG 20261019300000: serve_tier_candidates still scans the pool without the pool';
  end if;
  -- serve_next_lead must still hand the pool gate to the draw (the whole premise of this file).
  if pg_get_functiondef('public.serve_next_lead(uuid,uuid)'::regprocedure) not like '%v_pool_ok := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id);%'
     or pg_get_functiondef('public.serve_eligible_ids(uuid,uuid,timestamptz,boolean,uuid[])'::regprocedure) not like '%and p_pool_ok)%' then
    raise exception 'AG 20261019300000: serve_next_lead no longer gates the pool through agent_can_take_pool_lead';
  end if;
  if pg_get_functiondef('public.agent_can_take_pool_lead(uuid,uuid)'::regprocedure) not like '%agency_visible_user_ids%' then
    raise exception 'AG 20261019300000: 20261019100000 (the agency pool gate) is not live';
  end if;
end;
$$;
