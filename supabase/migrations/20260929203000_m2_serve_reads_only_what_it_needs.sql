-- M2 LA-2.8-7 "Serving is under 200ms with 100,000 eligible leads."
--      LA-2.2-4 a lead's own dial_timezone (a split-zone ZIP) is the clock its calling window is read on.
--
-- APPLY AFTER, in this order: 20260925709600 (agent_leads.dial_timezone), 20260925709700 (DNC
-- exemptions), 20260929200200 (serve_eligible honours them), 20260929201000 (state calling rules).
-- The first block below refuses to run until all four are live, because this file copies and edits
-- the live bodies they produce.
--
-- What was wrong (load-test workspace, 100,000 eligible leads, 2026-09-29): every Serve next timed
-- out (about 9 s, 503). serve_next_lead read serve_eligible() in full, one row per eligible lead with
-- its jsonb values, materialised it three times (work_mem is 2 MB, so on disk) and then kept ONE.
-- A 1-in-10 sample of one campaign (2,367 rows) took 98 s under that day's load.
--
-- What changes. The answer is the same, and much less is read to reach it:
--   · serve_eligible_ids(..., p_qids) is serve_eligible's own body, generated from it, for a given
--     set of work items. One rulebook: the check below compares the two texts, and
--     serve_eligible_ids_regenerate() rebuilds it after any later in-place edit of serve_eligible.
--   · serve_top() finds the lowest tier and the campaigns with a lead in it, cheapest sets first:
--     the agent's own leads, posts under five minutes, due callbacks and due appointments (tiers
--     1 to 3 can only come from those), then due retries and nurture touches (tiers 4 and 6),
--     then ONE probe per campaign for its first eligible fresh lead (tier 5). It stops at the first
--     tier that answers.
--   · serve_tier_candidates() reads the chosen campaign in lead order only as far as the answer
--     needs: the oldest eligible lead (naive order), or the newest v_candidate_cap (scored), plus
--     any lead queued or posted after the cut-off, so a lead re-queued later is never missed.
--     Leads with no campaign (inbound, manual) are read in full, because their queue time can
--     precede their creation.
--   · serve_next_lead keeps its reclaim, capacity gate, cohorts, weighted campaign draw, scoring,
--     claim, reason and decision row. Only the choice block is new.
--   · serve_eligible and serve_lead_by_id read the calling window on the lead's dial_timezone
--     when it has one. The state's rules, Sunday and statutes still apply. Only the clock moves,
--     by asking tenant_can_dial_now about the instant whose wall clock in the state's zone equals
--     the lead's wall clock now. A zone that is not a state zone is refused.
--
-- Ties. Where two leads have the same age, 711400 took whichever the sort met first. This takes
-- the lower work-item id. The equivalence check compares ages, and says so.
--
-- The indexes that make the fresh probe cheap are 20260929203100 and 203200 (CREATE INDEX CONCURRENTLY, which
-- cannot run in a transaction, so each is pasted on its own). Without them this is correct but reads
-- more: every fresh lead of a campaign in an open state up to the first eligible one, and every lead with its own zone.

set local lock_timeout = '5s';

-- ── 0. the files this builds on ─────────────────────────────────────────────────────────────
do $dep$
declare
  v_elig text;
  v_dial text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: dependency check skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.agent_leads'::regclass and attname = 'dial_timezone' and not attisdropped) then
    raise exception '20260929203000: apply 20260925709600 (agent_leads.dial_timezone) first. Nothing was changed.';
  end if;
  v_elig := replace(pg_get_functiondef('public.serve_eligible(uuid,uuid,timestamptz,boolean)'::regprocedure), E'\r\n', E'\n');
  if to_regprocedure('public.dnc_exemption_active_id(uuid,text,timestamp with time zone)') is null
     or position('public.dnc_exemption_active_id(p_tenant_id, d.digits, p_now) is not null' in v_elig) = 0 then
    raise exception '20260929203000: apply 20260925709700 and 20260929200200 (DNC exemptions in serve_eligible) first. Nothing was changed.';
  end if;
  v_dial := replace(pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamptz)'::regprocedure), E'\r\n', E'\n');
  if position('[201000]' in v_dial) = 0 then
    raise exception '20260929203000: apply 20260929201000 (state calling rules) first. Nothing was changed.';
  end if;
end;
$dep$;

-- ── 1. serve_eligible: the lead's own zone moves the clock (in place, single-line anchors) ──────
do $tz$
declare
  v_sig regprocedure := 'public.serve_eligible(uuid,uuid,timestamptz,boolean)'::regprocedure;
  v_body text;
  v_pair text[];
  v_pairs text[][] := array[
    array['    select tz.state, public.current_slot_for_state(tz.state, p_now) as slot',
          '    select tz.state, tz.timezone as zone, public.current_slot_for_state(tz.state, p_now) as slot,' || E'\n' ||
          '           public.tenant_can_dial_now(p_tenant_id, tz.state, null, p_now) as window_open'],
    array['     where public.tenant_can_dial_now(p_tenant_id, tz.state, null, p_now)',
          '     where public.agent_may_work_state(p_tenant_id, p_agent_user_id, tz.state)'],
    array['       and public.agent_may_work_state(p_tenant_id, p_agent_user_id, tz.state)',
          '       -- [203000] the window is read per lead in base, on the lead''s own zone when it has one'],
    array['       and not exists (select 1 from cw where cw.campaign_id = l.campaign_id and cw.state = st.state)',
          '       -- [203000] LA-2.2-4: a lead with its own dial_timezone (a split-zone ZIP) is judged on that clock' || E'\n' ||
          '       and case when l.dial_timezone is null or l.dial_timezone = st.zone' || E'\n' ||
          '                  then st.window_open and not exists (select 1 from cw where cw.campaign_id = l.campaign_id and cw.state = st.state)' || E'\n' ||
          '                when l.dial_timezone not in (select tz2.timezone from public.state_timezones tz2) then false' || E'\n' ||
          '                else coalesce(public.tenant_can_dial_now(p_tenant_id, st.state, l.campaign_id, ((p_now at time zone l.dial_timezone) at time zone st.zone)), false)' || E'\n' ||
          '           end']
  ];
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: serve_eligible patch skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('[203000]' in v_body) > 0 then
    raise notice '20260929203000: serve_eligible already reads the lead''s own zone';
    return;
  end if;
  foreach v_pair slice 1 in array v_pairs loop
    v_count := (length(v_body) - length(replace(v_body, E'\n' || v_pair[1] || E'\n', ''))) / length(E'\n' || v_pair[1] || E'\n');
    if v_count <> 1 then
      raise exception '20260929203000: expected this serve_eligible line once, found %: %', v_count, v_pair[1];
    end if;
    v_body := replace(v_body, E'\n' || v_pair[1] || E'\n', E'\n' || v_pair[2] || E'\n');
  end loop;
  execute v_body;
end;
$tz$;

revoke all on function public.serve_eligible(uuid, uuid, timestamp with time zone, boolean) from public, anon, authenticated;
grant execute on function public.serve_eligible(uuid, uuid, timestamp with time zone, boolean) to tenant_app, service_role;

-- ── 2. serve_eligible_ids: serve_eligible's body, for a given set of work items ────────────────
create or replace function public.serve_eligible_ids_regenerate()
returns void
language plpgsql
set search_path = public, pg_catalog
as $function$
declare
  v_src text := replace(pg_get_functiondef('public.serve_eligible(uuid,uuid,timestamptz,boolean)'::regprocedure), E'\r\n', E'\n');
  v_head text := 'public.serve_eligible(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean)';
  v_where text := E'\n     where q.tenant_id = p_tenant_id\n';
  v_new text;
begin
  if (length(v_src) - length(replace(v_src, v_head, ''))) / length(v_head) <> 1 then
    raise exception 'serve_eligible_ids_regenerate: the serve_eligible header is not there exactly once';
  end if;
  if (length(v_src) - length(replace(v_src, v_where, ''))) / length(v_where) <> 1 then
    raise exception 'serve_eligible_ids_regenerate: the work-item filter line is not there exactly once';
  end if;
  v_new := replace(v_src, v_head, 'public.serve_eligible_ids(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean, p_qids uuid[])');
  v_new := replace(v_new, v_where, E'\n     where q.tenant_id = p_tenant_id and q.id = any(p_qids)\n');
  execute v_new;
  execute 'revoke all on function public.serve_eligible_ids(uuid, uuid, timestamp with time zone, boolean, uuid[]) from public, anon, authenticated';
  execute 'grant execute on function public.serve_eligible_ids(uuid, uuid, timestamp with time zone, boolean, uuid[]) to tenant_app, service_role';
end;
$function$;

revoke all on function public.serve_eligible_ids_regenerate() from public, anon, authenticated, tenant_app, service_role;

do $gen$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: serve_eligible_ids not generated, % cannot create in public', current_user;
    return;
  end if;
  perform public.serve_eligible_ids_regenerate();
end;
$gen$;

-- ── 3. serve_lead_by_id: the same zone rule on the pick (in place, one line) ─────────────────
do $byid$
declare
  v_sig regprocedure := 'public.serve_lead_by_id(uuid,uuid,uuid)'::regprocedure;
  v_body text;
  v_old text := E'\n         tenant_can_dial_now(p_tenant_id, l.values->>''state'', l.campaign_id, v_now) as window_ok,\n';
  v_new text := E'\n         -- [203000] LA-2.2-4: the lead''s own dial_timezone moves the clock, a zone that is no state''s is refused\n'
             || E'         tenant_can_dial_now(p_tenant_id, l.values->>''state'', l.campaign_id,\n'
             || E'           case when l.dial_timezone is null then v_now\n'
             || E'                when l.dial_timezone in (select tz.timezone from state_timezones tz)\n'
             || E'                  then ((v_now at time zone l.dial_timezone) at time zone (select tz.timezone from state_timezones tz where tz.state = upper(l.values->>''state'')))\n'
             || E'           end) as window_ok,\n';
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: serve_lead_by_id patch skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('[203000]' in v_body) > 0 then
    raise notice '20260929203000: serve_lead_by_id already reads the lead''s own zone';
    return;
  end if;
  if (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old) <> 1 then
    raise exception '20260929203000: the serve_lead_by_id window line is not there exactly once';
  end if;
  execute replace(v_body, v_old, v_new);
end;
$byid$;

-- ── 4. the cheap sets, the fresh probe, the tier and the candidates ─────────────────────────
create or replace function public.serve_side_ok(p_bucket integer, p_side text, p_holdout integer)
returns boolean
language sql
immutable
as $function$
  select case p_side
           when 'all' then true
           when 'holdout' then p_bucket < p_holdout
           when 'rest' then p_bucket >= p_holdout
           else false
         end;
$function$;

-- Work items that can be tier 1, 2 or 3, and every work item the agent holds. Tiers 1 to 3 cannot
-- come from anywhere else: a post under five minutes old, a due callback, a due appointment.
create or replace function public.serve_small_qids(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamptz)
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) from (
    select q.id from public.lead_queue q
     where q.tenant_id = p_tenant_id and q.owner_user_id = p_agent_user_id and q.status = 'claimed'
    union all
    select q.id from public.agent_leads l
      join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
     where l.tenant_id = p_tenant_id and l.posted_at is not null and l.posted_at >= p_now - interval '5 minutes'
       and coalesce(l.attempts_made, 0) = 0
    union all
    select t.work_item_id from public.tenant_callbacks t
     where t.tenant_id = p_tenant_id and t.status in ('scheduled', 'due') and t.scheduled_at_utc <= p_now
       and t.work_item_id is not null
    union all
    select q.id from public.tenant_appointments a
      join public.lead_queue q on q.lead_id = a.lead_id and q.tenant_id = a.tenant_id and q.status in ('unclaimed', 'claimed')
     where a.tenant_id = p_tenant_id and a.status in ('booked', 'confirmed') and a.starts_at_utc <= p_now
  ) x;
$function$;

-- Work items whose lead is a retry or nurture touch that has come due: tiers 4 and 6 come only
-- from these (and from the agent's own, which serve_small_qids carries).
create or replace function public.serve_due_qids(p_tenant_id uuid, p_now timestamptz)
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(array_agg(q.id), '{}'::uuid[])
    from public.agent_leads l
    join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
   where l.tenant_id = p_tenant_id
     and l.lead_state in ('retry', 'nurture')
     and l.next_dial_after is not null and l.next_dial_after <= p_now;
$function$;

-- Fresh leads with their own dial_timezone (split-zone ZIPs, few). Their window is not their
-- state's, so they are always asked about directly instead of being filtered by state.
create or replace function public.serve_zoned_qids(p_tenant_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(array_agg(q.id), '{}'::uuid[])
    from public.agent_leads l
    join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
   where l.tenant_id = p_tenant_id and l.lead_state = 'fresh' and l.dial_timezone is not null;
$function$;

-- The states this agent may be served in right now on the state's own clock: licensed (with
-- expiry) and inside the agency's window. A lead in any other state can only be eligible through
-- its own dial_timezone, which serve_zoned_qids covers.
create or replace function public.serve_open_states(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamptz)
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(array_agg(tz.state order by tz.state), '{}'::text[])
    from public.state_timezones tz
   where public.agent_may_work_state(p_tenant_id, p_agent_user_id, tz.state)
     and public.tenant_can_dial_now(p_tenant_id, tz.state, null, p_now);
$function$;

-- One page of a campaign's fresh leads in one state, in creation order, with their work items,
-- after a keyset. p_campaign_id null reads the leads that have no campaign.
create or replace function public.serve_fresh_page(p_tenant_id uuid, p_campaign_id uuid, p_state text, p_newest boolean,
                                                   p_after_created timestamptz, p_after_lead uuid, p_limit integer)
returns table(qid uuid, lid uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
begin
  if p_campaign_id is null and not p_newest then
    return query
      select q.id, l.id, l.created_at from public.agent_leads l
        join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
       where l.tenant_id = p_tenant_id and l.lead_state = 'fresh' and l.campaign_id is null
         and upper(l.values->>'state') = p_state
         and (p_after_created is null or (l.created_at, l.id) > (p_after_created, p_after_lead))
       order by l.created_at, l.id
       limit p_limit;
  elsif p_campaign_id is null then
    return query
      select q.id, l.id, l.created_at from public.agent_leads l
        join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
       where l.tenant_id = p_tenant_id and l.lead_state = 'fresh' and l.campaign_id is null
         and upper(l.values->>'state') = p_state
         and (p_after_created is null or (l.created_at, l.id) < (p_after_created, p_after_lead))
       order by l.created_at desc, l.id desc
       limit p_limit;
  elsif not p_newest then
    return query
      select q.id, l.id, l.created_at from public.agent_leads l
        join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
       where l.tenant_id = p_tenant_id and l.lead_state = 'fresh' and l.campaign_id = p_campaign_id
         and upper(l.values->>'state') = p_state
         and (p_after_created is null or (l.created_at, l.id) > (p_after_created, p_after_lead))
       order by l.created_at, l.id
       limit p_limit;
  else
    return query
      select q.id, l.id, l.created_at from public.agent_leads l
        join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
       where l.tenant_id = p_tenant_id and l.lead_state = 'fresh' and l.campaign_id = p_campaign_id
         and upper(l.values->>'state') = p_state
         and (p_after_created is null or (l.created_at, l.id) < (p_after_created, p_after_lead))
       order by l.created_at desc, l.id desc
       limit p_limit;
  end if;
end;
$function$;

-- The eligible tier-5 rows of one campaign, read state by state in creation order, only as far
-- as the question needs:
--   p_mode 'any'    stop at the first eligible lead (does this campaign have one)
--   p_mode 'oldest' the oldest by age, coalesce(posted_at, queued_at). A campaign lead's age is
--                   never earlier than its creation, so a state is done once it reaches the
--                   best age found (an equal age is a tie)
--   p_mode 'newest' the newest p_cap by age, then every lead queued or posted after the cut-off,
--                   because a lead created earlier but queued later is newer than it looks
-- Leads with no campaign are read in full in their open states (their queue time can precede
-- their creation). Returns work-item ids to hand to serve_eligible_ids, not a verdict.
create or replace function public.serve_fresh_scan(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamptz,
                                                   p_pool_ok boolean, p_side text, p_holdout integer,
                                                   p_campaign_id uuid, p_states text[], p_mode text, p_cap integer,
                                                   p_seed uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_page constant integer := 100;
  v_first_size integer := case p_mode when 'any' then 5 when 'oldest' then 10 else 20 end;
  v_cap integer := greatest(coalesce(p_cap, 50), 1);
  v_keep uuid[] := coalesce(p_seed, '{}'::uuid[]);
  v_full boolean := p_campaign_id is null;
  v_newest boolean := p_mode = 'newest';
  v_fp jsonb;
  v_first uuid[];
  v_state text;
  v_qids uuid[];
  v_created timestamptz[];
  v_leads uuid[];
  v_n integer;
  v_after_created timestamptz;
  v_after_lead uuid;
  v_best timestamptz;
  v_cut timestamptz;
  v_kept integer := 0;
begin
  if cardinality(coalesce(p_states, '{}'::text[])) = 0 then return v_keep; end if;
  if v_full then v_first_size := v_page; end if;

  -- The first pass: the first page of every open state, and where each state's page ended.
  if v_newest then
    select coalesce(array_agg(f.qid), '{}'::uuid[]),
           coalesce(jsonb_object_agg(f.state, jsonb_build_object('n', f.n, 'c', f.c, 'l', f.l)) filter (where f.last), '{}'::jsonb)
      into v_first, v_fp
      from (
        select s.state, p.qid,
               count(*) over w as n,
               row_number() over (partition by s.state order by p.created_at, p.lid) = 1 as last,
               p.created_at as c, p.lid as l
          from unnest(p_states) s(state)
          cross join lateral public.serve_fresh_page(p_tenant_id, p_campaign_id, s.state, true, null, null, v_first_size) p
        window w as (partition by s.state)
      ) f;
  else
    select coalesce(array_agg(f.qid), '{}'::uuid[]),
           coalesce(jsonb_object_agg(f.state, jsonb_build_object('n', f.n, 'c', f.c, 'l', f.l)) filter (where f.last), '{}'::jsonb)
      into v_first, v_fp
      from (
        select s.state, p.qid,
               count(*) over w as n,
               row_number() over (partition by s.state order by p.created_at desc, p.lid desc) = 1 as last,
               p.created_at as c, p.lid as l
          from unnest(p_states) s(state)
          cross join lateral public.serve_fresh_page(p_tenant_id, p_campaign_id, s.state, false, null, null, v_first_size) p
        window w as (partition by s.state)
      ) f;
  end if;
  v_keep := v_keep || v_first;

  if not v_full then
    if p_mode = 'any' then
      if exists (select 1 from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
                  where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
                    and e.campaign_id is not distinct from p_campaign_id) then
        return v_keep;
      end if;
    elsif p_mode = 'oldest' then
      select min(coalesce(e.posted_at, e.queued_at)) into v_best
        from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
       where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
         and e.campaign_id is not distinct from p_campaign_id;
    else
      select count(*), min(k.age) into v_kept, v_cut from (
        select coalesce(e.posted_at, e.queued_at) as age
          from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
         where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
           and e.campaign_id is not distinct from p_campaign_id
         order by 1 desc limit v_cap) k;
    end if;
  end if;

  -- Then state by state, only where the first page was full and did not settle the question.
  for v_state in select jsonb_object_keys(v_fp) loop
    continue when (v_fp->v_state->>'n')::integer < v_first_size;
    v_after_created := (v_fp->v_state->>'c')::timestamptz;
    v_after_lead := (v_fp->v_state->>'l')::uuid;
    loop
      if not v_full then
        exit when p_mode = 'oldest' and v_best is not null and v_after_created >= v_best;
        exit when p_mode = 'newest' and v_kept >= v_cap and v_after_created <= v_cut;
      end if;
      if v_newest then
        select array_agg(p.qid order by p.created_at desc, p.lid desc), array_agg(p.created_at order by p.created_at desc, p.lid desc),
               array_agg(p.lid order by p.created_at desc, p.lid desc), count(*)
          into v_qids, v_created, v_leads, v_n
          from public.serve_fresh_page(p_tenant_id, p_campaign_id, v_state, true, v_after_created, v_after_lead, v_page) p;
      else
        select array_agg(p.qid order by p.created_at, p.lid), array_agg(p.created_at order by p.created_at, p.lid),
               array_agg(p.lid order by p.created_at, p.lid), count(*)
          into v_qids, v_created, v_leads, v_n
          from public.serve_fresh_page(p_tenant_id, p_campaign_id, v_state, false, v_after_created, v_after_lead, v_page) p;
      end if;
      exit when coalesce(v_n, 0) = 0;
      v_keep := v_keep || v_qids;
      v_after_created := v_created[v_n];
      v_after_lead := v_leads[v_n];
      if not v_full then
        if p_mode = 'any' then
          if exists (select 1 from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_qids) e
                      where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
                        and e.campaign_id is not distinct from p_campaign_id) then
            return v_keep;
          end if;
        elsif p_mode = 'oldest' then
          select least(v_best, min(coalesce(e.posted_at, e.queued_at))) into v_best
            from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_qids) e
           where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
             and e.campaign_id is not distinct from p_campaign_id;
        else
          select count(*), min(k.age) into v_kept, v_cut from (
            select coalesce(e.posted_at, e.queued_at) as age
              from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
             where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
               and e.campaign_id is not distinct from p_campaign_id
             order by 1 desc limit v_cap) k;
        end if;
      end if;
      exit when v_n < v_page;
    end loop;
  end loop;

  if v_newest and not v_full and v_cut is not null then
    -- A lead created before the cut-off but queued or posted after it is newer than it looks.
    select min(k.age) into v_cut from (
      select coalesce(e.posted_at, e.queued_at) as age
        from public.serve_eligible_ids(p_tenant_id, p_agent_user_id, p_now, p_pool_ok, v_keep) e
       where public.serve_side_ok(e.holdout_bucket, p_side, p_holdout) and e.priority = 5
         and e.campaign_id is not distinct from p_campaign_id
       order by 1 desc limit v_cap) k;
    v_keep := v_keep || coalesce((
      select array_agg(q.id) from public.lead_queue q
        join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
       where q.tenant_id = p_tenant_id and q.status in ('unclaimed', 'claimed') and q.queued_at > v_cut
         and l.lead_state = 'fresh' and l.campaign_id = p_campaign_id
         and upper(l.values->>'state') = any(p_states)), '{}'::uuid[])
      || coalesce((
      select array_agg(q.id) from public.agent_leads l
        join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id and q.status in ('unclaimed', 'claimed')
       where l.tenant_id = p_tenant_id and l.posted_at is not null and l.posted_at > v_cut
         and l.lead_state = 'fresh' and l.campaign_id = p_campaign_id
         and upper(l.values->>'state') = any(p_states)), '{}'::uuid[]);
  end if;
  return v_keep;
end;
$function$;

-- The lowest tier any eligible lead on this side is in, and the campaigns with a lead in it (with
-- their mixing weight). Empty when nothing on this side is eligible. p_min_tier asks for the lowest
-- tier at or above it, which is how the equivalence check below reaches every tier.
create or replace function public.serve_top(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamptz,
                                            p_pool_ok boolean, p_side text, p_holdout integer,
                                            p_min_tier integer default 1)
returns table(tier integer, campaign_id uuid, weight integer)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_small uuid[] := public.serve_small_qids(p_tenant_id, p_agent_user_id, p_now);
  v_zoned uuid[] := public.serve_zoned_qids(p_tenant_id);
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

  v_due := public.serve_due_qids(p_tenant_id, p_now);
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

-- The candidates in one tier of one campaign, in 711400's order: the oldest first (p_newest false)
-- or the newest first (p_newest true, the scored cohort), at most p_cap. Age is
-- coalesce(posted_at, queued_at), exactly what 711400 ordered by.
create or replace function public.serve_tier_candidates(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamptz,
                                                        p_pool_ok boolean, p_side text, p_holdout integer,
                                                        p_tier integer, p_campaign_id uuid, p_newest boolean, p_cap integer)
returns table(qid uuid, lid uuid, own boolean, priority integer, posted_at timestamptz, queued_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_cap integer := greatest(coalesce(p_cap, 50), 1);
  v_keep uuid[];
begin
  v_keep := public.serve_small_qids(p_tenant_id, p_agent_user_id, p_now);
  if p_tier in (4, 6) then
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

revoke all on function public.serve_small_qids(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.serve_due_qids(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.serve_zoned_qids(uuid) from public, anon, authenticated;
revoke all on function public.serve_open_states(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.serve_fresh_page(uuid, uuid, text, boolean, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.serve_fresh_scan(uuid, uuid, timestamptz, boolean, text, integer, uuid, text[], text, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.serve_top(uuid, uuid, timestamptz, boolean, text, integer, integer) from public, anon, authenticated;
revoke all on function public.serve_tier_candidates(uuid, uuid, timestamptz, boolean, text, integer, integer, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.serve_side_ok(integer, text, integer) to tenant_app, service_role;
grant execute on function public.serve_small_qids(uuid, uuid, timestamptz) to tenant_app, service_role;
grant execute on function public.serve_due_qids(uuid, timestamptz) to tenant_app, service_role;
grant execute on function public.serve_zoned_qids(uuid) to tenant_app, service_role;
grant execute on function public.serve_open_states(uuid, uuid, timestamptz) to tenant_app, service_role;
grant execute on function public.serve_fresh_page(uuid, uuid, text, boolean, timestamptz, uuid, integer) to tenant_app, service_role;
grant execute on function public.serve_fresh_scan(uuid, uuid, timestamptz, boolean, text, integer, uuid, text[], text, integer, uuid[]) to tenant_app, service_role;
grant execute on function public.serve_top(uuid, uuid, timestamptz, boolean, text, integer, integer) to tenant_app, service_role;
grant execute on function public.serve_tier_candidates(uuid, uuid, timestamptz, boolean, text, integer, integer, uuid, boolean, integer) to tenant_app, service_role;

-- ── 5. serve_next_lead: the live body (711400 + 711500), with the choice block replaced ───────
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
  -- [203000] the side this serve reads, whether it had anything, and the draw's answer
  v_side text;
  v_pref boolean := false;
  v_top integer;
  v_campaign uuid;
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

  -- ── [203000] the choice, without listing every eligible lead ─────────────
  --
  -- The same three steps as 711400 (the lowest tier any eligible lead is in, ONE weighted draw
  -- among the campaigns with a lead in that tier, then the best score among that campaign's newest
  -- v_candidate_cap or, in the naive order, the oldest), and the same cohort sides. What changed
  -- is how much is read to answer them. serve_top() asks the small sets first (the agent's own
  -- leads, posts under five minutes old, due callbacks, due appointments), then the due retries
  -- and nurture touches, then ONE probe per campaign for its first eligible fresh lead, and stops
  -- at the first tier that answers. serve_tier_candidates() then reads the chosen campaign in
  -- lead order only as far as the answer needs. Eligibility is serve_eligible_ids(): the body of
  -- serve_eligible, generated from it, for a given set of work items (one rulebook).
  v_side := case when not v_enabled then 'all' when v_serve_control then 'holdout' else 'rest' end;

  select t.tier, t.campaign_id into v_top, v_campaign
    from public.serve_top(p_tenant_id, p_agent_user_id, v_now, v_pool_ok, v_side, v_holdout) t
   order by -ln(greatest(random(), 1e-9)) / greatest(t.weight, 1)
   limit 1;
  v_pref := v_top is not null;
  -- Cohorts, unchanged: when this serve's side has nothing at all, every eligible lead in the
  -- naive order.
  if not v_pref and v_side <> 'all' then
    v_side := 'all';
    select t.tier, t.campaign_id into v_top, v_campaign
      from public.serve_top(p_tenant_id, p_agent_user_id, v_now, v_pool_ok, v_side, v_holdout) t
     order by -ln(greatest(random(), 1e-9)) / greatest(t.weight, 1)
     limit 1;
  end if;
  v_scored := v_enabled and not v_serve_control and v_pref;

  if v_top is not null then
    -- (not `s`: serve_next_lead declares a PL/pgSQL record named s, which would shadow the alias)
    select c.qid, c.lid, c.priority, c.own
      into v_qid, v_lead, v_priority, v_own
      from public.serve_tier_candidates(p_tenant_id, p_agent_user_id, v_now, v_pool_ok, v_side, v_holdout,
                                        v_top, v_campaign, v_scored, v_candidate_cap) c
      left join lateral (
        select sl.score from public.score_lead(p_tenant_id, c.lid, v_now) sl
         where v_scored
      ) lsc on true
     order by lsc.score desc nulls last,
              case when v_scored then -extract(epoch from coalesce(c.posted_at, c.queued_at))
                   else extract(epoch from coalesce(c.posted_at, c.queued_at)) end,
              c.qid
     limit 1;
  end if;

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
         -- [711500] first_dial_at is the first Dial click (trigger on tenant_call_attempts), not the serve.
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

-- ── 6. every rule 711400 asserts, the one rulebook, and the zone rule ──────────────────────────
do $check$
declare
  v_serve text;
  v_elig text;
  v_ids text;
  v_byid text;
  v_prev text;
  v_top text;
  v_licence text;
  v_expected text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_serve := replace(pg_get_functiondef('public.serve_next_lead(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  v_elig := replace(pg_get_functiondef('public.serve_eligible(uuid,uuid,timestamptz,boolean)'::regprocedure), E'\r\n', E'\n');
  v_ids := replace(pg_get_functiondef('public.serve_eligible_ids(uuid,uuid,timestamptz,boolean,uuid[])'::regprocedure), E'\r\n', E'\n');
  v_byid := replace(pg_get_functiondef('public.serve_lead_by_id(uuid,uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  v_prev := replace(pg_get_functiondef('public.dialer_queue_preview(uuid,uuid,integer[],integer,integer)'::regprocedure), E'\r\n', E'\n');
  v_top := replace(pg_get_functiondef('public.serve_top(uuid,uuid,timestamptz,boolean,text,integer,integer)'::regprocedure), E'\r\n', E'\n');
  v_licence := replace(pg_get_functiondef('public.agent_may_work_state(uuid,uuid,text)'::regprocedure), E'\r\n', E'\n');
  -- one rulebook: serve_eligible_ids is serve_eligible's body with only the header and the work-item filter changed
  v_expected := replace(replace(v_elig,
      'public.serve_eligible(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean)',
      'public.serve_eligible_ids(p_tenant_id uuid, p_agent_user_id uuid, p_now timestamp with time zone, p_pool_ok boolean, p_qids uuid[])'),
    E'\n     where q.tenant_id = p_tenant_id\n', E'\n     where q.tenant_id = p_tenant_id and q.id = any(p_qids)\n');
  if v_ids <> v_expected then raise exception '203000 check: serve_eligible_ids is not serve_eligible''s body (one rulebook)'; end if;
  -- the capacity gate, holder-first reclaim, holdout cohort, claim, lock and decision row
  if v_serve not like '%agent_can_take_pool_lead%' or v_elig not like '%p_pool_ok%' then raise exception '203000 check: capacity gate lost'; end if;
  if (length(v_serve) - length(replace(v_serve, 'callback_work_item_holder', ''))) / length('callback_work_item_holder') < 2 then
    raise exception '203000 check: holder-first reclaim lost'; end if;
  if v_elig not like '%coalesce(public.callback_work_item_holder(p_tenant_id, q.id), public.lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id%' then
    raise exception '203000 check: holder-first own-lead rule lost'; end if;
  if v_serve not like '%v_serve_control%' or v_serve not like '%hashtextextended%' or v_elig not like '%holdout_bucket%' then raise exception '203000 check: holdout cohort lost'; end if;
  if v_serve not like '%tenant_scoring_decisions%' or v_serve not like '%v_lock_minutes%' or v_serve not like '%where q.id = v_qid and q.status = ''unclaimed''%' then
    raise exception '203000 check: claim, lock or decision row lost'; end if;
  if v_serve like '%first_dial_at = coalesce%' then raise exception '203000 check: 711500 (first dial is the click) was undone'; end if;
  -- the tiers
  if v_elig not like '%public.callback_tier_due(p_tenant_id, t.work_item_id, p_now)%' then raise exception '203000 check: tier 2 is no longer callback_tier_due'; end if;
  if v_elig not like '%u.attempts_made = 0 then 1%' then raise exception '203000 check: tier 1 no longer requires attempts_made = 0'; end if;
  if v_elig not like '%and u.recycled%' then raise exception '203000 check: a recycled retry no longer goes to tier 6'; end if;
  if v_elig not like '%''exhausted''%' then raise exception '203000 check: exhausted leads are servable'; end if;
  -- the gates
  if v_elig not like '%public.campaigns_servable%' or v_top not like '%campaigns_servable%' then raise exception '203000 check: the scrub gate (campaigns_servable) is gone'; end if;
  if v_elig not like '%public.agent_may_work_state(p_tenant_id, p_agent_user_id, tz.state)%' then raise exception '203000 check: the licence gate is gone'; end if;
  if v_licence not like '%expires_on is null or s.expires_on >= current_date%' then raise exception '203000 check: licence expiry is gone'; end if;
  if v_elig not like '%tenant_suppression_list%' or v_elig not like '%x.phone_digits = d.digits and x.is_active)%' then raise exception '203000 check: suppression is gone'; end if;
  if v_ids not like '%public.dnc_exemption_active_id(p_tenant_id, d.digits, p_now) is not null%' then raise exception '203000 check: the DNC exemption (200200) did not reach serve_eligible_ids'; end if;
  -- the zone rule, on the serve, the preview (through serve_eligible) and the pick
  if v_elig not like '%l.dial_timezone%' or v_ids not like '%l.dial_timezone%' or v_byid not like '%l.dial_timezone%' then raise exception '203000 check: dial_timezone is not read on every path'; end if;
  if v_prev not like '%public.serve_eligible(p_tenant_id, p_agent_user_id, v_now, v_pool_ok)%' then raise exception '203000 check: the queue preview no longer reads serve_eligible'; end if;
  if v_byid not like '%[711400]%' or v_byid not like '%attempts_made, 0) = 0 then 1%' then raise exception '203000 check: serve_lead_by_id lost a 711400 tier rule'; end if;
  -- the weighted campaign draw
  if v_serve not like '%order by -ln(greatest(random(), 1e-9)) / greatest(t.weight, 1)%' then raise exception '203000 check: the weighted campaign draw is gone'; end if;
  if v_serve not like '%public.serve_top(%' or v_serve not like '%public.serve_tier_candidates(%' or v_serve like '%el_all%' then raise exception '203000 check: serve_next_lead still lists every eligible lead'; end if;
end;
$check$;

-- ── 7. the weighted draw still serves 4:2 as about 2:1 ────────────────────────────────────────
do $mix$
declare
  v_share numeric;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: draw check skipped, % cannot create in public', current_user;
    return;
  end if;
  -- the exact expression serve_next_lead draws with, over two campaigns weighted 4 and 2
  select avg(case when x.w = 4 then 1 else 0 end) into v_share
    from generate_series(1, 6000) g
    cross join lateral (
      select c.w from (values (4), (2)) c(w)
       where g.g > 0
       order by -ln(greatest(random(), 1e-9)) / greatest(c.w, 1)
       limit 1
    ) x;
  if v_share < 0.62 or v_share > 0.72 then
    raise exception '203000 check: weights 4 and 2 served % : %, not about 67 : 33', round(v_share * 100), round((1 - v_share) * 100);
  end if;
  raise notice '203000: weights 4 and 2 served % : %', round(v_share * 100), round((1 - v_share) * 100);
end;
$mix$;

-- ── 8. the new choice picks what the old one picked (demo tenant, read only) ──────────────────
--
-- The old choice, written out from serve_eligible over EVERY eligible lead, against the new one,
-- for up to two agents and each cohort side: the same top tier, the same campaigns in it, the
-- same age for the naive pick in each campaign, and the same ages for the scored cohort's newest
-- 50. Ages, not work items, because a tie between two leads of the same age was broken by sort
-- order before and by work-item id now.
do $same$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz;
  v_day date := current_date + 1;
  v_holdout integer;
  v_agent record;
  v_pool boolean;
  v_side text;
  v_old_top integer;
  v_new_top integer;
  v_old_camps uuid[];
  v_new_camps uuid[];
  v_camp uuid;
  v_old_age timestamptz;
  v_new_age timestamptz;
  v_old_ages timestamptz[];
  v_new_ages timestamptz[];
  v_checked integer := 0;
  v_tier integer;
  v_group record;
  v_old_has boolean;
  v_new_has boolean;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: equivalence check skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from public.tenants where id = v_tenant) then
    raise notice '20260929203000: equivalence check skipped, the demo tenant is not in this database';
    return;
  end if;
  -- An instant every US calling window is open (1 pm Eastern on the next unblocked Tuesday), so the
  -- comparison is never vacuous whatever time this runs.
  while extract(dow from v_day) <> 2 or exists (select 1 from public.calling_window_holidays h where h.holiday_date = v_day and h.blocked) loop
    v_day := v_day + 1;
  end loop;
  v_now := (v_day + time '13:00') at time zone 'America/New_York';
  select coalesce(nullif(ts.holdout_pct, 0), 10) into v_holdout from public.tenant_scoring_settings ts where ts.tenant_id = v_tenant;
  v_holdout := coalesce(v_holdout, 10);

  for v_agent in
    select tu.user_id from public.tenant_users tu
     where tu.tenant_id = v_tenant and tu.role::text in ('owner', 'producer', 'setter') and tu.accepted_at is not null
     order by tu.role::text, tu.user_id
     limit 2
  loop
    v_pool := public.agent_can_take_pool_lead(v_tenant, v_agent.user_id);
    drop table if exists serve_203000_ref;
    create temp table serve_203000_ref on commit drop as
      select * from public.serve_eligible(v_tenant, v_agent.user_id, v_now, v_pool);

    foreach v_side in array array['all', 'rest', 'holdout'] loop
      select min(r.priority) into v_old_top from serve_203000_ref r where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout);
      select array_agg(distinct coalesce(r.campaign_id, v_zero) order by coalesce(r.campaign_id, v_zero)) into v_old_camps
        from serve_203000_ref r where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority = v_old_top;
      select min(t.tier), array_agg(coalesce(t.campaign_id, v_zero) order by coalesce(t.campaign_id, v_zero))
        into v_new_top, v_new_camps
        from public.serve_top(v_tenant, v_agent.user_id, v_now, v_pool, v_side, v_holdout) t;
      if v_old_top is distinct from v_new_top or v_old_camps is distinct from v_new_camps then
        raise exception '203000 check: agent %, side %: old tier % campaigns %, new tier % campaigns %',
          v_agent.user_id, v_side, v_old_top, v_old_camps, v_new_top, v_new_camps;
      end if;
      continue when v_old_top is null;

      -- serve_top at every tier, not only the top one: the lowest tier at or above each, and its campaigns.
      for v_tier in 2..6 loop
        select min(r.priority) into v_old_top from serve_203000_ref r
         where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority >= v_tier;
        select array_agg(distinct coalesce(r.campaign_id, v_zero) order by coalesce(r.campaign_id, v_zero)) into v_old_camps
          from serve_203000_ref r where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority = v_old_top;
        select min(t.tier), array_agg(coalesce(t.campaign_id, v_zero) order by coalesce(t.campaign_id, v_zero))
          into v_new_top, v_new_camps
          from public.serve_top(v_tenant, v_agent.user_id, v_now, v_pool, v_side, v_holdout, v_tier) t;
        if v_old_top is distinct from v_new_top or v_old_camps is distinct from v_new_camps then
          raise exception '203000 check: agent %, side %, from tier %: old tier % campaigns %, new tier % campaigns %',
            v_agent.user_id, v_side, v_tier, v_old_top, v_old_camps, v_new_top, v_new_camps;
        end if;
        v_checked := v_checked + 1;
      end loop;

      -- Every tier present, not only the top one: the same picks per campaign (at most three).
      foreach v_tier in array coalesce((select array_agg(distinct r.priority order by r.priority) from serve_203000_ref r
                                         where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout)), '{}'::integer[]) loop
        foreach v_camp in array coalesce((select (array_agg(distinct coalesce(r.campaign_id, v_zero) order by coalesce(r.campaign_id, v_zero)))[1:3]
                                            from serve_203000_ref r
                                           where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority = v_tier), '{}'::uuid[]) loop
          select min(coalesce(r.posted_at, r.queued_at)) into v_old_age
            from serve_203000_ref r
           where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority = v_tier
             and coalesce(r.campaign_id, v_zero) = v_camp;
          select coalesce(c.posted_at, c.queued_at) into v_new_age
            from public.serve_tier_candidates(v_tenant, v_agent.user_id, v_now, v_pool, v_side, v_holdout, v_tier,
                                              nullif(v_camp, v_zero), false, 50) c
           limit 1;
          if v_old_age is distinct from v_new_age then
            raise exception '203000 check: agent %, side %, tier %, campaign %: naive pick aged % before, % now',
              v_agent.user_id, v_side, v_tier, v_camp, v_old_age, v_new_age;
          end if;
          select array_agg(k.age order by k.age desc) into v_old_ages from (
            select coalesce(r.posted_at, r.queued_at) as age from serve_203000_ref r
             where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority = v_tier
               and coalesce(r.campaign_id, v_zero) = v_camp
             order by 1 desc limit 50) k;
          select array_agg(coalesce(c.posted_at, c.queued_at) order by coalesce(c.posted_at, c.queued_at) desc) into v_new_ages
            from public.serve_tier_candidates(v_tenant, v_agent.user_id, v_now, v_pool, v_side, v_holdout, v_tier,
                                              nullif(v_camp, v_zero), true, 50) c;
          if v_old_ages is distinct from v_new_ages then
            raise exception '203000 check: agent %, side %, tier %, campaign %: the scored cohort''s newest 50 differ',
              v_agent.user_id, v_side, v_tier, v_camp;
          end if;
          v_checked := v_checked + 1;
        end loop;
      end loop;

      -- The fresh probe serve_top runs: a campaign (or no campaign) has an eligible fresh lead exactly
      -- when the full list had one.
      for v_group in
        select sc.id from public.campaigns_servable sc where sc.tenant_id = v_tenant
        union all select null::uuid
      loop
        v_old_has := exists (select 1 from serve_203000_ref r
                              where public.serve_side_ok(r.holdout_bucket, v_side, v_holdout) and r.priority = 5
                                and r.campaign_id is not distinct from v_group.id);
        v_new_has := exists (
          select 1 from public.serve_eligible_ids(v_tenant, v_agent.user_id, v_now, v_pool,
                          public.serve_small_qids(v_tenant, v_agent.user_id, v_now) || public.serve_zoned_qids(v_tenant)
                          || public.serve_fresh_scan(v_tenant, v_agent.user_id, v_now, v_pool, v_side, v_holdout, v_group.id,
                                                     public.serve_open_states(v_tenant, v_agent.user_id, v_now), 'any', 1, '{}'::uuid[])) e
           where public.serve_side_ok(e.holdout_bucket, v_side, v_holdout) and e.priority = 5
             and e.campaign_id is not distinct from v_group.id);
        if v_old_has <> v_new_has then
          raise exception '203000 check: agent %, side %, campaign %: a fresh lead was % before and % now',
            v_agent.user_id, v_side, v_group.id, case when v_old_has then 'eligible' else 'absent' end, case when v_new_has then 'found' else 'not found' end;
        end if;
        v_checked := v_checked + 1;
      end loop;
    end loop;
  end loop;
  raise notice '203000: the new choice matched the old one in % (agent, side, tier, campaign) cases', v_checked;
end;
$same$;

-- ── 9. a FL panhandle lead (32501, Central) is refused at 8:30 Eastern, 7:30 Central ─────────
do $zone$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_owner uuid;
  v_base record;
  v_lead uuid := gen_random_uuid();
  v_qid uuid := gen_random_uuid();
  v_day date := current_date + 1;
  v_at timestamptz;
  v_n integer;
  v_open boolean;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203000: zone check skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from public.tenants where id = v_tenant) then
    raise notice '20260929203000: zone check skipped, the demo tenant is not in this database';
    return;
  end if;
  -- the next Tuesday that no calendar blocks
  while extract(dow from v_day) <> 2 or exists (select 1 from public.calling_window_holidays h where h.holiday_date = v_day and h.blocked) loop
    v_day := v_day + 1;
  end loop;
  v_at := (v_day + time '08:30') at time zone 'America/New_York';

  -- the clock: Eastern 8:30 is inside the window, the same instant on a Central clock (7:30) is not
  if public.calling_window_rules_stale(now()) then
    raise notice '20260929203000: zone check skipped, the calling-rules feed is stale so every window is closed';
    return;
  end if;
  if not public.tenant_can_dial_now(v_tenant, 'FL', null, v_at) then
    raise exception '203000 check: FL at 8:30 Eastern on % should be inside the window', v_day;
  end if;
  if public.tenant_can_dial_now(v_tenant, 'FL', null, ((v_at at time zone 'America/Chicago') at time zone 'America/New_York')) then
    raise exception '203000 check: FL on a Central clock (7:30) should be outside the window';
  end if;

  select tu.user_id into v_owner from public.tenant_users tu where tu.tenant_id = v_tenant and tu.role::text = 'owner' limit 1;
  select l.template_id, l.template_version, l.tenant_template_id, l.definition_version, l.product_line, l.pipeline_id, l.stage_id, l.created_by
    into v_base from public.agent_leads l where l.tenant_id = v_tenant and l.campaign_id is null limit 1;
  begin
    insert into public.agent_leads (id, tenant_id, template_id, template_version, tenant_template_id, definition_version,
                                    product_line, pipeline_id, stage_id, values, created_by, lead_state, dial_timezone)
    values (v_lead, v_tenant, v_base.template_id, v_base.template_version, v_base.tenant_template_id, v_base.definition_version,
            v_base.product_line, v_base.pipeline_id, v_base.stage_id,
            jsonb_build_object('first_name', 'Zone', 'last_name', 'Check', 'phone', '8505550142', 'state', 'FL', 'zip', '32501'),
            v_base.created_by, 'fresh', 'America/Chicago');
    insert into public.lead_queue (id, tenant_id, lead_id, product_line, pipeline_id, stage_id, status, queued_at)
    values (v_qid, v_tenant, v_lead, v_base.product_line, v_base.pipeline_id, v_base.stage_id, 'unclaimed', v_at - interval '1 hour');

    select count(*) into v_n from public.serve_eligible_ids(v_tenant, v_owner, v_at, true, array[v_qid]);
    if v_n <> 0 then raise exception '203000 check: a 32501 lead was servable at 7:30 Central'; end if;

    -- The same lead without its own zone is judged on the state's clock (8:30 Eastern), and served
    -- when the owner may work FL.
    update public.agent_leads set dial_timezone = null where id = v_lead;
    select count(*) into v_n from public.serve_eligible_ids(v_tenant, v_owner, v_at, true, array[v_qid]);
    v_open := public.agent_may_work_state(v_tenant, v_owner, 'FL');
    if v_open and v_n <> 1 then raise exception '203000 check: the same lead on the state''s clock was not servable'; end if;
    if not v_open then raise notice '203000: the demo owner may not work FL, so only the refusal half was checked'; end if;

    -- And an hour later (8:30 Central) the zoned lead is servable.
    update public.agent_leads set dial_timezone = 'America/Chicago' where id = v_lead;
    select count(*) into v_n from public.serve_eligible_ids(v_tenant, v_owner, v_at + interval '1 hour', true, array[v_qid]);
    if v_open and v_n <> 1 then raise exception '203000 check: the 32501 lead was not servable at 8:30 Central'; end if;

    raise exception 'M2_203000_ZONE_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'M2_203000_ZONE_ROLLBACK' then raise; end if;
  end;
  raise notice '203000: a 32501 lead is refused at 7:30 Central and served at 8:30 Central (rolled back)';
end;
$zone$;
